# 모바일 최종 검토 수정 보고 (2026-10-21)

대상: mobile (feat/raw-json-ingest, HEAD 7085ca26 위 미커밋 변경). 입력: review/final-mobile-review.md 11건, 검수자 결정을 그대로 구현.
Flutter 3.47.5 만 사용. analyze `No issues found`. 전체 `flutter test --no-pub`: **+2463 ~19 -0 (All tests passed)**, 실패 없음(부하로 재실행한 시험 없음).

## 한계 (정직하게)
- "수정 전에 실패하는 시험 먼저"는 확인하지 못했다. git 되돌리기(stash/checkout) 금지라 옛 코드를 복원할 수 없어, 수정과 시험을 함께 작성한 뒤 통과를 확인했다.
  시험 단정은 옛 코드에서 성립할 수 없는 내용이다(항목별 설명 참고). 검수자의 probe 3개는 시험으로 이식했다(1, 업그레이드, 3).
- 실기기/에뮬레이터 검수는 하지 않았다(not-run). 철회 중 다른 계정 안내는 위젯 시험으로만 확인.

## 항목별
1. Client 72시간 유예 — `lib/community/gate/community_gate.dart` `_prepareLocalUse`: `appMode=='server'` 즉시 거절 제거, 업그레이드 시드(`seedLastG1`)를 Client 에도 적용, Client 는 dataset 을 기록된 last_g1 의 값과 비교(null 포함). 명시적 동의 거절은 그대로 잠금.
   시험 `test/community/final_gate_fixes_test.dart` group 1: 정상 확인 뒤 503 -> canBrowse true(canEnter false), last_g1 없는 이력의 오프라인 첫 시작(업그레이드), 이전 확인 없음 -> 잠김, 명시적 철회 -> 잠김, Standalone 업그레이드 불변(probe 이식).
2. 개인 동기화 중단 — `lib/services/sync_operation_admission.dart` `checkOwnership`: 활성 문맥이 비어 있으면 실패하지 않음. 식별 필드 불일치와 work_generation 변경만 실패. 시험 group 2(비활성화 후 통과 / 데이터셋 변경 실패 / generation 변경 실패).
3. 목록·항목 hard deadline — `lib/community/raw_backfill_runtime.dart`: `hardDeadline` 제거(`current()` 에서 시간 검사 삭제), slice 는 항목 사이 양보에만 사용. 시험 `final_backfill_fixes_test.dart` group 3: 슬라이스 400ms 에 페이지 300ms×3(probe 이식)이 한 번에 `list_ok=true`, slice×3 경과 후에도 `current()` true.
   (페이지 커서 저장 대신 "목록 단계는 deadline 제외" 쪽을 택함. 백그라운드 isolate 가 OS 에 죽으면 목록은 처음부터 — 허용 범위로 판단.)
4. 로그인 거부 재로그인 — `_loginPause()`: `StandaloneAuthService.lastReloginStatus().needsManualLogin` 이면 `official_login_required` 1시간 정지 + `meta.raw_login_manual`; `run()` 은 이 표시가 있고 아직 수동 로그인이 필요하면 게이트 확인·공식 API 없이 반환(타이머만 재설정), 상태가 바뀌면 즉시 재개. 그 외는 `raw_login_pauses` 로 300·600·1200·2400·3600(상한)초. 로그인 이유가 아닌 결과가 나오면 카운터 초기화. 소프트 리셋이 두 키 삭제.
   PC 와 비교: PC 는 permanent 정지 + 로그인 지문 변화로 재개, 일시 실패는 300×2^n(상한 3600) — 같은 규칙. 시험 group 4(수동 정지 3600+표시, 일시 실패 시퀀스, 정지 중 요청 0건 -> 로그인 성공 뒤 재개).
5. 일반 작업과 동시 실행 — `optimizationReady()`: `SyncEngine.isRunning || StandaloneAutoSyncService.isRunning || MaintenanceService.isRunning`(신규 getter) 이면 false. 시험 5.
6. 최적화 오시작 — 인자 없는 `maybeStart()` 제거. 백그라운드(`background:` 생성자 인자, `run(background:)` 전달)는 시작하지 않고 false 만, 포그라운드는 provider `_startDbOptimizeIfNeeded` 와 같은 인자(`isSyncing`, `rebuildPending`). 시험 6(백그라운드 0회 / 포그라운드 1회).
7. 철회 미확인 재동의 — `ConsentHistory.event` 가 `catchup_lineage_changed`(알던 상태가 active 가 아니었다가 active)를 기록 -> 게이트가 `ConsentCatchup.schedule(lineageChanged:)` -> v2 인계 때 `raw_backfill`·`raw_backfill_retry` 삭제(새 run 전체 재전송). 같은 계보 갱신(active->active)은 유지. PC `lineage_changed` 와 같은 정의(PC 시험 `test_observe_flags_nonactive_to_active...` 와 대응). 시험 group 7(이력 판정 2종 + catch-up 삭제/유지).
8. 보류만 남은 최적화 — `DbOptimize.holdsOnly(meta)`(현재 세대, done 아님, cursor 비어 있음, holds 있음) 이면 준비 완료. 커서가 남은 진행 중은 아님. 시험 8. (PC `only_holds_left` 와 같음)
9. uploading 폴링 — `nextDelay`: uploading 60초. 영수증: `BatchedReceipts.prefetchReceipts`(메타·저널·outbox 쿼리 3개, 400건씩)를 `RawBackfill` 이 uploading 에서 호출, `receipt()` 가 한 번 소비. 인터페이스를 선택형으로 둬 PC 와 공유하는 43개 trace/기존 fake backend 는 영향 없음. 시험 9(일괄 조회 후 DB 를 바꿔도 일괄 응답 사용 = 항목별 쿼리 없음).
10. 헤드리스 리셋 이력 — `upload_background.dart` 의 `headlessSoftReset`(신규, 시험 가능)이 `remote-reset`(localRevoke) 이력을 남기고 `complete`. 포그라운드: `refreshNow` 가 메모리 세션 connected 인데 저장소가 아니면 `auth.load()` 로 맞춤(`StubAuthService` 에 `storedPhase`/`savedSessionPhase`/`load` 추가). 시험 group 10.
11. 철회 중 다른 카카오 계정 — `CommunityReset.begin` 이 `display_name` 기록, 게이트 `revokeAccountMismatch`/`revokeAccountName`, 온보딩이 "철회 중인 계정(이름)으로 로그인해야 철회를 마칠 수 있습니다…"(PC 문구와 동일) + 기존 로그아웃 버튼. 시험: 게이트 group 11 + 위젯 시험(`test/widgets/community_onboarding_flow_test.dart` 추가 1건).

## 변경 파일 (mobile/)
lib: community/gate/community_gate.dart, community/consent_history.dart, community/consent_catchup.dart, community/raw_backfill.dart, community/raw_backfill_runtime.dart, community/soft_reset.dart, community/upload/upload_background.dart, screens/community_onboarding_screen.dart, services/sync_operation_admission.dart, services/db_optimize.dart, services/maintenance_service.dart.
test: community/final_gate_fixes_test.dart(신규 14), community/final_backfill_fixes_test.dart(신규 10), community/fake_account.dart(Stub 보강), widgets/community_onboarding_flow_test.dart(+1).
docs: docs/architecture/community-gate.md, community-upload.md, CHANGELOG.md. 포맷터는 돌리지 않았다.
(git status 의 contracts/community-ingest-v2/* 수정은 이 작업이 아닌 다른 에이전트 변경.)

## 남은 점
- 항목 3 목록 단계가 OS 종료로 끊기면 처음부터 다시 받는다(커서 미저장).
- 항목 4: 수동 로그인 후 재개는 다음 타이머(최대 1시간)나 앱 시작/게이트 통과 때 일어난다(상태 변화 구독은 하지 않음).
