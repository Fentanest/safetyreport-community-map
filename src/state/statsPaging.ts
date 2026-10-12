/**
 * 맞춤 통계 D23 행 쪽(row paging, 2026-10-12): client-side page cache + merge helpers. Pure, no network/React —
 * StatisticsPage owns the fetch loop and React state (so loading/cancel/error UI stays there); this module only
 * knows how to combine what already came back. One cache belongs to exactly one (recipe, sort) pair — a new
 * query or a changed sort starts a fresh, empty cache (a stale page is never reused across either).
 */
import type { StatisticsResult } from '../domain/statistics';

/** one query's fetched pages, keyed by each page's own `row_page.offset` (every page of one query shares the
 *  same server-computed `limit`, so offsets line up: 0, limit, 2×limit, …). */
export type StatsPages = ReadonlyMap<number, StatisticsResult>;

export const emptyPages = (): StatsPages => new Map();

/** the offsets still missing to cover every row [0, total) at this page size, in ascending order (so a
 *  collector that walks the list fetches low to high, same order the table itself pages through). */
export function missingOffsets(total: number, limit: number, have: ReadonlySet<number>): number[] {
  const out: number[] = [];
  const step = Math.max(1, limit);
  for (let offset = 0; offset < total; offset += step) if (!have.has(offset)) out.push(offset);
  return out;
}

/** true once `pages` covers every row of the query it belongs to (nothing left to fetch for a chart/Excel merge).
 *  An empty cache (no rows ever requested, e.g. before the first page lands) is not "collected". */
export function allPagesCollected(pages: StatsPages): boolean {
  const first = pages.get(0);
  if (!first?.row_page) return false;
  return missingOffsets(first.row_page.total, first.row_page.limit, new Set(pages.keys())).length === 0;
}

/**
 * every cached page of one query, concatenated in offset order, into one "complete" StatisticsResult — the exact
 * shape the pre-D23 chart (PivotChart/statsChartModel) and Excel adapter (src/export/adapters/statistics.ts)
 * already expect, so neither needed to change for paging. Column members/totals, grand totals and every other
 * "shape" field come from the page at offset 0 (every page of one query returns them byte-identical — same
 * dataset snapshot, same spec). Throws if `pages` does not fully cover [0, total) — callers check
 * {@link allPagesCollected} first, so this is a programming-error guard, never a user-facing path.
 */
export function mergePages(pages: StatsPages): StatisticsResult {
  const base = pages.get(0);
  if (!base?.row_page) throw new Error('mergePages: no page at offset 0');
  const missing = missingOffsets(base.row_page.total, base.row_page.limit, new Set(pages.keys()));
  if (missing.length) throw new Error(`mergePages: missing offsets ${missing.join(',')}`);
  const ordered = [...pages.entries()].sort(([a], [b]) => a - b).map(([, r]) => r);
  const row_members = ordered.flatMap((r) => r.row_members);
  const row_totals = ordered.flatMap((r) => r.row_totals);
  const cells = ordered.flatMap((r) => r.cells);
  return { ...base, row_members, row_totals, cells,
    row_page: { offset: 0, limit: base.row_page.total, total: base.row_page.total, has_more: false } };
}

/** how many pages a query of this size has (≥1, even for an empty result) — for a "n/총 m쪽" progress label. */
export const pageCount = (total: number, limit: number): number => Math.max(1, Math.ceil(total / Math.max(1, limit)));
