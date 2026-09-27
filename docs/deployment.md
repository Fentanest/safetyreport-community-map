# 배포·환경 설정
이 문서는 준비 명세다. installer/패키지 실행이 클라우드 리소스를 변경하지 않는다.

## 환경값
| 값 | 위치 | 성격 |
|---|---|---|
| VITE_KAKAO_MAP_JS_KEY | repo variable 또는 CI frontend env | 공개 JS key. secrets에 저장해도 번들에서는 공개 |
| VITE_PUBLIC_ANALYTICS_URL | variable / frontend | 공개 read-only Edge API base |
| VITE_DATA_MODE | variable | live 또는 명시 demo |
| VITE_BASE_PATH | variable | `/` 기본 (공개 주소 `https://safemap.worklazy.net/`) |
| PUBLIC_ANALYTICS_URL | CI variable | Pages 빌드의 API base. snapshot exporter는 공유자 전용 동안 쓰지 않음. 비밀키 불필요 |
| SUPABASE_EXPORT_DATABASE_URL | 선택적 후속 direct exporter 전용 | 현재 스크립트는 사용하지 않음. 사용 시 specific safe views SELECT 전용 DSN/TLS 필요 |
| ANALYTICS_RATE_SALT | Supabase Edge Function secret | 1분 rate bucket용 salt(공유자 전용이면 사용자별, 공개면 IP별). 프런트/CI에 넣지 않음 |
| ANALYTICS_ACCESS | Supabase Edge Function secret | 없거나 `public`이 아니면 공유자 전용(기본). `public`이면 예전처럼 익명 공개 |
| ANALYTICS_ALLOWED_ORIGINS | Supabase Edge Function secret | 공유자 전용일 때 `public-analytics` Origin allowlist. 없으면 `MY_ANALYTICS_ALLOWED_ORIGINS` |
| optional SUPABASE_PUBLISHABLE_KEY | 공개 direct adapter만 | anon/access grants로 제한. 기본 UI는 필요 없음 |
| service_role/secret | 중앙 Supabase 함수 runtime만 | 관리자 성격. CI readonly 대용으로 사용하지 않음 |
| VITE_SUPABASE_URL | variable / frontend | 지도 웹 로그인용 프로젝트 URL. 공유자 전용 동안 필수(비우면 아무도 지도를 볼 수 없음) |
| VITE_SUPABASE_PUBLISHABLE_KEY | variable / frontend | 선택. 공개 publishable(`sb_publishable_…`) 키. secret/service_role 금지(dist 스캔이 비-anon JWT 차단) |
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
지도 로그인 토큰과 함께 API에서 읽는다. `npm run data:export`(공개 API에서 snapshot 생성)는 공개로 다시 열 때를 위해 남겨 두었다.
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

현재 운영 Supabase 키·도메인·v2 사실 데이터가 없어 위 smoke는 미실행이다. 로컬 PostgreSQL 16에서
기존 migration과 v2 migration을 적용하고 역할 권한·1건 조회·철회 후 version 무효화를 검사했다.
이 검사는 운영 DB migration 승인이나 실제 Kakao 지도 검증을 대신하지 않는다.

## rollback
새 build 실패면 배포하지 않음. 배포 후 문제가 생기면 직전 검증 artifact로 rollback(권한 승인 범위),
다만 삭제 요청으로 폐기된 data version으로 되돌아가면 안 됨. 코드 rollback과 데이터 version은 분리 관리.

## 내 신고 비교(my-analytics) 운영 적용 — 별도 승인 필요
1. 운영 DB에 `supabase/migrations/202609270100_my_analytics.sql` 적용(읽기 전용 STABLE RPC 1개, service_role만 실행). 수집·동의·writer 스키마 변경 없음.
2. `supabase functions deploy my-analytics`(verify_jwt=true), secret `MY_ANALYTICS_ALLOWED_ORIGINS`.
3. Supabase Auth: Kakao provider 리다이렉트 허용에 `https://safemap.worklazy.net/**` 추가(지도 페이지로 돌아오는 PKCE).
4. Pages 변수 `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` 설정 후 `VITE_DATA_MODE=live npm run build && npm run scan`.
5. smoke(공유자 전용): 비로그인 → 로그인 안내 화면·API 401 → 공유 신고가 있는 계정으로 로그인 → 지도 → 비교 켜기 → 전체 열 = 지도 KPI → 로그아웃 → 앱 수동 업로드가 계속 ACK되는지. 로컬 증거 스크립트 `scripts/integration/access_gate_e2e.mjs`.
6. 되돌리기: 개인 비교만 끄려면 `MY_ANALYTICS_ENABLED=false`. 지도 공개 범위를 되돌리려면 `ANALYTICS_ACCESS=public`(익명 공개, 함수 재배포 불필요). RPC drop은 선택.
로컬 합성 스택 검증 결과는 `docs/integration/community-ingest/evidence/2026-09-27-personal-compare/`. 운영 적용·실카카오는 BLOCKED.
