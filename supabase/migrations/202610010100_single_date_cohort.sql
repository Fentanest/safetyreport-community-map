-- 2026-10-01 · single-date cohort (docs/implementation/date-basis-dashboard, U01 / D01 / D13 / D14).
-- LOCAL PROPOSAL — not applied to production; operational apply needs separate approval.
--
-- What changes (incremental; earlier files are not edited, earlier functions are NOT replaced):
--   1. internal_analytics_cohort_facts(p_date_basis, p_start, p_end, p_with_previous, …)
--      - ONE date selects the reports: p_date_basis = 'report_date' | 'completed_date'. The other date never filters.
--      - D13: the representative of an identity is elected over the identity's WHOLE eligible history first; only
--        then the representative's selected date decides whether the identity is in the window. The previous
--        function elected among rows already cut to the window, so an older answer (August) could come back as the
--        representative of a report whose latest answer is in September.
--      - Every returned row carries identity_report_date / identity_completed_date (the representative's dates), so
--        the server places all rows of one identity (co-contributors, mine) in the same period.
--      - D14: p_with_previous = false reads only [p_start, p_end]; the candidate identities are found with the
--        SQL-filterable dimensions (category, agency, manager, bbox) BEFORE the row budget is checked, so a narrow
--        request is not refused because the whole country is large. The budget is still checked before
--        materialising (RESULT_TOO_LARGE for the whole request, never a partial set).
--   2. internal_analytics_cohort_state(): internal_analytics_v2_state() plus basis_bounds (전체 기간 of each basis)
--      and cohort_policy_version = 'single-date-v1'.
--   3. internal_my_analytics_cohort_source(p_user, p_session, p_date_basis, p_start, p_end, p_with_previous, …):
--      the same identity checks as internal_my_analytics_source over the new facts/state.
--
-- New names instead of new overloads of the old names: PostgREST resolves an RPC by its argument names, and two
-- overloads of one name (7 and 9 arguments) would make the call depend on which arguments are sent. The old
-- functions stay untouched for the Edge build that is live during the rollout; drop them in a later migration once
-- the new Edge functions are deployed (docs/implementation/date-basis-dashboard/MIGRATION.md).
--
-- Rollback: drop the three new functions (no table or data changes here).

begin;

create or replace function public.internal_analytics_cohort_facts(
    p_date_basis text, p_start date, p_end date, p_with_previous boolean, p_category text, p_region_code text,
    p_agency_key text, p_manager_key text, p_bbox double precision[]
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
    v_from date;
    v_rows jsonb;
    v_count integer;
    v_scoped integer;
begin
    if p_date_basis is null or p_date_basis not in ('report_date', 'completed_date') or p_with_previous is null or
       p_start is null or p_end is null or p_end < p_start or p_start - (p_end - p_start + 1) < date '1900-01-01' or
       p_category is null or p_category not in ('all','traffic','parking','other') or
       (p_bbox is not null and (array_length(p_bbox,1) <> 4 or p_bbox[1] > p_bbox[3] or p_bbox[2] > p_bbox[4])) then
        raise exception 'INVALID_QUERY';
    end if;
    perform set_config('statement_timeout', '8000', true);
    v_from := case when p_with_previous then p_start - (p_end - p_start + 1) else p_start end;

    -- Row budget BEFORE materialising, over exactly the rows the result is built from (whole history of the
    -- candidate identities).
    with candidates as (
        select distinct f.source_report_key
          from private.community_report_facts f
          join private.contributor_profiles c on c.user_id = f.contributor_id and c.status = 'active'
         where f.public_state = 'completed'
           and private.community_lineage_active(f.consent_grant_id)
           and (case when p_date_basis = 'report_date' then f.report_date else f.completed_date end) between v_from and p_end
           and (p_category = 'all' or f.category = p_category)
           and (p_agency_key is null or f.agency_key = p_agency_key)
           and (p_manager_key is null or f.manager_key = p_manager_key)
           and (p_bbox is null or (f.lat is not null and f.lng between p_bbox[1] and p_bbox[3] and f.lat between p_bbox[2] and p_bbox[4]))
    )
    select count(*) into v_scoped
      from private.community_report_facts f
      join private.contributor_profiles c on c.user_id = f.contributor_id and c.status = 'active'
     where f.public_state = 'completed'
       and private.community_lineage_active(f.consent_grant_id)
       and f.source_report_key in (select k.source_report_key from candidates k);
    if v_scoped > 100000 then raise exception 'RESULT_TOO_LARGE'; end if;

    with candidates as (
        select distinct f.source_report_key
          from private.community_report_facts f
          join private.contributor_profiles c on c.user_id = f.contributor_id and c.status = 'active'
         where f.public_state = 'completed'
           and private.community_lineage_active(f.consent_grant_id)
           and (case when p_date_basis = 'report_date' then f.report_date else f.completed_date end) between v_from and p_end
           and (p_category = 'all' or f.category = p_category)
           and (p_agency_key is null or f.agency_key = p_agency_key)
           and (p_manager_key is null or f.manager_key = p_manager_key)
           and (p_bbox is null or (f.lat is not null and f.lng between p_bbox[1] and p_bbox[3] and f.lat between p_bbox[2] and p_bbox[4]))
    ),
    -- the WHOLE eligible history of the candidate keys (no date window): the representative is elected here
    scoped as (
        select f.*,
               exists(select 1 from private.community_consent_grants g0
                        join private.community_consent_grants g on g.lineage_id = g0.lineage_id and g.revoked_at is null
                        join private.community_policy_disclosures d on d.version = g.policy_version and d.amounts_public
                       where g0.grant_id = f.consent_grant_id) as amount_public,
               exists(select 1 from private.community_consent_grants g0
                        join private.community_consent_grants g on g.lineage_id = g0.lineage_id and g.revoked_at is null
                        join private.community_policy_disclosures d on d.version = g.policy_version and d.violation_law_public
                       where g0.grant_id = f.consent_grant_id) as law_public,
               exists(select 1 from private.community_consent_grants g0
                        join private.community_consent_grants g on g.lineage_id = g0.lineage_id and g.revoked_at is null
                        join private.community_policy_disclosures d on d.version = g.policy_version and d.rating_public
                       where g0.grant_id = f.consent_grant_id) as rating_public
          from private.community_report_facts f
          join private.contributor_profiles c on c.user_id = f.contributor_id and c.status = 'active'
         where f.public_state = 'completed'
           and private.community_lineage_active(f.consent_grant_id)
           and f.source_report_key in (select k.source_report_key from candidates k)
    ),
    -- R2 (unchanged): the number a key was first seen with, over the consent-active full history
    key_numbers as (
        select distinct on (f.source_report_key) f.source_report_key,
               f.report_number as key_number
          from private.community_report_facts f
          join private.contributor_profiles c on c.user_id = f.contributor_id and c.status = 'active'
         where f.public_state = 'completed'
           and private.community_lineage_active(f.consent_grant_id)
           and f.source_report_key in (select s.source_report_key from scoped s)
         order by f.source_report_key, (f.report_number is null), f.first_accepted_at, f.contributor_id
    ),
    identified as (
        select s.*,
               k.key_number,
               (s.source_report_key || '|' || coalesce(s.report_number, k.key_number, 'legacy')) as report_identity,
               max(s.answer_accepted_at) over (
                   partition by s.source_report_key, coalesce(s.report_number, k.key_number, 'legacy'), s.payload_sha256
               ) as answer_time
          from scoped s
          join key_numbers k using (source_report_key)
    ),
    ranked as (
        select i.*,
               -- R1 order (unchanged): latest adopted answer, newer official answer date, earliest contributor
               row_number() over w = 1 as is_representative,
               first_value(i.report_date) over w as identity_report_date,
               first_value(i.completed_date) over w as identity_completed_date,
               count(*) over (partition by i.report_identity) as contribution_count
          from identified i
        window w as (partition by i.report_identity
                     order by i.answer_time desc, i.completed_date desc nulls last, i.first_accepted_at, i.contributor_id
                     rows between unbounded preceding and unbounded following)
    )
    select count(*), coalesce(jsonb_agg(jsonb_build_object(
        'fact_identity', dataset_key || ':' || source_report_key, 'contributor_id', contributor_id,
        'report_identity', report_identity, 'report_number', report_number,
        'source_report_key', source_report_key, 'first_accepted_at', first_accepted_at,
        'snapshot_id', 'ingest-v1', 'snapshot_generation', 1,
        'report_date', report_date, 'completed_date', completed_date,
        'identity_report_date', identity_report_date, 'identity_completed_date', identity_completed_date,
        'category', category, 'status', status, 'disposition', disposition,
        'vehicle_raw', vehicle_raw, 'point_key', point_key, 'lat', lat, 'lng', lng,
        'address', address, 'region_code', region_code,
        'agency_key', agency_key, 'agency_name', agency_name,
        'agency_current_name', agency_current_name,
        'manager_key', manager_key, 'manager_name', manager_name,
        'is_representative', is_representative, 'contribution_count', contribution_count,
        'amount_kind', amount_kind,
        'amount_confirmed_won', case when amount_public then amount_confirmed_won else null end,
        'amount_public', amount_public,
        'amount_stated', amount_confirmed_won is not null,
        'violation_law', case when law_public then violation_law else null end,
        'rating', case when rating_public then rating else null end
    )), '[]'::jsonb) into v_count, v_rows from ranked
     where (p_category = 'all' or category = p_category)
       and (p_region_code is null or region_code = p_region_code)
       and (p_agency_key is null or agency_key = p_agency_key)
       and (p_manager_key is null or manager_key = p_manager_key)
       and (p_bbox is null or (lat is not null and lng between p_bbox[1] and p_bbox[3] and lat between p_bbox[2] and p_bbox[4]))
       -- the representative's SELECTED date decides for every row of the identity (never the row's own copy)
       and (case when p_date_basis = 'report_date' then identity_report_date else identity_completed_date end)
           between v_from and p_end;
    if v_count > 100000 then raise exception 'RESULT_TOO_LARGE'; end if;
    return v_rows;
end;
$$;

revoke all on function public.internal_analytics_cohort_facts(text, date, date, boolean, text, text, text, text, double precision[])
    from public, anon, authenticated;
grant execute on function public.internal_analytics_cohort_facts(text, date, date, boolean, text, text, text, text, double precision[])
    to service_role;

create or replace function public.internal_analytics_cohort_state()
returns jsonb language sql stable security definer set search_path = '' as $$
  with bounds as (
    select min(f.report_date) as report_min, max(f.report_date) as report_max,
           min(f.completed_date) as completed_min, max(f.completed_date) as completed_max
      from private.community_report_facts f
      join private.contributor_profiles c on c.user_id = f.contributor_id and c.status = 'active'
     where f.public_state = 'completed'
       and private.community_lineage_active(f.consent_grant_id)
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

create or replace function public.internal_my_analytics_cohort_source(
    p_user uuid, p_session uuid, p_date_basis text, p_start date, p_end date, p_with_previous boolean,
    p_category text, p_region_code text, p_agency_key text, p_manager_key text, p_bbox double precision[])
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
    v_id jsonb;
    v_ok boolean;
    v_profile private.contributor_profiles%rowtype;
    v_contributor text;
    v_has boolean := false;
begin
    if p_user is null or p_session is null then raise exception 'INVALID_QUERY'; end if;
    v_id := private.community_identity_state(p_user, p_session);
    v_ok := (v_id->>'user_ok')::boolean and (v_id->>'kakao')::boolean and (v_id->>'session')::boolean;
    select * into v_profile from private.contributor_profiles where user_id = p_user;
    v_contributor := case
        when v_profile.user_id is null then 'none'
        when v_profile.status <> 'active' then 'suspended'
        when exists (select 1 from private.community_consent_grants g where g.user_id = p_user and g.revoked_at is null) then 'active'
        when exists (select 1 from private.community_consent_grants g where g.user_id = p_user) then 'revoked'
        else 'none' end;
    if v_ok then
        select exists (select 1 from private.community_report_facts f
                        where f.contributor_id = p_user and private.community_fact_publicly_listed(f)) into v_has;
    end if;
    return jsonb_build_object(
        'state', public.internal_analytics_cohort_state(),
        'viewer', jsonb_build_object(
            'user_ok', (v_id->>'user_ok')::boolean, 'kakao', (v_id->>'kakao')::boolean,
            'session', (v_id->>'session')::boolean, 'contributor', v_contributor, 'has_public_facts', v_has),
        -- the same public fact source as the anonymous API (same population and date rule); no rows on a failed identity
        'facts', case when v_ok then public.internal_analytics_cohort_facts(
            p_date_basis, p_start, p_end, p_with_previous, p_category, p_region_code, p_agency_key, p_manager_key, p_bbox)
            else '[]'::jsonb end);
end;
$$;

revoke all on function public.internal_my_analytics_cohort_source(uuid, uuid, text, date, date, boolean, text, text, text, text, double precision[])
    from public, anon, authenticated;
grant execute on function public.internal_my_analytics_cohort_source(uuid, uuid, text, date, date, boolean, text, text, text, text, double precision[])
    to service_role;

commit;
