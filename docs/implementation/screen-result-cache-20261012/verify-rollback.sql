-- OPERATOR ONLY. This agent did not run this against production.
-- psql -X -v ON_ERROR_STOP=1 -v cache_migration=/tmp/cm-cache-migration-body.sql \
--   -v cache_viewer=<existing eligible UUID> -v cache_session=<its active session UUID> -f verify-rollback.sql
-- The migration BODY must have its top-level BEGIN/COMMIT removed; see REPORT.md.
\set ON_ERROR_STOP on
\timing on
begin;
\i :cache_migration
set local statement_timeout='120s';
create temp table cache_probe_context as
select :'cache_viewer'::uuid as uid, :'cache_session'::uuid as sid;
create temp table cache_probe_results(phase text,period text,value json,elapsed_ms numeric);
create temp table cache_probe_scopes as
select 'year' as period,jsonb_build_object('date_basis','completed_date','category','all',
 'start',(((statement_timestamp() at time zone 'Asia/Seoul')::date-interval '1 year')::date+1)::text,
 'end',(statement_timestamp() at time zone 'Asia/Seoul')::date::text) as scope
union all
select 'all',jsonb_build_object('date_basis','completed_date','category','all',
 'start',s->'basis_bounds'->'completed_date'->>'min','end',s->'basis_bounds'->'completed_date'->>'max')
from (select public.internal_analytics_cohort_state() s) a;
-- Only timings/aggregate booleans are printed; no raw or private packets.
create function pg_temp.cache_probe(p_phase text) returns void language plpgsql as $$
declare context record; selected record; started timestamptz; result json; elapsed numeric;
begin
 select * into context from cache_probe_context;
 for selected in select * from cache_probe_scopes order by period loop
  started:=clock_timestamp();
  if p_phase='baseline' then
   result:=public.internal_analytics_read_snapshot(selected.scope,true,p_user=>context.uid,p_session=>context.sid,
    p_options=>'{"screen_encoding":"screen-aggregate-v2","panels":[{"path":"compare"}]}');
  else
   result:=public.internal_analytics_screen_cached(selected.scope,'[{"path":"compare"}]',context.uid,context.sid);
  end if;
  elapsed:=extract(epoch from clock_timestamp()-started)*1000;
  insert into cache_probe_results values(p_phase,selected.period,result,elapsed);
 end loop;
end $$;
select pg_temp.cache_probe('baseline');
select pg_temp.cache_probe('miss');
select pg_temp.cache_probe('hit');
select phase,period,elapsed_ms,value->'cache' as cache,octet_length(value::text) as bytes from cache_probe_results;
-- Compare unordered internal collections, preserving every metric and every positional tuple.
create function pg_temp.cache_canonical(a jsonb) returns jsonb language sql immutable as $$
 select (a-'stats'-'anchors'-'full')||jsonb_build_object(
  'stats',(select jsonb_agg(v order by v::text) from jsonb_array_elements(a->'stats') v),
  'anchors',(select jsonb_agg(v order by v::text) from jsonb_array_elements(a->'anchors') v),
  'full',(select jsonb_agg(v order by v::text) from jsonb_array_elements(a->'full') v));
$$;
select c.phase,c.period,
 (b.value->'state')::jsonb=(c.value->'state')::jsonb as same_state,
 pg_temp.cache_canonical((b.value->'aggregate')::jsonb)=pg_temp.cache_canonical(
 (c.value->'public_aggregate')::jsonb || jsonb_build_object(
  'stats',(c.value->'public_aggregate'->'stats')::jsonb||(c.value->'personal_aggregate'->'stats')::jsonb,
  'anchors',(c.value->'public_aggregate'->'anchors')::jsonb||(c.value->'personal_aggregate'->'anchors')::jsonb,
  'full',c.value->'personal_aggregate'->'full')) as exact_aggregate
from cache_probe_results c join cache_probe_results b on b.period=c.period and b.phase='baseline' where c.phase in ('miss','hit');
-- Public-only hit (first visit by an uncached user): remove only personal cache slots inside ROLLBACK.
delete from private.screen_result_cache where slot between 32 and 159;
select pg_temp.cache_probe('public-hit');
select phase,period,elapsed_ms,value->'cache' from cache_probe_results where phase='public-hit';
-- Gate is checked again on every hit, even without a dataset version change.
select (public.internal_analytics_screen_cached(scope,'[{"path":"compare"}]',uid,'00000000-0000-0000-0000-000000000000')->>'public_aggregate') is null as bad_session_denied
from cache_probe_scopes cross join cache_probe_context;
-- Isolate a disclosure-policy change and restore it with a savepoint. Existing cached amount data must never survive it.
savepoint disclosure;
update private.community_policy_disclosures set amounts_public=false;
select public.internal_analytics_screen_cached(scope,'[{"path":"compare"}]',uid,sid)->'cache' as invalidated
from cache_probe_scopes cross join cache_probe_context;
rollback to disclosure;
-- Own consent revocation must return no public/personal data, even with a populated cache.
savepoint revoke_consent;
update private.community_consent_grants set revoked_at=clock_timestamp() where user_id=(select uid from cache_probe_context);
select (public.internal_analytics_screen_cached(scope,'[{"path":"compare"}]',uid,sid)->>'public_aggregate') is null as revoked_denied
from cache_probe_scopes cross join cache_probe_context;
rollback to revoke_consent;
-- Default prewarm, ACL, bounded storage. Real job scheduling is outside this rollback verification.
select private.screen_cache_maintain();
select count(*) as slots,sum(octet_length(payload::text)) as live_payload_bytes from private.screen_result_cache;
select has_function_privilege('anon','public.internal_analytics_screen_cached(jsonb,jsonb,uuid,uuid)','execute') as anon_must_be_false,
 has_function_privilege('authenticated','public.internal_analytics_screen_cached(jsonb,jsonb,uuid,uuid)','execute') as authenticated_must_be_false,
 has_table_privilege('service_role','private.screen_result_cache','select') as table_must_be_false;
rollback;
