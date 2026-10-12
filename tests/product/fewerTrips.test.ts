import { describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createScreenHandler } from '../../server/screenHandler';
import { demoFacts, demoMeta, DEMO_VIEWER_ID } from '../../src/data/demoEngine';
import { DEMO_SCOPE, type DashboardData } from '../../src/domain/public';
import { dashboardResponseSchema, dashboardAnalyticsResponseSchema } from '../../src/data/schema';
import { RefreshController } from '../../src/data/refreshController';
import { PublicApiError } from '../../src/data/client';

const origin = 'https://local.invalid';
const token = `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: DEMO_VIEWER_ID, role: 'authenticated', aud: 'authenticated', session_id: '11111111-2222-4333-8444-555555555555' })).toString('base64url')}.sig`;
const state = { ...demoMeta(), ready: true, coverage_note: 'synthetic', dedupe_policy_version: 'contribution-dedupe-v1' };
const viewer = { user_ok: true, kakao: true, session: true, contributor: 'active' as const, has_public_facts: true, public_fact_count: 10 };
const request = (deferred: boolean, charts = false, compare = false) => new Request(`${origin}/my-analytics/screen?${new URLSearchParams({
  date_basis: DEMO_SCOPE.date_basis, start: DEMO_SCOPE.start, end: DEMO_SCOPE.end, category: 'all',
  panels: JSON.stringify([...(charts ? [{ id: 'charts', path: 'dashboard-analytics', params: {} }] : []),
    ...(compare ? [{ id: 'compare', path: 'compare', params: {} }] : [])]),
})}`, { headers: { Origin: origin, Authorization: `Bearer ${token}`, Accept: deferred ? 'application/json; screen-detail=deferred-v1' : 'application/json' } });

describe('fewer trips', () => {
  it('preserves legacy payloads and retrieves deferred charts from the same replacement snapshot', async () => {
    const handler = createScreenHandler({ enabled: true, allowedOrigins: [origin], jwtIssuer: null,
      getUser: async () => ({ id: DEMO_VIEWER_ID, isAnonymous: false }),
      rpc: async name => name.endsWith('rate_limit') ? true : { state, viewer, facts: demoFacts() } });
    const old = await (await handler(request(false))).json();
    const first = await (await handler(request(true))).json();
    const expanded = await (await handler(request(true, true))).json();
    expect(old.dashboard.analytics).not.toBeNull();
    expect(first).toEqual({ ...old, dashboard: { ...old.dashboard, analytics: null } });
    expect(dashboardAnalyticsResponseSchema.parse(expanded.panels[0].body)).toEqual({ dataset_version: old.meta.dataset_version, scope: old.dashboard.scope, analytics: old.dashboard.analytics });
    dashboardResponseSchema.parse(first.dashboard);
    const preflight = await handler(new Request(request(true).url, { method: 'OPTIONS', headers: { Origin: origin } }));
    expect(preflight.status).toBe(204); expect(preflight.headers.get('access-control-max-age')).toBe('600');
    const denied = await handler(new Request(request(true).url, { method: 'OPTIONS', headers: { Origin: 'https://evil.invalid' } }));
    expect(denied.status).toBe(403); expect(denied.headers.has('access-control-allow-origin')).toBe(false);
    const anonymous = await handler(new Request(request(true).url)); expect(anonymous.status).toBe(401);
    expect((await handler(request(true))).headers.get('cache-control')).toContain('no-store');
  });

  it('bootstraps without meta, retries 409 once, and rejects late responses after account reset', async () => {
    const fetchMeta = vi.fn(), fetchDashboard = vi.fn();
    const data = { scope: DEMO_SCOPE, meta: demoMeta() } as DashboardData;
    const fetchScreen = vi.fn().mockRejectedValueOnce(new PublicApiError('changed', 409)).mockResolvedValueOnce(data);
    const controller = new RefreshController({ fetchMeta, fetchDashboard, fetchScreen, now: Date.now, setTimer: setTimeout, clearTimer: id => clearTimeout(id as ReturnType<typeof setTimeout>) });
    controller.request(DEMO_SCOPE);
    await vi.waitFor(() => expect(controller.snapshot().displayed?.data).toBe(data));
    expect(fetchMeta).not.toHaveBeenCalled(); expect(fetchDashboard).not.toHaveBeenCalled(); expect(fetchScreen).toHaveBeenCalledTimes(2);
    let resolve!: (value: DashboardData) => void;
    fetchScreen.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    controller.retry(); controller.reset(); resolve(data);
    await Promise.resolve(); expect(controller.snapshot().displayed).toBeNull(); expect(controller.snapshot().meta).toBeNull();
    controller.dispose();
  });

  it('measures actual serialized legacy/deferred responses on a deterministic dense synthetic cohort', async () => {
    const template = demoFacts().find(f => f.status === 'accepted' && f.completed_date)!;
    const facts = Array.from({ length: 6000 }, (_, i) => ({ ...template, fact_identity: `measure-${i}`, report_identity: `measure-${i}`,
      report_date: '2026-08-01', completed_date: '2026-08-02', contributor_id: DEMO_VIEWER_ID,
      agency_key: `agency-${i % 500}`, agency_name: `합성기관${i % 500}`, manager_key: `manager-${i}`, manager_name: `합성담당${i}`,
      address: `서울특별시 중구 합성로 ${i}`, lat: 37.5 + (i % 100) / 1000, lng: 126.9 + Math.floor(i / 100) / 1000,
    }));
    const handler = createScreenHandler({ enabled: true, allowedOrigins: [origin], jwtIssuer: null,
      getUser: async () => ({ id: DEMO_VIEWER_ID, isAnonymous: false }), rpc: async name => name.endsWith('rate_limit') ? true : { state, viewer, facts } });
    const out = '.agent-runtime/fewer-trips'; mkdirSync(out, { recursive: true });
    const sizes = [];
    for (const phase of ['before', 'after'] as const) {
      const response = await handler(request(phase === 'after')); expect(response.status).toBe(200);
      const body = await response.text(); dashboardResponseSchema.parse(JSON.parse(body).dashboard);
      writeFileSync(`${out}/${phase}.json`, body);
      sizes.push({ phase, raw: Buffer.byteLength(body), gzip: gzipSync(body).length, analytics: Buffer.byteLength(JSON.stringify(JSON.parse(body).dashboard.analytics)) });
    }
    writeFileSync(`${out}/meta.json`, JSON.stringify(JSON.parse(await (await handler(request(false))).text()).meta));
    writeFileSync(`${out}/sizes.json`, JSON.stringify(sizes, null, 2));
    const comparisonSizes = [];
    for (const phase of ['before', 'after'] as const) {
      const response = await handler(request(phase === 'after', false, true)); expect(response.status).toBe(200);
      const body = await response.text();
      comparisonSizes.push({ phase, raw: Buffer.byteLength(body), gzip: gzipSync(body).length });
    }
    writeFileSync(`${out}/comparison-sizes.json`, JSON.stringify(comparisonSizes, null, 2));
    expect(sizes[1].raw).toBeLessThan(sizes[0].raw); expect(sizes[1].gzip).toBeLessThan(sizes[0].gzip);
  });
});
