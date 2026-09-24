# 구현 로드맵
각 단계는 문서 생성만으로 완료하지 않는다. 구현 허용이 주어졌으므로 0단계 보고만 하고 멈추지 않는다.

| 단계 | 산출물 | 통과 기준 |
|---|---|---|
| 0. 실제 환경/원천 | HEAD·remote·upstream capability·Muse doctor·파일 소유 ledger | no invented model/schema |
| 1. 계약·설계 | strict DTO, metric functions/tests, UI tokens, Muse 방향 검수 | mask/date/denominator edge cases passed |
| 2. UI 수직 슬라이스 | 전국 dashboard, map mount, KPI, one panel, filters, light/dark | 실제 browser screenshots·키보드 동작 |
| 3. 분석 기능 | 기관/담당자, 월별, region compare, top5, capabilities | cross-filter·version·1건·0분모 passed |
| 4. 실읽기 연동 | public Edge API/RPC, safe exporter, version consistency | raw/secret 안 내려옴, 정확 sample 대조 |
| 5. 지도 완성/성능 | Kakao clusters, detail, relayout, LOD, tests | 키 있는 도메인에서 실제 지도 검수 |
| 6. release preparation | Actions templates→검증된 workflows, dist scan, runbook | no blocked hard gate |
| 7. 승인 후 배포 | actual Pages URL·smoke tests·rollback | 운영 승인/근거 남김 |

공통 상세기능은 docs/acceptance-matrix.md를 따른다. 키가 없는 동안에도 1~3·대부분 테스트를 진행한다.
4~5 실제 연결과 운영 배포가 막혀 있으면 이유/필요 설정을 기록하며 fake success로 바꾸지 않는다.
