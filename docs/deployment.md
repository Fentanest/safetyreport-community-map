# 배포·환경 설정
이 문서는 준비 명세다. installer/패키지 실행이 클라우드 리소스를 변경하지 않는다.

## 환경값
| 값 | 위치 | 성격 |
|---|---|---|
| VITE_KAKAO_MAP_JS_KEY | repo variable 또는 CI frontend env | 공개 JS key. secrets에 저장해도 번들에서는 공개 |
| VITE_PUBLIC_ANALYTICS_URL | variable / frontend | 공개 read-only Edge API base |
| VITE_DATA_MODE | variable | live 또는 명시 demo |
| VITE_BASE_PATH | variable | `/` 기본 (공개 주소 `https://safemap.worklazy.net/`) |
| PUBLIC_ANALYTICS_URL | CI variable, snapshot exporter | 현재 구현은 이미 공개 허용된 Edge API만 읽음. 비밀키 불필요 |
| SUPABASE_EXPORT_DATABASE_URL | 선택적 후속 direct exporter 전용 | 현재 스크립트는 사용하지 않음. 사용 시 specific safe views SELECT 전용 DSN/TLS 필요 |
| KAKAO_REST_API_KEY | 선택적 주소 보완 step만 | 현재 스크립트는 사용하지 않음. 브라우저 변수 금지 |
| ANALYTICS_RATE_SALT | Supabase Edge Function secret | 공개 요청 IP의 1분 rate bucket용 salt. 프런트/CI에 넣지 않음 |
| optional SUPABASE_PUBLISHABLE_KEY | 공개 direct adapter만 | anon/access grants로 제한. 기본 UI는 필요 없음 |
| service_role/secret | 중앙 Supabase 함수 runtime만 | 관리자 성격. CI readonly 대용으로 사용하지 않음 |

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
`product-check.yml`은 검증 전용이다. `publish-pages.yml`은 main의 수동 `workflow_dispatch`만
받아 public endpoint에서 snapshot export·검사·live 빌드가 모두 성공했을 때만 Pages artifact를
배포하도록 작성했으나, 현재 운영값과 v2 원천이 없어 실행하지 않았다. 정적 첫 화면 snapshot은
`PUBLIC_ANALYTICS_URL=https://<project>.supabase.co/functions/v1 npm run data:export`로 **공개 API**에서만
생성한다. 이 URL은 비밀키가 아니다. `public/data/`는 생성 파일이며 gitignore 대상이다.
export가 실패하거나 v2 capability가 missing이면 manifest를 갱신하지 않는다. 런타임은 API meta의
현재 dataset_version과 snapshot version이 일치할 때만 정적 파일을 사용한다.
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
