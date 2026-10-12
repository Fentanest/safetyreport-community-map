import { describe, expect, it } from 'vitest';
import type { PrivateFact } from '../../server/aggregate';
import { aggregateStatistics, parseRowPage, parseSpec, statisticsCandidates, statisticsCatalog, StatsQueryError } from '../../server/statistics';
import { createPublicHandler, type AnalyticsRepository } from '../../server/publicHandler';
import type { Scope } from '../../src/domain/public';
import { STAT_OTHER_KEY, type RowPageRequest, type StatisticsSpec } from '../../src/domain/statistics';
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
const scope: Scope = { date_basis: 'completed_date' as const, start: '2026-01-01', end: '2026-06-30', category: 'all', region_code: null, agency_key: null, manager_key: null, bbox: null, law: null };
const spec = (patch: Partial<StatisticsSpec> = {}): StatisticsSpec => ({
  version: 1, date_basis: 'completed_date', population: 'all', rows: [], columns: [], metrics: ['completed_count'], filters: [], place_key: null, ...patch,
});
// one basis per request: the handler unifies scope and recipe (unifyBasis), so the helper does the same
const run = (facts: PrivateFact[], s: Partial<StatisticsSpec>, viewerId?: string, rowPage?: RowPageRequest) =>
  aggregateStatistics({ facts, scope: { ...scope, date_basis: spec(s).date_basis }, spec: spec(s), datasetVersion: 'v', viewerId, rowPage });
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
    // D17 (2026-09-29): the selected basis's month axis is a calendar spine — every month of the period, in order
    const months = r.row_members.map((m) => m.key[0]);
    expect(months).toHaveLength(145);
    expect([months[0], months[4], months[144]]).toEqual(['2014-09', '2015-01', '2026-09']);
    expect(months).toEqual([...months].sort());
    const cellOf = (k: string) => r.cells.find((c) => c.row[0] === k)!.values.completed_count.value;
    expect([cellOf('2015-01'), cellOf('2015-02'), cellOf('2020-05')]).toEqual([1, 0, 1]);
    expect(r.date_axes).toEqual([{ dimension: 'completed_month', role: 'row', mode: 'spine' }]);
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
  it('PV-14 an over-budget non-date × date grid is built, never refused: top rows by count + 그 외', () => {
    // 30 agencies, agency i has (30-i) facts, so ranking by count is unambiguous — all on one day, so the budget
    // comes entirely from the 181-day completed_day spine (never cut) crossed with the 30 agencies.
    const many = Array.from({ length: 30 }, (_, i) => Array.from({ length: 30 - i }, () => f({ agency_key: `a1:${i}`, agency_name: `기관${i}`, completed_date: '2026-03-15' }))).flat();
    const r = run(many, { rows: ['agency'], columns: ['completed_day'] });
    expect(r.col_members).toHaveLength(181); // the date spine is never cut
    expect(r.truncated).toEqual([{ role: 'row', dimensions: ['agency'], total_members: 30, shown_members: 26, other_count: 4 }]);
    expect(r.row_members).toHaveLength(27); // 26 kept + 1 '그 외'
    const other = r.row_members.at(-1)!;
    expect(other.key).toEqual([STAT_OTHER_KEY]);
    expect(other.label[0]).toBe('그 외 4개');
    // kept = the 26 highest-count agencies (i = 0..25, n = 30..5); folded = i = 26..29 (n = 4,3,2,1)
    expect(r.row_members.filter((m) => m.key[0] !== STAT_OTHER_KEY).map((m) => m.key[0]).sort())
      .toEqual(Array.from({ length: 26 }, (_, i) => `a1:${i}`).sort());
    expect(r.row_totals.find((t) => t.key[0] === STAT_OTHER_KEY)!.values.completed_count.value).toBe(4 + 3 + 2 + 1);
    expect(r.row_totals.find((t) => t.key[0] === 'a1:0')!.values.completed_count.value).toBe(30); // a kept row's total is unchanged
    expect(r.grand_totals[0].values.completed_count.value).toBe(many.length); // grand total never changes
  });
  it('비날짜×비날짜: both axes non-date — the LARGER one (manager, 300) is cut first; the smaller (agency, 20) already fits and stays whole', () => {
    const AGENCIES = 20, MANAGERS = 300;
    const facts = Array.from({ length: MANAGERS }, (_, m) => f({
      agency_key: `a1:ag${m % AGENCIES}`, agency_name: `기관${m % AGENCIES}`, manager_key: `mgr${m}`, manager_name: `매니저${m}`, completed_date: '2026-03-15',
    }));
    const r = run(facts, { rows: ['agency'], columns: ['manager'] });
    expect(r.row_members).toHaveLength(AGENCIES); // not cut
    expect(r.col_members).toHaveLength(250); // 249 kept + 1 그 외 (floor(5000 / 20) = 250)
    expect(r.col_members.at(-1)!.key).toEqual([STAT_OTHER_KEY]);
    expect(r.truncated).toEqual([{ role: 'column', dimensions: ['manager'], total_members: MANAGERS, shown_members: 249, other_count: 51 }]);
    expect(r.grand_totals[0].values.completed_count.value).toBe(facts.length);
  });
  it('비교(×2): 전체 혼자는 예산 안이지만, 전체와 내 신고 비교는 칸이 두 배라 자른다', () => {
    const compareScope: Scope = { date_basis: 'completed_date', start: '2019-01-01', end: '2025-12-31', category: 'all', region_code: null, agency_key: null, manager_key: null, bbox: null, law: null };
    const facts = Array.from({ length: 59 }, (_, i) => f({ agency_key: `a1:cmp${i}`, agency_name: `비교기관${i}`, contributor_id: 'u-compare', completed_date: '2022-06-15' }));
    const base = (population: StatisticsSpec['population']) => aggregateStatistics({ facts, scope: compareScope,
      spec: spec({ rows: ['agency'], columns: ['completed_month'], population }), datasetVersion: 'v', viewerId: population === 'all' ? undefined : 'u-compare' });
    const whole = base('all');
    expect(whole.col_members).toHaveLength(84); // 7년 × 12개월, 날짜 축은 자르지 않음
    expect(whole.truncated).toBeUndefined(); // 59 × 84 × 1 = 4,956 ≤ 5,000
    const cmp = base('compare');
    expect(cmp.truncated).toEqual([{ role: 'row', dimensions: ['agency'], total_members: 59, shown_members: 28, other_count: 31 }]); // × 2라서 59 × 84 × 2 = 9,912 > 5,000
  });
  it('비교 대상으로 직접 고른 멤버는 자르지 않는다(필터가 이미 전체 후보를 줄였으므로 그 외도 생기지 않는다)', () => {
    const many = Array.from({ length: 30 }, (_, i) => Array.from({ length: 30 - i }, () => f({ agency_key: `a1:${i}`, agency_name: `기관${i}`, completed_date: '2026-03-15' }))).flat();
    const chosen = ['a1:0', 'a1:15', 'a1:29'];
    const r = run(many, { rows: ['agency'], columns: ['completed_day'], filters: [{ dimension: 'agency', members: chosen }] });
    expect(r.truncated).toBeUndefined();
    expect(r.row_members.map((m) => m.key[0]).sort()).toEqual([...chosen].sort());
    expect(r.row_members.some((m) => m.key[0] === STAT_OTHER_KEY)).toBe(false);
  });
  it("'그 외' 값은 접힌 기관들의 원 신고를 다시 집계한 값이다(건수·비율·금액·기간 — 평균의 평균이 아님, 행 합계·전체 합계는 자르기 전과 같음)", () => {
    const quarterScope: Scope = { date_basis: 'completed_date', start: '2016-01-01', end: '2025-12-31', category: 'all', region_code: null, agency_key: null, manager_key: null, bbox: null, law: null };
    const filler = Array.from({ length: 124 }, (_, i) => Array.from({ length: 10 }, () =>
      f({ agency_key: `a1:filler${i}`, agency_name: `필러${i}`, completed_date: '2020-06-15', report_date: '2020-06-01' }))).flat();
    const dated = (reportDate: string, completedDate: string, patch: Partial<PrivateFact>) => f({ report_date: reportDate, completed_date: completedDate, ...patch });
    const x = [dated('2020-01-01', '2020-01-06', { agency_key: 'a1:x', agency_name: '포커스X', status: 'accepted', disposition: 'fine',
      amount_kind: 'fine', amount_confirmed_won: 40000, amount_public: true, amount_stated: true })];
    const y = [
      dated('2020-01-01', '2020-01-11', { agency_key: 'a1:y', agency_name: '포커스Y', status: 'accepted', disposition: 'fine',
        amount_kind: 'fine', amount_confirmed_won: 50000, amount_public: true, amount_stated: true }),
      dated('2020-01-01', '2020-01-11', { agency_key: 'a1:y', agency_name: '포커스Y', status: 'rejected', disposition: 'none' }),
    ];
    const z = Array.from({ length: 3 }, () => dated('2020-01-01', '2020-01-21', { agency_key: 'a1:z', agency_name: '포커스Z', status: 'rejected', disposition: 'none' }));
    const w = [
      dated('2020-01-01', '2020-01-16', { agency_key: 'a1:w', agency_name: '포커스W', status: 'accepted', disposition: 'fine',
        amount_kind: 'fine', amount_confirmed_won: 60000, amount_public: true, amount_stated: true }),
      dated('2020-01-01', '2020-01-16', { agency_key: 'a1:w', agency_name: '포커스W', status: 'accepted', disposition: 'fine',
        amount_kind: 'fine', amount_confirmed_won: 70000, amount_public: true, amount_stated: true }),
    ];
    const facts = [...filler, ...x, ...y, ...z, ...w]; // folded counts 1,2,3,2 — all strictly below filler's 10, so exactly these 4 fold
    const r = aggregateStatistics({ facts, scope: quarterScope, spec: spec({ rows: ['agency'], columns: ['completed_quarter'],
      metrics: ['completed_count', 'accept_rate', 'amount_sum', 'amount_mean', 'amount_median', 'duration_mean', 'duration_median'] }), datasetVersion: 'v' });
    expect(r.col_members).toHaveLength(40); // 10년 × 4분기, 날짜 축은 자르지 않음
    expect(r.truncated).toEqual([{ role: 'row', dimensions: ['agency'], total_members: 128, shown_members: 124, other_count: 4 }]);
    const other = r.row_totals.find((t) => t.key[0] === STAT_OTHER_KEY)!.values;
    expect(other.completed_count.value).toBe(8); // 1(X) + 2(Y) + 3(Z) + 2(W), never an average of the 4 folded agencies
    // accepted 4 of known 8 (X:1, Y:1, W:2) → 50%; a naive average of each agency's OWN rate (100,50,0,100) would be 62.5%
    expect(other.accept_rate.value).toBeCloseTo(50, 6);
    expect(other.amount_sum).toMatchObject({ value: 220000, numerator: null, denominator: 4 }); // 40000+50000+60000+70000, only the 4 confirmed fines
    expect(other.amount_mean.value).toBeCloseTo(55000, 6);
    expect(other.amount_median.value).toBe(55000);
    expect(other.duration_mean.value).toBeCloseTo(115 / 8, 6); // 5,10,10,15,15,20,20,20
    expect(other.duration_median.value).toBe(15);
    expect(r.row_totals.find((t) => t.key[0] === 'a1:filler0')!.values.completed_count.value).toBe(10); // a kept row's total is unchanged
    expect(r.grand_totals[0].values.completed_count.value).toBe(facts.length); // grand total is unchanged
  });
  it('날짜 축 두 개만으로도 예산을 넘으면 자르지 않고 분명히 거절한다(기간을 줄여 주세요)', () => {
    const long: Scope = { ...scope, start: '2014-09-30', end: '2026-09-29' };
    const facts = [f({ completed_date: '2015-01-02' }), f({ completed_date: '2026-09-01' })];
    expect(() => aggregateStatistics({ facts, scope: long, spec: spec({ rows: ['completed_day'], columns: ['completed_month'] }), datasetVersion: 'v' }))
      .toThrow(/기간을 줄여 주세요/);
  });
  it('예산 안에서는 전과 똑같다(자르지 않음)', () => {
    const r = run(G, { rows: ['outcome'], columns: ['disposition'], metrics: ['completed_count'] });
    expect(r.truncated).toBeUndefined();
    expect(r.row_members.some((m) => m.key[0] === STAT_OTHER_KEY)).toBe(false);
  });
});

describe('D23 행 쪽(row paging, 2026-10-12): 그 외로 묶지 않고 쪽 단위로 전부 내보낸다', () => {
  // 100 agencies (agency i has 100-i facts, strictly decreasing — no count ties) × 80 위반법규 열 = 8,000칸,
  // 5,000칸 예산을 넘는다. agency 0 혼자 100건이라 0..79 모든 법규가 적어도 한 번은 나와서 열은 전부 보존된다.
  const AGENCIES = 100, LAWS = 80;
  const wide = Array.from({ length: AGENCIES }, (_, i) => Array.from({ length: AGENCIES - i }, (_, k) =>
    f({ agency_key: `a1:${i}`, agency_name: `기관${i}`, violation_law: `LAW${k % LAWS}` }))).flat();
  const wideSpec: Partial<StatisticsSpec> = { rows: ['agency'], columns: ['law'], metrics: ['completed_count'] };

  it('첫 쪽: 전체 열·행/열/전체 합계는 그대로, 칸은 첫 쪽 행만 — floor(5000/80)=62', () => {
    const r = run(wide, wideSpec, undefined, { cursor: 0 });
    expect(r.truncated).toBeUndefined(); // D22 fold는 쪽 요청에서 절대 돌지 않는다
    expect(r.col_members).toHaveLength(LAWS); // 열은 절대 쪽으로 나누지 않는다
    expect(r.col_totals).toHaveLength(LAWS);
    expect(r.row_page).toEqual({ offset: 0, limit: 62, total: AGENCIES, has_more: true });
    expect(r.row_members).toHaveLength(62);
    // 기본 순서(건수 많은 순)는 그대로 — 동률이 없으므로 agency 0(100건)부터 agency 61(39건)까지
    expect(r.row_members.map((m) => m.key[0])).toEqual(Array.from({ length: 62 }, (_, i) => `a1:${i}`));
    expect(r.row_totals.find((t) => t.key[0] === 'a1:0')!.values.completed_count.value).toBe(100);
    expect(r.col_totals.reduce((a, t) => a + (t.values.completed_count.value ?? 0), 0)).toBe(wide.length);
    expect(r.grand_totals[0].values.completed_count.value).toBe(wide.length);
  });

  it('다음 쪽: 이어지는 행만, 겹치거나 빠지는 행 없이 전체를 덮고 칸 합도 전체와 같다', () => {
    const p1 = run(wide, wideSpec, undefined, { cursor: 0 });
    const p2 = run(wide, wideSpec, undefined, { cursor: p1.row_page!.offset + p1.row_page!.limit });
    expect(p2.row_page).toEqual({ offset: 62, limit: 62, total: AGENCIES, has_more: false });
    expect(p2.row_members).toHaveLength(38); // 100 - 62
    const seen = [...p1.row_members, ...p2.row_members].map((m) => m.key[0]);
    expect(new Set(seen).size).toBe(AGENCIES); // 중복 없음
    expect(seen.slice().sort()).toEqual(Array.from({ length: AGENCIES }, (_, i) => `a1:${i}`).sort()); // 빠짐 없음
    // 같은 스냅숏의 모든 쪽은 같은 열 머리·열 합계·전체 합계를 돌려준다
    expect(p2.col_members).toEqual(p1.col_members);
    expect(p2.col_totals).toEqual(p1.col_totals);
    expect(p2.grand_totals).toEqual(p1.grand_totals);
    // 쪽 합 = 전체(칸 값의 합)
    const sum = [...p1.cells, ...p2.cells].reduce((a, c) => a + (c.values.completed_count.value ?? 0), 0);
    expect(sum).toBe(wide.length);
  });

  it('행 수를 넘겨 요청하면 빈 쪽(행 0개)을 돌려준다(오류 아님)', () => {
    const r = run(wide, wideSpec, undefined, { cursor: AGENCIES + 10 });
    expect(r.row_page).toEqual({ offset: AGENCIES, limit: 62, total: AGENCIES, has_more: false });
    expect(r.row_members).toHaveLength(0);
    expect(r.cells).toHaveLength(0);
  });

  it('서버 정렬: sort_metric·sort_dir로 전체 행을 다시 정렬한 뒤 쪽을 나눈다(null은 항상 마지막)', () => {
    const asc = run(wide, wideSpec, undefined, { cursor: 0, sortMetric: 'completed_count', sortDir: 'asc' });
    expect(asc.row_members[0].key).toEqual(['a1:99']); // 가장 적은 건수(1건)부터
    expect(asc.row_members.at(-1)!.key).toEqual(['a1:38']); // 62번째로 적은 건수(62건) = agency 38
    const desc = run(wide, wideSpec, undefined, { cursor: 0, sortMetric: 'completed_count', sortDir: 'desc' });
    expect(desc.row_members[0].key).toEqual(['a1:0']); // 기본 순서(건수 많은 순)와 같다
  });

  it('sort_metric이 spec.metrics에 없으면 거절한다', () => {
    expect(() => run(wide, wideSpec, undefined, { cursor: 0, sortMetric: 'accept_rate' })).toThrow(StatsQueryError);
  });

  it('비교(×2): 칸 예산이 반으로 줄어 쪽 크기도 절반 — floor(5000/(80*2))=31', () => {
    const mineFacts = wide.map((x) => ({ ...x, contributor_id: 'u-page' }));
    const r = run(mineFacts, { ...wideSpec, population: 'compare' }, 'u-page', { cursor: 0 });
    expect(r.row_page).toEqual({ offset: 0, limit: 31, total: AGENCIES, has_more: true });
  });

  it('열이 너무 많아 한 행도 담지 못하면(극단) 거절한다 — 열 쪽 나눔은 하지 않고 줄이라고 안내', () => {
    const manyLaws = Array.from({ length: 5001 }, (_, j) => f({ agency_key: 'a1:solo', agency_name: '기관', violation_law: `LAW${j}` }));
    expect(() => run(manyLaws, { rows: ['agency'], columns: ['law'] }, undefined, { cursor: 0 }))
      .toThrow(/열 항목이나 비교 대상을 줄여/);
  });

  it('예산 안이면 요청해도 쪽은 하나뿐(행 전부, has_more:false)이고 자르지 않는다', () => {
    const r = run(G, { rows: ['outcome'], columns: ['disposition'] }, undefined, { cursor: 0 });
    expect(r.row_page!.offset).toBe(0);
    expect(r.row_page!.has_more).toBe(false);
    expect(r.row_page!.total).toBe(r.row_members.length);
    expect(r.row_page!.limit).toBe(Math.max(1, Math.floor(5000 / r.col_members.length)));
    expect(r.truncated).toBeUndefined();
  });

  it('row_cursor 없이 요청하면(구 클라이언트) row_page 없이 기존 top-N 응답 그대로', () => {
    const r = run(wide, wideSpec); // rowPage 생략
    expect(r.row_page).toBeUndefined();
    expect(r.truncated).toBeDefined();
  });

  describe('parseRowPage (요청 파라미터 검증)', () => {
    const s = spec({ metrics: ['completed_count', 'accept_rate'] });
    it('row_cursor 없으면 undefined(페이징 미사용 = 구 클라이언트)', () => {
      expect(parseRowPage(new URLSearchParams(), s)).toBeUndefined();
    });
    it('정상 요청', () => {
      expect(parseRowPage(new URLSearchParams('row_cursor=10&sort_metric=accept_rate&sort_dir=asc'), s))
        .toEqual({ cursor: 10, sortMetric: 'accept_rate', sortDir: 'asc' });
      expect(parseRowPage(new URLSearchParams('row_cursor=0'), s)).toEqual({ cursor: 0, sortMetric: null, sortDir: 'desc' });
    });
    it('잘못된 값은 거절(음수·소수·문자, 목록에 없는 지표, 모르는 방향, sort_metric 없이 sort_dir만)', () => {
      for (const qs of ['row_cursor=-1', 'row_cursor=abc', 'row_cursor=1.5', 'row_cursor=0&sort_metric=no_such_metric',
        'row_cursor=0&sort_dir=sideways', 'row_cursor=0&sort_dir=asc']) {
        expect(() => parseRowPage(new URLSearchParams(qs), s)).toThrow(StatsQueryError);
      }
    });
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
    const ok = await handler(viewerRequest(q('statistics/query', { date_basis: 'completed_date' as const, start: '2026-01-01', end: '2026-06-30', category: 'all', spec: JSON.stringify(spec({ metrics: ['fine_rate'] })) })));
    expect(ok.status).toBe(200);
    expect((await ok.json()).grand_totals[0].values.fine_rate.value).toBe(40);
    const mine = await handler(viewerRequest(q('statistics/query', { date_basis: 'completed_date' as const, start: '2026-01-01', end: '2026-06-30', category: 'all', spec: JSON.stringify(spec({ population: 'mine' })) })));
    expect(mine.status).toBe(400);
    const extra = await handler(viewerRequest(q('statistics/query', { date_basis: 'completed_date' as const, start: '2026-01-01', end: '2026-06-30', category: 'all', spec: JSON.stringify(spec()), user_id: 'u2' })));
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
    const r = await handler(viewerRequest(q('statistics/candidates', { date_basis: 'completed_date' as const, start: '2026-01-01', end: '2026-06-30', category: 'all', kind: 'agency', q: '기관', limit: '5' })));
    expect(r.status).toBe(200);
    expect((await r.json()).items[0]).toMatchObject({ key: 'a1:A', count: 20 });
  });
  it('D23 row_cursor/sort_metric/sort_dir reach aggregateStatistics end to end; candidates/query without row_cursor stay legacy', async () => {
    const base_q = { date_basis: 'completed_date' as const, start: '2026-01-01', end: '2026-06-30', category: 'all' };
    const paged = await handler(viewerRequest(q('statistics/query', { ...base_q, spec: JSON.stringify(spec({ rows: ['agency'], metrics: ['completed_count'] })), row_cursor: '0' })));
    expect(paged.status).toBe(200);
    const pagedBody = await paged.json();
    expect(pagedBody.row_page).toEqual({ offset: 0, limit: expect.any(Number), total: 1, has_more: false });
    expect(pagedBody.truncated).toBeUndefined();
    const sorted = await handler(viewerRequest(q('statistics/query', { ...base_q,
      spec: JSON.stringify(spec({ rows: ['agency'], metrics: ['completed_count'] })), row_cursor: '0', sort_metric: 'completed_count', sort_dir: 'asc' })));
    expect(sorted.status).toBe(200);
    const legacy = await handler(viewerRequest(q('statistics/query', { ...base_q, spec: JSON.stringify(spec({ rows: ['agency'], metrics: ['completed_count'] })) })));
    expect((await legacy.json()).row_page).toBeUndefined();
    // D23 params belong to statistics/query only
    const onCandidates = await handler(viewerRequest(q('statistics/candidates', { ...base_q, kind: 'agency', row_cursor: '0' })));
    expect(onCandidates.status).toBe(400);
    // sort_dir without sort_metric is refused (same as any other bad spec)
    const badSortDir = await handler(viewerRequest(q('statistics/query', { ...base_q, spec: JSON.stringify(spec({ rows: ['agency'] })), row_cursor: '0', sort_dir: 'asc' })));
    expect(badSortDir.status).toBe(400);
  });
});

describe('C05 / MS-10: 0건 vs 확인할 수 없음', () => {
  const people = [
    f({ agency_key: 'a1:A', category: 'traffic' }),
    f({ agency_key: 'a1:B', agency_name: '기관B', category: 'parking' }),
    // only in another account's own rows and not representative (e.g. a shared identity elected elsewhere)
    f({ agency_key: 'a1:HIDDEN', agency_name: '비공개기관', is_representative: false, contributor_id: 'other' }),
  ];
  const trafficScope: Scope = { ...scope, category: 'traffic' };
  it('a member excluded only by the other conditions is "zero"; an unknown / not-permitted key is "unconfirmed" without a label', () => {
    const r = aggregateStatistics({ facts: people, scope: trafficScope, datasetVersion: 'v',
      spec: spec({ rows: ['agency'], filters: [{ dimension: 'agency', members: ['a1:A', 'a1:B', 'a1:HIDDEN', 'a1:made-up'] }] }) });
    const st = Object.fromEntries(r.filter_members.map((m) => [m.key, [m.status, m.count, m.label]]));
    expect(st['a1:A']).toEqual(['ok', 1, '기관A']);
    expect(st['a1:B']).toEqual(['zero', 0, '기관B']); // exists this period, the 교통위반 condition excludes it
    expect(st['a1:HIDDEN']).toEqual(['unconfirmed', 0, null]); // not in the permitted (representative) data: no name, no reason
    expect(st['a1:made-up']).toEqual(['unconfirmed', 0, null]);
    // unconfirmed keys are never turned into "all": the result stays limited to the confirmed selection
    expect(r.row_members.map((m) => m.key[0])).toEqual(['a1:A']);
  });
  it('candidates report the same three states for already-selected keys', () => {
    const page = statisticsCandidates({ facts: people, scope: trafficScope, datasetVersion: 'v', kind: 'agency', q: '', cursor: 0, limit: 10,
      filters: [], basis: 'completed_date', placeKey: null, keys: ['a1:A', 'a1:B', 'a1:HIDDEN'] });
    expect(page.selected.map((s) => [s.key, s.status])).toEqual([['a1:A', 'ok'], ['a1:B', 'zero'], ['a1:HIDDEN', 'unconfirmed']]);
    expect(page.selected.find((s) => s.key === 'a1:HIDDEN')!.label).toBe('');
  });
  it("another account's key saved in this browser is unconfirmed for a viewer whose permitted data lacks it (mine)", () => {
    const r = aggregateStatistics({ facts: [f({ contributor_id: 'u1', agency_key: 'a1:MINE' }), f({ contributor_id: 'u2', agency_key: 'a1:THEIRS' })], scope,
      datasetVersion: 'v', viewerId: 'u1', spec: spec({ population: 'mine', filters: [{ dimension: 'agency', members: ['a1:MINE', 'a1:THEIRS'] }] }) });
    expect(r.filter_members.map((m) => m.status)).toEqual(['ok', 'unconfirmed']);
  });
});

describe('observation-v5 5분류 분류 축 (traffic·parking·safety·living·other)', () => {
  it('breaks the 신고 분류 row down into all 5 members, in their natural order and with 안전신고/생활불편 labels', () => {
    const facts = [
      ...Array.from({ length: 4 }, () => f({ category: 'traffic' })),
      ...Array.from({ length: 3 }, () => f({ category: 'parking' })),
      ...Array.from({ length: 2 }, () => f({ category: 'safety' })),
      f({ category: 'living' }),
      f({ category: 'other' }),
    ];
    const r = run(facts, { rows: ['category'], metrics: ['completed_count'] });
    expect(r.row_members).toEqual([
      { key: ['traffic'], label: ['교통위반'] }, { key: ['parking'], label: ['주정차'] },
      { key: ['safety'], label: ['안전신고'] }, { key: ['living'], label: ['생활불편'] }, { key: ['other'], label: ['기타'] },
    ]);
    expect(cell(r, ['traffic'])!.values.completed_count.value).toBe(4);
    expect(cell(r, ['parking'])!.values.completed_count.value).toBe(3);
    expect(cell(r, ['safety'])!.values.completed_count.value).toBe(2);
    expect(cell(r, ['living'])!.values.completed_count.value).toBe(1);
    expect(cell(r, ['other'])!.values.completed_count.value).toBe(1);
    expect(r.grand_totals[0].values.completed_count.value).toBe(11);
  });
  it('the category dimension of the catalog lists all 5 members as natural order', () => {
    const dim = statisticsCatalog().dimensions.find((d) => d.id === 'category')!;
    expect(dim.order).toBe('natural');
  });
});
