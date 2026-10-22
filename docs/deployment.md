# 배포·환경 설정
이 문서는 준비 명세다. installer/패키지 실행이 클라우드 리소스를 변경하지 않는다.

## 환경값
| 값 | 위치 | 성격 |
|---|---|---|
| VITE_KAKAO_MAP_JS_KEY | frontend env (`vars.KAKAO_MAP_JS_KEY`에서 전달) | 공개 JS key. secrets에 저장해도 번들에서는 공개 |
| VITE_PUBLIC_ANALYTICS_URL | frontend env (`vars.LOCAL_PUBLIC_ANALYTICS_URL`에서 전달) | 사용자 JWT가 필요한 통계 Edge API base |
| VITE_DATA_MODE | variable | live 또는 명시 demo |
| VITE_BASE_PATH | variable | `/` 기본 (공개 주소 `https://safemap.worklazy.net/`) |
| LOCAL_PUBLIC_ANALYTICS_URL | GitHub Actions Variable | `PUBLIC_ANALYTICS_URL`·`VITE_PUBLIC_ANALYTICS_URL`로 전달하는 Pages 빌드의 API base. snapshot exporter는 공유자 전용 동안 쓰지 않음. 비밀키 불필요 |
| LOCAL_SUPABASE_URL | GitHub Actions Variable | 빌드 env `VITE_SUPABASE_URL`로 전달하는 공개 Supabase origin |
| LOCAL_SUPABASE_PUBLISHABLE_KEY | GitHub Actions Variable | 빌드 env `VITE_SUPABASE_PUBLISHABLE_KEY`로 전달하는 공개 키 |
| SUPABASE_EXPORT_DATABASE_URL | 선택적 후속 direct exporter 전용 | 현재 스크립트는 사용하지 않음. 사용 시 specific safe views SELECT 전용 DSN/TLS 필요 |
| ANALYTICS_RATE_SALT | Supabase Edge Function secret | 1분 rate bucket용 salt(공유자 전용이면 사용자별, 공개면 IP별). 프런트/CI에 넣지 않음 |
| ANALYTICS_ALLOWED_ORIGINS | Supabase Edge Function secret | 공유자 전용일 때 `public-analytics` Origin allowlist. 없으면 `MY_ANALYTICS_ALLOWED_ORIGINS` |
| optional SUPABASE_PUBLISHABLE_KEY | 공개 direct adapter만 | anon/access grants로 제한. 기본 UI는 필요 없음 |
| service_role/secret | 중앙 Supabase 함수 runtime만 | 관리자 성격. CI readonly 대용으로 사용하지 않음 |
| VITE_SUPABASE_URL | variable / frontend | 지도 웹 로그인용 프로젝트 URL. 공유자 전용 Pages 배포에 필수 |
| VITE_SUPABASE_PUBLISHABLE_KEY | variable / frontend | 지도 웹 로그인용 공개 publishable(`sb_publishable_…`) 키. 공유자 전용 Pages 배포에 필수. secret/service_role 금지(dist 스캔이 비-anon JWT 차단) |
| VITE_GA | frontend env (선택) | Google Analytics(`G-44DVBQZ1S8`). 비우면 운영 live 빌드에서만 켜짐, `off`면 끔, `on`이면 dev 검수용으로 켬. 배포 전 GA 속성의 '브라우저 기록 이벤트 기반 페이지 변경'을 꺼야 함(docs/privacy-security.md §Google Analytics) |
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

## 2026-10-11 클라우드 업로드 중단(운영 적용함)
- 사용자 지시(2026-10-11): 수집 앱 저장 구조 개편(서버 스키마 6·앱 DB 17) 완료 뒤 클라우드 Supabase(`nxdcxccixoswvqgjeprh`) 업로드를 막는다.
  셀프호스트 Supabase 로 옮기는 동안 클라우드에 새 자료가 쌓이지 않게 하려는 것.
- 적용: `supabase secrets set COMMUNITY_INGEST_ENABLED=false --project-ref nxdcxccixoswvqgjeprh`(2026-10-11 08:48:26 UTC, `secrets list` 의 값 다이제스트가 `false` 의 sha256 과 같음 확인).
  `community-ingest` 는 `service_unavailable` 로 답한다. 앱의 전송 대기열(outbox)·개인 DB 는 지우지 않으므로 재개하면 그대로 다시 보낸다.
- 되돌리기: `supabase secrets unset COMMUNITY_INGEST_ENABLED --project-ref nxdcxccixoswvqgjeprh`(또는 `true`). 공개 읽기(지도)는 영향 없음.

## 2026-10-12 랭킹 보드·재시도·성능 운영 적용(운영 적용함)
- 사용자 승인("Astra 검수 후 전부 배포"). 순서: migration → Edge → Postgres 설정 → Pages(보드 화면은 Edge 보다 먼저 올리면 실패).
- migration `202610111200_user_rankings_board.sql` 적용·기록(함수 1개 + service_role grant).
- Edge 재배포: `user-rankings`(`/board` 경로), `my-analytics`(screen-aggregate v2 — 셀프호스트 실측으로 v1 보다 10–23% 빠름, Retry-After),
  `public-analytics`·`community-ingest`(5xx Retry-After). 워커 메모리 한도 150→512MB(`volumes/functions/main/index.ts`).
- Postgres: `shared_buffers` 128MB→1GB, `effective_cache_size` 128MB→8GB(ALTER SYSTEM, db 재시작 약 6초).
- 검증: deno check 4함수, 업로드 해시 일치, 전 서비스 healthy, 함수 5종 앱 수준 응답, auth health 200.
- 백업·되돌리기: `.agent-runtime/supabase-trial-20261010/server-changes/journal.jsonl` 의 2026-10-12 항목(추적 안 함).
- Pages: 이 배포부터 운영 지도가 셀프호스트(`LOCAL_*` Variables)를 쓴다 — 이용자는 지도에 다시 로그인한다.

## 2026-10-11 셀프호스트 Edge Functions 5분류 배포(운영 적용함)
- 사용자 승인으로 셀프호스트의 community-ingest·my-reports·public-analytics 를 5분류 코드로 바꿨다(파일 6개, 나머지는 서버와 같았음).
  새 앱(observation-v5)이 안전신고·생활불편 관측을 보내도 422 로 거절·격리되지 않게, **앱 배포보다 먼저** 해야 하는 단계였다(최종 감사 지적).
  구앱(3분류) 관측도 그대로 받는다.
- 검증: 세 함수 `deno check`, 업로드 해시 일치, functions 컨테이너 healthy·로그 오류 없음, 세 함수의 앱 수준 응답 확인.
- 백업·되돌리기: `.agent-runtime/supabase-trial-20261010/server-changes/journal.jsonl` 의 `deploy-functions-five-categories`(추적 안 함).
- user-rankings·my-analytics 는 바꾸지 않았다.

## 2026-10-11 클라우드 → 셀프호스트 데이터 이전(운영 적용함)
- 사용자 승인으로 셀프호스트 Supabase 의 기존(이전 클라우드 사본·테스트) 데이터를 비우고 클라우드 데이터로 바꿨다. 두 쪽 migration 이력이 같아(54개) 데이터만 옮겼다.
- 한 트랜잭션: 트리거 끔(replica) → auth·public·private·storage 표 비움(migration 기록 표 제외) → `supabase db dump --linked --data-only` 넣기 → 68개 표 건수를 같은 덤프의 격리 리허설 값과 대조 → 커밋.
  결과 auth.users 69, community_report_facts 89,237, community_ingest_events 162,081.
- 이어서 `202610110100_five_categories.sql` 을 셀프호스트에 적용·기록했다(클라우드에는 적용하지 않음 — 업로드 중단 상태).
- 백업·되돌리기는 이 레포 `.agent-runtime/supabase-trial-20261010/server-changes/20261011-cloud-to-selfhost.md`(추적 안 함)와 로컬 `~/backups/supabase/`.
- 덤프 뒤 클라우드에 새로 가입·로그인한 사용자는 앱이 셀프호스트로 바뀐 뒤 다시 로그인하면 된다.

## 내 신고 비교(my-analytics) 운영 적용 — 별도 승인 필요
1. 운영 DB에 `supabase/migrations/202609270100_my_analytics.sql` 적용(읽기 전용 STABLE RPC 1개, service_role만 실행). 수집·동의·writer 스키마 변경 없음.
2. `supabase functions deploy my-analytics`(verify_jwt=true), secret `MY_ANALYTICS_ALLOWED_ORIGINS`.
3. Supabase Auth: Kakao provider 리다이렉트 허용에 `https://safemap.worklazy.net/**` 추가(지도 페이지로 돌아오는 PKCE).
4. Pages 저장소 Variables `LOCAL_SUPABASE_URL`, `LOCAL_SUPABASE_PUBLISHABLE_KEY`를 환경변수 `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`로 전달한 뒤 `VITE_DATA_MODE=live npm run build && npm run scan`.
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

## UUID 유저 랭킹 (2026-10-03, 적용하지 않음)

선행 composed migrations → `202610030100_user_rankings.sql` → 인증 전용 `user-rankings` Edge(deno.json 포함) →
실제 자료·철회·페이지 smoke → Pages live build/scan/deploy. 새 secret·계정 변경 없음.
세부 적용/롤백/미검증 항목은 [docs/user-rankings.md](user-rankings.md). 이번 작업은 로컬 커밋만 한다.

## 2026-10-03 main 통합 및 실제 운영 적용

후속 사용자 배포 승인으로 main `f9f6537`을 push하고 랭킹 migration202610030100·202610030200을 운영 DB에 적용했다.
지도 소유 Edge5개 배포 명령 성공(analytics2개 갱신, user-rankings 신규, ingest/my-reports 동일 버전 유지),
Pages [run37107584086](https://github.com/Fentanest/safetyreport-community-map/actions/runs/37107584086) build/deploy 성공.
서비스: https://safemap.worklazy.net/. 로컬은 main 하나만 남겼다.
운영 RPC 권한·익명401·실제 사이트 검수와 운영 로그인 후 미검증 범위는
[배포 보고서](implementation/main-release-20261003/REPORT.md)에 구분했다. 위 과거 ‘미적용’ 문구는 당시 기록이다.

## 2026-10-04 지도 성능 리팩터링 운영 적용

후속 사용자 승인으로 main bc7fecc을 push하고 신규040100~040800 migration8개를 적용했다. public-analytics v16/my-analytics v14 갱신,
기존 ingest/my-reports/user-rankings 동일코드 유지 확인. Pages [run37170626259](https://github.com/Fentanest/safetyreport-community-map/actions/runs/37170626259) build/deploy 성공.
운영SQL 동등성44개, 함수권한/본문10개, 익명401·런타임CORS·실사이트8화면 검사를 통과했다. 운영JWT로그인후UI/RUM은 미검증이다.
상세 적용·기존기록 구분·백업/롤백: [배포 보고](implementation/map-performance-release-20261004/REPORT.md).

## 2026-10-04 대시보드 화면 개편 운영 적용

사용자 승인으로 main d9020a9(프론트엔드만: 상단 화면 탭·고정 조건 바·주요 통계 재배치·지도 위 광고·지도/패널 같은 높이·분석 탭 카드·
로그인 화면 뉴스 갈무리)를 push했다. Supabase migration·Edge 변경은 없어 DB/함수 배포는 하지 않았다.
Pages [run37174903492](https://github.com/Fentanest/safetyreport-community-map/actions/runs/37174903492) build/deploy 성공(워크플로 안의 blueprint·product·vitest·scan 포함).
운영 사이트 로그인 전 화면(1440·390)에서 뉴스 갈무리 → 대가성 문구 → 광고 → 로그인 카드 순서, 이미지 로드, 콘솔 오류 0건을 확인했다.
로그인 후 대시보드(실제 카카오 지도 위 패널 높이 일치 등)는 운영 계정이 없어 미검증이다. 데모 검수 화면: `docs/reviews/screenshots/claude-ui-redesign-2026-10-04/`.

## 2026-10-04 맞춤 통계·유저 랭킹 화면 정리 운영 적용

main 70eb165(프론트엔드만: '이 항목으로 좁히기' 바가 표의 고정 첫 열에 가려 잘리던 문제 수정, 맞춤 통계 헤더·표·설정 패널 정리,
유저 랭킹 탭·조건 한 줄·얇은 내 순위·값 막대 배치, 데모 전용 합성 랭킹)을 push했다. `supabase migration list --linked`로 로컬 마이그레이션이
모두 원격에 적용돼 있음을 확인했고 마지막 DB/Edge 반영(bc7fecc) 이후 supabase/·server/·contracts/ 변경이 없어 Supabase 배포는 하지 않았다.
Pages [run37176609584](https://github.com/Fentanest/safetyreport-community-map/actions/runs/37176609584) build/deploy 성공. 운영 번들에 새 스타일이 들어갔고
데모 랭킹 코드는 포함되지 않음을 확인했다. 로그인 후 두 화면은 운영 계정이 없어 미검증이며, 데모 검수 화면은
`docs/reviews/screenshots/claude-stats-rankings-2026-10-04/`. 로컬 worktree는 모두 정리했고 그 안의 미커밋 파일은 `.agent-runtime/archive/worktrees-2026-10-04/`에 보관했다.

## 2026-10-06 · cohort facts 8초 취소 수정 준비

지도 `202610060100_cohort_facts_setwise.sql` 한 파일과 migration 이력 등록만 필요하다.
RPC/Edge/Pages 계약은 불변이며 Edge·Pages 재배포는 필요 없다. 운영 적용은 이번 작업에서 하지 않았다.
기존 함수 백업·적용·검증·forward rollback 순서는
[cohort timeout 적용 메모](implementation/cohort-facts-timeout/MIGRATION.md),
로컬 3천/3만 행 실행계획과 동등성 결과는 [검증 보고](implementation/cohort-facts-timeout/REPORT.md)에 있다.

## 2026-10-06 전체 쿼리 감사

공유 이력의 auth `202610050100` → map `202610060100` → `202610060200` → `202610060300` → `202610060400` → `202610060500` 순서를 따른다. 이번 신규 변경은 SQL이며 Edge/Pages/앱 재배포가 필요 없다. 운영 미접속 상태의 명령·잠금·forward rollback 절차는 [MIGRATION.md](implementation/query-audit-20261006/MIGRATION.md)에 있다.


## 2026-10-06 · DATASET_CHANGED 화면 수정

쿼리 감사에 추가한 `202610060600_analytics_read_snapshot.sql`까지 SQL 적용 → `public-analytics`, `my-analytics`, `user-rankings` Edge → main Pages 순서다. 새 웹은 개인 `my-analytics/screen` 묶음을 사용하므로 Edge 전에 Pages만 배포하면 안 된다. 기존 앱 ingest/account/relay/my-reports 계약과 배포는 변경하지 않는다. 운영자가 한 번에 실행할 명령은 [MIGRATION.md](implementation/dataset-snapshot-20261006/MIGRATION.md). 이번 작업에서는 운영 접속·배포·push를 하지 않았다.

## 2026-10-11 · 신고 분류 5분류(traffic·parking·safety·living·other) 준비

지도 `202610110100_five_categories.sql` 한 파일 적용이 필요하다(기존 3분류 목록을 나열한 모든 함수·CHECK 제약을 5분류로 다시 만들고
`private.my_reports_stats`에 safety·living 건수를 추가; 3분류 목록이 남아 있으면 트랜잭션이 실패해 되돌린다). RPC 응답 모양은 바뀌지
않는다(분류별 카운트 객체에 safety·living 키가 늘어날 뿐). Edge(`community-ingest`, `public-analytics`, `my-analytics`, `my-reports`,
`user-rankings`)는 이번 코드 변경으로 함께 재배포해야 한다(허용 category 값·분류 축 라벨 갱신). Pages도 같은 빌드로 재배포한다(공유
링크의 `category=other`는 그대로 유지되고, 새 `category=safety`/`category=living` 값이 추가된다). 이미 올라간 기존 신고(특히 예전
`other`로 분류된 안전신고·생활불편)는 수집 앱이 재크롤링(`source-rebuild-2026-10-11.1`)으로 다시 올릴 때만 새 분류로 바뀐다 — 이
마이그레이션 자체는 기존 행의 `category` 값을 고치지 않는다. 운영 적용·Edge/Pages 배포는 이번 작업에서 하지 않았다(로컬 커밋만,
`npx vitest run`/`npx tsc -b`/`npm run build`로 검증).

## 2026-10-12 · 화면 결과 캐시 후보 (운영 미적용)

`202610121201`까지 적용된 DB에서 신규 `202610121300_screen_result_cache.sql` →
`202610121301_screen_cache_cron.sql`(pg_cron available/preloaded 확인 후) →
`my-analytics`, `public-analytics` Edge 순서로 준비한다. 기존 폐기된 `202610061200_ingest_precompute.sql`을 다시 적용하지 않는다.
이번 변경에 Pages·ingest·앱 배포는 필요 없다. 운영 롤백 트랜잭션 검증, 파일 목록, cron/성능/정리 확인 및
되돌리기는 [캐시 보고서](implementation/screen-result-cache-20261012/REPORT.md)를 따른다.

## 2026-10-12 · 연속 업로드 캐시 후속 (로컬 후보, 배포하지 않음)

신규 `202610121400_screen_cache_stale.sql` → my-analytics Edge(server 신규 모듈 포함) → Pages 순서다. 이전 migration은 수정하지 않는다. 구 Edge/exact RPC가 rollback 경로다. [Opus rollback 검증 SQL·절차·부하 계산·미검증 범위](implementation/screen-result-cache-20261012/STALE-REPORT.md)를 먼저 확인한다.

## 2026-10-12 · 느린 회선 왕복·응답 축소 (미배포)

`astra/fewer-trips` 후보는 `my-analytics` Edge의 `server/screenHandler.ts`와 프런트/정적 자산 재배포가 필요하다.
이번 추가 변경에 운영 DB migration·public-analytics·ingest 배포는 없다. Edge → 정적 웹 순서를 권장한다. 구 클라이언트는 전체 응답을 유지한다.
`public/_headers`가 dist/_headers로 복사되어 Workers assets의 해시 `/assets/*`에 1년 immutable을 부여한다.
HTML·SPA는 Workers 기본 `public, max-age=0, must-revalidate`를 유지한다. GitHub Pages의 HTTP 헤더 설정 파일로 간주하지 않는다.
현재 Workers 배포 워크플로에서 dist 전체를 사용한다. 로컬 Wrangler 및 느린 회선 결과·한계는
[보고서](implementation/fewer-trips-20261012/REPORT.md). 커밋·push·운영 배포·운영 DB 쓰기는 수행하지 않았다.

## 2026-10-13 릴리스 검수 결함 수정 후보 (운영 미적용)

운영자 rollback 리허설 SQL → 신규 `202610130100_screen_plate_normalization.sql` → `public-analytics`·`my-analytics` Edge → 정적 웹 순서다. 기존 migration/5분류 RPC/원본 fact는 변경하지 않는다. `community-ingest`는 deno check만 수행하며 이번 변경으로 재배포할 필요 없다. SQL 정규화의 공개 마스킹 경계, 검사 결과와 한계, 되돌리기는 [수정 보고서](implementation/release-fix-20261013/REPORT.md)를 따른다. 커밋·push·배포는 이 작업에서 하지 않았다.

## 2026-10-14 통계 10만 건 제한 제거 (운영 적용 완료)

사용자 “적용해. 배포까지 다 해” 승인. DB migration `20261014132612`, public-analytics / my-analytics 파일 5개,
웹 `fd303a4`를 [workflow 38574485274](https://github.com/Fentanest/safetyreport-community-map/actions/runs/38574485274)로 배포했다.
운영 전체 기간 126,535건 집계 성공, 기본 최근 12개월 80,389건·이전 비교 27,794건. 고정 건수 제한이나 truncate 없음.
함수 권한 유지·컨테이너 healthy·익명 API 401 확인. 운영 브라우저는 저장된 접근 차단 설정으로 BLOCKED.
[검증·백업·복구 기록](implementation/analytics-row-limit-20261014/REPORT.md) 참조.

## 2026-10-16 · 미적용 migration 확인과 적용 순서 (2026-10-17 확인: 이미 적용됨, 이력 행 기록 완료 — 맨 아래 절)

배경: 10-14 배포 웹(`fd303a4`)은 차량 가림 새 형식만 받아, `202610131000_motorcycle_plate.sql`이 없는 DB가 내는
옛 3자리 가림(`1*3*4*67`) 한 줄로 대시보드 전체가 실패할 수 있었다. `fix1016/map` 웹은 옛·새 형식을 모두 받고
(옛 형식은 `1*3****7`로 줄여 보임) 형식이 맞지 않는 차량 한 행만 생략한다([privacy-security](privacy-security.md)).
그래도 응답 JSON 원문에는 옛 형식의 끝 세 자리가 남으므로 아래 migration 적용이 실제 해소다.
운영 적용 기록이 문서에 있는 마지막 단계는 `20261014132612`이고, 그보다 앞 번호인 아래 파일들은 적용 기록이 없다.

### 읽기 전용 확인 SQL (운영 DB, 쓰기 없음)

```sql
begin read only;
-- 1) 이력: 없는 번호가 미적용 후보
select version from supabase_migrations.schema_migrations
 where version in ('202610121300','202610121301','202610121400','202610130100','202610131000','202610131500','20261014132612')
 order by version;
-- 2) 현재 가림 함수 정의와 결과: 새 형식이면 '1*3가*5*7', 옛 형식이면 '1*3*4*67'
select pg_get_functiondef('private.screen_mask_plate(text)'::regprocedure);
select private.screen_mask_plate('123가4567') as masked;
-- 3) 저장 투영 객체: 둘 다 null이거나 둘 다 값이어야 한다(한쪽만 있으면 202610131000이 중단 — 아래)
select to_regclass('private.screen_observations') as screen_observations,
       to_regprocedure('private.screen_precompute_lock()') as screen_precompute_lock,
       to_regclass('private.screen_cache_epoch') as screen_cache_epoch,
       to_regprocedure('private.screen_plate_strict(text)') as screen_plate_strict,
       to_regprocedure('private.community_bump_projection()') as community_bump_projection;
rollback;
```

Edge 쪽도 확인한다. 10-14 배포는 public-analytics / my-analytics의 **바뀐 파일 5개만** 교체했으므로, 운영 functions 볼륨의
`server/plate.ts`가 `de738ac` 이후 내용인지 해시로 대조한다(`git show de738ac:server/plate.ts | sha256sum`과 운영 파일 sha256; 그 뒤 이 파일은 바뀌지 않았다).
TS 경로(`server/aggregate.ts`·`statistics.ts`의 `maskPlate`)도 옛 파일이면 옛 형식을 낸다.

### 적용 순서 (파일 번호 순, 이미 있는 번호는 건너뜀)

1. `202610121300_screen_result_cache.sql` → `202610121301_screen_cache_cron.sql`(pg_cron 확인 후) → `202610121400_screen_cache_stale.sql`.
   10-14 읽기 전용 조사에서 `internal_analytics_screen_cached`·`internal_analytics_screen_stale` 함수가 운영에 있었으므로 이미 적용됐을 가능성이 높다. 1)의 이력으로 확정한다.
2. `202610130100_screen_plate_normalization.sql` — `screen_cache_epoch`(121400)와 `community_bump_projection`이 필요하다.
3. `202610131000_motorcycle_plate.sql` — 새 `screen_mask_plate`. 적용 뒤 2)가 `1*3가*5*7`인지 다시 확인한다.
4. `202610131500_my_reports_vehicle_min4.sql` — 독립(내 신고 차량 4자 검색). DB+Edge 먼저, 확장 나중([my-reports](my-reports.md)).
5. 그 다음 Edge(public-analytics / my-analytics, `server/plate.ts` 포함 전체 대조) → 정적 웹.

`20261014132612`가 이미 기록돼 있어 `supabase db push`는 앞 번호를 순서 밖으로 본다. **`supabase db push --include-all`을 쓰지 않는다.**
원격 이력에 없는 모든 파일을 넣으므로 폐기된 `202610061200_ingest_precompute.sql`(저장 투영·수집 트리거 설치,
`internal_analytics_read_snapshot` 이전 정의로 교체)까지 적용된다. 위 1~4의 파일만 하나씩 수동 `psql -1 -f <파일>`(또는 SQL Editor)로 넣고,
파일마다 성공한 뒤 기존 절차대로 `schema_migrations`에 그 번호를 기록한다. CLI로 확인만 하려면 같은 이력을 가진 검증 DB에서
`--dry-run`으로 대상 목록에 `202610061200`이 없는지 먼저 본다.

**폐기 객체 의존(2026-10-16 수정):** `202610131000`은 원래 `private.screen_precompute_lock()`과 `private.screen_observations`
(폐기된 `202610061200_ingest_precompute.sql`에만 정의, 10-14 보고서 기준 운영에 없음)를 무조건 사용해, 운영과 같은 DB에서는
트랜잭션 전체가 실패했다. 운영 미적용이라 같은 파일 안에서 고쳤다(새 migration 없음).
- 두 객체가 **모두 있으면**: 기존처럼 잠금 → 함수 교체 → 저장 투영(`plate/plate_mask`) 재계산 → 캐시 무효화.
- **모두 없으면**: 함수 교체와 캐시 무효화(`community_bump_projection()`, `screen_cache_epoch` 증가)만 한다. 화면 집계는 읽을 때 새 함수로 가린다.
- **한쪽만 있으면**: 알 수 없는 배포로 보고 `screen precompute objects are partial` 오류로 중단한다(한 트랜잭션이라 아무것도 바뀌지 않음).
  위 3) 확인 SQL에서 두 값이 둘 다 null이거나 둘 다 값이어야 한다.
- 함수 4개(`screen_normalize_plate`·`screen_plate_strict`·`screen_plate`·`screen_mask_plate`)는 `create or replace`라 owner·기존 ACL을 유지하고,
  SECURITY INVOKER·`search_path=''`·IMMUTABLE이다. 파일의 grant로 `service_role` 실행 권한이 더해지고 anon/authenticated는 실행할 수 없다.
- 같은 폐기 객체 의존을 `202610130100`(의존: `community_bump_projection`, `screen_cache_epoch` — 121400 정의, 폐기 객체 아님)·`202610131500`(없음)·
  `20261014132612`(precompute 함수가 없으면 건너뛰는 조건 이미 있음)에서 확인했고 고칠 것이 없었다.

로컬 검증: `npm run test:sql`의 `tests/sql/verify-motorcycle-plate-deploy.mjs`가 060900·130100 실제 정의로 운영과 같은 사전 상태를 만들고
(a) 폐기 객체 없음 (b) 있음 두 경우 모두 적용·재적용 성공, 새 가림 결과, owner·ACL·search_path·DEFINER 보존, 캐시 무효화를 확인하고
(c) 한쪽만 있는 경우 오류·롤백을 확인한다. 수정 전 파일은 (a)에서 `function private.screen_precompute_lock() does not exist`로 실패함을 확인했다.
운영 PostgreSQL 리허설을 대신하지 않는다.

## 2026-10-16 · 10만 건 제한 제거 이후 운영 주의 (코드 변경 없음)

`20261014132612` 이후 통계 후보 행에 고정 상한이 없다. 남은 상한은 `service_role`의 `statement_timeout = 30s`
(`202610060800`)와 Edge 실행 한도뿐이다.

- 관측(10-14 운영 읽기 전용): 전체 기간 126,535건 집계 **12.233초 / 30초**, 기본 최근 12개월 80,389건 9.739초.
  `202610060800` 기록 기준 PostgREST가 다시 읽는 facts payload는 **10만 건당 약 20MB**.
- SQL screen 경로는 DB 안에서 집계하지만, Edge TS 경로(`statistics/query`, `my-analytics` 비교·개인 통계)는
  facts 전체를 받아 Edge 메모리에 올린 뒤 집계한다. 건수가 늘면 응답 시간과 Edge 메모리가 함께 선형으로 는다.
- 지켜볼 지표: 전체 기간 screen 집계 시간(20초를 넘으면 경고 수준), `AGGREGATE_NOT_READY`(503)·statement timeout 취소 빈도,
  Edge functions 컨테이너 메모리 최대치와 재시작, `statistics/query`·`my-analytics` 응답 시간 p95.
- 다음 조치 후보(미결정): ① Edge TS 경로를 SQL 집계 RPC로 옮겨 facts 전체 전송 제거, ② 월 rollup·screen 캐시 사전 계산 재도입
  (폐기된 `202610061200`과 별개 설계), ③ Edge TS 경로도 `202610060700_screen_fact_transport.sql`의 압축 열 전송을 쓰는지 점검·통일, ④ 위 지표에 경보를 걸고
  상한 대신 "기간을 좁히면 빠르다"는 안내만 추가. 건수 제한 재도입은 사용자 결정("10만건제한을 왜 해. 하지마")에 어긋나므로 하지 않는다.

## 2026-10-17 · GA·광고 배너 분리·오른쪽 알리익스프레스 배너·로그인 화면 MBC 갈무리 (정적 웹 배포 완료)

사용자 "다 반영하고 … 푸시 배포 모두 진행" 승인. main `0d4f9d6`(10-16 결함 수정 커밋들 + `bfa1e64` GA + `0d4f9d6` 광고)을 push하고
[workflow 39040261663](https://github.com/Fentanest/safetyreport-community-map/actions/runs/39040261663)으로 정적 웹만 배포했다.
배포 전 로컬에서 CI와 같은 검사(blueprint·product 파이썬, Vitest 1209, `test:sql` 3개, live 빌드, dist 스캔)를 통과했다.
운영 확인: 번들에 GA(`G-44DVBQZ1S8`)·`wlpb-v1-height`·MBC 갈무리 포함, 로그인 전 화면(1440)에서 KBS 갈무리 → 쿠팡(id 1034414) → MBC 갈무리 → 로그인 카드 순서와
두 이미지 로드를 실제 브라우저로 확인했다. 쿠팡 위젯과 GA 수집 요청은 이 검사 호스트의 네트워크에서 차단(`ERR_CONNECTION_REFUSED`)돼 렌더·수집은 확인하지 못했다.
대시보드 오른쪽 배너는 공유자 로그인이 필요해 운영에서는 확인하지 못했다(로컬 E2E로 확인).
**DB migration·Edge는 배포하지 않았다** — 아래 확인 결과 배포할 것이 없었다.

### 2026-10-17 · 운영 DB·Edge 읽기 전용 대조 (10-16 '미적용 migration' 정정)
10-16 절의 "적용 기록 없음"은 이력 표만 본 판단이었다. 서버 변경 기록(`.agent-runtime/supabase-trial-20261010/server-changes/journal.jsonl`)상
`202610121300`·`121301`·`121400`(10-12), `202610130100`·`202610131000`(운영 적용본 `20261013-moto.applied.sql`, 10-13), `202610131500`(10-13)은
사용자 승인으로 이미 운영에 적용됐고 백업·롤백이 기록돼 있다. 10-17 운영 읽기 전용 확인(`begin read only`, 서버 DB 컨테이너 psql):
- `screen_mask_plate('123가4567')` = `1*3가*5*7`(새 형식), `screen_observations`·`screen_precompute_lock()` 둘 다 없음, `screen_cache_epoch`·`screen_plate_strict` 있음, cron `screen-result-cache-v1` active.
- 6개 파일이 정의하는 함수 24개 중 23개 본문이 저장소 최신 정의와 같다. `analytics_screen_parts`는 `20261014132612`의 10만 건 제한 제거 두 줄만 다르다.
- **이력 행만 없었다**: `schema_migrations`에 6개 번호가 없고 `20261014132612`만 있었다. 사용자 승인("운영 서버 쓰기 허용할게") 뒤
  함수·데이터 변경 없이 이력 6행만 한 트랜잭션으로 넣었다(사전 검사: 미기록·새 가림·stale 함수 존재). 결과 `202610121300`~`202610131500`·`20261014132612` 7개 기록.
  되돌리기 `.agent-runtime/release-20261017/rollback-history.sql`(6행 삭제). `supabase db push --include-all` 금지는 그대로다(폐기 `202610061200`이 여전히 미기록).
- Edge: 운영 `volumes/functions/*/source` 파일 62개가 main과 SHA-256 일치. 다른 1개는 `my-reports/server/myReports/handler.ts`의 주석 한 줄(601ae23)뿐이라 재배포하지 않았다.
  13개는 community-auth 저장소 소유 함수(community-account·community-auth-relay)라 대조 대상이 아니다. 10-14 이후 이 저장소의 Edge 실행 코드 변경은 없다(`contracts/`는 테스트 전용).
결과 기록: `.agent-runtime/release-20261017/`(Git 제외), 원격 실행 기록 `server-changes/journal.jsonl`의 `release-20261017-*`.

## 2026-10-18 · 화면 쿼리 최적화·알리익스프레스 자동 넘김 (운영 적용 완료)

- 쿼리: `202610180100_screen_fact_norm.sql` → `202610180101_screen_fact_norm_backfill.sql`(별도 트랜잭션 backfill, 수십 초) →
  `202610180200_screen_cache_reuse.sql` → `202610180300_personal_source_columns.sql`. Edge `my-analytics`·`public-analytics`는 옛 SQL과도 동작하므로
  SQL 전후 어느 쪽에 올려도 된다. Pages 변경 없음. 운영 SQL·Edge 적용은 별도 승인 뒤에만 한다.
- 주의: 이후 `community_report_facts` TRUNCATE는 CASCADE 필요. 트리거를 끈 대량 적재 뒤와 정규화 함수·지역 사전 변경(버전 함수 증가) 뒤에는 `202610180101` 재실행.
- 되돌리기·검증·로컬 측정·미검증 범위: [보고서](implementation/screen-query-opt-20261018/REPORT.md), [rollback.sql](implementation/screen-query-opt-20261018/rollback.sql).
- 광고: Muse `dc01aea`(오른쪽 알리익스프레스 배너 생성기 최신 출력: 자동 넘김 `true`·다크 모서리 수정)를 병합했다(정적 웹 빌드·배포 필요). 브라우저 확인
  `scripts/browser/verify_aliexpress_auto.mjs` 통과(`docs/implementation/ad-banners-2026-10-17/evidence/auto-rotate/`).

### 2026-10-18 운영 적용 결과
사용자 승인("다 진행 … 푸시나 서버반영 등 필요한거 다 하자"). main `d984fef` push, 실행 기록 `.agent-runtime/release-20261018/`(Git 제외, `journal.jsonl`·원격 `server-changes/journal.jsonl`).
- 사전 확인(읽기 전용): 신고 138,936건, 고유 주소 27,279·차량 67,658·법규 203·좌표 125,744. 기존 cron은 24시간 1,440회·평균 16.5초·합계 23,709초 CPU였다.
- DB(17:12 UTC): `202610180100`(0.02초) → `202610180101` backfill(34.1초) → `202610180200` → `202610180300`, 파일마다 한 트랜잭션 + `schema_migrations` 이력 행.
  적용 전 함수 정의 원문 `functions-before.sql`. 검증: 보조 표 138,936행 = facts, 완전성 판정 true(0.36초), 새 함수·보조 표 API 역할 권한 닫힘
  (columns RPC만 service_role 실행), 운영 SQL 직접 집계 12개월 7.9초(10-14 9.7초)·전체 기간 10.7초(10-14 12.2초).
- Edge: `my-analytics/server/personalHandler.ts`·`public-analytics/supabase/functions/public-analytics/index.ts` 교체, `public-analytics/server/screenFacts.ts` 생성
  (원격 원본 해시가 `f1e129e`와 일치할 때만, 원본은 `edge-before/`), functions 재시작. 익명 확인 auth 200, Edge 4경로 401.
  (Python urllib 기본 User-Agent는 프록시가 403으로 막아 검사에 별도 UA를 넣었다.)
- Pages: [workflow 39052868594](https://github.com/Fentanest/safetyreport-community-map/actions/runs/39052868594) 성공(`d984fef`, 알리 배너 반영).
- cron(`cron.job_run_details`): 적용 전 17:05~17:12 UTC는 3분 중 2번 24.8~26.3초(나머지 0.6초). 적용 직후 새 키로 한 번(17:13, 19.6초) 계산한 뒤
  17:14~17:19는 매분 0.61~0.65초 — 자료 변화가 없을 때 재계산하지 않는다(시각만 갱신).
- 미검증: 운영 로그인 브라우저에서 화면·핀·개인 비교 실제 응답 시간.

## 2026-10-18 · 개인 비교 기관·담당자·내 핀 상한 상향 (적용함)
- 코드 `0408205`(기관 50→1,000, 담당자 50→2,000, `my_points` 1,000→5,000). DB 변경 없음. 순서: Pages → Edge(새 화면은 옛 Edge의 50개 응답도 받는다. 반대 순서면 옛 화면이 새 응답을 검사에서 거부).
- Pages: [workflow 39099695386](https://github.com/Fentanest/safetyreport-community-map/actions/runs/39099695386) 성공.
- Edge(206 셀프호스트, 사용자 승인): `volumes/functions/my-analytics/source/server/{compare.ts,screenAggregate.ts}` 교체(원본 해시가 `b855978`과 같을 때만, 교체 후 `0408205`와 같음 확인),
  `docker compose restart functions`. healthy·로그 오류 없음·무인증 my-analytics/screen·compare 401. 다른 함수에는 두 파일이 없다.
- 되돌리기: 206 `~/edge-backup-20261018-cmplimits/`의 두 파일을 같은 위치로 복사 후 functions 재시작.
- 미검증: 로그인 브라우저에서 제물포 테두리 복구(Chrome 확장 미연결, 개인 응답 재현은 세션 자격 증명이 필요해 하지 않음).


## 기관 registry 2026-10-18.1 전환·롤백 (206 적용함, 2026-10-18)

적용 기록(206 셀프호스트, 사용자 허락 "실운영 서버 아니니까 해도 된다"):
- 백업 `~/registry-backup-20261018/`: Edge 원본 6파일(교체 전 해시가 `643b148`과 같음 확인), facts 식별·원문·파생 triple CSV 138,941행.
- Edge: `community-ingest/source`의 `server/ingest/observation.ts`·`shared/agency-region-registry/{manifest.json,data/agency_*.json}` 교체 후 functions 재시작.
  익명 호출이 함수 본문의 `auth_required`까지 도달(새 번들 로딩 확인). 재시작으로 구 워커 종료.
- DB: `202610180400` 한 트랜잭션 적용·`schema_migrations` 기록, singleton `2026-10-18.1`.
- recompute: dry-run scanned 138,941 / changed 11 / codelessInstitutionRefreshed 0 / versionStampOnly 138,930 → apply 동일, skipped 0.
  사후 대조: 행·식별자 동일, 원문 열 변경 0, 파생 변경 11(평택지방해양수산청 항만물류과 10건 `ag-c1192000`(해양수산부 본부) → `ag-c1192229`,
  이름 해시 키 1건 → `ag-c5700000` 경기도 여주시), 전 행 `2026-10-18.1`. 공개 화면 캐시는 180초 안에 갱신.
- 되돌리기: 아래 롤백 절차 + 백업 CSV로 triple 복원.


새 스냅샷이 포함된 `community-ingest` Edge 전체 import 번들을 먼저 배포한다.
구 Edge의 진행 중 요청이 모두 끝났음을 확인한 뒤 singleton migration
`202610180400_agency_registry_2026_10_18_1.sql`을 적용하고, 같은 스냅샷의
`scripts/recompute-agency-keys.mjs`를 dry-run → apply 순서로 실행한다.
필요하면 수집을 잠시 정지해 구 요청을 drain한다. 현재 DB 트리거는 Edge가 실제
계산한 버전을 singleton 값으로 덮어쓰므로 **singleton 먼저 → 구 Edge 쓰기**가
발생하면 옛 키가 새 버전으로 찍혀 stale 재계산에서 영구 누락된다.

적용 전에 원문을 바꾸지 않는 기관·담당자 triple과 registry version의 보호된
백업을 준비한다. dry-run의 `codelessInstitutionRefreshed`는 코드 없는 기존 inst
행 중 원문 이름의 유일 별칭(`code_derived`)으로 파생 triple이 바뀌는 행 수다.
모호하거나 찾지 못한 이름은 기존 triple을 유지한다. 이 수와 changed/stamp-only,
적용 후 stale 행 수·신고 총수·기관별 통계를 함께 대조한다.

롤백은 이전 Edge 번들 배포·새 버전 요청 종료 확인 → 별도 migration으로 singleton을
`2026-09-29.3`으로 되돌림 → **이전 스냅샷**을 사용하는 호환 recompute 도구로
dry-run/apply 재실행 순서다. singleton만 되돌리면 facts의 새 파생값은 남는다.
현재 안전한 별칭 갱신 로직은 이전 스냅샷에서도 사용해야 한다(과거 도구는 inst를
무조건 보존함). 이전 스냅샷에 없는 신규 코드·모호한 코드 없는 행은 자동 역변환을
보장할 수 없으므로 적용 전 백업과 대조해 복원하고, 원문·신고 수 불변을 검증한다.

트리거가 실제 계산 버전을 보존하거나 불일치 쓰기를 거절하게 하는 대안은 이번에
적용하지 않았다. 새 Edge를 먼저 올리는 혼합 버전 구간과 recompute의 낙관적 잠금·
버전 기록을 함께 설계하고 SQL 통합 검증해야 하므로 별도 변경이 필요하다.

## 2026-10-18 · 좁은 화면 지도 아래 알리 가로 배너 (정적 웹 배포 완료)
- 사용자 승인("응 해"). 코드 `56ce8fd`(banners.html `below` 자리, `AdBanner` media 조건). DB·Edge 변경 없음.
- 배포 전 로컬에서 CI와 같은 검사 통과: blueprint·product 파이썬, Vitest 1225, `test:sql`, live 빌드, dist 스캔.
- Pages: [workflow 39128677720](https://github.com/Fentanest/safetyreport-community-map/actions/runs/39128677720) 성공.
- 운영 확인: https://safemap.worklazy.net 번들에 `below` 자리·photo-strip 배너·`(min-width: 1440px)` 조건 포함.
  대시보드는 공유자 로그인이 필요해 운영 화면에서는 보지 못했다(demo 자료 브라우저 검사 `scripts/browser/verify_aliexpress_below.mjs` 26/26으로 확인).
- 되돌리기: `56ce8fd`를 revert 후 Pages workflow 재실행.

## 2026-10-21 · 원본 JSON 수신(v2)·서버 파싱 워커·카카오 연결 해제 웹훅 (206 적용, 정책 전환 전)
사용자 승인("버전 확정하고 모두 푸시 빌드 배포 다 하자"). 계획·검수는 [REVIEW-REPORT](implementation/raw-json-ingest-20261021/REVIEW-REPORT.md).
- 백업 `~/backup-20261021/`(206): DB 전체 `pg_dump -Fc`(적용 전), 교체 전 Edge 함수 3개(`functions-before.tgz`), compose·라우터·`.env` 사본(0600).
- DB: 지도 `202610210100_raw_json_ingest.sql` → auth `202610210300_kakao_unlink_revoke.sql` 순서로 `psql -v ON_ERROR_STOP=1`, 각각
  `schema_migrations` 기록, `notify pgrst`. 해시는 `migration-manifest.json`과 일치. `community_ingest_config.v2_enabled=false`(기본),
  정책은 `2026-09-28.3` 그대로 — v2 는 정책 전환 때 켠다. pg_cron `community-ingest-payload-prune` 등록 확인.
- Edge: 이번 변경분만 교체 — `community-ingest`(handler·raw·index), `my-analytics`(personalHandler·clientStatus·index),
  `community-account`(account·index), 새 `community-kakao-unlink`. `my-reports`의 예전 미배포분(Retry-After, `2839a4b`·`601ae23`)은 이번 범위 밖이라 두었다.
- 라우터 `volumes/functions/main/index.ts`: 206 은 `docker-compose.community-trial.yml`이 `VERIFY_JWT=true`라 카카오 호출이 라우터에서 막힌다.
  `community-kakao-unlink`를 `community-auth-relay`와 같은 JWT 예외에 넣었다(함수가 `KakaoAK` 대표 어드민 키·앱 ID 를 직접 확인).
- functions 환경: `.env`의 `KAKAO_ADMIN_KEY`·`KAKAO_APP_ID`(사용자가 직접 입력)를 `docker-compose.yml` functions environment 에 연결.
  확인: 키 없음·틀린 키 401, 다른 앱 ID 403, 맞는 키+없는 회원번호 200(`unmatched`), 외부 HTTPS 도달.
  카카오 콘솔 웹훅 URL `https://supabase.worklazy.net/functions/v1/community-kakao-unlink`(POST) 등록은 사용자 몫. 실제 카카오 호출로는 아직 검증하지 않았다.
- 파서 워커: `~/community-parser/`(지도 `b19e837` git archive, 이미지 `community-parser:map-b19e837`, 네트워크 `supabase_default`).
  DB 로그인 `community_parser_login`(NOLOGIN 역할 `community_parser` 의 구성원, 역할 timeout 설정), DSN 은 `~/community-parser/.env`(0600)에만 있다.
  기동 로그 `parse_key=pc-parser-13+map1`, registry `2026-10-18.1` = DB singleton.
- 레거시 HS256 키 교체(같은 날): 점검 출력에 functions 의 레거시 service_role 키가 찍혀 `JWT_SECRET`과 이를 쓰는 `ANON_KEY`·`SERVICE_ROLE_KEY`,
  `JWT_KEYS`·`JWT_JWKS`의 HS256 키를 새로 만들었다(사용자가 206에서 스크립트 실행, 값 출력 없음). ES256 키·`sb_publishable_`·`sb_secret_`는 그대로라
  앱·지도 웹·확장·GitHub 변수 변경 없음. 확인: 옛 service_role·anon 키 401, 새 키·공개 키 정상, 함수 내부 DB 호출 정상, realtime tenant 재생성, 전 컨테이너 healthy.
- 클라이언트 출시: PC [v3.6.0](https://github.com/Fentanest/safetyreport/releases/tag/v3.6.0)(실행 파일 4종·Docker),
  모바일 [v2.5.0+179](https://github.com/Fentanest/safetyreport-mobile/releases/tag/v2.5.0)(Play production 업로드, 심사 대기).
- 정책 전환(사용자 지시 "다 발급하고 다 올려", 스토어 반영을 기다리지 않음): auth `202610211900_policy_2026_10_21_1.sql` 적용·이력 기록 →
  현재 정책 `2026-10-21.1`(공개 플래그 셋 모두 true), 기존 active grant 98 건은 outdated(재동의 대상, v1 은 계속 수신).
  `community_ingest_config`: `v2_enabled=true`, `client_notice` = warning·최소 PC 3.6.0/모바일 2.5.0·다운로드 링크·deadline 없음. `v1_sunset` 은 미정이라 null.
- 카카오 연결 해제 웹훅은 사용자가 정책 전환 전에 콘솔에 등록했다(POST).
- Pages: auth [workflow 39588117070](https://github.com/Fentanest/safetyreport-community-auth/actions/runs/39588117070)(privacy·help 새 정책 절),
  지도 [workflow 39588126429](https://github.com/Fentanest/safetyreport-community-map/actions/runs/39588126429)(업데이트 안내 배너). 둘 다 성공, 운영 페이지에서 새 문구·`client-status` 호출 확인.
- 되돌리기: 정책은 `community_policy_current` 를 `2026-09-28.3` 으로, `v2_enabled=false`·`client_notice=null`(받은 원본은 남는다).
- PC [v3.6.1](https://github.com/Fentanest/safetyreport/releases/tag/v3.6.1): 재시작 직후 필수 설정 화면이 '확인 중'에 머물러 새 동의문이 안 뜨던 문제 수정.
  205 개인 서버를 3.6.1 로 갱신(공유 기록 DB 사전 백업 `/docker/safetyreport/data_backup_20261021_pre360/`).
  릴리스 노트(PC 3.6.0·3.6.1, 모바일 2.5.0)를 사용자 관점으로 다시 쓰고 Play production(빌드 179) '새로운 기능' 문구도 교체했다.
- 남은 일: 실제 재동의 사용자의 원본 1회 전송·워커 파싱 운영 관찰, 구버전(v1) 차단일 결정.

## 2026-10-22 · 1회 전송 재개·점검 스위치·필수 버전·공지·운영 콘솔 (미배포, 적용 순서 제안)

작업지시서 `docs/tasks/backfill-resume-20261022.md`, 보고 `docs/implementation/backfill-resume-20261022/A-REPORT.md`. 각 단계는 사용자 승인 뒤.

1. migration: auth `202610220100_setup_progress_client_seen.sql` → 지도 `202610220200_backfill_resume_ops.sql`(지도 쪽이 auth 의 `community_note_client`·
   `community_setup_progress`·`community_client_seen` 을 쓴다). 적용 직후 `select public.internal_community_ingest_capabilities();` 에
   `paused:false`·`client_requirement:null` 이 보이는지, pg_cron `community-progress-history-prune` 등록을 확인한다.
2. Edge(교체 파일):
   - `community-ingest`: `server/ingest/handler.ts`·`progress.ts`(새)·`version.ts`(새)·`index.ts`. 순서 바뀜: 인증 직후 공유 설정을 읽는다(중지면 503).
   - `my-analytics`: `server/clientStatus.ts`·`personalHandler.ts`(client-status 에 `upload_pause`·`update_gate`). **지도 웹(Pages)도 바로 이어서 배포**한다 —
     예전 웹은 새 키를 모르는 응답을 버려 업데이트 안내만 사라진다(지도 열람에는 영향 없음).
   - `community-account`(auth `server/account.ts`): setup-progress·버전 헤더·status 의 중지/필수 버전.
   - 새 `app-announcements`(`server/announcements/handler.ts`·`server/ingest/version.ts`). 206 라우터 `volumes/functions/main/index.ts` 는
     `VERIFY_JWT=true` 이므로 `community-auth-relay`·`community-kakao-unlink` 와 같은 **JWT 예외 목록에 `app-announcements` 를 넣는다**
     (공개 키만으로 읽는 공개 함수, 개인정보 없음, `Cache-Control: max-age=300`). 확인: 토큰 없이 `GET …/app-announcements?app=pc&mode=server&platform=windows&version=3.6.2` 200.
3. 운영 콘솔 DB 준비: `docs/operations/ops-console-db.md`(로그인 역할 켜기, 첫 관리자 한 줄). 비상 SQL: `docs/operations/emergency.sql`.
4. PC 3.6.2 → 모바일 2.5.1 출시.
5. 파서 워커: 이제 **파서 레포(`Fentanest/safetyreport-community-parser`) 커밋 기준으로 빌드**한다. 지도 레포 git archive(`server/parser-py`)는 더 쓰지 않는다.
   빌드 인자 `MAP_REF`(기본값: 파서 레포 `deploy/map-ref`)의 지도 커밋에서 `shared/agency-region-registry/`·`contracts/parser/` 를 받아 지도 MANIFEST 해시와
   비교하고, 다르면 빌드가 실패한다. 이미지 태그는 파서 레포 커밋 기준(`community-parser:<파서 커밋>`). 기동 때 DB registry 버전 검사는 그대로.
6. 운영 콘솔 배포(콘솔 레포, LAN 바인드)·첫 관리자 등록 → `client_notice` 최소 버전을 PC 3.6.2 / 모바일 2.5.1 로 → 콘솔에서 첫 공지 두 개 게시.

### 변경 체크리스트 추가 (2026-10-22부터)
- 처리기관-지역 목록(`shared/agency-region-registry/`)이나 파서 계약(`contracts/parser/`)을 바꾸는 변경은 **파서 레포 `deploy/map-ref` 를 그 지도 커밋으로 갱신**하고
  파서 이미지를 다시 빌드한다(안 하면 워커가 옛 목록·계약으로 돈다).
- `contracts/app-announcements/`·`contracts/parser/` 를 바꾸면 `python3 scripts/check_contract_manifests.py --write <폴더>`, v2 계약은 `generate_contract.py`.
- `v1_sunset` 과 필수 버전(`client_requirement`)을 함께 쓰지 않는다. v1 차단은 필수 버전(PC 3.6.0 / 모바일 2.5.0 이상)으로 한다.

### 한계
- 이미 배포된 구버전(PC 3.6.1 이하·모바일 2.5.0 이하)에는 앱 잠금·공지·진행 보고가 없다. 구버전에 듣는 것은 업로드 503·426 과 지도 웹 안내뿐이다.
- 지도 웹의 필수 버전 판정은 `client-status` 가 하고 지도 웹이 따르는 방식이라, 지도 데이터 API 자체는 버전으로 막지 않는다.
