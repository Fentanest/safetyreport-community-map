# 공개 데이터 파이프라인

## 매일 데이터 흐름
업로더 02~03 KST 자동 실행은 PC/server/Android 책임이다. Android 지연 가능하므로 03시에 모든 사용자가 업로드를 마쳤다고 가정하지 않는다.
Supabase는 완료된 snapshot만 집계에 포함하고 version을 교체한다. Pages 초기 캐시는 daily 04:17 KST 목표로 생성하고
추가 갱신은 workflow_dispatch / 승인된 repository_dispatch 등으로 할 수 있다.
GitHub Actions cron 기본 UTC를 쓸 경우 `17 19 * * *`가 KST 다음날 04:17이다. 이 스케줄은 정시 보장이 아니며
지연/공개 레포 60일 비활성 중단을 감시해야 한다. [S08]

## Actions 순서
1. safe export connection으로 versioned meta/overview/map preview를 읽는다. SQL connection은 TLS·read-only role.
2. public projection strict schema 검증, sample=false 확인, 통계 총계 대조.
3. 주소가 없고 좌표가 valid인 포인트만 optional Kakao reverse geocode. raw report data 전송 금지.
4. `data/manifest.json`, `data/<version>/overview.json`, `map-index.json`, dictionaries 등 생성.
5. build는 sanitized 산출물만 받는다. private DSN/REST key env는 exporter step에만 둔다.
6. 테스트 → asset/secret/원번호 scan → dist 전용 artifact → 승인된 Pages deployment.

## geocoding
입력 주소가 정상이면 재호출하지 않는다. 좌표를 주소로 보완하는 일과 위치 좌표를 대체하는 일은 다르다.
Kakao REST coord2address: x=lng, y=lat, Authorization: KakaoAK secret. region code가 필요하면 coord2regioncode.
실패/null address는 '주소 확인 중'과 exact coordinate로 표시; 없는 지명을 지어내거나 0,0 좌표로 대체하지 않는다.
좌표별 cache·재시도·429 budget 적용. persistent cache 보관/재배포 조건과 공급자 약관은 실제 운영 전에 확인한다.
CI cache에는 비공개 data를 섞지 않는다. 위치 cache 쓰기가 필요해도 exporter DB role의 전역 쓰기를 열지 않는다.
[S05: Kakao Local]

## 정적 데이터 분할
first-screen은 최소 meta+overview+map-index. point-details/entities는 공개 API lazy fetch.
URL은 dataset_version을 포함하고 manifest pointer는 짧은 캐시. API에서 새 version을 알면 stale snapshot 라벨 및 재조회.
정적 artifact의 차량별 전체 집계/원본은 금지. source maps에 fixture raw가 들어가지 않도록 테스트 포함.

## 실패
export 실패 → 기존 Pages 배포 유지, 상태 알림. 빈 데이터로 정상 덮어쓰기 금지.
차량/담당자 상세는 live API 기준, 오류 시 해당 panel 오류/재시도. 다른 정상 panel은 사용 가능.
배포 캐시·라이브 집계·원천 수집시각 3개를 구분 표시한다.
