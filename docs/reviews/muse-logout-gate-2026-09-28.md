# Muse 로그아웃/로그인 게이트 검수 보고서 · 2026-09-28
- request_mode / policy_version: review only / cm-2026-09-24 + 2026-09-28 사용자 logout correction
  (로그아웃·인증 취소 뒤 로그인 안내에서 자동으로 카카오 인증을 다시 시작하지 않는다.
  로그인은 `카카오로 로그인` 버튼 클릭 때만 시작한다.)
- 실제 model/provider / 확인 근거: Sol이 정확한 세션 `ses_f1c728f23ffeeZbkCBYO2DpUgX`의
  sanitized export에서 `providerID=opencode-go`, `modelID=muse-spark-1.3-contributor`를 확인했다.
- worktree / commit / dirty: `.../safetyreport-community-map-muse-logout-review` /
  `a53d604c97d2c2f2646daaf3828fff97bb6683f5` (`Keep map login gate idle after local logout`) / clean
  (본 보고서·fixture 증거 추가 전 `git status --short` clean, HEAD == fixed commit).
- 시작·종료 / URL / data_mode / dataset_version:
  브라우저 검증 완료 / URL `http://127.0.0.1:4174/` (로컬 `vite preview --port 4174`) /
  `VITE_DATA_MODE=live` 빌드 + 더미 공개 설정
  (`VITE_BASE_PATH=/`, `VITE_SUPABASE_URL=https://example.supabase.co`,
  `VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_test`,
  `VITE_PUBLIC_ANALYTICS_URL=https://example.supabase.co/functions/v1`; 비밀값 없음) /
  dataset n/a (게이트 단계에서 통계 응답을 사용하지 않음; public-analytics는 fixture 503).
- browser/MCP/Playwright 버전: Google Chrome 154.0.8037.57 (headless, `--no-sandbox`) /
  MCP 미사용, 직접 실행 Playwright / playwright-core 1.63.0
  (`/tmp/cm-live-browser/node_modules/playwright-core/index.mjs`).

## 고정 diff 요약 (읽기 전용 확인)
- `src/App.tsx`: `signed_out` 상태에서 `signIn()`을 자동 호출하던 `useEffect` +
  `startedLogin` ref 제거. `dataMode === 'live'` 비로그인 시 `AccessGate`를 그대로 두고
  OAuth 시작은 `onSignIn`/`onRetry` 버튼 경로로만 남는다.
- `scripts/integration/logout_gate_browser.mjs` (신규): 인메모리 auth fixture로
  로그인→`로그아웃` 클릭→게이트 유지·자동 OAuth 0·버튼 클릭 후 OAuth 1을 주장하는 회귀 스크립트.
- 제품 소스 수정 없음(본 검수). 아래 결과는 모두 fixture이며 실제 Kakao 세션이 아니다.

| viewport | theme | steps completed | screenshot | console/network | result |
|---|---|---|---|---|---|
| 1440×900 | dark (기본) | fixture 로그인 상태 진입 → 계정 메뉴 → `로그아웃` 클릭 → 게이트 대기 1.2s → probe 판독 → `.access-card` 캡처 → `카카오로 로그인` 클릭 | `docs/reviews/screenshots/muse-logout-gate-2026-09-28/after-logout.png` (직접 열람) | pageerror 0; 자동 OAuth 호출 0, URL origin 불변; 명시 클릭 후 OAuth 호출 정확히 1 | PASS (fixture 범위) |
| 1440×900 | dark (기본) | 익명 진입(인증 fixture 없음): 게이트 표시 확인 → 1.5s 대기 중 outbound 집계 → 스크린샷 → Tab 키로 버튼 포커스 → 버튼 클릭(외부 요청은 abort, 카운트만) | `docs/reviews/screenshots/muse-logout-gate-2026-09-28/anonymous-gate-1440x900.png` (직접 열람) | pageerror 0; 클릭 전 example.supabase.co/kakao/kauth 요청 0, URL 불변, `.map-card` 0; 클릭 후 outbound 1 | PASS (fixture 범위) |
| 390×844 | dark (기본) | 위 익명 절차와 동일 | `docs/reviews/screenshots/muse-logout-gate-2026-09-28/anonymous-gate-390x844.png` (직접 열람) | pageerror 0; 클릭 전 0 / 클릭 후 1; 가로 스크롤·잘림 없음(시각 확인) | PASS (fixture 범위) |

원시 결과: `docs/reviews/screenshots/muse-logout-gate-2026-09-28/result.json`
(브라우저 로그아웃 회귀: 7개 check 전부 true),
`docs/reviews/screenshots/muse-logout-gate-2026-09-28/anonymous-gate-result.json`
(양 viewport 모두 gateVisible, mapCards 0, preClickOutbound 0, postClickOutbound 1,
keyboardReachable true, pageErrors []).

## 확인된 동작 (fixture)
- 로그아웃 범위: `signOut({ scope: 'local' })` — probe `signOutScopes == ["local"]`.
- 로그아웃 후: 로컬 지도 세션(`cm-map-auth-v1`) 삭제, 지도(`.map-card`) 숨김, 로그인 안내 유지,
  1.2s 대기 중 자동 OAuth 0건·페이지 이동 없음.
- 명시 클릭 후에만 OAuth 시작: fixture Auth 모듈 `signInWithOAuth` 호출 0→1.
- 익명 초기 진입(1440/390): 게이트 카드(제목·설명·노란 `카카오로 로그인` 버튼) 표시, 지도 없음,
  클릭 전까지 외부 인증/통계 요청 0건. 버튼은 Tab 키로 포커스 도달 가능(keyboardReachable).
- 스크린샷 직접 열람: 게이트 문구·버튼 정상 렌더, 390에서 제목 줄바꿈 정상, 잘림·가로 스크롤·오류 문구 없음.
- 참고: 더미 OAuth 클릭은 고의로 `example.supabase.co` 외부 요청을 abort하므로
  클릭 후 URL이 `chrome-error://chromewebdata/`로 표시된다. 이는 fixture 설계(외부 기록 방지)이며,
  판정은 outbound 요청 카운트(클릭 전 0 / 클릭 후 1)로 수행한다. 실제 인증 성공 화면이 아니다.

## 결함
| id | severity | 재현 | expected | actual | evidence | owner |
|---|---|---|---|---|---|---|
| (없음) | — | — | — | 본 fixture 범위에서 재현된 결함 없음 | result.json × 2, png × 3 | — |

## 통계·공개 경계
- 게이트 단계이므로 1건/0분모/partial month/completed_date 누락/mask collision은 본 검수 범위 밖.
- 토큰·계정 식별자·query code 기록 없음(합성 토큰 문자열은 fixture 코드 내부 상수이며 보고서에 미기록).
- `dist/` 빌드 산출물은 git 추적 대상이 아님(`git status`에 미표시, 무시됨).

## 최종 판정
- PASS (fixture 범위): 로그아웃 후 자동 재로그인 없음, 로그인 게이트 명시 클릭 대기 — 1440/390,
  pageerror·네트워크(outbound 카운트) 기준 충족. 콘솔 메시지는 별도로 수집하지 않았다.
- NOT_RUN (실제 환경, 별도 승인 필요): 실제 Kakao 세션이 남아 있는 브라우저에서의 로그아웃 후 거동,
  운영 Pages 배포 URL에서의 게이트 검증, 실제 OAuth 왕복·실제 계정 로그인·실제 통계 API 연동.
  운영 배포를 테스트한 것으로 표시하지 않는다.
