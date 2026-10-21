// App-update guidance (2026-10-21): the map web reads only its own GET /my-analytics/client-status (PROJECT_RULES 7)
// and shows nothing unless the server sends a notice. Server route + client decode + render rules + refresh policy.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createPersonalHandler, type PersonalDeps } from '../../server/personalHandler';
import { parseClientStatus } from '../../server/clientStatus';
import { acceptClientStatus, type ClientStatus } from '../../src/data/personal';
import ClientUpdateNotice, { ClientUpdateContext, dashboardNoticeVisible, gateNoticeVisible } from '../../src/components/ClientUpdateNotice';
import AccessGate from '../../src/components/AccessGate';
import type { AuthSnapshot } from '../../src/auth/mapAuth';
import { CLICK_REFRESH_MS, createClientStatusRefresher, FOCUS_REFRESH_MS } from '../../src/hooks/useClientUpdate';

const ORIGIN = 'https://safemap.worklazy.net';
const UID = '0b9a1d6e-2f4c-4d3a-9e8b-7c6d5e4f3a2b';
const SESSION = '11111111-2222-4333-8444-555555555555';
const PC = 'https://github.com/Fentanest/safetyreport/releases/latest';
const MOBILE = 'https://play.google.com/store/apps/details?id=com.fentanest.mysafetyreport';
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = (claims: Record<string, unknown> = {}) => `${b64({ alg: 'HS256' })}.${b64({ sub: UID, role: 'authenticated',
  aud: 'authenticated', iss: 'https://p.supabase.co/auth/v1', session_id: SESSION, is_anonymous: false, ...claims })}.sig`;
const notice = (url: { pc: string | null; mobile: string | null } = { pc: PC, mobile: MOBILE }, level = 'warning') => ({
  level, message: '서버가 보낸 안내 문구', min_version: { pc: '9.1.0', mobile: '9.2.0' }, url, deadline: null });
const rpcState = (over: Record<string, unknown> = {}) =>
  ({ consent: 'outdated', last_contract: 'community-ingest-v1', v1_connections: 1, v2_enabled: true, notice: notice(), ...over });

function setup(state: unknown = rpcState(), over: Partial<PersonalDeps> = {}, viewer: Record<string, unknown> = {}) {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const deps: PersonalDeps = {
    enabled: true, allowedOrigins: [ORIGIN], jwtIssuer: 'https://p.supabase.co/auth/v1',
    getUser: async () => ({ id: UID, isAnonymous: false }),
    rpc: async (name, args) => {
      calls.push([name, args]);
      if (name === 'internal_community_ingest_rate_limit') return true;
      if (name === 'internal_map_client_state') { if (state instanceof Error) throw state; return state; }
      if (name === 'internal_analytics_viewer') return { user_ok: true, kakao: true, session: true, contributor: 'active', ...viewer };
      throw new Error(`unexpected rpc ${name}`);
    },
    ...over,
  };
  return { handle: createPersonalHandler(deps), calls };
}
const req = (path = '/functions/v1/my-analytics/client-status', init: { method?: string; auth?: string | null; origin?: string | null } = {}) => {
  const headers: Record<string, string> = {};
  if (init.auth !== null) headers.authorization = init.auth ?? `Bearer ${token()}`;
  if (init.origin !== null) headers.origin = init.origin ?? ORIGIN;
  return new Request(`https://p.supabase.co${path}`, { method: init.method ?? 'GET', headers });
};

describe('GET /my-analytics/client-status (server)', () => {
  it('returns exactly the five fields of internal_map_client_state for the verified user only', async () => {
    const { handle, calls } = setup();
    const res = await handle(req());
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(res.headers.get('cache-control')).toContain('no-store');
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(['consent', 'last_contract', 'notice', 'v1_connections', 'v2_enabled']);
    expect(body).toEqual(rpcState());
    expect(calls.find(([n]) => n === 'internal_map_client_state')?.[1]).toEqual({ p_user: UID });
    // own rate bucket, separate from compare/statistics
    const bucket = calls.find(([n]) => n === 'internal_community_ingest_rate_limit')?.[1];
    expect(bucket?.p_limit).toBe(30);
    expect(String(bucket?.p_bucket)).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    ['no token', { auth: null }, 401, 'auth_required'],
    ['anonymous user', { auth: `Bearer ${token({ is_anonymous: true })}` }, 403, 'kakao_required'],
    ['foreign origin', { origin: 'https://evil.example' }, 403, 'origin_forbidden'],
    ['POST', { method: 'POST' }, 405, 'method_not_allowed'],
  ] as const)('refuses %s without reading the state', async (_n, init, status, code) => {
    const { handle, calls } = setup();
    const res = await handle(req(undefined, init));
    expect(res.status).toBe(status);
    expect((await res.json()).error.code).toBe(code);
    expect(calls.some(([n]) => n === 'internal_map_client_state')).toBe(false);
  });

  it('refuses query parameters (no user id or anything else is ever read from the request)', async () => {
    const { handle, calls } = setup();
    const res = await handle(req(`/functions/v1/my-analytics/client-status?user=${UID}`));
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('answers 429 when the per-user limit is spent', async () => {
    const { handle } = setup(rpcState(), { rpc: async () => false });
    expect((await handle(req())).status).toBe(429);
  });

  it.each([
    ['RPC missing (map migration not applied)', new Error('rpc PGRST202')],
    ['null', null],
    ['unknown consent', rpcState({ consent: 'maybe' })],
    ['negative v1 count', rpcState({ v1_connections: -1 })],
    ['v2_enabled not boolean', rpcState({ v2_enabled: 'yes' })],
  ])('answers 503 when the state is unusable: %s', async (_n, state) => {
    const res = await setup(state).handle(req());
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('30');
  });

  it('drops non-https links and an off-schema notice; never passes them to the page', async () => {
    let body = await (await setup(rpcState({ notice: notice({ pc: 'javascript:alert(1)', mobile: 'http://x.example/' }) })).handle(req())).json();
    expect(body.notice.url).toEqual({ pc: null, mobile: null });
    expect(body.notice.message).toBe('서버가 보낸 안내 문구');
    body = await (await setup(rpcState({ notice: { ...notice(), extra: 1 } })).handle(req())).json();
    expect(body.notice).toBeNull();
    body = await (await setup(rpcState({ notice: { ...notice(), level: 'urgent' } })).handle(req())).json();
    expect(body.notice).toBeNull();
  });

  it.each([
    ['suspended contributor', { contributor: 'suspended' }],
    ['ineligible account', { user_ok: false }],
    ['not a Kakao account', { kakao: false }],
  ])('never sends update text to a %s', async (_n, viewer) => {
    const res = await setup(rpcState({ consent: 'none' }), {}, viewer).handle(req());
    expect(res.status).toBe(200);
    expect((await res.json()).notice).toBeNull();
  });

  it('skips the viewer check when there is no notice', async () => {
    const { handle, calls } = setup(rpcState({ notice: null }));
    expect((await (await handle(req())).json()).notice).toBeNull();
    expect(calls.some(([n]) => n === 'internal_analytics_viewer')).toBe(false);
  });

  it('decoder keeps nullable last_contract and the schema', () => {
    expect(parseClientStatus(rpcState({ last_contract: null, notice: null }))?.last_contract).toBeNull();
    expect(parseClientStatus({ ...rpcState(), notice: undefined })?.notice).toBeNull();
  });
});

const status = (over: Partial<ClientStatus> = {}): ClientStatus =>
  acceptClientStatus({ ...rpcState(), ...over });
const render = (s: ClientStatus | null, audience: 'contributor' | 'consent') => renderToStaticMarkup(
  <ClientUpdateContext.Provider value={{ status: s, refresh: () => {} }}><ClientUpdateNotice audience={audience} /></ClientUpdateContext.Provider>);

describe('update notice rules (client)', () => {
  it('dashboard banner only with a notice, v2 enabled and an outdated consent or a v1 app', () => {
    expect(dashboardNoticeVisible(null)).toBe(false);
    expect(dashboardNoticeVisible(status())).toBe(true);
    expect(dashboardNoticeVisible(status({ consent: 'active', v1_connections: 1 }))).toBe(true);
    expect(dashboardNoticeVisible(status({ consent: 'outdated', v1_connections: 0 }))).toBe(true);
    expect(dashboardNoticeVisible(status({ consent: 'active', v1_connections: 0 }))).toBe(false);
    expect(dashboardNoticeVisible(status({ v2_enabled: false }))).toBe(false);
    expect(dashboardNoticeVisible(status({ notice: null }))).toBe(false);
  });

  it('consent gate only with a notice and a non-active consent (suspended/ineligible keep an active one)', () => {
    expect(gateNoticeVisible(status({ consent: 'none' }))).toBe(true);
    expect(gateNoticeVisible(status({ consent: 'revoked' }))).toBe(true);
    expect(gateNoticeVisible(status({ consent: 'active' }))).toBe(false);
    expect(gateNoticeVisible(status({ consent: 'none', notice: null }))).toBe(false);
  });

  it('renders the server message and only the links that exist, as new-tab links', () => {
    const html = render(status(), 'contributor');
    expect(html).toContain('서버가 보낸 안내 문구');
    expect(html).toContain('PC 9.1.0 이상');
    expect(html).toContain(`href="${PC}"`);
    expect(html).toContain(`href="${MOBILE}"`);
    expect(html.match(/target="_blank"/g)).toHaveLength(2);
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('aria-label="PC 앱 받기 (새 탭에서 열림)"');
    expect(html).toContain('class="external-mark" aria-hidden="true"');
    const pcOnly = render(status({ notice: { ...notice({ pc: PC, mobile: null }), level: 'warning' } as ClientStatus['notice'] }), 'contributor');
    expect(pcOnly).toContain('서버가 보낸 안내 문구');
    expect(pcOnly).toContain(`href="${PC}"`);
    expect(pcOnly).not.toContain('모바일 앱 받기');
    const none = render(status({ notice: { ...notice({ pc: null, mobile: null }) } as ClientStatus['notice'] }), 'contributor');
    expect(none).toContain('서버가 보낸 안내 문구');
    expect(none).not.toContain('<a ');
  });

  it('never renders unsafe links or built-in text', () => {
    const html = render(acceptClientStatus(rpcState({ notice: notice({ pc: 'javascript:alert(1)', mobile: 'http://x.example/' }) })), 'contributor');
    expect(html).not.toMatch(/javascript:|http:\/\//);
    expect(html).not.toContain('<a ');
    expect(render(status({ notice: null }), 'contributor')).toBe('');
    expect(render(null, 'consent')).toBe('');
    expect(render(status({ notice: null }), 'consent')).not.toMatch(/3\.6\.0|2\.5\.0/);
  });

  it('a required notice is announced as an alert', () => {
    expect(render(status({ notice: notice(undefined, 'required') as ClientStatus['notice'] }), 'contributor')).toContain('role="alert"');
  });
});

describe('AccessGate with the update notice', () => {
  const signedIn: AuthSnapshot = { status: 'signed_in', displayName: '예시 사용자', viewerId: null, synthetic: false, message: null };
  const gate = (s: ClientStatus | null, code: 'contributor_required' | 'upload_required' = 'contributor_required') => renderToStaticMarkup(
    <ClientUpdateContext.Provider value={{ status: s, refresh: () => {} }}>
      <AccessGate code={code} auth={signedIn} onSignIn={() => {}} onSignOut={() => {}} onRetry={() => {}} progress={{ required: 10, current: 3 }} />
    </ClientUpdateContext.Provider>);

  it('shows no update text without a server notice, and names the new consent', () => {
    const html = gate(status({ consent: 'none', notice: null }));
    expect(html).not.toContain('client-update-notice');
    expect(html).not.toMatch(/PC 3\.6\.0|모바일 2\.5\.0/);
    expect(html).toContain('[필수] 신고내용 공유 동의');
  });
  it('shows the server notice to an account without consent', () => {
    expect(gate(status({ consent: 'none' }))).toContain('서버가 보낸 안내 문구');
  });
  it('shows nothing to a suspended/ineligible account (active consent on the consent gate)', () => {
    expect(gate(status({ consent: 'active', v1_connections: 1 }))).not.toContain('client-update-notice');
  });
  it('upload gate follows the dashboard rule', () => {
    expect(gate(status(), 'upload_required')).toContain('서버가 보낸 안내 문구');
    expect(gate(status({ consent: 'active', v1_connections: 0 }), 'upload_required')).not.toContain('client-update-notice');
  });
});

describe('client-status refresh policy', () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));
  function harness(results: Array<ClientStatus | Error>) {
    let t = 1_000_000;
    const published: Array<ClientStatus | null> = [];
    let loads = 0;
    const r = createClientStatusRefresher({
      now: () => t, publish: (s) => published.push(s),
      load: async () => { const v = results[Math.min(loads++, results.length - 1)]; if (v instanceof Error) throw v; return v; },
    });
    return { r, published, loads: () => loads, advance: (ms: number) => { t += ms; } };
  }

  it('loads on sign-in, clears on sign-out, never loads while signed out', async () => {
    const h = harness([status()]);
    h.r.setViewer(null); h.r.refresh(); h.r.focus();
    expect(h.loads()).toBe(0);
    h.r.setViewer('a|s'); await flush();
    expect(h.loads()).toBe(1);
    expect(h.published.at(-1)).toEqual(status());
    h.r.setViewer(null);
    expect(h.published.at(-1)).toBeNull();
  });

  it('throttles focus to once a minute and clicks to every few seconds', async () => {
    const h = harness([status()]);
    h.r.setViewer('a|s'); await flush();
    h.r.focus(); expect(h.loads()).toBe(1);
    h.advance(CLICK_REFRESH_MS); h.r.refresh(); await flush(); expect(h.loads()).toBe(2);
    h.r.refresh(); expect(h.loads()).toBe(2);
    h.advance(FOCUS_REFRESH_MS - 1); h.r.focus(); expect(h.loads()).toBe(2);
    h.advance(1); h.r.focus(); await flush(); expect(h.loads()).toBe(3);
  });

  it('a failed refresh keeps the last answer', async () => {
    const h = harness([status(), new Error('503')]);
    h.r.setViewer('a|s'); await flush();
    h.advance(FOCUS_REFRESH_MS); h.r.focus(); await flush();
    expect(h.loads()).toBe(2);
    expect(h.published.at(-1)).toEqual(status());
  });

  it('drops a late answer that belongs to the previous account', async () => {
    let release: (s: ClientStatus) => void = () => {};
    const published: Array<ClientStatus | null> = [];
    const r = createClientStatusRefresher({ publish: (s) => published.push(s),
      load: () => new Promise<ClientStatus>((res) => { release = res; }) });
    r.setViewer('a|s');
    const first = release;
    r.setViewer('b|s');
    first(status()); await flush();
    expect(published).toEqual([null, null]);
    r.dispose();
  });
});
