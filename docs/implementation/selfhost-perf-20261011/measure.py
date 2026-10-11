#!/usr/bin/env python3
"""Self-hosted Supabase read-path measurement (2026-10-11).

Read-only: every measured function is STABLE (no table writes). The only write this study performed was a separate
`ANALYZE`. Connection: LOCAL_SUPABASE_DB_URL from .env.supabase.local, passed to a throwaway psql container via the
environment; the URL, user ids and session ids are never written to stdout or result files.

usage: measure.py screen|other|concurrency|export|workmem|median|settings  (results -> raw/*.json next to this file)
"""
import json, os, re, subprocess, sys, time, statistics, threading
from pathlib import Path

HERE = Path(__file__).resolve().parent
RAW = HERE / 'raw'
REPO = Path(os.environ.get('MAP_REPO', '/home/better0101/projects/safetyreport-community-map'))
IMAGE = 'public.ecr.aws/supabase/postgres:17.6.1.171'


def load_env():
    env = {}
    for line in (REPO / '.env.supabase.local').read_text().splitlines():
        if '=' in line and not line.lstrip().startswith('#'):
            k, v = line.split('=', 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


ENV = load_env()


def psql(sql: str, vars: dict | None = None, timeout=600) -> str:
    args = ['timeout', str(timeout), 'docker', 'run', '--rm', '-i', '--network', 'host', '-e', 'PGURL', IMAGE,
            'sh', '-c', 'psql "$PGURL" -X -q -At -v ON_ERROR_STOP=1 "$@"', 'sh']
    for k, v in (vars or {}).items():
        args += ['-v', f'{k}={v}']
    p = subprocess.run(args, input=sql, text=True, capture_output=True, env={**os.environ, 'PGURL': ENV['LOCAL_SUPABASE_DB_URL']})
    if p.returncode:
        raise RuntimeError(re.sub(r'postgres(ql)?://\S+', '<url>', p.stderr)[-2000:])
    return p.stdout


def pick_viewer():
    # The gate-passing Kakao session whose contributor has the most public facts (worst case for the personal part).
    out = psql("""
with cand as (select s.user_id, s.id sid from auth.sessions s
  join auth.identities i on i.user_id=s.user_id and i.provider='kakao' where s.not_after is null or s.not_after>now()),
v as (select c.*, public.internal_analytics_viewer(c.user_id,c.sid) v from cand c)
select user_id, sid, (v->>'public_fact_count') from v
 where (v->>'user_ok')::boolean and (v->>'kakao')::boolean and (v->>'session')::boolean and v->>'contributor'='active'
   and (v->>'public_fact_count')::int>=10 order by (v->>'public_fact_count')::int desc limit 1;""")
    uid, sid, n = out.strip().split('|')
    return {'uid': uid, 'sid': sid}, int(n)


def bounds():
    return json.loads(psql("select public.internal_analytics_cohort_state()->'basis_bounds'").strip())


PANELS = [dict(id='entities', path='entities', params=dict(kind='agency')), dict(id='laws', path='laws', params={}),
          dict(id='compare', path='compare', params={}), dict(id='places', path='places', params=dict(view_bbox='126,36,129,39')),
          dict(id='prefix', path='entity-prefix', params=dict(kind='agency', through_page='2'))]


def scope(window, category, b):
    if window == 'all':
        start, end = b['completed_date']['min'], b['completed_date']['max']
    else:  # recentTwelveMonths() of src/domain/public.ts on 2026-10-11 KST
        start, end = '2025-10-12', '2026-10-11'
    return dict(date_basis='completed_date', start=start, end=end, category=category, region_code=None,
                agency_key=None, manager_key=None, bbox=None, law=None)


SNAP = "public.internal_analytics_read_snapshot(:'scope'::jsonb, true, null, :'opts'::jsonb, :'uid'::uuid, :'sid'::uuid)"
TEMP = "select temp_files, temp_bytes from pg_stat_database where datname=current_database();"


def explain_block(expr):
    return f"{TEMP}\nEXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) select octet_length(({expr})::text);\n{TEMP}\n"


def parse_explain(out):
    temps, plans, buf = [], [], None
    for l in out.splitlines():
        if buf is not None:
            buf.append(l)
            if l == ']':
                plans.append(json.loads('\n'.join(buf))[0]); buf = None
        elif l == '[':
            buf = [l]
        elif re.fullmatch(r'\d+\|\d+', l):
            temps.append([int(x) for x in l.split('|')])
    res = []
    for i, plan in enumerate(plans):
        t0, t1, node = temps[2 * i], temps[2 * i + 1], plan['Plan']
        res.append(dict(server_ms=round(plan['Execution Time'] + plan['Planning Time'], 1),
                        shared_hit=node.get('Shared Hit Blocks', 0), shared_read=node.get('Shared Read Blocks', 0),
                        temp_read=node.get('Temp Read Blocks', 0), temp_written=node.get('Temp Written Blocks', 0),
                        db_temp_files=t1[0] - t0[0], db_temp_bytes=t1[1] - t0[1]))
    return res


def timing_values(out):
    return [float(m) for m in re.findall(r'^Time: ([0-9.]+) ms', out, re.M)]


def fetch_block(expr, n):
    return '\\timing on\n\\o /dev/null\n' + f"select ({expr})::text;\n" * n + '\\o\n\\timing off\n'


def summarize(xs):
    return dict(n=len(xs), median=round(statistics.median(xs), 1), max=round(max(xs), 1), min=round(min(xs), 1)) if xs else None


def screen(cold_n=3, warm_n=5, fetch_n=3):
    viewer, facts = pick_viewer()
    b = bounds()
    cases = [(enc, w, c) for w in ('all', '12m') for c in ('all', 'parking') for enc in ('v1', 'v2')]
    def vars_for(enc, w, c):
        return {**viewer, 'scope': json.dumps(scope(w, c, b)),
                'opts': json.dumps(dict(fact_encoding='columns-v1', screen_encoding=f'screen-aggregate-{enc}', panels=PANELS))}
    result = dict(viewer_public_fact_count=facts, bounds=b, panels=PANELS, cases={})
    for enc, w, c in cases:
        result['cases'][f'{enc}|{w}|{c}'] = dict(encoding=enc, window=w, category=c, scope=scope(w, c, b),
                                                 cold=[], cold_fetch_ms=[], warm=[], warm_fetch_ms=[])
    # cold: a fresh backend per sample (empty plan/catalog cache, PL/pgSQL compile), round-robin across cases
    for r in range(cold_n):
        for enc, w, c in cases:
            k = f'{enc}|{w}|{c}'
            result['cases'][k]['cold'] += parse_explain(psql(explain_block(SNAP), vars_for(enc, w, c)))
            print('cold', r, k, result['cases'][k]['cold'][-1], flush=True)
    for r in range(2):
        for enc, w, c in cases:
            k = f'{enc}|{w}|{c}'
            result['cases'][k]['cold_fetch_ms'] += timing_values(psql(fetch_block(SNAP, 1), vars_for(enc, w, c)))
    # warm: one backend, one discarded call, then explain samples and full-payload client fetches
    for enc, w, c in cases:
        k = f'{enc}|{w}|{c}'
        sql = f"select octet_length(({SNAP})::text);\n" + explain_block(SNAP) * warm_n + fetch_block(SNAP, fetch_n)
        out = psql(sql, vars_for(enc, w, c))
        first, rest = out.split('\n', 1)
        result['cases'][k]['payload_bytes'] = int(first)
        result['cases'][k]['warm'] = parse_explain(rest)
        result['cases'][k]['warm_fetch_ms'] = timing_values(rest)
        print('warm', k, result['cases'][k]['payload_bytes'], [x['server_ms'] for x in result['cases'][k]['warm']],
              result['cases'][k]['warm_fetch_ms'], flush=True)
    for k, v in result['cases'].items():
        v['summary'] = dict(cold_server=summarize([x['server_ms'] for x in v['cold']]), cold_fetch=summarize(v['cold_fetch_ms']),
                            warm_server=summarize([x['server_ms'] for x in v['warm']]), warm_fetch=summarize(v['warm_fetch_ms']),
                            temp_written_max=max(x['temp_written'] for x in v['cold'] + v['warm']),
                            db_temp_bytes_max=max(x['db_temp_bytes'] for x in v['cold'] + v['warm']))
    (RAW / 'screen.json').write_text(json.dumps(result, indent=1, ensure_ascii=False) + '\n')


def other(n=3):
    viewer, _ = pick_viewer()
    b = bounds()
    q = dict(theme='reporters', metric='reports_count', period='all', start=None, end=None, month=None, date_basis='completed_date',
             category='all', min_reports=1, page=1, page_size=20, expected_version=None)
    exprs = {
        # statistics/query: getSnapshot(scope, {previous:false}) without kind/options -> full facts payload for Node
        'statistics_12m': ("public.internal_analytics_read_snapshot(:'scope12'::jsonb, false, null, '{}'::jsonb)", {}),
        'statistics_all': ("public.internal_analytics_read_snapshot(:'scopeall'::jsonb, false, null, '{}'::jsonb)", {}),
        # public-analytics laws rollup (narrow snapshot path)
        'rollup_laws_12m': ("public.internal_analytics_read_snapshot(:'scope12'::jsonb, false, 'laws', '{\"page\":1,\"page_size\":20,\"q\":\"\",\"sort\":{\"key\":\"completed_count\",\"dir\":\"desc\"}}'::jsonb)", {}),
        'rankings_default': ("public.internal_user_rankings(:'uid'::uuid, :'sid'::uuid, :'rq'::jsonb)", {}),
    }
    vars = {**viewer, 'scope12': json.dumps(scope('12m', 'all', b)), 'scopeall': json.dumps(scope('all', 'all', b)), 'rq': json.dumps(q)}
    result = {}
    for name, (expr, _) in exprs.items():
        cold = []
        for _ in range(2):
            cold += parse_explain(psql(explain_block(expr), vars))
        sql = f"select octet_length(({expr})::text);\n" + explain_block(expr) * n + fetch_block(expr, 2)
        out = psql(sql, vars)
        first, rest = out.split('\n', 1)
        warm = parse_explain(rest)
        result[name] = dict(payload_bytes=int(first), cold=cold, warm=warm, warm_fetch_ms=timing_values(rest),
                            summary=dict(cold_server=summarize([x['server_ms'] for x in cold]), warm_server=summarize([x['server_ms'] for x in warm]),
                                         warm_fetch=summarize(timing_values(rest))))
        print(name, result[name]['payload_bytes'], result[name]['summary'], flush=True)
    (RAW / 'other.json').write_text(json.dumps(result, indent=1, ensure_ascii=False) + '\n')


def sampler(stop, samples):
    cmd = ['timeout', '900', 'ssh', '-o', 'BatchMode=yes', ENV['LOCAL_SUPABASE_SSH_TARGET'],
           'while true; do echo "T $(date +%s.%N)"; free -m | awk \'/Mem:/{print "FREE",$3,$6}\'; '
           'docker stats --no-stream --format "DS {{.CPUPerc}} {{.MemUsage}}" supabase-db; done']
    p = subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, text=True)
    cur = {}
    for line in p.stdout:
        parts = line.split()
        if parts[0] == 'T':
            if cur: samples.append(cur)
            cur = {'t': float(parts[1])}
        elif parts[0] == 'FREE':
            cur['host_used_mb'], cur['host_cache_mb'] = int(parts[1]), int(parts[2])
        elif parts[0] == 'DS':
            cur['db_cpu_pct'] = float(parts[1].rstrip('%')); cur['db_mem'] = parts[2]
        if stop.is_set():
            p.terminate(); break


def concurrency(levels=(1, 2, 4), rounds=2):
    viewer, _ = pick_viewer()
    b = bounds()
    result = {}
    for enc in ('v1', 'v2'):
        vars = {**viewer, 'scope': json.dumps(scope('all', 'all', b)),
                'opts': json.dumps(dict(fact_encoding='columns-v1', screen_encoding=f'screen-aggregate-{enc}', panels=PANELS))}
        for k in levels:
            stop, samples = threading.Event(), []
            th = threading.Thread(target=sampler, args=(stop, samples), daemon=True); th.start()
            time.sleep(4)
            base = [dict(s) for s in samples]
            lat = []
            def worker():
                # one warm-up call per backend, then `rounds` measured full-payload fetches
                out = psql(f"select octet_length(({SNAP})::text);\n" + fetch_block(SNAP, rounds), vars)
                lat.extend(timing_values(out))
            t0 = time.time()
            ws = [threading.Thread(target=worker) for _ in range(k)]
            [w.start() for w in ws]; [w.join() for w in ws]
            wall = time.time() - t0
            time.sleep(3); stop.set(); th.join(timeout=20)
            during = [s for s in samples if t0 <= s.get('t', 0) <= t0 + wall]
            idle_used = min((s['host_used_mb'] for s in base if 'host_used_mb' in s), default=None)
            peak_used = max((s['host_used_mb'] for s in during if 'host_used_mb' in s), default=None)
            result[f'{enc}|x{k}'] = dict(encoding=enc, concurrency=k, latencies_ms=lat, summary=summarize(lat), wall_s=round(wall, 1),
                                        host_used_idle_mb=idle_used, host_used_peak_mb=peak_used,
                                        db_cpu_peak_pct=max((s.get('db_cpu_pct', 0) for s in during), default=None),
                                        samples=during)
            print(enc, k, result[f'{enc}|x{k}']['summary'], idle_used, peak_used, flush=True)
    (RAW / 'concurrency.json').write_text(json.dumps(result, indent=1, ensure_ascii=False) + '\n')


def function_def(name):
    return psql(f"select pg_get_functiondef('{name}(jsonb,uuid,jsonb)'::regprocedure);")


def workmem(levels=('4MB', '16MB', '32MB', '64MB', '128MB'), n=3):
    # Sensitivity only. v1 (no SET clause) follows the session's work_mem. v2 pins work_mem=16MB in its SET clause, so
    # its unchanged body is copied into a pg_temp function inside BEGIN ... ROLLBACK with only that value replaced;
    # nothing persists. Both call the aggregate directly (state/viewer gate excluded, ~ms).
    viewer, _ = pick_viewer()
    b = bounds()
    v1 = function_def('private.analytics_screen_aggregate')
    v2 = function_def('private.analytics_screen_aggregate_v2')
    assert "SET work_mem TO '16MB'" in v2
    result = {}
    for w in ('all', '12m'):
        vars = {**viewer, 'scope': json.dumps(scope(w, 'all', b)), 'panels': json.dumps(PANELS)}
        for jit in ('on', 'off'):
            for wm in levels:
                if jit == 'off' and wm not in ('4MB', '16MB', '64MB'):
                    continue
                for enc in ('v1', 'v2'):
                    if enc == 'v1':
                        pre, fn = f"set work_mem='{wm}'; set jit={jit};\n", 'private.analytics_screen_aggregate'
                    else:
                        body = v2.replace('CREATE OR REPLACE FUNCTION private.analytics_screen_aggregate_v2(',
                                          'CREATE FUNCTION pg_temp.v2_wm(').replace("SET work_mem TO '16MB'", f"SET work_mem TO '{wm}'")
                        body = body.replace(' SET search_path TO', f" SET jit TO '{jit}'\n SET search_path TO", 1)
                        pre, fn = 'begin;\n' + body.rstrip() + ';\n', 'pg_temp.v2_wm'
                    expr = f"{fn}(:'scope'::jsonb, :'uid'::uuid, :'panels'::jsonb)"
                    sql = pre + f"select octet_length(({expr})::text);\n" + explain_block(expr) * n + ('rollback;\n' if enc == 'v2' else '')
                    out = psql(sql, vars)
                    runs = parse_explain(out)
                    k = f'{enc}|{w}|wm={wm}|jit={jit}'
                    result[k] = dict(runs=runs, summary=summarize([x['server_ms'] for x in runs]),
                                     temp_bytes=max(x['db_temp_bytes'] for x in runs))
                    print(k, result[k]['summary'], result[k]['temp_bytes'], flush=True)
    (RAW / 'workmem.json').write_text(json.dumps(result, indent=1, ensure_ascii=False) + '\n')


def median_viewer():
    # Same all-period screen for the median gate-passing contributor (the default run uses the largest one).
    out = psql("""
with cand as (select s.user_id, s.id sid from auth.sessions s
  join auth.identities i on i.user_id=s.user_id and i.provider='kakao' where s.not_after is null or s.not_after>now()),
v as (select c.*, (public.internal_analytics_viewer(c.user_id,c.sid)->>'public_fact_count')::int n from cand c),
e as (select distinct on (user_id) * from v where n>=10 order by user_id)
select user_id, sid, n from e order by n offset (select count(*)/2 from e) limit 1;""")
    uid, sid, n = out.strip().split('|')
    b = bounds()
    res = {'viewer_public_fact_count': int(n), 'cases': {}}
    for enc in ('v1', 'v2'):
        vars = {'uid': uid, 'sid': sid, 'scope': json.dumps(scope('all', 'all', b)),
                'opts': json.dumps(dict(fact_encoding='columns-v1', screen_encoding=f'screen-aggregate-{enc}', panels=PANELS))}
        o = psql(f"select octet_length(({SNAP})::text);\n" + explain_block(SNAP) * 3, vars)
        runs = parse_explain(o)
        res['cases'][f'{enc}|all|all'] = dict(payload_bytes=int(o.split()[0]), runs=runs, summary=summarize([r['server_ms'] for r in runs]))
    (RAW / 'median-viewer.json').write_text(json.dumps(res, indent=1) + '\n')


def server_settings():
    names = ("'shared_buffers','work_mem','hash_mem_multiplier','maintenance_work_mem','effective_cache_size','max_connections',"
             "'statement_timeout','jit','max_parallel_workers_per_gather','random_page_cost','effective_io_concurrency','temp_buffers'")
    rows = psql(f"select name, setting, coalesce(unit,''), source from pg_settings where name in ({names}) order by 1;"
                "select 'role', rolname, array_to_string(rolconfig, ';'), '' from pg_roles where rolname in "
                "('authenticator','service_role','authenticated','anon') order by 2;"
                "select 'function', p.oid::regprocedure::text, array_to_string(p.proconfig, ';'), '' from pg_proc p where p.proname in "
                "('analytics_screen_aggregate','analytics_screen_aggregate_v2','internal_analytics_read_snapshot','internal_user_rankings',"
                "'internal_analytics_rollup','analytics_cohort_payload') order by 2;"
                "select 'version', version(), '', '';")
    (RAW / 'settings.txt').write_text(rows)


def export(dest=os.environ.get('SELFHOST_PERF_SOURCE_DIR', '')):
    # Real sources for tests/integration/selfhost-perf-replay.test.ts. They hold real (aggregated) data: keep them out of git.
    assert dest and not Path(dest).resolve().is_relative_to(HERE.parents[2]), 'SELFHOST_PERF_SOURCE_DIR outside the repo'
    Path(dest).mkdir(parents=True, exist_ok=True); os.chmod(dest, 0o700)
    viewer, _ = pick_viewer()
    b = bounds()
    cases = []
    for w in ('all', '12m'):
        for c in ('all', 'parking'):
            sc = scope(w, c, b)
            cases.append(dict(key=f'{w}-{c}', scope={k: v for k, v in sc.items() if v is not None}))
            for enc in ('v1', 'v2'):
                vars = {**viewer, 'scope': json.dumps(sc),
                        'opts': json.dumps(dict(fact_encoding='columns-v1', screen_encoding=f'screen-aggregate-{enc}', panels=PANELS))}
                f = Path(dest) / f'{w}-{c}-{enc}.json'
                f.write_text(psql(f"select ({SNAP})::text;", vars)); os.chmod(f, 0o600)
    (Path(dest) / 'cases.json').write_text(json.dumps(cases))


if __name__ == '__main__':
    RAW.mkdir(exist_ok=True)
    {'screen': screen, 'other': other, 'concurrency': concurrency, 'export': export, 'workmem': workmem, 'median': median_viewer, 'settings': server_settings}[sys.argv[1]]()
