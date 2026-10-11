# user-rankings-board-v1

`GET {VITE_PUBLIC_ANALYTICS_URL}/user-rankings/board` (base ends in `/functions/v1`). A second route of the SAME
`user-rankings` Edge function — no new function, deploy entry or `verify_jwt` setting. 2026-10-11 user decision:
"기간만 설정하면 테마별 랭킹은 한 페이지에 다 보이게". The paged list (`/user-rankings`, [user-rankings-v1](../user-rankings/README.md))
stays as the '전체 보기' sub-screen of one metric.

Everything that is not listed here is identical to user-rankings-v1: Kakao identity + verified JWT session + active
contribution/consent + the map gate of ≥10 unique shared reports checked on EVERY request; UUID-only identifier;
N/F/R/P definitions; single selected date; representatives elected before date/category; competition rank with
exact-fraction rate sort; secondary display order larger N then UUID ascending; private/no-store headers;
Origin allowlist; error codes and their HTTP status.

| Parameter | Values / default |
|---|---|
| period | all (default), range, month |
| start/end | ISO dates, inclusive, required together for range only |
| month | YYYY-MM for month only; omitted = server's current Asia/Seoul month |
| date_basis | completed_date (default) / report_date |
| category | all (default), traffic, parking, safety, living, other (5분류) |
| min_reports | integer ≥1, default 1; applies to all seven boards |
| top | integer 1..10, default 5 (board size K) |
| consistency | optional, only `latest` (the client always sends it; there is no paging) |

No `theme`, `metric`, `page`, `page_size`, `expected_version`, user id or raw filter. Unknown or duplicate keys,
impossible dates, reversed ranges, start/end outside range, month outside month → 400 INVALID_QUERY (Edge AND SQL).

Response (`response.schema.json`, `types.ts`): `schema_version: user-rankings-board-v1`, `cohort_policy_version`,
`dataset_version`, `generated_at`, normalized `scope` (with `top`, KST `in_progress`), `total_participants`,
`boards` (exactly seven, fixed order: reporters/reports_count, fines/fine_count, fines/fine_rate,
unlucky/rejected_count, unlucky/rejected_rate, unlucky/partial_count, unlucky/partial_rate) and `diagnostics`.
Each board = `{theme, metric, total_participants, rows (≤ top), me}` where `rows` and `me` are user-rankings-v1 rows.
`me` is the viewer's GLOBAL rank for that metric (may be outside the top K); `me=null` means no eligible sample.

Equivalence: for every metric, `rows`, `me` and `total_participants` equal page 1 of `/user-rankings` with the same
period/date/category/minimum and `page_size = top` (tests/integration/user-rankings-board.test.ts, one snapshot).

DB: `public.internal_user_rankings_board(uuid,uuid,jsonb)` (migration `202610111200_user_rankings_board.sql`),
service_role only, `search_path=''`. It checks the gate, elects representatives and aggregates ONCE, then ranks the
seven metrics. `dataset_version` = SHA-256 prefix of the normalized scope (incl. `top`), diagnostics and ALL participant
aggregates — the same construction as the list, so it changes when any rank/exposure-relevant aggregate changes.

Edge: same rate bucket as the list (60/min per verified user), strict nested response parse, `is_me` must be true
exactly on the viewer's rows in every board, `me.uuid` must be the viewer, `scope.top`/`min_reports` must echo the
request — any mismatch is a closed 503. Browser: one request per applied condition, reused from an in-memory map for
120 s per viewer+query (cleared on logout, account switch, pagehide and 409); never localStorage/Service Worker.

Local implementation only. Production SQL/Edge/Pages apply is NOT performed.
