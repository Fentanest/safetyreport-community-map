import { describe, expect, it } from 'vitest';
import { querySchema, monthBounds } from '../../contracts/user-rankings/types';
import { boardQuerySchema } from '../../contracts/user-rankings-board/types';
import {
  BOARD_SECTIONS, RANKING_THEME_METRICS, boardQueryOf, defaultRankingQuery, rankingPeriodLabel, rankingStateFromSearch,
  writeRankingParams,
} from '../../src/domain/rankingPeriods';

const now = new Date('2026-09-30T15:00:00Z'); // 2026-10-01 00:00 KST

describe('ranking periods: every metric × all/range/month', () => {
  it.each(['all', 'range', 'month'] as const)('all seven metrics accept %s without metric or denominator substitution', (period) => {
    for (const [theme, metrics] of Object.entries(RANKING_THEME_METRICS)) {
      for (const metric of metrics) {
        const extra = period === 'month' ? { month: '2023-07' } : period === 'range' ? { start: '2023-07-01', end: '2023-07-31' } : {};
        expect(querySchema.safeParse({ theme, metric, period, ...extra }).success).toBe(true);
        expect(boardQuerySchema.safeParse({ period, ...extra }).success).toBe(true);
      }
    }
  });
  it('rejects invalid months and conflicting dates for the list and the board', () => {
    for (const month of ['2023-00', '2023-13', '2023-7', '2023-07-01']) {
      expect(querySchema.safeParse({ period: 'month', month }).success).toBe(false);
      expect(boardQuerySchema.safeParse({ period: 'month', month }).success).toBe(false);
    }
    expect(querySchema.safeParse({ period: 'month', month: '2023-07', start: '2023-07-01' }).success).toBe(false);
    expect(boardQuerySchema.safeParse({ period: 'month', month: '2023-07', start: '2023-07-01' }).success).toBe(false);
    expect(boardQuerySchema.safeParse({ period: 'range', start: '2023-07-02', end: '2023-07-01' }).success).toBe(false);
  });
  it('the board sections cover exactly the seven metrics, in the contract order', () => {
    expect(BOARD_SECTIONS.map((s) => s.label)).toEqual(['신고 랭킹', '과태료 랭킹', '불운 랭킹']);
    expect(BOARD_SECTIONS.flatMap((s) => s.metrics)).toEqual(Object.values(RANKING_THEME_METRICS).flat());
  });
  it('period labels: current month is 이달 (KST), past months name the year/month, ranges show both dates', () => {
    expect(rankingPeriodLabel({ period: 'month', month: '2023-07', start: null, end: null }, now)).toBe('2023년 7월');
    expect(rankingPeriodLabel({ period: 'month', month: '2026-10', start: null, end: null }, now)).toBe('이달');
    expect(rankingPeriodLabel({ period: 'month', month: null, start: null, end: null }, now)).toBe('이달');
    expect(rankingPeriodLabel({ period: 'month', month: '2026-09', start: null, end: null }, now)).toBe('2026년 9월');
    expect(rankingPeriodLabel({ period: 'range', month: null, start: '2026-01-01', end: '2026-03-31' }, now)).toBe('2026-01-01 — 2026-03-31');
    expect(rankingPeriodLabel({ period: 'all', month: null, start: null, end: null }, now)).toBe('전체 기간');
    expect(monthBounds('2023-07')).toEqual({ start: '2023-07-01', end: '2023-07-31' });
    expect(monthBounds('2024-02').end).toBe('2024-02-29');
  });
});

describe('rk_* URL state (2026-10-11 board)', () => {
  it('no rk_* → null (default board)', () => {
    expect(rankingStateFromSearch('?screen=rankings')).toBeNull();
  });
  it('a board URL keeps period/basis/category/min and opens the board', () => {
    const s = rankingStateFromSearch('?screen=rankings&rk_period=month&rk_month=2023-07&rk_basis=report_date&rk_category=safety&rk_min=3');
    expect(s?.view).toBe('board');
    expect(s?.query).toMatchObject({ period: 'month', month: '2023-07', date_basis: 'report_date', category: 'safety', min_reports: 3, page: 1 });
  });
  it('an older link with rk_theme/rk_metric opens that metric in the full list', () => {
    const s = rankingStateFromSearch('?rk_theme=unlucky&rk_metric=partial_rate&rk_period=all&rk_basis=completed_date&rk_category=all&rk_min=1');
    expect(s).toMatchObject({ view: 'full', query: { theme: 'unlucky', metric: 'partial_rate' } });
    // theme only → its first metric
    expect(rankingStateFromSearch('?rk_theme=fines')).toMatchObject({ view: 'full', query: { theme: 'fines', metric: 'fine_count' } });
  });
  it('invalid or mismatched values fall back to the default board, never a half-applied state', () => {
    for (const q of ['?rk_theme=fines&rk_metric=reports_count', '?rk_period=month&rk_month=2023-13', '?rk_min=0', '?rk_category=unknown']) {
      expect(rankingStateFromSearch(q)).toEqual({ query: defaultRankingQuery(), view: 'board' });
    }
  });
  it('writing the board removes rk_theme/rk_metric; writing the full list adds them; other params are kept', () => {
    const q = { ...defaultRankingQuery(), theme: 'fines' as const, metric: 'fine_rate' as const, period: 'range' as const, start: '2026-01-01', end: '2026-01-31' };
    const params = new URLSearchParams('screen=rankings&category=parking&rk_theme=unlucky&rk_metric=rejected_count&rk_month=2023-07');
    writeRankingParams(params, q, 'board');
    expect(params.has('rk_theme')).toBe(false);
    expect(params.has('rk_metric')).toBe(false);
    expect(params.has('rk_month')).toBe(false);
    expect(params.get('rk_start')).toBe('2026-01-01');
    expect(params.get('screen')).toBe('rankings');
    expect(params.get('category')).toBe('parking'); // the map's own filter is untouched
    writeRankingParams(params, q, 'full');
    expect(params.get('rk_theme')).toBe('fines');
    expect(params.get('rk_metric')).toBe('fine_rate');
    // round trip
    expect(rankingStateFromSearch(`?${params}`)).toMatchObject({ view: 'full', query: { theme: 'fines', metric: 'fine_rate', start: '2026-01-01', end: '2026-01-31' } });
  });
  it('the board request carries the applied period/filters only (no theme/metric/page)', () => {
    const q = { ...defaultRankingQuery(), theme: 'unlucky' as const, metric: 'partial_rate' as const, page: 3, period: 'month' as const, month: '2023-07', min_reports: 2 };
    const b = boardQueryOf(q);
    expect(b).toEqual({ period: 'month', start: null, end: null, month: '2023-07', date_basis: 'completed_date', category: 'all', min_reports: 2, top: 5 });
    expect(boardQuerySchema.parse(b)).toEqual(b);
  });
});
