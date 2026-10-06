// my-reports measurements on the local stack (synthetic only, removed afterwards). Not part of the normal suite:
//   COMMUNITY_STACK=1 MY_REPORTS_MEASURE=1 npx vitest run tests/integration/my-reports-measure.test.ts
// Writes docs/integration/chromeextension/measurements.json and plans/*.txt: per-RPC DB time, DB→Edge bytes (the RPC's
// JSON), Edge→extension bytes (the handler's response), and EXPLAIN (ANALYZE, BUFFERS) of the RPC internals
// (auto_explain, nested statements) with and without the owner index of 202609300200.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMyReportsHandler, RPC_INVALID, RPC_TIMEOUT } from '../../server/myReports/handler';
import { API, DB_CONTAINER, createUser, deleteUsers, serviceClient, sql, stackKeys, type StackKeys, type TestUser } from './helpers/myReportsSeed';

const enabled = process.env.COMMUNITY_STACK === '1' && process.env.MY_REPORTS_MEASURE === '1';
const OUT = process.env.MY_REPORTS_MEASURE_OUT
  ? new URL(process.env.MY_REPORTS_MEASURE_OUT.replace(/\/?$/, '/'), `file://${process.cwd()}/`)
  : new URL('../../docs/integration/chromeextension/', import.meta.url);
const ORIGIN = 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const VEHICLE = '12가3456';

// heavy user: OWN reports × 2 datasets (PC + mobile copies); others: OTHERS users × PER_OTHER reports
const OWN = Number(process.env.MR_OWN ?? 20000);
const OTHERS = Number(process.env.MR_OTHERS ?? 400);
const PER_OTHER = Number(process.env.MR_PER_OTHER ?? 500);

let keys: StackKeys;
let heavy: TestUser;
const users: TestUser[] = [];

function admin(query: string): string {
  return execFileSync('docker', ['exec', '-i', DB_CONTAINER, 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-tAq', '-v', 'ON_ERROR_STOP=1'],
    { input: query, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}
/** Only statements that took >= 1 ms (the per-row sub-millisecond nested calls would make the file megabytes). */
function significant(log: string): string {
  return log.split(/(?=^LOG:  duration: )/m).filter((b) => {
    const m = /^LOG:  duration: ([0-9.]+) ms/.exec(b);
    return !m || Number(m[1]) >= 1;
  }).join('');
}
/** auto_explain output of every nested statement of one RPC call (LOG lines arrive on stderr). */
function explainRpc(call: string): string {
  const res = execFileSync('bash', ['-c', `docker exec -i ${DB_CONTAINER} psql -U supabase_admin -d postgres -tAq 2>&1`], {
    input: `load 'auto_explain'; set auto_explain.log_min_duration = 0; set auto_explain.log_analyze = on;
      set auto_explain.log_buffers = on; set auto_explain.log_nested_statements = on; set auto_explain.log_parameter_max_length = 0; set client_min_messages = log;
      select octet_length(${call}::text);`, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return res;
}
function timed(call: string, runs = 5): { median_ms: number; bytes: number } {
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const plan = JSON.parse(sql(`explain (analyze, format json) select ${call}`));
    times.push(plan[0]['Execution Time']);
  }
  times.sort((x, y) => x - y);
  const bytes = Number(sql(`select octet_length(${call}::text)`));
  return { median_ms: Math.round(times[Math.floor(times.length / 2)] * 10) / 10, bytes };
}

describe.skipIf(!enabled)('my-reports measurements (synthetic volume)', () => {
  beforeAll(async () => {
    keys = stackKeys();
    const svc = serviceClient(keys);
    heavy = await createUser(svc, keys.ANON_KEY, 'heavy');
    users.push(heavy);
    // others: plain auth users with an active grant (no GoTrue session needed)
    sql(`insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
      select gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mr-other-' || g || '@example.invalid', now(), now()
        from generate_series(1, ${OTHERS}) g;
      insert into private.contributor_profiles (user_id, consent_version, privacy_policy_version)
      select id, '2026-09-28.3', '2026-09-28.3' from auth.users where email like 'mr-other-%@example.invalid';
      insert into private.community_consent_grants (grant_id, lineage_id, user_id, policy_version, consent_text_sha256, granted_via, granted_session_id)
      select gen_random_uuid(), gen_random_uuid(), id, '2026-09-28.3', repeat('a', 64), 'safetyreport_server', gen_random_uuid()
        from auth.users where email like 'mr-other-%@example.invalid';`);
    const fact = (who: string, grant: string, ds: string, n: string, extra = '') => `
      insert into private.community_report_facts (contributor_id, dataset_key, source_report_key, source_report_id, latest_receipt_id,
        consent_grant_id, writer_epoch, source_revision, payload_sha256, public_state, category, status, disposition, amount_kind,
        amount_confirmed_won, vehicle_raw, report_date, completed_date, address, coord_source, agency_key, agency_name, agency_current_name,
        manager_key, manager_name, report_number, answer_accepted_at, first_accepted_at)
      select ${who}, encode(sha256(convert_to(${ds}, 'UTF8')), 'hex'), encode(sha256(convert_to('k' || g, 'UTF8')), 'hex'), (91000000 + g)::text,
        gen_random_uuid(), ${grant}, 1, 1, encode(sha256(convert_to('p' || g, 'UTF8')), 'hex'), 'completed',
        (array['traffic','parking','other'])[1 + g % 3], (array['accepted','partial','rejected','completed_unknown'])[1 + g % 4],
        (array['fine','warning','penalty','none','unknown'])[1 + g % 5], case when g % 5 = 0 then 'fine' else 'unknown' end,
        case when g % 5 = 0 and g % 4 in (0, 1) then 40000 end,
        case when g % 7 = 0 then '12가3456' else (10 + g % 89)::text || '나' || lpad((g % 9999)::text, 4, '0') end,
        date '2024-01-01' + (g % 1000), date '2024-01-10' + (g % 1000),
        '서울특별시 종로구 예시로 ' || (g % 300), 'none', 'a1:measure-' || (g % 40), '예시 기관 ' || (g % 40), '예시 기관 ' || (g % 40),
        'm1:measure-' || (g % 400), '담당 ' || (g % 400), 'SPP-2609-' || lpad(g::text, 8, '0'), now() - (g || ' minutes')::interval,
        now() - (g || ' minutes')::interval
      from ${n} ${extra};`;
    // heavy user: every report from PC and mobile (duplicate observations → one report each)
    sql(fact(`'${heavy.id}'`, `'${heavy.grant}'`, `'heavy-pc'`, `generate_series(1, ${OWN}) g`));
    sql(fact(`'${heavy.id}'`, `'${heavy.grant}'`, `'heavy-mobile'`, `generate_series(1, ${OWN}) g`));
    sql(fact('u.id', 'gr.grant_id', `'other-' || u.id::text`, `auth.users u join private.community_consent_grants gr on gr.user_id = u.id
      cross join generate_series(1, ${PER_OTHER}) g`, `where u.email like 'mr-other-%@example.invalid'`));
    sql('analyze private.community_report_facts;');
  }, 600000);

  afterAll(() => {
    sql(`delete from private.community_report_facts where contributor_id in (select id from auth.users where email like 'mr-other-%@example.invalid');
      delete from private.community_consent_grants where user_id in (select id from auth.users where email like 'mr-other-%@example.invalid');
      delete from private.contributor_profiles where user_id in (select id from auth.users where email like 'mr-other-%@example.invalid');
      delete from auth.users where email like 'mr-other-%@example.invalid';`);
    deleteUsers(users);
    sql('analyze private.community_report_facts;');
  }, 600000);

  it('measures the three RPCs, the Edge response bytes and the plans', async () => {
    const total = Number(sql('select count(*) from private.community_report_facts'));
    const own = Number(sql(`select count(*) from private.community_report_facts where contributor_id = '${heavy.id}'`));
    const u = `'${heavy.id}'::uuid, '${heavy.session}'::uuid`;
    const calls = {
      search_vehicle_first: `public.internal_my_reports_search(${u}, 'vehicle', '${VEHICLE}', true, 0, 20, 0, 10, null)`,
      search_address_first: `public.internal_my_reports_search(${u}, 'address', '서울특별시 종로구 예시로 7', true, 0, 20, 0, 10, null)`,
      search_vehicle_next: `public.internal_my_reports_search(${u}, 'vehicle', '${VEHICLE}', false, 20, 20, null, null, null)`,
      summary_first: `public.internal_my_reports_summary(${u}, date '2026-09-27', date '2026-09-29', true, 0, 20, null)`,
      numbers_page_500: `public.internal_my_reports_numbers(${u}, 'vehicle', '${VEHICLE}', 0, 500, 10000, null)`,
    };
    const withIndex = Object.fromEntries(Object.entries(calls).map(([k, c]) => [k, timed(c)]));
    const hasDraftIndex = sql(`select count(*) from pg_indexes where indexname = 'community_report_facts_my_reports_owner'`) === '1';
    mkdirSync(new URL('plans/', OUT), { recursive: true });
    const tag = process.env.MR_LABEL ?? `own${OWN}`;
    writeFileSync(new URL(`plans/${tag}.search_vehicle_first.with-owner-index.txt`, OUT), significant(explainRpc(calls.search_vehicle_first)));
    // same call without the draft owner index (inside a rolled-back transaction: the primary key alone)
    const noIndexPlan = execFileSync('bash', ['-c', `docker exec -i ${DB_CONTAINER} psql -U supabase_admin -d postgres -tAq 2>&1`], {
      input: `begin; drop index if exists private.community_report_facts_my_reports_owner;
        load 'auto_explain'; set auto_explain.log_min_duration = 0; set auto_explain.log_analyze = on; set auto_explain.log_buffers = on;
        set auto_explain.log_nested_statements = on; set auto_explain.log_parameter_max_length = 0; set client_min_messages = log;
        select octet_length(${calls.search_vehicle_first}::text); rollback;`, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    writeFileSync(new URL(`plans/${tag}.search_vehicle_first.primary-key-only.txt`, OUT), significant(noIndexPlan));

    // Edge → extension bytes: the real handler over the same database
    const svc = serviceClient(keys);
    const h = createMyReportsHandler({
      enabled: true, cursorSecret: 'measure-cursor-secret-0123456789abcdef', jwtIssuer: null, allowedOrigins: [ORIGIN],
      rateLimitPerMinute: 100000,
      rpc: async (name, args, signal) => {
        const { data, error } = await svc.rpc(name, args).abortSignal(signal);
        if (error) throw new Error(error.code === '57014' ? RPC_TIMEOUT : /INVALID_QUERY/.test(error.message) ? RPC_INVALID : 'rpc');
        return data;
      },
      getUser: async (t) => { const { data, error } = await svc.auth.getUser(t); if (error) console.log('getUser', error.status, error.message); return data.user ? { id: data.user.id, isAnonymous: false } : null; },
    });
    const edge = async (route: string, body: unknown) => {
      const t0 = performance.now();
      const res = await h(new Request(`${API}/functions/v1/my-reports/${route}`, { method: 'POST',
        headers: { 'content-type': 'application/json', origin: ORIGIN, authorization: `Bearer ${heavy.token}` }, body: JSON.stringify(body) }));
      const text = await res.text();
      return { status: res.status, code: res.ok ? null : JSON.parse(text).error?.code, bytes: Buffer.byteLength(text), ms: Math.round(performance.now() - t0) };
    };
    await svc.auth.getUser(heavy.token).catch(() => null); // warm a fresh connection after the long seed (a stale keep-alive fails once)
    const edgeBytes = {
      search_vehicle_first_20: await edge('search', { kind: 'vehicle', query: VEHICLE }),
      search_vehicle_first_50_managers_50: await edge('search', { kind: 'vehicle', query: VEHICLE, page_size: 50, managers_page_size: 50 }),
      search_address_first: await edge('search', { kind: 'address', query: '서울특별시 종로구 예시로 7' }),
      summary_first: await edge('summary', {}),
      numbers_page_500: await edge('numbers', { kind: 'vehicle', query: VEHICLE, page_size: 500 }),
    };
    for (const v of Object.values(edgeBytes)) expect(v.status, JSON.stringify(edgeBytes)).toBe(200);
    const matched = JSON.parse(sql(`select ${calls.search_vehicle_first}`)).reports.total;
    const prev = (() => { try { return JSON.parse(readFileSync(new URL('measurements.json', OUT), 'utf8')); } catch { return {}; } })();
    const label = process.env.MR_LABEL ?? `own${OWN}`;
    const result = {
      measured_at: new Date().toISOString(),
      environment: 'local composed stack (Postgres 17.6 supabase image, Docker), synthetic rows; not production',
      volume: { facts_total: total, heavy_user_facts: own, heavy_user_reports: OWN, other_users: OTHERS, per_other_user: PER_OTHER,
        vehicle_matches: matched },
      db_rpc_median_ms_and_db_to_edge_bytes: withIndex,
      draft_owner_index_present: hasDraftIndex,
      edge_to_extension: edgeBytes,
    };
    const out = { ...prev, runs: { ...(prev.runs ?? {}), [label]: result } };
    delete out.measured_at; delete out.environment; delete out.volume; delete out.db_rpc_median_ms_and_db_to_edge_bytes;
    delete out.draft_owner_index_present; delete out.edge_to_extension;
    writeFileSync(new URL('measurements.json', OUT), `${JSON.stringify(out, null, 2)}\n`);
    console.log(JSON.stringify(result, null, 2));
  }, 600000);
});
