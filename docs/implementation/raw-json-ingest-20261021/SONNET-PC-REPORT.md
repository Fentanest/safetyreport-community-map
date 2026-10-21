# SONNET-PC-REPORT · PC 검수 결함 수정 (2026-10-21)

범위: `pc/` worktree(feat/raw-json-ingest, 기준 dev 1a67d01, 전부 미커밋)만 수정. map/auth/mobile·`pc/contracts/` 는 건드리지 않았다.
커밋·push·원격 접속 없음. 이 문서가 map 쪽 유일한 쓰기다.

## 0. 시작 상태와 판단

중단된 이전 실행은 backfill 재작성(건별 상태 SQLite 표 `raw_backfill_items`, marker 요약)과 함께 게이트(리셋 근거 소거·시드·G7 엄격 판정),
철회 재시도 경로, 알림 일부까지 이미 고쳐 둔 상태였다. 그러나 `community_raw_backfill.py` 는 시험·runtime 과 어긋나 있었다
(marker 에 `items` 를 기대하는 시험, 항목마다 commit, retry 로직 불일치 등). 처음 전체 시험을 돌려 보니 검수자의 25건 중 대부분은 이미 풀려 있었고
실제 실패는 23건(시험 환경 영향 1건 포함)이었다. 아래는 최종 상태 기준이다.

최종 전체 시험(재실행 명령은 8절): **Ran 1419 tests, OK (skipped=6)**, 373초(시드 기준 변경 뒤 재실행). 기준 1a67d01 은 1327건, 검수자 환경 실행은 1355건(실패 25)이었다.

## 1. 검수 지적별 처리 (pc-review.md)

| 항목 | 파일·요약 | 시험 |
|---|---|---|
| 1 CRITICAL 재로그인 무한 리셋 | `services/community_gate.py` `reset_verdict`/`status_wellformed`(리셋은 G1 근거가 있고 응답 형식이 정상일 때만, `gate_policy` 표와 같은 규칙). `community_account_ops.soft_reset` → `community_cloud.reset_evidence` 가 `last_g1` 을 지우고 `reset_completed_at` 기록. G1 기록(`mark_g1`)은 기여자 active 일 때만(예전엔 contributor none 에서 기록돼 다음 poll 에서 G8 리셋). `community_cloud.record_status`: 리셋이 남긴 sticky 거부(`consent_revoked`/`account_removed`)를 새 grant 의 active 확인 때 해제(다른 기기·지도 웹 재동의 대응). | `test_review_fixes_gate.ReloginAfterRevokeTests`(실제 `regate('login')` 4회 반복, 리셋 호출 수 1 고정, 재동의, 재철회 시 다시 1회), G8 경로, 근거 없는 로그인은 리셋 0, sticky 해제. `RevokeRetryRouteTests.test_relogin_through_routes_...`: 실제 HTTP 라우트(start→confirm→gate) 2회 재로그인에서 `consent_required`·리셋 1회. 고쳐 본 시험을 일부러 깨 보아(근거 소거 제거 등) 실패하는 것을 확인. |
| 2 HIGH 목록 단계 retry → 0건 done | `services/community_raw_backfill.py` `RawBackfill.run`: retry 는 holds·휴지만 풀고 현재 phase 유지(목록 완료 뒤에만 filling 으로). publish 불변식: 목록 미완료·미처리 항목이 있으면 `done` 을 `listing`/`filling` 으로 내린다. 목록 조회의 일반 예외도 `list_failed` 휴지로 바꿔 백오프 없는 반복을 막음. | `RetryInvariantTests` 5건(list_incomplete 에서 retry 3회, waiting_optimize, 옛 결함 marker 강제 주입, 0건은 목록 완료 뒤에만 done, BackfillBlocked 항목 분모 제외). 공유 trace 픽스처(`raw_backfill_cases.json`) 5건 그대로 통과. |
| 3 HIGH v2 영구 고정 | `community_uploader._build_batch`: status 에서 2 가 빠지면(`selected()` 비고정) 대기 중 실시간·수동·재공유 v2 행은 같은 event_id 의 v1 payload 로 전송, `raw_backfill` 행은 60초 간격 보류(`v2_unavailable`). `release_raw_required`: v1 로 돌아가면 `raw_required` 로 막힌 행을 풀어 v1 로 전송. 새 수집은 v1(원본 사본 없음). gzip 503 은 기존 `server_busy` 재시도 분류 그대로(행 `retry_wait`, 차단·삭제 없음). 이전의 sticky `raw_contract_scope` 시험 삭제·교체. | `test_raw_delivery_lifecycle`: v2→v1 전환 시 v1 봉투·payload 전송, backfill 행 보류 후 v2 복귀 시 전송, `raw_required` 해제, gzip 503 retry_wait. |
| 4 MEDIUM-HIGH 큰 DB | 건별 상태는 `raw_backfill_items`(run_id, report_id, position, state, attempts …), marker 는 요약(크기 ≈700B 상수). 항목 갱신은 100건 단위 한 트랜잭션(`put_many`), 이전 run 항목 삭제. 원본이 있는 건은 네트워크 없이 처리(네트워크 단계만 0.5초 간격). 스레드 pass 는 45초, 3초 안팎 slice 마다 예약(rating 토큰)을 놓고 1초 쉼. ACK 대기만 남으면 pass 종료(10Hz 폴링 제거), `done` 이면 poll 이 스레드를 만들지 않음(`start()` → `_finished`). 인덱스 `source_journal_logical(source_report_id, dataset_key, contributor_fingerprint)` 추가(삭제 표시·prior 조회가 신고마다 전체 스캔하던 O(N²) 제거). `request_reshare` 는 신고마다 읽고 버림(전체 메모리 적재 제거). ACK 받은 journal `raw_event_json` 은 비교 해시만 남기고 축약(`community_raw_ingest.compact`). 실측: 실제 prepare/enqueue 3,000건 합성 DB 약 3.4ms/건·marker 쓰기 5회·메모리 수 MB(선형). | `LargeBackfillTests`: 5,000건 상태기계(marker 쓰기 40회 미만·크기 2KB 미만·메모리 64MB 미만·60초 미만, 표 5,000행 stored), `put_many` 1 트랜잭션, 이전 run 정리. 축약 후에도 같은 내용 재수집은 새 이벤트를 만들지 않는 시험(lifecycle). |
| 5 MEDIUM 보충·차단이 원본을 막음 | `community_raw_backfill_runtime.prepare`: 별점·사진 보충 실패(예외·미확인·로그인 불가 포함)는 `unavailable` marker 만 남기고 원본은 보낸다. 삭제 표시 신고·`not_eligible` 캡처·기관코드 초과·서버가 거절한 건은 `not_eligible`(분모 제외, hold 아님). `community_raw_ingest.supplement` 는 스키마 범위로 정규화(별점 1~5 밖 null, 문자열 최대 길이로 절단, 사진 수 0~1,000,000). 이미 조회한 신고는 다시 조회하지 않음. | `RuntimeSupplementTests`(실제 개인 DB 저장 경로), `SupplementNormalizationTests`(계약 `supplement.schema.json` 범위 대조, 0/6/적대적 입력). |
| 6 MEDIUM 철회 다시 시도 403 | `main.py` `_GATE_ALLOW` 에 `revoke-retry`(CSRF·관리자 세션 유지). 라우트 응답에 `result.revoked/pending` 추가. `onboarding_community.html`: 응답을 보고 확인/대기/실패(HTTP 코드)를 `aria-live` 영역에 표시, 성공 시에만 새로고침. | `RevokeRetryRouteTests`(허용 목록 포함, CSRF 없으면 403, 서버 회복 후 200·`kakao_required`, 페이지 렌더, 비로그인). |
| 7 MEDIUM G7 느슨함 | `reset_verdict`: `gate.kakao is False` + reasons 에 `kakao_missing` 만 G7. 형식 이상(gate 없음·문자열·0·None, contributor/consent 형식 이상)은 리셋 안 함(상태는 기존 `decide` 의 kakao_required/verification_required). G9 정지가 리셋보다 먼저. 공유 벡터 `status-dto`/`legacy-gate-vectors` 와 맞추려고 `decide()` 는 기준 순서를 유지하고 마지막에 `contributor != active → verification_required` 만 둠(legacy 벡터와 일치). | `G7StrictnessTests` 15건(`session_missing`, `user_not_eligible`, 이유 없음, 비문자열, 형식 이상 6종, 정지+철회). 형식 검사를 빼면 3건이 실패함을 확인. |
| 8 client_upgrade_required | `services/community_notice.py` 재작성: status 가 정본(없음/null → 안내·426 표시 해제 + 막힌 행 풀기), 성공 ACK 가 426 표시 해제, 426 표시는 앱 버전별(업데이트 뒤 자동 해제), `save` 가 형식 틀린 값으로 기존 안내를 지우지 않음. 하드코딩 FALLBACK 제거 — 서버 문구가 없으면 "앱을 최신 버전으로 업데이트해 주세요."만. 426 행은 blocked 가 아니라 1시간 `retry_wait`(`_apply_error`), 표시 해제 시 즉시 pending. | `test_raw_delivery_lifecycle`(426 → 일반 문구·retry_wait, status null 로 해제·pending, 버전 변경 시 만료, 성공 ACK 해제, 형식 틀린 안내 무시). |
| 9 LOW v1 회귀 | `reports_repo._community_capture_for`: v2 스냅숏 준비 전체를 try 로 격리(`note_fallback`), 실패해도 `capture` 호출. `capture` 내부 `snapshot_for_adapter` 도 격리. `ingest_status` 읽기 실패는 {}(=v1). v1 DTO 입력은 기준과 같음(`_community_capture_for` 의 v1 경로 diff 없음, `사진_촬영수` 는 SELECT 열만 추가). `consent_jobs._tick` 은 v2 준비 시 job 을 `succeeded/raw_backfill` 로 완료 처리. | `PersonalSaveIsolationTests`, 계약 벡터·캡처 기존 시험 통과. |
| 10 LOW 개인정보 | `cached_status` 는 consent{state,grant_id,policy_version}·ingest{contracts,raw_policy_version}만 저장. `community.db` 는 연결 시 0600(POSIX). | `StoreHygieneTests`, `StatusPrivacyTests`(display_name·dataset_key 부재). |
| 배포 위험 last_g1 시드 (검수자 추가 지시로 기준 변경) | `community_cloud.seed_g1`: 동의 이력은 전이만 기록하므로 'active 로 바뀐 시각'을 쓰지 않는다. last_g1 이 한 번도 없고(`g1_seeded` 표시 없음, 리셋·거부·정지 기록 없음) 기존 암호화 동의 이력의 최신 결과가 active 이며 같은 카카오 회원·DB 주인·dataset(바인딩)일 때만, **새 버전을 처음 실행한 시각(지금)** 을 last_g1 으로 1회 시드하고 `g1_seeded` 를 남긴다. 최신 이력이 active 가 아니면 시드하지 않는다. 72시간 규칙은 그대로. | `UpgradeSeedTests` 9건(90일 전 전이여도 지금으로 시드·1회뿐, revoked/outdated/none 미시드, 다른 회원·다른 dataset 미시드, 리셋한 계정 미시드, 시드된 유예도 72시간 뒤 만료). |

mobile-review 공유 항목: 1·2·3·6·7·8·11 은 위 표와 같다. 추가로 11(run identity): `RUN_IDENTITY=('local_dataset_id',)` — parser_target·writer_epoch·connection·grant·계정은 run 을 바꾸지 않고
marker 의 참고 범위만 갱신한다. 다시 도는 조건은 local_dataset_id 변경과 소프트 리셋(marker 삭제) 뒤 재동의뿐. 주의: 같은 local_dataset_id 에서 카카오 계정만 바뀌는 경우는 DB 주인 불일치 흐름이
데이터를 지우므로(데이터셋 회전) 별도 키로 두지 않았다. 모바일이 계정 키를 identity 에 남겨 둔다면 1:1 이 깨지므로 확인 필요.
알림(6): 앱 버전 < `min_version.pc` 일 때만 표시(`min_version.pc` 가 비었거나 읽을 수 없으면 표시 안 함, 426 표시는 예외), info/warning 은 배너, required 는 배너 + 하루 한 번(내용 해시) 대화상자(`shell-polling.js`, `localStorage`).

## 2. 검수자 실패 25건 → 원인·처리

(대부분은 이전 실행에서 이미 풀려 있었고, 아래는 원래 원인과 최종 해소 방식이다. 괄호는 이번에 추가로 만진 것.)

| 원 실패 | 원인 | 처리 |
|---|---|---|
| `test_suspension_survives_local_revoke_outage_and_restart` (AttributeError `stop_background`) | `community_reset.stop_work` 가 없는 `community_uploader.stop_background` 호출 | uploader 에 `stop_background(timeout)` 존재(이전 실행). 시험의 가짜 uploader 모듈에도 추가됨. |
| DB 최적화 시험군(`test_db_optimize*`, 12건), `test_maintenance_service` 2건 | 새 작업 허가가 게이트 문맥 없는 환경에서도 maybe_start 를 막음 | 허가 검사를 "명시적 계정 중단 중(`pause_for_account`)이고 같은 data 경로일 때"로 한정(이전 실행). 이번 추가: `maintenance_service.stop_for_account` 가 돌고 있는 작업이 없을 때 전역 상태를 `paused` 로 남겨 `status.active` 가 새는 문제(전체 시험에서만 재현) 수정, resume 이 상태 복구. |
| `test_unknown_transport_result_does_not_change_baseline` | baseline 계정 행에 시드/`last_g1` 쓰기가 섞임 | 시드는 오프라인 판정 때만, `mark_g1` 은 최초/10분 간격만 쓰도록 정리(이전 실행). 현재 통과. |
| `test_onboarding_consent_flow_and_revoke` (500) | 철회 흐름이 새 `community_reset.begin/attempt` 로 바뀌었는데 의존성 누락 | 통과(이전 실행) + 기대값을 소프트 리셋(`kakao_required`, 일반 화면 302)으로 갱신. |
| `test_change_listener_fires_on_loss`, `test_remote_revoke_blocks_on_next_poll`, `test_remote_revoke_soft_resets_...` | 원격 철회가 이제 소프트 리셋 | 정책 변경에 맞춘 기대값(아래 3절). |
| `test_every_silent_fallback_is_classified` | 조용한 대체 3~4곳 | `RuntimeBackend.close`/heartbeat 는 `note_fallback`(이전), 이번 추가: `community_reset.resume_work`·`community_schedule.pause_upload_jobs`(이미 없는 job 확인 후 제거 + `note_fallback`). |
| (이번 전체 실행에서 새로 드러난 23건) | | |
| `test_community_client_rules`(5), `test_community_gate.DecideTests`(2) | 이전 실행이 `decide()` 를 G7/G3 엄격화하면서 공유 벡터(`community-client/status-dto.json`, legacy 벡터)와 어긋남 | `decide()` 를 기준 순서로 되돌리고(마지막에 `contributor != active` 만 legacy 벡터대로 유지) G7 엄격성은 리셋 판정(`reset_verdict`)으로 옮김. |
| `test_community_offline` 2건, `test_soft_reset_retry` 2건 | 재로그인 뒤 writer 충돌(`regate('login')` 없이 `connect` 만 호출, 실제 라우트는 claim), `reset_evidence` 가 가짜 service 에 `auth_dir` 없음 | 시험이 실제 라우트와 같이 `ops.regate('login'/'consent_saved')` 를 부르게 수정, 가짜에 `reset_evidence` 를 목 처리. |
| `test_community_consent_catchup` revoked/outdated 2건 | 같은 시험이 G1 이후 revoked 를 보면 이제 리셋됨 | 리셋 뒤 재로그인을 시험에 추가(정책 변경). |
| `test_raw_backfill` 3건, `test_raw_delivery_lifecycle` 1건 | 재작성 미반영 시험(저장 경로가 일반 캡처를 만들지 않음, 조회 marker 재사용, sticky 전환) | 3절. |
| `test_many_joined_manual_calls_share_one_run...` | 전체 실행에서만 한 번 실패(타이밍/잔여 스레드). 단독·최종 전체 실행에서는 통과 | 코드 변경 없음, 재현되지 않음(남은 위험으로 기록). |

## 3. 바꾼 기존 시험과 이유 (의도한 정책 변경 여부)

이전 실행이 바꾼 것(정책 변경 때문, 이미 SOL-REPORT-2 에 목록 있음)과 이번에 바꾼 것을 함께 적는다.

| 시험 | 변경 | 이유 |
|---|---|---|
| `test_community_gate` `DecideTests.test_contract_gate_vectors` | 읽는 벡터를 `contracts/community-ingest-v2/legacy-gate-vectors.json`(first_time_contributor_none → verification_required)로 | 정책 변경(G1 은 기여자 active 필요). 계약 사본은 수정하지 않음. |
| `test_order_first_failure_wins` | contributor none → `verification_required/contributor_missing` | 같은 정책. |
| `GateServiceTests.test_remote_revoke_blocks_on_next_poll`, `test_change_listener_fires_on_loss`, `GateAppTests.test_onboarding_consent_flow_and_revoke` | 철회 후 `consent_required` → 소프트 리셋 `kakao_required`, 세션·writer 해제, 일반 화면 302 | 정책 변경(철회 = 소프트 리셋, 로컬 사용 불가). |
| `test_community_offline`: revoked/미동의 로컬 허용 시험 3건 | 로컬 허용 → 불가(`can_local` False), 미동의는 주인 기록 안 함 | 정책 변경(동의 없으면 사용 불가, 확인 불가만 72시간). |
| `test_community_offline` 재동의 reshare 2건 | revoked 로 기록되던 journal 차단 사유 시험 제거, 리셋 → `connect` + `regate('login')` → 동의 `regate('consent_saved')` | 정책 변경 + 실제 라우트와 같은 순서. |
| `test_community_consent_catchup.test_known_nonactive_to_active_schedules_once` | revoked/outdated 하위 케이스에서 리셋되면 다시 로그인 | G1 이후 revoked 는 리셋(정책 변경). 로그인 후 흐름은 그대로 검증. |
| `test_community_account_ops` 철회 시험 | begin → attempt 순서, 결과 `pending` | 철회가 영속 대기 + 서버 확인 뒤 리셋으로 바뀜. |
| `test_community_live_stack` | 철회 후 `kakao_required`, 재로그인·`ops.consent` 사용 | 정책 변경 + 실제 흐름. |
| `test_community_store` | schema 4, 단계 수 3 | journal `raw_event_json` 열 추가. |
| `test_community_capture` | `_community_capture_for` 목이 kwargs 허용 | 시그니처에 `engine=` 추가. |
| `test_soft_reset_retry` | `cloud.reset_evidence` 목 + 로그아웃 전에 근거 소거가 호출되는지 단언 | 항목 1(리셋 때 근거 소거). |
| `test_raw_backfill` | 식별 시험 `test_dataset_grant_and_writer_changes_restart_once` → `test_only_local_dataset_change_restarts_the_run` | 항목 11 결정(run identity). |
| `test_raw_backfill` 만료 판정 | 두 번째 prepare 전에 보충 marker 삭제 | "이미 조회한 신고는 다시 조회하지 않음" 정책. |
| `test_raw_backfill` 손상 원본 | prepare 는 일반 캡처를 만들지 않음을 단언하고 `enqueue` 로 v2 journal 확인 | 이벤트는 enqueue 한 번만 생성. |
| `test_raw_delivery_lifecycle` | sticky 시험 삭제 → v2→v1 전환·보류·해제 시험들, `FALLBACK` 의존 제거, 426 기대 갱신 | 항목 3·8 결정. |

## 4. 새 시험

- `tests/test_review_fixes_state.py`(21건, 소켓 불필요): retry 불변식, 5,000건 큰 DB, put_many, 설정/권한(0600, ingest_status), 보충 정규화·실패, 삭제/부적격 not_eligible, 개인 저장 격리, 끝난 run 스레드 미생성.
- `tests/test_review_fixes_gate.py`(36건, loopback): 재로그인 무한 리셋(서비스·HTTP 라우트), G7/G8/G9, 업그레이드 시드(지금 기준 1회), ingest_status 프라이버시, revoke-retry 라우트·페이지.
- `tests/test_raw_delivery_lifecycle.py` 보강(13건): v2→v1, 보류, 426/알림/버전 비교, 축약, raw_required 해제, gzip 503.

## 5. 계약·벡터 변경 요청 (map 정본에 반영 필요 — pc/contracts 사본은 수정하지 않음)

`contracts/community-ingest-v2/gate-vectors.json` (PC 판정은 `tests/fixtures/review_gate_cases.json` 로 이미 새 기대값으로 시험함. 모바일 동일하게 필요):

1. `G7` 입력에 `"reasons": ["kakao_missing"]` 추가(기대값 `soft_reset` 유지). `G7_new` 도 같은 `reasons` 추가(기대값 `login_required` 유지).
2. 새 케이스 추가(나머지 입력은 `G1` 과 같고 `confirmed:true, session:true, owner:true, binding:true, same_member:true, reauth:false, now:1000000`):
   - `G7_unproven_false`: kakao false, `reasons:["session_missing"]`, contributor active, consent active, last_g1 1000000 → `connection_required`
   - `G7_malformed`: kakao null(또는 bool 아님), 같은 조건, last_g1 1000000 → `connection_required`
   - `G6_after_reset`: kakao true, contributor active, consent revoked, `last_g1:null` → `consent_required`
   - `G8_after_reset`: kakao true, contributor none, consent revoked, `last_g1:null` → `consent_required`
   - `G9_before_reset`: kakao true, contributor suspended, consent revoked, last_g1 1000000 → `suspended`
3. (문서) `README.md`/`account-api.md`: client_notice 는 클라이언트 `min_version.<platform>` 보다 앱이 낮을 때만 표시, 해당 플랫폼 min_version 이 null 이면 표시하지 않음, status 의 null/부재가 정본이고 426 표시는 앱 버전별이며 성공 ACK·status null 이 해제한다는 문장을 추가하면 두 앱의 구현이 문서와 일치한다.
4. (문서) `errors.md` 503 `service_unavailable` 행에 "클라이언트는 같은 event_id 를 재시도하고 다음 status 에서 contracts 에 2 가 없으면 v1 형식으로 보낸다"를 명시하면 좋다.

## 6. 남은 일·위험

- 브라우저·AVD·실제 안전신문고/206 호출은 하지 않았다. 철회 페이지 JS, 상단 배너·필수 대화상자(`srConfirm`)는 `node --check` 와 서버 렌더 시험까지만 확인했고 실제 화면 검수는 NOT RUN.
- backfill 스레드 루프(`_run_runtime` 의 pass 종료 조건·slice 간 휴지)와 실제 네트워크 단계(상세 재수집·만족도·사진)는 직접 시험하지 못했다. 상태기계·DB 경로는 시험했고 합성 3,000건 prepare/enqueue 를 실제 저장소로 돌려 선형임을 확인했다(시험 코드에는 5,000건 상태기계만 포함).
- 시드 기준을 '지금'으로 바꿔(검수자 추가 지시) 오래된 사용자의 업그레이드 직후 오프라인 잠금 위험은 사라졌다. `min_version.pc` null 이면 안내 숨김 규칙은 유지.
- run identity 를 `local_dataset_id` 하나로 한 점(1절)과 `min_version` 이 null 이면 안내를 숨기는 점은 모바일과 동일하게 맞춰야 한다.
- `test_many_joined_manual_calls_share_one_run_started_after_they_arrived` 가 첫 전체 실행에서만 1회 실패(재현 안 됨).
- 경고 정리: pyflakes 가 기존 코드의 미사용 변수 2건(`community_gate.evaluate` 의 `member`, `community_uploader` 의 `global`)을 보고하지만 이번 변경과 무관해 두었다.

## 7. 변경·추가 파일 요약(이번 실행분)

수정: `services/community_gate.py`, `community_cloud.py`, `community_notice.py`(재작성), `community_raw_backfill.py`, `community_raw_backfill_runtime.py`, `community_backfill_store.py`, `community_raw_ingest.py`, `community_uploader.py`, `community_upload_status.py`, `community_capture.py`, `community_consent_jobs.py`, `community_reset.py`, `community_schedule.py`, `maintenance_service.py`, `core/storage/reports_repo.py`, `web/routers/community_route.py`, `web/static/ui/shell-polling.js`, `web/templates/onboarding_community.html`, 문서 `docs/architecture/community-upload.md`·`community-gate.md`, `CHANGELOG.md`. 시험: 3절·4절.

## 8. 재실행 명령

```
cd /home/better0101/projects/raw-json-ingest-ws/pc && SAFETYREPORT_DATA_DIR=$(mktemp -d) /home/better0101/projects/safetyreport/.venv/bin/python -m unittest discover -s tests -p "test_*.py"
```
새 시험만: `... -m unittest discover -s tests -p "test_review_fixes_*.py"` (소켓 필요), `-p "test_raw_*.py"`.
