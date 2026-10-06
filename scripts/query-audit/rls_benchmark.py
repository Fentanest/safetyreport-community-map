"""Actual role ACL probes plus explicitly temporary RLS default-deny diagnostics."""
import json,subprocess
from benchmark import baseline,seed,block,OUT,DB
catalog=json.loads((OUT/'catalog-before.json').read_text())
for size in [3000,30000]:
 for mode in ['force_custom_plan','force_generic_plan']:
  script='begin;'+baseline()+seed(size)+f"set plan_cache_mode={mode};create temp table audit_results(label text,ms numeric,result jsonb,error text,message text);grant select,insert on audit_results to anon,authenticated,service_role;"
  for role in ['anon','authenticated','service_role']:
   script+=f'set local role {role};'
   for t in catalog['tables']:
    if t['name']=='it_realtime_control':continue
    name=t['schema']+'.'+t['name'];script+=block('actual/'+role+'/'+name,'select to_jsonb(count(*)) from '+name,True)
   script+='reset role;'
  script+='grant usage on schema private to anon,authenticated;'
  for t in catalog['tables']:
   if t['rls'] and t['name']!='it_realtime_control':script+='grant select on '+t['schema']+'.'+t['name']+' to anon,authenticated;'
  for role in ['anon','authenticated']:
   script+=f'set local role {role};'
   for t in catalog['tables']:
    if t['rls'] and t['name']!='it_realtime_control':
     name=t['schema']+'.'+t['name'];script+=block('temporary-grant-default-deny/'+role+'/'+name,'select to_jsonb(count(*)) from '+name,True)
   script+='reset role;'
  script+='rollback;'
  p=subprocess.run(['docker','exec','-i',DB,'psql','-X','-U','supabase_admin','-d','postgres','-qAt','-v','ON_ERROR_STOP=1'],input=script,text=True,capture_output=True,timeout=120)
  if p.returncode:raise RuntimeError(p.stderr[-2000:])
  rows=[json.loads(s) for s in p.stdout.splitlines() if s.startswith('{')]
  (OUT/f'rls-{size}-{mode}.json').write_text(json.dumps(dict(size=size,mode=mode,samples=rows),indent=2)+'\n')
  for row in rows:
   if row['case'].startswith('temporary'):assert row['error'] is None,row
   elif row['error']:assert row['error']=='42501',row
  print(size,mode,len(rows),'role probes passed',flush=True)
