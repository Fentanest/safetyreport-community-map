# GPT-6-Sol · 7일 감사 수정 3차 재검증

## 확인 범위와 실행 증거

읽기 전용으로 PC `57a8cb3..b752efe`의 3개 파일(`services/crawl_manager.py`, `tests/test_storage_exchange.py`, 데이터 계약 문서), 모바일 `c52a12c7..2debce44`의 3개 파일(설정 화면·서버 DB 테스트·설정 위젯 테스트)을 전체 diff로 읽고 호출자·피호출자를 확인했다. 지도 `f6b1e0d..16e88c4`는 `audit-resolution.md`, 2차 보고서, audit3 증거 추가뿐이며 제품 코드 diff는 없다. 인증 HEAD `1dddcc4`도 2차와 동일하다. 기존 `audit-sol-recheck-02.md`와 반영 문서의 “Sol 2차 재검증 … 반영” 절을 대조했다. 대상 worktree·목표 branch·스택 DB는 변경하지 않았고, 독립 재현은 `/tmp` 임시 폴더에서만 했다.

`evidence/2026-09-26-audit3/`의 명령·후보 SHA·dirty·종료 코드·본문을 확인했다. PC `b752efe`에서 단위 **385 OK(4 skip)**, 실스택 1 OK, 브라우저 128 passed, 서버↔모바일 왕복 `diff_count=0`; 모바일 `2debce44`에서 단위 **525 passed(3 skipped)**, 실스택 1 passed, analyze 0건이다. 지도 단위 88·타입 검사·빌드, 스택 21, Deno 4함수·compose check가 통과했다. 지도 로그의 `candidate f6b1e0d / dirty: 1`은 당시 커밋 전 `audit-resolution.md` 변경이고, `f6b1e0d..16e88c4`에 제품 파일이 없는 것을 diff로 확인했다. 인증 같은 제품 코드의 단위 38·relay 24가 통과했고, 브라우저 11건은 audit2의 같은 코드 증거다. 이 로그들은 아래 새 동시성 사례를 실행하지 않았다.

### 음성 대조의 실제 실패 지점

| 로그 | 후보·되돌린 내용 | 실제 결과·검출력 |
|---|---|---|
| `neg-mobile-sol02-guard-before-recheck.log` | 모바일 `c52a12c7 dirty 3`, 옛 전체 merge 생략 가드 | 정상 혼합 DB 성공 경로는 통과. 미지 열 거부 시험만 `UnknownColumnsException` 예상 대신 **2건 이식 완료**로 실패(`:9-14`). 이전의 SQL 문법 오류가 사라져 SOL-02의 목표 손실을 검출한다. |
| `neg-r2-01-clear-on-terminate.log` | PC `57a8cb3 dirty 2`, 종료 직후 참조 삭제 | 살아 있는 `Stubborn` 객체 대신 `None`이라는 단언 실패(`:42-49`). R2-01 검출. |
| `neg-r2-02-no-persist.log` / `neg-r2-02-no-resume.log` | PC `57a8cb3 dirty 2`, 파일 저장 제거 / 복원 후 재개 제거 | 각각 재시작 모사 후 큐 **0≠1**(`:42-49`), 복원 후 launch **[]≠[[SPP-7]]**(`:48-55`)에서 실패. 두 기능의 단일 경로는 검출하지만 실제 크롤러 시작 실패·경쟁·게이트 우회는 시험하지 않는다. |
| `neg-sol04-no-hold-start.log` / `neg-sol04-no-hold-atomic.log` | PC `57a8cb3 dirty 3`, hold 제거, 테스트별 단독 실행 | 각각 `restore_in_progress()` 거짓(`:48-54`), `RestoreRefused` 미발생(`:48-54`)의 목표 단언 실패. 이전의 공유 fixture `UNIQUE` 오류는 없다. 첫 시험은 hold 존재를 Popen보다 앞에서 확인하므로 Popen 경쟁 자체의 독립 음성 대조는 아니다. |
| `neg-r2-03-no-listener.log` | 모바일 `c52a12c7 dirty 1`, 설정 provider 리스너 제거 | 데모 DB 전환 뒤에도 버튼 1개가 남아 `findsNothing` 단언 실패(`:10-18`). 목표 UI 회귀 검출. |

## 지적 항목 재판정

| 항목 | 최종 판정 | 코드와 테스트의 실제 범위 |
|---|---|---|
| **R2-01** | **닫힘** | PC `crawl_manager.py:92-116`은 종료 신호 뒤 최대 10초 대기, 이어 kill 후 최대 5초 대기하며 실제 종료 확인 전에 참조를 지우지 않는다. `clear_process(proc)`는 다른 새 프로세스의 참조를 지우지 않는다. `tests/test_storage_exchange.py:417-468`의 지연 종료·정상 종료와 위 음성 대조가 원래의 복원 경쟁을 검출한다. `crawl_control.stop_crawl()`의 직렬화 잠금은 대기 중 최대 15초 유지되므로 동시에 들어온 시작/큐 요청은 그만큼 늦어질 수 있으나, `_state_lock`은 `wait()` 전에 풀리고 검토한 경로에 잠금 순환은 없다. 실제 15초 지연·프록시 timeout 측정은 없다. |
| **R2-02** | **부분 — 높음 새 회귀** | `crawl_manager.py:132-180`은 단일 프로세스의 상태 잠금 아래 JSON 큐를 저장하고 `:48-52,182-194`가 복원 후 게이트 검사 뒤 재개한다. `tests/test_storage_exchange.py:473-495` 및 두 음성 대조는 정상 파일·단일 재개만 증명한다. 큐를 먼저 제거한 뒤 시작 실패 시 유실(R3-01), 기존 완료 훅의 게이트 우회(R3-02), 파일 저장 실패를 성공으로 보고(R3-03)하는 경로가 남는다. |
| **R2-03** | **닫힘** | 모바일 `settings_screen.dart:89-91,202-222,586-590`가 모드·데모 키 변화에만 사본을 다시 읽고 같은 리스너를 `dispose()`에서 제거한다. `test/widgets/settings_revert_button_test.dart:70-119`는 실 DB 버튼 표시 → 데모 숨김 → 실 DB 표시 → 확인 대화상자 → 실제 A로 복원을 검증하며 음성 대조도 목표 단언에서 실패한다. 리스너 누수는 발견하지 못했다. 빠른 연속 모드 전환에서 비동기 조회 완료 순서를 강제로 뒤집는 시험은 없다. |
| **SOL-02 검출력** | **닫힘** | 모바일 `local_db_service.dart:2975-3018`의 분류별 표 가드는 실제 읽기(`:2924-2944`)와 일치한다. 새 `test/storage/server_import_test.dart:156-194`는 제목 열이 있는 정상 혼합 DB 성공, parking merge의 NULL 아닌 미지 열 거부·기존 DB 보존을 검사한다. 옛 가드 음성 대조가 SQL 오류 없이 **예외 부재/2건 이식**으로 실패해 목표 결함을 잡는다. |
| **SOL-04** | **부분** | hold→write barrier, 실행 중 자식의 참조 유지까지 원래 DB 교체 경쟁은 닫혔다(`exchange.py:358-375`, `crawl_manager.py:36-52,92-116`). 그러나 복원 뒤 자동 큐 처리에는 R3-01/02가 있어 게이트·신고 처리 안전성까지 완료로 볼 수 없다. |
| **SOL-05** | **닫힘** | 모바일 직전 DB 사본·A→B→A→B 서비스 시험과 설정의 실제 렌더·확인·복원 위젯 시험이 통과했다. 모드별 표시 R2-03도 닫혔다. 실기기 파일 시스템·중단 복원 화면은 미검증이다. |

## 새 결함

| ID·심각도 | 파일:줄·재현/원인 | 실제 영향·수정 제안·필요한 회귀 시험 |
|---|---|---|
| **R3-01 · 높음** | PC `services/crawl_manager.py:168-175,182-194,256-288`. 복원 재개는 `pop_pending()`으로 메모리 큐와 JSON 파일을 **먼저 삭제**한다. 그 뒤 다른 요청/완료 훅이 크롤러를 선점해 `start_crawl()`이 `False`이면 `launch_pending_crawl()`은 `started` 거짓을 처리하지 않고 끝난다. `/tmp` 독립 재현에서 `SPP-RACE`의 시작 실패를 주입했을 때 `(큐 1, JSON 있음) → (큐 0, JSON 없음)`이었다. 또한 `pending_queue.txt`는 고정 경로(`:267-270`)이고 자식은 로그인·DB 준비 후에야 읽는다(`start.py:353-356`). 연속 시작 모사에서 첫 파일 `SPP-FIRST`가 둘째 시도에 `SPP-SECOND`로 덮였고 시작 실패 항목도 큐에 남지 않았다. | 응답이 이미 queued였던 신고가 처리되지 않거나 첫 크롤러가 다른 번호를 읽을 수 있다. 큐 항목을 성공적인 프로세스 인수 확인 전까지 내구성 있게 유지하고, `False`/예외 시 되돌리며, 실행별 고유 큐 파일을 사용해야 한다. 복원 후 재개와 사용자/완료 훅의 동시 시작을 barrier로 맞춰 정확히 한 번 처리·재시작 보존·자식이 읽은 번호를 검사한다. 현 테스트는 `launch_pending_crawl` 자체를 mock해 이 경로를 지나지 않는다. |
| **R3-02 · 높음** | PC `services/crawl_manager.py:207-252,256-282`. 새 `_resume_pending_after_restore()`만 `crawl_control._check_crawl_allowed()`를 호출한다(`:182-194`). **기존 `run_after_crawl()` 완료 훅**은 자식 종료 후 1초 쉬었다가 큐를 꺼내 같은 `launch_pending_crawl()`을 직접 부르고, 그 함수도 게이트를 검사하지 않는다. kill 직후 자식 종료 훅이 잠든 사이 복원이 끝나 새 dataset에서 초기화가 필요해지면, 재개 스레드가 큐를 남기더라도 완료 훅이 일반 크롤을 시작할 수 있다. `/tmp` 독립 재현에서 `_check_crawl_allowed`를 `COMMUNITY_REBUILD_REQUIRED`로 설정한 채 완료 훅을 실행하자 `gate_calls=0, crawler_starts=1, queue_remaining=0`이었다. `start.py` 일반 `--queue` 경로도 초기화 게이트를 검사하지 않는다. | 복원으로 회전된 데이터셋에서 필수 초기화 전에 일반 크롤이 DB에 쓸 수 있다. 모든 자동 시작을 한 공통 게이트/직렬화 경로로 모으고, 차단 시 항목은 내구 큐에 남긴다. `stop_crawl`→완료 훅 대기→복원→`rebuild.required()==True` 순서를 강제한 시험에서 프로세스 시작 0, 큐 보존, 초기화 완료 후 단일 재개를 확인한다. |
| **R3-03 · 중간** | PC `services/crawl_manager.py:145-166`. `_save_pending_locked()`는 파일 쓰기·`os.replace`의 `OSError`를 전부 삼킨다. `append_to_pending()`은 그래도 개수를 반환하므로 호출자는 queued 성공을 보낸다. `/tmp`에서 `os.replace` 실패를 주입하자 `queued_result=1`, 내구 파일 없음, 재시작 뒤 `pending_count=0`이었다. 정상 파일은 단일 프로세스 잠금과 원자 교체로 부분 JSON을 피하지만 이 오류는 숨긴다. | 디스크 공간/권한 오류 때 신고가 재시작 후 조용히 사라진다. 내구 저장 실패를 호출자에게 알리고 성공 응답을 보내지 않거나 복구 가능한 별도 기록을 남겨야 한다. 쓰기·교체 실패 주입과 재시작 시험을 추가한다. 다중 worker 간 같은 `.tmp` 경로의 동시성은 현재 단일 worker 실행 구성에서는 재현하지 않았으며 별도 미검증 한계다. |

## SOL-01~10 최종 상태

| ID | 상태 | 근거·한계 |
|---|---|---|
| SOL-01 | 닫힘 | ACK 중복 전송 관련 제품 diff 없음; PC·모바일 전체 단위·실스택 통과. |
| SOL-02 | 닫힘 | 혼합 원본/merge DB 정상 이식·미지 열 거부와 올바른 음성 대조 확인. |
| SOL-03 | 닫힘 | `entry_value` NULL/빈 값 코드 변경 없음; 양쪽 단위·왕복 통과. |
| SOL-04 | **부분** | 원래의 복원 장벽/자식 종료 경쟁은 닫혔으나 자동 큐 시작의 R3-01/02 높음 위험이 남음. |
| SOL-05 | 닫힘 | 백업·서비스 되돌리기·모드별 버튼·실제 위젯 복원 확인. |
| SOL-06 | 닫힘 | 지도 제품 변경 없음; AF-MAP2 `point_count`/빈 결과 단위·스택 통과. 완료 전용 실제 브라우저 화면은 미검증. |
| SOL-07 | 닫힘 | 좌표 결측 집계 변경 없음; 지도 단위·스택 통과. |
| SOL-08 | 닫힘 | entities API 호환 코드 변경 없음; 지도 단위·스택 통과. 대량 실브라우저 네트워크 비용은 미측정. |
| SOL-09 | 닫힘 | compose 명시 경로 변경 없음; audit3 compose check 통과. |
| SOL-10 | 닫힘 | 요청 본문 제한 변경 없음; 지도·인증 단위/relay 통과. |

## 결론

**수정 후 재검토.** R2-01·R2-03·SOL-02·SOL-05는 닫혔고 음성 대조의 이전 검출력 문제도 해소됐다. 그러나 R2-02의 새 큐 경로에서 **높음 두 건(R3-01 처리 유실, R3-02 초기화 게이트 우회)**과 중간 한 건(R3-03 저장 실패 은폐)을 재현했다. 따라서 현재 후보를 **감사 수정 병합 가능**으로 판정하지 않는다. 큐 시작·보존·게이트를 한 경계에서 처리한 뒤 위 경쟁·파일 오류 시험과 새 후보 SHA의 실행 로그가 필요하다.
