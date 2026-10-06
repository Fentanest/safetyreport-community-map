# 변경 기록 · 2026-10-06

- `060600`: state/facts/viewer 또는 state/rollup을 한 STABLE SQL 스냅샷에서 읽는 service-only RPC. 기존 랭킹에 optional `consistency=latest`를 추가한다.
- Edge: 기존 공개 집계의 분리된 state/source 읽기를 통합. 개인 `my-analytics/screen`은 대시보드·비교·현재 표·지도 상세를 같은 자료에서 묶는다. JWT/Origin/gate/rate/no-store/원천 한도 유지.
- 웹: 화면 단위 교체와 요청 세대 검사, 계정 경계 초기화. 버전 변경만으로 표 페이지를 초기화하지 않으며 누적 목록도 한 묶음으로 읽는다. 맞춤 통계·랭킹은 한 응답의 반환 버전을 수용한다.
- 기존 strict 요청·공개 DTO·앱 업로드 계약은 유지. 새 화면을 위해 SQL → Edge → Pages 배포 필요.
- 실제 연속 ingest 4조건 비교, MVCC 중간 커밋 probe, 단위/통합/브라우저 증거를 추가한다. 운영 접속·push·배포 없음.
