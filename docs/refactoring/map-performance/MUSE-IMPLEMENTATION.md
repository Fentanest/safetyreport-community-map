# Muse implementation report — rankings §8 + statistics polish

- request_mode: implement. Model/variant host-verified by Root session export:
  `opencode-go/muse-spark-1.3-contributor`, high. No billing fallback, substitution, or permission changes.
- worktree: `.agent-runtime/worktrees/muse-ui`, branch `muse/map-performance-ui`, base `cf90096`.
  No cloud/other-repo/production changes; no main merge/push.
- ownership: ONLY `src/pages/RankingsPage.tsx`, `src/styles/rankings.css`,
  `src/pages/StatisticsPage.tsx`, `src/styles/scope-statistics.css`
  plus this report and `docs/refactoring/map-performance/evidence/muse-implementation/**`.
  Root owns tests/scripts/data/domain/Dashboard/tokens/packages — none touched.
  Scratch (server log, PID, verify scripts) lived only in ignored `.agent-runtime/tmp/`.

## 1. What changed

### `src/pages/RankingsPage.tsx` (rewritten, ~950 lines)

- H1 is now `참여자 랭킹`; sub-line shows the exact metric title with period prefix
  (`이달 · …`, `2023년 7월 · …`, `start — end · …`, none for all-time).
- Three tabs only: 신고 랭킹 / 과태료 랭킹 / 불운 랭킹 (`aria-pressed`). Six-preset
  UI, `RANKING_PRESETS`/`selectRankingPreset`/`rankingTitle` imports, and the global
  적용 button are gone. Internal `theme`/`metric` mapping is contract-compatible (no DB enum change).
- Common period `[전체 기간] [월별] [기간 지정]`; month mode shows `〈 YYYY년 M월 〉`
  prev/next + direct `type=month` input (KST, never hardcoded); `분류` select on the
  main screen; `날짜 기준` + `최소 신고 건수` inside a `상세 조건` disclosure with its
  own 적용; range `시작일/종료일` with its own 조회 and inline validation (no general apply).
- Triggering: tab / metric segmented / category / month prev-next-direct commit
  immediately from APPLIED values (range/advanced drafts never leak in).
  Range 조회 and advanced 적용 consume only their own drafts. Identical selections
  are dropped by key comparison (no refetch of the selected tab/button); identical
  in-flight semantics preserved via Abort + generation.
- Per-theme last-metric memory (in-memory only, never persisted): returning to
  `unlucky` restores `partial_count`/`partial_rate` after a fines round-trip.
- Per-tab metrics: reporters has no metric switch; fines `[건수순][비율순]`;
  unlucky `[불수용][일부수용] × [건수순][비율순]`. Exact titles
  (`완료 신고가 많은 순위`, `과태료 처분 건수가 많은 순위`, `과태료 처분율이 높은 순위`,
  `불수용 건수가 많은 순위`, `불수용 비율이 높은 순위`, `일부수용 건수가 많은 순위`,
  `일부수용 비율이 높은 순위`). Rate mode surfaces the min-reports hint next to the switch.
- Thin `내 순위` block before the list uses `response.me`/`total_participants` only
  (never page rows): `내 순위 12위 / 248명 | 과태료 처분율 75.0% | 96건 중 128건 |
  완료 신고 128건 | 공동 N명`. `me=null` shows guidance, never `0위/0건`.
- Desktop table: generic `값` header removed; per-metric headers; reporters shows
  3 columns (순위/참여자/완료 신고, no repeated count); other metrics show
  4 columns (+ 완료 신고). Rate cells carry `분자건 중 분모건`; unknown/`표본 1건`
  notes kept. Fraction note rendered: display rounding never re-sorted client-side.
  Pager shows `참여자 start–end / total명` computed from `response.page_size`
  (no hardcoded 20 in copy). Out-of-page `me` preserved via server `me`.
- UUID: short UUID itself is the button (`aria-haspopup="dialog"`) opening a small
  `role="dialog" aria-modal` popover with readonly full UUID + 복사/닫기.
  Tab-trapped, `Escape` closes, focus returns to the opener, clipboard-denied
  shows an explicit failure message (never fake success) with manual-select fallback.
  React key/selection/copy use the full UUID. Self row keeps token-based `나` badge.
  The dialog closes on hidden/account/query changes.
- Mobile: separate two-line `<ul class="rk-list">` (same formatters), dividers, no
  shadow cards, no nested `480px` scroll — single page scroll. Desktop table hidden
  on narrow via CSS `display:none` (one exposed tree at a time).
- Internal terms (`N`, `F`, `R/N`, `completed_unknown`, 초안, 값) removed from the
  default screen; plain-language `집계 기준 보기` kept + separate collapsed
  developer diagnostics (not deleted).
- URL: `rk_*` only (map/stats params preserved); direct entry/refresh/back-forward
  work; a URL with no `rk_*` resets to the default query instead of a stale snapshot.
- Request lifecycle: 429 keeps only the latest intent (`pendingIntent`), auto-resumes
  exactly once on expiry (pending intent or one refetch), countdown shown, no storm.
  409 handling kept (page-1 restart / notice). Guards (generation, viewer, query key,
  active, visible) apply on resolve even if abort is ignored. Hidden/logout clears
  the protected response; nothing persisted (no localStorage/IDB/SW).

### `src/styles/rankings.css` (rewritten)

Token-only styles for tabs, metric segmented groups, month stepper, range/advanced
rows, thin me strip, scope line, fraction note, UUID dialog/backdrop, copy states,
desktop table + mobile two-line list switch, focus-visible rings, reduced-motion kept.

### `src/pages/StatisticsPage.tsx` (+66/−~10)

All features retained (presets, rows/cols/metrics editors, filters, whole/mine/compare,
member picker, saved recipes, share link, table/chart/export parity, hidden series).
Changes only:

- Mobile result-first: `조건 변경` toggle (`aria-expanded`, narrow-only via CSS);
  layout carries `data-editor`; builder hidden when closed on narrow.
- PC grouped editor: `범위 / 누구의 신고`, `행 · 열`, `지표 / 비교 대상` group headings.
- Hidden/inactive suspend: `execute` while hidden/inactive aborts, advances the
  generation, and retains the latest intended recipe in `runRef`; visibility/active
  listeners resume it exactly once when visible. Handoff/share effects are
  active-guarded (suspend via the same path). No dashboard fetching added or changed;
  direct-entry metadata remains Root-owned.

### `src/styles/scope-statistics.css` (+14)

Group titles, narrow-only editor toggle, result-first ordering, closed-builder hiding,
and flex-blowout containment (`min-width:0; width:100%` chain) — the last fixed a
measured 3117px page-level overflow on statistics mobile (table now scrolls inside
the pre-existing `.pivot-scroll`).

## 2. Verification

- `npm run build` (tsc + vite): PASS on final state.
- Read-only unit: `rankings`, `rankingPeriods`, `scopeStatisticsUi`, `statistics` —
  4 files / 49 tests PASS. No test files modified.
- Actual browser (own `vite.e2e` server on E2E_PORT=5196, synthetic stack, no DB
  seeding; server log/PID/scripts under ignored `.agent-runtime/tmp/`; own server
  stopped afterwards, main-repo processes untouched):
  - 11/11 structural checks PASS: H1, 3 tabs, unlucky→immediate `rk_theme`,
    `partial_rate` restore path, category-immediate, month-step `2026-10→2026-09`,
    range validation message, fetch-outcome panel, 390px no-overflow, 3 mobile tabs,
    statistics renders. Zero console errors on rankings desktop+mobile.
  - Follow-up 4/4 PASS: statistics zero `flushSync` warnings (fixed, see §3),
    mobile `조건 변경` toggle visible, builder hides on close with result first,
    page-level overflow 0px after containment fix.
  - 6 screenshots actually opened and read: `rk-A1-tabs`, `rk-A2-unlucky-partial-rate`,
    `rk-A3-range-outcome`, `rk-B1-mobile-light`, `rk-C1-statistics`,
    `rk-C2-stats-mobile-result-first` (copied to evidence/).
  - `rk_*` URL + back/forward semantics verified in-run (tab/metric/category/month
    each rewrite only `rk_*`; map/stats params preserved by construction).

## 3. Fixes found during verification (all in owned files)

1. Script-sequencing false FAIL (month stepper needs 월별 first) — harness script only.
2. `flushSync` inside the Rankings hidden/auth passive effect produced React
   lifecycle warnings on the statistics screen — removed (plain setState; handler
   paths unchanged). Re-verified 0 warnings.
3. Statistics mobile 3117px page overflow from the new flex-column layout —
   contained with `min-width:0/width:100%` chain; pivot table keeps its pre-existing
   internal scroll. Re-verified 0px page overflow.
4. Removed sub-line period duplication (heading already carries the period prefix).

## 4. BLOCKED / needs the rankings-route environment (for Root's integrated review)

The synthetic e2e stack serves no `/user-rankings` route, so every rankings fetch
ends in the error panel (verified as the correct failure surface, not silent).
Live-row paths are code-complete but unverified here — Root's adapted legacy
scripts on the fixed integrated commit should cover: populated table/pager ranges,
`내 순위` values, joint-rank display, UUID dialog open/copy/failure with real rows,
429 auto-resume against a real limiter, hidden/account-race guards with late data,
`rk_*` back/forward across real pages, and 200% text zoom. No baseline numbers are
fabricated in this report; Root's audit baseline stands as the reference.

## 5. Integration notes for Root

- Owned files only in the commit below; `docs/tasks/*` prompts untouched.
- `Dashboard.tsx` contract assumed unchanged (`active` prop, `hidden` hiding,
  session-key remount on account change) — relied upon by the guards.
- Backwards compat: existing `rk_*` URLs parse into the new state (unknown values
  fall back to defaults via `querySchema`); six-preset-era URLs carry the same
  `rk_theme/metric/period` keys, so old links keep working.
- Watch item: `.stats-layout` narrow mode is now flex-column (was grid
  single-column); desktop grid untouched.
