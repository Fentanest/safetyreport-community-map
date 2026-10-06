-- Same election, filters, row budget and STABLE statement snapshot; lossless internal transport only.
-- JSON text avoids expensive jsonb construction/normalization on the production aarch64 host.
-- columns-v1 also removes repeated field names; public DTOs are unchanged.
-- Legacy RPC callers still receive the complete ordered array of objects.
begin;
-- Return types cannot be changed with CREATE OR REPLACE. No CASCADE: unknown dependencies abort.
-- These PL/pgSQL callers resolve the unchanged argument signatures at execution time.
drop function public.internal_analytics_read_snapshot(jsonb,boolean,text,jsonb,uuid,uuid);
drop function public.internal_my_analytics_cohort_source(uuid,uuid,text,date,date,boolean,text,text,text,text,double precision[]);
drop function public.internal_analytics_cohort_facts(text,date,date,boolean,text,text,text,text,double precision[]);
create or replace function private.analytics_cohort_payload(
    p_date_basis text, p_start date, p_end date, p_with_previous boolean, p_category text, p_region_code text,
    p_agency_key text, p_manager_key text, p_bbox double precision[], p_compact boolean
)
returns json language plpgsql stable security definer set search_path = '' set enable_nestloop = off as $$
declare
    v_from date;
    v_rows json;
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

    -- Resolve active lineage once per grant, not once per fact. Eligibility includes user_id;
    -- disclosure deliberately follows the existing lineage-only EXISTS semantics.
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
    ), candidates as materialized (
        -- Keep date indexes available for narrow or empty windows; no national wide-row spool.
        select distinct f.source_report_key
          from private.community_report_facts f
          join private.contributor_profiles c on c.user_id = f.contributor_id and c.status = 'active'
          join active_grants g on g.grant_id = f.consent_grant_id
         where f.public_state = 'completed'
           and (case when p_date_basis = 'report_date' then f.report_date else f.completed_date end) between v_from and p_end
           and (p_category = 'all' or f.category = p_category)
           and (p_agency_key is null or f.agency_key = p_agency_key)
           and (p_manager_key is null or f.manager_key = p_manager_key)
           and (p_bbox is null or (f.lat is not null and f.lng between p_bbox[1] and p_bbox[3] and f.lat between p_bbox[2] and p_bbox[4]))
    ), scoped as materialized (
        -- D13: keep the whole eligible history of each candidate key for election.
        select f.*, g.amount_public, g.law_public, g.rating_public
          from private.community_report_facts f
          join private.contributor_profiles c on c.user_id = f.contributor_id and c.status = 'active'
          join active_grants g on g.grant_id = f.consent_grant_id
          join candidates k using (source_report_key)
         where f.public_state = 'completed'
    ), budget as materialized (
        select count(*) as n from scoped
    ), admitted as materialized (
        -- Do not rank or build any JSON if the whole-history row budget is exceeded.
        select s.* from scoped s where (select n <= 100000 from budget)
    ), key_numbers as (
        -- R2: first known number over exactly the same eligible history as scoped.
        select distinct on (f.source_report_key) f.source_report_key, f.report_number as key_number
          from admitted f
         order by f.source_report_key, (f.report_number is null), f.first_accepted_at, f.contributor_id
    ),
    identified as (
        select s.*,
               k.key_number,
               (s.source_report_key || '|' || coalesce(s.report_number, k.key_number, 'legacy')) as report_identity,
               max(s.answer_accepted_at) over (
                   partition by s.source_report_key, coalesce(s.report_number, k.key_number, 'legacy'), s.payload_sha256
               ) as answer_time
          from admitted s
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
    select (select n from budget), count(*), coalesce(json_agg(case when p_compact then json_build_array(
        dataset_key || ':' || source_report_key,
        contributor_id,
        report_identity,
        report_number,
        source_report_key,
        first_accepted_at,
        'ingest-v1',
        1,
        report_date,
        completed_date,
        identity_report_date,
        identity_completed_date,
        category,
        status,
        disposition,
        vehicle_raw,
        point_key,
        lat,
        lng,
        address,
        region_code,
        agency_key,
        agency_name,
        agency_current_name,
        manager_key,
        manager_name,
        is_representative,
        contribution_count,
        amount_kind,
        case when amount_public then amount_confirmed_won else null end,
        amount_public,
        amount_confirmed_won is not null,
        case when law_public then violation_law else null end,
        case when rating_public then rating else null end
    ) else json_build_object(
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
    ) end), '[]'::json) into v_scoped, v_count, v_rows from ranked
     where (p_category = 'all' or category = p_category)
       and (p_region_code is null or region_code = p_region_code)
       and (p_agency_key is null or agency_key = p_agency_key)
       and (p_manager_key is null or manager_key = p_manager_key)
       and (p_bbox is null or (lat is not null and lng between p_bbox[1] and p_bbox[3] and lat between p_bbox[2] and p_bbox[4]))
       -- the representative’s SELECTED date decides for every row of the identity (never the row’s own copy)
       and (case when p_date_basis = 'report_date' then identity_report_date else identity_completed_date end)
           between v_from and p_end;
    if v_scoped > 100000 or v_count > 100000 then raise exception 'RESULT_TOO_LARGE'; end if;
    return case when p_compact then json_build_object('encoding','columns-v1','columns',
        json_build_array('fact_identity','contributor_id','report_identity','report_number','source_report_key','first_accepted_at','snapshot_id','snapshot_generation','report_date','completed_date','identity_report_date','identity_completed_date','category','status','disposition','vehicle_raw','point_key','lat','lng','address','region_code','agency_key','agency_name','agency_current_name','manager_key','manager_name','is_representative','contribution_count','amount_kind','amount_confirmed_won','amount_public','amount_stated','violation_law','rating'),'rows',v_rows) else v_rows end;
end;
$$;
revoke all on function private.analytics_cohort_payload(text,date,date,boolean,text,text,text,text,double precision[],boolean) from public,anon,authenticated;
-- Existing Supabase RPCs are owned by postgres, even when the migration runner is supabase_admin.
grant execute on function private.analytics_cohort_payload(text,date,date,boolean,text,text,text,text,double precision[],boolean) to postgres;
create or replace function public.internal_analytics_cohort_facts(
    p_date_basis text, p_start date, p_end date, p_with_previous boolean, p_category text, p_region_code text,
    p_agency_key text, p_manager_key text, p_bbox double precision[]
) returns json language sql stable security definer set search_path='' as $$
  select private.analytics_cohort_payload(p_date_basis,p_start,p_end,p_with_previous,p_category,p_region_code,
    p_agency_key,p_manager_key,p_bbox,false);
$$;
revoke all on function public.internal_analytics_cohort_facts(text,date,date,boolean,text,text,text,text,double precision[]) from public,anon,authenticated;
grant execute on function public.internal_analytics_cohort_facts(text,date,date,boolean,text,text,text,text,double precision[]) to service_role;
create or replace function public.internal_analytics_read_snapshot(
  p_scope jsonb, p_previous boolean default false,
  p_kind text default null, p_options jsonb default '{}'::jsonb,
  p_user uuid default null, p_session uuid default null
) returns json language plpgsql stable security definer set search_path='' as $$
declare s jsonb; v jsonb; data json; box double precision[];
begin
  s := public.internal_analytics_cohort_state();
  if p_user is not null then
    v := public.internal_analytics_viewer(p_user,p_session);
    if not coalesce((v->>'user_ok')::boolean,false) or
       not coalesce((v->>'kakao')::boolean,false) or
       not coalesce((v->>'session')::boolean,false) or
       v->>'contributor' is distinct from 'active' or
       coalesce((v->>'public_fact_count')::bigint,0)<10 then
      return json_build_object('state',s,'viewer',v,'facts','[]'::json);
    end if;
  end if;
  if p_kind is not null then
    data := public.internal_analytics_rollup(p_scope,p_kind,
      coalesce(p_options,'{}'::jsonb) || jsonb_build_object('expected_version',s->>'dataset_version'));
    return json_build_object('state',s,'rollup',data);
  end if;
  if jsonb_typeof(p_scope->'bbox')='array' then
    select array_agg(x::double precision order by n) into box
      from jsonb_array_elements_text(p_scope->'bbox') with ordinality a(x,n);
  end if;
  data := private.analytics_cohort_payload(
    p_scope->>'date_basis',(p_scope->>'start')::date,(p_scope->>'end')::date,p_previous,
    p_scope->>'category',null,p_scope->>'agency_key',p_scope->>'manager_key',box,coalesce(p_options->>'fact_encoding'='columns-v1',false));
  return json_build_object('state',s,'viewer',v,'facts',data);
end $$;
revoke all on function public.internal_analytics_read_snapshot(jsonb,boolean,text,jsonb,uuid,uuid) from public,anon,authenticated;
grant execute on function public.internal_analytics_read_snapshot(jsonb,boolean,text,jsonb,uuid,uuid) to service_role;
comment on function public.internal_analytics_read_snapshot(jsonb,boolean,text,jsonb,uuid,uuid)
  is 'Service-only single-statement snapshot for version, eligible facts/rollup and optional screen viewer.';
-- The personal comparison caller must not CASE-coerce or rewrap large facts as jsonb.
CREATE OR REPLACE FUNCTION public.internal_my_analytics_cohort_source(p_user uuid, p_session uuid, p_date_basis text, p_start date, p_end date, p_with_previous boolean, p_category text, p_region_code text, p_agency_key text, p_manager_key text, p_bbox double precision[])
 RETURNS json
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
    return json_build_object(
        'state', public.internal_analytics_cohort_state(),
        'viewer', jsonb_build_object(
            'user_ok', (v_id->>'user_ok')::boolean, 'kakao', (v_id->>'kakao')::boolean,
            'session', (v_id->>'session')::boolean, 'contributor', v_contributor, 'has_public_facts', v_has),
        -- the same public fact source as the anonymous API (same population and date rule); no rows on a failed identity
        'facts', case when v_ok then public.internal_analytics_cohort_facts(
            p_date_basis, p_start, p_end, p_with_previous, p_category, p_region_code, p_agency_key, p_manager_key, p_bbox)
            else '[]'::json end);
end;
$function$
;

revoke all on function public.internal_my_analytics_cohort_source(uuid,uuid,text,date,date,boolean,text,text,text,text,double precision[]) from public,anon,authenticated;
grant execute on function public.internal_my_analytics_cohort_source(uuid,uuid,text,date,date,boolean,text,text,text,text,double precision[]) to service_role;
-- Restore the established public RPC owner after DROP/CREATE by the migration role.
alter function public.internal_analytics_cohort_facts(text,date,date,boolean,text,text,text,text,double precision[]) owner to postgres;
alter function public.internal_analytics_read_snapshot(jsonb,boolean,text,jsonb,uuid,uuid) owner to postgres;
alter function public.internal_my_analytics_cohort_source(uuid,uuid,text,date,date,boolean,text,text,text,text,double precision[]) owner to postgres;
notify pgrst, 'reload schema';
commit;
