# plan-review-sol-01 지적 처리 (Opus5.5)

검토: GPT-6-Sol, Codex job `task-muh8e98y-qnzsw0`, thread `01a0d999-7780-7592-86a0-caa9bde3eb43`,
rollout `~/.codex/sessions/2026/09/26/rollout-2026-09-26T02-25-08-01a0d999-….jsonl` 의 turn_context: model `gpt-6-sol`, cwd = `…/community-map/plan-review-sol`, sandbox `workspace-write`(network off), effort high.
(Sol 보고서 0절은 자기 모델 ID 를 실측하지 못했다고 적었다 — 위 rollout 대조가 그 확인이다.)
Sol 환경: deno·node 실행 가능, Supabase CLI(홈 telemetry 쓰기 EROFS)·Docker 소켓은 sandbox 에서 거부 → **로컬 Supabase 통합 스택 실행과 동적 증거는 Opus 가 맡고 Sol 은 증거·diff 를 검증**한다.

| ID | 심각도 | 처리 | 결정·근거 | 반영 위치(plan-final) |
|---|---|---|---|---|
| S-01 | critical | **수용** | 공개 RPC 는 좌표 결측 완료 fact 도 반환. 지도 지점만 좌표 필요, bbox 필터 시에만 좌표 없는 fact 제외. `location_missing` coverage 추가. 모집단은 "공유된 완료 신고"로 capability·문구 변경, 완료 비율·미완료 비중 등 분모 없는 지표는 unsupported | §3.4, §3.6 |
| S-02 | critical | **수용** | fact 는 **그 fact 를 수락한 grant 가 활성일 때만** 공개. 재동의는 과거 fact 를 자동 재공개하지 않음. 사용자가 지도 탭에서 명시적으로 "이전 수집 사본 다시 공유"를 누르면 journal 최신 사본을 새 grant·새 revision 의 `reshare` 이벤트로 보냄(원 captured_at 유지). 삭제 요청(`contributions-delete`)은 fact 삭제 + tombstone(삭제 시각 이전 captured_at 이벤트는 영구 거절) + version 갱신 | §3.2, §3.4, §4, §8 |
| S-03 | high | **수용(상태 정의)** | 2PC 로 포장하지 않는다. journal 먼저 commit 하는 이유(역순이면 개인 DB 가 종결 Y 가 된 뒤 사본이 영구 유실)를 명시하고, journal 에 `personal_save_state(pending/saved/failed)` 를 둔다. 전송 가능 여부는 개인 저장과 독립(공식 응답 사본이므로). 개인 저장이 안 된 신고는 다음 수집에서 상세 재조회 대상이 되고, 같은 내용이면 새 이벤트를 만들지 않는다(같은 event ID 로 수렴). crash 지점 3곳 테스트 | §5, §11 G11 |
| S-04 | high | **수용** | 같은 사용자 재로그인 = 같은 connection **rebind**(epoch 유지) → pending 그대로 전송. 다른 사용자·새 grant·새 connection 으로 자동 승계 없음. takeover·연결 폐기로 막힌 pending 은 `blocked:<code>` 로 보존·표시, 사용자가 명시적 `reshare` 로만 새 epoch 이벤트 재발급. immutable 본문(payload·captured_at·event_id·source_revision·writer_epoch)과 전송 문맥(세션·trigger) 분리 | §3.2, §5, §8 |
| S-05 | high | **수용** | fact 키 = (contributor, **connection 의 dataset_key**, source_report_key). dataset_key 는 연결 등록값에서 서버가 취함(이벤트 본문에서 받지 않음). source_report_key 도 서버가 계산 | §3.4 |
| S-06 | high | **수용(문구·설계 변경)** | PC: `crawl_control.start_rebuild(run_id)` → `start.py --force --rebuild <run_id>`(신규 인자), rebuild items = **이번 run 의 완전한 목록 결과** ID. 모바일: rebuild 모드에서 목록 부재 행 삭제를 하지 않음(orphan 보존·건수 표시). "개인 DB shadow cutover" 주장을 철회하고 **사전 일관 백업 + 기존 사용자 데이터 보존 제자리 갱신 + community.db 수준 staging→검증→cutover** 로 정확히 기술 | §7 |
| S-07 | high | **수용** | allowlist 에 `POST /settings/community/settings`(관리자 세션+CSRF 유지) 추가. 일반 `/settings/save` 는 게이트 뒤. 미들웨어 순서(Session → auth → gate)를 ASGI 테스트로 고정 | §6.2 |
| S-08 | high | **수용** | `update_jobs()` 는 크롤 job ID 만 제거·재생성. 커뮤니티 job(`community-midnight-upload`, `community-gate-poll`, `community-uploader-wake`)은 `register_community_jobs(scheduler)` 로 독립 등록되고 `update_jobs` 끝에서도 재확인. 크롤 스케줄러 enabled=false 와 무관 | §8, §10 인터페이스 |
| S-09 | high | **수용** | 모든 RPC 잠금 순서 고정: policy(FOR SHARE/운영 변경 FOR UPDATE) → contributor → grant → connection → fact → analytics_state. POC 는 이미 contributor 선잠금이었고(문서가 틀렸음) policy 잠금 추가. 40P01/40001 → 503 `busy` retryable. 반복 경쟁 테스트 | §3.2, §3.4 |
| S-10 | high | **수용(부분)** | 운영 DB 조회는 승인 경계라 하지 않는다. 대신 공개 RPC 가 **contributor 단위 authoritative 전환**: 그 contributor 의 ingest fact 가 하나라도 있으면 그 사람의 구 v2 snapshot fact 는 제외, 없으면 기존대로 포함(이중 집계 방지 + 기존 v2 보존). 운영자용 읽기 전용 사전 점검 SQL 제공. invalidate 트리거는 contributor 변경 시 ready 를 끄지 않고 version·generated_at 만 갱신, 구 snapshot state 변경은 기존처럼 ready=false 유지 | §3.4, §13 |
| S-11 | high | **수용** | `published` = 커밋 시점 `ready=true` 이고 `generated_at` 이 있으며 공개 RPC 소스가 ingest 를 포함(이 migration 적용 = 참). 아니면 `held`. account status 에 `projection.ready` 노출. 통합 테스트: ACK published 직후 익명 공개 API 가 같은 version 으로 그 fact 를 포함 | §3.4, §11 |
| S-12 | high | **수용** | 두 앱의 증분 선정에 "목록 `상태`(C_NOW 라벨)가 마지막 상세 관측의 `상태` 와 다르면 종결 여부와 무관하게 상세 재조회" 추가(같은 `_C_NOW_STATUS` 라벨이라 변경 건만). 목록만으로 correction 을 만들지 않음, 상세 실패는 재시도 | §8.5 |
| S-13 | high | **수용** | 지연 상한 명시: 이 기기 로컬 철회·로그아웃 → 동기 무효화. 원격 철회 → 온라인이면 ≤60초(주기 status poll) 또는 업로드 403 즉시. 새 작업(크롤·업로드·초기화·설정 저장) 시작은 60초 이내 검증 필요(아니면 동기 재검증, 실패 시 시작 안 함). 화면 이동은 10분 캐시. 오프라인 기기는 최대 10분 뒤 `verification_required` 로 잠김 | §6.1 |
| S-14 | medium | **수용** | payload 에 `amount.penalty_points`(정수|null) 추가, disposition enum 은 코드(SQL/TS) 정본 `fine/warning/penalty/none/unknown` 유지하고 `docs/data-contract.md` 정정. 금액·벌점은 private 저장, `fine_amount` capability 는 missing 유지 | §4 |
| S-15 | medium | **수용** | `schedule_runs` 키 = (project_namespace, contributor_fingerprint, local_dataset_id, writer_epoch, schedule_key). UI 는 현재 context 만 | §5 |
| S-16 | medium | **수용** | 좌표를 e7 정수 대신 **double 의 최단 왕복 10진 문자열**(`"37.5662952"`, 소수점 없으면 `.0` 추가)로 보냄. 세 언어 모두 최단 왕복 표현(Python repr, Dart toString, JS String)이라 같은 double → 같은 문자열. 서버는 그 문자열을 double 로 저장, point_key 는 문자열 그대로 | §4 |
| S-17 | medium | **수용** | T0 에 인터페이스 고정: 게이트 서비스(`evaluate()/require_fresh()/on_change(cb)`), scheduler job ID·등록 함수, capture API, rebuild runner API, Dart 동등. 작업서에 같은 계약 commit 전달 | §10 |
| S-18 | high | **수용** | ingest 한도는 사용자·연결 기준(분당 60 요청·일 20,000 이벤트), **IP 헤더는 신뢰하지 않음**. 보안 행렬에 구 mutating RPC(`internal_activate_snapshot`, `internal_cleanup_expired`, relay·account RPC)·GraphQL·publication(Realtime)·Storage 음성 테스트 + 행 수 검증 추가 | §3.5, §3.6 |
| S-19 | high | **수용** | iOS `Info.plist` `CFBundleURLTypes` + `AppDelegate.swift` 의 URL open(cold/warm) → 기존 MethodChannel `com.fentanest.mysafetyreport/community_auth` 전달을 T5 소유로. 이 호스트에 Xcode 없음 → 코드·plist 적용 + Dart 단위 테스트, iOS 빌드·실기기 미실행 명시 | §6.3, §10 |
| S-20 | high | **수용** | `LocalDbService.replaceFromBackup`·`importFromServerDb`·모드 전환 성공 뒤 `CommunityStore.rotateDataset(reason)`(새 local_dataset_id, 이전 journal 은 원 귀속 보존·격리). PC `db_backup.restore_*` 동일. 소유: 모바일 `local_db_service.dart` 훅 = T6, PC `db_backup.py` 훅 = T3 | §5, §10 |
| S-21 | high | **수용(순서 확정)** | 순서: 로컬 schema 준비 → **게이트(K·C)** → 기존 `SetupScreen`(모드·서버/공식 계정) → 기존 `PermissionScreen`(모드별 권한) → 초기화 안내 → 메인. 기존 사용자(설정 완료)는 게이트 → (권한 미충족이면 기존 동작) → 초기화 안내 → 메인. 게이트가 모든 OS 권한 요청보다 먼저라는 요구를 지키고, 모드 의존 권한 판정 로직을 바꾸지 않는다. 설정 화면의 네트워크·DB 작업은 게이트 뒤에만 실행됨 | §2, §6.3 |

§15 가정 판정 반영: 1(S-03 로 대체), 2(S-01·S-10·S-11 로 재설계), 3(잠금·트리거·삭제 계약 명시 후 공동 테스트), 4(유지: getUser + 트랜잭션 재확인, GoTrue 장애 시 503 retryable·수집은 계속), 5(S-04·S-05 로 재설계), 6(S-02 로 기각·재설계), 7(S-06 로 기각·재기술).

POC 증거(격리 스택 `ci0926-poc`, 제품 레포 무변경): `safetyreport/.agent-runs/ci-20260926/stack-poc/poc_rpc.mjs` — anon·publishable 키 RPC 401, 사용자 JWT RPC 403, private REST 406, 같은 event 재전송 duplicate, 같은 event 다른 내용 conflict, 과거 revision stale_ignored, A→B→A accepted, 철회 트랜잭션 진행 중 ingest 는 대기 후 `consent_revoked`·쓰기 0(대기 약 2.3초).

## 2차 재확인(plan-review-sol-02 — 파일은 Sol 이 `plan-review-sol-final.md` 로 쓴 것을 이름만 바꿔 보관) 처리

같은 thread `01a0d999-…`, job `task-muh923li-2xepzj`, turn_context model `gpt-6-sol`·같은 cwd. 판정: 착수 불가(S-02·S-10 critical, S-03/04/06/12/20/21·N-03 high).
Sol 독립 재계산: 벡터 25+7건 불일치 0, MANIFEST 20파일 OK.

| ID | 처리 | 결정·근거 |
|---|---|---|
| S-10 | **수용(설계 변경)** | 공개 소스 = ingest fact 만. 구 v2 snapshot 자료를 쓰는 코드가 네 레포 어디에도 없음(grep: `upload_snapshots`/`report_facts_v2`/`internal_activate_snapshot` 호출 0). migration 5 가 구 자료(v2 fact 행 또는 staged/active snapshot)를 발견하면 `LEGACY_SNAPSHOT_DATA_PRESENT` 로 중단 → 조용한 소실·이중 집계 불가, 운영자 결정 필요. 사전 점검 SQL 제공 |
| S-02 | **수용** | legacy 는 공개하지 않으므로 재동의 재공개 경로 없음. tombstone 을 (contributor, dataset_key, source_report_key) identity 단위 영구 차단으로 변경(클라이언트 시각 무관) |
| S-03 | **수용** | capture 실패 → 그 신고 개인 저장 보류(`community_capture_failed`) → 개인 상태 미전진 → 다음 수집이 다시 읽음. pending 표시는 시작 시 정리 |
| S-04 | **수용** | `community-ingest/manifest` 로 이 dataset 의 completed fact key 앞 24hex 를 받아 `server_completed` 에 보관, 로컬 prev 가 없을 때 eligible prev 로 취급 → 첫 비적격 관측도 correction. 벡터 3건 추가 |
| S-06 | **수용** | rebuild 중 capture 는 staging 에 항상 유효 최신 포인터(무변경이면 기존 id)를 쓰고, cutover 는 upsert 병합(삭제 없음, 영구 실패·목록 부재는 carry-forward) |
| S-12 | **수용** | `detail_status`(상세 당시 C_NOW 라벨)를 capture 트랜잭션에서 기록, 선정은 목록 라벨과 비교(처리상태와 비교 금지). PC 상세 표에는 C_NOW 열이 없음을 확인(`models.py` 의 `상태` 는 merge 표). 벡터 11건 |
| S-20 | **수용(단순화)** | 개인 DB 교체·공식 계정 변경 **전에** dataset 선회전. 교체 실패 시 초기화 1회 추가 비용뿐, crash 창 없음 |
| S-21 | **수용** | 원문 순서 준수: 게이트 → 모드 무관 권한 안내/요청 → Setup → 모드 의존 권한 보충 → 초기화. T5 가 PermissionScreen 을 두 단계로 분리 |
| N-01 | **수용** | 금액 문법(세 자리 구분자만, 음수·만·소수·잘못된 묶음 → null, 1억 초과 null, 벌점 ≤1000)과 서버 값 검증(달력, not eligible 의 completed_date 금지, 좌표 정규형·일관성, reshare 는 trigger=reshare) 명시. 벡터 7건 추가 |
| N-02 | **수용** | `acceptance-matrix.md` 작성 |
| N-03 | **수용** | 정책 이력 표(version, hash) 불변 트리거 + current 포인터, grant 의 (version, hash) 쌍 비교 |
| S-09·S-11·S-18 | 구현 게이트 | 최종 SQL·실제 스택 HTTP·익명 API 증거로만 닫는다. POC 는 증거로 인용하지 않는다 |
| 기타 | 수용 | status 응답에 dataset_key 포함(account-api 와 일치), plan-final §5 의 connection_secret 문장 정정 |

## 3차 재확인(plan-review-sol-03) 처리 — job `task-muh9kni1-m2c5mw`, 같은 thread·model `gpt-6-sol`
판정: 착수 불가(S-02 critical 잔여, S-03/04/06/12/20/21·N-03 high 부분). Sol 독립 재계산: 관측 32·이벤트 10 일치, 목록 11건은 null 가드 필요.

| ID | 처리 |
|---|---|
| S-02 | 철회된 계보의 fact 는 `reshare` 가 아니면 옛 grant 에 남김(비공개 유지), tombstone 키를 (contributor, source_report_key) 로 — dataset_key 재등록 우회 차단. 최종 SQL 초안으로 격리 스택에서 확인: 재동의 후 일반 이벤트 no_change/held·공개 0, 다른 dataset_key 로 삭제 신고 재업로드 rejected |
| S-10 | 가드를 **공개 중인** 구 자료(active snapshot 의 v2 fact)로 한정, staged 는 통과(격리 스택에서 staged 통과·active v2 중단 확인). `preflight_counts.sql`(읽기 전용), `deployment-and-rollback.md` 결정표 |
| S-03 | `community_capture_retry.json`(별도 파일, 원자 쓰기) 로 재시도 강제, 연속 3회 실패 시 `community_store_unavailable` 중단·안내 |
| S-04 | manifest 페이지(≤5000, `after` 커서)·total 검증·원자 교체, 실패 시 수집·초기화 시작 안 함, no-store·로그 금지 |
| S-06 | 무이벤트·무포인터 관측은 detail_status 만, plan §7 을 병합 cutover 로 정정 |
| S-12 | null 비교 명시 규칙 + `rebuild_items.last_list_label`, 벡터 13건(재계산 일치) |
| S-20 | revision 은 `meta.next_revision` 파일 전체 단조(회전으로 초기화 안 함) — 옛 대기 이벤트가 새 관측을 되돌리지 못함 |
| S-21 | OS 별 권한 집합, iOS 는 Android 전용 항목 건너뜀, MethodChannel 예외(`MissingPluginException`) 처리 — T5 작업서 반영 |
| N-03 | plan-final 에서 구 singleton 문장 삭제, 정책 정본 = `community_policies` + `community_policy_current` |
| 추가(Opus 발견) | grant **계보(lineage)**: 정책 버전 갱신 재동의는 계보를 이어 기존 공개 유지, 사용자 철회 뒤 새 동의는 새 계보. 없으면 정책 버전 교체만으로 공개 자료 전부가 사라지는 결함(격리 스택에서 발견·수정·확인) |

## 4차 재확인(plan-review-sol-04) 처리 — job `task-muha0cn7-tk25ah`, 같은 thread·model `gpt-6-sol`
판정: 착수 불가(S-02-R·S-09-R critical, S-11-R·N-04 high, medium 4). 목록 13·관측 32·이벤트 10 독립 재계산 일치.
처리 후 격리 스택 회귀(`stack-poc/poc_v3.mjs`) 결과:

| ID | 처리 | 격리 스택 결과 |
|---|---|---|
| S-02-R | 삭제 fence(`community_deletion_fences`) + 삭제 시 사용자 연결 전부 revoked + 로컬 대기 행 blocked:deleted_by_user | 대기(중앙 미존재) R50 → 옛 연결 `connection_revoked`, 새 연결로 재전송해도 `rejected:deleted`, 삭제 뒤 새 관측은 published |
| S-09-R | ingest 가 connection 을 FOR UPDATE(동일 연결 직렬화, 잠금 순서 유지) | 같은 연결 병렬 2요청 × 20회(같은·다른 신고 교차) → 200 40건, deadlock 0 |
| S-11-R | ACK projection_status 5종(published/removed/held/not_public/not_applicable), 공개 RPC 와 같은 판정 함수 | 새 완료 published, 날짜 없는 완료 not_public, 완료→취하 정정 removed(익명 목록 0) |
| N-04 | 철회는 계보의 활성 grant 로 귀결 | 정책 승계 후 옛 G1 ID 로 철회 → G2 철회·공개 0, 이후 새 동의 새 계보·공개 0 |
| S-10-D | preflight 를 DO 블록 동적 SQL 로(부재 표 조회 안 함), plan §3.4 를 SQL 기준으로 재작성 | — |
| S-03-F | 재시도 의도를 capture **전에** 기록, 기록 실패 시 저장 없이 즉시 중단 | — (앱 구현 테스트) |
| S-04-M | 페이지마다 `manifest_token`, 전 페이지 동일할 때만 교체, 최대 3회 | 같은 상태 두 페이지 토큰 동일, 쓰기 뒤 토큰 변경 |

## 5차 재확인(plan-review-sol-05) 처리 — job `task-muhae66b-5g505d`, 같은 thread·model `gpt-6-sol`
판정: 착수 불가(critical 0, high 4: S-11-B·S-04-T·N-04-L·D-01, medium 2). 처리 뒤 assertion 회귀 `sql-drafts/regression_poc.mjs`(격리 스택 `ci0926-poc`, exit 0, 12 checks):

| ID | 처리 | 회귀 |
|---|---|---|
| S-11-B | 요청 안 같은 신고 중복 금지(Edge 422 + SQL invalid_request) | 같은 R3 두 이벤트 → invalid_request |
| S-04-T | `community_manifest_generations` 세대 번호 = manifest_token, accepted 변경·삭제 때 같은 트랜잭션 증가 | 완료↔미완료 교환(총수 동일)에도 토큰 변경 |
| N-04-L | 입력 계보가 닫혔고 다른 활성 계보가 있으면 `stale_grant` | 사용자 철회 뒤 새 계보 활성, 옛 G1 철회 → stale_grant·공개 유지 |
| D-01 | SQL 초안을 `sql-drafts/`+SHA256SUMS 로 고정, 계획 정본 경로 교체, duplicate 불변 필드 = 계약 | 같은 event_id 다른 captured_at → conflict, 전송 문맥만 다르면 duplicate |
| S-02-F | 삭제 보장 범위 문서화(서버: 연결 폐기·identity tombstone·주장 시각 fence / 앱: journal 비승계) | 삭제 후 옛 연결 connection_revoked, 새 연결 재발급 rejected:deleted |
| S-03-I | 남는 한계 명시(수동 단건 + 파일 쓰기 실패 → 실패 표시·재요청), rebuild 는 items 로 재시도 | — |
