"""Local-only, rollback-isolated query audit. No remote DSN accepted.
All latency rows are server time; plans run separately from timed samples.
"""
import argparse, json, pathlib, subprocess, hashlib
from catalog import ROOT, DB, pending, strip_tx
OUT=ROOT/'docs/implementation/query-audit-20261006/evidence'
AUTH=pathlib.Path('/home/better0101/projects/worktree/auth-perf')
def lit(s):return "'"+str(s).replace("'","''")+"'"
U="(select id from cohort_users where idx=1)"
S="(select session_id from cohort_users where idx=1)"
G="(select grant_id from cohort_users where idx=1)"
C="md5('audit-connection-1-1')::uuid"
SCOPE=json.dumps(dict(date_basis='completed_date',start='2023-01-01',end='2026-10-01',category='all',region_code=None,agency_key=None,manager_key=None,bbox=None,law=None))
COHORT="'completed_date','2023-01-01','2026-10-01',false,'all',null,null,null,null"
LEGACY="'2023-01-01','2026-10-01','all',null,null,null,null"
def baseline():
    cat=json.loads((ROOT/'docs/implementation/query-audit-20261006/evidence/catalog-before.json').read_text())
    s=pending(AUTH,through='202610060100')+'set check_function_bodies=off;'
    s+='\n'.join(f['definition']+';' for f in cat['functions'])+'set check_function_bodies=on;'
    for name in ['community_report_facts_manifest','community_report_facts_manifest_insert','community_report_facts_manifest_delete','community_report_facts_projection','community_report_facts_registry_version']:
        s+='drop trigger if exists '+name+' on private.community_report_facts;'
    s+='\n'.join(t['definition']+';' for t in cat['triggers'] if t['table']=='private.community_report_facts')
    return s

def seed(size,concentrated=False):
    n=size//100
    s=(ROOT/'tests/integration/helpers/cohort-timeout-seed.sql').read_text().replace('__SIZE__',str(size)).replace('generate_series(1,30)',f'generate_series(1,{n})').replace('u.idx=1+g%30',('u.idx=1' if concentrated else f'u.idx=1+g%{n}'))
    if concentrated:s=s.replace("select u.id,repeat('a',64),md5","select u.id,case when g%10=0 then repeat('c',64) else repeat('a',64) end,md5")
    s='truncate auth.users cascade;\n'+s
    s+='''
update private.community_consent_grants g set policy_version=p.version,consent_text_sha256=p.consent_text_sha256
from private.community_policy_current c join private.community_policies p on p.version=c.version
where g.user_id=(select id from cohort_users where idx=1) and g.revoked_at is null;
insert into private.community_consent_grants(grant_id,lineage_id,user_id,policy_version,consent_text_sha256,granted_via,granted_session_id,revoked_at)
select md5('audit-history-'||u.idx||'-'||k)::uuid,u.lineage,u.id,'2026-09-26.1',repeat('a',64),'safetyreport_server',u.session_id,now()
from cohort_users u cross join generate_series(1,2) k;
insert into private.community_connections(connection_id,user_id,bound_session_id,connection_secret_sha256,source_app,source_mode,platform,device_label,dataset_key,writer_epoch)
select md5('audit-connection-'||u.idx||'-'||k)::uuid,u.id,u.session_id,repeat('b',64),'safetyreport','server','linux','synthetic',
case when k=1 then repeat('a',64) else md5('device-'||k)||md5('device-'||k) end,1000000+u.idx*3+k
from cohort_users u cross join generate_series(1,3) k where k<=1+u.idx%3;
truncate private.community_auth_requests,private.community_auth_rate_limits,private.rate_limits;
insert into private.community_auth_requests(id,protocol_version,client_kind,device_label,display_code,code_challenge,create_idem_hash,device_secret_hash,install_hash,bootstrap_ticket_hash,browser_secret_hash,status,created_at,expires_at)
select md5('audit-relay-'||g)::uuid,1,'pc','synthetic','ABCD-EFGH',repeat('A',43),md5('idem-'||g)||md5('idem-'||g),repeat('b',64),md5('install-'||g)||md5('install-'||g),repeat('c',64),repeat('d',64),
case when g%10=0 then 'created' else 'cancelled' end,now()-interval '10 minutes',now()+interval '10 minutes' from generate_series(1,__RELAY__) g;
insert into private.community_auth_rate_limits select md5(g::text),now()-g*interval '1 minute',1 from generate_series(1,__SIZE__) g;
insert into private.rate_limits select md5(g::text)||md5(g::text),now()-g*interval '1 minute',1 from generate_series(1,__SIZE__) g;
insert into private.community_ingest_events(receipt_id,contributor_id,event_id,request_id,connection_id,consent_grant_id,dataset_key,writer_epoch,source_system,source_report_key,source_report_id,source_revision,event_type,trigger,payload,payload_sha256,captured_at,result,report_number)
select f.latest_receipt_id,f.contributor_id,md5('audit-history-event-'||f.source_report_id)::uuid,'audit-seed-request',md5('audit-connection-'||u.idx||'-1')::uuid,f.consent_grant_id,f.dataset_key,f.writer_epoch,'safetyreport',f.source_report_key,f.source_report_id,f.source_revision,'completed_observation','manual',jsonb_build_object('status',f.status),f.payload_sha256,f.first_accepted_at,'accepted',f.report_number
from private.community_report_facts f join cohort_users u on u.id=f.contributor_id;
analyze private.community_ingest_events;
analyze private.community_report_facts; analyze private.contributor_profiles; analyze private.community_consent_grants;
analyze private.community_connections; analyze private.community_auth_requests; analyze private.community_auth_rate_limits; analyze private.rate_limits;
'''.replace('__RELAY__',str(size//5)).replace('__SIZE__',str(size))
    return s

def cases():
    r={}
    def add(name,expr): r[name]='select to_jsonb('+expr+') as value'
    for name,args in [('internal_analytics_v2_state',''),('internal_analytics_cohort_state',''),('internal_analytics_viewer',f'{U},{S}'),('internal_analytics_cohort_facts',COHORT),('internal_analytics_v2_facts',LEGACY),('internal_my_analytics_cohort_source',f'{U},{S},'+COHORT),('internal_my_analytics_source',f'{U},{S},'+LEGACY),('internal_account_policy',''),('internal_account_status',f'{U},{S},{C}'),('internal_community_manifest',f'{U},{S},{C},null,5000'),('internal_agency_recompute_state',''),('internal_my_reports_summary',f"{U},{S},'2026-09-29','2026-10-01',true,0,20,null"),('internal_my_reports_search',f"{U},{S},'address','합성 주소',true,0,20,0,10,null"),('internal_my_reports_numbers',f"{U},{S},'address','합성 주소',0,500,100000,null")]:add(name,f'public.{name}({args})')
    for kind in ['agency','manager','laws','series']:
        opts="jsonb_build_object('page',1,'page_size',100,'q','','sort',jsonb_build_object('column','completed','value','count','dir','desc'),'expected_version',(select dataset_version from private.analytics_state where singleton))"
        add('rollup/'+kind,f'public.internal_analytics_rollup({lit(SCOPE)}::jsonb,{lit(kind)},{opts})')
    q=dict(theme='reporters',metric='reports_count',period='all',date_basis='completed_date',category='all',min_reports=1,page=1,page_size=50,expected_version=None)
    add('internal_user_rankings',f'public.internal_user_rankings({U},{S},{lit(json.dumps(q))}::jsonb)')
    for name,args in [('ranking_representatives',''),('my_reports_own',U),('analytics_rollup_source',lit(SCOPE)+'::jsonb')]:r[name]=f'select coalesce(jsonb_agg(to_jsonb(x)),\'[]\'::jsonb) as value from private.{name}({args}) x'
    r['internal_agency_recompute_page']="select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) as value from public.internal_agency_recompute_page((select version from private.community_registry_state where id=1),500,null,null,null) x"
    return r

def block(label,query,plans=False):
    # Exception subtransactions prevent a timeout/error from poisoning the remaining audit.
    # 8s is an external probe budget, not a product-function timeout change.
    if plans:
        body=f"for p in execute {lit('explain(analyze,buffers,format json) '+query)} loop result:=p; end loop;"
    else:body=f"execute {lit(query)} into result;"
    return f"""
set statement_timeout='8s';
do $audit$ declare started timestamptz:=clock_timestamp(); result jsonb; p jsonb; state text; msg text;
begin
 begin {body}
 insert into audit_results values({lit(label)},extract(epoch from clock_timestamp()-started)*1000,result,null,null);
 exception when query_canceled or others then get stacked diagnostics state=returned_sqlstate,msg=message_text;
 insert into audit_results values({lit(label)},extract(epoch from clock_timestamp()-started)*1000,null,state,msg);
 end;
end $audit$;
select jsonb_build_object('case',label,'ms',ms,'error',error,'message',message,'digest',md5(result::text),'bytes',octet_length(result::text),'response_error',result->>'error'{",'plan',result" if plans else ''}) from audit_results where label={lit(label)};
"""

def provenance():
    return {str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in
            [pathlib.Path(__file__).resolve(),ROOT/'scripts/query-audit/write_benchmark.py',ROOT/'tests/integration/helpers/cohort-timeout-seed.sql',*sorted((ROOT/'supabase/migrations').glob('202610060*.sql'))]}

def run(size,mode,phase,concentrated=False,plans=False):
    prefix=f'{phase}-{size}-{mode}'+('-concentrated' if concentrated else '')+('-plans' if plans else '')
    script='begin;\n'+baseline()+'\n'+seed(size,concentrated)
    if phase=='after':
        for p in sorted((ROOT/'supabase/migrations').glob('202610060[2-9]*.sql')):script+=strip_tx(p.read_text())
    script+=f"\nset plan_cache_mode={mode};set jit=on;set timezone='UTC';create temp table audit_results(label text,ms numeric,result jsonb,error text,message text);\n"
    if plans:script+="set client_min_messages=log;load 'auto_explain';set auto_explain.log_min_duration=5;set auto_explain.log_nested_statements=on;set auto_explain.log_analyze=on;set auto_explain.log_buffers=on;set auto_explain.log_parameter_max_length=0;\n"
    for label,query in cases().items():script+=block(label,query,plans)
    if phase=='parity':
        script+='alter table audit_results rename to audit_before;create temp table audit_results (like audit_before);'
        for p in sorted((ROOT/'supabase/migrations').glob('202610060[2-9]*.sql')):script+=strip_tx(p.read_text())
        for label,query in cases().items():script+=block(label,query,False)
        script+="select jsonb_build_object('parity',a.label,'equal',case when a.label='internal_user_rankings' then a.result-'generated_at' is not distinct from b.result-'generated_at' else a.result is not distinct from b.result end,'before_error',b.error,'after_error',a.error) from audit_results a join audit_before b using(label);"
    script+='rollback;'
    OUT.mkdir(parents=True,exist_ok=True)
    with (OUT/(prefix+'.txt')).open('w') as out,(OUT/(prefix+'-stderr.txt')).open('w') as err:
        proc=subprocess.run(['docker','exec','-i',DB,'psql','-X','-U','supabase_admin','-d','postgres','-qAt','-v','ON_ERROR_STOP=1'],input=script,text=True,stdout=out,stderr=err,timeout=1200)
    if proc.returncode:raise RuntimeError(prefix+': '+(OUT/(prefix+'-stderr.txt')).read_text()[-1800:])
    rows=[json.loads(x) for x in (OUT/(prefix+'.txt')).read_text().splitlines() if x.startswith('{')]
    (OUT/(prefix+'.json')).write_text(json.dumps(dict(size=size,users=size//100,mode=mode,phase=phase,concentrated=concentrated,plans=plans,provenance=provenance(),samples=rows),ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(dict(run=prefix,samples=len(rows),slow=[(x['case'],x['ms'],x['error']) for x in rows if x.get('ms',0)>100 or x.get('error')]),ensure_ascii=False),flush=True)

if __name__=='__main__':
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--sizes',nargs='+',type=int,choices=[3000,30000],default=[3000,30000]);ap.add_argument('--phase',choices=['before','after','parity'],default='before');ap.add_argument('--modes',nargs='+',choices=['force_custom_plan','force_generic_plan'],default=['force_custom_plan','force_generic_plan']);ap.add_argument('--concentrated',action='store_true');ap.add_argument('--plans',action='store_true');a=ap.parse_args()
    for size in a.sizes:
        for mode in a.modes:run(size,mode,a.phase,a.concentrated,a.plans)
