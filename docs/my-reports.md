# 확장 본인 완료 신고 조회 API

정본은 [my-reports-v1](../contracts/my-reports/README.md)과 같은 폴더의 `types.ts`·JSON Schema다.
2026-10-13 차량 최소 길이 변경은 로컬 후보이며 운영 DB·Edge에는 적용하지 않았다.

## 계약

`POST /functions/v1/my-reports/{summary|search|numbers}`. Supabase 사용자 Bearer 토큰과 publishable apikey를 쓴다.
응답은 `Cache-Control: private, no-store, max-age=0`, `Vary: Origin, Authorization`이다.
CORS는 설정된 확장 origin만 허용하며 인증을 대신하지 않는다.

- `search`: `{ "kind": "vehicle", "query": "5902", "page_size": 20, "managers_page_size": 10 }`.
  차량은 NFC·모든 공백 제거 후 Unicode **4~64 코드포인트**의 문자 그대로 부분 일치(`strpos > 0`)다.
  숫자만인 `5902`, 공백을 포함한 ` 5 9 0 2 `도 같다. 3자 이하는 `400 QUERY_LENGTH`다.
  주소는 NFC·trim·연속 공백 축소 후 5~200 코드포인트이며 기존 동일 주소 규칙을 유지한다.
- `numbers`: 같은 kind/query와 `page_size`(기본 200, 최대 500). 실제 신고번호를 중복 제거해 반환한다.
  전체 복사 가능 번호는 최대 10,000개이며 초과 시 `422 NUMBERS_LIMIT_EXCEEDED`다. 번호 없는 신고는
  `without_number`에 포함하고 가짜 번호나 source ID로 대체하지 않는다.
- `summary`: `{ "page_size": 20 }`. 본인 전체 및 KST 오늘+직전 2일 완료 신고를 집계한다.

신고/담당자 페이지는 각각 최대 50행이다. 전체 일치 신고 건수를 임의로 자르지 않는다.
후속 페이지는 `next_cursor`를 `cursor`로 보낸다. 커서는 사용자·검색·경로·페이지 크기·자료 버전에 묶인
서명값이며 유효기간은 15분이다. 자료 변경은 `409 DATASET_CHANGED`, 만료는 `409 CURSOR_EXPIRED`다.
이전 offset 기반 초안 RPC는 `202610020100_my_reports.sql`에서 폐기됐다.

## 권한과 변경 범위

Edge는 `auth.getUser(token)` 및 JWT UID·role·audience·session을 검증하고 요청의 user_id를 받지 않는다.
DB는 매 요청에서 실제 Kakao identity·활성 세션·계정 자격을 다시 검사한다. `my_reports_own(p_user)`는
**contributor_id 본인 조건 → 활성 동의 계보의 완료 4상태 → identity별 대표 관측 → 검색 조건** 순서다.
`search`와 `numbers` 모두 같은 검증 함수와 본인 집합을 사용한다. 다른 사용자의 같은 차량번호나
원신고, 본인의 철회 자료·이전 관측 차량번호는 검색 결과에 섞이지 않는다. 지도 10건 열람 gate는 변경하지 않는다.

새 migration `202610131500_my_reports_vehicle_min4.sql`은 최신 정의인 `202610020100`의
`private.my_reports_check_query(text,text)`에서 차량 하한만 6→4로 교체한다. `CREATE OR REPLACE`로
owner·ACL을 보존하며 기존 `IMMUTABLE`, `SECURITY INVOKER`(기본값), 빈 `search_path`를 유지한다.
세 public RPC는 계속 service_role 전용이다. private helper는 public/anon/authenticated에 허용하지 않는다.
Edge `server/myReports/handler.ts`의 `validQuery`는 정본 `LIMITS.vehicle_min`을 참조하므로 별도 숫자 상수가 없다.

요청 본문 16KiB, 정규화 전 query 256 UTF-16 단위, 응답 256KiB, 기본 사용자당 분당 120회와
RPC AbortSignal 5초를 그대로 유지한다. 응답 초과는 `RESULT_TOO_LARGE`, 시간 초과는 `QUERY_TIMEOUT`이다.
5초 AbortSignal이 DB 문장 중단을 보장하지는 않는다. DB 실행 상한은 기존 PostgREST 역할의
`statement_timeout`에 달려 있으며 이번에 역할 설정을 변경하지 않았다. 토큰·본문·원번호 로깅도 추가하지 않았다.

## 성능 판단과 운영 확인

4자 검색은 더 많은 차량에 일치할 수 있어 결과 집계·담당자 그룹·정렬·번호 중복 제거 비용이 증가할 수 있다.
페이지 상한은 전송량을 제한하며 내부 스캔량을 제한하지 않는다. 현재 RPC는 검색 길이와 관계없이 매번 본인
전체 관측에서 대표 신고와 버전을 계산하고, 메모리 배열에서 정규화 문자열을 비교한다. 전체 일치 수 상한은 없다.

[기존 로컬 합성 측정](integration/chromeextension/MEASUREMENTS.md)에서 본인 20,000신고/40,000관측,
전체 240,000행의 search 첫 페이지 중앙값은 666ms, numbers는 598.1ms였다. **이번 4자 검색 측정이나 운영 수치가 아니다.**
[저장된 실행 계획](integration/chromeextension/plans/heavy20k.search_vehicle_first.with-owner-index.txt)의
`Bitmap Index Scan`은 `contributor_id = $1`로 PK/owner 인덱스를 사용하고, 대표 선정 후 `Function Scan on unnest`
단계에서 `strpos`를 필터로 적용한다. 4자 허용 자체가 테이블 전체 검색으로 바꾸지는 않는다.
이 구조에서 단순 원본 차량 trigram 인덱스는 배열 필터를 가속하지 못한다. 대표 선정 전에 차량 조건을 밀어 넣으면
이전 관측을 잘못 찾을 수 있어 이번에 쿼리 순서나 인덱스를 바꾸지 않았다.

Opus 배포 시 실DB에서 보유량이 큰 계정의 흔한 4자리·기존 긴 검색어를 비교해 search 첫/후속/담당자 페이지와
numbers에 `EXPLAIN (ANALYZE, BUFFERS)` 및 필요시 nested plan을 수집한다. 일치 행 수, 정렬 spill,
실행 시간, statement_timeout을 확인한다. 큰 계정에서 지연이 크면 본인 대표행 캐시를 별도 검토한다.

## 검증과 배포 인계

- 계약/Edge 회귀: 3/4 경계, 숫자 4글자, Unicode 공백·NFC, 최대 64, 주소 규칙, 기존 인증·요청/응답 상한.
- SQL: `PGLITE_MODULE=/tmp/map-sql-test/node_modules/@electric-sql/pglite/dist/index.js node tests/sql/verify-my-reports-vehicle-min4.mjs`.
  기존 실제 my-reports 함수와 신규 migration을 메모리 PostgreSQL에서 실행한다. 인증/동의 의존 테이블·함수는 합성 fixture다.
  양 경로 부분 일치, A/B 격리, 철회/이전 관측 제외, 세션 불일치, 페이지/번호 상한 및 함수 속성·ACL 보존을 검사한다.
  운영 인증·실DB 성능·확장 브라우저 종단 검증을 대신하지 않는다.
- 전체 `npx vitest run`, `npx tsc -b`, `npx vite build`. 실제 Supabase 스택 통합 시험은 `COMMUNITY_STACK=1` 별도 환경이 필요하다.
- JSON Schema는 원문 query 형식(1~256)만 정의하며 정규화 길이는 types.ts/README가 정한다. schema와 기존 응답 fixture에
  6자 하한 상수는 없으므로 변경하지 않았다. 정본 manifest 재생성 후 sync script로 확장 `contracts/my-reports/`만 동기화한다.
  확장 계약 시험은 manifest에서 해시를 읽으며 별도 고정 my-reports 해시가 없다. `npm run test:contracts` 실행은 Opus 담당이다.

배포 순서(Opus): **DB 신규 migration → 갱신된 계약을 포함한 my-reports Edge → 확장**.
기존 `202610020100` 적용 여부를 먼저 확인한다. DB와 Edge 모두 갱신돼야 4/5자 요청이 성공한다.
서버 준비 후 3자 거절·4자 성공·A/B 격리·번호복사를 확인하고 확장 시험/빌드/배포를 진행한다.
지도 Pages 배포는 이 변경에 필요 없다. 이번 작업에서 커밋·push·배포·운영 SQL 실행은 하지 않는다.

실행 결과(2026-10-13, 이 worktree):

- myReports 계약·Edge 시험만 재실행: 2 파일/33 시험 전부 통과.
- `npx vitest run`: 79 파일/1,172 시험 통과, 33 파일/195 시험 건너뜀, 1 파일/11 시험 실패.
  실패는 모두 기존 `tests/product/composeScript.test.ts`의 자식 프로세스 stdout/stderr 검사다.
  별도 Node `spawnSync`로 단순 `console.log`/`console.error`를 호출해도 출력이 비고 `error.code=EPERM`인
  환경 제한을 재현했다. 실제 전체 성공으로 보고하지 않으며 코드·전역 권한을 바꾸지 않았다.
- `npx tsc -b`: 통과. `npx vite build`: 통과(기존 dynamic/static import 중복 및 큰 chunk 경고).
- PGlite SQL: 통과. 이번에는 Supabase 스택 통합 시험·운영 DB·확장 브라우저 검증을 실행하지 않았다.
- 계약 sync/`--check`와 두 폴더 `diff -qr`: 통과. 확장 변경은 README.md·types.ts·MANIFEST.sha256 3개뿐이다.
