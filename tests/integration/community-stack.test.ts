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
const POLICY = '2026-09-26.1';
const CONSENT_HASH = readFileSync(new URL('../../contracts/community-ingest/consent/share-consent-2026-09-26.1.sha256', import.meta.url), 'utf8').split(/\s/)[0];
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
const ingestRaw = (body: unknown, token: string | null, headers?: Record<string, string>) =>
  call('POST', '/functions/v1/community-ingest', { token, body, headers });
const SCOPE = 'start=2024-01-01&end=2028-12-31';
const publicApi = (route: string) => call('GET', `/functions/v1/public-analytics/${route}${route === 'meta' ? '' : `?${SCOPE}`}`, { apikey: null });

// ── sessions ──────────────────────────────────────────────────────────────────
const b64url = (b: Buffer) => b.toString('base64url');
const rid = () => randomBytes(8).toString('hex'); // source_report_id is ^[0-9A-Za-z_-]{1,40}$
interface Session { access: string; refresh: string; userId: string; sessionId: string }

async function kakaoSession(choice: 'A' | 'B' | 'C' | 'D'): Promise<Session> {
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

async function writerFor(choice: 'A' | 'B' | 'C' | 'D', login = `int-${randomUUID()}`): Promise<Writer> {
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
    source_revision: w.revision, writer_epoch: w.epoch, captured_at: new Date().toISOString(), payload,
    payload_sha256: await sha256Hex(canonicalJson(payload)), ...opts };
}
const envelope = (w: Writer, events: unknown[], over: Partial<Json> = {}) => ({ protocol: 1, contract: 'community-ingest-v1',
  source_app: 'safetyreport', source_mode: 'server', connection_id: w.connectionId, consent_grant_id: w.grantId, policy_version: POLICY,
  client_version: 'it-1', parser_version: 'pc-parser-1', trigger: 'manual', events, ...over });
const ingest = (w: Writer, events: unknown[], over: Partial<Json> = {}, token = w.session.access) => ingestRaw(envelope(w, events, over), token);

const ledger = () => count('private.community_ingest_events');
// What the anonymous public API serves (same SECURITY DEFINER function public-analytics calls), optionally per contributor.
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
  beforeAll(() => {
    const status = JSON.parse(execFileSync('npx', ['supabase', 'status', '-o', 'json', '--workdir', '.integration-stack'], { encoding: 'utf8' }));
    keys = status as Keys;
    // shared local stack: reset only rate-limit windows so reruns are independent
    sql('delete from private.rate_limits; delete from private.community_auth_rate_limits;');
    // deployment-and-rollback.md step 7: the operator switches the public projection on
    sql('update private.analytics_state set ready = true, published_at = coalesce(published_at, now()) where singleton;');
  });

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
      let r = await ingest(fakeWriter, [await event(fakeWriter, 'NC-1')]);
      expect(r.status).toBe(403);
      expect(r.json.error.code).toMatch(/^consent_/);
      // consent but no connection
      fakeWriter.grantId = await consent(s);
      r = await ingest(fakeWriter, [await event(fakeWriter, 'NC-2')]);
      expect([r.status, r.json.error.code]).toEqual([403, 'connection_unknown']);
      // someone else's connection id → same answer as unknown (no existence leak)
      const other = await writerFor('C');
      r = await ingest({ ...fakeWriter, connectionId: other.connectionId }, [await event(fakeWriter, 'NC-3')]);
      expect([r.status, r.json.error.code]).toEqual([403, 'connection_unknown']);
      // A's token with B's (other's) connection+grant in the body
      r = await ingestRaw(envelope(other, [await event(other, 'NC-4')]), s.access);
      expect(r.status).toBe(403);
      expect(ledger()).toBe(before);
      // same user, a second session: refused until rebind
      const w = await writerFor('D');
      const second = await kakaoSession('D');
      r = await ingest(w, [await event(w, 'NC-5')], {}, second.access);
      expect([r.status, r.json.error.code]).toEqual([403, 'connection_session_mismatch']);
      const rebind = await account('connections-rebind', second.access, { connection_id: w.connectionId, connection_secret: w.secret });
      expect(rebind.status, JSON.stringify(rebind.json)).toBe(200);
      r = await ingest(w, [await event(w, 'NC-5b')], {}, second.access);
      expect(r.status, JSON.stringify(r.json)).toBe(200);
      expect(r.json.results[0].status).toBe('accepted');
      // the first session is now refused
      r = await ingest(w, [await event(w, 'NC-6')]);
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
      for (let i = 0; i < 32; i++) statuses.push((await account('status', s.access)).status);
      expect(statuses).toContain(429);
      sql('delete from private.community_auth_rate_limits;');
    });

    it('blocks direct REST/RPC/GraphQL access to private data and leaves row counts unchanged', async () => {
      const w = await writerFor('B');
      const tables = ['private.community_ingest_events', 'private.community_report_facts', 'private.community_connections',
        'private.community_consent_grants', 'private.community_fact_tombstones', 'private.community_deletion_fences'];
      const before = Object.fromEntries(tables.map(t => [t, count(t)]));
      const bearers: [string, string | undefined][] = [['publishable', undefined], ['anon', keys.ANON_KEY], ['user', w.session.access]];
      for (const [label, token] of bearers) {
        for (const table of ['community_ingest_events', 'community_report_facts', 'community_connections', 'community_consent_grants']) {
          const sel = await call('GET', `/rest/v1/${table}?select=*`, { token, headers: { 'Accept-Profile': 'private' } });
          expect(sel.status, `${label} select private.${table}`).toBeGreaterThanOrEqual(400);
          const ins = await call('POST', `/rest/v1/${table}`, { token, body: { id: 1 }, headers: { 'Content-Profile': 'private', Prefer: 'resolution=merge-duplicates' } });
          expect(ins.status, `${label} insert private.${table}`).toBeGreaterThanOrEqual(400);
          const pub = await call('GET', `/rest/v1/${table}?select=*`, { token });
          expect(pub.status, `${label} public.${table}`).toBeGreaterThanOrEqual(400);
        }
        for (const fn of ['internal_community_ingest', 'internal_community_manifest', 'internal_community_delete_contributions',
          'internal_analytics_v2_facts', 'internal_analytics_v2_state', 'internal_community_ingest_rate_limit', 'internal_account_status',
          'internal_grant_consent', 'internal_revoke_consent', 'internal_register_connection', 'internal_rebind_connection',
          'internal_revoke_connection', 'internal_activate_snapshot', 'internal_cleanup_expired']) {
          const r = await call('POST', `/rest/v1/rpc/${fn}`, { token, body: { p_user: w.session.userId, p_session: w.session.sessionId } });
          expect(r.status, `${label} rpc ${fn}: ${JSON.stringify(r.json).slice(0, 120)}`).toBeGreaterThanOrEqual(400);
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
      // an older revision arriving late (offline backlog) must not roll the fact back
      const stale = await event(w, report, payloadOf('withdrawn_not_eligible'), { source_revision: 1, event_type: 'status_correction' });
      const r = await ingest(w, [stale]);
      expect(r.status, JSON.stringify(r.json)).toBe(200);
      expect(r.json.results[0].status).toBe('stale_ignored');
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

    it('races ingest against revoke, takeover and a policy switch without deadlocks or partial writes (S-09)', async () => {
      const deadlocks = () => Number(execFileSync('sh', ['-c', `docker logs ${DB_CONTAINER} 2>&1 | grep -c "deadlock detected" || true`], { encoding: 'utf8' }).trim() || '0');
      const before = deadlocks();
      const statuses: number[] = [];
      const codes: string[] = [];
      const record = (r: { status: number; json: Json }) => { statuses.push(r.status); if (r.json.error?.code) codes.push(r.json.error.code); };
      const nextPolicy = `2026-09-26.${900 + Math.floor(Math.random() * 99)}`;
      try {
        for (let round = 0; round < 3; round++) {
          sql('delete from private.rate_limits; delete from private.community_auth_rate_limits;');
          const a = await writerFor('A');
          const b = await writerFor('C');
          const burst = async (w: Writer, n: number) => { for (let i = 0; i < n; i++) record(await ingest(w, [await event(w, `RC${round}${i}-${rid()}`)])); };
          await Promise.all([
            burst(a, 6), burst(b, 6),
            (async () => record(await account('consent-revoke', a.session.access, { grant_id: a.grantId })))(),
            (async () => record((await register(b.session, b.dataset, true)).r))(),
            (async () => { if (round === 2) sql(`insert into private.community_policies(version, consent_text_sha256) values ('${nextPolicy}', '${'a'.repeat(64)}'); update private.community_policy_current set version = '${nextPolicy}', effective_at = now();`); })(),
            burst(a, 4),
          ]);
        }
      } finally {
        sql(`update private.community_policy_current set version = '${POLICY}', effective_at = now();`);
      }
      expect(deadlocks() - before).toBe(0);
      expect(codes).not.toContain('busy');
      expect(statuses.filter(st => st >= 500)).toEqual([]);
      // every refused request wrote nothing: each ledger row belongs to an accepted-state connection at write time
      expect(count('private.community_ingest_events', "result = 'pending'")).toBe(0);
    });

    it('bumps the public dataset version on operator DML too (N-09)', async () => {
      const v0 = (await publicMeta()).dataset_version;
      sql("update private.community_report_facts set manager_name = manager_name where ctid = (select ctid from private.community_report_facts where public_state = 'completed' limit 1);");
      const v1 = (await publicMeta()).dataset_version;
      expect(v1).not.toBe(v0);
    });
  });
});
