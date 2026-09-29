/**
 * date-basis-dashboard handler contract: date_basis parameter, one-basis unification with 맞춤 통계 (EX-08),
 * cohort_policy_version echo (EX-09), the focus overview of an address (U02), server-side count/rate sorting over
 * the FULL list before paging (U03, SO-02/SO-07), and previous-window reads only where a comparison is shown (D14).
 * Handler-level (Node) checks with synthetic facts — not an Edge Runtime, SQL or browser pass.
 */
import { describe, expect, it } from 'vitest';
import { createPublicHandler, type AnalyticsRepository, type AnalyticsState, type FactsOptions } from '../../server/publicHandler';
import type { PrivateFact } from '../../server/aggregate';
import { placeKey } from '../../server/places';
import { entitiesResponseSchema, lawsResponseSchema, placeDetailResponseSchema } from '../../src/data/schema';
import { ORACLE, oracleDemoFacts } from '../../src/data/demoOracle';
import type { Scope } from '../../src/domain/public';
import { fixtureAccess, viewerRequest } from './helpers/mapViewer';

const state: AnalyticsState = {
  dataset_version: 'db-v1', ready: true, source_updated_at: null, generated_at: '2025-09-29T00:00:00Z', published_at: null,
  data_min: '2025-04-01', data_max: '2025-09-12', coverage_note: 'test', dedupe_policy_version: 'test',
  basis_bounds: { report_date: { min: '2025-04-01', max: '2025-08-25' }, completed_date: { min: '2025-06-10', max: '2025-09-12' } },
};
function setup(facts: PrivateFact[]) {
  const calls: Array<{ scope: Scope; options?: FactsOptions }> = [];
  const repo: AnalyticsRepository = {
    getState: async () => state, allowRequest: async () => true,
    getFacts: async (scope, options) => { calls.push({ scope, options }); return facts; },
  };
  const handler = createPublicHandler(repo, fixtureAccess());
  return { calls, get: (path: string) => handler(viewerRequest(`https://api.example.invalid/public-analytics/${path}`)) };
}
const range = `start=${ORACLE.range.start}&end=${ORACLE.range.end}&category=all`;

describe('date_basis on every route', () => {
  it('DT-01 an old link without date_basis is read as 답변일 and echoed; a bad value is refused', async () => {
    const { get } = setup(oracleDemoFacts());
    const body = await (await get(`dashboard?${range}`)).json();
    expect(body.scope.date_basis).toBe('completed_date');
    expect(body.cohort_policy_version).toBe('single-date-v1');
    expect((await get(`dashboard?${range}&date_basis=published_date`)).status).toBe(400);
  });
  it('DT-05/06 same range, two bases → two different requests and results (identities differ, counts equal)', async () => {
    const { get, calls } = setup(oracleDemoFacts());
    const a = await (await get(`dashboard?${range}&date_basis=report_date`)).json();
    const b = await (await get(`dashboard?${range}&date_basis=completed_date`)).json();
    expect([a.overview.report_count.value, b.overview.report_count.value]).toEqual([3, 3]);
    expect(a.overview.warning_count).not.toBe(b.overview.warning_count); // 2 (C,E) vs 1 (C)
    expect(calls.map((c) => c.scope.date_basis)).toEqual(['report_date', 'completed_date']);
  });
  it('DT-13 a valid period with no data is a normal 0, not an invalid query', async () => {
    const { get } = setup(oracleDemoFacts());
    const res = await get('overview?start=2010-01-01&end=2010-12-31&category=all&date_basis=report_date');
    expect(res.status).toBe(200);
    expect((await res.json()).overview.report_count.value).toBe(0);
  });
  it('D14 only the comparison routes read the previous window', async () => {
    const { get, calls } = setup(oracleDemoFacts());
    await get(`dashboard?${range}`);
    await get(`entities?${range}&kind=agency`);
    await get(`laws?${range}`);
    await get(`statistics/query?${range}&spec=${encodeURIComponent(JSON.stringify({ version: 1, date_basis: 'completed_date', population: 'all', rows: [], columns: [], metrics: ['completed_count'], filters: [], place_key: null }))}`);
    expect(calls.map((c) => c.options?.previous)).toEqual([true, false, false, false]);
  });
});

describe('EX-08 one basis per 맞춤 통계 request', () => {
  const spec = (basis: string) => encodeURIComponent(JSON.stringify({ version: 1, date_basis: basis, population: 'all', rows: ['report_month'], columns: [], metrics: ['completed_count'], filters: [], place_key: null }));
  it('a scope/spec conflict is a 400 with its own code; no scope basis → the recipe basis is kept (EX-07)', async () => {
    const { get } = setup(oracleDemoFacts());
    const conflict = await get(`statistics/query?${range}&date_basis=completed_date&spec=${spec('report_date')}`);
    expect(conflict.status).toBe(400);
    expect((await conflict.json()).error.code).toBe('BASIS_CONFLICT');
    const kept = await (await get(`statistics/query?${range}&spec=${spec('report_date')}`)).json();
    expect(kept.scope.date_basis).toBe('report_date');
    expect(kept.population_count.all).toBe(3);
  });
});

describe('U02 address focus overview', () => {
  it('KP-02/KP-03 the full overview of the address under the same scope and basis', async () => {
    const { get } = setup(oracleDemoFacts());
    const key = placeKey(oracleDemoFacts().find((f) => f.fact_identity === 'oracle:D')!)!;
    const body = placeDetailResponseSchema.parse(await (await get(`places/${encodeURIComponent(key)}?${range}&date_basis=completed_date`)).json());
    expect(body.overview.report_count.value).toBe(1);
    expect(body.overview.contributor_count.value).toBe(2);
    expect(body.overview.point_count.value).toBe(1);
    expect(body.overview.fine_count).toMatchObject({ value: 1, denominator: 1 });
    expect(body.overview.report_count.basis).toBe('completed_date');
  });
});

// SO-02/SO-07: agency A 100 answers · 20 fines (20%), B 5 · 5 (100%), plus 30 fillers that push B to page 2 by count
function sortFacts(): PrivateFact[] {
  const out: PrivateFact[] = [];
  let n = 0;
  const add = (agency: string, fine: boolean) => out.push({
    fact_identity: `s${n}`, contributor_id: `u${n++}`, snapshot_id: 's', snapshot_generation: 1, report_date: '2025-08-01', completed_date: '2025-08-02',
    category: 'parking', status: 'accepted', disposition: fine ? 'fine' : 'none', vehicle_raw: null, point_key: null, lat: null, lng: null, address: null,
    region_code: '11110', agency_key: `a1:${agency}`, agency_name: agency, manager_key: null, manager_name: null,
  });
  for (let i = 0; i < 100; i++) add('기관A', i < 20);
  for (let i = 0; i < 5; i++) add('기관B', true);
  for (let k = 0; k < 30; k++) for (let i = 0; i < 6; i++) add(`채움${String(k).padStart(2, '0')}`, i === 0);
  return out;
}

describe('U03 server-side count/rate sort over the full list', () => {
  const { get } = setup(sortFacts());
  const page = async (sort: string, value: string, dir: string, p = 1) => entitiesResponseSchema.parse(
    await (await get(`entities?${range}&kind=agency&sort=${sort}&sort_value=${value}&dir=${dir}&page=${p}&page_size=20`)).json());
  it('SO-02 fine count desc: A before B; fine rate desc: B (100%) first on page 1 though it was on page 2 by count (SO-07)', async () => {
    expect((await page('fine', 'count', 'desc')).items.map((r) => r.agency_name).slice(0, 2)).toEqual(['기관A', '기관B']);
    // by answers B (5) is the last of 32 rows → page 2
    const byAnswers = await page('completed', 'count', 'desc');
    expect(byAnswers.items[0].agency_name).toBe('기관A');
    expect(byAnswers.items.some((r) => r.agency_name === '기관B')).toBe(false);
    const byRate = await page('fine', 'rate', 'desc');
    expect(byRate.items[0].agency_name).toBe('기관B');
    expect(byRate.sort).toEqual({ column: 'fine', value: 'rate', dir: 'desc' });
    expect(byRate.total_rows).toBe(32);
  });
  it('SO-02 reverse directions; SO-09 pages never repeat or skip a row', async () => {
    expect((await page('fine', 'rate', 'asc')).items[0].agency_name).toMatch(/채움/); // 1/6 ≈ 16.7% < 20%
    const all: string[] = [];
    for (let p = 1; p <= 2; p++) all.push(...(await page('fine', 'count', 'asc', p)).items.map((r) => r.key));
    expect(new Set(all).size).toBe(32);
  });
  it('an unknown sort key or value is refused (registry allowlist, never a column name)', async () => {
    expect((await get(`entities?${range}&kind=agency&sort=fine_count;drop&dir=desc`)).status).toBe(400);
    expect((await get(`entities?${range}&kind=agency&sort=completed&sort_value=rate`)).status).toBe(400);
  });
  it('SO-06 the law list is searched and sorted on the server too', async () => {
    const { get: getLaw } = setup(oracleDemoFacts());
    const laws = lawsResponseSchema.parse(await (await getLaw(`laws?${range}&date_basis=completed_date&sort=fine&sort_value=rate&dir=desc`)).json());
    expect(laws.items.map((r) => r.law)).toEqual(['도로교통법 제32조', '도로교통법 제33조']); // G1 has D (fine) · C, G2 has B
    expect(laws.total_rows).toBe(2);
  });
});
