# 공개 정책·보안 경계
사용자가 확정한 실명·정확좌표·최소표본 1건 정책을 구현한다. 공개 수위와 법적 적법성 판단은 동일하지 않으며
마스킹했으니 완전 익명이라는 문구는 쓰지 않는다. 연락처·신고자·피신고자 신원 추정 기능은 추가하지 않는다.

## 차량 규칙 mask-v1 (과거 규칙, 현재 보완은 아래 2026-10-13 절)
1. NFKC 정규화, 공백·일반 하이픈 제거.
2. 허용된 대한민국 지역 접두어를 맨 앞에서만 판정한다. 동일성 canonical에는 보존한다.
3. 공개 표시에는 짧은 지역명(서울특별시 → 서울, 경기도 → 경기)을 **그대로 앞에 붙인다**. 위치를 셀 때만 건너뛴다.
4. 지역명 뒤 문자열의 1-based 위치 2,4,6의 문자(숫자·한글 모두)를 '*'로 치환한다.
5. 유효한 지원 형식이 아니면 원문을 반환하지 말고 표시 `번호 확인 불가`. 해당 건은 전체 신고수에는 남기되 차량순위 제외 사유 기록.

합성 예시:
| 내부 입력 | 공개 표시 |
|---|---|
| 12가3456 | 1*가*4*6 |
| 123가4567 | 1*3가*5*7 |
| 서울12가3456 | 서울1*가*4*6 |
| 경기 123가-4567 | 경기1*3가*5*7 |
| 경기76자3623 | 경기7*자*6*3 |

서울12가3456와 서울13가3456은 **서로 다른 canonical**인데 둘 다 `서울1*가*4*6`으로 표시된다. 표시가 같아도 합치지 않는다.
원번호 또는 region prefix를 지운 번호로 행을 묶고 TOP5를 계산하는 것 모두 금지. private canonical 전체로 집계한 뒤 마스킹한다.
같은 마스킹 문자열의 두 차량은 독립 행 유지; '마스킹 표시가 같아도 서로 다른 번호일 수 있음' 안내.

## 공개 전 차단할 필드
raw/canonical vehicle, 안정 vehicle HMAC/hash, report number/internal report IDs, contributor UUID,
snapshot IDs, 이메일·전화번호·계정 이름·Google sub·JWT·refresh token, 신고 본문·답변 전문·첨부 URL.
공개 담당자 이름과 기관 이름은 예외적으로 **명시 허용**된 필드다. 이메일/연락처와 같이 내려오는 payload를 통째로 펼치지 않는다.
차량 raw를 HTML hidden, title, data-attribute, tooltip, aria-label, analytics 이벤트, URL query에 넣어도 노출이다.

## 내 신고 비교(개인 읽기) 경계
- 지도 통계 API(`public-analytics`)는 공유자 전용이다: 검증된 카카오 세션 + 공유 동의 + 지도에 올라간 본인 고유 신고 10건 이상인 사람에게만 같은 공개 DTO를 준다(2026-09-28 사용자 결정으로 1건에서 상향, `private, no-store`, 사용자별 횟수 제한). 누가 읽든 내용은 같고, 요청자 정보는 응답에 들어가지 않는다(테스트 고정). 익명 공개 전환 스위치는 없다.
- 개인 응답(`my-analytics`)은 검증된 사용자 본인에게만, `Cache-Control: private, no-store`·`Vary: Authorization`. 계정 id·세션·이메일을 담지 않는다.
- exporter는 `mine`·`viewer`·`my_points`·`user_id`·`session_id` 필드를 거부하고, share URL에는 비교 모드·계정 상태를 넣지 않는다.
- 관심 지역·비교 토글은 이 브라우저 localStorage에만(서버 전송 없음). 브리핑 모드는 내 데이터를 기본으로 숨긴다.
- 지도 로그인은 relay·account API와 별개이며 `signOut({scope:'local'})`만 쓴다. dist 스캔이 relay/account 참조와 비-anon JWT를 차단한다.

## 최소 권한
Pages에는 public API URL·Kakao JavaScript key만 필요하다. Supabase direct-read adapter를 쓰는 경우 publishable key는
공개 설정이며 read-only는 key 이름이 아니라 grants/RLS/함수 권한으로 강제한다.
CI export는 특정 safe view의 SELECT 전용 login role/endpoint를 사용한다. SUPABASE_SERVICE_ROLE_KEY를 read-only라고 이름 바꾸지 않는다.
신고 위치는 앱·서버가 공식 상세 응답에서 받은 좌표를 전송한다. 지도 웹앱의 Kakao JavaScript 키는 공개 지도 SDK용이며 서버의 REST 주소 변환 키와 다르다.

## 공개 artifact
Vite root는 web 또는 src 기반 제품 빌드만. docs/design reference PNG에는 원본 예시 번호가 있으므로 dist에 복사 금지.
빌드 후 텍스트·JSON뿐 아니라 sourcemaps·compressed files·CSV·service worker precache 목록을 검사한다.
원본번호 탐지, strict JSON unknown field 거부, secret canary 삽입 테스트를 수행한다.
CORS는 HTTP 비브라우저 호출을 막는 인증 수단이 아니다. 반환 결과 자체가 공개 가능해야 한다.

## 삭제와 보존
공동 지도 기여 철회 → 신규 업로드 차단 → active facts 제외 → aggregate version 교체 → API cache purge →
(정적 snapshot은 지금 만들지 않으므로 재생성 단계 없음— docs/public-api-contract.md §열람 조건)). 민감한 상세 차량/담당자 응답은 장기 정적 cache로 배포하지 않는다.
공개 파일을 이용자가 저장한 사본까지 원격 회수할 수 있다고 약속하지 않는다.
static snapshot을 다시 쓰게 되면(공개 전환 후) 생성시각 표시, API에서 더 최신 삭제 version을 알리면 그 즉시 구본 사용을 중단한다.
정정·삭제 요청과 문의는 이 저장소의 공개 Issues(템플릿 `.github/ISSUE_TEMPLATE/`)로 받는다. 공개 게시판이라 개인정보를 적지 말라고 안내하고, 본인 확인은 운영자가 따로 한다. 운영자 삭제는 `internal_community_delete_contributions(user, session)`.

## 차량 규칙 보완 (2026-10-13)

현재 규칙은 일반형의 앞 숫자 둘째와 끝 4자리 첫째·셋째를 가린다.
2자리 일반형은 `경기76자3623 → 경기7*자*6*3`, 3자리 일반형은 `123가4567 → 1*3가*5*7`이다.
과거 위치 2·4·6 고정 규칙은 3자리 일반형의 끝 네 숫자 중 세 개를 드러내므로 더 이상 사용하지 않는다.
이륜형은 지역·시군구·용도 글자·선행 숫자를 보이고, 용도 글자 뒤 선택 숫자와 끝 4자리 첫째·셋째를 가린다.
`경기군포다2671 → 경기군포다*6*1`, `서울강남다0025 → 서울강남다*0*5`,
`광주북바5231 → 광주북바*2*1`, `1오41357 → 1오**3*7`, `가1234 → 가*2*4`.

TS `parsePlate`·`maskPlate`, SQL `screen_plate`·`screen_mask_plate`, 공개 DTO와 snapshot 내보내기는
같은 형식을 사용한다. 끝 네 자리는 모든 지원 형식에서 정확히 두 자리만 공개한다.
가림 표시가 같아도 정규형이 다른 차량은 합치지 않으며 정규형·해시는 공개하지 않는다.
기존 SQL 집계와 수집 투영은 공통 함수 교체를 통해 함께 반영된다.

추가 마이그레이션 `202610131000_motorcycle_plate.sql`은 저장 투영(`screen_observations`·`screen_precompute_lock`)이 있는 배포에서만
기존 투영 잠금을 잡고 `screen_observations.plate/plate_mask`를 해당 행의 `vehicle_raw`로 다시 계산한다. 없는 배포(운영 기준)는 함수 교체와 캐시 무효화만 한다([배포 문서](deployment.md)).
원문 facts·수집 이벤트·확정금액·추정금액은 변경하지 않는다. projection 버전과 screen cache epoch를 함께 올린다.
운영 적용 시 지도 웹의 강화된 DTO·Edge 코드·SQL을 함께 배포한다.
전환기 호환(2026-10-16 정정): 10-14 배포 웹은 구 SQL/캐시의 3자리 일반형 가림(`1*3*4*67`)을 거절해 차량 한 줄 때문에
대시보드 전체가 실패할 수 있었다. 이제 브라우저 DTO(`src/data/schema.ts`의 `vehicleListSchema`)는 옛 형식을 받되
옛·새 형식이 함께 공개하는 자리만 남겨 `1*3****7`로 보인다(끝 네 자리 중 한 자리). 가림 형식이 아닌 행은 받은 문자열을 버리고
`번호 표시 생략`으로 보이며, 행 모양이 다르면 그 행만 뺀다. 서버 출력 계약 `vehicleSchema`는 계속 새 형식만 받는다.
브라우저가 줄여 보여도 **응답 JSON 원문**에는 옛 형식의 세 자리가 남으므로, 실제 노출 해소는 `202610131000` 적용으로만 된다
(적용 확인 SQL은 [배포 문서](deployment.md)의 "미적용 migration 확인"). 벡터는 `contracts/masking-vectors.json`의 `legacy_output`·`legacy_display`.
실DB 화면 전체 집계 시간은 배포 담당자 Opus가 전후 동일 조건으로 측정해야 한다.
로컬 SQL 재현은 `npm run test:sql`(PGlite devDependency, `tests/sql/verify-screen-plate.mjs` 포함)이다.
실행기는 메모리 PostgreSQL만 사용하며 원문을 출력하지 않는다. 선택 환경 변수 `MOTO_UNRECOGNIZED_TSV`로 제공 목록을 읽을 수 있다.
