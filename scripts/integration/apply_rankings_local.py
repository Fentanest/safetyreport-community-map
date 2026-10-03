"""Apply composed migrations to the existing LOCAL test stack; never takes a DSN/host.
Usage: python3 scripts/integration/apply_rankings_local.py --auth ../safetyreport-community-auth
Other repository is read-only. No reset, cloud calls or production configuration changes.
"""
import argparse, json, pathlib, subprocess
p=argparse.ArgumentParser();p.add_argument('--auth',required=True);a=p.parse_args()
root=pathlib.Path(__file__).resolve().parents[2]
def sql(text):
 return subprocess.run(['docker','exec','-i','supabase_db_ci0926-int','psql','-U','postgres','-d','postgres','-tAq','-v','ON_ERROR_STOP=1'],input=text,text=True,capture_output=True,check=True).stdout
seen=set(sql('select version from supabase_migrations.schema_migrations').split())
manifest=json.loads((root/'docs/integration/community-ingest/migration-manifest.json').read_text())
for m in manifest['migrations']:
 if m['version'] in seen: continue
 owner=root if m['repo']=='map' else pathlib.Path(a.auth).resolve()
 try:
  sql((owner/m['path']).read_text())
  sql(f"insert into supabase_migrations.schema_migrations(version,name,statements) values ('{m['version']}','{pathlib.Path(m['path']).stem}',array[]::text[])")
 except subprocess.CalledProcessError as e:
  print(e.stderr);raise
 print('LOCAL applied',m['version'])
