// Local synthetic 500 NULL-number own keys. Compare live eligibility before/after a partial lookup index.
import { describe,it,expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync,writeFileSync,readFileSync } from 'node:fs';
import { createUser,deleteUsers,insertFacts,serviceClient,stackKeys,type TestUser } from './helpers/myReportsSeed';
describe.skipIf(process.env.COMMUNITY_STACK!=='1'||process.env.VIEWER_MEASURE!=='1')('viewer lookup measurement',()=>{
 it('same live gate over 500 owned keys with nested plans and 30 samples',async()=>{
  const users:TestUser[]=[];const out=process.env.VIEWER_MEASURE_OUT??'docs/refactoring/map-performance/evidence/viewer-lookup';mkdirSync(out,{recursive:true});
  try{
   const keys=stackKeys(),svc=serviceClient(keys);users.push(await createUser(svc,keys.ANON_KEY,'lookup-500'));
   const u=users[0];insertFacts(Array.from({length:500},(_,i)=>({user:u,dataset:'pc',key:`lookup-${i}`,sourceId:'9100000001',completedDate:'2042-09-30'})));
   const call=`public.internal_analytics_viewer('${u.id}','${u.session}')`;
   const measure=(variant:string)=>Array.from({length:30},()=>`with s as materialized(select clock_timestamp() at),r as materialized(select ${call} body,at from s) select jsonb_build_object('variant','${variant}','ms',extract(epoch from clock_timestamp()-at)*1000,'body',body) from r;`).join('\n');
   const explain=`set auto_explain.log_min_duration=0;select ${call};set auto_explain.log_min_duration=-1;`;
   const index=`create index community_report_facts_number_lookup on private.community_report_facts(source_report_key,first_accepted_at,contributor_id) where public_state='completed' and report_number is not null;`;
   const materialized=readFileSync('supabase/migrations/202610040800_viewer_lookup_plan.sql','utf8').replace(/^begin;\s*$/gm,'').replace(/^commit;\s*$/gm,'').replace(/create index community_report_facts_number_lookup[\s\S]*?;/,'');
   // The current schema already owns this index. Reconstruct the named without-index fixture inside rollback.
   const script=`begin;drop index if exists private.community_report_facts_number_lookup;set statement_timeout='20s';load 'auto_explain';set client_min_messages=log;set auto_explain.log_nested_statements=on;set auto_explain.log_analyze=on;set auto_explain.log_buffers=on;set auto_explain.log_parameter_max_length=0;${explain}${measure('without-index')}${index}${explain}${measure('with-index')}${materialized}${explain}${measure('materialized-index')}rollback;`;
   const r=spawnSync('docker',['exec','-i','supabase_db_ci0926-int','psql','-U','supabase_admin','-d','postgres','-tAq','-v','ON_ERROR_STOP=1'],{input:script,encoding:'utf8',maxBuffer:64*1024*1024});
   writeFileSync(`${out}/plans.txt`,r.stderr??'');expect(r.status,r.stderr).toBe(0);
   const rows=r.stdout.split('\n').filter(x=>x.startsWith('{')).map(x=>JSON.parse(x)).filter(x=>x.variant);
   writeFileSync(`${out}/measurements.json`,JSON.stringify({mode:'local SQL gate, actual session, synthetic 500 NULL-number keys; index rolls back',rows},null,2));
   expect(rows).toHaveLength(90);for(const row of rows)expect(row.body).toEqual(rows[0].body);expect(rows[0].body.public_fact_count).toBe(500);
  }finally{deleteUsers(users);}
 },240000);
});
