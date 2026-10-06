"""Rollback-only local screen RPC benchmark. Never accepts a DSN or a container override."""
import argparse,hashlib,json,subprocess,time
from pathlib import Path
from screen_snapshot_timeout import strip_tx,seed
ROOT=Path(__file__).resolve().parents[2]
DB='supabase_db_ci0926-int'
OUT=ROOT/'docs/implementation/screen-server-aggregate-20261006/evidence'
RUNTIME=ROOT/'.agent-runtime/screen-aggregate'

def run(size,iterations,profile,window,plans=False):
    migrations='\n'.join(strip_tx(p.read_text()) for p in sorted((ROOT/'supabase/migrations').glob('202610060*.sql')) if '0800_' not in p.name)
    # The existing local stack is changed ONLY inside one transaction. Same data/state for both paths.
    fixture=seed(size)
    if profile=='diverse':
        fixture+="\nupdate private.community_report_facts set address='합성 주소 '||(substring(source_report_id from '[0-9]+')::int%257),vehicle_raw='12가'||lpad((1000+substring(source_report_id from '[0-9]+')::int%400)::text,4,'0');\n"
    sql='begin;\n'+migrations+'\n'+fixture+'''\nset statement_timeout='180s';set work_mem='2MB';
create temp table measurements(value json);
create temp table payloads(phase text,value json);
'''
    start='2025-10-07' if window=='year' else '2019-04-23'
    scope=json.dumps(dict(date_basis='completed_date',start=start,end='2026-10-06',category='all'))
    stem=f'{size}-{profile}-{window}'
    panels=[dict(id='entities',path='entities',params=dict(kind='agency')),dict(id='laws',path='laws',params={}),dict(id='compare',path='compare',params={}),dict(id='places',path='places',params=dict(view_bbox='126,36,129,39')),dict(id='prefix',path='entity-prefix',params=dict(kind='agency',through_page='2'))]
    for phase in ['before','after']:
        options=dict(fact_encoding='columns-v1')
        if phase=='after':options.update(screen_encoding='screen-aggregate-v1',panels=panels)
        call=f"public.internal_analytics_read_snapshot('{scope}',true,p_user=>u.id,p_session=>u.session_id,p_options=>'{json.dumps(options)}')"
        for i in range(iterations):
            for mode in ['direct','postgrest']:
                expr=call+'::text' if mode=='direct' else f"(select coalesce((json_agg(t.s)->0)::text,'null') from (select {call} s) t)"
                sql+=f"""set statement_timeout='180s';
do $measure$ declare started timestamptz; result text; elapsed numeric; u record;
begin
 select * into u from cohort_users where idx=1;
 started:=clock_timestamp(); result:={expr}; elapsed:=extract(epoch from clock_timestamp()-started)*1000;
 insert into measurements values(json_build_object('phase','{phase}','mode','{mode}','iteration',{i},'ms',elapsed,'bytes',octet_length(result::text)));
 {'insert into payloads values(\''+phase+'\',result::json);' if i==0 and mode=='postgrest' else ''}
end $measure$;
select 'MEASURE:'||value::text from measurements;truncate measurements;
"""
    if plans:
        sql+="set statement_timeout='180s';set client_min_messages=log;load 'auto_explain';set auto_explain.log_min_duration=10;set auto_explain.log_nested_statements=on;set auto_explain.log_analyze=on;set auto_explain.log_buffers=on;set auto_explain.log_timing=off;"
        sql+=f"select octet_length({call}::text) from cohort_users u where idx=1;"
    sql+="select 'MEASURE:'||value::text from measurements;select 'SOURCE:'||phase||':'||value::text from payloads;rollback;"
    started=time.monotonic()
    p=subprocess.run(['docker','exec','-i',DB,'psql','-X','-U','supabase_admin','-d','postgres','-qAt','-v','ON_ERROR_STOP=1'],input=sql,text=True,capture_output=True,timeout=1200)
    OUT.mkdir(parents=True,exist_ok=True);RUNTIME.mkdir(parents=True,exist_ok=True)
    (OUT/f'sql-{stem}.stderr.txt').write_text(p.stderr)
    rows=[]
    for line in p.stdout.splitlines():
        if line.startswith('MEASURE:'): rows.append(json.loads(line[8:]))
        if line.startswith('SOURCE:'):
            _,phase,value=line.split(':',2);path=RUNTIME/f'{stem}-{phase}.json';path.write_text(value);path.chmod(0o600)
    valid=p.returncode==0 and len(rows)==iterations*4
    (OUT/f'sql-{stem}.json').write_text(json.dumps(dict(synthetic=True,sql_sha256=hashlib.sha256((ROOT/'supabase/migrations/202610060900_screen_server_aggregate.sql').read_bytes()).hexdigest(),seed_rows=size,work_mem="2MB",profile=profile,scope=json.loads(scope),iterations=iterations,status='MEASURED' if valid else 'FAIL',exit_code=p.returncode,elapsed_seconds=time.monotonic()-started,samples=rows),indent=2)+'\n')
    print(json.dumps(dict(size=size,samples=len(rows),exit_code=p.returncode)))
    if not valid: raise RuntimeError(p.stderr[-2000:])

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--size',type=int,choices=[300,30000,60000],required=True);parser.add_argument('--iterations',type=int,choices=range(1,7),default=3)
    parser.add_argument('--profile',choices=['original','diverse'],default='diverse');parser.add_argument('--window',choices=['year','all'],default='year')
    parser.add_argument('--plans',action='store_true')
    a=parser.parse_args();run(a.size,a.iterations,a.profile,a.window,a.plans)
