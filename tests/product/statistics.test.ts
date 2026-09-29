import { describe, expect, it } from 'vitest';
import type { PrivateFact } from '../../server/aggregate';
import { aggregateStatistics, parseSpec, statisticsCandidates, statisticsCatalog, StatsQueryError } from '../../server/statistics';
import { createPublicHandler, type AnalyticsRepository } from '../../server/publicHandler';
import type { Scope } from '../../src/domain/public';
import type { StatisticsSpec } from '../../src/domain/statistics';
import { fixtureAccess, viewerRequest } from './helpers/mapViewer';

/** S05–S08 맞춤 통계 (synthetic facts only). */
let n = 0;
const f = (patch: Partial<PrivateFact> = {}): PrivateFact => {
  n += 1;
  return {
    fact_identity: `st-${n}`, contributor_id: 'u1', snapshot_id: 's', snapshot_generation: 1,
    report_date: '2026-03-02', completed_date: '2026-03-10', category: 'traffic', status: 'accepted', disposition: 'none',
    vehicle_raw: null, point_key: null, lat: 37.55, lng: 126.85, address: '서울특별시 강서구 공항대로 1', region_code: '서울 강서구',
    agency_key: 'a1:A', agency_name: '기관A', manager_key: 'm1:kim', manager_name: '김하늘', ...patch,
  };
};
const scope: Scope = { start: '2026-01-01', end: '2026-06-30', category: 'all', region_code: null, agency_key: null, manager_key: null, bbox: null, law: null };
const spec = (patch: Partial<StatisticsSpec> = {}): StatisticsSpec => ({
  version: 1, date_basis: 'completed_date', population: 'all', rows: [], columns: [], metrics: ['completed_count'], filters: [], place_key: null, ...patch,
});
const run = (facts: PrivateFact[], s: Partial<StatisticsSpec>, viewerId?: string) =>
  aggregateStatistics({ facts, scope, spec: spec(s), datasetVersion: 'v', viewerId });
const cell = (r: ReturnType<typeof run>, row: string[], col: string[] = [], side: 'all' | 'mine' = 'all') =>
  r.cells.find((c) => JSON.stringify(c.row) === JSON.stringify(row) && JSON.stringify(c.col) === JSON.stringify(col) && c.side === side);

// group G: C=20, A=12, P=3, R=3, unknown=2, F=8, W=5
const G = [
  ...Array.from({ length: 12 }, (_, i) => f({ status: 'accepted', disposition: i < 8 ? 'fine' : i === 8 ? 'warning' : 'none' })),
  ...Array.from({ length: 3 }, () => f({ status: 'partial', disposition: 'warning' })),
  ...Array.from({ length: 3 }, (_, i) => f({ status: 'rejected', disposition: i === 0 ? 'warning' : 'none' })),
  ...Array.from({ length: 2 }, () => f({ status: 'completed_unknown' })),
];

describe('PV: exact pivot values', () => {
  it('PV-02 group G rates', () => {
    const r = run(G, { metrics: ['completed_count', 'accept_rate', 'partial_rate', 'reject_rate', 'fine_rate', 'warning_rate'] });
    const v = r.grand_totals[0].values;
    expect(v.completed_count.value).toBe(20);
    expect(v.accept_rate).toMatchObject({ numerator: 12, denominator: 18 });
    expect(v.accept_rate.value!.toFixed(1)).toBe('66.7');
    expect(v.partial_rate.value!.toFixed(1)).toBe('16.7');
    expect(v.reject_rate.value!.toFixed(1)).toBe('16.7');
    expect(v.fine_rate).toMatchObject({ value: 40, numerator: 8, denominator: 20 });
    expect(v.warning_rate).toMatchObject({ value: 25, numerator: 5, denominator: 20 });
  });
  it('PV-03 a total rate is Σnum/Σden of the raw union (1/1 + 9/99 → 10%), not the mean of cells', () => {
    const facts = [f({ region_code: '서울 종로구', lat: 37.57, lng: 126.98 }),
      ...Array.from({ length: 9 }, () => f({ region_code: '서울 강남구', lat: 37.5, lng: 127.05 })),
      ...Array.from({ length: 90 }, () => f({ region_code: '서울 강남구', lat: 37.5, lng: 127.05, status: 'rejected' }))];
    const r = run(facts, { rows: ['sgg'], metrics: ['accept_rate'] });
    expect(r.row_members).toHaveLength(2);
    expect(r.grand_totals[0].values.accept_rate.value).toBeCloseTo(10);
  });
  it('PV-01 cells are real crosses (agency × law) and missing combinations are absent, not 0', () => {
    const facts = [f({ agency_key: 'a1:A', violation_law: '도로교통법 제32조' }), f({ agency_key: 'a1:A', violation_law: '도로교통법 제32조' }),
      f({ agency_key: 'a1:B', agency_name: '기관B', violation_law: '도로교통법 제33조' })];
    const r = run(facts, { rows: ['agency'], columns: ['law'], metrics: ['completed_count'] });
    expect(cell(r, ['a1:A'], ['도로교통법 제32조'])!.values.completed_count.value).toBe(2);
    expect(cell(r, ['a1:A'], ['도로교통법 제33조'])).toBeUndefined();
    expect(r.col_totals.map((t) => t.values.completed_count.value)).toEqual([2, 1]);
  });
  it('PV-04 distinct vehicles and medians of a total come from the union (not the sum of cells)', () => {
    const facts = [f({ agency_key: 'a1:A', vehicle_raw: '12가3456', report_date: '2026-03-01' }), f({ agency_key: 'a1:B', agency_name: '기관B', vehicle_raw: '12가3456', report_date: '2026-03-05' }),
      f({ agency_key: 'a1:B', agency_name: '기관B', vehicle_raw: '34나5678', report_date: '2026-02-01' })];
    const r = run(facts, { rows: ['agency'], metrics: ['vehicle_distinct', 'duration_median'] });
    const sumOfCells = r.cells.reduce((a, c) => a + (c.values.vehicle_distinct.value ?? 0), 0);
    expect(sumOfCells).toBe(3);
    expect(r.grand_totals[0].values.vehicle_distinct.value).toBe(2);
    expect(r.grand_totals[0].values.duration_median.value).toBe(9); // durations 9, 5, 37 → median 9
  });
  it('PV-06/PV-07 undisclosed rating/amount is never 0; a single report is kept', () => {
    const r = run([f({ rating: null, disposition: 'fine', amount_kind: 'fine', amount_public: false, amount_stated: true, amount_confirmed_won: null })],
      { metrics: ['rating_mean', 'amount_sum', 'completed_count'] });
    expect(r.grand_totals[0].values.rating_mean).toMatchObject({ value: null, reason: 'no_data' });
    expect(r.grand_totals[0].values.amount_sum.value).toBeNull();
    expect(r.grand_totals[0].values.completed_count.value).toBe(1);
  });
  it('PV-09 수용 and 과태료 overlap: an outcome × disposition cross keeps both memberships', () => {
    const r = run(G, { rows: ['outcome'], columns: ['disposition'] });
    expect(cell(r, ['accepted'], ['fine'])!.values.completed_count.value).toBe(8);
    expect(r.row_totals.find((t) => t.key[0] === 'accepted')!.values.completed_count.value).toBe(12);
  });
  it('PV-12 report-date basis: facts without a report date are excluded and counted', () => {
    const r = run([f(), f({ report_date: null }), f({ report_date: '2025-12-31', completed_date: '2026-01-02' })], { date_basis: 'report_date' });
    expect(r.grand_totals[0].values.completed_count.value).toBe(1);
    expect(r.excluded.no_report_date).toBe(1);
  });
  it('monthly rows are in calendar order and a 12-year range works', () => {
    const long: Scope = { ...scope, start: '2014-09-30', end: '2026-09-29' };
    const facts = [f({ completed_date: '2015-01-02' }), f({ completed_date: '2026-09-01' }), f({ completed_date: '2020-05-05' })];
    const r = aggregateStatistics({ facts, scope: long, spec: spec({ rows: ['completed_month'] }), datasetVersion: 'v' });
    expect(r.row_members.map((m) => m.key[0])).toEqual(['2015-01', '2020-05', '2026-09']);
  });
});

describe('MS: selected members, pairs and facets', () => {
  const people = [
    f({ agency_key: 'a1:A', manager_key: 'm1:kim', manager_name: '김하늘' }),
    f({ agency_key: 'a1:B', agency_name: '기관B', manager_key: 'm1:kim', manager_name: '김하늘' }),
    f({ agency_key: 'a1:B', agency_name: '기관B', manager_key: 'm1:lee', manager_name: '이서윤' }),
    f({ agency_key: 'a1:C', agency_name: '기관C', manager_key: 'm1:park', manager_name: '박도윤', completed_date: '2025-01-01' }),
  ];
  it('MS-04/05 same name in two agencies = two members; a pair filter is a union of exact pairs (no cross-product)', () => {
    const r = run(people, { rows: ['manager'], filters: [{ dimension: 'manager', members: ['a1:A|m1:kim', 'a1:B|m1:lee'] }] });
    expect(r.row_members.map((m) => m.key[0]).sort()).toEqual(['a1:A|m1:kim', 'a1:B|m1:lee']);
    expect(r.grand_totals[0].values.completed_count.value).toBe(2);
  });
  it('MS-09 a selected member the period excludes stays with count 0', () => {
    const r = run(people, { rows: ['agency'], filters: [{ dimension: 'agency', members: ['a1:A', 'a1:C'] }] });
    expect(r.filter_members.find((m) => m.key === 'a1:C')!.count).toBe(0);
    expect(r.row_members.map((m) => m.key[0])).toEqual(['a1:A']);
  });
  it('MS-03/08 candidates search the full set and ignore the dimension\'s own selection', () => {
    const page = statisticsCandidates({ facts: people, scope, datasetVersion: 'v', kind: 'agency', q: '', cursor: 0, limit: 1,
      filters: [{ dimension: 'agency', members: ['a1:A'] }], basis: 'completed_date', placeKey: null, keys: ['a1:A', 'a1:C'] });
    expect(page.total).toBe(2); // A and B (C is outside the period)
    expect(page.next_cursor).toBe(1);
    expect(page.selected.find((c) => c.key === 'a1:C')!.count).toBe(0);
    const search = statisticsCandidates({ facts: people, scope, datasetVersion: 'v', kind: 'manager', q: '이서', cursor: 0, limit: 10,
      filters: [], basis: 'completed_date', placeKey: null, keys: [] });
    expect(search.items).toEqual([{ key: 'a1:B|m1:lee', label: '이서윤 · 기관B', sub: '기관B', count: 1 }]);
  });
});

describe('PV-08/PV-10: populations and the registry', () => {
  it('mine is the verified viewer\'s rows; compare returns both sides; mine without a viewer is refused', () => {
    const facts = [f({ contributor_id: 'u1' }), f({ contributor_id: 'u2' }), f({ contributor_id: 'u2', status: 'rejected' })];
    const r = run(facts, { population: 'compare', metrics: ['completed_count', 'accept_rate'] }, 'u2');
    expect(r.grand_totals.find((t) => t.side === 'all')!.values.completed_count.value).toBe(3);
    expect(r.grand_totals.find((t) => t.side === 'mine')!.values.accept_rate.value).toBe(50);
    expect(() => run(facts, { population: 'mine' })).toThrow(StatsQueryError);
  });
  it('no private field is a dimension; every catalog id is accepted by the validator in its roles', () => {
    const cat = statisticsCatalog();
    const ids = cat.dimensions.map((d) => d.id);
    for (const bad of ['vehicle_raw', 'report_number', 'contributor_id', 'penalty_points', 'source_report_id']) expect(ids).not.toContain(bad);
    for (const d of cat.dimensions) {
      if (d.roles.includes('row')) expect(() => parseSpec(JSON.stringify(spec({ rows: [d.id] })))).not.toThrow();
    }
    for (const m of cat.metrics) expect(() => parseSpec(JSON.stringify(spec({ metrics: [m.id] })))).not.toThrow();
  });
  it('PV-05 SQL fragments, unknown fields and oversize specs are refused', () => {
    for (const raw of [
      JSON.stringify({ ...spec(), rows: ['agency; drop table x'] }),
      JSON.stringify({ ...spec(), sql: 'select 1' }),
      JSON.stringify({ ...spec(), metrics: ['sum(amount)'] }),
      JSON.stringify({ ...spec(), rows: ['vehicle_raw'] }),
      JSON.stringify({ ...spec(), rows: ['place'], columns: ['place'] }),
      JSON.stringify({ ...spec(), rows: ['sido', 'sgg', 'agency', 'law'] }),
      'x'.repeat(7000),
    ]) expect(() => parseSpec(raw)).toThrow(StatsQueryError);
  });
  it('PV-14 over-budget grids are refused with a readable message (never truncated)', () => {
    const many = Array.from({ length: 80 }, (_, i) => f({ agency_key: `a1:${i}`, agency_name: `기관${i}`, completed_date: `2026-0${1 + (i % 6)}-${String(1 + (i % 28)).padStart(2, '0')}` }));
    expect(() => run(many, { rows: ['agency'], columns: ['completed_day'] })).toThrow(/한도/);
  });
});

describe('statistics routes', () => {
  const state = { dataset_version: 'v1', ready: true, source_updated_at: null, generated_at: '2026-09-30T00:00:00Z', published_at: null,
    data_min: '2014-10-01', data_max: '2026-09-29', coverage_note: '', dedupe_policy_version: 'x' };
  const repo: AnalyticsRepository = { getState: async () => state, getFacts: async () => G, allowRequest: async () => true };
  const base = 'https://api.example.invalid/public-analytics';
  const q = (path: string, params: Record<string, string>) => `${base}/${path}?${new URLSearchParams(params)}`;
  const handler = createPublicHandler(repo, fixtureAccess());
  it('query returns the exact result; mine on the public API is refused; unknown params are refused', async () => {
    const ok = await handler(viewerRequest(q('statistics/query', { start: '2026-01-01', end: '2026-06-30', category: 'all', spec: JSON.stringify(spec({ metrics: ['fine_rate'] })) })));
    expect(ok.status).toBe(200);
    expect((await ok.json()).grand_totals[0].values.fine_rate.value).toBe(40);
    const mine = await handler(viewerRequest(q('statistics/query', { start: '2026-01-01', end: '2026-06-30', category: 'all', spec: JSON.stringify(spec({ population: 'mine' })) })));
    expect(mine.status).toBe(400);
    const extra = await handler(viewerRequest(q('statistics/query', { start: '2026-01-01', end: '2026-06-30', category: 'all', spec: JSON.stringify(spec()), user_id: 'u2' })));
    expect(extra.status).toBe(400);
  });
  it('PV-15 no token → 401 like every other route; catalog lists no private field', async () => {
    const anon = await handler(new Request(q('statistics/catalog', {}), { headers: { Origin: 'https://safemap.worklazy.net' } }));
    expect(anon.status).toBe(401);
    const cat = await handler(viewerRequest(`${base}/statistics/catalog`));
    expect(cat.status).toBe(200);
    expect(JSON.stringify(await cat.json())).not.toMatch(/vehicle_raw|report_number|contributor_id/);
  });
  it('candidates page and search', async () => {
    const r = await handler(viewerRequest(q('statistics/candidates', { start: '2026-01-01', end: '2026-06-30', category: 'all', kind: 'agency', q: '기관', limit: '5' })));
    expect(r.status).toBe(200);
    expect((await r.json()).items[0]).toMatchObject({ key: 'a1:A', count: 20 });
  });
});
