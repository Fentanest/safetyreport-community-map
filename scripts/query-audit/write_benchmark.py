"""Write-path/helper audit; synthetic rows and every individual mutation rolled back."""
import argparse,json,subprocess
from benchmark import ROOT,AUTH,OUT,DB,seed,pending,baseline,strip_tx,lit,block,provenance,U,S,G,C
from catalog import psql
RID="md5('audit-relay-10')::uuid"
POL="(select version from private.community_policy_current)"
HASH="(select consent_text_sha256 from private.community_policies where version="+POL+")"

def cases():
 r=[]
 def add(label,expr,setup=''):r.append((label,setup,'select to_jsonb('+expr+') as value'))
 def dml(label,sql,setup=''):r.append((label,setup,'with changed as ('+sql+' returning 1) select to_jsonb(count(*)) as value from changed'))
 add('internal_account_grant_consent/current',f"public.internal_account_grant_consent({U},{S},{POL},{HASH},'safetyreport_server')")
 add('internal_account_grant_consent/new',f"public.internal_account_grant_consent({U},{S},{POL},{HASH},'safetyreport_server')",f'update private.community_consent_grants set revoked_at=now() where user_id={U};')
 add('internal_account_register_connection',f"public.internal_account_register_connection({U},{S},'safetyreport','server','linux','synthetic',repeat('a',64),repeat('b',64),true)")
 add('internal_account_rebind_connection',f"public.internal_account_rebind_connection({U},{S},{C},repeat('b',64))")
 add('internal_account_revoke_connection',f'public.internal_account_revoke_connection({U},{C})')
 add('internal_account_revoke_consent',f'public.internal_account_revoke_consent({U},{S},{G})')
 add('internal_community_delete_contributions',f'public.internal_community_delete_contributions({U},{S})')
 add('internal_analytics_v2_rate_limit',"public.internal_analytics_v2_rate_limit(repeat('f',64))")
 add('internal_community_ingest_rate_limit',"public.internal_community_ingest_rate_limit(repeat('f',64),60)")
 add('internal_safeauth_rate_limit',"public.internal_safeauth_rate_limit('sa:audit:'||repeat('f',64),60,60)")
 add('internal_safeauth_create',"public.internal_safeauth_create(md5('audit-new-relay')::uuid,1,'pc','synthetic','ABCD-EFGH',repeat('A',43),repeat('a',64),repeat('b',64),repeat('a',64),repeat('c',64),600,10,10000)")
 add('internal_safeauth_claim',f"public.internal_safeauth_claim({RID},repeat('c',64),repeat('d',64))")
 add('internal_safeauth_browser_status',f"public.internal_safeauth_browser_status({RID},repeat('d',64))")
 add('internal_safeauth_prepare',f"public.internal_safeauth_prepare({RID},repeat('d',64))",f"update private.community_auth_requests set status='claimed' where id={RID};")
 add('internal_safeauth_publish',f"public.internal_safeauth_publish({RID},repeat('d',64),'code',repeat('e',64),'synthetic-encrypted',120,null)",f"update private.community_auth_requests set status='oauth_started' where id={RID};")
 ready=f"update private.community_auth_requests set status='code_ready',code_digest=repeat('e',64),encrypted_auth_code='synthetic-encrypted',code_expires_at=now()+interval '2 minutes' where id={RID};"
 add('internal_safeauth_poll',f"public.internal_safeauth_poll({RID},repeat('b',64),repeat('f',64))",ready)
 add('internal_safeauth_complete',f"public.internal_safeauth_complete({RID},repeat('b',64),{U},{S},now())",ready+f"update private.community_auth_requests set status='code_delivered' where id={RID};")
 add('internal_safeauth_cancel',f"public.internal_safeauth_cancel({RID},'device',repeat('b',64))")
 add('internal_safeauth_rotate_ticket',f"public.internal_safeauth_rotate_ticket({RID},repeat('b',64),repeat('e',64))")
 add('internal_safeauth_cleanup','public.internal_safeauth_cleanup()',"update private.community_auth_requests set created_at=now()-interval '2 days',expires_at=now()-interval '2 days'+interval '20 minutes';")
 add('internal_activate_snapshot',f"public.internal_activate_snapshot(md5('audit-snapshot')::uuid,{U})",f"insert into private.upload_snapshots(id,user_id,schema_version,source_mode,client_generated_at,expected_point_count,payload_sha256) values(md5('audit-snapshot')::uuid,{U},1,'safetyreport_server',now(),0,encode(extensions.digest('','sha256'),'hex'));")
 add('internal_agency_recompute_apply',"public.internal_agency_recompute_apply((select version from private.community_registry_state where id=1),(select jsonb_agg(jsonb_build_object('contributor_id',contributor_id,'dataset_key',dataset_key,'source_report_key',source_report_key,'source_agency_code',source_agency_code,'agency_name',agency_name,'manager_name',manager_name,'expected_agency_key',agency_key,'expected_agency_current_name',agency_current_name,'expected_manager_key',manager_key,'expected_agency_registry_version',agency_registry_version,'agency_key',agency_key,'agency_current_name',agency_current_name,'manager_key',manager_key)) from (select * from private.community_report_facts limit 500) f))", "update private.community_registry_state set version='audit-version' where id=1;")
 for count in [1,20]:
  env=f"jsonb_build_object('consent_grant_id',{G},'connection_id',{C},'source_app','safetyreport','source_mode','server','trigger','manual')"
  events=f"(select jsonb_agg(jsonb_build_object('event_id',md5('audit-event-'||g)::uuid,'writer_epoch',1000004,'source_revision',g,'source_report_key',md5('audit-event-key-'||g)||md5('audit-event-key-'||g),'source_report_id','synthetic-event-'||g,'event_type','completed_observation','payload',jsonb_build_object('status','accepted'),'payload_sha256',repeat('f',64),'captured_at',now(),'derived',jsonb_build_object('public_state','completed','report_date','2026-01-01','completed_date','2026-01-02','category','parking','status','accepted','disposition','none','amount_kind','unknown','coord_source','none'))) from generate_series(1,{count}) g)"
  add('internal_community_ingest/'+str(count),f"public.internal_community_ingest({U},{S},'audit-request',{env},{events})")
 add('internal_cleanup_expired','public.internal_cleanup_expired()')
 add('community_current_policy', 'private.community_current_policy(true)')
 add('community_identity_state',f'private.community_identity_state({U},{S})')
 add('community_lineage_active',f'private.community_lineage_active({G})')
 add('community_lock_contributor',f'private.community_lock_contributor({U},true)')
 add('community_grant_is_current',f'private.community_grant_is_current((select g from private.community_consent_grants g where grant_id={G}),private.community_current_policy(false))')
 add('community_fact_publicly_listed','private.community_fact_publicly_listed((select f from private.community_report_facts f limit 1))')
 add('community_bump_manifest',f"private.community_bump_manifest({U},repeat('a',64))")
 add('community_bump_projection','private.community_bump_projection()')
 add('safeauth_expire_if_needed',f'private.safeauth_expire_if_needed((select x from private.community_auth_requests x where id={RID}))',f"update private.community_auth_requests set created_at=now()-interval '20 minutes',expires_at=now()-interval '1 minute' where id={RID};")
 add('analytics_in_ring',"private.analytics_in_ring(1,1,'[[0,0],[2,0],[2,2],[0,2],[0,0]]'::jsonb)")
 add('analytics_in_polygon',"private.analytics_in_polygon(1,1,'[[[0,0],[2,0],[2,2],[0,2],[0,0]]]'::jsonb)")
 add('analytics_region',"private.analytics_region('서울 중구',37.5,127.0)")
 add('analytics_law',"private.analytics_law('도로교통법 제005조 제2항')")
 for n,args in [('my_reports_address_base',"'서울특별시 종로구 예시로 7'"),('my_reports_norm_address',"'서울특별시 종로구 예시로 7'"),('my_reports_norm_vehicle',"'12가3456'"),('my_reports_check_query',"'address','합성 주소'"),('my_reports_gate',f'{U},{S}')]:add(n,f'private.{n}({args})')
 own=f'(select array_agg(x) from private.my_reports_own({U}) x)'
 for n,args in [('my_reports_page',own+',0,20'),('my_reports_managers',own+',0,10'),('my_reports_stats',own),('my_reports_version',own+",'active'"),('my_reports_matches',f"(select x from private.my_reports_own({U}) x limit 1),'address','합성 주소'"),('my_reports_row_json',f'(select x from private.my_reports_own({U}) x limit 1)')]:add(n,f'private.{n}({args})')
 dml('triggers/insert-bulk','insert into private.community_report_facts select * from audit_facts',"alter table private.community_report_facts disable trigger user;delete from private.community_report_facts;alter table private.community_report_facts enable trigger user;")
 dml('triggers/insert-one','insert into private.community_report_facts select * from audit_facts limit 1',"alter table private.community_report_facts disable trigger user;delete from private.community_report_facts;alter table private.community_report_facts enable trigger user;")
 dml('triggers/delete-bulk','delete from private.community_report_facts')
 dml('triggers/update-state',"update private.community_report_facts set public_state='not_completed' where contributor_id="+U)
 dml('triggers/profile-update',"update private.contributor_profiles set status='suspended' where user_id="+U)
 dml('triggers/policy-immutable',"update private.community_policies set consent_text_sha256=repeat('e',64) where version="+POL)
 dml('triggers/policy-text-immutable',"delete from private.community_policy_texts")
 return r

def run(size,mode,phase,concentrated,plans):
 prefix=f'write-{phase}-{size}-{mode}'+('-concentrated' if concentrated else '')+('-plans' if plans else '')
 seq=psql('select last_value,is_called from private.community_writer_epoch_seq;').strip().split('|')
 script='begin;'+baseline()+seed(size,concentrated)
 if phase=='after':
  for p in sorted((ROOT/'supabase/migrations').glob('202610060[2-9]*.sql')):script+=strip_tx(p.read_text())
 script+=f"set plan_cache_mode={mode};set jit=on;create temp table audit_results(label text,ms numeric,result jsonb,error text,message text);create temp table audit_facts as select * from private.community_report_facts;"
 if plans:script+="set client_min_messages=log;load 'auto_explain';set auto_explain.log_min_duration=5;set auto_explain.log_nested_statements=on;set auto_explain.log_analyze=on;set auto_explain.log_buffers=on;set auto_explain.log_parameter_max_length=0;"
 for label,setup,query in cases():
  script+='savepoint audit_case;set statement_timeout=0;'+setup
  if plans:script+='set auto_explain.log_min_duration='+('5' if label.startswith(('triggers/','my_reports_')) or label=='internal_agency_recompute_apply' else '0')+';'
  script+=block(label,query,plans)+'rollback to audit_case;'
 script+='rollback;'
 try:
  with (OUT/(prefix+'.txt')).open('w') as out,(OUT/(prefix+'-stderr.txt')).open('w') as err:
   p=subprocess.run(['docker','exec','-i',DB,'psql','-X','-U','supabase_admin','-d','postgres','-qAt','-v','ON_ERROR_STOP=1'],input=script,text=True,stdout=out,stderr=err,timeout=1200)
  if p.returncode:raise RuntimeError(prefix+': '+(OUT/(prefix+'-stderr.txt')).read_text()[-1600:])
 finally:psql(f"select setval('private.community_writer_epoch_seq',{int(seq[0])},{'true' if seq[1]=='t' else 'false'});")
 rows=[json.loads(x) for x in (OUT/(prefix+'.txt')).read_text().splitlines() if x.startswith('{')]
 (OUT/(prefix+'.json')).write_text(json.dumps(dict(size=size,users=size//100,mode=mode,phase=phase,concentrated=concentrated,plans=plans,provenance=provenance(),samples=rows),ensure_ascii=False,indent=2)+'\n')
 print(json.dumps(dict(run=prefix,samples=len(rows),slow=[(x['case'],x['ms'],x['error'],x['message']) for x in rows if x['ms']>100 or x['error']]),ensure_ascii=False),flush=True)
if __name__=='__main__':
 ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--sizes',nargs='+',type=int,choices=[3000,30000],default=[3000,30000]);ap.add_argument('--phase',choices=['before','after'],default='before');ap.add_argument('--modes',nargs='+',default=['force_custom_plan','force_generic_plan']);ap.add_argument('--concentrated',action='store_true');ap.add_argument('--plans',action='store_true');a=ap.parse_args()
 for size in a.sizes:
  for mode in a.modes:run(size,mode,a.phase,a.concentrated,a.plans)
