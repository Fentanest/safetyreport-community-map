// Local Docker PostgreSQL only. Every fixture, function replacement and assertion is rolled back.
// Run sequentially: COMMUNITY_STACK=1 npx vitest run tests/integration/cohort-timeout.test.ts --maxWorkers=1
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const read = (path: string) => readFileSync(path, 'utf8');
const old = read('supabase/migrations/202610010100_single_date_cohort.sql');
const migration = read('supabase/migrations/202610060100_cohort_facts_setwise.sql').replace(/^(begin|commit);\s*$/gm, '');
const frozen = old.match(/create or replace function public\.internal_analytics_cohort_facts\([\s\S]*?\$\$;/)![0]
  .replace('public.internal_analytics_cohort_facts(', 'pg_temp.cohort_before(');
const personal = old.match(/create or replace function public\.internal_my_analytics_cohort_source\([\s\S]*?\$\$;/)![0]
  .replace('public.internal_my_analytics_cohort_source(', 'pg_temp.personal_before(')
  .replace('public.internal_analytics_cohort_facts(', 'pg_temp.cohort_before(');
const seed = read('tests/integration/helpers/cohort-timeout-seed.sql').replaceAll('__SIZE__', '300');
const prefix = `begin;${seed}${frozen}${personal}${migration}set plan_cache_mode=force_custom_plan;set statement_timeout='60s';`;
function sql(query: string): any[] {
  return execFileSync('docker', ['exec', '-i', 'supabase_db_ci0926-int', 'psql', '-X', '-U', 'supabase_admin', '-d', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1'],
    { input: prefix + query + '\nrollback;', encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 300000 })
    .split('\n').filter(s => s.startsWith('{')).map(s => JSON.parse(s));
}
const broad = "'completed_date','2023-01-01','2026-10-01',false,'all',null,null,null,null";
const scopes = [
  ['all', "'2023-01-01','2026-10-01'", "'all',null,null,null,null"],
  ['month', "'2023-04-01','2023-04-30'", "'all',null,null,null,null"],
  ['agency', "'2023-01-01','2026-10-01'", "'all',null,'agency-1',null,null"],
  ['manager', "'2023-01-01','2026-10-01'", "'all',null,'agency-1','manager-1',null"],
  ['bbox', "'2023-01-01','2026-10-01'", "'all',null,null,null,array[127.1,37.1,127.3,37.3]::double precision[]"],
  ['category-region', "'2023-01-01','2026-10-01'", "'traffic','서울 중구',null,null,null"],
  ['empty', "'2040-01-01','2040-01-31'", "'all',null,null,null,null"],
];
const compare = (label: string, args = broad) => `select jsonb_build_object('case','${label}','equal',pg_temp.cohort_before(${args})=public.internal_analytics_cohort_facts(${args}));`;

describe.skipIf(process.env.COMMUNITY_STACK !== '1')('cohort timeout: exact ordered JSON and unchanged boundaries', () => {
  it('matches frozen original arrays, fields and nulls across both bases, previous windows and filters, including cached generic plans', () => {
    const cases = scopes.flatMap(([name, dates, filters]) => ['report_date','completed_date'].flatMap(basis => [false,true].map(previous =>
      compare(`${name}/${basis}/${previous}`, `'${basis}',${dates},${previous},${filters}`)))).join('\n');
    const rows = sql(cases + 'set plan_cache_mode=force_generic_plan;' + cases);
    expect(rows).toHaveLength(56);
    for (const r of rows) expect(r.equal, r.case).toBe(true);
  }, 120000);

  it('preserves D13, number fallback, shared payload recency, duplicate devices and exact election ties', () => {
    const rows = sql(`
      update private.community_report_facts set report_date='2025-05-01',report_number=null,
        completed_date=case when source_report_id='synthetic-9' then date '2025-08-01' else date '2025-09-01' end
        where source_report_id in ('synthetic-9','synthetic-10');
      update private.community_report_facts set report_number='SPP-2025-00000009' where source_report_id='synthetic-10';
      update private.community_report_facts set payload_sha256=repeat('c',64) where source_report_id in ('synthetic-19','synthetic-20');
      insert into private.community_report_facts select (jsonb_populate_record(null::private.community_report_facts,
        to_jsonb(f)||jsonb_build_object('dataset_key',repeat('b',64)))).* from private.community_report_facts f
        where source_report_id in ('synthetic-11','synthetic-12');
      ${compare('duplicates and ties')}
      ${compare('august cannot revive old answer', "'completed_date','2025-08-01','2025-08-31',false,'all',null,null,null,null")}
      ${compare('may contains September answer', "'report_date','2025-05-01','2025-05-31',false,'all',null,null,null,null")}
      select jsonb_build_object('august_n',jsonb_array_length(public.internal_analytics_cohort_facts('completed_date','2025-08-01','2025-08-31',false,'all',null,null,null,null)),
        'may_n',jsonb_array_length(public.internal_analytics_cohort_facts('report_date','2025-05-01','2025-05-31',false,'all',null,null,null,null)));
    `);
    for (const r of rows.slice(0,3)) expect(r.equal, r.case).toBe(true);
    expect(rows[3]).toEqual({ august_n:0, may_n:2 });
  }, 120000);

  it('retains disclosure and active-lineage semantics through withdrawal, reconsent, suspension, missing grants and deletion', () => {
    const steps = [
      '',
      "update private.community_consent_grants set revoked_at=now() where user_id=(select id from cohort_users where idx=1);",
      "update private.community_consent_grants set revoked_at=null where grant_id=(select grant_id from cohort_users where idx=1);",
      "update private.contributor_profiles set status='suspended' where user_id=(select id from cohort_users where idx=2);",
      "update private.contributor_profiles set status='active' where user_id=(select id from cohort_users where idx=2);",
      // A different user in the same lineage cannot make an inactive original grant eligible.
      "update private.community_consent_grants set lineage_id=(select lineage from cohort_users where idx=28) where user_id=(select id from cohort_users where idx=29);",
      // Disclosure is historically lineage-only, even if another active user holds the newer policy.
      "update private.community_consent_grants set lineage_id=(select lineage from cohort_users where idx=4) where user_id=(select id from cohort_users where idx=3);",
      "update private.community_report_facts set consent_grant_id='00000000-0000-0000-0000-000000000000' where source_report_id='synthetic-1';",
      "delete from private.community_report_facts where contributor_id=(select id from cohort_users where idx=4);",
    ];
    const rows=sql(steps.map((step,i) => step + compare(`transition-${i}`)).join('\n'));
    expect(rows).toHaveLength(steps.length);
    for (const r of rows) expect(r.equal,r.case).toBe(true);
  }, 120000);

  it('keeps personal source authentication/state and RPC settings/privileges unchanged', () => {
    const rows=sql(`set enable_nestloop=on;
      select jsonb_build_object('equal',pg_temp.personal_before(u.id,u.session_id,${broad})=public.internal_my_analytics_cohort_source(u.id,u.session_id,${broad}),
        'valid',(public.internal_my_analytics_cohort_source(u.id,u.session_id,${broad})->'viewer'->>'session')::boolean) from cohort_users u where idx=1;
      select jsonb_build_object('equal',pg_temp.personal_before(u.id,'00000000-0000-0000-0000-000000000000',${broad})=public.internal_my_analytics_cohort_source(u.id,'00000000-0000-0000-0000-000000000000',${broad}),
        'facts',public.internal_my_analytics_cohort_source(u.id,'00000000-0000-0000-0000-000000000000',${broad})->'facts') from cohort_users u where idx=1;
      select jsonb_build_object('nestloop_restored',current_setting('enable_nestloop')='on',
        'stable',p.provolatile='s','definer',p.prosecdef,'search_path',p.proconfig @> array['search_path=""'],
        'anon',has_function_privilege('anon',p.oid,'execute'),'authenticated',has_function_privilege('authenticated',p.oid,'execute'),
        'service',has_function_privilege('service_role',p.oid,'execute')) from pg_proc p
        where p.oid='public.internal_analytics_cohort_facts(text,date,date,boolean,text,text,text,text,double precision[])'::regprocedure;
    `);
    expect(rows).toEqual([{equal:true,valid:true},{equal:true,facts:[]},
      {nestloop_restored:true,stable:true,definer:true,search_path:true,anon:false,authenticated:false,service:true}]);
  }, 120000);

  it('keeps validation errors and the whole-history 100000-row budget, including the region-filter asymmetry', () => {
    const outcome = `create function pg_temp.outcome(before boolean, args jsonb) returns text language plpgsql as $$
      begin
        if before then return jsonb_array_length(pg_temp.cohort_before(args->>0,(args->>1)::date,(args->>2)::date,(args->>3)::boolean,args->>4,args->>5,args->>6,null,null))::text;
        else return jsonb_array_length(public.internal_analytics_cohort_facts(args->>0,(args->>1)::date,(args->>2)::date,(args->>3)::boolean,args->>4,args->>5,args->>6,null,null))::text;end if;
      exception when others then return sqlerrm;end;$$;`;
    const check = (label:string,args:unknown[]) => `select jsonb_build_object('case','${label}','before',pg_temp.outcome(true,'${JSON.stringify(args)}'), 'after',pg_temp.outcome(false,'${JSON.stringify(args)}'));`;
    const args:unknown[]=['completed_date','2023-01-01','2026-10-01',false,'all',null,null];
    const invalid=[['basis',0,'published_date'],['null-basis',0,null],['null-previous',3,null],['null-start',1,null],['reversed',2,'2020-01-01'],['category',4,'bad']] as const;
    const rows=sql(outcome+invalid.map(([label,idx,value])=>{const a=[...args];a[idx]=value;return check(label,a);}).join('\n')+`
      alter table private.community_report_facts disable trigger user;
      delete from private.community_report_facts;
      insert into private.community_report_facts(contributor_id,dataset_key,source_report_key,source_report_id,latest_receipt_id,
        consent_grant_id,writer_epoch,source_revision,payload_sha256,public_state,category,status,disposition,amount_kind,coord_source,report_date,completed_date,agency_key)
      select u.id,md5(g::text)||md5(g::text),repeat('e',64),'bulk',gen_random_uuid(),u.grant_id,1,1,repeat('f',64),
        'completed','parking','accepted','none','unknown','none','2023-01-01',case when g=1 then date '2026-10-01' else date '2023-01-01' end,'bulk-agency'
      from cohort_users u cross join generate_series(1,100000) g where u.idx=1;
      alter table private.community_report_facts enable trigger user;
      analyze private.community_report_facts;
      ${check('exact-limit-region-empty',[...args.slice(0,5),'no-region',null])}
      insert into private.community_report_facts select (jsonb_populate_record(null::private.community_report_facts,
        to_jsonb(f)||jsonb_build_object('dataset_key',repeat('d',64)))).* from private.community_report_facts f limit 1;
      ${check('over-limit-region-empty',[...args.slice(0,5),'no-region',null])}
      ${check('over-limit-whole-history',['completed_date','2026-10-01','2026-10-01',false,'all',null,null])}
      ${check('over-limit-narrow-agency',[...args.slice(0,6),'no-agency'])}
    `);
    expect(rows).toHaveLength(10);
    for (const r of rows) expect(r.after,r.case).toEqual(r.before);
    for (const r of rows.slice(0,6)) expect(r.after,r.case).toBe('INVALID_QUERY');
    expect(rows.slice(6).map(r=>r.after)).toEqual(['0','RESULT_TOO_LARGE','RESULT_TOO_LARGE','0']);
  }, 300000);
});
