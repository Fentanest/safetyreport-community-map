# FIX-S 보고서 · 서버(지도·auth) 출시 전 검수 수정 (2026-10-22.2)

작업 폴더: 지도 `backfill-resume-ws/map`(feat/backfill-resume, 기준 88c9834), auth `backfill-resume-ws/auth`(기준 ba4fdf9). **커밋·push 하지 않았다.**
원격 서버(206 포함) 접속 없음. 모든 확인은 로컬(합성 자료)이며 운영 결과가 아니다.
근거: 검수 BUGS.md "검수자 결정 D1~D11"·"S 서버", R3-REPORT(서버), R4-REPORT(C4), R5-REPORT.
두 migration(`auth 202610220100`, `지도 202610220200`)은 아직 어디에도 적용 전이라 **새 파일을 만들지 않고 기존 파일을 고쳤다**
(manifest `docs/integration/community-ingest/migration-manifest.json` 의 sha256 두 줄도 갱신).

## 0. 가장 먼저 고친 문서 (다른 담당이 참고)

### CLIENT-RULES.md (규칙 문장의 유일한 작성자로서)
머리에 "개정 2026-10-22.2" 문단과 바뀐 절 목록을 넣었다. 문장 끝 `(Dn)` 이 결정 번호다.

| 절 | 바뀐 내용 |
|---|---|
| 1절 표 | `result` 없음 행에 "JSON 아닌 응답"(일시적) 추가 |
| 1절 새 소절 "일시적 오류의 신고별 상한 (D1)" | 항목 필드 `transient_attempts`. 세는 것(network·timeout·server_5xx·rate_limited·no_result)·세지 않는 것(sync_busy·db_locked·maintenance·공식 로그인). 1~4번째는 run paused, **5번째는 그 신고만 hold(hold_count 규칙 그대로)·커서 다음·run 은 쉬지 않음**. 신고 횟수는 성공·보류 때 0, run `transient_failures` 는 다른 신고가 성공하면 0. 시험 문장 |
| 1절 "고정적 오류" (D2) | 보류에서 풀려 다시 실패하면 `hold_count` 이어서. 채우기 성공으로 `hold_count`·`first_held_at` 을 지우지 않고 `stored` 때만 지움. 업로드 확인 retry 보류도 같은 카운트. 예외는 '다시 시도' 버튼·2절 첫 실행 풀기. 업로드 확인 표의 retry 행에도 표시 |
| 1절 "보류만 남은 run" | (R1-3) 보류+queued 만 남으면 다음 깨움 = `min(가장 이른 보류 - now, 600초)` 이상(하한 15초), 15초 간격은 포그라운드 타이머에서만 |
| 4-1 (D5) | "마지막으로 **보낸** 상태 키"와 비교. 억제된 tick 은 키·날짜를 갱신하지 않음(요청을 실제로 보냈을 때만, 실패여도). 시험 문장 |
| 4-2 (D6) | 응답별 기록 표: 200 보냄 / **400·404 보냄 + 같은 내용 24시간 재전송 없음** / 그 밖 4xx 보냄 / 429·5xx·네트워크·시간 초과만 다음 변화 때 재시도 |
| 5절 머리 | 예외(거절 카운터는 응답 뒤 기다리지 않고 기록), **점검 스위치는 서버가 설정을 읽을 수 있을 때만**(읽기 실패면 v2 만 503, v1·manifest·progress 는 받음) |
| 5절 503 예시 (D7) | `Retry-After`·`retry_after_seconds` **최대 1800**, `resume_at` 은 그대로, 새 앱은 `resume_at` 사용 |
| 5절 저장 | (R1-10) 503 의 `pause_message` 가 null·없으면 저장 문구 유지(status 가 정본) |
| 5절 중지 동안 (D4) | 재개 시각(+지터)이 지났는데 해제 미확인이면 **status 한 번**, 실패·키 없음·과거/없는 resume_at 이면 **다음 시도 ≥ 지금+60초**(지연 0 반복 금지). **일찍 재개**: status `paused=false` 면 `maintenance` 로 미룬 `retry_wait` 행 다음 시도를 즉시로, run `maintenance` 도 풀고 깨움 |
| 6-1 (D9) | 서버가 저장 때 `v`·`V` 를 뗌, 앱은 `v` 붙은 값도 계약대로 비교, auth status·진행 보고·설정 단계 보고·헤더는 소문자 `v` 하나 허용 |
| 6-2 (D3) | **읽을 때마다** 저장 `min_version` 과 지금 버전 재비교(`cmp >= 0` 이면 잠금 아님·저장값 삭제, `null` 이면 유지). 새로 잠그는 것만 서버 정상 응답에서. **잠금 중에도 카카오 로그인·재로그인**(PC 는 `/settings/` 의 로그인·재로그인·로그아웃 열어 둠), 로그인 뒤 status 한 번. 시험 문장 |
| 6-3 | 헤더 형식 `^v?[0-9][0-9A-Za-z.+_-]{0,39}$`. (D11) 지도 웹 업데이트 화면은 앱 기록(연결 또는 client_seen, 기간 무관)이 있는 사람만, 없으면 원래 온보딩 |
| 새 6-4 (D8) | 서버가 `client_notice` 를 요구에 맞춰 냄(규칙·기본 문구). 새 앱은 지금처럼 처리 |
| 7절 | (R1-5) 모드·서버 주소·휴대폰 카카오 계정이 바뀌면 계정 불일치 잠금을 메모리·저장값 모두 지움, 온보딩 차단은 "지금 Client 이고 잠금"일 때만 |
| 8절 | `optimize_blocked_background` 는 **모바일만**(PC 는 만들지 않음, R5-의심3). 알림 코드는 표의 4개(진행 보고 reason 과 별개). (R1-6) 백그라운드에서도 알림(채널 등록 또는 사유 저장 후 네이티브/다음 포그라운드), 하루 1번 기록은 실제로 띄웠을 때 |
| 9절 | 잠금으로 바뀌면 떠 있는 공지 팝업 닫기, 공지 id **전체 일치**(R2-S5), (D10) 버전 조건이면 apps 하나, 링크 벡터 경계 경우 안내 |
| 10절 | 점검 503(1800 상한) 예시 추가 |

### OPS-DB-API.md (C 담당이 쓴다)
- **`ops.audit_list(p_actor uuid, p_limit integer default 50, p_before_at timestamptz default null, p_before_kind text default null, p_before_id bigint default null)`**.
  정렬 `(changed_at desc, kind desc, audit_id desc)`, 다음 쪽은 이전 쪽 마지막 항목의 `changed_at`·`kind`·`audit_id` 를 그대로(마이크로초 포함) 넘기고 그 튜플보다 작은 것.
  반환 항목은 그대로 `kind`·`audit_id`·`changed_at`·`actor`·`action`·`target`·`before`·`after`. 세 인자 일부만 주거나 kind 가 틀리면 새 예외 `invalid_cursor`(22023, 오류 표에 추가).
- 직접 SQL 이력 actor = 접속 역할(`session_user`).
- 공통 버전 규칙: 앞뒤 공백 무시, `set_client_requirement` 가 `v`·`V` 를 떼고 저장(D9). `set_client_requirement` 절에 D8(콘솔이 `client_notice` 를 따로 고칠 필요 없음, 저장값은 그대로).
- 공지 절: 버전 조건이면 `apps` 정확히 하나(D10), 링크 검사 기준은 DB 정규식·같은 벡터.
- 대시보드: Client 세부 사유 표 추가 — `client_server_unconfigured` = **서버(PC)의 커뮤니티 설정이 안 됨**(커뮤니티 끔·미설정 503 또는 PC 3.0 미만). 휴대폰의 서버 주소 미설정이 아니다(R5-의심4).

## 1. 버그별 수정

(아래 "시험" 은 모두 이번에 새로 넣은 회귀 시험이다. U = 지도 `tests/product/backfillResume.test.tsx`, I = 지도 `tests/integration/backfill-resume-stack.test.ts`(로컬 스택), A = auth `tests/backfill-resume.unit.test.ts`.)

### D7 · 503 maintenance 의 Retry-After 최대 1800초 (R2-C1)
- 고친 곳: `server/ingest/handler.ts` `MAINTENANCE_RETRY_AFTER_MAX = 1800`, `maintenanceRetryAfter` 상한 7일 → 1800. 본문 `resume_at` 은 그대로.
- 시험: U "D7: resume time 3 hours away → Retry-After 1800 …", 기존 경로별 503 시험(90분 뒤 → 1800)·상한 단언 갱신. I Edge 실제 함수: 3시간 뒤 재개 → 헤더 `1800`, `retry_after_seconds` 1800, `resume_at` 정확.
- 계약: `contracts/community-ingest-v2/errors.md`·`README.md`.

### D8 · 필수 버전 적용 중이면 서버가 `client_notice` 를 맞춤 (R3-M1, R5-3)
- 고친 곳: 지도 migration 새 함수 `private.community_effective_notice(n, r)`, `public.internal_community_ingest_capabilities()` 의 `client_notice` 가 이 값.
  auth status 와 v2 ACK 는 모두 capabilities 를 그대로 싣으므로 auth 코드 변경 없이 둘 다 적용된다. 저장된 `community_ingest_config.client_notice` 는 바꾸지 않는다.
- 규칙: 요구가 적용 중이고, 저장 notice 가 없거나 요구가 있는 플랫폼의 notice min 이 낮음·null·해석 불가면 `{level:'required', message: 요구 message 또는
  "이 버전은 더 이상 신고를 공유할 수 없습니다. 최신 버전으로 업데이트해 주세요.", min_version: 요구(저장값이 더 높으면 저장값, 요구 없는 플랫폼은 저장값), url: 요구 → 저장 → 기본 링크, deadline: null}`.
- 직접 SQL 로 넣은 `v3.6.2` 요구도 notice 에는 `3.6.2` 로 나간다(구버전 앱 파서가 `v` 를 모를 수 있어서).
- 판단: 지도 웹 `internal_map_client_state.notice` 는 저장값 그대로 둔다(지도 웹은 앱 버전을 몰라 최신 사용자에게도 "required" 를 보이게 되므로. 지도 웹은 `update_gate` 로 따로 안내).
- 시험: I "D8 …"(요구 없음 → 저장값, 적용 중 → required·버전·링크, 저장값 불변, notice 없음 → 요구 message·기본 링크, 저장값이 이미 높으면 그대로, 높은 값은 낮추지 않음, 요구 없는 플랫폼은 저장값, 직접 SQL `v3.6.4` → notice `3.6.4`, `enforce_from` 전 → 저장값). A "D8: … reaches the old apps unchanged". 실제 HTTP(§3).

### D9 · 버전 앞 `v` (R3-L4, R5-2)
- 고친 곳: 지도 migration `private.community_version_normalize`(앞뒤 공백과 `^[vV]` 하나 제거), `ops.set_client_requirement`·`ops.requirement_impact` 가 사용.
  지도 `server/ingest/progress.ts` `VERSION_TEXT = /^v?[0-9]…/`, 계약 `progress.schema.json` 의 `client_version` 패턴 같게. auth `server/account.ts` `VERSION_TEXT` 같게
  (헤더·setup-progress·`parseRequirement` 모두). 대문자 `V` 는 계약(version-vectors `V2.5.1` → null) 밖이라 읽는 쪽은 받지 않고, 저장할 때만 뗀다.
- 시험: I "D9 …"(`' v3.6.2 '`·`'V2.5.1'` → `3.6.2`·`2.5.1` 저장, impact 도 받음, `vv3.6.2` 거부). U "D9 … leading v passes, upper-case V does not".
  A "D9: a requirement written with a leading v is still read …"(고치기 전에는 status 에서 `client_requirement` 키가 빠짐), "version header and setup-progress … leading v".
  계약 벡터 `vectors/progress.json` 에 2건 추가(끝에 붙임: `v3.6.2` ok, `V3.6.2` schema_invalid).

### D10 · 버전 조건 공지는 앱 하나 (R3-L7)
- 고친 곳: 지도 migration `private.app_announcement_audience_valid` — `min_version`·`max_version` 중 하나라도 문자열이면 `apps` 길이 1. 계약 `announcement.schema.json` audience 에 `if/then`(apps maxItems 1)과 설명, `README.md`.
  예시 두 개는 이미 앱 하나라 그대로 맞다.
- 시험: I "D10 …"(두 앱 + max/min → `invalid_announcement`, 두 앱 조건 없음·한 앱 + 조건은 통과).

### D11 · 지도 웹 업데이트 화면은 앱 기록이 있는 사람만 (R3-L6)
- 고친 곳: 지도 migration `internal_map_client_state.update_gate.blocked` = (연결 또는 client_seen 이 하나라도 있음, 기간 무관) **그리고** 요구 미충족. 지도 웹 코드는 `blocked` 를 따르므로 변경 없음.
- 판단: "기록"은 기간 무관으로 했다(오래전에 앱을 쓴 사람은 앱이 있는 사람이므로 업데이트 안내가 맞다). 30일 판정(요구 이상인가)은 그대로.
- 시험: I 2-10 시험 갱신 — 기록 없는 사람 `blocked:false`, 버전 모름(`dev-build`) 기록 `true`, 버전 없는 업로드 연결만 있는 사람 `true`.

### R3-M3 · 거절 카운터를 기다리지 않음 + "점검 스위치는 설정을 읽을 수 있을 때만" 문서화
- 고친 곳: `server/ingest/handler.ts` `noteRejection` 을 `void` 로 부르고(동기 throw·reject 모두 삼킴), `supabase/functions/community-ingest/index.ts` 는 `EdgeRuntime.waitUntil` 로 워커가 upsert 를 끝내게 했다.
  설정 읽기 실패 때 v1·manifest·progress 계속은 유지(설계 결정). 문서: CLIENT-RULES 5절, 계약 README, `docs/deployment.md`(Edge 로그 `capabilities_unavailable_v1_continue` 확인 안내), migration 주석.
- 시험: U "R3-M3: … hanging or throwing counter never delays the 503/426"(끝나지 않는 카운터에도 1초 안에 503, 동기 throw 에도 426). I Edge 실제 함수: 응답 뒤 카운터가 +1 로 들어옴(최대 3초 폴링).

### R3-M2 · connections 열 추가 잠금
- 고친 곳: 지도 migration 의 `alter table private.community_connections …` 앞뒤만 `set local lock_timeout = '10s'` → 다시 `'3s'`. 배포 문서 1단계에 "업로드가 한산한 시간, 실패하면 전부 롤백되니 그대로 재실행".
- 시험(로컬 재현, §3): 다른 세션이 그 표를 13초 잡고 있으면 10.1초 뒤 `lock timeout` 으로 실패·`ops` 스키마 없음(전부 롤백), 6초 잡고 있으면 기다렸다가 성공(예전 3초면 실패하던 경우).

### R3-L1 · 직접 SQL 이력 actor = 접속 역할
- 고친 곳: `private.community_ops_label()` 의 `current_user` → `session_user`(트리거 함수가 security definer 라 `current_user` 는 늘 소유자였다).
- 시험: I "R3-L1 …"(`supabase_admin` 으로 바꾸면 `sql:supabase_admin`, `postgres` 면 `sql:postgres`).

### R3-L5 · setup-progress 가 세션 철회 확인 (auth)
- 고친 곳: auth migration `internal_account_setup_progress` 가 `user_ok and kakao and session` 을 함께 본다.
- 판단: 새 오류 코드 `session_revoked` 를 만들지 않고 `kakao_required` 를 돌려준다. consent·connections 등 다른 account RPC 가 세션 없음에 이미 `kakao_required` 를 쓰고,
  auth 오류 표(`contracts/community-client` central codes)에 `session_revoked` 가 없어 새 코드를 넣으면 앱 계약이 바뀐다.
- 시험: I "R3-L5 …"(세션 삭제 뒤 `{error:'kakao_required'}`, 행 없음).

### R4-C4 · `ops.audit_list` 키셋 넘김
- 고친 곳: 지도 migration `ops.audit_list(p_actor, p_limit, p_before_at, p_before_kind, p_before_id)`. 정렬은 실제 열 기준 `(changed_at desc, kind desc, audit_id desc)`
  (예전에는 jsonb 문자열 정렬이었다), 다음 쪽 조건은 행 비교 `(changed_at, kind, audit_id) < (…)`. 커서가 반쯤이면 `invalid_cursor`. `ops.overview` 의 호출과 권한 목록(`grant … to community_ops`) 시그니처도 바꿨다.
- 시험: I "R4-C4 …": **한 트랜잭션**에서 설정 62번 + 공지 3번 바꾼 뒤 50개씩 끝까지 넘김 → SQL 기준 정렬 목록과 **완전히 같음**(빠짐·겹침 0, R4 재현은 25행 빠졌었다),
  같은 시각 묶음은 config 62개 뒤 announcement 3개, `invalid_cursor` 두 경우, overview 의 `recent_changes`.

### R5-5 · 링크 경계 벡터
- 고친 곳: `contracts/app-announcements/vectors/links.json` 19건 → **52건**. 추가: `github.com/Fentanest/`(허용)·`Fentanest`(슬래시 없음)·쿼리+조각 허용 경우, `'`·`(`·`;`·`,`·`|`·`*`·`!`·`@`,
  `worklazy.net?x=1`·`#a`(슬래시 없이 쿼리·조각은 거부)·호스트만(허용), `%ED%95%9C%EA%B8%80`(허용)·`/한글`(거부), 대문자 호스트·`.NET`, `-a.`·`a-.`·`a..`·`.worklazy`, 다단계 하위 도메인,
  Play `#x`·`'`·`%20`·끝 `&`·`id` 앞 다른 쿼리, NBSP·탭, 500자(허용)·501자(거부). 기대값은 지도 SQL/Edge 정규식 기준(둘 다 52/52 같음).
- 시험: U 링크 벡터 루프(Edge `announcementUrlAllowed`), I 링크 벡터 루프(SQL `app_announcement_url_allowed`). MANIFEST 갱신.

### R5-의심4 · `client_server_unconfigured` 뜻
- OPS-DB-API 5절에 Client 세부 사유 표를 넣었다(콘솔 문구 고치기는 C 담당).

## 2. 바꾼 계약 파일 (PC·모바일·콘솔 사본 담당이 맞출 것)
| 파일 | 변경 | MANIFEST |
|---|---|---|
| `contracts/community-ingest-v2/progress.schema.json` | `client_version` 패턴 `^v?[0-9]…` | `contracts/community-ingest-v2/MANIFEST.sha256`(generate_contract.py 로 재생성, check_contract.py PASS) |
| `contracts/community-ingest-v2/vectors/progress.json` | 끝에 2건(`v3.6.2` ok, `V3.6.2` schema_invalid). 앞 12건 순서 그대로 | 같음 |
| `contracts/community-ingest-v2/account-api.md` | 헤더 형식 `v` 허용, 요구 버전 `v`, D8 `client_notice` | 같음 |
| `contracts/community-ingest-v2/errors.md` | maintenance Retry-After 최대 1800 | 같음 |
| `contracts/community-ingest-v2/README.md` | 1800 상한, 카운터 예외·설정 읽기 실패 한계 | 같음 |
| `contracts/app-announcements/announcement.schema.json` | audience `if/then`(버전 조건이면 apps 하나), 설명 | `contracts/app-announcements/MANIFEST.sha256`(check_contract_manifests.py PASS) |
| `contracts/app-announcements/vectors/links.json` | 33건 추가(52건), rule 문장 | 같음 |
| `contracts/app-announcements/README.md` | D10, 경계 벡터 안내 | 같음 |
`version-vectors.json`·`client-requirement.schema.json`·`client-notice.schema.json`·`response.schema.json`·예시는 바꾸지 않았다(이미 `v` 접두 사례가 있다).
문서 사본: 지도 `docs/account-api.md`(계약 account-api.md 와 바이트 같음), auth `docs/account-api.md`(같은 절).

## 3. 실행한 검사
모두 로컬. 로그는 scratchpad `fixs/`(키 줄은 출력·기록하지 않음).

| 검사 | 결과 |
|---|---|
| 지도 `npx vitest run`(스택 없이) | **88 파일 통과 / 37 건너뜀, 1367 통과 / 232 건너뜀, 실패 0**. 첫 실행에서 `authBoundary` 5초 시간 초과 1건(부하, 단독 재실행 통과)과 `migrationEditorSafe`(내가 넣은 주석의 `'`)가 실패 → 주석을 고친 뒤 전체 재실행 0 실패 |
| 지도 `tsc -b` + live 빌드(`VITE_DATA_MODE=live npm run build`, 로컬 주소·가짜 공개 키) | 통과 |
| 지도 `npm run scan` | `passed: true`, issues 0 |
| 계약 검사 | `scripts/raw-ingest/check_contract.py` PASS(15 파일, 생성기 재현, `PARSER_REPO` 로 재생성), `scripts/check_contract_manifests.py` PASS(2), `compose_supabase.mjs check` PASS(76 migration) |
| 지도 SQL 시험 `npm run test:sql` | PASS(PGlite 3종) |
| auth `npm test` | 115 중 **114 통과, 1 실패 = 기존 privacy.html 정책 버전(L8, 이번 diff 무관)**. `tsc --noEmit` 통과. `npm run test:sql` OK. 새 회귀 3건 포함(`tests/backfill-resume.unit.test.ts` 26/26) |
| **로컬 Supabase 운영 순서 적용**(프로젝트 `fixs-1022`, API 59321·DB 59322·shadow 59320·inspector 59383, 모의 카카오 59410) | 기존 지도+auth 74개를 `supabase start` 로 → 지도 202610220200 을 먼저 넣으면 `community_client_seen does not exist` 로 실패·`ops` 없음(롤백) → **auth 202610220100 적용** → 다른 세션이 connections 를 13초 잡은 채 **지도 202610220200**: 10.1초 뒤 `lock timeout`, `ops` 없음(전부 롤백) → 6초 잡은 채 다시: 5.1초 기다린 뒤 성공 → capabilities `paused:false`·`client_requirement:null`·cron 1개. 최종 파일로 스택을 새로 만들어 이 순서를 다시 했다(`fixs/apply-order.log`) |
| `tests/integration/backfill-resume-stack.test.ts` | **16/16 통과**(기존 10 + fix-S 6) |
| `tests/integration/raw-ingest-stack.test.ts`(`PARSER_REPO=backfill-resume-ws/parser`, psycopg 3 python) | **12/12 통과** |
| auth status 실제 HTTP(모의 카카오 세션, `fixs/status-check.mjs`) | 요구 없음 → 저장 notice(warning 3.6.0/2.5.0). 직접 SQL 로 `v3.6.2`/`2.5.1` 적용 → status 에 `client_requirement` 키가 **남고**(`v3.6.2`), `client_notice` = `required`·`3.6.2`/`2.5.1`·두 링크. 헤더 `X-Client-Version: v2.5.1` 기록됨. 해제 → 둘 다 null |

끝난 뒤 스택(`supabase stop --no-backup`)과 모의 카카오를 내렸다. 59xxx 포트·컨테이너 남은 것 없음.

## 4. 배포 문서 갱신 (`docs/deployment.md` 2026-10-22 절)
- 1단계: 반대 순서는 실패·롤백, **업로드가 한산한 시간에, connections 잠금은 최대 10초, 실패하면 전부 롤백되니 그대로 재실행**.
- 2단계 community-ingest: Retry-After 1800 상한, 카운터는 응답 뒤, **점검 스위치는 설정을 읽을 수 있을 때만**(로그 `capabilities_unavailable_v1_continue` 확인).
- 6단계: 콘솔은 `ops.audit_list` 5인자 버전과 함께 배포. `client_notice` 수동 갱신 단계를 뺐다.
- 새 7단계: 필수 버전 거는 순서(100% 출시 확인 → impact → `enforce_from` 며칠 뒤 → 426·차단 수 확인), `client_notice` 는 서버가 맞춤, `v` 는 저장 때 뗌.
- 한계: 앱 기록 없는 첫 방문자는 온보딩.
- 그 밖: `docs/operations/ops-console-db.md`(actor = 접속 역할, 키셋), 지도·auth `CHANGELOG.md`, `A-REPORT.md` 머리에 바뀐 결정 안내.

## 5. 남은 것·주의
- PC·모바일·콘솔 사본: 위 2절 파일을 각 담당이 복사하고 사본 MANIFEST 를 맞춘다(지도 `scripts/raw-ingest/check_contract.py --copies …`).
- 콘솔(C)은 `ops.audit_list` 5인자로 바꾸기 전까지 이 migration 과 함께 배포하면 안 된다(옛 3인자 호출은 함수 없음).
- D8 로 `client_notice` 가 `required` 가 되면 구버전 모바일은 하루 1번 대화상자를 띄운다(요구 플랫폼이 아닌 쪽 앱도 그 앱 버전이 저장 notice min 보다 낮으면 같은 수준으로 보인다).
- R3 의 L2(대시보드 앱·버전이 최근 sighting 을 따라감)·L3(한쪽 앱만 요구)·S1~S3 는 이번 범위(BUGS.md S 목록) 밖이라 그대로 두었다.
- `tests/integration/raw-ingest-stack.test.ts` 가 `STACK_WORKDIR` 를 따르게 했다(예전에는 `.integration-stack` 고정).
