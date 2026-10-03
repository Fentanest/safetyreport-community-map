# Monthly review — Muse final closure validation (review mode)

- Candidate commit: `c99bee6` (verified `git rev-parse HEAD` in THIS worktree)
- Worktree: `.agent-runtime/monthly-review-final` (detached; no source changes made)
- Live server: `http://127.0.0.1:5141` (root-owned; NOT started/stopped/touched)
- Browser/tool: `Google Chrome 154.0.8037.92` via harness `scripts/browser/harness.mjs`
  (`E2E_PORT=5141`), Playwright core resolved read-only per harness order
  (first hit: `/tmp/cm-live-browser/node_modules/playwright-core`)
- Data mode: **local synthetic API + MOCK Kakao SDK only** (no production, no real Kakao,
  no token/JWT recorded). Search baseline:
  `?date_basis=completed_date&start=2025-09-25&end=2026-09-24&category=all`
- Helpers (all under approved evidence path, run from THIS worktree):
  - `docs/implementation/monthly-review-20261003/evidence/muse-final/final_check.mjs` (54 checks)
  - `.../muse-final/probe.mjs`, `probe2.mjs`, `probe3.mjs` (targeted follow-ups)
- Baseline context: root 39 checks PASS; initial Muse 5 issues fixed at `49c4c6d`;
  previous sessions `ses_effb4025fffefAJzy4ll1Mr5da` / root initial evidence integrated separately.
- Verdict convention: exit code alone is NOT approval; only the behavioral evidence below counts.

## Closure results (initial defects)

| # | Defect area | Verdict | Evidence |
|---|-------------|---------|----------|
| 1 | EntityTable agency→manager switch: no old rows / stale total | PASS | `entities-no-old-rows-new-kind`=0 rows; `entities-no-stale-total`=true (pager left old value); `entity-kind-pending.png` shows pending state, visually confirmed loading without stale rows |
| 2 | Injected 503 clears rows, retry restores (entities) | PASS | `entities-no-old-rows-failure`=0 rows on alert; `entities-retry-restores-rows`=true |
| 3 | Manager page2 → select row (narrower scope) resets to page1, non-empty | PASS | `entities-page-two-reached`, `entities-new-scope-page-one`, `entities-new-scope-not-empty` all true; `scope-page-reset.png` visually shows `1 / 1 쪽` with row `김서연…105건` |
| 4 | Korean IME: 0 requests during composition, exactly 1 after; final value = last input (entity / scope / law / picker) | PASS | All 8 IME checks pass (`entities`, scope-panel `entities`, `laws`, `statistics/candidates` × during/commit) + 4 `IME-final-value` checks equal to last input |
| 5 | Law failure: no false empty, retry available + restores | PASS | `laws-error-not-no-results` (`.empty-state`=0 on error), `laws-error-retry-present`=1, `laws-retry-restores-rows`=true; `law-search-pending.png` shows pending without stale rows |
| 6a | Picker Tab/Shift+Tab wrap both directions | PASS | `picker-tab-trapped`=true, `picker-shifttab-trapped`=true |
| 6b | Picker Esc/cancel/apply restore focus to opener | PASS | `picker-focus-restored-esc`, `-cancel`, `-apply` all true |
| 6c | Picker kind change clears old candidates, then restores | PASS (via probe2; helper selector was radio-only) | probe2: kind 기관(10 rows)→담당자 during-load 0 rows → 30 rows after load. Note: kind control is segmented buttons (`aria-pressed`), not radios — helper `picker-kind-switch` recorded NOT_RUN for that reason, behavior itself verified |
| 6d | Picker error → retry restores | PASS (corrected; see note) | probe3 with real query `경찰`: error state `alerts:1, items:0` → after retry `alerts:0, items:4` (`예시 대구수성경찰서`). Initial helper FAIL was a bad assertion (nonsense query `재시도유발2` legitimately matches 0 rows after successful retry), not a product bug |
| 7a | Pivot numeric cells Enter/Space offer narrow | PASS | `pivot-cell-keyboard-narrow-enter` + `-space` both open `이 항목으로 좁히기` dialog |
| 7b | `aria-sort` on `th`, not button | **FAIL — remaining issue** | probe: 31 `th`, 28 `button.pivot-sort`; `th[aria-sort]`=0, `button[aria-sort]`=0 **even after clicking a sort button** (`sortAfterClick.thSort=[]`). Sort state is exposed to AT nowhere. For Sol: needs source fix (UI-only change, out of review-write scope) |
| 8 | Scope chart pagination rows kept only for same cohort | PASS (via scope-list cohort check) | probe2: `더 보기` expanded 19→24 rows; after narrowing cohort (region select) list reset to 9 rows of the new scope. No dedicated chart-pager selector exists in `.scope-panel` (nav is only the region trail) → helper item recorded NOT_RUN, cohort behavior verified instead |
| 9 | Viewports 1920/1440/2560/390 × dark/light: no overflow, theme attr, modal focus, 200% text at 390, 2px focus | PASS | 16/16 `viewport-*` + `theme-*` + 2/2 `large-text-picker-*` checks pass. Screenshots actually opened: `1920-dark.png` (full data-wall, MOCK tiles, masked ranks `5*두*6*9`), `390-dark.png` (single column, no overflow), `picker-390-dark-large-text.png` (dialog fits viewport at 200%, 2px focus outline measured `outline:2px, shadow:none`), `scope-page-reset.png` |
| 10 | No console JS errors | PASS | `unexpectedErrors`=0; only 3× `503` resource errors, all from deliberately injected 503s |

## NOT_RUNs (explicitly not product bugs)

- Ranking API unavailable in legacy fixture: not exercised, NOT labeled a product bug
  (real-LOCALDB regression is root's track).
- Picker kind control as `radio`: control is segmented buttons; covered equivalently.
- Standalone chart-pager selector: no such pager in `.scope-panel`; covered via `더 보기` cohort reset.
- `verify_monthly_review.mjs` itself was NOT executed (its default output dir is outside
  the approved write scope); its flow was ported into `final_check.mjs` with identical
  assertions plus the extra checks above.

## Remaining work for Sol

1. Pivot sort `aria-sort` on `th` (FAIL item 7b): after a `button.pivot-sort` click, set
   `aria-sort` on the owning `th` (ascending/descending), never on the button. UI-only source change.
2. Nothing else blocks closure from the Muse side: 53/54 helper checks pass, both helper
   FAILs resolved (1 assertion artifact corrected by probe3, 1 real a11y issue filed above).

Evidence: `docs/implementation/monthly-review-20261003/evidence/muse-final/`
(`results.json`, 8 viewport PNGs, 2 pending-state PNGs, `scope-page-reset.png`,
2 picker-390 PNGs per theme, `picker-probe.png`, `final_check.mjs`, `probe*.mjs`).
No source files touched; no writes outside the two approved paths.

## Sol 통합 주석
원본 results.json은54검사 중52 PASS/2 FAIL이다. ‘53/54’ 문장은 재시도 후속 probe를 반영한 요약이며 원본검사 전체통과로 해석하지 않는다. 재시도 후0건 문제는 assertion오류로 해소됐고, 교차 표 ARIA는 실제 결함이었다. 27de7f3에서 행 합계 열에 단일 aria-sort와 정렬 button을 보완했다. 이후 고정 커밋 Muse 검수는 monthly-review-muse-aria.md에 기록한다.
