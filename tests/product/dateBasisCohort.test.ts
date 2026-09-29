/**
 * date-basis-dashboard oracle (docs/implementation/date-basis-dashboard/fixtures/cohort-oracle.json) through the REAL
 * server aggregation: identity membership (not only counts), numerators/denominators, durations, participants,
 * monthly grouping, previous window, missing-date diagnostics, the place focus, the personal side and 맞춤 통계.
 * These are unit/contract checks over synthetic facts — not an SQL, Edge or browser pass.
 */
import { describe, expect, it } from 'vitest';
import { aggregateDashboard, focusSelection, overviewOf, representatives, selectScope, type PrivateFact } from '../../server/aggregate';
import { aggregateCompare } from '../../server/compare';
import { aggregateStatistics } from '../../server/statistics';
import { placeKey } from '../../server/places';
import { ORACLE, oracleDemoFacts } from '../../src/data/demoOracle';
import type { DateBasis, Scope } from '../../src/domain/public';
import { baseSpec } from '../../src/state/statistics';
import { compareRows, sortFraction, type SortableRow } from '../../src/domain/tableSort';

const facts = oracleDemoFacts();
const scope = (date_basis: DateBasis, patch: Partial<Scope> = {}): Scope => ({
  date_basis, start: ORACLE.range.start, end: ORACLE.range.end, category: 'all', region_code: null,
  agency_key: null, manager_key: null, bbox: null, law: null, ...patch,
});
const ids = (rows: readonly PrivateFact[]) => [...new Set(rows.map(f => f.fact_identity.replace('oracle:', '')))].sort();
const options = { datasetVersion: 'oracle', sourceUpdatedAt: null, generatedAt: '2025-09-29T00:00:00Z', asOf: '2025-09-12',
  sample: true, dataMin: '2025-04-01', today: ORACLE.today_kst };

describe.each(['report_date', 'completed_date'] as const)('single cohort on %s', (basis) => {
  const want = ORACLE.expected[basis];
  const sel = selectScope(representatives(facts), scope(basis));
  const data = aggregateDashboard(facts, scope(basis), options);
  const o = data.overview;

  it('DT-05/06 exact identity membership (same count, different reports)', () => {
    expect(ids(sel.cohort)).toEqual(want.identities);
    expect(o.report_count.value).toBe(want.N);
    expect(o.completed_count.value).toBe(want.C);
    expect(o.report_count.basis).toBe(basis);
  });
  it('DT-07..10 numerators and denominators come from that one set', () => {
    expect(o.outcomes).toMatchObject({ accepted: want.accepted, partial: want.partial, rejected: want.rejected, result_known: want.K });
    expect(o.fine_count.value).toBe(want.F);
    expect(o.fine_count.denominator).toBe(want.C);
    expect(o.warning_count).toBe(want.W);
    expect(o.accepted_including_partial.numerator).toBe(want.accepted + want.partial);
    expect(o.accepted_including_partial.denominator).toBe(want.K);
  });
  it('DT-08/DT-10 durations keep the real report date and never invent an answer date', () => {
    const d = o.processing_duration!;
    expect(d.count).toBe(want.duration_days.length);
    expect(d.min_days).toBe(want.duration_days[0]);
    expect(d.max_days).toBe(want.duration_days[1]);
    expect(d.median_days).toBe(want.duration_median);
    expect(d.excluded.no_answer_date).toBe(want.duration_excluded.no_answer_date);
    expect(d.excluded.no_report_date).toBe(want.duration_excluded.no_report_date);
    expect(d.basis).toBe(basis);
  });
  it('AG-05 participants are the distinct accounts linked to the selected identities', () => {
    expect(o.contributor_count.value).toBe(want.participants);
    expect(o.point_count.value).toBe(want.places);
  });
  it('EX-01 / D08 monthly groups by the SELECTED date month; every result of a month is from the same reports', () => {
    for (const [month, members] of Object.entries(want.monthly)) {
      const row = data.monthly.find(m => m.month === month)!;
      expect(row.report_count).toBe(members.length);
      expect(row.completed_count).toBe(members.length);
      expect(row.outcomes!.result_known).toBe(members.length);
    }
    // calendar spine: July is kept even when no report falls there (answer basis) — a real 0, not a gap
    expect(data.monthly.map(m => m.month)).toEqual(['2025-07', '2025-08']);
  });
  it('AG-03 / D11 previous window uses the same basis; its rows never enter the current counts or diagnostics', () => {
    expect(ids(sel.previousReported)).toEqual(want.previous.identities);
    expect(o.report_count.previous).toBe(want.previous.identities.length);
    expect(o.report_count.missing).toBe(want.selected_date_missing);
    expect(o.cohort).toEqual({ date_basis: basis, selected_date_missing: want.selected_date_missing,
      other_date_missing: basis === 'report_date' ? 1 : 1 });
  });
  it('D07 repeated report DAYS use the reports\' own report dates over the same cohort', () => {
    const buckets = data.analytics!.vehicle_days;
    const repeatV1 = Object.values(want.vehicle_repeat_days)[0];
    expect(buckets.repeat_vehicle_count).toBe(repeatV1 > 1 ? 1 : 0);
    expect(data.vehicle_total_scope_reports).toBe(want.N);
  });
  it('D02/MP-01 every cohort report is on the map: places = distinct addresses, no date-based hiding', () => {
    const drawn = data.points.reduce((n, p) => n + p.report_count, 0);
    expect(drawn).toBe(want.N);
    expect(data.points.length).toBe(want.places);
  });
  it('D06/AG-05 personal side: each viewer\'s own reports of the SAME cohort; D counted once in all', () => {
    for (const [viewer, own] of Object.entries(want.mine)) {
      const c = aggregateCompare(facts, scope(basis), viewer, { datasetVersion: 'oracle', asOf: '2025-09-12', dataMin: '2025-05-20',
        viewer: { contributor: 'active', has_public_facts: true }, today: ORACLE.today_kst });
      expect(c.mine.report_count).toBe(own.length);
      expect(c.all.report_count).toBe(want.N);
      expect(c.cohort!.all.date_basis).toBe(basis);
    }
  });
  it('D09 맞춤 통계 on the same basis returns the same identities and month grouping', () => {
    const month = basis === 'report_date' ? 'report_month' : 'completed_month';
    const r = aggregateStatistics({ facts, scope: scope(basis), datasetVersion: 'oracle',
      spec: baseSpec({ date_basis: basis, rows: [month], metrics: ['completed_count', 'fine_count'] }) });
    expect(r.population_count.all).toBe(want.N);
    expect(r.row_members.map(m => m.key[0])).toEqual(['2025-07', '2025-08']);
    expect(r.date_axes).toEqual([{ dimension: month, role: 'row', mode: 'spine' }]);
    const july = r.cells.find(c => c.row[0] === '2025-07')!;
    expect(july.values.completed_count.value).toBe(want.monthly['2025-07'].length);
  });
});

describe('oracle specifics', () => {
  it('DT-07 A (July report, September answer) is in the report-date July month with its September result', () => {
    const data = aggregateDashboard(facts, scope('report_date'), options);
    const july = data.monthly.find(m => m.month === '2025-07')!;
    expect(july.outcomes!.accepted).toBe(1);
    expect(july.fine_count).toBe(1);
  });
  it('DT-09 D (no report date) counts once in all with 2 participants on the answer basis', () => {
    const sel = selectScope(facts, scope('completed_date'));
    const d = sel.cohort.filter(f => f.fact_identity === 'oracle:D');
    expect(d.map(f => f.contributor_id).sort()).toEqual(['u1', 'u2']);
    expect(selectScope(representatives(facts), scope('completed_date')).cohort.filter(f => f.fact_identity === 'oracle:D')).toHaveLength(1);
  });
  it('EX-04 another date as a classification keeps its own values (answer-basis August set by report month shows May)', () => {
    const r = aggregateStatistics({ facts, scope: scope('completed_date'), datasetVersion: 'oracle',
      spec: baseSpec({ date_basis: 'completed_date', rows: ['report_month'], metrics: ['completed_count'] }) });
    expect(r.row_members.map(m => m.key[0])).toEqual(['2025-05', '2025-08', '__none__']);
    expect(r.date_axes).toEqual([{ dimension: 'report_month', role: 'row', mode: 'other_date' }]);
  });
  it('EX-06 explicitly picked months stay explicit (no invented gap month)', () => {
    const r = aggregateStatistics({ facts, scope: scope('report_date', { start: '2025-01-01', end: '2025-12-31' }), datasetVersion: 'oracle',
      spec: baseSpec({ date_basis: 'report_date', rows: ['report_month'], metrics: ['completed_count'],
        filters: [{ dimension: 'report_month', members: ['2025-05', '2025-07'] }] }) });
    expect(r.row_members.map(m => m.key[0])).toEqual(['2025-05', '2025-07']);
    expect(r.date_axes![0].mode).toBe('explicit');
  });
  it('EX-05 spine: a month without reports is count 0 and rate null; outside the data window it is no_data', () => {
    const r = aggregateStatistics({ facts, scope: scope('completed_date', { start: '2025-06-01', end: '2025-10-31' }), datasetVersion: 'oracle',
      dataWindow: { min: '2025-06-10', max: '2025-09-12' },
      spec: baseSpec({ date_basis: 'completed_date', rows: ['completed_month'], metrics: ['completed_count', 'accept_rate'] }) });
    expect(r.row_members.map(m => m.key[0])).toEqual(['2025-06', '2025-07', '2025-08', '2025-09', '2025-10']);
    const july = r.cells.find(c => c.row[0] === '2025-07')!.values;
    expect(july.completed_count.value).toBe(0);
    expect(july.accept_rate.value).toBeNull();
    const oct = r.cells.find(c => c.row[0] === '2025-10')!.values;
    expect(oct.completed_count).toMatchObject({ value: null, reason: 'no_data' });
  });
  it('KP-02/KP-03 address focus: the full overview of one place from the same builder, co-contributors kept', () => {
    const key = placeKey(facts.find(f => f.fact_identity === 'oracle:D')!)!;
    const inPlace = (f: PrivateFact) => placeKey(f) === key;
    const sel = focusSelection(selectScope(representatives(facts), scope('completed_date')), inPlace);
    const full = focusSelection(selectScope(facts, scope('completed_date')), inPlace);
    const o = overviewOf({ sel, full, comparisonCovered: true });
    expect(o.report_count.value).toBe(1);          // D only (E has no answer date → not in the answer basis)
    expect(o.contributor_count.value).toBe(2);     // u1 and u2 both linked to D
    expect(o.point_count.value).toBe(1);
    expect(o.fine_count.value).toBe(1);
    const onReport = overviewOf({ sel: focusSelection(selectScope(representatives(facts), scope('report_date')), inPlace),
      full: focusSelection(selectScope(facts, scope('report_date')), inPlace), comparisonCovered: true });
    expect(onReport.report_count.value).toBe(1);   // E only on the report basis
    expect(onReport.warning_count).toBe(1);
  });
  it('EX-08 a scope/spec basis conflict is refused, never resolved silently', () => {
    expect(() => aggregateStatistics({ facts, scope: scope('report_date'), datasetVersion: 'oracle',
      spec: baseSpec({ date_basis: 'completed_date', rows: [], metrics: ['completed_count'] }) })).toThrow();
  });
});

describe('SO sort oracle (registry comparator)', () => {
  const rows: Array<SortableRow & { key: string; name: string }> = ORACLE.sort_oracle.rows.map(r => ({
    key: r.key, name: r.name, completed_count: r.completed_count, fine_count: r.fine_count,
    outcomes: { accepted: 0, partial: 0, rejected: 0, result_known: 0, result_unknown: 0 },
  }));
  const order = (value: 'count' | 'rate', dir: 'asc' | 'desc') =>
    [...rows].sort(compareRows({ column: 'fine', value, dir }, r => r.name, r => r.key)).map(r => r.key);
  it.each([['count', 'desc'], ['count', 'asc'], ['rate', 'desc'], ['rate', 'asc']] as const)('SO-02 fine %s %s', (value, dir) => {
    expect(order(value, dir)).toEqual(ORACLE.sort_oracle.expected[`fine ${value} ${dir}`]);
  });
  it('SO-03 1/3 and 3333/10000 (both 33.3%) are ordered by the exact value', () => {
    const third = rows.find(r => r.key === 'agency-third')!, fourth = rows.find(r => r.key === 'agency-fourth')!;
    expect(sortFraction(third, 'fine', 'rate')).toEqual({ num: 1, den: 3 });
    expect(compareRows<typeof third>({ column: 'fine', value: 'rate', dir: 'desc' }, r => r.name, r => r.key)(third, fourth)).toBeLessThan(0);
  });
  it('SO-10 an unknown count is never 0 / 0%', () => {
    const unknown = rows.find(r => r.key === 'agency-null')!;
    expect(sortFraction(unknown, 'fine', 'count')).toBeNull();
    expect(sortFraction(unknown, 'fine', 'rate')).toBeNull();
  });
});

describe('long periods in the personal comparison', () => {
  it('a 12-year comparison (145 monthly rows) passes the client schema (was capped at 80 rows)', async () => {
    const { personalCompareSchema } = await import('../../src/data/personal');
    const c = aggregateCompare(facts, scope('report_date', { start: '2014-09-01', end: '2026-09-30' }), 'u1', { datasetVersion: 'oracle', asOf: '2025-09-12',
      dataMin: '2014-09-01', viewer: { contributor: 'active', has_public_facts: true }, today: ORACLE.today_kst });
    expect(c.monthly).toHaveLength(145);
    expect(personalCompareSchema.safeParse(JSON.parse(JSON.stringify(c))).success).toBe(true);
  });
});
