-- Query audit: share eligibility at grant granularity, compute both metadata bounds in one scan,
-- legacy facts and viewer eligibility. No new indexes, API/ACL/timeout or election changes.
begin;

CREATE OR REPLACE FUNCTION public.internal_analytics_v2_state()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with active_grants as materialized (
    select g.grant_id from private.community_consent_grants g
    join private.community_consent_grants a on a.lineage_id=g.lineage_id and a.user_id=g.user_id and a.revoked_at is null
  ), bounds as (
    select min(least(coalesce(f.report_date, f.completed_date), coalesce(f.completed_date, f.report_date))) as lo,
           max(greatest(coalesce(f.report_date, f.completed_date), coalesce(f.completed_date, f.report_date))) as hi
      from private.community_report_facts f
      join private.contributor_profiles c on c.user_id = f.contributor_id and c.status = 'active'
      join active_grants g on g.grant_id=f.consent_grant_id
     where f.public_state = 'completed'
  )
  select jsonb_build_object(
    'dataset_version', s.dataset_version, 'ready', s.ready,
    'source_updated_at', s.source_updated_at, 'generated_at', s.generated_at,
    'published_at', s.published_at,
    -- whole publicly listed history (report date AND answer date), never a filtered or last-screen range
    'data_min', coalesce(s.data_min, b.lo), 'data_max', coalesce(s.data_max, b.hi),
    'coverage_note', s.coverage_note, 'dedupe_policy_version', s.dedupe_policy_version
  ) from private.analytics_state s cross join bounds b where s.singleton = true;
$function$
;
CREATE OR REPLACE FUNCTION public.internal_analytics_cohort_state()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  select jsonb_build_object(
    'dataset_version', s.dataset_version, 'ready', s.ready,
    'source_updated_at', s.source_updated_at, 'generated_at', s.generated_at, 'published_at', s.published_at,
    'data_min', coalesce(s.data_min, least(b.report_min,b.completed_min)),
    'data_max', coalesce(s.data_max, greatest(b.report_max,b.completed_max)),
    'coverage_note', s.coverage_note, 'dedupe_policy_version', s.dedupe_policy_version) || jsonb_build_object(
    'cohort_policy_version', 'single-date-v1',
    -- 전체 기간 of each basis over the publicly listed history (never the other date, never a filtered range)
    'basis_bounds', jsonb_build_object(
      'report_date', jsonb_build_object('min', b.report_min, 'max', b.report_max),
      'completed_date', jsonb_build_object('min', b.completed_min, 'max', b.completed_max)))
    from bounds b cross join private.analytics_state s where s.singleton=true;
$function$
;
CREATE OR REPLACE FUNCTION public.internal_analytics_v2_facts(p_start date, p_end date, p_category text, p_region_code text, p_agency_key text, p_manager_key text, p_bbox double precision[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET enable_nestloop TO 'off'
AS $function$
declare
    v_previous_start date;
    v_rows jsonb;
    v_count integer;
    v_scoped integer;
begin
    -- 2026-09-30: no period-length cap (the whole shared history is a valid scope). The previous window must
    -- stay on the calendar; the volume is bounded by the row budget below, never by shortening the period.
    if p_start is null or p_end is null or p_end < p_start or p_start - (p_end - p_start + 1) < date '1900-01-01' or
       p_category is null or p_category not in ('all','traffic','parking','other') or
       (p_bbox is not null and (array_length(p_bbox,1) <> 4 or p_bbox[1] > p_bbox[3] or p_bbox[2] > p_bbox[4])) then
        raise exception 'INVALID_QUERY';
    end if;
    perform set_config('statement_timeout', '8000', true);
    v_previous_start := p_start - (p_end - p_start + 1);
    -- Preserve the legacy union-of-dates/window-first election, including its pre-filter budget.
    with disclosures as materialized (
        select g.lineage_id,
               coalesce(bool_or(d.amounts_public), false) as amount_public,
               coalesce(bool_or(d.violation_law_public), false) as law_public,
               coalesce(bool_or(d.rating_public), false) as rating_public
          from private.community_consent_grants g
          left join private.community_policy_disclosures d on d.version = g.policy_version
         where g.revoked_at is null
         group by g.lineage_id
    ), active_grants as materialized (
        select g.grant_id, d.amount_public, d.law_public, d.rating_public
          from private.community_consent_grants g
          join private.community_consent_grants a
            on a.lineage_id = g.lineage_id and a.user_id = g.user_id and a.revoked_at is null
          join disclosures d on d.lineage_id = g.lineage_id
    ), eligible as materialized (
      select f.*, g.amount_public, g.law_public, g.rating_public
      from private.community_report_facts f
      join private.contributor_profiles c on c.user_id=f.contributor_id and c.status='active'
      join active_grants g on g.grant_id=f.consent_grant_id
      where f.public_state='completed'
    ), scoped as materialized (
      select f.* from eligible f where f.report_date between v_previous_start and p_end
        or f.completed_date between v_previous_start and p_end
    ), budget as materialized (select count(*) as n from scoped), admitted as materialized (
      select s.* from scoped s where (select n<=100000 from budget)
    ), key_numbers as (
      select distinct on (f.source_report_key) f.source_report_key,f.report_number as key_number
      from eligible f where f.source_report_key in (select source_report_key from admitted)
      order by f.source_report_key,(f.report_number is null),f.first_accepted_at,f.contributor_id
    ),
    identified as (
        select s.*,
               k.key_number,
               -- H1: both numbers present and different -> separate identities;
               -- a missing number joins the key’s first numbered group, else the legacy group.
               (s.source_report_key || '|' || coalesce(s.report_number, k.key_number, 'legacy')) as report_identity,
               -- R1: the latest DISTINCT answer wins: the answer group adopted
               -- most recently (same answer re-sent does not move it, because
               -- no_change/stale/grant-only reshare keep answer_accepted_at).
               max(s.answer_accepted_at) over (
                   partition by s.source_report_key, coalesce(s.report_number, k.key_number, 'legacy'), s.payload_sha256
               ) as answer_time
          from admitted s
          join key_numbers k using (source_report_key)
    ),
    ranked as (
        select i.*,
               -- R1: the representative is elected per identity BEFORE scope filters (see final select).
               -- Order: latest adopted answer first, then the newer official
               -- answer date (completed_date), then earliest contributor.
               row_number() over (partition by i.report_identity
                                  order by i.answer_time desc, i.completed_date desc nulls last,
                                           i.first_accepted_at, i.contributor_id) = 1
                   as is_representative,
               count(*) over (partition by i.report_identity) as contribution_count
          from identified i
    )
    select (select n from budget), count(*), coalesce(jsonb_agg(jsonb_build_object(
        'fact_identity', dataset_key || ':' || source_report_key, 'contributor_id', contributor_id,
        'report_identity', report_identity, 'report_number', report_number,
        'source_report_key', source_report_key, 'first_accepted_at', first_accepted_at,
        'snapshot_id', 'ingest-v1', 'snapshot_generation', 1,
        'report_date', report_date, 'completed_date', completed_date,
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
        -- whether the answer stated an amount at all (existence only, never the value) — keeps ’not stated’ apart from ’not published’
        'amount_stated', amount_confirmed_won is not null,
        -- 위반법규 (observation-v2): exact text for the law filter and the per-law table; null = 법규 미상
        -- (v1 payload, not extracted, or the lineage’s policy does not publish it)
        'violation_law', case when law_public then violation_law else null end,
        'rating', case when rating_public then rating else null end
    )), '[]'::jsonb) into v_scoped, v_count, v_rows from ranked
     where (p_category = 'all' or category = p_category)
       and (p_region_code is null or region_code = p_region_code)
       and (p_agency_key is null or agency_key = p_agency_key)
       and (p_manager_key is null or manager_key = p_manager_key)
       and (p_bbox is null or (lat is not null and lng between p_bbox[1] and p_bbox[3] and lat between p_bbox[2] and p_bbox[4]));
    if v_scoped > 100000 or v_count > 100000 then raise exception 'RESULT_TOO_LARGE'; end if;
    return v_rows;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.internal_analytics_viewer(p_user uuid, p_session uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
    v_id jsonb;
    v_profile private.contributor_profiles%rowtype;
    v_contributor text;
    v_has boolean := false;
    v_count integer := 0;
begin
    if p_user is null or p_session is null then raise exception 'INVALID_QUERY'; end if;
    v_id := private.community_identity_state(p_user, p_session);
    select * into v_profile from private.contributor_profiles where user_id = p_user;
    -- same states as internal_my_analytics_source: ’active’ = active profile with an unrevoked share consent
    v_contributor := case
        when v_profile.user_id is null then 'none'
        when v_profile.status <> 'active' then 'suspended'
        when exists (select 1 from private.community_consent_grants g where g.user_id = p_user and g.revoked_at is null) then 'active'
        when exists (select 1 from private.community_consent_grants g where g.user_id = p_user) then 'revoked'
        else 'none' end;
    -- "shared at least one report": a fact of this user that the public map actually lists (completed, active
    -- contributor, active consent lineage) — the same rule as internal_my_analytics_source.has_public_facts.
    -- The count and existence flag use the same eligible rows as the personal-comparison source.
    if v_contributor = 'active' then
        with active_grants as materialized (
            select g.grant_id from private.community_consent_grants g
            join private.community_consent_grants a on a.lineage_id=g.lineage_id and a.user_id=g.user_id and a.revoked_at is null
        ), mine as materialized (
            select f.source_report_key, f.report_number from private.community_report_facts f
            join active_grants g on g.grant_id=f.consent_grant_id
            where f.contributor_id=p_user and f.public_state='completed'
              and (f.report_date is not null or f.completed_date is not null)
        ),
        key_numbers as materialized (
            -- Only NULL-number observations need the global historical number fallback. LIMIT keeps
            -- each lookup keyed by source_report_key before evaluating the unchanged consent predicate.
            select keys.source_report_key, k.key_number
              from (select distinct source_report_key from mine where report_number is null) keys
              left join lateral (
                select f.report_number as key_number
                  from private.community_report_facts f
                  join private.contributor_profiles c on c.user_id=f.contributor_id and c.status='active'
                 where f.source_report_key=keys.source_report_key and f.report_number is not null
                   and f.public_state='completed' and f.consent_grant_id in (select grant_id from active_grants)
                 order by f.first_accepted_at,f.contributor_id limit 1
              ) k on true
        )
        select count(distinct (m.source_report_key || '|' || coalesce(m.report_number, k.key_number, 'legacy')))
          into v_count
          from mine m left join key_numbers k using (source_report_key);
        v_has := v_count > 0;
    end if;
    return jsonb_build_object(
        'user_ok', (v_id->>'user_ok')::boolean, 'kakao', (v_id->>'kakao')::boolean,
        'session', (v_id->>'session')::boolean, 'contributor', v_contributor, 'has_public_facts', v_has,
        'public_fact_count', v_count);
end;
$function$
;

CREATE OR REPLACE FUNCTION private.ranking_representatives()
 RETURNS TABLE(contributor_id uuid, identity text, report_date date, completed_date date, category text, status text, disposition text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET work_mem TO '32MB'
 SET enable_nestloop TO 'off'
AS $function$
 with grants as materialized (
   select g.grant_id, g.user_id
   from private.community_consent_grants g
   join private.contributor_profiles p on p.user_id=g.user_id and p.status='active'
   join auth.users u on u.id=g.user_id and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now()) and not coalesce(u.is_anonymous,false)
   where exists(select 1 from private.community_consent_grants a where a.lineage_id=g.lineage_id and a.user_id=g.user_id and a.revoked_at is null)
     and exists(select 1 from auth.identities i where i.user_id=g.user_id and i.provider='kakao')
 ), own as materialized (
   select f.contributor_id, decode(f.source_report_key,'hex') as source_report_key, decode(f.dataset_key,'hex') as dataset_key,
     f.report_number collate "C" as report_number, f.report_date, f.completed_date, f.category, f.status, f.disposition,
     f.payload_sha256 collate "C" as payload_sha256, f.answer_accepted_at, f.first_accepted_at
   from private.community_report_facts f join grants g on g.grant_id=f.consent_grant_id and g.user_id=f.contributor_id
   where f.public_state='completed' and f.status in ('accepted','partial','rejected','completed_unknown')
 ), key_numbers as (
   select distinct on (o.contributor_id,o.source_report_key) o.contributor_id,o.source_report_key,o.report_number as key_number
   from own o where o.report_number is not null order by o.contributor_id,o.source_report_key,o.first_accepted_at,o.dataset_key
 ), identified as (
   select o.*,o.source_report_key||convert_to('|'||coalesce(o.report_number,k.key_number,'legacy'),'UTF8') as rid,
     max(o.answer_accepted_at) over(partition by o.contributor_id,(o.source_report_key||convert_to('|'||coalesce(o.report_number,k.key_number,'legacy'),'UTF8')),o.payload_sha256) as answer_time
   from own o left join key_numbers k using(contributor_id,source_report_key)
 ), elected as (
   select i.*,row_number() over(partition by i.contributor_id,i.rid order by i.answer_time desc,i.completed_date desc nulls last,i.first_accepted_at,i.dataset_key) as rn
   from identified i
 ) select e.contributor_id,encode(substring(e.rid from 1 for 32),'hex')||convert_from(substring(e.rid from 33),'UTF8'),e.report_date,e.completed_date,e.category,e.status,e.disposition from elected e where e.rn=1;
$function$
;

CREATE OR REPLACE FUNCTION public.internal_my_analytics_source(p_user uuid, p_session uuid, p_start date, p_end date, p_category text, p_region_code text, p_agency_key text, p_manager_key text, p_bbox double precision[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
        select exists (
            select 1 from private.community_report_facts f
            join private.contributor_profiles c on c.user_id=f.contributor_id and c.status='active'
            join private.community_consent_grants g on g.grant_id=f.consent_grant_id
            join private.community_consent_grants a on a.lineage_id=g.lineage_id and a.user_id=g.user_id and a.revoked_at is null
            where f.contributor_id=p_user and f.public_state='completed'
              and (f.report_date is not null or f.completed_date is not null)
        ) into v_has;
    end if;
    return jsonb_build_object(
        'state', public.internal_analytics_v2_state(),
        'viewer', jsonb_build_object(
            'user_ok', (v_id->>'user_ok')::boolean, 'kakao', (v_id->>'kakao')::boolean,
            'session', (v_id->>'session')::boolean, 'contributor', v_contributor, 'has_public_facts', v_has),
        -- The same public fact source as the anonymous API (same population); a failed identity gets no rows.
        'facts', case when v_ok then public.internal_analytics_v2_facts(
            p_start, p_end, p_category, p_region_code, p_agency_key, p_manager_key, p_bbox) else '[]'::jsonb end);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.internal_my_analytics_cohort_source(p_user uuid, p_session uuid, p_date_basis text, p_start date, p_end date, p_with_previous boolean, p_category text, p_region_code text, p_agency_key text, p_manager_key text, p_bbox double precision[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
        select exists (
            select 1 from private.community_report_facts f
            join private.contributor_profiles c on c.user_id=f.contributor_id and c.status='active'
            join private.community_consent_grants g on g.grant_id=f.consent_grant_id
            join private.community_consent_grants a on a.lineage_id=g.lineage_id and a.user_id=g.user_id and a.revoked_at is null
            where f.contributor_id=p_user and f.public_state='completed'
              and (f.report_date is not null or f.completed_date is not null)
        ) into v_has;
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
$function$
;

commit;
