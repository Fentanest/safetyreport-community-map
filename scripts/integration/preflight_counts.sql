-- READ-ONLY preflight for the community-ingest rollout (run by the operator on the target project BEFORE
-- applying 202609260100 / 202609260200). Writes nothing. Output decides the row in
-- docs/integration/community-ingest/deployment-and-rollback.md §2.
begin read only;
select 'map_initial_applied' as check, to_regclass('private.upload_snapshots') is not null as value
union all select 'map_v2_applied', to_regclass('private.report_facts_v2') is not null
union all select 'auth_relay_applied', to_regclass('private.community_auth_requests') is not null
union all select 'account_registry_applied', to_regclass('private.community_consent_grants') is not null
union all select 'ingest_applied', to_regclass('private.community_report_facts') is not null;

select state, count(*) from private.upload_snapshots group by state order by state;
select count(*) as v2_facts_total,
       count(*) filter (where s.state = 'active') as v2_facts_public
  from private.report_facts_v2 f left join private.upload_snapshots s on s.id = f.snapshot_id;
select count(*) as contributors, count(*) filter (where revoked_at is null and status = 'active') as active_contributors
  from private.contributor_profiles;
select ready, generated_at is not null as has_generated_at, dedupe_policy_version from private.analytics_state;
rollback;
