# user-rankings-v1

`GET {VITE_PUBLIC_ANALYTICS_URL}/user-rankings` (base ends in `/functions/v1`). No anonymous reads. Kakao identity,
valid verified JWT session, active contribution/consent and the existing map gate of ≥10 unique shared reports are
checked by the server on EVERY page. Query cannot name `user_id`, other-user details or raw filters.

The allowed display identifier is Supabase Auth UUID. This is the explicit 2026-10-03 exception to older blanket
UUID bans, limited to this API's aggregate row. Map/my-reports contracts and private table permissions are unchanged.

| Parameter | Values / default |
|---|---|
| theme | reporters (default), fines, unlucky |
| metric | reporters: reports_count; fines: fine_count, fine_rate; unlucky: rejected_count, rejected_rate, partial_count, partial_rate |
| period | all (default), range, month; unlucky requires month |
| start/end | ISO calendar dates, inclusive, required together for range; no duration cap |
| month | YYYY-MM for month; omitted = server's current Asia/Seoul month |
| date_basis | completed_date (default) / report_date |
| category | all (default), traffic, parking, other |
| min_reports | integer ≥1, default 1; independent of viewer's 10-report all-history gate |
| page/page_size | 1-based; default 1/20; page_size ≤50; no arbitrary page-count cap |
| expected_version | 32 hex digits; REQUIRED when page >1, optional on first page |

Theme/metric and period combinations are validated in Edge AND SQL. Unknown/duplicate query fields, impossible dates,
reversed ranges, start/end outside range mode, month outside month mode and arbitrary user IDs return 400.

N = own deduplicated completed reports in the selected date/category cohort (accepted, partial, rejected,
completed_unknown). Selected-date missing reports are excluded even for all-time and diagnosed. No upload date or
alternate-date substitution. All numerators use this SAME cohort. F = disposition=fine AND status in
(accepted,partial), whether the amount exists or not. Warnings, penalty payments, inferred fines and unknown
outcomes are excluded from F. R = rejected; P = partial. Rates = 100×F/N, 100×R/N, 100×P/N. Unknown is in N.
Zero N produces no ranking row and `me=null`; no zero-division value is ranked.

Rank is SQL competition rank: 1,1,3 for equal main metrics. Secondary display order is larger N then UUID ascending;
secondary ordering does not break a tie. Rate sort uses an exact order embedding of the rational number:
`div(numerator::numeric * 10^40, N::numeric)`. Counts are safe integers ≤2^53−1: unequal fractions differ by at least
1/(2^53−1)² >10^-32, so the integer keys cannot merge distinct ratios. Equal fractions produce the same key.
This compares exact fractions across the count domain, never rounded percentages or floating-point display values.

Response (`response.schema.json`, `types.ts`): schema_version, single-date-v1 cohort_policy_version, dataset_version,
generated_at (UTC), normalized scope (KST/in_progress included), total_participants, rows (≤50), me (global rank
from JWT user, possibly outside current page), page/page_size/next_page, diagnostics. Each row contains ONLY UUID,
rank/tie_count/is_me, N/F/R/P/unknown counts, numerator/denominator and value. `value` for rate is PERCENT (0..100),
not a 0..1 fraction. Numerator and N are returned also for count metrics. No report identity/number, original plate,
dataset key, email, Kakao ID, source text, coordinates or links. `me=null` means no eligible selected-scope sample
(including an optional minimum filter); it does not lower the viewing gate.

DB is the source: `private.community_report_facts` → active grants/profiles/auth accounts → own identity election
(`ranking_representatives`, set-wise parity with `my_reports_own`) → representative date/category → per-user
aggregates → all-candidate ranks → page + own row. Same user's datasets collapse. Other users never elect or fill
own identity. Shared reports earn one contribution EACH; per-user sum is not a global deduplicated total.

No application/DB/browser persistent ranking cache. Every request reads current facts, lineage and account state
from ONE statement snapshot. Version SHA-256 prefix binds ALL candidate aggregates, full normalized scope,
diagnostics and page size. Changes affecting ranks, exposure or the returned aggregates yield 409 DATASET_CHANGED
on subsequent pages: discard the old response and restart page1. Unchanged aggregate output can keep its version;
raw changes with no ranking effect are not a pagination change. No monthly top-list union or 100k fact-loader cap.

HTTP: private/no-store/max-age=0, Pragma:no-cache, Vary:Origin,Authorization, nosniff. Explicit Origin allowlist;
Origin does not replace authentication. Per verified user DB rate bucket, 60/min using existing limiter;
429 rate_limited + Retry-After:60. Browser aborts hidden/stale requests, drops responses on logout/pagehide and
rechecks when returning/focusing; no protected response in localStorage, Service Worker or Pages data files.

Stable errors: 400 INVALID_QUERY; 401 auth_required/session_expired; 403 kakao_required/contributor_required/
upload_required (details required:10,current:N|null)/origin_forbidden; 409 DATASET_CHANGED; 429 rate_limited;
503 service_unavailable. Method/path errors 405 METHOD_NOT_ALLOWED / 404 NOT_FOUND. SQL/stack/private inputs are
never echoed. Bounded page and narrow SQL projection keep response bytes bounded independently of fact volume.

Local implementation only. Production SQL/Edge/Pages apply is NOT performed. See docs/user-rankings.md.
