# 데이터 계약 v2 · 공개 지도 읽기 모델
upstream 데이터가 이미 적재된다는 가정 아래 필요한 의미 계약이다. 실제 테이블/컬럼명은 adapter로 매핑한다.
원본 앱/서버를 이 작업에서 임의로 수정하지 않는다. 기존 v1 aggregate만 있으면 v2 지원으로 위장하지 않는다.

## A. 최소 private 분석 사실
개별 report fact 또는 아래 차원을 보존한 joint cube가 필요하다.
| 의미 | 타입/규칙 |
|---|---|
| fact_identity | private 중복 제거 키. 공개 금지. 계정 간 이전은 링크 ID와 private `report_number`가 모두 같고 처리상태 외 Observation이 같을 때만 |
| contributor_id / snapshot_id | private. community ingest 는 신고별 최신 fact(`snapshot_id='ingest-v1'`), 구 snapshot 경로는 공개 소스에서 제외(가드) |
| report_date | KST ISO date, null 허용하되 신고일 지표 제외 수 보고 |
| completed_date | 확인된 처리완료일 KST date, null은 결측. 업로드일로 대체 금지 |
| category | traffic / parking / other |
| status | accepted / partial / rejected / processing / supplement / withdrawn / transferred / completed_unknown / other |
| disposition | fine / penalty / warning / none / unknown (SQL·`server/aggregate.ts` 정본. 2026-09-26 문서 정정: 이전 문서의 warning_or_penalty/other 는 코드에 없음) |
| lat / lng | WGS84 원 double 값. finite·대한민국 서비스 범위 검증. 주소→좌표 재생성으로 원 좌표 덮지 않음 |
| point_key | 서버 위치 기준 version; 좌표 공개 정밀도와 key 묶음 알고리즘은 별개 |
| address / region codes | 제공된 위치 표시 주소·ingest 지역 키(`서울 중구`). 집계는 2026-07-01 법정 시도/시군구 코드로 다시 맞춘다(docs/region-boundaries.md). 주소 없으면 역지오코딩 대기 상태 |
| agency_key / agency_name | 검증된 기관 코드 우선. 정규화 규칙 version |
| manager_key / manager_name | agency_key + name + 가능하면 안정 담당자 식별. 이름 단독 전역 병합 금지 |
| vehicle_raw | private 원번호(업로드 원문). 공개 전 `parsePlate` 로 정규화(지역 접두어 보존)·마스킹 |
| report_number | private `STTEMNT_NO`/신고번호. 공개 API·DTO·로그에서 제외. NULL 레거시는 계정 간 이전 불가 |
| amount_kind / amount_confirmed_won / penalty_points | private 저장(답변에 적힌 금액·종류·벌점). 공개 RPC는 **사실의 동의 정책이 금액 공개를 허용할 때만**(`private.community_policy_disclosures.amounts_public`) 금액 값을 내보내고, 아니면 null + `amount_stated`(적혔는지 여부)만. 공개 DTO에는 집계(합계·평균·중앙값·건수)만. 벌점은 내보내지 않는다 |
| violation_law | 위반법규(법 이름·조항, 예: `도로교통법 제32조`) text 1..60자 또는 null. observation-v2(2026-09-28)의 payload 값을 그대로 저장(`private.community_report_facts.violation_law`, map `202609281100`). v1 payload(구 앱)는 null. 공개 RPC는 **사실의 동의 계보가 위반법규 공개를 허용할 때만**(`community_policy_disclosures.violation_law_public`) 값을 내보내고, 아니면 null(=법규 미상) |
| count | fact=1; joint cube면 1 이상의 가중치 |

manager 동명이인이 같은 기관에도 존재할 수 있다. 별도 ID가 없으면 '기관·성명 기준 묶음'임을 표시하고 동일인으로 단정하지 않는다.
현재 `manager_key`는 `hash(agency_key | NFC 이름)`(server/ingest/observation.ts)라서, 같은 `agency_key` 안의 같은 이름은 항상 한 identity다
(같은 기관의 실제 동명이인 두 사람은 upstream 담당자 ID가 없어 구분할 수 없다 — 데이터 한계, UI에서 나눌 수 없음). 반대로 같은 기관
**표시명**에 `agency_key`가 둘(registry 확인 `inst:`와 미확정 `src:`/`a1:` 이름 키 등)이면 같은 이름이 두 identity로 남는다. 이때는
병합하지 않고 화면·파일에서 번호(`서울마포경찰서 1번`/`2번`)로 구분하며 '같은 기관 이름 아래 따로 집계'라고 설명한다(`same_name.same_agency`).
담당자 미상은 '담당자 정보 없음'으로 별도 유지하며 0건으로 버리지 않는다.

## B. 절대 금지 추론
`agency_counts={A:10,B:10}`과 `status_counts={수용:10,불수용:10}`만으로 A의 수용률을 구할 수 없다.
`manager_counts`도 동일하다. 비례 배분·동일 평균 가정·연간 값을 월별 1/12 분배 금지.
status/처분 구분이 combined뿐이면 warning_or_penalty를 유지하며 금액·범칙금 개별 건수를 상상하지 않는다.

## C. 중복 제거 단위
같은 기여자·같은 공식 계정(dataset_key)·같은 신고는 fact 하나(`(writer_epoch, source_revision)` 순서, 같은 event_id 는 멱등). 좌표 없는 fact 는 통계에 포함하고 지도 지점에서만 제외한다.
서로 다른 계정은 링크 ID와 private 신고번호가 모두 같고 처리상태 외 Observation이 같은 경우에만 나중 업로드한 계정으로 fact를 이전한다. 레거시 NULL 번호·내용 불일치는 합치지 않고 새 공개 fact 생성을 거절한다. 기존에 이미 생긴 다중 소유 행은 자동 정리하지 않는다.
복수 신고자가 같은 차량/위치에 신고한 건은 별도 신고일 수 있다. 좌표+차량+날짜만 같다는 이유로 임의 삭제 금지.
`dedupe_policy_version`과 `coverage_note`를 meta에 넣는다.

## D. 공개 DTO allowlist
계정 정보 없음. 기관명·담당자명은 공개한다. exact lat/lng·주소·집계수·분모·기준일·데이터시각은 공개한다.
차량 DTO는 `rank, masked_plate, report_count, percentage, rank_item_id`만 기본 허용.
rank_item_id는 응답 내부 항목 구분용이며 영속 식별자가 아니다. 차량별 상세좌표/날짜 추적 링크 금지.
공개 차트 데이터는 count와 eligible/missing denominator를 함께 제공한다. null과 0을 구분한다.

금액 공개 정책(2026-09-27 사용자 승인): 동의문 2026-09-28.1이 ‘무엇이 공개되나요’에 과태료 금액 통계를 적었고,
map migration `202609280300`이 그 버전을 disclosures에 등록했다(auth `202609280200`이 현재 정책으로 지정).
2026-09-26.1은 금액을 ‘보내는 항목’으로만 적어 등록하지 않았다. 금액 공개 여부는 사실이 속한 동의 계보의 **현재 유효한 동의**가
정한다: 새 버전에 직접 동의하면 이전 버전으로 보낸 사실의 금액도 통계에 들어가고(동의문에 적음), 이전 동의만으로는 들어가지 않는다.
재동의를 자동으로 만들지 않는다. 한 조건에 1건뿐이면 통계가 곧 그 신고의 금액임을 동의문에 적었다.

위반법규 공개 정책(2026-09-28 사용자 결정): 동의문 2026-09-28.2가 ‘다른 이용자에게 어떤 정보가 보이나요?’에 위반법규를 적었고,
auth `202609281000`이 그 정책을 현재로 지정, map `202609281100`이 disclosures에 `('2026-09-28.2', amounts_public=true, violation_law_public=true)`를 등록했다.
2026-09-28.1 이하는 위반법규를 적지 않아 `violation_law_public=false`다. 공개 DTO에는 법규의 **조 단위 키**(`{법이름} 제{N}조[의{M}]`, 항 제외 — 필터 값·표의 행 이름)와 법규별 집계만 나간다.
항까지 붙은 저장 원문은 private에 그대로 두고 공개 응답에는 내보내지 않는다(docs/metrics-catalog.md §위반법규별 현황).
처리내용 원문은 앱이 보내지 않는다(contracts/community-ingest/observation.md). ingest는 C0 제어문자·DEL이 든 법규를 422로 거절한다(clean()이 남기지 않는 문자, 공개 필터 값 보호).

## E. capabilities
meta.capabilities: daily_report_dates, completion_dates, manager_status_cross,
agency_status_cross, vehicle_top5, fine_amount, processing_duration, region_boundaries, violation_law(2026-09-28, coverage = 법규 있는 답변/C).
각각 supported / missing / partial + reason + coverage.{eligible,total}로 표현한다.
2026-09-27부터 processing_duration(coverage = 계산된 건수/답변 cohort), fine_amount(coverage = 금액 확인/F), region_boundaries는
집계 상태(ready)를 따른다. 실제로 계산한 결과가 있는 경로에서만 supported다.
지원하지 않는 패널은 설명된 준비 상태로 남긴다. 사용자가 요청한 패널 자체를 흔적 없이 삭제하지 않는다.

## F. fixture 원칙
합성 fixture는 sample=true를 강제하고 private raw facts는 tests/fixtures 또는 docs 외부 빌드입력에만 둔다.
prod output에는 fixtures/원번호를 복사하지 않는다. 1건·0분모·동명이인·마스크충돌·완료일결측·월 경계·연말·중복재전송 포함.


숫자 별점 공개 정책(2026-09-28 사용자 결정): 동의문 2026-09-28.3에 처리 만족도 숫자 별점과 평균·건수를 명시했다. AUTH `202609281700`이 현행 정책을 .3으로 전환하고 MAP `202609281800`이 private fact의 정수 1..5 열과 `rating_public` disclosure를 추가한다. .1/.2만 현재 동의인 계보의 공개 projection에서는 별점이 null이다. .3에 재동의한 계보는 과거 공유 사실의 별점도 공개할 수 있다. 별점사유는 전송하지 않는다.

## 2026-10-06 · 단일 날짜 cohort 실행 최적화

`202610060100_cohort_facts_setwise`는 `internal_analytics_cohort_facts`의 구현만 변경한다.
`single-date-v1`, D13(전체 유효 이력에서 대표 선출 후 대표 날짜로 포함 여부 판정), R2 번호 보완,
공동 기여 행과 순서·필드·null·공개 동의 의미는 그대로다. 후보 조건은 날짜·분류·기관·담당자·bbox이며,
**지역 코드는 기존처럼 대표 선출 뒤 적용한다**. 100,000행 예산은 후보 키의 전체 유효 이력을 센다.
예산 초과 시 대표 선출/JSON 집계를 수행하지 않고 `RESULT_TOO_LARGE`로 전체 요청을 거부한다.
유효 동의는 같은 lineage와 user, 공개 항목은 기존 lineage-only 판정으로 각각 보존한다.
개인 통계는 같은 함수에 위임하므로 동일한 개선을 받으며 인증·메타데이터 계약은 바뀌지 않는다.
[동등성·실행계획·로컬 성능](implementation/cohort-facts-timeout/REPORT.md).
