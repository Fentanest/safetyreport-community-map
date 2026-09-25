// community-ingest handler without a database: auth, strict envelope, server hash, one event per report, derived
// columns and RPC error mapping. The SQL side is covered by the integration stack tests.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createIngestHandler } from '../../server/ingest/handler';
import { canonicalJson, sha256Hex } from '../../server/ingest/observation';

const UID = '6f37df54-911b-4c37-8020-a0b45a84591d';
const SID = '0b1c2d3e-4f50-4a61-8b72-9c8d7e6f5a4b';
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (c: Record<string, unknown>) => `${b64({ alg: 'ES256' })}.${b64(c)}.sig`;
const claims = { sub: UID, role: 'authenticated', aud: 'authenticated', session_id: SID, is_anonymous: false };
const vectors = JSON.parse(readFileSync(new URL('../../contracts/community-ingest/vectors/observations.json', import.meta.url), 'utf8'));
const payload = vectors.cases[0].expected_payload;

async function event(id: string, reportId = 'R1', p = payload, type = 'completed_observation') {
  return { event_id: id, event_type: type, source_system: 'safetyreport', source_report_id: reportId, source_revision: 1,
    writer_epoch: 3, captured_at: '2026-09-26T01:02:03.004Z', payload: p, payload_sha256: await sha256Hex(canonicalJson(p)) };
}
const envelope = async (events: unknown[]) => ({ protocol: 1, contract: 'community-ingest-v1', source_app: 'safetyreport',
  source_mode: 'server', connection_id: '11111111-2222-3333-4444-555555555555', consent_grant_id: '66666666-7777-8888-9999-000000000000',
  policy_version: '2026-09-26.1', client_version: '1.2.3', parser_version: 'pc-parser-1', trigger: 'realtime', events });

function setup(rpcResult: (name: string, args: Record<string, unknown>) => unknown = () => ({ results: [] })) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const handler = createIngestHandler({ enabled: true, jwtIssuer: null, allowedOrigins: ['https://safemap.worklazy.net'],
    getUser: async t => (t.includes(b64(claims)) ? { id: UID, isAnonymous: false } : null),
    rpc: async (name, args) => { calls.push({ name, args }); return name.endsWith('rate_limit') ? true : rpcResult(name, args); } });
  return { handler, calls };
}
const post = (body: unknown, token: string | null = jwt(claims), path = '/functions/v1/community-ingest') =>
  new Request(`https://p.supabase.co${path}`, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json', apikey: 'sb_publishable_x', ...(token ? { authorization: `Bearer ${token}` } : {}) } });

describe('community-ingest handler', () => {
  it('requires a user JWT (publishable key alone or as bearer is refused)', async () => {
    const { handler, calls } = setup();
    expect((await handler(post(await envelope([await event('7d9f3b52-1c4e-4a8b-9f0e-2a3b4c5d6e7f')]), null))).status).toBe(401);
    expect((await handler(post(await envelope([]), 'sb_publishable_x'))).status).toBe(401);
    expect((await handler(post(await envelope([]), jwt({ ...claims, sub: 'other' })))).status).toBe(401);
    expect((await handler(post(await envelope([]), jwt({ ...claims, is_anonymous: true })))).status).toBe(401);
    expect(calls.filter(c => c.name === 'internal_community_ingest')).toHaveLength(0);
  });

  it('OPTIONS answers CORS for allowed origins without auth or side effects', async () => {
    const { handler, calls } = setup();
    const res = await handler(new Request('https://p.supabase.co/functions/v1/community-ingest', { method: 'OPTIONS', headers: { origin: 'https://safemap.worklazy.net' } }));
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://safemap.worklazy.net');
    const other = await handler(new Request('https://p.supabase.co/functions/v1/community-ingest', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }));
    expect(other.headers.get('access-control-allow-origin')).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('rejects unknown fields, bad hashes, duplicate reports and inconsistent event types before any write', async () => {
    const { handler, calls } = setup();
    const e = await event('7d9f3b52-1c4e-4a8b-9f0e-2a3b4c5d6e7f');
    expect((await handler(post({ ...(await envelope([e])), user_id: UID }))).status).toBe(422);
    expect((await handler(post(await envelope([{ ...e, payload_sha256: 'a'.repeat(64) }])))).status).toBe(422);
    const e2 = await event('8d9f3b52-1c4e-4a8b-9f0e-2a3b4c5d6e7f');
    expect((await handler(post(await envelope([e, e2])))).status).toBe(422);  // same report twice (S-11-B)
    const withdrawn = { ...payload, status: 'withdrawn', status_raw: '취하', completed_date: null };
    expect((await handler(post(await envelope([await event('9d9f3b52-1c4e-4a8b-9f0e-2a3b4c5d6e7f', 'R2', withdrawn)])))).status).toBe(422);
    expect((await handler(post(await envelope(Array.from({ length: 21 }, () => e))))).status).toBe(422);
    expect(calls.filter(c => c.name === 'internal_community_ingest')).toHaveLength(0);
  });

  it('passes server-computed keys, hashes and derived columns; the user comes from the token', async () => {
    const { handler, calls } = setup(() => ({ results: [{ event_id: 'x', status: 'accepted', durable: true }], dataset_version: 'v' }));
    const res = await handler(post(await envelope([await event('7d9f3b52-1c4e-4a8b-9f0e-2a3b4c5d6e7f')])));
    expect(res.status).toBe(200);
    const call = calls.find(c => c.name === 'internal_community_ingest')!;
    expect(call.args.p_user).toBe(UID); expect(call.args.p_session).toBe(SID);
    const ev = (call.args.p_events as Record<string, unknown>[])[0];
    expect(ev.source_report_key).toBe(await sha256Hex('safetyreport|R1'));
    expect(ev.payload_sha256).toBe(vectors.cases[0].payload_sha256);
    expect((ev.derived as Record<string, unknown>).point_key).toBe('v1:37.5662952,126.9779451');
    expect(ev.quarantine_reason).toBeNull();
    const body = await res.json();
    expect(body.request_id).toMatch(/^ing_/);
  });

  it('marks a status that does not follow its raw label for quarantine instead of trusting the client', async () => {
    const { handler, calls } = setup(() => ({ results: [] }));
    const wrong = { ...payload, status: 'partial' };  // status_raw 수용 → accepted
    await handler(post(await envelope([await event('7d9f3b52-1c4e-4a8b-9f0e-2a3b4c5d6e7f', 'R1', wrong)])));
    expect((calls.find(c => c.name === 'internal_community_ingest')!.args.p_events as Record<string, unknown>[])[0].quarantine_reason)
      .toBe('status_mapping_mismatch');
  });

  it('maps SQL permission outcomes to 403 codes and deadlocks to 503 busy', async () => {
    const revoked = setup(() => ({ error: 'consent_revoked' }));
    const r = await revoked.handler(post(await envelope([await event('7d9f3b52-1c4e-4a8b-9f0e-2a3b4c5d6e7f')])));
    expect(r.status).toBe(403); expect((await r.json()).error.code).toBe('consent_revoked');
    const busy = setup(() => { throw new Error('rpc 40P01'); });
    const b = await busy.handler(post(await envelope([await event('7d9f3b52-1c4e-4a8b-9f0e-2a3b4c5d6e7f')])));
    expect(b.status).toBe(503); expect((await b.json()).error.retryable).toBe(true);
  });

  it('manifest pages go through the same auth and validate the cursor', async () => {
    const { handler, calls } = setup(() => ({ dataset_key: 'd', total: 0, manifest_token: '0', key_prefixes: [], next_after: null }));
    const path = '/functions/v1/community-ingest/manifest';
    expect((await handler(post({ protocol: 1, connection_id: '11111111-2222-3333-4444-555555555555', after: 'x', limit: 10 }, jwt(claims), path))).status).toBe(400);
    const ok = await handler(post({ protocol: 1, connection_id: '11111111-2222-3333-4444-555555555555', after: null, limit: 5000 }, jwt(claims), path));
    expect(ok.status).toBe(200);
    expect((await ok.json()).manifest_token).toBe('0');
    expect(calls.find(c => c.name === 'internal_community_manifest')!.args.p_user).toBe(UID);
  });
});
