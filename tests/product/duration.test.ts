import { describe, expect, it } from 'vitest';
import { aggregateDashboard, type PrivateFact } from '../../server/aggregate';
import { durationOf, durationSummary, median, nearestRank } from '../../server/duration';
import type { Scope } from '../../src/domain/public';

let n = 0;
const fact = (report: string | null, done: string | null, patch: Partial<PrivateFact> = {}): PrivateFact => ({
  fact_identity: `d${n++}`, contributor_id: 'c1', snapshot_id: 's', snapshot_generation: 1,
  report_date: report, completed_date: done, category: 'traffic', status: 'accepted', disposition: 'none',
  vehicle_raw: null, point_key: null, lat: null, lng: null, address: null, region_code: '서울 중구',
  agency_key: 'a1', agency_name: '기관1', manager_key: 'm1', manager_name: '담당1', ...patch,
});
const scope = (start: string, end: string): Scope => ({ start, end, category: 'all', region_code: null, agency_key: null, manager_key: null, bbox: null, law: null });
const opts = { datasetVersion: 'v', sourceUpdatedAt: null, generatedAt: '2026-09-27T00:00:00Z', asOf: '2026-12-31', sample: false, dataMin: '2020-01-01' };

describe('duration of one report (KST calendar days)', () => {
  it('same-day answer is 0 days; month, year and leap-day boundaries count calendar days', () => {
    expect(durationOf(fact('2026-09-01', '2026-09-01'))).toEqual({ days: 0 });
    expect(durationOf(fact('2026-01-31', '2026-02-01'))).toEqual({ days: 1 });
    expect(durationOf(fact('2025-12-31', '2026-01-01'))).toEqual({ days: 1 });
    expect(durationOf(fact('2024-02-28', '2024-03-01'))).toEqual({ days: 2 }); // leap year: 02-29 exists
    expect(durationOf(fact('2025-02-28', '2025-03-01'))).toEqual({ days: 1 });
  });
  it('uses the KST calendar day of timestamps, not UTC', () => {
    // 2026-09-01T15:30Z is 2026-09-02 00:30 KST
    expect(durationOf(fact('2026-09-02', '2026-09-01T15:30:00Z'))).toEqual({ days: 0 });
  });
  it('excludes with a reason instead of fixing values', () => {
    expect(durationOf(fact(null, '2026-09-01'))).toEqual({ reason: 'no_report_date' });
    expect(durationOf(fact('2026-09-05', '2026-09-01'))).toEqual({ reason: 'reversed' });
    expect(durationOf(fact('2026-09-01', null))).toEqual({ reason: 'no_answer_date' });
    expect(durationOf(fact('2026-09-01', '2026-09-03', { status: 'withdrawn' }))).toEqual({ reason: 'not_answered' });
    expect(durationOf(fact('2026-09-01', '2026-09-03', { status: 'transferred' }))).toEqual({ reason: 'not_answered' });
    expect(durationOf(fact('2026-09-01', '2026-09-03', { status: 'completed_unknown' }))).toEqual({ days: 2 });
  });
});

describe('median and 90th percentile definitions', () => {
  it('n = 0, 1, 2 and even-n median', () => {
    expect(median([])).toBeNull();
    expect(nearestRank([], 0.9)).toBeNull();
    expect(median([7])).toBe(7);
    expect(nearestRank([7], 0.9)).toBe(7);
    expect(median([2, 5])).toBe(3.5);
    expect(nearestRank([2, 5], 0.9)).toBe(5);
    expect(median([1, 2, 3, 10])).toBe(2.5);
  });
  it('p90 is nearest-rank: rank ceil(0.9 n)', () => {
    const ten = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(nearestRank(ten, 0.9)).toBe(9);     // ceil(9) = 9th
    expect(nearestRank([...ten, 11], 0.9)).toBe(10); // ceil(9.9) = 10th
  });
  it('summary counts exclusions separately and keeps the long but valid value', () => {
    const s = durationSummary([fact('2026-01-01', '2026-01-01'), fact('2025-01-01', '2026-01-01'), fact(null, '2026-01-02'), fact('2026-01-05', '2026-01-02')]);
    expect(s).toMatchObject({ count: 2, median_days: 182.5, min_days: 0, max_days: 365, excluded: { no_report_date: 1, reversed: 1 } });
    expect(s.mean_days).toBe(182.5);
  });
});

describe('scope integration', () => {
  it('uses the answer-date cohort: a report from before the period answered inside it is included', () => {
    const data = aggregateDashboard([
      fact('2026-08-20', '2026-09-03'), // reported before the period, answered inside → 14 days, included
      fact('2026-09-10', '2026-10-02'), // answered after the period → not in this cohort
      fact('2026-09-05', null, { status: 'completed_unknown' }), // answered status but no answer date → period unknown
    ], scope('2026-09-01', '2026-09-30'), opts);
    expect(data.overview.processing_duration).toMatchObject({ count: 1, median_days: 14, answer_date_missing: 1 });
    expect(data.meta.capabilities.processing_duration.status).toBe('supported');
  });
  it('says "no computable reports" (count 0, nulls) instead of unsupported when the period is empty', () => {
    const data = aggregateDashboard([], scope('2026-09-01', '2026-09-30'), opts);
    expect(data.overview.processing_duration).toMatchObject({ count: 0, median_days: null, mean_days: null, p90_days: null });
    expect(data.meta.capabilities.processing_duration.status).toBe('supported');
  });
  it('group medians are recomputed from raw values, not averaged', () => {
    const rows = [
      fact('2026-09-01', '2026-09-02', { region_code: '서울 중구', agency_key: 'a', agency_name: 'a' }),
      fact('2026-09-01', '2026-09-03', { region_code: '서울 중구', agency_key: 'a', agency_name: 'a' }),
      fact('2026-09-01', '2026-09-30', { region_code: '부산 해운대구', agency_key: 'b', agency_name: 'b' }),
    ];
    const data = aggregateDashboard(rows, scope('2026-09-01', '2026-09-30'), opts);
    const byRegion = Object.fromEntries(data.regions!.filter(r => r.level === 'sgg').map(r => [r.region_code, r.duration!.median_days]));
    expect(byRegion).toEqual({ '11140': 1.5, '26350': 29 });
    // 시도 rows are computed from raw facts too (서울 = [1, 2] → 1.5; 부산 = [29])
    expect(data.regions!.find(r => r.region_code === '11')!.duration!.median_days).toBe(1.5);
    // overall median of raw [1, 2, 29] is 2, not the mean of group medians (15.25)
    expect(data.overview.processing_duration!.median_days).toBe(2);
    expect(data.agencies.find(a => a.agency_key === 'a')!.duration).toMatchObject({ count: 2, median_days: 1.5 });
    const sep = data.monthly.find(m => m.month === '2026-09')!;
    expect(sep.duration).toMatchObject({ count: 3, median_days: 2 });
  });
});
