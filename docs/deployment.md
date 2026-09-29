# 배포·환경 설정
이 문서는 준비 명세다. installer/패키지 실행이 클라우드 리소스를 변경하지 않는다.

## 환경값
| 값 | 위치 | 성격 |
|---|---|---|
| VITE_KAKAO_MAP_JS_KEY | repo variable 또는 CI frontend env | 공개 JS key. secrets에 저장해도 번들에서는 공개 |
| VITE_PUBLIC_ANALYTICS_URL | variable / frontend | 사용자 JWT가 필요한 통계 Edge API base |
| VITE_DATA_MODE | variable | live 또는 명시 demo |
| VITE_BASE_PATH | variable | `/` 기본 (공개 주소 `https://safemap.worklazy.net/`) |
| PUBLIC_ANALYTICS_URL | CI variable | Pages 빌드의 API base. snapshot exporter는 공유자 전용 동안 쓰지 않음. 비밀키 불필요 |
| SUPABASE_EXPORT_DATABASE_URL | 선택적 후속 direct exporter 전용 | 현재 스크립트는 사용하지 않음. 사용 시 specific safe views SELECT 전용 DSN/TLS 필요 |
| ANALYTICS_RATE_SALT | Supabase Edge Function secret | 1분 rate bucket용 salt(공유자 전용이면 사용자별, 공개면 IP별). 프런트/CI에 넣지 않음 |
| ANALYTICS_ALLOWED_ORIGINS | Supabase Edge Function secret | 공유자 전용일 때 `public-analytics` Origin allowlist. 없으면 `MY_ANALYTICS_ALLOWED_ORIGINS` |
| optional SUPABASE_PUBLISHABLE_KEY | 공개 direct adapter만 | anon/access grants로 제한. 기본 UI는 필요 없음 |
| service_role/secret | 중앙 Supabase 함수 runtime만 | 관리자 성격. CI readonly 대용으로 사용하지 않음 |
| VITE_SUPABASE_URL | variable / frontend | 지도 웹 로그인용 프로젝트 URL. 공유자 전용 Pages 배포에 필수 |
| VITE_SUPABASE_PUBLISHABLE_KEY | variable / frontend | 지도 웹 로그인용 공개 publishable(`sb_publishable_…`) 키. 공유자 전용 Pages 배포에 필수. secret/service_role 금지(dist 스캔이 비-anon JWT 차단) |
| MY_ANALYTICS_ALLOWED_ORIGINS | Supabase Edge Function secret | `my-analytics` Origin allowlist. 운영 `https://safemap.worklazy.net` |
| MY_ANALYTICS_ENABLED | Supabase Edge Function secret | `false`면 개인 비교만 503(지도 통계 영향 없음) |

환경 파일은 .env.example만 커밋한다. 실제값은 요청받아 채팅에 복사시키지 말고 사용자가 GitHub/Supabase 설정에 입력한다.
VITE_에 PRIVATE/SECRET/REST/DSN이 들어가면 검증 실패. 단순 환경변수 이름보다 실제 artifact도 검사한다.

## Pages
공개 주소는 `https://safemap.worklazy.net/`(이 저장소의 GitHub Pages, base `/`)다. Settings → Pages에서
Source = GitHub Actions, Custom domain = `safemap.worklazy.net`, Enforce HTTPS. DNS는 `safemap` CNAME → `fentanest.github.io`
(Cloudflare는 DNS 전용). 카카오 지도 JavaScript 키의 사이트 도메인에 `https://safemap.worklazy.net`을 등록한다.
push만으로는 배포되지 않는다(`publish-pages.yml` 수동 실행).
base 설정을 맞춘다. 날짜·탭은 query 또는 hash routing으로 유지해 deep-link 404를 피한다.
assets/data 주소에 import.meta.env.BASE_URL 사용. 자동 임의 wildcard redirect에 의존하지 않는다.
실제 배포 artifact는 dist 하나만; repository root/documentation/reference-image 전체를 upload하지 않는다.
`product-check.yml`은 검증 전용이다. `publish-pages.yml`은 main의 수동 `workflow_dispatch`만 받아 검사·live 빌드가
성공했을 때만 Pages artifact를 배포한다. 2026-09-27부터 지도는 공유자 전용이라 **정적 통계 snapshot을 만들지 않고**,
산출물에 `data/`가 없는지 검사한다(주소만 알면 받을 수 있는 통계 파일을 두지 않기 위해). 런타임은 모든 통계를
지도 로그인 토큰과 함께 API에서 읽는다. Pages 배포 전에는 익명 `public-analytics/meta`가 401인지 검사하며
(함수 `auth_required` 또는 Supabase 게이트웨이 `UNAUTHORIZED_NO_AUTH_HEADER`),
200이면 배포를 중단한다. 이미 배포된 API가 200인 경우 인증 전용 코드와 `verify_jwt=true`로 Edge Function을 재배포해야 한다.
기존 `ANALYTICS_ACCESS` 값은 새 코드에서 무시한다. 프런트에서 익명 진입을 막아도 API 직접 요청은 서버가 막아야 한다.
`npm run data:export`(공개 API에서 snapshot 생성)는 공개로 다시 열 때를 위해 남겨 두었다.
`publish-pages.yml`의 Pages Actions는 확인한 버전의 전체 commit SHA로 고정했다. 오래된
`templates/github-pages.yml.example`은 비교용 참고 파일이다.

## Actions 안전
PR 검증은 secrets 없는 fixture job. fork PR/pull_request_target에서 비밀값과 untrusted 코드를 함께 실행하지 않는다.
build job에는 contents:read. deploy job만 pages:write,id-token:write 및 github-pages environment.
production deployment는 별도 사용자 승인 후. concurrency와 rollback runbook 구성.
스케줄 지연/60일 비활성 중단·시간대 변환을 확인하고 cron 성공을 실시간 갱신 보장처럼 표시하지 않는다.

## 실제 연동 smoke
1. public endpoint에서 작은 known 범위를 받아 원천 집계와 count 비교.
2. 권한 없는 role에서 private SELECT·INSERT·UPDATE·DELETE·mutating RPC 모두 실패 확인.
3. Kakao 키/domain에서 지도 SDK load, 원 lat/lng marker, cluster, resize 확인.
4. source_version/삭제 전파/429/오류 UI/캐시 지연 확인.
5. Pages URL/subpath/assets/share-query 검증, browser console/network 확인.

2026-09-27 로그인된 PC 운영 지도에서 Kakao SDK와 공유 통계 응답을 검증했다
(`docs/reviews/live-map-followup-2026-09-27.md`). 전국 지도 묶음·복귀·화면 범위 수정 후보의
운영 배포 검증은 별도다. 기존 로컬 PostgreSQL 16 검사는 운영 검증을 대신하지 않는다.

Supabase Auth의 Site URL과 정확한 redirect allowlist 항목은 모두
`https://safemap.worklazy.net/`이다. 기존 앱·인증 사이트 콜백을 유지한다. 이 주소가
`localhost:3000`으로 남아 있으면 모바일 OAuth 완료 후 잘못된 주소로 돌아갈 수 있다.

2026-09-28 지도 수정은 main `4e897c4`의 Pages 배포와 `public-analytics` v6으로 운영 적용했다.
익명 401, 로그인된 dashboard와 화면 범위 요청 200, 지도 묶음·지역 복귀의 실제 브라우저 검증은
`docs/reviews/live-map-followup-2026-09-27.md`에 기록했다. 삼성 인터넷의 OAuth 완료 복귀는
실제 기기 재시험 대기 중이다.

## rollback
새 build 실패면 배포하지 않음. 배포 후 문제가 생기면 직전 검증 artifact로 rollback(권한 승인 범위),
다만 삭제 요청으로 폐기된 data version으로 되돌아가면 안 됨. 코드 rollback과 데이터 version은 분리 관리.

## 내 신고 비교(my-analytics) 운영 적용 — 별도 승인 필요
1. 운영 DB에 `supabase/migrations/202609270100_my_analytics.sql` 적용(읽기 전용 STABLE RPC 1개, service_role만 실행). 수집·동의·writer 스키마 변경 없음.
2. `supabase functions deploy my-analytics`(verify_jwt=true), secret `MY_ANALYTICS_ALLOWED_ORIGINS`.
3. Supabase Auth: Kakao provider 리다이렉트 허용에 `https://safemap.worklazy.net/**` 추가(지도 페이지로 돌아오는 PKCE).
4. Pages 변수 `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` 설정 후 `VITE_DATA_MODE=live npm run build && npm run scan`.
5. smoke(공유자 전용): 비로그인 → 로그인 안내 화면·API 401 → 공유 신고가 있는 계정으로 로그인 → 지도 → 비교 켜기 → 전체 열 = 지도 KPI → 로그아웃 → 앱 수동 업로드가 계속 ACK되는지. 로컬 증거 스크립트 `scripts/integration/access_gate_e2e.mjs`.
6. 되돌리기: 개인 비교만 끄려면 `MY_ANALYTICS_ENABLED=false`. 지도 오류 때는 직전 인증 전용 Edge 배포로 되돌리고 익명 공개 버전으로는 되돌리지 않는다. RPC drop은 선택.
로컬 합성 스택 검증 결과는 `docs/integration/community-ingest/evidence/2026-09-27-personal-compare/`. 운영 적용·실카카오는 BLOCKED.

## 2026-09-30 대시보드 후속(R1–R7) 운영 적용 — 별도 승인 필요
순서: ① DB 마이그레이션 → ② Edge 두 개 → ③ Pages. 새 클라이언트는 구 서버와도 동작한다(과태료 처분 별점 행은 ‘서버 미지원’, 새 오류 코드는 추가뿐).
1. 운영 DB에 `supabase/migrations/202609300100_long_range_bounds.sql` 적용. `internal_analytics_v2_facts`의 1826일 상한 삭제,
   후보 10만 건 초과는 `RESULT_TOO_LARGE` 예외(조용한 limit 삭제), `internal_analytics_v2_state`가 data_min/max를 공개 가능 신고에서 계산.
   읽기 전용 함수 교체만 있고 테이블·권한 변경 없음. 로컬 검증: `PGHOST=… PGPORT=… bash scripts/sql/verify_long_range.sh`.
   되돌리기: 파일 머리말의 rollback 절차(`202609281800_rating.sql`의 facts, `202609240001_analytics_v2.sql`의 state 함수 본문을 새 마이그레이션으로 재적용).
2. `supabase functions deploy public-analytics` · `supabase functions deploy my-analytics`(RESULT_TOO_LARGE 매핑, entity_limit, 별점 과태료 행, 법규 미상 히트맵 제외).
3. Pages 빌드·배포(`VITE_DATA_MODE=live npm run build && npm run scan`).
4. smoke: 로그인 → ‘전체 기간’ 한 번 → 날짜 버튼·칩·URL이 같은 범위, dashboard 200 → 2014-09-30~2026-09-29 입력 적용 200 →
   지도 ‘수용률’에서 핀 0·시도 색칠 → 확대/축소로 시군구↔시도 → 지역 클릭 시 선택한 지역 카드.
운영 적용·실카카오 SDK·운영 로그 확인은 이 세션에서 하지 않았다(**미검증**).

## scope-statistics-2026-09-29.2 운영 적용 — 별도 승인 필요
DB 마이그레이션 **없음**(맞춤 통계는 기존 `internal_analytics_v2_facts` / `internal_my_analytics_source` 한 번의 조회 결과를 Edge에서 집계).
1. `npx supabase functions deploy public-analytics` · `npx supabase functions deploy my-analytics` (새 경로 statistics/*, dashboard 추가 필드 — 모두 additive).
2. Pages 배포(`VITE_DATA_MODE=live npm run build && npm run scan`). 새 화면은 `?screen=statistics`라 별도 rewrite가 필요 없다.
3. smoke: 로그인 → 지도 핀 선택/다시 눌러 해제/Esc → 서울 선택 시 오른쪽 ‘선택 범위’ → ‘이 조건으로 통계 만들기’ → 표↔그래프 → 비교 대상 선택 →
   월별 추이 ‘처리결과 비율’ 네 지표 체크 → 느린 조회에서 상단 상태 표시.
운영 적용·실카카오 SDK는 이 세션에서 하지 않았다(**운영 미검증**). Edge를 먼저 올리지 않으면 새 프런트의 맞춤 통계는 404로 ‘통계를 불러오지 못했습니다’를 보이고 지도는 그대로 동작한다.
