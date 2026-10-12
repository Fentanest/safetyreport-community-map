import { describe, expect, it } from 'vitest';
import { allPagesCollected, emptyPages, mergePages, missingOffsets, pageCount, type StatsPages } from '../../src/state/statsPaging';
import type { StatisticsResult } from '../../src/domain/statistics';
import type { Scope } from '../../src/domain/public';

const scope: Scope = { date_basis: 'completed_date', start: '2026-01-01', end: '2026-06-30', category: 'all', region_code: null, agency_key: null, manager_key: null, bbox: null, law: null };
const spec: StatisticsResult['spec'] = { version: 1, date_basis: 'completed_date', population: 'all', rows: ['agency'], columns: [], metrics: ['completed_count'], filters: [], place_key: null };

/** a minimal page response: `offset`'s rows (keys `rowKeys`), the shared shape fields identical across every page. */
function page(offset: number, limit: number, total: number, rowKeys: string[]): StatisticsResult {
  return {
    schema_version: 1, dataset_version: 'v1', scope, spec,
    row_members: rowKeys.map((k) => ({ key: [k], label: [k] })),
    col_members: [{ key: [], label: [] }],
    cells: rowKeys.map((k) => ({ row: [k], col: [], side: 'all' as const, values: { completed_count: { value: 1, numerator: 1, denominator: null, reason: null } } })),
    row_totals: rowKeys.map((k) => ({ key: [k], side: 'all' as const, values: { completed_count: { value: 1, numerator: 1, denominator: null, reason: null } } })),
    col_totals: [{ key: [], side: 'all' as const, values: { completed_count: { value: total, numerator: total, denominator: null, reason: null } } }],
    grand_totals: [{ key: [], side: 'all' as const, values: { completed_count: { value: total, numerator: total, denominator: null, reason: null } } }],
    population_count: { all: total, mine: null },
    excluded: { no_report_date: 0 },
    filter_members: [],
    row_page: { offset, limit, total, has_more: offset + rowKeys.length < total },
    complete: true,
  };
}

describe('D23 statsPaging (client page cache + merge, pure)', () => {
  it('missingOffsets: every page boundary up to total, in ascending order', () => {
    expect(missingOffsets(205, 62, new Set())).toEqual([0, 62, 124, 186]);
    expect(missingOffsets(205, 62, new Set([0, 124]))).toEqual([62, 186]);
    expect(missingOffsets(0, 62, new Set())).toEqual([]); // no rows at all: nothing to fetch
    expect(missingOffsets(5, 62, new Set())).toEqual([0]); // smaller than one page: still exactly one offset
  });

  it('allPagesCollected: false until every offset is cached, true once complete; empty cache is never "collected"', () => {
    expect(allPagesCollected(emptyPages())).toBe(false);
    const pages: StatsPages = new Map([[0, page(0, 2, 5, ['a', 'b'])]]);
    expect(allPagesCollected(pages)).toBe(false);
    const full = new Map([...pages, [2, page(2, 2, 5, ['c', 'd'])], [4, page(4, 2, 5, ['e'])]]);
    expect(allPagesCollected(full)).toBe(true);
  });

  it('mergePages: concatenates in offset order, keeps the shape fields of page 0, and the merged page covers everything at once', () => {
    const p0 = page(0, 2, 5, ['a', 'b']), p1 = page(2, 2, 5, ['c', 'd']), p2 = page(4, 2, 5, ['e']);
    const merged = mergePages(new Map([[4, p2], [0, p0], [2, p1]])); // insertion order scrambled on purpose
    expect(merged.row_members.map((m) => m.key[0])).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(merged.row_totals.map((t) => t.key[0])).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(merged.cells).toHaveLength(5);
    expect(merged.row_page).toEqual({ offset: 0, limit: 5, total: 5, has_more: false });
    // shape fields (never paged) come through unchanged, byte-identical to page 0's
    expect(merged.col_members).toEqual(p0.col_members);
    expect(merged.grand_totals).toEqual(p0.grand_totals);
    expect(merged.dataset_version).toBe('v1');
  });

  it('mergePages throws on an incomplete cache (programming-error guard, never a user-facing path)', () => {
    const p0 = page(0, 2, 5, ['a', 'b']);
    expect(() => mergePages(new Map([[0, p0]]))).toThrow(/missing offsets/);
    expect(() => mergePages(emptyPages())).toThrow();
  });

  it('pageCount: at least 1 even for an empty result; otherwise ceil(total/limit)', () => {
    expect(pageCount(0, 62)).toBe(1);
    expect(pageCount(100, 62)).toBe(2);
    expect(pageCount(124, 62)).toBe(2);
    expect(pageCount(125, 62)).toBe(3);
  });
});
