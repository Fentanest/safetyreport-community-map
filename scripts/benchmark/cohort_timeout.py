"""Rollback-only cohort RPC parity/latency/EXPLAIN on the existing LOCAL Docker stack.
No DSN, remote host, secrets or production data. Run sequentially with other DB tests.
  python3 scripts/benchmark/cohort_timeout.py --sizes 3000 30000 --out <directory>
"""
import argparse
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
OLD = ROOT / 'supabase/migrations/202610010100_single_date_cohort.sql'
NEW = ROOT / 'supabase/migrations/202610060100_cohort_facts_setwise.sql'
DB = 'supabase_db_ci0926-int'


def function(source, name):
    return re.search(r'create or replace function public\.' + name + r'\([\s\S]*?\$\$;', source).group()


def strip_transaction(source):
    return re.sub(r'^(begin|commit);\s*$', '', source, flags=re.M)


def cases():
    scopes = [
        ('all', '2023-01-01', '2026-10-01', 'all', None, None, None, None),
        ('year', '2025-01-01', '2025-12-31', 'all', None, None, None, None),
        ('month', '2026-06-01', '2026-06-30', 'all', None, None, None, None),
        ('agency', '2023-01-01', '2026-10-01', 'all', None, 'agency-1', None, None),
        ('manager', '2023-01-01', '2026-10-01', 'all', None, 'agency-1', 'manager-1', None),
        ('bbox', '2023-01-01', '2026-10-01', 'all', None, None, None, 'array[127.1,37.1,127.3,37.3]::double precision[]'),
        ('category-region', '2023-01-01', '2026-10-01', 'traffic', '서울 중구', None, None, None),
        ('empty', '2040-01-01', '2040-01-31', 'all', None, None, None, None),
    ]
    for basis in ['report_date', 'completed_date']:
        for previous in [False, True]:
            for label, start, end, category, region, agency, manager, bbox in scopes:
                args = ','.join([quote(basis), quote(start), quote(end), str(previous).lower(), quote(category), quote(region), quote(agency), quote(manager), bbox or 'null'])
                yield f'{basis}/{previous}/{label}', args


def quote(value):
    return 'null' if value is None else "'" + value.replace("'", "''") + "'"


def run(size, out, mode, personal_only=False):
    original = function(OLD.read_text(), 'internal_analytics_cohort_facts').replace('public.internal_analytics_cohort_facts(', 'pg_temp.cohort_before(')
    personal = function(OLD.read_text(), 'internal_my_analytics_cohort_source').replace('public.internal_my_analytics_cohort_source(', 'pg_temp.personal_before(').replace('public.internal_analytics_cohort_facts(', 'pg_temp.cohort_before(')
    seed = (ROOT / 'tests/integration/helpers/cohort-timeout-seed.sql').read_text().replace('__SIZE__', str(size))
    script = 'begin;\n' + seed + '\n' + original + '\n' + personal + '\n' + strip_transaction(NEW.read_text())
    script += f"\nset plan_cache_mode={mode};set statement_timeout='60s';set application_name='cohort-timeout-local';\n"
    script += "create temp table cohort_results(label text,before_ms numeric,after_ms numeric,equal boolean,n integer,bytes integer);\n"
    for label, args in ([] if personal_only else cases()):
        # One top-level statement per pair. Exact JSONB equality preserves array order and every field.
        script += f"""
set statement_timeout='60s';
do $measure$ declare started timestamptz; old jsonb; new jsonb; old_ms numeric; new_ms numeric;
begin
 started:=clock_timestamp(); old:=pg_temp.cohort_before({args}); old_ms:=extract(epoch from clock_timestamp()-started)*1000;
 started:=clock_timestamp(); new:=public.internal_analytics_cohort_facts({args}); new_ms:=extract(epoch from clock_timestamp()-started)*1000;
 insert into cohort_results values ({quote(label)},old_ms,new_ms,old=new,jsonb_array_length(new),octet_length(new::text));
end $measure$;
select row_to_json(r) from cohort_results r where label={quote(label)};
"""
    # Authenticated personal source shares the same facts path; failed session must still return no facts.
    for valid in [True, False]:
        args = "'completed_date','2023-01-01','2026-10-01',false,'all',null,null,null,null"
        session = 'u.session_id' if valid else "'00000000-0000-0000-0000-000000000000'::uuid"
        script += f"""set statement_timeout='60s';
do $measure$ declare started timestamptz; old jsonb; new jsonb; old_ms numeric; new_ms numeric; u record;
begin
 select * into u from cohort_users where idx=1;
 started:=clock_timestamp(); old:=pg_temp.personal_before(u.id,{session},{args}); old_ms:=extract(epoch from clock_timestamp()-started)*1000;
 started:=clock_timestamp(); new:=public.internal_my_analytics_cohort_source(u.id,{session},{args}); new_ms:=extract(epoch from clock_timestamp()-started)*1000;
 insert into cohort_results values ('personal/{valid}',old_ms,new_ms,old=new,jsonb_array_length(new->'facts'),octet_length(new::text));
end $measure$;
select row_to_json(r) from cohort_results r where label='personal/{valid}';
"""
    script += """set statement_timeout='60s';set client_min_messages=log;load 'auto_explain';
set auto_explain.log_min_duration=10;set auto_explain.log_nested_statements=on;set auto_explain.log_analyze=on;
set auto_explain.log_buffers=on;set auto_explain.log_parameter_max_length=0;
"""
    for name in ['pg_temp.cohort_before', 'public.internal_analytics_cohort_facts']:
        script += f"set statement_timeout='60s';explain(analyze,buffers) select jsonb_array_length({name}('completed_date','2023-01-01','2026-10-01',false,'all',null,null,null,null));\n"
    script += 'rollback;\n'
    out.mkdir(parents=True, exist_ok=True)
    prefix = f'{size}-{mode}' + ('-personal' if personal_only else '')
    # Stream evidence to disk so failures retain all completed measurements, without printing synthetic facts.
    with (out / f'{prefix}.txt').open('w') as stdout, (out / f'{prefix}-plans.txt').open('w') as stderr:
        result = subprocess.run(['docker', 'exec', '-i', DB, 'psql', '-X', '-U', 'supabase_admin', '-d', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1'], input=script, text=True, stdout=stdout, stderr=stderr, timeout=1800)
    rows = [json.loads(line) for line in (out / f'{prefix}.txt').read_text().splitlines() if line.startswith('{')]
    (out / f'{prefix}.json').write_text(json.dumps({'synthetic': True, 'rows': size, 'mode': mode, 'exit_code': result.returncode, 'samples': rows}, ensure_ascii=False, indent=2)+'\n')
    if result.returncode or len(rows)!=(2 if personal_only else 34) or not all(r['equal'] for r in rows):
        raise RuntimeError(f'{size}/{mode}: exit={result.returncode}, samples={len(rows)}, mismatches={[r.get("label",r) for r in rows if not r["equal"]]}; see {out}')
    times = [r for r in rows if 'after_ms' in r]
    limit_ms = 1000 if size == 3000 else 4000
    if any(r['after_ms'] >= limit_ms for r in times):
        raise RuntimeError(f'{size}/{mode}: replacement exceeded the local {limit_ms}ms target; see {out}')
    print(json.dumps({'size':size,'mode':mode,'equal':len(rows),'before_max_ms':max(r['before_ms'] for r in times),'after_max_ms':max(r['after_ms'] for r in times)}), flush=True)


def timeout_probe(out):
    """Reproduce the 8s generic-plan failure; catch SQLSTATE 57014, then test the replacement."""
    seed = (ROOT / 'tests/integration/helpers/cohort-timeout-seed.sql').read_text().replace('__SIZE__', '30000')
    original = function(OLD.read_text(), 'internal_analytics_cohort_facts').replace('public.internal_analytics_cohort_facts(', 'pg_temp.cohort_before(')
    script = 'begin;' + seed + original + strip_transaction(NEW.read_text()) + """
set plan_cache_mode=force_generic_plan;
set statement_timeout='8s';
create temp table probe(phase text, sqlstate text, ms numeric, n integer);
do $$ declare t timestamptz:=clock_timestamp(); n integer;begin
 n:=jsonb_array_length(pg_temp.cohort_before('completed_date','2023-01-01','2026-10-01',false,'all',null,null,null,null));
 insert into probe values('before','00000',extract(epoch from clock_timestamp()-t)*1000,n);
exception when query_canceled then insert into probe values('before',SQLSTATE,extract(epoch from clock_timestamp()-t)*1000,null);end $$;
set statement_timeout='8s';
do $$ declare t timestamptz:=clock_timestamp(); n integer;begin
 n:=jsonb_array_length(public.internal_analytics_cohort_facts('completed_date','2023-01-01','2026-10-01',false,'all',null,null,null,null));
 insert into probe values('after','00000',extract(epoch from clock_timestamp()-t)*1000,n);end $$;
select row_to_json(p) from probe p;
rollback;
"""
    result = subprocess.run(['docker','exec','-i',DB,'psql','-X','-U','supabase_admin','-d','postgres','-qAt','-v','ON_ERROR_STOP=1'],input=script,text=True,capture_output=True,timeout=120)
    out.mkdir(parents=True, exist_ok=True)
    (out/'generic-timeout.txt').write_text(result.stdout+result.stderr)
    rows=[json.loads(line) for line in result.stdout.splitlines() if line.startswith('{')]
    if result.returncode or len(rows)!=2 or rows[0]['sqlstate']!='57014' or rows[1]['sqlstate']!='00000' or rows[1]['ms']>=8000:
        raise RuntimeError(f'timeout reproduction failed; see {out}/generic-timeout.txt')
    print(json.dumps({'generic_timeout_probe':rows}),flush=True)


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sizes',type=int,nargs='+',default=[3000,30000],choices=[3000,30000])
    parser.add_argument('--out',type=Path,default=ROOT/'.agent-runtime/cohort-timeout/benchmark')
    parser.add_argument('--plan-mode',choices=['auto','force_generic_plan','force_custom_plan'],default='auto')
    parser.add_argument('--personal-only', action='store_true')
    parser.add_argument('--timeout-probe', action='store_true')
    args=parser.parse_args()
    if args.timeout_probe:
        timeout_probe(args.out)
        raise SystemExit(0)
    for size in args.sizes:
        run(size,args.out,args.plan_mode,args.personal_only)
