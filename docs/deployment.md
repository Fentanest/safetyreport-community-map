# 배포·환경 설정
이 문서는 준비 명세다. installer/패키지 실행이 클라우드 리소스를 변경하지 않는다.

## 환경값
| 값 | 위치 | 성격 |
|---|---|---|
| VITE_KAKAO_MAP_JS_KEY | repo variable 또는 CI frontend env | 공개 JS key. secrets에 저장해도 번들에서는 공개 |
| VITE_PUBLIC_ANALYTICS_URL | variable / frontend | 공개 read-only Edge API base |
| VITE_DATA_MODE | variable | live 또는 명시 demo |
| VITE_BASE_PATH | variable | /safetyreport-community-map/ 기본 |
| SUPABASE_EXPORT_DATABASE_URL | GitHub secret, exporter step만 | specific safe views SELECT 전용 DSN, TLS |
| KAKAO_REST_API_KEY | GitHub secret, geocode step만 | private REST credential |
| optional SUPABASE_PUBLISHABLE_KEY | 공개 direct adapter만 | anon/access grants로 제한. 기본 UI는 필요 없음 |
| service_role/secret | 중앙 Supabase 함수 runtime만 | 관리자 성격. CI readonly 대용으로 사용하지 않음 |

환경 파일은 .env.example만 커밋한다. 실제값은 요청받아 채팅에 복사시키지 말고 사용자가 GitHub/Supabase 설정에 입력한다.
VITE_에 PRIVATE/SECRET/REST/DSN이 들어가면 검증 실패. 단순 환경변수 이름보다 실제 artifact도 검사한다.

## Pages
프로젝트 하위 경로 base를 맞춘다. 날짜·탭은 query 또는 hash routing으로 유지해 deep-link 404를 피한다.
assets/data 주소에 import.meta.env.BASE_URL 사용. 자동 임의 wildcard redirect에 의존하지 않는다.
실제 배포 artifact는 dist 하나만; repository root/documentation/reference-image 전체를 upload하지 않는다.
워크플로 예시는 templates/github-pages.yml.example이며 Sol이 script/package명을 실제 구현과 맞춘 후
현재 지원 action을 확인·버전/SHA 고정해서 `.github/workflows/`로 승격한다.

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

## rollback
새 build 실패면 배포하지 않음. 배포 후 문제가 생기면 직전 검증 artifact로 rollback(권한 승인 범위),
다만 삭제 요청으로 폐기된 data version으로 되돌아가면 안 됨. 코드 rollback과 데이터 version은 분리 관리.
