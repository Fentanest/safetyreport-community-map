# Ranking periods final review · Muse (review-only)
- request_mode: review
- policy_version: cm-2026-09-24
- model: `opencode-go/muse-spark-1.3-contributor` high (root-provided subscription string; exact provider variant ID follows host `opencode models` record, not independently re-verified here)
- worktree: `/home/better0101/projects/safetyreport-community-map-ranking-periods-review` (detached review worktree)
- candidate commit: `97605a5f3248d74d80191b324e302d8452219632` (readonly; no product edits)
- dirty: evidence + this review only (uncommitted for root retrieval; no source commit/push/deploy/DB/global changes)
- server (root-owned): `http://127.0.0.1:5221/?screen=rankings` — fixed candidate local server; no start/kill/cleanup/withdraw issued
- data_mode: real LOCAL GoTrue/JWT/DB RPC, synthetic fixtures only (July 2023 + current-month 26 users + August 2026); ancillary Kakao SDK mocked via `scripts/browser/mock-kakao-sdk.js`; no cloud claims
- browser/tool: Chrome `154.0.8037.92` headless via `scripts/browser/harness.mjs` + `scripts/browser/verify_ranking_periods.mjs`; MCP none
- session hygiene: session fetched from `/__rankings/session` into memory/localStorage only; no tokens/keys/session payload recorded, printed, or captured in evidence

## Executed runner (actual)
- Command: `RANKINGS_ORIGIN=http://127.0.0.1:5221 node scripts/browser/verify_ranking_periods.mjs docs/implementation/ranking-periods/evidence/muse-final`
- Result: exit 0, `89/89` checks PASS, `22` `/user-rankings` responses recorded, `0` console/page errors, `failure: null`
- Evidence dir: `docs/implementation/ranking-periods/evidence/muse-final/` — `result.json` + 12 PNG:
  `1440/1920/2560/390 × light/dark July`, `390-light-font200.png`, `july-fines-rate.png`, `july-unlucky-rate.png`, `cumulative-unlucky.png`
- This report: `docs/reviews/ranking-periods-muse-final.md`
- Screenshot views (correction): initial pass opened 10/12 PNGs with the real view tool; same-session followup opened the remaining 2/2 (`1440-light-july.png`, `2560-light-july.png`), total 12/12. No textual-only approval.
- Followup light assessment (2/2): both show `2023년 7월의 최다 신고자` + scope `2023-07-01 — 2023-07-31`, 6 grouped entries with active `월별 최다 신고자`, full control row (지표/날짜 기준/분류/최소 신고 건수/기간/조회 달/적용·초기화), `내 순위 20위 값 2건 완료 신고 2건 공동 7명`, table `참여자 26명` with joint-rank rows + `전체 UUID 보기`, pagination, criterion text. No horizontal overflow, no label truncation, typography legible; light contrast (dark text on white/pale panels, blue active button with white text) readable at both 1440 and 2560. No new issue; verdict unchanged.

| viewport | theme | steps completed | screenshot | console/network | result |
|---|---|---|---|---|---|
| 1440 | light/dark | 6 entries, July 2023 apply, title + own summary, no h-overflow | `1440-light-july.png`, `1440-dark-july.png` | part of 22×200, errors 0 | PASS |
| 1920 | light/dark | same as 1440 | `1920-light-july.png`, `1920-dark-july.png` | same | PASS |
| 2560 | light/dark | same as 1440 | `2560-light-july.png`, `2560-dark-july.png` | same | PASS |
| 390 | light/dark | same + stacked controls, compact table, no h-overflow | `390-light-july.png`, `390-dark-july.png` | same | PASS |
| 390 light | 200% rendered font | every rendered text ×2, h-overflow + line-height checks | `390-light-font200.png` | n/a (render-only) | PASS |
| 1440 dark (functional) | draft/apply, July cohort, theme switch, 4 unlucky metrics, pagination, cumulative, custom range, current month ×3, report_date, refresh, route/back/forward, keyboard | `july-fines-rate.png`, `july-unlucky-rate.png`, `cumulative-unlucky.png` | 22 responses below | PASS |

## Independent assessment (screenshots + result.json)
- Mobile label wrapping: 390px light/dark — entry buttons stack in two labeled groups (`누적 · 기간별` 3, `월별` 3); no page horizontal overflow. 200% font — labels wrap mid-word (`최다 신/고자`, `월별 최/다 신고자` etc.) but stay inside viewport with readable line spacing (runner asserts line-height ≥ font-size). No truncation of titles/denominators observed. Observation only, not a defect.
- 6 entry control grouping: all 8 viewport/theme combos assert each of `최다 신고자 / 최다 과태료 수용자 / 최다 불운자 / 월별 최다 신고자 / 월별 최다 과태료 수용자 / 월별 불운자` exactly once; screenshots show `fieldset` grouping `누적 · 기간별` + `월별` with `aria-pressed` on active entry. PASS.
- Current/past titles: past month `2023년 7월의 …` across reporters/fines/unlucky (screenshots + h1 asserts); current month `이달의 …` + `진행 중인 달이라` notice for all 3 monthly themes (runner asserts prefix + progress label + `in_progress:true`). No past month rendered as 이달. PASS.
- Same July across monthly 3: scope `2023-07-01 — 2023-07-31` identical; `me` N=2 (denominator 2, numerator 1, value 50, fraction `1/2건` rendered) for fines/unlucky-rate; reporters winner N=5 joint rank 1 tie 6; theme switch preserves `조회 달=2023-07`. PASS.
- All 4 unlucky metrics: `rejected_count / rejected_rate / partial_count / partial_rate` each applied separately in month mode with `me` numerator 1 / denominator 2. PASS.
- Cumulative unlucky + custom range: cumulative `all` + `partial_rate` → `me` reports 53 / partial 14, scope month null, title `최다 불운자`; custom range 2023-07-01–31 equals July cohort (reports 2, partial 1). PASS.
- me/global rank/sample 1: `내 순위` summary visible in every screenshot; July reporters `20위 값 2건 완료 신고 2건 공동 7명`; fines July own row highlighted `나` badge in table; page2 preserves global own rank `20위`; table shows `참여자 26명` (July) / `30명` (cumulative); min_reports=1 retained; `표본 1건 숨기지 않음` criterion text visible. No sample suppression. PASS.
- Keyboard focus + contrast: `Enter` on focused `월별 최다 신고자` activates entry, `aria-pressed=true`, filters preserved; draft-before-apply issues zero requests and keeps old heading. Dark/light screenshots both legible: headings, chips, `값/신고` columns, `전체 UUID 보기` buttons, pagination, criterion text all contrasted on both themes; no light-modal-left-dark residue. Instrumented contrast-ratio run NOT_RUN (limitation); visual + existing token use only. PASS within scope.
- Pagination/route: historical-month page2 shows `2페이지 · 20명씩` with global own rank; refresh preserves month/metric/date_basis; map→rankings→back→forward preserves `2023-07`. PASS.
- Date basis: `report_date` July cohort changes to N=1, R=0, P=1 (whole-cohort shift, not substitution). PASS.

## Network (sanitized: statuses/bytes only, no headers/raw JWT)
- All 22 `/user-rankings` responses: HTTP `200`, `cache-control: private, no-store, max-age=0`, bytes `4640–5000` (bounded, independent of fact volume).
- Representative scopes: July month ×9 (`participants 26`, `in_progress:false`); cumulative all (`participants 30`, month null); range July (`participants 26`); current month 2026-10 ×3 (`participants 26`, `in_progress:true`, `me.reports=50`); report_date July (`reports=1`).
- Console/page errors: `[]`. No full headers, no raw JWT, no secret scan hits (`eyJ/service_role/secret/kakao key/token` all false in `result.json`).

## Defects
| id | severity | reproduction | expected | actual | evidence | owner |
|---|---|---|---|---|---|---|
| — | — | No FAIL observed in this rerun; runner threw nothing | — | 89/89 PASS | `muse-final/result.json` | — |

No FAIL disguised as PASS. If any hidden runner-assertion vs product question existed, none triggered.

## Integration-first tests (existing, not re-executed here)
- Root-tested full ranking regression separately (per task brief); this review focuses on expansion and does not claim DB test execution.
- Contracts referenced readonly: `contracts/user-rankings/README.md`, `types.ts` (Theme×period validation, competition rank 1,1,3, exact rational ordering, version-bound pages, gate ≥10).

## Limitations / NOT_RUN
- Kakao SDK mocked (ancillary only); no real-map PASS claim.
- No cloud deploy/push/DB migration/operator distribution; production apply explicitly out of scope.
- No persistent ranking cache audit beyond single-run responses; no 50万 perf re-measurement here.
- Instrumented color-contrast ratios, screen-reader pass, and reduced-motion verification NOT_RUN (visual dark/light + keyboard check only).
- Fixture-only: July 2023 + current-month + August 2026 synthetics; not production data.

## Final verdict
- PASS (expansion scope, fixed candidate `97605a5`, 89/89 browser checks + 12/12 screenshots actually viewed + sanitized network/console evidence). BLOCKED: none. NOT_RUN items listed above.
- Evidence + this report left uncommitted for root retrieval.
