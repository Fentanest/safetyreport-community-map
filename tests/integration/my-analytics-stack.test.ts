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
async function kakaoSession(choice: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'I'): Promise<Session> {
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

// 동의문은 중앙 `policy` 로 받는다(2026-09-27) — 받은 본문의 해시를 직접 계산해 그 버전·해시로 동의한다(앱과 같은 방식).
// 계약 폴더에 동의문 사본을 두지 않는다. beforeAll 이 채운다.
let POLICY = '';
let CONSENT_HASH = '';
async function loadPolicy() {
  const s = await kakaoSession('A');
  const r = await account('policy', s.access);
  expect(r.status).toBe(200);
  const p = r.json.policy as { version: string; consent_text_sha256: string; consent_text: string };
  expect(createHash('sha256').update(p.consent_text, 'utf8').digest('hex')).toBe(p.consent_text_sha256);
  POLICY = p.version;
  CONSENT_HASH = p.consent_text_sha256;
}

interface Writer { session: Session; connectionId: string; epoch: number; grantId: string; revision: number }
async function writer(choice: 'A' | 'B' | 'C' | 'D' | 'E' | 'G' | 'I'): Promise<Writer> {
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
// The map is contributor-only (2026-09-28): statistics are read as E, a Kakao user with an active share consent
// and at least 10 distinct publicly-listed reports on the map.
let viewerToken: string | null = null;
async function viewer(): Promise<string> {
  if (!viewerToken) {
    const w = await writer('E');
    const uploaded = await ingest(w, 10);
    expect(uploaded.status, JSON.stringify(uploaded.json)).toBe(200);
    expect(uploaded.json.results).toHaveLength(10);
    expect(uploaded.json.results.every((result: Json) => result.projection_status === 'published')).toBe(true);
    viewerToken = w.session.access;
  }
  return viewerToken;
}
const publicGet = async (path: string, token?: string | null, origin?: string) =>
  call('GET', `/functions/v1/public-analytics/${path}`, { apikey: null, token: token === undefined ? await viewer() : token,
    headers: origin ? { origin } : {} });
const publicDashboard = () => publicGet(`dashboard?${SCOPE}`);

describe.skipIf(!enabled)('my-analytics on the composed local stack', () => {
  beforeAll(async () => {
    keys = JSON.parse(execFileSync('npx', ['supabase', 'status', '-o', 'json', '--workdir', '.integration-stack'], { encoding: 'utf8' }));
    sql('delete from private.rate_limits;');
    sql('update private.analytics_state set ready = true, published_at = coalesce(published_at, now()), data_max = null, data_min = null where singleton;');
    await loadPolicy();
  }, 120_000);

  it('returns all = the public numbers and mine = only the verified user, from one version', async () => {
    const c = await writer('C');
    const d = await writer('D');
    const mapC = await kakaoSession('C');
    const mapD = await kakaoSession('D');
    // Both suites share one stack DB and the fixed mock Kakao identities, so earlier suites may
    // already hold C/D contributions. Record the priors and assert per-user deltas (+2 for C, +3 for D).
    const mineCount = (uid: string) => Number(sql(`select count(*) from jsonb_array_elements(public.internal_analytics_v2_facts(date '2024-01-01', date '2026-09-27', 'all', null, null, null, null)) e where e->>'contributor_id' = '${uid}' and (e->>'report_date')::date between '2024-01-01' and '2026-09-27';`));
    const cPrior = mineCount(mapC.userId);
    const dPrior = mineCount(mapD.userId);
    expect((await ingest(c, 2)).status).toBe(200);
    expect((await ingest(d, 3)).status).toBe(200);
    const pub = await publicDashboard();
    expect(pub.status).toBe(200);
    const r = await compare(mapC.access, `&expected_version=${pub.json.dataset_version}`);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.dataset_version).toBe(pub.json.dataset_version);
    expect(r.json.all.report_count).toBe(pub.json.overview.report_count.value);
    expect(r.json.all.completed_count).toBe(pub.json.overview.completed_count.value);
    const cFacts = mineCount(mapC.userId);
    expect(cFacts).toBe(cPrior + 2);
    expect(r.json.mine.report_count).toBe(cFacts);
    expect(r.json.mine.report_count).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(r.json)).not.toContain(mapC.userId);
    expect(JSON.stringify(r.json)).not.toContain(d.session.userId);
    expect(r.headers.get('cache-control')).toBe('private, no-store, max-age=0');
    // The local Kong gateway rewrites Access-Control-Allow-Origin to '*' for every function; the handler's own
    // origin allowlist (403 below) is the enforced control. Hosted gateway CORS is recorded as NOT verified.
    expect([MAP_ORIGIN, '*']).toContain(r.headers.get('access-control-allow-origin'));
    const rd = await compare(mapD.access);
    expect(rd.json.all).toEqual(r.json.all);
    expect(rd.json.mine.report_count).toBe(dPrior + 3);
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
  it('releases fine amounts only while the current grant of the lineage publishes them (2026-09-28.1 does)', async () => {
    const a = await writer('A');
    expect((await ingest(a, 2)).status).toBe(200); // accepted_fine vectors: 40,000원 each
    const facts = "public.internal_analytics_v2_facts(date '2024-01-01', date '2026-09-27', 'all', null, null, null, null)";
    const released = () => Number(sql(`select count(*) from jsonb_array_elements(${facts}) e where e->'amount_confirmed_won' <> 'null'::jsonb;`));
    const stated = Number(sql(`select count(*) from jsonb_array_elements(${facts}) e where (e->>'amount_stated')::boolean;`));
    expect(sql(`select amounts_public from private.community_policy_disclosures where version = '${POLICY}';`)).toBe('t');
    expect(stated).toBeGreaterThanOrEqual(2);
    expect(released()).toBe(stated);
    // each step reads a scope not asked before, so no cached answer hides the change
    const offScope = 'start=2024-01-01&end=2026-09-27&category=parking';
    const onScope = 'start=2024-01-02&end=2026-09-27&category=parking';
    try {
      // publication switched off: no value leaves the database, the public side counts them as undisclosed
      sql(`update private.community_policy_disclosures set amounts_public = false where version = '${POLICY}';`);
      expect(released()).toBe(0);
      const off = await publicGet(`dashboard?${offScope}`);
      expect(off.status).toBe(200);
      expect(off.json.overview.fine_amount).toMatchObject({ confirmed_count: 0, sum_won: null, mean_won: null });
      expect(off.json.overview.fine_amount.undisclosed_count).toBeGreaterThanOrEqual(2);
      expect(JSON.stringify(off.json)).not.toMatch(/40000|amount_confirmed_won|amount_public/);
    } finally {
      sql(`update private.community_policy_disclosures set amounts_public = true where version = '${POLICY}';`);
    }
    expect(released()).toBe(stated);
    const after = await publicGet(`dashboard?${onScope}`);
    expect(after.status).toBe(200);
    const fa = after.json.overview.fine_amount;
    expect(fa.confirmed_count).toBeGreaterThanOrEqual(2);
    expect(fa.sum_won).toBe(40000 * fa.confirmed_count);
    const mapA = await kakaoSession('A');
    const mine = await call('GET', `/functions/v1/my-analytics/compare?${onScope}&expected_version=${after.json.dataset_version}`, { token: mapA.access, headers: { origin: MAP_ORIGIN } });
    expect(mine.status, JSON.stringify(mine.json)).toBe(200);
    expect(mine.json.all.fine_amount).toMatchObject({ confirmed_count: fa.confirmed_count, sum_won: fa.sum_won });
    expect(mine.json.mine.fine_amount.sum_won).toBeLessThanOrEqual(fa.sum_won);
  });
  it('contributor-only map: no sign-in → 401; no consent, zero or nine reports → 403; ten reports → 200', async () => {
    for (const path of ['meta', `dashboard?${SCOPE}`, `map?${SCOPE}`, `entities?${SCOPE}&kind=agency`]) {
      const r = await publicGet(path, null);
      expect([r.status, r.json.error?.code], path).toEqual([401, 'auth_required']);
    }
    const f = await kakaoSession('F'); // Kakao sign-in, never consented to share
    const refused = await publicGet('meta', f.access);
    expect([refused.status, refused.json.error?.code]).toEqual([403, 'contributor_required']);
    expect(JSON.stringify(refused.json)).not.toMatch(/dataset_version|report_count/);
    // I belongs to this suite only. Clear its local contributions so repeated runs still test exactly 9 → 10.
    const prior = await kakaoSession('I');
    const cleared = await account('contributions-delete', prior.access, { confirm: 'DELETE_MY_SHARED_REPORTS' });
    expect(cleared.status, JSON.stringify(cleared.json)).toBe(200);
    const i = await writer('I');
    const noUpload = await publicGet('meta', i.session.access);
    expect([noUpload.status, noUpload.json.error?.code]).toEqual([403, 'upload_required']);
    expect(noUpload.json.error.details).toEqual({ required: 10, current: 0 });
    const nine = await ingest(i, 9);
    expect(nine.status, JSON.stringify(nine.json)).toBe(200);
    expect(nine.json.results).toHaveLength(9);
    expect(nine.json.results.every((result: Json) => result.projection_status === 'published')).toBe(true);
    const short = await publicGet('meta', i.session.access);
    expect([short.status, short.json.error?.code]).toEqual([403, 'upload_required']);
    expect(short.json.error.details).toEqual({ required: 10, current: 9 });
    const tenth = await ingest(i, 1);
    expect(tenth.json.results?.[0]?.projection_status, JSON.stringify(tenth.json)).toBe('published');
    expect((await publicGet('meta', i.session.access)).status).toBe(200);
    const ok = await publicGet('meta', undefined, MAP_ORIGIN);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('cache-control')).toBe('private, no-store, max-age=0');
    expect((await publicGet('meta', undefined, 'https://evil.example')).status).toBe(403);
    expect((await publicGet('meta', 'not.a.jwt')).status).toBe(401);
  });
});
