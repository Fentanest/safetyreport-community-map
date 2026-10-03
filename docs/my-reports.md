# 확장 본인 완료 신고 조회 API

상태: 로컬 구현. 운영 DB 적용과 Edge 배포는 별도 작업이다. 공개 지도 API·10건 열람 기준을 변경하지 않는다.

## 계약

`POST /functions/v1/my-reports/{summary|search|numbers}`. 요청은 `Authorization: Bearer <Supabase access token>`, `apikey: <publishable key>`, `Content-Type: application/json`을 사용한다. 응답은 항상 `Cache-Control: private, no-store`와 `Vary: Origin, Authorization`을 붙인다. CORS는 `MY_REPORTS_ALLOWED_ORIGINS`에 명시된 확장 origin만 허용한다. CORS는 인증을 대신하지 않는다.

- `summary`: `{ "offset": 0, "limit": 20 }`. 자기 완료 신고 전체 집계와 Asia/Seoul 오늘+직전 2일에 답변된 첫 페이지를 반환한다.
- `search`: `{ "kind": "vehicle"|"address", "query": "…", "offset": 0, "limit": 20, "expected_version": "…" }`. 차량은 NFC·모든 공백 제거 후 Unicode 코드포인트 6~64자 부분 일치다. 주소는 연속 공백을 한 칸으로 정리해 같은 주소를 조회한다.
- `numbers`: search와 같은 조건. 번호복사에 필요한 `report_number`만 페이지당 최대 50개 반환한다. 번호 없는 완료 신고는 `missing_numbers`로 알린다.

응답 공통 구조: `{ version, total, missing_numbers, summary, managers, manager_total, managers_truncated, items, next_offset }`. `summary`는 검색 결과 **전체**의 상태·처분·확정 과태료 합계이며 `items`는 한 페이지다. 담당자 집계도 전체 검색 결과를 기준으로 계산하며, 표시 행은 건수 상위 100명까지 제한하고 초과 여부를 밝힌다. `version`은 소유자 범위에서 선출한 신고 집합에 묶이며 다음 페이지에 `expected_version`을 넣는다. 변동 시 HTTP 409로 처음부터 다시 조회한다. `next_offset=null`이면 끝이다. 페이지 크기는 1~50, offset은 0~5000이다.

행 DTO에는 실제 신고번호, 원천 상세 ID, 원본 차량번호, 신고·완료일, 분류, 처리 결과, 처분, 확정금액, 벌점, 주소·좌표, 기관·담당자, 법규, 숫자 별점만 있다. 제목·본문·답변 원문·첨부·사유·업로드 payload는 없다. `source_report_id`는 `report_number`와 다르며 실제 상세 링크를 만드는 값이다.

## 권한과 데이터 선택

Edge handler가 `auth.getUser(token)`과 JWT의 UID·role·audience·session을 확인한다. RPC는 `private.community_identity_state`로 실제 Kakao identity 및 활성 세션을 다시 확인한다. 본인 조건을 먼저 적용하고 현재 활성 동의 계보의 완료 신고 4상태만 선택한 후 `source_report_key|report_number` 단위로 관측 중복을 정리한다. 전체 지도 10건 gate나 공개 집계 ready 상태는 본인 읽기에 적용하지 않는다. 새 계정의 빈 결과를 허용하고 writer를 등록하지 않는다.

내부 RPC `public.internal_my_reports`는 `service_role`만 실행할 수 있다. `anon`·`authenticated`·`public`에는 실행 권한이 없다. 행 선택·요약·페이지는 한 SQL 문장 안에서 계산한다. 사용자별 rate bucket, 4KiB 요청 본문·256KiB 응답 상한, owner 인덱스, 5초 statement timeout을 둔다. 토큰·요청 본문·원본 번호를 로그로 남기지 않는다.

## 적용 순서와 운영 설정

1. 기존 community fact/identity/rating 마이그레이션 뒤 `202609300200_my_reports.sql`을 적용한다. 운영 적용 전 현재 DB의 선행 버전을 확인한다.
2. `MY_REPORTS_ALLOWED_ORIGINS=chrome-extension://<실제 확장 ID>`를 Edge secret으로 설정한다. 스토어 확장 ID와 개발용 unpacked ID는 다를 수 있다. `MY_REPORTS_ENABLED` 기본 true; 일시 중단은 false.
3. 기존 `SUPABASE_URL`, `SUPABASE_SECRET_KEYS` 또는 `SUPABASE_SERVICE_ROLE_KEY`, `AUTH_JWT_ISSUER`를 서버에서 재사용한다. 비밀키를 확장 빌드에 넣지 않는다.
4. `supabase functions deploy my-reports` 후 OPTIONS, 인증 실패, A/B 소유자 격리, 0~9건 본인, 번호복사, 직접 RPC 권한을 실제 운영 설정에서 점검한다.
5. Supabase Auth Redirect URLs에 정확한 `chrome.identity.getRedirectURL('supabase-auth')`를 추가한다. 기존 PC·모바일·지도 URL은 유지한다. Kakao 개발자 콘솔의 Supabase Auth callback은 별도 항목이다.

오류 코드: `auth_required`/`session_expired`(401), `kakao_required`/`account_ineligible`/`origin_forbidden`(403), `INVALID_QUERY`(400), `DATASET_CHANGED`(409), `RESULT_TOO_LARGE`(422), `rate_limited`(429), `service_unavailable`(503). `report_number`가 없는 행에는 가짜 번호나 링크를 만들지 않는다.

## 로컬 확인 기록

2026-09-30에 Docker의 기존 로컬 통합 DB에서 **롤백하는 트랜잭션** 안에 합성 A/B 계정·신고를 넣어 SQL을 실행했다. 이 로컬 DB는 최신 운영 스키마보다 오래되어 새 컬럼과 인증·동의 fixture 함수를 트랜잭션 안에서만 보완했다. A의 동일 신고 2관측은 1건으로 선출되고 B의 같은 차량·신고는 A의 결과에 섞이지 않았다. RPC 실행 권한은 `anon=false`, `authenticated=false`, `service_role=true`였다. 트랜잭션을 롤백했으며 운영 DB에 적용한 검증이 아니다.

## 2026-10-03 랭킹과의 관계

유저 랭킹은 최신 정본 `contracts/my-reports/README.md` §1.3의 **사용자 범위→identity→대표 선정→조건**을 재사용한다.
신규 set-wise `ranking_representatives`와 `my_reports_own`의 identity 동일성을 실제 DB 통합 테스트로 비교한다.
랭킹 공개 UUID를 my-reports 입력으로 받지 않는다. 원문/차량/주소 조회는 계속 검증 JWT 본인만 가능하다.
[랭킹 계약](../contracts/user-rankings/README.md)의 F 건수는 실제 처분 확인 기준이며 기존 확정금액 합산과 별개의 지표다.
