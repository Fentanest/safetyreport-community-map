# Muse M0 planning review — map-performance rankings/statistics UI

- request_mode: plan (no product edits in this task)
- worktree: `.agent-runtime/worktrees/muse-ui`, branch `muse/map-performance-ui`
- base/HEAD: `cf9009666a164ca91f694fd5a4164bffbe29ef0b` (matches requested base `cf900966`; HEAD clean except pre-existing untracked `docs/tasks/*`)
- date (KST): 2026-10-03
- model: `MODEL_UNVERIFIED` — provider/model/variant not verified via host in this turn; no billing fallback, substitution, or permission changes performed.
- ownership this task: `docs/refactoring/map-performance/MUSE-M0.md` + `docs/refactoring/map-performance/evidence/muse-m0/` only. No product files touched.

## 1. What was read

Required docs (all opened in this worktree):

- `PROJECT_RULES.md`, `AGENTS.md`, `MUSE.md`, `SOL.md`
- `docs/implementation/MASTER_PROMPT.md`, `docs/product-decisions.md`, `docs/repository-audit.md`
- `docs/ui-spec.md` (full, incl. §14 user-ranking period selection), `docs/screen-by-screen.md` (§13 user ranking)
- `design/reference-ui/index.html` (53 lines, layout reference only — map is a mock, not the real Kakao map)
- skills: `.agents/skills/cm-cinematic-ui/SKILL.md`, `.agents/skills/cm-browser-review/SKILL.md`, `.agents/skills/cm-sol-muse/SKILL.md`
- new instruction: `docs/tasks/map-performance-user-prompt.md` — all 630 lines read
- ranking contracts/code (read-only): `contracts/user-rankings/README.md`, `contracts/user-rankings/types.ts`, `contracts/user-rankings/query.schema.json`, `contracts/user-rankings/response.schema.json`, `src/domain/rankingPeriods.ts`, `src/data/rankings.ts`, `src/pages/RankingsPage.tsx` (742 lines), `src/styles/rankings.css` (75 lines), `src/pages/StatisticsPage.tsx` (507 lines), `src/styles/scope-statistics.css` (215 lines), `docs/user-rankings.md`, `docs/implementation/ranking-periods/REPORT.md`
- integration boundary (read-only, Root-owned): `src/pages/Dashboard.tsx:972-977` (`RankingsPage active={screen==='rankings'}`, `StatisticsPage` with `key={sessionKey}`, handoff/fallbackScope/version/viewer/canMine/theme/scopeChips/onBack/shared)

Actual browser reference review performed (not claimed otherwise):

- Viewed via image read: `docs/implementation/ranking-periods/evidence/browser/390-dark-july.png` (mobile dark, July monthly reporters) and `docs/implementation/ranking-periods/evidence/browser/july-fines-rate.png` (desktop dark, July fines rate). See `evidence/muse-m0/reference-review.md`.
- No new screenshots taken, no dev server started, no DB-seeding tests run in this turn (Root is obtaining baseline per task).

## 2. Confirmed file paths

- `src/pages/RankingsPage.tsx` — exists (742 lines, current HEAD)
- `src/styles/rankings.css` — exists (75 lines)
- `src/pages/StatisticsPage.tsx` — exists (507 lines)
- `src/styles/scope-statistics.css` — exists (215 lines, combined scope-panel + statistics styles)

## 3. Current RankingsPage behavior (base for the plan)

1. Six preset buttons from `RANKING_PRESETS` (`src/domain/rankingPeriods.ts:8-15`): 3 cumulative + 3 monthly, grouped “누적 · 기간별 / 월별”. `selectRankingPreset` keeps custom `range` when leaving a monthly preset, shares `month` across monthly themes.
2. One draft→`적용` form: metric select (per-theme), `date_basis` select, `category` select, `min_reports` number, period segmented (`all`/`range`/`month`) + `start`/`end` dates or `month` input. Nothing is applied until submit (hint: “초안은 적용을 누르기 전에는 반영되지 않습니다”).
3. Draft→query validation via `contracts/user-rankings/types.ts:querySchema` (`draftToQuery`, `RankingsPage.tsx:109-127`); `page_size=20` const; `expected_version` only on `page>1`; 409 → notice + restart page 1; 429 → `Retry-After` countdown + disabled apply/retry.
4. `rk_*` URL sync (`writeUrl`, `draftFromSearch`, `popstate` restore), independent of map/stats scope.
5. Guards already present and must be kept: hidden/logout abort + clear protected response (`170-181`, `199-228`), late-response account/queryKey guard (`253`, `395`), server-sort only (no client re-sort), `me` from `response.me` (not from page rows), `completed_unknown` shown, `tie_count` shown, `in_progress` banner, `me=null`/empty/error/access-gate distinct states.
6. Gaps vs the new §8 (i.e. the work to plan): six shortcuts instead of three tabs; single global 적용 instead of immediate tab/metric/category/month + range own 조회 + advanced own 적용; generic `값`/`신고` columns with duplicated counts; `<details>` per-row “전체 UUID 보기” (not a dialog, weak keyboard/focus/copy-failure handling); nested `max-height:480px` table scroll; pager text “N페이지 · 20명씩” (hardcoded 20 in copy, not range semantics); internal terms (`N`, `F`, `completed_unknown`, “초안”, “값”, diagnostics) on the default screen.

## 4. Implementation plan — `RankingsPage.tsx` (Root owns Dashboard/types/tokens/server/data; do not touch)

### 4.1 Header order (§8.1)

Keep `참여자 랭킹 → 3개 탭 → 기간/분류 → 정확한 지표 제목 → 내 기록 → 순위 목록 → 집계 기준`.

- Replace the six-preset fieldset with exactly three main tabs: `신고 랭킹` (`theme=reporters`), `과태료 랭킹` (`theme=fines`), `불운 랭킹` (`theme=unlucky`). Remove labels “최다 과태료 수용자” (role ambiguity) and “값”. Internal `theme`/`metric` mapping stays contract-compatible; no DB enum change.
- One common period control for all tabs: `[전체 기간] [월별] [기간 지정]` (segmented, `aria-pressed`). Month nav only in month mode: `〈 2026년 9월 〉` prev/next buttons + direct `type=month` input; never hardcode the example month; KST current month default (`kstMonth()`), past months exact `YYYY-MM`; current-month title `이달의 …` + small `집계 중`, past `2023년 7월의 …` with matching API scope.
- Default visible: period + category (`전체/교통위반/주정차/기타` preserved). `date_basis` + `min_reports` move to a `상세 조건` disclosure panel. Applied condition always stays short above results, e.g. `답변일 기준 · 2026년 9월 · 전체 분류 · 최소 1건`. When `metric` ends with `_rate`, surface the min-reports condition near the metric switch (still default 1; never introduce 10/30/100 defaults).

### 4.2 Per-tab metric switches (§8.3) and query triggering

- 신고: no metric select (single `reports_count`).
- 과태료: segmented `[건수순] [비율순]` → `fine_count`/`fine_rate`.
- 불운: two segmented groups `[불수용] [일부수용]` (dimension: `rejected_*` vs `partial_*`) × `[건수순] [비율순]`.
- Exact titles: `완료 신고가 많은 순위`, `과태료 처분 건수가 많은 순위`, `과태료 처분율이 높은 순위`, `불수용 건수가 많은 순위`, `불수용 비율이 높은 순위`, `일부수용 건수가 많은 순위`, `일부수용 비율이 높은 순위`. Keep existing `rankingTitle` month logic for the H1; the metric title is the list heading (contract `METRIC_LABELS` stays the API label source).
- Triggering: tab switch, metric segmented switch, category select, month prev/next/direct input → immediate fetch (click-type policy: instant feedback + request, dedupe identical in-flight). No screen-wide 적용 button. Range `start`/`end` → only that section’s `조회` button validates (both present, `start<=end`, else inline error, no fetch). Advanced (`date_basis`, `min_reports`) → only that panel’s `적용` button. Unapplied edits are visually distinguished from the applied result scope; switching tabs preserves period/category/basis/min; unsupported metric maps to the new tab’s valid default. `partial_count` restoration: keep `lastUnluckyMetric` ref — leaving `unlucky/partial_*` for `fines/*` then returning to `unlucky` restores `partial_*`, not the theme default `rejected_count`; cover with a unit test.
- Keep `rk_*` compat: existing `rk_theme/metric/period/start/end/month/basis/category/min` parse/serialize, direct entry, refresh, back/forward. Ranking conditions never overwrite map/stats conditions.

### 4.3 “내 기록” thin summary (§8.4)

One thin block before the list (not large cards). Format per metric kind with named numbers, e.g. `내 순위 12위 / 248명 | 과태료 처분 96건 · 처분율 75.0% | 완료 신고 128건`. Count-first metrics lead with count; rate-first lead with rate + `128건 중 96건` numerator/denominator beside the rate. Use `response.me`/`total_participants` only — never derive from page rows. `me=null` → guidance text + condition-widening path, never `0위/0건`.

### 4.4 Desktop table (§8.5)

- Header `값` removed; per-metric headers (`완료 신고`, `과태료 처분`, `과태료 처분율`, `불수용 비율`, …). Numbers right-aligned, `tabular-nums`, unified units/decimals (`N건`, `R%` one decimal via existing `formatValue`).
- Reporters count-sort: single count column (do not repeat the same count in two columns). Other metrics: primary value + auxiliary `분자/분모` (rate) or `완료 신고` (count metrics) as one group in the same cell stack.
- Base columns: `순위 / 참여자 / 선택 지표 / 필요한 경우 완료 신고`. Joint rank reads `공동 1위 · 3명` from `rank`/`tie_count`. Same-display-value-different-fraction explainable (title/note: exact-fraction sort, not rounded display). Pager shows row range `참여자 1–20 / 248명` computed from `page`/`page_size`/`rows.length`/`total_participants` — never call a tie-range a row range; never hardcode 20 in copy (read `page_size` from response). Keep prev/next + disabled states + out-of-page `me`.

### 4.5 UUID + self (§8.6)

Keep UUID as the only allowed identifier; no nickname/Kakao/avatar. Short UUID itself is the button → small popover/dialog with full UUID + copy button. No always-visible second “전체 UUID 보기” line on every row. React `key`/selection/copy use the full UUID (short collisions never merge people). Self row: `나` recognized first + existing token-based subtle highlight. Keyboard: Enter/Space opens, `C`/button copies, `Esc` closes, focus returns to the invoking button; no hover-only path. Copy failure (denied clipboard, insecure context) → explicit failure text, never fake success. Current `<details>` implementation must be replaced to meet focus-return + failure-text requirements.

### 4.6 Mobile list (§8.7)

Not a shrunk table. Same data/formatters, two-line rows, e.g. `1  a31f92c8…07da  142건` / `완료 신고 180건 · 과태료 처분율 78.9%`. Rate-sort: primary right number is the rate, secondary line carries numerator/denominator. One list with dividers (no per-person shadow cards). Remove the nested `480px` inner scroll (`rk-scroll max-height`) on mobile — single page scroll. 상세 조건 opens in its own panel; the list is not pushed under a long filter form. Pagination/joint-rank/self/UUID-copy all usable at 360–390px.

### 4.7 Text/design (§8.8)

Top note: `이 서비스에 공유된 완료 신고를 기준으로 집계합니다.` Default screen removes `N`, `F`, `R/N`, `completed_unknown`, “초안”, “값”, raw diagnostics. Denominator + unknown handling stay in plain language under `집계 기준 보기`; diagnostics stay as a separate developer detail (not deleted). Current-month `집계 중` small but accessible. Follow existing light/dark tokens/font stack; no new brand colors, fixed white/blue splatter, crowns/podiums/giant TOP3/celebration animations/duplicate charts/insight boxes. Body 15–16px primary / 13–14px secondary starting point; verify at 200% zoom.

### 4.8 State/network unhappy paths (must specify in implementation)

- Draft/applied/displayed/loading/error separation: new title/filter beside old numbers is forbidden; allowed stale (map only) is not copied to rankings — rankings clears on new fetch (`setResponse(null)`), shows skeleton, never mixes versions. 409 `DATASET_CHANGED`: discard old response, page-1 restart (current `gotoPage`/`expected_version` logic kept), bounded retry (no infinite 409 loop).
- Late/stale: `AbortController` + generation + `appliedKey` + viewer guard (keep current pattern). Late response for another account/condition/screen is dropped, never rendered.
- Account change (`viewer`/`auth.status` change), logout, consent withdrawal: abort in-flight, clear protected response + export/chart data + global store slice, reset `lastFetch`, refuse to render previous account even for a frame; verify hidden DOM + back/BFCache shows no prior numbers.
- Hidden view (`active=false`, `visibilitychange`, `pagehide`): abort + clear + `loading=false`; on return/focus revalidate once (keep `REVALIDATE_MS` throttle, `retryAt` respect). No `localStorage/IndexedDB/ServiceWorker` protected-response persistence (contract no-store kept).
- Errors distinct: first-load vs page-turn vs `me` missing vs empty (`total_participants===0`/`rows.length===0` + scope-relax guidance) vs gate (`upload_required` with `{required:10, current:N|null}`) vs 400/401/403/409/422/429/5xx/offline. List failure ≠ success-empty; retry offered. 429 honors `Retry-After`, keeps only the latest intent, no per-screen retry storm. 400/401/403/409 never infinite-retried. No auto demo/fixture fallback on failure.
- Fractional/tie/page semantics (server-authoritative): exact rational sort key (contract `div(num*10^40, N)`), competition rank `1,1,3`, `tie_count`, secondary `N desc, UUID asc` display-only; client never re-sorts by rounded display. `value` for rates is percent 0–100. `me` global rank works outside the current page. `page_size≤50`, `expected_version` (32 hex) required when `page>1`.

## 5. `rankings.css` plan

- Token-only (`var(--*)`), both themes, no fixed white/blue text; keep `rk-page[hidden]` rule (Dashboard hides via `hidden`, CSS `display:none` already present).
- Add: tab bar (3 tabs, `aria-selected` or `aria-pressed` + selected style reusing `rk-seg` language), metric/dimension segmented groups, month stepper (`〈 2026년 9월 〉`), advanced disclosure, thin `me` strip, conditional desktop columns, mobile two-line list (replace mobile table-squeeze rules at `max-width:700px`), UUID dialog/popover positioning (no viewport overflow at 360px, above bottom nav), focus-visible rings, `prefers-reduced-motion` kept, 200%-zoom safe (relative line-height, no fixed-px title squeeze — cf. ranking-periods fix `97605a5`).
- Remove: six-preset caption layout dependency, generic `값` column widths, per-row always-open UUID second line, `rk-scroll{max-height:480px}` on mobile, hardcoded pager copy.
- Regression risk: bottom-nav overlap, popover clipping, light-theme badge contrast (amber/yellow white-text ban per ui-spec §11), 360px horizontal overflow (page-level `overflow-x` forbidden; internal table scroll only on desktop).

## 6. `StatisticsPage.tsx` + `scope-statistics.css` plan (all features retained)

- Keep `draft → [통계 만들기] → applied/result` exactly once per run. Never wire selects to immediate API. Keep `unapplied` note, applied title/scope/basis/population line, `PanelStatus` previous-result banner, table/chart same `query/version` refresh, display-only switches (view, chart type, overlay, legend `hidden`) with no refetch, explicit re-aggregation labeling, no fake whole-sort from current page only, `0` vs `확인할 수 없음` vs `아직 조회하지 않음` distinctions, export/share on the applied result only.
- PC: `설정 영역 + 넓은 결과 영역` split; settings width must not starve the result (keep `minmax(280px,320px) / 1fr` grid, sticky builder).
- Mobile: result-first — applied condition summary + result on top, `조건 변경` collapsible editor panel; do not bury the list under a long filter form; keep single page scroll + internal `pivot-scroll` only.
- Group settings as `범위/누구의 신고`, `행·열`, `지표/비교 대상`; retain presets, row/col/metric limits, filters, whole/mine/compare, member search/paging, saved recipes, share link, pick-narrow, export parity, status colors via common formatters/tokens. No duplicate KPI/insight cards above the result.
- `scope-statistics.css` actual path confirmed; changes limited to layout/info-hierarchy (result-first ordering class, editor panel) + perf-boundary comments. No token/package changes (Root-owned).

## 7. Contracts that must not change (Root-owned — read, don't edit)

`contracts/user-rankings/*` (query/response schema, `types.ts`), `src/data/rankings.ts`, `src/data/*`, `server/*`, `Dashboard.tsx`, shared types/tokens, `package.json`/lock, tests. UI maps 1:1 onto `theme/metric/period/start/end/month/date_basis/category/min_reports/page/page_size/expected_version`; response `rows≤50`, `me`, `total_participants`, `page/next_page`, `dataset_version`, `diagnostics`, `scope.in_progress`. Any contract change → server+DTO+Zod+client+tests+docs together (Root).

## 8. Proposed small steps (for the later implementation request)

1. S1 shell: 3 tabs + common period/month stepper + category; Contract: theme/period/month mapping + `rk_*` round-trip test.
2. S2 triggers: immediate tab/metric/category/month; range 조회 + advanced 적용 isolation; `lastUnluckyMetric` restore test.
3. S3 titles + thin me + applied-scope line; `me=null` guidance test.
4. S4 desktop table + pager range semantics (`page_size`-driven) + tie/fraction note.
5. S5 UUID dialog (keyboard/focus/copy-failure) + self highlight.
6. S6 mobile list + CSS (no nested scroll, 360px, 200%, light/dark).
7. S7 URL/history/back-forward + account/hidden/late-response guards.
8. S8 statistics result-first mobile editor + hierarchy pass (no feature removal).
9. Each step: `npm run build`, affected vitest (no shared-DB seeding in this lane), Playwright harness checks, screenshots actually opened.

## 9. Regression risks

- Immediate-fetch storm on fast tab/month switching (needs dedupe/abort/generation; verify request count).
- Range/advanced edits leaking into immediate path (must stay isolated until their own buttons).
- `partial_*` loss on tab round-trip (explicit restore rule + test).
- Rounded-display re-sort or duplicated count column (keep server order, single count column for reporters).
- UUID dialog focus loss / clipboard-denied fake success / short-UUID key collision.
- Pager hardcoding 20 / tie-range mislabel / `me` derived from page rows.
- Old-response flash on account/hidden/409 paths (clear-then-fetch + guards).
- Statistics accidental immediate-fetch wiring or dropped features (presets/compare/save/share/export/picker/hidden-series) during hierarchy cleanup.
- Shared-file collisions with Root (Dashboard/types/tokens/package/tests/server/data) — this plan touches none.

## 10. Verification status this turn

- Read-only inspection + 2 reference screenshots actually viewed. No dev server, no tests, no measurements (baseline is Root's lane; shared-DB tests deliberately not run).
- Next phase (separate implementation request): production build, existing ranking/statistics vitest subset, Playwright `verify_rankings*.mjs` + accessibility + subpath harnesses, 360/390/768/1440/1920/2560 × light/dark × keyboard × 200% with screenshots opened, console/network check, account/hidden/409/429 paths.

## 11. BLOCKED / out of scope

- No BLOCKED contract fields for this UI plan (ranking contract + statistics catalog paths exist in-tree). Live Kakao SDK / hosted Edge / Pages / real-device large-font verification remains future-phase work, not claimed here.
- Push / main merge / migration apply / Edge-Pages deploy are explicitly out of scope and were not performed.
