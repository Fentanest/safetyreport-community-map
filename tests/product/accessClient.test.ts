import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MapAuth } from '../../src/auth/mapAuth';

// Contributor-only map (user decision 2026-09-27): the statistics client sends the map session token and turns the
// server's access refusals into codes the page shows as the access gate.
const auth = vi.hoisted(() => ({ current: null as unknown as MapAuth }));
vi.mock('../../src/hooks/usePersonal', () => ({ mapAuth: () => auth.current }));

function fakeAuth(token: string | null, refreshed: string | null = null): MapAuth {
  return {
    snapshot: () => ({ status: token ? 'signed_in' : 'signed_out', displayName: null, viewerId: null, synthetic: false, message: null }),
    subscribe: () => () => undefined, signIn: async () => undefined, signOut: async () => undefined,
    accessToken: async () => token, refreshToken: vi.fn(async () => refreshed), settled: async () => undefined,
  };
}
const refusal = (status: number, code: string) =>
  new Response(JSON.stringify({ error: { code, message: `server:${code}` } }), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => { vi.stubEnv('VITE_PUBLIC_ANALYTICS_URL', 'https://p.supabase.co/functions/v1'); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });

const scope = { date_basis: 'completed_date' as const, start: '2026-01-01', end: '2026-01-31', category: 'all' as const, region_code: null, agency_key: null, manager_key: null, bbox: null, law: null };

describe('statistics client while the map is contributor-only', () => {
  it('sends the signed-in token to the analytics URL only, without cookies', async () => {
    auth.current = fakeAuth('token-1');
    const fetchMock = vi.fn().mockResolvedValue(refusal(403, 'contributor_required'));
    vi.stubGlobal('fetch', fetchMock);
    const { loadDashboard } = await import('../../src/data/client');
    await expect(loadDashboard(scope)).rejects.toMatchObject({ code: 'contributor_required', status: 403 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://p.supabase.co/functions/v1/public-analytics/meta');
    expect(init.headers.Authorization).toBe('Bearer token-1');
    expect(init.credentials).toBe('omit');
  });
  it('without a session refuses to call even a mistakenly public analytics API', async () => {
    auth.current = fakeAuth(null);
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { loadDashboard, isAccessError } = await import('../../src/data/client');
    const error = await loadDashboard(scope).catch((e: unknown) => e);
    expect(isAccessError(error)).toBe(true);
    expect(error).toMatchObject({ code: 'auth_required', status: 401 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('refreshes once after a 401 and retries with the new token', async () => {
    auth.current = fakeAuth('old', 'new');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(refusal(401, 'session_expired'))
      .mockResolvedValueOnce(refusal(403, 'contributor_required'));
    vi.stubGlobal('fetch', fetchMock);
    const { loadDashboard } = await import('../../src/data/client');
    await expect(loadDashboard(scope)).rejects.toMatchObject({ code: 'contributor_required' });
    expect(auth.current.refreshToken).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer new');
  });
  it('other failures are ordinary errors, not the access gate', async () => {
    auth.current = fakeAuth('token-1');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(refusal(503, 'AGGREGATE_NOT_READY')));
    const { loadDashboard, isAccessError } = await import('../../src/data/client');
    const error = await loadDashboard(scope).catch((e: unknown) => e);
    expect(isAccessError(error)).toBe(false);
    expect(error).toMatchObject({ status: 503, code: 'AGGREGATE_NOT_READY' });
    // the real cause stays on the error (code/status) and the message is plain language (no HTTP jargon)
    expect((error as Error).message).not.toMatch(/HTTP/);
  });
});
