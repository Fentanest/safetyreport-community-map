// my-reports-v1 on the REAL local stack (Postgres 17 + GoTrue + PostgREST of .integration-stack), with the
// runtime-agnostic handler running in-process (node) against it: real getUser, real JWT claims, real
// internal_my_reports_* RPCs through supabase-js as service_role. NOT the Deno Edge runtime (tests/integration/
// my-reports-edge.test.ts) and NOT production. Synthetic users and rows only, removed afterwards.
//   COMMUNITY_STACK=1 npx vitest run tests/integration/my-reports-sql.test.ts
// UPDATE_MY_REPORTS_FIXTURES=1 additionally rewrites contracts/my-reports/fixtures/*.json from these real responses.
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMyReportsHandler, RPC_INVALID, RPC_TIMEOUT, type MyReportsDeps } from '../../server/myReports/handler';
import { LIMITS } from '../../contracts/my-reports/types';
import { validate } from '../product/helpers/jsonSchema';
import schema from '../../contracts/my-reports/my-reports-v1.schema.json';
import {
  API, createUser, deleteUsers, hex, insertFacts, serviceClient, signIn, sql, stackKeys, type StackKeys, type TestUser,
} from './helpers/myReportsSeed';
import { ADDR, ADDR_B_ONLY, ADDR_REF, V, V_B_ONLY, V_OLD, V_WILD, scenarioA, scenarioB } from './helpers/myReportsScenario';

const enabled = process.env.COMMUNITY_STACK === '1';
const UPDATE = process.env.UPDATE_MY_REPORTS_FIXTURES === '1';
const ORIGIN = 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SECRET = 'fixture-cursor-secret-not-a-real-key-0123456789';
// 2026-09-29 12:00 KST
const NOON = Date.parse('2026-09-29T03:00:00Z');
const FIXTURES = new URL('../../contracts/my-reports/fixtures/', import.meta.url);

type Json = Record<string, any>;
let keys: StackKeys;
const users: TestUser[] = [];
let A: TestUser, B: TestUser;
let clock = NOON;
const logs: Array<Record<string, string | number>> = [];

function handler(extra: Partial<MyReportsDeps> = {}) {
  const svc = serviceClient(keys);
  return createMyReportsHandler({
    enabled: true, cursorSecret: SECRET, jwtIssuer: null, allowedOrigins: [ORIGIN], rateLimitPerMinute: 100000,
    now: () => clock,
    rpc: async (name, args, signal) => {
      const { data, error } = await svc.rpc(name, args).abortSignal(signal);
      if (error) {
        if (error.code === '57014' || signal.aborted) throw new Error(RPC_TIMEOUT);
        if (/INVALID_QUERY/.test(error.message ?? '')) throw new Error(RPC_INVALID);
        throw new Error(`rpc ${error.code}`);
      }
      return data;
    },
    getUser: async (token) => {
      const { data, error } = await svc.auth.getUser(token);
      if (error) return [400, 401, 403, 404].includes((error as { status?: number }).status ?? 0) ? null : Promise.reject(new Error('auth'));
      return data.user ? { id: data.user.id, isAnonymous: data.user.is_anonymous === true } : null;
    },
    log: (e) => logs.push(e),
    ...extra,
  });
}

async function post(route: string, body: unknown, token: string | null, opts: { origin?: string | null; h?: ReturnType<typeof handler>; raw?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json', apikey: keys.ANON_KEY };
  if (token) headers.authorization = `Bearer ${token}`;
  if (opts.origin !== null) headers.origin = opts.origin ?? ORIGIN;
  const res = await (opts.h ?? handler())(new Request(`${API}/functions/v1/my-reports/${route}`, {
    method: 'POST', headers, body: opts.raw ?? JSON.stringify(body) }));
  const text = await res.text();
  return { status: res.status, json: JSON.parse(text) as Json, bytes: Buffer.byteLength(text), headers: res.headers };
}
const numbersOf = (page: Json) => page.reports.items.map((r: Json) => r.report_number);

function writeFixture(name: string, body: unknown) {
  if (!UPDATE) return;
  mkdirSync(FIXTURES, { recursive: true });
  writeFileSync(new URL(`${name}.json`, FIXTURES), `${JSON.stringify(body, null, 2)}\n`);
}
const def = (name: string) => ({ $ref: `#/$defs/${name}`, $defs: (schema as Json).$defs });
const valid = (name: string, body: unknown) => expect(validate(def(name), body), JSON.stringify(body).slice(0, 400)).toEqual([]);

describe.skipIf(!enabled)('my-reports on real Postgres/GoTrue (in-process handler)', () => {
  let revoked: string;
  beforeAll(async () => {
    keys = stackKeys();
    const svc = serviceClient(keys);
    A = await createUser(svc, keys.ANON_KEY, 'a');
    B = await createUser(svc, keys.ANON_KEY, 'b');
    users.push(A, B);
    // a second, revoked lineage of A (R13 was uploaded under it)
    revoked = randomUUID();
    sql(`insert into private.community_consent_grants (grant_id, lineage_id, user_id, policy_version, consent_text_sha256, granted_via, granted_session_id, revoked_at)
         values ('${revoked}', '${randomUUID()}', '${A.id}', '2026-09-28.3', '${'a'.repeat(64)}', 'mobile_client', '${randomUUID()}', now());`);
    insertFacts([...scenarioA(A, revoked), ...scenarioB(B)]);
  }, 120000);
  afterAll(() => deleteUsers(users));

  // ------------------------------------------------------------------ selection
  it('vehicle search: own representative reports only, whole-scope summary, stable page order', async () => {
    const r = await post('search', { kind: 'vehicle', query: '12 가 3456', page_size: 3, managers_page_size: 2 }, A.token);
    expect(r.status).toBe(200);
    valid('SearchResponse', r.json);
    expect(r.json.query_normalized).toBe(V);
    expect(r.json.account).toEqual({ contributor: 'active' });
    // R1 R2 R3 R4 R6 R7 R8 R10×2 R12 — R9 processing, R13 revoked lineage, R5/R14 other plates are out
    expect(r.json.summary.total).toBe(10);
    expect(r.json.summary.status).toEqual({ accepted: 5, partial: 1, rejected: 3, completed_unknown: 1 });
    expect(r.json.summary.accept_rate).toBe(50);
    expect(r.json.summary.disposition).toEqual({ fine: 3, warning: 1, penalty: 0, none: 5, unknown: 1 });
    expect(r.json.summary.fine_amount).toEqual({ fine_count: 3, confirmed_count: 2, confirmed_sum_won: 40000, unconfirmed_count: 1, other_count: 0 });
    expect(r.json.summary.category).toEqual({ traffic: 1, parking: 9, other: 0 });
    expect(r.json.summary.completed_date_missing).toBe(1);
    expect(r.json.reports.total).toBe(10);
    expect(numbersOf(r.json)).toEqual(['SPP-2609-00000001', 'SPP-2609-00000002', 'SPP-2609-00000003']);
    // PC + mobile copies of R1 are one row; B's newer copy of R1 changes nothing for A
    const r1 = r.json.reports.items[0];
    expect(r1).toMatchObject({ vehicle_number: V, status: 'accepted', status_label: '수용', confirmed_amount_won: 40000, rating: 5,
      manager_name: '박담당', agency_name_original: '예시 종로경찰서', official_url: 'https://www.safetyreport.go.kr/#mypage/mysafereport/9100000001' });
    // R2: the latest answer (rejected, plate V) — the older accepted answer with another plate never comes back
    expect(r.json.reports.items[1]).toMatchObject({ status: 'rejected', vehicle_number: V, confirmed_amount_won: null });
    writeFixture('search-vehicle-first-page', r.json);
    logs.length = 0;
  });

  it('pages: every report exactly once, summary/managers not repeated, next_cursor null at the end', async () => {
    const seen: string[] = [];
    let page = await post('search', { kind: 'vehicle', query: V, page_size: 3 }, A.token);
    const first = page.json;
    seen.push(...page.json.reports.items.map((x: Json) => `${x.source_report_id}|${x.report_number}`));
    let n = 0;
    while (page.json.reports.next_cursor) {
      page = await post('search', { kind: 'vehicle', query: V, cursor: page.json.reports.next_cursor }, A.token);
      expect(page.status).toBe(200);
      expect(page.json.summary).toBeNull();
      expect(page.json.managers).toBeNull();
      if (++n === 1) writeFixture('search-vehicle-next-page', page.json);
      seen.push(...page.json.reports.items.map((x: Json) => `${x.source_report_id}|${x.report_number}`));
    }
    expect(seen).toHaveLength(first.reports.total);
    expect(new Set(seen).size).toBe(seen.length);
    // order: answer date desc, nulls last (R6 has no answer date → last)
    expect(seen.at(-1)).toBe('9100000006|SPP-2609-00000006');
    // R10: one source key, two real numbers → both present; R12: legacy + numbered = one numbered report
    expect(seen.filter((s) => s.startsWith('9100000010|'))).toEqual(['9100000010|SPP-2609-00000011', '9100000010|SPP-2609-00000010']);
    expect(seen.filter((s) => s.startsWith('9100000012|'))).toEqual(['9100000012|SPP-2608-00000012']);
    // legacy without number: report_number null (source id is never shown as a number), invalid id → no link
    const legacy = (await post('search', { kind: 'vehicle', query: V, page_size: 50 }, A.token)).json.reports.items.find((x: Json) => x.source_report_id === 'R8/legacy id');
    expect(legacy).toMatchObject({ report_number: null, official_url: null });
  });

  it('managers: (agency, manager) groups with full-scope stats, same-name managers of two agencies apart, unassigned separate', async () => {
    const r = await post('search', { kind: 'address', query: `  ${ADDR}  ` }, A.token);
    expect(r.status).toBe(200);
    // same address: ADDR and ADDR (예시동) — R1 R2 R4 R6 R7 R8 R10×2 R12; not 예시로 12 (R3, R5) or 예시로 3 (R14); not B's RB2
    expect(r.json.summary.total).toBe(9);
    const m = await post('search', { kind: 'vehicle', query: V, managers_page_size: 1 }, A.token);
    expect(m.json.managers.total_managers).toBe(2);
    expect(m.json.managers.unassigned_count).toBe(3); // R4 R8 R12 have no manager
    expect(m.json.managers.items[0]).toMatchObject({ manager_name: '박담당', agency_key: 'inst:9000001', total: 5 });
    const more = await post('search', { kind: 'vehicle', query: V, part: 'managers', cursor: m.json.managers.next_cursor }, A.token);
    expect(more.status).toBe(200);
    expect(more.json.reports).toBeNull();
    expect(more.json.summary).toBeNull();
    expect(more.json.managers.items.map((x: Json) => [x.manager_name, x.agency_name_original, x.agency_name_current, x.total]))
      .toEqual([['김담당', '예시구청(구)', '예시구청', 2]]);
    expect(more.json.managers.next_cursor).toBeNull();
    writeFixture('search-managers-page', more.json);
    // the other agency's 김담당 (R5, plate V_OTHER) is a different manager
    const other = await post('search', { kind: 'vehicle', query: '34나5678' }, A.token);
    expect(other.json.managers.items.map((x: Json) => [x.manager_name, x.agency_key])).toEqual([['김담당', 'inst:9000001']]);
    expect(other.json.summary.fine_amount).toEqual({ fine_count: 0, confirmed_count: 0, confirmed_sum_won: null, unconfirmed_count: 0, other_count: 0 });
    expect(other.json.reports.items[0]).toMatchObject({ disposition: 'penalty', amount_kind: 'penalty', confirmed_amount_won: 30000, penalty_points: 10 });
  });

  it('address: same address with/without the (동) reference; neighbours and B-only addresses are not matched', async () => {
    const withRef = await post('search', { kind: 'address', query: ADDR_REF }, A.token);
    const plain = await post('search', { kind: 'address', query: ADDR }, A.token);
    expect(withRef.json.summary).toEqual(plain.json.summary);
    const near = await post('search', { kind: 'address', query: '서울특별시 종로구 예시로 12' }, A.token);
    expect(near.json.summary.total).toBe(2);
    const region = await post('search', { kind: 'address', query: '서울특별시 종로구' }, A.token);
    expect(region.json.summary.total).toBe(0);
    const bOnly = await post('search', { kind: 'address', query: ADDR_B_ONLY }, A.token);
    expect(bOnly.json.summary.total).toBe(0);
    expect(bOnly.json.managers).toMatchObject({ items: [], total_managers: 0, unassigned_count: 0 });
    writeFixture('search-empty', bOnly.json);
  });

  it('isolation: A never sees B’s plate, address, numbers, managers — nor A’s own superseded plate', async () => {
    for (const [kind, query] of [['vehicle', V_B_ONLY], ['address', ADDR_B_ONLY], ['vehicle', V_OLD]] as const) {
      const s = await post('search', { kind, query }, A.token);
      expect(s.json.summary.total).toBe(0);
      const n = await post('numbers', { kind, query }, A.token);
      expect(n.json).toMatchObject({ matched_reports: 0, unique_numbers: 0, items: [], complete: true });
    }
    const all = JSON.stringify((await post('search', { kind: 'vehicle', query: V, page_size: 50 }, A.token)).json);
    for (const leak of ['이담당', '예시 부산경찰서', 'SPP-2609-00000901', 'SPP-2609-00000902', V_B_ONLY, B.id, A.id]) expect(all).not.toContain(leak);
    // B sees its own copy of R1 (its own newer answer), not A's
    const b = await post('search', { kind: 'address', query: ADDR }, B.token);
    expect(b.json.summary.total).toBe(2);
    expect(b.json.reports.items.find((x: Json) => x.source_report_id === '9100000001')).toMatchObject({ status: 'rejected', vehicle_number: V_B_ONLY });
  });

  it('literal search: %, _ and \\ are ordinary characters; 6..64 code points after normalisation', async () => {
    expect((await post('search', { kind: 'vehicle', query: V_WILD }, A.token)).json.summary.total).toBe(1);
    expect((await post('search', { kind: 'vehicle', query: '12가%45' }, A.token)).json.summary.total).toBe(1);
    expect((await post('search', { kind: 'vehicle', query: '12_345' }, A.token)).json.summary.total).toBe(0);
    expect((await post('search', { kind: 'vehicle', query: '%%%%%%' }, A.token)).json.summary.total).toBe(0);
    expect((await post('search', { kind: 'vehicle', query: '가3456' }, A.token)).json.error.code).toBe('QUERY_LENGTH');
    expect((await post('search', { kind: 'vehicle', query: ' 가 3 4 5 6 ' }, A.token)).json.error.code).toBe('QUERY_LENGTH');
    expect((await post('search', { kind: 'vehicle', query: '가'.repeat(64) }, A.token)).status).toBe(200);
    expect((await post('search', { kind: 'vehicle', query: '가'.repeat(65) }, A.token)).json.error.code).toBe('QUERY_LENGTH');
    // the RPC re-checks: a direct call with a 5-character query is refused in SQL
    expect(() => sql(`select public.internal_my_reports_numbers('${A.id}', '${A.session}', 'vehicle', '12가34', 0, 10, 10, null)`)).toThrow(/INVALID_QUERY/);
  });

  it('numbers: every page of the same scope, distinct numbers, missing numbers counted, never the source id', async () => {
    let r = await post('numbers', { kind: 'vehicle', query: V, page_size: 4 }, A.token);
    expect(r.status).toBe(200);
    valid('NumbersResponse', r.json);
    expect(r.json).toMatchObject({ matched_reports: 10, without_number: 1, unique_numbers: 9, complete: false });
    writeFixture('numbers-first-page', r.json);
    const all = [...r.json.items];
    while (r.json.next_cursor) {
      r = await post('numbers', { kind: 'vehicle', query: V, cursor: r.json.next_cursor }, A.token);
      expect(r.status).toBe(200);
      all.push(...r.json.items);
    }
    writeFixture('numbers-last-page', r.json);
    expect(r.json.complete).toBe(true);
    expect(all).toHaveLength(9);
    expect(new Set(all).size).toBe(9);
    expect(all.every((n) => /^SPP-/.test(n))).toBe(true);
    expect(all).not.toContain('SPP-2609-00000009');
    expect(all).not.toContain('SPP-2609-00000013');
    // above the cap: an explicit error, never a truncated list
    const capped = JSON.parse(sql(`select public.internal_my_reports_numbers('${A.id}', '${A.session}', 'vehicle', '${V}', 0, 10, 8, null)`));
    expect(capped).toEqual({ error: 'NUMBERS_LIMIT_EXCEEDED' });
  });

  it('summary: whole own scope vs the KST 3-day window by answer date (upload time never used)', async () => {
    const r = await post('summary', { page_size: 2 }, A.token);
    expect(r.status).toBe(200);
    valid('SummaryResponse', r.json);
    expect(r.json).toMatchObject({ timezone: 'Asia/Seoul', recent_start: '2026-09-27', recent_end: '2026-09-29' });
    // all own completed: 10 plate-V + R5 + R14 = 12
    expect(r.json.summary.total).toBe(12);
    // R1 (09-29), R2 (09-28), R3 (09-27); R4 09-26 and R6 (no date) out; R13 is revoked
    expect(r.json.recent_summary.total).toBe(3);
    expect(r.json.recent.total).toBe(3);
    expect(r.json.recent.items.map((x: Json) => x.completed_date)).toEqual(['2026-09-29', '2026-09-28']);
    writeFixture('summary-first-page', r.json);
    // midnight passes between pages: the cursor keeps its window (first page at 23:59:30 KST, next at 00:00:01 KST)
    clock = Date.parse('2026-09-29T14:59:30Z');
    const late = await post('summary', { page_size: 2 }, A.token);
    expect(late.json.recent_end).toBe('2026-09-29');
    clock = Date.parse('2026-09-29T15:00:01Z');
    try {
      const next = await post('summary', { cursor: late.json.recent.next_cursor }, A.token);
      expect(next.status).toBe(200);
      expect(next.json).toMatchObject({ recent_start: '2026-09-27', recent_end: '2026-09-29', summary: null, recent_summary: null });
      expect(next.json.recent.items.map((x: Json) => x.completed_date)).toEqual(['2026-09-27']);
      writeFixture('summary-next-page', next.json);
      const fresh = await post('summary', {}, A.token);
      expect(fresh.json).toMatchObject({ recent_start: '2026-09-28', recent_end: '2026-09-30' });
      expect(fresh.json.recent.total).toBe(2);
    } finally { clock = NOON; }
    // one second before KST midnight is still the 29th
    clock = Date.parse('2026-09-29T14:59:59Z');
    try { expect((await post('summary', {}, A.token)).json.recent_end).toBe('2026-09-29'); } finally { clock = NOON; }
  });

  it('recent window across month and year ends (SQL)', () => {
    const recent = (s: string, e: string) => JSON.parse(sql(`select public.internal_my_reports_summary('${A.id}', '${A.session}', date '${s}', date '${e}', true, 0, 50, null)`));
    expect(recent('2025-12-30', '2026-01-01').recent.items.map((x: Json) => x.completed_date)).toEqual(['2026-01-01', '2025-12-31']);
    expect(recent('2026-07-30', '2026-08-01').recent.total).toBe(1);
    expect(() => recent('2026-09-26', '2026-09-29')).toThrow(/INVALID_QUERY/);
  });

  it('version: my content changes invalidate my cursors; another account’s upload does not', async () => {
    const first = await post('search', { kind: 'vehicle', query: V, page_size: 3 }, A.token);
    const cursor = first.json.reports.next_cursor;
    insertFacts([{ user: B, dataset: 'B-extra', key: 'RB-extra', sourceId: '9200000077', number: 'SPP-2609-00000977', vehicle: V,
      completedDate: '2026-09-29', address: ADDR }]);
    const still = await post('search', { kind: 'vehicle', query: V, cursor }, A.token);
    expect(still.status).toBe(200);
    expect(still.json.data_version).toBe(first.json.data_version);
    for (const change of [
      `update private.community_report_facts set rating = 2 where contributor_id = '${A.id}' and source_report_key = '${hex('key|R3')}'`,
      `update private.community_report_facts set agency_current_name = '예시구청 새이름' where contributor_id = '${A.id}' and source_report_key = '${hex('key|R3')}'`,
      `update private.community_report_facts set amount_confirmed_won = 50000 where contributor_id = '${A.id}' and source_report_key = '${hex('key|R1')}'`,
      `update private.community_report_facts set report_number = 'SPP-2512-00000008' where contributor_id = '${A.id}' and source_report_key = '${hex('key|R8')}'`,
    ]) {
      const before = await post('search', { kind: 'vehicle', query: V, page_size: 3 }, A.token);
      sql(change);
      const after = await post('search', { kind: 'vehicle', query: V, cursor: before.json.reports.next_cursor }, A.token);
      expect(after.status, change).toBe(409);
      expect(after.json.error).toMatchObject({ code: 'DATASET_CHANGED', retryable: true });
    }
    // a number copy that started before a change stops too
    const n1 = await post('numbers', { kind: 'vehicle', query: V, page_size: 2 }, A.token);
    sql(`delete from private.community_report_facts where contributor_id = '${A.id}' and source_report_key = '${hex('key|R7')}'`);
    expect((await post('numbers', { kind: 'vehicle', query: V, cursor: n1.json.next_cursor }, A.token)).json.error.code).toBe('DATASET_CHANGED');
  });

  it('cursors: another account, query, part or route, a forged or an expired cursor is refused', async () => {
    const first = await post('search', { kind: 'vehicle', query: V, page_size: 2 }, A.token);
    const c = first.json.reports.next_cursor as string;
    const bad = async (route: string, body: Json, token = A.token) => (await post(route, body, token)).json.error?.code;
    expect(await bad('search', { kind: 'vehicle', query: V, cursor: c }, B.token)).toBe('INVALID_CURSOR');
    expect(await bad('search', { kind: 'vehicle', query: '12가34567', cursor: c })).toBe('INVALID_CURSOR');
    expect(await bad('search', { kind: 'address', query: ADDR, cursor: c })).toBe('INVALID_CURSOR');
    expect(await bad('search', { kind: 'vehicle', query: V, part: 'managers', cursor: c })).toBe('INVALID_CURSOR');
    expect(await bad('numbers', { kind: 'vehicle', query: V, cursor: c })).toBe('INVALID_CURSOR');
    expect(await bad('summary', { cursor: c })).toBe('INVALID_CURSOR');
    expect(await bad('search', { kind: 'vehicle', query: V, cursor: c, page_size: 3 })).toBe('INVALID_CURSOR');
    const [body, sig] = c.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), o: 0 })).toString('base64url');
    expect(await bad('search', { kind: 'vehicle', query: V, cursor: `${forged}.${sig}` })).toBe('INVALID_CURSOR');
    clock = NOON + (LIMITS.cursor_ttl_seconds + 1) * 1000;
    try { expect(await bad('search', { kind: 'vehicle', query: V, cursor: c })).toBe('CURSOR_EXPIRED'); } finally { clock = NOON; }
  });

  it('auth: no token, publishable key as token, forged token, no Kakao identity, revoked session, banned user, suspended contributor', async () => {
    const svc = serviceClient(keys);
    expect((await post('summary', {}, null)).json.error.code).toBe('AUTH_REQUIRED');
    expect((await post('summary', {}, keys.ANON_KEY)).status).toBe(401);
    const [h, p] = A.token.split('.');
    expect((await post('summary', {}, `${h}.${p}.${'x'.repeat(43)}`)).json.error.code).toBe('SESSION_EXPIRED');
    const noKakao = await createUser(svc, keys.ANON_KEY, 'nokakao', { kakao: false });
    users.push(noKakao);
    expect((await post('summary', {}, noKakao.token)).json.error.code).toBe('KAKAO_REQUIRED');
    const revokedSession = await createUser(svc, keys.ANON_KEY, 'revsess');
    users.push(revokedSession);
    sql(`delete from auth.sessions where id = '${revokedSession.session}'`);
    const rs = await post('summary', {}, revokedSession.token);
    expect(rs.status).toBe(401);
    const banned = await createUser(svc, keys.ANON_KEY, 'banned');
    users.push(banned);
    sql(`update auth.users set banned_until = now() + interval '1 day' where id = '${banned.id}'`);
    expect([401, 403]).toContain((await post('summary', {}, banned.token)).status);
    const suspended = await createUser(svc, keys.ANON_KEY, 'suspended');
    users.push(suspended);
    sql(`update private.contributor_profiles set status = 'suspended' where user_id = '${suspended.id}'`);
    const s = await post('summary', {}, suspended.token);
    expect(s.status).toBe(403);
    expect(s.json.error.code).toBe('ACCOUNT_INELIGIBLE');
  });

  it('a new extension session works without writer registration and leaves other sessions untouched', async () => {
    const before = sql(`select count(*) from auth.sessions where user_id = '${A.id}'`);
    const second = { ...A };
    await signIn(second, keys.ANON_KEY);
    expect(second.session).not.toBe(A.session);
    expect((await post('summary', {}, second.token)).status).toBe(200);
    expect((await post('summary', {}, A.token)).status).toBe(200);
    expect(Number(sql(`select count(*) from auth.sessions where user_id = '${A.id}'`))).toBe(Number(before) + 1);
    expect(sql(`select count(*) from private.community_connections where user_id = '${A.id}'`)).toBe('0');
  });

  it('0 / 1 / 9 / 10 reports: normal results, no community-map gate; no consent = "none"; revoked = "revoked"', async () => {
    const svc = serviceClient(keys);
    for (const n of [0, 1, 9, 10]) {
      const u = await createUser(svc, keys.ANON_KEY, `n${n}`);
      users.push(u);
      insertFacts(Array.from({ length: n }, (_, i) => ({ user: u, dataset: `n${n}`, key: `N${n}-${i}`, sourceId: `93${n}0000${i}`,
        number: `SPP-2609-9${n}0000${i}`, vehicle: V, completedDate: '2026-09-28', address: ADDR })));
      const r = await post('summary', {}, u.token);
      expect(r.status).toBe(200);
      expect(r.json.summary.total).toBe(n);
      expect((await post('search', { kind: 'vehicle', query: V }, u.token)).json.reports.total).toBe(n);
    }
    const fresh = await createUser(svc, keys.ANON_KEY, 'fresh', { profile: false });
    users.push(fresh);
    const f = await post('summary', {}, fresh.token);
    expect(f.status).toBe(200);
    expect(f.json.account.contributor).toBe('none');
    expect(f.json.summary.total).toBe(0);
    writeFixture('summary-empty-no-consent', f.json);
    const gone = await createUser(svc, keys.ANON_KEY, 'revoked');
    users.push(gone);
    insertFacts([{ user: gone, dataset: 'g', key: 'G1', sourceId: '9400000001', number: 'SPP-2609-94000001', vehicle: V, completedDate: '2026-09-28' }]);
    const beforeRevoke = await post('numbers', { kind: 'vehicle', query: V, page_size: 1 }, gone.token);
    expect(beforeRevoke.json.unique_numbers).toBe(1);
    sql(`update private.community_consent_grants set revoked_at = now() where user_id = '${gone.id}'`);
    const g = await post('summary', {}, gone.token);
    expect(g.json).toMatchObject({ account: { contributor: 'revoked' }, summary: { total: 0 } });
  });

  it('consent revoked while paging → DATASET_CHANGED on the next page', async () => {
    const svc = serviceClient(keys);
    const u = await createUser(svc, keys.ANON_KEY, 'pagerevoke');
    users.push(u);
    insertFacts(Array.from({ length: 3 }, (_, i) => ({ user: u, dataset: 'p', key: `P${i}`, sourceId: `950000000${i}`,
      number: `SPP-2609-9500000${i}`, vehicle: V, completedDate: '2026-09-28' })));
    const first = await post('search', { kind: 'vehicle', query: V, page_size: 1 }, u.token);
    sql(`update private.community_consent_grants set revoked_at = now() where user_id = '${u.id}'`);
    expect((await post('search', { kind: 'vehicle', query: V, cursor: first.json.reports.next_cursor }, u.token)).json.error.code).toBe('DATASET_CHANGED');
  });

  it('grants: the three RPCs are service_role only; anon/authenticated are refused over PostgREST', async () => {
    for (const sig of ['internal_my_reports_search(uuid, uuid, text, text, boolean, integer, integer, integer, integer, text)',
      'internal_my_reports_summary(uuid, uuid, date, date, boolean, integer, integer, text)',
      'internal_my_reports_numbers(uuid, uuid, text, text, integer, integer, integer, text)']) {
      expect(sql(`select has_function_privilege('anon', 'public.${sig}', 'execute') || ',' || has_function_privilege('authenticated', 'public.${sig}', 'execute')
        || ',' || has_function_privilege('service_role', 'public.${sig}', 'execute')`)).toBe('false,false,true');
    }
    for (const token of [keys.ANON_KEY, A.token]) {
      const res = await fetch(`${API}/rest/v1/rpc/internal_my_reports_summary`, { method: 'POST',
        headers: { apikey: keys.ANON_KEY, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ p_user: A.id, p_session: A.session, p_recent_start: '2026-09-27', p_recent_end: '2026-09-29',
          p_with_summary: true, p_offset: 0, p_limit: 20, p_expected_version: null }) });
      expect([401, 403, 404]).toContain(res.status);
      expect(await res.text()).not.toContain('SPP-');
      const table = await fetch(`${API}/rest/v1/community_report_facts?select=*`, { headers: { apikey: keys.ANON_KEY, authorization: `Bearer ${token}` } });
      expect(await table.text()).not.toContain('SPP-');
    }
  });

  it('logs carry no body, plate, address, number, token or user id', async () => {
    logs.length = 0;
    await post('search', { kind: 'vehicle', query: V }, A.token);
    await post('numbers', { kind: 'address', query: ADDR }, A.token);
    const text = JSON.stringify(logs);
    for (const secret of [V, ADDR, 'SPP-', A.token, A.id, A.session, '9100000001']) expect(text).not.toContain(secret);
    expect(logs.every((l) => l.event === 'my_reports' && typeof l.request_id === 'string')).toBe(true);
  });

  it('rate limit: the DB bucket my-reports|user|<uid> answers 429 with Retry-After', async () => {
    const h = handler({ rateLimitPerMinute: 2 });
    sql(`delete from private.rate_limits`);
    const codes = [];
    for (let i = 0; i < 3; i++) codes.push((await post('summary', {}, A.token, { h })).status);
    expect(codes).toEqual([200, 200, 429]);
    const r = await post('summary', {}, A.token, { h });
    expect(r.headers.get('retry-after')).toBe('60');
    expect(r.json.error).toMatchObject({ code: 'RATE_LIMITED', retryable: true });
    sql(`delete from private.rate_limits`);
  });

  it('bounded output: 50-row page stays far below 256 KiB (measured)', async () => {
    const r = await post('search', { kind: 'vehicle', query: V, page_size: 50, managers_page_size: 50 }, A.token);
    expect(r.bytes).toBeLessThan(LIMITS.response_bytes);
    if (UPDATE) {
      const prev = (() => { try { return JSON.parse(readFileSync(new URL('../../docs/integration/chromeextension/measurements.json', import.meta.url), 'utf8')); } catch { return {}; } })();
      writeFileSync(new URL('../../docs/integration/chromeextension/measurements.json', import.meta.url),
        `${JSON.stringify({ ...prev, scenario_first_page_bytes: r.bytes }, null, 2)}\n`);
    }
  });
});
