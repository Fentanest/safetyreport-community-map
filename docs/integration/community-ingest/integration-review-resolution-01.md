# Sol 1차 통합 검토 반영 (Opus5.5, 2026-09-26)

대상 검토: `integration-review-sol-01.md`(판정 "수정 후 재검토"). 새 후보 commit:

| 레포 | 이전 후보 | 새 후보 |
|---|---|---|
| map | 4555d75 | 이 문서가 들어간 commit(`ci0926/integration` HEAD) |
| auth | 3be1c39 | 3be1c39 (변경 없음) |
| PC | d37749e | 703332e |
| mobile | 4aee1e4e | 265f9d42 |

Sol 환경에서는 `npx`·Flutter·스택 호출이 막혀(EPERM/EROFS) 재실행이 안 됐으므로, 이번에는 **실행 로그를 후보 commit 에 포함**했다:
`docs/integration/community-ingest/evidence/2026-09-26-r2/*.log`(키·JWT 문자열은 `<redacted>` 로 치환, ANSI·접속 로그 줄 제거). 로그를 만든 명령은 아래 표에 있다.

## 차단 결함

| ID | 조치 | 코드 | 검증 |
|---|---|---|---|
| H-01 | 공유 사본을 만들 수 없으면(저장소 열기 실패·manifest 확보 실패) **개인 상세를 저장하지 않고 수집을 멈춘다**. 공통 함수 `captureAndSaveDetail` 첫 줄에서 `CaptureStoreUnavailable`(단건 경로는 큐 보존). 개인 저장 실패 때는 재조회 의도를 지우지 않는다. | M `lib/services/sync_engine.dart`(run 시작 fail-closed, `captureAndSaveDetail` 가드) | M `test/community/integration_contract_test.dart` "sync fail-closed (Sol H-01)" 2건, `mobile-unit.log` |
| H-02 | 복원·서버 DB 가져오기 전 dataset 회전 실패 → 예외, 개인 DB 교체 안 함 | M `lib/services/local_db_service.dart` `_rotateCommunityDataset` | M `test/community/rebuild_hook_test.dart` "회전 실패면 복원하지 않고…"(community.db 자리를 폴더로 막아 실패 주입, live2 행 유지) |
| H-03 | 삭제 성공 뒤 **영속 표시(경계 = 그 시점 journal 최대 rowid)를 먼저 쓰고** 경계까지의 journal 을 `deleted_by_user` 로, 그 outbox 를 blocked 로, server_completed 를 비운 뒤 표시를 지운다. 시계(captured_at)와 무관. 표시가 남아 있으면 업로드·reshare 는 먼저 적용을 시도하고 실패하면 보내지 않는다. 손상된 표시는 경계 없이(적용 시점 전체) 적용해 영구 잠김을 피한다. PC 라우트는 존재하지 않는 hook 을 부르고 있어 **아무것도 막지 않던** 결함도 함께 수정. 로컬 정리 실패는 설정 화면에 안내. | PC `services/community_capture.py`(`on_contributions_deleted`·`apply_pending_deletion`·`deletion_cleanup_pending`), `services/community_uploader.py`, `web/routers/community_route.py`, 동의 카드; M `lib/community/capture/server_completed.dart`, `reshare.dart`, `upload/community_uploader.dart`, `upload_hooks.dart`, `gate/community_gate.dart` | PC `tests/test_community_deletion.py` 4건(미래 시계 행 차단·적용 실패 시 표시 유지와 업로드/reshare 중단·경계 뒤 새 행 허용·손상 표시), M `uploader_test.dart` "deletion cleanup (Sol H-03)" 4건 |
| M-01 | `verification_required` 포함 **모든** `can_enter=false` 전이에서 이벤트 WS 4403 종료, `broadcast` 는 보내기 전 게이트 확인(닫혀 있으면 보내지 않고 4403) | PC `main.py` `_on_community_gate_change`, `services/ws_manager.py` | PC `tests/test_community_gate.py` `test_gate_loss_closes_event_websockets`(기대를 뒤집음), `test_broadcast_checks_the_gate_before_sending` |
| M-02 | 합성 스택에 Storage 를 켜고(realtime 포함) 실제 채널을 시험. 거절 응답은 **상태 + 오류 JSON 코드**를 단언: private 스키마 406 `PGRST106`, public 표 404 `PGRST205`(GET/POST/PATCH/DELETE), DB 의 **모든 `public.internal_*` RPC 를 실제 시그니처로** 호출해 anon 401·authenticated 403 `42501`(인자가 틀린 404 로는 권한을 증명할 수 없어서). Realtime: anon·사용자 JWT 로 private 표 3개 postgres_changes 구독 → ingest 뒤 변경 이벤트 0(채널 응답은 받음). Storage: 버킷 0·생성/업로드 거절·행 수 불변. 경쟁에 **삭제(contributions-delete)** 추가 → deadlock 0, 제품 5xx 0, 삭제 사용자 공개 fact 0. 운영 DML 은 값을 실제로 바꿔(category→other) **새 익명 HTTP 조회가 새 버전·새 값(분류 건수 +1)** 을 돌려주는지 확인. | MAP `tests/integration/community-stack.test.ts`, `scripts/integration/compose_supabase.mjs`(`[storage] enabled`) | `map-stack-run-{1,2,3}.log` 연속 21/21 |
| M-03 | acceptance-matrix 를 이 후보 commit 에 반영(아래), 증거 로그 동봉 | MAP `acceptance-matrix.md`, `evidence/2026-09-26-r2/` | — |

## Sol 이 적은 "부분" 항목에 대한 판단

- **captured_at 서버 검사를 넣지 않은 이유**: captured_at 은 계약상 정상 앱의 순서 메타데이터이고 클라이언트가 값을 정한다(위조 가능). 서버가 미래 시각을 거절해도 조작된 클라이언트는 과거 시각을 넣을 수 있으므로 보장이 늘지 않는다. 삭제 뒤 옛 사본의 재전송을 막는 통제는 **앱의 ID(행 순번) 기준 로컬 차단**과 서버의 identity tombstone·fence 조합이며, 이번에 앱 쪽을 시계 무관하게 바꿨다. 조작된 클라이언트까지 막는 것은 원 프롬프트 §14 마지막 행("다른 프로그램으로 생성 — 이번 범위 구분 불가")과 같은 한계로 문서화한다.
- **경쟁 테스트의 런타임 503**: 로컬 `supabase functions serve` 가 isolate 를 벽시계·CPU 한도로 재활용할 때 진행 중 요청이 계약 형식이 아닌 503 을 받을 수 있다(serve 로그 `connection closed before message completed`, 10여 회 중 1회 관찰). 앱은 503 을 재시도한다. 테스트는 제품이 낸 5xx(계약 오류 JSON)는 0 을 요구하고, 런타임 503 은 따로 기록(≤3)한다.
- **실경로 파서 동등성**: 같은 공식 상세 응답을 PC·모바일 파서에 넣어 event_type 까지 비교하는 실경로 테스트는 여전히 없다(공식 사이트 호출 금지). 대신 세 언어가 같은 관측 벡터 32건·event_decisions 10건을 통과하고, PC·모바일 실스택에서 source_report_key 가 서버 계산과 같다. 한계로 남긴다.
- **Realtime**: 실제 구독 음성은 추가했다. 운영 프로젝트의 Realtime 설정(publication)은 운영 반영 때 다시 본다.

## 이번 후보의 실행 결과 (로그: evidence/2026-09-26-r2)

| 영역 | 명령 | 결과 |
|---|---|---|
| map 실스택 | `COMMUNITY_STACK=1 npx vitest run tests/integration` ×3 | 21/21 ×3 |
| map migration | `bash scripts/integration/migration_paths.sh` | 빈/map 선행/auth 선행/양쪽 + legacy 가드 PASS |
| map 단위 | `npx vitest run` | 74 passed(21 skipped = 스택 테스트) |
| Deno 2.9.7 | `deno check` 4 함수(합성 레이아웃, package.json 탐색 끔) | 4 ok |
| auth relay 실스택 | `SAFEAUTH_STACK=1 npx vitest run tests/relay.integration.test.ts`(map 선행 스키마 포함) | 24/24 |
| auth 브라우저 | `SAFEAUTH_STACK=1 SAFEAUTH_BROWSER=1 … browser.e2e.test.ts` | 11/11 |
| PC 단위 | `unittest discover` | 367 OK (skip 4) |
| PC 실스택 | `tests/test_community_live_stack.py` | 1 OK(relay 연결 요청 시작 포함) |
| PC 브라우저 스모크 | `tools/web-tests` chromium+firefox, 동의 세션·초기화 완료 fixture | 125/126, 실패 1건(firefox watchlist 콘솔 오류 1개)은 재실행 28/28 통과 — 간헐, 문구는 재실행에 덮여 미확인 |
| mobile | `flutter test` / `flutter analyze` / 실스택 `live_stack_test.dart` | 509 passed(3 skipped) / error 0 / 1 passed |
