# GPT-6-Sol · 7일 감사 수정 4차 재검증

## 읽은 범위와 실행 증거

읽기 전용으로 PC `b752efe..cb1305d`의 수정 4개 파일(`services/crawl_manager.py`, `tests/test_storage_exchange.py`, `docs/architecture/data-contracts.md`, `CHANGELOG.md`) 전체 diff 및 `crawl_control.py`·`exchange.py`·`start.py`·게이트·크롤 로그 호출 경로를 확인했다. 모바일 제품 HEAD `2debce44`, 지도 제품 HEAD `e284c86`, 인증 제품 HEAD `5a4d678`은 3차 이후 그대로다. 지도 `16e88c4..804a30b`에는 반영 문서·3차 보고서·audit4 증거만 추가됐다. 대상 worktree·branch·스택 DB는 수정하지 않았다. 독립 재현은 `/tmp` 임시 폴더와 프로세스 mock만 사용했다.

`evidence/2026-09-26-audit4/`의 명령·candidate·dirty·본문·종료 코드를 확인했다. PC `cb1305d` 단위 **388 OK(4 skip)**, 실스택 1 OK, 서버↔모바일 왕복 `diff_count=0`. 브라우저 전체는 **127 passed, 1 failed**이고 같은 후보의 해당 스펙 재실행은 Chromium/Firefox **16 passed**다. 모바일·지도·인증에는 이번 제품 수정이 없으므로 3차의 단위·실스택·analyze/타입 검사·빌드 결과만 유효하며, 이번 회차에 그 검사를 다시 실행한 증거는 없다.

| 음성 대조 | 실제 실패 지점 | 검출력 |
|---|---|---|
| `neg-r3-01-remove-before-start.log` (`b752efe dirty 2`) | 시작 실패 후 큐 예상 `[SPP-RACE]`, 실제 `[]` (`:42-49`) | 원래의 선제 삭제 결함을 검출. |
| `neg-r3-01-fixed-queue-file.log` (`b752efe dirty 2`) | 두 실행의 큐 파일 경로가 동일하여 `assertNotEqual` 실패 (`:42-49`) | 고정 경로 덮어쓰기를 검출. |
| `neg-r3-02-no-gate.log` (`b752efe dirty 2`) | 완료 훅에서 Popen **1회 호출**되어 `assert_not_called` 실패 (`:42-51`) | 게이트 누락을 검출한다. 다만 실패 로그의 mock 호출 인자가 **환경 변수 전체**를 출력했다(R4-04). |
| `neg-r3-03-swallow-save.log` (`b752efe dirty 2`) | 파일 저장 실패에도 `RuntimeError`가 나오지 않아 단언 실패 (`:42-49`) | 저장 오류 은폐를 검출. |

## 요청한 세 가지 `/tmp` 재현

새 `cb1305d` 코드에서 3차의 같은 조건을 다시 맞췄다. 모두 운영 프로세스·DB 없이 임시 데이터 폴더에서 실행했다.

| 사례 | 새 결과 | 판정 |
|---|---|---|
| 다른 크롤 선점으로 `start_crawl=False` | 시작 시도 1회, 큐 `[SPP-RACE]`, 내구 JSON 존재 | **기존 R3-01 선제 삭제 경로 해결.** `crawl_manager.py:281-318`이 시작 실패 시 큐를 유지한다. |
| 완료 훅에서 `COMMUNITY_REBUILD_REQUIRED` | 게이트 호출 1회, 시작 0회, 큐 `[SPP-GATE]` | **기존 R3-02 무검사 경로 해결.** `:266-289`의 완료 훅이 공통 검사를 사용한다. |
| `os.replace`에 `OSError` | 요청 거부(`RuntimeError`), 메모리 큐 `[]`, 내구 JSON 없음 | **R3-03 닫힘.** `:145-170`이 저장 실패를 숨기지 않고 호출자까지 올린다. |

## R3-01·02·03 및 SOL-04 재판정

| 항목 | 판정 | 코드·테스트 경계 |
|---|---|---|
| **R3-01** | **부분 — 높음 잔여** | 고유 `pending_queue_<uuid>.txt`와 시작 실패 시 큐 유지가 확인됐다(`crawl_manager.py:294-318`). 새 테스트 `test_storage_exchange.py:542-566`은 실제 `launch_pending_crawl`과 `start_crawl`을 지나며 Popen만 가짜로 한다. 그러나 가짜 Popen은 **시작 순간에 파일을 읽는다**(`:495-500`): 실제 자식은 DB·로그인 준비 후 `start.py:353-356`에서 읽는다. 자식이 읽기 전 실패하면 Popen 성공 직후 큐가 제거되고 종료 훅이 파일을 삭제한다(R4-01). 두 launch의 동시 중복·로그 손상도 R4-02로 남는다. |
| **R3-02** | **부분 — 높음 잔여** | 완료 훅과 복원 후 재개가 공통 `launch_pending_crawl()`을 호출하고 게이트가 실패하면 큐를 남긴다(`crawl_manager.py:207-210,266-289`). 실제 완료 훅 테스트 `test_storage_exchange.py:568-582`와 음성 대조가 이 정적 차단을 잡는다. 그러나 게이트 통과 뒤 복원이 새 데이터셋으로 선회전하고 hold가 풀리면 재검사 없이 일반 크롤이 시작될 수 있다(R4-03). |
| **R3-03** | **닫힘** | 파일 `flush`·`fsync`·원자 교체(`crawl_manager.py:145-157`), 실패 시 메모리 추가 취소와 오류 반환(`:159-170`)을 확인했다. 테스트 `test_storage_exchange.py:584-600`은 직접 큐 추가와 `crawl_control.enqueue_report` 호출자의 오류까지 검사하며 음성 대조도 목표 단언에서 실패한다. 삭제/갱신 실패는 `:178-200`에서 재처리 가능성을 택한다. |
| **SOL-04** | **부분** | 복원 hold·쓰기 장벽·중지 중 자식 추적의 기존 DB 교체 경쟁은 닫혀 있다. 자동 큐 시작의 게이트/처리 완료 보증은 R4-01·R4-03에 남아 있어 복원 후 안전성까지 닫을 수 없다. |

## 새 결함·회귀

| ID·심각도 | 파일:줄·재현/근거 | 영향·수정 제안·필요한 회귀 시험 |
|---|---|---|
| **R4-01 · 높음** | PC `services/crawl_manager.py:308-333`은 **Popen 반환**을 처리 완료로 보고 즉시 `_remove_pending()`을 호출한다. 자식의 큐 파일 읽기는 `start.py:353-356`으로 훨씬 뒤다. `_after()`는 자식 종료 뒤 성공/실패·읽기 여부와 관계없이 큐 파일을 삭제한다. `/tmp`에서 Popen은 성공하지만 자식이 읽기 전 종료한 경우를 모사하자 `started=True`, 큐 `[]`, 실행 큐 파일 없음이었다. | 로그인·DB 준비 중 실패한 queued 신고가 영구히 사라질 수 있다. 자식이 항목을 받아 처리한 결과를 내구적으로 확인한 뒤 ack/삭제하거나 실패한 실행의 항목을 재큐잉해야 한다. 시작 즉시 종료·큐 파일 읽기 전 종료·일부 항목 처리 후 실패·정상 완료 각각에서 재시작 후 남는 항목과 중복을 검사한다. 현재 Popen mock의 즉시 파일 읽기는 이 결함을 가린다. 정상 완료에서는 종료 후 파일 삭제이므로 자식의 정상 읽기와 직접 경쟁하지 않는다. |
| **R4-02 · 중간** | PC `crawl_manager.py:281-318`은 큐 snapshot→게이트 검사→파일/로그 작성→`start_crawl()`을 한 launch 잠금 없이 실행한다. 두 스레드가 같은 snapshot을 잡으면 첫 자식이 빨리 끝난 후 둘째도 같은 번호로 시작할 수 있다. `/tmp`의 두 동시 launch에서 실제 `start_crawl` 잠금과 즉시 종료 Popen을 써서 `launch_results=[True,True]`, 자식 입력이 모두 `SPP-DUPE`임을 확인했다. 첫 자식이 아직 살아 둘째 시작이 `False`여도 둘째는 **먼저** `current_crawl.log`를 `w`로 열어 첫 실행 로그를 지운다(`:299-309`). 다른 재현에서 시작 1회·둘째 실패인데 `FIRST_CHILD_OUTPUT`이 사라졌다. | 중복 크롤·불필요한 외부 요청 및 현재 로그 손상. snapshot부터 시작/큐 갱신까지 단일 launch 직렬화 또는 실행별 예약 상태를 두고, 로그도 시작 확정 전에는 교체하지 않아야 한다. 두 launch를 barrier로 동시 실행해 자식 입력 1회, 파일 1개, 로그 보존을 확인한다. 현 테스트 `test_storage_exchange.py:557-566`은 수동 `clear_process()`를 끼운 **순차** 실행이라 이 경쟁을 검출하지 않는다. |
| **R4-03 · 높음** | PC `crawl_manager.py:284-309`의 `_check_crawl_allowed()`는 `start_crawl()`의 상태 잠금·복원 hold 밖에서 한 번만 실행된다. 검사 통과 뒤 파일·로그 처리 사이에 복원이 완료되면 hold는 해제되고, 새 데이터셋에서 `community_rebuild.required()`가 참이어도 `start_crawl()`은 게이트를 다시 보지 않는다(`:63-87`). `/tmp`에서 게이트 통과와 `start_crawl` 사이에 복원 hold/새 초기화 필요 상태를 끼워 넣자 `rebuild_required_at_start=True`, 검사 1회, 자식 시작 1회였다. | 복원된 데이터셋에 필수 초기화 전에 일반 크롤이 쓸 수 있다. 복원 세대/게이트 판정과 실제 프로세스 시작을 같은 배타 경계에 묶거나, hold 해제 후 현재 세대를 다시 검사하고 변했으면 큐를 유지한다. 검사 통과→복원 완료→시작의 순서를 강제한 테스트가 필요하다. |
| **R4-04 · 높음** | 지도 `docs/integration/community-ingest/evidence/2026-09-26-audit4/neg-r3-02-no-gate.log:51`의 `assert_not_called` 실패는 `Popen` 호출의 `env={...}`를 통째로 기록하며 **실행 세션 토큰 환경변수의 값**을 포함한다. 이 로그는 `804a30b`에 추적·커밋돼 있다(`git ls-files` 확인). 보고서에는 값 자체를 옮기지 않았다. | 감사 증거를 공유/병합하면 자격 정보가 배포된다. 로그와 branch 기록에서 해당 값을 제거하고 유효한 토큰이면 폐기·재발급한다. mock 호출을 검증할 때 env를 출력하지 않는 단언 또는 사전 마스킹을 쓰고, 증거 artifact에 비밀 환경변수가 없는지 검사한다. |

### 게이트 지연과 브라우저 스모크

`crawl_control._check_crawl_allowed()`는 중앙 status가 오래되면 네트워크를 다시 확인한다(`community_gate.py:209-213`); account 요청 timeout은 10초(`community_account_client.py:17,48`). 완료 훅은 자식 `wait`·참조 해제 뒤 검사를 수행하므로 사용자 요청이나 `_state_lock`을 쥔 채 네트워크를 기다리지 않아 직접 교착은 확인되지 않았다. 하지만 완료 알림 뒤 대기 큐 시작과 지오코딩 재개(`crawl_manager.py:266-269`)가 그만큼 늦고, 검사와 시작 사이의 상태 변화는 R4-03이다. 중앙 장애 시 큐는 남지만 자동 재시도 timer는 없다.

전체 브라우저 로그의 한 실패는 `list-interactions`의 `beforeEach`가 30초 안에 `table.dataTable tbody tr`을 보지 못한 것이다(`pc-browser-smoke.log:53-73`). 제품 HTML은 DataTables JS/CSS를 외부 CDN에서 받는다(`web/templates/base.html:12-16,269-273`). 별도 원인 문서는 trace에서 CDN 요청의 `ERR_NETWORK_CHANGED`를 봤다고 기록하고, 같은 후보의 해당 스펙 재실행 16/16은 통과했다. **원본 trace는 재실행 후 worktree에 남아 있지 않아** 네트워크 오류 자체는 독립 확인하지 못했다. CDN 의존성과 재실행 결과에 비춰 일시 네트워크 실패 설명은 타당하지만, 전체 128건을 같은 실행에서 통과했다고 기록할 수는 없다. 이번 PC 제품 diff에는 표/브라우저 코드가 없다.

## SOL-01~10 최종 상태

| ID | 상태 | 근거·한계 |
|---|---|---|
| SOL-01 | 닫힘 | ACK 코드 변경 없음; audit3 모바일·PC 및 audit4 PC 단위/실스택 확인. |
| SOL-02 | 닫힘 | 혼합 DB의 미지 열 거부·정상 복원과 유효한 음성 대조는 3차에서 확인; 모바일 변경 없음. |
| SOL-03 | 닫힘 | NULL/빈 `entry_value` 변환 변경 없음; audit4 왕복 `diff_count=0`. |
| SOL-04 | **부분** | DB 교체 중 기존 쓰기/자식 경쟁은 닫힘. 복원 뒤 자동 큐의 R4-01·R4-03 높음 위험 잔존. |
| SOL-05 | 닫힘 | 모바일 사본·설정 되돌리기/모드 상태 3차 판정 유지; 제품 변경 없음. |
| SOL-06 | 닫힘 | 지도 `point_count`·완료 전용 빈 상태 수정 유지; 제품 변경 없음. 완료 전용 실제 브라우저는 미검증. |
| SOL-07 | 닫힘 | 결측 좌표 집계 변경 없음. |
| SOL-08 | 닫힘 | entities API 호환 코드 변경 없음; 대량 실브라우저 네트워크 비용은 미측정. |
| SOL-09 | 닫힘 | compose 명시 경로 변경 없음. |
| SOL-10 | 닫힘 | body 제한 변경 없음. |

## 결론

**수정 후 재검토.** 요청한 3차의 직접 재현은 통과했고 네 음성 대조는 목표 단언에서 실패했다. 그러나 큐 항목의 **자식 처리 전 삭제(R4-01)**, **복원 후 초기화 게이트의 시점 경쟁(R4-03)**, **커밋된 증거의 토큰 값 노출(R4-04)**은 높음 미해결이다. 동시 launch의 중복/로그 손상(R4-02)도 고쳐야 한다. 이들을 수정하고 민감 증거를 branch 기록에서 제거한 뒤 새 후보의 동시성·실패 경로 검사 결과로 재판정해야 한다.
