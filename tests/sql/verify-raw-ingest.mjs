// Synthetic PostgreSQL execution with fixture identity/session dependencies. No network or Docker.
// The real composed-stack counterpart (locks, triggers, worker, concurrency) is tests/integration/raw-ingest-stack.test.ts.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const db=new PGlite();
const sql=readFileSync('supabase/migrations/202610210100_raw_json_ingest.sql','utf8');
const old=readFileSync('supabase/migrations/202610121201_fine_estimate_ingest_aggregate.sql','utf8').split('\ncreate or replace function private.analytics_cohort_payload')[0];
const facts=readFileSync('supabase/migrations/202609260200_community_ingest.sql','utf8').match(/create table private.community_report_facts \([\s\S]*?\n\);/)[0];
const events=readFileSync('supabase/migrations/202609260200_community_ingest.sql','utf8').match(/create table private.community_ingest_events \([\s\S]*?\n\);/)[0];
await db.exec(`create schema private;create schema extensions;create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;create role service_role;
 create table private.contributor_profiles(user_id uuid primary key,status text);
 create table private.community_policies(version text,consent_text_sha256 text);
 create table private.community_policy_current(singleton boolean primary key,version text);
 create table private.community_consent_grants(grant_id uuid primary key,user_id uuid,lineage_id uuid,policy_version text,revoked_at timestamptz,revoke_reason text,consent_text_sha256 text default 'hash');
 create table private.community_connections(connection_id uuid primary key,user_id uuid,dataset_key text,writer_epoch bigint,last_accepted_revision bigint default 0,status text,bound_session_id uuid,source_app text,source_mode text);
 create table private.community_deletion_fences(contributor_id uuid primary key,fenced_at timestamptz);
 create table private.community_dataset_deletion_fences(contributor_id uuid,dataset_key text,fenced_at timestamptz);
 create table private.community_fact_tombstones(contributor_id uuid,source_report_key text);
 create table private.community_dataset_fact_tombstones(contributor_id uuid,dataset_key text,source_report_key text);
 create table private.community_official_account_bindings(user_id uuid,dataset_key text);
 create table private.community_report_ownership_audit(receipt_id uuid,request_id text,user_id uuid,dataset_key text,source_report_key text,report_number text);
 create table private.analytics_state(singleton boolean,ready boolean,generated_at timestamptz,dataset_version text);
 insert into private.analytics_state values(true,true,now(),'fixture');
 create function extensions.digest(text,text) returns bytea language sql as $$ select decode(repeat('a',64),'hex') $$;
 ${events}
 ${facts}
 alter table private.community_report_facts add column report_number text,add column agency_current_name text,add column source_agency_code text,add column violation_law text,add column rating integer,
 add column fine_estimate_won bigint,add column fine_estimate_rule text,add column fine_estimate_rule_version text,add column answer_accepted_at timestamptz default now();
 alter table private.community_ingest_events add column report_number text,add column rejection_reason text;
 create function private.community_current_policy(boolean) returns private.community_policies language sql as $$ select p.* from private.community_policies p join private.community_policy_current c using(version) $$;
 create function private.community_grant_is_current(g private.community_consent_grants,p private.community_policies) returns boolean language sql as $$ select g.grant_id is not null and g.policy_version=p.version and g.revoked_at is null $$;
 create function private.community_lineage_active(id uuid) returns boolean language sql as $$select exists(select 1 from private.community_consent_grants g join private.community_consent_grants a using(lineage_id) where g.grant_id=id and a.revoked_at is null)$$;
 create function private.community_identity_state(uuid,uuid) returns jsonb language sql as $$select '{"user_ok":true,"kakao":true,"session":true}'::jsonb$$;
 create function private.community_fact_publicly_listed(f private.community_report_facts) returns boolean language sql as $$select f.public_state='completed' and private.community_lineage_active(f.consent_grant_id)$$;
`);
await db.exec(old.slice(old.indexOf('create or replace function public.internal_community_ingest')).replace('public.internal_community_ingest(', 'public.baseline_ingest('));
await db.exec(sql);
const q=async(text,params=[])=> (await db.query(text,params)).rows;
const one=async(text,params=[])=> (await q(text,params))[0];
const u='11111111-1111-4111-8111-111111111111',c='22222222-2222-4222-8222-222222222222',g='33333333-3333-4333-8333-333333333333';
const dataset='d'.repeat(64),key='a'.repeat(64), hash='b'.repeat(64);
await q('insert into auth.users values($1)',[u]);
await q("insert into private.contributor_profiles values($1,'active')",[u]);
await q("insert into private.community_policies values('2026-10-21.1','hash')");
await q("insert into private.community_policy_current values(true,'2026-10-21.1')");
await q("insert into private.community_consent_grants values($1,$2,$1,'2026-10-21.1',null,null)",[g,u]);
await q("insert into private.community_connections values($1,$2,$3,1,0,'active',$2,'safetyreport','server',null,null,null,null)",[c,u,dataset]);
await q('insert into private.community_official_account_bindings values($1,$2)',[u,dataset]);
const envelope={connection_id:c,consent_grant_id:g,source_app:'safetyreport',source_mode:'server',trigger:'manual',client_version:'3.5.1',parser_version:'pc-parser-13'};
const event={event_id:'44444444-4444-4444-8444-444444444444',source_report_key:key,source_report_id:'SYNTHETIC01',report_number:null,source_revision:1,writer_epoch:1,captured_at:'2026-10-21T00:00:00Z',event_type:'completed_observation',payload_sha256:hash,
 payload:{status:'accepted',source_agency_code:null,rating:4},derived:{public_state:'completed',status:'accepted',category:'traffic',disposition:'none',amount_kind:'unknown',report_date:'2026-10-20',completed_date:'2026-10-21',coord_source:'none',rating:4}};
const call=async(name,ev=event,env=envelope)=> (await one(`select public.${name}($1,$2,'fixture-request',$3,$4) as result`,[u,u,env,[ev]])).result;
const fact=async()=> (await q('select to_jsonb(f)-ARRAY[\'latest_receipt_id\',\'first_accepted_at\',\'answer_accepted_at\',\'updated_at\',\'fact_source\',\'fact_parser_version\',\'raw_sha256\'] as f from private.community_report_facts f')).map(r=>r.f);

// v1 parity with the pre-migration function (same fact columns, same result) and the transport columns in the same statement.
await db.exec('begin;savepoint before_v1');
const baseline=await call('baseline_ingest'),before=await fact();
await db.exec('rollback to savepoint before_v1');
const current=await call('internal_community_ingest'),after=await fact();
assert.deepEqual(after,before,'v1 SQL extracted fact assignments equal baseline');
assert.equal(current.results[0].status,baseline.results[0].status);
await db.exec('commit');
assert.deepEqual(await one('select fact_source,fact_parser_version,raw_sha256 from private.community_report_facts'),{fact_source:'dto',fact_parser_version:'pc-parser-13',raw_sha256:null});
assert.equal((await one('select last_contract from private.community_connections')).last_contract,'community-ingest-v1');
const fn=(await one("select prosrc from pg_proc where proname='project_raw_fact'")).prosrc;
assert.equal((fn.match(/update private\.community_report_facts/g)||[]).length,2,'M3: no extra fact UPDATE statement');

// M4: purge is a bounded batch function (pg_cron schedules it); v1 duplicate ACK survives.
await db.exec("update private.community_ingest_events set received_at=now()-interval '31 days'");
assert.equal(Number((await one('select private.prune_community_ingest_payloads(1) as n')).n),1);
assert.equal((await one('select count(*)::int as n from private.community_ingest_events where payload is not null')).n,0);
assert.equal((await call('internal_community_ingest')).results[0].status,'duplicate','v1 idempotency after payload pruning');

// L1 / notice: v2 off by default, notice NULL by default, missing config fails closed.
assert.equal((await one('select client_notice from private.community_ingest_config')).client_notice,null);
const raw={...event,event_id:'55555555-5555-4555-8555-555555555555',raw:{body:'{"result":{}}',sha256:hash,size:13,fetched_at:'2026-10-21T00:00:00Z',source:'raw_backfill'},supplement:{},supplement_sha256:hash,client_parser_version:'pc-parser-13'};
assert.equal((await call('internal_community_ingest_v2',raw)).error,'service_unavailable');
await db.exec('begin;delete from private.community_ingest_config');
assert.equal((await call('internal_community_ingest_v2',raw)).error,'service_unavailable');
assert.deepEqual((await one('select public.internal_community_ingest_capabilities() as c')).c.contracts,[1]);
await db.exec('rollback');
const notice={level:'info',message:'업데이트 안내',min_version:{pc:'3.6.0',mobile:null},url:{pc:'https://example.invalid/pc',mobile:null},deadline:null};
await q('update private.community_ingest_config set client_notice=$1',[notice]);
for(const bad of [{...notice,level:'urgent'},{...notice,message:''},{...notice,message:'x'.repeat(1001)},{...notice,extra:1},{...notice,url:{pc:'javascript:alert(1)',mobile:null}},{...notice,deadline:'tomorrow'},{level:'info'}]) {
 await assert.rejects(q('update private.community_ingest_config set client_notice=$1',[bad]),/community_ingest_config_notice_shape/);
}
await q("update private.community_ingest_config set client_notice=null,v2_enabled=true");

// M1: (date, N) comparison, not lexical; current grant still required.
for(const [v,m,ok] of [['2026-10-21.1','2026-10-21.1',true],['2026-10-21.10','2026-10-21.9',true],['2026-10-21.9','2026-10-21.10',false],['2026-11-01.1','2026-10-21.2',true],['2026-10-20.5','2026-10-21.1',false],['x','2026-10-21.1',false]])
 assert.equal((await one('select private.community_policy_version_at_least($1,$2) as r',[v,m])).r,ok,`${v}>=${m}`);
await q("update private.community_ingest_config set raw_policy_version='2026-10-21.2'");
assert.equal((await call('internal_community_ingest_v2',raw)).error,'consent_outdated');
await q("update private.community_ingest_config set raw_policy_version='2026-10-20.9'");

// v2 stores, queues and dedupes; v2 ledger keeps no payload.
assert.equal((await call('internal_community_ingest_v2',raw)).results[0].status,'stored');
assert.equal((await one('select count(*)::int as n from private.community_parse_queue')).n,1);
assert.equal((await call('internal_community_ingest_v2',raw)).results[0].status,'duplicate');
assert.equal((await one("select payload from private.community_ingest_events where contract='community-ingest-v2'")).payload,null);
assert.equal((await one('select last_contract from private.community_connections')).last_contract,'community-ingest-v2');

// H1: claim sets a lease and commits; finish requires that lease. Same tuple raw beats DTO.
const [job]=await q('select * from private.claim_raw_parse_jobs(10,300)');
assert.equal(job.attempts,1);
assert.equal((await q('select * from private.claim_raw_parse_jobs(10,300)')).length,0,'leased jobs are not claimed twice');
const parsed={report_content:'PRIVATE',processing_content:'ANSWER',rating:4,violation_latitude:37.5};
const finish=(lease,sha=hash,parser='pc-parser-13+map1+regX')=>one('select private.finish_raw_parse($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) as r',[u,dataset,key,lease,sha,hash,parser,event.payload,hash,event.derived,parsed,{}]);
assert.equal((await finish('99999999-9999-4999-8999-999999999999')).r,'lease_lost');
const firstAnswer=(await one('select answer_accepted_at from private.community_report_facts')).answer_accepted_at;
assert.equal((await finish(job.lease_token)).r,'no_change');
assert.equal((await one('select fact_source from private.community_report_facts')).fact_source,'raw');
assert.deepEqual(await one('select report_content,processing_content,rating,violation_latitude from private.community_report_parsed'),parsed);
assert.equal((await one('select count(*)::int as n from private.community_parse_queue')).n,0);
assert.deepEqual((await one('select differences from private.community_parse_diffs')).differences,null,'W-L4: no observation -> NULL diff');
// L7: reparse of the same bytes/revision with a different DTO hash is not a new answer.
await q("select private.enqueue_raw_reparse('pc-parser-14+map1+regX',10)");
const [re]=await q('select * from private.claim_raw_parse_jobs(10,300)');
await one('select private.finish_raw_parse($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) as r',[u,dataset,key,re.lease_token,hash,hash,'pc-parser-14+map1+regX',{...event.payload,rating:5},'c'.repeat(64),{...event.derived,rating:5},parsed,null]);
const reparsed=await one('select answer_accepted_at,rating,fact_parser_version from private.community_report_facts');
assert.equal(reparsed.rating,5);assert.equal(reparsed.fact_parser_version,'pc-parser-14+map1+regX');
assert.deepEqual(reparsed.answer_accepted_at,firstAnswer,'L7: answer_accepted_at unchanged on reparse');

// L5: permanent failures become dead after 8 attempts; same bytes stay no_change, new bytes revive.
await q("update private.community_report_raw set parse_state='parsed'");
await q("insert into private.community_parse_queue(contributor_id,dataset_key,source_report_key,attempts) values($1,$2,$3,7)",[u,dataset,key]);
let [bad]=await q('select * from private.claim_raw_parse_jobs(10,300)');
assert.equal((await one('select private.fail_raw_parse($1,$2,$3,$4,$5,$6,$7) as r',[u,dataset,key,bad.lease_token,hash,'pc-parser-14+map1+regX','ValueError'])).r,'dead');
assert.equal((await one('select parse_state from private.community_report_raw')).parse_state,'dead');
assert.equal((await one('select count(*)::int as n from private.community_parse_queue')).n,0);
assert.equal((await call('internal_community_ingest_v2',{...raw,event_id:'88888888-8888-4888-8888-888888888888'})).results[0].status,'no_change');
const raw2={...raw,event_id:'89999999-8888-4888-8888-888888888888',report_number:null,raw:{...raw.raw,sha256:'e'.repeat(64)}};
await q("update private.community_report_raw set report_number='SPP-1'");
assert.equal((await call('internal_community_ingest_v2',raw2)).results[0].status,'stored');
assert.deepEqual(await one('select parse_state,report_number from private.community_report_raw'),{parse_state:'pending',report_number:'SPP-1'},'L3 keeps report_number');
[bad]=await q('select * from private.claim_raw_parse_jobs(10,300)');
assert.equal((await one('select private.fail_raw_parse($1,$2,$3,$4,$5,$6,$7) as r',[u,dataset,key,bad.lease_token,'e'.repeat(64),'p','ValueError'])).r,'retry');
assert.equal((await one('select lease_token from private.community_parse_queue')).lease_token,null);

// Newer DTO wins later.
const newer={...event,event_id:'66666666-6666-4666-8666-666666666666',source_revision:2};
await call('internal_community_ingest',newer);
assert.equal((await one('select fact_source from private.community_report_facts')).fact_source,'dto');

// L2: a v1 upload of a report reserved by another dataset's raw row is audited.
const other='f'.repeat(64),c2='12121212-1212-4212-8212-121212121212';
await q("insert into private.community_connections values($1,$2,$3,1,0,'active',$2,'safetyreport','server',null,null,null,null)",[c2,u,other]);
await q('insert into private.community_official_account_bindings values($1,$2)',[u,other]);
const elsewhere=await call('internal_community_ingest',{...event,event_id:'13131313-1313-4313-8313-131313131313',source_report_key:key,report_number:'SPP-1'},{...envelope,connection_id:c2});
assert.equal(elsewhere.results[0].error.code,'report_owned_elsewhere');
assert.equal((await one('select count(*)::int as n from private.community_report_ownership_audit where dataset_key=$1',[other])).n,1);

// Map client state: no identifiers, consent classification.
let state=(await one('select public.internal_map_client_state($1) as s',[u])).s;
assert.deepEqual(Object.keys(state).sort(),['consent','last_contract','notice','v1_connections','v2_enabled']);
assert.equal(state.consent,'active');assert.equal(state.v1_connections,2);assert.equal(state.v2_enabled,true);
assert.ok(!JSON.stringify(state).includes(dataset)&&!JSON.stringify(state).includes(g));

// M5: policy supersession keeps raw and projects under the lineage's active grant on reparse.
const nextGrant='77777777-7777-4777-8777-777777777777';
await q("update private.community_consent_grants set revoked_at=now(),revoke_reason='superseded_policy' where grant_id=$1",[g]);
await q("insert into private.community_consent_grants values($1,$2,$3,'2026-10-21.1',null,null)",[nextGrant,u,g]);
assert.equal((await one('select count(*)::int as n from private.community_report_raw')).n,1,'policy supersession is not withdrawal');
await q("update private.community_parse_queue set next_attempt_at=now()");await q("update private.community_report_raw set source_revision=3"); // newer than the rev-2 DTO
const [sup]=await q('select * from private.claim_raw_parse_jobs(10,300)');
await one('select private.finish_raw_parse($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) as r',[u,dataset,key,sup.lease_token,'e'.repeat(64),hash,'pc-parser-14+map1+regX',event.payload,hash,event.derived,parsed,null]);
assert.equal((await one('select consent_grant_id from private.community_report_facts where dataset_key=$1',[dataset])).consent_grant_id,nextGrant,'M5: projected under the active grant');
await q("update private.community_policy_current set version='2026-11-01.1'");await q("insert into private.community_policies values('2026-11-01.1','hash')");
assert.equal((await one('select public.internal_map_client_state($1) as s',[u])).s.consent,'outdated');
await q("update private.community_policy_current set version='2026-10-21.1'");

// M6: tombstones purge raw per statement.
await q('insert into private.community_fact_tombstones values($1,$2)',[u,key]);
assert.equal((await one('select count(*)::int as n from private.community_report_raw')).n,0);

// Worker role and client roles: least privilege.
for(const role of ['anon','authenticated','service_role']) for(const table of ['community_report_raw','community_report_parsed','community_parse_diffs','community_parse_queue']) {
 assert.equal((await one("select has_table_privilege($1,$2,'SELECT') as yes",[role,'private.'+table])).yes,false);
}
for(const table of ['community_report_raw','community_report_parsed','community_parse_diffs','community_parse_queue'])
 for(const priv of ['INSERT','UPDATE','DELETE']) assert.equal((await one('select has_table_privilege($1,$2,$3) as yes',['community_parser','private.'+table,priv])).yes,false,`${table} ${priv}`);
for(const role of ['anon','authenticated','service_role']) for(const f of ['private.finish_raw_parse(uuid,text,text,uuid,text,text,text,jsonb,text,jsonb,jsonb,jsonb)','private.claim_raw_parse_jobs(integer,integer)','private.prune_community_ingest_payloads(integer,interval)'])
 assert.equal((await one("select has_function_privilege($1,$2,'EXECUTE') as yes",[role,f])).yes,false);
for(const role of ['anon','authenticated','community_parser']) assert.equal((await one("select has_function_privilege($1,'public.internal_map_client_state(uuid)','EXECUTE') as yes",[role])).yes,false);
assert.equal((await one("select has_function_privilege('community_parser','private.prune_community_ingest_payloads(integer,interval)','EXECUTE') as yes")).yes,false,'M4: purge is not the worker\'s job');

// User withdrawal deletes raw and cascades.
await q("insert into private.community_report_raw select $1,$2,$3,'S',null,$4,receipt_id,'completed_observation',now(),'{}',$5,2,now(),'x','{}',$5,null,null,'p',1,9 from private.community_ingest_events limit 1",[u,dataset,'9'.repeat(64),nextGrant,hash]);
await q("insert into private.community_parse_queue(contributor_id,dataset_key,source_report_key) values($1,$2,$3)",[u,dataset,'9'.repeat(64)]);
await q("update private.community_consent_grants set revoked_at=now(),revoke_reason='user' where grant_id=$1",[nextGrant]);
assert.equal((await one('select count(*)::int as n from private.community_report_raw')).n,0);
assert.equal((await one('select count(*)::int as n from private.community_parse_queue')).n,0);
assert.equal((await one('select public.internal_map_client_state($1) as s',[u])).s.consent,'revoked');
console.log('PASS: v1 SQL parity + single-statement transport columns, cron-style purge keeps duplicate ACK, fail-closed config/notice CHECK, policy (date,N) compare, lease claim/finish, L3/L5/L7, M5 active grant, M6 tombstones, map client state, least privilege, revoke cascade (synthetic PGlite)');
await db.close();
