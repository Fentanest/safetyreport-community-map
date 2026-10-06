import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const sql = (text: string) => execFileSync('docker', ['exec', '-i', 'supabase_db_ci0926-int', 'psql', '-X', '-U', 'supabase_admin', '-d', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1'], { input: text, encoding: 'utf8' }).trim();
describe.skipIf(process.env.COMMUNITY_STACK !== '1')('SQL screen snapshot boundary', () => {
  it('keeps read functions stable and inaccessible to browser database roles', () => {
    expect(sql(`select provolatile::text || '|' || prosecdef::text || '|' || coalesce(array_to_string(proconfig,','),'') from pg_proc
      where oid='public.internal_analytics_read_snapshot(jsonb,boolean,text,jsonb,uuid,uuid)'::regprocedure;`)).toBe('s|true|search_path=""');
    expect(sql(`select has_function_privilege('anon','public.internal_analytics_read_snapshot(jsonb,boolean,text,jsonb,uuid,uuid)','execute'),
      has_function_privilege('authenticated','public.internal_analytics_read_snapshot(jsonb,boolean,text,jsonb,uuid,uuid)','execute'),
      has_function_privilege('service_role','public.internal_analytics_read_snapshot(jsonb,boolean,text,jsonb,uuid,uuid)','execute');`)).toBe('f|f|t');
  });
  it.skipIf(process.env.SNAPSHOT_CONCURRENT_PROBE !== '1')('holds state and facts fixed while real ingest commits during a delayed stable call', () => {
    const scope = `'{"date_basis":"completed_date","start":"2024-01-01","end":"2028-12-31","category":"all"}'::jsonb`;
    const lines = sql(`begin;
      create function pg_temp.snapshot_probe() returns jsonb language plpgsql stable as $$
      declare before_version text; before_count integer; result jsonb;
      begin
        before_version:=public.internal_analytics_cohort_state()->>'dataset_version';
        before_count:=jsonb_array_length(public.internal_analytics_cohort_facts('completed_date','2024-01-01','2028-12-31',true,'all',null,null,null,null)::jsonb);
        perform pg_sleep(3);
        result:=public.internal_analytics_read_snapshot(${scope},true);
        return jsonb_build_object('before_version',before_version,'snapshot_version',result->'state'->>'dataset_version',
          'before_count',before_count,'snapshot_count',jsonb_array_length(result->'facts'));
      end $$;
      select pg_temp.snapshot_probe();
      select jsonb_build_object('outside_version',public.internal_analytics_cohort_state()->>'dataset_version');
      rollback;`).split('\n').filter(s => s.startsWith('{')).map(s => JSON.parse(s));
    expect(lines).toHaveLength(2);
    expect(lines[0].before_version).toBe(lines[0].snapshot_version);
    expect(lines[0].before_count).toBe(lines[0].snapshot_count);
    expect(lines[1].outside_version).not.toBe(lines[0].snapshot_version);
    const out = process.env.SNAPSHOT_PROBE_OUT;
    if (out) writeFileSync(out, JSON.stringify(lines, null, 2) + '\n');
  }, 30000);
});
