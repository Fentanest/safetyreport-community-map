// my-reports handler without a database: HTTP rules, auth mapping, strict input, cursor binding, DTO allowlist,
// error mapping and the response cap. The SQL half is tested on the real stack (tests/integration/my-reports-*).
import { describe, expect, it, vi } from 'vitest';
import { createMyReportsHandler, RPC_TIMEOUT, type MyReportsDeps } from '../../server/myReports/handler';
import { signCursor, verifyCursor, userDigest, queryDigest } from '../../server/myReports/cursor';
import { LIMITS } from '../../contracts/my-reports/types';

type Json = Record<string, any>;
const ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
const SECRET = 's'.repeat(40);
const UID = '11111111-1111-4111-8111-111111111111';
const SESSION = '22222222-2222-4222-8222-222222222222';
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = (claims: Json = {}) => `${b64({ alg: 'HS256' })}.${b64({ sub: UID, role: 'authenticated', aud: 'authenticated',
  session_id: SESSION, ...claims })}.sig`;
const DV = 'a'.repeat(32);

const stats = (total: number) => ({ total, status: { accepted: total, partial: 0, rejected: 0, completed_unknown: 0 },
  accept_rate: total ? 100 : null, disposition: { fine: 0, warning: 0, penalty: 0, none: total, unknown: 0 },
  fine_amount: { fine_count: 0, confirmed_count: 0, confirmed_sum_won: null, unconfirmed_count: 0, other_count: 0 },
  category: { traffic: 0, parking: total, other: 0 }, completed_date_missing: 0, report_number_missing: 0 });
const row = (i: number, extra: Json = {}) => ({ report_number: `SPP-2609-0000000${i}`, source_report_id: `91000000${i}`,
  vehicle_number: '12가3456', report_date: '2026-09-20', completed_date: '2026-09-29', category: 'parking', status: 'accepted',
  disposition: 'none', amount_kind: 'unknown', confirmed_amount_won: null, penalty_points: null, address: '예시로 1', lat: null, lng: null,
  agency_key: null, agency_name_original: null, agency_name_current: null, manager_key: null, manager_name: null, violation_law: null,
  rating: null, ...extra });

function setup(over: Partial<MyReportsDeps> = {}, rpcResult?: (name: string, args: Json) => unknown) {
  const calls: Array<[string, Json]> = [];
  const logs: Json[] = [];
  const deps: MyReportsDeps = {
    enabled: true, cursorSecret: SECRET, jwtIssuer: null, allowedOrigins: [ORIGIN], now: () => Date.parse('2026-09-29T03:00:00Z'),
    getUser: async (t) => (t.endsWith('.sig') ? { id: UID, isAnonymous: false } : null),
    rpc: async (name, raw) => {
      const args = raw as Json;
      calls.push([name, args]);
      if (name === 'internal_community_ingest_rate_limit') return true;
      if (rpcResult) return rpcResult(name, args);
      if (name === 'internal_my_reports_search') {
        return { contributor: 'active', data_version: DV, query_normalized: args.p_query, summary: args.p_with_summary ? stats(3) : null,
          reports: args.p_reports_offset === null ? null : { items: [row(1), row(2)].slice(0, args.p_reports_limit), total: 3 },
          managers: args.p_managers_offset === null ? null : { items: [], total_managers: 0, unassigned_count: 3 } };
      }
      if (name === 'internal_my_reports_summary') {
        return { contributor: 'active', data_version: DV, summary: stats(3), recent_summary: stats(1), recent: { items: [row(1)], total: 1 } };
      }
      return { contributor: 'active', data_version: DV, query_normalized: args.p_query, matched_reports: 3, without_number: 0, unique_numbers: 3,
        items: ['SPP-2609-00000001', 'SPP-2609-00000002', 'SPP-2609-00000003'].slice(args.p_offset, args.p_offset + args.p_limit) };
    },
    log: (e) => logs.push(e),
    ...over,
  };
  const h = createMyReportsHandler(deps);
  const call = async (route: string, body: unknown, opts: { method?: string; origin?: string | null; auth?: string | null; ctype?: string; raw?: string } = {}) => {
    const headers: Record<string, string> = {};
    if (opts.ctype !== '') headers['content-type'] = opts.ctype ?? 'application/json';
    if (opts.origin !== null) headers.origin = opts.origin ?? ORIGIN;
    if (opts.auth !== null) headers.authorization = `Bearer ${opts.auth ?? token()}`;
    const method = opts.method ?? 'POST';
    const res = await h(new Request(`https://x.supabase.co/functions/v1/my-reports/${route}`, {
      method, headers, body: method === 'POST' ? (opts.raw ?? JSON.stringify(body)) : undefined }));
    const text = await res.text();
    return { status: res.status, headers: res.headers, json: text ? JSON.parse(text) as Json : {} };
  };
  return { call, calls, logs };
}

describe('my-reports handler', () => {
  it('private, non-cacheable responses; CORS only for configured chrome-extension origins', async () => {
    const { call } = setup();
    const ok = await call('summary', {});
    expect(ok.status).toBe(200);
    expect(ok.headers.get('cache-control')).toBe('private, no-store, max-age=0');
    expect(ok.headers.get('vary')).toBe('Origin, Authorization');
    expect(ok.headers.get('x-content-type-options')).toBe('nosniff');
    expect(ok.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(ok.headers.get('access-control-expose-headers')).toContain('Retry-After');
    const pre = await call('search', undefined, { method: 'OPTIONS' });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-methods')).toBe('POST, OPTIONS');
    expect(pre.headers.get('access-control-allow-headers')).toBe('authorization, apikey, content-type, x-client-info');
    const other = await call('summary', {}, { origin: 'chrome-extension://zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz' });
    expect(other.status).toBe(403);
    expect(other.headers.get('access-control-allow-origin')).toBeNull();
    const web = await call('summary', {}, { origin: 'https://evil.example' });
    expect(web.json.error.code).toBe('ORIGIN_FORBIDDEN');
    // no Origin (server/CLI): same authentication and own scope apply
    expect((await call('summary', {}, { origin: null })).status).toBe(200);
    expect((await call('summary', {}, { origin: null, auth: null })).json.error.code).toBe('AUTH_REQUIRED');
    // an allowed origin can read error bodies
    const err = await call('summary', {}, { auth: null });
    expect(err.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(err.headers.get('www-authenticate')).toBe('Bearer');
  });

  it('method, route, media type, body size and strict fields', async () => {
    const { call, calls } = setup();
    expect((await call('summary', undefined, { method: 'GET' })).json.error.code).toBe('METHOD_NOT_ALLOWED');
    expect((await call('list', {})).json.error.code).toBe('NOT_FOUND');
    expect((await call('summary', {}, { ctype: 'text/plain' })).status).toBe(415);
    expect((await call('summary', {}, { ctype: '' })).status).toBe(415);
    expect((await call('summary', null, { raw: `{"cursor":null,"pad":"${'x'.repeat(LIMITS.body_bytes)}"}` })).status).toBe(413);
    expect((await call('summary', null, { raw: '{not json' })).json.error.code).toBe('INVALID_REQUEST');
    expect((await call('summary', null, { raw: '[]' })).json.error.code).toBe('INVALID_REQUEST');
    for (const body of [{ user_id: UID }, { contributor_id: UID }, { dataset_key: 'x' }, { url: 'https://x' }, { page_size: 51 }, { page_size: 0 }, { page_size: 2.5 }]) {
      expect((await call('summary', body)).json.error.code, JSON.stringify(body)).toBe('INVALID_REQUEST');
    }
    expect((await call('search', { kind: 'plate', query: '12가3456' })).json.error.code).toBe('INVALID_REQUEST');
    expect((await call('search', { kind: 'vehicle', query: 123456 })).json.error.code).toBe('INVALID_REQUEST');
    expect((await call('search', { kind: 'vehicle', query: '12가3456', part: 'all' })).json.error.code).toBe('INVALID_REQUEST');
    expect((await call('search', { kind: 'vehicle', query: 'x'.repeat(257) })).json.error.code).toBe('QUERY_LENGTH');
    expect((await call('numbers', { kind: 'vehicle', query: '12가3456', page_size: 500 })).status).toBe(200);
    expect((await call('numbers', { kind: 'vehicle', query: '12가3456', page_size: 501 })).json.error.code).toBe('INVALID_REQUEST');
    // none of the refused requests reached the database
    expect(calls.filter(([n]) => n.startsWith('internal_my_reports')).length).toBe(1);
  });

  it('auth failures map to the contract codes and never reach the data RPCs', async () => {
    const { call, calls } = setup();
    expect((await call('summary', {}, { auth: null })).json.error.code).toBe('AUTH_REQUIRED');
    expect((await call('summary', {}, { auth: 'not-a-jwt' })).json.error.code).toBe('AUTH_REQUIRED');
    expect((await call('summary', {}, { auth: token().replace('.sig', '.bad') })).json.error.code).toBe('SESSION_EXPIRED');
    expect((await call('summary', {}, { auth: token({ role: 'anon' }) })).json.error.code).toBe('AUTH_REQUIRED');
    expect((await call('summary', {}, { auth: token({ sub: '33333333-3333-4333-8333-333333333333' }) })).json.error.code).toBe('AUTH_REQUIRED');
    expect((await call('summary', {}, { auth: token({ is_anonymous: true }) })).json.error.code).toBe('KAKAO_REQUIRED');
    expect(calls).toEqual([]);
    const down = setup({ getUser: async () => { throw new Error('down'); } });
    const r = await down.call('summary', {});
    expect(r.json.error).toMatchObject({ code: 'SERVICE_UNAVAILABLE', retryable: true });
    expect(r.headers.get('retry-after')).toBe('5');
  });

  it('the user id reaches the RPC only from the verified token', async () => {
    const { call, calls } = setup();
    await call('search', { kind: 'vehicle', query: '12 가 3456' });
    const [, args] = calls.find(([n]) => n === 'internal_my_reports_search')!;
    expect(args).toMatchObject({ p_user: UID, p_session: SESSION, p_kind: 'vehicle', p_query: '12가3456', p_with_summary: true,
      p_reports_offset: 0, p_reports_limit: 20, p_managers_offset: 0, p_managers_limit: 10, p_expected_version: null });
  });

  it('DB gate and version codes become errors, never an empty success', async () => {
    for (const code of ['ACCOUNT_INELIGIBLE', 'KAKAO_REQUIRED', 'SESSION_EXPIRED', 'DATASET_CHANGED', 'NUMBERS_LIMIT_EXCEEDED']) {
      const { call } = setup({}, () => ({ error: code }));
      expect((await call('numbers', { kind: 'vehicle', query: '12가3456' })).json.error.code).toBe(code);
    }
    const weird = setup({}, () => ({ error: 'SOMETHING_ELSE' }));
    expect((await weird.call('summary', {})).json.error.code).toBe('SERVICE_UNAVAILABLE');
    const malformed = setup({}, () => ({ contributor: 'active', data_version: 'x' }));
    expect((await malformed.call('summary', {})).json.error.code).toBe('SERVICE_UNAVAILABLE');
    const timeout = setup({}, () => { throw new Error(RPC_TIMEOUT); });
    expect((await timeout.call('summary', {})).json.error).toMatchObject({ code: 'QUERY_TIMEOUT', retryable: true });
    const limited = setup({ rpc: async () => false });
    const rl = await limited.call('summary', {});
    expect(rl.status).toBe(429);
    expect(rl.headers.get('retry-after')).toBe('60');
    const off = setup({ enabled: false });
    expect((await off.call('summary', {})).status).toBe(503);
    const weakSecret = setup({ cursorSecret: 'short' });
    expect((await weakSecret.call('summary', {})).status).toBe(503);
  });

  it('DTO allowlist: unexpected columns are dropped, invalid values are nulled or refused', async () => {
    const { call } = setup({}, (name) => name === 'internal_my_reports_summary' ? {
      contributor: 'active', data_version: DV, summary: stats(1), recent_summary: stats(1),
      recent: { items: [row(1, { title: '제목', body: '본문', answer: '답변 원문', attachments: ['a.jpg'], contributor_id: UID,
        dataset_key: 'd', source_report_key: 'k', payload_sha256: 'p', rating: 7, source_report_id: 'javascript:alert(1)' })], total: 1 },
    } : true);
    const r = await call('summary', {});
    const item = r.json.recent.items[0];
    for (const k of ['title', 'body', 'answer', 'attachments', 'contributor_id', 'dataset_key', 'source_report_key', 'payload_sha256']) {
      expect(item).not.toHaveProperty(k);
    }
    expect(item.rating).toBeNull();
    expect(item.official_url).toBeNull();
    expect(Object.keys(item)).toHaveLength(23);
    const bad = setup({}, (name) => name === 'internal_my_reports_summary'
      ? { contributor: 'active', data_version: DV, summary: stats(1), recent_summary: stats(1), recent: { items: [row(1, { status: 'processing' })], total: 1 } } : true);
    expect((await bad.call('summary', {})).json.error.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('a response above 256 KiB is RESULT_TOO_LARGE, never truncated', async () => {
    const { call } = setup({}, (name, args) => name === 'internal_my_reports_search' ? {
      contributor: 'active', data_version: DV, query_normalized: args.p_query, summary: stats(50),
      reports: { items: Array.from({ length: 50 }, (_, i) => row(i, { violation_law: 'x'.repeat(6000) })), total: 50 },
      managers: { items: [], total_managers: 0, unassigned_count: 50 } } : true);
    const r = await call('search', { kind: 'vehicle', query: '12가3456', page_size: 50 });
    expect(r.status).toBe(422);
    expect(r.json.error.code).toBe('RESULT_TOO_LARGE');
  });

  it('cursors: signed, bound to user/route/part/query/size, expiring; the next page passes offset and version', async () => {
    const { call, calls } = setup();
    const first = await call('search', { kind: 'vehicle', query: '12가3456', page_size: 2 });
    const c = first.json.reports.next_cursor;
    expect(typeof c).toBe('string');
    expect(c).not.toContain('12');
    const payload = await verifyCursor(SECRET, c);
    expect(payload).toMatchObject({ v: 1, r: 'search.reports', o: 2, n: 2, dv: DV, u: await userDigest(UID), q: await queryDigest('vehicle', '12가3456') });
    expect(JSON.stringify(payload)).not.toContain(UID);
    const next = await call('search', { kind: 'vehicle', query: '12가 3456', cursor: c });
    expect(next.status).toBe(200);
    expect(next.json.summary).toBeNull();
    expect(next.json.managers).toBeNull();
    expect(calls.at(-1)![1]).toMatchObject({ p_reports_offset: 2, p_reports_limit: 2, p_with_summary: false, p_managers_offset: null, p_expected_version: DV });
    expect(await verifyCursor('t'.repeat(40), c)).toBeNull();
    expect(await verifyCursor(SECRET, `${c}x`)).toBeNull();
    expect(await verifyCursor(SECRET, c.split('.')[0])).toBeNull();
    const forged = await signCursor('t'.repeat(40), payload!);
    expect((await call('search', { kind: 'vehicle', query: '12가3456', cursor: forged })).json.error.code).toBe('INVALID_CURSOR');
    const expired = setup({ now: () => Date.parse('2026-09-29T03:00:00Z') + (LIMITS.cursor_ttl_seconds + 1) * 1000 });
    expect((await expired.call('search', { kind: 'vehicle', query: '12가3456', cursor: c })).json.error.code).toBe('CURSOR_EXPIRED');
    const nums = await call('numbers', { kind: 'vehicle', query: '12가3456', page_size: 2 });
    expect(nums.json).toMatchObject({ items: ['SPP-2609-00000001', 'SPP-2609-00000002'], complete: false });
    const last = await call('numbers', { kind: 'vehicle', query: '12가3456', cursor: nums.json.next_cursor });
    expect(last.json).toMatchObject({ items: ['SPP-2609-00000003'], complete: true, next_cursor: null, offset: 2 });
  });

  it('summary: the recent window is Asia/Seoul today and the 2 days before', async () => {
    const at = async (iso: string) => {
      const { call, calls } = setup({ now: () => Date.parse(iso) });
      const r = await call('summary', {});
      return [r.json.recent_start, r.json.recent_end, calls.at(-1)![1].p_recent_start];
    };
    expect(await at('2026-09-29T14:59:59Z')).toEqual(['2026-09-27', '2026-09-29', '2026-09-27']);
    expect(await at('2026-09-29T15:00:00Z')).toEqual(['2026-09-28', '2026-09-30', '2026-09-28']);
    expect(await at('2026-03-01T00:00:00Z')).toEqual(['2026-02-27', '2026-03-01', '2026-02-27']);
    expect(await at('2025-12-31T15:30:00Z')).toEqual(['2025-12-30', '2026-01-01', '2025-12-30']);
  });

  it('logs: route, outcome, request id, rows, bytes, ms — nothing from the request', async () => {
    const log = vi.fn();
    const { call } = setup({ log });
    await call('search', { kind: 'address', query: '서울특별시 종로구 예시로 1' });
    await call('search', { kind: 'vehicle', query: '12가3456' }, { auth: null });
    const text = JSON.stringify(log.mock.calls);
    for (const s of ['예시로', '12가3456', UID, SESSION, 'Bearer']) expect(text).not.toContain(s);
    expect(log.mock.calls[0][0]).toMatchObject({ event: 'my_reports', route: 'search', outcome: 'ok' });
    expect(Object.keys(log.mock.calls[0][0]).sort()).toEqual(['bytes', 'event', 'ms', 'outcome', 'request_id', 'route', 'rows']);
  });
});
