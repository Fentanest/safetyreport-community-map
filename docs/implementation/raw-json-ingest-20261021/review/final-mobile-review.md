# 모바일 최종 버그 검토 (커밋 7085ca26, 2026-10-21) — "→" 는 검수자 결정

재현 시험(검토자 작성, scratchpad): client_outage_probe_test.dart, upgrade_probe_test.dart, inventory_deadline_probe_test.dart
(/tmp/claude-1000/-home-better0101-projects-safetyreport-community-map/47106abd-9038-489b-b6cd-34b46a02553e/scratchpad/).

1. HIGH — Client 모드에서 커뮤니티 클라우드 일시 장애·쿨다운이면 잠김(업데이트 회귀). `lib/community/gate/community_gate.dart:376`
   `if (consentDenied || appMode == 'server') return false;` → Client 는 `_cloudUnavailable` 에서 canBrowse=false → 온보딩.
   base 는 Client 에 `_localAllowed=true`. markG1 은 Client 에도 dataset null 로 기록되나 쓰이지 않고 seedLastG1 은 isWriter 만.
   → Client 도 같은 회원의 last_g1 72시간 유예 적용(dataset null 비교, 업그레이드 시드 포함). PC 가 명시적으로 거절할 때만 잠금.
2. MED — 개인 동기화가 게이트의 일시 문맥 비활성화로 중단. `lib/services/sync_operation_admission.dart:35-50, 112`
   매 checkOwnership 마다 active context 비교 → 동기화 중 poll 이 503/쿨다운이면 inactive → sync_context_changed.
   → 실패 조건은 식별 필드가 다를 때와 work_generation 변경으로 한정. inactive 전환은 capture 의 offline 경로에 맡김(base·PC 와 같게).
3. MED — 원본 1회 전송 목록 단계가 포그라운드 hardDeadline(slice×3=60초)에 끊겨 처음부터 반복, 공식 API 반복 호출.
   `lib/community/raw_backfill_runtime.dart:274, 338, 363-400`. 항목 처리 40초 초과도 같은 항목 반복.
   → 목록 단계는 페이지 커서를 저장하고 hard deadline 대상에서 제외(또는 커서로 이어 받기). 항목 처리는 중간에 hard cancel 하지 않고 끝난 뒤 양보.
4. MED — 공식 로그인 거부 시 5분마다 재로그인(계정 잠김 위험). `lib/community/raw_backfill.dart:5`, `raw_backfill_runtime.dart:412, 552`.
   → `StandaloneAuthService.lastReloginStatus().needsManualLogin` 이면 수동 로그인까지 멈춤(official_login_required), 그 외는 지수 백오프(최대 1시간). PC 동일.
5. MED — 원본 전송이 일반 크롤·사진 작업과 동시에 돎(PC·계획 7-2 와 다름). `raw_backfill_runtime.dart:349-356`
   → `SyncEngine.isRunning || StandaloneAutoSyncService.isRunning || MaintenanceService 실행 중` 이면 준비 안 됨(false).
6. MED — 원본 전송이 DB 최적화를 잘못 시작. `raw_backfill_runtime.dart:350-353` → `db_optimize.dart:2001` 인자 없는 maybeStart() 가
   provider 의 `_lastIsSyncing`/`_lastRebuildPending` 을 null 로 덮고, 백그라운드 isolate 에서 전체 최적화를 시작(포그라운드와 동시 실행 가능).
   → 백그라운드에서는 시작하지 않고 false 만. 포그라운드는 provider 의 `_startDbOptimizeIfNeeded` 와 같은 인자로.
7. MED — 철회를 보지 못한 채 새 계보로 재동의하면 원본을 다시 보내지 않음(PC 도 같음, PC 는 별도 수정 중). `lib/community/consent_catchup.dart:53-66`.
   → 계보가 바뀐 catch-up(non-active→active)이면 raw_backfill marker 를 지워 새 run 으로 전체 재전송(PC 와 같은 방식).
8. LOW — DB 최적화 보류만 남으면 needsRun()=true 라 원본 전송이 영원히 waiting_optimize. → 보류만 남은 상태는 준비 완료로 본다(PC 동일).
9. LOW — uploading 단계에서 15초마다 대기 항목 최대 1000건 × 쿼리 3~4개(`raw_backfill_runtime.dart:130-133, 759-783`).
   → uploading 단계는 60초 간격, receipt 는 한 쿼리로 묶어 조회.
10. LOW — 헤드리스 소프트 리셋(`upload_background.dart:279`)이 remote-reset(localRevoke) 이력을 안 남기고, 포그라운드 프로세스는 메모리 세션이 valid 로 남아
   cloud_unavailable 화면을 볼 수 있음. → 이력 기록(포그라운드와 같게), 포그라운드는 복귀·poll 때 저장소의 세션을 다시 읽어 끊김 반영.
11. LOW — revoke_pending 중 다른 카카오 계정으로 로그인하면 attempt 가 계정 불일치로 조용히 끝나 영구 잠김(`soft_reset.dart:169`).
   → "철회 중인 계정(표시 이름)으로 로그인해야 철회를 마칠 수 있습니다" 안내와 로그아웃 제공(PC 동일).
