import { describe, expect, it } from 'vitest';
import { SCREEN_FACT_COLUMNS, decodeScreenFacts } from '../../server/screenFacts';
import { createScreenHandler } from '../../server/screenHandler';
import { createPublicHandler } from '../../server/publicHandler';
import { demoFacts, demoMeta, demoEngineDashboard, DEMO_VIEWER_ID } from '../../src/data/demoEngine';
import { DEMO_SCOPE } from '../../src/domain/public';
import { personalCompareSchema } from '../../src/data/personal';
import { dashboardResponseSchema } from '../../src/data/schema';
import { ScreenCoordinator, type ScreenPanel } from '../../src/data/screenCoordinator';
import { fixtureAccess, viewerRequest } from './helpers/mapViewer';

const scope = DEMO_SCOPE;
const q = new URLSearchParams({ date_basis: scope.date_basis, start: scope.start, end: scope.end, category: scope.category });
const state = { ...demoMeta(), ready: true, coverage_note: 'synthetic', dedupe_policy_version: 'contribution-dedupe-v1' };
const viewer = { user_ok: true, kakao: true, session: true, contributor: 'active' as const, has_public_facts: true, public_fact_count: 10 };
const session = '11111111-2222-4333-8444-555555555555';
const token = `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: DEMO_VIEWER_ID, role: 'authenticated', aud: 'authenticated', session_id: session })).toString('base64url')}.sig`;
const panels: ScreenPanel[] = [{ id: 'compare', path: 'compare', params: {} }, { id: 'entities', path: 'entities', params: { kind: 'agency' } }, { id: 'laws', path: 'laws', params: {} }];
const req = (ps = panels, auth = true) => new Request(`https://local.invalid/my-analytics/screen?${q}&expected_version=old&panels=${encodeURIComponent(JSON.stringify(ps))}`,
  { headers: auth ? { Authorization: `Bearer ${token}` } : {} });

describe('one screen from one source snapshot', () => {
  it('returns strict dashboard/personal/table DTOs from one read, despite obsolete expected version', async () => {
    const calls: string[] = [];
    const handler = createScreenHandler({ enabled: true, allowedOrigins: [], jwtIssuer: null,
      getUser: async () => ({ id: DEMO_VIEWER_ID, isAnonymous: false }), rpc: async (name, args) => {
        calls.push(name);
        if (name === 'internal_community_ingest_rate_limit') return true;
        expect(args.p_user).toBe(DEMO_VIEWER_ID); expect(args.p_session).toBe(session);
        return { state, viewer, facts: demoFacts() };
      } });
    const response = await handler(req()); expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('private, no-store');
    const body = await response.json();
    expect(calls).toEqual(['internal_community_ingest_rate_limit', 'internal_analytics_read_snapshot']);
    dashboardResponseSchema.parse(body.dashboard);
    const personal = personalCompareSchema.parse(body.panels[0].body);
    expect(personal.all.report_count).toBe(body.dashboard.overview.report_count.value);
    expect(body.panels.every((p: any) => p.status === 200 && p.body.dataset_version === body.meta.dataset_version)).toBe(true);
    expect(JSON.stringify(body)).not.toContain(DEMO_VIEWER_ID);
  });
  it('losslessly decodes compact SQL rows and preserves the complete screen, including personal comparison', async () => {
    const facts = demoFacts();
    const compact = { encoding: 'columns-v1', columns: SCREEN_FACT_COLUMNS,
      rows: facts.map(f => SCREEN_FACT_COLUMNS.map(k => f[k])) };
    const run = (payload: unknown) => createScreenHandler({ enabled: true, allowedOrigins: [], jwtIssuer: null,
      getUser: async () => ({ id: DEMO_VIEWER_ID, isAnonymous: false }), rpc: async (name, args) => {
        if (name.endsWith('rate_limit')) return true;
        expect(args.p_options).toEqual({ fact_encoding: 'columns-v1', screen_encoding: 'screen-aggregate-v1', panels });
        return { state, viewer, facts: payload };
      } })(req());
    const before = await run(facts), after = await run(compact);
    expect(after.status).toBe(200);
    expect(await after.json()).toEqual(await before.json());
    expect(decodeScreenFacts({ ...compact, encoding: 'future' })).toBeNull();
    expect(decodeScreenFacts({ ...compact, columns: [...SCREEN_FACT_COLUMNS].reverse() })).toBeNull();
    expect(decodeScreenFacts({ ...compact, rows: [[null]] })).toBeNull();
    expect((await run({ ...compact, encoding: 'future' })).status).toBe(503);
  });
  it('fails closed on an unknown aggregate protocol without using accompanying legacy facts', async () => {
    const handler = createScreenHandler({ enabled: true, allowedOrigins: [], jwtIssuer: null,
      getUser: async () => ({ id: DEMO_VIEWER_ID, isAnonymous: false }),
      rpc: async name => name.endsWith('rate_limit') ? true : { state, viewer, facts: demoFacts(), aggregate: { encoding: 'future' } } });
    const response = await handler(req());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: 'AGGREGATE_NOT_READY' } });
  });
  it('expands a table/chart prefix within one snapshot, including rows beyond the first page', async () => {
    const facts = Array.from({ length: 230 }, (_, i) => ({ ...demoFacts()[0], fact_identity: `row-${i}`, report_identity: `id-${i}`,
      is_representative: true, report_date: scope.start, completed_date: scope.start,
      agency_key: `agency-${String(i).padStart(3, '0')}`, agency_name: `Agency ${String(i).padStart(3, '0')}` }));
    const handler = createScreenHandler({ enabled: true, allowedOrigins: [], jwtIssuer: null,
      getUser: async () => ({ id: DEMO_VIEWER_ID, isAnonymous: false }), rpc: async name => name.endsWith('rate_limit') ? true : { state, viewer, facts } });
    const r = await handler(req([{ id: 'scope-agency', path: 'entity-prefix', params: { kind: 'agency', q: '', through_page: '2' } }]));
    expect(r.status).toBe(200);
    const packet = await r.json(), body = packet.panels[0].body;
    expect(body.items).toHaveLength(200); expect(body.total_rows).toBe(230);
    expect(body.items[0].agency_name).toBe('Agency 000'); expect(body.items[199].agency_name).toBe('Agency 199');
    expect(body.dataset_version).toBe(packet.dashboard.dataset_version);
  });
  it('checks authentication, snapshot gate and bounded panel allowlist without falling back to raw data', async () => {
    let reads = 0;
    const handler = createScreenHandler({ enabled: true, allowedOrigins: [], jwtIssuer: null,
      getUser: async () => ({ id: DEMO_VIEWER_ID, isAnonymous: false }), rpc: async name => {
        if (name.endsWith('rate_limit')) return true;
        reads++; return { state, viewer: { ...viewer, public_fact_count: 9 }, facts: [] };
      } });
    expect((await handler(req(panels, false))).status).toBe(401); expect(reads).toBe(0);
    expect((await handler(req([{ id: 'bad', path: 'private/facts', params: {} }]))).status).toBe(400); expect(reads).toBe(0);
    expect((await handler(req())).status).toBe(403); expect(reads).toBe(1);
  });
  it('labels public facts with the source snapshot state, never the earlier metadata read', async () => {
    const handler = createPublicHandler({ getState: async () => ({ ...state, dataset_version: 'old' }),
      getFacts: async () => { throw new Error('separate facts read forbidden'); },
      getSnapshot: async () => ({ state: { ...state, dataset_version: 'new' }, facts: demoFacts() }), allowRequest: async () => true }, fixtureAccess());
    const r = await handler(viewerRequest(`https://local.invalid/public-analytics/dashboard?${q}&expected_version=old&consistency=latest`));
    expect(r.status).toBe(200); expect((await r.json()).dataset_version).toBe('new');
  });
});

describe('complete-screen browser coordinator', () => {
  it('restores the displayed frame when a scope transition is cancelled and bundles its pending table intent', async () => {
    let calls = 0; let release!: () => void;
    const coordinator = new ScreenCoordinator(async (s, panels) => {
      if (++calls === 2) await new Promise<void>(resolve => { release = resolve; });
      const data = demoEngineDashboard(s); data.meta.dataset_version = `version-${calls}`;
      return { data, panels: panels.map(p => ({ id: p.id, status: 200, body: { ...p.params, dataset_version: data.meta.dataset_version } })) };
    });
    await coordinator.open(scope);
    const ac = new AbortController();
    const moving = coordinator.open({ ...scope, category: 'parking' }, ac.signal);
    const rejected = expect(moving).rejects.toMatchObject({ name: 'AbortError' });
    expect(coordinator.active()).toBe(true);
    const table = coordinator.panel(scope, { id: 'laws', path: 'laws', params: { q: 'after-return' } });
    ac.abort(); release(); await rejected;
    expect((await table).body).toEqual({ q: 'after-return', dataset_version: 'version-3' });
    expect(coordinator.matches(scope)).toBe(true); expect(calls).toBe(3);
  });
  it('supersedes an old displayed-scope panel when the new scope succeeds', async () => {
    let release!: () => void, calls = 0;
    const coordinator = new ScreenCoordinator(async s => {
      if (++calls === 2) await new Promise<void>(resolve => { release = resolve; });
      return { data: demoEngineDashboard(s), panels: [] };
    });
    await coordinator.open(scope);
    const next = { ...scope, category: 'parking' as const };
    const moving = coordinator.open(next);
    const old = coordinator.panel(scope, panels[0]);
    const rejected = expect(old).rejects.toMatchObject({ name: 'AbortError' });
    release(); await moving; await rejected;
    expect(coordinator.matches(next)).toBe(true); expect(calls).toBe(2);
  });
  it('coalesces concurrent panels, installs one complete replacement and reuses its version without a retry loop', async () => {
    let calls = 0; const published: string[] = [];
    const coordinator = new ScreenCoordinator(async (scope, panels) => {
      calls++;
      const data = demoEngineDashboard(scope); data.meta.dataset_version = `version-${calls}`;
      return { data, panels: panels.map(p => ({ id: p.id, status: 200, body: { dataset_version: data.meta.dataset_version } })) };
    });
    coordinator.subscribe(d => published.push(d.meta.dataset_version));
    await coordinator.open(scope);
    await Promise.all(panels.map(p => coordinator.panel(scope, p)));
    expect(calls).toBe(2); expect(published).toEqual(['version-1', 'version-2']);
    await Promise.all(panels.map(p => coordinator.panel(scope, p)));
    expect(calls).toBe(2);
    expect(coordinator.matches(Object.fromEntries(Object.entries(scope).reverse()) as typeof scope)).toBe(true);
  });
  it('drops a late account response and queued panel work after reset', async () => {
    let done!: (value: any) => void;
    const coordinator = new ScreenCoordinator(() => new Promise(resolve => { done = resolve; }));
    const events: unknown[] = []; coordinator.subscribe(d => events.push(d));
    const open = coordinator.open(scope); coordinator.reset();
    done({ data: demoEngineDashboard(scope), panels: [] });
    await expect(open).rejects.toMatchObject({ name: 'AbortError' }); expect(events).toEqual([]);
  });
  it('newer table intent wins even when the older bundle finishes later', async () => {
    let calls = 0; let release!: () => void;
    const coordinator = new ScreenCoordinator(async (s, panels) => {
      if (++calls === 2) await new Promise<void>(resolve => { release = resolve; });
      return { data: demoEngineDashboard(s), panels: panels.map(p => ({ id: p.id, status: 200, body: p.params })) };
    });
    await coordinator.open(scope);
    const first = coordinator.panel(scope, { id: 'laws', path: 'laws', params: { q: 'first' } });
    const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' });
    await new Promise(r => setTimeout(r, 5));
    const second = coordinator.panel(scope, { id: 'laws', path: 'laws', params: { q: 'second' } });
    release(); await rejected;
    expect((await second).body).toEqual({ q: 'second' }); expect(calls).toBe(3);
  });
});
