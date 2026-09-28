# 2026-09-28 신고번호 및 소유 이전 결정·검증 계획

## 확정 계획

1. PC 제목 `신고번호`, 모바일 `Report.reportNumber`를 별도 private event `report_number`로 전송한다. `source_report_id`(링크 ID)는 기존 그대로다. Observation JSON과 `payload_sha256`은 바꾸지 않는다. 서버 형식 검사 후 private events/facts에 저장한다. 공개 RPC/DTO는 번호 열을 선택하지 않는다.
2. 새 migration에서 기존 연결 잠금 뒤, fact 접근 전 신고 키 advisory transaction lock을 건다. 동일 링크 ID의 다른 계정 fact가 있으면 신고번호 두 개가 같고, Observation에서 `status_raw`와 `status`를 뺀 값이 동일할 때만 이전한다. 이전은 한 트랜잭션에서 A fact 삭제·B fact 삽입·private 감사 기록으로 수행한다. A 톰스톤은 만들지 않는다. 기존 manifest 트리거가 A 축소와 B 추가를 기록한다. 같은 계정 갱신 규칙은 그대로다.
3. 조건 불일치면 비재시도 `rejected` ACK(`report_identity_mismatch`, `cross_account_mismatch`, 다수 기존 소유자는 `ambiguous_existing_owners`)로 차단한다. PC·모바일 outbox는 blocked로 보존하고 이유를 표시한다. `transferred`는 receipt가 있는 성공 ACK다.
4. 과거 fact의 신고번호는 NULL로 남긴다. 기존 소유자가 다시 상세를 수집해 번호를 백필하기 전에는 다른 계정으로 자동 이전하지 않는다. 로컬 최신 journal의 번호가 NULL이고 새 번호가 생기면 해시가 같아도 새 이벤트를 발급한다. 로컬에 상세 재수집이 없는 행은 자동 백필되지 않는다.
5. 참여 계정의 동일인 추정·병합은 하지 않는다. contributor_count는 현재 공개 fact를 가진 서로 다른 계정의 수다. 이전 전후 두 fact가 모두 공개 가능한 상태라면 총 신고 건수는 1로 유지되고 기여자는 A에서 B로 바뀐다. 상태 변경으로 공개 적격이 달라지면 그 상태 의미에 따라 공개 건수도 달라진다.

## 신고번호 형식 근거

- `pc/CHANGELOG.md` 2139행은 실제 형식 변경 `SPP-2603-1434237`을 기록하고 뒷자리 6~8자리 패턴을 사용한다.
- `pc/contracts/parser-vectors.json`은 `SPP-2609-8000001` 등 4자리 중간 구간·7자리 끝 구간을 사용한다.
- `mobile/lib/screens/crawl_screen.dart`의 입력 예시는 `SPP-231120-1234567`, `SPP-231121-7654321`로 6자리 중간 구간을 사용한다.
- 이 worktree에는 요청서가 언급한 `pc/testresults` 디렉터리가 없다. 운영 원본 자료에는 접근하지 않았다.
- 따라서 중앙 검사식은 `^SPP-[0-9]{4,6}-[0-9]{6,8}$`이다. 현재 확인되지 않은 중간 5자리와 끝 6·8자리도 역사적 패턴보다 좁히지 않으려고 허용한다. 새로운 공식 형식이 발견되면 근거를 추가해 migration과 계약을 확장한다. 값이 없으면 NULL이다.

## 처리상태 동반 변경 조사

| 필드 | 코드/fixture 근거 | 현재 이전 예외 |
|---|---|---|
| `status_raw`, `status` | `observation.md` 상태 표: 원문 상태와 파생 상태가 함께 바뀜 | 허용 |
| `completed_date` | PC `community_capture.py`, 모바일 `observation_rules.dart`: eligible일 때만 답변일 사용. 처리중→완료면 NULL→날짜 | 불허 |
| `disposition`, `amount` | PC `community_capture.py`: 불수용이면 `none`; 범칙금/과태료 답변이면 처분·금액 변함. `observations.json`의 accepted/partial/rejected 사례도 서로 다름 | 불허 |
| `manager_name`, `agency_name` | 상세 파서가 각각 별도 필드에서 가져오며 상태 변화와 동시 변동하는 실제 paired 기록은 이 worktree에 없음 | 불허 |
| `address`, `location`, `vehicle_raw`, `report_date`, `category` | 서로 다른 공식/파생 입력. 처리상태 변화에 따른 동일성 근거 없음 | 불허 |

`completed_date`/처분/금액 때문에 처리중→답변완료 같은 전환은 현재 자동 이전에 실패할 수 있다. 사용자 승인 전 예외를 넓히지 않는다. 로컬 fixture는 실데이터의 동반 변경 빈도를 입증하지 않는다.

## 해시·호환·배포 순서

신고번호를 Observation에 넣지 않아 기존 모든 신고의 `payload_sha256` 일괄 변동과 대량 update 이벤트가 없다. `observation-v1`, parser 버전, `community-ingest-v1` 명칭을 유지한다. 새 클라이언트는 `report_number`를 전송하고 구 클라이언트의 필드 생략은 NULL로 받아 기존 업로드를 유지한다. 레거시 NULL은 같은 계정이 상세를 재수집해 번호를 확보했을 때만 백필한다. 배포 시에는 새 migration과 Edge 함수를 먼저 배포하고 그 뒤 PC·모바일을 배포해야 한다. 여기서는 운영 적용을 하지 않는다.

## 검증 범위

단위: 번호 형식/해시 독립/캡처 백필/성공·비재시도 ACK/공개 비노출. 로컬 실스택: 동일·처리상태만 다른 이전, 필드·번호 불일치, 레거시 NULL, 동시 A/B, manifest 축소, 공개 수·기여자, 삭제/철회. 실제 운영 계정·DB 검증은 이 작업 범위 밖이다.
