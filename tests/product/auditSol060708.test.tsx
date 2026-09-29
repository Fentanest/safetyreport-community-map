import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { aggregateDashboard, type PrivateFact } from '../../server/aggregate';
import { placeKeyOf } from '../../server/places';
import { createPublicHandler, type AnalyticsRepository, type AnalyticsState } from '../../server/publicHandler';
import { entitiesResponseSchema } from '../../src/data/schema';
import { loadEntities } from '../../src/data/client';
import EntityTable from '../../src/components/EntityTable';
import type { Scope } from '../../src/domain/public';
import { fixtureAccess, viewerRequest } from './helpers/mapViewer';

vi.mock('../../src/hooks/usePersonal', () => ({
  mapAuth: () => ({ settled: async () => undefined, accessToken: async () => 'test-map-session', refreshToken: async () => null }),
}));

const sept: Scope = {
  date_basis: 'completed_date' as const, start: '2026-09-01', end: '2026-09-30', category: 'all', region_code: null,
  agency_key: null, manager_key: null, bbox: null, law: null,
};
const aopts = {
  datasetVersion: 'af-map-test', sourceUpdatedAt: null,
  generatedAt: '2026-09-30T00:00:00Z', asOf: '2026-09-30', sample: false,
};

let uid = 0;
const mkFact = (patch: Partial<PrivateFact>): PrivateFact => {
  uid++;
  return {
    fact_identity: `af-${uid}`, contributor_id: `af-user-${uid}`,
    snapshot_id: 's1', snapshot_generation: 1,
    report_date: null, completed_date: null, category: 'traffic',
    status: 'accepted', disposition: 'none', vehicle_raw: null,
    point_key: null, lat: null, lng: null, address: null, region_code: '11',
    agency_key: 'agency-1', agency_name: '예시 기관',
    manager_key: 'manager-1', manager_name: '김하늘',
    ...patch,
  };
};
// R07: map places are keyed by address, so each "point" of these tests is its own address
const located = (key: string): Partial<PrivateFact> =>
  ({ point_key: key, lat: 37.5, lng: 127.0, address: `예시 지점 ${key}` });
const place = (key: string) => placeKeyOf(`예시 지점 ${key}`);

// Migrated 2026-09-29 (date-basis-dashboard §0.2 / U01): SOL-06/07 described two sets (report-date reports and
// answer-date completions) drawn together. Now ONE date of the scope selects the reports, and each drawn place
// carries the same reports for its count and its results (no report_count-0 "completion-only" place any more).
const onReport: Scope = { ...sept, date_basis: 'report_date' };
describe('SOL-06 → single cohort: places carry the same reports for counts and results', () => {
  it('an August report answered in September is IN the September answer-date set with its report counted (MP-01)', () => {
    const data = aggregateDashboard([
      mkFact({ report_date: '2026-08-10', completed_date: '2026-09-05', ...located('pt-cross') }),
    ], sept, aopts);
    expect(data.overview.report_count.value).toBe(1);
    expect(data.overview.completed_count.value).toBe(1);
    expect(data.points).toHaveLength(1);
    expect(data.points[0]).toMatchObject({ key: place('pt-cross'), report_count: 1, completed_count: 1 });
    // …and it is NOT in the September report-date set (its report date is August)
    expect(aggregateDashboard([mkFact({ report_date: '2026-08-10', completed_date: '2026-09-05', ...located('pt-cross2') })], onReport, aopts)
      .overview.report_count.value).toBe(0);
  });
  it('mixed places: each basis draws exactly its own reports', () => {
    const facts = [
      mkFact({ report_date: '2026-09-05', completed_date: '2026-09-06', ...located('pt-a') }),
      mkFact({ report_date: '2026-08-10', completed_date: '2026-09-07', ...located('pt-b') }),
      mkFact({ report_date: '2026-09-08', completed_date: null, status: 'processing', ...located('pt-c') }),
      mkFact({ report_date: '2026-09-09', completed_date: '2026-09-10' }),
    ];
    const answer = aggregateDashboard(facts, sept, aopts);
    expect([answer.overview.report_count.value, answer.overview.completed_count.value]).toEqual([3, 3]);
    expect(answer.points.map(row => [row.key, row.report_count, row.completed_count]).sort())
      .toEqual([[place('pt-a'), 1, 1], [place('pt-b'), 1, 1]].sort());
    expect(answer.overview.cohort?.selected_date_missing).toBe(1); // pt-c: no answer date, report date in range
    const report = aggregateDashboard(facts, onReport, aopts);
    expect([report.overview.report_count.value, report.overview.completed_count.value]).toEqual([3, 2]);
    expect(report.points.map(row => [row.key, row.report_count, row.completed_count]).sort())
      .toEqual([[place('pt-a'), 1, 1], [place('pt-c'), 1, 0]].sort());
    // invariant: drawn + unplaced = the cohort
    expect(report.points.reduce((n, row) => n + row.report_count, 0) + 1).toBe(3);
  });
});

describe('SOL-07 location_missing basis (the cohort only)', () => {
  it('ignores a location-less fact that belongs only to the comparison window', () => {
    const data = aggregateDashboard([
      mkFact({ report_date: '2026-08-10', completed_date: null, status: 'processing' }),
    ], onReport, aopts);
    expect(data.overview.report_count.value).toBe(0);
    expect(data.overview.completed_count.value).toBe(0);
    expect(data.meta.location_missing).toBe(0);
  });
  it('counts unique cohort facts once and excludes located ones', () => {
    const facts = [
      mkFact({ report_date: '2026-08-10', completed_date: null, status: 'processing' }), // prev only
      mkFact({ report_date: '2026-09-05', completed_date: null, status: 'processing' }), // report basis only
      mkFact({ report_date: '2026-09-05', completed_date: '2026-09-06' }), // both bases, one fact
      mkFact({ report_date: '2026-09-05', completed_date: '2026-09-06', ...located('pt-ok') }), // located
    ];
    const report = aggregateDashboard(facts, onReport, aopts);
    expect([report.overview.report_count.value, report.overview.completed_count.value, report.meta.location_missing]).toEqual([3, 2, 2]);
    const answer = aggregateDashboard(facts, sept, aopts);
    expect([answer.overview.report_count.value, answer.overview.completed_count.value, answer.meta.location_missing]).toEqual([2, 2, 1]);
  });
});

// SOL-08: 105 agencies/managers with completion counts 1..5 cycling, so the default
// completed-desc order pushes count-1 '테스트기관-100' to overall position 105 (past the top 100).
const entityFacts: PrivateFact[] = [];
for (let i = 0; i < 105; i++) {
  for (let j = 0; j < (i % 5) + 1; j++) {
    entityFacts.push(mkFact({
      fact_identity: `ef-${i}-${j}`, contributor_id: `ef-user-${i}-${j}`,
      report_date: '2026-09-05', completed_date: '2026-09-06',
      point_key: `pt-8-${i}-${j}`, lat: 33 + (i % 60) * 0.1, lng: 124 + (i % 70) * 0.1,
      agency_key: `agency-${i}`, agency_name: `테스트기관-${String(i).padStart(3, '0')}`,
      manager_key: `manager-${i}`, manager_name: `담당자-${String(i).padStart(3, '0')}`,
    }));
  }
}
const estate: AnalyticsState = {
  dataset_version: 'af-map-entities', ready: true, source_updated_at: '2026-09-30T00:00:00Z',
  generated_at: '2026-09-30T01:00:00Z', published_at: null,
  data_min: '2026-09-01', data_max: '2026-09-30', coverage_note: 'af-map test',
  dedupe_policy_version: 'test-v1',
};
const erepo: AnalyticsRepository = {
  getState: async () => estate,
  getFacts: async () => entityFacts,
  allowRequest: async () => true,
};
const ehandler = createPublicHandler(erepo, fixtureAccess());
const eq = 'start=2026-09-01&end=2026-09-30&category=all';
const get = (path: string) => ehandler(viewerRequest(`https://example.test/public-analytics/${path}`));

describe('SOL-08 full-list entities API', () => {
  it('paginates the full list and reaches past the dashboard top 100', async () => {
    const dashboard = await (await get(`dashboard?${eq}`)).json();
    expect(dashboard.agencies).toHaveLength(100);
    expect(dashboard.agencies.some((row: { agency_name: string }) => row.agency_name === '테스트기관-100')).toBe(false);
    const page3 = await (await get(`entities?${eq}&kind=agency&page=3&page_size=50`)).json();
    expect(entitiesResponseSchema.safeParse(page3).success).toBe(true);
    expect(page3.total_rows).toBe(105);
    expect(page3.items).toHaveLength(5);
    expect(page3.items.some((row: { agency_name: string }) => row.agency_name === '테스트기관-100')).toBe(true);
  });
  it('finds a beyond-100 row by server search and sorts across the whole list', async () => {
    const found = await (await get(`entities?${eq}&kind=agency&q=${encodeURIComponent('테스트기관-100')}`)).json();
    expect(found.total_rows).toBe(1);
    expect(found.items[0].agency_name).toBe('테스트기관-100');
    const asc = await (await get(`entities?${eq}&kind=agency&sort=completed&dir=asc&page_size=100`)).json();
    const counts = asc.items.map((row: { completed_count: number }) => row.completed_count);
    expect(counts[0]).toBe(1);
    expect([...counts].sort((a, b) => a - b)).toEqual(counts);
    const tail = await (await get(`entities?${eq}&kind=agency&sort=completed&dir=asc&page=2&page_size=100`)).json();
    expect(tail.items).toHaveLength(5);
    expect(tail.total_rows).toBe(105);
    expect(tail.items.every((row: { completed_count: number }) => row.completed_count === 5)).toBe(true);
  });
  it('keeps the default ordering backward compatible and rejects bad entity queries', async () => {
    const legacy = await (await get(`entities?${eq}&kind=agency&page_size=50`)).json();
    const explicit = await (await get(`entities?${eq}&kind=agency&sort=completed&dir=desc&page_size=50`)).json();
    expect(explicit.items.map((row: { key: string }) => row.key))
      .toEqual(legacy.items.map((row: { key: string }) => row.key));
    expect((await get(`entities?${eq}&kind=agency&sort=bogus`)).status).toBe(400);
    expect((await get(`entities?${eq}&kind=agency&q=${'x'.repeat(161)}`)).status).toBe(400);
    expect((await get(`dashboard?${eq}&q=x`)).status).toBe(400);
    expect((await get(`dashboard?${eq}&sort=completed`)).status).toBe(400);
  });
});

describe('SOL-08 client and table connection', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  it('loads a real handler page through loadEntities and renders it in server-mode table', async () => {
    vi.stubEnv('VITE_PUBLIC_ANALYTICS_URL', 'https://example.test');
    vi.stubGlobal('fetch', (...args: any[]) => ehandler(viewerRequest(String(args[0]))));
    const page = await loadEntities(sept,
      { kind: 'agency', q: '테스트기관-100', sort: { column: 'completed', value: 'count', dir: 'asc' }, page: 1, pageSize: 50 },
      'af-map-entities');
    expect(page.totalRows).toBe(1);
    expect(page.items[0].agency_name).toBe('테스트기관-100');
    const nav = await loadEntities(sept, { kind: 'agency', page: 2, pageSize: 100 }, 'af-map-entities');
    expect(nav.totalRows).toBe(105);
    expect(nav.items).toHaveLength(5);
    expect(nav.items.map((row) => row.agency_name)).toContain('테스트기관-100');
    // The table's summary uses the dashboard rows without a request and says it shows only part of them;
    // search/sort/page/전체 보기 switch to the full server list (R09, browser-verified).
    const all = [...nav.items, ...(await loadEntities(sept, { kind: 'agency', page: 1, pageSize: 100 }, 'af-map-entities')).items];
    const html = renderToStaticMarkup(
      <EntityTable agencies={all} managers={[]} tab="agency" onTab={() => {}} onPick={() => {}}
        scope={sept} version="af-map-entities" serverList activeAgency={null} activeManager={null} />,
    );
    expect(html).toContain('기관 105곳');
    expect(html).toContain('8곳만 표시');
    expect(html).toContain('전체 보기');
  });
});
