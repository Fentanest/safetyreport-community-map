-- User decision 2026-10-14: analytics must not reject or truncate a cohort at 100,000 rows.
-- Patch only the row-admission guards of the installed implementations. This preserves
-- deployment-specific projection fixes, function signatures, owner, ACL and SET options.
-- Cache/precompute functions are optional on older deployments; core paths are required.
begin;
set local lock_timeout='3s';
do $migration$
declare signature text; target regprocedure; definition text; updated text;
begin
 foreach signature in array array[
  'private.analytics_cohort_payload(text,date,date,boolean,text,text,text,text,double precision[],boolean)',
  'public.internal_analytics_v2_facts(date,date,text,text,text,text,double precision[])',
  'private.analytics_screen_aggregate(jsonb,uuid,jsonb)',
  'private.analytics_screen_aggregate_v2(jsonb,uuid,jsonb)',
  'private.analytics_screen_parts(jsonb,uuid,jsonb,text)',
  'private.analytics_screen_precomputed(jsonb,uuid,jsonb)'
 ] loop
  target:=to_regprocedure(signature);
  if target is null then
   if signature in ('private.analytics_screen_parts(jsonb,uuid,jsonb,text)',
                    'private.analytics_screen_precomputed(jsonb,uuid,jsonb)') then continue; end if;
   raise exception 'Missing required analytics function: %',signature;
  end if;
  definition:=pg_get_functiondef(target);
  if definition not like '%100000%' and definition not like '%RESULT_TOO_LARGE%' then continue; end if;
  -- Keep the complete candidate history; do not introduce LIMIT, sampling or period narrowing.
  updated:=regexp_replace(definition,
   '\(select n\s*<=\s*100000 from budget\)', 'true', 'g');
  updated:=regexp_replace(updated,
   'if v_scoped\s*>\s*100000 or v_count\s*>\s*100000 then raise exception ''RESULT_TOO_LARGE'';\s*end if;', '', 'g');
  updated:=regexp_replace(updated,
   'if v_budget\s*>\s*100000 then raise exception ''RESULT_TOO_LARGE'';\s*end if;', '', 'g');
  -- Fail atomically on an unexpected implementation, rather than partially removing a guard.
  if updated=definition or updated like '%100000%' or updated like '%RESULT_TOO_LARGE%' then
   raise exception 'Unrecognized analytics row guard: %',signature;
  end if;
  updated:=replace(updated,'-- Do not rank or build any JSON if the whole-history row budget is exceeded.',
    '-- Retain every eligible history row before representative election.');
  execute updated;
 end loop;
end $migration$;
commit;
