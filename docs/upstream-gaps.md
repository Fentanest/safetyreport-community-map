# v1 → v2 원천 계약 차이

2026-09-24 현재 **저장소에 있는** `202608150001_initial_schema.sql`을 검사했다. 운영 Supabase의 실제 테이블과 데이터는 연결 권한이 없어 확인하지 않았다. 아래 `missing`은 이 저장소의 v1 입력 계약에서 계산 불가능하다는 뜻이다.

| 기능/지표 | v1 저장소 근거 | 저장소 기준 지원 | v2 원천 계약 |
|---|---|---|---|
| 임의 날짜 범위·월별 신고 | `private.upload_points.period_year`만 있음 | missing | KST `report_date` 또는 동등한 일별 joint fact |
| 처리완료·과태료 완료월 | 완료일 컬럼 없음, `fine_count`는 연간 지점 marginal | missing | 실제 `completed_date`와 terminal status·disposition |
| 기관별 처리결과 | `agency_counts`와 `status_counts`가 각각 marginal | missing | agency×status×completed_date joint fact |
| 담당자별 처리결과 | `manager_counts`와 `status_counts`가 각각 marginal | missing | agency+manager×status×completed_date joint fact |
| 임의 기간 차량 TOP5 | 차량 컬럼 없음 | missing | private canonical plate×report_date×공간 joint fact; 원번호는 공개 금지 |
| 기여 계정 distinct | active snapshot 관계와 user_id 있음 | partial | 동일 filter/date/space에서 원 fact의 distinct user_id |
| exact 좌표의 지점 목록 | `upload_points.lat/lng`, `public_map_points.lat/lng` 있음 | partial | v2 fact와 정확 좌표·지점 키 연결 |
| Google 계정 기여 | auth.users FK는 있으나 기존 설명은 전화 기반 | 미확인 | Google OAuth upstream 동의·자동 업로드 계약 |

새 로컬 migration `202609240001_analytics_v2.sql`은 원천 fact 테이블과 읽기 경계를 제안하지만 **v1 연간 행을 v2 일별 사실로 변환하지 않는다**. 기본 `analytics_state.ready=false`이며 실제 v2 적재·검증·version 갱신 전에는 공개 API가 통계를 제공하지 않는다. 초기 SQL은 수정하지 않았다.

운영 준비 전 확인할 것: 실제 원천 앱/서버의 필드·날짜 시간대·상태코드·차량번호 유효성·동일 신고 판정 키·담당자 식별키·행정코드·삭제/철회 이벤트. 추정이나 marginal 비례 배분으로 채우지 않는다.
