# community-ingest 통합 후보 독립 재검토 3차 (GPT-6-Sol, 2026-09-26)

**결론: 수정 후 재검토.** 고정 후보 map `5a4b462`, auth `3be1c39`, PC `b8e49a9`, mobile `96085981`의 코드를 읽었다. 이번에는 `evidence/2026-09-26-r3/`의 로그와 이미지가 `git ls-files`에 실제로 나타난다. 제출 로그는 실행 증거로 참고했으나 이 세션의 재실행 결과는 아니다. DB를 초기화하는 `migration_paths.sh`는 실행하지 않았다.

## 2차 차단 결함 재판정

| ID | 판정 | 수정·시험의 효력과 남은 문제 |
|---|---|---|
| H-03a | **부분** | PC `services/community_capture.py:474-481`, 모바일 `lib/community/capture/server_completed.dart:103-115`는 삭제 표시를 journal과 같은 community.db의 meta 트랜잭션에 **중앙 호출 전** 기록한다. 표시 쓰기 실패 시 PC 라우트(`web/routers/community_route.py:258-268`)와 모바일 요청 함수(`lib/community/upload_hooks.dart:34-44`)가 중앙 호출을 하지 않는다. PC `tests/test_community_deletion.py:72-81`, 모바일 `test/community/integration_contract_test.dart:180-185`가 이를 검사한다. 따라서 이전의 “중앙 성공 뒤 표시 쓰기 실패” 구멍은 닫혔다. 그러나 준비 표시와 삭제 성공 표시를 구별하지 않아, 중앙 응답 전 업로드/reshare가 표시를 **적용하고 제거**할 수 있다(아래 신설 H-03c). 응답 손실을 확정 실패로 취급해 표시를 취소하는 경로도 있다(H-03d). |
| H-03b | **부분** | PC `services/community_capture.py:484-508`, 모바일 `lib/community/capture/server_completed.dart:117-149`는 UUID별 meta 행을 두고 한 DB 트랜잭션에서 남은 표시 전체를 처리한다. PC `tests/test_community_deletion.py:83-115`는 다른 ID 보존과 네 스레드 동시 **apply**를, 모바일 `test/community/uploader_test.dart:460-474`는 두 표시·동시 apply를 확인한다. 고정 파일/prefs 키 덮어쓰기 결함은 해결했다. 하지만 테스트는 표시를 모두 만든 뒤 apply한다. 실제 `begin → 중앙 요청 중 → cleanup/apply → 다른 capture 또는 begin/cancel` 인터리빙을 검사하지 않으며, 준비 표시를 먼저 제거하는 문제 때문에 전체 삭제 직렬화는 성립하지 않는다. |
| M-02 | **부분** | map `tests/integration/community-stack.test.ts:360-422`는 anon/사용자 각 Realtime join 응답을 확인하고 공개 대조 채널에서 실제 변경을 받았을 때만 private 변경 0을 인정한다. 실제 임시 버킷에서 업로드 거절과 객체 0을 본다(`:424-450`). 삭제 경쟁은 수집한 사용자 ID 3개를 직접 조회한다(`:638-679`). 이전의 무조건 허용하던 비계약 5xx 상한도 serve 종료 로그 수와 비교한다(`:135-142,645-685`). 다만 **빈 스택 첫 실행은 공개 대조 이벤트가 도착하지 않아 20/21 실패**했고, 같은 스택에서 다섯 번 연속 21/21 통과했다(`evidence/2026-09-26-r3/map-stack-run-1..6.log`). 대조 표를 테스트 중 publication에 추가한 뒤 복제가 준비되기 전 발생하는 cold-start 실패이며, 표를 영구 남겨 후속 실행은 warm 상태다(`:365-372`). 깨끗한 스택에서 재현 가능한 게이트 증거가 아니다. Storage 읽기 음성은 실제 객체 파일 없이 `storage.objects` 행만 넣고 HTTP `>=400`만 보므로 파일 부재에 의한 4xx도 통과한다(`:443-447`). 비계약 5xx의 전역 종료 로그 **건수** 비교는 동일 요청과 원인을 매칭하지 않는다. 이번 5회 통과 로그에 그런 5xx는 보고되지 않아 현재 결과를 왜곡한 증거는 없다. |
| M-03 | **해결(기록 한계 명시)** | map `.gitignore`의 예외와 `git ls-files docs/integration/community-ingest/evidence/2026-09-26-r3` 결과로 로그·이미지 21개가 고정 후보에 포함됨을 확인했다. 매트릭스가 R3 경로를 가리키고 미실행 항목을 분리한다(`docs/integration/community-ingest/acceptance-matrix.md:3,38,47,67,72`). 첫 map 실패도 숨기지 않고 제출했다(`integration-review-resolution-02.md:14,26`). auth 후보는 변경 없으며 auth 로그는 2차 실행분 복사라고 명시돼 있다(`:29`). PC Firefox 125/126 실패 원인은 제출된 한 줄의 CDN 폰트 다운로드 실패 설명(`evidence/2026-09-26-r3/pc-browser-smoke-firefox-cause.txt`)으로만 확인 가능하고 원 trace는 포함되지 않아 독립 재현은 **미검증**이다. 이는 이번 M-03의 로그 추적 문제와 구분한다. |

## 수정으로 생긴 차단 결함

| 심각도 | 위치 | 코드로 재현 가능한 순서·영향 | 수정 기준 |
|---|---|---|---|
| **high / H-03c** | PC `services/community_capture.py:474-508,518-523`, `services/community_uploader.py:440-444,676-681`, `web/routers/community_route.py:261-278`; M `lib/community/capture/server_completed.dart:108-149,163-169`, `lib/community/upload/community_uploader.dart:165-173`, `lib/community/capture/reshare.dart:31-53` | (1) `beginDeletion`으로 준비 표시 생성, (2) 중앙 삭제 응답을 기다리는 동안 예약 업로드/reshare가 `deletionCleanupPending`을 호출, (3) 이는 성공 여부 확인 없이 journal을 차단하고 **표시를 삭제**, (4) 그 뒤 공식 상세가 새 journal 행을 만들고 중앙 삭제가 완료되어도 최종 `applyPendingDeletion`은 표시가 없어 아무것도 하지 않는다. PC 게이트 무효화는 context를 끄지만 capture는 비활성 context에서도 journal을 만든다(`services/community_gate.py:219-223`, `community_capture.py:359-379`). 모바일도 같은 분기다. 서버 fence가 시각을 비교하므로, 삭제 전 행의 기기 시계가 앞서 있으면 새 연결에서 재공유 가능하다(`map supabase/migrations/202609260200_community_ingest.sql:264-269`). 기존 테스트는 중앙 호출을 실제로 대기시키고 그 사이 cleanup·capture를 교차 실행하지 않는다. | `prepared`와 `central_confirmed`를 영속적으로 구분한다. prepared가 있으면 업로드·reshare는 **차단만** 하고 표시를 지우지 않는다. 중앙 성공 후에만 같은 DB 트랜잭션으로 경계 행을 막고 표시를 완료한다. 응답 대기 중 cleanup·capture·새 연결을 교차시키는 PC/모바일 실제 DB 테스트에서 기존 행 전송 0을 확인한다. |
| **high / H-03d** | PC `web/routers/community_route.py:267-274`, `:203-217`, `services/community_account_client.py:48-55`; M `lib/community/upload_hooks.dart:43-50`, `lib/community/gate/community_account_client.dart:116-135` | 중앙이 삭제를 커밋했지만 응답이 타임아웃/연결 종료되면 PC는 `network_error`를 `CommunityAuthError`로 바꿔 준비 표시를 취소하고, 모바일도 `timeout/offline`에서 무조건 취소한다. 서버 tombstone은 이미 존재하던 fact identity만 막으므로 과거 **미공개** journal을 새 동의·연결에서 재공유할 수 있다. 반대로 중앙이 확실히 실패한 경우에도 H-03c의 조기 적용이 있으면 이미 로컬 행이 영구 차단된다. | 응답 불명 상태를 확정 실패와 분리하고 표시를 유지한다. 중앙 status/삭제 결과를 조회해 성공 여부를 화해시키거나 동일 요청 키로 안전 재시도할 때만 취소·적용한다. “중앙 커밋 후 응답 손실” 및 “명시적 4xx 실패”를 따로 실패 주입해 각각 재공유 차단·정상 수집 회복을 확인한다. |
| **medium / M-02** | map `tests/integration/community-stack.test.ts:365-422,443-447,682-685` | 빈 스택의 첫 Realtime 양성 대조가 실패하지만 후속 warm 실행만 통과한다. Storage 읽기는 객체 파일 부재를 권한 거절로 오인할 수 있다. | 대조 표/publication을 테스트 전에 생성하고 Realtime 복제 준비를 검증한 뒤 **초기화된 스택의 첫 실행**을 통과시킨다. Storage는 실제 객체를 service role로 업로드해 읽기 양성 대조와 anon/user 거절 상태·오류 코드를 함께 검사한다. 비계약 5xx가 생기면 요청과 runtime 로그를 매칭한다. |

PC `services/ws_manager.py:49-61`은 게이트 평가를 `asyncio.to_thread`로 옮겨 이벤트 루프의 동기 파일 읽기 부담을 낮췄다. 기존 4403 보장은 유지된다. 매 broadcast마다 평가/스레드 호출은 남으며 실부하 지연은 **미검증**이다. 모바일 `lib/widgets/community_account_card.dart:564-579`는 `local_pending`을 받아도 동일한 일반 삭제 요청 문구를 표시하지만, 게이트가 로컬 정리 실패 notice를 별도로 기록한다(`lib/community/gate/community_gate.dart:518-525`). 이는 위 차단 결함보다 낮은 UX 확인 항목이다.

## 승인 계획 §20 최종 판정

| 게이트 | 판정 | 근거와 한계 |
|---|---|---|
| 1. 통합 DB | **충족(합성 스택 범위)** | 추적된 `map-migration-paths.log`는 빈/map 선행/auth 선행/양쪽+legacy 가드 PASS를 기록한다. 스크립트는 이번 검토에서 읽기만 하고 실행하지 않았다. 삭제 사용자 3명의 실제 ID로 공개 fact 0, deadlock 증가 0, 계약 5xx 0을 확인하도록 경쟁 검사가 개선됐다(`map tests/integration/community-stack.test.ts:638-687`). R3 스택 여섯 실행에서 이 경쟁 검사의 실패는 보고되지 않았다. 운영 DB의 migration 상태는 별도 preflight 대상이다. |
| 2. HTTP·권한 | **부분** | 실제 Edge/GoTrue/PostgREST의 JWT·동의·연결·세션·422/원장 0·REST/RPC/GraphQL·익명 published/removed/좌표 결측 검사는 유지된다(`map tests/integration/community-stack.test.ts:177-355,455-635`). Realtime 음성은 양성 대조와 각 join으로 강화됐지만 cold-start 첫 실행이 실패한다(`:360-422`, R3 run-1). Storage 쓰기 거절은 실버킷 RLS 응답으로 확인하나 읽기 권한 음성은 파일 부재와 분리되지 않는다(`:424-450`). 따라서 §14 전체·§20-2 완전 통과로 표기하지 않는다. |
| 3. manifest·앱·삭제 | **미충족** | 빈 `"0"`·페이지 토큰/수량·3회 fail-closed 및 이전 H-01은 유지된다(`PC services/community_uploader.py:733-785`, `M lib/community/capture/server_completed.dart:41-102`, `M lib/services/sync_engine.dart:209-223`). H-03c/d로 삭제 전 대기 사본의 새 연결 업로드 차단이 보장되지 않는다. |
| 4. 공개 버전 | **충족(합성 스택 범위)** | 직접 DML로 fact 분류를 실제 변경한 뒤 새 익명 HTTP 조회의 버전·건수 변화를 확인한다(`map tests/integration/community-stack.test.ts:690-707`; R3 run-2..6 통과). |
| 5. 원천·앱 내구성 | **부분** | capture 의도→journal→개인 저장, 목록 재조회·rebuild·ACK 상태의 PC/모바일 단위와 중앙 HTTP 수직 검사는 제출 로그상 통과(PC 368, mobile 511, 각 live 1)했다. 그러나 H-03c/d의 삭제 내구성 실패가 있고, 실스택 수직 검사는 양 앱의 공식 개인 저장 진입점 대신 capture 함수를 직접 호출한다(`PC tests/test_community_live_stack.py:142-149`, `M test/community/live_stack_test.dart:119-133`). H-01 `_run` 실패→개인 DB 불변→다음 재조회도 여전히 통합 미검증이다. |

## 병합 뒤 감사·운영 반영의 경계

현재 **병합은 승인하지 않는다**. H-03c/d를 같은 후보에서 수정하고 중앙 응답 대기/손실 경쟁을 실패 주입으로 검증해야 한다. M-02의 깨끗한 스택 첫 실행과 Storage 읽기 양성 대조까지 통과시켜 §20-2를 닫고 다시 제출한다.

수정 후보가 병합 가능해질 경우에도 **병합 뒤 7일 감사 전까지** 매트릭스의 E08(fork/PR의 운영 호출 금지), I06(trigger만 바뀐 재전송), S-18(IP 헤더 위조), N-03(정책 불변 HTTP) 등 `not-run/partial`을 통과로 바꾸지 않고 담당·재현 명령·결과를 남겨야 한다(`map docs/integration/community-ingest/acceptance-matrix.md:38,47,67,72`). 첫 Realtime 실패의 원인과 재현 가능한 clean-stack 준비 절차, PC Firefox 콘솔 실패 원 trace, 실제 `_run` 중단·재시도 UX도 감사 목록에 둔다.

**운영 반영 전**에는 읽기 전용 legacy/preflight와 운영 migration 이력·SHA를 확인하고 auth `202609260100` → map `202609260200` 순서로 적용한다. 운영 호스팅 Kakao 로그인/redirect, Edge verify_jwt·origin allowlist·키 분리, 실제 Realtime publication·Storage 정책, 제한 계정의 동의→업로드→철회→삭제→익명 조회를 확인해야 한다. Android/iOS 실기기의 게이트→권한 순서·딥링크·백그라운드·복원, PC 실행파일/Docker 및 모바일 릴리스 번들의 동의문·비밀 스캔도 운영 전 조건이다. **호스팅 Kakao, 실기기, 공식 상세의 PC↔모바일 실경로 파서 동등성은 현재 미검증**이며, 관측 벡터·가짜 Kakao·로컬 스택 통과와 구분한다.
