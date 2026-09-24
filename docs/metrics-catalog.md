# 지표 사전 · 모든 지표에 제목·시간축·분모
시간대 Asia/Seoul. 날짜 UI 양 끝 포함; DB 조건은 [start KST 00:00, end+1 KST 00:00).
동일 UI 기간이라도 신고지표는 report_date, 처리지표는 completed_date로 필터한다.
각 카드의 `신고일 기준`/`처리완료일 기준` 배지를 숨기지 않는다.

## 공통 기호
R = 선택 공간/분류/기관/담당자에서 **신고일이 기간 내**인 신고 수.
C = 같은 조건에서 **처리완료일이 기간 내이고 완료로 확인된** 신고 수.
A/P/J = 완료일 기준 결과 중 수용/일부수용/불수용의 수. D=A+P+J.
F = 완료일 기준 과태료 처분으로 확인된 신고 수. 금액 수납 건수 아님.
unknown은 분모를 정의하지 않은 채 버리지 말고 n_missing과 eligible을 별도로 낸다.

## 필수 카드와 표
| id | 제목 | 값·분모·기준 |
|---|---|---|
| report_count | 신고 접수 건수 | R / 신고일 |
| report_share | 선택 범위 신고 비중 | R / 같은 기간·비공간 필터를 적용한 전국 신고수 ×100 / 신고일 |
| point_count | 신고 지점 수 | 신고일 기간의 distinct point / 원 신고건수와 다름 |
| contributor_count | 기여 계정 수 | 조건 내 distinct contributor / 전체 행별 수 합산 금지 |
| completed_count | 처리완료 신고 수 | C / 처리완료일 |
| accepted_rate | 수용률 | A/D×100 / 처리완료일, D 표시 |
| partial_rate | 일부수용률 | P/D×100 / 처리완료일 |
| rejected_rate | 불수용률 | J/D×100 / 처리완료일 |
| accepted_including_partial | 수용·일부수용 비중 | (A+P)/D×100 / 수용률과 구분 |
| fine_count | 과태료 처분 신고 수 | F / 처리완료일, 실제 부과일 통계 아님 |
| fine_rate | 처리완료 중 과태료 비중 | F/C×100 / C=0 null |
| disposition_known_share | 처분 확인률 | 확인 처분건수/C×100 / 미확인 포함 범위 설명 |
| current_pending | 선택 신고의 현재 미완료 수 | 신고일 cohort 중 현재 processing/supplement / 과거 backlog 아님 |
| monthly_report | 월별 신고 접수 | month(report_date)의 counts |
| monthly_completed | 월별 처리완료 | month(completed_date)의 counts |
| monthly_fine | 월별 과태료 처분 신고 | month(completed_date) 중 fine |
| monthly_result | 월별 처리결과 구성 | 월별 A/P/J/D·rates; unknown 별도 |
| vehicle_top5 | 신고 접수 차량 TOP5 | 신고일/선택 공간·필터 전체 private 후보, count desc |
| agency_results | 기관별 처리결과 비교 | C,A,P,J,D, rates,F; default C desc, 모든 n≥1 표시 |
| manager_results | 담당자별 처리결과 비교 | 기관+담당자 scope, 나머지 동등 |
| category_share | 신고 분류 구성 | 각 category 신고수 / R |
| region_volume | 지역별 신고 접수 | 선택 지역 코드 기준 R, 건수/비중; 인구비율 아님 |

## 변화량
count delta = current-previous.
count delta% = (current-previous)/previous×100 (previous>0).
previous=0 & current>0 → null + '신규 집계'; both=0 → null + '비교 기준 없음'; current=0/previous>0 → -100%.
비율 변화는 `현재 % - 이전 %`를 **%p**로 표시. 비율의 상대변화 %와 혼동 금지.
소수점은 display 단계에서 1자리(tooltip 2자리)만 반올림. 원 count를 먼저 반올림/정수배분하지 않는다.

## 부분 월·이전 기간
- 오늘 포함 범위는 `진행 중 기간` 배지. 기본 비교는 같은 경과 일수, 같은 timezone.
- 완료된 월은 전월 전체와 비교. 일수 차이로 생길 오해를 줄이려면 일평균도 병기.
- arbitrary range [s,e] N일은 직전 N일과 비교; explicit previous window를 response와 tooltip에 넣는다.
- MTD는 전월 같은 일자까지 가능한 기간을 취하고 end-of-month clipping 여부 표시한다.
- 데이터 제공 시작 전 기간은 0이 아니라 coverage 없음. 누락 구간을 연결해 연속 선처럼 보이지 않게 한다.

## 선별 필터와 분모
기관/담당자/지역/분류/기간은 모두 분모에 반영한다. 상태 필터로 '수용만'을 보았다고 수용률 100%를
기관 전체 수용률처럼 보여주지 않는다. 분포/비율 카드 분모는 해당 결과 축의 선택을 제외한 context를 사용하고
'결과 필터 제외 분모'를 표시한다. 별도 '필터 후 구성' 지표는 명시적으로 구분한다.
처분 선택 역시 처분 비중에서 동일 원칙. query response denominator_filter를 같이 반환한다.

## 추가 구현 권장
- 처리기간 중앙값·p90: 신고일/완료일이 모두 정상인 완료 cohort; 음수 날짜 제외·n 보고.
  joint cube이면 duration distribution/샘플이 있어야 한다. 중앙값 평균으로 전체 중앙값을 만들지 않는다.
- 일자×요일 신고 calendar: 일별 사실이 있을 때만. 시간대 히트맵은 발생시각 없으면 생성 금지.
- 지역 A/B 비교: 같은 기간·분모에 나란히 표시. 승자/우열 점수로 요약하지 않는다.
- 최근 증가 지점: 절대 변화량 우선, %와 n·동일 비교기간 병기. 모집단 발생 위험으로 부르지 않는다.
- 현재 선택 조건에서 범주 구성, 신고 접수월 기준 현재 결과(cohort)가 지원되면 별도 탭으로 명시.

## 순위와 언어
차량 순위는 '신고 건수 기준 · 위반 확정 아님'. 1건이라도 n≥1이면 후보에 포함한다. 5대 미만이면 있는 만큼.
기관/담당자는 수치 정렬이 가능하지만 평가 점수·인물의 우수/불량 판정·독려/비난 문구를 만들지 않는다.
'신고율'은 모집단 분모가 없으므로 일반 제목으로 쓰지 않고 신고 비중/일평균 신고건수 등 실제 분모를 표현한다.
