# 공개 데이터 파이프라인

## 매일 데이터 흐름
업로드는 수집 직후 실시간 + 지도 탭 수동 + 매일 00:00 KST(PC/server/Android 책임, 지연 가능). 특정 시각에 모든 사용자가 업로드를 마쳤다고 가정하지 않는다.
Supabase는 완료된 snapshot만 집계에 포함하고 version을 교체한다. (2026-09-27 공유자 전용 전환: 정적 snapshot을 만들지 않는다 — docs/public-api-contract.md §열람 조건)
(공개 전환 뒤 다시 쓸 때의 계획) Pages 초기 캐시는 daily 04:17 KST 목표로 생성하고
추가 갱신은 workflow_dispatch / 승인된 repository_dispatch 등으로 할 수 있다.
GitHub Actions cron 기본 UTC를 쓸 경우 `17 19 * * *`가 KST 다음날 04:17이다. 이 스케줄은 정시 보장이 아니며
지연/공개 레포 60일 비활성 중단을 감시해야 한다. [S08]

## Actions 순서
1. safe export connection으로 versioned meta/overview/map preview를 읽는다. SQL connection은 TLS·read-only role.
2. public projection strict schema 검증, sample=false 확인, 통계 총계 대조.
3. 앱·서버가 전송한 공식 좌표와 주소를 그대로 사용한다. 주소가 없어도 좌표를 바꾸거나 추정하지 않는다.
4. `data/manifest.json`, `data/<version>/overview.json`, `map-index.json`, dictionaries 등 생성.
5. build는 sanitized 산출물만 받는다. private DSN env는 exporter step에만 둔다.
6. 테스트 → asset/secret/원번호 scan → dist 전용 artifact → 승인된 Pages deployment.

## 신고 위치
안전신문고 상세 응답의 위도·경도를 그대로 받는다. 완료된 보완으로 위치가 바뀌면 새 좌표가 최신 신고 사실을 대체한다.
주소가 없으면 없는 상태로 표시하며, 지명을 추정하거나 0,0 좌표로 대체하지 않는다.

## 정적 데이터 분할
(2026-09-27 공유자 전용 전환: 정적 snapshot을 만들지 않는다 — docs/public-api-contract.md §열람 조건)
first-screen은 최소 meta+overview+map-index. point-details/entities는 공개 API lazy fetch.
URL은 dataset_version을 포함하고 manifest pointer는 짧은 캐시. API에서 새 version을 알면 stale snapshot 라벨 및 재조회.
정적 artifact의 차량별 전체 집계/원본은 금지. source maps에 fixture raw가 들어가지 않도록 테스트 포함.

## 실패
export 실패 → 기존 Pages 배포 유지, 상태 알림. 빈 데이터로 정상 덮어쓰기 금지.
차량/담당자 상세는 live API 기준, 오류 시 해당 panel 오류/재시도. 다른 정상 panel은 사용 가능.
배포 캐시·라이브 집계·원천 수집시각 3개를 구분 표시한다.
