# GPT-6-Sol 7차 독립 계획 재확인 — 최종 판정

## 0. 검토 범위와 증거

6차 보고서 `plan-review-sol-06.md`의 N-05~N-08을 `plan-resolution.md:99-107`, `plan-final.md:200-202`, 계약 및 `sql-drafts/` 원문과 대조했다. 아래 I는 `sql-drafts/202609260200_community_ingest.sql`, A는 `sql-drafts/202609260100_community_account_registry.sql`, R은 `sql-drafts/regression_poc.mjs`이다. `SHA256SUMS`의 SQL 2개와 스크립트 1개는 `sha256sum -c`에서 모두 **OK**, 스크립트는 `node --check`에서 통과했다. 격리 스택의 **14 checks exit 0은 처리표의 실행 기록**이다. 이번 검토에서는 Docker·HTTP·앱을 실행하지 않았고, 다른 worktree·제품 파일·git·네트워크를 건드리지 않았다.

## 1. 최종 판정

**구현 착수 가능.** N-05·N-06의 high 두 건은 계약과 SQL에서 해소되었고, N-07·N-08의 요구한 수정도 들어갔다. 이 정적 검토에서 **critical/high 미해소는 0건**이다. §3의 medium 두 건은 구현 중 처리하고, §4의 통합 게이트를 통과하기 전에는 구현 완료나 배포 준비 완료로 판정하면 안 된다.

## 2. 6차 지적별 판정

| ID | 판정 | 근거와 판단 |
|---|---|---|
| **N-05 high** | **해소** | 계약이 `manifest_token`을 `^[0-9]+$`, 빈 dataset은 `"0"`으로 고정한다(`contracts/community-ingest/account-api.md:44-46`). SQL은 `generation::text`, 행이 없으면 `'0'`을 반환한다(`I:390-403`). 토큰이 전 페이지에서 같아야 교체한다는 클라이언트 규칙도 명시됐다(`account-api.md:46`). 실제 Edge 응답 파싱은 구현 게이트다. |
| **N-06 high** | **해소(SQL), 경쟁 회귀 보강 필요** | 삭제가 contributor·grant·connection 잠금 뒤 `clock_timestamp()`를 얻고, 충돌 시 `greatest(기존, 새 값)`을 저장하며 저장된 시각을 반환한다(`I:422-444`). ingest는 연결 잠금 뒤 tombstone/fence를 검사한다(`I:226-255`). 시간 역행 반례는 SQL상 차단된다. R의 경쟁 시나리오는 실행됐더라도 첫 삭제 자식 프로세스의 실패를 감지하지 못한다(§3.2). |
| **N-07 medium** | **해소(완료 키 세대), 운영 DML 조건 있음** | fact `AFTER INSERT/UPDATE/DELETE` 트리거가 완료 키 집합의 삽입·삭제·상태/키 이동 때 세대를 같은 트랜잭션에서 올린다(`I:91-110,140-157`). RPC의 명시 세대 증가가 제거되어 fact→generation→analytics 순서가 된다(`I:293-365,436-442`). 직접 DML 전후 세대 assertion도 있다(`R:56-60`). 직접 DML의 공개 집계 버전 갱신은 별개 결함이다(§3.1). |
| **N-08 medium** | **해소(지적한 거짓 통과)** | 병렬 40응답마다 HTTP 200, JSON `results` 2건, 각 status 허용 집합, `durable=true`를 검사하며, 최종 연결 revision도 확인한다(`R:49-55`). 따라서 HTTP 200 `{error:...}`만 오는 경우는 실패한다. `check()`는 카운터/라벨일 뿐 assertion은 그 뒤에서 수행한다(`R:9,49-55`). exit 0의 범위는 직접 RPC 40건이며 Edge·공개 HTTP는 포함하지 않는다. |

## 3. 새로 확인한 잔여 항목

### N-09 · medium · 직접 fact 정정 시 공개 버전이 그대로일 수 있음

**근거:** service_role에는 fact 직접 DML이 허용된다(`I:154-157`). 새 fact 트리거는 manifest 세대만 올린다(`I:93-109,140-144`). 공개 `dataset_version`은 ingest·삭제 RPC가 명시적으로 올린다(`I:359-365,440-444`); 기존 analytics 무효화 트리거는 contributor·snapshot 변경에만 붙어 있다(`supabase/migrations/202609240001_analytics_v2.sql:66-74`). 공개 클라이언트는 `meta.dataset_version`과 같은 버전의 정적 snapshot을 재사용한다(`src/data/client.ts:33-43,72-79`). **영향:** 운영자가 완료 상태·날짜·금액 등을 직접 정정하면 manifest는 바뀌어도 기존 공개 snapshot이 같은 버전으로 계속 선택될 수 있다. **수정:** 직접 DML은 공식 운영 절차에서 금지하고 정정 RPC만 사용하거나, fact 변경 시 공개 버전도 같은 트랜잭션에서 갱신하는 *문장 단위* 트리거/정정 함수를 마련한다. 행 단위로 analytics_state를 먼저 잠그는 등 현재 fact→generation→analytics 순서를 깨는 설계는 피한다. **회귀:** service_role 직접 정정 후 manifest 세대와 공개 meta 버전이 모두 변하고, 새 HTTP 조회가 새 값·새 버전을 반환함을 확인한다. 이 항목은 신뢰된 운영 DML 경로에 한정되어 구현 착수 차단 사유로 보지 않는다.

### N-10 · medium · 삭제 경쟁 회귀의 자식 SQL 실패가 숨을 수 있음

**근거:** R은 첫 삭제 `psql`을 별도 프로세스로 실행하면서 stdout/stderr를 버리고 종료 코드도 읽지 않는다(`R:90-96`). 이후 fence가 두 번째 삭제 시각 이상인지 확인한다(`R:97-99`). 첫 프로세스가 SQL 오류로 종료되어도 두 번째 삭제가 성공하면 이 비교는 통과할 수 있다. **영향:** 보고된 exit 0만으로는 두 삭제가 모두 성공한 경쟁 시나리오가 증명되지 않는다. SQL의 `clock_timestamp()+greatest()` 자체는 N-06을 해소한다. **수정:** 첫 프로세스에 `ON_ERROR_STOP=1`, stderr 수집, 종료 코드 0 및 첫 삭제 결과의 `deletion_id` assertion을 추가한다. 두 삭제 사이 시각으로 capture된 중앙 미수락 이벤트를 새 연결에서 재전송해 `rejected:deleted`도 확인한다. **회귀:** 첫 프로세스에서 의도적으로 SQL 오류를 일으키면 테스트가 실패해야 한다.

### N-11 · low · 완료 키 집합이 그대로여도 세대가 증가하는 UPDATE

**근거:** 트리거의 UPDATE 분기는 `old.public_state`와 `new.public_state`가 다르거나 키가 달라지면 두 상태가 모두 `not_completed`여도 세대를 올린다(`I:100-105`). **영향:** 안전성은 유지되지만 빈/미완료 dataset에서 불필요한 manifest 재시도를 유발하고 “완료 key 집합이 바뀔 때만”이라는 계획 문구(`plan-final.md:200-201`)와 어긋난다. **수정:** old/new 각각의 완료 key 존재 여부와 실제 키 차이로 분기를 좁힌다. **회귀:** `not_completed→not_completed` 키 이동·상태 유지에서 세대 불변, 완료 키 삽입·제거·이동에서는 증가를 검사한다.

## 4. 구현 게이트

1. **통합 DB:** 정본 SQL을 SHA256 그대로 migration에 옮기고, 빈 DB·map 선행·auth 선행·양쪽 선행 4경로와 공개 중인 legacy v2 자료 가드를 재현한다. 동시 ingest·삭제·철회·정책 전환에서 잠금 순서 `policy_current→contributor→grant→connection→tombstone/fact→manifest generation→analytics_state`와 deadlock 0을 확인한다. 삭제 경쟁 회귀는 N-10처럼 두 프로세스의 성공을 각각 증명한다.
2. **HTTP·권한:** 실제 Edge에서 공식 신고 ID 중복은 422·원장 0건, 서비스 역할 외 ingest/account/private RPC는 차단, 익명 공개 API는 새 완료 `published`, 취하 `removed`, 철회·삭제 후 0건, 좌표 결측 통계 포함을 검증한다. 오류 JSON과 HTTP 상태를 모두 검사한다.
3. **manifest·앱:** 빈 dataset의 `"0"`, 다중 페이지의 동일 10진 토큰·개수·중복 검사, 페이지 사이 변화의 최대 3회 재시도 및 실패 시 원자 교체/수집 중단을 PC·모바일에서 확인한다. 삭제 후 옛 연결/기존 identity/삭제 전 대기 이벤트의 차단과 새 관측의 재공유 가능성을 검사한다.
4. **공개 버전:** N-09의 운영 직접 DML 정책을 결정하고, 허용한다면 세대와 공개 `dataset_version`을 함께 검증한다. 공개 snapshot이 동일 버전으로 오래 남지 않아야 한다.
5. **원천·앱 내구성:** capture 의도 파일 실패·수동 재시도·rebuild/목록 재조회·ACK별 로컬 상태 전환을 실제 PC/모바일 테스트로 확인한다. POC의 직접 RPC assertion을 앱 또는 공개 HTTP 통과 증거로 대체하지 않는다.

## 5. 판정의 한계

이번에 직접 확인한 실행 결과는 해시 검사와 Node 구문 검사뿐이다. 격리 스택 14 checks는 `plan-resolution.md:99-107`에 기록된 결과이며, R 원문상 N-05는 교환 전후 토큰 변화만 검사한다(`R:43-48`), N-07은 직접 UPDATE 두 방향을 검사한다(`R:56-60`), N-08은 RPC 결과 본문을 검사한다(`R:49-55`). 실제 Edge·공개 HTTP·앱 및 운영 배포는 아직 이 보고서의 통과 판정에 포함되지 않는다.
