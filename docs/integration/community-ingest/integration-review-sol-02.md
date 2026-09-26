# community-ingest 통합 후보 독립 재검토 2차 (GPT-6-Sol, 2026-09-26)

**판정: 수정 후 재검토.** 고정 후보는 map `3b6e8a4`, auth `3be1c39`, PC `703332e`, mobile `265f9d42`이다. PC worktree의 현재 HEAD는 지정 후보보다 문서 커밋 하나 앞서 있어 PC 코드는 `git show 703332e:`로 확인했다. 이 문서만 작성했다. `migration_paths.sh`는 DB를 초기화하므로 실행하지 않았다. 제공된 R2 로그는 로컬 자료로 읽었으며, 이번 환경에서 스택·Flutter 명령을 재실행한 결과로 취급하지 않는다.

## 1차 결함 재판정

| ID | 판정 | 코드·테스트와 판단 |
|---|---|---|
| H-01 | **해결(검증 범위 제한)** | 모바일 `lib/services/sync_engine.dart:209-223`은 store 부재·manifest 실패 시 목록/개인 상세 갱신 전에 실행을 중단한다. 공통 단건 함수도 `:666-681`에서 개인 upsert 전 거절하고, 단건 큐는 `lib/services/standalone_auto_sync_service.dart:172-193`에서 보존한다. 정상 경로는 의도 기록→journal→개인 저장(`sync_engine.dart:692-738`). `test/community/integration_contract_test.dart:156-169`는 **store=null인 공통 함수의 즉시 예외만** 확인한다. `_run`의 manifest 실패·실제 개인 DB 불변·다음 재조회는 실행하지 않으므로 테스트 자체의 증명은 제한적이나, 코드상 기존 fail-open은 닫혔다. |
| H-02 | **해결** | 모바일 `lib/services/local_db_service.dart:3111-3116,3140-3146,3203-3207`은 가져오기·복원 모두 회전을 교체 전에 호출하고 실패를 전파한다. `test/community/rebuild_hook_test.dart:219-247`은 실제 community.db 경로를 디렉터리로 막아 열기 실패를 주입하고 이전 개인 DB의 `live2` 행 유지를 확인한다. 모의 회전 성공만 보는 테스트가 아니다. 서버 DB 가져오기 실패 주입은 별도로 없지만 공통 회전 함수를 지난다. |
| H-03 | **부분** | PC `services/community_capture.py:480-524`, 모바일 `lib/community/capture/server_completed.dart:112-166`은 `captured_at` 대신 삭제 당시 journal rowid 경계를 사용한다. PC `tests/test_community_deletion.py:35-80`, 모바일 `test/community/uploader_test.dart:414-469`는 미래 시계 행·표시 **적용** 실패·손상 표시를 실제 저장소에서 검사한다. PC 라우트도 실재 hook을 호출한다(`web/routers/community_route.py:258-270`). 그러나 **표시 생성 자체가 실패하면** 양쪽 모두 영속 차단 상태가 없다. PC의 `open/fsync/os.replace` 예외는 라우트에서 `local_cleanup_pending`으로만 응답하고(`community_capture.py:490-497`, `community_route.py:263-270`), 다음 확인은 표시 부재를 성공으로 본다(`community_capture.py:500-504,527-532`). 모바일은 `SharedPreferences.setString`의 `bool` 결과를 버려 실패가 `false`이면 표시가 없는 채 `applyPendingDeletion`이 성공한다(`server_completed.dart:125-139`); `remove` 결과도 무시한다(`:165`). 테스트는 이 쓰기 전 실패를 주입하지 않는다. 아래 차단 결함 참조. |
| M-01 | **해결(성능 관찰 필요)** | PC `main.py:373-377`은 `verification_required`를 포함한 모든 `can_enter=false` 전이에서 WS 4403을 예약한다. `services/ws_manager.py:49-61`은 전송 전 재평가하고 오류면 닫는다. `tests/test_community_gate.py:679-715`는 이전 연결의 미전송·4403을 확인한다. 게이트 평가를 모의하므로 실제 파일 I/O 비용과 예외 경로는 측정하지 않는다. |
| M-02 | **부분** | map `tests/integration/community-stack.test.ts:317-349`의 REST 상태+오류 코드, 실제 `public.internal_*` 시그니처 조회(`:136-149`), `:623-640`의 변경 DML 뒤 익명 HTTP 값 검사는 유효하다. Storage API도 켠다(`scripts/integration/compose_supabase.mjs:154-157`). 그러나 Realtime 음성은 여섯 구독 각각의 성공 응답을 확인하지 않고 전체 이벤트 중 응답 하나만 요구한다(`community-stack.test.ts:353-375`); 구독 실패·미활성도 변경 0으로 통과한다. Storage 업로드는 존재하지 않는 `community` 버킷에 보내므로 버킷 없음만으로 거절된다(`:377-391`). 경쟁 검사의 삭제 사용자 ID는 실행 중 받은 `d.session.userId`가 아니라 닉네임 DB 조회 결과에 의존하고, 조회가 비면 `'-'`로 0을 검사한다(`:599-614`). 제품 5xx 판정도 응답에 `error.code`가 없는 모든 5xx를 최대 3건 허용한다(`:584-590,616-620`); 원인을 runtime으로 증명하지 않는다. 따라서 §20-1/2의 요구를 전부 증명하지 못한다. |
| M-03 | **부분** | map `docs/integration/community-ingest/acceptance-matrix.md:8-72`는 후보에 반영돼 있다. E08 `:38`, I06 `:47`, S-18 `:67`, N-03 `:72` 등은 한계를 명시한다. 다만 `integration-review-resolution-01.md:12-13,23-24`의 “로그를 후보 commit에 포함” 주장은 사실과 다르다. `git ls-files docs/integration/community-ingest/evidence/2026-09-26-r2`는 빈 결과이고 `.gitignore:9`의 `*.log`에 의해 16개 로그가 모두 무시된다. `map-location-missing.png`도 미추적이다. 이 worktree의 로그에서는 map 21/21 세 번, mobile 509 passed, PC 367 OK 등을 읽을 수 있으나 **고정 commit의 재현 가능한 첨부 자료가 아니다**. PC 브라우저 최초 125/126 중 Firefox 콘솔 실패 1건은 재실행 28/28로만 해소되었고 원인은 미확인(`resolution-01.md:45`). |

## 새 회귀와 잔여 위험

1. **삭제 표시 쓰기 실패 시 재공유 가능:** 중앙 삭제 뒤 PC가 `os.replace` 전에 실패하면 라우트는 경고만 반환한다. 이후 새 동의·연결이 생기면 표시 부재 검사에 통과하며 `services/community_uploader.py:676-715`가 미차단 옛 eligible journal로 새 `reshare`를 만든다. 모바일도 prefs 쓰기가 `false`를 돌려준 경우 `lib/community/capture/reshare.dart:31-66`의 같은 경로가 열린다. 이미 공개된 identity는 서버 tombstone이 막지만, **한 번도 공개되지 않은** 옛 journal과 미래로 찍힌 `captured_at`은 서버 fence(`map supabase/migrations/202609260200_community_ingest.sql:264-269,442-450`)만으로 막힌다고 할 수 없다.
2. **삭제 표시 경쟁:** PC가 고정 `community_deletion_pending.json.tmp`에 쓰고(`services/community_capture.py:490-496`) 적용 뒤 현재 표시 파일을 지우는(`:523`) 작업에 락이 없다. 두 삭제 응답 또는 복구 작업이 겹치면 한쪽의 표시를 다른 쪽이 덮거나 제거할 수 있다. 모바일도 prefs 표시 1개에 경계 쓰기→DB transaction→표시 삭제가 분리돼 있다(`server_completed.dart:125-165`). 더 늦은 삭제의 경계가 사라질 수 있는 인터리빙을 막는 직렬화가 필요하다. 기존 테스트는 모두 순차 실행이다.
3. **H-01 fail-closed의 정상 경로 영향:** 연결이 없는 journal-only 상태는 `activeContext()==null`이면 scope 검사 성공이어서 정상 수집 가능하다(`mobile lib/services/sync_engine.dart:580-603`). 중앙 연결이 있고 manifest가 일시적으로 불가하면 이제 **개인 상세도 멈추는 설계**다(`:209-223`); 로컬 store를 열 수 없을 때도 동일하다. 개인정보 저장 유실 방지에는 맞지만, 사용자가 커뮤니티 공유를 끄거나 재연결하기 전까지 개인 동기화가 계속 막힐 수 있다. 수집 정지 사유·재시도/연결 해제 UX를 실기기에서 확인해야 한다. 성공/실패 실제 `_run` 테스트가 없으므로 정상 수집 회귀를 배제하지 못한다.
4. **M-01 broadcast 비용:** 연결이 있을 때마다 이벤트 루프 안에서 `community_gate.evaluate()`가 동기 config·암호화 세션 파일 로드를 수행한다(`PC services/ws_manager.py:49-61`, `services/community_gate.py:125-148`). 예외는 fail-closed라 유출보다 연결 종료 위험이며, 세션 파일 순간 오류 때 모든 소켓을 닫는다. 이벤트 빈도와 파일 지연을 계측해 운영 영향 확인이 필요하다. 보안 차단 자체는 타당하다.

## resolution 판단

- **서버 `captured_at` 검사 미도입:** 동의한다. 클라이언트 시각은 위조 가능하며 시간 상한만으로 오래된 사본을 식별하지 못한다. 다만 이 판단은 클라이언트 rowid 차단의 영속성·원자성이 충족될 때만 삭제 보장과 양립한다. 현재 H-03은 그 전제가 깨진다.
- **런타임 503 분리:** 원인 추정은 가능하지만, 현재 테스트의 `error.code` 유무만으로 runtime과 제품 오류를 구분하는 것은 동의하지 않는다(`map tests/integration/community-stack.test.ts:584-590`). 해당 요청과 edge 로그를 연결해 확인하거나 알 수 없는 5xx를 실패로 처리해야 한다. 제출 로그는 21/21 요약이며 요청별 503·deadlock 원인 증거가 없다.
- **실경로 파서 동등성 한계:** 동의한다. 세 언어 관측 벡터와 PC·모바일의 중앙 `source_report_key` 실스택 검사는 유의미하나, 양 앱의 **같은 공식 상세 응답 → canonical/SHA/event_type/key** 전 과정 동등성은 확인되지 않았다. 운영 Kakao·공식 사이트 호출 금지 조건 때문에 이를 통과로 표기하면 안 된다.

## 승인 계획 §20 게이트 재판정

| 게이트 | 판정 | 근거·미완료 범위 |
|---|---|---|
| 1. 통합 DB | **부분** | 4경로+legacy 가드 로그(`evidence/2026-09-26-r2/map-migration-paths.log`)와 SQL 잠금 순서는 있다. 삭제가 들어간 경쟁 실행(`map tests/integration/community-stack.test.ts:577-621`)도 제출 로그상 3회 통과했다. 다만 삭제 사용자 공개 0 검사의 ID가 불확정(`:613-614`)이고 무형식 5xx를 허용해 원자성·deadlock 0의 범위를 좁힌다. 이 검토에서는 초기화 스크립트를 실행하지 않았다. |
| 2. HTTP·권한 | **부분** | 실제 Edge/GoTrue/PostgREST에서 422·JWT·동의·철회·공개 API·REST/RPC 상태/코드를 검사한다(`map tests/integration/community-stack.test.ts:177-349`). Realtime 각 구독 준비 확인 및 실제 버킷에서의 Storage object 권한 검사는 빠져 있어 §20의 채널별 차단 증명이 미완료다(`:353-391`). `private` 권한 회수·publication 0 SQL은 별도 방어 근거다(`:346-349`). |
| 3. manifest·앱·삭제 | **미충족** | 중앙 manifest 및 양 앱의 페이지·토큰·수량 검증은 유지된다(`PC services/community_uploader.py:733-785`, `M lib/community/capture/server_completed.dart:41-102`). H-01은 닫혔지만 H-03의 표시 생성 실패·경쟁 때문에 삭제 전 대기행의 새 연결 재공유 차단을 보장하지 못한다. |
| 4. 공개 버전 | **충족** | map `tests/integration/community-stack.test.ts:623-640`은 fact category를 실제로 바꾼 뒤 `dataset_version`과 새 익명 overview의 `other` 건수 증가를 확인한다. 제출 스택 로그상 테스트 통과. |
| 5. 원천·앱 내구성 | **부분** | PC/모바일의 capture 의도→journal→개인 저장, ACK, rebuild 단위 및 각 앱의 실제 중앙 HTTP 수직 테스트가 있다(`PC tests/test_community_live_stack.py:142-159`, `M test/community/live_stack_test.dart`). H-02 실패 주입은 유효하다. 그러나 H-03의 표시 쓰기 실패 시 삭제 내구성이 없고, H-01의 새 `_run` 실패→개인 DB 불변→재시도 전체 경로는 테스트하지 않았다. 수직 테스트도 공식 개인 저장 진입점 대신 capture 모듈을 직접 호출한다. |

## 병합 차단 결함과 수정 기준

| 심각도 | 위치 | 재현·영향 | 수정 제안 |
|---|---|---|---|
| **high / H-03a** | PC `services/community_capture.py:490-504,527-532`, `web/routers/community_route.py:258-270`; M `lib/community/capture/server_completed.dart:125-139,169-175` | 중앙 삭제 성공 뒤 PC `os.replace` 또는 모바일 prefs `setString`을 실패시킨다. 표시가 없으면 다음 업로드·reshare 검사에서 정리 완료로 간주한다. 이전 미공개 journal 재공유 가능. | 삭제와 같은 영속 DB에 삭제 fence/미완료 상태를 원자적으로 기록하거나, 표시 쓰기 실패 때 재시작 이후까지 보존되는 대체 차단 상태를 둔다. `setString`/`remove`의 bool을 검사한다. **표시 생성 실패→새 연결→reshare/업로드 0**을 실제 store와 fake HTTP 송신 횟수로 검증한다. |
| **medium / H-03b** | PC `services/community_capture.py:490-523`; M `lib/community/capture/server_completed.dart:125-165` | 두 삭제/복구 작업을 동시에 시작해 단일 표시 파일 또는 prefs 키를 덮고 앞 작업이 뒤 표시를 지우게 한다. 늦은 경계 행이 남을 수 있다. | 삭제·정리 작업을 DB 기반 잠금/단일 writer로 직렬화하고 표시 세대 또는 deletion_id 일치 때만 지운다. 서로 다른 rowid 경계의 동시 실행 테스트를 추가한다. |
| **medium / M-02** | map `tests/integration/community-stack.test.ts:353-391,584-620` | Realtime 가입이 실제로 실패해도 이벤트 0으로 통과; 없는 버킷 업로드는 권한과 무관하게 실패; 삭제 경쟁의 공개 0은 닉네임 조회가 비면 무의미; 계약 없는 5xx 3건 허용. | 각 `phx_join`의 ref·상태와 활성 구독을 검사하고 양성 공개 채널 대조군을 둔다. 실제 임시 버킷에 사용자 object 시도 후 정리한다. `d.session.userId`로 공개 사실을 검사하고 모든 미분류 5xx를 실패 또는 요청별 runtime 로그로 증명한다. |
| **medium / M-03** | map `docs/integration/community-ingest/integration-review-resolution-01.md:12-13`, `.gitignore:9`, `docs/integration/community-ingest/acceptance-matrix.md:3` | 후보 checkout에는 R2 로그가 없다(`git ls-files` 결과 0). 매트릭스의 passed를 고정 후보만으로 검토할 수 없다. | redacted 로그를 명시적으로 추적하거나 재현 명령·실행 SHA·결과를 추적 문서에 넣고, 불안정 Firefox 1건의 원인/재현 여부를 기록한다. 동일한 고정 commit으로 다시 제출한다. |

운영 반영 전에는 기존 1차 검토의 preflight·migration 순서(auth `202609260100` → map `202609260200`), 호스팅 Kakao 및 verify_jwt/CORS/키 설정, Android/iOS 실기기 권한 전 게이트·백그라운드·복원, PC 실행파일/Docker와 모바일 릴리스 산출물의 비밀/동의문 검사를 계속 요구한다. 이 조건들은 위 차단 결함을 대신하지 않는다.
