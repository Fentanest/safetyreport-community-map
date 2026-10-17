-- Backfill for 202610180100, in its own transaction so ingest is never blocked on the facts table.
-- Idempotent: rows written meanwhile by the trigger are newer and win (ON CONFLICT keeps the latest put).
-- Re-run after any screen_norm_version() bump. Missing or stale rows only make screen reads slower, never different.
begin;
select private.screen_fact_norm_put(f.contributor_id, f.dataset_key, f.source_report_key,
 f.address, f.vehicle_raw, f.violation_law, f.region_code, f.lat, f.lng)
from private.community_report_facts f
where not exists (select 1 from private.screen_fact_norm n
 where n.contributor_id=f.contributor_id and n.dataset_key=f.dataset_key and n.source_report_key=f.source_report_key
   and n.v=private.screen_norm_version() and n.address is not distinct from f.address and n.vehicle_raw is not distinct from f.vehicle_raw
   and n.violation_law is not distinct from f.violation_law and n.region_code is not distinct from f.region_code
   and n.lat is not distinct from f.lat and n.lng is not distinct from f.lng);
-- A completeness result cached before this refill (202610180200, slot 161) must not outlive it.
do $$begin if to_regclass('private.screen_result_cache') is not null then delete from private.screen_result_cache where slot=161; end if; end$$;
commit;
