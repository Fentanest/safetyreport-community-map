"""Local synthetic rollback-only result cache measurement. Fixed local container, no DSN accepted."""
import argparse, json, re, subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
def setup(size):
    names=[p.name for p in sorted((ROOT/'supabase/migrations').glob('202610060[1-9]00_*.sql')) if '0800_' not in p.name]
    names+=['202610061000_screen_aggregate_opt.sql','202610110100_five_categories.sql','202610121200_fine_estimate_columns.sql','202610121201_fine_estimate_ingest_aggregate.sql','202610121300_screen_result_cache.sql']
    sql='begin;\n'+'\n'.join(re.sub(r'^(begin|commit);\s*$','',(ROOT/'supabase/migrations'/n).read_text(),flags=re.M) for n in names)
    sql+='\n'+(ROOT/'tests/integration/helpers/cohort-timeout-seed.sql').read_text().replace('__SIZE__',str(size))
    # More than one address/plate; realistic serialization rather than a one-point compressed fixture.
    sql+="""
    alter table private.community_report_facts disable trigger user;
    update private.community_report_facts set address='합성 주소 '||(substring(source_report_id from '[0-9]+')::int%10000),
      vehicle_raw='12가'||lpad((1000+substring(source_report_id from '[0-9]+')::int%400)::text,4,'0');
    alter table private.community_report_facts enable trigger user;
    update private.analytics_state set ready=true,data_min=null,data_max=null;
    set statement_timeout='180s';
    """
    return sql

def measure(size, iterations):
    sql=setup(size)
    panels=json.dumps([dict(path='compare')])
    for window,start in [('year','2025-10-13'),('all','2023-01-01')]:
        scope=json.dumps(dict(date_basis='completed_date',start=start,end='2026-10-12',category='all'))
        for i in range(iterations):
            for phase in ['baseline','cold','hit','public-hit']:
                if phase=='baseline':
                    call=f"public.internal_analytics_read_snapshot('{scope}',true,p_user=>u.id,p_session=>u.session_id,p_options=>jsonb_build_object('screen_encoding','screen-aggregate-v2','panels','{panels}'::jsonb))"
                else:
                    call=f"public.internal_analytics_screen_cached('{scope}','{panels}',u.id,u.session_id)"
                if phase=='cold':sql+='truncate private.screen_result_cache;\n'
                if phase=='public-hit':sql+='delete from private.screen_result_cache where slot between 32 and 159;\n'
                sql+=f"""
                do $measure$ declare started timestamptz; result json; elapsed numeric; u record;
                begin
                  select * into u from cohort_users where idx=1;
                  started:=clock_timestamp();result:={call};elapsed:=extract(epoch from clock_timestamp()-started)*1000;
                  raise notice 'MEASURE:%',json_build_object('window','{window}','phase','{phase}','iteration',{i},'ms',elapsed,'bytes',octet_length(result::text),'cache',result->'cache');
                end $measure$;
                """
    sql+='rollback;'
    p=subprocess.run(['docker','exec','-i','supabase_db_ci0926-int','psql','-X','-U','supabase_admin','-d','postgres','-qAt','-v','ON_ERROR_STOP=1'],input=sql,text=True,capture_output=True,timeout=1200)
    rows=[json.loads(line.split('MEASURE:',1)[1]) for line in p.stderr.splitlines() if 'MEASURE:' in line]
    if p.returncode:raise RuntimeError(p.stderr[-3000:])
    return dict(synthetic=True,size=size,iterations=iterations,postgres='local 17 (same version family; not production hardware/data)',rows=rows)
if __name__=='__main__':
    a=argparse.ArgumentParser(description=__doc__);a.add_argument('--size',type=int,choices=[1200,30000,90000],default=30000);a.add_argument('--iterations',type=int,choices=[1,2,3],default=3);a.add_argument('--output',type=Path,required=True);args=a.parse_args()
    result=measure(args.size,args.iterations);args.output.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
