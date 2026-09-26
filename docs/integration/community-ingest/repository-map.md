# community-ingest 작업 — 저장소 지도 (정본)

RUN_ID `ci-20260926` · 작업 시작 2026-09-26 02:03:33 KST (2026-09-25 17:03:33 UTC) · 작성 Opus5.5(claude-opus-5-5)
정본 위치: `safetyreport-community-map/docs/integration/community-ingest/`. 다른 저장소 문서는 이 폴더의 파일·커밋을 참조한다.
근거: 직접 확인한 명령 결과 + Gemini(agy 1.2.11, `gemini-3.1-pro-high`) 조사 보고서 7건(`safetyreport/.agent-runs/ci-20260926/gemini-*/report.md`, 추적 안 함).
Gemini 서술은 Opus가 표본 대조한 것만 사실로 옮겼다. 대조하지 못한 항목은 "미확인"으로 둔다.

## 1. 작업상 이름 ↔ 실제 저장소

| 작업상 이름 | 저장소 | 로컬 경로 | 이번 역할 |
|---|---|---|---|
| safetyreport | `Fentanest/safetyreport` | `~/projects/safetyreport` | PC·Docker 수집, 커뮤니티 세션, source journal·outbox·업로더, 서버 게이트·초기화 |
| safetyreport-mobile | `Fentanest/safetyreport-mobile` | `~/projects/safetyreport-mobile` | Flutter Standalone 수집·업로드, Client 의 서버 제어, 모바일 게이트·초기화 |
| safetyreport-map | `Fentanest/safetyreport-community-map` | `~/projects/safetyreport-community-map` | 계약·fixture 정본, community-ingest, 비공개 사실·projection, 공개 API, 통합 migration manifest |
| safetyreport-auth | `Fentanest/safetyreport-community-auth` | `~/projects/safetyreport-community-auth` | 중앙 계정 연결 페이지·PKCE relay, 계정·동의·기기 연결 레지스트리와 상태 API |

도메인(두 중앙 레포 README·auth `docs/protocol.md` 기준, DNS·운영 배포는 미확인):
`https://safeauth.worklazy.net/`(콜백 `/callback.html`), `https://safemap.worklazy.net/`, 모바일 복귀 `com.fentanest.mysafetyreport://auth/callback`.
과거 `worklazy.net/safeauth/` 하위 경로 구조는 map 커밋 5ac7689·d6046df 에서 폐기됐다. 되돌리지 않는다.

## 2. 시작 시점 git 상태 (정리 대상 구분의 기준)

| repo | 현재 브랜치 | HEAD | 관련 브랜치 | 사용자 미커밋 변경(보존) |
|---|---|---|---|---|
| safetyreport | `dev` | `cb4b027` | `feat/community-account` `db4b38f`(dev 의 후손, 미병합 6커밋), `main` `17df6cb`(릴리즈) | `?? docs/refactor-hardening-test-plan-2026-05.md`, `?? testresults/`, `?? tests/test_db_backup_regression.py` |
| safetyreport-mobile | `dev` | `af2ae809` | `feat/community-account` `98e474b2`(dev 의 후손, 미병합 4커밋), `main` `c64be69a` | `?? kr.go.safepeople-157/`, `?? resultstest/`, `?? safepeople.md` |
| community-map | `main` | `a829079` | — | 작업 도중 사용자가 설치: ` M package.json`(devDependency `supabase` 2.118.0), ` M package-lock.json`, `?? deno.lock`, `?? supabase/.temp/` |
| community-auth | `main` | `558ed6b` | — | 없음 |

- 시작 시 각 repo 의 worktree 는 주 체크아웃 하나뿐이었고 `~/projects/worktree/` 는 비어 있었다. 원격은 모두 `git@github.com:Fentanest/<repo>.git`.
- 목표 브랜치(로컬): safetyreport·mobile = `dev`(작업 브랜치, `main` 은 릴리즈), map·auth = `main`. push·태그·릴리즈는 하지 않는다.
- `feat/community-account`(PC·mobile)는 이번 필수 게이트의 K(카카오 인증)를 이루는 기존 구현이다. 이번 통합 브랜치는 이 브랜치 tip 에서 시작하고, 최종 병합으로 `dev` 에 함께 들어간다(근거: 5절). 원래 브랜치는 삭제하지 않는다.

## 3. 적용 지시문

| repo | 문서 | 이번 작업에 걸리는 규칙 |
|---|---|---|
| safetyreport | `AGENTS.md`, `PROJECT_RULES.md`, `CLAUDE.md`, `GEMINI.md`, `docs/agent-dispatch-runbook.md` | 3-1 서버↔모바일 DB 교환 무결성 최우선(스키마 변경은 두 레포 동시·왕복 테스트), 3-2 확정/추정 금액 분리, 운영 `data/`·실크롤링·외부 전송 금지, fixture 로 검증 |
| safetyreport-mobile | 같은 구성 | 같은 3-1, 광범위 패키지(`supabase_flutter` 등) 추가는 승인 필요 → 기존 REST 어댑터 방식 유지 |
| community-map | `AGENTS.md`, `PROJECT_RULES.md`(cm-2026-09-24), `SOL.md`, `MUSE.md` | 공개 정책(전체 성명·정확 좌표·1건 공개·차량 지역 보존 마스킹), VITE_* 는 공개값만. 레포 문서는 Sol 총괄을 전제하지만 **최신 사용자 지시(Opus 통합·Muse 구현·Sol 검토/감사)가 우선**(PROJECT_RULES 1줄: 최신 사용자 명시 요구 > 본 규칙) |
| community-auth | `README.md`, `docs/*.md` | relay 는 pre-login capability 검증(`verify_jwt=false`), 원래 기기가 verifier·세션 소유, `scope=local` 로그아웃 |

## 4. 도구·모델 (실측 2026-09-26 02:0x KST)

| 항목 | 값 | 확인 명령 |
|---|---|---|
| OS·사용자 | Ubuntu 24.04, kernel 7.0.0-31, uid 1000 `better0101`(docker 그룹) | `uname -a`, `id` |
| Node / npm | v22.17.1 / 10.9.2 (nvm) | `node --version` |
| Supabase CLI | **2.118.0** — map 주 체크아웃 `node_modules/.bin/supabase`(사용자가 devDependency 로 설치, 전역 `supabase` 없음) | `npx supabase --version` |
| Deno | **2.9.7** `~/.deno/bin/deno`. 비대화형 셸 PATH 에 없어서 `~/.local/bin/deno` 심볼릭 링크 추가(셸 설정 무변경) | `deno --version` |
| Docker | client/server 29.8.1, `/var/run/docker.sock` root:docker 0660 | `docker version` |
| Flutter | 3.41.6 stable | `flutter --version` |
| Python | `safetyreport/.venv` python3.14 | — |
| Gemini | agy 1.2.11, `gemini-3.1-pro-high` | `agy models` |
| Muse | OpenCode 1.18.31, **`opencode-go/muse-spark-1.3-contributor`**(구독 경로 `opencode-go`; `opencode/…-free` 변형은 쓰지 않음) | `opencode models` |
| Sol | Codex CLI 0.157.0 + 공식 Claude Codex 플러그인 1.0.6 companion, 모델 **`gpt-6-sol`**(`~/.codex/config.toml` 기본값과 같음, 호출 때 명시) | `codex --version`, installed_plugins.json |

로컬 Supabase 실측: 격리 workdir(`safetyreport/.agent-runs/ci-20260926/stack-poc`, project_id `ci0926-poc`, API 55321/DB 55322)에서
`supabase start` 성공(1분54초): Postgres 17.6.1.171, GoTrue v2.197.0, PostgREST v16.3, Kong 2.8.1, edge-runtime v1.76.2. JWT 는 ES256.
POC: `logout?scope=local` 직후 같은 access token 의 `/auth/v1/user` → 403 `session_not_found`; Publishable Key 를 Bearer 로 → 403 `bad_jwt`.
auth 레포에는 별도 compose 검증 스택(`tests/stack`, 포트 544xx, GoTrue v2.197.0·PostgREST v13.0.7·모의 카카오)이 있다.

## 5. 재사용할 기존 구현

### safetyreport (`feat/community-account` @ db4b38f)
- `services/community_auth_service.py`(976줄): 설정 검증, 상태 DTO, relay start/poll/confirm/cancel/disconnect, `get_access_token()`(RLock+파일 락 single-flight 갱신·원자 저장), `is_upload_allowed()`(현재 `upload_enabled=false` 고정).
- `services/community_auth_client.py`: relay·GoTrue HTTP(PKCE, `logout?scope=local`). `services/community_auth_store.py`: `data/auth/community_session.enc`(Fernet), `.community_key`, 설치 ID, 파일 락.
- `web/routers/community_route.py`: 관리자 `/settings/community/*`(세션+CSRF), 모바일 `/api/v1/community-auth/*`(API 키, 관리 동작은 `api_key_managers`).
- 설정 `[COMMUNITY]`: `enabled`, `supabase_url`(`SAFETYREPORT_COMMUNITY_SUPABASE_URL`), `publishable_key`(`SAFETYREPORT_COMMUNITY_PUBLISHABLE_KEY`), `site_url`, `device_label`, `api_key_managers`, `upload_enabled`.
- 세션은 `data.db` 에 넣지 않는다 → DB 백업·모바일 변환·교환 계약에 들어가지 않는다(이번 source journal/outbox 도 같은 원칙으로 별도 파일).
- 수집: 스케줄러(APScheduler `BackgroundScheduler`, 로컬 timezone) → `services/crawl_control.py` → `services/crawl_manager.py` → 서브프로세스 `start.py` → 목록 `crawltitle_api.crawl_titles()` → `database.get_pending_detail_ids()`(신규 또는 `종결여부 != 'Y'`) → `crawldetail_api.crawl_details()`(curl_cffi, Selenium `browser_fallback`) → `services/parser.py` → `start.py _save_details_as_they_arrive()` → `core/storage/reports_repo.py save_crawled()`(건별 commit).
- 종결 판정: `services/parser.py _CANONICAL_DONE_STATUSES` = 수용·일부수용·불수용·기타·답변완료·취하·이송 → `종결여부=Y`. **커뮤니티 완료 판정과 다르다**(취하·이송은 완료 답변이 아님).
- 수기 수정: `services/db_editor_service.py`, `종결여부` 가 편집 가능 컬럼 → 개인 수정이 수집 선정에 섞인다(A07 대상). 세부는 2차 조사로 확정.
- 인증: `main.py auth_middleware`(세션 `admin_logged_in`, `_PUBLIC_PATHS` 예외에 `/api/v1`), API 는 `X-API-Key`, WS `/ws/events?api_key=`.
- 지도: `/map` → `web/templates/report_map.html`.
- 테스트: `tests/test_community_auth.py`, `tests/test_community_auth_live.py`(선택 실행, 실제 GoTrue+relay), fixture 서버 `scripts/dev/fixture_server.py`, Playwright `tools/web-tests`.

### safetyreport-mobile (`feat/community-account` @ 98e474b2)
- `lib/services/community_auth_*.dart`: SDK 없는 Supabase REST + PKCE + 외부 브라우저, 딥링크 `com.fentanest.mysafetyreport://auth/callback`(Android intent-filter + `MainActivity.kt` MethodChannel `com.fentanest.mysafetyreport/community_auth`), `flutter_secure_storage` 키 `community_session_v1`·`community_pending_login_v1`. iOS URL scheme 미설정.
- `lib/services/community_server_link_service.dart`: Client 가 서버 `/api/v1/community-auth/*` 호출.
- 설정: `--dart-define=COMMUNITY_SUPABASE_URL`, `COMMUNITY_SUPABASE_PUBLISHABLE_KEY`(`CommunityAuthConfig`). 빌드 스크립트·`build-apk.yml` 에는 아직 전달 없음.
- 시작: `main()` → Workmanager(`BackgroundLoginCheck`) 초기화 → `CommunityAuthLinkChannel.start` → `runApp` → `ReportProvider.init()` → `SetupScreen`/`PermissionScreen`/대시보드. 권한 요청: `permission_screen.dart`(알림·배터리·백그라운드 위치·알림 접근), `report_map_screen.dart`(위치), 설정·파일 브라우저(저장소).
- 수집: `sync_engine.dart` 상세 루프 `fetchReportDetail` → `parseJsonToReport` → `_augmentRatingCause` → `MaintenanceService.prefetchForSave` → `LocalDbService.upsertReport`(raw/override 분리, DB v15, `reports_effective` 뷰). 증분 대상 = 신규 또는 `보완_미응답=Y` 또는 `종결여부!=Y`(existingStatus 출처는 2차 조사로 확정). 단건: `standalone_auto_sync_service.dart _tryFetchSingle`.
- 좌표: 주소 → `geocode_cache`(주소정규화 키) 지오코딩. 공식 응답 좌표 여부는 2차 조사로 확정.
- 백그라운드: Workmanager `^0.10.10`, Android `SyncForegroundService`·`WsService`·`NotificationService`, iOS BGTask 설정 없음.
- 지도 탭: `lib/screens/report_map_screen.dart`(flutter_map + OSM 타일).

### community-map (@ a829079)
- 공개 API: `supabase/functions/public-analytics` + `server/publicHandler.ts`·`aggregate.ts`·`plate.ts`(Deno `npm:@supabase/supabase-js@2.117.1`, service role 클라이언트, `verify_jwt=false`), RPC `internal_analytics_v2_state/facts/rate_limit`(service_role 전용).
- SQL: `202608150001_initial_schema.sql`(private 스키마, `contributor_profiles`, `upload_snapshots` 사용자당 active 1개, `upload_points`, `rate_limits`), `202609240001_analytics_v2.sql`(운영 미적용 제안, `report_facts_v2` 가 active snapshot 에 묶임, `analytics_state.ready`, 변경 시 ready=false 트리거).
- **ingest 함수·연결 레지스트리·동의 grant 없음.** 업로드 경로는 구 snapshot 설계 문서뿐(`docs/client-integration.md`: Google 로그인, 02~03시 분산 업로드).
- 문서·SQL 불일치(코드가 정본): `docs/data-contract.md` disposition `fine/penalty/warning/warning_or_penalty/other/unknown` vs SQL `fine/warning/penalty/none/unknown`; 문서 `vehicle_canonical`·`fine_amount` vs SQL `vehicle_raw`·금액 컬럼 없음.
- 테스트: `npm test`(vitest), `tests/product`, `tests/blueprint`(python), `npm run scan`(`scripts/scan_public_dist.py`). 로컬 DB 하네스 없음.

### community-auth (@ 558ed6b)
- relay 프로토콜 v1(`docs/protocol.md`, `server/protocol.ts`, `server/relay.ts`, Edge `community-auth-relay` `verify_jwt=false`), SQL `202609251200_community_auth_relay.sql`(`private.community_auth_requests`, `community_auth_rate_limits`, service_role 전용 상태 전이 함수). `/complete` 는 사용자 JWT 를 `/auth/v1/user` 로 검증.
- **영속 연결 레지스트리·공유 동의 테이블 없음**(마이그레이션 주석: contributor_profiles 를 쓰지 않음).
- 사이트: `site/`(index·callback·help·privacy MPA), 설정 `SAFEAUTH_PUBLIC_SUPABASE_URL`·`SAFEAUTH_PUBLIC_PUBLISHABLE_KEY`·`SAFEAUTH_PUBLIC_PRIVACY_POLICY_URL`·`SAFEAUTH_PUBLIC_OPERATOR_CONTACT`, `scripts/verify-artifact.mjs`.
- 로컬 스택: `node tests/stack/stack.mjs up`(compose `safeauth-local`, 544xx), `SAFEAUTH_STACK=1 npx vitest run tests/relay.integration.test.ts`.

## 6. 최근 7일(2026-09-19 00:00 KST~) 변경 개요 — 감사 범위 참고용(감사 창은 감사 시작 시 다시 고정)
- safetyreport dev: 09-24~25 fixture·Playwright·통계 명세·밤샘주차·과태료 규칙·딥다크 팔레트·앱과 계산 일치(cb4b027). feat: 09-25~26 커뮤니티 계정 6커밋.
- mobile dev: DB v15·`reports_effective`·별점 6개월 규칙·5탭 리뉴얼·inbox 모델. feat: 커뮤니티 계정 4커밋.
- map: 09-23~26 React 상황판 M0~M3, v2 분석 SQL, safeauth 코드 분리, 마스킹 지역 보존, 루트 경로 배포.
- auth: 09-26 레포 생성(72bbf7e)~558ed6b.

## 7. 미접근·미확인 범위
- 운영 Supabase 프로젝트(ref·키·적용된 migration), DNS·Pages 실제 배포, 실제 카카오 앱: 접근 안 함(승인 경계).
- WorklazyTools `docs/agent-dispatch-runbook.md`(09-22)는 참고만 했다. Sol/Muse 호출 형식은 그 문서와 설치본 옵션을 대조해 사용한다.
