# GPT-6-Sol · 7일 감사 수정 2차 재검증

## 범위와 증거

네 `ci0926/audit-fix` worktree를 읽기 전용으로 확인했다. PC `255247b..57a8cb3`(5개 파일), 모바일 `ff7530c3..c52a12c7`(3개 파일), 지도 `7f7e3af..f6b1e0d`(제품 수정 `e284c86`, Muse `e11ebb2` 병합 포함), 인증 `5a4d678..1dddcc4`(QA 결과·스크린샷 13개, 제품 코드 변경 없음)의 diff와 관련 호출 경로·테스트를 읽었다. 이전 판정인 `audit-sol-recheck.md`, 반영 문서 `audit-resolution.md`, `evidence/2026-09-26-audit2/`의 명령·candidate·dirty·exit 및 실패 본문을 대조했다. 대상 worktree, 목표 branch, 실행 중인 스택 DB는 수정하지 않았다.

양성 로그는 PC 단위 382개 통과·4개 skip, 실스택 1개, 브라우저 128개, DB 왕복 `diff_count=0`; 모바일 단위 523개 통과·3개 skip, 실스택 1개, `flutter analyze` 무문제; 지도 단위 88개·타입 검사·빌드, 스택 21개씩 두 차례, Deno 4함수 검사·compose check; 인증 단위 38개 통과·35개 stack skip과 별도 relay 24개·브라우저 11개 통과다. 지도 제품 로그의 candidate `e284c86` 뒤 최종 `f6b1e0d`까지는 문서·증거 추가다. 실제 `map-page.png`는 1신고/1완료 화면이므로 완료일만 포함된 화면의 브라우저 검증 증거는 아니다.

## SOL-01~10 판정

| ID | 판정 | 코드·테스트 검토 결과 |
|---|---|---|
| SOL-01 | **닫힘 유지** | 모바일 durable ACK 재전송 제한과 PC ACK 대기 정리 코드에 이번 제품 diff 없음. 양쪽 전체 단위·실스택 로그 통과. |
| SOL-02 | **부분 — 검출력 미입증** | 모바일 `lib/services/local_db_service.dart:2975-3018`은 각 분류의 상세 표 유무에 따라 실제 읽는 원본/merge 표를 골라 NULL 아닌 미지 열을 교체 전에 거부한다. 이는 `:2924-2944`의 읽기 분기와 일치하여 앞서 지적한 혼합 구버전 DB의 무음 손실 경로를 코드상 닫는다. 그러나 새 테스트 `test/storage/server_import_test.dart:156-170`의 `mysafety`는 `ID`만 있어, 옛 가드를 쓴 음성 대조가 목표인 손실/오검출에 도달하지 못하고 `SELECT d.*,  FROM ...` 문법 오류로 실패했다. `neg-mobile-sol02-guard-before-recheck.log:13-37`의 실패를 결함 검출 증거로 셀 수 없다. 정상적인 제목 열을 가진 혼합 DB에서 성공 경로와 미지 열 거부를 함께 검사하고, 옛 가드에서 실제 미지 열 손실 또는 기대 예외 부재로 실패하는 음성 대조가 필요하다. 기존 정상/NULL 열 복원 테스트는 통과한다. |
| SOL-03 | **닫힘 유지** | 빈 문자열/NULL의 `entry_value` 변환 코드는 이번 diff에서 그대로이고 양쪽 단위·왕복 검사 통과. |
| SOL-04 | **부분 — 높음 미해결** | PC `services/crawl_manager.py:35-49,60-84`의 `hold_for_restore`와 `start_crawl`은 같은 `_state_lock`으로 검사와 시작을 직렬화하고, `core/storage/exchange.py:358-375`는 hold 다음 write barrier를 얻는다. 두 잠금의 검사 구간에서 `_state_lock`을 계속 쥐고 배리어를 기다리지 않으므로 검토한 경로에는 직접적인 잠금 순환이 없다. `tests/test_storage_exchange.py:344-400`은 복원 중 신규 시작 거부와 실행 중 크롤의 복원 거부를 검증한다. 하지만 `/crawl/kill`로 종료 요청 직후 프로세스 참조를 지워, 살아 있는 자식과 DB 교체가 겹칠 수 있다(아래 R2-01). 복원과 대기 큐가 겹치면 큐가 자동 재개되지 않는 경로도 남는다(R2-02). 쓰기 장벽의 다른 엔진 생성 경로는 이전 검증과 동일하며 이번 diff에서 새 우회는 발견하지 못했다. |
| SOL-05 | **부분** | 모바일 `local_db_service.dart:2831-2850`의 되돌리기는 최신 직전 사본을 복원하며 복원 직전 DB도 새 사본으로 보관한다. `test/storage/server_import_test.dart:224-242`의 A→B→A→B 서비스 테스트는 통과한다. 설정 `settings_screen.dart:575-619,1818-1831`에는 단독 모드 확인·버튼·새로고침이 붙었다. 다만 모드/데모 DB 전환 뒤 같은 화면의 사본 표시 상태가 갱신되지 않는다(R2-03). 버튼 위젯과 실제 사용자 선택/확인 흐름의 자동화 또는 실기기 증거도 없다. |
| SOL-06 | **닫힘** | 지도 `server/aggregate.ts:267-274,337`가 `point_count`를 신고일 범위의 위치 있는 고유 지점 수로 복귀시키고 지도 점은 신고일/완료일 합집합으로 유지한다. `src/pages/Dashboard.tsx:39-44,246`의 빈 결과 판정은 신고·완료·점 모두 0일 때만 참이다. 새 테스트 `tests/product/afMap2PointCount.test.tsx:30-78`이 완료일만 포함된 범위의 지표/점/빈 결과를 검사한다. 독립 읽기 전용 집계 재현에서도 신고 0, 완료 1, `point_count={value:0,basis:'report_date',denominator:0}`, 완료 점 1개였다. 테스트의 빈 배너 부분은 실제 Dashboard 렌더 대신 helper로 문자열을 조립하지만, Dashboard가 같은 helper를 호출하는 점은 코드에서 확인했다. 완료 전용 실제 브라우저 화면은 미검증이다. |
| SOL-07 | **닫힘 유지** | 좌표 결측 집계 코드에 이번 diff 없음. 지도 단위·스택 로그 통과. |
| SOL-08 | **닫힘 유지** | `/entities` 기본 응답·검색·정렬·페이지 코드에 이번 diff 없음. 지도 단위·스택 및 브라우저 로그 통과. 105행 실제 브라우저 네트워크 검증은 이번에도 별도 증거 없음. |
| SOL-09 | **닫힘 유지** | compose 경로 필수화 코드에 이번 diff 없음. `compose-check.log` 통과. |
| SOL-10 | **닫힘 유지** | 요청 본문 스트림 제한 코드에 이번 diff 없음. 지도·인증 단위/relay 로그 통과. 인증 최신 commit은 QA 파일만 변경. |

## 새 결함·음성 대조 평가

| ID·심각도 | 파일:줄·재현/원인 | 영향·수정 및 필요한 회귀 검사 |
|---|---|---|
| **R2-01 · 높음** | PC `services/crawl_manager.py:86-93`의 `stop_crawl()`은 `terminate()` 직후 `wait()`/`poll()` 완료 확인 없이 `_active_process=None`으로 만든다. `web/routers/crawl.py:65-69`의 지원되는 `/crawl/kill` 경로에서 이 함수가 호출된다. 즉시 `hold_for_restore()`는 자식이 아직 살아 있어도 `:40`의 실행 중 검사를 통과한다. 읽기 전용 mock 재현에서 `terminate_calls=1`, `child_still_alive=True`인 상태로 `restore_hold_entered_while_child_alive=True`를 확인했다. | 종료 신호 수신과 실제 종료 사이에 별도 프로세스 크롤러가 DB를 쓸 수 있어 복원 교체 시 기록 손실 가능. 자식 종료를 확인·회수하기 전에는 실행 중 참조를 지우지 말고 복원을 막아야 한다. `terminate()` 뒤 `poll() is None`인 지연 종료 자식을 가진 테스트에서 복원 거부, 종료 확인 후 복원 허용을 검사한다. |
| **R2-02 · 중간** | PC `services/crawl_manager.py:178-180`은 완료 시 대기 큐를 꺼낸다. 복원 중 `launch_pending_crawl()`의 시작이 차단되면 `:211-215`가 메모리 큐에 되넣고 끝난다. `hold_for_restore()`의 `finally`(`:47-49`)에는 자동 재개가 없고 `pop_pending()`의 다른 호출자는 없다. 테스트 `tests/test_storage_exchange.py:371-380`도 큐에 남은 항목을 직접 꺼내 확인할 뿐 자동 시작은 확인하지 않는다. `pending_queue.txt`는 시작 시에만 써지며 재시작 시 큐 로드 경로가 없다. | 다음 크롤이 우연히 완료될 때까지 신고가 처리되지 않고 프로세스 재시작 시 메모리 큐가 사라질 수 있다. 복원 hold 해제 및 write barrier 해제 후 한 번만 재개하도록 순서를 보장하고, 재시작에도 복구할 내구성 있는 큐를 사용한다. 복원과 완료를 교차시킨 테스트에서 자동 처리 1회와 재시작 보존을 확인한다. |
| **R2-03 · 낮음** | 모바일 `lib/screens/settings_screen.dart:88,423-440,568-573,1818-1831`은 사본 경로를 화면 시작·복원 후에만 갱신한다. 같은 화면에서 `ReportProvider.setStandaloneConfig()`로 실 DB↔데모 DB를 바꾸면 `LocalDbService.getDbPath()` 대상은 바뀌지만 `_previousImportBackup`은 이전 DB의 표시 상태로 남는다. `revertToPreviousImport()`는 실행 시 현재 DB 사본을 재조회하므로 이 상태만으로 다른 DB를 덮어쓰지는 않는다. | 사본이 없는 모드에서 버튼이 보이거나 사본이 있는 모드에서 버튼이 숨을 수 있다. 설정 변경 뒤 사본 상태를 다시 읽고, 두 DB의 사본 유무를 다르게 둔 설정 위젯 테스트로 표시와 실제 동작을 확인한다. |

PC 음성 대조 `neg-pc-sol04-no-crawl-hold.log`는 사용자 설명대로 수정 전 `255247b`의 **dirty 3** 작업 트리에서 실행됐다. 첫 테스트는 복원 hold assertion 실패로 필요한 방어의 검출력을 보여준다. 두 번째 테스트는 첫 실패가 `proceed.set()` 전에 종료되어 남은 스레드가 공유 fixture에 닿으면서 `UNIQUE constraint failed mysafety_geocode_cache.주소정규화`로 setUp에서 오류가 났다. 이는 두 번째 시나리오의 독립 검출 증거가 아니다. 테스트에서 `finally`로 스레드를 반드시 해제·join하고 각 음성 대조를 따로 실행해야 한다. 모바일 음성 대조의 `candidate c52a12c7 dirty 1`은 과거 가드를 임시 적용했다는 로그 설명과 일치하지만, 위 SQL 문법 오류 때문에 목적 결함을 검출했다고 볼 수 없다.

SOL-04의 hold→barrier 순서는 스테이징·교체 동안 새 크롤 시작을 막는 데 맞고, 현재 확인한 경로에서 잠금 교착은 재현되지 않았다. 다만 이 순서는 종료 중 자식 추적과 대기 큐 자동 재개를 보장하지 않는다. SOL-02의 과잉 거부 여부는 정상 혼합 DB 성공 사례가 빠져 미검증이다. SOL-05의 버튼은 단독 모드에서만 보이지만 데모/실 DB별 상태는 R2-03과 같다. AF-MAP2의 API `point_count` 의미·빈 결과 분기는 앞선 의미 회귀를 해결했다.

## 결론

**수정 후 재검토.** SOL-04에 **높음 미해결**인 종료 중 자식과 복원 교체의 경쟁(R2-01)이 남는다. SOL-02는 코드 수정은 타당하나 음성 대조가 다른 오류로 실패해 목표 결함에 대한 회귀 검출력이 입증되지 않았다. 대기 큐 자동 처리·내구성(R2-02)과 설정의 사본 표시 상태(R2-03)도 고친 뒤, 각 경계 사례의 독립 테스트와 새 candidate 로그를 확인해야 한다.
