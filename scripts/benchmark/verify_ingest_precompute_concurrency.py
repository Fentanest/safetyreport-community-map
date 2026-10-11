"""Real concurrent transactions in an owned disposable database; no production options."""
import json,subprocess,time
from pathlib import Path
import ingest_precompute as b

def begin_async(source):
    p=subprocess.Popen(['docker','exec','-i',b.DB,'psql','-X','-U','supabase_admin','-d','postgres','-qAt','-v','ON_ERROR_STOP=1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    p.stdin.write(source);p.stdin.close();p.stdin=None
    return p

def wait_marker(marker):
    for _ in range(100):
        if b.sql(f"select count(*) from pg_locks where locktype='advisory' and classid=2026100612 and objid={marker} and granted;").strip()=='1':return
        time.sleep(.02)
    raise RuntimeError('concurrency synchronization marker absent')
def finish(p):
    out,err=p.communicate(timeout=30)
    if p.returncode:raise RuntimeError(err[-2000:])
    return out

def main():
    owned=[];result={'status':'FAIL','synthetic':True,'checks':[]}
    try:
        b.start(owned);b.baseline();b.fixture(600)
        b.sql((b.ROOT/'supabase/migrations/202610061200_ingest_precompute.sql').read_text())
        while not json.loads(b.sql('select private.screen_precompute_backfill(250);'))['done']:pass
        b.sql('analyze private.screen_observations;analyze private.screen_month_rollups;')
        a=begin_async("""begin;
 update private.community_report_facts set status='accepted',payload_sha256=repeat('d',64),answer_accepted_at='2026-10-07T00:00:00Z' where source_report_id='synthetic-9';
 select pg_advisory_xact_lock(2026100612,1);select pg_sleep(2);commit;""")
        wait_marker(1)
        started=time.monotonic()
        c=begin_async("""begin;
 update private.community_report_facts set status='rejected',payload_sha256=repeat('e',64),answer_accepted_at='2026-10-08T00:00:00Z' where source_report_id='synthetic-10';
 commit;""")
        finish(a);finish(c)
        state=json.loads(b.sql("""select json_build_object('dirty',(select count(*) from private.screen_dirty_months),
 'winner',(select status from private.screen_observations where source_report_key=(select source_report_key from private.community_report_facts where source_report_id='synthetic-10') and is_representative),
 'contributions',(select contribution_count from private.screen_observations where source_report_key=(select source_report_key from private.community_report_facts where source_report_id='synthetic-10') and is_representative))"""))
        assert state==dict(dirty=0,winner='rejected',contributions=2),state
        assert time.monotonic()-started>=1, 'writers did not overlap'
        result['checks'].append(dict(name='concurrent same identity writes + automatic deferred COMMIT flush',passed=True,**state))
        for phase in ['legacy','after']:
            (b.RUNTIME/f'concurrency-{phase}.json').write_text(b.sql(b.call(phase,'all')+';'))
        # The materialized CTE establishes the read snapshot before the marker. A real write commits
        # during pg_sleep; both STABLE RPC invocations must still return the same complete packet.
        query=b.call('after','all')
        reader=begin_async(f"""begin;
 with first(v) as materialized ({query}), gate as materialized (
 select first.*,pg_advisory_xact_lock(2026100612,2),pg_sleep(2) from first)
 select json_build_object('before',gate.v::json,'after',({query})::json) from gate;
 commit;""")
        wait_marker(2)
        b.sql("update private.community_report_facts set status='partial',payload_sha256=repeat('f',64),answer_accepted_at='2026-10-09T00:00:00Z' where source_report_id='synthetic-10';")
        response=json.loads(next(line for line in finish(reader).splitlines() if line.startswith('{')))
        assert response['before']==response['after'], 'one statement saw two versions'
        later=json.loads(b.sql(query+';'))
        assert later['state']['dataset_version']!=response['before']['state']['dataset_version'], 'writer failed to commit during probe'
        assert later['aggregate']!=response['before']['aggregate'], 'writer did not change statistics'
        result['checks'].append(dict(name='STABLE single statement retains whole packet across concurrent commit',passed=True))
        result['status']='PASS'
    finally:
        if owned:b.command(['docker','rm','-f','-v',owned[0]])
        (b.OUT/'concurrency.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result))
if __name__=='__main__':main()
