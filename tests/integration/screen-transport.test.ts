// Local rollback-only SQL: encoding, failed viewer, legacy callers, role boundary and STABLE snapshot.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeScreenFacts } from '../../server/screenFacts';
const migrations = readdirSync('supabase/migrations').filter(n => /^20261006/.test(n) && !n.includes('0800_')).sort()
  .map(n => readFileSync(`supabase/migrations/${n}`, 'utf8').replace(/^(begin|commit);\s*$/gm, '')).join('\n');
const baseline = readFileSync('supabase/migrations/202610060100_cohort_facts_setwise.sql', 'utf8')
  .match(/create or replace function public\.internal_analytics_cohort_facts\([\s\S]*?\$\$;/)![0]
  .replace('public.internal_analytics_cohort_facts(', 'pg_temp.screen_baseline(')
  // Adopt only the explicitly specified final dataset tie key in the historical oracle.
  .replaceAll('f.first_accepted_at, f.contributor_id','f.first_accepted_at, f.contributor_id, f.dataset_key')
  .replaceAll('i.first_accepted_at, i.contributor_id','i.first_accepted_at, i.contributor_id, i.dataset_key');
const personalBaseline = readFileSync('supabase/migrations/202610060200_query_read_paths.sql', 'utf8')
  .match(/CREATE OR REPLACE FUNCTION public\.internal_my_analytics_cohort_source[\s\S]*?\$function\$\s*;/)![0]
  .replace('public.internal_my_analytics_cohort_source(', 'pg_temp.personal_baseline(')
  .replace('public.internal_analytics_cohort_facts(', 'pg_temp.screen_baseline(')
  // Adopt only the explicitly specified final dataset tie key in the historical oracle.
  .replaceAll('f.first_accepted_at, f.contributor_id','f.first_accepted_at, f.contributor_id, f.dataset_key')
  .replaceAll('i.first_accepted_at, i.contributor_id','i.first_accepted_at, i.contributor_id, i.dataset_key');
const seed = readFileSync('tests/integration/helpers/cohort-timeout-seed.sql', 'utf8').replaceAll('__SIZE__', '300');
const scope = `'{"date_basis":"completed_date","start":"2023-01-01","end":"2026-10-06","category":"all"}'::jsonb`;
const call = `public.internal_analytics_read_snapshot(${scope},true,p_user=>u.id,p_session=>u.session_id`;
const sql = (body: string) => execFileSync('docker', ['exec','-i','supabase_db_ci0926-int','psql','-X','-U','supabase_admin','-d','postgres','-qAt','-v','ON_ERROR_STOP=1'],
  { input: `begin;${migrations}${seed}${baseline}${personalBaseline}${body}\nrollback;`, encoding: 'utf8', maxBuffer: 8*1024*1024, timeout: 120000 })
  .split('\n').filter(s => s.startsWith('{')).map(s => JSON.parse(s));

describe.skipIf(process.env.COMMUNITY_STACK !== '1')('screen fact transport in real local PostgreSQL', () => {
  it('decodes to the complete legacy ordered source on both plan modes; snapshot state and viewer agree', () => {
    const rows = sql(['force_custom_plan','force_generic_plan'].map(mode => `set plan_cache_mode=${mode};
      select json_build_object('legacy',${call}), 'compact',${call},p_options=>'{"fact_encoding":"columns-v1"}'::jsonb))
      from cohort_users u where idx=1;`).join('\n'));
    expect(rows).toHaveLength(2);
    for (const { legacy, compact } of rows) {
      expect(compact.viewer.public_fact_count).toBeGreaterThanOrEqual(10);
      expect(compact.state).toEqual(legacy.state); expect(compact.viewer).toEqual(legacy.viewer);
      expect(decodeScreenFacts(compact.facts)).toEqual(legacy.facts);
      expect(JSON.stringify(compact).length).toBeLessThan(JSON.stringify(legacy).length * 0.6);
    }
  });
  it('matches the 060100 oracle with the specified dataset tie key across date/filter/previous windows', () => {
    const cases = ['report_date','completed_date'].flatMap(basis => [false,true].flatMap(previous => [
      ["'2023-01-01','2026-10-06'", "'all',null,null,null,null"],
      ["'2023-03-01','2023-03-31'", "'all',null,null,null,null"],
      ["'2023-01-01','2026-10-06'", "'traffic','서울 중구',null,null,null"],
      ["'2023-01-01','2026-10-06'", "'all',null,'agency-1','manager-1',null"],
      ["'2023-01-01','2026-10-06'", "'all',null,null,null,array[127.1,37.1,127.3,37.3]::double precision[]"],
      ["'2040-01-01','2040-01-31'", "'all',null,null,null,null"],
    ].map(([dates,filters]) => {
      const args = `'${basis}',${dates},${previous},${filters}`;
      return `select jsonb_build_object('equal',pg_temp.screen_baseline(${args})=public.internal_analytics_cohort_facts(${args})::jsonb);`;
    }))).join('\n');
    const rows = sql(`insert into private.community_report_facts select (jsonb_populate_record(null::private.community_report_facts,
      to_jsonb(f)||jsonb_build_object('dataset_key',repeat('b',64)))).* from private.community_report_facts f
      where source_report_id in ('synthetic-11','synthetic-12');
      set plan_cache_mode=force_custom_plan;${cases}set plan_cache_mode=force_generic_plan;${cases}`);
    expect(rows).toHaveLength(48);
    for (const row of rows) expect(row.equal).toBe(true);
  // This case executes 48 pairs of real SQL calls. The runner timeout is not a per-query latency assertion.
  }, 30000);
  it('returns no private facts for invalid sessions, 1–9 contributions or revoked consent', () => {
    const rows = sql(`
      select ${call.replace('p_session=>u.session_id', "p_session=>'00000000-0000-0000-0000-000000000000'::uuid")},p_options=>'{"fact_encoding":"columns-v1"}'::jsonb) from cohort_users u where idx=1;
      delete from private.community_report_facts where contributor_id=(select id from cohort_users where idx=1)
        and source_report_id not in (select source_report_id from private.community_report_facts where contributor_id=(select id from cohort_users where idx=1) order by source_report_id limit 5);
      select ${call},p_options=>'{"fact_encoding":"columns-v1"}'::jsonb) from cohort_users u where idx=1;
      update private.community_consent_grants set revoked_at=now() where user_id=(select id from cohort_users where idx=1);
      select ${call},p_options=>'{"fact_encoding":"columns-v1"}'::jsonb) from cohort_users u where idx=1;`);
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row.facts).toEqual([]);
    expect(rows[0].viewer.session).toBe(false);
    expect(rows[1].viewer.public_fact_count).toBeLessThan(10);
    expect(rows[2].viewer.contributor).toBe('revoked');
  });
  it('preserves native JSON values, unique keys, precision, escaping and object-order-independent consumers', () => {
    const args = "'completed_date','2023-01-01','2026-10-06',true,'all',null,null,null,null";
    const rows = sql(`update private.community_report_facts set address=$text$서울 "인용" \\ 경로 😀$text$,
        lat=37.123456789012345,lng=127.00000000000003,amount_confirmed_won=0 where source_report_id='synthetic-2';
      create temp table native_payload as select public.internal_analytics_cohort_facts(${args}) as value;
      select json_build_object('old',pg_temp.screen_baseline(${args}),'new',(select value from native_payload));
      select json_build_object('unique_keys',bool_and(n=34 and n=distinct_n)) from (
        select count(*) n,count(distinct key) distinct_n from native_payload,
        lateral json_array_elements(value) with ordinality r(obj,ord), lateral json_each(r.obj) group by ord) k;
      select json_build_object('old',jsonb_build_array(1e-7::double precision,1e20::double precision,9007199254740991::bigint,1.2300::numeric,null,true),
        'new',json_build_array(1e-7::double precision,1e20::double precision,9007199254740991::bigint,1.2300::numeric,null,true));`);
    expect(rows).toHaveLength(3);
    expect(rows[0].new).toEqual(rows[0].old);
    expect(Object.keys(rows[0].new[0])).not.toEqual(Object.keys(rows[0].old[0]));
    expect(rows[1].unique_keys).toBe(true);
    expect(rows[2].new).toEqual(rows[2].old);
  });
  it('keeps personal API callers and rollup snapshot branches compatible, and rankings independent', () => {
    const args = "'completed_date','2023-01-01','2026-10-06',true,'all',null,null,null,null";
    const options = `jsonb_build_object('page',1,'page_size',100,'sort',jsonb_build_object('column','completed','value','count','dir','desc'),
      'expected_version',public.internal_analytics_cohort_state()->>'dataset_version')`;
    const rows = sql(`select json_build_object('old',pg_temp.personal_baseline(u.id,u.session_id,${args}),
        'new',public.internal_my_analytics_cohort_source(u.id,u.session_id,${args})) from cohort_users u where idx=1;
      select json_build_object('old',pg_temp.personal_baseline(u.id,'00000000-0000-0000-0000-000000000000',${args}),
        'new',public.internal_my_analytics_cohort_source(u.id,'00000000-0000-0000-0000-000000000000',${args})) from cohort_users u where idx=1;
      select json_build_object('old',public.internal_analytics_rollup(${scope},kind,${options}),
        'new',public.internal_analytics_read_snapshot(${scope},false,kind,${options})->'rollup')
        from unnest(array['agency','manager','laws','series']) kind;
      select public.internal_user_rankings(u.id,u.session_id,
        '{"theme":"reporters","metric":"reports_count","period":"all","date_basis":"completed_date","category":"all","min_reports":1,"page":1,"page_size":10,"consistency":"latest"}') from cohort_users u where idx=1;`);
    expect(rows).toHaveLength(7);
    for (const row of rows.slice(0,6)) expect(row.new).toEqual(row.old);
    expect(rows[1].new.facts).toEqual([]);
    expect(rows[6].schema_version).toBe('user-rankings-v1');
    expect(rows[6].rows).toHaveLength(10);
    expect(rows[6].me).not.toBeNull();
  });
  it('keeps stable definer/search_path and service-only RPC, denies browser roles access to the helper', () => {
    const rows = sql(`select jsonb_build_object('name',proname,'stable',provolatile='s','definer',prosecdef,
      'return_type',prorettype::regtype::text,'path',proconfig @> array['search_path=""'],
      'anon',has_function_privilege('anon',oid,'execute'),'authenticated',has_function_privilege('authenticated',oid,'execute'),
      'service',has_function_privilege('service_role',oid,'execute')) from pg_proc where proname in
      ('analytics_cohort_payload','internal_analytics_cohort_facts','internal_analytics_read_snapshot','internal_my_analytics_cohort_source');`);
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row).toMatchObject({ return_type: 'json', stable: true, definer: true, path: true, anon: false, authenticated: false });
      if (row.name !== 'analytics_cohort_payload') expect(row.service).toBe(true);
    }
  });
  it('restores the three original definitions and service ACLs through the forward rollback', () => {
    const rollback = readFileSync('docs/implementation/screen-snapshot-timeout-20261006/rollback.sql', 'utf8')
      .replace(/^(begin|commit);\s*$/gm, '');
    const rows = sql(`${rollback}
      select json_build_object('name',proname,'type',prorettype::regtype::text,'owner',pg_get_userbyid(proowner),
        'service',has_function_privilege('service_role',oid,'execute'),
        'anon',has_function_privilege('anon',oid,'execute'),'authenticated',has_function_privilege('authenticated',oid,'execute'))
        from pg_proc where proname in ('internal_analytics_cohort_facts','internal_analytics_read_snapshot','internal_my_analytics_cohort_source');
      select json_build_object('removed',to_regprocedure('private.analytics_cohort_payload(text,date,date,boolean,text,text,text,text,double precision[],boolean)') is null,
        'equal',public.internal_analytics_cohort_facts('completed_date','2023-01-01','2026-10-06',true,'all',null,null,null,null)
          = pg_temp.screen_baseline('completed_date','2023-01-01','2026-10-06',true,'all',null,null,null,null));`);
    expect(rows).toHaveLength(4);
    for (const row of rows.slice(0,3)) expect(row).toMatchObject({ type: 'jsonb', owner: 'postgres', service: true, anon: false, authenticated: false });
    expect(rows[3]).toEqual({ removed: true, equal: true });
  });
  it('accounts for every installed SQL caller of the changed functions', () => {
    const rows = sql(`select json_build_object('name',p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname in ('public','private') and p.prokind='f'
        and p.prosrc ~ '(internal_analytics_cohort_facts|internal_analytics_read_snapshot|analytics_cohort_payload)[[:space:]]*[(]'
      order by p.proname;`);
    expect(rows.map(r => r.name)).toEqual(['internal_analytics_cohort_facts','internal_analytics_read_snapshot','internal_my_analytics_cohort_source']);
  });
  it('does not mistake an in-function statement_timeout setting for a deadline on that statement', () => {
    const rows = sql(`create function pg_temp.timeout_probe() returns json language plpgsql as $$
      declare started timestamptz:=clock_timestamp();
      begin
        perform set_config('statement_timeout','30',true);
        perform pg_sleep(0.1);
        return json_build_object('elapsed_ms',extract(epoch from clock_timestamp()-started)*1000,'setting',current_setting('statement_timeout'));
      end $$;
      set statement_timeout='2s'; select pg_temp.timeout_probe(); set statement_timeout='90s';`);
    expect(rows).toHaveLength(1);
    expect(rows[0].setting).toBe('30ms');
    expect(rows[0].elapsed_ms).toBeGreaterThanOrEqual(90);
  });
});
