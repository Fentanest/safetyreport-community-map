# upstream gap 기록 템플릿
착수 시 실제 Supabase schema를 읽을 권한이 있을 때만 확인한다. 허가 없는 DB 조회·운영 수정 금지.

| 지표/기능 | 실제 source field/query | support | missing/assumption | 필요한 upstream 계약 | 증거 |
|---|---|---|---|---|---|
| daily report | 미확인 | missing | v1은연도만 | KST report_date | |
| completed series | 미확인 | missing | 완료일 없음 | completed_date+terminal status | |
| manager status | 미확인 | missing | marginal counts는불충분 | agency+manager+status cross | |
| vehicle TOP5 | 미확인 | missing | v1미수집 | private full canonical/date/space | |

미확인을 missing으로 적어두는 것은 실제 운영 DB에 없다는 단정이 아니다. 확인 후 evidence와 support를 갱신한다.
