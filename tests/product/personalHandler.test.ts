import { describe, expect, it } from 'vitest';
import { createPersonalHandler, type PersonalDeps, type PersonalSource } from '../../server/personalHandler';
import { createPublicHandler, type AnalyticsState } from '../../server/publicHandler';
import { demoFacts, DEMO_AS_OF, DEMO_DATA_MIN, DEMO_VIEWER_ID } from '../../src/data/demoEngine';
import { personalCompareSchema } from '../../src/data/personal';
import { fixtureAccess, viewerRequest } from './helpers/mapViewer';

const ORIGIN = 'https://safemap.worklazy.net';
const SESSION = '11111111-2222-4333-8444-555555555555';
const state: AnalyticsState = {
  dataset_version: 'v-live-1', ready: true, source_updated_at: null, generated_at: '2026-09-27T00:00:00Z',
  published_at: null, data_min: DEMO_DATA_MIN, data_max: DEMO_AS_OF, coverage_note: 'test', dedupe_policy_version: 'contribution-dedupe-v1',
};

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
function token(claims: Record<string, unknown> = {}): string {
  return `${b64({ alg: 'HS256' })}.${b64({ sub: DEMO_VIEWER_ID, role: 'authenticated', aud: 'authenticated', iss: 'https://p.supabase.co/auth/v1', session_id: SESSION, is_anonymous: false, ...claims })}.sig`;
}

interface Calls { rpc: Array<[string, Record<string, unknown>]> }
function setup(over: Partial<PersonalDeps> = {}, source: Partial<PersonalSource> = {}, viewer: Partial<PersonalSource['viewer']> = {}) {
  const calls: Calls = { rpc: [] };
  const deps: PersonalDeps = {
    enabled: true, allowedOrigins: [ORIGIN], jwtIssuer: 'https://p.supabase.co/auth/v1',
    getUser: async () => ({ id: DEMO_VIEWER_ID, isAnonymous: false }),
    rpc: async (name, args) => {
      calls.rpc.push([name, args]);
      if (name === 'internal_community_ingest_rate_limit') return true;
      if (name === 'internal_my_analytics_source') {
        return { state, facts: demoFacts(), ...source,
          viewer: { user_ok: true, kakao: true, session: true, contributor: 'active', has_public_facts: true, ...viewer } };
      }
      throw new Error(`unexpected rpc ${name}`);
    },
    ...over,
  };
  return { handle: createPersonalHandler(deps), calls };
}

const QS = `start=2025-09-25&end=2026-09-24&category=all&expected_version=v-live-1`;
function req(path = `/functions/v1/my-analytics/compare?${QS}`, init: { method?: string; auth?: string | null; origin?: string | null } = {}) {
  const headers: Record<string, string> = {};
  if (init.auth !== null) headers.authorization = init.auth ?? `Bearer ${token()}`;
  if (init.origin !== null) headers.origin = init.origin ?? ORIGIN;
  return new Request(`https://p.supabase.co${path}`, { method: init.method ?? 'GET', headers });
}

async function body(res: Response) { return JSON.parse(await res.text()); }

describe('my-analytics authentication and ownership', () => {
  it('requires a bearer token and never serves personal data anonymously', async () => {
    const { handle, calls } = setup();
    const res = await handle(req(undefined, { auth: null }));
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe('Bearer');
    expect((await body(res)).error.code).toBe('auth_required');
    expect(calls.rpc).toHaveLength(0);
  });

  it('treats a token the auth server rejects as an expired session', async () => {
    const { handle, calls } = setup({ getUser: async () => null });
    const res = await handle(req());
    expect(res.status).toBe(401);
    expect((await body(res)).error.code).toBe('session_expired');
    expect(calls.rpc).toHaveLength(0);
  });

  it.each([
    ['sub differs from the verified user', { sub: 'someone-else' }, 401, 'auth_required'],
    ['wrong role', { role: 'service_role' }, 401, 'auth_required'],
    ['wrong audience', { aud: 'other' }, 401, 'auth_required'],
    ['wrong issuer', { iss: 'https://evil.example/auth/v1' }, 401, 'auth_required'],
    ['anonymous user', { is_anonymous: true }, 403, 'kakao_required'],
    ['no session id', { session_id: undefined }, 401, 'auth_required'],
  ])('rejects claims: %s', async (_n, claims, status, code) => {
    const { handle, calls } = setup();
    const res = await handle(req(undefined, { auth: `Bearer ${token(claims)}` }));
    expect(res.status).toBe(status);
    expect((await body(res)).error.code).toBe(code);
    expect(calls.rpc.filter(([n]) => n === 'internal_my_analytics_source')).toHaveLength(0);
  });

  it.each([
    [{ user_ok: false }, 403, 'account_ineligible'],
    [{ kakao: false }, 403, 'kakao_required'],
    [{ session: false }, 401, 'session_expired'],
  ])('refuses identity state %o from the database', async (viewer, status, code) => {
    const { handle } = setup({}, {}, viewer);
    const res = await handle(req());
    expect(res.status).toBe(status);
    expect((await body(res)).error.code).toBe(code);
  });

  it('takes the viewer id and session only from the verified token, never from the query', async () => {
    const { handle, calls } = setup();
    const spoof = await handle(req(`/functions/v1/my-analytics/compare?${QS}&user_id=someone-else`));
    expect(spoof.status).toBe(400);
    const res = await handle(req());
    expect(res.status).toBe(200);
    const [, args] = calls.rpc.find(([n]) => n === 'internal_my_analytics_source')!;
    expect(args.p_user).toBe(DEMO_VIEWER_ID);
    expect(args.p_session).toBe(SESSION);
    expect(args).toMatchObject({ p_start: '2025-09-25', p_end: '2026-09-24', p_category: 'all', p_region_code: null, p_bbox: null });
  });

  it('rate-limits per verified user with a hashed bucket', async () => {
    const { handle, calls } = setup({ rpc: async (name, args) => { calls.rpc.push([name, args]); return false; } });
    const res = await handle(req());
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('60');
    const [, args] = calls.rpc[0];
    expect(String(args.p_bucket)).toMatch(/^[0-9a-f]{64}$/);
    expect(String(args.p_bucket)).not.toContain(DEMO_VIEWER_ID);
  });
});

describe('my-analytics response boundary', () => {
  it('returns a strict private, non-cacheable comparison for the same scope and version', async () => {
    const { handle } = setup();
    const res = await handle(req());
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store, max-age=0');
    expect(res.headers.get('vary')).toContain('Authorization');
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    const json = await body(res);
    expect(personalCompareSchema.safeParse(json).success).toBe(true);
    expect(json.dataset_version).toBe('v-live-1');
    const text = JSON.stringify(json);
    expect(text).not.toContain(DEMO_VIEWER_ID);
    expect(text).not.toContain('contributor_id');
    expect(text).not.toContain(SESSION);
  });

  it('refuses other origins and never answers with a wildcard CORS origin', async () => {
    const { handle, calls } = setup();
    const res = await handle(req(undefined, { origin: 'https://evil.example' }));
    expect(res.status).toBe(403);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(calls.rpc).toHaveLength(0);
    const pre = await handle(req(undefined, { method: 'OPTIONS', auth: null }));
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(pre.headers.get('access-control-allow-methods')).toBe('GET');
  });

  it('answers 409 when the public version on screen is not the version it would compute', async () => {
    const { handle } = setup();
    const res = await handle(req(`/functions/v1/my-analytics/compare?start=2025-09-25&end=2026-09-24&expected_version=old`));
    expect(res.status).toBe(409);
  });

  it('answers 503 while the public projection is not ready, and rejects non-GET and unknown routes', async () => {
    expect((await setup({}, { state: { ...state, ready: false } }).handle(req())).status).toBe(503);
    expect((await setup().handle(req(undefined, { method: 'POST' }))).status).toBe(405);
    expect((await setup().handle(req(`/functions/v1/my-analytics/facts?${QS}`))).status).toBe(404);
  });

  it('computes all/mine from the one RPC snapshot it received (no second read)', async () => {
    const { handle, calls } = setup();
    await handle(req());
    expect(calls.rpc.map(([n]) => n)).toEqual(['internal_community_ingest_rate_limit', 'internal_my_analytics_source']);
  });
});

describe('shared map API stays personal-free after authentication', () => {
  const repo = {
    getState: async () => state,
    getFacts: async () => demoFacts(),
    allowRequest: async () => true,
  };
  it('refuses anonymous requests and never returns personal fields to a viewer', async () => {
    const handle = createPublicHandler(repo, fixtureAccess());
    const url = `https://p.supabase.co/functions/v1/public-analytics/dashboard?start=2025-09-25&end=2026-09-24`;
    expect((await handle(new Request(url))).status).toBe(401);
    const response = await handle(viewerRequest(url));
    expect(response.status).toBe(200);
    const body = await response.text();
    const json = JSON.parse(body);
    for (const key of ['mine', 'viewer', 'my_points', 'contributor_id']) expect(body).not.toContain(`"${key}"`);
    expect(Array.isArray(json.regions)).toBe(true);
  });
  it('allows the Authorization header only for the map origin', async () => {
    const handle = createPublicHandler(repo, fixtureAccess());
    const url = 'https://p.supabase.co/functions/v1/public-analytics/meta';
    const allowed = await handle(new Request(url, { method: 'OPTIONS', headers: { origin: ORIGIN } }));
    expect(allowed.headers.get('access-control-allow-headers')).toContain('authorization');
    expect(allowed.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    const blocked = await handle(new Request(url, { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }));
    expect(blocked.status).toBe(403);
  });
});
