import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// ── minimal browser globals for the auth adapter (vitest runs in node) ─────────
const store = new Map<string, string>();
const replaceState = vi.fn();
function installWindow(search = '') {
  const localStorage = {
    getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  };
  vi.stubGlobal('window', {
    location: { search, origin: 'https://safemap.worklazy.net', pathname: '/', href: `https://safemap.worklazy.net/${search}` },
    history: { state: null, replaceState }, localStorage, sessionStorage: localStorage,
  });
}

const signOut = vi.fn(async (_opts?: unknown) => ({ error: null }));
const signInWithOAuth = vi.fn(async (_opts?: unknown) => ({ data: {}, error: null }));
const storedSession = { access_token: 'user-jwt', user: { user_metadata: { nickname: '합성', email: 'x@y.z' } } };
let sessionResult: typeof storedSession | null = storedSession;
let emitInitialNull = false;
const createClient = vi.fn((_url: string, _key: string, _opts: unknown) => ({
  auth: {
    onAuthStateChange: vi.fn((listener: (_event: string, session: null) => void) => {
      if (emitInitialNull) listener('INITIAL_SESSION', null);
    }),
    getSession: vi.fn(async () => ({ data: { session: sessionResult } })),
    refreshSession: vi.fn(async () => ({ data: { session: null }, error: { status: 400 } })),
    signOut, signInWithOAuth,
  },
}));
vi.mock('@supabase/supabase-js', () => ({ createClient }));

beforeEach(() => {
  store.clear();
  sessionResult = storedSession;
  emitInitialNull = false;
  vi.clearAllMocks();
  vi.stubEnv('VITE_SUPABASE_URL', 'https://p.supabase.co');
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test');
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });

describe('map web login (separate from relay and app sessions)', () => {
  it('does not load the auth SDK before an anonymous visitor starts login', async () => {
    installWindow('?start=2026-01-01');
    const { createLiveAuth } = await import('../../src/auth/mapAuth');
    const auth = createLiveAuth();
    expect(auth.snapshot().status).toBe('signed_out');
    await new Promise((r) => setTimeout(r, 0));
    expect(createClient).not.toHaveBeenCalled();
    expect(await auth.accessToken()).toBeNull();
  });

  it('uses PKCE, a map-only storage key, and signs out with scope local only', async () => {
    installWindow('');
    store.set('cm-map-auth-v1', '{}');
    const { createLiveAuth, MAP_AUTH_STORAGE_KEY } = await import('../../src/auth/mapAuth');
    const auth = createLiveAuth();
    await vi.waitFor(() => expect(auth.snapshot().status).toBe('signed_in'));
    const [, , options] = createClient.mock.calls[0] as unknown as [string, string, { auth: Record<string, unknown> }];
    expect(options.auth).toMatchObject({ flowType: 'pkce', storageKey: MAP_AUTH_STORAGE_KEY, persistSession: true });
    expect(auth.snapshot().displayName).toBe('합성');
    await auth.signOut();
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(auth.snapshot().status).toBe('signed_out');
  });

  it('starts Kakao OAuth back to the same public page without OAuth leftovers', async () => {
    installWindow('?start=2026-01-01&code=abc&state=zzz');
    const { createLiveAuth, stripOAuthParams } = await import('../../src/auth/mapAuth');
    expect(stripOAuthParams('?start=2026-01-01&code=abc&state=zzz&error=x&view=map')).toBe('?start=2026-01-01&view=map');
    const auth = createLiveAuth();
    await vi.waitFor(() => expect(replaceState).toHaveBeenCalled());
    expect(replaceState.mock.calls[0][2]).toBe('/?start=2026-01-01');
    await auth.signIn();
    expect(signInWithOAuth).toHaveBeenCalledWith({ provider: 'kakao', options: { redirectTo: 'https://safemap.worklazy.net/?start=2026-01-01' } });
  });

  it('keeps a failed OAuth return on the login screen instead of retrying forever', async () => {
    installWindow('?code=invalid');
    sessionResult = null;
    emitInitialNull = true;
    const { createLiveAuth } = await import('../../src/auth/mapAuth');
    const auth = createLiveAuth();
    const states: string[] = [];
    auth.subscribe(snapshot => states.push(snapshot.status));
    await vi.waitFor(() => expect(auth.snapshot().status).toBe('error'));
    expect(states).not.toContain('signed_out');
    expect(auth.snapshot().message).toContain('카카오 로그인이 취소되었거나');
  });

  it('reports an unconfigured deployment instead of failing the public page', async () => {
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '');
    installWindow('');
    const { createLiveAuth } = await import('../../src/auth/mapAuth');
    const auth = createLiveAuth();
    expect(auth.snapshot().status).toBe('unconfigured');
    await auth.signOut();
    expect(signOut).not.toHaveBeenCalled();
  });
});

describe('session-expired guidance (docs/personal-comparison.md §6)', () => {
  it('tells the viewer that the app upload connection is not affected', async () => {
    installWindow('?me=expired');
    const { createDemoAuth } = await import('../../src/auth/mapAuth');
    const auth = createDemoAuth('?me=expired');
    expect(await auth.refreshToken()).toBeNull();
    expect(auth.snapshot()).toMatchObject({ status: 'signed_out' });
    expect(auth.snapshot().message).toContain('앱의 자동 업로드는 그대로 계속됩니다');
  });
});

describe('personal client', () => {
  const scope = { start: '2025-09-25', end: '2026-09-24', category: 'all' as const, region_code: '서울 중구', agency_key: null, manager_key: null, bbox: null };
  async function sample() {
    const { aggregateCompare } = await import('../../server/compare');
    const { demoFacts, DEMO_AS_OF, DEMO_DATA_MIN, DEMO_VIEWER_ID } = await import('../../src/data/demoEngine');
    return JSON.parse(JSON.stringify(aggregateCompare(demoFacts(), scope, DEMO_VIEWER_ID, {
      datasetVersion: 'v1', asOf: DEMO_AS_OF, dataMin: DEMO_DATA_MIN, viewer: { contributor: 'active', has_public_facts: true } })));
  }
  const fakeAuth = (tokens: Array<string | null>) => ({
    snapshot: () => ({ status: 'signed_in' as const, displayName: null, synthetic: false, message: null }),
    subscribe: () => () => {}, signIn: async () => {}, signOut: async () => {},
    accessToken: async () => 'token-1', refreshToken: vi.fn(async () => tokens.shift() ?? null), settled: async () => undefined,
  });

  it('sends the bearer token only to my-analytics, uncached, with the public version, and refreshes once on 401', async () => {
    installWindow('');
    vi.stubEnv('VITE_PUBLIC_ANALYTICS_URL', 'https://p.supabase.co/functions/v1');
    const payload = await sample();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{"error":{"code":"session_expired"}}', { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(payload), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { loadCompare } = await import('../../src/data/personal');
    const auth = fakeAuth(['token-2']);
    const result = await loadCompare(scope, 'v1', auth);
    expect(result.dataset_version).toBe('v1');
    expect(auth.refreshToken).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[1];
    expect(String(url)).toMatch(/^https:\/\/p\.supabase\.co\/functions\/v1\/my-analytics\/compare\?/);
    expect(String(url)).toContain('expected_version=v1');
    expect(new URL(String(url)).searchParams.get('region_code')).toBe('서울 중구');
    expect(init).toMatchObject({ cache: 'no-store', credentials: 'omit' });
    expect(init.headers.Authorization).toBe('Bearer token-2');
  });

  it('stops after one refresh and maps 429 with Retry-After', async () => {
    installWindow('');
    vi.stubEnv('VITE_PUBLIC_ANALYTICS_URL', 'https://p.supabase.co/functions/v1');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));
    const { loadCompare } = await import('../../src/data/personal');
    await expect(loadCompare(scope, 'v1', fakeAuth([null]))).rejects.toMatchObject({ code: 'session_expired' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 429, headers: { 'retry-after': '30' } })));
    await expect(loadCompare(scope, 'v1', fakeAuth([]))).rejects.toMatchObject({ code: 'rate_limited', retryAfter: 30 });
  });

  it('rejects a response for another version or scope and any extra (private) field', async () => {
    const { acceptCompare } = await import('../../src/data/personal');
    const payload = await sample();
    expect(() => acceptCompare(payload, scope, 'v2')).toThrow(expect.objectContaining({ code: 'DATASET_CHANGED' }));
    expect(() => acceptCompare(payload, { ...scope, region_code: null }, 'v1')).toThrow(expect.objectContaining({ code: 'DATASET_CHANGED' }));
    expect(() => acceptCompare({ ...payload, viewer: { ...payload.viewer, user_id: 'x' } }, scope, 'v1')).toThrow(expect.objectContaining({ code: 'invalid_response' }));
    expect(() => acceptCompare({ ...payload, contributor_id: 'x' }, scope, 'v1')).toThrow(expect.objectContaining({ code: 'invalid_response' }));
    expect(acceptCompare(payload, scope, 'v1').mine.report_count).toBe(payload.mine.report_count);
  });
});

describe('source boundaries', () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(name)) files.push(path);
    }
  };
  walk(join(__dirname, '../../src'));
  const code = (path: string) => readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

  it('never calls the device relay or the account API from the map', () => {
    for (const file of files) expect(code(file), file).not.toMatch(/community-auth-relay|community-account|safeauth\.worklazy/);
  });

  it('never signs out globally or other sessions', () => {
    for (const file of files) expect(code(file), file).not.toMatch(/scope:\s*['"](global|others)['"]/);
  });

  // Contributor-only map (user decision 2026-09-27): the statistics client also sends the map session token,
  // still only to the configured analytics base URL, never with cookies.
  it('sends Authorization only from the two analytics clients, only to the analytics base URL', () => {
    const senders = files.filter((f) => /Authorization/.test(code(f)));
    expect(senders.map((f) => f.split('/src/')[1]).sort()).toEqual(['data/client.ts', 'data/personal.ts']);
    for (const f of ['client.ts', 'personal.ts']) {
      const src = code(join(__dirname, '../../src/data', f));
      expect(src).toMatch(/credentials: 'omit'/);
      expect(src).toMatch(/VITE_PUBLIC_ANALYTICS_URL/);
      expect(src).not.toMatch(/fetch\(\s*['"`]https?:/);
    }
  });

  it('keeps personal comparison out of share URLs', async () => {
    const { scopeToSearch } = await import('../../src/state/filters');
    const { DEMO_SCOPE } = await import('../../src/domain/public');
    const search = scopeToSearch(DEMO_SCOPE, { view: 'map' });
    expect(search).toContain('view=map');
    expect(search).not.toMatch(/compare|mine|me=|user|token/);
  });
});
