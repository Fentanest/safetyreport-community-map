import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  TREND_RATES, normalizeRates, rateCell, readTrendRates, trendRateRows, writeTrendRates, type TrendRate,
} from '../../src/components/trendMetrics';
import type { MonthlyBucket } from '../../src/domain/public';
import type { CompareMonth } from '../../src/domain/personal';

/** S09 oracle: docs/implementation/scope-statistics/fixtures/monthly-rates.example.json (synthetic, test-only).
 *  The expected values are the fixture's own; they are never regenerated from this implementation. */
const oracle = JSON.parse(readFileSync('docs/implementation/scope-statistics/fixtures/monthly-rates.example.json', 'utf8'));

type Side = { completed_count: number; outcomes?: MonthlyBucket['outcomes']; fine_count?: number };
const bucket = (month: string, s: Side, partial = false): MonthlyBucket => ({
  month, report_count: s.completed_count, completed_count: s.completed_count,
  // "field not sent" (undefined) is what an older server does; the adapter keeps it distinct from null
  fine_count: s.fine_count as number, outcomes: (s.outcomes ?? undefined) as MonthlyBucket['outcomes'], partial, coverage_note: null,
});
const mineMonth = (month: string, s: Side): CompareMonth => ({
  month, all_report_count: null, mine_report_count: s.completed_count, all_completed_count: null, mine_completed_count: s.completed_count,
  all_accept_rate: null, mine_accept_rate: null, all_duration_median_days: null, mine_duration_median_days: null,
  ...(s.outcomes !== undefined ? { mine_outcomes: s.outcomes } : {}),
  ...(s.fine_count !== undefined ? { mine_fine_count: s.fine_count } : {}),
});

describe('S09 monthly rate selector vs the oracle fixture', () => {
  const cases = oracle.cases as Array<{ month: string; note?: string; all: Side; mine: Side; partial?: boolean; expected: Record<'all' | 'mine', Record<TrendRate, unknown>> }>;
  // MT-13: my months arrive in another order (and are joined by key)
  const rows = trendRateRows(cases.map((c) => bucket(c.month, c.all, !!c.partial)), [...cases].reverse().map((c) => mineMonth(c.month, c.mine)));
  for (const c of cases) {
    it(`${c.month}: ${c.note ?? ''}`, () => {
      const row = rows.find((r) => r.month === c.month)!;
      for (const k of oracle.metric_order as TrendRate[]) {
        expect(row.all[k]).toEqual(c.expected.all[k]);
        expect(row.mine![k]).toEqual(c.expected.mine[k]);
      }
    });
  }
  it('rows are sorted by YYYY-MM and the in-progress month is flagged only where it is', () => {
    expect(rows.map((r) => r.month)).toEqual([...rows.map((r) => r.month)].sort());
    expect(rows.filter((r) => r.partial).map((r) => r.month)).toEqual(['2026-09']);
  });
  it('MT-13: a month my response lacks is "no data", never the neighbour month', () => {
    const r = trendRateRows([bucket('2026-01', cases[0].all), bucket('2026-04', cases[3].all)], [mineMonth('2026-04', cases[3].mine)]);
    expect(r[0].mine!.accept).toEqual({ numerator: null, denominator: null, value: null, reason: 'no_data' });
    expect(r[1].mine!.reject.value).toBeCloseTo(66.667, 2);
  });
  it('comparison off → no mine cells at all', () => {
    expect(trendRateRows([bucket('2026-01', cases[0].all)], null)[0].mine).toBeNull();
  });
  it('a month outside the data window (all null) is no_data, not 0%', () => {
    const outside: MonthlyBucket = { month: '2026-10', report_count: null, completed_count: null, fine_count: null, outcomes: null, partial: false, coverage_note: null };
    expect(trendRateRows([outside], null)[0].all.fine).toEqual({ numerator: null, denominator: null, value: null, reason: 'no_data' });
  });
  it('rateCell never turns null into 0', () => {
    expect(rateCell({ completed_count: 3, outcomes: null, fine_count: null }, 'accept').value).toBeNull();
    expect(rateCell({ completed_count: 3, outcomes: null, fine_count: null }, 'fine').value).toBeNull();
  });
});

describe('S09 selection preference', () => {
  const store = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); }, m }; };
  it('MT-07: default 수용률 only; a legacy single choice becomes a one-item list; unknown values dropped', () => {
    expect(readTrendRates(store())).toEqual(['accept']);
    const s = store(); s.setItem('cm-trend-rate', 'fine');
    expect(readTrendRates(s)).toEqual(['fine']);
    s.setItem('cm-trend-rates', JSON.stringify(['fine', 'bogus', 'accept', 'accept']));
    expect(readTrendRates(s)).toEqual(['accept', 'fine']);
  });
  it('an explicit empty selection stays empty (never silently back to 수용률); canonical order kept', () => {
    const s = store();
    writeTrendRates([], s);
    expect(readTrendRates(s)).toEqual([]);
    writeTrendRates(['fine', 'reject'], s);
    expect(readTrendRates(s)).toEqual(['reject', 'fine']);
    expect(s.m.has('cm-trend-rate')).toBe(false);
    expect(normalizeRates('x')).toBeNull();
    expect(TREND_RATES).toEqual(oracle.metric_order);
  });
});
