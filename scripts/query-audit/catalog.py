"""Inventory current composed map/auth PostgreSQL objects; local Docker only, DDL rolled back."""
import argparse, json, pathlib, re, subprocess
ROOT=pathlib.Path(__file__).resolve().parents[2]
DB='supabase_db_ci0926-int'

def psql(script):
    result = subprocess.run(['docker','exec','-i',DB,'psql','-X','-U','supabase_admin','-d','postgres','-qAt','-v','ON_ERROR_STOP=1'], input=script,text=True,capture_output=True)
    if result.returncode: raise RuntimeError(result.stderr[-3500:])
    return result.stdout

def strip_tx(s): return re.sub(r'^(?:begin|commit);\s*$','',s,flags=re.M|re.I)

def pending(auth, through=None):
    manifest=json.loads((ROOT/'docs/integration/community-ingest/migration-manifest.json').read_text())
    seen=set(psql('select version from supabase_migrations.schema_migrations;').splitlines())
    return '\n'.join(strip_tx(((ROOT if m['repo']=='map' else auth)/m['path']).read_text()) for m in manifest['migrations'] if m['version'] not in seen and (through is None or m['version']<=through))

QUERY="""
select jsonb_build_object(
 'functions',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'signature',p.oid::regprocedure::text,
   'args',pg_get_function_identity_arguments(p.oid),'result',pg_get_function_result(p.oid),'volatility',p.provolatile,
   'definer',p.prosecdef,'config',p.proconfig,'acl',p.proacl::text,'definition',pg_get_functiondef(p.oid)) order by n.nspname,p.proname)
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private')
   and not exists(select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')),
 'tables',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,'kind',c.relkind,'rls',c.relrowsecurity,
   'force_rls',c.relforcerowsecurity,'acl',c.relacl::text,'view',case when c.relkind in ('m','v') then pg_get_viewdef(c.oid) end) order by n.nspname,c.relname)
   from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and c.relkind in ('r','v','m')),
 'policies',(select coalesce(jsonb_agg(to_jsonb(p)),'[]') from pg_policies p where schemaname in ('public','private')),
 'indexes',(select jsonb_agg(to_jsonb(i) order by schemaname,tablename,indexname) from pg_indexes i where schemaname in ('public','private')),
 'triggers',(select jsonb_agg(jsonb_build_object('table',tgrelid::regclass::text,'name',tgname,'function',tgfoid::regprocedure::text,
   'enabled',tgenabled,'definition',pg_get_triggerdef(oid)) order by tgrelid::regclass::text,tgname) from pg_trigger
   where not tgisinternal and tgrelid in (select c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private'))));
"""

def collect(auth, installed=False):
    catalog=json.loads(psql(QUERY if installed else 'begin;'+pending(auth)+QUERY+'rollback;').strip())
    sources={}
    for owner,root in [('map',ROOT),('auth',auth)]:
        for path in sorted((root/'supabase/migrations').glob('*.sql')):
            txt=path.read_text()
            for match in re.finditer(r'create\s+(?:or\s+replace\s+)?function\s+([\w]+\.[\w]+)',txt,re.I):
                sources[match.group(1)]={'repo':owner,'path':str(path.relative_to(root)),'line':txt[:match.start()].count('\n')+1}
    code={}
    for owner,root,dirs in [('map',ROOT,['server','supabase/functions','src','scripts']),('auth',auth,['server','supabase/functions','site','scripts'])]:
        for d in dirs:
            for path in (root/d).rglob('*'):
                if path.is_file() and path.suffix in ('.ts','.tsx','.js','.mjs','.py','.sh') and 'query-audit' not in str(path):
                    code[(owner,str(path.relative_to(root)))]=path.read_text()
    for f in catalog['functions']:
        f['source']=sources.get(f['schema']+'.'+f['name'])
        f['call_sites']=[{'repo':owner,'path':p,'line':txt[:m.start()].count('\n')+1}
                         for (owner,p),txt in code.items() for m in re.finditer(r'\b'+f['name']+r'\b',txt)]
        f['callers']=[g['schema']+'.'+g['name'] for g in catalog['functions'] if g is not f and re.search(r'\b'+f['schema']+r'\.'+f['name']+r'\s*\(',g['definition'])]
    return catalog

if __name__=='__main__':
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--auth',type=pathlib.Path,required=True);ap.add_argument('--out',type=pathlib.Path,required=True)
    ap.add_argument('--installed',action='store_true',help='Read the installed local catalog without replaying pending migrations')
    a=ap.parse_args();result=collect(a.auth.resolve(),a.installed);a.out.parent.mkdir(parents=True,exist_ok=True);a.out.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print({k:len(v) for k,v in result.items()})
