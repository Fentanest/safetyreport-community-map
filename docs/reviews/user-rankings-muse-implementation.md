# User rankings — Muse UI implementation evidence

- Base: 8ed88bf · branch: feat/rankings-muse · worktree: .agent-runtime/rankings-muse
- Approved files only: `src/pages/RankingsPage.tsx`, `src/styles/rankings.css`, this note.
  Root Sol owns routing/nav/contracts — `RankingsPage` is a default-export `({active})`
  component; integration (`?screen=rankings`, rail entry, CSS import in bundle entry)
  is left to Sol.

## What was built (real page, not a mock)

- `RankingsPage({active})` uses `useMapAuth()` + Sol's `loadRankings(query, signal)`.
  Scope is independent from map filters; own draft + explicit 적용; `rk_*` prefixed
  URL params preserve map params (root owns `?screen=rankings`); popstate restores form.
- Themes 최다 신고자 / 최다 과태료 수용자 / 이달의 불운자; all 7 metrics via
  `METRIC_LABELS`, theme switch auto-selects a valid metric (contract `superRefine` compatible).
- reporters/fines: 전체 기간 + 직접 범위. unlucky: month picker, default KST current
  month (`kstMonth()`); earlier months render `YYYY년 M월의 불운자`.
- 날짜 기준 답변일(기본)/신고일, same scope for all metrics; 분류 전체/교통위반/주정차/기타;
  최소 신고 건수 default 1 numeric; page_size 20 고정; 이전/다음, page>1 carries
  `expected_version` (dataset_version of the shown snapshot).
- Hidden screen: DOM stays mounted with `hidden`, in-flight requests abort,
  protected response clears on hidden/logout; render guard (`response.viewer === viewer`)
  never shows a previous account's numbers. Abort on old requests, visibility-hidden,
  and revalidate-on-pageshow/focus/visible (30 s throttle). No persistent cache.
- 409 → clears response, notice, restarts page 1. 429 → Retry-After countdown disables
  retry until expiry. Other errors clear the response; eligibility codes render the
  existing `AccessGate` with current signin/signout. No fake users/data, no demo fallback.
- Table: 순위 / 사용자(UUID shortened + details full + copy, collision-free) / 값
  (rates show % + numerator/denominator) / 신고 N + 미확인 count (accessible label).
  No links to others' private reports. `is_me` row gets 나 badge + highlight.
  Distinct states: 내 순위 요약 / 내 기록 없음 / 결과 없음 / 표본 1건 / 공동 N명.
- Disclaimer rendered verbatim: 이 서비스에 공유된 완료 신고 기준, 전체 안전신문고 활동 아님.
  Definition details: N = 수용·일부수용·불수용·completed_unknown 포함; F = 실제 처분 fine
  (수용/일부수용·금액 없음 포함); 순위는 능력·도덕 평가 아님. `in_progress` notice shown.
- CSS reuses app tokens/typography/focus; internal `.table-scroll` only, no page-level
  horizontal overflow; 390px single column; 44px targets; tabular numerals.

## Verification

- `npm ci` (no lock change) + `npm run build`: PASS (tsc + vite, 667 ms).
- `npm test`: 587 passed / 1 failed — `tests/product/authBoundary.test.ts` expects
  Authorization senders `['data/client.ts','data/personal.ts']` but Sol's base commit
  added `src/data/rankings.ts` (tracked at 8ed88bf). Pre-existing, outside Muse scope;
  NOT modified. Sol to update the allowlist.
- Browser review: NOT claimed. No live analytics URL / credentials in this worktree,
  and the page is not yet routed by root. Sol will supply the fixed integrated
  candidate; actual browser UI/UX review (screenshots, console/network, 390px) happens then.
