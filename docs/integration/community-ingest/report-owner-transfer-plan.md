# 2026-09-28 신고번호 및 계정별 기여 결정·검증 계획
<!-- 2026-09-28 개정2: 소유 이전 모델을 계정별 기여 + 전역 중복 제거로 대체(사용자 규칙). 아래 "개정 전" 문단과
     완전-동일-이전 규칙(4·5·7항)은 효력을 잃었다. 1~3·6항(번호 수집·답변 완료만·NULL 백필)은 유지. -->

## 확정 계획 (2026-09-28 개정2)

1. PC 제목 `신고번호`, 모바일 `Report.reportNumber`를 별도 private event `report_number`로 전송한다. `source_report_id`(링크 ID)는 기존 그대로다. Observation JSON과 `payload_sha256`은 바꾸지 않는다. 서버 형식 검사 후 private events/facts에 저장한다. 공개 RPC/DTO는 번호 열을 선택하지 않는다.
2. 앱은 답변 완료(eligible: accepted/partial/rejected/completed_unknown) 관측만 이벤트로 만든다. 적격이 아닌 관측(처리중·보완요청·취하·이송·other)은 이벤트 없음 — `status_correction` 발급 없음, 로컬 `detail_status` 기록만. 로컬 prev 합성에 `server_completed` 를 쓰지 않는다(표 자체는 manifest 신선도 증명용으로 유지).
   로컬 outbox 잔여 미전송 `status_correction` 행은 보내지 않고 `blocked:deprecated_status_correction` 으로 보존한다(PC·모바일 동일).
3. 서버(TS 핸들러 + SQL ingest 함수 양쪽)는 payload 가 적격이 아니거나 event_type 이 `status_correction` 인 이벤트를
   이벤트 단위로 재시도 불가 `rejected:non_final_not_accepted`(durable=false)로 거절한다. 구버전 앱 배치의 나머지 이벤트는 정상 처리한다.
   `status_correction` 이름은 구버전 인식용으로만 유지한다. 답변 완료로 올라간 신고가 나중에 비종결 상태로 돌아가면(드묾) 중앙은 마지막 답변 상태를 유지한다.
4. ~~새 migration에서 기존 연결 잠금 뒤, fact 접근 전 신고 키 advisory transaction lock을 건다. 동일 링크 ID의 다른 계정 fact가 있으면 신고번호 두 개가 같고, Observation payload 가 **완전히 같을 때만**(상태 포함, `status_only` 예외 없음) 이전한다. 이전은 한 트랜잭션에서 A fact 삭제·B fact 삽입·private 감사 기록(`reason='identical'` 만 허용)으로 수행한다. A 톰스톤은 만들지 않는다. 기존 manifest 트리거가 A 축소와 B 추가를 기록한다. 같은 계정 갱신 규칙은 그대로다.~~
   → **계정별 기여(개정2)로 대체**: 타 계정 업로드는 업로더의 fact만 만들거나 갱신하고 `accepted`로 수신한다. A fact 삭제·이전·감사 기록 없음.
   advisory lock은 동시 기여의 결정적 처리를 위해 유지한다. 같은 계정 갱신 규칙은 그대로다.
5. ~~조건 불일치면 비재시도 `rejected` ACK(`report_identity_mismatch`, `cross_account_mismatch`, 다수 기존 소유자는 `ambiguous_existing_owners`)로 차단한다. PC·모바일 outbox는 blocked로 보존하고 이유를 표시한다. `transferred`는 receipt가 있는 성공 ACK다.~~
   → **폐기(개정2)**: payload·신고번호가 달라도 타 계정 기여로 정상 수신한다. 코드 이름은 구버전 앱 호환용으로만 문서에 남긴다.
6. 과거 fact의 신고번호는 NULL로 남긴다. 기존 소유자가 다시 상세를 수집해 번호를 백필하기 전에는 다른 계정으로 자동 이전하지 않는다. 로컬 최신 journal의 번호가 NULL이고 새 번호가 생기면 해시가 같아도 새 이벤트를 발급한다. 로컬에 상세 재수집이 없는 행은 자동 백필되지 않는다.
7. 참여 계정의 동일인 추정·병합은 하지 않는다. contributor_count는 현재 공개 fact를 가진 서로 다른 계정의 수다. ~~이전 전후 두 fact가 모두 공개 가능한 상태라면 총 신고 건수는 1로 유지되고 기여자는 A에서 B로 바뀐다.~~
   → **개정2**: 공개 통계는 identity당 대표행 1건으로 집계하고(`contribution-dedupe-v1`), 개인 범위는 각자의 기여를 센다(A=1, B=1, 전체=1).
8. 공개 projection(`internal_analytics_v2_facts`)은 identity당 공개 목록 중 `first_accepted_at`이 가장 이른 행을 대표(`is_representative`)로 선출하고 기여 수(`contribution_count`)를 싣는다. 실제 결과가 계정마다 다르면 각 관측을 보존하고 대표는 최초 기여로 유지한다. 한 계정의 삭제/철회는 그 계정만 처리하고 대표는 유효 기여로 승계된다.

## 개정 전 계획 (효력 없음 — 2026-09-28 결정으로 대체됨)

> 이하 문단은 개정 전 기록으로 남긴다. `status_correction` 발급, `server_completed` prev 합성, 처리상태 동반 변경 예외(`status_only`)는
> 더는 유효하지 않다.

1. ~~PC 제목 `신고번호`, 모바일 `Report.reportNumber`를 별도 private event `report_number`로 전송한다.~~ (유지 — 위 1항)
2. ~~새 migration에서 기존 연결 잠금 뒤, fact 접근 전 신고 키 advisory transaction lock을 건다. 동일 링크 ID의 다른 계정 fact가 있으면 신고번호 두 개가 같고, Observation에서 `status_raw`와 `status`를 뺀 값이 동일할 때만 이전한다.~~ → 완전 동일만 이전(위 4항).
3. ~~조건 불일치면 비재시도 `rejected` ACK(`report_identity_mismatch`, `cross_account_mismatch`, 다수 기존 소유자는 `ambiguous_existing_owners`)로 차단한다.~~ (유지 — 위 5항)
4. ~~과거 fact의 신고번호는 NULL로 남긴다.~~ (유지 — 위 6항)
5. ~~참여 계정의 동일인 추정·병합은 하지 않는다.~~ (유지 — 위 7항)

## 신고번호 형식 근거

- `pc/CHANGELOG.md` 2139행은 실제 형식 변경 `SPP-2603-1434237`을 기록하고 뒷자리 6~8자리 패턴을 사용한다.
- `pc/contracts/parser-vectors.json`은 `SPP-2609-8000001` 등 4자리 중간 구간·7자리 끝 구간을 사용한다.
- `mobile/lib/screens/crawl_screen.dart`의 입력 예시는 `SPP-231120-1234567`, `SPP-231121-7654321`로 6자리 중간 구간을 사용한다.
- 이 worktree에는 요청서가 언급한 `pc/testresults` 디렉터리가 없다. 운영 원본 자료에는 접근하지 않았다.
- 따라서 중앙 검사식은 `^SPP-[0-9]{4,6}-[0-9]{6,8}$`이다. 현재 확인되지 않은 중간 5자리와 끝 6·8자리도 역사적 패턴보다 좁히지 않으려고 허용한다. 새로운 공식 형식이 발견되면 근거를 추가해 migration과 계약을 확장한다. 값이 없으면 NULL이다.

## 처리상태 동반 변경 조사 (개정 전 기록 — `status_only` 예외는 2026-09-28 결정으로 폐지됨)

| 필드 | 코드/fixture 근거 | 개정 전 이전 예외 | 개정 후 |
|---|---|---|---|
| `status_raw`, `status` | `observation.md` 상태 표: 원문 상태와 파생 상태가 함께 바뀜 | 허용했음 | 불허 — 하나라도 다르면 `cross_account_mismatch` 거절 |
| `completed_date` | PC `community_capture.py`, 모바일 `observation_rules.dart`: eligible일 때만 답변일 사용. 처리중→완료면 NULL→날짜 | 불허 | 불허 |
| `disposition`, `amount` | PC `community_capture.py`: 불수용이면 `none`; 범칙금/과태료 답변이면 처분·금액 변함. `observations.json`의 accepted/partial/rejected 사례도 서로 다름 | 불허 | 불허 |
| `manager_name`, `agency_name` | 상세 파서가 각각 별도 필드에서 가져오며 상태 변화와 동시 변동하는 실제 paired 기록은 이 worktree에 없음 | 불허 | 불허 |
| `address`, `location`, `vehicle_raw`, `report_date`, `category` | 서로 다른 공식/파생 입력. 처리상태 변화에 따른 동일성 근거 없음 | 불허 | 불허 |

개정 후에는 처리상태를 포함한 어떤 필드 차이도 자동 이전에 실패한다. 사용자 승인 전 예외를 넓히지 않는다.

## 해시·호환·배포 순서

신고번호를 Observation에 넣지 않아 기존 모든 신고의 `payload_sha256` 일괄 변동과 대량 update 이벤트가 없다. `observation-v1`, parser 버전, `community-ingest-v1` 명칭을 유지한다. 새 클라이언트는 `report_number`를 전송하고 구 클라이언트의 필드 생략은 NULL로 받아 기존 업로드를 유지한다. 레거시 NULL은 같은 계정이 상세를 재수집해 번호를 확보했을 때만 백필한다. 배포 시에는 새 migration과 Edge 함수를 먼저 배포하고 그 뒤 PC·모바일을 배포해야 한다. 여기서는 운영 적용을 하지 않는다.

## 검증 범위

단위: 번호 형식/해시 독립/캡처 백필(적격만)/성공·비재시도 ACK(`non_final_not_accepted` 포함, 이전 모델 거절 코드 제외)/공개 비노출/대표 선출·개인 collapse.
로컬 실스택: A→A이름변경→B이름변경→B재전송 집계표(1/0/1→1/0/1→1/1/1→1/1/1), 결과 상이 기여 수용과 대표 유지, 번호 무관 수신, 비적격·구버전 correction 거절(배치 나머지 정상 처리), 레거시 supplement 혼합 배치, 동시 A/B, 삭제 시 대표 승계, manifest·공개 수·기여자, 철회. 실제 운영 계정·DB 검증은 이 작업 범위 밖이다.
