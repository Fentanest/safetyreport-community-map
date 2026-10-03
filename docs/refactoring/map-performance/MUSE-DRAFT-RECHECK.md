# Muse narrow recheck · RankingsPage two tiny fixes (fixed 7542cde)
- Scope: ONLY `src/pages/RankingsPage.tsx` diff `8901ad4..7542cde` (2 commits:
  `29f836f` advanced first-edit race, `7542cde` numeric `rk_min` restoration).
  Prior UI approval `2cd5442` and SQL changes `8901ad4` are OUT of scope.
- Worktree: `.agent-runtime/mn` (own). HEAD before = HEAD after =
  `7542cded652c91835f3421f394f4466b6e9b0c6d`. `git diff` product empty (verified).
- Model: requested `opencode-go/muse-spark-1.3-contributor/high`; actual provider/model
  ID is not verifiable from inside this session → recorded as requested-model run.
  No other models, no API billing.
- Server: OWN Vite E2E `E2E_PORT=5198 npx vite --config scripts/browser/vite.e2e.config.ts
  --host 127.0.0.1` (reused running instance, no duplicates). Shared 5190/5192 untouched.
- Browser: system Chrome 154.0.8037.92 headless via raw CDP (no Playwright/MCP).
  Socket-limit recovery per Sol: `TMPDIR='.'` (relative dot) + `cwd`=worktree +
  `--user-data-dir=.b` inside worktree. No /tmp, no $HOME profiles, no permission changes.
- Helper (reproducible): `.agent-runtime/recheck-5198/run5198.mjs` (+ fixed `cdp.mjs`
  result-path bug). Evidence: `docs/refactoring/map-performance/evidence/muse-draft/`
  (`checks.json`, `network.json`, `console.json`, 4 screenshots, all opened below).

## What the two fixes do (read, not inferred)
1. `29f836f`: removed the open-time draft reset in `details.onToggle` (it ran AFTER the
   first input event and erased a fast `report_date` selection → apply sent nothing).
   The closed-panel effect already syncs drafts while closed.
2. `7542cde`: `queryFromSearch` now does `p.has(rk_min) ? Number(p.get(rk_min)) : undefined`
   because `querySchema.min_reports` is numeric (`z.number`); string `"1"` failed validation
   and fell back to default on reload/remount/history.

## Result: APPROVE (narrow scope only) — 37/37 checks PASS, 0 console/page errors
FAST draft race (1440 dark, real keyboard): open→Tab reaches 날짜 기준 (A0b) →
ArrowDown selects 신고일 and it survives (A3) → no new query signature while editing (A4,
only StrictMode same-signature dup noise) → draft hint shown (A5) → Tab,Tab reaches 적용
(A8, focus ring visible in screenshot) → Space sends exactly ONE new query signature
carrying `date_basis=report_date` (A6/A7).
Draft lifecycle: unapplied draft staged (B1) → close/reopen resets to applied values (B2) →
no new query (B3). Immediate controls: tab change one new query with APPLIED basis (C1/C2),
month switch immediate (C3), month label follows (C4).
URL restoration (D): direct entry `rk_theme=unlucky&rk_metric=partial_rate&rk_period=month&
rk_month=2023-07&rk_basis=report_date&rk_category=traffic&rk_min=3` → request carries
month/basis/metric/min_reports=3 (D1), heading `2023년 7월 · 일부수용 비율이 높은 순위` (D2),
tab/category/month-label (D3), details controls report_date+3 from actual React state (D4),
reload preserves full state (D5), saved `rk_min=1` restores numeric 1 (D6).
Invalid `rk_min=abc` fails closed to default theme/metric/min 1 (E1).
In-app map→rank keeps `rk_*` in URL (F1), restores applied state (F2); history back leaves
rankings (F3), forward returns with state (F4).
Stress: 20 rapid open/edit cycles keep every first edit (G1), fire no new query (G2), one
apply after stress sends exactly one new query with latest basis (G3).
390 light keyboard FAST (H1/H2/H3) + 390 dark entry screenshot; session UID unchanged (I1);
no page-level horizontal overflow at 390 (I2).
Network: 18 `user-rankings` requests (17×200 + 1×aborted StrictMode dup);
consoleErrors 0, pageErrors 0.

## Screenshots (all actually opened in this session)
- `1440-dark-fast-applied.png` — details open, 날짜 기준=신고일, 최소 1건, 적용 focused.
- `1440-dark-stress.png` — post-20-cycle apply, 신고일, clean layout.
- `390-light-fast.png` — light theme keyboard apply, bottom nav, no overflow.
- `390-dark-entry.png` — dark entry, details closed, clean.
All show the `랭킹을 불러오지 못했습니다` panel: EXPECTED fixture limitation (see below),
not a product failure. No unexpected visual defects in the reviewed controls.

## Explicit fixture/mock limits (not claimed as production proof)
- The E2E stack does NOT serve `/functions/v1/user-rankings` (falls through to Vite SPA
  `200 text/html` → client Zod parse fails → error panel). Hence NO ranking rows/me/ties
  rendered here. All scope assertions rest on request query strings + actual React control
  state. Row-level `min1/N1/ties` rendering is UNCHANGED by these two diffs (no table code
  touched) and covered by prior wider reviews, not re-proven here.
- Kakao SDK is the synthetic `mock-kakao-sdk.js`; map itself is out of this narrow scope.
- Synthetic Node facts/SDK explicitly labeled mock; account/generation paths untouched.
- Wider 360/390/768/1440/zoom coverage from prior reviews is preserved, NOT re-run here;
  this recheck covers 1440 + 390 light/dark only.
- Harness notes for reproducibility: (a) request assertions compare query SIGNATURES because
  React StrictMode double-mounts effects (dup/abort share one signature); a late abort-dup
  must not satisfy an apply-wait (`waitForNewSig`). (b) CDP-injected `rawKeyDown`+`keydown`
  are each default-handled (one Tab moved two stops) → helper sends `keyDown`+`keyUp` only.
  (c) The dashboard command bar has its own `날짜 기준` select earlier in the DOM — all
  rankings reads are scoped to `.rk-page` (an unscoped read initially mis-attributed basis;
  product was correct, verified: rk select=`report_date`, min=`3`).

## Verdict
APPROVE for the narrow scope: FAST first-edit preservation + numeric `rk_min` restoration
(incl. month 2023-07 / report_date / partial_rate / min 1·3 direct+reload+map-return+history,
invalid-min fail-closed). No other product UI changes (diff = 1 file, +4/−7). No commit,
deploy, push, or host changes made. Session export left for Sol to verify.
