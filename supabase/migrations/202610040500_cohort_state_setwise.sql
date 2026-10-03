-- Metadata bounds only: set-wise equivalent of the existing active-lineage predicate.
-- Same live table snapshot, state/version and single-date bounds. No state cache or snapshot.
-- Rollback: restore internal_analytics_cohort_state from 202610010100 in a forward migration.
begin;
create or replace function public.internal_analytics_cohort_state()
returns jsonb language sql stable security definer set search_path = '' as $$
  with active_grants as materialized (
    select distinct g.grant_id from private.community_consent_grants g
    join private.community_consent_grants a on a.lineage_id=g.lineage_id and a.user_id=g.user_id and a.revoked_at is null
  ), bounds as (
    select min(f.report_date) as report_min, max(f.report_date) as report_max,
           min(f.completed_date) as completed_min, max(f.completed_date) as completed_max
      from private.community_report_facts f
      join private.contributor_profiles c on c.user_id = f.contributor_id and c.status = 'active'
      join active_grants g on g.grant_id=f.consent_grant_id
     where f.public_state = 'completed'

  )
  select public.internal_analytics_v2_state() || jsonb_build_object(
    'cohort_policy_version', 'single-date-v1',
    -- 전체 기간 of each basis over the publicly listed history (never the other date, never a filtered range)
    'basis_bounds', jsonb_build_object(
      'report_date', jsonb_build_object('min', b.report_min, 'max', b.report_max),
      'completed_date', jsonb_build_object('min', b.completed_min, 'max', b.completed_max)))
    from bounds b;
$$;
revoke all on function public.internal_analytics_cohort_state() from public, anon, authenticated;
grant execute on function public.internal_analytics_cohort_state() to service_role;

commit;
