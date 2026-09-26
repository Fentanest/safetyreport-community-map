# GPT-6-Sol 6차 독립 계획 재확인 — 최종 판정

## 0. 범위·증거

5차 보고서 `plan-review-sol-05.md`의 S-11-B·S-04-T·N-04-L·D-01·S-02-F·S-03-I를 수정 계획·계약과 `docs/integration/community-ingest/sql-drafts/`의 SQL 원문 두 파일로 재확인했다. 아래 약칭 A=`sql-drafts/202609260100_community_account_registry.sql`, I=`sql-drafts/202609260200_community_ingest.sql`, P=`plan-final.md`, C=`contracts/community-ingest/`이다. `sql-drafts/SHA256SUMS:1-3`을 해당 폴더에서 `sha256sum -c`로 검사해 **3/3 OK**였다. Opus가 보고한 격리 스택 exit 0(`plan-resolution.md:87-97`)은 `regression_poc.mjs`의 assertion 범위를 읽어 평가했다. Docker·네트워크·다른 worktree·제품 파일·git은 건드리지 않았다.

## 1. 최종 판정

**구현 착수 불가.** 핵심 4건의 SQL 수정 자체는 대체로 맞지만, 현재 계약은 manifest_token을 `<md5>`로 지정하는 반면 SQL은 **10진 세대 문자열**을 반환한다. 계약대로 응답을 검증하는 클라이언트는 모든 manifest 요청을 실패 처리하고 수집을 시작하지 못한다. 또한 반복 삭제에서 `fenced_at`이 뒤로 갈 수 있어 서버가 주장하는 마지막 삭제 경계가 약해진다. 두 사항을 고치고 새 assertion을 추가해야 한다. §3의 다른 잔여 항목은 구현 게이트나 medium으로 분리한다.

## 2. 5차 지적별 판정

| ID | 판정 | 근거 |
|---|---|---|
| **S-11-B high** | **해소(SQL), Edge 게이트** | SQL은 한 요청의 `source_report_key` 중복을 권한 검사 전에 `invalid_request`로 거절한다(`I:179-186`); Edge의 422는 계획 약속(`P:195-196`)이며 아직 코드가 없다. POC의 R3 중복 직접 RPC assertion은 맞다(`regression_poc.mjs:37-38`). 키는 Edge가 공식 ID에서 계산해야 한다(`C/observation.md:85`). |
| **S-04-T high** | **부분** | accepted fact 변화마다 세대 증가(`I:315-319`), 삭제 때 fact가 있던 dataset별 증가(`I:409-416`), manifest가 세대를 읽음(`I:370-384`)으로 5차의 `max(updated_at)` 반례는 해소됐다. 다만 계약이 아직 md5 형식을 지시해 클라이언트와 서버가 충돌한다(§3.1). 직접 service_role DML에는 세대 트리거가 없어 §3.3의 제한도 있다. |
| **N-04-L high** | **해소(SQL)** | 입력 계보가 닫혔고 다른 활성 grant가 있으면 `stale_grant`를 반환하고, 활성 계보가 없을 때만 `already_revoked`로 응답한다(`A:283-299`). contributor `FOR UPDATE`가 동의/철회 경쟁을 직렬화한다(`A:282`, `A:245-247`). POC는 정책 승계 G1→G2와 사용자 철회 후 새 계보 G3을 각각 검사한다(`regression_poc.mjs:58-70`). |
| **D-01 high** | **해소(정본·핵심 필드)** | P §3.4가 현 `sql-drafts/`와 SHA256SUMS를 정본으로 지정한다(`P:66-71`); 실제 해시 3/3 일치. duplicate는 event_type·공식 ID/key·revision·epoch·captured_at·hash·연결 dataset을 비교한다(`I:243-260`; `C/observation.md:78`). POC는 captured_at 변경 conflict와 trigger 변경 duplicate를 검사한다(`regression_poc.mjs:39-42`). P의 과거 v2 POC 기록(`P:189`)은 이력으로만 남아 있어 구현 정본은 §3.4다. |
| **S-02-F medium** | **부분(보장 범위 문서화)** | 계약은 기기 시각 fence의 한계와 삭제 전 journal 비승계를 명시한다(`C/observation.md:91`; `C/local-store.md:91`). 옛 연결 폐기·기존 identity tombstone은 SQL에 있다(`I:401-416`). 그러나 같은 사용자 반복 삭제에서 fence 시각이 뒤로 갈 수 있다(§3.2). |
| **S-03-I medium** | **부분(명시된 제품 한계)** | 수동 단건의 의도 파일 쓰기 실패는 화면에 실패를 표시하고 사용자가 다시 요청한다는 제한으로 정리했다(`C/local-store.md:88-90`). 일반 증분의 기존 완료 Y·같은 목록 라벨은 자동 재조회되지 않으므로, 재시도 의도가 기록된 경우와 수동 실패 UI를 구현 테스트로 분리해야 한다. |

## 3. 남은 결함·새 반례

### 3.1 N-05 · high · manifest_token 형식 계약 불일치가 수집을 막음

**근거:** API 성공 응답 예시는 `"manifest_token":"<md5>"`로 지정한다(`C/account-api.md:44-45`). 바로 다음 줄은 “세대 번호”라고 설명한다(`C/account-api.md:46`). SQL은 `generation::text`, 없으면 `'0'`을 반환한다(`I:372-384`). 로컬 계약은 manifest 전 페이지 수신에 실패하면 수집/초기화를 시작하지 않는다(`C/local-store.md:92`). **재현:** 빈 dataset의 `/manifest` SQL 응답 token은 `"0"`. `<md5>`에 맞춰 32자리 hex를 검사하는 계약 구현 클라이언트는 이를 잘못된 응답으로 거절하고 `manifest_unavailable` 상태에 머문다. 현재 POC는 직접 RPC의 두 token이 다른지만 보며 HTTP 계약 파싱을 시험하지 않는다(`regression_poc.mjs:43-48`). **영향:** 첫 연결·재설치·writer 전환 뒤 정상 수집이 영구 중단될 수 있다. **수정:** `C/account-api.md:45`를 10진 단조 세대 문자열(`"0"`, `"1"`…)로 고치고 manifest 응답 schema/클라이언트 검증 규칙을 고정한다. **회귀:** 빈/첫 fact/삭제 뒤 manifest의 실제 HTTP JSON을 계약 파서로 통과시키고, 페이지 사이 세대 변경은 fail-closed·최대 3회 재시도를 확인한다.

### 3.2 N-06 · high · 반복 삭제가 fenced_at을 과거로 되돌릴 수 있음

**근거:** 삭제는 contributor를 잠근 **뒤** `fenced_at=now()`를 upsert하고, 충돌 시 이전 값과 비교하지 않고 덮는다(`I:401-408`). PostgreSQL `now()`는 트랜잭션 **시작** 시각이므로 잠금을 얻은 시각보다 이를 수 있다. **재현:** D1 트랜잭션 t1 시작 후 지연 → D2가 t2>t1에 같은 사용자의 삭제를 먼저 완료해 fence=t2 → D1이 나중에 contributor 잠금을 얻어 fence=t1로 덮는다. t1과 t2 사이에 capture된, 중앙 미수락 이벤트는 최종 fence를 통과한다. 옛 연결 폐기와 정상 앱 journal 차단은 별도 방어지만, POC가 시험한 “새 연결에서 이전 이벤트 거절”의 서버 조건은 깨진다(`regression_poc.mjs:71-79`). **영향:** 마지막 삭제의 보호 경계가 이전 삭제보다 후퇴한다. **수정:** 잠금 획득 후 `clock_timestamp()`를 얻고 `fenced_at=greatest(existing.fenced_at, excluded.fenced_at)`로 단조화한다. 반환 `deleted_at`도 저장된 최종 fence를 사용한다. **회귀:** `BEGIN` 후 대기한 D1과 나중 시작해 먼저 끝나는 D2를 동일 사용자로 교차 실행하고 최종 fence가 절대 감소하지 않음을 확인한다. 두 삭제 사이 시각의 중앙 미수락 이벤트를 새 연결로 재발급하면 `deleted`여야 한다.

### 3.3 N-07 · medium · manifest 세대는 RPC 경로에서만 유지됨

**근거:** 세대 증가가 ingest의 accepted 분기(`I:315-319`)와 삭제 RPC(`I:409-416`)에 명시되어 있고, fact 표 자체에는 세대 bump 트리거가 없다(`I:48-89,110-124`). 그런데 service_role에 fact 직접 INSERT/UPDATE/DELETE도 허용한다(`I:131-134`). **영향:** 운영 정정·후속 service_role 코드가 fact를 직접 수정하면 완료 key가 바뀌어도 token은 그대로여서 페이지 혼합을 검출하지 못한다. **수정:** fact 변경 트리거로 중앙화하거나, fact DML을 RPC/정해진 함수로 제한하고 운영 SQL도 반드시 세대를 같은 트랜잭션에서 올리도록 migration 가드·테스트를 둔다. **회귀:** 직접 DML을 차단하는 권한 시험 또는 직접 completed↔not_completed 변경 뒤 세대 증가 시험.

### 3.4 N-08 · medium · POC 병렬 검사에 거짓 통과 경로

**근거:** 병렬 40요청 검사는 응답이 HTTP 200이고 본문에 `40P01|deadlock`이 없으면 성공으로 센다(`regression_poc.mjs:49-51`). `internal_community_ingest`는 권한·입력 오류를 SQL JSON `{error:...}`로 돌려줄 수 있고(`I:179-210`), PostgREST는 이를 200으로 전달할 수 있다. 따라서 40건이 모두 `{error:"consent_revoked"}`여도 `bad=0`이다. `check(name, ()=>{})`는 이름을 먼저 출력할 뿐 해당 콜백은 비어 있다(`regression_poc.mjs:9,30-80`). exit 0은 **실제 뒤따르는 assert가 모두 통과**했다는 뜻이지만, “40건 정상 수락”이나 Edge 422/익명 공개 HTTP까지 증명하지 않는다. **수정:** 각 병렬 본문에 `results` 길이·각 status·최종 fact/revision을 assert하고, Edge 경로와 익명 공개 API를 별도 HTTP 회귀로 검사한다. **회귀:** RPC가 200 `{error:"invalid_request"}`를 내도록 주입했을 때 병렬 시험이 반드시 실패해야 한다.

## 4. 정적 SQL·권한 검토 및 POC가 실제 증명하는 것

- **중복 신고 검사:** `I:179-186`은 루프·쓰기 전에 요청 전체를 거절한다. SQL은 Edge가 계산한 `source_report_key`를 기준으로 중복을 판단하므로 Edge가 공식 ID→key를 한 번씩 계산하고 같은 ID 두 건을 422로 내는 통합 시험이 필요하다. POC는 service_role 직접 RPC의 `invalid_request`만 확인한다(`regression_poc.mjs:37-38`).
- **세대 증가:** 신규 fact·내용 변경·grant 재귀속은 `accepted`이고 bump된다(`I:273-285,297-319`). `no_change`, stale, quarantined는 완료 key 집합을 바꾸지 않으므로 bump하지 않아도 된다(`I:263-269,292-318`). 삭제는 fact가 있던 dataset별로 bump하고 같은 트랜잭션에서 삭제한다(`I:409-418`). §3.3의 직접 DML만 별도 통제하면 RPC 경로의 세대 규칙은 맞다.
- **잠금·권한:** ingest는 policy→contributor→grant→connection `FOR UPDATE`→fact→manifest 세대→analytics 순서다(`I:187-204,270-271,315-344`). 삭제는 contributor `FOR UPDATE`로 같은 사용자의 ingest를 막은 뒤 grant→connection→세대/fact→analytics로 진행한다(`I:401-418`). 신규 표는 RLS on·anon/authenticated/public 권한 회수(`A:88-98`; `I:126-134`), RPC는 `SECURITY DEFINER`, `search_path=''`, service_role만 EXECUTE(`A:275-276,381-394`; `I:148-150,352-354,389-391,453-457,512-524`). 이 정적 범위에서 새 익명 직접 EXECUTE는 보이지 않는다. 실제 private REST·GraphQL·Realtime·구 RPC 음성 검사는 아직 미실행이다.
- **POC 범위:** exit 0이라면 직접 PostgREST RPC로의 새 단건 ACK, 같은 신고 중복 거절, captured_at conflict, 한 교환의 세대 변화, 정책 승계/철회/새 계보, 삭제·새 연결 사례에 적힌 assert는 통과한 것이다(`regression_poc.mjs:33-48,52-81`). POC는 앱의 journal·manifest 파서, Edge 인증·422·rate limit, 익명 `public-analytics` 응답, 다중 요청의 삭제/철회 경쟁을 실행하지 않는다. 사용자 JWT 음성 시험은 단지 HTTP ≥400인지 확인한다(`regression_poc.mjs:30-32`). 결과를 이 범위 이상으로 확대하면 안 된다.

## 5. 착수 전 수정과 이후 구현 게이트

**착수 전:** N-05의 manifest_token 계약을 실제 세대 문자열과 일치시키고, N-06의 삭제 fence를 단조화한 뒤 SQL SHA256SUMS와 assertion POC를 갱신한다. 새 SQL은 “바이트 그대로 migration으로 이동”하는 정본이므로 현재 초안 상태로 복사하면 안 된다(`P:66-68`).

**구현 중 반드시 증명:** (1) 합성 migration 네 시작 경로와 SHA 검사·legacy active v2 안전 중단, (2) Edge 중복 신고 422·원장 0건 및 익명 공개 API의 published/removed, (3) manifest 빈/페이지/교환/삭제의 동일 세대 계약 파싱과 최대 3회 fail-closed, (4) 두 삭제의 순서 역전·삭제와 ingest/철회/정책 변경의 병렬 40P01 0, (5) 계보 stale_grant·동의 철회 뒤 공개 0, (6) PC/모바일 capture 의도 파일 실패의 실패 표시·재요청과 정상 재시도, (7) anon/authenticated의 RPC/private REST·GraphQL·Realtime 차단 및 기존 서비스 역할 RPC의 운영 경계, (8) service_role 직접 fact DML 통제 또는 세대 트리거. 이 게이트의 실제 통합 스택·HTTP 결과가 구현 완료의 증거다.
