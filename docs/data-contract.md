# 데이터 계약 v2 · 공개 지도 읽기 모델
upstream 데이터가 이미 적재된다는 가정 아래 필요한 의미 계약이다. 실제 테이블/컬럼명은 adapter로 매핑한다.
원본 앱/서버를 이 작업에서 임의로 수정하지 않는다. 기존 v1 aggregate만 있으면 v2 지원으로 위장하지 않는다.

## A. 최소 private 분석 사실
개별 report fact 또는 아래 차원을 보존한 joint cube가 필요하다.
| 의미 | 타입/규칙 |
|---|---|
| fact_identity | private 중복 제거 키. 공개 금지. 기여자별 행 보존. 계정 간 fact 소유 이전 없음(202609281300) |
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
| report_number | private `STTEMNT_NO`/신고번호. 공개 API·DTO·로그에서 제외. NULL은 같은 source_report_key의 최초 알려진 번호로 identity 보완, 없으면 legacy |
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
202609281300_account_contributions.sql부터 기여자별 행을 보존하며 다른 계정으로 fact를 이전하지 않는다. 같은 신고의 다른 계정 관측도 정상 수신하고 개인 집계는 계정별 identity당 1건, 공개 집계는 identity당 대표 1건이다. identity는 `source_report_key | coalesce(report_number, key의 최초 알려진 번호, 'legacy')`이며 서로 다른 유효 번호는 분리한다.
공개 대표는 전체 적격 이력에서 `answer_time DESC → completed_date DESC NULLS LAST → first_accepted_at ASC → contributor_id ASC`로 선출한다(202610060200_query_read_paths.sql). `answer_time`은 같은 identity·payload_sha256 관측의 answer_accepted_at 최댓값이다. 이번 추가 migration 202610061000은 완전 동률의 마지막 규칙으로 `dataset_key ASC`를 추가한다. 최초 알려진 번호 선택도 first_accepted_at·contributor_id·dataset_key 순서다. 날짜·차원 필터 전에 대표를 정하며 철회·삭제는 해당 계정만 처리하고 남은 적격 기여에서 다시 선출한다.
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

## 2026-10-06 전체 쿼리 감사

`202610060200`~`060500`은 공개/개인 DTO, 배열 순서, 동의 lineage·공개 정책, 날짜 기준과 행 예산을 유지한다. legacy v2의 날짜 합집합/기간 내 선거를 cohort D13 규칙으로 바꾸지 않는다. manifest generation은 completed 관측이 키 집합에 들어오거나 나갈 때의 기존 증가량 그대로이며 bulk INSERT/DELETE에서도 행 수만큼 증가한다. UPDATE의 키 이동은 기존 행 판정을 유지한다. 기관 보정은 같은 CAS 조건·applied/skipped 수를 반환하고 projection version은 계속 불투명한 무효화 토큰이다. 상세 동등성·잔여 비용은 [감사 문서](implementation/query-audit-20261006/CHANGELOG.md) 참조.


## 2026-10-06 · 연속 업로드와 화면 스냅샷 (`screen-v1`)

새 지도 웹은 `GET my-analytics/screen`으로 대시보드와 현재 표·주소 상세·지도 확대·개인 비교를 묶어 받는다. `internal_analytics_read_snapshot`의 단일 STABLE SQL 호출에서 state·적격 facts·viewer를 같은 statement MVCC snapshot으로 읽는다. 업로드 완료를 기다리거나 쓰기를 막지 않는다. Edge는 그 불변 source만으로 각 기존 집계 함수를 호출한다. `meta.dataset_version`, `dashboard.dataset_version`, 성공한 모든 panel의 버전과 scope가 일치해야만 웹에서 수용한다. 원시 facts는 Edge 안에만 있고 브라우저/저장소/공유 캐시에 보내지 않는다. 내 신고는 인증된 사용자에서만 계산하며 이 개인 묶음은 public-analytics 응답과 분리한다.

쿼리는 기존 scope + `panels` JSON 배열(최대 8개/8,000자)이다. 항목은 `{id,path,params}`이며 허용 path는 `entities`, `laws`, `places`, `places/pl1:…`, `compare`, `entity-prefix`다. 마지막 항목은 기관/담당자 확장 목록의 1~N 페이지를 한 번에 계산한다(한 페이지 100개, 원천 100,000행 한도 유지). 나머지 패널의 필드·정렬·분모·페이지 결과는 기존 경로와 같다. 응답은 `{schema_version:'screen-v1',meta,dashboard,panels:[{id,status,body}]}`다. 묶음의 `expected_version`은 과거 화면의 힌트이며 불일치를 거절하지 않는다. 사라진 주소는 해당 panel 404와 새 대시보드를 함께 반환하므로 선택을 자동 해제한다.

화면의 표 검색/정렬/페이지/비교 변경은 새 묶음 하나로 전체를 교체한다. 같은 렌더의 요청은 합치고 수신한 패널은 **그 화면 버전에 한해** 메모리에서 재사용한다. 계정 변경은 전부 폐기하며 늦은 응답은 generation으로 버린다. 버전은 opaque 값이라 문자열 크기로 최신을 판단하지 않는다. 새 자료 때문에 화면 맞추기 요청을 반복하는 방식이 아니므로 연속 ingest 자체가 재시도/409를 만들지 않는다. 네트워크·권한·rate·원천 행 예산 등의 기존 오류는 숨기지 않는다.

공개 단일 집계도 새 SQL snapshot으로 state와 facts/rollup을 함께 읽는다. 맞춤 통계는 한 응답의 전체/내 신고·표·차트·합계를 사용하며 `consistency=latest`이면 반환 버전을 채택한다. 통계 편집기의 후보 검색은 미적용 draft의 선택 도움이며 이미 만든 결과 숫자에 합치지 않는다. 랭킹 역시 단일 STABLE SQL로 전체 페이지+내 순위를 읽고 `consistency=latest`에서는 전체 페이지를 최신 자료로 교체한다(페이지끼리 이어붙이지 않음). 새 화면 프로토콜을 모르는 기존 요청의 명시적 `expected_version` fence는 하위호환으로 유지한다. 그 구형 독립 요청을 화면처럼 혼합해서는 안 되며 SQL → Edge → Pages 순서로 함께 갱신한다.

DB에 화면 사본/새 테이블/인덱스를 만들지 않고 철회/삭제 이후 새 요청은 최신 적격 자료만 읽는다. 같은 이유로 장기 pin/TTL 스냅샷은 사용하지 않는다. 단일 응답이 시작할 때 이미 유효했던 스냅샷의 진행 중 읽기까지 소급 취소하지는 않는다. 서비스 권한·JWT/카카오/활성동의/10건 gate·no-store·기존 timeout을 유지한다.

화면 전환 중 남아 있는 이전 범위의 패널 intent는 진행 중인 화면 요청을 기다린다. A→B→A 취소는 마지막 완전한 A DTO 묶음을 복구한 뒤 필요한 패널을 새 묶음으로 읽으며, B가 성공하면 이전 A intent를 취소한다. 계정 reset은 복구용 DTO도 지운다. 활성 화면의 패널은 이 경합에서 legacy 개별 fence 요청으로 돌아가지 않는다.

2026-10-06 화면 timeout 부분 보완: 클라이언트의 각 공개 통계/screen read는 auth 준비·refresh·응답 body를 포함해 20초로 제한한다.
상한을 넘으면 `REQUEST_TIMEOUT`을 표시하고 자동 재시도하지 않으며, 이미 표시한 정상 화면은 유지하고 수동 재시도를 제공한다.
일반 API 실패는 메시지에 오류 코드·HTTP 상태를 남긴다. scope 전환/로그아웃 취소는 timeout으로 바꾸지 않는다.
이는 DB/Edge의 실행 제한이나 단일 snapshot 계약을 변경하지 않으며 서버 SQL 취소·성능 개선을 보장하지 않는다.
운영 jsonb 생성·재포장 병목은 총괄의 실측으로 확정됐으며, 수정 후 운영 전체 응답시간은 배포 후 총괄이 검증한다([보고서](implementation/screen-snapshot-timeout-20261006/REPORT.md)).


2026-10-06 화면 내부 전송 v1 (`202610060700`): `my-analytics/screen`만
`p_options.fact_encoding=columns-v1`을 요청한다. 단일 STABLE RPC는 동일한 34개 private fact 필드를
`{encoding, columns, rows}`로 손실 없이 전달하고 Edge가 검증된 열 순서로 원 객체를 복원한다.
이 형식은 public DTO가 아니며 브라우저·공유·정적 파일에 노출하지 않는다. 대표 선출·이전기간·개인 비교·공개
동의·10만 행 예산은 그대로다. `p_kind` rollup 경로와 옵션 없는 기존 RPC 호출은 기존 형식을 유지한다.
새 Edge는 구 SQL의 객체 배열도 읽으며, 알 수 없는 encoding/열 순서/행 길이는 503으로 거부한다.
`private.analytics_cohort_payload`는 전송 형식만 분기하는 공통 구현이고 화면 snapshot 경계나 데이터 캐시를 추가하지 않는다.
로컬 실측은 [보고서](implementation/screen-snapshot-timeout-20261006/REPORT.md)에 있다.
r3에서 대형 payload의 집계·포장·반환을 PostgreSQL `json`으로 바꾼다. `internal_analytics_cohort_facts`,
`internal_analytics_read_snapshot`, `internal_my_analytics_cohort_source`는 인자를 유지하며 jsonb→json 반환형만 변경한다.
small state/viewer/options는 jsonb로 남지만 facts를 jsonb로 캐스트하거나 재포장하지 않는다.
개인 래퍼의 CASE 빈 배열도 json으로 맞춘다. SQL→Edge는 기존과 같은 JSON 값이고 브라우저 공개 DTO는 불변이다.
객체 키 순서·공백·숫자 인쇄 형식은 의미 계약이 아니며, 고정 키는 중복되지 않는다. 배열 순서·중복 행·null·boolean·정수·원 좌표는
보존하며 실제 native JSON 파싱, SQL 값 비교, 공개 전체 화면 deep equality로 검증한다.
반환형 변경은 동일 transaction의 DROP/CREATE(무CASCADE), postgres 소유권·service_role 전용 ACL 복원과 PostgREST schema reload를 요구한다.
[전수 호출자 목록](implementation/screen-snapshot-timeout-20261006/CALLERS.md)을 따른다.
운영 aarch64의 jsonb 구성 병목은 확정됐지만 수정 후보의 운영 성능은 아직 미측정이다. **운영 재측정은 배포 후 총괄이 수행**한다.
8초 설정과 20초 클라이언트 deadline은 유지한다. 함수 안의 statement_timeout 변경을 현재 SQL statement의 강제 취소 보장으로
해석하지 않는다. 실제 외부 RPC 제한과 end-to-end 여유는 운영 검증 항목이다.

## 2026-10-06 · 화면 서버 집계 (`202610060900`)

`my-analytics/screen`은 같은 `internal_analytics_read_snapshot`에
`p_options.screen_encoding=screen-aggregate-v1`과 panel intent를 전달한다. 옵션이 있을 때만
state·viewer·집계 source를 하나의 STABLE statement snapshot에서 반환한다. 원시 fact JSON 생성·PostgREST
전송·Edge columns decode를 제거한다. SQL이 대표 선출/개인 사본 제거/기간·차원 필터를 한 번 수행하고,
현재·이전기간·월·기관·담당자·법규·지역·주소·히트맵·개인 측의 실제 교차집계, distinct 참가자·장소·차량 신고일,
중앙값·nearest-rank p90·금액 공개 분류·별점 분포를 계산한다. 양 축의 membership과 `single-date-v1`은 유지한다.

집계 source에는 원번호·report identity·계정 UUID가 없다. 차량은 전체 canonical 후보에서 TOP5를 정한 뒤 SQL에서
마스킹한다(마스킹 충돌은 합치지 않음). 주소는 기존 `address-v1` 정규화·UTF-16 FNV 규칙과 원 좌표 대표 선정을 따른다.
SQL 내부 분위수 배열은 DB 밖으로 반환하지 않는다. Edge는 기존 한국어 정렬·동명이인·월별 coverage·지도 노드 압축·페이지와
공개 DTO를 조립한다. 개인 집계의 user는 인증된 viewer에서만 받고 별도의 비교 source 읽기를 하지 않는다.

브라우저의 `screen-v1`, 성공 패널의 scope/version, 게이트·rate limit·no-store·100,000행 budget은 불변이다.
장기 캐시나 새로운 무효화 규칙은 없다. 구 Edge는 기존 facts 형식을 받고, 신 Edge+구 SQL은 한 번 받은 legacy source로
집계한다. 알 수 없는 aggregate encoding은 503이다. 독립 public-analytics·personal·rankings·앱 RPC 계약은 바꾸지 않는다.

전송량은 원시 행×34개 필드에서 집계 그룹 수로 바뀐다. 고유 주소/기관/담당자 등 차원의 수가 늘면 내부 집계 source도 커지며
항상 상수 크기라고 보장하지 않는다. 지도 압축과 정렬은 Edge에 남아 있다. 운영 end-to-end 수 초 목표는
[로컬 보고서](implementation/screen-server-aggregate-20261006/REPORT.md)와 구분하여 **배포 후 총괄 측정**으로 판정한다.

## 2026-10-06 · 화면 집계 v2 최적화 (`202610061000`)

이번 후보의 `my-analytics/screen`은 `screen-aggregate-v2`를 요청한다. 기존 v1과 facts fallback은 유지한다.
히트맵은 전체 후보의 실제 건수로 SQL에서 40행·16법규를 선택하고 해당 셀만 반환한다. 전체 행/법규 수와
선택된 행/법규의 전체 건수는 별도 보존하며 잘린 셀을 전체 분모로 사용하지 않는다. 히트맵의 결과·정렬·셀 순서는
기존 DTO와 동일하다. 장소·히트맵의 집계는 사용하지 않는 분위수/금액/별점 분포를 계산하지 않고, 히스토그램·별점
분포는 summary에만 생성한다. 주소별 full contribution은 요약·요청 상세·개인 지점의 shared 계산에 필요한 것만 반환한다.

기관/담당자/법규 전체 목록은 기존 검색·정렬·페이지·동명이인·비교 의미를 유지하도록 집계 source에 남긴다.
지도는 원 좌표 대표와 전체 장소의 작은 건수 통계를 보내 기존 Node 압축 및 view_bbox 의미를 유지한다.
무제한 sufficient statistics를 그대로 보내는 v1에서 부분적으로 줄인 방식이며, 모든 화면 요소의 SQL 페이지화를
완료했다고 주장하지 않는다. Edge의 장소·통계·기여 lookup은 요청 단위 Map으로 바꾸며 저장 캐시가 아니다.

성능·검사·배포 호환성은 [최적화 보고서](implementation/screen-aggregate-opt-20261006/REPORT.md)를 따른다.
