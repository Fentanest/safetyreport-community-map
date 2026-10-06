"""One owned, resource-limited disposable PostgreSQL. No DSN, production URL or deployment options.
Schema is copied read-only under ci0926's flock and cached. Policies and facts are synthetic;
region reference rows come from the checked-in migration.
Restart measurements clear PostgreSQL shared buffers only: host page cache is NOT claimed cold.
"""
import argparse,fcntl,hashlib,json,re,subprocess,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
DB='astra-precompute-pg'
IMAGE='public.ecr.aws/supabase/postgres:17.6.1.171'
OUT=ROOT/'docs/implementation/ingest-precompute-20261006/evidence'
RUNTIME=ROOT/'.agent-runtime/ingest-precompute'
from screen_snapshot_timeout import seed

def command(args,**kwargs):
    return subprocess.run(args,check=True,capture_output=True,text=True,**kwargs)
def sql(source):
    return command(['docker','exec','-i',DB,'psql','-X','-U','supabase_admin','-d','postgres','-qAt','-v','ON_ERROR_STOP=1'],input=source,timeout=600).stdout

def start(owned):
    # Do not reuse/remove a pre-existing name, even if it has our task label.
    if subprocess.run(['docker','inspect',DB],capture_output=True).returncode==0:
        raise RuntimeError(f'{DB} already exists; no changes made')
    created=command(['docker','run','--name',DB,'--label','community-map-task=ingest-precompute-20261006',
      '--cpus=1','--memory=1g','--shm-size=256m','-e','POSTGRES_HOST_AUTH_METHOD=trust','-d',IMAGE,
      'postgres','-D','/var/lib/postgresql/data','-c','shared_buffers=224MB','-c','work_mem=2MB',
      '-c','max_parallel_workers_per_gather=1','-c','max_connections=60','-c','jit=off'])
    owned.append(created.stdout.strip())
    for _ in range(120):
        logs=command(['docker','logs','--tail','100',DB])
        if 'PostgreSQL init process complete' in logs.stdout+logs.stderr:break
        time.sleep(.5)
    else:raise RuntimeError('PostgreSQL initialization did not finish')
    ready()
def ready():
    for _ in range(120):
        try:
            if sql('select 1;').strip()=='1':return
        except (subprocess.CalledProcessError,subprocess.TimeoutExpired):pass
        time.sleep(.5)
    raise RuntimeError('disposable PostgreSQL did not become ready')
def baseline(apply_recent=True):
    OUT.mkdir(parents=True,exist_ok=True);RUNTIME.mkdir(parents=True,exist_ok=True)
    sql('drop schema if exists private cascade; drop schema if exists auth cascade; drop schema if exists public cascade; create extension if not exists pgcrypto with schema extensions;')
    cache=RUNTIME/'schema.sql'
    if not cache.exists():
        with open('/tmp/ci0926-db.lock','a') as lock:
            # A busy shared stack must not create an unbounded background waiter.
            deadline=time.monotonic()+30
            while True:
                try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB);break
                except BlockingIOError:
                    if time.monotonic()>deadline:raise RuntimeError('ci0926 lock busy and no cached baseline schema')
                    time.sleep(.2)
            schema=command(['docker','exec','supabase_db_ci0926-int','pg_dump','-U','supabase_admin','-d','postgres',
                '--schema-only','--no-owner','--no-acl','--schema=private','--schema=public','--schema=auth']).stdout
            cache.write_text(schema);cache.chmod(0o600)
    sql(cache.read_text())
    # Synthetic policy identities; publication flags match the checked-in policy migrations.
    # No user data, policy secrets or operational analytics_state are copied.
    sql("""insert into private.community_policies(version,consent_text_sha256)
 select v,repeat('a',64) from unnest(array['2026-09-26.1','2026-09-28.1','2026-09-28.2','2026-09-28.3']) v;
 insert into private.community_policy_current(singleton,version) values(true,'2026-09-28.3');
 insert into private.community_policy_disclosures(version,amounts_public,violation_law_public,rating_public)
 values('2026-09-28.1',true,false,false),('2026-09-28.2',true,true,false),('2026-09-28.3',true,true,true);
 insert into private.analytics_state(singleton,ready,source_updated_at,generated_at,published_at,dedupe_policy_version)
 values(true,true,now(),now(),now(),'contribution-dedupe-v1');""")
    # Schema-only dumps intentionally omit data. These four reference tables are REQUIRED for
    # SQL/JavaScript regional parity and are loaded from the repository's versioned registry.
    registry=(ROOT/'supabase/migrations/202610040300_analytics_rollups.sql').read_text()
    sql(registry[registry.index('insert into private.analytics_region_tokens'):registry.index('create function private.analytics_in_ring')])
    assert sql("select private.analytics_region('서울 중구',null,null);").strip()=='11140'
    (OUT/'baseline-schema.json').write_text(json.dumps(dict(schema_sha256=hashlib.sha256(cache.read_bytes()).hexdigest(),
        source='ci0926 schema-only dump captured under flock; cached, no rows',policies='synthetic identifiers, repository disclosure flags',
        region_registry='20260701 checked-in SQL reference rows'))+'\n')
    if apply_recent:
        for p in sorted((ROOT/'supabase/migrations').glob('20261006*.sql')):
            if p.name[:12]<='202610061000':sql(p.read_text())
def fixture(size):
    sql(seed(size).replace('create temp table cohort_users','create table public.cohort_users'))
    sql("""update private.community_report_facts f set
 address='합성 주소 '||(substring(source_report_id from '[0-9]+')::int%4507),
 agency_key='agency-'||(substring(source_report_id from '[0-9]+')::int%127),
 agency_name='합성 기관 '||(substring(source_report_id from '[0-9]+')::int%127),
 agency_current_name='합성 기관 '||(substring(source_report_id from '[0-9]+')::int%127),
 manager_key='manager-'||(substring(source_report_id from '[0-9]+')::int%1016),
 manager_name='합성 담당 '||(substring(source_report_id from '[0-9]+')::int%1016),
 violation_law='합성법 제'||(1+substring(source_report_id from '[0-9]+')::int%31)||'조',
 vehicle_raw='12가'||lpad((1000+substring(source_report_id from '[0-9]+')::int%8000)::text,4,'0');
 analyze private.community_report_facts;
 update private.analytics_state set ready=true,published_at=coalesce(published_at,now()),data_min=null,data_max=null;
 """)
    return json.loads(sql("""select json_build_object('facts',count(*),'places',count(distinct address),'agencies',count(distinct agency_key),
     'managers',count(distinct(agency_key,manager_key)),'laws',count(distinct violation_law),'vehicles',count(distinct vehicle_raw)) from private.community_report_facts;"""))
PANELS=[dict(id='entities',path='entities',params=dict(kind='agency')),dict(id='laws',path='laws',params={}),dict(id='compare',path='compare',params={}),
        dict(id='places',path='places',params=dict(view_bbox='126,36,129,39')),dict(id='prefix',path='entity-prefix',params=dict(kind='agency',through_page='2'))]
def call(phase,window):
    scope=dict(date_basis='completed_date',start='2025-10-07' if window=='year' else '2019-04-23',end='2026-10-06',category='all')
    encoding={'before':'screen-aggregate-v1','after':'screen-precompute-v1','legacy':'columns-v1'}[phase]
    opts=dict(screen_encoding=encoding,fact_encoding='columns-v1',panels=PANELS)
    rpc=f"public.internal_analytics_read_snapshot('{json.dumps(scope)}',true,p_user=>u.id,p_session=>u.session_id,p_options=>'{json.dumps(opts)}')"
    return f"select coalesce((json_agg(t.s)->0)::text,'null') from (select {rpc} s from public.cohort_users u where idx=1) t"
def measure_read(size,phase,window,iterations):
    query=call(phase,window);samples=[]
    for i in range(iterations+1):
        if i==0:
            command(['docker','restart',DB]);ready()
        row=json.loads(sql(f"""create temp table measurement(v json);
 do $$ declare started timestamptz;result text;elapsed numeric;begin
 started:=clock_timestamp();{query.replace('select coalesce','select coalesce',1)} into result;
 elapsed:=extract(epoch from clock_timestamp()-started)*1000;
 insert into measurement values(json_build_object('ms',elapsed,'bytes',octet_length(result)));
 end $$;select v from measurement;"""))
        row.update(iteration=i,cache='shared_buffers_cold_OS_cache_uncontrolled' if i==0 else 'warm');samples.append(row)
    payload=sql(query+';')
    path=RUNTIME/f'{size}-{window}-{phase}.json';path.write_text(payload);path.chmod(0o600)
    return dict(phase=phase,window=window,samples=samples)
def setup_ingest():
    sql("""update private.community_consent_grants set policy_version=p.version,consent_text_sha256=p.consent_text_sha256
 from private.community_policies p join private.community_policy_current c on c.version=p.version
 where user_id=(select id from public.cohort_users where idx=1) and revoked_at is null;
 insert into private.community_connections(connection_id,user_id,bound_session_id,connection_secret_sha256,source_app,source_mode,platform,device_label,dataset_key,writer_epoch)
 select md5('precompute-connection')::uuid,id,session_id,repeat('a',64),'safetyreport','server','linux','synthetic benchmark',repeat('a',64),100 from public.cohort_users where idx=1;
 """)
def capture_environment():
    host=json.loads(command(['docker','inspect',DB]).stdout)[0]['HostConfig']
    postgres=json.loads(sql("""select json_build_object('version',version(),
      'shared_buffers',current_setting('shared_buffers'),'work_mem',current_setting('work_mem'),
      'max_parallel_workers_per_gather',current_setting('max_parallel_workers_per_gather'),
      'max_connections',current_setting('max_connections'),'jit',current_setting('jit'),
      'read_function_settings',(select proconfig from pg_proc where oid='private.analytics_screen_precomputed(jsonb,uuid,jsonb)'::regprocedure),
      'write_function_settings',(select proconfig from pg_proc where oid='private.screen_refresh_keys(text[])'::regprocedure));"""))
    (OUT/'runtime-environment.json').write_text(json.dumps(dict(nano_cpus=host['NanoCpus'],
      memory_bytes=host['Memory'],shm_bytes=host['ShmSize'],postgres=postgres),indent=2)+'\n')
def measure_ingest(n):
    # Each measurement rolls back actual RPC writes. Validate durable event ACKs and fact count outside timer.
    return json.loads(sql(f"""begin;create temp table measured(v json);
 do $$ declare u record;events jsonb;env jsonb;result jsonb;started timestamptz;elapsed numeric;facts_before bigint;begin
 select * into u from public.cohort_users where idx=1;
 select jsonb_agg(jsonb_build_object('event_id',md5('precompute-event-'||g)::uuid,'source_report_key',md5('precompute-key-'||g)||md5('precompute-key-'||g),
 'source_report_id','BENCH-'||g,'source_revision',g,'writer_epoch',100,'event_type','completed_observation','captured_at',clock_timestamp(),
 'payload_sha256',md5('precompute-payload-'||g)||md5('precompute-payload-'||g),'payload',jsonb_build_object('synthetic',true,'status','accepted'),
 'derived',jsonb_build_object('public_state','completed','category','traffic','status','accepted','disposition','fine','amount_kind','fine',
 'amount_confirmed_won',50000,'report_date','2026-05-01','completed_date','2026-05-10','coord_source','geocode','lat',37.55,'lng',127.1,
 'address','합성 신규 주소','region_code','서울 중구','agency_key','bench-agency','agency_name','합성 기관','manager_key','bench-manager','manager_name','합성 담당','violation_law','합성법 제1조'))) into events from generate_series(1,{n}) g;
 env:=jsonb_build_object('connection_id',md5('precompute-connection')::uuid,'consent_grant_id',u.grant_id,
 'source_app','safetyreport','source_mode','server','trigger','manual');
 select count(*) into facts_before from private.community_report_facts;
 started:=clock_timestamp();result:=public.internal_community_ingest(u.id,u.session_id,'precompute-benchmark',env,events);
 set constraints all immediate; -- Include deferred rollup/COMMIT work in the write timer.
 elapsed:=extract(epoch from clock_timestamp()-started)*1000;
 if result ? 'error' or jsonb_array_length(result->'results')<>{n} or exists(select 1 from jsonb_array_elements(result->'results') e where e->>'status'<>'accepted' or not (e->>'durable')::boolean)
 then raise exception 'ingest benchmark ACK failed: %',result;end if;
 if (select count(*) from private.community_report_facts)<>facts_before+{n} then raise exception 'ingest wrote wrong count';end if;
 insert into measured values(json_build_object('events',{n},'ms',elapsed,'accepted',{n}));
 end $$;select v from measured;rollback;"""))
def run_size(size,iterations):
    baseline();diversity=fixture(size);setup_ingest();reads=[];writes=[]
    before_version=sql('select dataset_version from private.analytics_state where singleton;')
    for n in [1,20]:writes.append(dict(phase='before',**measure_ingest(n)))
    for window in ['year','all']:reads.append(measure_read(size,'before',window,iterations))
    # Legacy source is retained privately for independent full-packet parity.
    for window in ['year','all']:
        (RUNTIME/f'{size}-{window}-legacy.json').write_text(sql(call('legacy',window)+';'))
    migration=ROOT/'supabase/migrations/202610061200_ingest_precompute.sql';migration_bytes=migration.read_bytes();sql(migration_bytes.decode())
    start_time=time.monotonic();batches=[]
    while True:
        began=time.monotonic();r=json.loads(sql('select private.screen_precompute_backfill(250);'));r['wall_ms']=(time.monotonic()-began)*1000;batches.append(r)
        if r['done']:break
        if len(batches)%50==0:print(f'{size}: backfill {sum(b["keys"] for b in batches)} keys, {sum(b["months"] for b in batches)} months',flush=True)
    backfill_seconds=time.monotonic()-start_time
    sql('analyze private.screen_observations;analyze private.screen_month_rollups;')
    capture_environment()
    assert before_version==sql('select dataset_version from private.analytics_state where singleton;'), 'backfill changed dataset_version'
    for window in ['year','all']:reads.append(measure_read(size,'after',window,iterations))
    for n in [1,20]:writes.append(dict(phase='after',**measure_ingest(n)))
    storage=json.loads(sql("""select json_build_object('observations',(select count(*) from private.screen_observations),
 'rollup_rows',(select count(*) from private.screen_month_rollups),'observations_bytes',pg_total_relation_size('private.screen_observations'),
 'rollup_bytes',pg_total_relation_size('private.screen_month_rollups'))"""))
    result=dict(synthetic=True,size=size,architecture='x86_64 resource-limited; not production ARM',diversity=diversity,storage=storage,
        migration_sha256=hashlib.sha256(migration_bytes).hexdigest(),reads=reads,writes=writes,backfill_seconds=backfill_seconds,backfill_batches=batches,
        constraints=dict(cpus=1,memory_bytes=1073741824,shared_buffers='224MB',work_mem='2MB',max_parallel_workers_per_gather=1,jit='off'),
        cold_limit='Container restart clears shared_buffers. Host OS page cache not cleared.')
    (OUT/f'benchmark-{size}.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(dict(size=size,reads=reads,writes=writes,backfill_seconds=backfill_seconds)),flush=True)

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--sizes',nargs='+',type=int,choices=[35000,100000],default=[35000,100000]);p.add_argument('--iterations',type=int,choices=range(1,6),default=3);args=p.parse_args()
    OUT.mkdir(parents=True,exist_ok=True);RUNTIME.mkdir(parents=True,exist_ok=True)
    owned=[]
    try:
        start(owned)
        for n in args.sizes:run_size(n,args.iterations)
    except subprocess.CalledProcessError as error:
        # Synthetic SQL can contain private-shaped keys; keep raw errors in ignored runtime only.
        (RUNTIME/'benchmark-error.txt').write_text(error.stderr or str(error));raise RuntimeError('benchmark failed; see ignored runtime error') from None
    finally:
        if owned:
            command(['docker','rm','-f','-v',owned[0]]);(OUT/'container-cleanup.json').write_text(json.dumps(dict(container=DB,removed=True))+'\n')
if __name__=='__main__':main()
