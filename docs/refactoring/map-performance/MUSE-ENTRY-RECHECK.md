# MUSE ENTRY RECHECK — fixed commit 2cd5442 (request_mode=review)

- review commit (detached worktree, read-only): `2cd544299029b8ecec6c71ccbb5a767dc2dcc7dc`
  `perf(ui): preserve immediate ranking entry after measuring lazy regression`
- diff vs prior approved review (`7d25a9f..2cd5442`): product change is ONLY
  `src/pages/Dashboard.tsx` — `RankingsPage` goes from `lazy(() => import(...))` to a static
  eager import (with comment: still mounts/fetches solely on the ranking screen; `StatisticsPage`
  stays lazy). Everything else in the range is docs (`product-decisions`, `repository-audit`,
  `screen-by-screen`, `ui-spec`) plus two new measurement scripts
  (`measure_production.mjs`, `verify_browser_zoom.mjs`). No contract/SQL/handler changes.
- reviewer model: `opencode-go/muse-spark-1.3-contributor` — ID confirmed present in host
  `opencode models` list (alongside `-1.2-contributor` and `-free` variants); variant `high`
  per dispatch assignment. No API substitution, no guessed IDs, no permission/credential changes.
- session: fixed worktree `.agent-runtime/worktrees/muse-recheck` (HEAD verified `2cd5442` before
  and after the run). No product files modified, no commits, no pushes, no host/DB/other-project
  changes. Prior `7d25a9f` review verdict was APPROVE; this is a narrow entry-behavior recheck,
  not a full re-review (no SQL reruns, no perf reruns).
- verdict: **APPROVE (recheck)** — the eager-import change preserves every entry behavior checked
  below (27/27 PASS). Two non-blocking screenshot-composite notes (OBS-E1/E2). Prior OBS-01
  (emulated-195px `.header-end` overflow) is unchanged in scope and NOT retested here; the real
  200% browser-zoom regime below passes.

## 1. How this recheck ran (and what it is NOT)

- Real headless Chromium (Playwright via `scripts/browser/harness.mjs`), own dev server
  `E2E_PORT=5191` (`npx --no-install vite --config scripts/browser/vite.e2e.config.ts`,
  stdin `/dev/null`, detached via `setsid`, PID recorded, stopped after the run). Root
  ports 5190/5192/57098/57099 untouched (verified listening before/after; Xvfb `:97`
  used but never terminated).
- Rankings rows supplied EXCLUSIVELY by `attachRankingFixture(context)` from
  `scripts/browser/ranking_fixture.mjs`, attached BEFORE navigating to rankings
  (opened map first, attached fixture, then `goto ORIGIN+'/?screen=rankings'`). Explicit
  UI-fixture evidence — NEVER real SQL/auth/production. Statistics/personal via the E2E
  synthetic stack (real HTTP through `server/publicHandler.ts` + `demoEngine.ts` facts,
  counted via `POST /__e2e/log`). Mock Kakao SDK via route fulfill.
- Every screenshot below was actually opened and read (not merely generated).
  Behavioral JSON: `evidence/muse-entry/results.json`. Repro script:
  `evidence/muse-entry/recheck.mjs` (run with `E2E_PORT=5191` against the vite.e2e server).
- Two script bugs found during the run and fixed in the script (NOT product): mobile row
  selector is `.rk-list li` (not `.rk-row`); rail buttons are `통계/지도/유저 랭킹` (there is no
  `분석` screen button); the one-shot 429 route must be armed AFTER entry completes or the
  default entry request consumes it (observed: entry-429 → app retried and recovered, a
  resilience plus, but it voided that attempt's cooldown assertion).

## 2. Results — entry behavior (the actual subject of this commit)

| id | behavior | result + evidence |
|---|---|---|
| R-direct-one-default | direct rankings entry fires exactly 1 request with defaults (`theme=reporters, metric=reports_count, period=all, date_basis=completed_date, category=all, min_reports=1, page=1, page_size=20`) | PASS (`A-rankings-direct-dark.png` opened: H1, tabs, rows, pager all render) |
| R-h1-tabs | H1 `참여자 랭킹`, exactly 3 tabs `신고 랭킹\|과태료 랭킹\|불운 랭킹` | PASS (same shot) |
| R-headers | reporters desktop headers exactly `순위\|참여자\|완료 신고` | PASS |
| R-me-strip | thin `내 순위` strip from server `me` (`내 순위 1위 / 26명 … 완료 신고 53건`) | PASS |
| R-pager | `참여자 1–20 / 26명` from `page_size` | PASS |
| S-direct-no-dashboard | statistics direct entry: NO `dashboard`/`overview` request; routes exactly `meta, statistics/catalog, statistics/query` | PASS (`B-statistics-direct-dark.png` opened: pivot result + builder render) |
| S-direct-meta-catalog-query | `meta=1, catalog=1, query=1` (single session-restore run) | PASS |
| C-fines | fines tab → headers `순위\|참여자\|과태료 처분\|완료 신고` | PASS |
| C-same-no-dup | identical `월별` re-click sends nothing (server log 0→0) | PASS |
| C-rankings-controls-server-silent | all rankings tab/period controls add ZERO server-log entries (fixture-handled) | PASS |
| C-stats-no-dashboard | rail → statistics adds only `meta, statistics/catalog, statistics/query` | PASS |
| C-rankings-return-server-silent | rail statistics → map → rankings: return leg adds ZERO server entries | PASS |
| C-no-hidden-dashboard | the run's single `dashboard` request comes from the map screen itself (its own legitimate fetch), never from rankings/statistics controls | PASS (`C-rankings-after-nav.png`) |

Net meaning for the commit: eager `RankingsPage` still mounts and fetches ONLY on the ranking
screen — no eager fetch on map/statistics entry (server log silent), and entry issues exactly
one default query. The lazy→eager change is behavior-preserving on every entry path checked.

## 3. Results — matrix, keyboard, race, 429 (spot re-verification)

| id | behavior | result + evidence |
|---|---|---|
| D-360/390/768/1440-dark+light | rankings: 3 tabs, rows, `scrollWidth <= innerWidth`, table above 700px / list at/below | PASS ×8 (all `D-rankings-*.png` measured `sw==iw`; `D-rankings-390-light.png` opened: two-line list rows, bottom nav, pager above nav) |
| D-stats-390-light / 1440-dark | statistics representative: no page overflow | PASS (390-light opened: result-first `조건 닫기`, internal `.pivot-scroll`; see OBS-E2) |
| E-keyboard-focus | focus in `.rk-tabs`, `:focus-visible` outline/box-shadow, Enter-activation path stable | PASS (`E-keyboard-focus.png` opened: visible focus ring on `신고 랭킹`) |
| F-latest-intent | 900 ms-delayed fines response does not clobber newer unlucky intent (`rk_theme=unlucky`, title `불수용 건수가 많은 순위`, competition `공동 2명` rows, page-external me strip `21위/26명`) | PASS (`F-latest-intent.png` opened and read) |
| G-429-cooldown | one-shot 429+`Retry-After: 2` → disabled `3초 뒤 다시 시도` button; mid-cooldown unlucky click fires nothing (`net 3→3`) | PASS |
| G-429-latest-intent | auto-resume applies ONLY the latest intent (`rk_theme=unlucky`, ties intact) | PASS (`G-429-recovery.png` opened and read) |

Console: zero unexpected errors across the whole run (`results.json` `consoleErrors: []`).
Network: waiter-before-action throughout; no duplicate/immediate leaks observed.

## 4. Actual 200% browser zoom (headed Chromium under root Xvfb `:97`)

Ran the fixed commit's own `scripts/browser/verify_browser_zoom.mjs` with
`DISPLAY=:97 E2E_PORT=5191`, output to `evidence/muse-entry/browser-zoom/` (Xvfb NOT terminated).
Result: **4/4 PASS, EXIT=0** — `rankings/statistics × dark/light`: `dpr=2`,
`outerWidth/innerWidth = 810/384 ≈ 2.11`, `cssZoom='1'` (no CSS emulation),
`scrollWidth=376 <= innerWidth=384`, keyboard focus `true` on all four.
`rankings-dark-actual200.png` opened and read: real zoomed viewport render (810 physical px =
384 CSS × dpr 2), tabs/period/category controls legible, no overflow, bottom nav intact.
This is genuine browser-chrome page zoom (isolated profile
`partition.default_zoom_level.x = log(2)/log(1.2)`), not CSS/device emulation. Prior OBS-01
(emulated ~195px-effective `.header-end` overflow) belongs to a narrower effective width than
this regime (384 CSS px) and stands as labeled.

## 5. Observations (REPORT — no product files changed)

- **OBS-E1 (screenshot artifact, non-blocking):** `D-rankings-390-light.png` fullPage composite
  skips the 2위 row (rows shown: 1,3,4,…,20). DOM re-query on the same build/viewport returns
  exactly 20 `.rk-list li` rows in rank order 1–5… (`rowcount.mjs` run, output logged). Cause is
  fullPage stitching against the sticky bottom nav, not a data/DOM defect.
- **OBS-E2 (screenshot artifact, non-blocking):** `D-statistics-390-light.png` composite shows
  pivot rows sliding under the sticky bottom nav mid-stitch. DOM overflow check passes
  (`sw <= iw`); the pivot table keeps its internal `.pivot-scroll`.
- No other defects found on the rechecked surface. No crowns/podium/TOP3, no `값` headers,
  no full-UUID leaks (short-UUID buttons only), no dashboard leaks from rankings/statistics.

## 6. Explicitly NOT_RUN / limits (with reasons)

- Real SQL/auth/production, real Kakao SDK/OAuth, GoTrue flows, normal-HTTP checks: out of scope
  by instruction — Root owns them. Fixture `me`/ranks prove UI wiring only.
- Production timing numbers (the ~247/266ms vs ~263/297ms 30-run comparison): NOT rerun here;
  Root measured. This recheck covers entry *behavior*, not entry *performance*.
- Full rankings/statistics matrices from `MUSE-FINAL-REVIEW` (month stepper, range/advanced
  drafts, UUID dialog/clipboard, empty-month, 500-path, account-B separation, anonymous gate,
  save/share/compare/export, meta-500): covered by the APPROVED `7d25a9f` review against
  identical code paths (this commit touches none of them); representative samples only here.
- Real Excel binary open, RUM/field INP, screen-reader pass beyond focus/dialog semantics:
  environment-limited, same as prior review.

## 7. Evidence index (`docs/refactoring/map-performance/evidence/muse-entry/`)

Screenshots (all opened and read): `A-rankings-direct-dark`, `B-statistics-direct-dark`,
`C-rankings-after-nav`, `D-rankings-{360,390,768,1440}-{dark,light}`, `D-statistics-390-light`,
`D-statistics-1440-dark`, `E-keyboard-focus`, `F-latest-intent`, `G-429-recovery`,
`browser-zoom/{rankings,statistics}-{dark,light}-actual200`. Behavioral JSON: `results.json`
(27/27 PASS, `consoleErrors: []`); zoom JSON: `browser-zoom/results.json` (4/4 PASS).
Repro script: `recheck.mjs` (`E2E_PORT=5191 node recheck.mjs`); zoom via the committed
`scripts/browser/verify_browser_zoom.mjs` with `DISPLAY=:97`.

## 8. Reproduction recipe (for Root re-run)

1. `setsid env E2E_PORT=5191 npx --no-install vite --config scripts/browser/vite.e2e.config.ts`
   (own port; stop only this PID afterwards).
2. `E2E_PORT=5191 node docs/refactoring/map-performance/evidence/muse-entry/recheck.mjs`
   (open map → attach fixture → enter rankings; statistics direct; rail cross-nav; matrix;
   keyboard; delayed latest-intent; one-shot 429 armed post-entry).
3. `DISPLAY=:97 E2E_PORT=5191 node scripts/browser/verify_browser_zoom.mjs <outdir>`
   (headed, root Xvfb; do not terminate `:97`).

## 9. Approval (narrow scope)

**APPROVED at `2cd5442`** for the entry-behavior surface of the eager-`RankingsPage` change,
within the stated fixture/runtime limits (27/27 checks + 4/4 real-zoom checks, zero console
errors, screenshots actually read). No product changes made by this recheck. Prior
`7d25a9f` APPROVE remains the basis for the un-retested paths; OBS-01 and new OBS-E1/E2 are
the only non-blocking notes. Perf numbers, real SQL/auth/HTTP, and release order stay with
Root per the work agreement.
