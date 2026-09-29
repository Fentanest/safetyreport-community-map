// Real local Postgres 17 (composed Supabase stack, .integration-stack) checks of 202610010100_single_date_cohort.sql:
// representative elected BEFORE the date condition (D13 · AG-01/AG-02, compared with the previous function), the two
// bases on the cohort oracle (DT-05/06/09/10), previous window only on request (D14), row budget after the
// SQL-filterable dimensions (AG-10/AG-11), function signatures and grants (AG-12), per-basis bounds.
// Synthetic rows only, removed afterwards. Run: COMMUNITY_STACK=1 npx vitest run tests/integration/date-basis-sql.test.ts
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import oracle from '../../docs/implementation/date-basis-dashboard/fixtures/cohort-oracle.json';

const enabled = process.env.COMMUNITY_STACK === '1';
const API = process.env.COMMUNITY_API_URL ?? 'http://127.0.0.1:56321';
const DB_CONTAINER = process.env.COMMUNITY_DB_CONTAINER ?? 'supabase_db_ci0926-int';
const STACK_DIR = process.env.COMMUNITY_STACK_DIR ?? '.integration-stack';

function sql(query: string): string {
  return execFileSync('docker', ['exec', '-i', DB_CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-tAq', '-v', 'ON_ERROR_STOP=1'],
    { input: query, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
}
const q = (v: string | null) => (v === null ? 'null' : `'${v}'`);

const tag = randomUUID().slice(0, 8);
const hex = (text: string) => createHash('sha256').update(text).digest('hex');
const DATASET = hex(`ds-${tag}`), BULK_DATASET = hex(`bulk-${tag}`);
const keyOf = (id: string) => hex(`${tag}:${id}`);
const idOfKey = new Map(['A', 'B', 'C', 'D', 'E', 'G', 'F'].map((id) => [keyOf(id), id]));
const endsWith = (r: Record<string, any>, id: string) => r.source_report_key === keyOf(id);
const AGENCY = `a1:dbtest-${tag}`;
const BULK_AGENCY = `a1:dbbulk-${tag}`;
const users: Record<string, { id: string; grant: string }> = {};
let keys: { ANON_KEY: string; SERVICE_ROLE_KEY: string };

type Row = { id: string; user: string; report_date: string | null; completed_date: string | null; status: string; answer_at: string; number?: string };
const rows: Row[] = [];
for (const r of oracle.reports) {
  r.contributors.forEach((u, i) => rows.push({ id: r.id, user: u, report_date: r.report_date, completed_date: r.completed_date, status: r.status,
    answer_at: `2025-09-2${i}T00:00:00Z` }));
}
// D13: identity F — u3's copy carries the older August answer, u4's copy the latest September answer
for (const f of oracle.representative_oracle.rows) {
  rows.push({ id: 'F', user: f.contributor, report_date: f.report_date, completed_date: f.completed_date, status: f.status, answer_at: f.answer_accepted_at, number: 'SPP-2025-0000001' });
}

function facts(fn: string, basis: string, start: string, end: string, previous: boolean, agency = AGENCY): Array<Record<string, any>> {
  const out = sql(`select public.${fn}(${q(basis)}, date '${start}', date '${end}', ${previous}, 'all', null, ${q(agency)}, null, null)`);
  return JSON.parse(out);
}
const ids = (list: Array<Record<string, any>>, representativesOnly = true) =>
  [...new Set(list.filter((r) => !representativesOnly || r.is_representative).map((r) => idOfKey.get(r.source_report_key) ?? '?'))].sort();

describe.skipIf(!enabled)('single-date cohort SQL on real Postgres', () => {
  beforeAll(async () => {
    keys = JSON.parse(execFileSync('npx', ['supabase', 'status', '-o', 'json', '--workdir', STACK_DIR], { encoding: 'utf8' }));
    const svc = createClient(API, keys.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    for (const name of ['u1', 'u2', 'u3', 'u4']) {
      const { data, error } = await svc.auth.admin.createUser({ email: `db-${name}-${tag}@example.invalid`, password: `Pw-${randomUUID()}`, email_confirm: true });
      if (error) throw error;
      users[name] = { id: data.user!.id, grant: randomUUID() };
    }
    const grants = Object.values(users).map((u) => `('${u.grant}', '${randomUUID()}', '${u.id}', '2026-09-28.3', '${'a'.repeat(64)}', 'safetyreport_server', '${randomUUID()}')`).join(',');
    const profiles = Object.values(users).map((u) => `('${u.id}', '2026-09-28.3', '2026-09-28.3')`).join(',');
    sql(`insert into private.contributor_profiles (user_id, consent_version, privacy_policy_version) values ${profiles};
      insert into private.community_consent_grants (grant_id, lineage_id, user_id, policy_version, consent_text_sha256, granted_via, granted_session_id) values ${grants};`);
    const values = rows.map((r, i) => `('${users[r.user].id}', '${DATASET}', '${keyOf(r.id)}', 'src-${i}', '${randomUUID()}', '${users[r.user].grant}', 1, 1,
      '${hex(r.id + r.user + r.completed_date)}', 'completed', 'parking', '${r.status}', 'none', 'unknown', 'none',
      ${q(r.report_date)}, ${q(r.completed_date)}, '${r.answer_at}', '${r.answer_at}', ${q(r.number ?? null)}, '${AGENCY}', '예시 기관')`).join(',');
    sql(`insert into private.community_report_facts (contributor_id, dataset_key, source_report_key, source_report_id, latest_receipt_id,
      consent_grant_id, writer_epoch, source_revision, payload_sha256, public_state, category, status, disposition, amount_kind, coord_source,
      report_date, completed_date, answer_accepted_at, first_accepted_at, report_number, agency_key, agency_name) values ${values};`);
  }, 120000);

  afterAll(() => {
    if (!Object.keys(users).length) return;
    const list = Object.values(users).map((u) => `'${u.id}'`).join(',');
    sql(`delete from private.community_report_facts where contributor_id in (${list});
      delete from private.community_consent_grants where user_id in (${list});
      delete from private.contributor_profiles where user_id in (${list});
      delete from auth.users where id in (${list});`);
  });

  it('DT-05/DT-06 two bases over the same range select different identities (A/C/E vs B/C/D)', () => {
    const { start, end } = oracle.range;
    expect(ids(facts('internal_analytics_cohort_facts', 'report_date', start, end, false))).toEqual(oracle.expected.report_date.identities);
    expect(ids(facts('internal_analytics_cohort_facts', 'completed_date', start, end, false))).toEqual(oracle.expected.completed_date.identities);
  });
  it('DT-09/AG-05 D: one public representative, both contributions returned (two participants)', () => {
    const d = facts('internal_analytics_cohort_facts', 'completed_date', oracle.range.start, oracle.range.end, false).filter((r) => endsWith(r, 'D'));
    expect(d).toHaveLength(2);
    expect(d.filter((r) => r.is_representative)).toHaveLength(1);
    expect(d.every((r) => r.identity_report_date === null && r.identity_completed_date === '2025-08-20')).toBe(true);
  });
  it('DT-10 E (completed, no answer date) is in the report-date set and never in the answer-date set', () => {
    const e = facts('internal_analytics_cohort_facts', 'report_date', oracle.range.start, oracle.range.end, false).find((r) => endsWith(r, 'E'));
    expect(e).toMatchObject({ completed_date: null, status: 'accepted' });
  });
  it('AG-01 D13: the latest answer is elected before the date → August answer basis does not revive the old answer', () => {
    const now = facts('internal_analytics_cohort_facts', 'completed_date', '2025-08-01', '2025-08-31', false);
    expect(ids(now, false)).not.toContain('F');
    // reproduction on the previous function (kept for the rollout): it elects inside the window → the old August copy
    const old = JSON.parse(sql(`select public.internal_analytics_v2_facts(date '2025-08-01', date '2025-08-31', 'all', null, '${AGENCY}', null, null)`))
      .filter((r: Record<string, any>) => endsWith(r, 'F') && r.is_representative);
    expect(old.map((r: Record<string, any>) => [r.completed_date, r.status])).toEqual([['2025-08-10', 'rejected']]);
  });
  it('AG-02 report basis May: F carries its latest September result (same representative in every period)', () => {
    const may = facts('internal_analytics_cohort_facts', 'report_date', '2025-05-01', '2025-05-31', false).filter((r) => endsWith(r, 'F'));
    const rep = may.filter((r) => r.is_representative);
    expect(rep.map((r) => [r.completed_date, r.status])).toEqual([['2025-09-12', 'accepted']]);
    expect(may.every((r) => r.identity_completed_date === '2025-09-12')).toBe(true);
    const sep = facts('internal_analytics_cohort_facts', 'completed_date', '2025-09-01', '2025-09-30', false);
    expect(ids(sep)).toContain('F');
  });
  it('D14 the previous window is read only on request (same basis)', () => {
    const { start, end } = oracle.range;
    // previous window 2025-04-30..06-30 on the report date: B (05-20), F (05-12), G (06-01)
    expect(ids(facts('internal_analytics_cohort_facts', 'report_date', start, end, true))).toEqual(['A', 'B', 'C', 'E', 'F', 'G']);
    expect(ids(facts('internal_analytics_cohort_facts', 'report_date', start, end, false))).toEqual(['A', 'C', 'E']);
  });
  it('invalid basis / flags are refused', () => {
    expect(() => sql(`select public.internal_analytics_cohort_facts('published_date', date '2025-07-01', date '2025-08-31', false, 'all', null, null, null, null)`)).toThrow(/INVALID_QUERY/);
    expect(() => sql(`select public.internal_analytics_cohort_facts('report_date', date '2025-07-01', date '2025-08-31', null, 'all', null, null, null, null)`)).toThrow(/INVALID_QUERY/);
  });
  it('per-basis bounds and the policy version come from the state function', () => {
    const s = JSON.parse(sql('select public.internal_analytics_cohort_state()'));
    expect(s.cohort_policy_version).toBe('single-date-v1');
    expect(Object.keys(s.basis_bounds)).toEqual(['report_date', 'completed_date']);
    expect(s.basis_bounds.report_date.min <= '2025-05-12').toBe(true);
  });
  it('AG-12 one signature per new name; service_role only (anon/authenticated refused over PostgREST)', async () => {
    const sigs = sql(`select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('internal_analytics_cohort_facts','internal_analytics_cohort_state','internal_my_analytics_cohort_source') order by 1`).split('\n');
    expect(sigs).toHaveLength(3);
    for (const [fn, args] of [['internal_analytics_cohort_facts', 'text,date,date,boolean,text,text,text,text,double precision[]'], ['internal_analytics_cohort_state', ''],
      ['internal_my_analytics_cohort_source', 'uuid,uuid,text,date,date,boolean,text,text,text,text,double precision[]']]) {
      const priv = sql(`select has_function_privilege('anon', 'public.${fn}(${args})', 'execute') || ',' || has_function_privilege('authenticated', 'public.${fn}(${args})', 'execute')
        || ',' || has_function_privilege('service_role', 'public.${fn}(${args})', 'execute')`);
      expect(priv).toBe('false,false,true');
    }
    for (const token of [keys.ANON_KEY]) {
      const res = await fetch(`${API}/rest/v1/rpc/internal_analytics_cohort_facts`, { method: 'POST',
        headers: { apikey: keys.ANON_KEY, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ p_date_basis: 'report_date', p_start: '2025-07-01', p_end: '2025-08-31', p_with_previous: false, p_category: 'all',
          p_region_code: null, p_agency_key: null, p_manager_key: null, p_bbox: null }) });
      expect([401, 403, 404]).toContain(res.status);
    }
    // the service role reaches it with exactly these argument names (no overload ambiguity)
    const svc = createClient(API, keys.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const { data, error } = await svc.rpc('internal_analytics_cohort_facts', { p_date_basis: 'report_date', p_start: oracle.range.start, p_end: oracle.range.end,
      p_with_previous: false, p_category: 'all', p_region_code: null, p_agency_key: AGENCY, p_manager_key: null, p_bbox: null });
    expect(error).toBeNull();
    expect(ids(data as Array<Record<string, any>>)).toEqual(['A', 'C', 'E']);
  });
  // runs after AG-12: its temp-table DDL makes PostgREST reload the schema cache and drop open HTTP connections
  it('AG-10/AG-11 the row budget counts the filtered candidates: a narrow agency passes while the whole set is refused', () => {
    // 100,001 extra eligible rows inside ONE transaction that is rolled back (nothing stays in the database)
    const bulk = users.u1;
    const out = sql(`begin;
      insert into private.community_report_facts (contributor_id, dataset_key, source_report_key, source_report_id, latest_receipt_id,
        consent_grant_id, writer_epoch, source_revision, payload_sha256, public_state, category, status, disposition, amount_kind, coord_source,
        report_date, completed_date, agency_key)
        select '${bulk.id}', '${BULK_DATASET}', encode(sha256(('${tag}-bulk-' || g)::bytea), 'hex'), 'b' || g, gen_random_uuid(), '${bulk.grant}', 1, 1,
          md5(g::text) || md5(g::text), 'completed', 'other', 'accepted', 'none', 'unknown', 'none', date '2019-06-01', date '2019-06-02', '${BULK_AGENCY}'
        from generate_series(1, 100001) g;
      create temp table budget_out(k text, v text) on commit drop;
      do $$ begin
        perform public.internal_analytics_cohort_facts('completed_date', date '2019-06-01', date '2019-06-30', false, 'all', null, null, null, null);
        insert into budget_out values ('national', 'ok');
      exception when others then insert into budget_out values ('national', sqlerrm); end $$;
      insert into budget_out select 'narrow', jsonb_array_length(public.internal_analytics_cohort_facts('completed_date', date '2019-06-01', date '2019-06-30', false, 'all', null, '${AGENCY}', null, null))::text;
      insert into budget_out select 'oracle', (select string_agg(x->>'source_report_key', ',') from jsonb_array_elements(
        public.internal_analytics_cohort_facts('completed_date', date '${oracle.range.start}', date '${oracle.range.end}', false, 'all', null, '${AGENCY}', null, null)) x where (x->>'is_representative')::boolean);
      select k || '=' || v from budget_out order by k;
      rollback;`);
    const got = Object.fromEntries(out.split('\n').filter((l) => l.includes('=')).map((l) => l.split('=')));
    expect(got.national).toBe('RESULT_TOO_LARGE');
    expect(got.narrow).toBe('0');
    expect(got.oracle.split(',').map((k: string) => idOfKey.get(k)).sort()).toEqual(['B', 'C', 'D']);
    expect(sql(`select count(*) from private.community_report_facts where dataset_key = '${BULK_DATASET}'`)).toBe('0');
  }, 300000);
  it('the personal source gives no rows to an identity that fails the session check', () => {
    const out = JSON.parse(sql(`select public.internal_my_analytics_cohort_source('${users.u1.id}', '${randomUUID()}', 'report_date', date '2025-07-01', date '2025-08-31', false, 'all', null, null, null, null)`));
    expect(out.facts).toEqual([]);
    expect(out.state.cohort_policy_version).toBe('single-date-v1');
  });
});
