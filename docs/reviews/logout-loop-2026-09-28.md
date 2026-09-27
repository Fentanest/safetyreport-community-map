# 지도 로그아웃 후 자동 재로그인 수정 · 2026-09-28

- 정책: 사용자의 최신 지시 — 로그아웃·인증 취소 뒤 로그인 안내에서 자동으로 카카오 인증을 다시 시작하지 않는다.
- 원인: `src/App.tsx`의 `signed_out` 효과가 첫 방문뿐 아니라 `signOut({scope:'local'})` 뒤에도 `signIn()`을 호출했다. Kakao 브라우저 세션이 남아 있으면 OAuth가 곧바로 성공해 로그인·로그아웃 순환처럼 보였다.
- 수정: 해당 자동 호출을 제거했다. 로그인 안내는 유지하고 `카카오로 로그인` 버튼을 누를 때만 OAuth를 시작한다. 지도 통계 API의 서버 인증과 지도 세션의 local 로그아웃은 그대로다.
- 계약 동기화: `PROJECT_RULES.md`, `docs/personal-comparison.md`, 로컬 스택 브라우저 스크립트 두 개의 기대 동작을 갱신했다.

## 재현 가능한 브라우저 검증

- 검수 대상: `fix/logout-login-loop` 로컬 후보, `VITE_DATA_MODE=live` 빌드, Chrome 154.0.8037.57, Playwright Core 1.63.0.
- 익명 새 브라우저로 로컬 preview에 진입: 로그인 안내가 유지되고 OAuth·통계 요청은 0. 로그인 버튼 클릭 뒤 OAuth 요청 1건. pageerror 0. 이미지: `screenshots/logout-loop/anonymous-gate.png`.
- `PLAYWRIGHT_CORE=/tmp/cm-live-browser/node_modules/playwright-core/index.mjs node scripts/integration/logout_gate_browser.mjs docs/reviews/screenshots/logout-loop`: 합성된 지도 세션으로 실제 React 화면에 들어가 `로그아웃` 클릭. `scope=local`, 지도 저장 세션 삭제, 지도 숨김, 로그인 안내 유지, 자동 OAuth 0, 버튼 클릭 후 OAuth 1, pageerror 0. 결과: `screenshots/logout-loop/result.json`, 화면: `screenshots/logout-loop/after-logout.png`.
- 이 검증은 실제 계정·토큰을 사용하지 않는다. 운영 Pages 배포와 실제 카카오 세션이 남은 브라우저의 재검증은 별도 승인 뒤 수행한다.

## 검사

- `npm test`: 216 passed / 28 skipped.
- live 설정 `npm run build`와 `npm run scan`: 통과.
- `node --check scripts/integration/{live_login_e2e,access_gate_e2e,logout_gate_browser}.mjs`: 통과.
