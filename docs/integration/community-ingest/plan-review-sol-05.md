# GPT-6-Sol 5차 독립 계획 재확인 — 최종 판정

## 0. 범위와 검증 한계

4차 지적 `plan-review-sol-04.md`의 S-02-R·S-09-R·S-11-R·N-04·S-10-D·S-03-F·S-04-M을 대상으로, 수정 계획·계약·v3 SQL 두 파일·`poc_v3.mjs`를 원문에서 확인했다. 약칭: P=`docs/integration/community-ingest/plan-final.md`, A=`review-input/v3/202609260100_community_account_registry.sql`, I=`review-input/v3/202609260200_community_ingest.sql`, C=`contracts/community-ingest/`. 줄 번호는 해당 파일의 현재 행이다. 제품 파일·git·Docker·네트워크·다른 worktree는 건드리지 않았다. SQL 실행 결과는 Opus의 `plan-resolution.md:73-85` 주장과 스크립트 내용을 대조했으며 독립 실행으로 간주하지 않는다. 계약 `MANIFEST.sha256`은 계약 디렉터리에서 20/20 검증했다.

## 1. 최종 판정

**구현 착수 불가.** v3는 4차의 핵심 교착과 기존 연결을 통한 삭제 후 재전송을 줄였지만, (1) 같은 요청에서 한 신고가 두 번 바뀌면 ACK가 커밋 후 공개 상태와 달라지고, (2) manifest_token이 완료 목록 변경을 항상 식별하지 못하며, (3) 이전 **계보**의 grant ID로 철회를 요청하면 현재 활성 동의가 남아도 성공으로 응답한다. 계획 §3.4는 존재하지 않는 v2 SQL 경로를 구현 정본으로 지목한다. 이 high 결함과 경로 모순을 고치고 회귀를 추가해야 한다.

## 2. 4차 지적별 판정

| ID | 판정 | 직접 확인한 근거 |
|---|---|---|
| **S-02-R critical** | **부분 해소** | 삭제는 사용자 연결을 모두 폐기하고 fence를 기록하며 기존 fact를 tombstone으로 옮긴다(`I:360-389`). ingest는 연결 상태를 먼저 확인하고 tombstone 또는 `captured_at <= fenced_at`을 거절한다(`I:182-213`). 계약도 성공 뒤 로컬 대기 outbox 차단을 요구한다(`C/account-api.md:47`). POC는 중앙 미수락 R50을 옛/새 연결로 재전송해 본다(`poc_v3.mjs:49-56`). 단, `captured_at`은 클라이언트 주장 시각이라 fence의 절대적 보장은 아직 성립하지 않는다(§3.4). 정상 클라이언트의 삭제 후 자동 재전송 경로는 해소됐다. |
| **S-09-R critical** | **해소(정적 구조)** | ingest가 grant 다음 connection을 처음부터 `FOR UPDATE`로 잡고(`I:175-183`), 그 뒤 fact와 마지막 connection revision을 갱신한다(`I:244-245,310-314`). 같은 connection의 SHARE→UPDATE 교착은 제거됐다. POC는 병렬 2요청×20회 40P01/비200을 센다(`poc_v3.mjs:30-34`); 실제 다중 사용자·삭제·철회 경쟁은 통합 게이트로 남는다. |
| **S-11-R high** | **부분 해소** | `community_fact_publicly_listed`와 `published/removed/not_public`을 도입하고 공개 RPC와 단건 조건을 맞췄다(`I:119-127,291-307,439-450`; `C/observation.md:86-88`). POC는 각 경우를 **별도 RPC**로 시험한다(`poc_v3.mjs:26-29`). 같은 신고 두 이벤트가 한 요청에 있으면 앞 ACK가 커밋 후 fact와 달라진다(§3.1). |
| **N-04 high** | **부분 해소** | 정책 승계로 같은 계보가 된 G1→G2는 옛 G1 ID 철회가 G2에 귀결된다(`A:273-294`), POC도 이 경우를 시험한다(`poc_v3.mjs:42-48`). 사용자 철회 뒤 **새 계보** G3이 활성일 때 옛 G1 ID를 다시 철회하면 `already_revoked:true`만 반환하고 G3은 계속 공개된다(§3.3). |
| **S-10-D medium** | **해소(점검 SQL), 계획 경로는 미해소** | preflight는 `to_regclass` 뒤에만 동적 질의를 실행하므로 없는 표를 읽지 않는다(`scripts/integration/preflight_counts.sql:4-31`). staged/active 결정표도 유지된다(`deployment-and-rollback.md:12-17`). 그러나 P §3.4 정본 경로는 v2이고 실제 입력은 v3다(§3.5). |
| **S-03-F medium** | **부분 해소** | capture 전에 별도 JSON에 재시도 의도를 원자 기록하고, 실패하면 저장 전 중단한다(`C/local-store.md:88-89`). 단, 그 기록 자체가 실패한 기존 완료 Y·같은 목록 라벨의 상세는 재시작 때 다시 고를 근거가 없다(§3.6). |
| **S-04-M medium** | **미해소** | 페이지에 token을 넣고 클라이언트가 같은 token만 병합하도록 했다(`I:321-357`; `C/account-api.md:44-46`). 그러나 token의 `max(updated_at)+count(all facts)+fence`는 완료 key 집합의 버전이 아니다. 완료 집합이 바뀌어도 token이 같을 수 있다(§3.2). POC는 count가 증가하는 삽입만 시험한다(`poc_v3.mjs:35-41`). |

## 3. 남은 결함과 수정·회귀

### 3.1 S-11-B · high · 한 요청의 앞 ACK가 최종 공개 사실과 불일치

**근거:** 요청은 최대 20개 이벤트 배열이고 같은 `source_report_key` 중복 금지가 없다(`I:163-165,194-199`; `C/envelope.schema.json:69-76`). 각 이벤트 직후 `v_visible`을 읽어 결과 배열에 ACK를 확정한다(`I:291-308`). 공개 RPC는 **트랜잭션 최종 fact**만 읽는다(`I:439-450`); 계약은 `published`를 “커밋 뒤 익명 API가 이 fact를 보여 줌”으로 정의한다(`C/observation.md:86-88`). **재현:** 같은 R의 `completed_observation(rev 10)`와 `status_correction(rev 11, not_completed)`를 한 배열로 전송, ready=true. ACK는 앞 이벤트 `published`, 뒤 이벤트 `removed`; 커밋 뒤 R은 공개 0. 역순 배열은 `removed` 뒤 `published`의 반대 오표시도 가능하다. **영향:** 앱이 특정 이벤트를 “지도 반영됨”으로 기록하지만 그 시점의 익명 API에는 없다. **수정:** 요청 안에서 `source_report_key`를 한 번만 허용해 422로 거절하거나, 모든 fact 갱신 뒤 최종 상태를 읽어 각 이벤트 ACK를 재산출하고 중간 상태는 `superseded_in_batch` 등 별도로 표현한다. **회귀:** 같은 신고 완료→취하, 취하→완료, 다른 신고 2건, 중복 event_id를 한 배치에서 처리해 각 ACK와 커밋 후 익명 API를 비교한다.

### 3.2 S-04-T · high · manifest_token이 key 집합 변경을 놓침

**근거:** token은 `md5(max(f.updated_at)::text || count(*) || fenced_at)`로, **전체 fact**의 최대 시각과 행 수만 본다(`I:341-347`). manifest key는 그중 `public_state='completed'` 행만이다(`I:341-342,348-352`). PostgreSQL `now()`는 트랜잭션 시작 시각이고 UPDATE에 그대로 쓰인다(`I:267-283`). **반례:** R2의 `updated_at=t2`가 최대다. 더 일찍 시작한 T1(`now()=t1<t2`)이 connection 잠금을 기다리는 동안 T2가 R2를 갱신·커밋한다. 이후 T1이 R1을 completed→not_completed로 고치고 커밋하면 R1 `updated_at=t1`, 전체 count 동일, 최대는 여전히 R2의 t2, fence 동일이다. key 집합에서 R1이 사라졌는데 token이 같다. 페이지 1/2가 서로 다른 집합이어도 검증을 통과할 수 있다. `poc_v3.mjs:39-41`의 NEW1 삽입은 count 자체가 바뀌므로 이 반례를 검사하지 않는다. **영향:** 새 writer의 최초 비적격 정정 대상 누락·잘못된 `server_completed` 원자 교체. **수정:** 사용자·dataset별 서버 관리 monotonic `manifest_generation`을 key 집합을 바꾸는 모든 fact insert/update/delete와 같은 트랜잭션에서 증가시키고, 페이지 token으로 반환한다. 또는 완료 key 집합 자체의 결정적 digest를 계산하되 5000개 페이지 제한과 비용을 평가한다. **회귀:** 완료↔미완료 교환으로 total 동일, 앞쪽 key 삭제·뒤쪽 key 추가, 위 `now()` 역전 경쟁에서 페이지 token이 반드시 달라지고 혼합본이 거절되는지 시험한다.

### 3.3 N-04-L · high · 다른 계보의 stale grant 철회가 거짓 성공

**근거:** `A:283-286`은 입력 grant의 계보만 찾고, 그 계보에 활성 grant가 없으면 무조건 `revoked:true, already_revoked:true`를 반환한다(`A:287-289`). 이후 새 동의는 새 lineage를 만든다(`A:252-264`). 현재 활성 **다른 lineage**를 찾거나 응답의 실제 공개 상태를 확인하지 않는다. 계약의 성공 응답은 `lineage_active:false`도 약속한다(`C/account-api.md:13,47`), 그러나 이 분기에서는 그 필드도 없다. **재현:** G1 사용자 철회 → G2 새 동의·새 자료 공개 → 캐시된 G1 ID로 철회 요청 → 성공 응답, G2·새 공개 유지. **영향:** 지연된 앱/브라우저의 철회 요청이 성공 화면을 보여 주면서 실제 동의는 활성이다. **수정:** 입력 계보에 활성 grant가 없고 사용자에게 다른 활성 계보가 있으면 `stale_grant`/409와 status 재조회로 처리하거나, 명확한 사용자 의도라면 현재 활성 grant 철회로 귀결한다. 모든 성공 응답에서 `lineage_active=false`와 현재 gate 상태를 확인한다. **회귀:** 정책 승계 G1→G2의 G1 철회, 사용자 철회 G1→새 계보 G2의 G1 철회, 같은 요청 반복, 철회와 재동의 경쟁.

### 3.4 S-02-F · medium · 삭제 fence의 시각은 서버가 증명한 capture 시각이 아님

**근거:** `captured_at`은 클라이언트 문자열(`C/envelope.schema.json:117-120`)이고, SQL은 이를 `fenced_at`과 비교한다(`I:191,206-213`); 신뢰 가능한 capture 시각 증명이나 미래 시각 제한은 없다. 삭제의 `fenced_at=now()`도 요청 트랜잭션 시작 시각이다(`I:379-380`). **반례:** 삭제 전 수집한 대기 관측의 기기 시계가 서버보다 앞서 `captured_at > fenced_at`이다. 옛 연결은 폐기되지만 새 연결에서 대기 관측을 재발급하면 fence는 통과한다. **영향:** “삭제 전 captured_at 이벤트는 모두 거절”이라는 서버 보장이 클라이언트 시계·재발급에 의존한다. 정상 앱이 대기 outbox를 차단한다는 계약은 별도의 보호다(`C/account-api.md:47`). **수정:** fence의 보호 범위를 “기존 연결/서버 수신 관측”으로 정확히 쓰고, 새 연결에서 구 journal을 자동 승계하지 않도록 테스트한다. 절대적인 삭제 전 관측 차단이 요구된다면 서버 발급 capture 세대/서명 같은 증명 가능한 경계를 설계해야 한다. **회귀:** 미래로 어긋난 기기 시각, 삭제 직전/동시 capture, 복원된 대기 journal의 새 연결 재발급.

### 3.5 D-01 · high · 계획의 구현 정본이 존재하지 않는 v2 경로

**근거:** P §3.4는 구현 때 옮길 “정본”으로 `stack-poc/poc-sql/v2/202609260200_community_ingest.sql`을 명시한다(`P:66`). 이 worktree에 그 경로는 없으며 제공된 수정 초안은 `review-input/v3/202609260200_community_ingest.sql`이다. P §17은 v3 수정 요약을 덧붙였지만 정본 경로를 바꾸지 않았다(`P:189-191`). `P:69`의 “모든 불변 필드가 같으면 duplicate”도 실제 SQL의 해시·dataset·key·revision·epoch·event_type **6개 비교**(`I:222-227`)와 다르다. **영향:** 구현자가 없거나 구버전 SQL을 복사할 수 있고, 중복 이벤트의 grant/connection/captured_at 변경을 durable duplicate로 잘못 ACK할 수 있다. **수정:** 두 migration의 v3 절대/저장소 경로와 SHA-256을 계획·migration manifest에 고정하고, v2/POC 경로를 정본 표현에서 제거한다. SQL의 immutable 필드를 전부 비교하거나 계약에서 실제 비교 범위를 정확히 제한한다. **회귀:** compose 검사기가 입력 해시 불일치·v2 선택을 실패시키며, 같은 event_id에 다른 grant/connection/captured_at을 넣으면 conflict가 된다.

### 3.6 S-03-I · medium · 재시도 의도 파일 자체 실패 시 기존 완료 신고가 누락

**근거:** `C/local-store.md:88-89`는 의도 기록 실패 때 저장 없이 수집을 중단하지만, 이후 선택은 그 의도 파일과 기존 개인 상태·목록 라벨에 의존한다(`P:143`의 증분 규칙). 기존 완료 Y·같은 C_NOW 라벨 신고를 수동/전수 상세로 다시 읽다가 파일 쓰기가 실패하면 기존 상태는 그대로이고 의도 행도 없다. 다음 증분은 해당 ID를 선택하지 않는다. **수정:** 의도 기록 실패를 실행 전체의 “다음 시작 시 범위 재검사 필요”라는 다른 내구 표식으로 남기거나, 실패 후 정상 복구 시 전체 완료 ID를 한 번 재조회하도록 명시한다. **회귀:** Y·같은 라벨·변경된 금액에서 의도 JSON 쓰기 실패→재시작 정상 증분이 그 ID를 다시 읽는다.

## 4. 권한·잠금·POC 범위

- 신규 private 표는 RLS와 anon/authenticated/public 권한 회수(`A:88-98`; `I:110-117`), 신규 RPC는 `SECURITY DEFINER`, `search_path=''`, service_role 전용 EXECUTE(`A:225-227,275-276,376-389`; `I:131-133,323-325,360-362,422-426,481-493`)다. 정적 검토에서 새 익명 직접 EXECUTE 권한은 보이지 않는다. 기존 `internal_activate_snapshot`의 service_role 권한 및 PostgREST private 노출 여부는 통합 음성 시험이 필요하다.
- ingest `policy(SHARE)→contributor(SHARE)→grant(SHARE)→connection(UPDATE)→fact(UPDATE)→analytics_state`는 정적 순서가 맞다(`I:166-183,244-245,310-316`). 삭제는 contributor(UPDATE)로 같은 사용자 ingest를 먼저 직렬화하고 grant·connection·fence/fact·analytics 순서로 진행한다(`I:373-387`). Opus의 40요청 POC는 같은 connection 경쟁만 시험하며 삭제/철회/정책 변경 병렬 경쟁이나 Edge HTTP·익명 API를 검증하지 않는다(`poc_v3.mjs:30-34`). 스크립트는 결과를 `console.log`하지만 기대값에 `assert`를 걸지 않아 출력만으로 자동 회귀 실패가 되지 않는다(`poc_v3.mjs:26-57`).
- S-11의 새 predicate는 좌표 결측 완료를 계속 포함하고 bbox가 있을 때만 좌표를 요구한다(`I:439-450`). 단건 ACK 분류는 개선됐으나 §3.1 배치 반례가 남는다. lineage의 정책 승계 정상 경로는 개선됐으나 §3.3의 다른 계보 stale 철회 반례가 남는다.

## 5. 재확인 전 필수 수정과 구현 게이트

**착수 전:** S-11-B의 배치 최종 ACK, S-04-T의 실제 manifest 세대, N-04-L의 다른 계보 stale 철회, D-01의 v3 정본 경로·불변 필드 비교를 고친다. S-02-F의 보장 범위와 S-03-I의 복구 규칙도 계획·계약에 명시한다.

**구현 게이트:** (1) v3 SQL 해시를 고정한 합성 migration 네 경로 및 빈/legacy 자료 전환, (2) 같은 신고 다중 이벤트 ACK와 익명 API 최종 상태, (3) 페이지 사이 완료 집합 교환·`now()` 역전 경쟁의 manifest token, (4) 철회→재동의의 두 계보와 정책 승계 한 계보의 stale ID 철회, (5) 삭제 전 미수락·미래 시각·복원 outbox 및 새 연결, (6) 같은/다른 연결과 삭제·철회·정책 변경 병렬 경쟁의 deadlock 0, (7) anon/authenticated/private REST·GraphQL·Realtime 접근 차단, (8) PC/모바일 재시도 파일 실패 후 정상 재조회. POC는 각 기대값을 assertion으로 검사하고, 최종 판단은 실제 통합 스택·익명 공개 HTTP 결과로 한다.
