-- App-computed fine estimates; no backfill, no default, existing rows remain NULL.
-- Apply before community-ingest/public-analytics/my-analytics code. No production execution in this task.
begin;
set local lock_timeout = '3s';
alter table private.community_report_facts
  add column fine_estimate_won bigint,
  add column fine_estimate_rule text,
  add column fine_estimate_rule_version text;
-- NOT VALID avoids scanning existing rows, but checks every new/updated row.
alter table private.community_report_facts add constraint community_fine_estimate_valid check (
  (fine_estimate_won is null and fine_estimate_rule is null and fine_estimate_rule_version is null)
  or (fine_estimate_won is not null and fine_estimate_rule is not null and fine_estimate_rule_version is not null
    and fine_estimate_won between 1 and 100000000
    and fine_estimate_rule in ('bus_lane','parking','hydrant','school_zone','ev_charging','disabled_parking','fire_lane','waste','overnight_truck')
    and char_length(fine_estimate_rule_version)<=40)
) not valid;
commit;
