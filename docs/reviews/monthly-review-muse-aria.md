# Monthly review — Muse aria-sort closure (27de7f3)

- Target commit: `27de7f3` ("fix: expose matrix row-total sort state"), detached HEAD, worktree `monthly-review-aria`.
- Previous Muse review: `c99bee6` broad 54-check (`ses_effa3f575ffeflFJt16gSvgBw7`) — viewport/screens/modal/IME/queries passed; only open item was matrix `aria-sort` absent (hasCols guarded primary th). This report closes only that item. The 54 broad re-run was not repeated (per instruction; root re-runs 39+6 paging).
- Server: root-owned `http://127.0.0.1:5142` ONLY (candidate). No source/config/DB/host/process changes by Muse. No push/deploy/server writes.
- Tools: `E2E_PORT=5142` harness `scripts/browser/harness.mjs`; Playwright-core `1.63.0` (read-only) + `/usr/bin/google-chrome` `154.0.8037.92`; node `v22.17.1`. Helpers written only under approved evidence path, importing `../../../../../scripts/browser/harness.mjs`.
- Data: LOCAL synthetic only (`__e2e` handlers, `managers` dataset where noted), MOCK Kakao SDK route. No JWT/session/credentials printed or saved. Given rows/values used strictly; no fake product placeholders.
- Evidence: `docs/implementation/monthly-review-20261003/evidence/muse-aria/` (`verify_aria.mjs`, `verify_aria2.mjs`, `aria-result.json`, `aria-result2.json`, PNGs below — all opened and viewed).

## Results (actual browser)

| # | Check | Result |
|---|-------|--------|
| A | Normal no-column table (`manager_duration`, 118 rows, managers fixture): after sort click exactly 1 `th[aria-sort]`, 0 `button[aria-sort]`, value `descending`, no `.pivot-total[aria-sort]` | PASS (`aTh=1,aBtn=0,aVal=descending`) |
| A2 | Row order follows aria: `김민준…강남경찰서 125건` first, then `124건…`, pager `1–50`; screenshot arrow ▾ on 답변 건수 | PASS |
| B | Matrix (`outcome_disposition`) fresh state: 0 `th[aria-sort]` before sort; click NON-total column header → exactly 1 `th[aria-sort]` AND it is the TOTAL th (`bTot=1`), 0 `button[aria-sort]`, `descending` | PASS |
| B2 | Click TOTAL button toggles to `ascending`, still single TOTAL th; rows flip (`수용…` ↔ `미분류…` first) | PASS |
| B3 | Visible arrow matches aria (`::after` `▾` for descending, verified; ascending rule `▴` in CSS) | PASS |
| B4 | Grand total preserved across sort toggles (`7,847건` before/after) — server totals contract intact | PASS |
| B5 | Keyboard Enter and Space on numeric `.pivot-cell` each open `이 항목으로 좁히기` dialog | PASS (both) |
| C | Compare (`전체와 비교`, signed-in synthetic): sort → single TOTAL th on first-population side (`답변 건수 합계 · 전체`), 0 button aria, no duplicated aria across matrix columns | PASS |
| F | Keyboard `:focus-visible` outline `2px solid rgb(96,165,250)` offset `3px` (global `app.css` rule) | PASS |
| O | No page overflow (`scrollWidth<=innerWidth+1`) at 1440 dark/light, 390 dark/light | PASS (4/4) |

Note on run 1 vs run 2: run 1 reused the `manager_duration` desc sort state (same metric `completed_count`), so the first matrix click toggled desc→asc and the total click toggled asc→desc. Run 2 from a fresh preset state shows the canonical sequence: no aria → non-total click → `descending` on TOTAL th → total click → `ascending`. Both are correct toggle semantics; single-TOTAL-th invariant held in every state (`button[aria-sort]=0` always).

## Network / console

- `__e2e/log` (run 2): `meta 200`, `dashboard 200`, `statistics/catalog 200`, `statistics/query 200` ×2 (agency×law default + outcome×disposition). No failed requests.
- Console errors: `[]` in both result JSONs (no pageerrors; no 503s injected in this targeted pass).

## Screenshots (viewed)

- `evidence/muse-aria/A-normal-1440-dark.png` — 118-row manager table, 125→108건 descending, ▾ on 답변 건수. Viewed: yes.
- `evidence/muse-aria/table-1440-dark.png` — matrix managers fixture (7,847건), ▾ on 답변 건수 합계. Viewed: yes.
- `evidence/muse-aria/table-1440-light.png` — matrix default fixture (341건), ▾ on 합계. Viewed: yes. (Dataset differs because the light shot runs after `api reset`; both are server-given synthetic values.)
- `evidence/muse-aria/table-390-dark.png`, `table-390-light.png` — 390px matrix inside scroll region, bottom-nav visible, page-level no overflow. Viewed: yes.
- `evidence/muse-aria/table-focus-1440-dark.png` — keyboard-focus pass capture. Viewed: no (artifact only; focus metrics asserted programmatically).

## Closure statement

The c99bee6 open item is CLOSED: matrix row-total sort state is now exposed on exactly ONE TOTAL-column `th` (`aria-sort` descending/ascending), never on buttons or per-column headers; normal tables expose exactly one `th[aria-sort]`; compare mode keeps the single aria on the first-population (`· 전체`) total; row ordering, visible arrow, and server-recomputed totals all match the active aria. No new issues found; no broad re-run needed.
