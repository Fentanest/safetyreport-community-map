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
| region_volume | 지역별 신고 접수 | 2026-07-01 법정 시도/시군구 코드별 R·C·A/P/J·F(docs/region-boundaries.md). 시도·시군구 행은 각각 원 사실에서 계산, 미확인 행 별도; 인구비율 아님 |
| processing_duration | 답변까지 걸린 기간 | 아래 §답변까지 걸린 기간 |
| fine_amount | 답변에 적힌 과태료 금액 | 아래 §답변에 적힌 과태료 금액 |

## 답변까지 걸린 기간 (processing_duration, 2026-09-27 구현 `server/duration.ts`)
- 모집단: 완료일(답변일) cohort 중 답변이 나온 상태 accepted·partial·rejected·completed_unknown. 이전·취하·보완은 제외(답변 아님).
- 1건의 값: KST 달력일 `day(completed_date) − day(report_date)`. 같은 날 답변 = 0일. 시각 차이가 아니라 날짜 차이.
  `completed_date`는 마지막 답변 항목의 날짜(`answers[-1].C_DATE`).
- 제외(값을 고치지 않고 센다): 신고일 없음 `no_report_date`, 답변일이 신고일보다 앞섬 `reversed`. 답변 상태인데 답변일이 없는 신고는
  기간에 속하는지 알 수 없어 cohort 밖이며 `answer_date_missing`으로 따로 센다.
- 요약: n, 평균, 중앙값(짝수 n은 가운데 두 값 평균), p90(nearest-rank: 오름차순 ceil(0.9n)번째), 최솟값, 최댓값.
  그룹(월·지역·기관·담당자) 중앙값은 그룹의 원 값으로 다시 계산한다(그룹 중앙값의 평균 금지).
- n=0이면 값은 null이고 capability는 supported(‘계산할 신고 없음’), 미지원으로 표시하지 않는다.
- 비교: 내 값 − 전체 값(일). 평균은 부분집합이어도 전체보다 클 수 있어 부분집합 검사 대상이 아니다.

## 답변에 적힌 과태료 금액 (fine_amount, 2026-09-27 구현 `server/amount.ts`)
- 뜻: 답변 문장에 적힌 과태료 금액. 실제 부과·납부·징수 금액이 아니다.
- 모집단: 완료일 cohort의 과태료 처분 신고(F). 분류: confirmed(처분·종류·상태 일치, 금액 적힘, **동의한 정책이 금액 공개를 허용**),
  undisclosed(금액이 적혔으나 정책이 공개를 허용하지 않음 — 값은 DB 밖으로 나오지 않음), unconfirmed(금액 안 적힘·파싱 실패),
  conflict(처분·종류·상태가 서로 맞지 않음), penalty(범칙금), combined(과태료·범칙금이 한데 적혀 나눌 수 없음).
- 합계·평균·중앙값은 confirmed만. 정확한 원 단위 정수(표시할 때만 평균을 1원 단위로 반올림). confirmed 0건이면 null(‘확인된 금액 없음’), 0원으로 쓰지 않는다.
  명시적 0원은 실제 0으로 더하고 `zero_count`로 따로 보인다. 범칙금·섞인 금액은 과태료에 더하지 않는다. 위반 유형·법정 범위로 추정하지 않는다.
- 한 조건(지역·기관·담당자·월)에 금액 확인 신고가 1건뿐이면 합계·평균이 곧 그 신고의 금액이다. 숨기지 않는다(2026-09-27 사용자 결정, n=1 공개 원칙과 같음).
- `partial=true`: F 중 일부만 금액이 확인됨(화면 ‘일부만 합산’). capability coverage = {eligible: confirmed_count, total: F}.
- 비교: 내 합계 ÷ 전체 합계(%, 전체 합계가 0 또는 없으면 null), 평균 차이(원). 부분집합 검사는 건수·합계만.

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
- 처리기간: 2026-09-27 구현됨(위 §답변까지 걸린 기간).
- 일자×요일 신고 calendar: 일별 사실이 있을 때만. 시간대 히트맵은 발생시각 없으면 생성 금지.
- 지역 A/B 비교: 같은 기간·분모에 나란히 표시. 승자/우열 점수로 요약하지 않는다.
- 최근 증가 지점: 절대 변화량 우선, %와 n·동일 비교기간 병기. 모집단 발생 위험으로 부르지 않는다.
- 현재 선택 조건에서 범주 구성, 신고 접수월 기준 현재 결과(cohort)가 지원되면 별도 탭으로 명시.

## 순위와 언어
차량 순위는 '신고 건수 기준 · 위반 확정 아님'. 1건이라도 n≥1이면 후보에 포함한다. 5대 미만이면 있는 만큼.
기관/담당자는 수치 정렬이 가능하지만 평가 점수·인물의 우수/불량 판정·독려/비난 문구를 만들지 않는다.
'신고율'은 모집단 분모가 없으므로 일반 제목으로 쓰지 않고 신고 비중/일평균 신고건수 등 실제 분모를 표현한다.
