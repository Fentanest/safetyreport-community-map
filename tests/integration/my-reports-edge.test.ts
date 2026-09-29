// my-reports through the REAL Edge entry (supabase/functions/my-reports/index.ts) under the Deno CLI behind the local
// gateway (scripts/integration/deno_functions.mjs, "deno-local" — NOT Supabase's edge-runtime, NOT production; the
// gateway's verify_jwt step is not reproduced, the handler's own checks are). Kakao = local mock OAuth
// (scripts/integration/mock_kakao.mjs), so J/K sign in through GoTrue's real Kakao provider flow.
//   COMMUNITY_STACK=1 COMMUNITY_API_URL=http://127.0.0.1:56999 COMMUNITY_MOCK_KAKAO_HOST=127.0.0.1 \
//     npx vitest run tests/integration/my-reports-edge.test.ts
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hex, insertFacts, lit, sql, stackKeys, type StackKeys, type TestUser } from './helpers/myReportsSeed';
import { ADDR, V, V_B_ONLY, scenarioA, scenarioB } from './helpers/myReportsScenario';
import { validate } from '../product/helpers/jsonSchema';
import schema from '../../contracts/my-reports/my-reports-v1.schema.json';

const enabled = process.env.COMMUNITY_STACK === '1';
const API = process.env.COMMUNITY_API_URL ?? 'http://127.0.0.1:56999';
const MOCK_KAKAO_HOST = process.env.COMMUNITY_MOCK_KAKAO_HOST ?? '172.17.0.1';
const REDIRECT = 'http://127.0.0.1:56480/callback.html';
// the composed stack's MY_REPORTS_ALLOWED_ORIGINS (migration-manifest staging.function_env)
const ORIGIN = 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

type Json = Record<string, any>;
let keys: StackKeys;
const b64url = (b: Buffer) => b.toString('base64url');

async function kakao(choice: 'J' | 'K'): Promise<TestUser> {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const step1 = await fetch(`${API}/auth/v1/authorize?${new URLSearchParams({ provider: 'kakao', redirect_to: REDIRECT, code_challenge: challenge, code_challenge_method: 's256' })}`, { redirect: 'manual' });
  const k = new URL(step1.headers.get('location')!);
  k.hostname = MOCK_KAKAO_HOST;
  const decide = new URL('/oauth/decide', k);
  decide.search = new URLSearchParams({ state: k.searchParams.get('state')!, choice }).toString();
  const step2 = await fetch(decide, { redirect: 'manual' });
  const step3 = await fetch(step2.headers.get('location')!, { redirect: 'manual' });
  const code = new URL(step3.headers.get('location')!).searchParams.get('code');
  const res = await fetch(`${API}/auth/v1/token?grant_type=pkce`, { method: 'POST',
    headers: { apikey: keys.ANON_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ auth_code: code, code_verifier: verifier }) });
  const j = await res.json();
  expect(res.status, JSON.stringify(j)).toBe(200);
  const claims = JSON.parse(Buffer.from(j.access_token.split('.')[1], 'base64url').toString('utf8'));
  return { id: claims.sub, session: claims.session_id, token: j.access_token, email: '', password: '', grant: '', lineage: '' };
}

/** Fresh own-scope state for a mock Kakao user: only the rows this test seeds. */
function resetAccount(u: TestUser) {
  sql(`delete from private.community_report_facts where contributor_id = '${u.id}';
    delete from private.community_consent_grants where user_id = '${u.id}';
    delete from private.contributor_profiles where user_id = '${u.id}';`);
  u.grant = randomUUID();
  u.lineage = randomUUID();
  sql(`insert into private.contributor_profiles (user_id, consent_version, privacy_policy_version) values ('${u.id}', '2026-09-28.3', '2026-09-28.3');
    insert into private.community_consent_grants (grant_id, lineage_id, user_id, policy_version, consent_text_sha256, granted_via, granted_session_id)
    values ('${u.grant}', '${u.lineage}', '${u.id}', '2026-09-28.3', '${'a'.repeat(64)}', 'safetyreport_server', '${randomUUID()}');`);
}

async function call(route: string, body: unknown, token: string | null, opts: { origin?: string | null; method?: string } = {}) {
  const headers: Record<string, string> = { apikey: keys.ANON_KEY, 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (opts.origin !== null) headers.origin = opts.origin ?? ORIGIN;
  const method = opts.method ?? 'POST';
  const res = await fetch(`${API}/functions/v1/my-reports/${route}`, { method, headers, body: method === 'POST' ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json: Json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  return { status: res.status, json, headers: res.headers, bytes: Buffer.byteLength(text) };
}
const ref = (name: string) => ({ $ref: `#/$defs/${name}`, $defs: (schema as Json).$defs });

describe.skipIf(!enabled)('my-reports Edge function (deno-local gateway, mock Kakao OAuth)', () => {
  let J: TestUser, K: TestUser;
  beforeAll(async () => {
    keys = stackKeys();
    sql('delete from private.rate_limits;');
    J = await kakao('J');
    K = await kakao('K');
    resetAccount(J);
    resetAccount(K);
    // Kakao identity came from GoTrue's real provider flow (not inserted by the test)
    expect(sql(`select provider from auth.identities where user_id = '${J.id}'`)).toBe('kakao');
    const revoked = randomUUID();
    sql(`insert into private.community_consent_grants (grant_id, lineage_id, user_id, policy_version, consent_text_sha256, granted_via, granted_session_id, revoked_at)
         values ('${revoked}', '${randomUUID()}', '${J.id}', '2026-09-28.3', '${'a'.repeat(64)}', 'mobile_client', '${randomUUID()}', now());`);
    insertFacts([...scenarioA(J, revoked), ...scenarioB(K)]);
  }, 120000);
  afterAll(() => {
    if (J) resetAccount(J);
    if (K) resetAccount(K);
    sql(`delete from private.community_consent_grants where user_id in (${[J, K].filter(Boolean).map((u) => lit(u.id)).join(',') || 'null'});`);
  });

  it('preflight and CORS from the configured extension origin only', async () => {
    const pre = await call('search', undefined, null, { method: 'OPTIONS' });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(pre.headers.get('access-control-allow-methods')).toBe('POST, OPTIONS');
    expect(pre.headers.get('access-control-allow-headers')).toContain('authorization');
    const other = await call('summary', {}, J.token, { origin: 'chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' });
    expect(other.status).toBe(403);
    expect(other.headers.get('access-control-allow-origin')).toBeNull();
    const noAuth = await call('summary', {}, null);
    expect(noAuth.status).toBe(401);
    expect(noAuth.json.error).toMatchObject({ code: 'AUTH_REQUIRED', retryable: false });
    expect(noAuth.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    const onlyKey = await call('summary', {}, keys.ANON_KEY);
    expect(onlyKey.status).toBe(401);
  });

  it('a Kakao-signed-in extension session reads its own reports (search, next page, managers, summary, numbers)', async () => {
    const s = await call('search', { kind: 'vehicle', query: '12 가 3456', page_size: 3, managers_page_size: 1 }, J.token);
    expect(s.status).toBe(200);
    expect(validate(ref('SearchResponse'), s.json)).toEqual([]);
    expect(s.headers.get('cache-control')).toBe('private, no-store, max-age=0');
    expect(s.headers.get('vary')).toBe('Origin, Authorization');
    expect(s.json.summary.total).toBe(10);
    const next = await call('search', { kind: 'vehicle', query: V, cursor: s.json.reports.next_cursor }, J.token);
    expect(next.status).toBe(200);
    expect(next.json.reports.offset).toBe(3);
    const m = await call('search', { kind: 'vehicle', query: V, part: 'managers', cursor: s.json.managers.next_cursor }, J.token);
    expect(m.status).toBe(200);
    expect(m.json.managers.items[0].manager_name).toBe('김담당');
    const sum = await call('summary', {}, J.token);
    expect(sum.status).toBe(200);
    expect(validate(ref('SummaryResponse'), sum.json)).toEqual([]);
    expect(sum.json.summary.total).toBe(12);
    let n = await call('numbers', { kind: 'vehicle', query: V, page_size: 5 }, J.token);
    const all = [...n.json.items];
    while (n.json.next_cursor) { n = await call('numbers', { kind: 'vehicle', query: V, cursor: n.json.next_cursor }, J.token); all.push(...n.json.items); }
    expect(new Set(all).size).toBe(9);
    expect(n.json.complete).toBe(true);
  });

  it('A/B isolation through the Edge: K’s plate/address never reach J, J’s cursor is refused for K', async () => {
    const other = await call('search', { kind: 'vehicle', query: V_B_ONLY }, J.token);
    expect(other.json.summary.total).toBe(0);
    const addr = await call('search', { kind: 'address', query: ADDR }, J.token);
    expect(JSON.stringify(addr.json)).not.toContain('이담당');
    const first = await call('search', { kind: 'vehicle', query: V, page_size: 2 }, J.token);
    const stolen = await call('search', { kind: 'vehicle', query: V, cursor: first.json.reports.next_cursor }, K.token);
    expect(stolen.json.error.code).toBe('INVALID_CURSOR');
    const injected = await call('summary', { user_id: J.id }, K.token);
    expect(injected.json.error.code).toBe('INVALID_REQUEST');
  });

  it('logout of one session (revoked) stops that token; the other Kakao session keeps working', async () => {
    const second = await kakao('J');
    expect(second.session).not.toBe(J.session);
    sql(`delete from auth.sessions where id = '${second.session}'`);
    expect((await call('summary', {}, second.token)).status).toBe(401);
    expect((await call('summary', {}, J.token)).status).toBe(200);
  });

  it('data change between pages → 409 DATASET_CHANGED through the Edge', async () => {
    const first = await call('search', { kind: 'vehicle', query: V, page_size: 2 }, J.token);
    sql(`update private.community_report_facts set rating = 3 where contributor_id = '${J.id}' and source_report_key = '${hex('key|R1')}'`);
    const next = await call('search', { kind: 'vehicle', query: V, cursor: first.json.reports.next_cursor }, J.token);
    expect(next.status).toBe(409);
    expect(next.json.error).toMatchObject({ code: 'DATASET_CHANGED', retryable: true });
  });
});
