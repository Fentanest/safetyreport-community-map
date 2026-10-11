import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MapAuth } from '../../src/auth/mapAuth';

/**
 * Shared per-tab breaker (cloud-retry-brief.md 지도 웹 ①): `src/data/client.ts` (dashboard/statistics 'all') and
 * `src/data/personal.ts` (내 신고 비교/통계) must open and respect the SAME cooldown, so a Supabase outage seen by
 * one fetcher stops every other fetcher from hammering the network too — without this, each kept retrying on its
 * own (사용자 보고 2026-10-11).
 */
const scope = { date_basis: 'completed_date' as const, start: '2026-01-01', end: '2026-01-31', category: 'all' as const,
  region_code: null, agency_key: null, manager_key: null, bbox: null, law: null };

function fakeAuth(token: string | null): MapAuth {
  return {
    snapshot: () => ({ status: token ? 'signed_in' : 'signed_out', displayName: null, viewerId: null, synthetic: false, message: null }),
    subscribe: () => () => undefined, signIn: async () => undefined, signOut: async () => undefined,
    accessToken: async () => token, refreshToken: vi.fn(async () => null), settled: async () => undefined,
  };
}
// client.ts's internal read() calls mapAuth() from ../hooks/usePersonal (not the `auth` argument that loadCompare
// takes directly) — stub that singleton too so loadMeta/loadDashboard see a signed-in viewer.
const sharedAuth = vi.hoisted(() => ({ current: null as unknown as MapAuth }));
vi.mock('../../src/hooks/usePersonal', () => ({ mapAuth: () => sharedAuth.current }));
const outage = () => new Response(JSON.stringify({ error: { code: 'AGGREGATE_NOT_READY', message: '통계가 아직 준비되지 않았습니다.' } }),
  { status: 503, headers: { 'content-type': 'application/json' } });
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  vi.stubEnv('VITE_PUBLIC_ANALYTICS_URL', 'https://p.supabase.co/functions/v1');
  sharedAuth.current = fakeAuth('token-1');
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); vi.useRealTimers(); });

describe('shared breaker across fetchers', () => {
  it('a 503 from the public client blocks a later personal-comparison call without a second network attempt', async () => {
    const fetchMock = vi.fn().mockResolvedValue(outage());
    vi.stubGlobal('fetch', fetchMock);
    const { loadMeta } = await import('../../src/data/client');
    await expect(loadMeta()).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const { loadCompare } = await import('../../src/data/personal');
    await expect(loadCompare(scope, 'v1', fakeAuth('token-1'))).rejects.toMatchObject({ retryAfter: expect.any(Number) });
    // the breaker — not a second HTTP round trip — produced this rejection
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('clears after the cooldown elapses, and a later success does not re-open it', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValueOnce(outage());
    vi.stubGlobal('fetch', fetchMock);
    const { loadMeta } = await import('../../src/data/client');
    await expect(loadMeta()).rejects.toMatchObject({ status: 503 });

    const { loadCompare } = await import('../../src/data/personal');
    await expect(loadCompare(scope, 'v1', fakeAuth('token-1'))).rejects.toMatchObject({});
    expect(fetchMock).toHaveBeenCalledTimes(1); // still only the first (failed) attempt

    await vi.advanceTimersByTimeAsync(10_000); // well past the ~5s (±20%) base backoff
    fetchMock.mockResolvedValue(ok({ schema_version: 2, dataset_version: 'v1', sample: false, source_updated_at: null,
      generated_at: null, published_at: null, data_min: null, data_max: null, coverage_note: '', dedupe_policy_version: 't',
      capabilities: { daily_report_dates: { status: 'supported', reason: null, coverage: null } } }));
    const meta = await loadMeta();
    expect(meta.dataset_version).toBe('v1');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('a network-level failure (fetch throws) also opens the shared breaker', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);
    const { loadMeta } = await import('../../src/data/client');
    await expect(loadMeta()).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(loadMeta()).rejects.toMatchObject({ status: 429, code: 'COOLDOWN' });
    expect(fetchMock).toHaveBeenCalledTimes(1); // the second attempt never reached the network
  });

  it('an access refusal (403 contributor_required) never opens the breaker', async () => {
    // A fresh Response per call: a Response body can only be read (.json()) once, and each loadDashboard() call
    // below reads it while building the error.
    const fetchMock = vi.fn().mockImplementation(async () => new Response(
      JSON.stringify({ error: { code: 'contributor_required', message: 'x' } }),
      { status: 403, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const { loadDashboard } = await import('../../src/data/client');
    await expect(loadDashboard(scope)).rejects.toMatchObject({ code: 'contributor_required' });
    await expect(loadDashboard(scope)).rejects.toMatchObject({ code: 'contributor_required' });
    expect(fetchMock).toHaveBeenCalledTimes(2); // every call reached the network — no breaker involved
  });
});
