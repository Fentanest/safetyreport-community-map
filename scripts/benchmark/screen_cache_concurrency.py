"""Disposable local PostgreSQL concurrency proof. No production connection or credentials.
Prerequisite: local supabase_db_ci0926-int (schema/policy fixtures only) + local postgres:17.6 image.
Creates/removes only the uniquely named cm-perf2-cache-test container; never publishes a port.
"""
import concurrent.futures, json, subprocess, time
from pathlib import Path
from screen_result_cache import setup
DB='cm-perf2-cache-test'
OUT=Path('/tmp/cm-cache-concurrency.json')
def command(args,**kw):
    p=subprocess.run(args,text=True,capture_output=True,**kw)
    if p.returncode: raise RuntimeError(p.stderr[-3000:])
    return p.stdout

def sql(query):
    return command(['docker','exec','-i',DB,'psql','-X','-U','postgres','-d','postgres','-qAt','-v','ON_ERROR_STOP=1'],input='set jit=off;\n'+query)
def rows(query):
    return [json.loads(l) for l in sql(query).splitlines() if l.startswith('{')]
def call(idx=1,start='2023-01-01'):
    scope=json.dumps(dict(date_basis='completed_date',start=start,end='2026-10-12',category='all'))
    return f"select public.internal_analytics_screen_cached('{scope}','[{{\"path\":\"compare\"}}]',id,session_id) from cohort_users where idx={idx};"

def canonical(packet):
    # Only top-level unordered collections. Positional tuples/histograms retain their exact order.
    return {k:sorted(v,key=lambda row:json.dumps(row,sort_keys=True)) if k in ('stats','anchors','full') else v for k,v in packet.items()}

def main():
    # Refuse to reuse/stop an unknown preexisting container.
    command(['docker','run','--name',DB,'--label','cm.perf-cache-test=true','--rm','-d','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17.6'])
    evidence={'synthetic':True,'isolated_container':DB,'checks':[]}
    try:
        for _ in range(60):
            if subprocess.run(['docker','exec',DB,'pg_isready','-h','127.0.0.1','-U','postgres'],capture_output=True).returncode==0:break
            time.sleep(.1)
        sql('create role anon;create role authenticated;create role service_role;create role supabase_admin superuser login;create role supabase_auth_admin;create role supabase_storage_admin;create role authenticator;')
        schema=command(['docker','exec','supabase_db_ci0926-int','pg_dump','-U','supabase_admin','-d','postgres','--schema-only','--no-owner','--no-privileges'])
        schema=schema.replace('CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;','').replace("COMMENT ON EXTENSION supabase_vault IS 'Supabase Vault Extension';",'')
        sql(schema)
        config=command(['docker','exec','supabase_db_ci0926-int','pg_dump','-U','supabase_admin','-d','postgres','--data-only','--no-owner','--no-privileges','-t','private.analytics_state','-t','private.community_policies','-t','private.community_policy_current','-t','private.community_policy_disclosures','-t','private.community_registry_state'])
        sql(config)
        # Only this disposable database commits synthetic data. Temp fixture users are made persistent for concurrency.
        sql(setup(1200).replace('create temp table cohort_users','create table public.cohort_users')+'commit;')
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            packets=list(pool.map(lambda i:rows(call(i))[0],[1,2,1,2]))
        Path('/tmp/cm-cache-concurrent-packets.json').write_text(json.dumps(packets))
        assert all(p['public_aggregate'] for p in packets)
        assert packets[0]['state']==packets[1]['state']
        assert canonical(packets[0]['public_aggregate'])==canonical(packets[1]['public_aggregate'])
        assert packets[0]['personal_aggregate']!=packets[1]['personal_aggregate']
        assert canonical(packets[0]['personal_aggregate'])==canonical(packets[2]['personal_aggregate'])
        assert rows(call())[0]['cache']['public_hit']
        evidence['checks'].append('four simultaneous cold requests, two accounts: common equality + personal isolation + subsequent hit')
        # Hold the exact cache slot from another connection. The current request must bypass its optional write, not wait.
        slot=int(sql("select public_slot from private.screen_cache_resolve('{\"date_basis\":\"completed_date\",\"start\":\"2023-01-01\",\"end\":\"2026-10-12\",\"category\":\"all\"}','[]',null,null,true);"))
        sql('truncate private.screen_result_cache;')
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            held=pool.submit(sql,f"begin;select pg_advisory_xact_lock(121300,{slot});select pg_sleep(3);rollback;")
            for _ in range(100):
                if sql(f"select count(*) from pg_locks where locktype='advisory' and classid=121300 and objid={slot} and granted;").strip()=='1':break
                time.sleep(.01)
            started=time.monotonic();p=rows(call())[0];elapsed=time.monotonic()-started
            assert p['public_aggregate'] and elapsed<2.5, f'cache write waited or query too slow: {elapsed:.3f}s'
            held.result()
        evidence['checks'].append({'nonblocking_slot_seconds':elapsed})
        # Force an update to commit between revision read and aggregation. STABLE snapshot must still yield the OLD packet.
        before=rows(call())[0]
        sql('truncate private.screen_result_cache;alter function private.analytics_screen_parts(jsonb,uuid,jsonb,text) rename to analytics_screen_parts_test_original;')
        sql("""create function private.analytics_screen_parts(p_scope jsonb,p_user uuid,p_panels jsonb,p_part text) returns json
        language plpgsql stable set search_path='' as $$begin perform pg_sleep(1);return private.analytics_screen_parts_test_original(p_scope,p_user,p_panels,p_part);end$$;""")
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            reading=pool.submit(rows,call())
            for _ in range(100):
                if sql("select count(*) from pg_stat_activity where wait_event='PgSleep';").strip()=='1':break
                time.sleep(.01)
            sql("update private.community_report_facts set status='accepted',disposition='fine' where contributor_id=(select id from cohort_users where idx=2);")
            during=reading.result()[0]
        assert during['state']==before['state'] and canonical(during['public_aggregate'])==canonical(before['public_aggregate'])
        assert sql('select count(*) from private.screen_result_cache;').strip()=='0'
        after=rows(call())[0]
        assert after['state']['dataset_version']!=before['state']['dataset_version']
        assert not after['cache']['public_hit']
        evidence['checks'].append('concurrent fact commit: one MVCC snapshot, old computation not saved, next call gets new version')
        # Export exact SQL packets for the real-browser synthetic replay (actual handler, no DB/auth/network timing claim).
        for window,start in [('all','2023-01-01'),('year','2025-10-13')]:
            Path(f'/tmp/cm-cache-browser-{window}.json').write_text(json.dumps(rows(call(start=start))[0]))
        evidence['status']='PASS'
    finally:
        command(['docker','stop',DB]);OUT.write_text(json.dumps(evidence,indent=2)+'\n')
    print(json.dumps(evidence))
if __name__=='__main__':main()
