"""Local benchmark only: service-only immutable viewer/state aliases for frozen Edge comparison.
Creates no product migrations; refuses arbitrary DSNs. --cleanup drops exactly these two aliases.
--before-functions must name a directory INSIDE this repository's ignored .agent-runtime.
"""
import argparse,pathlib,re,subprocess
root=pathlib.Path(__file__).resolve().parents[2]
p=argparse.ArgumentParser();p.add_argument('--cleanup',action='store_true');p.add_argument('--before-functions');a=p.parse_args()
queries=[]
for file,name in [('202609281900_viewer_threshold.sql','viewer'),('202610010100_single_date_cohort.sql','cohort_state')]:
 sig='internal_analytics_'+name;args='uuid,uuid' if name=='viewer' else ''
 if a.cleanup:queries.append(f'drop function if exists public.{sig}_before_http({args});');continue
 text=(root/'supabase/migrations'/file).read_text()
 body=re.search(r'create or replace function public\.'+sig+r'[\s\S]*?\$\$;',text)[0].replace(sig,sig+'_before_http')
 queries.extend([body,f'revoke all on function public.{sig}_before_http({args}) from public,anon,authenticated;grant execute on function public.{sig}_before_http({args}) to service_role;'])
subprocess.run(['docker','exec','-i','supabase_db_ci0926-int','psql','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1'],input='\n'.join(queries)+"notify pgrst,'reload schema';",text=True,check=True,capture_output=True)
if a.before_functions and not a.cleanup:
 path=pathlib.Path(a.before_functions).resolve();path.relative_to(root/'.agent-runtime')
 entry=path/'supabase/functions/public-analytics/index.ts'
 text=entry.read_text()
 for name in ('viewer','cohort_state'):text=text.replace("rpc('internal_analytics_"+name+"'", "rpc('internal_analytics_"+name+"_before_http'")
 entry.write_text(text)
print('LOCAL HTTP benchmark aliases '+('removed' if a.cleanup else 'ready; frozen gateway must be restarted'))
