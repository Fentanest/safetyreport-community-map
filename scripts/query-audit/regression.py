"""Executable semantic regression checks on the existing local PostgreSQL; every test rolls back."""
import json,pathlib,re,unittest
from catalog import psql,strip_tx
from benchmark import ROOT,AUTH,pending,baseline,seed,U,S,G,C,cases,lit
CAT=json.loads((ROOT/'docs/implementation/query-audit-20261006/evidence/catalog-before.json').read_text())
MIG='\n'.join(strip_tx(p.read_text()) for p in sorted((ROOT/'supabase/migrations').glob('202610060[2-9]*.sql')))
NAMES=['internal_analytics_v2_state','internal_analytics_cohort_state','internal_analytics_v2_facts','internal_analytics_viewer','ranking_representatives','internal_agency_recompute_apply','internal_my_analytics_source','internal_my_analytics_cohort_source','internal_user_rankings','analytics_rollup_source','internal_analytics_rollup']
REPLACE={f['schema']+'.'+f['name']:'pg_temp.before_'+f['name'] for f in CAT['functions'] if f['name'] in NAMES}
def before(s):
 for old,new in REPLACE.items():s=s.replace(old+'(',new+'(')
 return s
ALIASES='\n'.join(before(f['definition'])+';' for f in CAT['functions'] if f['name'] in NAMES)
def sql(body,size=300):
 return [json.loads(x) for x in psql('begin;'+baseline()+seed(size)+'set check_function_bodies=off;'+ALIASES+'set check_function_bodies=on;'+MIG+body+'rollback;').splitlines() if x.startswith('{')]
def compare(label,expr):return f"select jsonb_build_object('case',{lit(label)},'equal',({expr}) is not distinct from ({before(expr)}));"

class QueryAudit(unittest.TestCase):
 def test_reads_modes_filters_and_transitions(self):
  checks=[]
  for mode in ['force_custom_plan','force_generic_plan']:
   checks.append('set plan_cache_mode='+mode+';')
   for basis in ['completed_date','report_date']:
    for dates,filters in [("'2023-01-01','2026-10-01'","'all',null,null,null,null"),("'2023-04-01','2023-04-30'","'all',null,null,null,null"),("'2023-01-01','2026-10-01'","'traffic','서울 중구','agency-1',null,null"),("'2040-01-01','2040-01-31'","'all',null,null,null,null"),("'2023-01-01','2026-10-01'","'all',null,null,'manager-2',array[127.0,37.0,127.3,37.3]::double precision[]")]:
     checks.append(compare('legacy/'+mode+'/'+basis+'/'+dates,f'public.internal_analytics_v2_facts({dates},{filters})'))
   for label,query in cases().items():
    if label in ['internal_analytics_v2_state','internal_analytics_cohort_state','internal_analytics_viewer','internal_user_rankings','internal_my_analytics_source','internal_my_analytics_cohort_source']:
     checks.append(compare(label,query.removeprefix('select ').removesuffix(' as value')))
  for i,mutation in enumerate(['',f'update private.community_consent_grants set revoked_at=now() where user_id={U};',f'update private.community_consent_grants set revoked_at=null where grant_id={G};',f"update private.contributor_profiles set status='suspended' where user_id={U};",f"update private.contributor_profiles set status='active' where user_id={U};", "update private.community_report_facts set report_date=null,completed_date=null where source_report_id='synthetic-3';", "update private.analytics_state set data_min='2000-01-01',data_max='2050-01-01';"]):
   checks.append(mutation)
   for name,args in [('internal_analytics_v2_state',''),('internal_analytics_cohort_state',''),('internal_analytics_viewer',f'{U},{S}'),('internal_analytics_v2_facts',"'2023-01-01','2026-10-01','all',null,null,null,null")]:checks.append(compare(str(i)+'/'+name,f'public.{name}({args})'))
  rows=sql('\n'.join(checks));self.assertEqual(len(rows),60)
  for r in rows:self.assertTrue(r['equal'],r['case'])

 def test_manifest_exact_generations_and_statement_rollback(self):
  original=next(t['definition'] for t in CAT['triggers'] if t['name']=='community_report_facts_manifest')+';'
  restore='drop trigger community_report_facts_manifest_insert on private.community_report_facts;drop trigger community_report_facts_manifest_delete on private.community_report_facts;drop trigger community_report_facts_manifest on private.community_report_facts;'+original
  migration=strip_tx((ROOT/'supabase/migrations/202610060300_manifest_statement_batches.sql').read_text())
  # The same immutable starting fixture is reused by rolling each DML sequence back inside a subtransaction.
  ops=["insert into private.community_report_facts select (jsonb_populate_record(null::private.community_report_facts,to_jsonb(f)||jsonb_build_object('dataset_key',repeat('d',64)))).* from private.community_report_facts f;",
       "update private.community_report_facts set public_state='not_completed' where source_report_id in ('synthetic-1','synthetic-2');",
       "update private.community_report_facts set public_state='completed' where source_report_id='synthetic-1';",
       "update private.community_report_facts set dataset_key=repeat('e',64) where source_report_id='synthetic-3' and dataset_key=repeat('d',64);",
       "insert into private.community_report_facts select * from private.community_report_facts where source_report_id='synthetic-4' on conflict(contributor_id,dataset_key,source_report_key) do update set public_state='not_completed';",
       "insert into private.community_report_facts select * from private.community_report_facts where false;",
       "delete from private.community_report_facts where source_report_id in ('synthetic-5','synthetic-6');",
       "delete from private.community_report_facts where false;"]
  snapshot="select jsonb_agg(to_jsonb(g) order by contributor_id,dataset_key) into result from private.community_manifest_generations g;"
  body=''.join(ops)+snapshot
  # Nested exception rolls back all effects but keeps result in a PL/pgSQL variable.
  fn="create function pg_temp.effects() returns jsonb language plpgsql as $f$ declare result jsonb;begin begin "+body+" raise exception using errcode='ZX001';exception when sqlstate 'ZX001' then null;end;return result;end;$f$;"
  rows=sql(restore+fn+"create temp table old_effect as select pg_temp.effects() as value;"+migration+"select jsonb_build_object('equal',(select value from old_effect)=pg_temp.effects());")
  self.assertEqual(rows,[{'equal':True}])

 def test_agency_batch_cas_errors_and_trigger_effects(self):
  setup="update private.community_registry_state set version='audit-batch' where id=1;create temp table updates as select jsonb_agg(jsonb_build_object('contributor_id',contributor_id,'dataset_key',dataset_key,'source_report_key',source_report_key,'source_agency_code',source_agency_code,'agency_name',agency_name,'manager_name',manager_name,'expected_agency_key',agency_key,'expected_agency_current_name',agency_current_name,'expected_manager_key',manager_key,'expected_agency_registry_version',agency_registry_version,'agency_key','new-agency','agency_current_name','새 기관','manager_key','new-manager')) as value from (select * from private.community_report_facts order by contributor_id,dataset_key,source_report_key limit 50) f;"
  fn="""create function pg_temp.agency(before boolean,updates jsonb) returns jsonb language plpgsql as $f$
  declare result jsonb;state jsonb;old_version text;begin
   begin
    select dataset_version into old_version from private.analytics_state;
    if before then result:=pg_temp.before_internal_agency_recompute_apply('audit-batch',updates);
    else result:=public.internal_agency_recompute_apply('audit-batch',updates);end if;
    select jsonb_build_object('facts',(select jsonb_agg(to_jsonb(f) order by contributor_id,dataset_key,source_report_key) from private.community_report_facts f),'generations',(select jsonb_agg(to_jsonb(g) order by contributor_id,dataset_key) from private.community_manifest_generations g),'version_changed',(select dataset_version<>old_version from private.analytics_state)) into state;
    result:=jsonb_build_object('response',result,'state',state);
    raise exception using errcode='ZX001';
   exception when sqlstate 'ZX001' then null;when others then result:=jsonb_build_object('error',sqlerrm,'state',sqlstate);end;
   return result;
  end;$f$;"""
  checks=''
  for v in ['(select value from updates)',"'[]'::jsonb",'(select value||value from updates)',"'[{}]'::jsonb","'{\"bad\":1}'::jsonb",'(select jsonb_set(value,\'{0,expected_agency_key}\',\'"stale"\') from updates)']:
   checks+=f"select jsonb_build_object('equal',pg_temp.agency(true,{v})=pg_temp.agency(false,{v}));"
  rows=sql(setup+fn+checks);self.assertEqual(rows,[{'equal':True}]*6)

 def test_legacy_validation_and_pre_filter_row_budget(self):
  body="""set plan_cache_mode=force_custom_plan;
  create function pg_temp.legacy_outcome(before boolean,s date,e date,category text) returns text language plpgsql as $f$ begin
   if before then return jsonb_array_length(pg_temp.before_internal_analytics_v2_facts(s,e,category,'no-such-region',null,null,null))::text;
   else return jsonb_array_length(public.internal_analytics_v2_facts(s,e,category,'no-such-region',null,null,null))::text;end if;
   exception when others then return sqlstate||':'||sqlerrm;end;$f$;
  """
  def check(start,end,cat):return f"select jsonb_build_object('before',pg_temp.legacy_outcome(true,{start},{end},{cat}),'after',pg_temp.legacy_outcome(false,{start},{end},{cat}));"
  body+=check('null',"'2026-10-01'","'all'")+check("'2026-10-01'","'2023-01-01'","'all'")+check("'2023-01-01'","'2026-10-01'","'bad'")
  body+="""create temp table budget_template as select to_jsonb(f) value from private.community_report_facts f where contributor_id=(select id from cohort_users where idx=1) limit 1;
  alter table private.community_report_facts disable trigger user;delete from private.community_report_facts;
  insert into private.community_report_facts select r.* from budget_template t cross join generate_series(1,100000) g
  cross join lateral jsonb_populate_record(null::private.community_report_facts,t.value||jsonb_build_object('dataset_key',md5(g::text)||md5(g::text),'public_state','completed','report_date','2023-01-01','completed_date','2023-01-02')) r;
  alter table private.community_report_facts enable trigger user;analyze private.community_report_facts;
  """
  body+=check("'2023-01-01'","'2026-10-01'","'all'")
  body+="""insert into private.community_report_facts select r.* from budget_template t cross join lateral jsonb_populate_record(null::private.community_report_facts,t.value||jsonb_build_object('dataset_key',repeat('d',64),'public_state','completed','report_date','2023-01-01','completed_date','2023-01-02')) r;"""
  body+=check("'2023-01-01'","'2026-10-01'","'traffic'")
  rows=sql(body);self.assertEqual(len(rows),5)
  for row in rows:self.assertEqual(row['before'],row['after'])
  self.assertEqual([r['after'] for r in rows],['P0001:INVALID_QUERY']*3+['0','P0001:RESULT_TOO_LARGE'])

 def test_rollup_region_names_and_split_coordinates(self):
  # Compare the ordered public response, including split geometry, NULL coordinates and old aliases.
  regions=[('서울 중구',37.5,127.0),('인천 남구',None,None),('세종 나성동',None,None),('인천 중구',None,None),('인천 서구',37.5,126.6),('인천 중구',37.49,126.55),('unknown',37,127),(None,None,None)]
  values=','.join('('+str(i)+','+','.join('null' if v is None else lit(v) for v in row)+')' for i,row in enumerate(regions))
  body="create temp table region_fixture(i integer,raw text,lat double precision,lng double precision);insert into region_fixture values "+values+";update private.community_report_facts f set region_code=r.raw,lat=r.lat,lng=r.lng,lat_text=r.lat::text,lng_text=r.lng::text,coord_source=case when r.lat is null then 'none' else 'geocode' end from region_fixture r where r.i=right(f.source_report_id,1)::int%8;"
  count=0
  for mode in ['force_custom_plan','force_generic_plan']:
   body+='set plan_cache_mode='+mode+';'
   for code in [None,'11','28','28125','28155','28275','28290','36','999']:
    scope=dict(date_basis='completed_date',start='2023-01-01',end='2026-10-01',category='all',region_code=code)
    opts="jsonb_build_object('page',1,'page_size',100,'q','','sort',jsonb_build_object('column','completed','value','count','dir','desc'),'expected_version',(select dataset_version from private.analytics_state where singleton))"
    body+=compare('region/'+str(code),f"public.internal_analytics_rollup({lit(json.dumps(scope))}::jsonb,'agency',{opts})");count+=1
  rows=sql(body);self.assertEqual(len(rows),count)
  for row in rows:self.assertTrue(row['equal'],row)

 def test_service_acl_and_actual_rls_roles(self):
  body="""select jsonb_build_object('acl',bool_and(not has_function_privilege('anon',p.oid,'execute') and not has_function_privilege('authenticated',p.oid,'execute') and has_function_privilege('service_role',p.oid,'execute'))) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('internal_analytics_v2_state','internal_analytics_cohort_state','internal_analytics_v2_facts','internal_analytics_viewer','internal_agency_recompute_apply');
  set local role service_role;
  select jsonb_build_object('service',public.internal_analytics_cohort_state() is not null);
  reset role;
  """
  for role in ['anon','authenticated']:
   body+=f"set local role {role};do $f$ begin begin perform count(*) from private.community_report_facts;raise exception 'unexpected access';exception when insufficient_privilege then null;end;end;$f$;reset role;"
  # Temporary SELECT/schema grants expose the underlying default-deny policy to real roles.
  # This is a diagnostic transaction, not an application permission change.
  body+='grant usage on schema private to anon,authenticated;grant select on private.community_report_facts to anon,authenticated;'
  for role in ['anon','authenticated']:
   body+=f"set local role {role};select jsonb_build_object('role',current_user,'visible',count(*)) from private.community_report_facts;explain(analyze,buffers) select count(*) from private.community_report_facts;reset role;"
  rows=sql(body);self.assertEqual(rows,[{'acl':True},{'service':True},{'role':'anon','visible':0},{'role':'authenticated','visible':0}])

if __name__=='__main__':unittest.main(verbosity=2)
