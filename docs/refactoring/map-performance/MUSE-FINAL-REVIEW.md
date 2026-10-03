# MUSE FINAL REVIEW — integrated commit 7d25a9f (request_mode=review)

- review commit (detached, read-only): `7d25a9fe7ad2700e3f252ea2f4fab24e22623849`
  `fix(ui): defer inactive charts and verify ranking and statistics interactions`
  (parents: `bc49b72` server + `bc41efc` Muse UI + prior; reviewed the integrated UI, not the earlier UI-only commit)
- reviewer model: `opencode-go/muse-spark-1.3-contributor` — ID confirmed present in host `opencode models`
  list (alongside `opencode-go/muse-spark-1.2-contributor` and `-free` variants); variant `high` per dispatch
  assignment. No API substitution, no guessed IDs, no permission/credential changes.
- session: NEW fixed worktree `.agent-runtime/worktrees/muse-review`; previous implementation
  directory/session not continued. No commits, no pushes, no other-project/host changes.
- verdict: **APPROVE** — no blocking defects. One minor non-blocking robustness observation (OBS-01).
  All §8 rankings behaviors and §9 statistics behaviors verified against the live integrated build.

## 1. What this review is (and is NOT)

- Real Chromium browser (headless), own dev server `E2E_PORT=5191`
  (`npx --no-install vite --config scripts/browser/vite.e2e.config.ts`, stdin `/dev/null`,
  logs/PID/scratch in `.agent-runtime/tmp/muse-final/`). Root servers/ports
  5190/5192/57098/57099 untouched; no DB seeding/reading/writing by this review.
- Rankings rows supplied EXCLUSIVELY by `await attachRankingFixture(context)` from
  `scripts/browser/ranking_fixture.mjs`, attached BEFORE navigating/clicking rankings
  (opened map first, attached fixture, then `goto ORIGIN+'/?screen=rankings'`).
  Fixture: 26 UUID participants, competition ties, month sample-1, me, global pages, rate fractions.
  This is explicit UI-fixture evidence — NEVER real SQL/auth/production (Root owns real SQL/auth/normal-HTTP checks).
- Mock Kakao SDK via harness `openPage()`; statistics/personal via the E2E synthetic stack
  (real HTTP through `server/publicHandler.ts` + `demoEngine.ts` facts, countable/delayable/failable).
- Every screenshot below was actually opened and read (not merely generated).
  Behavioral JSON + network logs: `docs/refactoring/map-performance/evidence/muse-final/results*.json`.
- Initial script run had a harness-side race (response waiter attached AFTER the click; the fixture
  answers instantly). All affected checks were re-run with waiter-before-action and pass;
  the first run's raw log is kept as `results.json` for auditability, corrected runs as
  `results2/3/4.json`. Consolidated tally below counts each behavior once, on the corrected run.

## 2. Results — rankings (§8)

| id | behavior | result + evidence |
|---|---|---|
| R-A01 | direct entry renders + exactly 1 immediate default request (`theme=reporters, metric=reports_count, period=all, date_basis=completed_date, category=all, min_reports=1, page=1`) | PASS (`A-rankings-desktop-dark.png`) |
| R-A02 | H1 `참여자 랭킹`, exactly 3 tabs `신고 랭킹\|과태료 랭킹\|불운 랭킹` | PASS (same shot) |
| R-A03 | reporters desktop headers exactly `순위\|참여자\|완료 신고` (no generic `값`) | PASS |
| R-A04 | thin `내 순위` strip before list from server `me` (`내 순위 1위 / 26명 완료 신고 53건`), pager `참여자 1–20 / 26명` from `page_size` | PASS |
| R05 | top-line `이 서비스에 공유된 완료 신고를 기준으로 집계합니다`, `집계 기준 보기` disclosure; no 왕관/시상대/TOP3/인사이트/축하/`completed_unknown` on default screen | PASS |
| R06 | fines tab → immediate `theme=fines` request; headers `순위\|참여자\|과태료 처분\|완료 신고` | PASS |
| R07 | 비율순 → immediate `metric=fine_rate`; cell `84.9% / 53건 중 45건` (분자/분모 order correct) | PASS |
| R08 | unlucky dimensions `불수용\|일부수용`; partial→fines→unlucky restores `partial_count` + title `일부수용 건수가 많은 순위` (per-theme metric memory) | PASS |
| R10 | 월별 → immediate `period=month`; stepper `이전 달/다음 달` + direct `type=month` input; prior-month title `2026년 8월 · 일부수용 건수가 많은 순위` | PASS |
| R11b/T01 | current month (2026-10): `집계 중` notice + `공동 26명` ties + `표본 1건`; past month correctly shows ties/sample1 WITHOUT in-progress note | PASS (`T-rankings-current-month.png`, `A-rankings-month-ties.png`) |
| R12 | range start/end drafts send nothing; dedicated 조회 fires `period=range&start=2026-08-01`; applied scope line shown | PASS |
| R13 | advanced (날짜 기준/최소 신고 건수) drafts send nothing; 적용 fires; min 5 applied then restored to 1 | PASS (`A-rankings-page2.png` shows open advanced panel) |
| R-same | identical tab/metric re-click sends no duplicate request | PASS |
| R14/U02 | page 2 → `참여자 21–26 / 26명` (row range, not rank range), server `me` strip unchanged outside page | PASS (`U-rankings-page2-clean.png`) |
| R15 | old `rk_*` deep link (`fines/fine_rate/month/2023-07`) applies; refresh preserves; back/forward restores `rk_theme` | PASS |
| R16/U01 | UUID dialog: short-UUID button opens `참여자 UUID` dialog with readonly full UUID; **copy success** → `복사했습니다.` + clipboard holds full UUID; **copy denied** → explicit failure message + manual-select fallback (never fake success) | PASS (`U-uuid-copy-success.png`, `A-rankings-uuid-dialog.png`) |
| R17 | focus trap (Tab stays in dialog), Escape closes, focus returns to opener | PASS |
| R18 | empty month (2020-01): `결과가 없습니다` heading, zero rows, no invented data | PASS |
| R19 | one-shot 500 → `랭킹을 불러오지 못했습니다` panel, protected rows cleared, 다시 시도 recovers | PASS (`A-rankings-error.png`) |
| R20 | one-shot 429+Retry-After → disabled `N초 뒤 다시 시도` countdown, mid-cooldown tab clicks fire nothing, auto-resume applies ONLY the latest intent (`fines`), no storm | PASS (`A-rankings-429.png` post-recovery) |
| R21 | account menu shows shortened OWN id `ID 11111111` (Sep-30 decision; no nickname demanded) | PASS |
| R22 | keyboard: Tab reaches tab group, focus visible; Enter-equivalent activation path exercised via focused control | PASS |
| D01 | late fines response (900 ms fixture delay) does not clobber newer unlucky intent (generation/query-key guard) | PASS |
| D02 | account B context: own me (`22222222…`), `나` badge, full A UUID absent from B DOM (A→B separation) | PASS (`D-rankings-account-B.png`) |
| F01 | anonymous: 10건 gate + 카카오 로그인, zero UUID rows | PASS (`F-rankings-anonymous.png`) |
| R-mobile | 390 light: two-line `.rk-list` rows (rank+UUID / metric+분자·분모), desktop table hidden, no nested scroll, pager reachable above bottom nav, min tab height 44px | PASS (`B-rankings-mobile-light.png`) |
| R-matrix | 360 dark / 768 dark+light / 1440 light: 3 tabs, rows, `documentElement.scrollWidth <= innerWidth`, correct table↔list switch at 700px | PASS (`C-*.png`) |

Numerator-order note: rate cells render `분자건 중 분모건` with the percentage first (e.g. `84.9% / 53건 중 45건`),
matching the Root-corrected order; no re-sorting by rounded display values (competition ranks from fixture
`rank`/`tie_count` shown as `공동 N명`).

## 3. Results — statistics (§9) + map shell

| id | behavior | result + evidence |
|---|---|---|
| S01 | statistics direct entry: `meta` + `statistics/catalog` + exactly ONE default-restore query, NO `dashboard`/`overview` request (single-date-v1 restore path, `StatisticsPage.tsx` L199–213) | PASS |
| S02 | real draft edit (지표 추가) fires nothing, shows `바꾼 설정이 아직 반영되지 않았습니다`, enables 통계 만들기 | PASS |
| S03 | 통계 만들기 fires exactly one query; 표↔그래프 switches refetch nothing (same query/version result) | PASS (`S-statistics-after-execute.png`) |
| S04 | population 내 신고 → execute goes to `my-analytics/statistics`; draft switch itself silent (no cross leak) | PASS |
| T02 | 설정 저장·불러오기 details → 이름+저장 lists recipe and reloads draft; 공유 링크 opens share panel | PASS (`T-statistics-save-share.png`) |
| S06 | 엑셀 다운로드 enabled once a result exists | PASS (enabled-state verified; real Excel binary NOT_RUN — no MS Excel in env) |
| E05 | mobile 390 light: result-first (`조건 닫기` toggle), builder hidden when closed, page-level overflow 0, pivot table keeps internal `.pivot-scroll` | PASS (`E-statistics-mobile-light.png`) |
| E06 | metadata 500 → banner `고를 수 있는 통계 항목을 불러오지 못했습니다. 새로고침해 주세요.`; reload recovers (documented retry path) | PASS (`E-statistics-meta-error.png`) |
| E04 | compare/share/preset/export surfaces retained (비교 대상 선택, 공유 링크, 예시 설정, 행·열 editors) | PASS (`E-statistics-desktop-dark.png`) |

Corrections to my own first-run expectations (not product defects): the single default query on entry is the
designed session-restore run (not select-triggered execution); choosing the first 예시 preset is a no-op when it
equals the current spec (hence no unapplied note — verified with a genuinely differing edit instead); the save
inputs live inside a collapsed `<details>` that must be opened first.

## 4. Zoom, console, network

- 360/390/768/1440 verified in BOTH light and dark (matrix §2/§3). No page overflow at 100% anywhere.
- 200%: headless Chromium exposes no browser-chrome zoom, so actual browser zoom is NOT_RUN; instead a
  precisely labeled emulation — `document.body.style.zoom='200%'` at 390px — was used (NOT claimed as browser zoom).
  Result: document scrollWidth 456 vs 390 (see OBS-01). Text-doubling (font-size×2, the method used by the legacy
  rankings script) keeps layout viewport and was implicitly covered by readable two-line rows in all shots.
- Console: zero unexpected errors across all four runs. The only console entries are the browser's own
  `Failed to load resource (500/429)` lines from my intentionally injected one-shot failures — expected.
- Network: every immediate control (tab/metric/category/month-stepper/direct-month) fires exactly one request
  with the applied query; range/advanced drafts fire zero; identical re-selection fires zero; 429 collapses to the
  latest intent with a single auto-resume. Full request logs in `results*.json` (`net` arrays, ctx-tagged).

## 5. Defects / observations (REPORT — no product files changed)

- **OBS-01 (minor, non-blocking): top-bar `.header-end` cluster overflows under emulated 200% zoom at 390px.**
  Forensics (`T-zoom200-forensics.png` + `results3.json` T03): `DIV.header-end L=40 R=456 W=416` — the date/account/
  theme/briefing cluster does not wrap at ~195px effective width. At real 360/390px widths there is no overflow
  (B02/C-360 PASS), and the effective width tested is beyond the WCAG-reflow 320px-equivalent threshold, so this
  is robustness polish, not a blocker. Narrow fix suggestion (for Root/owner): allow `.header-end` to wrap or
  collapse the date stamp below ~480px (`flex-wrap: wrap` / hide `.data-stamp` on narrow), then re-run T03.
- No other defects found. No crowns/podium/TOP3/insights/duplicate-KPI/reintroduced toggles. No `값` headers.
  No full-UUID second lines, no short-UUID key collisions (full UUID used for key/copy). Mobile own-badge grid and
  desktop compact filter layout (Root corrections) render as specified in the inspected shots.

## 6. Explicitly NOT_RUN / BLOCKED (with reasons)

- Real SQL/auth/production, real Kakao SDK/OAuth, real GoTrue session flows, normal-HTTP checks: out of this
  review's scope by instruction — Root performs them separately. Fixture `me`/ranks prove UI wiring only.
- Actual browser-chrome 200% zoom: unsupported in headless Chromium; labeled CSS-zoom emulation used instead.
- Performance p50/p95 and 50만-row ranking timing: review mode ran no perf baselines (no claim made).
- Real Excel open, RUM/field INP, screen-reader pass beyond keyboard/focus/dialog semantics: environment-limited.
- Map/chart interaction beyond rankings/statistics scope (dashboard scope, Kakao clusters): unchanged product
  surface, covered by Root's checks, not re-verified here.

## 7. Evidence index (`docs/refactoring/map-performance/evidence/muse-final/`)

Screenshots (all opened and read): `A-rankings-desktop-dark`, `A-rankings-month-ties`,
`A-rankings-page2` (superseded by `U-rankings-page2-clean`), `A-rankings-uuid-dialog`,
`U-uuid-copy-success`, `A-rankings-error`, `A-rankings-429`, `B-rankings-mobile-light`,
`B-rankings-mobile-zoom200-emulated`, `R-zoom200-culprit`, `T-zoom200-forensics`,
`C-rankings-360-dark`, `C-rankings-768-dark`, `C-rankings-768-light`, `C-rankings-1440-light`,
`D-rankings-account-B`, `E-statistics-desktop-dark`, `S-statistics-after-execute`,
`E-statistics-mobile-light`, `T-statistics-save-share`, `E-statistics-meta-error`, `F-rankings-anonymous`,
`T-rankings-current-month`. Behavioral/network JSON: `results.json` (first run incl. harness race, kept for
audit), `results2.json` (corrected rankings+statistics), `results3.json` (current-month/save/zoom forensics),
`results4.json` (clipboard success + clean page 2). Review scripts (reproducible): `.agent-runtime/tmp/muse-final/review{,2,3,4}.mjs` + `dbg.mjs`, run with `E2E_PORT=5191` against the vite.e2e server.

## 8. Reproduction recipe (for Root re-run)

1. `E2E_PORT=5191 npx --no-install vite --config scripts/browser/vite.e2e.config.ts` (stdin `/dev/null`).
2. Playwright: `openPage(browser,{search:'?screen=map'})` → `await attachRankingFixture(context)` →
   `goto ORIGIN+'/?screen=rankings'`; statistics at `ORIGIN+'/?screen=statistics'`.
3. Click tabs/metrics/month-stepper (each fires one `/functions/v1/user-rankings` request);
   fill range/advanced (zero requests) then 조회/적용 (one request each).
4. One-shot routes (`{times:1}` registered AFTER the fixture route) for 500/429/catalog-500 cases.

## 9. Files actually opened (review trace)

`PROJECT_RULES.md`, `AGENTS.md`, `SOL.md`, `MUSE.md`, `docs/implementation/MASTER_PROMPT.md`,
`docs/product-decisions.md`, `docs/repository-audit.md`, `docs/ui-spec.md` (full 125 lines),
`docs/screen-by-screen.md` (header), `safetyreport-map-refactor-sol-prompt.md` (all 630 lines),
`.agents/skills/{cm-sol-muse,cm-browser-review,cm-cinematic-ui}/SKILL.md`,
`design/reference-ui/index.html` (all 53 lines), `docs/refactoring/map-performance/{PLAN,CONTRACT-CHANGES,FEATURE-MATRIX,MUSE-IMPLEMENTATION}.md`,
`scripts/browser/{harness,ranking_fixture,vite.e2e.config,verify_rankings}.mjs` (+`verify_rankings.mjs` fully),
`src/data/rankings.ts` (full), `src/data/statistics.ts` + `src/data/client.ts` + `src/components/AccountMenu.tsx` +
`src/pages/{RankingsPage,StatisticsPage}.tsx` (targeted excerpts via grep/sed — product files never modified).
Confirmed absent as instructed: `contracts/selfhost-compat/` (no such path; community-ingest/my-reports are the
real counterparts) and original bitmap board (only `design/reference-ui/{index.html,ui.css,app.js,screenshots/}` exist).
`package.json` scripts confirmed (`build`/`test`/`scan`); `opencode models` confirms the reviewer model ID.

## 10. Approval

**APPROVED at `7d25a9f`** for the rankings §8 + statistics §9 UI surface, within the stated fixture/runtime
limits. No product changes made by this review; OBS-01 is the single non-blocking follow-up. Remaining
gates (real SQL/auth/HTTP, perf numbers, release order) stay with Root per the work agreement.
