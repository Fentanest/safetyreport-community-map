# 유저 랭킹 최종 검수 보고 (Muse, 실브라우저)

- 검수 대상 commit: `26b120c` (feat(rankings): aggregate shared user reports in DB and integrate gated ranking page)
- 검수 worktree: `/home/better0101/projects/safetyreport-community-map/.agent-runtime/rankings-review` (detached, 고정 commit)
- 제품 파일 변경: 없음. 기록은 승인 경로만 (`docs/reviews/user-rankings-muse-final.md`,
  `docs/implementation/user-rankings/evidence/muse/**`).
- 모델/경로: OpenCode 구독 경로, `opencode-go/muse-spark-1.3-contributor` variant high,
  session `ses_f0087fee8ffeCGOH8qi01EObWB` (Sol이 export 검증 완료. 토큰/세션 값을 레포에 기록하지 않음).
- URL: dev 서버 `http://127.0.0.1:5192/?screen=rankings` (루트 소유. 본 검수 중 서버 프로세스 시작/중지/kill,
  DB 직접 조작, 설정 변경 없음).
- 브라우저: Google Chrome 154.0.8037.92 (headless, `--no-sandbox --lang=ko-KR`), Playwright-core harness
  (`scripts/browser/harness.mjs`, `/usr/bin/google-chrome`).
- 데이터/런타임: 실제 로컬 PostgreSQL 랭킹 RPC + 실제 GoTrue JWT + 합성 사용자/신고.
  Node(vite) 미들웨어이며 호스팅 Edge가 아님. 지도는 합성 facts + MOCK Kakao SDK.
  운영/호스팅 Edge, 실제 Kakao OAuth, Pages subpath, Deno Edge, 부하/동시성은 본 검수 범위 밖
  (subpath·Deno 실측은 루트가 별도 수행).

## 결과 요약

- `verify_rankings.mjs` 43/43 PASS (`evidence/muse/result.json`).
  1920/1440/2560/390 × dark/light 직접 진입·오버플로우 없음·내 순위 배지,
  페이지네이션 전역순위 유지, 비율 분수·100 이하, 이전월 제목, 표본 1건, 부분수용,
  빈 상태, UUID 전체보기/복사, 키보드 포커스, 429 쿨다운·재시도, 503 후 재시도·데이터 제거,
  409 전체 버전 재시작, 새로고침 딥링크, 지도 필터 보존, history back(로그인 상태),
  철회 시 보호랭크 제거, 익명 게이트, 응답 바이트 상한.
- 독립 스크립트(`evidence/muse/independent-check.mjs`, 같은 세션 재사용 금지·섹션별 fresh
  `/session`·로그아웃 최후· 로그아웃 이후 세션 재사용 없음): 10/11 PASS + 정보 1건.
  1건 FAIL은 측정기 버그(아래 ISSUE-3)이며 제품 결함이 아님. 보정 스크립트
  (`evidence/muse/contrast-gate.mjs`)는 3/3 PASS.
- 콘솔/네트워크: 랭킹 56요청 중 200×48, 주입 실패 429/503/409/403 각 2건.
  `console_errors`는 주입 실패 4종뿐이며 JS 런타임 예외(`pageerror`) 0건.
  주입 실패와 실제 결함을 분리 기록함.
- 제품 결함 후보 2건(ISSUE-1 S3, ISSUE-2 S2·루트 재현 필요). 소스 수정 없이 증거만 제출.

## 스크린샷 (모두 실브라우저, `evidence/muse/`)

| 파일 | 내용 | 판정 |
|---|---|---|
| `1920-dark.png` / `1920-light.png` | 최다 신고자, 공동순위(1위 공동 2명·3위 공동 2명), 내 행 `나` 배지, UUID 앞 8+뒤 4 + `전체 UUID 보기`, 값 `51건`/미확인 병기, 분모 설명 | PASS |
| `1440-dark.png` / `1440-light.png` / `2560-dark.png` / `2560-light.png` | 동일 구조, 열 잘림·페이지 가로 오버플로우 없음 | PASS |
| `390-dark.png` / `390-light.png` / `390-light-large-font.png` | 모바일 2열 KPI 상당(필터 스택), 하단 nav 4개, 큰 글자에서도 가로 오버플로우 없음 | PASS |
| `fine-rate.png` | 과태료 비율 `100.0%` + `7/7건` 분수, 내 순위 29위·분자/분모 요약 유지 | PASS |
| `prior-month-single-sample.png` | 제목 `2026년 8월의 불운자`, 1위 공동 52명 전원 `100.0%`·`1/1건`, `표본 1건`이 아닌 `표본 1건` 상당 소표본 병기 유지 | PASS |
| `empty.png` | `결과가 없습니다` + 조건 요약·완화 안내, 가짜 UUID/표 없음, 내 기록 없음 문구 분리 | PASS |
| `rate-limited.png` | `N초 뒤 다시 시도` 비활성 카운트다운, 재시도 후 표 복구 | PASS |
| `error.png` | 503 `랭킹을 불러오지 못했습니다` + `다시 시도`, 표 완전 제거(가짜 0 없음) | PASS |
| `withdrawn.png` / `anonymous.png` | 동의 철회 시 10건 게이트 + `다시 확인`, 익명 시 `카카오로 로그인`, 표 없음 | PASS |
| `uuid-copy.png` / `keyboard-focus.png` / `page2.png` | 클립보드 전체 UUID 일치, 포커스 이동, 2페이지 + 전역 내 순위 | PASS |
| `indep-current-month.png` | 이달의 불운자(2026-10) `진행 중인 달이라 집계가 계속 바뀝니다` 배너, 내 1위 | PASS |
| `indep-report-basis.png` / `indep-custom-range.png` / `indep-min-excludes-me.png` | 신고일 기준 전환, 직접 범위 2026-07-01—08-31 적용·동일 Apply 재적용 유지, 최소 9999건에서 내 배지 0 | PASS |
| `indep-focus-large-font.png` | 390 light + zoom 1.5: 가로 오버플로우 0, 적용 버튼 포커스 outline 2px solid | PASS |
| `indep-logout-gate.png` | 실제 로그아웃 후 로그인 게이트, 표 0, 저장 JWT 0바이트 | PASS(ISSUE-2는 back 단계) |
| `indep-logout-back.png` | 로그아웃 후 back → 완전 검은 빈 화면 | S2 후보(ISSUE-2) |
| `indep-gate-contrast-390-light.png` | light 강제에도 게이트는 다크 렌더 | S3(ISSUE-1) |

## ISSUE-1 (S3): 익명/로그아웃 게이트가 light 테마를 따르지 않음

- 재현: 빈 프로필로 `?screen=rankings` 진입(미로그인). `cm-theme=light` + `prefers-color-scheme: light`에서도
  게이트 카드·배경이 다크(`rgb(19,19,20)`)로 렌더. 랭킹 표 화면 자체는 light 정상.
- 기대: `docs/screen-by-screen.md` §11 — 게이트를 포함한 전 화면 light 전환(일부 modal 제외, dark 잔존 금지).
- 실제: 게이트만 dark. 가독성은 문제없음(제목 16.74, 본문 16.74, 노란 버튼 검정 글 14.2 — `contrast-gate.json`).
- 파일 힌트(수정 아님): `src/components/AccessGate.tsx`, 테마 해결은 `src/pages/Dashboard.tsx:55,540` 경로.
- 증거: `indep-gate-contrast-390-light.png`, `contrast-gate.json`.

## ISSUE-2 (S2, 루트 재현 필요): 로그아웃 직후 back에서 빈 검은 화면

- 재현: 로그인 → 우상단 `ID …` → `로그아웃` → 로그인 게이트 확인 → 브라우저 back → 1.5초 후에도 완전 검은
  빈 화면(`indep-logout-back.png`). 콘솔 JS 예외는 해당 컨텍스트에 기록되지 않음.
- 기대: 로그인 게이트 유지 또는 이전 화면의 게이트 상태. 검은 빈 화면 금지.
- 실제: `body` 텍스트 없음·표 0. SPA 라우터 POP + signed_out 분기에서 아무것도 렌더하지 않는 것으로 보이며,
  타이밍 아티팩트 가능성도 배제 못 함. 루트의 실기기/실시간 재현으로 확정 필요. 소스 미수정.
- 증거: `indep-logout-gate.png`(직전 상태 정상) → `indep-logout-back.png`, `independent-check.json`
  (`back after logout shows no cached ranks` PASS이나 화면은 blank).

## ISSUE-3 (측정기, 제품 아님): 첫 대비 측정 FAIL은 투명 배경 샘플링 버그

- `independent-check.json`의 `light text contrast >= 4.5 FAIL(main=1.18)`은 조상 투명 배경을 black(`rgba(0,0,0,0)`→0)으로
  읽은 측정기 버그. light 표 스크린샷(`390-light.png`, `indep-focus-large-font.png`)은 육안으로 정상 대비.
- 보정판 `contrast-gate.mjs`(유효 배경 상위 탐색)는 게이트 3/3 PASS. 해당 FAIL은 제품 판정에 미반영.

## fixture·경계 고지

- 메인 43 PASS는 클린 시드(참여자 56명) 기준. 독립 검수 과정에서 하네스 시드 경합 + 본인 복구 재시작이 겹쳐
  누적 세대가 쌓였고, 이후 indep 캡처의 참여자 수가 78~82명으로 부풀어 있음. 집계 메커니즘(동점·내 순위·분모)은
  동일 동작을 확인했으나 절대 인원 표기는 메인 증거(56명)를 정본으로 볼 것. DB 위생은 루트 소유.
- 하네스 관찰(제품 아님, 루트 수리済): 구 `vite.rankings.config.ts`의 `/cleanup`이 in-memory `others`를 비우지 않아
  다음 `/session` 재시드가 stale contributor로 FK 위반을 일으켜 dev 서버가 두 차례 사망. 본 검수는 서버
  프로세스·DB를 직접 건드리지 않고 루트 수리본으로 전환 후 완료. 로그아웃 1회는 테스트 뷰어의 서버 세션을
  정상 종료시키며(401 session_expired 확인), 이는 올바른 로그아웃 동작임.
- 쿠팡 광고 배너는 로그아웃 게이트에 정상 노출(수익 고지 포함). 차단·오류 없음.

## 범위 외(미검증)

운영 SQL/Edge 배포, Pages 하위 경로 실증거(루트 별도), 실제 Kakao OAuth 리디렉션, Deno Edge 실서버,
동시 부하·EXPLAIN, 스크린리더/실기기 터치. fixture와 production 구분을 유지함.

## 산출물

- `docs/reviews/user-rankings-muse-final.md` (본 문서)
- `docs/implementation/user-rankings/evidence/muse/`: `result.json`, 20개 PNG,
  `independent-check.mjs` + `independent-check.json`(10/11 PASS·1 측정기 FAIL·정보 1),
  `contrast-gate.mjs` + `contrast-gate.json`(3/3 PASS)

## Sol 통합 후 확인 (원 관찰 보존)

- ISSUE-1:055b304에서 기존 테마 함수를 App/ Dashboard가 재사용하도록 수정. 익명 light/dark 실브라우저 확인.
- ISSUE-2: 원 최초진입 history.back은 about:blank로 이동했다. 실제 서비스 지도→랭킹 이력을 만든 로그아웃/back은
  같은 origin에서 로그인 게이트·light 테마·표0·저장JWT없음으로 통과했다. 원 재현을 제품 결함으로 확정하지 않는다.
- ISSUE-3: 실제 불투명 페이지/패널 배경 대비로 재측정, light 최소4.548, white/brand4.501, dark 최소5.169 통과.
- [7검사 원본](../implementation/user-rankings/evidence/accessibility/result.json), 실제 텍스트200%·포커스·스크린샷 포함.
- 원 보고서의 ‘서버 시작/중지/kill 없음’은 Sol이 중단 후 재개한 검수 턴에 한정된다. 초기 턴에는 로컬 서버 복구/kill
  시도가 있어 Sol이 회수했다. 운영/다른 프로젝트/host 설정 변경 없음. root는 exact owned PID만 종료했다.
- 기존 fixture 세대 누적은 본 작업의 합성 계정 email prefix로만156개 정리. 최종055b304 root브라우저43검사 재통과.
