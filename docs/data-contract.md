# 데이터 계약 v2 · 공개 지도 읽기 모델
upstream 데이터가 이미 적재된다는 가정 아래 필요한 의미 계약이다. 실제 테이블/컬럼명은 adapter로 매핑한다.
원본 앱/서버를 이 작업에서 임의로 수정하지 않는다. 기존 v1 aggregate만 있으면 v2 지원으로 위장하지 않는다.

## A. 최소 private 분석 사실
개별 report fact 또는 아래 차원을 보존한 joint cube가 필요하다.
| 의미 | 타입/규칙 |
|---|---|
| fact_identity | private 중복 제거 키. 공개 금지. 신고번호 수집 여부는 upstream 계약에서 별도 결정 |
| contributor_id / snapshot_id | private. community ingest 는 신고별 최신 fact(`snapshot_id='ingest-v1'`), 구 snapshot 경로는 공개 소스에서 제외(가드) |
| report_date | KST ISO date, null 허용하되 신고일 지표 제외 수 보고 |
| completed_date | 확인된 처리완료일 KST date, null은 결측. 업로드일로 대체 금지 |
| category | traffic / parking / other |
| status | accepted / partial / rejected / processing / supplement / withdrawn / transferred / completed_unknown / other |
| disposition | fine / penalty / warning / none / unknown (SQL·`server/aggregate.ts` 정본. 2026-09-26 문서 정정: 이전 문서의 warning_or_penalty/other 는 코드에 없음) |
| lat / lng | WGS84 원 double 값. finite·대한민국 서비스 범위 검증. 주소→좌표 재생성으로 원 좌표 덮지 않음 |
| point_key | 서버 위치 기준 version; 좌표 공개 정밀도와 key 묶음 알고리즘은 별개 |
| address / region codes | 제공된 위치 표시 주소·행정구역. 주소 없으면 역지오코딩 대기 상태 |
| agency_key / agency_name | 검증된 기관 코드 우선. 정규화 규칙 version |
| manager_key / manager_name | agency_key + name + 가능하면 안정 담당자 식별. 이름 단독 전역 병합 금지 |
| vehicle_raw | private 원번호(업로드 원문). 공개 전 `parsePlate` 로 정규화(지역 접두어 보존)·마스킹 |
| amount_confirmed_won / penalty_points | private 저장만(답변에 적힌 확정 금액·벌점). 공개 capability `fine_amount` 는 missing 유지 |
| count | fact=1; joint cube면 1 이상의 가중치 |

manager 동명이인이 같은 기관에도 존재할 수 있다. 별도 ID가 없으면 '기관·성명 기준 묶음'임을 표시하고 동일인으로 단정하지 않는다.
담당자 미상은 '담당자 정보 없음'으로 별도 유지하며 0건으로 버리지 않는다.

## B. 절대 금지 추론
`agency_counts={A:10,B:10}`과 `status_counts={수용:10,불수용:10}`만으로 A의 수용률을 구할 수 없다.
`manager_counts`도 동일하다. 비례 배분·동일 평균 가정·연간 값을 월별 1/12 분배 금지.
status/처분 구분이 combined뿐이면 warning_or_penalty를 유지하며 금액·범칙금 개별 건수를 상상하지 않는다.

## C. 중복 제거 단위
같은 기여자·같은 공식 계정(dataset_key)·같은 신고는 fact 하나(`(writer_epoch, source_revision)` 순서, 같은 event_id 는 멱등). 좌표 없는 fact 는 통계에 포함하고 지도 지점에서만 제외한다.
서로 다른 계정의 동일 신고인지 판정할 실제 키가 없으면 전역 완전 중복 제거를 주장하지 않는다.
복수 신고자가 같은 차량/위치에 신고한 건은 별도 신고일 수 있다. 좌표+차량+날짜만 같다는 이유로 임의 삭제 금지.
`dedupe_policy_version`과 `coverage_note`를 meta에 넣는다.

## D. 공개 DTO allowlist
계정 정보 없음. 기관명·담당자명은 공개한다. exact lat/lng·주소·집계수·분모·기준일·데이터시각은 공개한다.
차량 DTO는 `rank, masked_plate, report_count, percentage, rank_item_id`만 기본 허용.
rank_item_id는 응답 내부 항목 구분용이며 영속 식별자가 아니다. 차량별 상세좌표/날짜 추적 링크 금지.
공개 차트 데이터는 count와 eligible/missing denominator를 함께 제공한다. null과 0을 구분한다.

## E. capabilities
meta.capabilities: daily_report_dates, completion_dates, manager_status_cross,
agency_status_cross, vehicle_top5, fine_amount, processing_duration, region_boundaries.
각각 supported / missing / partial + reason + coverage.{eligible,total}로 표현한다.
지원하지 않는 패널은 설명된 준비 상태로 남긴다. 사용자가 요청한 패널 자체를 흔적 없이 삭제하지 않는다.

## F. fixture 원칙
합성 fixture는 sample=true를 강제하고 private raw facts는 tests/fixtures 또는 docs 외부 빌드입력에만 둔다.
prod output에는 fixtures/원번호를 복사하지 않는다. 1건·0분모·동명이인·마스크충돌·완료일결측·월 경계·연말·중복재전송 포함.
