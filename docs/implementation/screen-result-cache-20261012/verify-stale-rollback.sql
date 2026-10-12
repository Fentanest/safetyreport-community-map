-- Operator-only psql. ALL schema/data/cache changes roll back; no cron installation or commits.
-- Required variables: stale_migration (body WITHOUT BEGIN/COMMIT), cache_viewer, cache_session.
-- Use an eligible account and its active session. Never print either or a full RPC packet.
\set ON_ERROR_STOP on
\timing on
begin;
set local lock_timeout='3s';
set local statement_timeout='55s';
\i :stale_migration
select set_config('cm.verify.user', :'cache_viewer',true),
       set_config('cm.verify.session', :'cache_session',true) \gset
create temp table stale_results(label text,payload json);
create function pg_temp.stale_read() returns json language sql volatile as $$
 select public.internal_analytics_screen_stale(jsonb_build_object('date_basis','completed_date','category','all',
 'start',(((statement_timestamp() at time zone 'Asia/Seoul')::date-interval '1 year')::date+1)::text,
 'end',(statement_timestamp() at time zone 'Asia/Seoul')::date::text),'[{"path":"compare"}]',
 current_setting('cm.verify.user')::uuid,current_setting('cm.verify.session')::uuid);
$$;
create function pg_temp.assert_true(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'ASSERTION FAILED: %',label;end if;end $$;
-- Cache-only clearing is rolled back. May contend with cron/read writes; run off peak.
delete from private.screen_result_cache;
insert into stale_results values('cold',pg_temp.stale_read()),('warm',pg_temp.stale_read());
select pg_temp.assert_true((payload->'cache'->>'public_hit')::boolean and (payload->'cache'->>'personal_hit')::boolean,'warm hit') from stale_results where label='warm';
-- Simulated global upload version churn. Actual INSERT/UPDATE and concurrency are covered locally.
select private.community_bump_projection();
insert into stale_results values('global_churn',pg_temp.stale_read());
select pg_temp.assert_true((payload->'cache'->>'public_hit')::boolean and (payload->'cache'->>'personal_hit')::boolean,'unrelated version independence') from stale_results where label='global_churn';
-- Safely simulate the exact user revision produced by own fact mutation, without changing real facts.
insert into private.screen_user_revision(user_id,revision) values(current_setting('cm.verify.user')::uuid,1)
 on conflict(user_id) do update set revision=private.screen_user_revision.revision+1;
insert into stale_results values('own_change',pg_temp.stale_read());
select pg_temp.assert_true((payload->'cache'->>'public_hit')::boolean and not (payload->'cache'->>'personal_hit')::boolean,'own change immediate') from stale_results where label='own_change';
update private.screen_result_cache set created_at=statement_timestamp()-interval '179 seconds' where slot<32;
insert into stale_results values('within_age',pg_temp.stale_read());
select pg_temp.assert_true((payload->'cache'->>'public_hit')::boolean,'within 180 seconds') from stale_results where label='within_age';
update private.screen_result_cache set created_at=statement_timestamp()-interval '181 seconds' where slot<32;
insert into stale_results values('expired',pg_temp.stale_read());
select pg_temp.assert_true(not (payload->'cache'->>'public_hit')::boolean,'past 180 seconds') from stale_results where label='expired';
savepoint policy_check;
update private.community_policy_disclosures set amounts_public=not amounts_public;
insert into stale_results values('policy',pg_temp.stale_read());
select pg_temp.assert_true(not (payload->'cache'->>'public_hit')::boolean and not (payload->'cache'->>'personal_hit')::boolean,'policy immediate invalidation') from stale_results where label='policy';
rollback to policy_check;
savepoint withdrawal_check;
update private.community_consent_grants set revoked_at=clock_timestamp() where user_id=current_setting('cm.verify.user')::uuid and revoked_at is null;
insert into stale_results values('withdrawn',pg_temp.stale_read());
select pg_temp.assert_true(payload->>'public_aggregate' is null,'withdrawal denies cached data') from stale_results where label='withdrawn';
rollback to withdrawal_check;
-- Maintenance is never skipped just because the source changed within the last 5 seconds.
update private.screen_result_cache set created_at=statement_timestamp()-interval '61 seconds' where slot in(0,1);
update private.analytics_state set source_updated_at=clock_timestamp();
select private.screen_cache_maintain() as refreshed_scopes;
select pg_temp.assert_true(not has_function_privilege('anon','public.internal_analytics_screen_stale(jsonb,jsonb,uuid,uuid)','execute'),'anon denied');
select pg_temp.assert_true(not has_table_privilege('service_role','private.screen_user_revision','select'),'private table denied');
select label,payload->'cache' as cache,payload->'snapshots' as snapshots,
 octet_length((payload->'public_aggregate')::text) as public_bytes,
 octet_length((payload->'personal_aggregate')::text) as personal_bytes from stale_results;
select slot,created_at,expires_at,octet_length(payload::text) as bytes from private.screen_result_cache order by slot;
rollback;
