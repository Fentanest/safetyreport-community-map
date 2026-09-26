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
