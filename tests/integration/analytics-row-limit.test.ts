/** Local Docker PostgreSQL only; each schema/data mutation is rolled back. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createScreenHandler } from '../../server/screenHandler';
import { dashboardResponseSchema } from '../../src/data/schema';
import { personalCompareSchema } from '../../src/data/personal';
const read = (name: string) => readFileSync(name, 'utf8');
const strip = (s: string) => s.replace(/^(begin|commit);\s*$/gm, '');
const migration = strip(read('supabase/migrations/20261014132612_remove_analytics_row_limit.sql'));
const setup = [...readdirSync('supabase/migrations').filter(n => /^202610060[1-9]00_/.test(n) && !n.includes('0800_')).sort(),
  '202610061000_screen_aggregate_opt.sql', '202610110100_five_categories.sql', '202610121200_fine_estimate_columns.sql',
  '202610121201_fine_estimate_ingest_aggregate.sql', '202610121300_screen_result_cache.sql', '202610121400_screen_cache_stale.sql']
  .map(n => strip(read(`supabase/migrations/${n}`))).join('\n');
const baseSeed = read('tests/integration/helpers/cohort-timeout-seed.sql');
const scope = { date_basis: 'completed_date', start: '2025-10-13', end: '2026-10-12', category: 'all' };
const panels = [{ id: 'compare', path: 'compare', params: {} }, { id: 'entities', path: 'entities', params: { kind: 'agency' } }, { id: 'laws', path: 'laws', params: {} }];
const q = (value: unknown) => `'${JSON.stringify(value).replaceAll("'", "''")}'`;
const call = (s = scope) => `public.internal_analytics_screen_stale(${q(s)},${q(panels)},u.id,u.session_id)`;
function sql(seed: string, body: string) {
  return execFileSync('docker', ['exec', '-i', 'supabase_db_ci0926-int', 'psql', '-X', '-U', 'supabase_admin', '-d', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1'], {
    input: `begin;${setup}\n${seed}\nupdate private.analytics_state set ready=true,data_min=null,data_max=null;\n${body}\nrollback;`,
    encoding: 'utf8', timeout: 240000, maxBuffer: 32 * 1024 * 1024,
  }).split('\n').filter(s => s.startsWith('{')).map(s => JSON.parse(s));
}
const uid = createHash('md5').update('cohort-timeout-user-1').digest('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
async function replay(source: any) {
  const token = `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: uid, role: 'authenticated', aud: 'authenticated', session_id: '11111111-2222-4333-8444-555555555555' })).toString('base64url')}.sig`;
  const handler = createScreenHandler({ enabled: true, allowedOrigins: [], jwtIssuer: null, getUser: async () => ({ id: uid, isAnonymous: false }),
    rpc: async name => name.endsWith('rate_limit') ? true : source });
  const res = await handler(new Request(`https://local.invalid/my-analytics/screen?${new URLSearchParams({ ...scope, panels: JSON.stringify(panels) })}`,
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json; screen-cache=stale-v2; screen-detail=deferred-v1' } }));
  return { status: res.status, body: await res.json() };
}

describe.skipIf(process.env.SCREEN_CACHE_STACK !== '1')('analytics without a report-count cap', () => {
  it('preserves complete small-cohort results, owner, ACL and function settings; is repeatable', () => {
    const cases = ['completed_date', 'report_date'].flatMap(date_basis => ['all', 'parking', 'safety'].map(category => ({ ...scope, start: '2023-01-01', date_basis, category })));
    const query = cases.map(s => `select private.analytics_screen_parts(${q(s)},u.id,${q(panels)},'both')::jsonb from cohort_users u where idx=1`).join(' union all ');
    const rows = sql(baseSeed.replaceAll('__SIZE__', '1200'), `
      create temp table before_values as ${query};
      create temp table before_acl as select oid,proowner,proacl,proconfig from pg_proc where proname in
        ('analytics_cohort_payload','internal_analytics_v2_facts','analytics_screen_aggregate','analytics_screen_aggregate_v2','analytics_screen_parts');
      ${migration}${migration}
      create temp table after_values as ${query};
      select json_build_object('equal',not exists((table before_values except all table after_values) union all (table after_values except all table before_values)),
        'acl_equal',not exists(select 1 from before_acl b join pg_proc p using(oid) where (b.proowner,b.proacl,b.proconfig) is distinct from (p.proowner,p.proacl,p.proconfig)));
    `);
    expect(rows).toEqual([{ equal: true, acl_equal: true }]);
  }, 240000);

  it('reproduces 422, then returns every eligible report above 100000 through raw, compact and screen paths', async () => {
    // Unique source keys and one known date make the expected count independent of the implementation.
    const seed = baseSeed.replaceAll('__SIZE__', '120000')
      .replace('case when g%10=0 then g-1 else g end as k', 'g as k')
      .replace("case when g%71<>0 then date '2023-01-01'+(k%1300) end", "date '2026-10-01'")
      .replace("case when g%73<>0 then date '2023-01-01'+(k%1300)+g%90 end", "date '2026-10-01'");
    const rows = sql(seed, `
      create temp table failures(code text);
      do $$ begin
        perform private.analytics_screen_parts(${q(scope)},(select id from cohort_users where idx=1),${q(panels)},'both');
        insert into failures values('NO_ERROR');
      exception when others then insert into failures values(sqlerrm);end $$;
      select row_to_json(f) from failures f;
      ${migration}
      create temp table expected as select count(*) n from private.community_report_facts f
        join private.contributor_profiles c on c.user_id=f.contributor_id and c.status='active'
        where f.public_state='completed' and private.community_lineage_active(f.consent_grant_id);
      select json_build_object('expected',n) from expected;
      select json_build_object('raw',json_array_length(private.analytics_cohort_payload('completed_date','2025-10-13','2026-10-12',true,'all',null,null,null,null,false)),
        'compact',json_array_length(private.analytics_cohort_payload('completed_date','2025-10-13','2026-10-12',true,'all',null,null,null,null,true)->'rows'));
      set local statement_timeout='55s';
      select json_build_object('legacy',jsonb_array_length(public.internal_analytics_v2_facts('2025-10-13','2026-10-12','all',null,null,null,null)));
      -- Legacy raw RPC sets an 8s transaction-local timeout. Reset between separate probes.
      set local statement_timeout='55s';
      select json_build_object('v1',private.analytics_screen_aggregate(${q(scope)},u.id,${q(panels)}),
        'v2',private.analytics_screen_aggregate_v2(${q(scope)},u.id,${q(panels)})) from cohort_users u where idx=1;
      set local statement_timeout='55s';
      select ${call()} from cohort_users u where idx=1;
      set local statement_timeout='55s';
      select ${call()} from cohort_users u where idx=1;
      select ${call({ ...scope, start: '2023-01-01' })} from cohort_users u where idx=1;
    `);
    expect(rows[0]).toEqual({ code: 'RESULT_TOO_LARGE' });
    const n = rows[1].expected; expect(n).toBeGreaterThan(100000);
    expect(rows[2]).toEqual({ raw: n, compact: n }); expect(rows[3]).toEqual({ legacy: n });
    for (const aggregate of [rows[4].v1, rows[4].v2, rows[5].public_aggregate, rows[6].public_aggregate])
      expect(aggregate.stats.find((s: any) => s.side === 'all' && s.kind === 'summary' && s.period === 0).n).toBe(n);
    expect(rows[6].cache.public_hit).toBe(true);
    const response = await replay(rows[5]); expect(response.status).toBe(200);
    dashboardResponseSchema.parse(response.body.dashboard);
    personalCompareSchema.parse(response.body.panels[0].body);
    expect(response.body.dashboard.overview.report_count.value).toBe(n);
    expect(JSON.stringify(response.body)).not.toMatch(/SPP-2026-|vehicle_raw|report_identity|contributor_id/);
    expect(JSON.stringify(response.body)).not.toContain(uid);
    // Synthetic aggregate only, for the browser replay harness. No private rows are exported.
    writeFileSync('/tmp/cm-cache-browser-year.json', JSON.stringify(rows[5]));
    writeFileSync('/tmp/cm-cache-browser-all.json', JSON.stringify(rows[7]));
    writeFileSync('/tmp/cm-row-limit-evidence.json', JSON.stringify({ before: rows[0].code, after: response.status, expected: n, raw: rows[2].raw, compact: rows[2].compact, legacy: rows[3].legacy, screen: response.body.dashboard.overview.report_count.value, warm: rows[6].cache.public_hit }, null, 2));
  }, 240000);
});
