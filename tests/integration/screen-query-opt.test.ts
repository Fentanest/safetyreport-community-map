/** Real local PostgreSQL 17 (rolled back). 202610180100/0101/0200 must not change any Edge packet:
 * each scenario is computed by the deployed 202610121400 path first, then by the new path in the same transaction. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createScreenHandler } from '../../server/screenHandler';
import { placeKeyOf } from '../../server/places';
import { dashboardResponseSchema } from '../../src/data/schema';
import { personalCompareSchema } from '../../src/data/personal';
import { decodeScreenFacts } from '../../server/screenFacts';

const strip = (n: string) => readFileSync(`supabase/migrations/${n}`, 'utf8').replace(/^(begin|commit);\s*$/gm, '');
const deployed = [...readdirSync('supabase/migrations').filter(n => /^202610060[1-9]00_/.test(n) && !n.includes('0800_')).sort(),
  '202610061000_screen_aggregate_opt.sql', '202610110100_five_categories.sql', '202610121200_fine_estimate_columns.sql',
  '202610121201_fine_estimate_ingest_aggregate.sql', '202610121300_screen_result_cache.sql', '202610121400_screen_cache_stale.sql',
  '202610130100_screen_plate_normalization.sql', '202610131000_motorcycle_plate.sql', '20261014132612_remove_analytics_row_limit.sql'].map(strip).join('\n');
const candidate = ['202610180100_screen_fact_norm.sql', '202610180101_screen_fact_norm_backfill.sql', '202610180200_screen_cache_reuse.sql'].map(strip).join('\n');
// 300 shared places, distinct plates and laws, so normalization, focus and shared-place counters all matter.
const address = (k: number) => `경기 수원시 장안구 정자동 ${k % 300}-1 앞`;
const seed = readFileSync('tests/integration/helpers/cohort-timeout-seed.sql', 'utf8').replaceAll('__SIZE__', '4000')
  .replace("'합성 주소', 'point-'||k%50, null",
    "case when k%23=0 then null else '경기 수원시 장안구 정자동 '||(k%300)||'-1 앞' end, 'point-'||k%50, " +
    "case when g%9=0 then null when g%5=0 then '경기'||(10+k%89)||'자'||lpad((k%9999)::text,4,'0') else (100+k%899)||'가'||lpad((k%9999)::text,4,'0') end");
const setup = `begin;${deployed}\n${seed}\nupdate private.analytics_state set ready=true,data_min=null,data_max=null;`;
const sql = (body: string) => execFileSync('docker', ['exec', '-i', 'supabase_db_ci0926-int', 'psql', '-X', '-U', 'supabase_admin', '-d', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1'],
  { input: `${setup}\n${body}\nrollback;`, encoding: 'utf8', timeout: 300000, maxBuffer: 256 * 1024 * 1024 })
  .split('\n').filter(s => s.startsWith('{')).map(s => JSON.parse(s));
const quote = (v: unknown) => `'${JSON.stringify(v).replaceAll("'", "''")}'`;
const user = (idx = 1) => createHash('md5').update(`cohort-timeout-user-${idx}`).digest('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
const call = (s: object, ps: object[], idx = 1) =>
  `select public.internal_analytics_screen_stale(${quote(s)},${quote(ps)},u.id,u.session_id) from cohort_users u where idx=${idx};`;
const clear = 'delete from private.screen_result_cache;';

const base = { date_basis: 'completed_date', start: '2023-01-01', end: '2026-10-12', category: 'all' };
const focusA = { id: 'focus', path: `places/${placeKeyOf(address(7))}`, params: {} };
const focusB = { id: 'pin-b', path: `places/${placeKeyOf(address(8))}`, params: {} };
const compare = { id: 'compare', path: 'compare', params: {} };
const lists = [{ id: 'entities', path: 'entities', params: { kind: 'agency' } }, { id: 'laws', path: 'laws', params: {} }];
const scenarios: { name: string; scope: Record<string, string>; panels: object[] }[] = [
  { name: 'default + compare + two pins', scope: base, panels: [...lists, compare, focusA, focusB] },
  { name: 'parking report_date + compare + pin', scope: { ...base, date_basis: 'report_date', category: 'parking' }, panels: [compare, focusA] },
  { name: 'law filter + compare', scope: { ...base, law: '합성법 제3조' }, panels: [...lists, compare] },
  { name: 'pin only', scope: base, panels: [focusB] },
];

async function replay(source: unknown, s: Record<string, string>, ps: object[], idx = 1) {
  const token = `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: user(idx), role: 'authenticated', aud: 'authenticated', session_id: '11111111-2222-4333-8444-555555555555' })).toString('base64url')}.sig`;
  const handler = createScreenHandler({ enabled: true, allowedOrigins: [], jwtIssuer: null, getUser: async () => ({ id: user(idx), isAnonymous: false }),
    rpc: async name => name.endsWith('rate_limit') ? true : source });
  const response = await handler(new Request(`https://local.invalid/my-analytics/screen?${new URLSearchParams({ ...s, panels: JSON.stringify(ps) })}`,
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json; screen-cache=stale-v2' } }));
  const body = await response.json();
  expect(response.status).toBe(200);
  dashboardResponseSchema.parse(body.dashboard);
  const cmp = body.panels.find((p: any) => p.id === 'compare');
  if (cmp) personalCompareSchema.parse(cmp.body);
  expect(JSON.stringify(body)).not.toMatch(/SPP-2026-|cohort-key-|vehicle_raw|report_identity|contributor_id/);
  // Only the snapshot instants may differ between two statements.
  return JSON.parse(JSON.stringify(body, (k, v) => ['snapshot_at', 'public_at', 'personal_at'].includes(k) ? undefined : v));
}

describe.skipIf(process.env.SCREEN_CACHE_STACK !== '1')('screen query optimization (local rollback)', () => {
  it('every scenario: deployed path = full miss = public hit + restricted personal = all hits', async () => {
    const parts = scenarios.flatMap(sc => [clear, call(sc.scope, sc.panels)]);
    parts.push(candidate, `select json_build_object('complete',private.screen_norm_complete());`);
    for (const sc of scenarios) parts.push(
      clear, call(sc.scope, sc.panels),
      'delete from private.screen_result_cache where slot between 32 and 159;', call(sc.scope, sc.panels),
      call(sc.scope, sc.panels));
    const rows = sql(parts.join('\n'));
    expect(rows).toHaveLength(scenarios.length * 4 + 1);
    expect(rows[scenarios.length].complete).toBe(true);
    for (const [i, sc] of scenarios.entries()) {
      const old = rows[i], [miss, restricted, hit] = rows.slice(scenarios.length + 1 + i * 3, scenarios.length + 4 + i * 3);
      const personal = sc.panels.includes(compare);
      expect(miss.cache.public_hit, sc.name).toBe(false);
      expect(restricted.cache.public_hit, sc.name).toBe(true);
      if (personal) expect(restricted.cache.personal_hit, sc.name).toBe(false);
      expect(hit.cache.public_hit && (!personal || hit.cache.personal_hit), sc.name).toBe(true);
      const expected = await replay(old, sc.scope, sc.panels);
      for (const packet of [miss, restricted, hit]) expect(await replay(packet, sc.scope, sc.panels), sc.name).toEqual(expected);
    }
  }, 600000);

  it('a pin click reuses the warmed base entry; the stored base never holds focus rows', () => {
    const rows = sql(`${candidate}${call(base, [])}${call(base, [focusA])}${call(base, [focusB, compare])}
      select json_build_object('focus_rows',(select count(*) from private.screen_result_cache c, json_array_elements(c.payload->'data'->'stats') e
        where c.slot<32 and (e->>'kind'='focus' or e->>'focus'<>'')),'entries',(select count(*) from private.screen_result_cache where slot<32));`);
    expect(rows[1].cache.public_hit).toBe(true);
    expect(rows[2].cache.public_hit).toBe(true);
    expect(rows[1].public_aggregate.stats.some((s: any) => s.kind === 'focus')).toBe(true);
    expect(rows[3]).toEqual({ focus_rows: 0, entries: 1 });
  }, 300000);

  it('unchanged data is restamped instead of recomputed; any upload still recomputes', () => {
    const rows = sql(`${candidate}${call(base, [])}
      update private.screen_result_cache set created_at=created_at-interval '600 seconds',expires_at=statement_timestamp()+interval '1 minute' where slot<32;
      select json_build_object('payload',(select md5(payload::text) from private.screen_result_cache where slot<32));
      ${call(base, [])}
      select json_build_object('payload',(select md5(payload::text) from private.screen_result_cache where slot<32),
        'fresh',(select bool_and(created_at>statement_timestamp()-interval '5 seconds' and expires_at>statement_timestamp()+interval '14 minutes') from private.screen_result_cache where slot<32));
      update private.screen_result_cache set created_at=created_at-interval '600 seconds' where slot<32;
      update private.community_report_facts set status='accepted' where contributor_id=(select id from cohort_users where idx=2);
      ${call(base, [])}
      select json_build_object('warm',private.screen_cache_maintain());
      update private.screen_result_cache set created_at=statement_timestamp()-interval '61 seconds' where slot in (0,1);
      select json_build_object('warm',private.screen_cache_maintain());
      update private.analytics_state set source_updated_at=clock_timestamp();
      update private.screen_result_cache set created_at=statement_timestamp()-interval '61 seconds' where slot<32;
      select json_build_object('warm',private.screen_cache_maintain());`);
    expect(rows[2].cache.public_hit).toBe(true);
    expect(Date.parse(rows[2].snapshots.public_at)).toBeGreaterThan(Date.parse(rows[0].snapshots.public_at));
    expect(rows[3].payload).toBe(rows[1].payload); expect(rows[3].fresh).toBe(true);
    expect(rows[4].cache.public_hit).toBe(false);
    expect(rows[5].warm).toBe(2);
    expect(rows[6].warm).toBe(0);
    expect(rows[7].warm).toBe(2);
  }, 300000);

  it('the sidecar follows inserts, updates, key moves and deletes; it is closed to every API role', () => {
    const rows = sql(`${candidate}
      update private.community_report_facts set address=address||' 2', vehicle_raw='서울12가3456' where contributor_id=(select id from cohort_users where idx=3);
      update private.community_report_facts set source_report_key=md5(source_report_key)||md5('x'||source_report_key) where contributor_id=(select id from cohort_users where idx=4);
      select json_build_object('complete',private.screen_norm_complete(),
        'moved',(select count(*) from private.screen_fact_norm n join private.community_report_facts f using(contributor_id,dataset_key,source_report_key)
          where f.contributor_id=(select id from cohort_users where idx=4)),
        'facts4',(select count(*) from private.community_report_facts where contributor_id=(select id from cohort_users where idx=4)),
        'plate',(select count(*) from private.screen_fact_norm n join cohort_users u on u.id=n.contributor_id where u.idx=3 and n.plate='서울12가3456'));
      delete from private.community_report_facts where contributor_id=(select id from cohort_users where idx=5);
      select json_build_object('orphans',(select count(*) from private.screen_fact_norm n where not exists(select 1 from private.community_report_facts f
        where f.contributor_id=n.contributor_id and f.dataset_key=n.dataset_key and f.source_report_key=n.source_report_key)),
        'complete',private.screen_norm_complete(),
        'roles',(select json_agg(has_table_privilege(r,'private.screen_fact_norm','select')) from unnest(array['anon','authenticated','service_role']) r),
        'functions',(select json_agg(has_function_privilege(r,f,'execute')) from unnest(array['anon','authenticated','service_role']) r,
          unnest(array['private.screen_fact_norm_put(uuid,text,text,text,text,text,text,double precision,double precision)',
            'private.analytics_screen_parts(jsonb,uuid,jsonb,text,text[])','private.screen_norm_complete()']) f));
      alter table private.community_report_facts disable trigger screen_fact_norm_update;
      update private.community_report_facts set address='다른 주소' where contributor_id=(select id from cohort_users where idx=7);
      select json_build_object('complete',private.screen_norm_complete());`);
    expect(rows[0].complete).toBe(true);
    expect(rows[0].moved).toBeGreaterThan(0); expect(rows[0].moved).toBe(rows[0].facts4);
    expect(rows[0].plate).toBeGreaterThan(0);
    expect(rows[1].orphans).toBe(0); expect(rows[1].complete).toBe(true);
    expect(rows[1].roles).toEqual([false, false, false]);
    expect(rows[1].functions.every((v: boolean) => v === false)).toBe(true);
    expect(rows[2].complete).toBe(false);
  }, 300000);

  it('the personal columns source decodes to exactly the object source; both stay service-only', () => {
    const args = (idx: number, basis: string) => `u.id,u.session_id,'${basis}','2023-01-01','2026-10-12',false,'all',null,null,null,null`;
    const rows = sql(`${strip('202610180300_personal_source_columns.sql')}
      ${[1, 30].flatMap(idx => ['completed_date', 'report_date'].map(basis => `select json_build_object(
        'old',public.internal_my_analytics_cohort_source(${args(idx, basis)}),
        'new',public.internal_my_analytics_cohort_columns(${args(idx, basis)})) from cohort_users u where idx=${idx};`)).join('\n')}
      select json_build_object('acl',(select json_agg(has_function_privilege(r,
        'public.internal_my_analytics_cohort_columns(uuid,uuid,text,date,date,boolean,text,text,text,text,double precision[])','execute'))
        from unnest(array['anon','authenticated','service_role']) r));`);
    for (const row of rows.slice(0, 4)) {
      expect(row.new.state).toEqual(row.old.state);
      expect(row.new.viewer).toEqual(row.old.viewer);
      expect(decodeScreenFacts(row.new.facts)).toEqual(row.old.facts);
    }
    expect(rows[0].old.facts.length).toBeGreaterThan(1000);
    expect(rows.at(-1).acl).toEqual([false, false, true]);
  }, 300000);

  it('rollback restores every deployed definition, owner, ACL and setting, and removes the new objects', async () => {
    const rollback = readFileSync('docs/implementation/screen-query-opt-20261018/rollback.sql', 'utf8').replace(/^(begin|commit);\s*$/gm, '');
    const defs = `select json_build_object('defs',(select json_object_agg(p.oid::regprocedure::text, json_build_array(md5(pg_get_functiondef(p.oid)),
      pg_get_userbyid(p.proowner),p.proacl::text,p.proconfig::text,p.provolatile,p.prosecdef)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname in ('public','private') and (p.proname like 'screen%' or p.proname like 'analytics_screen%' or p.proname like 'internal_%')),
      'tables',(select json_agg(c.relname order by c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname like 'screen%'),
      'triggers',(select json_agg(tgname order by tgname) from pg_trigger where tgrelid='private.community_report_facts'::regclass and not tgisinternal));`;
    const sc = scenarios[0];
    const rows = sql(`${defs}${clear}${call(sc.scope, sc.panels)}${candidate}${call(sc.scope, sc.panels)}${rollback}${defs}${clear}${call(sc.scope, sc.panels)}`);
    expect(rows[3].defs).toEqual(rows[0].defs);
    expect(rows[3].tables).toEqual(rows[0].tables);
    expect(rows[3].triggers).toEqual(rows[0].triggers);
    const expected = await replay(rows[1], sc.scope, sc.panels);
    expect(await replay(rows[2], sc.scope, sc.panels)).toEqual(expected);
    expect(await replay(rows[4], sc.scope, sc.panels)).toEqual(expected);
  }, 300000);

  it('stale sidecar rows are ignored: the result equals the deployed path', async () => {
    const sc = scenarios[0];
    const rows = sql(`update private.community_report_facts set address='다른 주소 '||(source_revision%3) where contributor_id=(select id from cohort_users where idx=7);
      ${clear}${call(sc.scope, sc.panels)}${candidate}
      update private.screen_fact_norm set place='pl1:0000000000000000', region='99', plate='00가0000', v=0 where contributor_id=(select id from cohort_users where idx=8);
      update private.screen_fact_norm n set address=null where contributor_id=(select id from cohort_users where idx=9);
      ${clear}${call(sc.scope, sc.panels)}`);
    expect(await replay(rows[1], sc.scope, sc.panels)).toEqual(await replay(rows[0], sc.scope, sc.panels));
  }, 300000);
});
