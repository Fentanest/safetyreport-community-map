// 2026-10-22 backfill-resume (task 2-1, 2-9, 2-10, 2-11): upload pause (503 maintenance), required version (426),
// progress reports, version rule, public app announcements, map web banner and update screen. No containers; the SQL side
// runs in tests/integration/backfill-resume-stack.test.ts (composed local stack).
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createIngestHandler, maintenanceRetryAfter, requiredVersionFor, type IngestDeps } from '../../server/ingest/handler';
import { parseProgress } from '../../server/ingest/progress';
import { compareVersions, parseVersion } from '../../server/ingest/version';
import { announcementUrlAllowed, cleanAnnouncement, createAnnouncementHandler } from '../../server/announcements/handler';
import { parseClientStatus } from '../../server/clientStatus';
import { acceptClientStatus, type ClientStatus } from '../../src/data/personal';
import { ClientUpdateContext } from '../../src/components/ClientUpdateNotice';
import UploadPauseBanner, { kstTime, uploadPauseText } from '../../src/components/UploadPauseBanner';
import UpdateRequired from '../../src/components/UpdateRequired';

const versions = JSON.parse(readFileSync('contracts/community-ingest-v2/version-vectors.json', 'utf8'));
const progressVectors = JSON.parse(readFileSync('contracts/community-ingest-v2/vectors/progress.json', 'utf8'));
const links = JSON.parse(readFileSync('contracts/app-announcements/vectors/links.json', 'utf8'));
const wire = JSON.parse(readFileSync('contracts/community-ingest-v2/vectors/wire.json', 'utf8'));
const uid = '11111111-1111-4111-8111-111111111111';
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = `${b64({})}.${b64({ sub: uid, session_id: uid, role: 'authenticated', aud: 'authenticated' })}.sig`;
const PC = 'https://github.com/Fentanest/safetyreport/releases/latest';
const MOBILE = 'https://play.google.com/store/apps/details?id=com.fentanest.mysafetyreport';

type Caps = Awaited<ReturnType<NonNullable<IngestDeps['capabilities']>>>;
function setup(caps: Caps | (() => Promise<Caps>), rpc?: (name: string, args: Record<string, unknown>) => unknown) {
  const calls: string[] = [];
  const notes: unknown[][] = [];
  const deps: IngestDeps = {
    enabled: true, allowedOrigins: [], jwtIssuer: null,
    getUser: async () => { calls.push('getUser'); return { id: uid, isAnonymous: false }; },
    capabilities: async () => { calls.push('capabilities'); return typeof caps === 'function' ? caps() : caps; },
    noteRejection: async (...a) => { calls.push('noteRejection'); notes.push(a); },
    rpc: async (name, args) => {
      calls.push(name);
      if (name.endsWith('rate_limit')) return true;
      if (rpc) return rpc(name, args);
      return { results: [], dataset_version: 'x', stored: true };
    },
  };
  return { handler: createIngestHandler(deps), calls, notes };
}
const post = (body: unknown, path = '/functions/v1/community-ingest', gzip = false) => {
  const bytes = typeof body === 'string' ? Buffer.from(body) : Buffer.from(JSON.stringify(body));
  return new Request(`https://fixture.invalid${path}`, { method: 'POST', body: gzip ? gzipSync(bytes) : bytes,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(gzip ? { 'content-encoding': 'gzip' } : {}) } });
};
const v1Envelope = (over: Record<string, unknown> = {}) => ({ ...wire.envelope, protocol: 1, contract: 'community-ingest-v1', trigger: 'manual',
  client_version: '3.5.1', events: [{}], ...over });
const pcProgress = progressVectors.cases[0].body;
const caps = (over: Partial<Caps> = {}): Caps => ({ contracts: [1, 2], paused: false, pause_message: null, resume_at: null, client_requirement: null, ...over });
const requirement = (pc: string | null, mobile: string | null) =>
  ({ min_version: { pc, mobile }, url: { pc: PC, mobile: MOBILE }, message: null, enforce_from: null });

describe('version rule (contracts/community-ingest-v2/version-vectors.json)', () => {
  const versionCases: [unknown, unknown, number | null][] = versions.cases.map((c: { a: unknown; b: unknown; cmp: number | null }) => [c.a, c.b, c.cmp] as [unknown, unknown, number | null]);
  it.each(versionCases)('%j vs %j → %j', (a: unknown, b: unknown, cmp: number | null) => {
    expect(compareVersions(a, b)).toBe(cmp);
    if (cmp !== null) expect(compareVersions(b, a)).toBe(cmp === 0 ? 0 : -cmp);
  });
  it('parses build suffixes and missing parts', () => {
    expect(parseVersion('2.5.0+179')).toEqual([2, 5, 0, 0]);
    expect(parseVersion('3.0.0.3')).toEqual([3, 0, 0, 3]);
    expect(parseVersion('2.5.1-beta')).toBeNull();
  });
});

describe('2-9 upload pause: 503 maintenance before any database write', () => {
  const resume = new Date(Date.now() + 90 * 60_000).toISOString();
  const paused = caps({ paused: true, pause_message: '서버 점검', resume_at: resume });
  const routes: [string, () => Request][] = [
    ['v1 ingest', () => post(v1Envelope())],
    ['v2 ingest (identity)', () => post(wire.envelope)],
    ['v2 ingest (gzip, never inflated)', () => post(wire.envelope, undefined, true)],
    ['manifest', () => post({ protocol: 1, connection_id: wire.envelope.connection_id, after: null, limit: 10 }, '/functions/v1/community-ingest/manifest')],
    ['progress', () => post(pcProgress, '/functions/v1/community-ingest/progress')],
  ];
  it.each(routes)('%s', async (_, make) => {
    const { handler, calls, notes } = setup(paused);
    const r = await handler(make());
    expect(r.status).toBe(503);
    const body = await r.json();
    expect(body.error).toMatchObject({ code: 'maintenance', retryable: true, resume_at: resume, pause_message: '서버 점검' });
    const retry = Number(r.headers.get('retry-after'));
    expect(retry).toBeGreaterThan(89 * 60);
    expect(retry).toBeLessThanOrEqual(90 * 60);
    expect(body.error.retry_after_seconds).toBe(retry);
    // nothing but auth, the settings read and the refusal counter: no rate-limit write, no ledger/connection/queue RPC
    expect(calls).toEqual(['getUser', 'capabilities', 'noteRejection']);
    expect(notes[0][0]).toBe('maintenance');
  });
  it('no resume time → Retry-After 600; remaining seconds are bounded', async () => {
    const { handler } = setup(caps({ paused: true }));
    const r = await handler(post(v1Envelope()));
    expect(r.status).toBe(503);
    expect(r.headers.get('retry-after')).toBe('600');
    expect((await r.json()).error.resume_at).toBeNull();
    expect(maintenanceRetryAfter(new Date(Date.now() + 1500).toISOString())).toBe(2);
    expect(maintenanceRetryAfter(new Date(Date.now() - 5000).toISOString())).toBe(1);
    expect(maintenanceRetryAfter(new Date(Date.now() + 30 * 86400_000).toISOString())).toBe(7 * 86400);
  });
  it('the server already decided the automatic resume: paused=false lets every route through', async () => {
    const { handler, calls } = setup(caps({ paused: false }));
    expect((await handler(post(pcProgress, '/functions/v1/community-ingest/progress'))).status).toBe(200);
    expect(calls).toContain('internal_community_progress');
  });
  it('a failing settings read never pauses v1/manifest/progress (v2 is a retryable 503 service_unavailable)', async () => {
    const { handler } = setup(async () => { throw new Error('down'); });
    expect((await handler(post(pcProgress, '/functions/v1/community-ingest/progress'))).status).toBe(200);
    const v2 = await handler(post(wire.envelope));
    expect(v2.status).toBe(503);
    expect((await v2.json()).error.code).toBe('service_unavailable');
  });
  it('a failing refusal counter does not change the answer', async () => {
    const deps: IngestDeps = { enabled: true, allowedOrigins: [], jwtIssuer: null, getUser: async () => ({ id: uid, isAnonymous: false }),
      capabilities: async () => caps({ paused: true }), noteRejection: async () => { throw new Error('db down'); }, rpc: async () => true };
    expect((await createIngestHandler(deps)(post(v1Envelope()))).status).toBe(503);
  });
});

describe('2-10 required version: 426 for v1 and v2 below the requirement', () => {
  it.each([
    ['v1 pc below', v1Envelope({ client_version: '3.6.1' }), 426],
    ['v1 pc equal', v1Envelope({ client_version: '3.6.2' }), 'pass'],
    ['v1 pc unparseable', v1Envelope({ client_version: '3.6.2-beta' }), 'pass'],
    ['v2 pc below', { ...wire.envelope, client_version: '3.6.0' }, 426],
    ['v2 pc above', { ...wire.envelope, client_version: '3.7.0' }, 'pass'],
    ['mobile without a mobile requirement', v1Envelope({ source_app: 'safetyreport-mobile', source_mode: 'standalone', client_version: '2.4.1' }), 'pass'],
  ])('%s', async (_, body, want) => {
    const { handler, calls, notes } = setup(caps({ client_requirement: requirement('3.6.2', null) }));
    const r = await handler(post(body));
    if (want === 426) {
      expect(r.status).toBe(426);
      const e = (await r.json()).error;
      expect(e).toMatchObject({ code: 'client_upgrade_required', retryable: false, required_version: '3.6.2', update_url: PC });
      expect(r.headers.get('retry-after')).toBeNull();
      expect(calls.some(c => c.startsWith('internal_community_ingest') && !c.endsWith('rate_limit'))).toBe(false);
      expect(notes[0]).toEqual(['client_upgrade_required', 'pc', 'ingest']);
    } else {
      expect(r.status).not.toBe(426);
    }
  });
  it('progress is accepted below the requirement (to see who is left behind)', async () => {
    const { handler } = setup(caps({ client_requirement: requirement('9.0.0', '9.0.0') }));
    expect((await handler(post({ ...pcProgress, client_version: '3.6.2' }, '/functions/v1/community-ingest/progress'))).status).toBe(200);
  });
  it('requiredVersionFor never blocks on missing data', () => {
    expect(requiredVersionFor(null, 'safetyreport', '1.0')).toBeNull();
    expect(requiredVersionFor(requirement(null, '2.5.1') as never, 'safetyreport', '1.0')).toBeNull();
    expect(requiredVersionFor(requirement('3.6.2', null) as never, 'other', '1.0')).toBeNull();
    expect(requiredVersionFor(requirement('3.6.2', null) as never, 'safetyreport', '')).toBeNull();
  });
});

describe('2-1 progress reports (contracts/community-ingest-v2/vectors/progress.json)', () => {
  const progressCases: [string, unknown][] = progressVectors.cases.map((c: { name: string }) => [c.name, c] as [string, unknown]);
  it.each(progressCases)('%s', async (_: string, c: unknown) => {
    const vector = c as { body?: unknown; raw_body?: string; expect: string };
    if (vector.body !== undefined) expect(parseProgress(vector.body) !== null).toBe(vector.expect === 'ok');
    const { handler, calls } = setup(caps());
    const r = await handler(post(vector.raw_body ?? vector.body, '/functions/v1/community-ingest/progress'));
    expect(r.status).toBe(progressVectors.http[vector.expect]);
    if (vector.expect !== 'ok') expect(calls).not.toContain('internal_community_progress');
  });
  it('stores the report without the envelope keys and with the verified user/session', async () => {
    let args: Record<string, unknown> = {};
    const { handler } = setup(caps(), (name, a) => { if (name === 'internal_community_progress') args = a; return { stored: true }; });
    const r = await handler(post(pcProgress, '/functions/v1/community-ingest/progress'));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ protocol: 1, stored: true });
    expect(args.p_user).toBe(uid);
    expect(args.p_session).toBe(uid);
    expect(args.p_connection).toBe(pcProgress.connection_id);
    expect(args.p_report).not.toHaveProperty('connection_id');
    expect(args.p_report).not.toHaveProperty('protocol');
  });
  it.each([
    [{ error: 'rate_limited', retry_after: 42 }, 429, 'rate_limited'],
    [{ error: 'consent_revoked' }, 403, 'consent_revoked'],
    [{ error: 'consent_missing' }, 403, 'consent_missing'],
    [{ error: 'connection_unknown' }, 403, 'connection_unknown'],
    [{ error: 'connection_session_mismatch' }, 403, 'connection_session_mismatch'],
    [{ error: 'connection_mode_mismatch' }, 403, 'connection_mode_mismatch'],
  ])('maps %j', async (rpcResult, status, code) => {
    const { handler } = setup(caps(), name => (name === 'internal_community_progress' ? rpcResult : true));
    const r = await handler(post(pcProgress, '/functions/v1/community-ingest/progress'));
    expect(r.status).toBe(status);
    expect((await r.json()).error.code).toBe(code);
    if (status === 429) expect(r.headers.get('retry-after')).toBe('42');
  });
  it('refuses gzip on /progress', async () => {
    const { handler } = setup(caps());
    expect((await handler(post(pcProgress, '/functions/v1/community-ingest/progress', true))).status).toBe(415);
  });
});

describe('2-11 app announcements (public)', () => {
  const live = (over: Record<string, unknown> = {}) => ({ id: 'example-one', title: '제목', body: '<b>본문</b>\n둘째 줄', priority: 1,
    primary_action: { label: '보기', url: MOBILE }, snooze_days: 7, starts_at: '2026-10-22T00:00:00+00:00', ends_at: null, ...over });
  const handler = (rows: unknown, seen: Record<string, unknown>[] = []) => createAnnouncementHandler({ enabled: true,
    rpc: async (_n, a) => { seen.push(a); return rows; } });
  const get = (q: string) => new Request(`https://fixture.invalid/functions/v1/app-announcements?${q}`);
  it('link allowlist vectors', () => {
    for (const c of links.cases) expect(announcementUrlAllowed(c.url), c.url).toBe(c.allowed);
  });
  it('answers without any token, max 3, cacheable, keeps text verbatim', async () => {
    const seen: Record<string, unknown>[] = [];
    const r = await handler([live(), live({ id: 'example-two' }), live({ id: 'example-three' }), live({ id: 'example-four' })], seen)(
      get('app=mobile&mode=client&platform=android&version=2.5.1'));
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('public, max-age=300');
    const b = await r.json();
    expect(b.announcements).toHaveLength(3);
    expect(b.announcements[0].body).toBe('<b>본문</b>\n둘째 줄');
    expect(b.announcements[0].starts_at).toBe('2026-10-22T00:00:00.000Z');
    expect(seen[0]).toEqual({ p_app: 'mobile', p_mode: 'client', p_platform: 'android', p_version: '2.5.1' });
  });
  it('drops items whose link or app action is not allowed', async () => {
    const r = await handler([live({ primary_action: { label: '열기', url: 'https://evil.example/' } }),
      live({ id: 'example-two', primary_action: { label: '열기', app_action: 'format_phone' } }),
      live({ id: 'example-three', primary_action: { label: '바꾸기', app_action: 'open_mode_switch' } })])(
      get('app=mobile&mode=standalone&platform=android&version=2.5.1'));
    expect((await r.json()).announcements.map((a: { id: string }) => a.id)).toEqual(['example-three']);
    expect(cleanAnnouncement(live({ title: 'x'.repeat(41) }))).toBeNull();
  });
  it.each([
    'app=mobile&mode=server&platform=android&version=2.5.1', 'app=pc&mode=client&platform=windows&version=3.6.2',
    'app=mobile&mode=client&platform=android', 'app=mobile&mode=client&platform=android&version=2.5.1&x=1',
    'app=mobile&app=pc&mode=client&platform=android&version=2.5.1', 'app=tv&mode=client&platform=android&version=1',
  ])('400 for %s', async q => { expect((await handler([])(get(q))).status).toBe(400); });
  it('an unparseable version is not an error (the database leaves out version-bound notices)', async () => {
    const seen: Record<string, unknown>[] = [];
    expect((await handler([], seen)(get('app=pc&mode=server&platform=docker&version=dev-build'))).status).toBe(200);
    expect(seen[0].p_version).toBe('dev-build');
  });
  it('database failure → 503 with Retry-After, never a stack or detail', async () => {
    const h = createAnnouncementHandler({ enabled: true, rpc: async () => { throw new Error('secret detail'); } });
    const r = await h(get('app=pc&mode=server&platform=windows&version=3.6.2'));
    expect(r.status).toBe(503);
    expect(r.headers.get('retry-after')).toBe('300');
    expect(await r.text()).not.toContain('secret');
  });
});

describe('2-9/2-10 map web: client-status fields, banner, update screen', () => {
  const base = { consent: 'active', last_contract: 'community-ingest-v2', v1_connections: 0, v2_enabled: true, notice: null };
  it('server decode keeps the pause and the gate; an unusable gate fails closed to 503 (null)', () => {
    const s = parseClientStatus({ ...base, upload_pause: { paused: true, message: '점검', resume_at: '2026-10-22T06:30:00+00:00' },
      update_gate: { blocked: true, min_version: { pc: '3.6.2', mobile: null }, url: { pc: 'javascript:x', mobile: null }, message: null } });
    expect(s?.upload_pause).toEqual({ paused: true, message: '점검', resume_at: '2026-10-22T06:30:00.000Z' });
    expect(s?.update_gate).toEqual({ blocked: true, min_version: { pc: '3.6.2', mobile: null }, url: { pc: null, mobile: null }, message: null });
    expect(parseClientStatus({ ...base, update_gate: { blocked: 'yes' } })).toBeNull();
    expect(parseClientStatus(base)?.upload_pause).toEqual({ paused: false, message: null, resume_at: null });
  });
  it('the page accepts an older server answer without the new keys (no banner, no gate)', () => {
    const s = acceptClientStatus(base);
    expect(s.upload_pause.paused).toBe(false);
    expect(s.update_gate).toBeNull();
  });
  const render = (status: ClientStatus) => renderToStaticMarkup(
    <ClientUpdateContext.Provider value={{ status, refresh: () => {} }}><UploadPauseBanner /></ClientUpdateContext.Provider>);
  it('banner text: with and without a resume time, nothing when not paused', () => {
    const at = '2026-10-22T06:30:00.000Z';
    expect(kstTime(at)).toBe('10월 22일 오후 3:30');
    expect(uploadPauseText(at)).toBe('앱의 신고 업로드가 잠시 멈췄습니다. 10월 22일 오후 3:30에 자동으로 다시 올립니다. 지도는 그대로 볼 수 있습니다.');
    expect(uploadPauseText(null)).toContain('점검이 끝나면 자동으로 다시 올립니다');
    const on = render(acceptClientStatus({ ...base, upload_pause: { paused: true, message: '<b>점검</b>', resume_at: at } }));
    expect(on).toContain('서버 점검 중');
    expect(on).toContain('&lt;b&gt;점검&lt;/b&gt;');
    expect(render(acceptClientStatus(base))).toBe('');
  });
  it('update screen: server versions and https links only, retry and sign-out buttons', () => {
    const html = renderToStaticMarkup(<UpdateRequired displayName="민지" onRetry={() => {}} onSignOut={() => {}}
      gate={{ blocked: true, min_version: { pc: '3.6.2', mobile: '2.5.1' }, url: { pc: PC, mobile: 'http://insecure.example/' }, message: null }} />);
    expect(html).toContain('앱을 최신 버전으로 업데이트한 뒤 한 번 실행해 주세요');
    expect(html).toContain('PC 3.6.2 이상 · 모바일 2.5.1 이상');
    expect(html).toContain(PC);
    expect(html).not.toContain('insecure.example');
    expect(html).toContain('다시 확인');
    expect(html).toContain('다른 계정으로 로그인');
  });
});
