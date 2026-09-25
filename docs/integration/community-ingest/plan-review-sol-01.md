# community-ingest 계획 v1 독립 검토 · plan-review-sol-01

## 0. 실행 환경·모델 자기확인

- 검토 역할: GPT-6-Sol 독립 계획 검토자. 이 세션에서 확인 가능한 자기 정보는 **GPT-6 기반 Codex**이다. 런타임의 세부 모델 ID를 출력하는 도구는 제공되지 않아 `gpt-6-sol` 문자열 자체를 독립 실측했다고 주장하지 않는다. Opus는 호출 로그의 model ID와 세션을 별도로 대조해야 한다.
- 작업 경로: `/home/better0101/projects/worktree/ci-20260926/community-map/plan-review-sol`. 읽기 전용 비교 기준은 PC `db4b38f`, 모바일 `98e474b2`, 지도 `a829079`, 인증 `558ed6b`. 아래 `PC:`, `M:`, `MAP:`, `AUTH:`는 각각 사용자 지정 네 고정 스냅샷의 루트를 뜻한다. `P:`는 이 worktree의 `docs/integration/community-ingest/plan-v1.md`, `O:`는 `review-input/original-prompt.md`다. 모든 `경로:줄`은 이 루트 기준이다.
- 원 프롬프트, 계획 v1, repository-map 원문과 네 저장소의 지적 관련 코드를 직접 읽었다. Gemini 조사 보고서는 참고했으며 판단 근거로 삼지 않았다. 제품 코드·고정 스냅샷·Docker·운영 자원은 변경하지 않았다. 동적 통합 테스트를 실행했다고 주장하지 않는다.

| 요청한 명령 | 결과 |
|---|---|
| `deno --version` | 성공: `deno 2.9.7`, V8 `15.0.245.2-rusty`, TypeScript `6.0.3` |
| `node --version` | 성공: `v22.17.1` |
| `/home/better0101/projects/safetyreport-community-map/node_modules/.bin/supabase --version` | 실패(exit 1): telemetry 파일 `/home/better0101/.supabase/telemetry.json.tmp.…` 쓰기에 `EROFS: read-only file system` (`FileSystem.writeFile`). **이 세션에서 CLI 버전을 실측하지 못함.** 긴 번들 스택은 생략했다. |
| `docker version --format '{{.Server.Version}}'` | 실패(exit 1): `permission denied while trying to connect to the docker API at unix:///var/run/docker.sock`. **이 세션에서 서버 버전을 실측하지 못함.** |

## 1. 총평·진행 판정

**계획 v1 그대로 구현 착수 불가.** 구조 방향은 대체로 적절하지만, 현재 안으로는 좌표 없는 신고가 공개 신고량에서 사라지고(S-01), 철회·재동의/데이터 삭제의 공개 경계가 모호하며(S-02), 필수 게이트가 설정 복구를 막고(S-07), 기존 스케줄러가 자정 작업을 지울 수 있다(S-08). 초기화의 실제 shadow/cutover와 writer 전환도 아직 증명 가능한 계약이 아니다. 아래 critical/high를 `plan-final`에서 명시적으로 해결하고 재검토받아야 한다. 계획은 구현/테스트 결과가 아니며, 이 판정도 실제 배포 상태 판정이 아니다.

## 2. 원 프롬프트 §2.3 질문별 판정

`조건부`는 설계 의도는 있으나 현재 계획의 경계·재현 조건이 부족하다는 뜻이다. ID는 3절의 수정 요구에 연결된다.

| 번호 | 판정 | 코드·계획 근거와 이유 |
|---|---|---|
| 1 | 조건부 | `PC:core/storage/reports_repo.py:190-218`은 원본 `rec.detail`을 저장 전 읽고 override는 merge에 적용한다. `M:lib/services/local_db_service.dart:913-927,956-990`은 저장 중 기존 행·캐시를 합친다. `P:48-50,171`은 사전 DTO를 선언하지만 공식 주소의 보완·불변 직렬화 위치를 두 경로에서 고정해야 한다(S-03, S-16). |
| 2 | **미충족** | `PC:core/database/database.py:469-498`과 `M:lib/services/sync_engine.dart:226-238`은 기존 완료 Y를 증분 상세에서 제외한다. `PC:services/parser.py:6,247-259`의 Y에는 취하·이송도 포함된다. `P:168-169,228-230`의 후속 정정은 정상 증분에서 실제로 발견되지 않을 수 있다(S-12). 단건 경로 `M:lib/services/standalone_auto_sync_service.dart:158-189`도 별도 훅을 요구한다. |
| 3 | 조건부 | `P:102,139,142`가 `getUser`+claims+보안 행렬을 제안하며 `AUTH:server/relay.ts:327-345`에 선례가 있다. 신규 함수는 아직 없으므로 다른 프로젝트 JWT·익명 세션·공개키 단독 거절은 실제 HTTP/DB 행 수로 확인해야 한다(S-18). |
| 4 | 조건부 | `P:82-98,123-127`의 세션 귀속 확인은 옳다. 그러나 연결 전환/재로그인 후 기존 outbox는 `P:183,239`의 현재 연결 일치 조건 때문에 전송 불능이 될 수 있다(S-04). 기존 relay 완료는 연결 등록이 아니다(`AUTH:supabase/migrations/202609251200_community_auth_relay.sql:1-15`). |
| 5 | 조건부 | `MAP:supabase/migrations/202608150001_initial_schema.sql:7-13`은 private를 anon/authenticated에 열지 않는다. `MAP:supabase/functions/public-analytics/index.ts:14-19,30-47`은 public RPC를 service client로 호출한다. `P:92,123,142`는 같은 방식을 제안하지만 신규 RPC의 모든 서명·default privileges·옛 snapshot 쓰기 경로를 검증해야 한다(S-18). |
| 6 | **미충족** | `P:94-95`는 grant→contributor, `P:123-125`는 contributor→grant 순서로 잠근다. 역순 잠금은 동시 철회/ingest deadlock을 만든다. policy/session 변경도 같은 직렬화 순서가 없다(S-09). |
| 7 | **미충족** | event ID/해시 중복과 epoch 비교(`P:126-130`)은 적절하나, 재로그인·takeover 뒤 immutable 행의 예전 연결/epoch를 `P:239`가 걸러 영구 backlog가 된다. 다른 공식 계정의 같은 ID도 현재 fact key와 충돌한다. 모바일 DB 교체 훅도 소유 작업에 없다(`M:lib/services/local_db_service.dart:2722-2758`; S-04, S-05, S-20). |
| 8 | 조건부 | `MAP:supabase/migrations/202608150001_initial_schema.sql:270-281`의 기존 snapshot 활성화는 이전 active를 교체한다. 별도 fact(`P:110-132`)는 이 위험을 피하지만 기존 v2 사실을 무조건 제외하는 전환은 누락 위험이다(S-10). |
| 9 | 조건부 | 동기 DB fact/version 갱신(`P:123-134`)이면 Edge 종료 후 비동기 유실은 없다. `published`도 동기 읽기 모델에서는 가능하지만 `ready` 외 `generated_at`과 RPC/정적 snapshot의 버전 일치가 전제다(`MAP:server/publicHandler.ts:125-139`; S-11). |
| 10 | 조건부 | `P:249-264`에 빌드 주입 계획은 있다. 현재 모바일은 `String.fromEnvironment`를 쓰지만 빌드 전달 여부를 확인해야 한다(`M:lib/services/community_auth_config.dart:20-35`); PC는 기존 `is_upload_allowed`가 `upload_enabled`도 본다(`PC:services/community_auth_service.py:360-363`). 산출물 스캔까지 완료 전에는 통과 아님(S-18). |
| 11 | 적절·검증 필요 | relay는 pre-login이라 `verify_jwt=false`(`AUTH:supabase/config.toml:1-4`), `/complete`만 user token을 추가 확인한다(`AUTH:server/relay.ts:327-354`). `P:100-105,139`의 user-only 분리는 맞다. 배포 config 합성 회귀 테스트 필수. |
| 12 | 적절·검증 필요 | `P:10,59-72`는 auth/map 별도 소유와 합성 migration을 유지한다. 기존 relay의 독립 migration도 이를 뒷받침한다(`AUTH:supabase/migrations/202609251200_community_auth_relay.sql:1-15`). 운영 이력 미확인은 남는다. |
| 13 | **미충족** | 모바일 gate shell 전에 `ReportProvider()..init()`가 실행되고 현재 init이 큐 drain을 시작한다(`M:lib/main.dart:47-55`, `M:lib/providers/report_provider.dart:745-763`). 계획은 이동을 말하지만 실행 guard 위치가 중요하다. PC allowlist에는 실제 설정 복구 POST가 빠졌다(`PC:web/routers/community_route.py:164-172`; S-07). |
| 14 | 조건부 | `PC:main.py:291-300`은 `/api/v1/`, `/media/`, `/ws/`를 기존 HTTP 세션 검사에서 제외한다. `PC:web/routers/rating_route.py:39-41`, `PC:web/routers/crawl.py:101-103`의 WS도 독자 보호가 필요하다. `P:205-210,215-220`은 의도는 있으나 매 route/service/WS 및 활성 연결 검증이 남는다(S-07, S-15). |
| 15 | **미충족** | `PC:core/database/database.py:486-498`의 `force`는 상세 목록 선택 옵션일 뿐, `PC:services/crawl_control.py:42-49,59-61`의 기존 명령 생성에는 `--force` 전달 모드가 없다. 모바일 fullSync는 개인 DB를 제자리 갱신하고 완전 목록이면 부재 신고를 지운다(`M:lib/services/sync_engine.dart:182-185,316-324`). DB 복원은 파일을 교체한다(`M:lib/services/local_db_service.dart:2722-2758`). `P:15,228-232`의 shadow/cutover는 이 코드로는 성립하지 않는다(S-06, S-20). |
| 16 | 조건부 | `P:183,191-192,239-247`의 journal/ACK 보존은 맞다. 기존 스케줄러는 `update_jobs()` 때 전 작업을 삭제한다(`PC:core/utils/scheduler.py:28-43`); 수동/자정이 원본 DB를 읽지 않는 테스트와 재등록 테스트가 필요하다(S-08). |
| 17 | 조건부 | `P:242-247,303`은 정확 자정 보장을 피하고 Client writer를 금지한다. 다만 기존 모바일 Workmanager dispatcher는 로그인 점검만 분기한다(`M:lib/services/background_login_check.dart:11-24`), 현재 앱 `main()`이 이를 초기화한다(`M:lib/main.dart:39-45`). iOS callback/background 등록과 Client 모드 이전 작업 취소가 실제 산출물에서 검증되어야 한다(S-15, S-19). |
| 18 | 조건부 | `P:270-288`에 파일·DB 소유자가 있으나 T3/T4가 PC scheduler 등록 수명주기를 공유하고, T5/T6가 모바일 init/백그라운드 동작을 공유한다. 포트는 분리됐지만 기존 테스트 스택과 CLI 접근을 이 세션에서 검증할 수 없었다(S-08, S-17). |
| 19 | 적절·실행 전 | `P:308-314`에 1차 머지/정리→7일 감사→수정/재검증→최종 머지/2차 정리가 있다. 이는 아직 실행 결과가 아니다. `O:1422-1491`의 정확한 감사 창·merged HEAD 증거를 완료 기준으로 유지한다. |

## 3. 지적 목록

### S-01 · critical · 좌표 결측이 전국 신고량에서 사라짐

- **근거:** `P:132`는 `lat is not null`인 완료 fact만 공개 RPC에 넣는다. 기존 `MAP:server/aggregate.ts:237-255,290-305`는 받은 facts로 신고량·완료량·결측을 계산한다. `MAP:supabase/migrations/202609240001_analytics_v2.sql:104-126`의 기존 RPC에는 좌표 필수 조건이 없다. 원 요구 `O:982-989`는 완료만 업로드할 때 전체 신고 모집단이 부족하면 capability를 낮추라고 한다.
- **문제·영향:** 위치 없는 정상 완료 신고, 완료일 결측 신고까지 KPI·월별·기관·차량 분모에서 통째로 빠진다. 완료 신고만 업로드하면서 `report_count`를 전체 신고량처럼 노출하면 또 다른 과장이다.
- **수정안:** 비공개 사실 전체를 분석 RPC에 넣고 map point 생성에서만 좌표 결측을 제외한다. `report_count` capability는 `공유된 완료 신고의 신고일별 건수`로 명시하거나, 미완료 모집단이 확보될 때까지 전체 신고량을 unsupported/partial로 둔다. 위치 결측 coverage를 별도 제공한다.
- **재현/회귀:** 같은 기간 완료 신고 3건(좌표 1건, 결측 2건)을 넣어 신고/완료/기관 총계 3, 지점 1, 좌표결측 2를 검증한다. 미완료 1건이 원천에 없을 때 전체 신고 대비 비율이 표시되지 않아야 한다.

### S-02 · critical · 철회/삭제 후 과거 fact의 재공개 경계 부재

- **근거:** `P:89,95,132,223,322`는 contributor의 `revoked_at`을 다시 null로 만들고 활성 contributor 조건만으로 기존 모든 fact를 읽으며, 재동의 시 과거 전송분 재공개를 예정한다. 기존 `MAP:supabase/migrations/202609240001_analytics_v2.sql:105-108`도 contributor 활성 여부로 fact를 필터한다. 원 요구 `O:361-374,954-989`는 grant 귀속·철회·삭제/캐시를 구분한다.
- **문제·영향:** 철회 뒤 같은 사용자가 새 grant에 동의하면 이전 grant로 전송한 사실 전체가 별도 선택·검증 없이 다시 공개된다. 삭제 요청으로 제거해야 할 fact와 단순 철회 fact를 구분하는 컬럼/상태가 없다. 동의문 안내만으로 DB 삭제·캐시 무효화 계약을 대체할 수 없다.
- **수정안:** grant generation별 공개 가능 상태와 별도 deletion tombstone을 두고, 재동의의 재공개 범위를 정책·UI·SQL에서 하나로 확정한다. 삭제된 사실은 새 grant로 절대 부활하지 않게 한다. 정적 snapshot/API version 폐기 절차를 포함한다.
- **재현/회귀:** A grant로 2건 공개→철회→정적/동적 조회 제외→새 grant→정책상 허용된 건만 재공개→1건 삭제→재철회/재동의 후에도 삭제 건은 0을 확인한다.

### S-03 · high · 두 SQLite 파일 사이의 저장 성공 상태가 정의되지 않음

- **근거:** `P:12,48-51,176-191,317`은 `community.db` journal/outbox를 먼저 commit하고 개인 DB를 나중에 저장한다. 기존 개인 저장은 `PC:core/storage/reports_repo.py:190-229`에서 건별 실패를 잡아 계속하며, 모바일은 `M:lib/services/local_db_service.dart:913-927`에서 별도 transaction이다. 원 요구 `O:673-695`는 crash 복구를 명시한다.
- **문제·영향:** journal commit 뒤 개인 저장 실패/프로세스 종료 시 중앙에는 관측이 전송되지만 개인 앱에는 신고가 없거나 오래된 상태로 남는다. 재시작 후 같은 공식 응답을 다시 받아야 할지, journal 이벤트를 재사용할지 규칙이 없어 중복 revision/이벤트를 만들 수 있다. 계획의 ‘원자성 충족’ 주장은 성립하지 않는다.
- **수정안:** cross-DB 2PC로 포장하지 말고 `captured → personal_saved → deliverable` 내구 상태와 신고별 recovery reconciliation을 정의한다. 공식 응답 사본으로 개인 저장 재시도가 가능한지, 개인정보 보존 범위 내에서 복구 자료를 무엇으로 유지할지 정한다. uploader wake는 검증된 deliverable 이후로 두거나 개인 저장 실패를 명시적 허용·표시 상태로 분리한다.
- **재현/회귀:** journal commit 직후, 개인 DB transaction 중, commit 직후 wake 전을 강제 종료하고 두 DB/중앙 fact/사용자 UI가 같은 사건을 하나의 event ID로 복구하는지 검사한다.

### S-04 · high · 재로그인·writer takeover 후 pending이 영구 고립

- **근거:** journal은 원 연결/epoch/grant를 고정한다(`P:183`). uploader는 현재 `(connection_id, consent_grant_id)`와 같은 행만 보낸다(`P:239`). rebind는 active 연결의 session만 바꾸고 epoch 유지(`P:96-98`); takeover는 새 연결/epoch를 만든다(`P:96`). 원 요구 `O:350-360,737-747`는 유효한 같은 사용자 재로그인 pending 승계를 요구한다.
- **문제·영향:** 새 세션에서 새 connection을 만들거나 takeover하면 이전 grant가 유효해도 pending이 전송되지 않는다. 이전 epoch 이벤트를 envelope만 새 epoch로 바꾸면 immutable identity/순서가 흔들리고, 예전 epoch 그대로면 신규 writer가 거절한다. 같은 grant의 정상 재로그인과 새 grant/계정의 불허 승계를 구분하지 못한다.
- **수정안:** 우선 같은 사용자·프로젝트·grant의 **동일 connection rebind**를 공식 정상 경로로 만든다. takeover 시 이전 pending의 제출/격리/폐기 정책을 서버가 승인한 receipt와 별도로 정의한다. immutable event 본문·revision과 전송용 session 문맥을 분리하고, 이전 epoch는 최신 fact를 절대 덮지 않되 어떤 ACK를 남길지 확정한다.
- **재현/회귀:** A 세션의 2건 pending→local logout→같은 사용자 재로그인/rebind→두 건 ACK, B 사용자/새 grant에는 0건; 두 기기 takeover와 오프라인 이전 epoch 재전송을 검사한다.

### S-05 · high · 공식 계정 namespace가 중앙 신고 키에 없음

- **근거:** `P:110-116`은 `source_report_key=sha256(source_system|source_report_id)`와 `(contributor_id, source_report_key)` PK다. 로컬에는 `source_account_namespace`가 초기화 범위에 있다(`P:15,188,194`). 원 요구 `O:897-915`는 공식 ID의 전역 유일성을 가정하지 말고 필요한 namespace를 넣으라고 한다.
- **문제·영향:** 한 커뮤니티 사용자가 공식 계정 A/B를 바꾸고 같은 내부 ID가 나오면 B 관측이 A fact를 덮는다. `dataset_key`는 writer 충돌용 클라이언트 주장값(`P:301`)이므로 계정 증명은 아니지만 저장 구분 차원으로 필요하다.
- **수정안:** 검증된 연결에 bound된 source namespace/dataset key를 신고 identity에 포함하고, 계정 전환 시 새 namespace를 발급·확인한다. client 임의 source_report_key는 받지 않는다.
- **재현/회귀:** 동일 사용자, 서로 다른 공식 계정 namespace, 동일 ID의 두 사건이 두 fact가 되는지; 같은 namespace의 재전송만 멱등인지 검사한다.

### S-06 · high · 초기화의 shadow/cutover와 `--force` 호출이 실재하지 않음

- **근거:** `P:15,228-232,323`은 기존 `--force`를 통한 전체 재수집과 staging cutover를 선언한다. 그러나 `PC:services/crawl_control.py:42-49,59-61`의 시작 모드는 full/reset뿐이며, `PC:start.py:21,210`에서만 `--force`를 받는다. `PC:core/database/database.py:486-498`의 force는 기존 title DB 전체를 읽는다. 모바일 `M:lib/services/sync_engine.dart:182-185,281-289,316-324`는 제자리 갱신 후 목록 밖 행을 삭제한다.
- **문제·영향:** 계획대로 기존 명령을 호출하면 완료 신고 상세를 건너뛰고 초기화 성공 marker를 잘못 찍을 수 있다. 모바일은 상세 실패가 있어도 목록 수집 성공 시 부재 행과 연결된 개인 override를 삭제할 수 있다. `community.db` staging만으로 개인 데이터의 원자 cutover가 되지 않는다.
- **수정안:** PC에 별도 rebuild CLI/서비스 인자를 명시해 `--force`를 전달하고 해당 run의 **완전한 공식 목록**만 item으로 등록한다. 모바일 개인 행/override 삭제를 rebuild 검증 이후로 미루거나 orphan 보존한다. staging 범위를 개인 파생 테이블·source 상태·journal과 함께 정확히 정의하고, 불가능하면 안전한 제자리 복구 계약으로 문구를 바꿔 Sol 재검토를 받는다.
- **재현/회귀:** 기존 완료 Y 1건 + 새 1건, 목록 2페이지 중 1페이지 실패, 상세 1건 실패, 앱 crash를 각 단계에 주입해 완료 marker 0·기존 행/override 보존·같은 run resume을 검사한다.

### S-07 · high · PC 필수 게이트가 자신의 설정 복구 POST를 차단

- **근거:** `P:202,205-213`은 config invalid를 fail-closed로 처리하면서 allowlist에 `POST /settings/community/settings`와 기존 `POST /settings/save`를 넣지 않았다. 실제 커뮤니티 공개 설정 변경 경로는 `PC:web/routers/community_route.py:164-172`; 기존 설정 저장은 `PC:web/routers/settings_route.py:130-139`다. 현재 인증 미들웨어는 API/media 전체를 예외 처리한다(`PC:main.py:291-310`).
- **문제·영향:** 설치본에 URL/key가 없거나 잘못되어 K/C 상태 조회가 불가하면 설정을 고칠 유일한 웹 POST마저 게이트가 403으로 막아 영구 잠금이 된다. 새 onboarding route도 미들웨어 순서/세션을 잘못 잡으면 같은 교착이 생긴다.
- **수정안:** 필요 최소 `POST /settings/community/settings` 및 실제 복구 경로를 정확한 method+path로 허용하고 기존 관리자 세션·CSRF를 그대로 강제한다. 일반 `/settings/save`는 민감 범위를 쪼개거나 복구 전용 좁은 경로를 둔다. SessionMiddleware 바깥/안쪽 실행 순서를 ASGI 테스트로 고정한다.
- **재현/회귀:** 설정 누락 상태에서 관리자 로그인→설정 변경 POST 성공→중앙 검증→게이트 통과, 익명/CSRF 실패/임의 설정 API 접근은 거절을 검사한다.

### S-08 · high · 기존 scheduler 설정 저장이 자정 업로드 job을 삭제

- **근거:** `PC:core/utils/scheduler.py:28-43`의 `update_jobs()`는 `scheduler.remove_all_jobs()`를 호출하고 설정이 꺼지면 반환한다. `PC:web/routers/settings_route.py:130-139`는 설정 저장 때 이를 부른다. `P:243,277,284`는 T3가 scheduler.py, T4가 등록 함수만 작성한다고 한다.
- **문제·영향:** T4가 등록한 커뮤니티 자정 job은 서버 설정 저장 한 번으로 사라진다. 기존 크롤링 scheduler.enabled=false면 커뮤니티 업로드 기본 활성 요구도 꺼진다.
- **수정안:** 크롤 job ID만 선택 제거/재생성하고 community 업로드 job은 독립 namespace로 관리하거나 `update_jobs`의 매 호출에서 확실히 재등록한다. `CronTrigger`의 KST 지정과 다중 worker lease를 실제 실행 경로에 연결한다. T3/T4 interface는 구현 전에 합의한다.
- **재현/회귀:** 자정 job 등록→기존 설정 저장(enabled true/false)→job 존속 및 다음 KST due 유지; 서버 재시작·동시 worker에서 1회만 실행을 확인한다.

### S-09 · high · 권한 행 잠금 순서 역전과 policy 변경 경쟁

- **근거:** `P:94-95`는 동의 철회 시 grant를 먼저 `for update`하고 contributor를 갱신한다. `P:123-125`의 ingest는 contributor→grant→connection을 `for share`로 잠근다. `P:77-81`의 policy는 필수 version 정본인데 ingest의 잠금/버전 일관성 계약에는 없다. 기존 contributor 변경 트리거는 analytics_state를 갱신한다(`MAP:supabase/migrations/202609240001_analytics_v2.sql:53-69`).
- **문제·영향:** ingest가 contributor를, revoke가 grant를 먼저 잡으면 상호 대기 후 DB가 한 요청을 abort한다. 정책 버전 변경 중에는 구 grant 수락과 새 policy의 엇갈린 판정이 가능하다.
- **수정안:** account/ingest/revoke/takeover 모든 RPC에 같은 잠금 순서(policy→contributor→grant→connection→fact→analytics_state)를 명시하고 SQL 테스트로 강제한다. deadlock SQLSTATE는 제한적 재시도/정상 사용자 오류로 매핑한다. policy version을 저장 시점 같은 transaction에서 판정한다.
- **재현/회귀:** 두 세션에서 철회/ingest, takeover/ingest, policy update/ingest를 반복해 deadlock 없음, 철회 commit 이후 accepted 0, 항상 일관된 grant version을 검사한다.

### S-10 · high · 기존 v2 데이터 무조건 제외와 `ready` 의미 변경의 무검증 전환

- **근거:** `P:132-134,318`은 `report_facts_v2`를 공개 소스에서 제거하며 ‘운영 데이터 없음’을 문서로 추정한다. 기존 RPC는 active snapshot의 v2 facts를 읽는다(`MAP:supabase/migrations/202609240001_analytics_v2.sql:104-126`), 상태 무효화는 `ready=false`로 한다(`MAP:supabase/migrations/202609240001_analytics_v2.sql:52-74`). 공개 handler는 ready와 generated_at을 둘 다 요구한다(`MAP:server/publicHandler.ts:125-139`).
- **문제·영향:** 운영 DB에 기존 v2 fact가 한 건이라도 있으면 migration 적용 순간 공개 지도에서 사라진다. 트리거 의미만 바꾸면 이전 데이터 삭제/철회 시 오래된 정적 snapshot과 live 결과가 달라질 수 있다. migration 설명의 ‘운영 데이터 없음’은 확인되지 않은 가정이다.
- **수정안:** rollout 전에 실제 DB의 각 계열 건수·user/dataset별 coverage를 읽기 전용으로 확인한다. contributor/dataset별 authoritative source와 중복 제거 범위를 저장하고, backfill/cutover/rollback 조건을 명시한다. `ready`, `generated_at`, `dataset_version`, static snapshot 폐기 규약을 하나의 테스트 가능한 상태기계로 만든다.
- **재현/회귀:** 기존 v2 2건+신규 ingest 1건, 동일 신고/다른 신고, 철회/재동의/삭제를 합성 DB에 만들고 migration 전후 익명 API 총계와 static version을 검사한다.

### S-11 · medium · `published` ACK의 공개 가시성 조건이 불완전

- **근거:** `P:129-134`는 fact 변경과 `ready=true`면 `projection_status=published`를 반환한다. 현재 공개 API는 state를 읽은 뒤 별도 RPC로 facts를 조회하고 JS에서 집계한다(`MAP:supabase/functions/public-analytics/index.ts:30-49`; `MAP:server/publicHandler.ts:125-148`). `MAP:src/data/client.ts:33-43,72-79`는 version이 같은 정적 snapshot을 우선 읽는다.
- **문제·영향:** 새 fact를 동기로 조회하는 현재 구조에서는 commit 직후 공개가 가능하다. 그러나 `ready=true`만으로는 `generated_at`과 신규 RPC 가용성까지 증명되지 않으며, 정적 snapshot이 새 version을 이미 갖는 경우의 일관성도 계약되지 않았다. 이 조건이 빠지면 앱이 ‘지도 반영 완료’를 잘못 보여준다.
- **수정안:** `published`의 의미를 ‘동일 version의 익명 공개 API가 커밋된 fact를 읽을 수 있음’으로 고정한다. migration/rollout 때 `ready`, `generated_at`, RPC source, snapshot version을 함께 검증한다. 미충족이면 `held` 또는 `pending`으로 ACK하고 receipt별 상태 조회를 제공한다.
- **재현/회귀:** fact commit 직후 새 공개 RPC/old RPC/ready false/generated_at null/static version mismatch를 각각 주입해 ACK와 익명 API 결과가 일치하는지 검사한다.

### S-12 · high · 완료 후 재개/취하를 일반 증분에서 발견하지 못함

- **근거:** `PC:core/database/database.py:469-498`은 종결 Y 상세를 건너뛴다. `M:lib/services/sync_engine.dart:220-238`은 목록을 갱신해도 기존 Y는 상세 대상에서 제외한다. `PC:services/parser.py:6,247-259`는 이송·취하도 Y로 만든다. `P:168-169`는 후속 공식 관측이 생기면 correction을 만든다고만 한다.
- **문제·영향:** 목록상 완료→재개/취하/보완으로 바뀌어도 상세를 안 받아 오래된 완료 fact가 지도에 남는다. 최초 초기화 한 번 이후의 정상 증분 경로에서 발생한다.
- **수정안:** 로컬 source 상태와 새 공식 **목록 상태의 변화**를 비교해 Y였더라도 상세 재조회 대상으로 넣는다. 목록만으로 tombstone을 만들지 말고 상세 확인 실패는 stale/재시도 표시한다. PC·Dart 동일 fixture로 묶는다.
- **재현/회귀:** Y 수용→목록 진행/취하→상세 처리중/취하, 상세 403, 사용자 override Y 변경을 각각 넣어 요청 선정·정정 event·실패 시 기존 fact 상태를 검증한다.

### S-13 · high · 10분 성공 캐시가 ‘즉시 게이트 복귀’와 충돌

- **근거:** `P:11,199-201`은 성공 캐시를 10분 유지하고 네트워크 실패 시 유효 캐시로 계속 진입시킨다. 원 요구 `O:361-374,375-400`은 철회·정지·계정 변경을 즉시 재평가하고 일반 기능으로 복귀하지 못하게 한다. 기존 PC `main.py:291-310`은 아직 세션만 검사한다.
- **문제·영향:** 다른 기기에서 철회/정지한 직후에도 최대 10분 또는 현재 열린 화면 동안 개인 앱 기능이 계속 동작할 수 있다. ingest 저장은 서버가 차단하더라도 필수 진입 정책은 지켜지지 않는다.
- **수정안:** ‘즉시’의 탐지 가능한 범위와 지연 상한을 사용자 요구에 맞게 명시한다. 로컬 철회/로그아웃은 동기 무효화; 앱 resume·새 작업·민감 route에서 중앙 재검증; 원격 철회는 push/짧은 poll 또는 fail-closed 정책을 정한다. 성공 캐시를 기능 시작의 유일한 권한 근거로 쓰지 않는다.
- **재현/회귀:** A 기기에서 gate 통과→B 기기 철회→A 열린 화면·API·예약 작업/오프라인 진입을 시간 제어로 검사하고 허용 지연을 기록한다.

### S-14 · medium · 계약 필드와 기존 공개 지표 매핑 미완성

- **근거:** `P:160-171` payload는 `amount`를 넣지만 벌점 필드가 없고 `disposition`은 `fine|penalty|warning|none|unknown`이다. 원 요구 `O:652-669`는 벌점 및 구분 불가 처분을 요구한다. 기존 문서는 `warning_or_penalty|other`도 열거한다(`MAP:docs/data-contract.md:14-23`); 실제 SQL/TS는 다르다(`MAP:supabase/migrations/202609240001_analytics_v2.sql:13`; `MAP:server/aggregate.ts:8-10,249-250,281-286`).
- **문제·영향:** 원천의 벌점과 ‘과태료 또는 범칙금’ 미확정값을 소실하거나 fine으로 오분류할 수 있다. 금액을 저장해도 공개 code는 fine_amount capability를 항상 missing으로 낸다.
- **수정안:** 문서/SQL/TS/업로드 enum 교차표를 정본화하고 `confirmed_fine`, `combined`, `penalty_points`의 원천 근거·public capability를 정한다. 원천 미지원이면 null/unsupported로 남긴다.
- **재현/회귀:** 확정 과태료, 범칙금, combined, 경고, 벌점만 있는 응답의 Python/Dart/TS DTO와 월별 fine_count/금액 capability를 대조한다.

### S-15 · medium · 날짜별 schedule key에 소유 범위가 없어 계정 전환 충돌

- **근거:** `P:14,187,242`의 `schedule_runs.schedule_key` PK는 `midnight:YYYY-MM-DD`뿐이다. 원 요구 `O:759-773`은 날짜·사용자·데이터셋·writer별 유일성을 요구한다. 모바일은 모드 전환 시 background job을 관리한다(`M:lib/services/background_login_check.dart:74-103`).
- **문제·영향:** 같은 로컬 DB에서 계정/공식 데이터셋/writer가 날짜 중 바뀌면 이전 사용자의 succeeded 행이 새 사용자 자정 업로드를 생략한다. 이전 계정 실행 상태가 UI에도 섞일 수 있다.
- **수정안:** schedule PK에 project namespace, contributor, dataset, writer epoch를 포함하고 UI 조회도 현재 context에 한정한다. Client 전환 때 Standalone job은 해제하고 서버 writer job만 보이게 한다.
- **재현/회귀:** 같은 KST 날짜에 A→B 계정/데이터셋 전환, Standalone→Client 전환 후 각각 due가 독립이며 이전 token으로 POST 0건인지 검사한다.

### S-16 · medium · e7 좌표 직렬화가 원좌표를 변경할 수 있음

- **근거:** `P:152,166,131`은 좌표를 `lat_e7/lng_e7` 정수로 제한하고 이를 point key로 사용한다. 고정 공개 규칙은 원 좌표 그대로다(`PROJECT_RULES.md:8`; `MAP:server/aggregate.ts:23-25,159-163`). 기존 v2 SQL 좌표는 double이다(`MAP:supabase/migrations/202609240001_analytics_v2.sql:16-20`).
- **문제·영향:** 입력이 소수 8자리 이상이면 e7 반올림/절삭으로 바뀐다. 값의 오차가 작더라도 ‘정확한 입력 좌표’ 정책과 달라지고 근접 지점 두 개가 하나의 key로 합쳐질 수 있다.
- **수정안:** 공개 lat/lng는 수집 당시 원 좌표를 보존하는 lossless decimal 규약으로 직렬화한다. point key 양자화가 필요하면 위치 그룹 규칙으로 별도 명시하고 공개 좌표를 그 key에서 복원하지 않는다.
- **재현/회귀:** 37.12345678, 127.12345678과 인접 8자리 좌표 두 건을 Python/Dart/TS 왕복해 동일 값·독립 지점인지 확인한다.

### S-17 · medium · 병렬 소유 표가 runtime 파일 충돌을 완전히 막지 못함

- **근거:** `P:276-285`은 T3가 `scheduler.py`·`start.py`, T4가 scheduler 등록 함수·`reports_repo.py`, T5가 `ReportProvider.init`, T6가 Workmanager dispatcher/수집 루프를 담당한다. 실제 `PC:core/utils/scheduler.py:28-43`, `M:lib/main.dart:39-55`, `M:lib/providers/report_provider.dart:745-763`에서 등록과 실행 수명주기가 같은 코드 경계에 걸친다.
- **문제·영향:** 파일 충돌은 없어도 각 분기에서 서로 다른 게이트/스케줄 API를 전제하면 merge 뒤 job 누락·중복·게이트 전 실행이 생긴다. 계획의 ‘파일 single writer’만으로 통합 안전이 보장되지 않는다.
- **수정안:** T0 계약에 `register/unregister/recheck` 함수 시그니처, scheduler job ID, gate 서비스 인터페이스, callback 호출 순서를 고정하고 양쪽 작업서에 같은 commit을 전달한다. 통합 스택/포트/DB는 Opus만 쓰며 merged HEAD에서 수직 테스트한다.
- **재현/회귀:** T3+T4, T5+T6 병합 후 설정 저장·앱 cold/warm start·철회·자정 due를 한 테스트에서 실행한다.

### S-18 · high · 보안 테스트 계획의 프록시/IP 및 구형 경로 범위 부족

- **근거:** `P:135`는 `cf-connecting-ip`가 없으면 `x-forwarded-for` 첫 값을 쓴다. 현재 공개 API에도 같은 패턴이 있다(`MAP:supabase/functions/public-analytics/index.ts:22-27`). 원 요구 `O:835-845`는 임의 X-Forwarded-For 신뢰를 금지한다. 기존 snapshot mutating RPC도 남아 있다(`MAP:supabase/migrations/202608150001_initial_schema.sql:215-292`).
- **문제·영향:** gateway가 헤더를 덮어쓴다는 실제 증거가 없으면 공격자가 IP bucket을 바꿔 rate limit을 우회할 수 있다. 신규 ingest만 시험하고 구형 경로의 역할 권한을 보지 않으면 업로드 권한 우회를 놓친다.
- **수정안:** 배포 gateway에서 신뢰하는 헤더를 실제 request 관측으로 확정하고 불명확할 때는 헤더를 신뢰하지 않는 계정/연결 기반 한도를 기본으로 둔다. 구형 snapshot RPC·Storage·GraphQL·Realtime까지 직접 호출 음성 테스트와 DB 행 수 검증을 포함한다.
- **재현/회귀:** 동일 사용자·IP에서 XFF를 매번 바꿔도 한도 초과, 공개키/익명/authenticated로 구형 mutating RPC 호출 시 쓰기 0, 정상 익명 지도 GET 유지 여부를 검사한다.

### S-19 · high · iOS OAuth 복귀 경로가 구현 작업에서 빠짐

- **근거:** `M:lib/services/community_auth_config.dart:15-18`은 `com.fentanest.mysafetyreport://auth/callback`을 고정한다. 하지만 `M:ios/Runner/Info.plist:1-75`에는 `CFBundleURLTypes`가 없다. `P:245,279`는 iOS background 항목을 T6에 주지만 OAuth URL scheme과 cold/warm callback 수신의 소유·검증을 명시하지 않는다. 원 요구 `O:319-327,1008-1020`은 iOS 수신 설정을 확인·적용하도록 한다.
- **문제·영향:** iOS에서 카카오 인증 뒤 앱으로 돌아올 수 없으면 필수 K 게이트가 영구 교착된다. background 업로드만 구현해도 이용자가 초기 진입을 못 한다.
- **수정안:** iOS URL scheme/host/path를 실제 `Info.plist` 및 앱 delegate/plugin 수신 경로에 연결하고 T5/T6 중 단일 소유자를 지정한다. 지원되지 않는 iOS 환경이면 코드·단위 테스트와 실기기 미검증 상태를 분리한다.
- **재현/회귀:** iOS simulator/가능한 기기에서 OAuth callback URI cold/warm open→PKCE state 검증→게이트 완료; 잘못된 state/중복 callback은 실패를 확인한다.

### S-20 · high · 모바일 DB 교체/모드 전환과 community.db 세대 변경 훅이 누락

- **근거:** `M:lib/services/local_db_service.dart:2722-2758,2920-2935`는 기존 개인 DB를 실제 파일 교체 또는 서버 DB import로 바꾼다. `M:lib/screens/settings_screen.dart:563-619`가 이를 호출한다. `P:194`는 백업 복원/공식 계정 변경 시 local_dataset_id 재발급을 선언하지만 T5/T6 소유 파일(`P:278-279`)에 `local_db_service.dart` 교체·import 훅이 없다.
- **문제·영향:** 개인 DB가 새 데이터셋이 되었는데 community.db의 완료 marker·source journal·sequence·현재 writer가 그대로면 새 초기화를 생략하거나 이전 계정 사본을 계속 전송할 수 있다. 반대로 무작정 세대 초기화하면 미ACK 근거가 소실된다.
- **수정안:** 파일 교체/서버 DB import/모드 변경의 단일 transactional intent를 community store에 기록하고 개인 DB 교체 성공 후 dataset identity를 회전한다. 이전 journal은 원 귀속으로 격리·보존하며 새 DB의 초기화를 요구한다. T5/T6와 `local_db_service.dart`의 소유자를 지정한다.
- **재현/회귀:** A DB에 pending 1건→B 백업 복원 및 서버 import→A pending은 B 토큰으로 0건, B에 초기화 필요, rollback 때 A identity 복구를 검사한다.

### S-21 · high · 모바일 온보딩 순서가 계획 내부에서도 충돌

- **근거:** `P:43-44`는 gate→PermissionScreen→SetupScreen으로 적고, `P:215-217`은 gate→SetupScreen→PermissionScreen으로 적는다. 현재 `M:lib/screens/setup_screen.dart:75-90,123-127,150-159`는 서버/Standalone 설정 뒤 PermissionScreen으로 이동한다. 원 요구 `O:402-423`은 gate를 권한 안내보다 먼저, 그 뒤 기존 권한 흐름과 필수 설정을 명시한다.
- **문제·영향:** 작업자가 서로 다른 화면 순서를 구현할 수 있다. `PermissionScreen`은 `ReportProvider.appMode`로 필수 권한을 판정한다(`M:lib/screens/permission_screen.dart:70-75`); 설정 전 화면으로 옮기면 모드 판정이 미정이다. 반대로 setup을 gate 밖에 두면 설정 중 저장·백그라운드 작업이 gate를 우회한다.
- **수정안:** K/C gate→mode-independent 권한 안내→모드 설정이라는 제품 순서를 하나로 확정하고, PermissionScreen의 모드 의존 판정은 모드 선택 뒤 단계로 분리한다. 기존 설정 중 네트워크/DB 작업은 게이트 이후로만 시작한다.
- **재현/회귀:** 새 설치·기존 사용자·Client/Standalone 각각에서 첫 프레임, OS 권한 팝업 시점, mode 미선택 상태, Back/딥링크 복귀를 widget/플랫폼 테스트로 검증한다.

## 4. 계획 §15의 일곱 가정 판정

| 가정 | 판정·반박 |
|---|---|
| 1. journal 선 commit | **불충분(S-03).** 공식 사본을 보존한다는 장점은 있으나 개인 저장과 원자적이지 않다. 개인 저장 실패 뒤 deliverable/복구 상태를 따로 계약해야 한다. `P:317`, `PC:core/storage/reports_repo.py:221-229`. |
| 2. analytics RPC 교체·invalidate 의미 변경 | **기각(S-01, S-10, S-11).** `lat is not null`과 완료 전용 모집단은 현재 dashboard 분모를 바꾼다. 기존 v2 자료 미존재는 입증되지 않았다. `P:132-134`, `MAP:server/aggregate.ts:237-255`, `MAP:supabase/migrations/202609240001_analytics_v2.sql:52-74`. |
| 3. auth의 map contributor_profiles 갱신 | **조건부(S-02, S-09, S-10).** 한 DB에 한 profile writer라는 방향은 맞지만 migration 의존·lock 순서·철회 트리거·deletion semantics를 auth/map 공동 테스트로 증명해야 한다. `P:89-98`, `MAP:supabase/migrations/202608150001_initial_schema.sql:15-26`. |
| 4. ingest마다 getUser + auth.sessions | **조건부.** GoTrue 호출은 세션 폐기 감지를 개선하지만 가용성·지연을 추가한다. 현재 relay 선례가 있다(`AUTH:server/relay.ts:334-345`). SQL 마지막 확인은 `auth.sessions` 존재뿐 아니라 policy/grant/connection과 같은 commit 시점 잠금·오류 처리(S-09)가 필요하다. GoTrue 장애에서는 수집을 보존하고 업로드를 retry해야 한다. `P:102,123-125,320`. |
| 5. writer takeover/rebind | **기각(S-04, S-05).** 새 연결/epoch와 예전 outbox의 귀속이 충돌한다. 동일 user 재로그인 rebind, 다른 user/grant 거절, 이전 epoch 백로그 ACK 의미를 먼저 고정해야 한다. `P:96-98,183,239,321`. |
| 6. 철회 후 재동의 과거분 재공개 | **기각(S-02).** 동의문 명시만으로 삭제 tombstone/과거 grant별 공개 범위/캐시 폐기를 구현할 수 없다. 재공개 정책 자체는 제품 결정으로 확정할 수 있으나 SQL과 삭제 예외를 동시에 정의해야 한다. `P:132,223,322`. |
| 7. 기존 `--force`+checkpoint+staging | **기각(S-06).** 호출 경로에 `--force`가 연결돼 있지 않고 개인 DB는 제자리 갱신된다. 커뮤니티 DB marker cutover는 전체 데이터 shadow cutover가 아니다. `PC:services/crawl_control.py:42-49`, `M:lib/services/sync_engine.dart:182-185,316-324`. |

## 5. `plan-final` 전에 반드시 고칠 것

1. **S-01/S-02:** 공개 모집단·좌표 결측·철회/재동의/삭제 tombstone과 static version 폐기를 SQL/DTO/fixture로 확정한다.
2. **S-03/S-04/S-05:** cross-DB crash 상태, 재로그인·takeover pending, 공식 계정 namespace와 event identity를 하나의 상태기계로 확정한다.
3. **S-06/S-07/S-08/S-19/S-20/S-21:** 실제 PC `--force` 연결, 모바일 삭제/override 보존·DB 교체 세대 훅·온보딩 순서·iOS callback, 설정 복구 allowlist, 자정 job 수명주기를 코드 호출 경로에 맞춰 다시 작성한다.
4. **S-09/S-10/S-12/S-13/S-18:** SQL 잠금 순서·운영 v2 전환 조건·완료 후 상태 변경 감지·게이트 지연 상한·신뢰 프록시 및 구형 RPC 공격 테스트를 계획에 반영한다. S-11의 공개 ACK 조건도 같은 계약 검증에 포함한다.
5. 각 critical/high의 재현 테스트를 acceptance ID와 작업 소유자에 매핑하고, 실제 로컬 Supabase/merged HEAD 검증 전에는 해결로 닫지 않는다. 이 세션의 Supabase CLI/Docker 실패는 Opus 환경의 실행 성공 근거로 대체할 수 없다.
