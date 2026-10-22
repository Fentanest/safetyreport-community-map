# 작업지시서 · 1회 전송 재개·진행/설정 보고·점검 스위치·필수 버전·Client 계정 일치·앱 공지·운영 콘솔·대시보드·레포 분리 (2026-10-22)

request_mode: **구현**. 담당: Claude 에이전트 7개(0-2 분배). 검수·통합: 메인 Claude Opus 가 단계마다 검수하고 여섯 레포를 한 번에 커밋한다.
(2026-10-22 사용자: Sol 사용량 없음 → 난이도에 따라 Opus·Sonnet 에 나눠 맡긴다.)
배경: 2026-10-21 정책 `2026-10-21.1` 전환 뒤 하루 동안, 새 동의자 23명 중 원본(JSON)을 보낸 사람은 11명이다.
모바일은 1회 일괄 전송(`raw_backfill`)이 사실상 아무에게서도 끝나지 않았고, PC 도 5명 중 2명이 중간에 멈췄다(아래 0-1).

## 0. 작업 공간
`/home/better0101/projects/backfill-resume-ws` 아래 여섯 폴더, 모두 branch `feat/backfill-resume`.

| 폴더 | 레포 | 기준 |
|---|---|---|
| `map/` | safetyreport-community-map (Edge·Postgres·계약) | main `123092c` |
| `pc/` | safetyreport (PC/Docker 서버, Python) | dev `dda96e7`, VERSION 3.6.1 |
| `mobile/` | safetyreport-mobile (Flutter) | main `1a74536d`, 출시 2.5.0+179 |
| `auth/` | safetyreport-community-auth (카카오 인증·동의·계정 API) | main `5c6c2be` |
| `parser/` | **새 비공개 레포** `Fentanest/safetyreport-community-parser` (파서 워커) | 지도 main `123092c` 의 `server/parser-py/` 를 이력째 분리(`git subtree split`) |
| `ops-console/` | **새 비공개 레포** `Fentanest/safetyreport-ops-console` (운영 콘솔, 2-14·2-15) | 빈 레포(README 만) |

- 두 새 레포는 검수자가 에이전트 시작 **전에** GitHub 비공개로 만들고 위 기준으로 push 한 뒤 worktree 를 만든다(사용자 지시 2026-10-22).
  지도 레포는 공개라서 운영 콘솔 코드는 지도 레포에 두지 않는다. 파서도 이 레포로 옮긴다(공개 레포의 과거 이력에 남은 파서 코드는 그대로 남는다).
- 파서 분리에 따른 지도 쪽 일: `server/parser-py/` 삭제, 자리에 새 레포를 가리키는 짧은 README, `.github/workflows/product-check.yml` 의
  파서 시험 줄 제거(파서 레포에 같은 시험 CI 를 둔다), 파서 경로를 참조하는 스크립트·문서(`scripts/raw-ingest/`, MANIFEST, 배포 문서) 전부 갱신.
  지도↔파서 사이의 계약 사본 검사(파서 MANIFEST·PC 파서 일치 검사)는 파서 레포 쪽 스크립트로 옮기고, 지도에는 사본 위치만 적는다.
- 처리기관-지역 목록(`shared/agency-region-registry/`)은 지도 레포에만 둔다(사용자 결정 2026-10-22). 파서 레포는 사본을 갖지 않고,
  **빌드할 때마다 지도 공개 레포에서 내려받는다**: Docker 빌드 인자 `MAP_REF`(지도 커밋, 기본값은 파서 레포 `deploy/map-ref` 한 줄 파일)로
  GitHub 에서 그 커밋의 `shared/agency-region-registry/` 만 받는다. 받은 파일을 지도 레포의 해당 MANIFEST 해시와 비교해 다르면 빌드 실패.
  파서 레포 CI 도 같은 방식으로 받아 시험한다. 워커 기동 때 DB singleton 의 registry 버전과 맞추는 기존 검사는 그대로.
- DB 스키마(migration, 운영 콘솔용 `security definer` 함수·`ops_admins`·이력 표)는 그대로 **지도 레포 migration** 에 둔다. 콘솔 레포에는 앱 코드만.

- 각 레포의 `AGENTS.md`·`PROJECT_RULES.md` 를 먼저 읽는다. 지도 레포는 `.agents/skills/` 의 `cm-contract-metrics`,
  `cm-public-privacy`, `cm-static-supabase`, `cm-release-verification` 도 읽는다.
- 앞 작업의 정본: `map/docs/implementation/raw-json-ingest-20261021/PLAN.md`(7-2 1회 전송, 7-4 게이트). 이 지시서가 바꾸는 곳은 PLAN 에도 반영한다.
- **커밋하지 않는다**(검수자가 커밋). 로컬 네트워크·docker·로컬 Supabase 시험은 써도 된다(206·205 등 원격 서버 접속은 금지).
  로컬 Supabase 를 띄우면 끝난 뒤 내리고, 다른 에이전트와 포트가 겹치지 않게 보고서에 쓴 포트를 쓴다.
- 모바일 빌드·시험은 Flutter 3.47.5 를 쓴다(PATH 의 3.41.6 아님).

### 0-1. 운영 관찰 (2026-10-22 13:40 KST, 206 읽기 조회)
- 새 동의 23명 중 원본 0건 12명은 전원 모바일. 동의 뒤 전송 함수 호출이 한 번도 없다(`community_connections.last_seen_at` 비어 있음).
- 원본이 온 모바일 6명도 `trigger=raw_backfill` 이벤트는 모바일 전체 26건뿐(대부분 realtime·recovery). 2,800건 중 2건 같은 비율.
- PC: 2,910/2,910, 1,622/1,622 는 완료. 134/328(10-21 14:58 UTC 이후 호출 없음), 1,123/5,086(10-21 22:47 이후 호출 없음)은 멈춤.
- 1명은 구버전 2.4.1 로 새 동의문에 동의하고 v1 만 보낸다(구버전도 중앙 동의문으로 동의할 수 있다).
- 1명은 `granted_via=mobile_client` 로 가입 14초 뒤 동의했고 연결이 0건이다. 그런데 `mobile_client` 활성 동의 5건이 모두 카카오 가입
  9~18초 뒤(새 설치 첫 실행)이고, 그중 3건은 1분~수 시간 뒤 Standalone 연결이 생겨 휴대폰이 직접 올렸다(최대 1,861건).
  새 설치 첫 실행에서 동의 표시가 잘못 붙는 버그로 본다(2-5 의 첫 실행 모드 항목). 연결 0건인 2명은 Client 인지,
  Standalone 을 골랐는데 공식 계정 설정 전에 멈춘 것인지 서버에서 가를 수 없다.
- 기기 안의 진행 상태를 서버에서 볼 방법이 없어 원인을 단계별로 가를 수 없다 → 1번이 먼저다.

### 0-2. 담당과 순서
| 단계 | 담당 | 모델 | 작업 폴더 | 범위 |
|---|---|---|---|---|
| 1 | **A 서버** | Opus | `map/`, `auth/` | 지도·auth 의 migration·Edge·계약 전부: 2-1, 2-7, 2-9, 2-10(서버·버전 기록·지도 웹 판정 API), 2-11(표·Edge·계약), 2-14·2-15 의 DB 함수·`ops_admins`·이력 표, 2-16 지도·auth 링크, 지도 레포의 파서 제거(0절). 지도 웹 화면 변경(점검 배너·필수 버전 안내 화면)도 A. **규칙 문서** `map/docs/implementation/backfill-resume-20261022/CLIENT-RULES.md`(2-2 오류 분류표·보류 간격, 2-3 초기화 표, 2-9 중지 처리, 2-10·2-5 잠금 판정, 2-1·2-7 보고 시점, 2-11 공지 응답 형식)를 만든다 — B·C·D·E 는 이것만 보고 구현한다 |
| 1 (병렬) | **G 파서** | Sonnet | `parser/` | 0절 파서 레포: `MAP_REF` 로 목록 내려받기·해시 검사, CI, Dockerfile·compose 예시, README, 계약 사본 검사 스크립트 이전 |
| 2 | **B 모바일 핵심** | Opus | `mobile/` | 2-2, 2-3, 2-4, 2-5, 2-9 앱 동작, 2-10 앱 잠금, 그리고 D 가 만든 위젯·서비스를 화면에 연결(`main.dart`·게이트·설정 화면은 B 만 쓴다) |
| 2 | **C PC 핵심** | Opus | `pc/` | B 와 같은 항목의 PC 쪽(2-5 는 문서만), 관리자 웹 화면 연결 |
| 2 | **D 모바일 주변** | Sonnet | `mobile-ui/` | 2-1·2-7 보고 전송 서비스, 2-8 알림, 2-11 공지 가져오기·팝업 위젯, 2-16 `support_links.dart`, 2-6 모바일 확인. **새 파일 위주**, 기존 파일은 `support_links.dart`·사진 보조 값 자리만 |
| 2 | **E PC 주변** | Sonnet | `pc-ui/` | 2-1·2-7 보고 전송, 2-8 웹 안내 배너, 2-11 공지(서버가 받아 관리자 화면 팝업), 2-6 사진 표시 수정, PC 문의 링크. 화면 템플릿은 새 부분 파일로 만들고 연결은 C |
| 2 | **F 운영 콘솔** | Sonnet | `ops-console/` | 2-14, 2-15 앱 전체(화면·세션·CSRF·카카오 로그인·Docker·문서), 2-12 공지 파일 두 개(`announcements/`), 출시 목록 `config/releases.json`. DB 는 A 의 함수만 부른다 |
| 3 | 검수자 | Opus(메인) | 전체 | 합치기(B←D, C←E), 로컬 Supabase 통합 시험, 먹통 회귀 확인, 2-13 문구 표 검토, 커밋 |

- 2단계는 1단계 검수(계약·규칙 문서 고정) 뒤에 시작한다. 같은 레포의 핵심·주변 담당은 작업 폴더가 다르다(같은 branch 이름 아래 `-ui` 접미사 branch).
  담당이 아닌 파일을 고쳐야 하면 고치지 말고 보고서 "요청" 절에 적는다.
- 각 에이전트는 자기 보고서(`<에이전트>-REPORT.md`, 지도 레포 경로지만 **자기 작업 폴더 안에 쓰고** 검수자가 옮긴다)에 4절 내용을 쓴다.

## 1. 금지
- 206/205 등 원격 서버 접속·쓰기, migration 원격 적용, Edge·Pages 배포, 앱 릴리스·스토어 업로드, push·PR.
- 여섯 작업 폴더 밖 파일 쓰기(원래 checkout 포함). 호스트·global·Codex 설정 변경.
- `git reset --hard`·`git clean`·force push·브랜치 삭제, 비밀값 출력, broad pkill.
- 실데이터를 저장소에 넣기. 시험 자료는 합성.
- 버전 번호(PC `VERSION`, 모바일 `pubspec.yaml`)는 올리지 않는다. CHANGELOG/릴리스 노트에 "미출시" 항목만.
- 문서·주석에 해시 기호 바로 뒤 숫자를 붙이는 표기(PROJECT_RULES).
- 보조 값(별점·촬영 시각)을 원본과 따로 보내는 구조 변경(논의된 6번)은 **이번 범위가 아니다.**

## 2. 범위
PC·모바일은 같은 규칙, 호출 지점 1:1. PC `services/community_raw_backfill.py`·`community_raw_backfill_runtime.py`,
모바일 `lib/community/raw_backfill.dart`·`raw_backfill_runtime.dart` 가 짝이다.

### 2-1. 진행 상태 보고 (지도 + PC + 모바일)
목적: 멈춘 기기가 어느 단계·어떤 이유로 멈췄는지, 어느 앱 버전인지 서버에서 보이게 한다.
**전송을 한 번도 못 한 기기도 보고해야 한다** — 그래서 ingest 호출에 얹지 않고 따로 부른다.

- 지도 계약 `contracts/community-ingest-v2/`: `progress.schema.json` 추가(+README·MANIFEST·벡터). 내용은 개수·상태 코드만, 신고 ID·본문·URL 금지.
  - `client_version`, `parser_version`, `source_app`, `platform`
  - `backfill`: `state`(`waiting_optimize|listing|filling|uploading|paused|holds|done|none`), `phase`, `reason`(멈춤 이유 코드),
    `next_attempt_at`, 개수(`total`, `stored`, `queued`, `pending`, `holds`, `raw_unavailable`, `not_eligible`), `run_started_at`, `updated_at`
  - `optimize`: 필요 여부·진행 여부·보류만 남음 여부
  - `official_login`: `ok|retry|manual_required`
  - 모바일만: `foreground_slices_today` 같은 진행 속도 지표 1~2개(설계 재량, 근거를 보고서에)
- Edge `community-ingest`: `POST /community-ingest/progress`. 인증은 ingest 와 같다(사용자 세션 + `connection_id` + 세션 일치).
  동의가 outdated 여도 받는다(구버전 판단용). revoked·연결 없음이면 거부.
  저장만 하고 다른 상태를 바꾸지 않는다. 같은 연결에서 1분에 1번 넘게 오면 429. 본문 4KB 한도.
- migration(번호는 `202610210100` 뒤): `private.community_connections` 에 `last_progress jsonb`, `last_progress_at timestamptz`.
  `last_client_version`·`last_seen_at` 도 여기서 갱신한다. 공개 경로·`authenticated` 노출 금지.
- 운영 확인용 SQL 을 `map/docs/operations/` 에 하나 둔다(연결별 마지막 진행 상태, 원본 수, 사실 수).
- PC·모바일: 1회 전송 marker 가 바뀔 때마다 보내지 않는다. 앱 시작·게이트 통과 뒤 1회, 상태가 바뀔 때, 진행 중이면 10분마다(PC 는 15분).
  백그라운드 isolate(모바일)에서도 보낸다. 실패는 조용히 넘기고 재시도하지 않는다(다음 주기에 보냄).
  `done` 이 된 뒤에는 하루 1번만.

### 2-2. 보류 자동 재시도 (PC + 모바일)
- 지금: 같은 신고가 3번 실패하면 `hold`, 사용자가 '다시 시도'를 눌러야만 움직인다. 실패하면 15초 뒤 다시 시도해서
  30초 남짓의 네트워크 끊김으로도 보류가 된다. 업로드 확인이 3번 `retry` 면 `not_eligible`/`upload_rejected` 로 영구 제외된다.
- 바꿀 것:
  1. 오류를 둘로 나눈다. **일시적**(네트워크·시간 초과·5xx·429·`result` 없는 응답·`sync_busy`·DB 잠김)과 **고정적**(파서 예외 등 같은 입력이면 같은 결과).
     일시적 오류는 신고별 시도 횟수에 넣지 않고 run 을 `paused`(뒤로 물러나기 1분 → 5분 → 15분, 최대 1시간)로 둔다.
     고정적 오류만 신고별로 세서 3회면 `hold`.
  2. `hold` 에 `next_attempt_at` 을 둔다(15분 → 1시간 → 6시간 → 24시간, 이후 24시간 고정). 시각이 지나면 자동으로 `pending` 으로 되돌려 다시 처리한다.
     '다시 시도' 버튼은 그대로 두고, 누르면 시각과 관계없이 즉시 되돌린다.
  3. 업로드 확인 3회 `retry` 는 `not_eligible` 이 아니라 `hold`(같은 자동 재시도)로 보낸다. 서버가 재시도 불가로 거절한 `blocked` 만 `not_eligible`.
  4. 보류만 남은 run 은 `holds` 상태로 두되, 다음 보류 시각에 맞춰 스스로 다시 깨어난다(모바일 `nextDelay`, PC 스케줄러).
  5. 무한 재시도의 상한: 같은 신고가 고정적 오류로 30일 넘게 보류면 `hold` 에 `stale=true` 만 표시하고 계속 하루 1번 시도한다(지우지 않는다).

### 2-3. 이미 멈춘 기기 풀기 (PC + 모바일)
새 버전 첫 실행에서 한 번(완료 표시를 meta 에 남겨 재실행 금지):
- 지금 run 의 `hold` → `pending`(시도 횟수 0), `not_eligible` 중 `error=upload_rejected` → `pending`.
- `paused` 의 `next_attempt_at` → 0. `official_login_required` 수동 표시는 **유지**(사용자 로그인이 필요한 상태).
- 이 때문에 `done` 이던 run 에 되돌린 항목이 생기면 `done` 을 풀고 `filling` 으로 다시 연다. 되돌린 항목이 없으면 `done` 유지.
- 보고서에 "어떤 기기 상태가 어떻게 바뀌는지" 표를 쓴다.

### 2-4. 업로더 자주 깨우기 (PC + 모바일)
- 지금은 업로드 확인 단계 끝에서만 `wake_upload`/`wakeUploadNow('raw_backfill')` 를 부른다.
- 채우기 slice 가 끝날 때 그 slice 에서 새로 `queued` 된 항목이 있으면 업로더를 깨운다. 업로더 자체 묶음·한도 규칙은 그대로.

### 2-5. 첫 실행 모드 버그·Client 계정 일치 강제 (모바일 중심, PC 문서)
원칙: **Client 모드에서 휴대폰과 서버는 같은 카카오 계정이어야 한다.** 휴대폰 로그인을 없애는 재설계는 하지 않는다
(PC 클라이언트는 곧 종료 예정이라 Client 모드에 큰 투자를 하지 않는다 — 사용자 결정 2026-10-22). 계정이 같으면 동의가 하나라
철회·지도·업로드가 모두 같은 계정 기준이 된다. "계정이 다르면 따로 동의" 는 사용자 결정이 아니었다(09-27 커밋의 안내 문구일 뿐).

- **첫 실행 모드 버그(먼저 고친다)**: 새 설치에서 모드 선택(`SetupScreen` → `_initialModeChoice`)은 화면 상태에만 있고
  prefs 의 `appMode` 는 비어 있다. `AppModeX.fromString(null)` 기본값이 `AppMode.server` 라, 설정을 끝내기 전에 뜨는
  `CommunityOnboardingScreen`(`main.dart` 의 `!gate.canBrowse` 분기)에서 게이트는 Client 로 판정하고 동의는 `via: 'mobile_client'` 로 저장된다.
  Standalone 을 고른 사용자도 그렇다. 게이트·온보딩이 첫 실행에서는 **고른 모드**를 쓰게 한다(모드 미선택이면 동의 단계로 가지 않는다).
  이미 잘못 표시된 grant 는 바꾸지 않는다(감사 기록).
- **계정 불일치 잠금(Client)**: 게이트가 서버 `GET /api/v1/community/gate` 의 `account.fingerprint` 와 휴대폰 계정 지문을 비교한다(지금도 비교만 한다).
  1. 둘 다 있고 **다르다고 확인되면** 게이트 상태 `client_account_mismatch`: 잠금 화면에 "서버에 연결된 카카오 계정(서버 표시 이름)으로
     다시 로그인해 주세요"와 "로그아웃 후 다시 로그인" 버튼. 로그아웃은 휴대폰 세션만 지운다(서버·동의 건드리지 않음).
  2. **먹통 방지(필수)**: 서버에 닿지 못함·시간 초과·5xx·형식 이상·서버 계정 정보 없음·지문 비어 있음은 잠그지 않는다(지금 규칙 유지).
     잠금 해제는 같은 계정 확인 또는 서버 계정 정보가 사라졌을 때.
  3. 잠금 중에는 휴대폰에서 동의·철회를 할 수 없게 한다(엉뚱한 계정의 동의를 바꾸지 않도록).
  4. `ClientAccountMismatchNotice` 안내 카드는 잠금 화면으로 대체한다(같은 판정 함수 `serverAccountMismatch` 를 쓴다).
- **서버 로그인 전**: 지금처럼 서버가 "온보딩 필요"로 거절해 잠긴다. 잠금 화면 문구에 설정의 "서버의 커뮤니티 계정" 카드
  (`community_server_account_card.dart`, 기존 start/confirm)로 바로 가는 버튼을 단다. 관리 권한 없는 키면 기존 권한 안내.
- **커뮤니티 미설정 서버**: 서버 게이트가 503 `community_disabled`·`community_unconfigured` 면 잠그지 않고
  "서버 관리자가 커뮤니티 설정을 마쳐야 공유됩니다" 안내만. 서버 3.0 미만은 기존 `ClientCompatibility` 가 이미 막는다 — 새 차단을 만들지 않는다.
- 하지 않는 것: 휴대폰 카카오 로그인 제거, PC 새 동의 API, 휴대폰 토큰 경로 교체, 기존 grant 정리.
- 문서: 모바일 `docs/architecture/community-account.md`(1절 표·코드 대조 정정 표에 "Client 는 서버와 같은 계정만"), `community-gate.md`,
  PC `docs/architecture/community-gate.md`(Client 계정 규칙 한 줄).

### 2-6. 작은 수정
- PC `community_raw_backfill_runtime.py` 사진 보조 값: 보관 기간(6개월)이 지나 시도하지 않은 경우도 표시가 `success` 로 남는다 → `expired` 로 남긴다.
  모바일 같은 자리도 확인해 맞춘다.

### 2-7. 설정 단계 보고 (auth + PC + 모바일)
목적: 업로드 연결이 생기기 **전**에 멈춘 사람(동의 뒤 공식 사이트 로그인 전 이탈·실패, Client 의 서버 문제)을 서버에서 보이게 한다.
2-1 은 연결이 있어야 보낼 수 있어 이 사람들을 못 본다.

- auth 계약(`account-api.md`, 지도 레포 사본도 같은 바이트로): `POST /community-account/setup-progress`. 인증은 카카오 사용자 세션만.
  내용은 상태 코드만(공식 사이트 ID·비밀번호·서버 주소·API 키·기기 식별자 금지):
  - `client_version`, `source_app`, `platform`, `mode`(`standalone|client|demo|unselected`)
  - `stage`: `kakao_ok` → `consent_ok` → `official_login_started` → `official_login_failed` / `official_login_ok` → `connection_registered`
    (Client: `consent_ok` 대신 서버 판정 결과)
  - `reason`: 실패 코드(공식 로그인 거부·네트워크·캡차·서버 응답 이상 등, 앱이 이미 구분하는 코드를 그대로)
  - Client 만: `server_reachable`, `server_version`, `server_community_supported`, `server_logged_in`, `server_consent_active`,
    `account_match`(계정 지문 비교 결과 true/false/unknown — 지문 자체는 보내지 않는다)
- auth migration: `private.community_setup_progress`(user_id PK, 위 필드, `updated_at`), 사용자당 1행 덮어쓰기. 1분 1회 제한, 2KB 한도.
  공개 경로·`authenticated` 노출 금지. 철회·탈퇴·카카오 연결 끊기 때 지운다(기존 정리 경로에 추가).
- 보내는 때: 단계가 바뀔 때만(같은 단계 반복 전송 금지). `connection_registered` 이후에는 보내지 않는다(2-1 이 이어받는다).
  Client 는 게이트 판정 때 서버 상태가 바뀌었으면 보낸다. 실패는 조용히 넘긴다.
- PC 도 같은 경로를 쓴다(PC 의 카카오 로그인 뒤 공식 로그인·연결 등록 전 단계). `mode` 는 `server`.
- 운영 확인 SQL(2-1 과 같은 파일)에 "동의는 있는데 연결 없음 + 마지막 설정 단계" 조회를 넣는다.

### 2-8. 사용자 조치 알림 (PC + 모바일)
사용자가 손대야만 풀리는 상태를 알린다. 지금은 아무 표시 없이 기다린다.
- 대상: 공식 사이트 수동 로그인 필요(`official_login_required` + 수동 표시), DB 최적화 대기가 백그라운드에서 막힘
  (모바일 백그라운드는 최적화를 시작하지 않는다), 보류가 30일 넘음(`stale`), 2-10 업데이트 필요.
- 모바일: 로컬 알림(채널 하나, 같은 사유는 하루 1번) + 앱 상단 안내. 알림을 누르면 해당 화면(공식 로그인·업로드 화면)으로.
  Android 13+ 알림 권한이 없으면 앱 안 안내만. 앱에 이미 있는 알림 채널·권한 흐름이 있으면 그것을 쓴다.
- PC: 웹 화면 상단 안내(Docker 는 화면 안내만, 시스템 알림 없음). 2-1 진행 보고의 `reason` 과 같은 코드를 쓴다.

### 2-9. 업로드 일시 중지 스위치 (지도 + auth + PC + 모바일)
목적: 운영자가 스위치를 내리면 모든 기기가 업로드를 멈추고, 올리면 재개한다(서버 점검용).
**구버전 앱도 따라야 하므로 서버가 막는 것이 본체**이고, 새 앱은 미리 알고 덜 두드리는 것이 덧붙임이다.

- 설정: `private.community_ingest_config` 에 `uploads_paused boolean not null default false`, `pause_message text`,
  `pause_resume_at timestamptz`(자동 재개 시각, null 이면 운영자가 올릴 때까지), `paused_at`, `paused_by`(운영자 메모).
  변경 이력 표(`community_ingest_config_audit`) 추가.
- **자동 재개는 읽는 쪽에서 판정한다**: 설정을 읽는 RPC 가 `uploads_paused and (pause_resume_at is null or now() < pause_resume_at)` 일 때만
  "중지"로 돌려준다. 재개 시각이 지나면 cron·운영자 조작 없이 바로 재개 상태다(스위치 값은 이력용으로 남겨도 된다).
- 서버(본체): `community-ingest` 의 v1·v2·manifest·progress 가 **DB 쓰기 전에** 판정을 읽고, 중지면
  503 `{code:'maintenance', retryable:true, resume_at}` + `Retry-After`(재개 시각까지 남은 초, 재개 시각이 없으면 600). 원장·연결 표·대기열을 건드리지 않는다.
  파서 워커는 스위치와 무관(점검 때 운영자가 따로 멈춘다). account status·지도 웹 읽기는 계속 동작한다.
- 확인된 구버전 동작: 모바일 2.4.1 업로더는 일시 장애(5xx)에서 남은 배치를 보내지 않고 cooldown, 행은 남는다.
  PC 구버전(3.0~3.5)과 출시 2.5.0·3.6.x 도 503 에서 행을 잃지 않는지 **코드로 확인해 보고서에 표로** 남긴다. 잃는 버전이 있으면 멈추고 보고.
- status(auth `community-account`): `ingest.paused: true|false`, `ingest.pause_message`, `ingest.resume_at`. 같은 설정 RPC 를 읽는다.
- 새 앱(PC 3.6.2·모바일 2.5.1):
  - status 나 503 에서 중지를 받으면 업로더·1회 전송·진행 보고를 멈추고 상단에 "서버 점검 중 — HH:MM 에 자동으로 다시 올립니다"
    (재개 시각이 없으면 "점검이 끝나면 다시 올립니다") 안내. 중지 상태와 재개 시각을 저장해 앱 재시작·백그라운드에서도 지킨다.
  - **중지 동안 업로드 시도를 하지 않는다**(주기 재시도 금지). 재개 시각이 있으면 그 시각 + 무작위 0~120초에 한 번만 깨워
    status 를 확인하고 재개한다(모든 기기가 같은 초에 몰리지 않게). 모바일 백그라운드는 그 시각에 맞춘 1회 작업을 예약한다.
  - 재개 시각 전이라도 평소 주기의 status 확인(게이트 갱신)에서 `paused=false` 나 새 재개 시각을 받으면 그대로 따른다
    (운영자가 일찍 올리거나 연장한 경우). 점검 때문에 status 확인을 더 자주 하지 않는다.
  - 재개 시각이 없으면 평소 status 확인에서 `paused=false` 를 볼 때까지 기다린다.
  - 503 `maintenance` 는 2-2 의 **일시적 오류**(신고별 횟수에 넣지 않음, run 은 `paused`, 다음 시도 = 재개 시각).
- 구버전은 자기 물러나기 규칙대로 다시 두드리지만 서버가 DB 쓰기 전에 503 으로 끝내므로 부담이 작다(받아들인다).
- 지도 웹: 점검 중이면 상단 배너만(지도 열람은 그대로).
- 조작은 운영 콘솔(2-14)에서 한다: 지금 상태, 중지(문구·재개 시각 "언제까지" 또는 "몇 분 동안"), 재개. 재개 시각은 과거·7일 초과를 거부한다.
  콘솔이 죽었을 때를 위한 비상 SQL(중지·재개 한 줄씩)을 `docs/operations/` 에 둔다.

### 2-10. 필수 버전과 강제 업데이트 (지도 + auth + PC + 모바일)
목적: 운영자가 정한 버전보다 낮은 앱은 업데이트하기 전까지 쓸 수 없다.
기존 `client_notice`(info·warning 배너, required 는 하루 1번 대화상자, 막지 않음)는 그대로 두고, **막는 것은 새 필드**로 분리한다.

- 설정: `community_ingest_config.client_requirement jsonb`
  `{min_version:{pc,mobile}, url:{pc,mobile}, message, enforce_from}`(플랫폼 값 null 이면 그 플랫폼은 요구 없음). 이력 표에 기록.
- 서버 차단(모든 버전에 듣는다): `community-ingest` v1·v2 가 envelope `client_version` 이 요구보다 낮으면 426
  `client_upgrade_required`(구버전 포함, 버전 문자열을 해석 못 하면 막지 않는다). progress·setup-progress 는 받는다(누가 남았는지 보려고).
  구버전(모바일 2.4.1 이하·PC 3.5.x 이하)이 426 을 받으면 행을 어떻게 처리하는지(재시도·dead_letter 등) 코드로 확인해 2-9 의 표에 함께 적는다.
  dead_letter 로 버리는 버전이 있어도 업데이트 뒤 1회 전송이 로컬 DB 에서 다시 보내는지 확인한다.
  지금의 `v1_sunset` 은 이것으로 대신할 수 있다 — 둘 중 하나만 쓰도록 문서에 정리(요구 버전을 PC 3.6.0 / 모바일 2.5.0 이상으로 두면 v1 은 전부 막힌다).
- 새 앱 잠금(PC 3.6.2·모바일 2.5.1부터):
  - status 의 `client_requirement` 와 자기 버전을 비교해 낮으면 게이트 상태 `update_required`: 전체 화면 잠금(로컬 자료는 지우지 않음),
    업로드·크롤·1회 전송 정지, 업데이트 버튼(모바일 Play 스토어, PC 다운로드 주소).
  - **먹통 방지(필수)**: 잠금은 status 가 정상 응답으로 "요구 버전 > 내 버전"을 **명시했을 때만**. 시간 초과·5xx·네트워크 오류·형식 이상·
    버전 해석 실패는 절대 잠그지 않는다(마지막으로 받은 판정 유지). 잠금 해제도 정상 응답에서만. 새로 받은 요구가 없어지면(null) 즉시 해제.
  - 모바일: Play In-App Updates 즉시 업데이트 흐름을 잠금 화면에서 먼저 시도하고, 안 되면 스토어 주소. GitHub APK 설치본은 스토어 대신 릴리스 주소.
  - Client 모드: 휴대폰은 자기(mobile) 요구로 잠그고, 붙은 PC 가 잠겼으면 PC 게이트가 이미 거절하므로 "서버 업데이트 필요"를 보인다.
    PC 는 잠금 중 Client API 에 기존 `SERVER_UPGRADE_REQUIRED` 409 형식을 쓴다.
- 버전 기록: 지금 서버가 앱 버전을 아는 곳은 업로드 envelope 뿐이다(`community_connections.last_client_version`, 10-21 이후 업로드한 연결만).
  카카오 세션과 account status 요청에는 앱 버전이 없다. 그래서 새 앱(2.5.1·3.6.2)은 auth `community-account` 의 모든 요청에
  `X-Client-Version`·`X-Client-App` 헤더를 붙이고, auth 는 사용자별 `private.community_client_seen`(user_id, app, platform, version, last_seen_at,
  앱·플랫폼별 1행)에 남긴다. 2-1·2-7 보고의 버전도 같은 표를 갱신한다. 헤더 값은 길이·형식 검사 뒤에만 저장.
- 지도 웹(사용자 결정 2026-10-22: 요구 버전 미만은 막는다): 요구가 설정돼 있고 `enforce_from` 이 지났으면, 로그인한 사용자에게
  **최근 30일 안에 요구 버전 이상으로 확인된 앱이 하나라도** 있어야 지도를 연다(`community_client_seen` 또는 연결의 `last_client_version`).
  없으면 지도 대신 "앱을 최신 버전으로 업데이트한 뒤 한 번 실행해 주세요" 안내 화면(다운로드 주소 포함).
  버전을 모르는 사용자도 막힌다 — 새 앱은 실행 때 status 로 버전이 기록되므로 업데이트 후 앱을 한 번 열면 풀린다는 점을 안내 문구에 쓴다.
  판정은 지도 자체 API(`my-analytics/client-status`)가 하고, 지도 웹은 community-account 를 직접 부르지 않는다(기존 결정).
- 조작은 운영 콘솔(2-14)에서 한다. 저장 전에 "막히게 될 사용자 수(플랫폼·버전별)"를 보여 주고 확인을 받는다.
  출시되지 않은 버전(콘솔 레포 `config/releases.json` — PC·모바일 출시 버전 목록, 릴리스 때 갱신)을 요구하려 하면 거부한다.
  비상 해제 SQL(요구 지우기 한 줄)을 `docs/operations/` 에 둔다.
- 한계(보고서·운영 문서에 명시): 이미 배포된 구버전(PC 3.6.1 이하·모바일 2.5.0 이하)은 이 잠금 코드가 없어 앱 자체를 잠글 수 없다.
  구버전에 듣는 것은 업로드 426 과 지도 웹 안내뿐이다. 앱 잠금은 2.5.1·3.6.2 부터 실제로 동작한다.

### 2-11. 앱 공지 기능 (지도 + PC + 모바일)
목적: 운영자가 Supabase(206)에 공지를 올리면 대상 앱에 팝업으로 뜬다. 2-12 의 첫 공지 두 개도 이 기능으로 내보낸다.

- 저장(지도 migration): `private.app_announcements`
  - `id`(사람이 읽는 슬러그), `title`(40자), `body`(600자, 줄바꿈만 허용하는 평문), `primary_action`(`{label, url}` 또는 `{label, app_action}`),
    `snooze_days`(기본 7, 0 이면 "보지 않기" 버튼 없음), `starts_at`, `ends_at`, `priority`, `created_at`, `updated_at`
  - `audience`: `apps`(`pc`·`mobile`), `modes`(PC 는 `server`, 모바일은 `standalone`·`client`·`demo`), `platforms`, `min_version`·`max_version`(둘 다 선택)
  - 변경 이력 표. 공개 경로·`authenticated` 직접 노출 금지(Edge 만 읽는다).
- 배포(지도 Edge): 새 함수 `app-announcements`, `GET ?app=&mode=&platform=&version=`. **카카오 로그인 없이** 공개 키만으로 읽는다
  (PC 관리자 화면·로그인 전 휴대폰에서도 떠야 한다). 206 라우터 `VERIFY_JWT=true` 이므로 `community-auth-relay` 와 같은 예외에 넣는다.
  지금 시각에 유효하고 대상이 맞는 공지를 우선순위 순서로 최대 3개 돌려준다. 개인정보 없음, `Cache-Control: max-age=300`.
  버전을 해석 못 하면 버전 조건이 있는 공지는 빼고 조건 없는 공지만 준다.
- 앱 동작(PC 3.6.2·모바일 2.5.1):
  - 언제 가져오나: 모바일은 앱 시작(메인 화면 진입) 때, PC 는 관리자 로그인 직후. 그 뒤 6시간에 한 번. 실패하면 아무것도 띄우지 않고 다음 때를 기다린다
    (잠금·재시도 반복 없음, 다른 기능에 영향 없음).
  - 팝업: 한 번에 하나, 다음 공지는 닫은 뒤. 버튼은 `primary_action`(있으면), "일주일 동안 보지 않기"(`snooze_days` 가 7 이 아니면 "N일 동안 보지 않기"), "닫기".
  - "보지 않기": 공지 id 별로 그 시각까지 숨긴다. 모바일은 기기에(SharedPreferences), PC 는 관리자 계정별로 PC 데이터 폴더에 저장한다(브라우저가 바뀌어도 유지).
    "닫기"는 이번 실행(PC 는 이번 로그인) 동안만 숨긴다. 내용을 바꾼 공지는 새 id 로 올린다(운영 문서에 적는다).
  - 본문은 평문으로만 그린다(HTML·마크다운 해석 금지). 링크는 허용 목록만 연다
    (`play.google.com/store/apps/details?id=com.fentanest.mysafetyreport`, `github.com/Fentanest/`, `*.worklazy.net`).
  - `app_action` 은 정해 둔 것만: 모바일 `open_mode_switch`(설정의 모드 변경 흐름 `_confirmModeReset` 을 연다). 모르는 값이면 버튼을 숨긴다.
  - PC: 공지는 PC 서버가 Edge 에서 받아 관리자 웹 화면에 넘긴다(브라우저가 Supabase 를 직접 부르지 않는다). Docker 도 같다.
- 조작은 운영 콘솔(2-14)에서 한다: 목록, 작성·수정(게시 전만), 미리 보기(앱 팝업과 같은 모양), 게시, 종료. 게시 전 스키마·허용 링크 검사.
  공지 원본 파일은 콘솔 레포 `announcements/` 에 두고 콘솔에서 불러와 게시할 수 있게 한다.
- 계약: `contracts/app-announcements/`(스키마·예시·README). 구버전은 이 기능이 없어 공지를 못 본다(한계로 명시).

### 2-12. 첫 공지 두 개 (공지 파일 + 앱 쪽 동작 확인)
2-11 로 내보낸다. 담당 에이전트는 파일과 시험만 만들고 **게시하지 않는다**(게시는 운영자). 문구는 아래 초안을 쓰고, 사용자 검토 대상으로 표시한다.
초안 속 사실(특히 "그대로 이어집니다", "그대로 옮겨 옵니다")은 코드로 확인하고, 사실과 다르면 문장을 고친 뒤 보고서에 이유를 쓴다.

콘솔 레포 `announcements/2026-10-pc-sunset.json` — 대상: `apps:[pc]`, `modes:[server]`, PC 3.6.2 이상, `snooze_days: 7`
> 제목: PC 프로그램 배포를 곧 마칩니다
>
> 나만의 안전신문고 PC 프로그램은 곧 새 버전을 내지 않습니다.
> 앞으로 업데이트와 새 기능은 휴대폰 앱으로만 나옵니다.
>
> 안드로이드 휴대폰에서 플레이스토어를 열고 '나만의 안전신문고'를 설치해 주세요.
> 지금 쓰는 카카오 계정과 안전신문고 계정으로 로그인하면, 지도에 공유한 신고는 그대로 이어집니다.
>
> 버튼: [플레이스토어에서 보기] → `https://play.google.com/store/apps/details?id=com.fentanest.mysafetyreport`

콘솔 레포 `announcements/2026-10-client-to-standalone.json` — 대상: `apps:[mobile]`, `modes:[client]`, 모바일 2.5.1 이상, `snooze_days: 7`
> 제목: Client 모드가 곧 없어집니다
>
> PC 프로그램 배포를 마치면 Client 모드도 함께 없어집니다.
> 지금 미리 Standalone 모드로 바꿔 두세요.
>
> 설정에서 모드 옆 [변경]을 누르고 '서버 DB 받아 변환'을 고르면, 서버에 있던 신고 내역을 그대로 옮겨 옵니다.
> 바꾼 뒤에는 휴대폰에서 안전신문고 계정으로 직접 신고 내역을 불러옵니다.
>
> 버튼: [지금 바꾸기] → `app_action: open_mode_switch`

### 2-13. 문구 원칙 (이번 패치의 모든 새 문구)
알림·잠금 화면·안내·공지·오류 문구 전부에 적용한다. 보고서에 새 문구 전체 목록(위치·문장)을 표로 붙인다 — 사용자가 한 번에 검토한다.
- 사용자가 아는 말만 쓴다: 신고, 지도, 공유, 업데이트, 로그인, 안전신문고 계정, 카카오 계정. 내부 용어(writer, backfill, outbox, 게이트, 동기화 대기열,
  run, hold, contract, v1/v2)는 화면에 내지 않는다. 같은 대상은 앱에 이미 있는 이름을 그대로 쓴다(예: 'Client 모드', 'Standalone 모드', 설정의 [변경]).
- 한 문구에 세 가지만: 무슨 일인지, 사용자가 할 일, (있으면) 언제. 할 일이 없으면 "할 일 없음"이 드러나게 쓴다(예: "자동으로 다시 올립니다").
- 짧은 평서문. 존댓말은 "~합니다/~해 주세요"로 통일. 느낌표·이모지·물결표 금지.
- 쓰지 않는 표현: "원활한", "더 나은 서비스를 위해", "최적의", "새롭게", "편리하게", "~를 통해", "다양한", "효율적", "보다 나은",
  "불편을 드려 죄송합니다"를 문구마다 붙이는 것. 사과는 사용자가 실제로 손해를 본 경우에만 한 번.
- 숫자·시각은 구체적으로(예: "오전 3시에", "6개월이 지난 사진"). 확실하지 않은 약속은 쓰지 않는다.

### 2-14. 운영 콘솔 (콘솔 레포 + 지도 migration + 206)
목적: 업로드 일시 중지(2-9), 필수 버전(2-10), 공지(2-11)를 운영자가 터미널 없이 웹 화면에서 직접 발행한다. Supabase(206)에 의존한다.

- 위치: 비공개 레포 `safetyreport-ops-console`(작업 폴더 `ops-console/`). 내부 도구라 지도 웹 디자인 시스템은 쓰지 않는다. 단순한 폼 화면, 휴대폰 폭에서도 쓸 수 있게.
  화면 문구도 2-13 원칙을 따른다(운영자용이라도 내부 코드명 대신 뜻을 쓴다).
- 구성: 206 docker 컨테이너 하나(작은 서버 + 서버 렌더 화면, 언어는 담당 재량 — 근거를 보고서에), 네트워크 `supabase_default`.
  **LAN 에만 연다**: `10.20.10.206:<포트>` 로만 바인드하고 공개 도메인·터널(Kong·Cloudflare 등)에 붙이지 않는다.
  운영자는 집 밖에서 VPN 으로 LAN 에 들어와 쓴다(사용자 2026-10-22) — 외부 공개는 하지 않는다.
  배포 방식은 파서 워커(`~/community-parser`)와 같다: Supabase compose 를 고치지 않는 별도 compose 프로젝트(예: `~/community-ops-console`),
  외부 네트워크 `supabase_default` 에 붙고, `restart: unless-stopped`, 이미지 태그는 콘솔 레포 커밋 기준(파서도 앞으로 파서 레포 커밋 기준).
- 로그인: Supabase Auth 의 카카오 로그인(기존 공급자)을 쓴다. 콘솔 주소를 GoTrue 리다이렉트 허용 목록에 넣어야 하므로 필요한 설정 이름만
  문서에 적는다(206 리다이렉트 허용 목록 변경은 사용자 승인됨 2026-10-22, 검수자가 적용한다 — 담당 에이전트는 하지 않는다). 로그인한 사용자가 `private.ops_admins`(user_id, 메모, 추가 시각)에 있어야만 들어간다.
  첫 관리자는 migration 이 아니라 운영 문서의 SQL 한 줄로 넣는다(사용자 ID 를 저장소에 넣지 않는다).
- 세션: 서버 쪽 세션(httpOnly·SameSite=Strict 쿠키, 8시간, 유휴 1시간). 모든 변경 요청에 CSRF 토큰. 브라우저에 Supabase 토큰·키를 두지 않는다.
- 권한: 콘솔 DB 로그인 역할 `community_ops_login`(NOLOGIN 역할 `community_ops` 의 구성원)은 표를 직접 못 쓰고,
  `security definer` 함수만 실행한다: 점검 중지·재개, 필수 버전 설정·해제, 공지 작성·게시·종료, 상태·영향 수 조회.
  각 함수는 호출자 카카오 user_id 를 받아 `ops_admins` 를 다시 확인하고 이력 표에 누가·언제·무엇을(이전 값 → 새 값) 남긴다.
  DSN 은 컨테이너 `.env`(0600)에만 둔다. 로그·화면·오류에 DSN·키·토큰을 출력하지 않는다.
- 화면:
  1. 첫 화면: 지금 업로드 상태(정상 / 점검 중, 재개 시각), 필수 버전, 게시 중인 공지, 최근 1시간 503·426 수, 최근 변경 이력 10건.
  2. 업로드 점검: [지금 중지] — 문구, "언제까지"(KST 날짜·시각) 또는 "몇 분 동안", 확인 대화상자에 "업로드 중지"를 직접 입력해야 실행. [지금 재개].
  3. 필수 버전: PC·모바일 각각 버전 선택(출시 목록에서만), 적용 시작 시각, 문구. 저장 전 막힐 사용자 수 미리 보기와 직접 입력 확인. [요구 해제].
  4. 공지: 목록(예정·게시 중·종료), 작성(대상 앱·모드·버전, 기간, 버튼, 보지 않기 일수), 앱 팝업 모양 미리 보기, 게시, 종료.
  5. 변경 이력: 전체 목록, 항목별 이전 값 → 새 값.
- 시각은 화면에서 모두 KST 로 보이고 DB 에는 UTC 로 저장한다.
- 배포 파일: `Dockerfile`, compose 예시(LAN 바인드), `.env.example`(이름만), `README.md`(설치·첫 관리자 등록·리다이렉트 설정·비상 SQL·백업).
  담당 에이전트는 배포하지 않는다.

### 2-15. 운영 콘솔 대시보드 (콘솔 + 지도 migration)
목적: 새 동의자의 업로드가 어디까지 왔는지 사람별로 한눈에 본다. 오늘 터미널로 손으로 하던 조회(0-1)를 화면으로 옮기는 것이다.

- 분류(사람 = 카카오 계정. 위에서부터 처음 맞는 하나):
  1. **재동의 전**: 활성 동의가 지금 정책이 아님(outdated). 마지막 계약이 v1 인지 함께 표시.
  2. **구버전 앱**: 지금 정책에 동의했지만 확인된 앱 버전이 원본 전송 미지원(PC 3.6.0·모바일 2.5.0 미만)이거나 v1 만 보냄.
  3. **시도 안 됨**: 지금 정책 동의 active, 원본 0건, 진행 보고(2-1) 없음. 설정 단계(2-7)로 다시 나눈다 —
     공식 로그인 전·공식 로그인 실패(사유)·연결 등록 전·Client 서버 문제(미로그인·계정 불일치·미설정)·기록 없음(구버전 추정).
  4. **멈춤**: 1회 전송이 `paused`·`holds`·`waiting_optimize` 이거나, 진행 중 상태인데 24시간 넘게 보고가 없음. 사유별로 다시 나눈다
     (공식 로그인 필요·DB 최적화 대기·일시 오류 반복·보류 N건·보고 끊김).
  5. **업로드 중**: `listing`·`filling`·`uploading` 이고 24시간 안에 보고가 있음. 진행률(완료/전체)과 마지막 보고 시각.
  6. **완료**: 1회 전송 `done`. 앱이 최신 출시 버전(콘솔 레포 `config/releases.json`)인지에 따라 "완료(최신 버전)"·"완료(이전 버전)"으로 나눈다.
  분류 규칙은 DB 함수 하나(`ops_upload_overview()`)에 두고, 기준 시간(24시간)·버전 기준은 함수 인자로 받는다.
- 화면:
  - 맨 위 숫자 카드: 분류별 사람 수, 원본 수 / 지도 행 수(전체), PC·모바일 나눠 보기.
  - 분류별 표: 가명 ID(사용자 ID 의 sha256 앞 8자리), 앱·플랫폼·버전, 모드, 마지막 확인 시각(KST), 원본 수 / 지도 행 수, 멈춘 사유.
    카카오 이름·공식 사이트 ID·신고 내용은 보이지 않는다.
  - 행을 누르면 상세: 동의 이력(정책·경로·시각), 연결 목록, 최근 진행 보고 기록, 설정 단계 기록.
  - 필터(PC·모바일·분류), 수동 새로 고침. 자동 새로 고침은 하지 않는다.
- 상세용 기록: `private.community_progress_history`(연결별 보고 원문 요약, 30일 보관, 연결당 최근 200건까지) — 2-1 저장 때 함께 남긴다.
- 성능: 사용자 수백 명 기준 1초 안. 표 전체를 훑는 조회는 함수 안에서 한 번만, 인덱스 근거를 보고서에.

### 2-16. 문의 게시판을 모바일 레포로 옮기기 (지도 + auth + 모바일)
사용자 결정(2026-10-22): 문의·버그·삭제 요청 게시판은 `Fentanest/safetyreport-mobile` 이슈로 일원화한다. 지도 레포 이슈로 연결하지 않는다.
- 링크 교체: 지도 웹 `src/components/DataGuide.tsx` 의 `ISSUES_URL`, auth 사이트 `site/src/doc.ts` 의 `COMMUNITY_ISSUES_URL`,
  모바일 `PRIVACY_POLICY.md`, 그 밖에 앱·사이트 화면에서 지도 레포 이슈로 가는 링크 전부.
- 지도 레포의 이슈 양식(`delete-shared-reports.md`, `question.md`)은 모바일 레포로 옮기고(검수자가 이미 추가한 모바일 양식과 합친다),
  지도 레포에는 `ISSUE_TEMPLATE/config.yml` 로 빈 이슈를 막고 "문의는 safetyreport-mobile 에 남겨 주세요" 연락처 링크만 둔다.
  (지도 레포 이슈 기능 자체를 끄는 것은 운영자가 GitHub 설정에서 한다.)
- **동의문 본문은 고치지 않는다**: `contracts/consent/share-consent-*.md` 에도 지도 레포 이슈 주소가 있지만 동의문은 해시로 고정돼 있어
  바꾸면 새 정책 버전·전원 재동의가 된다. 다음 동의문 개정 때 함께 바꾼다(보고서 남은 일에 적기). 그때까지 지도 레포 이슈 주소로 들어온 사람은
  위 `config.yml` 안내로 모바일 레포에 간다.
- 모바일 앱의 버그 제보 링크(`lib/services/support_links.dart`)는 지금 제목·본문을 채운 빈 이슈를 연다. 모바일 레포의 새 양식을 쓰도록
  `template=bug_report.yml` 과 양식 칸 id(`os-version`, `device-model`, `app-version`, 그리고 쿼리로 채워지면 드롭다운 `platform`·`mode`)를 채워 연다.
  드롭다운이 쿼리로 안 채워지면 넣지 않는다(GitHub 동작을 확인해 보고서에). 양식 파일은 검수자가 모바일 레포 `.github/ISSUE_TEMPLATE/` 에 먼저 만들었다. 공개 게시판이므로
  아이디·서버 주소·차량번호 같은 값은 지금처럼 절대 자동으로 넣지 않는다. 기능 요청 링크도 같은 방식(`feature_request.yml`).
- PC 웹 화면에 문의 링크가 있으면 같은 모바일 레포 주소로.

## 3. 시험 (필수)
- 2-2: 일시적 오류 40초 연속 → 보류 0, run `paused`. 고정적 오류 3회 → `hold` + `next_attempt_at`. 시각 경과 → 자동 `pending`.
  업로드 확인 3회 `retry` → `hold`. `blocked` → `not_eligible`. 버튼 즉시 재시도.
- 2-3: 보류·`upload_rejected`·`paused`·`done` 조합 marker 를 만든 뒤 첫 실행 이행 → 기대 상태, 두 번째 실행에서 다시 안 바뀜.
- 2-4: 채우기 slice 에서 queued 가 생기면 업로더 wake 1회.
- 2-1: 계약 벡터(정상·한도 초과·금지 필드), Edge 처리기 단위 시험(outdated 허용, revoked 거부, 429), migration 로컬 적용 SQL 시험(NOT RUN 가능).
  PC·모바일 보고 주기·실패 무시.
- 2-5 첫 실행: 새 설치에서 Standalone 선택 → 휴대폰 카카오 로그인·동의 단계가 보이고 `via=mobile_standalone`. Client 선택 → `via=mobile_client`.
- 2-5 계정 일치: 같은 지문 → 통과, 다른 지문 → `client_account_mismatch` 잠금·동의/철회 불가, 로그아웃 뒤 같은 계정 로그인 → 해제.
  서버 닿지 못함·5xx·시간 초과·계정 정보 없음·지문 비어 있음 → 잠그지 않음(먹통 회귀 시험). 서버 로그인 전 → 기존 잠금 + 카드로 가는 버튼.
  503 미설정 → 잠그지 않고 안내.
- 2-7: auth 처리기 시험(세션 없음 401, 금지 필드 거부, 한도, 덮어쓰기, 철회 시 삭제), 앱 단계 전이별 1회 전송·`connection_registered` 뒤 중단,
  Client 의 `account_match` 가 지문 없이 true/false/unknown 만 가는지.
- 2-8: 사유별 하루 1번, 권한 없음 → 앱 안 안내만, 알림 눌러 해당 화면.
- 2-9: 스위치 내림 → v1·v2·manifest·progress 503 `maintenance` + `resume_at` + 남은 초 Retry-After, 원장 행 0.
  재개 시각 경과 → 조작 없이 수신 재개. 새 앱: 중지 동안 업로드 요청 0회, 재개 시각(+지터)에 1회 깨움, 앱 재시작 뒤에도 유지,
  운영자 조기 재개·연장을 평소 status 에서 반영, 보류 횟수 안 늘어남. 구버전 업로더 코드 확인 표.
- 2-10: 요구 버전 미만 v1·v2 → 426. 앱 잠금은 정상 응답에서만 — 시간 초과·5xx·형식 이상·버전 해석 실패·요구 없음은 잠그지 않음(먹통 회귀 시험).
  요구 해제 → 즉시 풀림. 지도 웹: 30일 안 요구 버전 이상 앱 있음 → 열림, 없음·모름 → 안내 화면, `enforce_from` 전 → 열림.
  auth 의 버전 헤더 기록(형식 이상 값 무시). 운영 콘솔의 영향 수 미리 보기·미출시 버전 거부.
- 2-11: Edge — 대상·기간·버전 필터, 최대 3개, 우선순위, 세션 없이 공개 키로 200, 버전 해석 실패 시 조건 있는 공지 제외.
  앱 — 가져오기 실패 시 팝업 없음·다른 기능 정상, 한 번에 하나, "보지 않기" 뒤 7일 숨김·7일 뒤 다시 뜸, "닫기"는 이번 실행만,
  PC 관리자 계정별 저장, 허용 목록 밖 링크·모르는 `app_action` 은 버튼 숨김, 본문 HTML 이 글자 그대로 보임.
  운영 콘솔의 스키마·링크 검사.
- 2-12: 두 공지 파일이 스키마를 통과하고, 대상이 정확히 PC 관리자 화면 / 모바일 Client 모드에서만 뜨는지(Standalone·데모에서는 안 뜸).
  `open_mode_switch` 가 모드 변경 대화상자를 연다.
- 2-14: 비관리자 카카오 로그인 → 403, 세션 없음 → 로그인 화면, CSRF 없는 변경 → 거부, 콘솔 역할로 표 직접 쓰기 → 권한 오류,
  함수마다 이력 기록, 직접 입력 확인 없이는 중지·필수 버전 저장 안 됨, 미출시 버전 거부, KST↔UTC 변환, 화면·로그에 비밀값 없음.
  LAN 바인드가 compose 예시에 들어 있는지. 실제 카카오 로그인 왕복은 NOT RUN 으로 두고 검수자가 206 에서 확인한다.
- 2-15: 합성 사용자로 분류 6종이 각각 정확히 하나로 떨어지는지(경계: 23시간/25시간 보고, 버전 경계, outdated+v1), 설정 단계 세부 분류,
  화면에 카카오 이름·공식 ID·신고 내용이 나오지 않음, 진행 기록 30일·200건 정리.
- 파서 분리: 파서 레포에서 기존 파서 시험 전부 통과, 지도 레포 CI 에 파서 경로 참조가 남지 않음.
- 2-16: 지도·auth·모바일 화면 코드에 지도 레포 이슈 주소가 남지 않음(동의문 파일 제외), 모바일 버그 제보 URL 이 양식 이름과 칸 id 를 정확히 채우고
  민감 값이 없음(`support_links_test.dart` 갱신).
- 파서 빌드: `MAP_REF` 로 받은 목록의 해시가 다르면 빌드 실패.
- 기존 시험 전부 통과(PC `pytest`, 모바일 `flutter test`, 지도·auth `npm test`·계약 검사). 못 돌린 것은 이유와 함께 NOT RUN.

## 4. 보고서
에이전트별 `map/docs/implementation/backfill-resume-20261022/<에이전트>-REPORT.md`(예: `A-REPORT.md`): 바꾼 파일, 설계 판단(특히 오류 분류표, 구버전 503·426 처리표),
새 문구 전체 표(2-13), 공지 초안의 사실 확인 결과(2-12),
시험 명령과 결과, NOT RUN 목록, 남은 위험. 운영 적용 순서(auth·지도 migration → Edge → PC 3.6.2 → 모바일 2.5.1 →
파서 워커 이미지를 새 파서 레포 기준으로 다시 빌드 → 운영 콘솔 배포·첫 관리자 등록 → `client_notice` 최소 버전을 PC 3.6.2 / 모바일 2.5.1 로 올림 → 콘솔에서 2-12 공지 두 개 게시)는 제안만.
