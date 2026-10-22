# 운영 콘솔 DB API (2026-10-22)

운영 콘솔(비공개 레포 `safetyreport-ops-console`, 담당 F)은 **이 문서의 함수만** 부른다. 표를 직접 읽거나 쓰지 않는다.
정의: 지도 migration `supabase/migrations/202610220200_backfill_resume_ops.sql`. 준비(로그인 역할·첫 관리자): `docs/operations/ops-console-db.md`.

## 0. 공통 규칙

- 접속: DB 역할 `community_ops_login`(NOLOGIN 역할 `community_ops` 의 구성원). DSN 은 콘솔 컨테이너 `.env`(0600)에만.
  이 역할은 스키마 `ops` 의 함수 실행만 할 수 있다(`private`·`public` 표, `public.internal_*` RPC, 다른 함수 모두 권한 오류).
- 호출: `select ops.<함수>(...);` 한 문장 = 한 트랜잭션(자동 커밋). 결과는 모두 **jsonb 하나**. 서버 쪽 SQL 문자열 조립 금지 —
  드라이버의 매개변수 바인딩만 쓴다(예: psycopg `cur.execute("select ops.pause_uploads(%s, %s, %s)", (actor, msg, resume))`).
- 첫 인자 `p_actor uuid` 는 **콘솔이 카카오 로그인으로 확인한 사용자 ID**(Supabase `auth.users.id`, GoTrue `/auth/v1/user` 의 `id`).
  모든 함수가 `private.ops_admins` 에 있는지 다시 확인한다. 없으면(또는 null) 예외 `not_ops_admin`(SQLSTATE `42501`).
  예외: `ops.whoami` 는 예외 없이 `{admin:false}` 를 돌려준다(로그인 직후 403 판정용).
- 바꾸는 함수는 같은 트랜잭션에서 이력 표에 **누가**(관리자 ID + `ops:<메모>`)·**언제**·**무엇을**(action)·**이전 값 → 새 값** 을 남긴다.
  읽기 함수는 이력을 남기지 않는다(바뀐 것이 없으므로).
- 시각: DB 는 `timestamptz`(UTC 저장). 인자는 ISO 문자열이나 드라이버의 timezone-aware 값으로 넘긴다. 결과의 시각은 ISO 문자열
  (`2026-10-22T06:30:00+00:00`). **화면은 모두 KST 로 바꿔 보여 준다.**
- 오류는 PostgreSQL 예외다. 메시지(아래 표의 코드)와 SQLSTATE 로 가른다. 메시지를 화면에 그대로 내지 말고 뜻으로 바꾼다.

| 예외 메시지 | SQLSTATE | 뜻 |
|---|---|---|
| `not_ops_admin` | 42501 | 관리자가 아님(403 화면) |
| `invalid_message` | 22023 | 점검 문구가 1~300자가 아니거나 줄바꿈·제어문자 포함 |
| `invalid_resume_at` | 22023 | 재개 시각이 지금 이전이거나 7일 넘게 뒤 |
| `invalid_requirement` | 22023 | 필수 버전 형식 오류(둘 다 비었음, 버전 해석 불가, https 아닌 링크, 문구 300자 초과) |
| `invalid_version` | 22023 | 버전 문자열 해석 불가 |
| `invalid_announcement` | 22023 | 공지 문서가 스키마·허용 링크·평문 규칙에 맞지 않음 |
| `announcement_published` | 55000 | 이미 게시한 공지는 고치거나 지울 수 없음(새 id 로) |
| `announcement_not_published` | 55000 | 게시 전 공지는 종료할 수 없음(지우기를 쓴다) |
| `announcement_expired` | 22023 | 끝나는 시각이 지난 공지는 게시할 수 없음 |
| `announcement_not_found` | P0002 | 그 id 의 공지 없음 |
| `invalid_stale_hours` | 22023 | 기준 시간이 1~720 밖 |
| `invalid_cursor` | 22023 | 이력 다음 쪽 인자(`p_before_at`·`p_before_kind`·`p_before_id`)가 셋 다 있거나 셋 다 null 이 아님, 또는 kind 가 틀림 |
| `invalid_pseudo_id` / `not_found` / `ambiguous_pseudo_id` | 22023 / P0002 / 21000 | 상세 조회 가명 ID 오류 |

버전 문자열 규칙(모든 함수 공통): `[v]N[.N[.N[.N]]][+build]`, 각 N 1~6자리. 빠진 자리는 0. 그 밖(예 `2.5.1-beta`)은 해석 불가.
앞뒤 공백은 무시한다. `ops.set_client_requirement` 는 저장할 때 앞의 `v`·`V` 하나와 앞뒤 공백을 뗀다(`v3.6.2` → `3.6.2`, D9). 콘솔도 같은 정규화를 해서 보여 준다.
벡터: `contracts/community-ingest-v2/version-vectors.json`.

## 1. 로그인·첫 화면

### `ops.whoami(p_actor uuid) → {admin: bool, memo: text|null}`
로그인 직후 한 번. `admin:false` 면 403 화면(세션을 만들지 않는다).

### `ops.overview(p_actor uuid) → jsonb`
```json
{"uploads":{"paused":true,"switch_on":true,"message":"서버 점검","resume_at":"2026-10-22T06:30:00+00:00",
            "paused_at":"2026-10-22T05:00:00+00:00","paused_by":"운영자 메모"},
 "client_requirement":{"min_version":{"pc":"3.6.2","mobile":"2.5.1"},"url":{"pc":"https://…","mobile":null},"message":null,
                       "enforce_from":"2026-11-01T00:00:00+00:00"} | null,
 "client_requirement_in_force": false,
 "v2_enabled": true, "v1_sunset": null, "client_notice": {…} | null,
 "server_time":"2026-10-22T05:10:00+00:00",
 "live_announcements":[{"id":"2026-10-pc-sunset","title":"…","ends_at":null}],
 "rejections_last_hour":{"maintenance":12,"client_upgrade_required":3},
 "recent_changes":[ …ops.audit_list 와 같은 항목 10건… ]}
```
- `uploads.paused` = **지금 실제로 중지인가**(재개 시각이 지나면 스위치가 켜져 있어도 false). `switch_on` 은 스위치 값 그대로(이력용).
  화면은 `paused` 로 "정상 / 점검 중(재개 시각)"을 보이고, `switch_on && !paused` 면 "재개 시각이 지나 자동으로 재개됨"을 보일 수 있다.
- `client_requirement` 는 저장된 값(적용 시작 전 포함), `client_requirement_in_force` 는 지금 적용 중인지.
- `rejections_last_hour`: 최근 1시간 업로드 거절 수(503 점검 = `maintenance`, 426 필수 버전 = `client_upgrade_required`).

### `ops.audit_list(p_actor uuid, p_limit integer default 50, p_before_at timestamptz default null, p_before_kind text default null, p_before_id bigint default null) → jsonb[]`
인자 5개(`p_actor` 포함, 2026-10-22.2 에 바뀜 — 예전 3인자 `p_before` 는 없다). 한도 1~500.
- 정렬: `(changed_at desc, kind desc, audit_id desc)`. `kind` 는 `config`·`announcement` 이므로 같은 시각이면 `config` 가 먼저다.
- 첫 쪽: `p_before_at`·`p_before_kind`·`p_before_id` 모두 null.
- 다음 쪽(키셋): 이전 쪽 **마지막 항목**의 `changed_at`·`kind`·`audit_id` 를 그대로 넘긴다. 결과는 튜플 `(changed_at, kind, audit_id) < (p_before_at, p_before_kind, p_before_id)` 인 것만.
  같은 트랜잭션의 변경(같은 `changed_at`)이 쪽 경계에 걸려도 빠지거나 겹치지 않는다.
- `changed_at` 은 마이크로초까지 그대로 넘긴다(결과 문자열을 다시 timestamptz 로 넘기면 된다. 초 단위로 자르면 같은 초의 항목이 빠진다).
- 세 값 중 일부만 주면(`p_before_at` 만 등) 예외 `invalid_cursor`(22023). `p_before_kind` 는 `config`·`announcement` 만.
```json
[{"kind":"config","audit_id":17,"changed_at":"…","actor":"ops:운영자 메모","action":"pause_uploads","target":"community_ingest_config",
  "before":{…설정 행 전체…},"after":{…}},
 {"kind":"announcement","audit_id":4,"changed_at":"…","actor":"ops:운영자 메모","action":"announcement_publish","target":"2026-10-pc-sunset",
  "before":{…공지 행…},"after":{…}}]
```
- `action`: `pause_uploads`·`resume_uploads`·`set_client_requirement`·`clear_client_requirement`·`announcement_save`·`announcement_publish`·
  `announcement_end`·`announcement_delete`, 콘솔 밖 SQL 은 `sql_update`(설정)·`sql_insert`/`sql_update`/`sql_delete`(공지), actor `sql:<DB 역할>`
  (실제로 로그인한 DB 역할 = `session_user`. 예: `sql:supabase_admin`, `sql:postgres`. 트리거 함수 소유자가 아니다).
- 화면의 "이전 값 → 새 값"은 `before`·`after` 에서 바뀐 키만 골라 보인다. 설정 행 키: `v2_enabled, raw_policy_version, v1_sunset, client_notice,
  uploads_paused, pause_message, pause_resume_at, paused_at, paused_by, client_requirement`.

## 2. 업로드 점검 (2-9)

### `ops.pause_uploads(p_actor uuid, p_message text, p_resume_at timestamptz) → jsonb`
- `p_message`: null 또는 1~300자 평문(줄바꿈 불가). 앱과 지도 웹 배너에 서버 문구로 함께 보인다.
- `p_resume_at`: null(운영자가 재개할 때까지) 또는 **지금 이후 7일 이내**. "몇 분 동안"은 콘솔이 지금 + N분으로 바꿔 넘긴다.
  "언제까지"(KST 입력)는 UTC 로 바꿔 넘긴다.
- 이미 중지 중이면 문구·재개 시각을 새 값으로 바꾼다(연장·단축). 결과는 `overview` 의 설정 부분(`uploads`, `client_requirement`, …)과 같다.
- 콘솔은 확인 대화상자에서 "업로드 중지"를 직접 입력받은 뒤에만 부른다(DB 는 이 확인을 모른다).

### `ops.resume_uploads(p_actor uuid) → jsonb`
스위치를 내리고 문구·재개 시각을 지운다. 앱은 평소 status 확인 때 재개를 본다.

## 3. 필수 버전 (2-10)

### `ops.requirement_impact(p_actor uuid, p_min_pc text, p_min_mobile text) → jsonb` (저장 전 미리 보기)
대상: 철회하지 않은 동의가 있는 사람. 최근 30일 안에 확인된 앱 버전(앱 헤더·진행 보고·업로드 기록).
```json
{"population":118,
 "rows":[{"app":"mobile","platform":"android","version":"2.5.0","users":40,"below":true,"unparseable":false}, …],
 "below_users":{"pc":3,"mobile":52},
 "map_web_blocked_users":61}
```
- `rows`: 앱·플랫폼·버전별 사람 수와 요구보다 낮은지(`below` = 업로드 426, 새 앱이면 앱 잠금).
- `below_users`: 요구보다 낮은 버전이 확인된 사람 수(플랫폼별).
- `map_web_blocked_users`: 지도 웹이 막을 사람 수(최근 30일 안에 요구 이상 앱이 하나도 확인되지 않은 사람, **버전 모름 포함**).
- 콘솔은 이 숫자를 보여 주고 직접 입력 확인을 받은 뒤 저장한다. **출시되지 않은 버전(콘솔 `config/releases.json` 밖)은 콘솔이 거부한다**(DB 는 출시 목록을 모른다).

### `ops.set_client_requirement(p_actor uuid, p_min_pc text, p_min_mobile text, p_url_pc text, p_url_mobile text, p_message text, p_enforce_from timestamptz) → jsonb`
인자 7개(`p_actor` 포함). `ops.upload_overview` 는 `p_actor` 포함 6개다.
- 빈 문자열은 null 로 본다. 버전 둘 다 null 이면 `invalid_requirement`(해제는 아래 함수).
- `p_url_*`: null 또는 https 링크(앱의 업데이트 버튼·지도 웹 안내 링크). 권장: PC `https://github.com/Fentanest/safetyreport/releases/latest`,
  모바일 `https://play.google.com/store/apps/details?id=com.fentanest.mysafetyreport`.
- `p_message`: null 또는 1~300자 평문(줄바꿈 불가).
- `p_min_pc`·`p_min_mobile`: 앞뒤 공백과 앞의 `v`·`V` 를 떼고 저장한다(D9). 결과의 `client_requirement.min_version` 에 뗀 값이 보인다.
- `p_enforce_from`: null = 지금부터. 그 시각 전에는 서버·앱·지도 웹 모두 요구가 없는 것으로 동작한다.
- 저장 형식(`client_requirement`): `contracts/community-ingest-v2/client-requirement.schema.json`.
- **구버전 앱 안내(`client_notice`)는 콘솔이 따로 고치지 않아도 된다 (D8)**: 요구가 적용 중이면 서버가 앱에 주는 `client_notice` 를 요구에 맞춰 만든다
  (저장된 notice 가 없거나 요구보다 낮으면 `level:'required'`, 같은 min_version·url). 저장된 `client_notice` 값 자체는 바뀌지 않는다(`overview.client_notice` 는 저장값).
  자세한 규칙: CLIENT-RULES 6-4.

### `ops.clear_client_requirement(p_actor uuid) → jsonb`
요구를 지운다. 426·지도 웹 안내·새 앱 잠금이 다음 status 확인 때 풀린다.

## 4. 공지 (2-11)

공지 문서 = `contracts/app-announcements/announcement.schema.json`(콘솔 레포 `announcements/*.json` 파일과 같은 모양).
상태: `draft`(게시 전) → `scheduled`(게시했지만 시작 전) / `live` → `ended`(운영자 종료) 또는 `expired`(끝나는 시각 지남).

### `ops.announcement_save(p_actor uuid, p_doc jsonb) → jsonb`
- 키 9개 정확히(`id, title, body, primary_action, snooze_days, starts_at, ends_at, priority, audience`). 없으면 만들고, **게시 전이면** 고친다.
- DB 가 다시 검사하는 것: 제목 1~40자(제어문자 없음), 본문 1~600자(줄바꿈 LF 만), 링크 허용 목록(`contracts/app-announcements/vectors/links.json`),
  `app_action` 은 `open_mode_switch` 만, 대상(apps·modes·platforms·버전)의 값, `snooze_days` 0~365, `priority` -1000~1000, 끝 > 시작.
- **대상에 `min_version`·`max_version` 이 하나라도 있으면 `apps` 는 정확히 하나**(`["pc"]` 또는 `["mobile"]`). 두 앱은 버전 번호가 달라서 같은 숫자를 둘에 걸 수 없다(D10).
  어기면 `invalid_announcement`. 두 앱에 버전 조건을 걸려면 공지를 앱마다 따로 만든다.
- 링크 검사는 DB 정규식이 기준이다. 콘솔 사전 검사도 같은 벡터(`links.json`, 쿼리·조각·특수문자·한글 경로 경계 포함)로 시험한다.
- 결과: 저장된 행(`id, title, body, primary_action, snooze_days, starts_at, ends_at, priority, audience, published_at, ended_at, created_at, updated_at`).

### `ops.announcement_publish(p_actor uuid, p_id text) → jsonb`
게시. `starts_at` 이 null 이면 게시한 때부터 보인다. 끝나는 시각이 지났으면 `announcement_expired`.

### `ops.announcement_end(p_actor uuid, p_id text) → jsonb`
게시 중지(종료). 이미 종료된 공지는 그대로 돌려준다.

### `ops.announcement_delete(p_actor uuid, p_id text) → {deleted: id}`
게시 전(초안)만 지울 수 있다.

### `ops.announcement_list(p_actor uuid) → jsonb[]`
모든 공지(최근 만든 순) + `state`(`draft`·`scheduled`·`live`·`ended`·`expired`). 앱에 실제로 가는 것은 `live` 중 대상이 맞는 우선순위 상위 3개다.

## 5. 대시보드 (2-15)

### `ops.upload_overview(p_actor uuid, p_stale_hours integer default 24, p_min_raw_pc text default '3.6.0', p_min_raw_mobile text default '2.5.0', p_latest_pc text default null, p_latest_mobile text default null) → jsonb`
지시서의 `ops_upload_overview()` 가 이 함수다. 콘솔은 `p_latest_*` 에 `config/releases.json` 의 최신 출시 버전을 넘긴다.

```json
{"generated_at":"…","params":{"stale_hours":24,"min_raw_pc":"3.6.0","min_raw_mobile":"2.5.0","latest_pc":"3.6.2","latest_mobile":"2.5.1"},
 "summary":{"people":118,"categories":{"reconsent":40,"old_app":12,"not_tried":20,"stuck":9,"uploading":7,"done":30},
            "by_app":{"pc":{"people":20,"raw_count":9000,"fact_count":15000},"mobile":{…},"unknown":{…}},
            "raw_total":31000,"fact_total":140000},
 "rows":[{"pseudo_id":"3fa85f64","category":"stuck","sub_reason":"holds","detail":"5",
          "app":"mobile","platform":"android","version":"2.5.1","mode":"standalone",
          "last_seen_at":"…","raw_count":1200,"fact_count":1500,
          "progress":{"state":"holds","stored":1200,"total":1861,"holds":5,"reason":"parser_error"},
          "last_progress_at":"…","last_contract":"community-ingest-v2",
          "consent":{"policy_version":"2026-10-21.1","current":true,"via":"mobile_standalone"}}]}
```

사람 = 철회하지 않은 동의가 있는 카카오 계정. 위에서부터 **처음 맞는 하나**:

| category | 조건 | sub_reason |
|---|---|---|
| `reconsent` 재동의 전 | 활성 동의가 지금 정책이 아님(outdated) | `last_contract_v1`(마지막 업로드가 v1) / `policy_outdated` |
| `old_app` 구버전 앱 | 가장 최근에 확인된 앱 버전 < 원본 지원 버전(인자), 또는 마지막 업로드 v1 이고 원본 0건 | `version_below_raw` / `v1_only` |
| `not_tried` 시도 안 됨 | 원본 0건, 진행 보고 없음 | 설정 단계(2-7): `no_record`(기록 없음, 구버전 추정), `before_official_login`, `official_login_failed`(`detail` = 사유 코드), `before_connection`, `connection_registered`, Client 서버 문제 `client_server_unreachable`·`client_server_unconfigured`·`client_server_not_logged_in`·`client_account_mismatch`·`client_server_no_consent`, `client_server_ok` (뜻은 아래 표) |
| `stuck` 멈춤 | 보고 상태 `paused`·`holds`·`waiting_optimize`·`none`, 공식 로그인 수동 필요, 진행 중인데 기준 시간 넘게 보고 없음, 또는 원본은 있는데 보고가 한 번도 없고 연결이 기준 시간 넘게 조용함 | `official_login_required`, `optimize_wait`, `transient_errors`(`detail` = 보고의 reason), `holds`(`detail` = 보류 건수), `not_started`, `report_gap`, `no_progress_report`(이전 버전이라 보고 기능 없음) |
| `uploading` 업로드 중 | `listing`·`filling`·`uploading` 이고 기준 시간 안에 보고, 또는 보고는 없지만 원본이 있고 연결이 기준 시간 안에 활동 | `reporting` / `no_progress_report` |
| `done` 완료 | 보고 상태 `done` | `done_latest` / `done_old`(앱 < 최신 출시) / `done_version_unknown`(최신 출시 인자 없음·버전 모름) |

Client 모드 세부 사유(휴대폰이 보낸 설정 단계 `client_server_checked` 의 `client` 6키에서, 위에서부터 처음 맞는 것):

| sub_reason | 조건 | 뜻(콘솔 문구 기준) |
|---|---|---|
| `client_server_unreachable` | `server_reachable=false` | 휴대폰이 서버(PC)에 닿지 못함(주소·네트워크·PC 꺼짐) |
| `client_server_unconfigured` | `server_community_supported=false` | **서버(PC)의 커뮤니티 설정이 안 됨**: PC 가 커뮤니티를 끄거나 설정을 마치지 않음(503 `community_disabled`·`community_unconfigured`), 또는 PC 가 3.0 미만. 휴대폰의 서버 주소 미설정이 아니다(그 경우는 보고 자체가 없다) |
| `client_server_not_logged_in` | `server_logged_in=false` | PC 가 카카오 로그인 안 됨(온보딩 필요) |
| `client_account_mismatch` | `account_match=false` | 휴대폰과 PC 의 카카오 계정이 다름 |
| `client_server_no_consent` | `server_consent_active=false` | PC 의 공유 동의가 active 아님 |
| `client_server_ok` | 위에 해당 없음 | 서버 쪽 조건은 맞음(아직 업로드 전) |

- 화면 카드: `summary.categories`(분류별 사람 수), `summary.raw_total`·`fact_total`(원본 수 / 지도 행 수 전체), `summary.by_app`(PC·모바일 나눠 보기 —
  사람의 앱은 가장 최근에 확인된 앱).
- 표: `rows`(가명 ID = 사용자 ID 의 sha256 앞 8자리). 카카오 이름·공식 사이트 ID·신고 내용·기기 이름·dataset 은 **결과에 없다**.
  `progress` 는 보고가 없으면 null. `version`·`app` 은 모를 수 있다(null).
- 경계: 기준 시간 24시간이면 23시간 전 보고 = `uploading`, 25시간 전 = `stuck/report_gap`. 버전은 같으면 "이상"(2.5.0 = 원본 지원).
- 성능: 원본·사실 표를 함수 안에서 한 번씩만 묶어 센다(인덱스: `community_raw_contributor_key`, 사실 PK 의 `contributor_id` 앞자리,
  `community_connections_user`, `community_client_seen` PK, `community_setup_progress` PK). 자동 새로 고침은 하지 않는다(수동).

### `ops.user_detail(p_actor uuid, p_pseudo_id text) → jsonb`
표의 행을 눌렀을 때. `p_pseudo_id` = 8자리 소문자 16진.
```json
{"pseudo_id":"3fa85f64",
 "consents":[{"policy_version":"2026-10-21.1","via":"mobile_standalone","granted_at":"…","revoked_at":null,"revoke_reason":null}],
 "connections":[{"source_app":"safetyreport-mobile","source_mode":"standalone","platform":"android","status":"active","created_at":"…",
                 "last_contract":"community-ingest-v2","last_client_version":"2.5.1","last_parser_version":"mobile-parser-13",
                 "last_seen_at":"…","last_progress_at":"…","last_progress":{…progress.schema.json 의 본문…}}],
 "progress_history":[{"received_at":"…","progress":{…}}],
 "setup_progress":{"client_version":"2.5.1","source_app":"…","platform":"…","mode":"…","stage":"…","reason":null,"client":null,"updated_at":"…"} | null,
 "apps_seen":[{"app":"mobile","platform":"android","version":"2.5.1","first_seen_at":"…","last_seen_at":"…"}],
 "raw_count":1200,"fact_count":1500}
```
진행 기록은 최근 100건(보관은 30일·연결당 200건). 연결 ID·기기 이름·dataset·사용자 ID 는 없다.

## 6. 콘솔 시험에서 쓰는 것
- 권한: `community_ops` 역할로 `update private.community_ingest_config …`, `select * from private.app_announcements`,
  `select public.internal_community_ingest_capabilities()` 는 모두 `permission denied`(지도 `tests/integration/backfill-resume-stack.test.ts` 가 확인).
- 비관리자 ID 로 아무 함수(`whoami` 제외) → `not_ops_admin`.
- 로컬 DB: 지도 레포 `scripts/integration/compose_supabase.mjs`(지도·auth migration 전부)로 로컬 Supabase 를 띄우고, 시험용으로만
  `alter role community_ops_login login password …` 를 준다. 운영 DB 에 붙지 않는다.
