// F04 맞춤 통계 on real function code over a real local database: catalog / candidates / query (public-analytics) and
// 내 신고 / 비교 (my-analytics statistics), auth refusals, and the frontend's own response schemas (the contract).
// Stack: the composed local project (Postgres 17 + GoTrue + PostgREST + Kong) with the functions served either by the
// edge-runtime container or by scripts/integration/deno_functions.mjs (Deno CLI + local gateway). Kakao = local mock.
// NOT a hosted or production check.
//   COMMUNITY_STACK=1 COMMUNITY_API_URL=http://127.0.0.1:56999 npx vitest run --no-file-parallelism tests/integration/statistics-edge.test.ts
//   (sequential: the suites share one database, and a parallel upload changes the dataset version under another suite)
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { canonicalJson, sha256Hex } from '../../server/ingest/observation';
import { candidatesSchema, catalogSchema, statisticsResultSchema } from '../../src/data/statistics';
import { dashboardResponseSchema, lawsResponseSchema } from '../../src/data/schema';
import { personalCompareSchema } from '../../src/data/personal';

const enabled = process.env.COMMUNITY_STACK === '1';
const API = process.env.COMMUNITY_API_URL ?? 'http://127.0.0.1:56321';
const MOCK_KAKAO_HOST = process.env.COMMUNITY_MOCK_KAKAO_HOST ?? '172.17.0.1';
const REDIRECT = 'http://127.0.0.1:56480/callback.html';
const MAP_ORIGIN = 'http://127.0.0.1:56490';
const STACK_DIR = process.env.COMMUNITY_STACK_DIR ?? '.integration-stack';
const vectors = JSON.parse(readFileSync(new URL('../../contracts/community-ingest/vectors/observations.json', import.meta.url), 'utf8'));
const payloadOf = (name: string) => structuredClone(vectors.cases.find((c: { name: string }) => c.name === name).expected_payload);
type Json = Record<string, any>;

function publishableKey(): string {
  const env = readFileSync(`${STACK_DIR}/supabase/functions/.env`, 'utf8');
  const fromEnv = /^SUPABASE_PUBLISHABLE_KEY=(.+)$/m.exec(env)?.[1];
  if (fromEnv) return fromEnv.replace(/^"|"$/g, '');
  const secrets = JSON.parse(readFileSync(`${STACK_DIR}/.stack-secrets.json`, 'utf8'));
  return secrets.PUBLISHABLE_KEY ?? secrets.ANON_KEY;
}
let PUB = '';
async function call(method: string, path: string, { token, body, apikey, origin }: { token?: string | null; body?: unknown; apikey?: string | null; origin?: string } = {}) {
  const h: Record<string, string> = {};
  if (apikey !== null) h.apikey = apikey ?? PUB;
  if (token) h.authorization = `Bearer ${token}`;
  if (origin) h.origin = origin;
  if (body !== undefined) h['content-type'] = 'application/json';
  const res = await fetch(`${API}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json: Json = {};
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json };
}
const b64url = (b: Buffer) => b.toString('base64url');
async function kakaoSession(choice: string): Promise<{ access: string; userId: string }> {
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
  return { access: token.json.access_token, userId: JSON.parse(Buffer.from(token.json.access_token.split('.')[1], 'base64url').toString()).sub };
}
const account = (action: string, token: string, body: Json = {}) => call('POST', `/functions/v1/community-account/${action}`, { token, body: { protocol: 1, ...body } });
let POLICY = '', HASH = '';
async function contributor(choice: string, n: number) {
  const s = await kakaoSession(choice);
  if (!POLICY) { const p = (await account('policy', s.access)).json.policy; POLICY = p.version; HASH = p.consent_text_sha256; }
  const st = await account('status', s.access);
  const grant = await account('consent', s.access, { policy_version: POLICY, consent_text_sha256: HASH, via: 'safetyreport_server', accepted: true });
  expect(grant.status, JSON.stringify(grant.json)).toBe(200);
  const reg = await account('connections', s.access, { source_app: 'safetyreport', source_mode: 'server', platform: 'linux', device_label: '맞춤 통계 통합',
    dataset_key: createHash('sha256').update(`safetyreport-dataset|v1|st-${randomUUID()}`).digest('hex'), connection_secret: b64url(randomBytes(32)), takeover: st.json.connection != null });
  expect(reg.status, JSON.stringify(reg.json)).toBe(200);
  const events = [];
  for (let i = 0; i < n; i++) {
    const payload = payloadOf('accepted_fine');
    events.push({ event_id: randomUUID(), event_type: 'completed_observation', source_system: 'safetyreport', source_report_id: `ST${randomBytes(6).toString('hex')}`,
      source_revision: i + 1, writer_epoch: reg.json.writer_epoch, captured_at: new Date().toISOString(), payload, payload_sha256: await sha256Hex(canonicalJson(payload)) });
  }
  const up = await call('POST', '/functions/v1/community-ingest', { token: s.access, body: { protocol: 1, contract: 'community-ingest-v1', source_app: 'safetyreport', source_mode: 'server',
    connection_id: reg.json.connection_id, consent_grant_id: grant.json.grant_id, policy_version: POLICY, client_version: 'it-1', parser_version: 'pc-parser-1', trigger: 'manual', events } });
  expect(up.status, JSON.stringify(up.json)).toBe(200);
  expect(up.json.results.every((r: Json) => r.projection_status === 'published')).toBe(true);
  return s;
}

const SCOPE = { date_basis: 'completed_date' as const, start: '2020-01-01', end: '2026-12-31', category: 'all' };
const spec = (patch: Json = {}) => ({ version: 1, date_basis: 'completed_date', population: 'all', rows: ['agency'], columns: [], metrics: ['completed_count', 'accept_rate', 'fine_rate'], filters: [], place_key: null, ...patch });
const q = (s: Json, extra: Record<string, string> = {}) => new URLSearchParams({ ...SCOPE, spec: JSON.stringify(s), ...extra }).toString();

describe.skipIf(!enabled)('맞춤 통계 on real function code + local database', () => {
  let viewer: { access: string; userId: string };
  let other: { access: string; userId: string };
  beforeAll(async () => {
    PUB = publishableKey();
    viewer = await contributor('G', 12);
    other = await contributor('I', 10);
  }, 180_000);

  it('FN-16 catalog: contract (frontend schema) and refusals without a verified contributor', async () => {
    const ok = await call('GET', '/functions/v1/public-analytics/statistics/catalog', { token: viewer.access, apikey: null });
    expect(ok.status, JSON.stringify(ok.json).slice(0, 300)).toBe(200);
    const cat = catalogSchema.parse(ok.json);
    expect(cat.metrics.map((m) => m.id)).toEqual(expect.arrayContaining(['accept_rate', 'fine_rate', 'completed_count']));
    expect((await call('GET', '/functions/v1/public-analytics/statistics/catalog', { apikey: null })).status).toBe(401);
    const anon = await call('GET', '/functions/v1/public-analytics/statistics/catalog', { token: PUB, apikey: PUB });
    expect([401, 403]).toContain(anon.status);
  });

  it('FN-16 query (전체): contract, complete result, totals from raw facts, no personal fields', async () => {
    const r = await call('GET', `/functions/v1/public-analytics/statistics/query?${q(spec())}`, { token: viewer.access, apikey: null });
    expect(r.status, JSON.stringify(r.json).slice(0, 300)).toBe(200);
    const res = statisticsResultSchema.parse(r.json);
    expect(res.complete).toBe(true);
    const g = res.grand_totals.find((t) => t.side === 'all')!.values;
    // at least the 22 synthetic reports uploaded above are counted
    expect(g.completed_count.value).toBeGreaterThanOrEqual(22);
    // a rate is its own numerator/denominator (×100), never an average of cells
    expect(g.accept_rate.value).toBeCloseTo((g.accept_rate.numerator! / g.accept_rate.denominator!) * 100, 9);
    const sumCells = res.cells.filter((c) => c.side === 'all').reduce((a, c) => a + (c.values.completed_count.value ?? 0), 0);
    expect(sumCells).toBe(g.completed_count.value);
    expect(JSON.stringify(r.json)).not.toMatch(new RegExp(`${viewer.userId}|source_report_id|contributor|access_token`));
  });

  it('FN-16 candidates: contract; an unknown selected key is "unconfirmed", never a name', async () => {
    const r = await call('GET', `/functions/v1/public-analytics/statistics/candidates?${new URLSearchParams({ ...SCOPE, kind: 'agency', cursor: '0', limit: '20', basis: 'completed_date', keys: JSON.stringify(['ag:no-such-agency']) })}`, { token: viewer.access, apikey: null });
    expect(r.status, JSON.stringify(r.json).slice(0, 300)).toBe(200);
    const page = candidatesSchema.parse(r.json);
    expect(page.items.length).toBeGreaterThan(0);
    const sel = page.selected.find((x) => x.key === 'ag:no-such-agency');
    expect(sel?.status).toBe('unconfirmed');
    expect(sel?.label ?? '').not.toMatch(/no-such/);
  });

  it('FN-16 invalid / SQL-like specs are refused with a code (no default result)', async () => {
    for (const bad of [spec({ metrics: ['no_such_metric'] }), spec({ rows: ["agency; drop table x"] }), { ...spec(), extra: 1 }]) {
      const r = await call('GET', `/functions/v1/public-analytics/statistics/query?${q(bad)}`, { token: viewer.access, apikey: null });
      expect(r.status).toBe(400);
      expect(r.json.code ?? r.json.error).toBeTruthy();
    }
  });

  it('FN-16/FN-18 내 신고 and 비교: the verified JWT user decides; another account sees its own counts', async () => {
    const mine = await call('GET', `/functions/v1/my-analytics/statistics?${q(spec({ population: 'mine' }))}`, { token: viewer.access, origin: MAP_ORIGIN });
    expect(mine.status, JSON.stringify(mine.json).slice(0, 300)).toBe(200);
    // oracle: the dashboard comparison of the same account (another route and aggregation over the same facts);
    // the stack persists between runs, so an account may hold uploads of earlier runs too (≥ this run's 12)
    const oracle = async (token: string) => (await call('GET', `/functions/v1/my-analytics/compare?${new URLSearchParams(SCOPE)}`, { token, origin: MAP_ORIGIN })).json.mine.completed_count;
    const mineCount = statisticsResultSchema.parse(mine.json).population_count.mine;
    expect(mineCount).toBe(await oracle(viewer.access));
    expect(mineCount).toBeGreaterThanOrEqual(12);
    const cmp = await call('GET', `/functions/v1/my-analytics/statistics?${q(spec({ population: 'compare' }))}`, { token: other.access, origin: MAP_ORIGIN });
    expect(cmp.status).toBe(200);
    const c = statisticsResultSchema.parse(cmp.json);
    expect(c.population_count.mine).toBe(await oracle(other.access));
    expect(c.population_count.mine).not.toBe(mineCount);
    expect(c.population_count.all).toBeGreaterThanOrEqual(22);
    expect(c.cells.some((x) => x.side === 'mine')).toBe(true);
    expect(JSON.stringify(cmp.json)).not.toContain(viewer.userId);
    expect((await call('GET', `/functions/v1/my-analytics/statistics?${q(spec({ population: 'mine' }))}`, { origin: MAP_ORIGIN })).status).toBe(401);
    // population 'all' is not served by my-analytics (the public route owns it)
    expect((await call('GET', `/functions/v1/my-analytics/statistics?${q(spec())}`, { token: viewer.access, origin: MAP_ORIGIN })).status).toBe(400);
  });

  it('single-date-v1 on real function code: both bases, policy echo, /laws sort, basis conflict refused (EX-08/EX-09/AG-13)', async () => {
    for (const basis of ['report_date', 'completed_date'] as const) {
      const d = await call('GET', `/functions/v1/public-analytics/dashboard?${new URLSearchParams({ ...SCOPE, date_basis: basis })}`, { token: viewer.access, apikey: null });
      expect(d.status, JSON.stringify(d.json).slice(0, 300)).toBe(200);
      const body = dashboardResponseSchema.parse(d.json);
      expect([body.scope.date_basis, body.cohort_policy_version, body.overview.report_count.basis]).toEqual([basis, 'single-date-v1', basis]);
    }
    const laws = await call('GET', `/functions/v1/public-analytics/laws?${new URLSearchParams({ ...SCOPE, sort: 'fine', sort_value: 'rate', dir: 'desc' })}`, { token: viewer.access, apikey: null });
    expect(laws.status).toBe(200);
    expect(lawsResponseSchema.parse(laws.json).sort).toEqual({ column: 'fine', value: 'rate', dir: 'desc' });
    const conflict = await call('GET', `/functions/v1/public-analytics/statistics/query?${q(spec({ date_basis: 'report_date' }))}`, { token: viewer.access, apikey: null });
    expect([conflict.status, conflict.json.error.code]).toEqual([400, 'BASIS_CONFLICT']);
    const mineConflict = await call('GET', `/functions/v1/my-analytics/statistics?${q(spec({ date_basis: 'report_date', population: 'mine' }))}`, { token: viewer.access, origin: MAP_ORIGIN });
    expect([mineConflict.status, mineConflict.json.error.code]).toEqual([400, 'BASIS_CONFLICT']);
    const cmp = await call('GET', `/functions/v1/my-analytics/compare?${new URLSearchParams({ ...SCOPE, date_basis: 'report_date' })}`, { token: viewer.access, origin: MAP_ORIGIN });
    expect(cmp.status).toBe(200);
    const parsed = personalCompareSchema.parse(cmp.json);
    expect([parsed.scope.date_basis, parsed.cohort.all.date_basis, parsed.cohort.mine.date_basis]).toEqual(['report_date', 'report_date', 'report_date']);
  });
});
