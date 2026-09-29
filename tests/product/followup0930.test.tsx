import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { aggregateDashboard, regionRows, selectScope, type PrivateFact } from '../../server/aggregate';
import { lawHeatmap, ratingDistribution, HEATMAP_MAX_LAWS } from '../../server/analyticsDistributions';
import { aggregateCompare } from '../../server/compare';
import { createPublicHandler, parseScope, type AnalyticsRepository } from '../../server/publicHandler';
import { presetRange, validateRange } from '../../src/state/filters';
import { entityRates, duplicateNames, entityLabel } from '../../src/components/entityMetrics';
import { placeChartSegments } from '../../src/components/PlaceEntityChart';
import { ratingLines } from '../../src/components/AnalyticsCharts';
import { boundaryLevelFor, outOfScopeCodes, renderModeOf } from '../../src/components/MapPanel';
import EntityTable from '../../src/components/EntityTable';
import LawTable from '../../src/components/LawTable';
import { LAW_NONE, type PublicEntity, type PublicLaw, type Scope } from '../../src/domain/public';
import { fixtureAccess, viewerRequest } from './helpers/mapViewer';

/** 2026-09-30 dashboard follow-up R1–R7 (docs/implementation/dashboard-redesign/FOLLOWUP-0930.md). Synthetic data only. */
let n = 0;
const f = (patch: Partial<PrivateFact> = {}): PrivateFact => {
  n += 1;
  return {
    fact_identity: `fu-${n}`, contributor_id: `fu-user-${n % 3}`, snapshot_id: 's', snapshot_generation: 1,
    report_date: '2026-09-02', completed_date: '2026-09-10', category: 'traffic', status: 'accepted', disposition: 'none',
    vehicle_raw: null, point_key: null, lat: 37.5, lng: 127.0, address: '서울특별시 중구 세종대로 110',
    region_code: '서울 중구', agency_key: 'a1:x', agency_name: '예시 기관', manager_key: 'm1:x', manager_name: '김하늘', ...patch,
  };
};
const scope = (start: string, end: string): Scope => ({ start, end, category: 'all', region_code: null, agency_key: null, manager_key: null, bbox: null, law: null });
const opts = { datasetVersion: 'fu', sourceUpdatedAt: null, generatedAt: '2026-09-30T00:00:00Z', asOf: '2026-09-29', sample: false };
const addDays = (d: string, k: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + k); return x.toISOString().slice(0, 10); };

describe('R1 long periods', () => {
  // 12 years of synthetic history: one answered report per quarter since 2014-10
  const history = Array.from({ length: 48 }, (_, i) => f({ report_date: addDays('2014-10-01', i * 91), completed_date: addDays('2014-10-01', i * 91 + 10) }));
  it('the API accepts 1826, 1827 days, >5 years and a 12-year range (the old 1826-day cap is gone)', () => {
    const state = { data_min: '2014-10-01', data_max: '2026-09-29' };
    const q = (start: string, end: string) => parseScope(new URLSearchParams({ start, end, category: 'all' }), state);
    expect(q('2021-01-01', addDays('2021-01-01', 1826)).end).toBe(addDays('2021-01-01', 1826));
    expect(q('2021-01-01', addDays('2021-01-01', 1827)).end).toBe(addDays('2021-01-01', 1827));
    expect(q('2014-09-30', '2026-09-29').start).toBe('2014-09-30');
    expect(() => q('2026-09-29', '2014-09-30')).toThrow();
  });
  it('aggregates the whole 12-year history; the missing comparison window is "no data", not a failure', () => {
    const data = aggregateDashboard(history, scope('2014-09-30', '2026-09-29'), { ...opts, dataMin: '2014-10-01' });
    expect(data.overview.report_count.value).toBe(48);
    expect(data.overview.completed_count.value).toBe(48);
    expect(data.overview.report_count.previous).toBeNull();
    expect(data.overview.report_count.delta).toBeNull();
    expect(data.overview.report_count.delta_percent).toBeNull();
    expect(data.overview.accepted_including_partial.delta).toBeNull();
    expect(selectScope(history, scope('2014-09-30', '2026-09-29')).done).toHaveLength(48);
  });
  it('the handler returns 200 for 2014-09-30..2026-09-29 and RESULT_TOO_LARGE (422) for an over-budget repository', async () => {
    const state = { dataset_version: 'fu', ready: true, source_updated_at: null, generated_at: '2026-09-30T00:00:00Z', published_at: null,
      data_min: '2014-10-01', data_max: '2026-09-29', coverage_note: '', dedupe_policy_version: 'x' };
    const repo: AnalyticsRepository = { getState: async () => state, getFacts: async () => history, allowRequest: async () => true };
    const url = 'https://api.example.invalid/public-analytics/dashboard?start=2014-09-30&end=2026-09-29&category=all';
    const ok = await createPublicHandler(repo, fixtureAccess())(viewerRequest(url));
    expect(ok.status).toBe(200);
    const big = await createPublicHandler({ ...repo, getFacts: async () => { throw new Error('RESULT_TOO_LARGE'); } }, fixtureAccess())(viewerRequest(url));
    expect(big.status).toBe(422);
    expect((await big.json()).error.code).toBe('RESULT_TOO_LARGE');
  });
  it('client validation: real dates, leap years, order, future; a start before the first report is allowed', () => {
    expect(validateRange('2024-02-29', '2024-03-01', '2014-10-01', '2026-09-29')).toBeNull();
    expect(validateRange('2025-02-29', '2025-03-01', null, null)).toMatch(/실제 날짜/);
    expect(validateRange('2026-0', '2026-03-01', null, null)).toMatch(/실제 날짜/);
    expect(validateRange('2026-03-02', '2026-03-01', null, null)).toMatch(/늦을 수 없습니다/);
    expect(validateRange('2026-01-01', '2999-01-01', null, null)).toMatch(/오늘 이후/);
    expect(validateRange('2000-01-01', '2026-09-29', '2014-10-01', '2026-09-29')).toBeNull();
    expect(validateRange('2000-01-01', '2001-01-01', '2014-10-01', '2026-09-29')).toMatch(/자료가 없습니다/);
  });
  it('전체 기간 = the dataset bounds, and nothing (not a fixed year) while they are unknown', () => {
    expect(presetRange(null, '2014-10-01', '2026-09-28')).toEqual({ start: '2014-10-01', end: '2026-09-28' });
    expect(presetRange(null, null, null)).toBeNull();
    expect(presetRange(null, '2014-10-01', null)).toBeNull();
  });
});

describe('R2/R3 manager metrics and chart denominators', () => {
  // C=20, A=12, P=3, R=3, unknown=2, F=8, W=5
  const e: PublicEntity = { key: 'm', agency_key: 'a', manager_key: 'm', agency_name: '갑 경찰서', manager_name: '김하늘',
    completed_count: 20, outcomes: { accepted: 12, partial: 3, rejected: 3, result_known: 18, result_unknown: 2 }, fine_count: 8, warning_count: 5 };
  it('rates follow the common definitions', () => {
    const m = entityRates(e);
    expect(m.accept!.toFixed(1)).toBe('66.7');
    expect(m.partial!.toFixed(1)).toBe('16.7');
    expect(m.reject!.toFixed(1)).toBe('16.7');
    expect(m.fineRate!.toFixed(1)).toBe('40.0');
    expect(m.warnRate!.toFixed(1)).toBe('25.0');
    expect(m.U).toBe(2);
  });
  it('수용률 bars use K=18, 과태료 bars use C=20, the count line is 20 in both modes', () => {
    const a = placeChartSegments(e, 'accept'), fi = placeChartSegments(e, 'fine');
    expect(a.denominator).toBe(18);
    expect(fi.denominator).toBe(20);
    expect([a.count, fi.count]).toEqual([20, 20]);
    expect(a.segments!.map(s => s.n)).toEqual([12, 3, 3]);
    expect(fi.segments!.map(s => s.n)).toEqual([8, 12]);
    expect(fi.segments!.reduce((x, s) => x + s.value, 0)).toBeCloseTo(100);
  });
  it('K=0 draws no fake 100% bar; unknown fine/warning stay null (—), never 0', () => {
    const onlyUnknown = { ...e, completed_count: 3, outcomes: { accepted: 0, partial: 0, rejected: 0, result_known: 0, result_unknown: 3 }, fine_count: null, warning_count: undefined };
    expect(placeChartSegments(onlyUnknown, 'accept').segments).toBeNull();
    expect(placeChartSegments(onlyUnknown, 'fine').segments).toBeNull();
    expect(placeChartSegments(onlyUnknown, 'accept').count).toBe(3);
    const m = entityRates(onlyUnknown);
    expect([m.accept, m.F, m.W, m.fineRate, m.warnRate]).toEqual([null, null, null, null, null]);
  });
  it('same names are told apart by agency', () => {
    const rows = [{ ...e }, { ...e, key: 'm2', agency_name: '을 구청' }, { ...e, key: 'm3', manager_name: '박도윤' }];
    const dup = duplicateNames(rows);
    expect(entityLabel(rows[0], 'manager', dup.has('김하늘'))).toBe('김하늘 (갑 경찰서)');
    expect(entityLabel(rows[2], 'manager', dup.has('박도윤'))).toBe('박도윤');
  });
});

describe('R4 heatmap without 법규 미상', () => {
  it('the most frequent unknown law takes no top slot, unknown-only rows are not listed, totals elsewhere unchanged', () => {
    const facts = [
      ...Array.from({ length: 30 }, () => f({ agency_key: 'a1:u', agency_name: '미상만 기관', violation_law: null })),
      ...Array.from({ length: HEATMAP_MAX_LAWS }, (_, i) => f({ agency_key: 'a1:k', agency_name: '법규 기관', violation_law: `도로교통법 제${i + 1}조` })),
    ];
    const h = lawHeatmap(facts, false);
    expect(h.laws.some(l => l.law_key === LAW_NONE)).toBe(false);
    expect(h.laws).toHaveLength(HEATMAP_MAX_LAWS); // no slot wasted
    expect(h.rows.map(r => r.key)).toEqual(['a1:k']);
    expect(h.total_laws).toBe(HEATMAP_MAX_LAWS);
    const data = aggregateDashboard(facts, scope('2026-09-01', '2026-09-30'), opts);
    expect(data.overview.completed_count.value).toBe(30 + HEATMAP_MAX_LAWS);
    expect(data.laws!.some(l => l.law === null)).toBe(true); // the 현황 table keeps 법규 미상
    expect(lawHeatmap(facts.slice(0, 30), false).rows).toHaveLength(0);
  });
});

describe('R5 ratings: fine row and paired mine rows', () => {
  const people = [
    f({ contributor_id: 'u1', status: 'accepted', disposition: 'fine', rating: 5 }),
    f({ contributor_id: 'u1', status: 'rejected', disposition: 'none', rating: 1 }),
    f({ contributor_id: 'u2', status: 'accepted', disposition: 'fine', rating: 3 }),
    f({ contributor_id: 'u2', status: 'partial', disposition: 'warning', rating: 4 }),
    f({ contributor_id: 'u2', status: 'accepted', disposition: 'none', rating: null }),
  ];
  it('a fine + accepted report is in both the 수용 and the 과태료 처분 rows; each row sums to its rating count', () => {
    const r = ratingDistribution(people);
    const row = (k: string) => r.rows.find(x => x.status === k)!;
    expect(row('accepted')).toMatchObject({ counts: [0, 0, 1, 0, 1], rating_count: 2 });
    expect(row('fine')).toMatchObject({ counts: [0, 0, 1, 0, 1], rating_count: 2, mean: 4 });
    for (const x of r.rows) expect(x.counts.reduce((a, b) => a + b, 0)).toBe(x.rating_count);
    expect(r.unrated).toBe(1);
  });
  it('mine rows are computed for the viewer (two accounts differ), paired by key, never copied from all', () => {
    const cmp = (id: string) => aggregateCompare(people, scope('2026-09-01', '2026-09-30'), id,
      { datasetVersion: 'v', asOf: '2026-09-29', dataMin: null, viewer: { contributor: 'active', has_public_facts: true } });
    const u1 = cmp('u1').analytics!.rating, u2 = cmp('u2').analytics!.rating;
    const all = ratingDistribution(people);
    expect(u1.rows.find(x => x.status === 'fine')).toMatchObject({ counts: [0, 0, 0, 0, 1] });
    expect(u2.rows.find(x => x.status === 'fine')).toMatchObject({ counts: [0, 0, 1, 0, 0] });
    const lines = ratingLines(all, u1, 'ready');
    expect(lines.map(l => `${l.key}:${l.side}`)).toEqual(['all:all', 'all:mine', 'accepted:all', 'accepted:mine', 'partial:all', 'partial:mine',
      'rejected:all', 'rejected:mine', 'fine:all', 'fine:mine', 'unknown:all', 'unknown:mine']);
    expect(lines.find(l => l.key === 'rejected' && l.side === 'mine')!.row).toMatchObject({ counts: [1, 0, 0, 0, 0] });
    expect(ratingLines(all, null, 'off')).toHaveLength(6);
    expect(ratingLines(all, null, 'loading').filter(l => l.side === 'mine').every(l => l.row === null && l.note === '불러오는 중')).toBe(true);
    // an older server without the fine row: matched by key, shown as unsupported — never an invented 0
    const old = { ...all, rows: all.rows.filter(x => x.status !== 'fine') };
    const oldLine = ratingLines(old, null, 'off').find(l => l.key === 'fine')!;
    expect(oldLine.row).toBeNull();
    expect(oldLine.note).toBe('서버 미지원');
  });
});

describe('R6 no special look for a count of 1', () => {
  const ent = (c: number): PublicEntity => ({ key: `e${c}`, agency_key: `a${c}`, manager_key: null, agency_name: `기관${c}`, manager_name: null,
    completed_count: c, outcomes: { accepted: c, partial: 0, rejected: 0, result_known: c, result_unknown: 0 }, fine_count: 0 });
  it('0/1/2/10 render with the same markup in the entity and law tables', () => {
    const table = renderToStaticMarkup(<EntityTable agencies={[0, 1, 2, 10].map(ent)} managers={[]} tab="agency" onTab={() => {}} onPick={() => {}}
      scope={scope('2026-09-01', '2026-09-30')} version="v" serverList={false} activeAgency={null} activeManager={null} />);
    expect(table).not.toContain('sample-one');
    expect(table).toContain('답변(건)');
    const cells = [...table.matchAll(/<td class="num">(\d+)<\/td>/g)].map(m => m[1]);
    expect(cells).toEqual(expect.arrayContaining(['0', '1', '2', '10']));
    const law = (c: number): PublicLaw => ({ law: `법 제${c}조`, completed_count: c, outcomes: ent(c).outcomes, accept_rate: 100, partial_rate: 0,
      fine_count: 0, fine_rate: 0, penalty_count: 0, warning_count: 0, fine_amount: { fine_count: 0, confirmed_count: 0, sum_won: null, mean_won: null } });
    const laws = renderToStaticMarkup(<LawTable laws={[10, 2, 1, 0].map(law)} activeLaw={null} onPickLaw={() => {}} />);
    expect(laws).not.toContain('sample-one');
    for (const c of [0, 1, 2, 10]) expect(laws).toContain(`<td class="num">${c}건</td>`);
  });
});

describe('R7 region map', () => {
  it('a 시도 rate is Σnumerator/Σdenominator of its 시군구 (1/1 and 9/99 → 10/100 = 10%, not the 50.5% average)', () => {
    const facts = [
      f({ region_code: '서울 종로구', lat: 37.57, lng: 126.98, status: 'accepted' }),
      ...Array.from({ length: 9 }, () => f({ region_code: '서울 강남구', lat: 37.5, lng: 127.05, status: 'accepted' })),
      ...Array.from({ length: 90 }, () => f({ region_code: '서울 강남구', lat: 37.5, lng: 127.05, status: 'rejected' })),
    ];
    const rows = regionRows([], facts);
    const sido = rows.find(r => r.level === 'sido' && r.region_code === '11')!;
    expect(sido.outcomes.accepted / sido.outcomes.result_known).toBeCloseTo(0.1);
    const a = rows.find(r => r.level === 'sgg' && r.outcomes.result_known === 1)!;
    const b = rows.find(r => r.level === 'sgg' && r.outcomes.result_known === 99)!;
    expect([a.outcomes.accepted, b.outcomes.accepted]).toEqual([1, 9]);
  });
  it('render modes, zoom levels independent of the region filter, and out-of-range codes', () => {
    expect(renderModeOf('reports')).toBe('points');
    for (const m of ['acceptance', 'rejection', 'fine'] as const) expect(renderModeOf(m)).toBe('regions');
    expect(boundaryLevelFor(13)).toBe('sido');
    expect(boundaryLevelFor(10)).toBe('sido');
    expect(boundaryLevelFor(9)).toBe('sgg');
    expect(boundaryLevelFor(5)).toBe('sgg');
    const feats = [{ code: '11', sido: '11' }, { code: '26', sido: '26' }].map(x => ({ ...x, polygons: [], bbox: [0, 0, 1, 1] as [number, number, number, number] }));
    expect([...outOfScopeCodes(feats, 'sido', '11110')]).toEqual(['26']);
    const sgg = [{ code: '11110', sido: '11' }, { code: '11680', sido: '11' }, { code: '26110', sido: '26' }].map(x => ({ ...x, polygons: [], bbox: [0, 0, 1, 1] as [number, number, number, number] }));
    expect([...outOfScopeCodes(sgg, 'sgg', '11')]).toEqual(['26110']);
    expect([...outOfScopeCodes(sgg, 'sgg', '11110')]).toEqual(['11680', '26110']);
    expect(outOfScopeCodes(sgg, 'sgg', null).size).toBe(0);
  });
});
