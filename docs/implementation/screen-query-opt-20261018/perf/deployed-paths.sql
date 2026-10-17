\timing on
create temp table pl as select private.screen_place_key(private.screen_address(address)) place from private.community_report_facts where address is not null group by 1 order by count(*) desc limit 1;
\echo OLD_PUBLIC_MISS_ALL
select length(public.internal_analytics_screen_stale('{"date_basis":"completed_date","start":"2019-01-01","end":"2026-10-17","category":"all"}','[]',u.id,u.session_id)::text) from cohort_users u where idx=1;
\echo OLD_PIN_ON_HIT
select length(public.internal_analytics_screen_stale('{"date_basis":"completed_date","start":"2019-01-01","end":"2026-10-17","category":"all"}',jsonb_build_array(jsonb_build_object('id','focus','path','places/'||(select place from pl),'params','{}'::jsonb)),u.id,u.session_id)::text) from cohort_users u where idx=1;
\echo OLD_PERSONAL_ON_HIT
select length(public.internal_analytics_screen_stale('{"date_basis":"completed_date","start":"2019-01-01","end":"2026-10-17","category":"all"}','[{"id":"compare","path":"compare","params":{}}]',u.id,u.session_id)::text) from cohort_users u where idx=1;
\echo OLD_ALL_HIT
select length(public.internal_analytics_screen_stale('{"date_basis":"completed_date","start":"2019-01-01","end":"2026-10-17","category":"all"}','[{"id":"compare","path":"compare","params":{}}]',u.id,u.session_id)::text) from cohort_users u where idx=1;
update private.screen_result_cache set created_at=created_at-interval '600 seconds' where slot<32;
\echo OLD_AFTER_180S_NO_CHANGE
select length(public.internal_analytics_screen_stale('{"date_basis":"completed_date","start":"2019-01-01","end":"2026-10-17","category":"all"}','[]',u.id,u.session_id)::text) from cohort_users u where idx=1;
