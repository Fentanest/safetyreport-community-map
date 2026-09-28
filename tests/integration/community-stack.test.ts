// Real local-stack HTTP tests for community-account (auth repo) + community-ingest + public-analytics (map repo),
// composed into ONE Supabase project by scripts/integration/compose_supabase.mjs (project ci0926-int).
// Real Postgres 17 + GoTrue + PostgREST + edge-runtime; Kakao is the local mock (scripts/integration/mock_kakao.mjs).
// This is NOT a hosted Kakao E2E. Run:
//   node scripts/integration/compose_supabase.mjs compose && (cd .integration-stack && npx supabase start --workdir .)
//   node scripts/integration/mock_kakao.mjs --host 172.17.0.1 --port 56410 &
//   (cd .integration-stack && npx supabase functions serve --workdir . --env-file supabase/functions/.env) &
//   COMMUNITY_STACK=1 npx vitest run tests/integration
// Covers plan-final §3.6 security matrix (prompt §14) and §20 gates 2–4. Every refused write is followed by a row-count check.
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { canonicalJson, sha256Hex } from '../../server/ingest/observation';

const enabled = process.env.COMMUNITY_STACK === '1';
const API = process.env.COMMUNITY_API_URL ?? 'http://127.0.0.1:56321';
const DB_CONTAINER = process.env.COMMUNITY_DB_CONTAINER ?? 'supabase_db_ci0926-int';
const MOCK_KAKAO_HOST = process.env.COMMUNITY_MOCK_KAKAO_HOST ?? '172.17.0.1';
const REDIRECT = 'http://127.0.0.1:56480/callback.html';
const vectors = JSON.parse(readFileSync(new URL('../../contracts/community-ingest/vectors/observations.json', import.meta.url), 'utf8'));
const payloadOf = (name: string) => structuredClone(vectors.cases.find((c: { name: string }) => c.name === name).expected_payload);

type Json = Record<string, any>;
interface Keys { PUBLISHABLE_KEY: string; ANON_KEY: string; SERVICE_ROLE_KEY: string; JWT_SECRET: string }
let keys: Keys;

function sql(query: string): string {
  return execFileSync('docker', ['exec', '-i', DB_CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-tAq', '-v', 'ON_ERROR_STOP=1'],
    { input: query, encoding: 'utf8' }).trim();
}
const count = (table: string, where = 'true') => Number(sql(`select count(*) from ${table} where ${where};`));

async function call(method: string, path: string, { token, body, headers = {}, apikey }: { token?: string | null; body?: unknown; headers?: Record<string, string>; apikey?: string | null } = {}) {
  const h: Record<string, string> = { ...headers };
  if (apikey !== null) h.apikey = apikey ?? keys.PUBLISHABLE_KEY;
  if (token) h.authorization = `Bearer ${token}`;
  if (body !== undefined) h['content-type'] = h['content-type'] ?? 'application/json';
  const res = await fetch(`${API}${path}`, { method, headers: h, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  const text = await res.text();
  let json: Json = {};
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json, headers: res.headers };
}
const account = (action: string, token: string | null, body: Json = {}) =>
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
const ingestRaw = (body: unknown, token: string | null, headers?: Record<string, string>) =>
  call('POST', '/functions/v1/community-ingest', { token, body, headers });
const SCOPE = 'start=2024-01-01&end=2028-12-31';
// The map is contributor-only (2026-09-27): statistics are read as E, a Kakao user with an active share consent
// and one shared report on the map.
let viewerToken: string | null = null;
async function viewer(): Promise<string> {
  if (!viewerToken) {
    const w = await writerFor('E');
    const r = await ingest(w, [await event(w, `VIEW-${rid()}`)]);
    expect(r.json.results?.[0]?.projection_status, JSON.stringify(r.json)).toBe('published');
    viewerToken = w.session.access;
  }
  return viewerToken;
}
const publicApi = async (route: string) =>
  call('GET', `/functions/v1/public-analytics/${route}${route === 'meta' ? '' : `?${SCOPE}`}`, { apikey: null, token: await viewer() });

// ── sessions ──────────────────────────────────────────────────────────────────
const b64url = (b: Buffer) => b.toString('base64url');
const rid = () => randomBytes(8).toString('hex'); // source_report_id is ^[0-9A-Za-z_-]{1,40}$
interface Session { access: string; refresh: string; userId: string; sessionId: string }

async function kakaoSession(choice: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G'): Promise<Session> {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const authorize = `${API}/auth/v1/authorize?${new URLSearchParams({ provider: 'kakao', redirect_to: REDIRECT, code_challenge: challenge, code_challenge_method: 's256' })}`;
  const step1 = await fetch(authorize, { redirect: 'manual' });
  const kakao = new URL(step1.headers.get('location')!);
  kakao.hostname = MOCK_KAKAO_HOST; // the browser-facing host.docker.internal is not resolvable from the host
  const decide = new URL('/oauth/decide', kakao);
  decide.search = new URLSearchParams({ state: kakao.searchParams.get('state')!, choice }).toString();
  const step2 = await fetch(decide, { redirect: 'manual' });
  const step3 = await fetch(step2.headers.get('location')!, { redirect: 'manual' });
  const landed = new URL(step3.headers.get('location')!);
  const code = landed.searchParams.get('code');
  if (!code) throw new Error(`no auth code: ${landed}`);
  const token = await call('POST', '/auth/v1/token?grant_type=pkce', { body: { auth_code: code, code_verifier: verifier } });
  expect(token.status).toBe(200);
  return toSession(token.json);
}

function toSession(j: Json): Session {
  const claims = JSON.parse(Buffer.from(j.access_token.split('.')[1], 'base64url').toString('utf8'));
  return { access: j.access_token, refresh: j.refresh_token, userId: claims.sub, sessionId: claims.session_id };
}

async function emailSession(): Promise<Session> {
  const email = `int-${randomUUID()}@example.invalid`, password = `Pw-${randomUUID()}`;
  const created = await call('POST', '/auth/v1/admin/users', { token: keys.SERVICE_ROLE_KEY, apikey: keys.SERVICE_ROLE_KEY, body: { email, password, email_confirm: true } });
  expect(created.status).toBe(200);
  const login = await call('POST', '/auth/v1/token?grant_type=password', { body: { email, password } });
  expect(login.status).toBe(200);
  return toSession(login.json);
}

function hs256(payload: Json, secret: string) {
  const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const head = enc({ alg: 'HS256', typ: 'JWT' }), body = enc(payload);
  return `${head}.${body}.${createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url')}`;
}

// ── writer / events ───────────────────────────────────────────────────────────
const datasetKey = (login: string) => createHash('sha256').update(`safetyreport-dataset|v1|${login}`).digest('hex');
interface Writer { session: Session; connectionId: string; epoch: number; grantId: string; dataset: string; secret: string; revision: number }

async function consent(s: Session) {
  const r = await account('consent', s.access, { policy_version: POLICY, consent_text_sha256: CONSENT_HASH, via: 'safetyreport_server', accepted: true });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  return r.json.grant_id as string;
}

async function register(s: Session, dataset: string, takeover = false, mode: 'server' | 'standalone' = 'server') {
  const secret = b64url(randomBytes(32));
  const r = await account('connections', s.access, { source_app: mode === 'server' ? 'safetyreport' : 'safetyreport-mobile', source_mode: mode,
    platform: 'linux', device_label: '통합 테스트', dataset_key: dataset, connection_secret: secret, takeover });
  return { r, secret };
}

async function writerFor(choice: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G', login = `int-${randomUUID()}`): Promise<Writer> {
  const session = await kakaoSession(choice);
  const grantId = await consent(session);
  const dataset = datasetKey(login);
  const { r, secret } = await register(session, dataset);
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  return { session, connectionId: r.json.connection_id, epoch: r.json.writer_epoch, grantId, dataset, secret, revision: 0 };
}

async function event(w: Writer, reportId: string, payload: Json = payloadOf('accepted_fine'), opts: Partial<Json> = {}) {
  w.revision += 1;
  return { event_id: randomUUID(), event_type: 'completed_observation', source_system: 'safetyreport', source_report_id: reportId,
    report_number: 'SPP-2609-8000001', source_revision: w.revision, writer_epoch: w.epoch, captured_at: new Date().toISOString(), payload,
    payload_sha256: await sha256Hex(canonicalJson(payload)), ...opts };
}
const envelope = (w: Writer, events: unknown[], over: Partial<Json> = {}) => ({ protocol: 1, contract: 'community-ingest-v1',
  source_app: 'safetyreport', source_mode: 'server', connection_id: w.connectionId, consent_grant_id: w.grantId, policy_version: POLICY,
  client_version: 'it-1', parser_version: 'pc-parser-1', trigger: 'manual', events, ...over });
const ingest = (w: Writer, events: unknown[], over: Partial<Json> = {}, token = w.session.access) => ingestRaw(envelope(w, events, over), token);

const ledger = () => count('private.community_ingest_events');
const RT_CONTROL = 'it_realtime_control';
// 로컬 스택 전용 Realtime 대조 표를 만들고(없으면), 실제 변경 전달이 될 때까지 기다린다 — 초기화된 스택의 첫 실행에서도
// 대조가 성립하게 테스트 **전** 준비 단계에서 한다(Sol 3차 M-02).
async function ensureRealtimeReady(): Promise<number> {
  sql(`create table if not exists public.${RT_CONTROL}(id bigint primary key, v text);
    alter table public.${RT_CONTROL} enable row level security;
    drop policy if exists rt_read on public.${RT_CONTROL};
    create policy rt_read on public.${RT_CONTROL} for select to anon, authenticated using (true);
    grant select on public.${RT_CONTROL} to anon, authenticated;
    do $$ begin if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = '${RT_CONTROL}')
      then alter publication supabase_realtime add table public.${RT_CONTROL}; end if; end $$;`);
  const started = Date.now();
  const ws = new WebSocket(`${API.replace('http', 'ws')}/realtime/v1/websocket?apikey=${keys.PUBLISHABLE_KEY}&vsn=1.0.0`);
  const got: Json[] = [];
  await new Promise<void>((resolve, reject) => { ws.onopen = () => resolve(); ws.onerror = e => reject(e); });
  ws.onmessage = m => got.push(JSON.parse(String(m.data)));
  ws.send(JSON.stringify({ topic: 'realtime:warmup', event: 'phx_join', ref: 'w', join_ref: 'w',
    payload: { config: { postgres_changes: [{ event: 'INSERT', schema: 'public', table: RT_CONTROL }] }, access_token: keys.PUBLISHABLE_KEY } }));
  try {
    for (let i = 0; i < 60 && !got.some(m => m.event === 'postgres_changes'); i++) {
      if (got.some(m => m.event === 'system' && m.payload?.status === 'ok')) sql(`insert into public.${RT_CONTROL}(id, v) values (${Date.now() * 10 + i}, 'warmup');`);
      await new Promise(r => setTimeout(r, 1500));
    }
  } finally { ws.close(); }
  if (!got.some(m => m.event === 'postgres_changes')) throw new Error(`realtime control never delivered: ${JSON.stringify(got).slice(0, 300)}`);
  return Date.now() - started;
}

const SERVE_LOG = process.env.COMMUNITY_SERVE_LOG ?? '/home/better0101/projects/safetyreport/.agent-runs/ci-20260926/stack-int/serve.log';
function runtimeTerminations(): number {
  try {
    return readFileSync(SERVE_LOG, 'utf8').split('\n')
      .filter(l => /connection closed before message completed|early termination has been triggered/.test(l)).length;
  } catch { return 0; }
}
function rpcSignatures(): { name: string; body: Json }[] {
  const dummy = (type: string): unknown => ({ uuid: '00000000-0000-4000-8000-000000000000', text: 'x', jsonb: {}, integer: 1,
    boolean: false, date: '2026-01-01', 'timestamp with time zone': '2026-01-01T00:00:00Z', 'double precision[]': null } as Json)[type] ?? null;
  const rows = sql(`select p.proname || '|' || coalesce(array_to_string(p.proargnames, ','), '') || '|' ||
      coalesce((select string_agg(format_type(t, null), ',' order by i) from unnest(p.proargtypes) with ordinality u(t, i)), '')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'internal\\_%' order by 1;`);
  const out = rows.split('\n').filter(Boolean).map(line => {
    const [name, argNames, argTypes] = line.split('|');
    const names = argNames ? argNames.split(',') : [];
    const types = argTypes ? argTypes.split(',') : [];
    return { name, body: Object.fromEntries(names.map((n, i) => [n, dummy(types[i])])) };
  });
  expect(out.length).toBeGreaterThanOrEqual(20);
  return out;
}
// What the (contributor-only) public API serves (same SECURITY DEFINER function public-analytics calls), optionally per contributor.
const publicFacts = (identityLike: string, contributor?: string) => Number(sql(`select count(*) from jsonb_array_elements(
  public.internal_analytics_v2_facts(date '2024-01-01', date '2028-12-31', 'all', null, null, null, null)) e
  where e->>'fact_identity' like '${identityLike}'${contributor ? ` and e->>'contributor_id' = '${contributor}'` : ''};`));
const facts = () => count('private.community_report_facts');
async function publicTotal(): Promise<number> {
  const r = await publicApi('overview');
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  return Number(r.json.meta?.source_count ?? r.json.overview?.total ?? r.json.overview?.reports ?? NaN);
}
async function publicMeta(): Promise<Json> {
  const r = await publicApi('meta');
  expect(r.status).toBe(200);
  return r.json;
}

describe.skipIf(!enabled)('community ingest on the composed local stack', () => {
  beforeAll(async () => {
    const status = JSON.parse(execFileSync('npx', ['supabase', 'status', '-o', 'json', '--workdir', '.integration-stack'], { encoding: 'utf8' }));
    keys = status as Keys;
    // shared local stack: reset only rate-limit windows so reruns are independent
    sql('delete from private.rate_limits; delete from private.community_auth_rate_limits;');
    // deployment-and-rollback.md step 7: the operator switches the public projection on
    sql('update private.analytics_state set ready = true, published_at = coalesce(published_at, now()) where singleton;');
    await loadPolicy();
    const warm = await ensureRealtimeReady();
    console.info(`[realtime] control delivery ready after ${warm} ms`);
    // The contributor-only viewer (E, one shared report) is made while publication is on, before any test switches it off.
    await viewer();
  }, 120_000);

  describe('security matrix (prompt §14)', () => {
    it('refuses URL + publishable key only, publishable key as bearer, forged/other-project/expired JWTs, legacy keys', async () => {
      const w = await writerFor('A');
      const body = envelope(w, [await event(w, `SM-${rid()}`)]);
      const before = ledger();
      const now = Math.floor(Date.now() / 1000);
      const claims = { sub: w.session.userId, role: 'authenticated', aud: 'authenticated', session_id: w.session.sessionId, is_anonymous: false };
      const attempts: [string, string | null][] = [
        ['no jwt', null],
        ['publishable as bearer', keys.PUBLISHABLE_KEY],
        ['forged', hs256({ ...claims, exp: now + 600 }, 'not-the-project-secret-000000000000000')],
        ['other project', hs256({ ...claims, iss: 'https://other.supabase.co/auth/v1', exp: now + 600 }, 'another-project-secret-111111111111111')],
        ['expired', hs256({ ...claims, exp: now - 60, iat: now - 3660 }, keys.JWT_SECRET)],
        ['legacy anon key', keys.ANON_KEY],
        ['legacy service_role key', keys.SERVICE_ROLE_KEY],
      ];
      for (const [label, token] of attempts) {
        const r = await ingestRaw(body, token);
        expect(r.status, `${label}: ${JSON.stringify(r.json)}`).toBe(401);
        const a = await account('status', token);
        expect(a.status, `account ${label}`).toBe(401);
      }
      expect(ledger()).toBe(before);
    });

    it('treats Supabase anonymous and non-Kakao sessions as not community users', async () => {
      const anon = await call('POST', '/auth/v1/signup', { body: {} });
      expect(anon.status).toBe(200);
      const anonToken = anon.json.access_token as string;
      const email = await emailSession();
      for (const token of [anonToken, email.access]) {
        const st = await account('status', token);
        if (token === anonToken) expect([401, 403]).toContain(st.status);
        else expect(st.json.gate?.kakao).toBe(false);
        const c = await account('consent', token, { policy_version: POLICY, consent_text_sha256: CONSENT_HASH, via: 'safetyreport_server', accepted: true });
        expect([401, 403]).toContain(c.status);
      }
      expect(count('private.community_consent_grants', `user_id in ('${email.userId}')`)).toBe(0);
    });

    it('requires consent, a registered connection, the owner, and the bound session', async () => {
      const s = await kakaoSession('B');
      const fakeWriter: Writer = { session: s, connectionId: randomUUID(), epoch: 1, grantId: randomUUID(), dataset: datasetKey('x'), secret: '', revision: 0 };
      const before = ledger();
      // no consent (fresh user B may already have one from another test run → revoke first)
      const st = await account('status', s.access);
      if (st.json.consent?.state === 'active') await account('consent-revoke', s.access, { grant_id: st.json.consent.grant_id });
      let r = await ingest(fakeWriter, [await event(fakeWriter, `NC1-${rid()}`)]);
      expect(r.status).toBe(403);
      expect(r.json.error.code).toMatch(/^consent_/);
      // consent but no connection
      fakeWriter.grantId = await consent(s);
      r = await ingest(fakeWriter, [await event(fakeWriter, `NC2-${rid()}`)]);
      expect([r.status, r.json.error.code]).toEqual([403, 'connection_unknown']);
      // someone else's connection id → same answer as unknown (no existence leak)
      const other = await writerFor('C');
      r = await ingest({ ...fakeWriter, connectionId: other.connectionId }, [await event(fakeWriter, `NC3-${rid()}`)]);
      expect([r.status, r.json.error.code]).toEqual([403, 'connection_unknown']);
      // A's token with B's (other's) connection+grant in the body
      r = await ingestRaw(envelope(other, [await event(other, `NC4-${rid()}`)]), s.access);
      expect(r.status).toBe(403);
      expect(ledger()).toBe(before);
      // same user, a second session: refused until rebind
      const w = await writerFor('D');
      const second = await kakaoSession('D');
      r = await ingest(w, [await event(w, `NC5-${rid()}`)], {}, second.access);
      expect([r.status, r.json.error.code]).toEqual([403, 'connection_session_mismatch']);
      const rebind = await account('connections-rebind', second.access, { connection_id: w.connectionId, connection_secret: w.secret });
      expect(rebind.status, JSON.stringify(rebind.json)).toBe(200);
      r = await ingest(w, [await event(w, `NC5b-${rid()}`)], {}, second.access);
      expect(r.status, JSON.stringify(r.json)).toBe(200);
      expect(r.json.results[0].status).toBe('accepted');
      // the first session is now refused
      r = await ingest(w, [await event(w, `NC6-${rid()}`)]);
      expect([r.status, r.json.error.code]).toEqual([403, 'connection_session_mismatch']);
    });

    it('refuses still-valid JWTs after consent revoke, connection revoke and logout', async () => {
      const w = await writerFor('A');
      expect((await ingest(w, [await event(w, `RV-${rid()}`)])).status).toBe(200);
      await account('consent-revoke', w.session.access, { grant_id: w.grantId });
      let r = await ingest(w, [await event(w, `RV-${rid()}`)]);
      expect([r.status, r.json.error.code]).toEqual([403, 'consent_revoked']);
      // re-consent does not revive the old grant's outbox
      const newGrant = await consent(w.session);
      expect(newGrant).not.toBe(w.grantId);
      r = await ingest(w, [await event(w, `RV-${rid()}`)]);
      expect(r.status).toBe(403);
      expect(r.json.error.code).toMatch(/^consent_(revoked|grant_unknown)$/);
      w.grantId = newGrant;
      expect((await ingest(w, [await event(w, `RV-${rid()}`)])).status).toBe(200);
      await account('connections-revoke', w.session.access, { connection_id: w.connectionId });
      r = await ingest(w, [await event(w, `RV-${rid()}`)]);
      expect([r.status, r.json.error.code]).toEqual([403, 'connection_revoked']);
      const w2 = await writerFor('B');
      const logout = await call('POST', '/auth/v1/logout?scope=local', { token: w2.session.access });
      expect(logout.status).toBe(204);
      r = await ingest(w2, [await event(w2, `RV-${rid()}`)]);
      expect(r.status).toBe(401);
    });

    it('refuses unsupported apps/modes and malformed or oversized requests without writing', async () => {
      const w = await writerFor('C');
      const before = ledger();
      const ev = await event(w, `BAD-${rid()}`);
      for (const over of [{ source_app: 'other-app' }, { source_mode: 'client' }, { source_app: 'safetyreport-mobile', source_mode: 'server' }]) {
        const r = await ingest(w, [ev], over);
        expect([403, 422], JSON.stringify(over)).toContain(r.status);
      }
      // standalone connection used as server (mode mismatch)
      const mob = await register(w.session, datasetKey(`mob-${randomUUID()}`), false, 'standalone');
      expect(mob.r.status).toBe(200);
      let r = await ingestRaw({ ...envelope(w, [ev]), connection_id: mob.r.json.connection_id }, w.session.access);
      expect([r.status, r.json.error?.code]).toEqual([403, 'connection_mode_mismatch']);
      r = await ingest(w, [{ ...ev, payload_sha256: '0'.repeat(64) }]);
      expect([r.status, r.json.error.code]).toEqual([422, 'payload_hash_mismatch']);
      r = await ingest(w, [ev, { ...(await event(w, ev.source_report_id)) }]);
      expect([r.status, r.json.error.code]).toEqual([422, 'schema_invalid']); // one event per report per request
      r = await ingest(w, [{ ...ev, extra: 1 }]);
      expect(r.status).toBe(422);
      r = await ingest(w, Array.from({ length: 21 }, () => ev));
      expect(r.status).toBe(422);
      r = await ingestRaw('x'.repeat(300 * 1024), w.session.access);
      expect(r.status).toBe(413);
      r = await ingestRaw('{not json', w.session.access);
      expect(r.status).toBe(400);
      r = await call('POST', '/functions/v1/community-ingest', { token: w.session.access, body: 'a=b', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
      expect(r.status).toBe(415);
      expect(ledger()).toBe(before);
    });

    it('rate limits the account API per user', async () => {
      const s = await kakaoSession('A');
      const statuses: number[] = [];
      // 분당 30회 고정 창: 창 경계를 한 번 넘어도 한 창에 31회 이상 들어가도록 61회까지 보낸다
      for (let i = 0; i < 61 && !statuses.includes(429); i++) statuses.push((await account('status', s.access)).status);
      expect(statuses).toContain(429);
      sql('delete from private.community_auth_rate_limits;');
    });

    it('blocks direct REST/RPC/GraphQL access to private data and leaves row counts unchanged', async () => {
      const w = await writerFor('B');
      const tables = ['private.community_ingest_events', 'private.community_report_facts', 'private.community_connections',
        'private.community_consent_grants', 'private.community_fact_tombstones', 'private.community_deletion_fences',
        'private.community_owner_transfer_audit'];
      const before = Object.fromEntries(tables.map(t => [t, count(t)]));
      const bearers: [string, string | undefined][] = [['publishable', undefined], ['anon', keys.ANON_KEY], ['user', w.session.access]];
      for (const [label, token] of bearers) {
        for (const table of ['community_ingest_events', 'community_report_facts', 'community_connections', 'community_consent_grants', 'community_owner_transfer_audit']) {
          // 상태와 오류 JSON 을 모두 본다(§20-2): private 는 노출 안 된 스키마, public 에는 그런 표가 없다
          const sel = await call('GET', `/rest/v1/${table}?select=*`, { token, headers: { 'Accept-Profile': 'private' } });
          expect([sel.status, sel.json.code], `${label} select private.${table}`).toEqual([406, 'PGRST106']);
          const ins = await call('POST', `/rest/v1/${table}`, { token, body: { id: 1 }, headers: { 'Content-Profile': 'private', Prefer: 'resolution=merge-duplicates' } });
          expect([ins.status, ins.json.code], `${label} insert private.${table}`).toEqual([406, 'PGRST106']);
          for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
            const pub = await call(method, `/rest/v1/${table}?event_id=eq.00000000-0000-0000-0000-000000000000`, { token, body: method === 'GET' || method === 'DELETE' ? undefined : { x: 1 } });
            expect([pub.status, pub.json.code], `${label} ${method} public.${table}`).toEqual([404, 'PGRST205']);
          }
        }
        // 모든 public.internal_* RPC 를 **정확한 시그니처**로 호출 → 실행 권한 거절(42501). 인자가 틀린 404 로는 권한을 증명하지 못한다.
        for (const fn of rpcSignatures()) {
          const r = await call('POST', `/rest/v1/rpc/${fn.name}`, { token, body: fn.body });
          // anon(공개키) 은 401, 사용자 JWT(authenticated)는 403 — 둘 다 PostgreSQL 권한 거절 42501
          expect([r.status, r.json.code], `${label} rpc ${fn.name}: ${JSON.stringify(r.json).slice(0, 120)}`)
            .toEqual([label === 'user' ? 403 : 401, '42501']);
        }
        const gql = await call('POST', '/graphql/v1', { token, body: { query: '{ __schema { types { name } } }' } });
        const names = JSON.stringify(gql.json);
        expect(names).not.toMatch(/community_(ingest_events|report_facts|connections|consent_grants)/);
      }
      expect(sql("select count(*) from pg_publication_tables where schemaname = 'private';")).toBe('0');
      expect(sql("select count(*) from information_schema.role_table_grants where table_schema = 'private' and grantee in ('anon','authenticated','PUBLIC');")).toBe('0');
      expect(sql("select count(*) from information_schema.routine_privileges where routine_schema = 'public' and routine_name like 'internal\\_%' and grantee in ('anon','authenticated','PUBLIC');")).toBe('0');
      for (const t of tables) expect(count(t), t).toBe(before[t]);
    });
  });

  describe('realtime and storage channels (§14, Sol M-02)', () => {
    it('Realtime: every private subscription is answered, none delivers changes, while a public control table does', async () => {
      const w = await writerFor('B');
      // 양성 대조군: 이 테스트만 쓰는 공개 표를 publication 에 넣어 Realtime 이 실제로 변경을 전달하는지 먼저 증명한다
      const control = RT_CONTROL; // beforeAll 이 만들고 전달 준비를 증명했다
      const base = Date.now();
      {
        const messages: Json[] = [];
        const sockets: WebSocket[] = [];
        const joins: { ref: string; token: string }[] = [];
        for (const [who, token] of [['anon', keys.PUBLISHABLE_KEY], ['user', w.session.access]] as const) {
          const ws = new WebSocket(`${API.replace('http', 'ws')}/realtime/v1/websocket?apikey=${keys.PUBLISHABLE_KEY}&vsn=1.0.0`);
          sockets.push(ws);
          await new Promise<void>((resolve, reject) => { ws.onopen = () => resolve(); ws.onerror = e => reject(e); });
          ws.onmessage = m => messages.push({ who, ...JSON.parse(String(m.data)) });
          for (const [schema, table] of [['private', 'community_report_facts'], ['private', 'community_ingest_events'],
            ['private', 'community_connections'], ['public', control]]) {
            const ref = `${who}:${table}`;
            joins.push({ ref, token });
            ws.send(JSON.stringify({ topic: `realtime:${ref}`, event: 'phx_join', ref, join_ref: ref,
              payload: { config: { postgres_changes: [{ event: '*', schema, table }] }, access_token: token } }));
          }
        }
        // 모든 join 이 응답을 받을 때까지(상태 기록) 기다린다 — 죽은 소켓으로 '변경 0' 이 되는 것을 막는다
        const deadline = Date.now() + 10_000;
        while (Date.now() < deadline && joins.some(j => !messages.some(m => m.event === 'phx_reply' && m.ref === j.ref))) {
          await new Promise(r => setTimeout(r, 100));
        }
        const replies = Object.fromEntries(joins.map(j => [j.ref, messages.find(m => m.event === 'phx_reply' && m.ref === j.ref)?.payload?.status]));
        expect(Object.values(replies).every(Boolean), JSON.stringify(replies)).toBe(true);
        expect(replies[`anon:${control}`]).toBe('ok');
        expect(replies[`user:${control}`]).toBe('ok');
        // 대조 채널의 postgres_changes 구독이 실제로 붙을 때까지("Subscribed to PostgreSQL") 기다린 뒤 변경을 만든다
        const subscribed = (who: string) => messages.some(m => m.event === 'system' && m.who === who
          && m.payload?.status === 'ok' && String(m.topic).endsWith(control));
        const ready = Date.now() + 20_000;
        while (Date.now() < ready && !(subscribed('anon') && subscribed('user'))) await new Promise(r => setTimeout(r, 100));
        expect(subscribed('anon') && subscribed('user'), 'control subscriptions active').toBe(true);
        sql(`insert into public.${control}(id, v) values (${base}, 'x');`);
        expect((await ingest(w, [await event(w, `RT-${rid()}`)])).json.results[0].status).toBe('accepted');
        // 스위트 전체에서 WAL 이 많이 쌓이면 Realtime 전달이 늦다 — 최대 30초, 10초마다 대조 행을 하나 더 넣는다
        const delivered = () => messages.some(m => m.event === 'postgres_changes' && String(m.topic).includes(control));
        for (let n = 2; n <= 4 && !delivered(); n++) {
          const until = Date.now() + 10_000;
          while (Date.now() < until && !delivered()) await new Promise(r => setTimeout(r, 100));
          if (!delivered()) sql(`insert into public.${control}(id, v) values (${base + n}, 'x');`);
        }
        await new Promise(r => setTimeout(r, 2000));
        for (const ws of sockets) ws.close();
        const changes = messages.filter(m => m.event === 'postgres_changes');
        expect(changes.some(m => String(m.topic).includes(control)), 'positive control delivered').toBe(true);
        const leaked = changes.filter(m => !String(m.topic).includes(control));
        expect(leaked, JSON.stringify(leaked).slice(0, 300)).toEqual([]);
      }
    }, 90_000);

    it('Storage: no buckets by default; a real private bucket refuses anonymous and user writes and reads', async () => {
      const w = await writerFor('C');
      expect(Number(sql('select count(*) from storage.buckets;'))).toBe(0);
      for (const token of [undefined, w.session.access]) {
        const list = await call('GET', '/storage/v1/bucket', { token });
        expect([list.status, list.json]).toEqual([200, []]);
        const create = await call('POST', '/storage/v1/bucket', { token, body: { name: `x-${rid()}`, public: true } });
        expect(create.status).toBeGreaterThanOrEqual(400);
        expect(create.json.code ?? create.json.error).toBeTruthy();
      }
      const bucket = `it-${rid()}`;
      sql(`insert into storage.buckets(id, name, public) values ('${bucket}', '${bucket}', false);`);
      try {
        for (const token of [undefined, w.session.access]) {
          const up = await call('POST', `/storage/v1/object/${bucket}/probe-${rid()}.json`, { token, body: '{"a":1}' });
          expect(up.status, JSON.stringify(up.json)).toBeGreaterThanOrEqual(400);
          expect(JSON.stringify(up.json)).toMatch(/row-level security|Unauthorized|not allowed/i);
        }
        expect(Number(sql(`select count(*) from storage.objects where bucket_id = '${bucket}';`))).toBe(0);
        // 읽기 양성 대조: service role 이 실제 객체를 올리고 읽을 수 있음을 먼저 확인 → anon·사용자 거절이 '파일 없음'이 아님을 보인다
        const svc = { token: keys.SERVICE_ROLE_KEY, apikey: keys.SERVICE_ROLE_KEY };
        const put = await call('POST', `/storage/v1/object/${bucket}/seeded.json`, { ...svc, body: '{"seed":true}' });
        expect(put.status, JSON.stringify(put.json)).toBe(200);
        const own = await call('GET', `/storage/v1/object/${bucket}/seeded.json`, svc);
        expect([own.status, own.json]).toEqual([200, { seed: true }]);
        for (const token of [undefined, w.session.access]) {
          const get = await call('GET', `/storage/v1/object/${bucket}/seeded.json`, { token });
          expect(get.status, JSON.stringify(get.json)).toBeGreaterThanOrEqual(400);
          expect(JSON.stringify(get.json)).not.toContain('seed');
        }
      } finally {
        await call('DELETE', `/storage/v1/object/${bucket}/seeded.json`, { token: keys.SERVICE_ROLE_KEY, apikey: keys.SERVICE_ROLE_KEY });
        sql(`begin; set local storage.allow_delete_query = 'true'; delete from storage.objects where bucket_id = '${bucket}';
          delete from storage.buckets where id = '${bucket}'; commit;`);
      }
    });
  });

  describe('ingest semantics and public projection', () => {
    it('holds accepted facts while the public projection is switched off, then serves them when on', async () => {
      const w = await writerFor('A');
      sql('update private.analytics_state set ready = false where singleton;');
      try {
        const r = await ingest(w, [await event(w, `HOLD-${rid()}`)]);
        expect(r.json.results[0]).toMatchObject({ status: 'accepted', durable: true, projection_status: 'held' });
        expect((await publicApi('overview')).status).toBe(503);
      } finally {
        sql('update private.analytics_state set ready = true where singleton;');
      }
      expect((await publicApi('overview')).status).toBe(200);
    });

    it('accepts, is idempotent for the same event, conflicts on changed content, and publishes to the anonymous API', async () => {
      const w = await writerFor('C');
      const meta0 = await publicMeta();
      const ev = await event(w, `OK-${rid()}`);
      const r1 = await ingest(w, [ev]);
      expect(r1.status, JSON.stringify(r1.json)).toBe(200);
      expect(r1.json.results[0]).toMatchObject({ status: 'accepted', durable: true, projection_status: 'published' });
      expect(r1.headers.get('cache-control')).toBe('no-store');
      const ledger1 = ledger();
      const r2 = await ingest(w, [ev]);
      expect(r2.json.results[0]).toMatchObject({ status: 'duplicate', durable: true });
      expect(ledger()).toBe(ledger1);
      const changed = { ...ev, payload: { ...ev.payload, manager_name: '다른이름' } };
      changed.payload_sha256 = await sha256Hex(canonicalJson(changed.payload));
      const r3 = await ingest(w, [changed]);
      expect(r3.json.results[0].status).toBe('conflict');
      expect(sql(`select payload_sha256 from private.community_ingest_events where event_id = '${ev.event_id}';`)).toBe(ev.payload_sha256);
      const meta1 = await publicMeta();
      expect(meta1.dataset_version).not.toBe(meta0.dataset_version);
      const map = await publicApi('map');
      expect(map.status).toBe(200);
      expect(JSON.stringify(map.json)).not.toContain('12가3456'); // raw plate never public
    });

    it('does not count an unchanged re-observation and keeps the newest revision', async () => {
      const w = await writerFor('D');
      const report = `NOCHG-${rid()}`;
      const first = await ingest(w, [await event(w, report)]);
      expect(first.status, JSON.stringify(first.json)).toBe(200);
      expect(first.json.results[0].status).toBe('accepted');
      const again = await ingest(w, [await event(w, report)]);
      expect(again.status, JSON.stringify(again.json)).toBe(200);
      expect(again.json.results[0].status).toBe('no_change');
      const newer = await ingest(w, [await event(w, report, payloadOf('partial_penalty_traffic'))]);
      expect(newer.json.results[0].status).toBe('accepted');
      // 2026-09-28: a legacy status_correction arriving late is rejected per event (not stale_ignored);
      // the central fact keeps its last answered state.
      const stale = await event(w, report, payloadOf('withdrawn_not_eligible'), { source_revision: 1, event_type: 'status_correction' });
      const r = await ingest(w, [stale]);
      expect(r.status, JSON.stringify(r.json)).toBe(200);
      expect(r.json.results[0]).toMatchObject({ status: 'rejected', durable: false,
        error: { code: 'non_final_not_accepted', retryable: false } });
      expect(sql(`select status from private.community_report_facts where source_report_id = '${report}';`)).toBe('partial');
    });

    it('counts coordinate-missing facts in the public population but not on the map', async () => {
      const w = await writerFor('A');
      const before = await publicApi('overview');
      const r = await ingest(w, [await event(w, `NOLOC-${rid()}`, payloadOf('geocode_pending_no_location'))]);
      expect(r.status, JSON.stringify(r.json)).toBe(200);
      expect(r.json.results[0].status).toBe('accepted');
      const after = await publicApi('overview');
      expect(after.json.location_missing).toBe((before.json.location_missing ?? 0) + 1);
      expect(after.json.overview.report_count.value).toBe(before.json.overview.report_count.value + 1); // counted in stats
      const map = await publicApi('map');
      expect(JSON.stringify(map.json.points)).not.toContain('"lat":null');
    });

    it('removes a revoked lineage from the public API, keeps it hidden after re-consent, and republishes only on explicit reshare', async () => {
      const w = await writerFor('B');
      const report = `LIN-${rid()}`;
      expect((await ingest(w, [await event(w, report)])).json.results[0].projection_status).toBe('published');
      const key = sql(`select source_report_key from private.community_ingest_events where source_report_id = '${report}' limit 1;`);
      const publicRows = () => publicFacts(`%:${key}`);
      expect(publicRows()).toBe(1);
      const v0 = (await publicMeta()).dataset_version;
      await account('consent-revoke', w.session.access, { grant_id: w.grantId });
      const v1 = (await publicMeta()).dataset_version;
      expect(v1).not.toBe(v0);
      const grant2 = await consent(w.session);
      expect(publicRows()).toBe(0);
      w.grantId = grant2;
      // S-02: a newer observation after re-consent is stored but the revoked lineage stays hidden (no auto re-publication)
      const r = await ingest(w, [await event(w, report, payloadOf('partial_penalty_traffic'))]);
      expect(r.status, JSON.stringify(r.json)).toBe(200);
      expect(r.json.results[0]).toMatchObject({ status: 'accepted', projection_status: 'held' });
      expect(publicRows()).toBe(0);
      // only an explicit reshare (trigger + event_type reshare) re-attributes it to the new lineage
      const reshare = await ingest(w, [await event(w, report, payloadOf('partial_penalty_traffic'), { event_type: 'reshare' })], { trigger: 'reshare' });
      expect(reshare.status, JSON.stringify(reshare.json)).toBe(200);
      expect(reshare.json.results[0]).toMatchObject({ status: 'accepted', projection_status: 'published' });
      expect(publicRows()).toBe(1);
      const mismatched = await ingest(w, [await event(w, report, payloadOf('partial_penalty_traffic'), { event_type: 'reshare' })]);
      expect([mismatched.status, mismatched.json.error?.code]).toEqual([422, 'event_type_mismatch']);
    });

    it('deletes contributions: public removal, fence for earlier captures, all connections revoked, new connection works', async () => {
      const w = await writerFor('C');
      const report = `DEL-${rid()}`;
      const early = await event(w, `${report}-late-arrival`);
      expect((await ingest(w, [await event(w, report)])).status).toBe(200);
      const del = await account('contributions-delete', w.session.access, { confirm: 'DELETE_MY_SHARED_REPORTS' });
      expect(del.status, JSON.stringify(del.json)).toBe(200);
      expect(del.json.revoked_connections).toBeGreaterThanOrEqual(1);
      expect(publicFacts('%', w.session.userId)).toBe(0);
      let r = await ingest(w, [early]);
      expect([r.status, r.json.error?.code]).toEqual([403, 'connection_revoked']);
      const { r: reg, secret } = await register(w.session, w.dataset);
      expect(reg.status).toBe(200);
      const w2: Writer = { ...w, connectionId: reg.json.connection_id, epoch: reg.json.writer_epoch, secret };
      r = await ingest(w2, [{ ...early, writer_epoch: w2.epoch }]);
      expect(r.json.results[0]).toMatchObject({ status: 'rejected', error: { code: 'deleted' } });
      r = await ingest(w2, [await event(w2, `${report}-new`)]);
      expect(r.json.results[0].status).toBe('accepted');
    });

    it('enforces the single writer epoch: takeover supersedes the old connection', async () => {
      const login = `writer-${randomUUID()}`;
      const w = await writerFor('D', login);
      const other = await register(w.session, w.dataset);
      expect([other.r.status, other.r.json.error?.code]).toEqual([409, 'writer_conflict']);
      const take = await register(w.session, w.dataset, true);
      expect(take.r.status).toBe(200);
      expect(take.r.json.writer_epoch).toBe(w.epoch + 1);
      const r = await ingest(w, [await event(w, `EP-${rid()}`)]);
      expect([r.status, r.json.error.code]).toEqual([403, 'writer_superseded']);
    });

    it('serves the manifest: empty "0", stable token across pages, count = total', async () => {
      const w = await writerFor('A');
      const post = (body: Json) => call('POST', '/functions/v1/community-ingest/manifest', { token: w.session.access, body: { protocol: 1, connection_id: w.connectionId, ...body } });
      let m = await post({ after: null, limit: 5000 });
      expect(m.status, JSON.stringify(m.json)).toBe(200);
      expect(m.json).toMatchObject({ total: 0, manifest_token: '0', key_prefixes: [], next_after: null });
      for (let i = 0; i < 3; i++) expect((await ingest(w, [await event(w, `MF-${i}-${rid()}`)])).status).toBe(200);
      const pages: Json[] = [];
      let after: string | null = null;
      do { m = await post({ after, limit: 2 }); expect(m.status).toBe(200); pages.push(m.json); after = m.json.next_after; } while (after);
      const tokens = new Set(pages.map(p => p.manifest_token));
      expect(tokens.size).toBe(1);
      expect([...tokens][0]).toMatch(/^[0-9]+$/);
      const keys = pages.flatMap(p => p.key_prefixes);
      expect(keys.length).toBe(pages[0].total);
      expect(new Set(keys).size).toBe(keys.length);
      expect(pages[0].total).toBe(3);
      for (const badBody of [{ after: 'zz', limit: 2 }, { after: null, limit: 0 }, { after: null, limit: 5001 }]) {
        const bad = await post(badBody);
        expect([400, 422], JSON.stringify(badBody)).toContain(bad.status);
      }
      const foreign = await call('POST', '/functions/v1/community-ingest/manifest', { token: (await kakaoSession('B')).access,
        body: { protocol: 1, connection_id: w.connectionId, after: null, limit: 10 } });
      expect(foreign.status).toBe(403); // another user's connection: no keys leak
    });

    it('counts one shared report once globally while each account keeps its contribution (2026-09-28 account rule)', async () => {
      // | 순서 | A 내 신고 | B 내 신고 | 전체 고유 신고 |
      // | A가 R 최초 업로드 | 1 | 0 | 1 |
      // | A가 R의 현행기관명 변경본 업로드 | 1 | 0 | 1 |
      // | B가 R의 현행기관명 변경본 업로드 | 1 | 1 | 1 |
      // | B가 같은 내용을 재전송 | 1 | 1 | 1 |
      const report = `SHR-${rid()}`;
      const a = await writerFor('A');
      const b = await writerFor('B');
      const key = createHash('sha256').update(`safetyreport|${report}`).digest('hex');
      const rep = () => Number(sql(`select count(*) from jsonb_array_elements(
        public.internal_analytics_v2_facts(date '2024-01-01', date '2028-12-31', 'all', null, null, null, null)) e
        where e->>'fact_identity' like '%:${key}' and (e->>'is_representative')::boolean;`));
      const contrib = () => sql(`select e->>'contribution_count' from jsonb_array_elements(
        public.internal_analytics_v2_facts(date '2024-01-01', date '2028-12-31', 'all', null, null, null, null)) e
        where e->>'fact_identity' like '%:${key}' and (e->>'is_representative')::boolean;`);
      const overviewReports = async () => {
        const r = await publicApi('overview');
        expect(r.status, JSON.stringify(r.json)).toBe(200);
        return Number(r.json.overview?.report_count?.value);
      };
      const base = await overviewReports();
      // A 최초 업로드: A=1, B=0, 전체=1
      expect((await ingest(a, [await event(a, report)])).json.results[0].status).toBe('accepted');
      expect(publicFacts(`%:${key}`, a.session.userId)).toBe(1);
      expect(publicFacts(`%:${key}`, b.session.userId)).toBe(0);
      expect(rep()).toBe(1);
      expect(await overviewReports()).toBe(base + 1);
      // A가 현행기관명만 바꾼 재업로드: 정상 수신, counts unchanged, A fact preserved (no new fact)
      const renamed = { ...payloadOf('accepted_fine'), agency_name: '부산광역시 해운대구청' };
      expect((await ingest(a, [await event(a, report, renamed)])).json.results[0].status).toBe('accepted');
      expect(count('private.community_report_facts', `source_report_key='${key}'`)).toBe(1);
      expect(publicFacts(`%:${key}`, a.session.userId)).toBe(1);
      expect(rep()).toBe(1);
      expect(await overviewReports()).toBe(base + 1);
      // B가 같은 신고의 이름 변경본 제출: B도 정상 수신(accepted — 이전 모델의 transferred/cross_account_mismatch 대체)
      expect((await ingest(b, [await event(b, report, renamed)])).json.results[0].status).toBe('accepted');
      expect(publicFacts(`%:${key}`, a.session.userId)).toBe(1); // A 기여 보존
      expect(publicFacts(`%:${key}`, b.session.userId)).toBe(1); // B 기여 연결
      expect(rep()).toBe(1); // 전체 고유 1건
      expect(contrib()).toBe('2');
      expect(await overviewReports()).toBe(base + 1);
      // B 재전송: idempotent(no_change), counts unchanged
      expect((await ingest(b, [await event(b, report, renamed)])).json.results[0].status).toBe('no_change');
      expect(count('private.community_report_facts', `source_report_key='${key}'`)).toBe(2);
      expect(rep()).toBe(1);
      expect(await overviewReports()).toBe(base + 1);
      // 같은 계정의 두 번째 dataset(PC·모바일·복원본)도 신고 횟수를 늘리지 않는다
      const { r: reg } = await register(a.session, datasetKey(`second-${rid()}`));
      expect(reg.status).toBe(200);
      const a2: Writer = { ...a, connectionId: reg.json.connection_id, epoch: reg.json.writer_epoch, dataset: '', revision: 0 };
      expect((await ingest(a2, [await event(a2, report, payloadOf('rejected_none'))])).json.results[0].status).toBe('accepted');
      expect(count('private.community_report_facts', `source_report_key='${key}'`)).toBe(3);
      expect(rep()).toBe(1);
      expect(await overviewReports()).toBe(base + 1);
    });

    it('elects the latest distinct answer as the public representative, then applies scope filters', async () => {
      const report = `DIV-${rid()}`;
      const a = await writerFor('A');
      const b = await writerFor('B');
      const key = createHash('sha256').update(`safetyreport|${report}`).digest('hex');
      const repField = (field: string) => sql(`select e->>'${field}' from jsonb_array_elements(
        public.internal_analytics_v2_facts(date '2024-01-01', date '2028-12-31', 'all', null, null, null, null)) e
        where e->>'fact_identity' like '%:${key}' and (e->>'is_representative')::boolean;`);
      const agencyKeyOf = (name: string) => `a1:${createHash('sha256').update(name.normalize('NFC')).digest('hex').slice(0, 24)}`;
      const nameA = payloadOf('accepted_fine').agency_name as string;
      const payloadB = { ...payloadOf('partial_penalty_traffic'), agency_name: '부산광역시 해운대구청' };
      const nameB = payloadB.agency_name as string;
      expect((await ingest(a, [await event(a, report)])).json.results[0].status).toBe('accepted');
      // B의 실제 결과가 다르면(수용 vs 일부수용) B 기여도 별도 관측으로 보존하고 정상 수신한다
      expect((await ingest(b, [await event(b, report, payloadB)])).json.results[0].status).toBe('accepted');
      expect(count('private.community_report_facts', `source_report_key='${key}'`)).toBe(2);
      expect(sql(`select status from private.community_report_facts where source_report_key='${key}' and contributor_id='${a.session.userId}';`)).toBe('accepted');
      expect(sql(`select status from private.community_report_facts where source_report_key='${key}' and contributor_id='${b.session.userId}';`)).toBe('partial');
      // 공개 대표는 최신의 서로 다른 답변(B) — 최초 기여(A) 고정이 아니다(REVIEW2 높음-2).
      // 같은 답변의 단순 재전송은 대표를 뒤집지 않는다(아래 no_change 확인).
      expect(repField('contributor_id')).toBe(b.session.userId);
      expect(repField('status')).toBe('partial');
      // A가 같은 답변을 다시 보내도(no_change) 대표는 그대로다.
      expect((await ingest(a, [await event(a, report)])).json.results[0].status).toBe('no_change');
      expect(repField('contributor_id')).toBe(b.session.userId);
      // 범위 필터는 확정된 대표에 적용된다: 옛 기관 필터에서는 0건, 새 기관 필터에서는 같은 대표 1건.
      const repWithAgency = (agencyKey: string | null) => sql(`select count(*) from jsonb_array_elements(
        public.internal_analytics_v2_facts(date '2024-01-01', date '2028-12-31', 'all', null, '${agencyKey}', null, null)) e
        where e->>'fact_identity' like '%:${key}' and (e->>'is_representative')::boolean;`);
      expect(repWithAgency(agencyKeyOf(nameB))).toBe('1');
      if (agencyKeyOf(nameA) !== agencyKeyOf(nameB)) expect(repWithAgency(agencyKeyOf(nameA))).toBe('0');
    });

    it('moves the representative when the first contributor sends a newer answer (REVIEW3 높음-1)', async () => {
      // A→B→A(새 답변): 대표는 B에 머물지 않고 A로 이동한다. 단순 재전송은 안 뒤집는다.
      const report = `UPD-${rid()}`;
      const a = await writerFor('A');
      const b = await writerFor('B');
      const key = createHash('sha256').update(`safetyreport|${report}`).digest('hex');
      const repField = (field: string) => sql(`select e->>'${field}' from jsonb_array_elements(
        public.internal_analytics_v2_facts(date '2024-01-01', date '2028-12-31', 'all', null, null, null, null)) e
        where e->>'fact_identity' like '%:${key}' and (e->>'is_representative')::boolean;`);
      expect((await ingest(a, [await event(a, report)])).json.results[0].status).toBe('accepted');
      const payloadB = { ...payloadOf('partial_penalty_traffic'), agency_name: '부산광역시 해운대구청' };
      expect((await ingest(b, [await event(b, report, payloadB)])).json.results[0].status).toBe('accepted');
      expect(repField('contributor_id')).toBe(b.session.userId);
      // A가 새 처리 결과(답변일도 새로움)로 갱신하면 대표가 A로 이동한다.
      const newer = { ...payloadOf('accepted_fine'), completed_date: '2026-09-12' };
      expect((await ingest(a, [await event(a, report, newer)])).json.results[0].status).toBe('accepted');
      expect(repField('contributor_id')).toBe(a.session.userId);
      expect(repField('completed_date')).toBe('2026-09-12');
      // 같은 답변 재전송(no_change)은 대표를 움직이지 않는다.
      expect((await ingest(a, [await event(a, report, newer)])).json.results[0].status).toBe('no_change');
      expect(repField('contributor_id')).toBe(a.session.userId);
      expect((await ingest(b, [await event(b, report, payloadB)])).json.results[0].status).toBe('no_change');
      expect(repField('contributor_id')).toBe(a.session.userId);
    });

    it('resolves pre- and post-change agency codes to one institution key in any arrival order (REVIEW3 높음-2)', async () => {
      // 승계 전 코드로 먼저 와도, 후 코드로 먼저 와도 같은 현행 기관 키로 묶인다(신규 수신 행 포함).
      const a = await writerFor('A');
      const b = await writerFor('B');
      const oldCode = { ...payloadOf('accepted_fine'), source_agency_code: '1812314', agency_name: '광주광역시경찰청' };
      const newCode = { ...payloadOf('accepted_fine'), source_agency_code: '1815198', agency_name: '광주경찰청' };
      const keysOf = (report: string) => sql(`select string_agg(distinct agency_key, ',' order by agency_key)
        from private.community_report_facts where source_report_id = '${report}';`);
      const namesOf = (report: string) => sql(`select string_agg(distinct agency_current_name, ',' order by agency_current_name)
        from private.community_report_facts where source_report_id = '${report}';`);
      const repsOf = (report: string) => {
        const key = createHash('sha256').update(`safetyreport|${report}`).digest('hex');
        return sql(`select count(*) from jsonb_array_elements(
          public.internal_analytics_v2_facts(date '2024-01-01', date '2028-12-31', 'all', null, null, null, null)) e
          where e->>'fact_identity' like '%:${key}' and (e->>'is_representative')::boolean;`);
      };
      const r1 = `SUC-old-first-${rid()}`;
      expect((await ingest(a, [await event(a, r1, oldCode)])).json.results[0].status).toBe('accepted');
      expect((await ingest(b, [await event(b, r1, newCode)])).json.results[0].status).toBe('accepted');
      expect(keysOf(r1)).toBe('inst:ag-gwangju-police-hq');
      expect(namesOf(r1)).toBe('광주경찰청');
      expect(repsOf(r1)).toBe('1');
      const r2 = `SUC-new-first-${rid()}`;
      expect((await ingest(b, [await event(b, r2, newCode)])).json.results[0].status).toBe('accepted');
      expect((await ingest(a, [await event(a, r2, oldCode)])).json.results[0].status).toBe('accepted');
      expect(keysOf(r2)).toBe('inst:ag-gwangju-police-hq');
      expect(namesOf(r2)).toBe('광주경찰청');
      expect(repsOf(r2)).toBe('1');
    });

    it('keeps a numberless observation on its identity whatever period is queried (REVIEW3 중간-3)', async () => {
      // 번호 있는 관측(09-01/09-10)과 번호 없는 관측(09-21/09-22): 좁은 창(09-20~09-25,
      // 이전 창 09-14~09-25 — A의 날짜는 완전히 밖)에서도 번호 없는 관측은 같은 report_identity 에 붙는다.
      const report = `WIN-${rid()}`;
      const a = await writerFor('A');
      const b = await writerFor('B');
      const key = createHash('sha256').update(`safetyreport|${report}`).digest('hex');
      const idOf = (start: string, end: string) => sql(`select string_agg(distinct e->>'report_identity', ',' order by e->>'report_identity')
        from jsonb_array_elements(
          public.internal_analytics_v2_facts(date '${start}', date '${end}', 'all', null, null, null, null)) e
        where e->>'fact_identity' like '%:${key}' and (e->>'is_representative')::boolean;`);
      expect((await ingest(a, [await event(a, report)])).json.results[0].status).toBe('accepted');
      const later = { ...payloadOf('accepted_fine'), report_date: '2026-09-21', completed_date: '2026-09-22' };
      const next = await event(b, report, later, { report_number: null });
      expect((await ingest(b, [next])).json.results[0].status).toBe('accepted');
      const wide = idOf('2024-01-01', '2028-12-31');
      const narrow = idOf('2026-09-20', '2026-09-25');
      expect(narrow).not.toBe('');
      expect(narrow).toBe(wide);
      expect(wide).toContain('SPP-2609-8000001');
    });

    it('isolates different report_numbers into separate public identities (no cross-number merge)', async () => {
      const a = await writerFor('A');
      const b = await writerFor('B');
      const repsOf = (key: string) => sql(`select count(*) from jsonb_array_elements(
        public.internal_analytics_v2_facts(date '2024-01-01', date '2028-12-31', 'all', null, null, null, null)) e
        where e->>'fact_identity' like '%:${key}' and (e->>'is_representative')::boolean;`);
      const identitiesOf = (key: string) => sql(`select string_agg(distinct e->>'report_identity', ',' order by e->>'report_identity') from jsonb_array_elements(
        public.internal_analytics_v2_facts(date '2024-01-01', date '2028-12-31', 'all', null, null, null, null)) e
        where e->>'fact_identity' like '%:${key}' and (e->>'is_representative')::boolean;`);
      // 같은 번호: B 기여도 정상 수신, 전체 고유 1건
      {
        const report = `NUM-same-${rid()}`;
        const key = createHash('sha256').update(`safetyreport|${report}`).digest('hex');
        expect((await ingest(a, [await event(a, report)])).json.results[0].status).toBe('accepted');
        expect((await ingest(b, [await event(b, report)])).json.results[0].status).toBe('accepted');
        expect(count('private.community_report_facts', `source_report_key='${key}'`)).toBe(2);
        expect(repsOf(key)).toBe('1');
      }
      // 번호 없는 구버전 관측: 번호 그룹에 붙는다(와일드카드) — 전체 고유 1건 유지
      {
        const report = `NUM-legacy-${rid()}`;
        const key = createHash('sha256').update(`safetyreport|${report}`).digest('hex');
        expect((await ingest(a, [await event(a, report)])).json.results[0].status).toBe('accepted');
        const next = await event(b, report, payloadOf('accepted_fine'), { report_number: null });
        expect((await ingest(b, [next])).json.results[0].status).toBe('accepted');
        expect(count('private.community_report_facts', `source_report_key='${key}'`)).toBe(2);
        expect(repsOf(key)).toBe('1');
      }
      // 둘 다 번호가 있는데 다르면: 격리 — 서로 다른 실제 신고이므로 공개 2건 (REVIEW2 높음-1)
      {
        const report = `NUM-split-${rid()}`;
        const key = createHash('sha256').update(`safetyreport|${report}`).digest('hex');
        expect((await ingest(a, [await event(a, report)])).json.results[0].status).toBe('accepted');
        const next = await event(b, report, payloadOf('accepted_fine'), { report_number: 'SPP-2609-8000002' });
        expect((await ingest(b, [next])).json.results[0].status).toBe('accepted');
        expect(count('private.community_report_facts', `source_report_key='${key}'`)).toBe(2);
        expect(repsOf(key)).toBe('2');
        expect(identitiesOf(key).split(',')).toHaveLength(2);
      }
    });

    it('preserves a stored agency code when an older app version re-observes without the key', async () => {
      // REVIEW2 높음-4: v1/v2 payload 에는 source_agency_code 키가 없다 — 키 부재가 명시적 NULL 이 아니다.
      const w = await writerFor('D');
      const report = `CODE-${rid()}`;
      const key = () => sql(`select source_report_key from private.community_ingest_events where source_report_id = '${report}' limit 1;`);
      const storedCode = () => sql(`select coalesce(source_agency_code, '<null>') from private.community_report_facts
        where contributor_id = '${w.session.userId}' and source_report_id = '${report}';`);
      const v3 = { ...payloadOf('accepted_fine'), source_agency_code: 'B410002' };
      expect((await ingest(w, [await event(w, report, v3)])).json.results[0].status).toBe('accepted');
      expect(storedCode()).toBe('B410002');
      // v1 키셋(violation_law·source_agency_code 없음)으로 더 높은 revision 을 보내도 코드는 유지된다.
      const { source_agency_code: _dropCode, violation_law: _dropLaw, rating: _dropRating, ...v1 } = payloadOf('accepted_fine');
      expect((await ingest(w, [await event(w, report, v1)])).json.results[0].status).toBe('accepted');
      expect(storedCode()).toBe('B410002');
      // v3 명시적 null(키 있음)은 코드를 지운다.
      expect((await ingest(w, [await event(w, report, payloadOf('accepted_fine'))])).json.results[0].status).toBe('accepted');
      expect(storedCode()).toBe('<null>');
      expect(key()).not.toBe('');
    });

    it('does not attach a stored agency code to a renamed answer from an older app (REVIEW3 중간-4)', async () => {
      // v3 저장 뒤 v1(키 없음)이 기관명이 바뀐 답변을 보내면 옛 코드를 붙이지 않는다.
      const w = await writerFor('D');
      const report = `CODE-rename-${rid()}`;
      const storedCode = () => sql(`select coalesce(source_agency_code, '<null>') from private.community_report_facts
        where contributor_id = '${w.session.userId}' and source_report_id = '${report}';`);
      const storedAgency = () => sql(`select agency_name from private.community_report_facts
        where contributor_id = '${w.session.userId}' and source_report_id = '${report}';`);
      const v3 = { ...payloadOf('accepted_fine'), source_agency_code: 'B410002' };
      expect((await ingest(w, [await event(w, report, v3)])).json.results[0].status).toBe('accepted');
      expect(storedCode()).toBe('B410002');
      // v1 + 같은 기관명 + 다른 답변 → 코드 보존.
      const { source_agency_code: _d1, violation_law: _d2, rating: _d3, ...v1base } = payloadOf('accepted_fine');
      const v1same = { ...v1base, status: 'partial', status_raw: '일부수용' };
      expect((await ingest(w, [await event(w, report, v1same)])).json.results[0].status).toBe('accepted');
      expect(storedCode()).toBe('B410002');
      // v1 + 바뀐 기관명 → 옛 코드 미부착(NULL).
      const v1renamed = { ...v1base, status: 'partial', status_raw: '일부수용', agency_name: '부산광역시 해운대구청' };
      expect((await ingest(w, [await event(w, report, v1renamed)])).json.results[0].status).toBe('accepted');
      expect(storedAgency()).toBe('부산광역시 해운대구청');
      expect(storedCode()).toBe('<null>');
    });

    it('keeps the institution key when an older app re-observes the same agency without the key (REVIEW4)', async () => {
      // 승계 코드(v3)로 저장된 뒤 v1(키 없음)이 같은 기관명의 새 답변을 보내면
      // 코드뿐 아니라 기관 키·현행명도 보존된다 — derived 기관명 해시(a1:)로
      // 덮으면 inst: 통계가 갈라지는 회귀(REVIEW4 중간-2).
      const w = await writerFor('D');
      const report = `CODE-keepkey-${rid()}`;
      const stored = (col: string) => sql(`select coalesce(${col}, '<null>') from private.community_report_facts
        where contributor_id = '${w.session.userId}' and source_report_id = '${report}';`);
      const v3 = { ...payloadOf('accepted_fine'), source_agency_code: '1812314', agency_name: '광주광역시경찰청' };
      expect((await ingest(w, [await event(w, report, v3)])).json.results[0].status).toBe('accepted');
      expect(stored('agency_key')).toBe('inst:ag-gwangju-police-hq');
      expect(stored('agency_current_name')).toBe('광주경찰청');
      // v1 + 같은 기관명 + 다른 답변 → 코드·기관 키·현행명 모두 보존.
      const { source_agency_code: _k1, violation_law: _k2, rating: _k3, ...v1base } = payloadOf('accepted_fine');
      const v1same = { ...v1base, status: 'partial', status_raw: '일부수용', agency_name: '광주광역시경찰청' };
      expect((await ingest(w, [await event(w, report, v1same)])).json.results[0].status).toBe('accepted');
      expect(stored('source_agency_code')).toBe('1812314');
      expect(stored('agency_key')).toBe('inst:ag-gwangju-police-hq');
      expect(stored('agency_current_name')).toBe('광주경찰청');
      // v1 + 바뀐 기관명 → 코드는 NULL, 키는 새 derived(옛 inst: 미부착).
      const v1renamed = { ...v1base, status: 'partial', status_raw: '일부수용', agency_name: '부산광역시 해운대구청' };
      expect((await ingest(w, [await event(w, report, v1renamed)])).json.results[0].status).toBe('accepted');
      expect(stored('source_agency_code')).toBe('<null>');
      expect(stored('agency_key')).not.toBe('inst:ag-gwangju-police-hq');
    });

    it('keeps the other account contribution when one account deletes its own (tombstone independence)', async () => {
      // A의 공유 삭제/철회는 A의 관계만 처리한다. B가 유효하게 공유한 관계는 유지되고 전체 대표는 B로 승계된다.
      const report = `DEL-${rid()}`;
      const f = await writerFor('F');
      const g = await writerFor('G');
      const key = createHash('sha256').update(`safetyreport|${report}`).digest('hex');
      const repContributor = () => sql(`select e->>'contributor_id' from jsonb_array_elements(
        public.internal_analytics_v2_facts(date '2024-01-01', date '2028-12-31', 'all', null, null, null, null)) e
        where e->>'fact_identity' like '%:${key}' and (e->>'is_representative')::boolean;`);
      expect((await ingest(f, [await event(f, report)])).json.results[0].status).toBe('accepted');
      expect((await ingest(g, [await event(g, report)])).json.results[0].status).toBe('accepted');
      expect(repContributor()).toBe(f.session.userId);
      expect((await account('contributions-delete', f.session.access, { confirm: 'DELETE_MY_SHARED_REPORTS' })).status).toBe(200);
      expect(publicFacts(`%:${key}`, f.session.userId)).toBe(0);
      expect(publicFacts(`%:${key}`, g.session.userId)).toBe(1);
      expect(publicFacts(`%:${key}`)).toBe(1); // 전체 고유 1건 유지
      expect(repContributor()).toBe(g.session.userId); // 대표가 G로 승계
      // G의 기여는 그대로 유효하다: 재전송도 정상 처리된다
      expect((await ingest(g, [await event(g, report)])).json.results[0].status).toBe('no_change');
    });

    it('serializes concurrent contributions of one report without duplicates', async () => {      const report = `RACE-${rid()}`;
      const a = await writerFor('A');
      const b = await writerFor('B');
      const key = createHash('sha256').update(`safetyreport|${report}`).digest('hex');
      const [left, right] = await Promise.all([
        ingest(a, [await event(a, report)]), ingest(b, [await event(b, report)]),
      ]);
      // 둘 다 accepted: 한 요청의 일부 실패로 잘못 ACK하지 않고, 계정 연결이 중복 생성되지 않는다
      expect([left.json.results[0].status, right.json.results[0].status].sort()).toEqual(['accepted', 'accepted']);
      expect(count('private.community_report_facts', `source_report_id='${report}'`)).toBe(2);
      expect(publicFacts(`%:${key}`, a.session.userId)).toBe(1);
      expect(publicFacts(`%:${key}`, b.session.userId)).toBe(1);
    });

    it('keeps the last answered state when a legacy correction says it is no longer final (2026-09-28: no corrections)', async () => {
      const w = await writerFor('D');
      const report = `CORR-${rid()}`;
      expect((await ingest(w, [await event(w, report)])).json.results[0].projection_status).toBe('published');
      const key = sql(`select source_report_key from private.community_ingest_events where source_report_id = '${report}' limit 1;`);
      expect(publicFacts(`%:${key}`)).toBe(1);
      const r = await ingest(w, [await event(w, report, payloadOf('withdrawn_not_eligible'), { event_type: 'status_correction' })]);
      expect(r.json.results[0]).toMatchObject({ status: 'rejected', durable: false,
        error: { code: 'non_final_not_accepted', retryable: false } });
      expect(publicFacts(`%:${key}`)).toBe(1);
      expect(sql(`select status from private.community_report_facts where source_report_id = '${report}';`)).toBe('accepted');
    });

    it('rejects a non-final event per event while the rest of an old-client batch still processes', async () => {
      const w = await writerFor('D');
      const good = await event(w, `MIX-${rid()}`);
      const bad = await event(w, `MIX-${rid()}`, payloadOf('processing_not_eligible'));
      const r = await ingest(w, [good, bad]);
      expect(r.status, JSON.stringify(r.json)).toBe(200);
      expect(r.json.results[0]).toMatchObject({ status: 'accepted', durable: true });
      expect(r.json.results[1]).toMatchObject({ status: 'rejected', durable: false,
        error: { code: 'non_final_not_accepted', retryable: false } });
      expect(count('private.community_report_facts', `source_report_id = '${good.source_report_id}'`)).toBe(1);
      expect(count('private.community_report_facts', `source_report_id = '${bad.source_report_id}'`)).toBe(0);
    });

    it('races ingest against revoke, takeover and a policy switch without deadlocks or partial writes (S-09)', async () => {
      const deadlocks = () => Number(execFileSync('sh', ['-c', `docker logs ${DB_CONTAINER} 2>&1 | grep -c "deadlock detected" || true`], { encoding: 'utf8' }).trim() || '0');
      const before = deadlocks();
      const statuses: number[] = [];
      const codes: string[] = [];
      const server5xx: string[] = [];
      const deletedUsers: string[] = [];
      const serveEventsBefore = runtimeTerminations();
      const runtime5xx: string[] = [];
      const record = (r: { status: number; json: Json }) => {
        statuses.push(r.status);
        if (r.json.error?.code) codes.push(r.json.error.code);
        // 제품이 낸 5xx(계약 오류 JSON: error.code)는 실패. 로컬 edge runtime 이 작업자를 재활용하며 끊은 요청의 503
        // (계약 형식 아님, serve 로그 "connection closed before message completed")은 앱이 재시도하는 일시 장애로 따로 기록한다.
        if (r.status >= 500 && r.json.error?.code) server5xx.push(JSON.stringify(r.json).slice(0, 200));
        else if (r.status >= 500) runtime5xx.push(`${r.status} ${JSON.stringify(r.json).slice(0, 120)}`);
      };
      const nextPolicy = `2026-09-26.${900 + Math.floor(Math.random() * 99)}`;
      try {
        for (let round = 0; round < 3; round++) {
          sql('delete from private.rate_limits; delete from private.community_auth_rate_limits;');
          const a = await writerFor('A');
          const b = await writerFor('C');
          const burst = async (w: Writer, n: number) => { for (let i = 0; i < n; i++) record(await ingest(w, [await event(w, `RC${round}${i}-${rid()}`)])); };
          const d = await writerFor('D');
          deletedUsers.push(d.session.userId);
          await Promise.all([
            burst(a, 6), burst(b, 6), burst(d, 6),
            (async () => { await new Promise(r => setTimeout(r, 20 * round)); record(await account('contributions-delete', d.session.access, { confirm: 'DELETE_MY_SHARED_REPORTS' })); })(),
            (async () => record(await account('consent-revoke', a.session.access, { grant_id: a.grantId })))(),
            (async () => record((await register(b.session, b.dataset, true)).r))(),
            (async () => { if (round === 2) sql(`insert into private.community_policies(version, consent_text_sha256) values ('${nextPolicy}', '${'a'.repeat(64)}') on conflict (version) do nothing; update private.community_policy_current set version = '${nextPolicy}', effective_at = now();`); })(),
            burst(a, 4),
          ]);
        }
      } finally {
        sql(`update private.community_policy_current set version = '${POLICY}', effective_at = now();`);
      }
      expect(deadlocks() - before).toBe(0);
      // 삭제와 경쟁한 ingest: 삭제 전에 커밋된 fact 는 삭제되고, 뒤에 온 요청은 폐기된 연결로 거절 → D 의 공개 fact 0
      expect(deletedUsers).toHaveLength(3);
      for (const u of deletedUsers) expect(publicFacts('%', u), u).toBe(0);
      expect(codes).not.toContain('busy');
      expect(server5xx).toEqual([]);
      // 계약 형식이 아닌 5xx 는 같은 시간대 edge runtime 의 작업자 종료 기록과 1:1 로 대응될 때만 런타임 원인으로 인정한다
      const runtimeEvents = runtimeTerminations() - serveEventsBefore;
      if (runtime5xx.length) console.warn(`[race] non-contract 5xx=${runtime5xx.length}, runtime worker terminations=${runtimeEvents}: ${runtime5xx.join(' | ')}`);
      expect(runtime5xx.length, 'every non-contract 5xx must match a logged runtime worker termination').toBeLessThanOrEqual(runtimeEvents);
      // every refused request wrote nothing: each ledger row belongs to an accepted-state connection at write time
      expect(count('private.community_ingest_events', "result = 'pending'")).toBe(0);
    }, 120_000);

    it('bumps the public dataset version on operator DML and serves the new value over HTTP (N-09, §20-4)', async () => {
      const w = await writerFor('A');
      const report = `DML-${rid()}`;
      expect((await ingest(w, [await event(w, report)])).json.results[0].projection_status).toBe('published');
      const v0 = (await publicMeta()).dataset_version;
      const otherCount = async () => {
        const r = await call('GET', `/functions/v1/public-analytics/overview?${SCOPE}&category=other`, { apikey: null, token: await viewer() });
        expect(r.status).toBe(200);
        return { version: r.json.dataset_version as string, n: r.json.overview.report_count.value as number };
      };
      const before = await otherCount();
      sql(`update private.community_report_facts set category = 'other' where source_report_id = '${report}';`);
      const v1 = (await publicMeta()).dataset_version;
      expect(v1).not.toBe(v0);
      const after = await otherCount();
      expect(after.version).toBe(v1);
      expect(after.n).toBe(before.n + 1); // 운영자가 바꾼 값이 새 익명 조회에 그대로 나온다
    });
  });
});
