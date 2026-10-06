"""Local Docker-only, rollback-only before/after SQL and plan benchmark.
Replays the approved map baseline through 060600 inside the transaction. No URL/DSN.
Back up the disposable ci0926-int database first and run DB checks sequentially.
"""
import argparse
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
DB = 'supabase_db_ci0926-int'
SCOPE = '{"date_basis":"completed_date","start":"2025-10-07","end":"2026-10-06","category":"all"}'
CANDIDATE = ROOT / 'supabase/migrations/202610060700_screen_fact_transport.sql'


def strip_tx(source):
    return re.sub(r'^(begin|commit);\s*$', '', source, flags=re.M)


def baseline():
    return '\n'.join(strip_tx(p.read_text()) for p in sorted((ROOT / 'supabase/migrations').glob('202610060*.sql')) if p.name < CANDIDATE.name)


def seed(size, concentrated=False):
    source = (ROOT / 'tests/integration/helpers/cohort-timeout-seed.sql').read_text()
    source = source.replace('__SIZE__', str(size)).replace("date '2023-01-01'", "date '2024-10-07'").replace('(k%1300)', '(k%640)')
    if concentrated:
        source = source.replace('u.idx=1+g%30', 'u.idx=1').replace("select u.id,repeat('a',64),md5", "select u.id,case when g%10=0 then repeat('b',64) else repeat('a',64) end,md5")
    return source


def script(size, mode, phase, iterations=6, plans=False, concentrated=False, export=False):
    direct = "public.internal_analytics_cohort_facts('completed_date','2025-10-07','2026-10-06',true,'all',null,null,null,null)"
    out = 'begin;\n' + baseline() + '\n' + seed(size, concentrated)
    # Save the complete legacy result once, before installing the candidate. Comparison is outside timing.
    out += f"\nset statement_timeout='90s'; set plan_cache_mode={mode};\ncreate temp table reference as select {direct} as facts;\n"
    if phase == 'after':
        out += strip_tx(CANDIDATE.read_text())
    out += """
create temp table screen_measurements(phase text, iteration int, ms numeric, sqlstate text, characters int, bytes int, facts int, parity boolean);
create temp table screen_source(value json);
"""
    calls = {'direct': direct}
    for label, auth in [('snapshot-no-viewer', ''), ('snapshot-viewer', ',p_user=>u.id,p_session=>u.session_id')]:
        encoding = ",p_options=>'{\"fact_encoding\":\"columns-v1\"}'::jsonb" if phase == 'after' else ''
        calls[label] = f"public.internal_analytics_read_snapshot('{SCOPE}'::jsonb,true{auth}{encoding})"
    for iteration in range(1, iterations + 1):
        for label, call in calls.items():
            extract = 'result' if label == 'direct' else "result->'facts'"
            if phase == 'after' and label != 'direct':
                decode = f"""columns:=result->'facts'->'columns';
                select coalesce(jsonb_agg(obj order by ord),'[]'::jsonb) into decoded from (
                  select r.ord,(select jsonb_object_agg(c.key,r.row->(c.n::int-1))
                    from jsonb_array_elements_text(columns) with ordinality c(key,n)) as obj
                  from jsonb_array_elements((result->'facts'->'rows')::jsonb) with ordinality r(row,ord)) d;"""
            else:
                decode = f'decoded:={extract};'
            out += f"""
set statement_timeout='90s';
do $measure$
declare started timestamptz:=clock_timestamp(); result json; elapsed numeric; u record; decoded jsonb; columns jsonb;
begin
 select * into u from cohort_users where idx=1;
 result:={call}; elapsed:=extract(epoch from clock_timestamp()-started)*1000;
 {decode}
 insert into screen_measurements values('{label}',{iteration},elapsed,'00000',length(result::text),octet_length(result::text),jsonb_array_length(decoded),decoded=(select facts from reference));
 {'insert into screen_source values(result);' if export and label == 'snapshot-viewer' and iteration == iterations else ''}
exception when query_canceled then
 insert into screen_measurements(phase,iteration,ms,sqlstate) values('{label}',{iteration},extract(epoch from clock_timestamp()-started)*1000,SQLSTATE);
end $measure$;
select row_to_json(r) from screen_measurements r where phase='{label}' and iteration={iteration};
"""
    if plans:
        out += """set client_min_messages=log; load 'auto_explain';
set auto_explain.log_min_duration=0; set auto_explain.log_nested_statements=on;
set auto_explain.log_analyze=on; set auto_explain.log_buffers=on; set auto_explain.log_parameter_max_length=0;
"""
        for label in ['direct', 'snapshot-no-viewer']:
            out += f"set statement_timeout='90s'; explain(analyze,buffers) select octet_length({calls[label]}::text);\n"
    if export:
        out += "select 'SOURCE:'||value::text from screen_source;\n"
    return out + 'rollback;\n'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--size', type=int, choices=[13035, 30000, 60000], default=30000)
    parser.add_argument('--plan-mode', choices=['auto', 'force_generic_plan', 'force_custom_plan'], default='auto')
    parser.add_argument('--phase', choices=['before', 'after'], required=True)
    parser.add_argument('--iterations', type=int, default=6)
    parser.add_argument('--plans', action='store_true')
    parser.add_argument('--concentrated', action='store_true')
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--source-out', type=Path, help='Synthetic private response; ignored local path only')
    parser.add_argument('--emit-sql', action='store_true')
    args = parser.parse_args()
    if not 1 <= args.iterations <= 10:
        parser.error('iterations must be 1..10')
    if args.source_out and not args.source_out.resolve().is_relative_to((ROOT / '.agent-runtime').resolve()):
        parser.error('source-out must be under ignored .agent-runtime')
    args.out.mkdir(parents=True, exist_ok=True)
    stem = f'{args.phase}-{args.size}-{args.plan_mode}' + ('-concentrated' if args.concentrated else '')
    source = script(args.size, args.plan_mode, args.phase, args.iterations, args.plans, args.concentrated, bool(args.source_out))
    if args.emit_sql:
        (args.out / f'{stem}.sql').write_text(source)
        print('SQL prepared; NOT_RUN')
        return
    summary = dict(synthetic=True, size=args.size, plan_mode=args.plan_mode, phase=args.phase, concentrated=args.concentrated, samples=[], status='FAIL')
    try:
        result = subprocess.run(['docker','exec','-i',DB,'psql','-X','-U','supabase_admin','-d','postgres','-qAt','-v','ON_ERROR_STOP=1'], input=source, text=True, capture_output=True, timeout=1900)
        lines = result.stdout.splitlines()
        (args.out / f'{stem}.txt').write_text('\n'.join(line for line in lines if not line.startswith('SOURCE:')) + '\n')
        (args.out / f'{stem}-plans.txt').write_text(result.stderr)
        if args.source_out:
            packets = [line[7:] for line in lines if line.startswith('SOURCE:')]
            if len(packets) != 1: raise RuntimeError('Missing synthetic source')
            args.source_out.parent.mkdir(parents=True, exist_ok=True)
            args.source_out.write_text(packets[0]); args.source_out.chmod(0o600)
        summary['exit_code'] = result.returncode
        summary['samples'] = [json.loads(line) for line in lines if line.startswith('{')]
        rows = summary['samples']
        if result.returncode or len(rows) != 3*args.iterations or not all(r['sqlstate']=='00000' and r['parity'] is True for r in rows):
            raise RuntimeError(f'Incomplete/failing run: exit={result.returncode}, samples={len(rows)}; inspect evidence')
        summary['status'] = 'MEASURED'
    finally:
        (args.out / f'{stem}.json').write_text(json.dumps(summary, indent=2)+'\n')
    print(json.dumps(dict(stem=stem,samples=len(rows),max_ms=max(r['ms'] for r in rows))))


if __name__ == '__main__':
    main()
