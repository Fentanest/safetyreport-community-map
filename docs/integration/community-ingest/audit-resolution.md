# 최근 7일 감사 반영 (Opus5.5, 2026-09-26)

대상: `audit-sol-findings.md`(GPT-6-Sol, 감사 창 `audit-window.md`). 판정 "완료·배포 가능 아님"(높음 3, 중간 7).
각 finding 은 Opus 가 코드로 재현·확인한 뒤 고쳤다. SOL-06·07·08 은 파일 소유를 나눠 **Muse Spark Contributor**
(`opencode-go/muse-spark-1.3-contributor`, worktree `community-map/audit-fix-muse`, branch `ci0926/audit-fix-muse`)가 병렬로 구현했고
Opus 가 diff 를 검토·병합했다. 감사 수정 branch 는 네 저장소 모두 `ci0926/audit-fix`(base = 1차 머지 HEAD).
Gemini(agy) 보조 조사는 구독 할당량 소진(429, 약 94시간 뒤 초기화)으로 **blocked** — 다른 유료 API 로 바꾸지 않았다.

| ID | 심각도 | 확인 | 수정 | 수정 commit | 회귀 테스트(음성 대조) |
|---|---|---|---|---|---|
| SOL-01 | 중간 | 모바일 `_enqueueUnacked` 에 `j.ack_status IS NULL` 없음 확인 | 조건 추가 + ACK 뒤 남은 대기 행 정리. PC 도 같은 정리 단계(동등성) | mobile `004aa62c`, PC `9f3e6b9` | M `uploader_test.dart` "SOL-01 …"(accepted/duplicate/no_change/quarantined × manual/midnight/recovery 전송 0, 미ACK 는 전송) — 옛 쿼리로 실패. PC `test_sol01_…` — 정리 단계 없으면 실패 |
| SOL-02 | 높음 | PC `apply_mobile_snapshot`·모바일 `importFromServerDb` 가 모르는 열을 여과로 버림 | 두 방향 모두 변환 대상 표의 모르는 열에 NULL 아닌 값('' 포함)이 있으면 교체 전 오류(PC `exchange.UnknownColumns` ⊂ `RestoreRefused` → 409, 모바일 `UnknownColumnsException`). 모두 NULL 인 열은 통과(잃는 값 없음). PC 의 아는 열 목록 = 계약 mobile 열(테스트로 대조) | PC `17f035b`, mobile `ff7530c3` | PC `test_known_mobile_columns_match_the_contract`, `test_unknown_column_with_values_refuses_…`, `…all_null…`; M `server_import_test.dart` SOL-02 2건 — 가드 호출을 빼면 실패 |
| SOL-03 | 높음 | PC `if r.get('entry_value')`, 모바일 `?? ''` 확인 | 서버 행 없음 ↔ 모바일 NULL, 행의 값(빈 문자열 포함) ↔ 같은 값. 앱에 열이 있으면 앱 값이 원천, 열 없는 구앱이면 서버 값 유지 | PC `17f035b`, mobile `ff7530c3` | PC `test_entry_value_follows_the_app_exactly_…`(빈 문자열 덮음·NULL 행 없음·구앱 유지); M SOL-03 1건 — 옛 `?? ''` 로 실패 |
| SOL-04 | 높음 | 복원이 staging 복사 뒤 교체까지 다른 요청의 커밋을 막지 않음 | `core/database/write_barrier.py`: 운영 DB 엔진 연결 풀에 장벽. `exclusive()` 는 빌려 간 연결 반납을 기다리고(20초 → 409 거절, 아무것도 안 바꿈), 그동안 새 연결은 대기. `checkout` 은 연결을 연 뒤 불리므로 교체 전 세대의 연결은 `DisconnectionError` 로 버리고 새 파일로 다시 연다 | PC `17f035b` | PC `test_write_committed_while_restore_waits_is_kept`, `test_connections_opened_during_restore_wait_and_write_to_the_new_db`, `test_restore_refuses_when_a_connection_is_never_returned` — 장벽을 끄면 3건 모두 실패. 한계: 프로세스 안 장벽이다(크롤러 서브프로세스는 복원이 이미 거부, 텔레그램 봇은 읽기만) |
| SOL-05 | 중간 | `_commitImportedDatabase` 가 성공 뒤 `.bak` 삭제 | 성공해도 `<db>.before_import.<ms>.bak` 보존(최근 3개), 실패로 되돌렸을 때만 삭제. `LocalDbService.latestImportBackup()` | mobile `ff7530c3` | M SOL-05 1건(직전 DB 내용·보존 개수) |
| SOL-06 | 중간 | 이전 달 신고·이번 달 완료 1건 → `completed=1, points=[]` 재현 | 신고일·완료일 위치 키 합집합으로 점 생성, 점마다 신고·완료 건수 독립. 완료만 있는 점의 클러스터 중심 0 나눗셈 방지 | Muse `16ba87b`, 병합 `406dd66` | MAP `tests/product/auditSol060708.test.tsx` 2건(불변식 overview 완료 = 점 합 + 좌표 결측) |
| SOL-07 | 중간 | 비교 기간만 속한 결측 1건 → `location_missing=1` 재현 | 현재 범위 신고일·완료일 지표에 실제 포함된 고유 fact 중 좌표 결측만 | 같음 | 같은 파일 2건 |
| SOL-08 | 중간 | 표가 dashboard 상위 100개만 검색·정렬 | `/entities` 에 하위호환 `q`·`sort`·`dir`(없으면 예전 순서·필드 그대로, 다른 경로는 400), 표는 live 모드에서 `/entities` 로 전체 검색·정렬·페이지. dashboard 100개는 요약 | 같음 + 문서 `82ae871` | 같은 파일 4건(105개 기관 fixture 에서 100번째 뒤 검색·전체 정렬·페이지·실제 핸들러 렌더) |
| SOL-09 | 중간 | 정리된 contributor worktree 를 기본 auth 경로로 씀 | `--auth <dir>` 또는 `SR_AUTH_REPO` 필수, 없거나 잘못된 경로는 exit 2 와 문장. 배포 문서에 정확한 명령 | MAP `155d289` | MAP `tests/product/composeScript.test.ts` 2건 |
| SOL-10 | 중간 | account·relay·ingest 가 본문 전체를 읽은 뒤 크기 검사 | 공용 bounded reader: 선언 길이 초과·숫자 아님은 읽지 않고, 선언이 없거나 거짓이어도 상한을 넘는 순간 스트림 취소. auth `server/adapters.ts readBodyLimited`(두 함수가 이미 공유하는 파일 — manifest 변경 없음), map `server/ingest/handler.ts` | auth `5a4d678`, MAP `155d289`·`1bd22ba` | auth `tests/body-limit.unit.test.ts` 4건 + relay 1건, MAP `ingestHandler.test.ts` 1건 — 옛 코드는 끝없는 본문을 끝까지 읽어 끝나지 않음(시간 초과로 확인) |

## 함께 고친 것 (통합 검토 5차 조건)
- PC 삭제 응답의 두 후처리 문제 동시 안내(Sol 5차 낮음): PC `728d75f`, 브라우저 스펙 `community-delete-message.spec.ts`(4조합, chromium·firefox).
- 모바일 `flutter analyze` 0건(Sol 5차 (a)): mobile `8e04a474` — async 뒤 context 사용 6곳에 `mounted` 확인, 쓰이지 않는 배지 인자 제거,
  Radio → `RadioGroup`, 드롭다운 `value` → `initialValue`(이 Flutter 3.41.6 은 `initialValue` 변경을 반영 — `dropdown.dart` `didUpdateWidget`), 분석기 기계 수정.
  위젯 테스트 `duplicate_editor_radio_test.dart`(실제 로컬 DB, 대표 후보 선택 → "수동 고정").

## 재검토 때 보아야 할 의미 변화
- 지도 `point_count` 는 이제 신고일·완료일 위치의 합집합(화면에 그려지는 점 수)이고 비교 기간 값도 같은 기준이다. 지표의 `basis` 표기는 `report_date` 그대로다.
- 서버 복원·모바일 가져오기는 모르는 열에 값이 있으면 **거부**한다(예전엔 성공). 새 앱 백업을 옛 서버로 복원하려면 서버를 먼저 올려야 한다.
- 모바일은 가져오기·복원마다 직전 DB 사본을 남긴다(최근 3개, 디스크 사용 증가).

## 실행 결과 (`evidence/2026-09-26-audit/`, 머리말에 명령·후보 SHA·종료 코드)
후보: PC `255247b`, mobile `ff7530c3`, map `82ae871`(+ 이 문서 commit), auth `5a4d678`. 모두 `ci0926/audit-fix`.
합성 스택은 같은 `ci0926-int` DB(migration 변경 없음 — 합성 결과의 config·env·migration 이 기존과 바이트 동일)에서 함수만 감사 수정 코드로 다시 띄웠다.

| 영역 | 결과 |
|---|---|
| PC 단위 / 실스택 / 브라우저 스모크(chromium+firefox) | 380 OK(skip 4) / 1 OK / 128 passed |
| 서버↔모바일 왕복(`scripts/dev/db_roundtrip_check.py`) | diff_count 0 |
| mobile 단위 / 실스택 / analyze | 521 passed(3 skipped) / 1 passed / **No issues found**(exit 0) |
| map 단위+tsc+build / 실스택 ×2 / Deno 2.9.7 4함수 / compose check | 85 passed / 21·21 / 4 ok / ok |
| auth 단위+tsc / relay 실스택 / 브라우저 | 38 passed(35 stack skip — 아래 두 줄에서 실행) / 24 passed / 11 passed |
| 지도 화면(실제 브라우저, live 모드) | 표가 `/entities` 전체 조회 모드(캡션 "전체 N건 · 서버 검색·정렬"), 검색·정렬 요청 200, 콘솔 오류 0 — `map-entities.png`, `map-page.png` |

auth relay·브라우저 첫 실행은 감사 worktree 에 로컬 스택 접속 파일(`.safeauth-stack/stack.env`, git 무시)과 로컬 사이트 서버가 없어 실행되지 못했다(skip·연결 거부). 같은 `safeauth-local` 스택의 파일을 복사하고 `tests/stack/build-local.sh` + `serve-local.ts` 를 띄운 뒤 위 결과를 얻었다.

## Sol 재검증(`audit-sol-recheck.md`, "수정 후 재검토") 반영

| ID | 재검증 지적 | 조치 | commit | 회귀 테스트 / 음성 대조 로그 |
|---|---|---|---|---|
| SOL-02 | 모바일 가드는 상세 표가 **하나라도** 있으면 merge 표를 모두 건너뛰는데, 읽기는 **분류별**로 상세 표가 없으면 merge 를 읽는다(혼합 구버전 DB) | 가드가 분류마다 `_readServerReportRows` 와 같은 조건으로 표를 고른다 | mobile `c52a12c7` | `server_import_test.dart` "mixed old DB …" — 음성 대조 `evidence/2026-09-26-audit2/neg-mobile-sol02-guard-before-recheck.log`(표 선택만 되돌리면 실패) |
| SOL-04 | 복원이 `is_crawling()` 을 장벽 전에 한 번만 보고, 크롤러(별도 프로세스)는 복원 장벽을 보지 않음 | `crawl_manager.hold_for_restore()` — 크롤 시작과 **같은 잠금**에서 "크롤 중 아님" 확인과 "복원 중" 표시를 한 번에. 복원 동안 `start_crawl` 은 `CrawlBlockedByRestore`, 대기 큐 자동 시작은 신고번호를 큐로 되돌림. 복원은 hold → 쓰기 장벽 순서 | PC `57a8cb3` | `test_crawler_cannot_start_while_a_restore_is_running`, `test_restore_is_refused_atomically_when_a_crawl_is_running` — 음성 대조 `neg-pc-sol04-no-crawl-hold.log`(hold 를 빼면 2건 실패) |
| SOL-05 | 남긴 사본을 사용자가 되돌릴 화면 경로가 없음 | 설정(단독 모드)에 "직전 DB 로 되돌리기" — `LocalDbService.revertToPreviousImport()`(되돌리기도 복원이라 바뀌기 전 DB 를 다시 사본으로 남겨 되돌리기를 되돌릴 수 있음) | mobile `c52a12c7` | `server_import_test.dart` "the settings revert …"(A→B 가져오기 → 되돌리기 A → 다시 B). 설정 화면 버튼 자체의 위젯 테스트는 없다(SettingsScreen 위젯 테스트 틀이 저장소에 없음) — **미검증** |
| SOL-06 | `point_count` 가 합집합을 세며 basis/분모/문구와 어긋나고, 완료만 있는 범위에 빈 결과 안내 | Muse(AF-MAP2): `point_count` 는 신고일 기준 위치 수로 복원(지도 점은 합집합 유지, 지도 부제·대체 목록에 안내), 빈 결과는 신고·완료·점이 모두 없을 때만 | Muse `e11ebb2`, 병합 `b09b9ef`, 문서 `e284c86` | `tests/product/afMap2PointCount.test.tsx` 3건(8월 신고·9월 완료 1건 → point_count 0/basis report_date/분모 0, 점 1개, 빈 배너 없음) |

음성 대조: 1차 반영의 음성 대조는 이 대화에서 실행했지만 로그를 남기지 않았다(Sol 지적 그대로). 재검증 반영분부터 `neg-*.log` 로 남긴다.

### 재검증 반영 후 실행 결과 (`evidence/2026-09-26-audit2/`)
후보: PC `57a8cb3`, mobile `c52a12c7`, map `e284c86`(+ 이 문서 commit), auth `5a4d678`(제품 코드) / `1dddcc4`(브라우저 QA 결과 파일 갱신만).
함수는 감사 수정 코드로 다시 합성해 띄웠다(config·env·migration 바이트 동일).

| 영역 | 결과 |
|---|---|
| PC 단위 / 실스택 / 브라우저 스모크 | 382 OK(skip 4) / 1 OK / 128 passed |
| 서버↔모바일 왕복 | diff_count 0 |
| mobile 단위 / 실스택 / analyze | 523 passed(3 skipped) / 1 passed / No issues found |
| map 단위+tsc+build / 실스택 ×2 / Deno 4함수 / compose check | 88 passed / 21·21 / 4 ok / ok |
| auth 단위 / relay / 브라우저 | 38 passed / 24 passed / 11 passed |
| 지도 화면(live) | 표 서버 조회·검색·정렬 요청 200, 콘솔 오류 0 (`map-entities.png`, `map-page.png`) |
| 음성 대조 | `neg-pc-sol04-no-crawl-hold.log`(exit 1 기대), `neg-mobile-sol02-guard-before-recheck.log`(exit 1 기대) |

auth relay 첫 실행(스크립트 순서상)은 브라우저 시험용 serve-local 이 mock Kakao 포트 54410 을 잡고 있어 시작하지 못했다(EADDRINUSE, 24 skip). serve-local 을 멈춘 뒤 다시 실행한 결과가 위 24 passed 이고 로그는 그 실행으로 덮었다.

## Sol 2차 재검증(`audit-sol-recheck-02.md`, "수정 후 재검토") 반영

| ID | 지적 | 조치 | commit | 회귀 테스트 / 음성 대조(각각 따로 실행, `evidence/2026-09-26-audit3/neg-*.log`) |
|---|---|---|---|---|
| R2-01 높음 | `stop_crawl()` 이 `terminate()` 직후 참조를 지워, 살아 있는 크롤러와 복원이 겹칠 수 있음 | 종료를 기다려(10초 뒤 kill) **끝난 것을 확인한 뒤에만** 참조를 지움. 끝나지 않으면 참조 유지 → `is_crawling`·`hold_for_restore` 가 계속 막음. `clear_process(proc)` 는 같은 프로세스일 때만 지움 | PC `b752efe` | `test_a_stopped_crawler_that_is_still_alive_keeps_blocking_restore`, `test_stop_clears_the_reference_only_after_the_crawler_exits` / `neg-r2-01-clear-on-terminate.log`(옛 동작 → "살아 있으면 참조를 지우지 않는다" 실패) |
| R2-02 중간 | 복원과 겹쳐 되돌린 대기 큐가 자동 재개되지 않고, 재시작하면 사라짐 | 큐를 `data/crawl_pending_queue.json` 에도 저장(재시작 뒤 복구, 시작 때 자동 크롤은 안 함). hold 해제(쓰기 장벽도 이미 해제) 뒤 한 번 재개 — 복원은 데이터셋을 회전시켜 초기화가 필요할 수 있으므로 일반 크롤 허용 검사(게이트·초기화)를 통과할 때만, 막히면 큐에 남김 | PC `b752efe` | `test_pending_queue_resumes_once_after_restore_and_survives_a_restart` / `neg-r2-02-no-resume.log`, `neg-r2-02-no-persist.log` |
| SOL-04 테스트 | 첫 음성 대조가 스레드를 풀지 못해 둘째 테스트가 setUp 오류 | 테스트가 `try/finally` 로 스레드를 반드시 풀고 join, 공유 상태 정리(`addCleanup`). 음성 대조를 테스트별로 따로 실행 | PC `b752efe` | `neg-sol04-no-hold-start.log`, `neg-sol04-no-hold-atomic.log`(둘 다 단언 실패) |
| SOL-02 테스트 | 새 테스트의 `mysafety` 가 ID 만 있어 음성 대조가 SQL 문법 오류로 실패(검출력 미입증) | 정상 제목 열을 가진 혼합 DB 로 다시 작성: 성공 경로(traffic 은 원본, parking 은 merge) + 거부 | mobile `e25b4eb6`·`2debce44` | `neg-mobile-sol02-guard-before-recheck.log` — 옛 가드에서 성공 경로는 통과하고 거부 테스트만 "예외 없이 가져오기 완료"로 실패 |
| R2-03 낮음 | 실 DB ↔ 데모 DB 전환 뒤 되돌리기 버튼 표시가 옛 DB 기준 | 설정 화면이 provider 를 듣고 모드·데모가 바뀌면 사본 여부를 다시 읽음 | mobile `e25b4eb6` | `test/widgets/settings_revert_button_test.dart`(SettingsScreen 실제 렌더: 실 DB 버튼 보임 → 데모 숨김 → 실 DB 보임 → 확인 대화상자 → 실제 되돌림) / `neg-r2-03-no-listener.log` |

SOL-06 은 2차에서 닫혔다(완료일만 든 범위의 실제 브라우저 화면은 미검증).

### 2차 재검증 반영 후 실행 결과 (`evidence/2026-09-26-audit3/`)
후보: PC `b752efe`, mobile `2debce44`, map 제품 코드 `e284c86`(변경 없음), auth 제품 코드 `5a4d678`(변경 없음).

| 영역 | 결과 |
|---|---|
| PC 단위 / 실스택 / 브라우저 스모크 | 385 OK(skip 4) / 1 OK / 128 passed |
| 서버↔모바일 왕복 | diff_count 0 |
| mobile 단위 / 실스택 / analyze | 525 passed(3 skipped) / 1 passed / No issues found |
| map 단위+tsc+build / 실스택 / Deno 4함수 / compose | 88 passed / 21 / 4 ok / ok |
| auth 단위 / relay | 38 passed / 24 passed (브라우저 11/11 은 같은 auth 코드로 `audit2`) |
| 음성 대조(각각 따로) | `neg-r2-01-clear-on-terminate`, `neg-r2-02-no-resume`, `neg-r2-02-no-persist`, `neg-sol04-no-hold-start`, `neg-sol04-no-hold-atomic`, `neg-mobile-sol02-guard-before-recheck`, `neg-r2-03-no-listener` — 모두 목표 단언에서 실패(exit≠0) |

## Sol 3차 재검증(`audit-sol-recheck-03.md`, "수정 후 재검토") 반영

R2-01·R2-03·SOL-02·SOL-05 는 3차에서 닫혔다. 대기 큐 경로의 새 결함을 **모든 자동 시작의 한 경계**(`crawl_manager.launch_pending_crawl()`)로 모아 고쳤다.

| ID | 지적 | 조치 | commit | 회귀 테스트 / 음성 대조(`evidence/2026-09-26-audit4/neg-*.log`, 각각 따로) |
|---|---|---|---|---|
| R3-01 높음 | 큐를 먼저 비운 뒤 시작 실패 시 항목 유실, 고정 `pending_queue.txt` 덮어쓰기 | 시작에 **성공한 뒤에만** 그 항목을 큐에서 뺌(실패·복원 중이면 그대로). 실행마다 `pending_queue_<uuid>.txt`, 크롤이 끝나면 삭제 | PC `cb1305d` | `test_pending_items_stay_when_the_start_fails_and_each_run_gets_its_own_queue_file`(실제 launch 경로, Popen 만 가짜 — 자식이 읽을 파일 내용을 시작 순간 기록) / `neg-r3-01-remove-before-start.log`, `neg-r3-01-fixed-queue-file.log` |
| R3-02 높음 | 크롤 완료 훅의 대기 큐 시작이 게이트·초기화 검사를 건너뜀 | 경계 안에서 일반 크롤과 같은 `_check_crawl_allowed()`(게이트 60초 재검증·1회 초기화) — 막히면 시작 0·큐 보존. 완료 훅·복원 뒤 재개 모두 이 경계만 부름 | PC `cb1305d` | `test_crawl_completion_does_not_start_the_queue_while_a_rebuild_is_required`(실제 `run_after_crawl`) / `neg-r3-02-no-gate.log`(검사를 빼면 크롤러 시작 1회) |
| R3-03 중간 | 큐 파일 저장 실패를 숨기고 "대기열에 넣음" 응답 | 저장(파일 fsync + 원자 교체) 실패 시 메모리 추가를 되돌리고 `RuntimeError` → API 500 문장(대기열 응답 없음) | PC `cb1305d` | `test_a_queue_that_cannot_be_saved_is_reported_not_silently_kept_in_memory`(`crawl_control.enqueue_report` 까지) / `neg-r3-03-swallow-save.log` |

남는 한계(3차 보고서 그대로): 여러 서버 worker 간 같은 큐 파일 동시성은 단일 worker 구성이라 미검증, 크롤 중지의 최대 15초 대기에 따른 프록시 timeout 은 미측정.

### 3차 재검증 반영 후 실행 결과 (`evidence/2026-09-26-audit4/`, PC 만 변경)
후보 PC `cb1305d`. mobile `2debce44`·map 제품 `e284c86`·auth 제품 `5a4d678` 은 audit3 과 같다(그 로그가 유효).

| 영역 | 결과 |
|---|---|
| PC 단위 / 서버↔모바일 왕복 / 실스택 | 388 OK(skip 4) / diff_count 0 / 1 OK |
| PC 브라우저 스모크 | 127 passed, **1 failed** — chromium `list-interactions` 1건: 외부 CDN `cdn.datatables.net` 스크립트가 `net::ERR_NETWORK_CHANGED` 로 받아지지 않아 표 미초기화(제품 서버 `/data/all` 은 200). 원인 `pc-browser-smoke-failure-cause.txt`, 같은 스펙 chromium+firefox 재실행 16/16 passed(`pc-browser-smoke-rerun-list-interactions.log`) |
| 음성 대조(각각 따로) | `neg-r3-01-remove-before-start`, `neg-r3-01-fixed-queue-file`, `neg-r3-02-no-gate`, `neg-r3-03-swallow-save` — 모두 목표 단언에서 실패 |

## Sol 4차 재검증(`audit-sol-recheck-04.md`, "수정 후 재검토") 반영

| ID | 지적 | 조치 | commit | 회귀 테스트 / 음성 대조(`evidence/2026-09-26-audit5/neg-*.log`, 각각 따로) |
|---|---|---|---|---|
| R4-04 높음 | 커밋한 음성 대조 로그(`audit4/neg-r3-02-no-gate.log`)에 mock 호출 인자로 **환경 변수 전체**(실행 세션 토큰 포함)가 찍힘 | ① 해당 줄을 지운 사본으로 **로컬 커밋을 고침**(map `804a30b` → `bfc9edd`, push 한 적 없음). 이 branch·HEAD reflog 만료 — 어떤 ref 도 옛 commit 을 가리키지 않음(객체는 사용자의 다음 `git gc` 까지 로컬 객체 저장소에만 남음). 실행 폴더 원본도 같은 처리. 다른 증거·Sol 작업 로그에 같은 값 0건 확인 ② 테스트가 `assert_called*`(실패 시 인자 출력) 대신 호출 **횟수**를 비교(PC `1997065`, `test_fixture_runtime_mode.py` 도) ③ 증거 사본 스크립트가 `env=` 줄을 지우고 비밀 패턴이 남으면 실패 | map `bfc9edd`, PC `1997065` | 증거 전체 비밀 패턴 검사 0건 |
| R4-01 높음 | Popen 반환 즉시 큐에서 빼서, 자식이 큐 파일을 읽기 전 실패하면 번호 유실 | 맡은 번호는 **예약**(다른 실행이 다시 맡지 않음), 자식이 **exit 0 으로 끝난 뒤에만** 큐에서 뺌. 실패하면 예약만 풀어 큐에 남김(곧바로 재시도하지 않고 다음 계기에) | PC `1997065` | `test_items_stay_queued_until_the_child_exits_cleanly`(실행 중·실패 종료·실행 중 들어온 번호·파일 내용) / `neg-r4-01-remove-on-start.log` |
| R4-02 중간 | 동시 launch 중복 시작, 지는 쪽이 실행 중 크롤의 로그를 지움 | 대기 큐 시작 직렬화(`_launch_lock`) + 예약. 로그 교체·실행별 큐 파일은 `start_crawl(prepare=…)` 로 **같은 잠금 안에서 시작 확정 뒤에만**. 사용자 시작(`crawl_control`)도 같은 방식이고 시작 경쟁에서 지면 번호를 대기 큐로 | PC `1997065` | `test_two_launches_never_hand_the_same_numbers_to_two_crawls`(첫 자식 즉시 종료), `test_concurrent_launches_start_once_and_keep_the_running_log` / `neg-r4-02-no-launch-lock.log`(같은 번호 2회), `neg-r4-02-user-log-before-start.log`(로그 덮어씀) |
| R4-03 높음 | 게이트 통과 뒤 복원이 끝나면 새 데이터셋에서 재검사 없이 시작 | 복원이 시작될 때마다 `restore_generation` +1. 모든 크롤 시작(대기 큐·사용자)이 검사 **전에** 세대를 읽고 `start_crawl` 이 같은 잠금 안에서 비교 — 달라졌으면 시작 거부(대기 큐는 보존) | PC `1997065` | `test_a_restore_between_the_check_and_the_start_blocks_the_start`(대기 큐·`enqueue_report` 모두) / `neg-r4-03-no-generation.log` |

테스트 격리: 복원 뒤 재개 스레드가 실제 게이트 검사를 하며 다음 테스트로 새는 간헐 실패(16회 중 1회)가 있어, 테스트 기본값으로 게이트 검사를 즉시 거부하고 크롤 후처리 스레드(이름 `crawl-*`)를 테스트 끝에 기다리게 했다. 이후 `tests.test_storage_exchange` 12회 연속 통과.

### 4차 재검증 반영 후 실행 결과 (`evidence/2026-09-26-audit5/`, PC 만 변경)
후보 PC `1997065`. mobile `2debce44`·map 제품 `e284c86`·auth 제품 `5a4d678` 은 audit3 과 같다.

| 영역 | 결과 |
|---|---|
| PC 단위 / 서버↔모바일 왕복 / 실스택 / 브라우저 스모크 | 392 OK(skip 4) / diff_count 0 / 1 OK / 128 passed |
| 음성 대조(각각 따로) | `neg-r4-01-remove-on-start`, `neg-r4-02-no-launch-lock`, `neg-r4-02-user-log-before-start`, `neg-r4-03-no-generation` — 모두 목표 단언에서 실패 |
| 증거 비밀 검사 | 모든 추적 증거에서 세션 토큰·SSH/DBUS·`env={` 0건(사본 스크립트가 남으면 실패) |

## Sol 5차 재검증(`audit-sol-recheck-05.md`, "수정 후 재검토") 반영

R4-02·R4-03·R4-04 는 5차에서 닫혔다.

| ID | 지적 | 조치 | commit | 회귀 테스트 / 음성 대조(`evidence/2026-09-26-audit6/neg-*.log`, 각각 따로) |
|---|---|---|---|---|
| R5-01 높음 | `start.py` 는 로그인·조회·저장 실패도 exit 0 — 종료 코드로 번호를 지우면 영구 누락 | 자식이 큐 모드에서 **번호별 결과 보고**(`<큐파일>.done.json`, `services/crawl_queue_report.py` — `processed` 는 상세 저장 성공한 ID 의 큐 번호, `not_found` 는 끝까지 찾아도 없는 번호)를 fsync·원자 교체로 남기고, 부모는 **보고에 있는 번호만** 뺀다. 보고가 없으면(로그인 실패 등) 아무것도 빼지 않음 | PC `9f1adc6` | `test_the_real_crawler_reports_saved_and_missing_numbers_only`(실제 `start._run_crawling_process`: 1건 저장 뒤 스트림 중단 + 없는 번호 / 실제 `start.main()` 로그인·대체 로그인 실패 → 보고 없음), `test_only_numbers_the_child_reports_as_done_leave_the_queue` / `neg-r5-01-trust-exit-code.log`, `neg-r5-01-child-reports-all.log` |
| R5-02 중간 | 실패 뒤 남은 번호·경쟁에서 `queued` 로 답한 번호를 다시 돌릴 계기 없음 | 남은 번호는 1분부터 두 배(최대 30분) 간격 재시도 타이머, 성공하면 간격 초기화. 번호를 대기 큐에 넣는 쪽(실행 중·시작 경쟁)이 한 번 더 시작을 시도 — 완료 훅이 이미 지나갔어도 시작됨 | PC `9f1adc6` | `test_a_number_queued_after_the_completion_hook_passed_still_starts`, 위 테스트의 재시도 단언 / `neg-r5-02-no-request-launch.log`, `neg-r5-02-no-retry.log` |
| R5-03 중간 | 시작 알림이 감시 스레드보다 먼저·예외 전파 → 예약 영구 누수 | 감시 스레드를 먼저 붙이고 알림 예외는 기록만. 스레드를 못 띄우면 예약 해제 | PC `9f1adc6` | `test_a_failed_notification_or_preparation_does_not_leak_reservations_or_files` / `neg-r5-03-broadcast-first.log` |
| R5-04 낮음 | 준비(prepare) 실패 때 번호가 담긴 임시 파일 잔류 | 시작 실패 처리에서 실행 파일(큐·보고·tmp)을 지움 | PC `9f1adc6` | 같은 테스트 / `neg-r5-04-no-file-cleanup.log` |

### 5차 재검증 반영 후 실행 결과 (`evidence/2026-09-26-audit6/`, PC 만 변경)
후보 PC `9f1adc6`. mobile `2debce44`·map 제품 `e284c86`·auth 제품 `5a4d678` 은 audit3 과 같다.

| 영역 | 결과 |
|---|---|
| PC 단위 / 서버↔모바일 왕복 / 실스택 / 브라우저 스모크 | 396 OK(skip 4) / diff_count 0 / 1 OK / 128 passed |
| 음성 대조(각각 따로) | `neg-r5-01-trust-exit-code`, `neg-r5-01-child-reports-all`, `neg-r5-02-no-request-launch`, `neg-r5-02-no-retry`, `neg-r5-03-broadcast-first`, `neg-r5-04-no-file-cleanup` — 모두 목표 단언에서 실패 |

## Sol 6차 재검증(`audit-sol-recheck-06.md`, "수정 후 재검토") 반영

R5-03·R5-04 는 6차에서 닫혔다.

| ID | 지적 | 조치 | commit | 회귀 테스트 / 음성 대조(`evidence/2026-09-26-audit7/neg-*.log`, 각각 따로) |
|---|---|---|---|---|
| R6-01 높음 | 목록 탐색 실패·빈 오류 응답·100쪽 상한을 `not_found` 로 확정 | `crawl_titles(progress=…)` 의 총 건수·실패 페이지로 **전 페이지를 성공적으로 훑었을 때만** 확정. 실패·잘림·상한이면 보고하지 않아 큐에 남음 | PC `2f38e71` | `test_a_failed_or_incomplete_list_search_never_marks_a_number_missing`(오류 응답·예외·250쪽) / `neg-r6-01-incomplete-search-reported.log` |
| R6-02 높음 | 탐색 뒤 재해석이 `LIKE` 첫 결과 → 모호한 번호를 임의 신고로 완료 | 재해석도 정확→`SPP-` 접두→유일한 부분 일치(`_resolve_report_number_detail`). 여러 건이면 저장하지 않고, 완전 탐색 뒤 `ambiguous` 로 보고(오류 로그로 정확한 번호 재요청 안내) | PC `2f38e71` | `test_an_ambiguous_partial_number_is_never_completed_with_an_arbitrary_report` / `neg-r6-02-first-partial-match.log`(임의 신고 저장) |
| R6-03 중간 | 게이트에 막힌 재시도가 다시 걸리지 않음, 재시작 뒤 타이머 소멸 | 막히거나 시작 못 하고 번호가 남으면 늘어나는 간격으로 다시 걸림. 서버 기동 때(`main.py`, fixture 제외) 남은 번호가 있으면 타이머 하나(곧바로 크롤하지 않음) | PC `2f38e71` | `test_a_blocked_retry_is_rescheduled_and_a_restart_schedules_one` / `neg-r6-03-no-reschedule.log` |
| R6-04 중간 | 시작 요청마다 스레드 | 작업자 하나로 합치기(`_request_worker_active`/`_request_again`), 작업자를 못 띄우면 예외 대신 재시도 타이머 | PC `2f38e71` | `test_many_launch_requests_use_a_single_worker`(25요청 → 작업자 1·launch 2회) / `neg-r6-04-thread-per-request.log` |
| R6-05 중간 | 유효한 JSON 의 잘못된 필드 타입에서 `TypeError` → 감시 종료·예약 누수 | 보고 필드가 문자열 목록이 아니면 빈 보고. 감시 전체를 `finally` 로 감싸 예약 해제·실행 파일 정리 보장 | PC `2f38e71` | `test_a_malformed_report_or_hook_error_still_releases_the_reservation` / `neg-r6-05-no-type-check.log`, `neg-r6-05-no-finally.log` |

PyInstaller: 이 환경에 PyInstaller 가 없어 **번들 포함은 미검증**. 정적 import 사슬(`main.py` → `start` → `services.crawl_queue_report`, `services/crawl_manager.py` → 같은 모듈)만 AST 로 확인했다. 영구 실패 번호의 무기한 재시도(최대 30분 간격)와 시도 상한·사용자 알림 부재는 남는 한계다.

### 6차 재검증 반영 후 실행 결과 (`evidence/2026-09-26-audit7/`, PC 만 변경)
후보 PC `2f38e71`. mobile `2debce44`·map 제품 `e284c86`·auth 제품 `5a4d678` 은 audit3 과 같다.

| 영역 | 결과 |
|---|---|
| PC 단위 / 서버↔모바일 왕복 / 실스택 / 브라우저 스모크 | 401 OK(skip 4) / diff_count 0 / 1 OK / 128 passed |
| 음성 대조(각각 따로) | `neg-r6-01-incomplete-search-reported`, `neg-r6-02-first-partial-match`, `neg-r6-03-no-reschedule`, `neg-r6-04-thread-per-request`, `neg-r6-05-no-type-check`, `neg-r6-05-no-finally` — 모두 목표 단언에서 실패 |
