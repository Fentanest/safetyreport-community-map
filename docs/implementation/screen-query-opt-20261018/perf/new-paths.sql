\o /dev/null
select private.screen_fact_norm_put(f.contributor_id, f.dataset_key, f.source_report_key, f.address, f.vehicle_raw, f.violation_law, f.region_code, f.lat, f.lng) from private.community_report_facts f;
\o
analyze private.screen_fact_norm;
\timing on
\echo NORM_COMPLETE
select private.screen_norm_complete();
create temp table pl as select place from private.screen_fact_norm where place is not null group by place order by count(*) desc limit 1;
\echo PUBLIC_MISS_ALL
select length(public.internal_analytics_screen_stale('{"date_basis":"completed_date","start":"2019-01-01","end":"2026-10-17","category":"all"}','[]',u.id,u.session_id)::text) from cohort_users u where idx=1;
\echo PIN_ON_HIT_FIRST
select length(public.internal_analytics_screen_stale('{"date_basis":"completed_date","start":"2019-01-01","end":"2026-10-17","category":"all"}',jsonb_build_array(jsonb_build_object('id','focus','path','places/'||(select place from pl),'params','{}'::jsonb)),u.id,u.session_id)::text) from cohort_users u where idx=1;
\echo PIN_ON_HIT_AGAIN
select length(public.internal_analytics_screen_stale('{"date_basis":"completed_date","start":"2019-01-01","end":"2026-10-17","category":"all"}',jsonb_build_array(jsonb_build_object('id','focus','path','places/'||(select place from pl),'params','{}'::jsonb)),u.id,u.session_id)::text) from cohort_users u where idx=1;
\echo PERSONAL_RESTRICTED_ON_HIT
select length(public.internal_analytics_screen_stale('{"date_basis":"completed_date","start":"2019-01-01","end":"2026-10-17","category":"all"}','[{"id":"compare","path":"compare","params":{}}]',u.id,u.session_id)::text) from cohort_users u where idx=1;
\echo ALL_HIT
select length(public.internal_analytics_screen_stale('{"date_basis":"completed_date","start":"2019-01-01","end":"2026-10-17","category":"all"}','[{"id":"compare","path":"compare","params":{}}]',u.id,u.session_id)::text) from cohort_users u where idx=1;
update private.screen_result_cache set created_at=created_at-interval '600 seconds' where slot<32;
\echo RESTAMP
select length(public.internal_analytics_screen_stale('{"date_basis":"completed_date","start":"2019-01-01","end":"2026-10-17","category":"all"}','[]',u.id,u.session_id)::text) from cohort_users u where idx=1;
\echo PERSONAL_FULL_BOTH_MISS
delete from private.screen_result_cache;
select length(public.internal_analytics_screen_stale('{"date_basis":"completed_date","start":"2019-01-01","end":"2026-10-17","category":"all"}','[{"id":"compare","path":"compare","params":{}}]',u.id,u.session_id)::text) from cohort_users u where idx=1;
\echo VIEWER
select public.internal_analytics_viewer(u.id,u.session_id)->>'public_fact_count' from cohort_users u where idx=1;
