// Shares the existing rollback-only 500k seed. GLOBAL keys are user-qualified: exactly 500k public representatives.
// Direct SQL diagnosis, not HTTP/OAuth or hosted performance. Raw transport is the actual old bounded cohort RPC.
import { describe,it,expect } from 'vitest';
import { mkdirSync,writeFileSync,readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { rankingMeasureSeed } from './helpers/rankingMeasureSeed';
import { DB_CONTAINER } from './helpers/myReportsSeed';
const enabled=process.env.COMMUNITY_STACK==='1'&&process.env.ROLLUP_PERF==='1';
describe.skipIf(!enabled)('large native rollup SQL measurements',()=>{
 it('keeps 500k representatives, captures bounded old failure and new aggregate timings/bytes/EXPLAIN',()=>{
  const out=process.env.ROLLUP_PERF_OUT??'docs/refactoring/map-performance/evidence/rollup-large';mkdirSync(out,{recursive:true});
  const repeats=Number(process.env.ROLLUP_PERF_REPEATS??10);
  const diagnosticTimeout=Number(process.env.ROLLUP_DIAGNOSTIC_TIMEOUT_SECONDS??30);
  if(!Number.isInteger(diagnosticTimeout)||diagnosticTimeout<1||diagnosticTimeout>180)throw new Error('invalid diagnostic timeout');
  const scope={start:'2040-09-01',end:'2040-09-30',date_basis:'completed_date',category:'all',region_code:null,agency_key:null,manager_key:null,bbox:null,law:null};
  const source=`public.internal_analytics_cohort_facts('completed_date','2040-09-01','2040-09-30',false,'all',null,null,null,null)`;
  const call=(kind:string)=>`public.internal_analytics_rollup('${JSON.stringify(scope)}'::jsonb,'${kind}',jsonb_build_object('page',1,'page_size',100,'q','','sort',jsonb_build_object('column','completed','value','count','dir','desc'),'agency_type',null,'expected_version',(select dataset_version from private.analytics_state where singleton)))`;
  const sample=(label:string,expression:string)=>`with started as materialized(select clock_timestamp() at),result as materialized(select ${expression} body, at from started)
   select jsonb_build_object('label','${label}','ms',extract(epoch from clock_timestamp()-at)*1000,'bytes',octet_length(body::text),'total_rows',body->'total_rows','n',case when '${label}' like '%series%' then body->'items'->0->'report_count' else body->'items'->0->'completed_count' end) from result;`;
  const sourcePlan=readFileSync('supabase/migrations/202610040600_rollup_scope_plan.sql','utf8').split('$plan$')[1].replace(/\$1/g,"'"+JSON.stringify(scope)+"'::jsonb");
  let script=rankingMeasureSeed(500000,true)+`explain (format json) ${sourcePlan};analyze private.contributor_profiles;analyze private.community_consent_grants;${process.env.ROLLUP_HASH_PLAN==='1'?"alter function private.analytics_rollup_source(jsonb) set enable_nestloop=off;":''}explain (format json) ${sourcePlan};`+`set statement_timeout='${diagnosticTimeout}s';set application_name='analytics-rollup-measure';
   create temporary table raw_attempt(status text,ms double precision);
   do $measure$ declare started timestamptz:=clock_timestamp();begin perform ${source};insert into raw_attempt values('200',extract(epoch from clock_timestamp()-started)*1000);
    exception when others then insert into raw_attempt values(case when sqlerrm like '%RESULT_TOO_LARGE%' then '422_RESULT_TOO_LARGE' else SQLSTATE end,extract(epoch from clock_timestamp()-started)*1000);end;$measure$;
   select jsonb_build_object('label','before-bounded-raw','status',status,'ms',ms) from raw_attempt;
   set client_min_messages=log;load 'auto_explain';set auto_explain.log_min_duration=50;set auto_explain.log_analyze=on;set auto_explain.log_buffers=on;set auto_explain.log_nested_statements=on;set auto_explain.log_parameter_max_length=0;
  `;
  for(const kind of ['manager','laws','series']){
   for(let i=0;i<repeats;i++)script+=sample(`after-${kind}-${i+1}`,call(kind))+`set auto_explain.log_min_duration=-1;`;
   script+=`set auto_explain.log_min_duration=50;`;
  }
  script+='rollback;';
  const execution=spawnSync('docker',['exec','-i',DB_CONTAINER,'psql','-U','supabase_admin','-d','postgres','-tAq','-v','ON_ERROR_STOP=1'],{input:script,encoding:'utf8',maxBuffer:128*1024*1024,stdio:['pipe','pipe','pipe'],timeout:1800000});
  writeFileSync(`${out}/plans.txt`,execution.stderr??'');
  writeFileSync(`${out}/partial-output.jsonl`,execution.stdout??'');
  expect(execution.status,execution.stderr?.slice(-1500)).toBe(0);
  const samples=(execution.stdout??'').trim().split('\n').filter(x=>x.startsWith('{')).map(x=>JSON.parse(x));
  writeFileSync(`${out}/measurements.json`,JSON.stringify({mode:'direct local PostgreSQL, service RPC; synthetic; rollback; no HTTP/rate or production claims',seed:'refactor-rank-deterministic-v1/global-user-qualified-keys',unique_public_reports:500000,observations:600000,repeats,diagnostic_timeout_seconds:diagnosticTimeout,production_function_timeout_unchanged:true,hash_plan_candidate:process.env.ROLLUP_HASH_PLAN==='1',candidate_migration:'202610040600_rollup_scope_plan.sql',samples},null,2));
  expect(samples[0].status).toBe('422_RESULT_TOO_LARGE');
  expect(samples).toHaveLength(1+3*repeats);
  for(const sample of samples.slice(1)){
   expect(sample.n,sample.label).toBe(sample.label.includes('manager')?1000:sample.label.includes('laws')?50000:500000);
   expect(sample.total_rows).toBe(sample.label.includes('manager')?500:sample.label.includes('laws')?10:1);
  }
 },1800000);
});
