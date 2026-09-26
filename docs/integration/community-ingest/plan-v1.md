# community-ingest 통합 계획 v1 (Opus5.5 초안 — Sol 검토 전)

기준: 사용자 프롬프트 `safetyreport-community-ingest-opus55-v2-mandatory-parallel-audit-prompt.md`(이하 "프롬프트", 절 번호 §)와
`repository-map.md`. 작성 2026-09-26 KST. 이 문서는 **계획**이다. 아직 어떤 제품 코드도 바꾸지 않았다.

## 0. 요약

| 축 | 결정 |
|---|---|
| 중앙 정본 | 한 Supabase 프로젝트. **auth 레포** = 계정·동의 grant·기기(writer) 연결 레지스트리 + `community-account` 함수(사용자 전용). **map 레포** = ingest 이벤트·신고별 최신 fact·공개 projection + `community-ingest` 함수(사용자 전용) + 계약·fixture·통합 manifest 정본 |
| 게이트 | `CAN_ENTER_MAIN = K && C`. K·C 정본은 중앙(`community-account/status`). 앱은 기한 있는 검증 캐시(10분)만 쓰고, ingest 는 저장 트랜잭션 안에서 매번 재확인 |
| 수집 사본 | 공식 상세 응답을 받은 직후, 개인 수정값과 합치기 전에 공유 DTO 확정 → **별도 SQLite 파일 `community.db`** 의 불변 source journal + outbox 에 먼저 commit → 개인 DB 저장 → uploader 깨우기 |
| 전송 | 공통 `request_community_upload(trigger)` 하나. trigger = `realtime/manual/midnight/recovery/rebuild`. 같은 journal·outbox·권한·ACK |
| 자정 | Asia/Seoul 00:00 due, `midnight:<YYYY-MM-DD>` 영속 schedule 행 + lease. 놓친 날은 **한 번만** 보충 |
| 초기화 | `required_crawl_version + local_dataset_id + source_account_namespace` 범위 job. 확인 버튼 → 일관 백업 → 전체 목록·전체 상세(기존 `--force` 경로, `--reset` 금지) → journal/source 상태 staging → 검증 → cutover → marker. 재개·단일 실행 |
| 순서 제어 | writer = 서버 발급 `writer_epoch` 를 가진 연결. 같은 사용자·같은 `dataset_key` 의 active writer 는 1개(명시적 전환). fact 갱신은 `(writer_epoch, source_revision)` 사전식 비교 |
| 공개 | 새 `private.community_report_facts` 를 기존 `internal_analytics_v2_facts` 반환 형태로 투영(aggregate.ts 변경 최소). 저장 커밋과 같은 트랜잭션에서 `dataset_version` 갱신 → projection 유실 없음 |

## 1. 요구사항 ID (추적표는 `requirements-traceability.md` 로 분리 예정)

| ID | 요구(프롬프트 §) | 담당 repo |
|---|---|---|
| R-ENV | 공개 설정 계약·주입·검증·비밀 차단 (§4) | 4개 |
| R-AUTH | 카카오 세션·영속 writer 연결·토큰 수명 (§5.1~5.3) | auth, PC, mobile |
| R-CONSENT | 동의 grant 정본·철회 직렬화 (§5.4, §6.6) | auth, map |
| R-GATE-M / R-GATE-P | 모바일 권한 전 게이트 / 서버 로그인 뒤 게이트 (§6) | mobile / PC |
| R-REBUILD | 1회 초기화 크롤링 (§7) | PC, mobile |
| R-CAPTURE | 수집 순간 DTO 확정 (§8, §9) | PC, mobile, map(fixture) |
| R-CONTRACT | 업로드 계약·ACK (§10, §17) | map |
| R-OUTBOX | 영속 journal/outbox·재시도 (§11) | PC, mobile |
| R-TRIGGER | 실시간·수동·자정 (§12) | PC, mobile |
| R-INGEST | 인증·인가·저장 (§13, §15, §16) | map |
| R-SECMATRIX | 공격 행렬 자동화 (§14) | map(+auth) |
| R-PROJ | 증분 사실·공개 반영 (§18) | map |
| R-MIG | 합성 migration 이력 (§21) | map(manifest), auth |
| R-UI | 필수 페이지·초기화·지도 패널 (§20) | PC, mobile, auth |
| R-PAR | 병렬 구현·머지·정리 (§23, §24) | 전체 |
| R-AUDIT | 최근 7일 Sol 감사 (§25) | 전체 |

## 2. 전체 흐름

```
[모바일] 로컬 schema 준비 → (loading/gate shell) → 중앙 status → [필수]카카오 + [필수]공유 동의
        → 기존 PermissionScreen → SetupScreen(모드·서버/공식 계정) → 초기화 안내·확인 → 초기화 job → 일반 화면
[PC]    기존 로그인/최초 관리자 설정 → CommunityGate 미들웨어 → /onboarding/community (두 카드)
        → 원래 목적지(허용된 상대경로) → 초기화 필요 시 /onboarding/rebuild 안내·확인 → 초기화 job

수집(실시간/증분/전체/단건/초기화 모두 같은 지점)
  공식 상세 응답 → 파서 → [capture] 공유 DTO(수정값 적용 전) → canonical JSON → sha256
  → community.db: journal INSERT + outbox INSERT (1 트랜잭션, commit) → 개인 DB 저장(기존 코드) → uploader wake
uploader(메인 프로세스/앱 isolate 1개): outbox lease → community-ingest POST(apikey + 사용자 Bearer) → 이벤트별 ACK → journal 에 receipt 기록 → outbox 행 삭제
수동/자정: journal 과 delivery ledger 대조 → 미ACK 항목만 outbox 로 → 같은 drain
중앙: community-ingest(JWT 검증·getUser·레지스트리) → RPC internal_community_ingest(트랜잭션: 권한 재확인·멱등·순서·fact·dataset_version) → ACK
공개: public-analytics → internal_analytics_v2_facts(새 migration 에서 ingest fact 투영) → aggregate.ts
```

## 3. 중앙(Supabase) 설계

### 3.1 migration 소유와 합성 순서

| 순서 | repo | 파일 | 상태 |
|---|---|---|---|
| 1 | map | `202608150001_initial_schema.sql` | 기존, 수정 금지 |
| 2 | map | `202609240001_analytics_v2.sql` | 기존(운영 미적용 제안), 수정 금지 |
| 3 | auth | `202609251200_community_auth_relay.sql` | 기존, 수정 금지 |
| 4 | auth | `202609260100_community_account_registry.sql` | **신규**: 정책 버전, 동의 grant, writer 연결, 계정 RPC. 의존: 1(contributor_profiles) |
| 5 | map | `202609260200_community_ingest.sql` | **신규**: ingest 이벤트, 신고별 fact, ingest RPC, 공개 facts RPC 교체, invalidate 트리거 교체, rate limit. 의존: 2, 4 |

- manifest(`migration-manifest.json`, map 정본): repo·commit·파일·version·sha256·depends_on. 검사 스크립트는 중복 version, 같은 version 다른 내용, 누락 의존, 소유 원문 체크섬 불일치를 실패로 한다.
- 합성 staging: `scripts/integration/compose_supabase.mjs` 가 두 레포 원문을 읽어 **한 번씩** `staging/supabase/migrations/` 에 복사하고 `config.toml`(격리 project_id·포트)·functions 를 조립 → `npx supabase start --workdir staging` (map 레포 devDependency `supabase` 2.118.0, 사용자가 설치한 버전 고정).
- 전환 경로 테스트: 빈 DB(1~5), map 만 적용 DB(1,2 → 3,4,5), auth 만 적용 DB(3 → 1,2,4,5 는 4 가 1 에 의존하므로 1 먼저), 양쪽 적용 DB(1,2,3 → 4,5).
- 운영 적용·`db push`·repair 는 하지 않는다(승인 경계).

### 3.2 auth 신규 SQL (4)

```
private.community_policy (singleton): required_version text, consent_text_sha256 text, effective_at
  seed: required_version = '2026-09-26.1', sha256 = contracts 의 동의문 해시 (manifest 검사로 일치 확인)
private.community_consent_grants: grant_id uuid pk, user_id → auth.users, policy_version, consent_text_sha256,
  granted_at, granted_session_id uuid, granted_via ('safetyreport_server'|'mobile_standalone'|'mobile_client'),
  revoked_at, revoke_reason, revoked_session_id. unique (user_id) where revoked_at is null
private.community_connections: connection_id uuid pk, user_id, bound_session_id uuid, connection_secret_sha256,
  source_app ('safetyreport'|'safetyreport-mobile'), source_mode ('server'|'standalone'), platform text(표시용),
  device_label, dataset_key char(64) (공식 계정 네임스페이스 해시, 불투명), writer_epoch bigint (시퀀스),
  status ('active'|'superseded'|'revoked'|'suspended'), created_at, rebound_at, revoked_at, revoke_reason,
  last_accepted_revision bigint default 0.
  unique (user_id, dataset_key) where status='active'
private.community_writer_epoch_seq
contributor_profiles(기존 map 테이블): 계정 RPC 만 갱신(단일 writer) — 동의 시 upsert(consent_version, privacy_policy_version, consented_at, revoked_at=null, status 유지), 철회 시 revoked_at
```

RPC(모두 `public.internal_account_*`, `security definer set search_path=''`, EXECUTE 는 service_role 만, PUBLIC/anon/authenticated 철회):
- `internal_account_status(p_user uuid, p_session uuid, p_connection uuid)` → K 판정 재료(`auth.identities` provider='kakao' 존재, `auth.users.is_anonymous=false`, banned/deleted 아님, `auth.sessions` 에 p_session 존재·not_after), grant, contributor status, connection(상태·epoch·bound 여부·last_accepted_revision).
- `internal_account_grant_consent(p_user, p_session, p_policy_version, p_text_sha256, p_via)` → 현재 정책과 다르면 거부, 같은 활성 grant 가 있으면 멱등 반환, 없으면 새 grant(+contributor_profiles upsert). **contributor 행 `for update`** 로 직렬화.
- `internal_account_revoke_consent(p_user, p_session, p_grant)` → grant `for update` 후 revoked_at, contributor_profiles.revoked_at.
- `internal_account_register_connection(p_user, p_session, p_payload jsonb, p_takeover bool)` → 같은 (user, dataset_key) active 가 있고 takeover=false 면 `writer_conflict`(상대 기기 label·platform 만), true 면 기존을 `superseded`. 새 epoch 발급. 비밀 원문은 받지 않고 sha256 만 저장.
- `internal_account_rebind_connection(p_user, p_session, p_connection, p_secret_sha256)` → 같은 user·비밀 일치·status active 일 때만 bound_session_id 교체(epoch 유지). 다른 user 면 `account_mismatch`.
- `internal_account_revoke_connection(p_user, p_connection)`.

### 3.3 auth 신규 함수 `community-account` (사용자 전용)

- config: `[functions.community-account] verify_jwt = true` **그리고** handler 에서 `supabase.auth.getUser(jwt)`(GoTrue `/user` — 서명·만료·세션 존재 확인, POC 에서 로그아웃 후 403 `session_not_found` 확인) + 검증된 토큰의 claims(`role=authenticated`, `aud`, `iss`, `session_id`, `is_anonymous=false`) 확인. relay 함수(`verify_jwt=false`, capability 검증)와 설정·코드 분리 유지.
- 경로: `POST /functions/v1/community-account/{status|consent|consent-revoke|connections|connections-rebind|connections-revoke}`, 본문 `{"protocol":1,...}`, 모르는 필드 거부, 8KB, `Cache-Control: no-store`, 오류 형식은 relay 와 같은 `{error:{code,message,requestTraceId,retryAfterSeconds?}}`.
- status 응답(정본 계약 `contracts/community-ingest/account-api.md`): `{protocol, user:{kakao_linked, display_name?}, policy:{required_version, consent_text_sha256}, consent:{state:'active'|'none'|'revoked'|'outdated', grant_id?, policy_version?, granted_at?}, contributor:{status}, connection?:{status, writer_epoch, bound_to_current_session, last_accepted_revision, source_app, source_mode}, gate:{kakao:bool, consent:bool, can_enter:bool, reasons:[…]}, server_time}`. 내부 UUID 중 user_id 는 반환하지 않는다(계정 비교는 `account_fingerprint = sha256("sr-community-account|v1|"+user_id)` 앞 32hex).
- 공통 서버 모듈 `server/account.ts`(Deno·Node 공용, relay 패턴과 동일) + Edge 엔트리 얇게.

### 3.4 map 신규 SQL (5)

```
private.community_ingest_events: receipt_id uuid pk, contributor_id uuid, event_id uuid, connection_id, consent_grant_id,
  writer_epoch, source_system, source_report_key char(64)=sha256(source_system|source_report_id), source_report_id text(private),
  source_revision bigint, event_type, payload jsonb, payload_sha256 char(64), captured_at, received_at, request_id,
  trigger text, result ('accepted'|'no_change'|'stale_ignored'|'quarantined'), quarantine_reason.
  unique (contributor_id, event_id)
private.community_report_facts: (contributor_id, source_report_key) pk, source_report_id, latest_receipt_id, writer_epoch,
  source_revision, payload_sha256, consent_grant_id, public_state ('completed'|'withdrawn_after_completion'|'not_completed'),
  report_date, completed_date, category, status, disposition, amount_kind, amount_confirmed_won, vehicle_raw,
  lat, lng, coord_source, address, region_code, point_key, agency_key, agency_name, manager_key, manager_name,
  first_accepted_at, updated_at
(+ 인덱스: report_date/completed_date/category/region, point_key)
```

- `public.internal_community_ingest(p_user uuid, p_session uuid, p_request_id text, p_envelope jsonb, p_events jsonb)` service_role 전용:
  1. contributor_profiles 행·grant 행 `for share`, connection 행 `for share`(철회·해제 RPC 는 `for update` → 직렬화).
  2. K(identities kakao, not anonymous), 세션 존재, connection(active·user 일치·bound_session_id=p_session·source_app/mode 일치), grant(active·user 일치·policy_version=required), contributor status='active' → 하나라도 실패면 요청 전체 403 코드(`connection_*`, `consent_*`, `session_*`, `contributor_suspended`), **쓰기 0**.
  3. 이벤트마다: `insert … on conflict (contributor_id, event_id) do nothing` → 충돌이면 기존 해시 비교: 같으면 `duplicate`(기존 receipt 반환), 다르면 `conflict`(409 의미, 기존 불변).
  4. event.writer_epoch ≠ connection.writer_epoch → `rejected: writer_epoch_mismatch`(쓰기 없음).
  5. fact 비교: 없으면 insert(`accepted`); `(epoch, revision)` 가 더 크면 해시 같으면 `no_change`(fact 불변, 이벤트 기록), 다르면 update(`accepted`); 작거나 같으면 `stale_ignored`(이벤트 기록, fact 불변).
  6. connection.last_accepted_revision = max(...). 하나 이상 fact 변경 시 `analytics_state.dataset_version` 새 값·`source_updated_at=now()`.
  7. 결과 배열 반환. 전체가 한 트랜잭션.
- 서버측 정규화(TS, `server/ingest/normalize.ts`): `region_code`(주소 앞 두 토큰 정규화), `point_key`(`v1:` + lat_e7,lng_e7), `agency_key`/`manager_key`(기관+이름 정규화, 동명이인 전역 병합 금지), 상태 재매핑 검증(`status_raw` → status 불일치면 quarantine).
- `internal_analytics_v2_facts` 를 새 migration 에서 `create or replace`: 소스를 `community_report_facts where public_state='completed' and lat is not null` + contributor active & 미철회로 바꾸고, 반환 필드는 기존 `PrivateFact` 형태(`snapshot_id='ingest-v1'`, `snapshot_generation=1`, `fact_identity=source_report_key`). → `aggregate.ts` 의 activeFacts 가 수정 없이 동작. 구 `report_facts_v2`(snapshot) 경로는 공개 소스에서 제외(운영 데이터 없음 — 문서 근거; 이중 집계 차단). v1 연간 집계는 v2 공개 API 에 원래 쓰이지 않는다.
- `private.invalidate_analytics_v2()` 교체: ready=false 로 전체 공개를 끄지 않고 `dataset_version` 만 갱신(증분 모델에서 한 사람의 철회가 지도 전체를 내리지 않게). `ready` 는 운영자 공개 스위치(rollout "공개 projection 활성화")로 의미를 좁힌다.
- ACK `projection_status`: fact 변경 & `analytics_state.ready` → `published`, 변경 & not ready → `held`, 변경 없음 → `not_applicable`.
- rate limit: 기존 `private.rate_limits` 재사용 `internal_community_ingest_rate_limit(bucket)`(사용자 분당 60 요청, IP 해시 분당 120). IP 는 `cf-connecting-ip` → 없으면 `x-forwarded-for` 첫 값(Supabase gateway 뒤 전제, 문서화).

### 3.5 map 신규 함수 `community-ingest`

§13 처리 순서 그대로: 메서드 POST·`Content-Type: application/json`·본문 ≤256KiB·events 1~20 → getUser+claims → rate limit → strict schema(`contracts/community-ingest/envelope.schema.json`, 모르는 필드 거부, 문자열 길이·enum·날짜·좌표 범위·정수) → 서버 해시 재계산(canonical JSON, 불일치 422) → RPC → 이벤트별 ACK. OPTIONS 는 부작용 없이 허용 Origin(`https://safemap.worklazy.net`, `https://safeauth.worklazy.net`)만 CORS 헤더, 인증 요구 안 함. Origin 없음 허용. 관리자 키 fallback 없음. 서비스 간 관리 호출 없음.

### 3.6 보안 행렬(§14) — 자동화 위치
map `tests/integration/security-matrix.test.ts`(로컬 Supabase 실제 HTTP): 공개키만/공개키 Bearer/가짜 JWT/다른 프로젝트 JWT(다른 키로 서명)/만료/`alg:none`/legacy anon·service_role 을 Bearer 로/익명 로그인/무동의/무연결/타인 connection/다른 session/해제·철회 후 기존 JWT/body 에 타 user/폐기 grant/미지원 source_app·Client 모드/직접 REST insert·upsert·RPC·GraphQL·private select/과대 payload·행수·필드/정상/같은 event 재전송/같은 event 다른 내용 → 각 기대 결과 + **DB 행 수 불변 확인**. 마지막 행(정상 세션의 다른 프로그램)은 "구분 불가"로 문서화.

## 4. 공통 계약(map `contracts/community-ingest/`, 병렬 구현 전에 Opus 가 확정)

| 파일 | 내용 |
|---|---|
| `README.md` | 버전 `community-ingest-v1`, 정책 `2026-09-26.1`, rebuild `source-rebuild-2026-09-26.1`, 변경 규칙 |
| `observation.schema.json` | 공유 payload(아래) |
| `envelope.schema.json`, `ack.schema.json` | 요청/응답 |
| `account-api.md` | 3.3 |
| `canonical-json.md` + `vectors/canonical-json.json` | 정렬 키, `,:` 구분, UTF-8, ensure_ascii=false, 문자열은 DTO 생성 때 NFC, **부동소수 금지**(좌표 `lat_e7`/`lng_e7` 정수), null 유지, 날짜 `YYYY-MM-DD` 문자열 |
| `status-mapping.json` + `vectors/observations/*.json` | 공식 입력(파서 출력 수준의 합성값) → 기대 DTO·해시·eligibility·event_type |
| `gate.md` + `vectors/gate.json` | status 응답 → can_enter/reasons, 캐시 규칙 |
| `schedule.md` + `vectors/schedule.json` | 가상 시각·이력 → next_due/due 여부/보충 1회 |
| `rebuild.md` | job 상태기계·완료 기준·보존 목록 |
| `local-store.md` | `community.db` 테이블 정의(PC·mobile 같은 의미) |
| `consent/share-consent-2026-09-26.1.md` + sha256 | 동의문 정본(앱 사본 해시 일치 테스트) |

공유 payload(`observation.schema.json`, v1):
```json
{"report_date":"YYYY-MM-DD|null","completed_date":"YYYY-MM-DD|null","category":"traffic|parking|other",
 "violation_type":"≤60|null","status_raw":"≤40","status":"accepted|partial|rejected|completed_unknown|withdrawn|transferred|processing|supplement|other",
 "disposition":"fine|penalty|warning|none|unknown","amount":{"kind":"fine|penalty|combined|unknown","confirmed_won":"int|null"},
 "agency_name":"≤200|null","manager_name":"≤160|null","vehicle_raw":"≤64|null","address":"≤200|null",
 "location":{"lat_e7":"int|null","lng_e7":"int|null","source":"geocode|none","geocoder":"≤40|null"}}
```
- eligibility(`is_community_eligible_observation`): status ∈ {accepted, partial, rejected, completed_unknown}. 처리중·보완·이송·취하·기타(분류 불가)는 신규 완료 아님. **기존 `종결여부`(취하·이송 포함 Y)와 다르다** — 차이표를 `status-mapping.json` 에 둔다.
- event_type: eligible 이면 `completed_observation`; 이전에 eligible 로 공유(journal 의 최신 공유 관측)했는데 이번 공식 관측이 not eligible 이거나 status/disposition 이 바뀌면 `status_correction`(payload 는 이번 관측 그대로). 개인 편집으로는 절대 생성 안 함.
- 금액: `범칙금_과태료` 원문에서 확정 금액만(정수 원). 규칙 추정 금액은 넣지 않는다(PROJECT_RULES 3-2). 과태료/범칙금 구분 불가 → `combined`, 원문 없음 → `unknown`+null. 0 과 null 구분.
- 좌표: capture 시점에 **공식 주소**로 계산된 지오코딩 결과만(PC `_prefetch_derived()` 결과, mobile 은 공식 주소 키로 `geocode_cache` 조회). 사용자 override 좌표·override 주소는 읽지 않는다. 없으면 null — 이후 같은 공식 주소가 캐시에서 풀리면 수동/자정 트리거 때 `location_supplement` 이벤트(새 revision, 나머지 필드 동일)로 보충.
- 금지: 공식 로그인·쿠키·헤더·사진·첨부·신고 본문 원문·처리내용 원문. `source_report_id` 와 `vehicle_raw` 는 private(공개 API 에 안 나감).

## 5. 로컬 저장소 `community.db` (PC `data/community.db`, mobile 앱 문서 폴더 `community.db`)

개인 DB(`data.db`, 모바일 `mysafetyreport.db`)와 **분리한 파일**. 근거: PROJECT_RULES 3-1(교환 스키마를 바꾸지 않음), 백업·DB 편집기·변환·clearAll 이 구조적으로 건드리지 못함, 기존 커뮤니티 세션도 data.db 밖에 둔 선례.
WAL, `synchronous=FULL`, 일반 영속 테이블(TEMP 금지).

| 테이블 | 핵심 컬럼 |
|---|---|
| `meta` | schema_version, project_namespace(=sha256(supabase_url)[:16]), local_dataset_id |
| `context` | 단일 행: contributor_fingerprint, connection_id, writer_epoch, consent_grant_id, policy_version, verified_at, state(active/inactive) — 메인 프로세스가 중앙 status 확인 후 기록, 수집 프로세스는 읽기만 |
| `source_journal` | event_id pk, project_namespace, local_dataset_id, source_report_id, source_revision(단조, `meta.next_revision` + 서버 last_accepted_revision 하한), captured_at(UTC), event_type, schema_version, parser_version, payload_json(canonical), payload_sha256, eligible, contributor_fingerprint, connection_id, writer_epoch, consent_grant_id, capture_trigger(realtime/rebuild/single/recovery), rebuild_run_id, ack_status, receipt_id, acked_at, projection_status |
| `report_latest` | (local_dataset_id, source_report_id) pk → 최신 journal event_id·eligible·status·disposition·last_shared_event_id (correction 판단용) |
| `outbox` | event_id pk(fk journal), state(pending/in_flight/retry_wait/auth_required/blocked/dead_letter), attempt_count, next_retry_at, lease_owner, lease_until, last_error_code, last_request_id, enqueued_trigger, enqueued_at |
| `upload_runs` | run_id, trigger, schedule_key, started_at, finished_at, result(no_change/success/partial/auth_required/consent_required/failed/deferred), counts JSON, request_ids |
| `schedule_runs` | schedule_key pk(`midnight:YYYY-MM-DD`), scheduled_date_kst, due_at_utc, state(due/running/succeeded/deferred/failed), attempts, last_attempt_at, finished_at, deferred_reason, lease_owner, lease_until |
| `rebuild_jobs` | run_id pk, required_version, local_dataset_id, source_account_namespace, state(§7.4), confirmed_at, started/updated/completed_at, phase, counts(listed/fetched/failed/eligible/pending_upload), backup_ref(경로·크기·integrity_check 결과), lease_owner/lease_until, last_error, source_generation |
| `rebuild_items` | (run_id, source_report_id) pk, state(pending/fetched/failed_retryable/failed_permanent), attempts, last_error, event_id |

- journal 행은 **불변**(ack 열만 갱신). outbox 행은 durable ACK(accepted/duplicate/no_change/stale_ignored/quarantined) 때 삭제, journal 에 receipt 기록. 거절은 dead_letter 로 보존.
- 보존: ACK 된 journal 행은 신고별 최신 1건 + 미ACK 전부 유지, 나머지는 90일 뒤 정리(용량 상한 200MB 경고). 정리는 조용히 pending 을 버리지 않는다.
- `project_namespace` 가 바뀌면(다른 Supabase 프로젝트) 이전 namespace 행은 전송하지 않고 `blocked:namespace_changed`(E05). 토큰 저장소도 namespace 별.
- 백업 복원·공식 계정 변경 훅이 `local_dataset_id` 를 새로 발급 → 초기화 marker 재사용 안 함(G14).

## 6. 게이트

### 6.1 판정(두 앱 공통, `contracts/community-ingest/gate.md`)
- K: 로컬에 유효 커뮤니티 세션(재로그인 필요 아님) **그리고** 중앙 status `gate.kakao=true`(identities kakao·비익명·세션 존재).
- C: 중앙 status `consent.state='active'` 이고 `policy_version = required_version`.
- 캐시: 성공 판정은 10분 유효(`verified_at`), 앱 cold start·로그인·사용자 변경·동의 변경·철회·401/403 수신 때 즉시 무효. 확인 실패(네트워크) 시 이전 성공 캐시가 유효기간 안이면 유지, 지났으면 `verification_required`(진입 차단, 재시도 UI). 로컬 prefs/SQLite 의 true 만으로 통과 없음.
- 설정 누락/자리표시자/비밀키 → `config_invalid` 복구 화면(fail-closed).

### 6.2 PC(§6.3, §6.4)
- `main.py`: 기존 `auth_middleware` 뒤에 `community_gate_middleware`. 세션 로그인된 HTML GET → `/onboarding/community?next=<허용 상대경로>`; 그 외 메서드·JSON → 403 `{"code":"COMMUNITY_ONBOARDING_REQUIRED","recovery":"/onboarding/community"}`.
- `/api/v1/**`(API 키): 라우터 의존성 `require_community_gate` 를 api_router 전체에 적용, 예외는 아래 allowlist 만.
- `/ws/events`: 연결 시 게이트 미충족이면 4403 으로 닫음. 게이트가 충족→미충족으로 바뀌면 열린 WS 에 `community_gate_required` 방송 후 닫음. `/crawl/ws/logs`, `/rating/ws/rating_logs`(현재 인증 없음 — 감사 후보)는 세션 확인 + 게이트.
- 예약 크롤링(`run_crawler`)·수동 크롤·알림 단건·별점 작업: 시작 전 게이트+초기화 상태 확인, 미충족이면 건너뜀(로그). 동의 철회 감지 시 진행 중 크롤은 기존 stop 경로로 다음 안전 지점에서 멈춤, uploader 정지.
- allowlist(정확한 method+path): `GET/POST /login`, `/setup`, `/logout`, `GET /health`(민감정보 없음 확인), `/static/**`, `GET /onboarding/community`, `GET /onboarding/rebuild`, `GET /settings/community/status`, `POST /settings/community/{start,confirm,cancel,disconnect,consent,consent-revoke,writer}`, `GET /settings/community/policy`, `GET /settings/community/rebuild`, `POST /settings/community/rebuild/{start,resume,pause}`, `GET /help/community`(정책·도움말), API 키: `GET /api/v1/app/config`, `GET /api/v1/community-auth/status`, `POST /api/v1/community-auth/{start,confirm,cancel,disconnect}`, `GET /api/v1/community/gate`, `GET /api/v1/community/rebuild`, `POST /api/v1/community/rebuild/{start,resume}`. 각 route 는 원래 인증·CSRF·manager 권한을 그대로 검사.
- `/media/*`(현재 공개 prefix): 신고 첨부 프록시 여부 확인 후 세션/게이트 적용(감사 후보로 기록, 이번 범위에서 차단 필요 시 적용).
- 초기화 필요/진행 중: 게이트 통과 후에도 수동·예약 크롤 시작은 409 `COMMUNITY_REBUILD_REQUIRED`(초기화 job 이 유일한 크롤). 조회·설정·도움말은 사용 가능(교착 방지), 상단 배너.
- next 검증: `/` 로 시작, `//`·`\\`·스킴·`@`·제어문자 없음, 알려진 route prefix 만.
- 모든 OS·Docker·소스 실행이 같은 미들웨어(플랫폼 분기 없음). fixture 서버(개발 스크립트, 릴리즈 번들 제외)는 게이트를 끄지 않고 로컬 Supabase 스택을 가리킨다.

### 6.3 mobile(§6.2)
- `main.dart` home 결정 앞에 `CommunityGateShell`: `!initialized` → 로딩, `!gate.canEnter` → `CommunityOnboardingScreen`(두 카드), 이후 기존 `SetupScreen`→`PermissionScreen`(신규 설치) / `MainNavigationScreen`(기존 사용자) → 초기화 필요 시 `CommunityRebuildScreen`.
  권한 요청 순서 변경: 게이트 전 OS 권한 팝업 0회(현재 권한 요청은 PermissionScreen·지도·설정·파일 브라우저에서만 → 게이트 뒤로 자연히 밀림. `NotificationService` 는 시스템이 권한 승인 시 시작하므로 수집 큐 처리만 게이트 뒤로).
- `ReportProvider.init()`: `BackgroundLoginCheck.schedule()`, `_drainAndRefresh()`, 자동 동기화, WsService 시작을 게이트 통과 후로 이동(`onGatePassed`). Workmanager 콜백·NotificationService 큐 처리도 게이트 캐시(유효 기간 내 성공)가 없으면 수집 안 함(큐는 보존).
- 딥링크: `CommunityAuthLinkChannel` 은 게이트 안에서도 수신(교착 방지). 알림 탭(`navigateToTab`)은 게이트 미충족이면 무시하고 게이트 화면 유지. Android back 은 게이트 화면에서 앱 종료(`SystemNavigator.pop`)만.
- Client 모드: 앱 자체 K·C 필수(같은 화면). 서버 게이트 상태는 `/api/v1/community/gate` 로 표시. 서버와 계정이 다르면(`account_fingerprint` 불일치) 민감 제어 버튼 비활성·설명. 민감 제어 요청에는 폰의 access token 을 `X-Community-User-Token` 으로 보내고 서버가 GoTrue `/user` 로 검증해 서버 연결 사용자와 같은지 확인(토큰 저장 안 함). Client 는 writer 등록·업로드·자정 작업을 만들지 않는다.

### 6.4 동의 UI(§6.6, §20.1)
두 카드(`[필수] 카카오 인증`, `[필수] 신고내용 공유 동의`), 동의 체크 기본 해제, 정책 펼침(공개 항목: 정확 좌표·주소·기관·담당자 전체 성명·처리결과·마스킹 차량·신고일/처리완료일; 비공개: 계정·원 차량번호·공식 신고번호; 전송 방식: 수집 즉시·지도 탭 수동·매일 00:00; 철회: 즉시 게이트 복귀·공개 제외, 재동의 시 이전 전송분 다시 공개; 삭제 요청 별도), 서버 저장 성공 후에만 완료 표시, `다음` 은 둘 다 완료 전 비활성+사유, 로그아웃·계정 변경·도움말·종료 항상 가능. `건너뛰기/나중에` 없음.

## 7. 초기화 크롤링(§7)

- 필요 조건: `rebuild_jobs` 에 `(required_version, local_dataset_id, source_account_namespace)` completed 행 없음. 새 설치도 같은 job 하나(첫 전체 수집 겸용, G04).
- 안내·확인: K·C·필수 OS 권한·공식 계정(서버 모드) 준비 후 안내 화면 → `확인 — 초기화 크롤링 시작` → job 생성(동시 확인은 `unique(required_version, dataset, namespace) where state not in (completed, abandoned)` + lease 로 1개).
- 단계: `preparing_backup`(PC: sqlite3 backup API → `data/backups/pre-rebuild-<run>.db` + `PRAGMA integrity_check`; mobile: `VACUUM INTO` → 앱 폴더 backups/ + integrity_check. 실패·공간 부족 → `failed`, 데이터 무변경) → `running`(목록 전체 → `rebuild_items` 등록 → 상세 전체, 기존 수집 코드 경로 그대로라 capture·개인 저장·override 보존이 일반 수집과 같음; item 단위 checkpoint, 재시작 시 fetched 건 건너뜀) → `validating`(목록 페이지 전부 성공, items 전부 fetched 또는 failed_permanent 로 분류, 파서 오류 0 이 아니면 retry) → `committing`(community.db 한 트랜잭션: source generation 확정·report_latest 확정·marker) → `completed`.
- 실패 분리: 로그인 실패/403/목록 일부 실패 → `failed`(0건 성공 금지, G12); 정상 인증의 빈 목록(총 0건·페이지 탐색 완료) → completed(G13). 부분 실패는 재시도, 영구 실패(삭제된 원본 등)는 누락 범위를 화면에 표시하고 사용자가 "누락 N건을 두고 완료"를 명시적으로 선택할 때만 `completed_with_gaps`(marker 는 완료로 인정, 목록 보존).
- 보존: 관리자 계정·config·공식 계정 설정·커뮤니티 세션/grant/connection·사용자 설정·override·감시목록·중복 판단·지오코딩 캐시·미전송 outbox·journal·receipt·epoch. `--reset` 절대 사용 안 함, clearAll 안 함.
- 동시성: 초기화는 크롤 lock 을 잡는다. 예약·수동 크롤은 초기화 필요/진행 중 409 로 거절. 서버 재시작·앱 재실행 시 `running` + lease 만료 job 을 같은 run_id 로 재개(자동 재개는 같은 run 범위만).
- 철회·로그아웃: 다음 item 경계에서 `paused(reason)`. 업로드도 정지. 재동의 후 사용자가 "계속"을 눌러야 재개.
- 초기화 성공 ≠ 업로드 완료: 화면에 `초기화 완료 · 중앙 전송 대기 N건` / `중앙 저장 완료 · 지도 반영 중` 구분.
- Client: `POST /api/v1/community/rebuild/start` 로 서버 job 시작·조회. 모바일 로컬 전수 수집 없음(G16).

## 8. 업로드·스케줄(§11, §12)

- `request_community_upload(trigger)`: (1) 로컬 게이트 캐시·context active 확인(아니면 즉시 `auth_required/consent_required/connection_required` 결과) → (2) 프로세스 single-flight + community.db `upload_lease` → (3) manual/midnight/recovery: journal 중 ack_status null(또는 retryable) & outbox 없음 → outbox 로 enqueue; `location_supplement` 후보 생성 → (4) drain: `(connection_id, consent_grant_id)` 가 현재 context 와 같은 행만, 요청당 ≤20건·≤256KiB, 새 이벤트는 기다리지 않고 1건 즉시 → (5) 결과 적용 → (6) upload_runs 기록.
- HTTP: 401 → 토큰 갱신 1회 후 재시도, 실패면 해당 행 `auth_required`. 403 코드별 `blocked`(consent_revoked/connection_*/writer_superseded/contributor_suspended) → context inactive + 게이트 재평가. 409 conflict(이벤트) → dead_letter. 400/413/422 → dead_letter. 429 → Retry-After. 5xx/timeout → 지수 백오프(1s·2s·…·최대 1h)+지터 ±20%. HTTP 2xx 라도 이벤트별 ACK 로만 삭제.
- 실시간: capture commit 뒤 wake(PC: 수집 서브프로세스가 쓰면 메인 프로세스 uploader 가 `PRAGMA data_version` 1초 폴링으로 감지; mobile: 같은 isolate 이벤트, 백그라운드 isolate 는 lease).
- 자정: `next_kst_midnight(now_utc)` (zoneinfo/`timezone` 패키지 없이 KST=UTC+9 고정 — 한국은 DST 없음, 테스트 벡터로 고정), due key `midnight:<KST 날짜>`. 시작·resume·네트워크 복구 때 "가장 최근 지난 자정" 의 key 가 succeeded 가 아니면 1회 실행(여러 날 누락도 1회, H11). 실행 결과 partial/실패는 succeeded 로 안 찍고 `deferred`/`failed`+다음 기회 재시도. lease 로 다중 worker·중복 OS job 방지.
  - PC: APScheduler `CronTrigger(hour=0, minute=0, timezone=Asia/Seoul)` + lifespan 시작 시 catch-up. 브라우저 세션 불필요.
  - Android: Workmanager 고유 periodic(1h, network) + 다음 자정 one-off(initialDelay) + 앱 resume catch-up. 정확 알람·상시 FGS·배터리 예외 요구 안 함.
  - iOS: `Info.plist` `BGTaskSchedulerPermittedIdentifiers`·`UIBackgroundModes(fetch, processing)`, Workmanager iOS 등록 코드, resume catch-up. 실제 기기 E2E 미실행 표시.
  - Client: 모바일 자정 writer 없음, 지도 탭 버튼은 서버 `POST /api/v1/community/upload/run`.
- 지도 탭 패널(두 앱): `커뮤니티 공유 / 마지막 업로드(KST) / 전송 대기 N · 확인 필요 M / 자동 업로드: 매일 00:00 (한국 시간) — 앱 종료·절전·네트워크 상태에 따라 지연될 수 있으며 다음 실행 기회에 이어서 전송 / [지금 업로드]`, 상태 문구(업로드 중·변경 없음·부분 성공·인증 필요·중앙 저장 완료·지도 반영 중·실패+추적 ID), "수정한 개인 데이터는 공유하지 않습니다" 안내. 연타는 진행 중 run 에 합류.

## 9. 설정·비밀(§4)

| 논리 이름 | PC | mobile | map | auth |
|---|---|---|---|---|
| COMMUNITY_SUPABASE_URL | `[COMMUNITY] supabase_url` ← env `COMMUNITY_SUPABASE_URL`(신규 별칭) / `SAFETYREPORT_COMMUNITY_SUPABASE_URL`(기존) — 둘 다 있고 다르면 `config_conflict` | dart-define 같은 이름 | 함수 런타임 `SUPABASE_URL`(플랫폼) | `SAFEAUTH_PUBLIC_SUPABASE_URL` |
| COMMUNITY_SUPABASE_PUBLISHABLE_KEY | 같은 방식 | 같은 이름 | 브라우저에 안 넣음(지도는 공개 API URL 만) | `SAFEAUTH_PUBLIC_PUBLISHABLE_KEY` |
| COMMUNITY_INGEST_FUNCTION | 기본 `community-ingest` | 같음 | 함수 디렉터리 이름 | — |
| COMMUNITY_AUTH_URL | `site_url` 기본 `https://safeauth.worklazy.net/` | Client 안내용 | — | 사이트 자체 |
| COMMUNITY_MOBILE_REDIRECT_URI | — | 기존 상수 | — | GoTrue Redirect URL 목록(운영) |
| COMMUNITY_UPLOAD_TIMEZONE / DAILY_TIME | 코드 상수 `Asia/Seoul`/`00:00`(변경 UI 없음) | 같음 | — | — |
| COMMUNITY_ONBOARDING_POLICY_VERSION | `2026-09-26.1` 상수 + 중앙 status 대조 | 같음 | contracts | policy 행 seed |
| COMMUNITY_REQUIRED_CRAWL_VERSION | `source-rebuild-2026-09-26.1` | 같음 | contracts | — |

- 공식 빌드 주입: PC — `scripts/build/build_exe.py` 와 `Dockerfile` 이 `community_public.json`(allowlist 4키 + 설정 버전) 생성 리소스를 포함하고 `settings` 가 우선순위 env > config.ini > 번들 기본값으로 읽는다. CI 는 `${{ vars.COMMUNITY_SUPABASE_URL }}` 등 Variables → 생성 스크립트 → 산출물 검사(자리표시자·`sb_secret_`·service_role JWT·Kakao secret 패턴이면 실패). mobile — `build_android_*.sh`·`build-apk.yml` 이 `--dart-define-from-file=build/community_public.json`(allowlist 생성) 사용, release 에서 비었거나 자리표시자면 빌드 실패. map/auth — 기존 Vite 이름 유지, 매핑표 문서화, 산출물 스캔.
- `env-and-secret-matrix.md` 에 운영자 표(어느 repo 의 Variables/Secrets 에 어떤 이름) — 값은 적지 않는다.
- 이번 작업은 실제 운영 값을 넣지 않는다(모름·승인 경계). 로컬은 로컬 스택 값, 릴리즈 검사는 자리표시자로 실패하는지 테스트.

## 10. 병렬 작업 분해

RUN 루트 `~/projects/worktree/ci-20260926/<repo>/<task>/`. 브랜치 `ci0926/<task>`. 모든 base 고정 SHA 기록(`parallel-work-manifest.json`).

| task | 담당(실제 모델) | repo·worktree | 소유 파일 | 선행 |
|---|---|---|---|---|
| T0 contracts | Opus | map `integration` | `contracts/community-ingest/**`, `docs/integration/**`, `migration-manifest.json`, `scripts/integration/**`, `server/ingest/canonical.ts`(참조 구현) | 계획 검토 |
| T0b store skeleton | Opus | PC `integration`, mobile `integration` | PC `services/community_store.py`, mobile `lib/community/community_store.dart`(스키마·열기·마이그레이션만), 계약 사본 | T0 |
| T1 central account | Opus | auth `account` | `supabase/migrations/202609260100_*`, `server/account.ts`, `supabase/functions/community-account/**`, `tests/account*.ts`, docs | T0 |
| T2 central ingest | Opus | map `ingest` | `supabase/migrations/202609260200_*`, `server/ingest/**`, `supabase/functions/community-ingest/**`, `supabase/config.toml`, `tests/integration/**` | T0, T1 스키마 |
| T3 PC gate+rebuild | Opus | PC `gate-rebuild` | `main.py`, `services/community_gate.py`, `services/community_rebuild.py`, `services/community_account_client.py`, `web/routers/community_onboarding_route.py`, `web/routers/community_route.py`, templates onboarding·base 배너, `start.py`, `core/database/database.py`(rebuild id 목록), `services/crawl_control.py`, `services/crawl_manager.py`, `core/utils/scheduler.py`, `services/db_backup.py`(훅), `settings/settings.py`, 테스트 | T0b |
| T4 PC data plane | **Muse** | PC `upload` | `services/community_capture.py`, `services/community_uploader.py`, `services/community_schedule.py`(스케줄러 등록 함수만 제공), `core/storage/reports_repo.py`(capture 호출 1곳), `web/routers/community_upload_route.py`, `web/templates/report_map.html` 패널, 테스트 | T0b |
| T5 mobile gate+rebuild | **Muse** | mobile `gate-rebuild` | `lib/main.dart`, `lib/providers/report_provider.dart`, `lib/community/gate/**`, `lib/screens/community_onboarding_screen.dart`, `lib/screens/community_rebuild_screen.dart`, `setup_screen.dart`/`permission_screen.dart`(순서만), `community_server_link_service.dart`, `server_contract.dart`, settings 카드, 테스트 | T0b |
| T6 mobile data plane | **Muse** | mobile `upload` | `lib/community/capture/**`, `lib/community/upload/**`, `lib/services/sync_engine.dart`(capture 호출·rebuild 모드), `standalone_auto_sync_service.dart`(capture 호출), `background_login_check.dart`→`background_tasks.dart` dispatcher(자정 작업 추가), `report_map_screen.dart` 패널, `ios/Runner/Info.plist`·`AppDelegate.swift`, 빌드 스크립트 dart-define, 테스트 | T0b |
| T7 auth site/docs | Opus | auth `account`(T1 과 같은 worktree, 순차) | `site/` 도움말·개인정보 문구, `docs/protocol.md` 부록 | T1 |
| T8 browser QA | **Muse** | 각 repo `qa-*`(고정 후보) | 증거만(`docs/integration/community-ingest/qa/`) | 통합 후보 |
| T9 build/env | Opus | PC·mobile·map·auth integration | 빌드 스크립트·workflow·스캔 | T3~T6 |

- 공유 파일 단일 writer: `lib/main.dart`(T5), `sync_engine.dart`(T6), `start.py`(T3), `reports_repo.py`(T4), `scheduler.py`(T3, T4 는 `register_community_jobs(scheduler)` 함수만 제공), `community_store.*`(T0b, 이후 변경은 Opus 경유), lockfile: PC `requirements.txt`(변경 필요 시 T3), mobile `pubspec.yaml/lock`(T6 — `timezone` 등 추가 안 함 목표), map/auth `package*.json`(Opus).
- 테스트 자원: 로컬 Supabase 통합 스택은 **Opus 단독 소유**(map `integration` staging, project_id `ci0926-int`, 포트 56320~56329), Muse 는 단위 테스트·fixture 서버만(포트 PC 18759/18769, Flutter 는 포트 불필요). 통합 테스트는 직렬.
- Muse 발주: `opencode run --dir <worktree> --model opencode-go/muse-spark-1.3-contributor "<작업서 경로 안내>" < /dev/null`, 작업서는 worktree 안 `.agent-runs/<task>/TASK.md`(gitignore 확인), 세션 ID·모델·cwd 기록, 결과는 커밋·테스트 로그로 회수.

병합 순서: auth(T1,T7) → map(T0,T2) → PC integration ← T3 ← T4 → mobile integration ← T5 ← T6 → 통합 테스트(로컬 스택 + PC fixture + Dart 업로드) → Sol 통합 후보 검토 → 목표 브랜치 merge commit → 1차 정리.

## 11. 테스트 계획(acceptance-matrix 로 확장)

- 계약 벡터: Python(`tests/test_community_contract_vectors.py`), Dart(`test/community/contract_vectors_test.dart`), TS(`tests/product/communityContract.test.ts`)가 **같은 JSON 파일**(각 repo 에 사본 + sha256 고정 검사)을 읽어 DTO·해시·eligibility·event_type·gate·schedule 결과 일치(I05).
- PC: capture 불변성(A01~A05, A07, A09), outbox 상태기계·재시도·partial(B01~B13, 가짜 HTTP 서버), 게이트 라우트 전수(F05, F08~F12, F15 — 라우트 표를 코드에서 뽑아 allowlist 외 전부 차단 검증), rebuild 상태기계·crash 주입(G01~G15), 자정 가상 시계(H06~H13, H17), 실제 로컬 스택 연동(I01, I04).
- mobile: 같은 범주의 Dart 단위 테스트(sqflite_common_ffi), 위젯 테스트(게이트 순서 F01~F03·F06·F18, 지도 패널 H01), Dart 업로드 → 로컬 스택(I02, 실행 가능한 범위: `dart test` 에서 HTTP).
- 중앙: account/ingest 단위(Node vitest) + 로컬 스택 통합(보안 행렬 C01~C13, D01~D06, 경쟁 C08: 두 연결로 동시 revoke·ingest 반복) + Deno 타입 검사(`deno check supabase/functions/*/index.ts`).
- 브라우저: PC 온보딩·초기화·지도 패널(라이트/다크·390/1440), auth 페이지 회귀, map 지도(비로그인) — Muse T8 + Playwright.
- 산출물: PC PyInstaller(linux 만 로컬 빌드 가능), Docker 이미지 로컬 빌드, Android APK(가능하면 debug), 비밀·자리표시자 스캔.

## 12. 신뢰 경계·한계(과장 금지)
- 출처 = 클라이언트 수집 데이터, 보안 = 인증·연결·동의 확인, 공식 서버 대조 = 미실시. 정상 세션+연결을 가진 사용자가 다른 프로그램으로 같은 요청을 만드는 것은 구분 불가(§1.3, §14 마지막 행).
- dataset_key 는 클라이언트 주장값(공식 계정 해시)이다 — writer 충돌 제어용일 뿐 계정 증명이 아니다.
- 서로 다른 커뮤니티 계정이 같은 공식 신고를 올리면 사용자별로 분리 저장(덮어쓰기 없음), 공개 집계에서 중복될 수 있다 → 운영 진단 쿼리 제공, 전역 unique 강제 안 함(§16.1).
- iOS 백그라운드·정확한 자정·종료된 앱 실행은 보장하지 않는다.

## 13. 승인 경계·미실행 예정
운영 Supabase migration/함수 배포/인증 설정, 카카오 실제 로그인, 안전신문고 실계정 수집, Pages/DNS, 스토어, push — 하지 않는다. 대신 로컬 실제 스택(GoTrue+Postgres+PostgREST+edge-runtime+모의 카카오)으로 수직 검증.

## 14. 완료 체크리스트
1. Sol 계획 검토(01) → resolution → plan-final → Sol 재확인(final) 치명·높음 0
2. T0~T9 구현·결과 회수(모델·세션·커밋)
3. 통합 테스트·브라우저·산출물 검사 → Sol 통합 후보 검토
4. 목표 브랜치 merge commit(4 repo), merged HEAD 재테스트, 1차 정리(manifest 기록 worktree·완전 병합 임시 브랜치만)
5. 감사 창 고정(`audit-window.md`) → Sol 7일 감사 → Opus(+Muse) 수정 → Sol 재검증
6. 최종 merge commit, 재테스트, 2차 정리, `verification-report.md`

## 15. Sol 에게 특히 반박을 요청하는 가정
1. community.db 를 개인 DB 와 분리해 "journal 먼저 commit → 개인 저장" 순서로 두는 것이 §11.1 원자성 요구를 충족하는가(개인 저장 실패 시 journal 만 남는 경우 = 공식 응답 기반이므로 허용 판단).
2. `internal_analytics_v2_facts` 교체 + invalidate 트리거 의미 변경이 기존 공개 정책·이중 집계 방지와 모순 없는가.
3. auth 가 map 의 `contributor_profiles` 를 RPC 로 갱신하는 교차 소유가 migration 합성·권한상 안전한가.
4. getUser(GoTrue 호출)를 ingest 마다 하는 비용·가용성 트레이드오프와 `auth.sessions` 트랜잭션 재확인.
5. writer 전환(takeover)과 rebind 설계가 §16.2·§5.3 재로그인 요구를 충족하는가.
6. 철회 후 재동의 시 과거 공개분을 다시 공개하는 정책(기존 contributor 단위 필터 보존) — 동의문 명시로 충분한가.
7. 초기화를 "기존 `--force` 전체 재수집 + checkpoint + community.db staging cutover" 로 구현하는 것이 §7.2~7.3(shadow→검증→cutover)에 부합하는가.
