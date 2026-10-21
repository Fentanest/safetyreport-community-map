# PC·모바일 원본 전송 후속 구현 보고서

작성일: 2026-10-21. 작업서: `docs/tasks/sol-raw-json-ingest-full-2.md`, 기준 계획: `PLAN.md` 7-2·7-3·7-4.

## 결과와 경계

항목 1–8의 PC·모바일 코드를 구현했다. 아래의 순수 판정·SQLite 저장·가짜 전송 시험과 정적 검사는 실행했다.
소켓 기반 시험·실제 앱 렌더·Android 실행 검수는 **NOT RUN**이며 완료로 간주하지 않는다. 실제 사용자 자료를 전송한 결과 보고서가 아니다.

이번 후속 작업의 쓰기는 `pc/`, `mobile/`와 이 새 보고서에 한정했다. `auth/`, 지도 코드·PLAN·기존 SOL-REPORT는 수정하지 않았다.
계약 사본 `contracts/community-ingest-v2/`는 이번 후속 작업에서 수정하지 않았다. 작업 시작 전에 있던 변경은 보존했다.
커밋·네트워크·원격 접속·Docker·운영 적용·배포·버전 변경은 하지 않았다. 실행 중인 운영 작업이나 지속 감시 서비스를 설치했다고 주장하지 않는다.

## 항목별 상태

| 항목 | 구현 상태 | 파일과 동작 | 검증 |
|---|---|---|---|
| 1. raw_backfill | 구현 완료, 실제 수집 미검증 | PC `services/community_raw_backfill.py`, `community_raw_backfill_runtime.py`; 모바일 `lib/community/raw_backfill.dart`, `raw_backfill_runtime.dart`. 영속 문맥·run_id·state·phase·cursor·holds·stats, 최적화 대기, A/B/C, 전체 강제 enqueue, stored 영수증 완료 | PC 상태·실제 개인 DB 저장 경로 시험, 공통 합성 trace의 Python/Dart 대조 |
| 2. 트리거·재개 | 구현 완료, OS 실행 미검증 | PC `main.py`, `community_schedule.py`, `community_consent_jobs.py`; 모바일 `community_wiring.dart`, `background_login_check.dart`. 새 정책/capability, 기동, 데이터셋·grant·parser·writer 변경으로 재시작; foreground/WorkManager 이어 하기 | scope 변경·커서 재개 시험, Flutter analyze |
| 3. 진행 UI | 구현 완료, 실제 렌더 미검증 | PC `web/templates/report_map.html`, `community_upload_status.py`, 업로드 retry 라우트; 모바일 `community_upload_panel.dart`. 전송 n/N′·원본 없음·채움/못 채움·holds·다시 시도 | PC 템플릿/JS 문법 PASS; 모바일 widget 시험 추가, NOT RUN |
| 4. capture 전환 | 구현 완료 | 아래 호출 지점 표. v2 선택 뒤 sticky raw_contract_scope로 v1 재생성을 금지; 원본 없음은 raw_required로 보류 | PC 원본·보충·가짜 gzip 전송 시험, Dart 바이트/해시 벡터; 모바일 저장 시험 추가 |
| 5. notice | 구현 완료, 실제 렌더 미검증 | ACK client_notice를 영속 저장. 426은 HTML 본문이어도 필수 업데이트. PC 전역 shell 배너, 모바일 root ClientNoticeHost 대화상자/스토어 링크 | PC 실제 업로더 ACK·426 시험 PASS; 모바일 SQLite/위젯 시험 추가, NOT RUN |
| 6. Client 잠금 | 구현 완료, 네이티브 실행 미검증 | 모바일 `client_server_consent.dart`, `client_server_policy.dart`, `community_gate.dart`, `api_service.dart`, `WsService.kt`. PC gate 조회, API 403·WS 4403, scoped lock, “서버 동의 필요”. 폰 로그인 유지 | Dart 순수 판정 5개 PASS; 가짜 PC 응답 gate 시험 추가; Kotlin/AVD NOT RUN |
| 7. 소프트 리셋 | 구현 완료, 실제 앱 검수 미검증 | PC `community_reset.py`, account_ops·crawl_manager·db_optimize·maintenance·uploader·schedule; 모바일 `soft_reset.dart`, sync_operation_admission·gate·optimizer·maintenance·upload_background. 선차단·작업 중단·영속 pending revoke·자동 재시도·확인 뒤 토큰 정리 | PC 실패→토큰 유지→서버 확인→초기화·다른 계정 보호·늦은 응답 시험 PASS; 모바일 동등 시험 추가, NOT RUN |
| 8. 긴급 정책 시험 | 기대값 교체 완료, 소켓 시험 미실행 | 미동의/철회 로컬 허용을 제거하고, 서버 확인 불가만 G1 뒤 72시간·같은 회원/DB로 제한. 수정 파일은 아래 목록 | PC 순수 판정 PASS, Dart 공통 gate 17개 PASS; HTTPServer/Flutter tester 기반 시험 NOT RUN |

## 일괄 전송의 저장·실행 규칙

- `community.db meta.raw_backfill`: contract=v2, parser_target, local_dataset_id, fingerprint/dataset/grant/connection/writer_epoch, run_id, state, phase, cursor, holds, stats, 건별 이벤트와 시도를 보존한다. 같은 범위는 재개하며 범위 변경은 새 run이다.
- A는 기존 목록 inventory 검증을 재사용한다. 전 페이지 list_ok가 아니면 커서를 진행하지 않는다. 로컬 답변 완료와 목록에만 있는 신고를 합쳐 준비한다.
- B는 저장 원본의 압축·크기·해시·JSON을 검사한다. 없거나 손상되면 기존 상세 파싱/개인 저장 경로로 다시 수집한다. 404/410은 raw_unavailable, 인증 문제는 휴지다.
- C는 참여 완료 별점·사유와 첨부사진 EXIF를 보충한다. 6개월 보관기간을 지난 첨부는 요청하지 않고 expired, EXIF가 없으면 no_exif를 건별 marker에 남긴다.
- 개별 실패 3회는 holds, 연속 실패 5회는 300초 휴지다. 인증 문제는 시도 횟수를 소모하지 않는다. 수동 다시 시도는 holds와 휴지를 풀며 전송 영수증은 보존한다.
- 기존 수집·최적화와 같은 PC 예약 잠금/모바일 personal_sync lease를 사용한다. raw_backfill 실행 lease는 120초, heartbeat는 20초이며 갱신 실패 시 저장을 중단한다. 요청 간격은 기존 목록의 0.5초, 상세/보충 요청 사이 0.5초를 적용한다.
- 모바일 최적화 시작은 personal_sync zone 밖에서 호출한다. 최적화가 끝나기 전에는 raw_backfill을 진행하지 않는다. foreground 예산 10분·background 4분이며 중단한 cursor는 보존한다. WorkManager는 `NetworkType.connected`이고 Wi-Fi 한정 조건이 없다. OS가 정확한 시각의 실행을 보장하지는 않는다.
- N=답변 완료 대상, N′=N−raw_unavailable. 모든 N′건의 저장 영수증만 done이다. stored/parse_pending은 원본 저장 성공이다. duplicate는 original_status가 stored/no_change인 경우만 저장 완료다. stale_ignored/거절은 완료로 세지 않는다.
- 강제 raw_backfill 이벤트와 run별 capture_trigger를 기록해 중단 뒤 이미 큐에 있거나 저장된 이벤트를 재사용한다. 개인 삭제 tombstone은 복원하지 않고 hold로 남긴다.
- 카드의 채움/못 채움은 해당 준비 단계가 완료한 보충 작업 합계다. 기존 DB의 모든 보충값 개수를 뜻하지 않는다.

## capture 호출 지점 대응

공통 처리: 전환 전 v1 유지 → 새 정책 active/capability 2 확인 시 v2 고정 → 원본/보충/관측 변경도 이벤트 발급.
한 번 전환한 범위에서 capability가 잠시 꺼지면 v2를 대기시키며 v1로 후퇴하지 않는다.
원본 바이트는 저장 스냅숏을 검증해 그대로 사용하고, 개인 override를 서버 원본으로 만들지 않는다.

| 경로 | PC | 모바일 | 처리 결과 |
|---|---|---|---|
| 일반 수집·개별/알림 수집 | `core/storage/reports_repo.py` capture | `SyncEngine.captureAndSaveDetail` | 공식 envelope와 원래 필드/사진/별점 보충을 capture에 전달 |
| 누락 원본 재수집 | raw_backfill runtime → reports_repo.save_crawled | raw runtime → captureAndSaveDetail | 같은 개인 저장 경로, source/trigger raw_backfill |
| DB 최적화·재파싱 | db_optimize → reports_repo | DbOptimize.captureReal | 새 상세는 받은 envelope, 재파싱은 저장 원본 사용 |
| 사진 촬영시각 보충 | photo_capture_time.fill_one | MaintenanceService → capture | 업데이트한 사진 정보를 adapter/raw supplement에 반영 |
| 추정 금액 재전송 | resend_fine_estimate_updates | resendFineEstimateUpdates | 최종 관측 payload를 만든 뒤 원본 이벤트 결합; 금액이 같아도 보충 변경은 캡처 |
| 수동 재공유 | community_upload_status.request_reshare | capture/reshare.dart | frozen raw_event_json 유지, 현재 동의 문맥으로 새 이벤트 발급; 원본 없으면 raw_required |
| 재동의 catch-up | community_consent_jobs | ConsentCatchup/CommunityWiring | v2는 전용 raw_backfill로 연결; v1 기존 동작 유지 |
| 목록 누락·별점/사유·EXIF 보충 뒤 최종 전체 전송 | raw runtime.enqueue | raw runtime.enqueue | 답변 완료 전체 force enqueue, trigger raw_backfill, run별 재개 |
| 업로드 재시도·수동·자정·백그라운드 | community_uploader | CommunityUploader | journal의 불변 문자열만 전송; v1/v2 혼합 금지 |

## 철회와 Client 동작

로컬 철회 요청은 거부 이력을 먼저 기록한다. 수집·최적화·사진 보충·업로더·수집 cron/자정 업로드 또는 모바일 background job을 중단한다.
PC는 crawl_manager 복원 세대, 모바일은 work_generation과 personal_sync를 검사한다. 네트워크 뒤와 저장 트랜잭션 안에서도 문맥을 검증한다.
늦은 ACK는 영수증을 쓰지 못하고, 늦은 headless status는 writer/context와 ok 캐시를 다시 활성화하지 못한다.
철회 응답 도중 세션이 바뀌면 새 세션을 초기화하지 않는다.

revoke_pending에는 계정·grant·시도·다음 시각을 보존한다. PC 기동/60초 poll, 모바일 foreground 30초 timer/전용 WorkManager 작업이 재시도한다.
철회 실패 중에는 토큰을 지우지 않고 “철회 처리 중” 화면에 둔다. stale_grant는 다음 status에서 현재 grant를 다시 확인한다.
서버 확인 뒤 active writer/session/cache와 raw_backfill 표식을 비운다. 개인 신고 DB·원본·DB 주인·동의 이력·journal은 보존한다.
같은 계정의 새 로그인·재동의는 기존 DB에서 새 backfill을 시작한다. 다른 계정은 기존 db_owner_mismatch 흐름을 따른다.

Client는 PC의 can_local/can_browse/can_enter를 엄격한 bool로 판정한다. PC가 잠기면 모바일도 서버 동의 필요로 잠기며,
PC 주소/키가 바뀐 뒤 늦게 온 거부가 새 서버를 잠그지 않도록 scope를 비교한다. native WS 4403 신호도 gate 재확인을 예약한다.

## 시험 결과

| 검사 | 결과 | 로그(각 worktree의 .agent-runs/raw-ingest-2/) |
|---|---|---|
| PC 최종 순수 판정·SQLite·mock transport 회귀 | 349 tests PASS (72.673초) | regression-complete.log |
| PC 최종 backfill·전송·철회·account_ops 집중 재검사 | 31 tests PASS (위 회귀와 중복 포함) | lifecycle-final.log |
| PC capability 일시 중단/전환 포함 delivery | 6 tests PASS (집중 검사와 중복) | transition-final.log |
| Dart backfill 공통 trace + Client bool 판정 | 43 assertions PASS | dart-backfill-final.log |
| Dart 기존 원본/gate/ACK/manifest 확인 | gate 17개·raw 바이트 4개·envelope/supplement/observation 해시·ACK protocol·manifest PASS | dart-ingest.log |
| Flutter 3.47.5 analyze --no-pub | 0 issue PASS (30.3초) | analyze-complete.log |
| PC Jinja 3개 + inline JavaScript, shell-polling.js | PASS | static-checks.log |
| git diff --check | PC/mobile PASS | 명령 직접 실행 |

349건과 31건 등은 중복이 있으므로 합쳐서 전체 시험 건수로 보고하지 않는다. 최종 349건 실행은 마지막 세대/heartbeat 변경과 추가 두 사례까지 포함한다.
초기 PC 239건 실행은 옛 revoke 순서 mock 시험 1건 오류가 있었다. 새 pending 철회 흐름에 맞춰 시험을 고친 뒤 위 회귀/집중 검사가 통과했다.
초기 Dart trace는 Map<String,Object>로 추론된 항목에 문자열을 넣는 runtime TypeError가 있었다. 명시적 dynamic map으로 고친 뒤 43개 판정이 통과했다.
Dart format은 파일 포맷 뒤 telemetry의 read-only 전역 파일 접근 오류가 있었으며 CI/analytics 억제 환경으로 다시 실행했다.
포맷 뒤 드러난 중괄호 lint 39개도 실제 코드를 고쳤다. 실패를 skip하거나 규칙을 완화하지 않았다.

### 재실행 명령

아래는 각각 pc/ 또는 mobile/ worktree 안에서 실행한다. 설치·pub get·네트워크가 필요하지 않다.

PC 집중 시험:

```sh
mkdir -p .agent-runs/raw-ingest-2/tmp
SAFETYREPORT_DATA_DIR=$(mktemp -d "$PWD/.agent-runs/raw-ingest-2/data.XXXXXX") TMPDIR="$PWD/.agent-runs/raw-ingest-2/tmp" PYTHONPATH=tests:. /home/better0101/projects/safetyreport/.venv/bin/python -m unittest test_raw_backfill test_raw_delivery_lifecycle test_soft_reset_retry test_community_account_ops
```

PC 최종 회귀(349개):

```sh
SAFETYREPORT_DATA_DIR=$(mktemp -d "$PWD/.agent-runs/raw-ingest-2/data.XXXXXX") TMPDIR="$PWD/.agent-runs/raw-ingest-2/tmp" PYTHONPATH=tests:. /home/better0101/projects/safetyreport/.venv/bin/python -m unittest test_raw_backfill test_raw_delivery_lifecycle test_soft_reset_retry test_raw_ingest_v2 test_community_store test_community_uploader test_community_upload_control test_community_deletion test_community_selection test_community_backfill_vectors test_community_client_rules test_community_contract_vectors test_community_capture test_community_schedule test_community_scheduler_split test_community_account_ops test_community_packaging test_community_ingest_client_ua test_community_config_migration test_community_consent_markdown test_raw_detail_storage test_raw_detail_vectors test_community_auth.StoreTests test_community_auth.HelperTests test_community_gate.DecideTests test_community_gate.SafeNextTests
```

모바일(복사한 SDK는 원래 SDK startup cache가 읽기 전용이어서 앞 작업에서 준비한 3.47.5 사본; 앱 의존성 변경 없음):

```sh
CI=true FLUTTER_SUPPRESS_ANALYTICS=true .agent-runs/flutter-3.47.5/bin/cache/dart-sdk/bin/dart scripts/check_raw_backfill.dart
CI=true FLUTTER_SUPPRESS_ANALYTICS=true .agent-runs/flutter-3.47.5/bin/cache/dart-sdk/bin/dart scripts/check_raw_ingest.dart
CI=true FLUTTER_SUPPRESS_ANALYTICS=true .agent-runs/flutter-3.47.5/bin/flutter --suppress-analytics analyze --no-pub
```

검수자 환경의 소켓/렌더 시험(**이번 실행은 NOT RUN**):

```sh
# pc/
SAFETYREPORT_DATA_DIR=$(mktemp -d) /home/better0101/projects/safetyreport/.venv/bin/python -m unittest discover -s tests -p 'test_*.py'
# mobile/ — 반드시 Flutter 3.47.5
/home/better0101/development/flutter-3.47.5/bin/flutter test --no-pub test/community test/widgets/raw_progress_notice_test.dart
```

### 새/변경 시험 파일

- PC 새 파일: `tests/test_raw_backfill.py`, `test_raw_delivery_lifecycle.py`, `test_soft_reset_retry.py`, `tests/fixtures/raw_backfill_cases.json`.
- PC 변경 파일: `test_community_account_ops.py`(revoke가 begin→attempt로 가는 순서), `test_community_live_stack.py`(철회 뒤 재로그인·명시적 재동의·잠금), `test_community_gate.py`(원격 철회 후 세션/writer 해제·302), `test_community_offline.py`(미동의/철회 잠금·주인 보존·실패 pending), `test_community_capture.py`, `test_community_store.py`, `test_raw_ingest_v2.py`. 마지막 일부는 앞 작업 변경을 포함한다.
- 모바일 새 파일: `test/community/raw_backfill_test.dart`, `raw_delivery_lifecycle_test.dart`, `test/widgets/raw_progress_notice_test.dart`, `test/fixtures/raw_backfill_cases.json`, `scripts/check_raw_backfill.dart`.
- 모바일 변경 파일: `test/community/upload_background_test.dart`(PC gate 주입·늦은 headless status), `official_binding_gate_test.dart`(G1 근거 없는 장애 허용 제거), `emergency_offline_test.dart`(none/revoked 뒤 장애도 잠금), `gate_evaluate_test.dart`, `gate_state_test.dart`, `gate_silent_refresh_test.dart`, `client_account_notice_test.dart`, `fake_account.dart`, `community_store_test.dart`, `raw_ingest_v2_test.dart`. 일부는 앞 작업 변경을 포함한다.
- 공통 fixture는 합성 A/B/C 신고 세 개만 쓰며 두 사본의 바이트를 대조했다. 계약 디렉터리를 수정하지 않고 새 backfill 재개/휴지/hold/done 시나리오를 공유한다.

## 남은 검수와 결정

코드 구현 범위 밖으로 남긴 제품 기능은 없다. 다만 아래 실행 검수를 마치기 전 릴리스 완료로 표시할 수 없다.

1. PC HTTPServer 기반 계정·게이트·offline·catch-up 시험과 loopback/ASGI 통합, 전체 discover. 샌드박스 소켓 제한 때문에 NOT RUN.
2. Flutter tester 기반 SQLite·위젯·기존 전체 회귀. tester가 loopback 제어 소켓을 필요로 하므로 지시대로 NOT RUN. analyze/순수 Dart 통과는 렌더·플러그인 실행 통과를 뜻하지 않는다.
3. PC 브라우저 지도 카드·전역 배너·철회 대기 화면, 모바일 AVD 지도 카드·root 대화상자·동일/다른 계정 재로그인, 앱 종료→WorkManager 커서 재개, 최적화/수집 경합과 세대 취소. Kotlin WS 4403 경로의 컴파일/실기동 포함.
4. 새 정책/capability를 켠 실제 v2 서버의 저장 ACK/duplicate/parse_pending 연계와 큰 개인 DB의 처리량 검수. 원본/회원 자료 없이 합성 시험만 실행했다. 운영 P6/P7은 실행하지 않았다.

계약 변경 요청은 없다. 기존 PLAN 13절의 정책 문구·릴리스 버전·구버전 차단일은 검수자/사용자 결정 대상으로 그대로 남긴다.
작업서에서 정한 raw_unavailable 제외 분모를 그대로 적용했으며 새 제품 결정을 대신 하지 않았다.
