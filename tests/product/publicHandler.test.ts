import { describe, expect, it } from 'vitest';
import { createPublicHandler, type AnalyticsRepository, type AnalyticsState } from '../../server/publicHandler';
import { dashboardResponseSchema, metaSchema, vehiclesResponseSchema } from '../../src/data/schema';
import type { PrivateFact } from '../../server/aggregate';

const state: AnalyticsState = {
  dataset_version: 'v2-test', ready: true, source_updated_at: '2026-09-24T00:00:00Z',
  generated_at: '2026-09-24T01:00:00Z', published_at: null,
  data_min: '2026-01-01', data_max: '2026-09-24', coverage_note: 'synthetic test',
  dedupe_policy_version: 'active-snapshot-v1',
};
const fact: PrivateFact = {
  fact_identity: 'PRIVATE-REPORT-1', contributor_id: 'PRIVATE-ACCOUNT-UUID',
  snapshot_id: 'PRIVATE-SNAPSHOT-UUID', snapshot_generation: 1,
  report_date: '2026-01-31', completed_date: '2026-02-01', category: 'traffic',
  status: 'accepted', disposition: 'fine', vehicle_raw: '서울12가3456',
  point_key: 'public-point-1', lat: 37.566535, lng: 126.9779692,
  address: '<script>alert(1)</script>', region_code: '11', agency_key: 'a1',
  agency_name: '<img src=x onerror=alert(1)>', manager_key: 'm1', manager_name: '김하늘',
};
function endpoint(path: string) {
  return new Request(`https://example.supabase.co/functions/v1/public-analytics/${path}`);
}
function makeRepo(overrides: Partial<AnalyticsRepository> = {}): AnalyticsRepository {
  return { getState: async () => state, getFacts: async () => [fact],
    allowRequest: async () => true, ...overrides };
}
const q = 'start=2026-01-01&end=2026-02-28&category=all&expected_version=v2-test';

describe('public analytics API boundary', () => {
  it('returns a strict public DTO with exact coordinate, full manager name and one-record rows', async () => {
    const response = await createPublicHandler(makeRepo())(endpoint(`dashboard?${q}`));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await response.json();
    expect(dashboardResponseSchema.safeParse(body).success).toBe(true);
    expect(body.points[0]).toMatchObject({ lat: 37.566535, lng: 126.9779692, report_count: 1 });
    expect(body.managers[0].manager_name).toBe('김하늘');
    expect(body.agencies[0].completed_count).toBe(1);
    const serialized = JSON.stringify(body);
    for (const privateValue of ['PRIVATE-REPORT-1', 'PRIVATE-ACCOUNT-UUID', 'PRIVATE-SNAPSHOT-UUID', '서울12가3456']) {
      expect(serialized).not.toContain(privateValue);
    }
    expect(body.points[0].address).toBe('<script>alert(1)</script>');
  });
  it('returns masked vehicles without a stable vehicle ID', async () => {
    const response = await createPublicHandler(makeRepo())(endpoint(`vehicles/top?${q}`));
    const body = await response.json();
    expect(vehiclesResponseSchema.safeParse(body).success).toBe(true);
    expect(body.items[0]).toMatchObject({ rank_item_id: 'r1', masked_plate: '서울1*가*4*6', report_count: 1 });
  });
  it('exposes the v1 source gap and refuses an unsupported aggregate', async () => {
    let factCalls = 0;
    const repo = makeRepo({ getState: async () => ({ ...state, ready: false, generated_at: null }),
      getFacts: async () => { factCalls++; return [fact]; } });
    const handler = createPublicHandler(repo);
    const metaResponse = await handler(endpoint('meta'));
    const meta = await metaResponse.json();
    expect(metaSchema.safeParse(meta).success).toBe(true);
    expect(meta.capabilities.vehicle_top5.status).toBe('missing');
    expect((await handler(endpoint(`dashboard?${q}`))).status).toBe(503);
    expect(factCalls).toBe(0);
  });
  it('rejects query abuse, stale versions, and rate limits without private errors', async () => {
    const handler = createPublicHandler(makeRepo());
    expect((await handler(endpoint(`dashboard?${q}&table=private.report_facts_v2`))).status).toBe(400);
    expect((await handler(endpoint('dashboard?start=2026-02-30&end=2026-03-01'))).status).toBe(400);
    expect((await handler(endpoint(`dashboard?${q}&expected_version=v3`))).status).toBe(400);
    const changed = await handler(endpoint('dashboard?start=2026-01-01&end=2026-02-28&expected_version=v3'));
    expect(changed.status).toBe(409);
    const limited = await createPublicHandler(makeRepo({ allowRequest: async () => false }))(endpoint('meta'));
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('60');
  });
  it('stops serving data immediately after withdrawal invalidates the version', async () => {
    let ready = true;
    const handler = createPublicHandler(makeRepo({ getState: async () => ({ ...state, ready }) }));
    expect((await handler(endpoint(`overview?${q}`))).status).toBe(200);
    ready = false;
    expect((await handler(endpoint(`overview?${q}`))).status).toBe(503);
  });
});
