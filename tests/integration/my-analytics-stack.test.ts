// Real local-stack tests for the personal comparison (my-analytics) on the composed project ci0926-int:
// real Postgres 17 + GoTrue + PostgREST + edge-runtime, Kakao = local mock (scripts/integration/mock_kakao.mjs).
// NOT a hosted Kakao or production check. Run exactly like tests/integration/community-stack.test.ts
// (compose → supabase start → mock_kakao → functions serve), then:
//   COMMUNITY_STACK=1 npx vitest run tests/integration/my-analytics-stack.test.ts
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { canonicalJson, sha256Hex } from '../../server/ingest/observation';

const enabled = process.env.COMMUNITY_STACK === '1';
const API = process.env.COMMUNITY_API_URL ?? 'http://127.0.0.1:56321';
const DB_CONTAINER = process.env.COMMUNITY_DB_CONTAINER ?? 'supabase_db_ci0926-int';
const MOCK_KAKAO_HOST = process.env.COMMUNITY_MOCK_KAKAO_HOST ?? '172.17.0.1';
const REDIRECT = 'http://127.0.0.1:56480/callback.html';
const MAP_ORIGIN = 'http://127.0.0.1:56490';
const POLICY = '2026-09-26.1';
const CONSENT_HASH = readFileSync(new URL('../../contracts/community-ingest/consent/share-consent-2026-09-26.1.sha256', import.meta.url), 'utf8').split(/\s/)[0];
const vectors = JSON.parse(readFileSync(new URL('../../contracts/community-ingest/vectors/observations.json', import.meta.url), 'utf8'));
const payloadOf = (name: string) => structuredClone(vectors.cases.find((c: { name: string }) => c.name === name).expected_payload);

type Json = Record<string, any>;
let keys: { PUBLISHABLE_KEY: string; SERVICE_ROLE_KEY: string };

function sql(query: string): string {
  return execFileSync('docker', ['exec', '-i', DB_CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-tAq', '-v', 'ON_ERROR_STOP=1'],
    { input: query, encoding: 'utf8' }).trim();
}

async function call(method: string, path: string, { token, body, headers = {}, apikey }: { token?: string | null; body?: unknown; headers?: Record<string, string>; apikey?: string | null } = {}) {
  const h: Record<string, string> = { ...headers };
  if (apikey !== null) h.apikey = apikey ?? keys.PUBLISHABLE_KEY;
  if (token) h.authorization = `Bearer ${token}`;
  if (body !== undefined) h['content-type'] = 'application/json';
  const res = await fetch(`${API}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json: Json = {};
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json, headers: res.headers };
}

interface Session { access: string; userId: string; sessionId: string }
const b64url = (b: Buffer) => b.toString('base64url');
const toSession = (j: Json): Session => {
  const claims = JSON.parse(Buffer.from(j.access_token.split('.')[1], 'base64url').toString('utf8'));
  return { access: j.access_token, userId: claims.sub, sessionId: claims.session_id };
};

/** A separate Kakao login = a separate GoTrue session (the app's session and the map's session are distinct). */
async function kakaoSession(choice: 'A' | 'B' | 'C' | 'D'): Promise<Session> {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const step1 = await fetch(`${API}/auth/v1/authorize?${new URLSearchParams({ provider: 'kakao', redirect_to: REDIRECT, code_challenge: challenge, code_challenge_method: 's256' })}`, { redirect: 'manual' });
  const kakao = new URL(step1.headers.get('location')!);
  kakao.hostname = MOCK_KAKAO_HOST;
  const decide = new URL('/oauth/decide', kakao);
  decide.search = new URLSearchParams({ state: kakao.searchParams.get('state')!, choice }).toString();
  const step2 = await fetch(decide, { redirect: 'manual' });
  const step3 = await fetch(step2.headers.get('location')!, { redirect: 'manual' });
  const code = new URL(step3.headers.get('location')!).searchParams.get('code');
  const token = await call('POST', '/auth/v1/token?grant_type=pkce', { body: { auth_code: code, code_verifier: verifier } });
  expect(token.status).toBe(200);
  return toSession(token.json);
}

const account = (action: string, token: string, body: Json = {}) =>
  call('POST', `/functions/v1/community-account/${action}`, { token, body: { protocol: 1, ...body } });

interface Writer { session: Session; connectionId: string; epoch: number; grantId: string; revision: number }
async function writer(choice: 'A' | 'B' | 'C' | 'D'): Promise<Writer> {
  const session = await kakaoSession(choice);
  const st = await account('status', session.access);
  const grant = await account('consent', session.access, { policy_version: POLICY, consent_text_sha256: CONSENT_HASH, via: 'safetyreport_server', accepted: true });
  expect(grant.status, JSON.stringify(grant.json)).toBe(200);
  const reg = await account('connections', session.access, { source_app: 'safetyreport', source_mode: 'server', platform: 'linux',
    device_label: 'my-analytics 통합', dataset_key: createHash('sha256').update(`safetyreport-dataset|v1|ma-${randomUUID()}`).digest('hex'),
    connection_secret: b64url(randomBytes(32)), takeover: st.json.connection != null });
  expect(reg.status, JSON.stringify(reg.json)).toBe(200);
  return { session, connectionId: reg.json.connection_id, epoch: reg.json.writer_epoch, grantId: grant.json.grant_id, revision: 0 };
}

async function ingest(w: Writer, n: number, token = w.session.access) {
  const events = [];
  for (let i = 0; i < n; i++) {
    const payload = payloadOf('accepted_fine');
    w.revision += 1;
    events.push({ event_id: randomUUID(), event_type: 'completed_observation', source_system: 'safetyreport',
      source_report_id: `MA${randomBytes(6).toString('hex')}`, source_revision: w.revision, writer_epoch: w.epoch,
      captured_at: new Date().toISOString(), payload, payload_sha256: await sha256Hex(canonicalJson(payload)) });
  }
  return call('POST', '/functions/v1/community-ingest', { token, body: { protocol: 1, contract: 'community-ingest-v1',
    source_app: 'safetyreport', source_mode: 'server', connection_id: w.connectionId, consent_grant_id: w.grantId, policy_version: POLICY,
    client_version: 'it-1', parser_version: 'pc-parser-1', trigger: 'manual', events } });
}

const SCOPE = 'start=2024-01-01&end=2026-09-27&category=all';
const compare = (token: string | null, extra = '', origin = MAP_ORIGIN) =>
  call('GET', `/functions/v1/my-analytics/compare?${SCOPE}${extra}`, { token, headers: { origin } });
const publicDashboard = () => call('GET', `/functions/v1/public-analytics/dashboard?${SCOPE}`, { apikey: null });

describe.skipIf(!enabled)('my-analytics on the composed local stack', () => {
  beforeAll(async () => {
    keys = JSON.parse(execFileSync('npx', ['supabase', 'status', '-o', 'json', '--workdir', '.integration-stack'], { encoding: 'utf8' }));
    sql('delete from private.rate_limits;');
    sql('update private.analytics_state set ready = true, published_at = coalesce(published_at, now()), data_max = null, data_min = null where singleton;');
  }, 120_000);

  it('returns all = the anonymous public numbers and mine = only the verified user, from one version', async () => {
    const c = await writer('C');
    const d = await writer('D');
    expect((await ingest(c, 2)).status).toBe(200);
    expect((await ingest(d, 3)).status).toBe(200);
    const pub = await publicDashboard();
    expect(pub.status).toBe(200);
    const mapC = await kakaoSession('C');
    const r = await compare(mapC.access, `&expected_version=${pub.json.dataset_version}`);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.dataset_version).toBe(pub.json.dataset_version);
    expect(r.json.all.report_count).toBe(pub.json.overview.report_count.value);
    expect(r.json.all.completed_count).toBe(pub.json.overview.completed_count.value);
    const cFacts = Number(sql(`select count(*) from jsonb_array_elements(public.internal_analytics_v2_facts(date '2024-01-01', date '2026-09-27', 'all', null, null, null, null)) e where e->>'contributor_id' = '${mapC.userId}' and (e->>'report_date')::date between '2024-01-01' and '2026-09-27';`));
    expect(r.json.mine.report_count).toBe(cFacts);
    expect(r.json.mine.report_count).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(r.json)).not.toContain(mapC.userId);
    expect(JSON.stringify(r.json)).not.toContain(d.session.userId);
    expect(r.headers.get('cache-control')).toBe('private, no-store, max-age=0');
    // The local Kong gateway rewrites Access-Control-Allow-Origin to '*' for every function; the handler's own
    // origin allowlist (403 below) is the enforced control. Hosted gateway CORS is recorded as NOT verified.
    expect([MAP_ORIGIN, '*']).toContain(r.headers.get('access-control-allow-origin'));
    const mapD = await kakaoSession('D');
    const rd = await compare(mapD.access);
    expect(rd.json.all).toEqual(r.json.all);
    expect(rd.json.mine.report_count).not.toBe(r.json.mine.report_count);
  });

  it('answers 409 for a stale public version and refuses foreign origins', async () => {
    const s = await kakaoSession('C');
    expect((await compare(s.access, '&expected_version=not-the-current-version')).status).toBe(409);
    const foreign = await compare(s.access, '', 'https://evil.example');
    expect(foreign.status).toBe(403);
    expect(foreign.json.error.code).toBe('origin_forbidden');
    expect(JSON.stringify(foreign.json)).not.toMatch(/report_count|mine/);
  });

  it('refuses anonymous callers, keys as bearer, Supabase anonymous and non-Kakao users', async () => {
    expect((await compare(null)).status).toBe(401);
    expect((await compare(keys.PUBLISHABLE_KEY)).status).toBe(401);
    const anon = await call('POST', '/auth/v1/signup', { body: {} });
    expect([401, 403]).toContain((await compare(anon.json.access_token)).status);
    const email = `ma-${randomUUID()}@example.invalid`, password = `Pw-${randomUUID()}`;
    await call('POST', '/auth/v1/admin/users', { token: keys.SERVICE_ROLE_KEY, apikey: keys.SERVICE_ROLE_KEY, body: { email, password, email_confirm: true } });
    const login = await call('POST', '/auth/v1/token?grant_type=password', { body: { email, password } });
    const r = await compare(login.json.access_token);
    expect(r.status).toBe(403);
    expect(r.json.error.code).toBe('kakao_required');
  });

  it('keeps the source RPC service_role-only', async () => {
    const body = { p_user: randomUUID(), p_session: randomUUID(), p_start: '2026-01-01', p_end: '2026-01-31', p_category: 'all',
      p_region_code: null, p_agency_key: null, p_manager_key: null, p_bbox: null };
    const asAnon = await call('POST', '/rest/v1/rpc/internal_my_analytics_source', { body });
    expect(asAnon.status).toBeGreaterThanOrEqual(400);
    const user = await kakaoSession('C');
    const asUser = await call('POST', '/rest/v1/rpc/internal_my_analytics_source', { token: user.access, body });
    expect(asUser.status).toBeGreaterThanOrEqual(400);
    expect(sql(`select has_function_privilege('authenticated', 'public.internal_my_analytics_source(uuid,uuid,date,date,text,text,text,text,double precision[])', 'execute')`)).toBe('f');
    expect(sql(`select has_function_privilege('anon', 'public.internal_my_analytics_source(uuid,uuid,date,date,text,text,text,text,double precision[])', 'execute')`)).toBe('f');
  });

  it('map logout with scope=local ends only the map session; the app upload session keeps working', async () => {
    const app = await writer('B');                  // the app/server session bound to the upload connection
    const map = await kakaoSession('B');            // the map web login of the same Kakao user
    expect(map.sessionId).not.toBe(app.session.sessionId);
    expect((await compare(map.access)).status).toBe(200);
    const out = await call('POST', '/auth/v1/logout?scope=local', { token: map.access });
    expect(out.status).toBe(204);
    expect((await compare(map.access)).status).toBe(401);            // map session gone
    const after = await ingest(app, 1);                                // automatic upload still accepted
    expect(after.status, JSON.stringify(after.json)).toBe(200);
    expect(after.json.results[0].status).toBe('accepted');
    // Contrast (why the map never uses it): a global logout from the map would revoke the app's bound session too.
    const map2 = await kakaoSession('B');
    expect((await call('POST', '/auth/v1/logout?scope=global', { token: map2.access })).status).toBe(204);
    const broken = await ingest(app, 1);
    expect(broken.status).not.toBe(200);
  });
});
