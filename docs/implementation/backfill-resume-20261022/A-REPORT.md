# A(서버) 보고서 · 2026-10-22 1회 전송 재개·점검 스위치·필수 버전·공지·운영 콘솔 DB

작업 폴더: `backfill-resume-ws/map`(feat/backfill-resume, 기준 478b7aa), `backfill-resume-ws/auth`(feat/backfill-resume, 기준 5c6c2be). 커밋하지 않았다.
다른 담당이 보는 문서: [CLIENT-RULES.md](CLIENT-RULES.md)(B·C·D·E), [OPS-DB-API.md](OPS-DB-API.md)(F).

## 1. 바꾼 파일

### 지도(map)
| 파일 | 내용 |
|---|---|
| `supabase/migrations/202610220200_backfill_resume_ops.sql`(새) | 버전 비교 함수, 설정 열(`uploads_paused`·`pause_message`·`pause_resume_at`·`paused_at`·`paused_by`·`client_requirement`)과 형식 검사, 변경 이력 표·트리거, `internal_community_ingest_capabilities` 확장(읽는 쪽 자동 재개·적용 중 요구만), 거절 수 표·RPC, 연결 `last_progress`·`last_progress_at`, `community_progress_history`(30일·연결당 200), `internal_community_progress`, `internal_map_client_state` 확장(`upload_pause`·`update_gate`), `app_announcements`·이력·`internal_app_announcements`, 매일 정리 cron, `ops_admins`, 역할 `community_ops`·`community_ops_login`, 스키마 `ops` 함수 15개(OPS-DB-API) |
| `server/ingest/handler.ts`, `progress.ts`(새), `version.ts`(새) | 인증 직후 공유 설정 읽기 → 중지면 v1·v2·manifest·progress 503 `maintenance`(+`resume_at`·`pause_message`·Retry-After 남은 초/600), 필수 버전 미만 v1·v2 426(+`required_version`·`update_url`), 새 경로 `/progress`(4KiB, gzip 거부, 스키마 검사) |
| `supabase/functions/community-ingest/index.ts` | 거절 수 기록 연결, 주석 |
| `server/announcements/handler.ts`(새), `supabase/functions/app-announcements/index.ts`(새), `supabase/config.toml` | 공개 공지 Edge(`verify_jwt=false`, 쿼리 4개, 최대 3, 링크·평문 재검사, 인스턴스 캐시 60초, `Cache-Control: public, max-age=300`) |
| `server/clientStatus.ts` | client-status 에 `upload_pause`·`update_gate`(형식 틀리면 503) |
| `src/components/UploadPauseBanner.tsx`(새), `UpdateRequired.tsx`(새), `src/App.tsx`, `src/pages/Dashboard.tsx`, `src/components/AccessGate.tsx`, `src/data/personal.ts`, `src/data/demoClientStatus.ts`, `src/styles/app.css` | 지도 웹 점검 배너(대시보드·업로드 필요 안내), 필수 버전 안내 화면(서버가 `blocked:true` 라고 할 때만), 데모 미리 보기 4종 |
| `src/components/DataGuide.tsx` | `ISSUES_URL` → `https://github.com/Fentanest/safetyreport-mobile/issues` |
| `.github/ISSUE_TEMPLATE/config.yml`(새), `delete-shared-reports.md`·`question.md`(삭제) | 빈 이슈 막고 모바일 레포 안내(양식은 모바일 레포에 이미 있음) |
| `contracts/community-ingest-v2/`: `progress.schema.json`·`client-requirement.schema.json`·`version-vectors.json`·`vectors/progress.json`(새), `README.md`·`errors.md`·`account-api.md`·`MANIFEST.sha256` | 계약. `account-api.md` 는 `docs/account-api.md`·auth `docs/account-api.md` 와 같은 바이트 |
| `contracts/app-announcements/`(새) | README, `announcement.schema.json`, `response.schema.json`, 예시 3, `vectors/links.json`, MANIFEST |
| `contracts/parser/`(새) | 파서 계약 정본: `parsed_columns.json`, `derived-v1.json`, `parser-vectors.json`, README, MANIFEST |
| `server/parser-py/`(30파일 삭제, README 만 새로) · `scripts/raw-ingest/vendor_parser.py`(삭제) | 파서 분리 |
| `scripts/raw-ingest/generate_contract.py`, `build_migration.py` | `PARSER_REPO` 있으면 파서로 비교 DTO 재계산, 없으면 커밋된 wire.json 값(안내 출력). 열 목록은 `contracts/parser/` 로 |
| `scripts/check_contract_manifests.py`(새) | `contracts/parser`·`contracts/app-announcements` MANIFEST 검사·재작성 |
| `.github/workflows/product-check.yml` | 파서 시험 두 줄 제거, MANIFEST 검사 추가 |
| `docs/integration/community-ingest/migration-manifest.json` | 두 migration·`app-announcements` 함수·`progress.ts`·`version.ts` |
| `docs/operations/backfill-progress-check.sql`·`emergency.sql`·`ops-console-db.md`(새) | 운영 확인 SQL(연결별 진행·원본·사실 수, 동의+연결 없음+설정 단계, 거절 수), 비상 SQL(중지·1시간 중지·재개·요구 해제), 콘솔 DB 준비 |
| `docs/implementation/backfill-resume-20261022/CLIENT-RULES.md`·`OPS-DB-API.md`·`A-REPORT.md`·`evidence/`(새) | 규칙 문서·콘솔 API·이 보고서·브라우저 증거 |
| `docs/implementation/raw-json-ingest-20261021/PLAN.md`, `docs/deployment.md`, `CHANGELOG.md` | 15절 변경, 적용 순서·체크리스트·한계, 미배포 항목 |
| `scripts/browser/verify_backfill_resume_demo.mjs`(새) | 데모 빌드 브라우저 증거 스크립트 |
| 시험: `tests/product/backfillResume.test.tsx`(새, 77), `tests/integration/backfill-resume-stack.test.ts`(새, 10), `ingestHandler`·`rawIngest`·`clientUpdate`·`functionAuthConfig`·`raw-ingest-stack` 갱신 | |

### auth
| 파일 | 내용 |
|---|---|
| `supabase/migrations/202610220100_setup_progress_client_seen.sql`(새) | `community_setup_progress`(사용자당 1행, 6키 Client 객체 검사), `community_client_seen`(앱·플랫폼별 1행), `community_note_client`, `internal_account_client_seen`, `internal_account_setup_progress`(1분 1회), 철회 때 삭제 트리거(정책 갱신 제외), 탈퇴는 FK cascade |
| `server/account.ts` | action `setup-progress`, 버전 헤더 기록, status 의 `ingest.paused/pause_message/resume_at`·`client_requirement`(읽지 못하면 키 없음) |
| `site/src/doc.ts` | `COMMUNITY_ISSUES_URL` → 모바일 레포 이슈 |
| `docs/account-api.md` | 지도 사본과 같은 바이트 |
| `tests/backfill-resume.unit.test.ts`(새, 23), `tests/stack/stack.mjs` | 시험, 레지스트리 의존 목록(기존에 빠진 `202610211900` 포함) |
| `CHANGELOG.md` | 미출시 항목 |

## 2. 판단 (지시서와 다르거나 지시서에 없던 결정)

1. **콘솔 함수는 스키마 `ops`** 에 두었다. `private` 에 두면 `community_ops` 에 `usage on schema private` 를 줘야 하는데, `private` 에는 PUBLIC 실행 권한이
   남은 함수가 있을 수 있다. `ops` 는 콘솔 함수만 있고 `community_ops` 만 실행한다. 지시서의 `ops_upload_overview()` = **`ops.upload_overview(...)`**.
2. **이력은 바꾸는 함수만** 남긴다("이전 값 → 새 값"이 없는 조회는 남기지 않음). 설정 이력은 트리거라서 콘솔 밖 직접 SQL 도 `sql:<역할>` 로 남는다.
   콘솔 함수는 `set_config('community_ops.*', …, true)` 로 같은 트랜잭션의 트리거에 누가·무엇을 넘긴다.
3. **중지 판정 위치**: 인증(getUser) 직후, rate limit 쓰기 전에 공유 설정을 읽는다(지시서 "DB 쓰기 전에" — rate limit 도 쓰기라서). 그 결과 v1 도
   설정 RPC 를 rate limit 보다 먼저 부르고, manifest 도 이제 설정을 읽는다(기존 시험 순서 기대를 고쳤다). gzip 은 이 판정 뒤에만 푼다.
4. **설정 RPC 실패**: v1·manifest·progress 는 중지·요구 없이 진행(먹통 방지), v2 는 지금처럼 503 `service_unavailable`.
5. **`client_requirement` 은 적용 중일 때만** status 와 426 에 쓴다(`enforce_from` 판정은 서버, 기기 시계를 믿지 않음). status 에서 **키가 없으면
   "판정 못 함"(앱은 마지막 판정 유지), 키가 있고 null 이면 해제** — 지시서의 "정상 응답에서만 잠금/해제"를 서버 일시 장애와 구분하려는 규칙.
   `ingest.paused` 도 같다. 설정이 이전 지도 migration(10-21)뿐인 동안은 auth 가 키를 빼고 경고 로그 2개를 남긴다.
6. **`X-Client-App` 값은 `<app>/<platform>`**(예 `mobile/android`): 지시서는 헤더 두 개와 표의 `platform` 열을 함께 요구해서, 헤더 수를 늘리지 않고 한 헤더에 담았다.
7. **`account_match` 는 `true`/`false`/`null`**(null = 모름). 문자열 "unknown" 대신 null 로 해 타입을 하나로 했다. 지문·이름은 보내지 않는다.
8. **setup-progress 2KB 초과는 400 `invalid_request`**: auth 오류 코드표는 PC 레포 `contracts/community-client` 사본과 같아야 해서(시험으로 고정) 새 코드(413)를 만들지 않았다.
9. Client 모드 설정 단계는 `client_server_checked` 라는 단계 이름을 새로 정했다("consent_ok 대신 서버 판정 결과").
10. 진행 보고: 개수는 `backfill` 안에 평평하게, 2-2 의 30일 보류 수 `stale_holds` 를 더했다. 모바일 속도 지표(`pace`)는
    `foreground_slices_today`·`background_runs_today` 두 개 — 0-1 에서 모바일 1회 전송이 거의 끝나지 않은 원인이 포그라운드/백그라운드 중 어디서 막히는지를 가르는 최소 값.
    진행 보고는 `last_parser_version` 도 갱신하고, 본문 `source_app` 이 연결과 다르면 `connection_mode_mismatch`, 정지된 기여자는 거부한다.
11. **거절 수**: "최근 1시간 503·426 수"를 보이려면 어딘가에 세야 해서 거절 때 분 단위 카운터 한 행을 upsert 한다(실패 무시, 7일 보관). 중지 중 부하는 늘지만 작다.
12. 공지: `starts_at` null = 게시한 때부터, `modes`·`platforms` null = 전체, `snooze_days` 0~365, `priority` -1000~1000, id 는 소문자 슬러그.
    허용 링크의 `*.worklazy.net` 은 하위 도메인과 `worklazy.net` 자체를 모두 허용했고, GitHub 조직 이름은 대소문자까지 `Fentanest` 만(벡터 `links.json`).
    공개 함수라 rate limit 대신 Edge 인스턴스 캐시 60초 + `max-age=300`.
13. 대시보드 분류 세부: 사람 = 철회하지 않은 동의가 있는 카카오 계정. 원본은 있는데 진행 보고가 없는 사람(3.6.0·3.6.1·2.5.0 은 보고 기능 없음)은 연결이 기준 시간 안에
    활동했으면 `uploading/no_progress_report`, 아니면 `stuck/no_progress_report`. 공식 로그인 수동 필요는 상태가 진행 중이어도 `stuck`. 보고 상태 `none` 은 `stuck/not_started`.
    "지도 행 수"는 `public_state='completed'` fact. 앱·버전은 연결 버전과 헤더 기록 중 나중 것.
14. 지도 웹 필수 버전 판정은 지시서대로 `client-status` 가 하고 지도 웹이 따른다. 지도 데이터 API 자체는 버전으로 막지 않는다(우회 가능, 남은 위험).
    안내 화면은 랭킹·통계 포함 앱 전체를 대신하고, client-status 응답 전(또는 실패)에는 지도를 보인다(먹통 방지).
15. 2-2 자동 재시도는 보류에서 돌아올 때 `attempts=2`(한 번 더 실패하면 바로 다음 보류 간격), 분류 못 한 예외는 **고정적**(보류 자동 재시도가 생겨 영구 정지가 없음).
    2-3 완료 표시 키 `raw_backfill_unstick = "2026-10-22.1"`.
16. 파서 계약 정본(검수자 방침): `parsed_columns.json`·`derived-v1.json`·`parser-vectors.json` 을 `contracts/parser/` 로 옮겼다(PC 벡터 나머지 5개는 PC 가 정본이라 옮기지 않음).
    워커를 띄우는 통합 시험은 `PARSER_REPO` 가 없으면 이유를 출력하고 건너뛴다.
17. auth `privacy.html`·`help.html` 의 "커뮤니티 지도 문의 게시판" 글자는 그대로 두고 링크만 바꿨다(정책 안내 문서의 문장 변경을 피함).
18. `community_ops_login` 은 NOLOGIN·비밀번호 없이 만들고 운영자가 206 에서 켠다(`community_parser_login` 과 같은 방식).

## 3. 구버전 503·426 처리표 (2-9·2-10, 태그 코드 읽기)

모든 출시 태그(모바일 v2.2.0~v2.5.0, PC v3.0.0.0~v3.6.1)를 `git show <태그>:<경로>` 로 읽었다(실행 검증 아님). **503(maintenance)·426·5xx 로 행을 잃는 버전은 없다.**
모든 버전이 행을 `retry_wait` 로 남기고 시도 상한 없이 다시 보낸다. manifest 503 은 로컬 자료를 지우지 않고 수집·초기화 시작만 미룬다.

| 앱 | 버전 구간 | 503 `maintenance` | 426 | 5xx | manifest 503 | 행을 잃나 | 근거(태그 기준) |
|---|---|---|---|---|---|---|---|
| 모바일 | v2.2.0~v2.4.1 | 모르는 코드 → `server_busy`(일시). 행 `retry_wait`, 로컬 백오프(≤300초±지터)와 `Retry-After`/`retry_after_seconds` 중 큰 값(24시간 상한), 서비스 쿨다운, 남은 배치 안 보냄. 전역 쿨다운 `max(300·2^(n-1)≤1800±20%, Retry-After)` | 코드 모름 → 기본 `server_busy`, `retry_wait`(전역 쿨다운 없음) | `server_busy` 같음 | `fetchManifestPage` null → `manifest_unavailable`, 이전 목록 유지·삭제 없음 | 아니오 | `upload_policy.dart:27-33,94-99,260-261`, `community_uploader.dart:309-316,637-642,1055-1071,1216-1230,1581-1605`, `cloud_availability.dart:108-148`, `server_completed.dart:43-44,73`, `sync_engine.dart:524-530` |
| 모바일 | v2.5.0 | 같음(v2 gzip 도 같은 판정) | 앎: `retry_wait` + hint 3600초, `ClientNotice.markUpgradeRequired`, 업데이트·ACK 때 `client_upgrade_required` 행을 `pending` 으로 되돌림 | 같음 | 같음 | 아니오 | `upload_policy.dart:44,146,341-346,366,430-432`, `community_uploader.dart:312,641,1034-1035,1093-1117,1691`, `client_notice.dart:138,152-156` |
| PC | v3.0.0.0~v3.0.0.2 | 모르는 코드 → `server_busy`, `retry_wait`, `max(로컬≤300초, 서버 지시)`, 서비스 쿨다운, 남은 배치 중단(전역 쿨다운 모듈 없음) | 모름 → `server_busy` | 같음 | `post_manifest` 실패 → `server_completed` 그대로, rebuild `prerequisites_required`, 삭제 없음 | 아니오 | `community_upload_policy.py:30-31,104,236-237`, `community_uploader.py:122-123,404-407,446-454,915-921`, `community_rebuild.py:533-535` |
| PC | v3.0.0.3~v3.0.0.4 | `status>=500` → `server_busy`, `max(300초, 서버 지시)`(상한 없음), 전역 쿨다운 `community_cloud.run` | 모름 → `server_busy`(최소 300초) | 같음 | 같음, manifest 503 도 전역 쿨다운을 건다(행은 남음) | 아니오 | `community_upload_policy.py:55,104,215-216`, `community_cloud.py:177,196-200`, `community_uploader.py:450,690,938-944` |
| PC | v3.1.0~v3.5.1 | 같음, 로컬 300초 바닥 철회, 전역 쿨다운 `max(300·2^(n-1)≤1800±20%, Retry-After)` | 모름 → `server_busy` | 같음 | 같음 | 아니오 | `community_upload_policy.py(v3.1.0):62,111,222,245`, `community_cloud.py(v3.1.0):197,219-222` |
| PC | v3.6.0~v3.6.1 | 같음(v2 gzip 도) | 앎: `retry_wait` + hint 3600, `community_notice.mark_upgrade_required`, `clear_upgrade` 가 되돌림 | 같음 | 같음 | 아니오 | `community_uploader.py:490,753,893,1024-1031,1038-1042`, `community_notice.py:55-66` |

- 업로드 경로에서 dead_letter 는 payload 오류(413·payload_invalid), ACK `conflict`, oversize 뿐이다. blocked 는 consent·connection 계열 코드와 ACK `rejected` 뿐이고
  `maintenance`·`client_upgrade_required` 는 구버전 목록에 없다. 모르는 코드는 4xx 라도 `server_busy` 로 재시도한다.
- 업데이트 뒤 1회 전송(PC 3.6.0+ `community_raw_backfill_runtime.py:148,247-251`, 모바일 2.5.0+ `raw_backfill_runtime.dart:535-540,761-824`)은 outbox 상태와 무관하게
  로컬 신고 표의 답변 완료 신고 전체로 새 이벤트를 만든다 — 다른 이유로 막힌 행이 있어도 다시 보낸다.
- 구버전은 426 을 받아도 ≤300초(3.0.0.3~0.4 는 300초) 간격으로 다시 두드린다. 서버는 envelope 검사 직후, DB 쓰기 전에 426 으로 끝내므로 부담은 작다(받아들임).

## 4. 새 문구 (2-13)

| 위치 | 문구 |
|---|---|
| 지도 웹 점검 배너 제목 | 서버 점검 중 |
| 지도 웹 점검 배너(재개 시각 있음) | 앱의 신고 업로드가 잠시 멈췄습니다. {10월 22일 오후 3:30}에 자동으로 다시 올립니다. 지도는 그대로 볼 수 있습니다. |
| 지도 웹 점검 배너(재개 시각 없음) | 앱의 신고 업로드가 잠시 멈췄습니다. 점검이 끝나면 자동으로 다시 올립니다. 지도는 그대로 볼 수 있습니다. |
| 지도 웹 점검 배너 접근성 이름 | 서버 점검 안내 |
| 지도 웹 업데이트 안내 제목 | 앱을 업데이트해 주세요 |
| 지도 웹 업데이트 안내 첫 줄 | {표시 이름} 계정에서 최근 30일 안에 실행한 앱 중 필요한 버전 이상이 없어 지도를 열 수 없습니다. |
| 지도 웹 업데이트 안내 본문 | 앱을 최신 버전으로 업데이트한 뒤 한 번 실행해 주세요. 앱을 실행하면 버전이 확인되고, 여기서 ‘다시 확인’을 누르면 지도가 열립니다. |
| 지도 웹 업데이트 안내 버전 줄 | 필요한 버전: PC {3.6.2} 이상 · 모바일 {2.5.1} 이상 |
| 지도 웹 업데이트 안내 링크 | PC 프로그램 받기 / 모바일 앱 받기 (접근성: "… (새 탭에서 열림)") |
| 지도 웹 업데이트 안내 버튼 | 다시 확인 / 다른 계정으로 로그인 |
| 지도 레포 이슈 안내(`config.yml`) | 문의·버그 제보·공유 신고 삭제 요청 — 문의는 safetyreport-mobile 에 남겨 주세요. 누구나 볼 수 있는 게시판이니 카카오 계정·차량번호·신고번호 같은 개인정보는 적지 마세요. |
| Edge 오류 `message`(앱이 화면에 내지 않는 영문 진단) | maintenance: "Uploads are paused for server maintenance. They resume automatically." / client_upgrade_required: "This app version can no longer upload. Please update the app." |
| 앱에 넣을 문구(B·C·D·E 가 구현) | CLIENT-RULES.md 11절 표(점검 배너, 업데이트 잠금, Client 계정 불일치, 미설정 서버, 알림 4종, 공지 버튼) |

## 5. 시험 결과

| 명령 | 결과 |
|---|---|
| map `npx vitest run --maxWorkers=4` | **88 파일 통과, 1362 통과 / 0 실패**, 226 건너뜀(통합 스택 등 환경 필요). 첫 전체 실행에서 `composeScript`·`sharedRetryCooldown` 이 부하로 5초 시간 초과 → 단독 15/15 통과, 재실행 전체 통과 |
| map `npx vitest run tests/product/backfillResume.test.tsx` | 77 통과: 버전 벡터 24, 중지 503(v1·v2·gzip·manifest·progress, 호출은 getUser·capabilities·거절 수뿐 = 원장·연결·대기열·rate limit 쓰기 0), Retry-After 남은 초/600, 자동 재개, 설정 실패 시 v1 진행·v2 503, 426(v1·v2·같음·해석 불가·다른 플랫폼), progress 벡터 12(정상·금지 필드·4KiB 초과 413)와 오류 매핑(429 Retry-After·revoked·unknown·session·mode), 공지(토큰 없이 200·최대 3·링크 벡터 19·모르는 app_action·400 6종·버전 해석 실패·503), client-status 디코드, 배너·안내 화면 렌더 |
| map `npx tsc -b`, `VITE_DATA_MODE=live npm run build`, `npm run scan` | 통과, scan `issues: []` |
| map `deno test tests/deno/raw_ingest_test.ts`, `deno check` (community-ingest·app-announcements·my-analytics) | 5 통과, 타입 검사 통과 |
| map `python3 scripts/raw-ingest/check_contract.py` (PARSER_REPO 있음·없음) | PASS 15 files, 생성기 재현 |
| map `python3 scripts/check_contract_manifests.py` | PASS 2 |
| map `node tests/sql/verify-raw-ingest.mjs`, `npm run test:sql`, `python3 -m unittest` (blueprint·product) | 통과 |
| map `node scripts/integration/compose_supabase.mjs check --auth ../auth` | ok 76 migrations, 9 functions |
| **로컬 Supabase**(지도+auth 전체 76 migration, 프로젝트 `brA-0922`, 포트 API 57321·DB 57322·shadow 57320·inspector 57383, 모의 카카오 57410) `tests/integration/backfill-resume-stack.test.ts` | **10/10 통과**: SQL 버전 벡터, 중지·자동 재개(스위치 켜진 채 재개 시각 경과 → `paused:false`)·이력(관리자·`ops:메모`·before→after, 직접 SQL `sql:postgres`)·재개 시각 과거/7일 초과/문구 거부, 필수 버전(적용 전 null·적용 중·검증·영향 수·지도 웹 30일 판정: 10일 전 2.5.1 열림, 2.5.0·31일 전·모름 막힘, 요구 없는 플랫폼 통과, `enforce_from` 전 null), 진행 RPC(outdated 허용·1분 1회·연결 기록·원장/원본 0·200건/30일 정리·세션·연결·모드·철회·동의 없음), setup-progress(1행·1분·Client 객체 규칙·버전 기록·정책 갱신은 유지·카카오 끊기 철회는 삭제), 콘솔 역할(표 직접 쓰기·읽기·private 함수·public RPC 모두 permission denied, ops 함수만 실행, 비관리자 `not_ops_admin`, 로그인 역할 NOLOGIN·구성원), 공지(초안만 수정·게시·종료·삭제·대상/버전/우선순위/최대 3·잘못된 링크·제어문자·모드·타입 거부·이력), 대시보드 15명 분류(23h/25h 경계, 버전 경계 2.5.0, outdated+v1, Client 불일치, 로그인 실패 사유, 보류 N, 공식 로그인 필요, 완료 최신/이전, 보고 없음 2종)·가명 ID 외 식별자 없음·상세, 정리 cron, **실제 Edge**: 토큰 없이 공지 200, 이메일 가입 사용자로 `/progress` → 503 maintenance·Retry-After 1700~1800·거절 수 +1 |
| 같은 스택 `tests/integration/raw-ingest-stack.test.ts`(PARSER_REPO=`../parser`, psycopg 3.3.6 venv) | 12/12 통과(키 기대값 2곳 갱신 뒤). 파서 워커가 새 레포 경로에서 돈다 |
| 같은 스택 `tests/integration/community-stack.test.ts` | 30 실패 / 3 통과 — **내 migration 2개를 뺀 기준선에서도 똑같이 30/3**(원인 `report_owned_elsewhere`, 기존 문제). 이번 변경으로 늘거나 줄지 않음 |
| 성능(같은 스택, 합성 600명·원본 6만 건) | `ops.upload_overview` 102~118ms, `ops.requirement_impact` 103ms |
| 운영 SQL(`backfill-progress-check.sql`·`emergency.sql`) | 로컬 스택에서 오류 없이 실행 |
| 콘솔 로그인 역할 | 로컬에서 비밀번호를 줘 `community_ops_login` 으로 접속 → `ops.whoami` 성공, `private.ops_admins` 조회 permission denied, 다시 NOLOGIN 으로 되돌림 |
| auth `npx vitest run` | 111 통과 / **1 실패(기존)**: `techlog-2026-10-04` "privacy page names the policy version …" — HEAD 에서도 `site/privacy.html` 에 `정책 버전 2026-10-21.1` 문구가 없어 실패(동의·개인정보 문서라 고치지 않음). 새 `backfill-resume.unit.test.ts` 23 통과 |
| auth `npx tsc --noEmit`, `npm run build`, `npm run scan`, `npm run test:sql` | 통과 |
| 지도 웹 실제 브라우저(데모 빌드, Chromium, 1366×900·390×844) `scripts/browser/verify_backfill_resume_demo.mjs` | 점검 배너 2종·업데이트 안내·요구 충족·평소 5경우×2 화면: 콘솔 오류 0, 가로 넘침 0, 안내 화면에서는 대시보드 미장착·외부 요청 0, "다시 확인" 클릭 동작. 스크린샷·`report.json`: `evidence/` |

## 6. NOT RUN

- 206·205 원격, migration 원격 적용, Edge·Pages 배포, 실제 카카오 로그인 왕복(지시서 금지·검수자 몫).
- `scripts/integration/migration_paths.sh`: `.integration-stack`·컨테이너 `supabase_db_ci0926-int` 고정이라 다른 에이전트와 포트·이름이 겹친다. 대신 전체 76개를 빈 DB 에 적용(`db reset` 4회)했다.
- 지도 웹 live 모드 브라우저 검수(실제 client-status 응답): 로컬 Edge 는 HTTP 로 확인했고 화면은 데모 빌드로만 찍었다. Muse 브라우저 검수 아님.
- PC·모바일 쪽 동작(B·C·D·E 범위), 콘솔 앱(F).

## 7. 남은 위험

- 지도 웹 필수 버전은 화면 판정이라 지도 데이터 API 를 직접 부르면 우회된다(지시서 설계 그대로).
- 지도 Edge(my-analytics)를 먼저 바꾸고 지도 웹 배포가 늦으면, 예전 웹이 새 키를 모르는 client-status 응답을 버려 업데이트 안내가 잠시 사라진다(열람 영향 없음). 연달아 배포.
- 중지 중 구버전의 재시도마다 거절 수 카운터 upsert 1회가 생긴다(분 단위 행 하나에 몰림).
- `ops` 함수는 콘솔이 넘긴 `p_actor` 를 믿는다(DB 는 카카오 로그인을 다시 확인할 수 없음). 콘솔 DB 비밀번호 유출 = 관리자 ID 를 아는 사람이 조작 가능.
- 대시보드의 "구버전 앱" 판정은 확인된 버전이 있어야 한다. 2.5.0·3.6.1 이하는 헤더를 보내지 않아 업로드 기록(`last_client_version`)으로만 보인다.
- 지도 웹 판정은 "최근 30일 안에 확인된 앱"이라, 업데이트했더라도 앱을 열지 않으면 막힌다(안내 문구에 적음).
- 동의문(`contracts/consent/share-consent-*.md`)에는 지도 레포 이슈 주소가 남아 있다 — 다음 동의문 개정 때 바꾼다. 그때까지 `config.yml` 안내로 모바일 레포로 간다.
- PC·모바일 레포의 `contracts/community-ingest-v2` 사본이 아직 옛 파일 집합이라 `check_contract.py --copies ../pc ../mobile` 은 지금 실패한다(아래 요청).
- 기존 `community-stack` 통합 시험 30개 실패(`report_owned_elsewhere`)는 이번 작업 전부터다. 별도 확인이 필요하다.

## 8. 요청

### 다른 담당에게
- **B·C(PC·모바일 핵심)**: `contracts/community-ingest-v2/` 사본을 지도 MANIFEST 와 같은 바이트로 갱신(새 파일 4개: `progress.schema.json`, `client-requirement.schema.json`,
  `version-vectors.json`, `vectors/progress.json`; 바뀐 파일: `README.md`, `errors.md`, `account-api.md`, `MANIFEST.sha256`). `version-vectors.json` 으로 잠금 비교를 시험.
- **D·E**: `contracts/app-announcements/vectors/links.json` 으로 앱 링크 허용 목록 시험, `response.schema.json` 으로 응답 검사.
- **F**: OPS-DB-API.md 만 보면 된다. 로컬 시험은 지도 `compose_supabase.mjs` 로 띄운 DB 에서 `community_ops_login` 에 시험용 비밀번호를 주고 쓰면 된다.
- **검수자**: 206 라우터 `volumes/functions/main/index.ts` JWT 예외 목록에 `app-announcements` 추가(배포 때). `client_notice` 최소 버전 갱신·공지 게시는 지시서 순서대로.

### 요청(G 후속) — 파서 레포가 받아야 할 것
정본을 지도 공개 레포로 옮긴 파일과 파서 레포가 `MAP_REF` 로 내려받아야 할 경로:

| 지도 경로(정본) | 예전 위치(파서 레포에 사본으로 있음) | 파서 레포가 할 일 |
|---|---|---|
| `contracts/parser/parsed_columns.json` | `parsed_columns.json` | `MAP_REF` 의 이 파일을 받아 `contracts/parser/MANIFEST.sha256` 해시와 비교, 워커·시험이 이것을 쓰게. 레포 사본은 지우거나 빌드 때 덮어쓰기 |
| `contracts/parser/derived-v1.json` | `contracts/derived-v1.json` | 같음(지도 `tests/product/rawIngest.test.ts` 도 이 경로를 읽는다) |
| `contracts/parser/parser-vectors.json` | `contracts/parser-vectors.json` | 같음. 정본의 원천은 PC `contracts/parser-vectors.json` — PC 일치 검사는 파서 레포에 그대로 |
| `contracts/parser/MANIFEST.sha256`, `README.md` | (없음) | 비교 기준 |
| `shared/agency-region-registry/` | (기존 G 작업) | 그대로 |

- 지도 쪽이 파서 레포에 기대는 것: `PARSER_REPO/community_adapter.py` 의 `build_payload`(지도 `generate_contract.py`), `PARSER_REPO/worker.py`
  (지도 `raw-ingest-stack.test.ts`, 인자 `--once --batch N`·`--pause N`, 환경 `COMMUNITY_PARSER_DSN`). 이 두 경로·인자를 바꾸면 알려 달라.
- `deploy/map-ref` 는 이 변경이 커밋된 지도 커밋으로 올려야 `contracts/parser/` 를 받을 수 있다(지금 값 123092c 에는 이 폴더가 없다).

## 9. 운영 적용 순서 (제안만, docs/deployment.md 같은 내용)
auth migration `202610220100` → 지도 migration `202610220200` → Edge(`community-ingest`, `my-analytics`, `community-account`, 새 `app-announcements` + 라우터 JWT 예외)
→ 지도 웹(Pages) 바로 이어서 → PC 3.6.2 → 모바일 2.5.1 → 파서 이미지를 파서 레포 커밋 기준으로 다시 빌드(`deploy/map-ref` 갱신 뒤)
→ 운영 콘솔 배포·`community_ops_login` 켜기·첫 관리자 등록 → `client_notice` 최소 버전 PC 3.6.2 / 모바일 2.5.1 → 콘솔에서 2-12 공지 두 개 게시.
