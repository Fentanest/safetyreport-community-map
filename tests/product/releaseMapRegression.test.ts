import { afterEach, describe, expect, it, vi } from 'vitest';
import { aggregateStatistics, parseRowPage } from '../../server/statistics';
import { createPublicHandler } from '../../server/publicHandler';
import { fixtureAccess, viewerRequest } from './helpers/mapViewer';
import { baseSpec } from '../../src/state/statistics';
import * as paging from '../../src/state/statsPaging';
import { loadStatistics, statisticsResultSchema } from '../../src/data/statistics';
import type { Scope } from '../../src/domain/public';

const transport = vi.hoisted(() => ({ read: vi.fn(), personal: vi.fn() }));
vi.mock('../../src/data/client', async (original) => ({ ...await original<object>(), read: transport.read }));
vi.mock('../../src/data/personal', () => ({ readPersonalStatistics: transport.personal }));
const scope: Scope = { date_basis: 'completed_date', start: '2026-01-01', end: '2026-06-30', category: 'all', region_code: null, agency_key: null, manager_key: null, bbox: null, law: null };
const result = (population: 'all' | 'mine' | 'compare' = 'all', version = 'v1') => aggregateStatistics({
  facts: [], scope, spec: baseSpec({ population, rows: [], columns: [], metrics: ['completed_count'] }),
  datasetVersion: version, viewerId: 'u1', rowPage: { cursor: 0 },
});
afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); });

describe('release review 2026-10-13', () => {
  for (const population of ['all', 'mine', 'compare'] as const) {
    it(`P1 ${population}: fresh query uses latest, subsequent query pins first response version`, async () => {
      vi.stubEnv('VITE_DATA_MODE', 'live');
      const r = result(population);
      const read = population === 'all' ? transport.read : transport.personal;
      read.mockResolvedValue(r);
      await loadStatistics(scope, r.spec, null, { cursor: 0 });
      const params = () => read.mock.calls.at(-1)![population === 'all' ? 1 : 0] as URLSearchParams;
      expect(params().get('consistency')).toBe('latest');
      await loadStatistics(scope, r.spec, r.dataset_version, { cursor: 1 });
      expect(params().get('expected_version')).toBe('v1');
      expect(params().has('consistency')).toBe(false);
      // Old/misbehaving servers must not sneak a newer page through the client check.
      read.mockResolvedValue(result(population, 'v2'));
      await expect(loadStatistics(scope, r.spec, 'v1', { cursor: 1 })).rejects.toMatchObject({ status: 409, code: 'DATASET_CHANGED' });
    });
  }
  it('P1 merge refuses different versions even when all offsets are present', () => {
    const a = { ...result(), row_page: { offset: 0, limit: 1, total: 2, has_more: true } };
    const b = { ...a, dataset_version: 'v2', row_page: { ...a.row_page, offset: 1, has_more: false } };
    expect(() => paging.mergePages(new Map([[0, a], [1, b]]))).toThrow(/자료|version/i);
  });
  for (const population of ['all', 'mine', 'compare'] as const) {
    it(`P2 empty agency × law ${population} survives actual JSON serialization + schema`, () => {
      const r = aggregateStatistics({ facts: [], scope, spec: baseSpec({ population }), datasetVersion: 'v1', viewerId: 'u1', rowPage: { cursor: 0 } });
      expect(Number.isFinite(r.row_page!.limit)).toBe(true);
      expect(r.row_page!.limit).toBeGreaterThan(0);
      expect(statisticsResultSchema.safeParse(JSON.parse(JSON.stringify(r))).success).toBe(true);
      expect(r.row_page).toMatchObject({ total: 0, has_more: false });
      expect(r.population_count[population === 'mine' ? 'mine' : 'all']).toBe(0);
    });
  }
  it('P2 empty query HTTP 200 body passes the browser schema', async () => {
    const handler = createPublicHandler({
      getState: async () => ({ dataset_version: 'v1', ready: true, source_updated_at: null, generated_at: '2026-01-01T00:00:00Z', published_at: null,
        data_min: '2026-01-01', data_max: '2026-06-30', coverage_note: '', dedupe_policy_version: 'test' }),
      getFacts: async () => [], allowRequest: async () => true,
    }, fixtureAccess());
    const q = new URLSearchParams({ date_basis: scope.date_basis, start: scope.start, end: scope.end, category: 'all', row_cursor: '0', spec: JSON.stringify(baseSpec()) });
    const response = await handler(viewerRequest(`https://api.example.invalid/public-analytics/statistics/query?${q}`));
    expect(response.status).toBe(200);
    expect(statisticsResultSchema.safeParse(await response.json()).success).toBe(true);
  });
  it('P2 removing the sorted metric resets to default order and produces a valid request', () => {
    const spec = baseSpec({ metrics: ['completed_count'] });
    const page = paging.firstPageRequest(spec, { cursor: 25, sortMetric: 'fine_rate', sortDir: 'asc' });
    expect(page).toEqual({ cursor: 0, sortMetric: null, sortDir: 'desc' });
    expect(() => parseRowPage(new URLSearchParams({ row_cursor: String(page.cursor) }), spec)).not.toThrow();
    expect(paging.firstPageRequest(spec, { cursor: 25, sortMetric: 'completed_count', sortDir: 'asc' }))
      .toEqual({ cursor: 0, sortMetric: 'completed_count', sortDir: 'asc' });
  });
});
