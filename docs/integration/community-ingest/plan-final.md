# community-ingest 통합 계획 — final (Opus5.5, Sol 01 검토 반영)

v1(`plan-v1.md`)을 대체한다. 지적별 처리는 `plan-resolution.md`. 원 프롬프트 절은 §, Sol 지적은 S-xx.
이 문서는 계획이다. 제품 구현은 Sol 의 final 재확인 뒤 시작한다.

## 0. 요약

| 축 | 결정 |
|---|---|
| 중앙 소유 | auth = 정책·동의 grant·writer 연결 레지스트리·`community-account`(사용자 전용)·계정 RPC. map = ingest 이벤트·신고별 fact·삭제 tombstone·공개 투영·`community-ingest`(사용자 전용)·계약/fixture/통합 manifest 정본 |
| 게이트 | `K && C`, 정본은 중앙 status. 로컬 캐시 10분(화면), 새 작업은 60초 이내 검증 필수, 원격 철회 반영 상한 온라인 ≤60초(S-13). ingest 는 트랜잭션에서 매번 재확인 |
| 수집 사본 | 파서 직후·override 전 DTO → 정규 JSON → `community.db` journal+outbox 먼저 commit → 개인 저장 → wake. `personal_save_state` 로 crash 상태 정의(S-03) |
| 전송 | `request_community_upload(trigger)` 하나(`realtime/manual/midnight/recovery/rebuild/reshare`). 이벤트별 durable ACK 로만 outbox 삭제 |
| 식별·순서 | fact 키 (contributor, dataset_key(연결에서), source_report_key(서버 계산)) (S-05). 순서 (writer_epoch, source_revision). 같은 사용자 재로그인은 rebind(epoch 유지) (S-04) |
| 공개 | fact 는 **수락한 grant 의 계보(lineage)에 사용자 철회되지 않은 grant 가 있을 때만** 공개(S-02; 정책 버전 갱신 재동의는 같은 계보를 잇고, 사용자 철회 뒤 새 동의는 새 계보). 재동의 자동 재공개 없음, 명시적 `reshare` 만. 삭제 = fact 삭제 + 서버 identity tombstone(영구, 클라이언트 시각 무관). 좌표 결측 fact 도 통계에 포함, 지점에서만 제외(S-01). **공개 소스는 ingest fact 만** — 구 v2 snapshot 자료는 쓰는 클라이언트가 없어(코드 grep) 운영에 없어야 하며, migration 이 자료를 발견하면 적용을 중단해 운영자 결정을 요구(조용한 소실·재공개·이중 집계 모두 차단, S-10·S-02) |
| 자정 | KST 00:00 due, 키 범위 (namespace, contributor, dataset, epoch, date), 최신 키 1회 보충(S-15). PC scheduler 는 크롤 job 만 재생성(S-08) |
| 초기화 | 사전 일관 백업 + 사용자 데이터 보존 제자리 갱신(기존 수집 경로) + community.db staging→검증→cutover. PC `--force --rebuild <run>` 신규 연결, 모바일 rebuild 에서 부재 행 삭제 금지(S-06) |

## 1. 요구 ID
v1 §1 표 유지(R-ENV, R-AUTH, R-CONSENT, R-GATE-M/P, R-REBUILD, R-CAPTURE, R-CONTRACT, R-OUTBOX, R-TRIGGER, R-INGEST, R-SECMATRIX, R-PROJ, R-MIG, R-UI, R-PAR, R-AUDIT). 테스트 매핑은 `acceptance-matrix.md`.

## 2. 사용자 흐름(확정)

```
[모바일 새 설치] 로컬 schema 준비(사용자 데이터 무변경) → 로딩/게이트 셸(기존 화면 렌더 안 함)
  → [필수]카카오 인증 + [필수]신고내용 공유 동의 → 기존 권한 안내/요청(모드와 무관한 항목) → 기존 SetupScreen(모드·서버/공식 계정)
  → 모드별 권한 보충(기존 PermissionScreen 의 모드 의존 항목, 이미 허용된 것은 건너뜀) → 초기화 안내·확인(Standalone: 로컬 job / Client: 서버 job) → 메인
[모바일 기존 사용자] 게이트 → (기존 권한 확인 동작 그대로) → 초기화 안내(필요 시) → 메인
원 프롬프트 §6.2 순서(게이트 → 권한 → 설정)를 그대로 따른다. PermissionScreen 의 모드 의존 판정은 설정 뒤 보충 단계로 분리(S-21).
권한 항목은 OS 별로 나눈다: Android 전용(알림 리스너 접근·배터리 최적화 예외·백그라운드 위치 등)은 iOS 에서 건너뛰고, `MethodChannel` 호출은 `MissingPluginException`·`PlatformException` 을 잡아 "해당 없음"으로 처리해 iOS 에서 멈추지 않게 한다(3차 재확인 §3.8).
[PC/Docker] 기존 관리자 로그인/최초 설정 → 게이트 미들웨어 → /onboarding/community(두 카드)
  → 원래 목적지(검증된 상대경로) → 초기화 필요 시 배너 + /onboarding/rebuild 안내·확인
```
게이트 전에는 OS 권한 팝업·백그라운드 수집·예약 전송·알림 기반 단건 조회를 시작하지 않는다(S-21, §6.2).

## 3. 중앙(Supabase)

### 3.1 migration 합성
| 순서 | repo | 파일 | 의존 |
|---|---|---|---|
| 1 | map | `202608150001_initial_schema.sql` (기존) | — |
| 2 | map | `202609240001_analytics_v2.sql` (기존) | 1 |
| 3 | auth | `202609251200_community_auth_relay.sql` (기존) | — |
| 4 | auth | `202609260100_community_account_registry.sql` (신규) | 1 |
| 5 | map | `202609260200_community_ingest.sql` (신규) | 2, 4 |

- 정본 manifest `docs/integration/community-ingest/migration-manifest.json`(repo·commit·path·version·sha256·depends_on). 검사기 `scripts/integration/compose_supabase.mjs --check` 는 중복 version, 같은 version 다른 내용, 누락 의존, 원문 해시 불일치를 실패로 한다.
- 합성 staging: 같은 스크립트가 두 레포 원문을 한 번씩 `.integration-stack/supabase/migrations/` 에 복사하고 `config.toml`(project_id `ci0926-int`, API 56321·DB 56322·shadow 56320, studio/smtp/storage/analytics 끔, realtime·edge_runtime 켬, 카카오 provider → 모의 서버)·함수(auth relay·account, map ingest·public-analytics)를 조립 → map devDependency `supabase` 2.118.0 으로 `supabase start --workdir .integration-stack`. 통합 스택은 **Opus 단독**, 테스트 직렬.
- 전환 경로 테스트: 빈 DB(1→5), map 만(1,2 → 3,4,5), auth 만(3 → 1,2,4,5), 양쪽(1,2,3 → 4,5). 기존 SQL 수정 금지·운영 적용 없음.

### 3.2 auth 신규(4) — 정책·grant·연결
- 테이블(정책 정본은 아래 `community_policies`+`community_policy_current` 두 표뿐): `private.community_consent_grants`(grant_id, user_id, policy_version, consent_text_sha256, granted_via, granted_session_id, granted_at, revoked_at, revoked_session_id, revoke_reason; 사용자당 활성 1개), `private.community_connections`(connection_id, user_id, bound_session_id, connection_secret_sha256, source_app, source_mode, platform, device_label, dataset_key, writer_epoch(시퀀스), status active/superseded/revoked/suspended, last_accepted_revision, created/rebound/revoked_at; (user,dataset_key) 활성 1개), 시퀀스 `private.community_writer_epoch_seq`.
- grant 계보: `lineage_id`, `superseded_by`. 구버전 정책 grant 를 새 정책 동의가 대체하면 이전 grant 는 `revoke_reason='superseded_policy'` + 같은 lineage 를 이어 받음. 사용자 철회 뒤 새 동의는 새 lineage.
- 정책(N-03): `private.community_policies`(version PK, consent_text_sha256, created_at; UPDATE/DELETE 거부 트리거) + `private.community_policy_current`(singleton → version). grant 의 (version, hash) 쌍이 현재와 둘 다 같아야 active. seed = `2026-09-26.1` / 계약 동의문 sha256.
- 잠금 순서(모든 RPC 공통, S-09): **policy_current → contributor_profiles → grant → connection → (map) tombstone/fact → analytics_state**. 계정 변경 RPC 는 contributor 행 FOR UPDATE(사용자당 뮤텍스), ingest 는 FOR SHARE. 운영자 policy 변경은 policy FOR UPDATE.
- K 판정 SQL `private.community_identity_state(user, session)`: `auth.users`(삭제·익명·차단 아님) + `auth.identities` provider=`kakao` + `auth.sessions` 존재·not_after. user_metadata 는 쓰지 않는다.
- RPC(`public.internal_account_*`, SECURITY DEFINER, `search_path=''`, EXECUTE service_role 만): `status(user, session, connection)`, `grant_consent(user, session, policy_version, text_sha256, via)`(K 필요, 정책·해시 일치, 같은 활성 grant 멱등, 구버전 grant 는 대체), `revoke_consent(user, session, grant)`, `register_connection(user, session, source_app, source_mode, platform, label, dataset_key, secret_sha256, takeover)`(동일 dataset 활성 writer 있으면 `writer_conflict`, takeover=true 면 이전 `superseded`), `rebind_connection(user, session, connection, secret_sha256)`(같은 user·비밀·active 만, epoch 유지, 타인/없음은 동일 `not_found`), `revoke_connection(user, connection)`, `delete_contributions(user, session)`(→ map RPC 호출이 아니라 map 이 제공하는 `private.community_delete_contributions(user)` 를 같은 트랜잭션에서 호출 — 의존 방향 때문에 **삭제 RPC 는 map migration(5)에 둔다**, account 함수는 그 RPC 를 부른다).
- contributor_profiles(map 소유 테이블)의 쓰기는 계정 RPC 만(단일 writer): 동의 때 upsert(consent_version, consented_at, revoked_at=null), 철회 때 revoked_at. 공개 여부 판단은 contributor 가 아니라 **fact 의 grant** 로 한다(S-02).

### 3.3 auth 신규 함수 `community-account`
- `[functions.community-account] verify_jwt = true` + handler 에서 `auth.getUser(jwt)`(GoTrue: 서명·만료·세션 존재. POC: 로그아웃 후 403 `session_not_found`) + claims(`role=authenticated`, `aud=authenticated`, `iss`=프로젝트, `session_id`, `is_anonymous=false`). relay 함수(verify_jwt=false, capability)와 설정·코드·테스트 분리 유지.
- `POST /functions/v1/community-account/{status|consent|consent-revoke|connections|connections-rebind|connections-revoke|contributions-delete}`, 본문 `{"protocol":1,…}` 모르는 필드 거부, 8KB, `no-store`, 오류 `{error:{code,message,requestTraceId,retryable,retryAfterSeconds?}}`, 한도 사용자별 분당 30.
- status 응답: `{protocol, gate:{kakao, consent, can_enter, reasons[]}, policy:{required_version, consent_text_sha256}, consent:{state, grant_id?, policy_version?, granted_at?}, contributor:{status}, connection?:{status, writer_epoch, bound_to_current_session, last_accepted_revision, source_app, source_mode}, projection:{ready}, account:{fingerprint, display_name?}, server_time}`. `fingerprint = sha256("sr-community-account|v1|"+user_id)[:32]`. user UUID·이메일·토큰은 내보내지 않는다.
- 공통 모듈 `server/account.ts`(Deno·Node 공용, relay 와 같은 패턴) + 얇은 Edge 엔트리.

### 3.4 map 신규(5) — ingest·fact·공개
- `private.community_ingest_events`(receipt_id, contributor_id, event_id, request_id, connection_id, consent_grant_id, dataset_key, writer_epoch, source_report_key, source_report_id(private), source_revision, event_type ∈ completed_observation/status_correction/location_supplement/reshare, trigger, payload, payload_sha256, captured_at, received_at, result ∈ accepted/no_change/stale_ignored/quarantined, quarantine_reason; unique(contributor_id, event_id)).
- `private.community_report_facts` PK (contributor_id, dataset_key, source_report_key): latest_receipt_id, consent_grant_id, writer_epoch, source_revision, payload_sha256, public_state(completed/not_completed), report_date, completed_date, category, status, disposition, amount_kind, amount_confirmed_won, penalty_points, vehicle_raw, lat, lng, lat_text, lng_text, coord_source, address, region_code, point_key, agency_key/name, manager_key/name, first_accepted_at, updated_at.
- `private.community_fact_tombstones`(contributor_id, dataset_key, source_report_key PK, deleted_at, deletion_id) — 삭제 요청 때 그 사용자의 모든 fact identity 를 기록. 이후 같은 identity 이벤트는 captured_at·기기·dataset 세대와 무관하게 영구 `rejected:deleted`(S-02).
- 구 자료 가드(S-10): migration 시작 부분에서 `private.report_facts_v2` 에 행이 있거나 `private.upload_snapshots` 에 staged/active 행이 있으면 `raise exception 'LEGACY_SNAPSHOT_DATA_PRESENT'` — 운영자가 `scripts/integration/preflight_counts.sql` 로 확인하고 별도 전환 결정을 해야 적용된다. 근거: PC·모바일·map·auth 어디에도 이 표를 쓰는 코드가 없음(2026-09-26 grep).
- `public.internal_community_ingest(user, session, request_id, envelope, events)`: 잠금 순서대로 권한 재확인(K·세션·grant 활성·정책 일치·connection active·bound_session·mode 일치·contributor active) — 실패는 요청 전체 오류, 쓰기 0. 이벤트별: epoch≠connection epoch → rejected; tombstone 이전 captured_at → rejected(deleted); `on conflict (contributor,event_id)` → 같은 해시 duplicate / 다른 해시 conflict; fact FOR UPDATE 후 (epoch,rev) 비교: 새 fact → accepted; 더 크고 해시·grant 같음 → no_change(순서 표지만 전진); 더 크고 해시 다르거나 grant 가 다름 → accepted(내용·grant 갱신); 작거나 같음 → stale_ignored. last_accepted_revision 전진. 변경 있으면 analytics_state 의 dataset_version·source_updated_at·generated_at 갱신(같은 트랜잭션 — projection 유실 없음).
- `private.community_delete_contributions(user)`: 사용자 fact 전부 삭제, tombstone 기록, version 갱신. 이벤트 원장(비공개)은 감사 목적 30일 보관 후 운영 정리(문서화).
- grant 귀속 규칙(S-02): 기존 fact 의 계보가 사용자 철회로 비활성이면 `reshare` 가 아닌 이벤트는 내용·순서만 갱신하고 옛 grant 에 남김(비공개 유지). tombstone 키 = (contributor, source_report_key)(dataset_key 무관).
- 구 자료 가드 범위(3차): **공개 중인** 구 자료(active snapshot 의 v2 fact)만 중단 조건. staged/만료 snapshot 행은 공개되지 않으므로 막지 않는다. 사전 점검 `scripts/integration/preflight_counts.sql`, 결정표 `deployment-and-rollback.md`.
- 공개 RPC 교체 `internal_analytics_v2_facts`(같은 서명·반환 형태): 소스 = ingest fact 만. 조건 `public_state='completed'` ∧ **fact.consent_grant_id 의 계보에 활성 grant 존재**(`private.community_lineage_active`) ∧ contributor active(삭제된 fact 는 행이 없음). 정책 버전만 바뀐 상태에서는 이전 조건으로 공유된 fact 가 계속 공개되고, 새 업로드만 `consent_outdated` 로 막힌다(POC 검증). **좌표 결측도 포함**(lat/lng null); bbox 인자가 있으면 좌표 있는 행만.
  반환: 기존 PrivateFact 형태(`fact_identity`=`dataset_key:source_report_key`, `snapshot_id`=`ingest-v1`, `snapshot_generation`=1), lat/lng nullable.
- manifest RPC `internal_community_manifest(user, session, connection)` → 연결 검사 후 그 (user, dataset_key) 의 completed fact `source_report_key` 앞 24hex 목록(S-04). ingest 함수의 `/manifest` 경로가 호출.
- `server/aggregate.ts`·`publicHandler.ts` 변경: PrivateFact.lat/lng nullable, 지점·bbox 는 좌표 있는 fact 만, `coverage.location_missing` 추가, meta 에 `population: "shared_completed_reports"` 와 모집단 설명, 완료 비율·미완료 비중·처리 중 비중 등 분모 없는 지표는 `unsupported`(값 null)로.
- `private.invalidate_analytics_v2()` 교체: contributor 행 변경 → ready 유지, version·generated_at 갱신. 구 snapshot state 변경 → 기존대로 ready=false(구 경로 보존). grant 철회·삭제·정책 변경도 같은 트랜잭션에서 version·generated_at 갱신.
- ACK `projection_status`: fact 변경 ∧ 커밋 시 `ready ∧ generated_at 존재` → `published`, 변경 ∧ 그 밖 → `held`, 변경 없음 → `not_applicable`(S-11). 통합 테스트로 published 직후 익명 API 반영 확인.
- 한도 RPC `internal_community_ingest_rate_limit(bucket, limit)`(기존 `private.rate_limits` 재사용). 버킷 = sha256(`ingest|user|…`), sha256(`ingest|conn|…`). **IP 헤더 미사용**(S-18).

### 3.5 map 신규 함수 `community-ingest`
§13 순서: POST·`application/json`·본문 ≤256KiB·events 1~20 → getUser+claims → 사용자·연결 한도 → strict schema(`envelope.schema.json`·`observation.schema.json`, 모르는 키 거부) → 서버 정규 JSON 해시 재계산(불일치 422) → `status==map(status_raw)` 아니면 그 이벤트 quarantined → event_type·eligibility 일관성(422) → 파생(§계약 observation.md 5) → RPC → 이벤트별 ACK. OPTIONS 는 허용 Origin(`https://safemap.worklazy.net`, `https://safeauth.worklazy.net`)에만 CORS, 인증 요구 없음, 부작용 없음. Origin 없는 요청 허용. 관리자 키 fallback·서비스 간 관리 호출 없음. 40P01/40001 → 503 `busy` retryable.

### 3.6 보안 행렬(§14) 자동화
map `tests/integration/security-matrix.test.ts`(실제 로컬 스택 HTTP): §14 표 전 행 + 구 mutating RPC(`internal_activate_snapshot`, `internal_cleanup_expired`, relay·account·ingest·delete RPC) anon/publishable/authenticated 직접 호출, PostgREST `Accept-Profile: private`, GraphQL(`/graphql/v1`)에서 private 객체 없음, `pg_publication_tables` 에 private 테이블 없음(Realtime), Storage 버킷 없음 → 모든 쓰기 시도 뒤 **행 수 불변** 확인. 마지막 행(정상 세션의 다른 프로그램)은 "구분 불가"로 문서화.

## 4. 공통 계약(map `contracts/community-ingest/`)
v1 §4 목록 + 변경:
- 좌표: `location:{lat, lng, source}` — lat/lng 는 double 의 **최단 왕복 10진 문자열**(소수점 없으면 `.0`), 범위 밖·결측이면 null(S-16).
- `amount:{kind, confirmed_won, penalty_points}` — 벌점 `벌점: N점` 정수(S-14).
- event_type 에 `reshare` 추가: 사용자가 명시적으로 요청한 경우만, journal 최신 사본(eligible)의 payload·captured_at 을 그대로 두고 새 event_id·새 revision·현재 grant/connection/epoch 로 발급.
- 인터페이스 계약 `interfaces.md`(S-17): PC `CommunityGate.evaluate()/require_fresh(max_age=60)/on_change(cb)`, `community_capture.capture(adapter_input, *, source_report_id, trigger, rebuild_run_id=None) -> CaptureResult`, `community_uploader.request_upload(trigger) -> RunResult`, `register_community_jobs(scheduler)`(job id: `community-midnight-upload`, `community-gate-poll`), `community_rebuild.start/resume/pause/status`, `CommunityStore.rotate_dataset(reason)`. Dart 동등 이름.
- `local-store.md` 확정(§5), `rebuild.md`(§7), `schedule.md`(키 범위 S-15), `gate.md`(지연 상한 S-13).
- 벡터: observations(좌표 문자열·벌점 반영), canonical-json, schedule, gate, event_decisions, list_refetch(§8.5).

## 5. 로컬 `community.db`
v1 §5 + 변경:
- `source_journal` 에 `dataset_key`, `personal_save_state`(pending/saved/failed), `blocked_reason` 추가. `personal_save_state` 는 개인 저장 결과로 갱신. 전송 가능 여부와 무관(S-03).
- `schedule_runs` PK = (project_namespace, contributor_fingerprint, local_dataset_id, writer_epoch, schedule_key)(S-15).
- `context` 에 `dataset_key`, `writer_epoch`, `consent_text_sha256` 추가. 연결 비밀 원문은 community.db 에 두지 않는다(PC `data/auth` 암호화 저장소, 모바일 secure storage).
- `detail_status`(상세 당시 C_NOW 라벨, S-12), `server_completed`(중앙 manifest, S-04) 추가. rebuild staging 은 병합 전용(S-06).
- `rotate_dataset(reason)`: 개인 DB 교체·공식 계정 변경 **직전** 호출(보수적 선회전, S-20). 교체 실패여도 되돌리지 않음(초기화 1회 추가 비용만). 이전 journal/outbox 는 원 귀속 그대로 보존.
- capture 실패 시 그 신고의 개인 저장을 건너뛰고(S-03) 별도 파일 `community_capture_retry.json` 에 ID 를 남겨 다음 증분에서 반드시 다시 읽는다. 한 실행에서 연속 3회 실패하면 수집을 `community_store_unavailable` 로 멈추고 복구 안내.
- revision 은 파일 전체 단조(`meta.next_revision`, 데이터셋 회전으로 초기화 안 함, S-20).
- manifest 신선도: `meta.manifest_scope`=`dataset_key:writer_epoch` 가 현재와 다르면 수집 전에 전 페이지를 받아 교체, 실패하면 수집 시작 안 함(S-04).
- 전송 대상: outbox 행의 (contributor_fingerprint, connection_id, consent_grant_id, project_namespace) 가 현재 context 와 같을 때만. 다르면 `blocked:context_mismatch` 로 보존·표시. 다른 계정 토큰으로 절대 전송 안 함(C04).

## 6. 게이트
### 6.1 판정·지연 상한(S-13)
`contracts/community-ingest/gate.md` 순서 + 규칙: 화면 이동은 10분 캐시, **새 작업(크롤 시작·업로드·초기화·설정 저장·자정 실행)은 60초 이내 검증 필수**(아니면 동기 재검증, 실패하면 시작하지 않음), 온라인 동안 60초 주기 status poll(PC: 서버 스레드, 모바일: 포그라운드 타이머·resume), 업로드 403(consent/connection/suspended) 즉시 무효화, 로컬 철회·로그아웃 동기 무효화. 원격 철회 반영 상한: 온라인 ≤60초, 오프라인 최대 10분 뒤 잠김.
### 6.2 PC
- 미들웨어 순서 고정(Session → 기존 auth → community gate), ASGI 테스트. 세션 로그인 HTML GET → `/onboarding/community?next=`, 그 외 → 403 `COMMUNITY_ONBOARDING_REQUIRED`.
- `/api/v1/**` 는 라우터 의존성으로 게이트(allowlist 제외). `/ws/events`, `/crawl/ws/logs`, `/rating/ws/rating_logs` 는 연결 시 인증(세션 또는 API 키)+게이트, 게이트 상실 시 4403 종료. `/media/*` 는 세션 또는 API 키 + 게이트.
- allowlist(정확한 method+path, 각자 기존 인증·CSRF·manager 권한 유지): `GET/POST /login`, `GET/POST /setup`, `GET /logout`, `GET /health`, `/static/**`, `GET /onboarding/community`, `GET /onboarding/rebuild`, `GET /settings/community/status`, `POST /settings/community/{start,confirm,cancel,disconnect,settings,consent,consent-revoke,writer,contributions-delete}`, `GET /settings/community/policy`, `GET /settings/community/rebuild`, `POST /settings/community/rebuild/{start,resume,pause}`, API 키: `GET /api/v1/app/config`, `GET /api/v1/community-auth/status`, `POST /api/v1/community-auth/{start,confirm,cancel,disconnect}`, `GET /api/v1/community/gate`, `GET /api/v1/community/rebuild`, `POST /api/v1/community/rebuild/{start,resume}`. 라우트 전수 표를 코드에서 뽑아 allowlist 외 전부 차단되는지 테스트(F09, F11).
- 초기화 필요·진행 중: 크롤 시작(수동·예약·큐)만 409 `COMMUNITY_REBUILD_REQUIRED`, 나머지 화면·설정 사용 가능 + 배너.
- 스케줄·작업: `run_crawler`, 큐 크롤, 별점 작업, 업로더, 자정 작업은 시작 전 `require_fresh(60)`; 철회 감지 시 진행 중 크롤은 기존 stop 경로, 업로드 중단.
- 공개 설정 누락/자리표시자/비밀 → `config_invalid` 복구 화면(설정 POST 허용). fixture 서버는 게이트를 끄지 않고 로컬 스택을 가리킨다.
### 6.3 모바일
- 게이트 셸이 `MaterialApp.home` 결정 맨 앞(`!initialized` → 로딩, `!gate.ok` → 온보딩). `ReportProvider.init()` 은 설정 로드만, `BackgroundLoginCheck.schedule`·`_drainAndRefresh`·자동 동기화·WsService 시작은 `onGatePassed()` 로 이동. Workmanager 콜백·NotificationService 큐 처리는 게이트 캐시가 유효 기간 안의 성공이 아니면 수집하지 않고 큐 보존.
- 딥링크는 게이트 안에서도 수신(Android 기존 + **iOS `CFBundleURLTypes`·AppDelegate URL 전달 추가, S-19**). 알림 탭 이동은 게이트 미충족 시 무시. 게이트 화면 Back = 앱 종료만.
- Client: 폰 사용자 본인 K·C. 서버 게이트 표시, 계정 fingerprint 비교, 민감 제어(초기화 시작·수동 업로드)는 `X-Community-User-Token`(폰 access token) 을 서버가 GoTrue `/user` 로 검증해 서버 연결 사용자와 같을 때만. Client 는 writer 등록·업로드·자정 job 없음, Standalone→Client 전환 시 모바일 자정 job 해제.
### 6.4 UI 규칙
v1 §6.4 그대로 + 동의문에 "철회하면 공개에서 제외, 재동의해도 이전 자료는 자동으로 다시 공개되지 않음(지도 탭에서 다시 공유를 눌러야 함), 삭제 요청은 별도" 명시.

## 7. 초기화 크롤링(S-06 재기술)
- 범위 키 `(required_version, local_dataset_id, source_account_namespace)`. 새 설치도 같은 job 하나.
- 상태기계 `rebuild.md`: required → awaiting_confirmation → preparing_backup → running → validating → committing → completed | completed_with_gaps; paused/failed → 같은 run 재개; prerequisites_required(공식 계정·권한 없음).
- **PC**: `crawl_control.start_rebuild(run_id)` → 명령 `start.py --force --rebuild <run_id>`(frozen 은 `--mode crawl --force --rebuild`). start.py 는 이번 run 의 목록 수집이 **모든 페이지 성공**일 때만 그 ID 집합을 `rebuild_items` 로 등록(부분 실패면 failed), 상세는 items 중 미완료만(checkpoint). `--reset` 사용 금지.
- **모바일**: `SyncEngine.start(fullSync: true, rebuildRunId: …)` — rebuild 모드는 목록 부재 행 삭제를 건너뛰고(orphan 보존·건수 표시), items checkpoint, 상세 실패는 item 단위 재시도.
- 개인 DB 는 **사전 일관 백업**(PC sqlite backup API, 모바일 `VACUUM INTO`, 둘 다 integrity_check) 후 기존 수집 경로로 제자리 갱신(override·감시목록·중복 판단·지오코딩 캐시 보존 — 기존 동작). 개인 DB 전체 shadow cutover 는 하지 않는다(기존 저장 계층이 사용자 데이터를 보존하므로 불필요, 실패 시 백업으로 복구 안내).
- community.db staging: rebuild run 동안 items·journal·`report_latest_staging` 에 쓰고, validating 통과 뒤 한 트랜잭션으로 staging 을 `report_latest` 에 **upsert 병합**(삭제 없음, 영구 실패·목록 부재는 기존 포인터 carry-forward) + marker(committing→completed). 시작 전 manifest 전 페이지 수신 필수(실패 시 시작 안 함).
- 완료 기준: 목록 전 페이지 성공 ∧ items 전부 fetched 또는 영구 실패로 분류 ∧ 파서 오류 0(또는 사용자가 누락 N건을 명시 수락 → completed_with_gaps). 로그인 실패·403·목록 일부 실패는 failed(0건 성공 금지). 정상 인증 빈 목록은 completed.
- 동시성: 크롤 lock, 초기화 필요·진행 중 다른 크롤 409, 확인 연타·다중 브라우저·Client 동시 요청은 unique 제약+lease 로 run 하나. 재시작·재부팅 시 같은 run 재개. 철회·로그아웃 → 다음 item 경계 paused, 재동의 뒤 사용자가 계속.
- 복원·공식 계정 변경 → rotate_dataset → 새 범위 키라 초기화 다시 필요(G14).
- Client: 서버 job 시작·조회만.

## 8. 업로드·스케줄
### 8.1 공통 서비스
`request_community_upload(trigger)`: 게이트 `require_fresh(60)` → single-flight + community.db lease → (manual/midnight/recovery) 현재 context 의 미ACK journal → outbox, location_supplement 후보 생성 → drain(요청당 ≤20건·≤256KiB, 새 이벤트 즉시 1건) → 이벤트별 ACK 적용 → upload_runs. `reshare` 는 지도 탭의 별도 명시 버튼(확인 대화상자)만.
### 8.2 HTTP 처리
401 → 토큰 갱신 1회 후 재시도, 실패면 auth_required. 403(consent_*/connection_*/writer_superseded/contributor_suspended/session_revoked) → 해당 행 blocked + 게이트 무효화. 이벤트 conflict·rejected(deleted/epoch) → dead_letter/blocked 보존. 400/413/422 → dead_letter. 429 → Retry-After. 5xx/timeout/503 busy → 지수 백오프(1s→최대 1h)+지터 ±20%. 이벤트별 durable ACK(accepted/duplicate/no_change/stale_ignored/quarantined)만 outbox 삭제.
### 8.3 자정
`schedule.md` + 키 범위(S-15). PC: `register_community_jobs(scheduler)` 가 `CronTrigger(hour=0, minute=0, timezone=ZoneInfo("Asia/Seoul"))` job `community-midnight-upload` 와 60초 `community-gate-poll` 을 등록, `update_jobs()` 는 크롤 job(`crawler_job` 등 기존 ID)만 지우고 다시 만들며 커뮤니티 job 존재를 끝에서 재확인(S-08). 서버 시작 시 should_run 보충. Android: Workmanager unique periodic `community-upload-periodic`(1h, network) + unique one-off `community-midnight`(initialDelay=다음 자정) + resume; dispatcher 에 작업명 분기 추가(기존 로그인 점검 유지). iOS: `BGTaskSchedulerPermittedIdentifiers`·`UIBackgroundModes`·AppDelegate 등록 + resume(실기기 미검증). Client 모드는 모바일 자정 job 해제.
### 8.4 지도 탭 패널
v1 §8 문구 + `이전 수집 사본 다시 공유(N건)`(재동의·takeover 뒤에만 보임, 확인 대화상자) + `blocked` 사유별 안내.
### 8.5 완료 후 상태 변화 감지(S-12)
두 앱의 증분 선정: `vectors/list_refetch.json` 규칙 그대로 — 신규 ∨ 종결여부≠Y ∨ 보완_미응답=Y ∨ capture 재시도 목록 ∨ (detail_status 없음 ∧ (영구 실패 아님 ∨ 목록 라벨이 실패 당시와 다름)) ∨ (detail_status 있음 ∧ **목록 C_NOW 라벨 ≠ `community.db detail_status` 라벨**). null 을 `!=` 로 직접 비교하지 않는다. PC `_get_new_and_incomplete_ids`, 모바일 sync_engine 필터를 같은 fixture(`vectors/list_refetch.json`)로 검증. 상세를 다시 받으면 capture 규칙이 correction 을 결정한다(목록만으로 correction 금지).

## 9. 설정·비밀
v1 §9 유지. 추가: PC 공개 설정 환경변수 우선순위 env(`COMMUNITY_*` 별칭 = 기존 `SAFETYREPORT_COMMUNITY_*`, 둘 다 있고 다르면 `config_conflict`) > config.ini > 번들 `community_public.json`. `[COMMUNITY] enabled=false` 는 더 이상 게이트를 끄지 못함(공식 제품에서 필수 — 설정은 무시하고 경고). `upload_enabled` 도 폐기(동의 grant 가 정본).

## 10. 병렬 작업 분해(S-17 인터페이스 고정)
| task | 담당 | worktree(`~/projects/worktree/ci-20260926/…`) · 브랜치 | 소유 파일(단일 writer) | 선행 |
|---|---|---|---|---|
| T0 계약·manifest·스택 | Opus | `community-map/integration` · `ci0926/integration` | `contracts/community-ingest/**`, `docs/integration/**`, `scripts/integration/**` | plan-final 재확인 |
| T0b 로컬 store 골격·계약 사본 | Opus | `safetyreport/integration`, `safetyreport-mobile/integration` · `ci0926/integration`(base = feat/community-account) | PC `services/community_store.py`, `contracts/community-ingest/`(사본); 모바일 `lib/community/community_store.dart`, 사본 | T0 |
| T1 auth 계정 | Opus | `community-auth/account` · `ci0926/account` | migration 4, `server/account.ts`, `supabase/functions/community-account/**`, `supabase/config.toml`, `tests/account*.ts`, `site/` 도움말·개인정보 문구, `docs/*` | T0 |
| T2 map ingest·공개 | Opus | `community-map/ingest` · `ci0926/ingest` | migration 5, `server/ingest/**`, `server/aggregate.ts`, `server/publicHandler.ts`, `supabase/functions/community-ingest/**`, `supabase/config.toml`, `tests/integration/**`, `tests/product/*` 관련, `docs/data-contract.md`·`client-integration.md` | T0, T1 스키마 |
| T3 PC 게이트·초기화 | Opus | `safetyreport/gate-rebuild` · `ci0926/gate-rebuild` | `main.py`, `services/community_gate.py`, `services/community_account_client.py`, `services/community_rebuild.py`, `web/routers/community_onboarding_route.py`, `web/routers/community_route.py`, `web/templates/onboarding_*.html`, `web/templates/base.html`(배너), `web/routers/{ws_route,crawl,rating_route,media_route}.py`(인증), `start.py`, `core/database/database.py`, `services/crawl_control.py`, `services/crawl_manager.py`, `core/utils/scheduler.py`, `services/db_backup.py`, `settings/settings.py`, `services/community_auth_service.py`(upload_enabled 제거·세션 공급), 테스트 | T0b |
| T4 PC 데이터 경로 | **Muse** | `safetyreport/upload` · `ci0926/upload` | `services/community_capture.py`, `services/community_uploader.py`, `services/community_schedule.py`(`register_community_jobs` 제공), `services/community_ingest_client.py`, `core/storage/reports_repo.py`(capture 호출 1곳 + personal_save_state), `web/routers/community_upload_route.py`, `web/templates/report_map.html` 패널, 테스트 | T0b |
| T5 모바일 게이트·초기화 | **Muse** | `safetyreport-mobile/gate-rebuild` · `ci0926/gate-rebuild` | `lib/main.dart`, `lib/providers/report_provider.dart`, `lib/screens/permission_screen.dart`·`setup_screen.dart`(권한 모드 무관/의존 분리), `lib/community/gate/**`, `lib/community/rebuild/**`, `lib/screens/community_onboarding_screen.dart`, `lib/screens/community_rebuild_screen.dart`, `lib/services/community_server_link_service.dart`, `lib/services/server_contract.dart`, `lib/widgets/community_account_card.dart`, `ios/Runner/Info.plist`(URL types), `ios/Runner/AppDelegate.swift`, 테스트 | T0b |
| T6 모바일 데이터 경로 | **Muse** | `safetyreport-mobile/upload` · `ci0926/upload` | `lib/community/capture/**`, `lib/community/upload/**`, `lib/services/sync_engine.dart`, `lib/services/standalone_auto_sync_service.dart`, `lib/services/background_login_check.dart`(dispatcher 분기), `lib/services/local_db_service.dart`(rotate 훅·rebuild 삭제 억제), `lib/screens/report_map_screen.dart` 패널, iOS BGTask 항목(Info.plist 는 T5 뒤 순차 — T6 는 별도 커밋 요청서로 Opus 가 병합), 빌드 스크립트 dart-define, 테스트 | T0b |
| T7 브라우저 QA | **Muse** | `<repo>/qa` (고정 후보, 코드 수정 금지) | `docs/integration/community-ingest/qa/**` 증거 | 통합 후보 |
| T8 빌드·env·스캔 | Opus | 각 integration | 빌드 스크립트·workflow·산출물 스캔 | T3~T6 |

- lockfile 단일 writer: PC `requirements.txt`(T3), 모바일 `pubspec.yaml/lock`(T6, 새 패키지 없음 목표), map/auth `package*.json`(Opus; map 은 사용자가 설치한 `supabase` 2.118.0 devDependency 를 그대로 커밋).
- 자원: 통합 스택 Opus 단독(56320~56329). PC fixture 포트 Opus 18619, Muse 18759/18769. Flutter 는 포트 없음. 브라우저 세션 `sr-opus`/`sr-muse`. 테스트 DB·데이터 루트는 worktree 안 `.agent-runs/<task>/`.
- Muse 발주: `opencode run --dir <worktree> --model opencode-go/muse-spark-1.3-contributor "<TASK 안내>" < /dev/null`, 세션 ID(`opencode session list`)·export 로 model/dir 확인, 작업서 `.agent-runs/<task>/TASK.md`(gitignore 확인), 결과 = 커밋·테스트 로그, 회수 뒤 Opus 가 diff·테스트 재현.
- 병합: auth(T1) → map(T0,T2) → PC integration ← T3 ← T4 → mobile integration ← T5 ← T6 → 통합 검증 → Sol 통합 후보 검토 → 목표 브랜치 merge commit → 1차 정리.

## 11. 테스트(acceptance-matrix 로 확장)
v1 §11 + 추가: S-01(좌표 결측 포함 총계), S-02(철회·재동의·reshare·삭제 tombstone), S-03(crash 3지점), S-04(rebind·takeover·타 사용자), S-05(같은 ID 다른 dataset 두 fact), S-06(목록 일부 실패·상세 실패·crash 재개·부재 행 보존), S-07(설정 복구 POST), S-08(update_jobs 후 커뮤니티 job 존속), S-09(철회/ingest·takeover/ingest·policy/ingest 반복 경쟁, deadlock 0), S-10(구 v2 + ingest 혼합 총계), S-11(published 직후 익명 API), S-12(list_refetch 벡터), S-13(원격 철회 60초 상한), S-15(날짜 내 계정 전환), S-16(좌표 문자열 왕복), S-18(구 RPC·GraphQL·publication 음성), S-19(iOS plist·AppDelegate 정적 검사), S-20(복원·import 후 rotate), S-21(첫 프레임·권한 팝업 순서 위젯 테스트).

## 12. 한계(과장 금지)
v1 §12 유지 + 원격 철회 반영 지연 상한(온라인 ≤60초·오프라인 ≤10분), 삭제는 공개 fact 즉시 제거·비공개 이벤트 원장 30일 보관, dataset_key 는 클라이언트 주장값.

## 13. 운영 전환 준비(실행하지 않음)
운영자용 읽기 전용 사전 점검 SQL(`scripts/integration/preflight_counts.sql`: v1 snapshot·v2 fact·contributor 수), rollout 순서(중앙 schema/RPC → account·ingest 함수 → auth 사이트 문구 → 앱 배포 → 제한 업로드 → ready 전환), rollback(함수 비활성·ready false, pending·원장·개인 DB 무삭제).

## 14. 완료 체크리스트
v1 §14 동일(계획 재확인 → 구현·회수 → 통합 검증 → Sol 통합 검토 → merge·1차 정리 → 7일 감사 → 수정·재검증 → 최종 merge·2차 정리 → 보고).

## 15. 2차 재확인(plan-review-sol-final) 반영 요약
S-02·S-10(critical): 공개 소스 ingest 전용 + 구 자료 발견 시 migration 중단 + identity tombstone. S-03: capture 실패 시 개인 저장 보류. S-04: 중앙 manifest(`server_completed`). S-06: staging 병합 전용 + 무변경 포인터 기록.
S-12: `detail_status` 로 상세 당시 C_NOW 보존·비교. S-20: 개인 DB 교체 전 선회전. S-21: 원문 순서(게이트→권한→설정) + 모드 의존 권한 보충. N-01: 금액 문법·서버 값 검증. N-02: `acceptance-matrix.md`. N-03: 정책 (버전, 해시) 불변 이력.
S-09·S-11·S-18 은 구현 게이트(최종 SQL·실제 스택 HTTP 증거로 닫음, POC 로 닫지 않음).

## 16. 3차 재확인(plan-review-sol-03) 반영 요약
S-02: 철회 계보 fact 는 reshare 없이 새 grant 로 재귀속 안 함 + tombstone 은 신고 identity 단위. S-10: 가드를 공개 중인 구 자료로 한정 + preflight SQL·결정표. S-03: 재시도 파일 + 연속 실패 중단. S-04: manifest 페이지·전체성 검증·fail-closed.
S-06: 무이벤트·무포인터는 detail_status 만, cutover 는 병합. S-12: null 비교 명시·영구 실패 당시 라벨. S-20: revision 파일 전체 단조. S-21: OS 별 권한 집합·채널 예외 처리. N-03: 정책 정본 두 표로 단일화.
최종 SQL 초안(격리 POC `stack-poc/poc-sql/v2/`)으로 위 S-02·S-04·S-10·N-03 동작을 실제 Postgres·PostgREST 에서 확인(증거 `poc_v2.mjs` 출력 — 최종 검증은 통합 스택에서 다시).
