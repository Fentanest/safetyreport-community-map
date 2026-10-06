-- Deterministic final dataset election and opt-in screen v2. Existing encodings remain available.
begin;
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
         order by f.source_report_key, (f.report_number is null), f.first_accepted_at, f.contributor_id, f.dataset_key
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
                     order by i.answer_time desc, i.completed_date desc nulls last, i.first_accepted_at, i.contributor_id, i.dataset_key
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

create or replace function private.analytics_rollup_source(p_scope jsonb)
returns table(identity text,report_date date,completed_date date,category text,status text,disposition text,
 agency_key text,agency_name text,manager_key text,manager_name text,law text,amount_won bigint,rating integer)
language plpgsql stable security definer set search_path='' set work_mem='32MB' set enable_nestloop=off as $$
begin
 return query execute $plan$
 with grants as materialized (
   select g.grant_id,g.user_id,
     bool_or(d.amounts_public) as amounts_public,bool_or(d.violation_law_public) as law_public,bool_or(d.rating_public) as rating_public
   from private.community_consent_grants g
   join private.contributor_profiles c on c.user_id=g.user_id and c.status='active'
   join private.community_consent_grants a on a.lineage_id=g.lineage_id and a.user_id=g.user_id and a.revoked_at is null
   left join private.community_policy_disclosures d on d.version=a.policy_version
   group by g.grant_id,g.user_id
 ), candidates as (
   -- A safe candidate superset, including earlier observations. No grouping/election within the period.
   select distinct f.source_report_key from private.community_report_facts f
   join grants g on g.grant_id=f.consent_grant_id and g.user_id=f.contributor_id
   where f.public_state='completed'
     and (case $1->>'date_basis' when 'report_date' then f.report_date else f.completed_date end)
       between ($1->>'start')::date and ($1->>'end')::date
     and ($1->>'category'='all' or f.category=$1->>'category')
     and ($1->>'agency_key' is null or f.agency_key=$1->>'agency_key')
     and ($1->>'manager_key' is null or f.manager_key=$1->>'manager_key')
 ), observations as materialized (
   select f.dataset_key,f.source_report_key collate "C" as source_report_key,f.report_number collate "C" as report_number,
     f.payload_sha256 collate "C" as payload_sha256,f.contributor_id,f.answer_accepted_at,f.first_accepted_at,
     f.report_date,f.completed_date,f.category,f.status,f.disposition,f.agency_key,
     coalesce(nullif(f.agency_current_name,''),nullif(f.agency_name,''),'기관 정보 없음') as agency_name,
     f.manager_key,f.manager_name,f.region_code,f.lat,f.lng,
     case when g.law_public then f.violation_law else null end as law,
     case when g.rating_public then f.rating else null end as rating,
     case when g.amounts_public and f.amount_kind='fine' and f.disposition='fine' and f.status in ('accepted','partial')
       then f.amount_confirmed_won else null end as amount_won
   from private.community_report_facts f join grants g on g.grant_id=f.consent_grant_id and g.user_id=f.contributor_id
   where f.public_state='completed' and f.source_report_key in (select source_report_key from candidates)
 ), normalized_laws as materialized (
   -- Pure text normalization once per distinct disclosed input in this query, never a saved result.
   select k.raw,private.analytics_law(k.raw) as normalized
   from (select distinct law as raw from observations where law is not null) k
 ), region_names as materialized (
   -- A non-null answer without coordinates is independent of coordinates (including Sejong).
   select k.raw,private.analytics_region(k.raw,null,null) as normalized
   from (select distinct region_code as raw from observations
     where $1->>'region_code' is not null and region_code is not null) k
 ), region_points as materialized (
   -- Split districts require geometry. Resolve each distinct input tuple once; NULL coordinates cannot match.
   select jsonb_build_array(k.raw,k.lat,k.lng) as point_key,private.analytics_region(k.raw,k.lat,k.lng) as normalized
   from (select distinct o.region_code as raw,o.lat,o.lng from observations o
     join region_names r on r.raw=o.region_code and r.normalized is null
     where o.lat is not null and o.lng is not null) k
 ), key_numbers as (
   select distinct on(source_report_key) source_report_key,report_number as key_number from observations
   where report_number is not null order by source_report_key,first_accepted_at,contributor_id,dataset_key
 ), identified as (
   select o.*,o.source_report_key||'|'||coalesce(o.report_number,k.key_number,'legacy') as rid,
     max(o.answer_accepted_at) over(partition by (o.source_report_key||'|'||coalesce(o.report_number,k.key_number,'legacy')),o.payload_sha256) as answer_time
   from observations o left join key_numbers k using(source_report_key)
 ), elected as (
   select i.*,row_number() over(partition by rid order by answer_time desc,completed_date desc nulls last,first_accepted_at,contributor_id,dataset_key) as rn
   from identified i
 ) select e.rid,e.report_date,e.completed_date,e.category,e.status,e.disposition,e.agency_key,e.agency_name,e.manager_key,e.manager_name,
   l.normalized,e.amount_won,e.rating::integer
 from elected e left join normalized_laws l on l.raw=e.law
 left join region_names region_name on $1->>'region_code' is not null and region_name.raw=e.region_code
 left join region_points region_point on $1->>'region_code' is not null and region_name.normalized is null
   and region_point.point_key=jsonb_build_array(e.region_code,e.lat,e.lng)
 where e.rn=1
   and (case $1->>'date_basis' when 'report_date' then e.report_date else e.completed_date end)
     between ($1->>'start')::date and ($1->>'end')::date
   and ($1->>'category'='all' or e.category=$1->>'category')
   and ($1->>'agency_key' is null or e.agency_key=$1->>'agency_key')
   and ($1->>'manager_key' is null or e.manager_key=$1->>'manager_key')
   and ($1->>'region_code' is null or coalesce(region_name.normalized,region_point.normalized) like ($1->>'region_code')||'%')
   and ($1->>'law' is null or case when $1->>'law'='__none__' then l.normalized is null else l.normalized=private.analytics_law($1->>'law') end)
   and ($1->'bbox'='null'::jsonb or not $1?'bbox' or (e.lat is not null and e.lng between ($1->'bbox'->>0)::double precision and ($1->'bbox'->>2)::double precision
     and e.lat between ($1->'bbox'->>1)::double precision and ($1->'bbox'->>3)::double precision));
 $plan$ using p_scope;
end;
$$;

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
      order by f.source_report_key,(f.report_number is null),f.first_accepted_at,f.contributor_id,f.dataset_key
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
                                           i.first_accepted_at, i.contributor_id, i.dataset_key) = 1
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
                 order by f.first_accepted_at,f.contributor_id,f.dataset_key limit 1
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

create or replace function private.screen_plate(raw text) returns text language plpgsql immutable set search_path='' as $$
declare t text; prefix text; region text:=''; names jsonb := '{"서울특별시": "서울", "부산광역시": "부산", "대구광역시": "대구", "인천광역시": "인천", "광주광역시": "광주", "대전광역시": "대전", "울산광역시": "울산", "세종특별자치시": "세종", "경기도": "경기", "강원특별자치도": "강원", "강원도": "강원", "충청북도": "충북", "충청남도": "충남", "전북특별자치도": "전북", "전라북도": "전북", "전라남도": "전남", "경상북도": "경북", "경상남도": "경남", "제주특별자치도": "제주", "제주도": "제주", "서울": "서울", "부산": "부산", "대구": "대구", "인천": "인천", "광주": "광주", "대전": "대전", "울산": "울산", "세종": "세종", "경기": "경기", "강원": "강원", "충북": "충북", "충남": "충남", "전북": "전북", "전남": "전남", "경북": "경북", "경남": "경남", "제주": "제주"}'::jsonb;
begin
 if raw is null or length(raw)>64 then return null;end if;
 t:=regexp_replace(normalize(raw,NFKC),'['||U&'\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF'||'-]','','g');
 -- A valid plate has an optional all-Hangul region immediately before the first digit.
 -- One dictionary lookup replaces sorting/iterating the prefix dictionary for every distinct plate.
 prefix:=substring(t from '^[가-힣]+');
 if prefix is not null then
  region:=names->>prefix;
  if region is null then return null;end if;
  t:=substr(t,length(prefix)+1);
 end if;
 if t !~ '^[0-9]{2,3}[가-힣][0-9]{4}$' then return null;end if;
 return region||t;
end $$;

create or replace function private.analytics_screen_aggregate(p_scope jsonb,p_user uuid,p_panels jsonb)
returns json language plpgsql stable security definer set search_path='' set enable_nestloop=off set enable_sort=off as $$
declare p_date_basis text:=p_scope->>'date_basis'; p_start date:=(p_scope->>'start')::date; p_end date:=(p_scope->>'end')::date;
 p_category text:=p_scope->>'category';p_agency_key text:=p_scope->>'agency_key';p_manager_key text:=p_scope->>'manager_key';
 p_bbox double precision[];v_from date;result json;v_budget bigint;
begin
 if p_date_basis is null or p_date_basis not in ('report_date','completed_date') or p_start is null or p_end is null or p_end<p_start
 or p_start-(p_end-p_start+1)<date '1900-01-01' or p_category is null or p_category not in ('all','traffic','parking','other')
 or jsonb_typeof(p_panels)<>'array' or jsonb_array_length(p_panels)>8 then raise exception 'INVALID_QUERY';end if;
 if jsonb_typeof(p_scope->'bbox')='array' then select array_agg(x::double precision order by n) into p_bbox
 from jsonb_array_elements_text(p_scope->'bbox') with ordinality a(x,n);end if;
 v_from:=p_start-(p_end-p_start+1);
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
        select f.dataset_key, f.source_report_key, f.report_number, f.payload_sha256, f.answer_accepted_at, f.contributor_id, f.first_accepted_at, f.report_date, f.completed_date, f.status, f.disposition, f.vehicle_raw, f.lat, f.lng, f.address, f.region_code, f.agency_key, f.agency_name, f.agency_current_name, f.manager_key, f.manager_name, f.amount_kind, f.amount_confirmed_won, f.violation_law, f.rating, f.category, g.amount_public, g.law_public, g.rating_public
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
         order by f.source_report_key, (f.report_number is null), f.first_accepted_at, f.contributor_id, f.dataset_key
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
                     order by i.answer_time desc, i.completed_date desc nulls last, i.first_accepted_at, i.contributor_id, i.dataset_key
                     rows between unbounded preceding and unbounded following)
    ), ordered as materialized (
 select r.report_identity,r.contributor_id,r.first_accepted_at,r.report_date,r.completed_date,r.identity_report_date,r.identity_completed_date,r.status,r.disposition,r.vehicle_raw,r.lat,r.lng,r.address,r.region_code,r.agency_key,r.agency_name,r.agency_current_name,r.manager_key,r.manager_name,r.is_representative,r.amount_kind,r.amount_confirmed_won,r.amount_public,r.law_public,r.rating_public,r.violation_law,r.rating,row_number() over () as ord from ranked r
 where (p_category='all' or category=p_category)
 and (p_agency_key is null or agency_key=p_agency_key) and (p_manager_key is null or manager_key=p_manager_key)
 and (p_bbox is null or (lat is not null and lng between p_bbox[1] and p_bbox[3] and lat between p_bbox[2] and p_bbox[4]))
 and (case p_date_basis when 'report_date' then identity_report_date else identity_completed_date end) between v_from and p_end
) , address_inputs as materialized (
 select raw,private.screen_address(raw) as address from (select distinct address as raw from ordered) a
), addresses as materialized (
 select raw,address,private.screen_place_key(address) as place from address_inputs
), plates as materialized (
 select raw,private.screen_plate(raw) as plate from (select distinct vehicle_raw as raw from ordered) a
), region_names as materialized (
 select raw,private.analytics_region(raw,null,null) as code from (select distinct region_code as raw from ordered) a
), region_points as materialized (
 select k.*,private.analytics_region(k.raw,k.lat,k.lng) as code from (
 select distinct o.region_code as raw,o.lat,o.lng from ordered o left join region_names n on n.raw=o.region_code
 where n.code is null and o.lat is not null and o.lng is not null) k
), laws as materialized (
 select raw,private.screen_law(raw) as law from (select distinct violation_law as raw from ordered where law_public) a
), normalized as materialized (
 select o.ord,o.report_identity,o.contributor_id,o.first_accepted_at,o.report_date,o.completed_date,o.status,o.disposition,o.lat,o.lng,o.agency_key,o.agency_name,o.agency_current_name,o.manager_key,o.manager_name,o.is_representative,o.amount_confirmed_won,a.address as place_address,a.place,
 coalesce(rn.code,rp.code) as region,l.law,p.plate,
 case p_date_basis when 'report_date' then identity_report_date else identity_completed_date end as day,
 case p_date_basis when 'report_date' then completed_date else report_date end as other_day,
 status in ('accepted','partial','rejected','withdrawn','transferred','completed_unknown') as done,
 case when status in ('accepted','partial','rejected','completed_unknown') and completed_date>=report_date then completed_date-report_date end as days,
 case when amount_kind='combined' then 'combined' when amount_kind='penalty' then case when disposition='fine' then 'conflict' else 'penalty' end
 when amount_kind='fine' and disposition<>'fine' then 'conflict' when disposition<>'fine' then 'none'
 when amount_kind is distinct from 'fine' or status not in ('accepted','partial') then 'conflict'
 when not amount_public then case when amount_confirmed_won is null then 'unconfirmed' else 'undisclosed' end
 when amount_confirmed_won is null then 'unconfirmed' else 'confirmed' end as amount_class,
 case when rating_public then rating end as stars
 from ordered o left join addresses a on a.raw=o.address left join plates p on p.raw=o.vehicle_raw
 left join region_names rn on rn.raw=o.region_code
 left join region_points rp on rn.code is null and rp.raw is not distinct from o.region_code and rp.lat=o.lat and rp.lng=o.lng
 left join laws l on law_public and l.raw=o.violation_law
), filtered as materialized (
 select * from normalized where (p_scope->>'region_code' is null or region like (p_scope->>'region_code')||'%')
 and (p_scope->>'law' is null or case when p_scope->>'law'='__none__' then law is null else law=private.screen_law(p_scope->>'law') end)
) , own_done as materialized (
 select distinct on(report_identity) ord from filtered where contributor_id=p_user and done
 order by report_identity,first_accepted_at,ord
), own as materialized (
 select distinct on(report_identity) ord from filtered where contributor_id=p_user
 order by report_identity,first_accepted_at,ord
), sides as materialized (
 select f.*,s.side collate "C" as side,s.report_member,s.done_member,case when day>=p_start then 0 else 1 end as period
 from filtered f left join own m on m.ord=f.ord left join own_done md on md.ord=f.ord
 cross join lateral (select 'all' as side,true as report_member,f.done as done_member where f.is_representative
 union all select 'mine',m.ord is not null,md.ord is not null where (m.ord is not null or md.ord is not null)
 and exists(select 1 from jsonb_array_elements(p_panels) p where p->>'path'='compare')) s
), focus as materialized (
 select distinct substr(p->>'path',8) as key from jsonb_array_elements(p_panels) p where p->>'path' like 'places/pl1:%'
), expanded as (
 select s.*,g.kind collate "C" as kind,g.k collate "C" as k,g.focus collate "C" as focus from sides s cross join lateral (
 select 'summary' as kind,''::text as k,''::text as focus
 union all select 'month',to_char(day,'YYYY-MM'),'' where period=0
 union all select 'agency',coalesce(nullif(agency_key,''),'agency-unknown'),'' where period=0 and done_member
 union all select 'manager',coalesce(nullif(agency_key,''),'agency-unknown')||':'||coalesce(nullif(manager_key,''),'manager-unknown'),'' where period=0 and done_member
 union all select 'law',coalesce(law,''),'' where period=0 and done_member and side='all'
 union all select 'region',coalesce(region,''),'' where period=0
 union all select 'region',left(region,2),'' where period=0 and region is not null
 union all select 'place',coalesce(place,''),'' where period=0
 union all select 'focus','',place where side='all' and place in(select key from focus)
 union all select 'agency',coalesce(nullif(agency_key,''),'agency-unknown'),place where side='all' and period=0 and done_member and place in(select key from focus)
 union all select 'manager',coalesce(nullif(agency_key,''),'agency-unknown')||':'||coalesce(nullif(manager_key,''),'manager-unknown'),place where side='all' and period=0 and done_member and place in(select key from focus)
 union all select 'heat',case when p_scope->>'agency_key' is null then coalesce(nullif(agency_key,''),'agency-unknown') else
 coalesce(nullif(agency_key,''),'agency-unknown')||':'||coalesce(nullif(manager_key,''),'manager-unknown') end,law where side='all' and period=0 and done_member and law is not null
 ) g
), stats as (
 select side,period,kind,k,focus,min(ord) as ord,
 count(*) filter(where report_member) as n,count(*) filter(where done_member) as c,
 count(*) filter(where done_member and status='accepted') as a,count(*) filter(where done_member and status='partial') as p,count(*) filter(where done_member and status='rejected') as r,
 count(*) filter(where done_member and disposition='fine') as f,count(*) filter(where done_member and disposition='warning') as w,count(*) filter(where done_member and disposition='penalty') as penalty,
 count(*) filter(where report_member and other_day is null) as missing,
 count(*) filter(where done_member and completed_date is null) as answer_missing,
 count(days) filter(where done_member) as dn,sum(days) filter(where done_member) as ds,array_agg(days::bigint) filter(where done_member and days is not null and kind not in ('place','law','heat')) as dvalues,
 min(days) filter(where done_member) as dmin,max(days) filter(where done_member) as dmax,
 count(*) filter(where done_member and status in ('accepted','partial','rejected','completed_unknown') and completed_date is not null and report_date is null) as dnr,
 count(*) filter(where done_member and status in ('accepted','partial','rejected','completed_unknown') and completed_date<report_date) as drev,
 count(*) filter(where done_member and status in ('accepted','partial','rejected','completed_unknown') and completed_date is null) as dna,
 count(*) filter(where done_member and amount_class='confirmed') as an,
 sum(amount_confirmed_won) filter(where done_member and amount_class='confirmed') as asum,
 array_agg(amount_confirmed_won) filter(where kind in ('summary','focus') and done_member and amount_class='confirmed') as avalues,
 count(*) filter(where done_member and amount_class='confirmed' and amount_confirmed_won=0) as az,
 count(*) filter(where done_member and amount_class='unconfirmed') as aunconfirmed,
 count(*) filter(where done_member and amount_class='undisclosed') as aundisclosed,
 count(*) filter(where done_member and amount_class='conflict') as aconflict,
 count(*) filter(where done_member and amount_class='penalty') as apenalty,
 count(*) filter(where done_member and amount_class='combined') as acombined,
 count(stars) filter(where done_member) as rn,sum(stars) filter(where done_member) as rs,
 count(*) filter(where kind='summary' and done_member and days between 0 and 6) as h0,
 count(*) filter(where kind='summary' and done_member and days between 7 and 13) as h1,
 count(*) filter(where kind='summary' and done_member and days between 14 and 20) as h2,
 count(*) filter(where kind='summary' and done_member and days between 21 and 27) as h3,
 count(*) filter(where kind='summary' and done_member and days between 28 and 34) as h4,
 count(*) filter(where kind='summary' and done_member and days between 35 and 41) as h5,
 count(*) filter(where kind='summary' and done_member and days between 42 and 48) as h6,
 count(*) filter(where kind='summary' and done_member and days between 49 and 55) as h7,
 count(*) filter(where kind='summary' and done_member and days between 56 and 62) as h8,
 count(*) filter(where kind='summary' and done_member and days between 63 and 69) as h9,
 count(*) filter(where kind='summary' and done_member and days between 70 and 76) as h10,
 count(*) filter(where kind='summary' and done_member and days between 77 and 83) as h11,
 count(*) filter(where kind='summary' and done_member and days >=84) as h12,
 count(*) filter(where kind='summary' and done_member and true and stars=1) as rall1,
 count(*) filter(where kind='summary' and done_member and true and stars=2) as rall2,
 count(*) filter(where kind='summary' and done_member and true and stars=3) as rall3,
 count(*) filter(where kind='summary' and done_member and true and stars=4) as rall4,
 count(*) filter(where kind='summary' and done_member and true and stars=5) as rall5,
 count(*) filter(where kind='summary' and done_member and status='accepted' and stars=1) as raccepted1,
 count(*) filter(where kind='summary' and done_member and status='accepted' and stars=2) as raccepted2,
 count(*) filter(where kind='summary' and done_member and status='accepted' and stars=3) as raccepted3,
 count(*) filter(where kind='summary' and done_member and status='accepted' and stars=4) as raccepted4,
 count(*) filter(where kind='summary' and done_member and status='accepted' and stars=5) as raccepted5,
 count(*) filter(where kind='summary' and done_member and status='partial' and stars=1) as rpartial1,
 count(*) filter(where kind='summary' and done_member and status='partial' and stars=2) as rpartial2,
 count(*) filter(where kind='summary' and done_member and status='partial' and stars=3) as rpartial3,
 count(*) filter(where kind='summary' and done_member and status='partial' and stars=4) as rpartial4,
 count(*) filter(where kind='summary' and done_member and status='partial' and stars=5) as rpartial5,
 count(*) filter(where kind='summary' and done_member and status='rejected' and stars=1) as rrejected1,
 count(*) filter(where kind='summary' and done_member and status='rejected' and stars=2) as rrejected2,
 count(*) filter(where kind='summary' and done_member and status='rejected' and stars=3) as rrejected3,
 count(*) filter(where kind='summary' and done_member and status='rejected' and stars=4) as rrejected4,
 count(*) filter(where kind='summary' and done_member and status='rejected' and stars=5) as rrejected5,
 count(*) filter(where kind='summary' and done_member and disposition='fine' and stars=1) as rfine1,
 count(*) filter(where kind='summary' and done_member and disposition='fine' and stars=2) as rfine2,
 count(*) filter(where kind='summary' and done_member and disposition='fine' and stars=3) as rfine3,
 count(*) filter(where kind='summary' and done_member and disposition='fine' and stars=4) as rfine4,
 count(*) filter(where kind='summary' and done_member and disposition='fine' and stars=5) as rfine5,
 count(*) filter(where kind='summary' and done_member and status not in ('accepted','partial','rejected') and stars=1) as runknown1,
 count(*) filter(where kind='summary' and done_member and status not in ('accepted','partial','rejected') and stars=2) as runknown2,
 count(*) filter(where kind='summary' and done_member and status not in ('accepted','partial','rejected') and stars=3) as runknown3,
 count(*) filter(where kind='summary' and done_member and status not in ('accepted','partial','rejected') and stars=4) as runknown4,
 count(*) filter(where kind='summary' and done_member and status not in ('accepted','partial','rejected') and stars=5) as runknown5
 from expanded group by side,period,kind,k,focus
) , stat_values as materialized (
 select s.*,private.screen_quantiles(dvalues) as dq,private.screen_quantiles(avalues) as aq from stats s
), place_counts as (
 select side,period,count(distinct place collate "C") filter(where report_member) as n from sides group by side,period
), stat_json as (
 select case when kind='place' then json_build_object('side',side,'period',period,'kind',kind,'k',k,'focus',focus,
 'n',stats.n,'c',c,'a',a,'p',p,'r',r,'f',f,'w',w) else json_build_object(
 'side',side,
 'period',period,
 'kind',kind,
 'k',k,
 'focus',focus,
 'ord',stats.ord,
 'label',json_build_array(o.agency_key,coalesce(nullif(o.agency_current_name,''),nullif(o.agency_name,''),'기관 정보 없음'),o.manager_key,o.manager_name),
 'n',stats.n,
 'c',c,
 'a',a,
 'p',p,
 'r',r,
 'f',f,
 'w',w,
 'penalty',penalty,
 'places',case when kind='summary' then pc.n when kind='focus' and stats.n>0 then 1 else 0 end,
 'missing',missing,
 'answer_missing',answer_missing,
 'duration',json_build_array(dn,ds,dq[1],dq[2],dmin,dmax,dnr,drev,dna),
 'amount',json_build_array(an,asum,aq[1],az,aunconfirmed,aundisclosed,aconflict,apenalty,acombined),
 'rating',json_build_array(rn,rs),
 'histogram',json_build_array(h0,h1,h2,h3,h4,h5,h6,h7,h8,h9,h10,h11,h12),
 'ratings',json_build_array(json_build_array(rall1,rall2,rall3,rall4,rall5),json_build_array(raccepted1,raccepted2,raccepted3,raccepted4,raccepted5),json_build_array(rpartial1,rpartial2,rpartial3,rpartial4,rpartial5),json_build_array(rrejected1,rrejected2,rrejected3,rrejected4,rrejected5),json_build_array(rfine1,rfine2,rfine3,rfine4,rfine5),json_build_array(runknown1,runknown2,runknown3,runknown4,runknown5))
 ) end as value from stat_values stats join place_counts pc using(side,period) join ordered o on o.ord=stats.ord order by stats.ord
), coords as (
 select side,place,lat,lng,sum(report_member::int+done_member::int) as n,
 min(report_identity collate "C") as identity from sides where period=0 and place is not null and lat is not null and lng is not null
 group by side,place,lat,lng
) , focus_coords as (
 select side,place,lat,lng,count(*) as n,min(report_identity collate "C") as identity from sides
 where side='all' and period=0 and report_member and place in(select key from focus) and lat is not null and lng is not null
 group by side,place,lat,lng
), anchor_coords as (
 select distinct on(side,place) side,place,lat,lng,identity from (
 select * from coords union all select 'focus',place,lat,lng,n,identity from focus_coords) c
 order by side,place,n desc,identity collate "C"
), anchors as (
 select distinct on(c.side,s.place) c.side,s.place,s.lat,s.lng,s.place_address,s.region
 from sides s join anchor_coords c on (c.side=s.side or (c.side='focus' and s.side='all')) and c.place=s.place and c.lat=s.lat and c.lng=s.lng and c.identity=s.report_identity
 order by c.side,s.place,s.ord
), full_counts as (
 select case when day>=p_start then 0 else 1 end as period,g.place,count(*) as n,count(distinct contributor_id) as people,
 bool_or(contributor_id<>p_user) as shared from filtered cross join lateral (
 select ''::text as place union all select place where place is not null) g
 group by 1,g.place
), vehicles as (
 select plate,count(*) as n,count(distinct report_date) as days from sides where side='all' and period=0 and plate is not null group by plate
), vehicle_totals as (
 select count(*) filter(where plate is null) as no_plate,count(*) filter(where plate is not null and report_date is null) as no_date
 from sides where side='all' and period=0
)
select (select n from budget),json_build_object('encoding','screen-aggregate-v1',
 'stats',coalesce((select json_agg(value) from stat_json),'[]'::json),
 'anchors',coalesce((select json_agg(json_build_array(side,place,lat,lng,place_address,region)) from anchors),'[]'::json),
 'full',coalesce((select json_agg(json_build_array(period,place,n,people,shared)) from full_counts),'[]'::json),
 'vehicles',json_build_object('identifiable',coalesce((select sum(n) from vehicles),0),
 'top',coalesce((select json_agg(json_build_array(private.screen_mask_plate(plate),n)) from (select * from vehicles order by n desc,plate collate "en-x-icu" limit 5) v),'[]'::json),
 'days',(select json_build_array(count(*) filter(where days=1),count(*) filter(where days=2),count(*) filter(where days between 3 and 4),count(*) filter(where days>=5)) from vehicles),
 'excluded',(select json_build_array(no_plate,no_date) from vehicle_totals)),
 'source_min',(select min(case p_date_basis when 'report_date' then report_date else completed_date end) from ordered)
) into v_budget,result;
if v_budget>100000 then raise exception 'RESULT_TOO_LARGE';end if;
return result;
end $$;

create function private.analytics_screen_aggregate_v2(p_scope jsonb,p_user uuid,p_panels jsonb)
returns json language plpgsql stable security definer set search_path='' set enable_nestloop=off set enable_sort=off set work_mem='16MB' as $$
declare p_date_basis text:=p_scope->>'date_basis'; p_start date:=(p_scope->>'start')::date; p_end date:=(p_scope->>'end')::date;
 p_category text:=p_scope->>'category';p_agency_key text:=p_scope->>'agency_key';p_manager_key text:=p_scope->>'manager_key';
 p_bbox double precision[];v_from date;result json;v_budget bigint;
begin
 if p_date_basis is null or p_date_basis not in ('report_date','completed_date') or p_start is null or p_end is null or p_end<p_start
 or p_start-(p_end-p_start+1)<date '1900-01-01' or p_category is null or p_category not in ('all','traffic','parking','other')
 or jsonb_typeof(p_panels)<>'array' or jsonb_array_length(p_panels)>8 then raise exception 'INVALID_QUERY';end if;
 if jsonb_typeof(p_scope->'bbox')='array' then select array_agg(x::double precision order by n) into p_bbox
 from jsonb_array_elements_text(p_scope->'bbox') with ordinality a(x,n);end if;
 v_from:=p_start-(p_end-p_start+1);
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
        select f.dataset_key, f.source_report_key, f.report_number, f.payload_sha256, f.answer_accepted_at, f.contributor_id, f.first_accepted_at, f.report_date, f.completed_date, f.status, f.disposition, f.vehicle_raw, f.lat, f.lng, f.address, f.region_code, f.agency_key, f.agency_name, f.agency_current_name, f.manager_key, f.manager_name, f.amount_kind, f.amount_confirmed_won, f.violation_law, f.rating, f.category, g.amount_public, g.law_public, g.rating_public
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
         order by f.source_report_key, (f.report_number is null), f.first_accepted_at, f.contributor_id, f.dataset_key
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
                     order by i.answer_time desc, i.completed_date desc nulls last, i.first_accepted_at, i.contributor_id, i.dataset_key
                     rows between unbounded preceding and unbounded following)
    ), ordered as materialized (
 select r.report_identity,r.contributor_id,r.first_accepted_at,r.report_date,r.completed_date,r.identity_report_date,r.identity_completed_date,r.status,r.disposition,r.vehicle_raw,r.lat,r.lng,r.address,r.region_code,r.agency_key,r.agency_name,r.agency_current_name,r.manager_key,r.manager_name,r.is_representative,r.amount_kind,r.amount_confirmed_won,r.amount_public,r.law_public,r.rating_public,r.violation_law,r.rating,row_number() over () as ord from ranked r
 where (p_category='all' or category=p_category)
 and (p_agency_key is null or agency_key=p_agency_key) and (p_manager_key is null or manager_key=p_manager_key)
 and (p_bbox is null or (lat is not null and lng between p_bbox[1] and p_bbox[3] and lat between p_bbox[2] and p_bbox[4]))
 and (case p_date_basis when 'report_date' then identity_report_date else identity_completed_date end) between v_from and p_end
) , address_inputs as materialized (
 select raw,private.screen_address(raw) as address from (select distinct address as raw from ordered) a
), addresses as materialized (
 select raw,address,private.screen_place_key(address) as place from address_inputs
), plates as materialized (
 select raw,private.screen_plate(raw) as plate from (select distinct vehicle_raw as raw from ordered) a
), region_names as materialized (
 select raw,private.analytics_region(raw,null,null) as code from (select distinct region_code as raw from ordered) a
), region_points as materialized (
 select k.*,private.analytics_region(k.raw,k.lat,k.lng) as code from (
 select distinct o.region_code as raw,o.lat,o.lng from ordered o left join region_names n on n.raw=o.region_code
 where n.code is null and o.lat is not null and o.lng is not null) k
), laws as materialized (
 select raw,private.screen_law(raw) as law from (select distinct violation_law as raw from ordered where law_public) a
), normalized as materialized (
 select o.ord,o.report_identity,o.contributor_id,o.first_accepted_at,o.report_date,o.completed_date,o.status,o.disposition,o.lat,o.lng,o.agency_key,o.agency_name,o.agency_current_name,o.manager_key,o.manager_name,o.is_representative,o.amount_confirmed_won,a.address as place_address,a.place,
 coalesce(rn.code,rp.code) as region,l.law,p.plate,
 case p_date_basis when 'report_date' then identity_report_date else identity_completed_date end as day,
 case p_date_basis when 'report_date' then completed_date else report_date end as other_day,
 status in ('accepted','partial','rejected','withdrawn','transferred','completed_unknown') as done,
 case when status in ('accepted','partial','rejected','completed_unknown') and completed_date>=report_date then completed_date-report_date end as days,
 case when amount_kind='combined' then 'combined' when amount_kind='penalty' then case when disposition='fine' then 'conflict' else 'penalty' end
 when amount_kind='fine' and disposition<>'fine' then 'conflict' when disposition<>'fine' then 'none'
 when amount_kind is distinct from 'fine' or status not in ('accepted','partial') then 'conflict'
 when not amount_public then case when amount_confirmed_won is null then 'unconfirmed' else 'undisclosed' end
 when amount_confirmed_won is null then 'unconfirmed' else 'confirmed' end as amount_class,
 case when rating_public then rating end as stars
 from ordered o left join addresses a on a.raw=o.address left join plates p on p.raw=o.vehicle_raw
 left join region_names rn on rn.raw=o.region_code
 left join region_points rp on rn.code is null and rp.raw is not distinct from o.region_code and rp.lat=o.lat and rp.lng=o.lng
 left join laws l on law_public and l.raw=o.violation_law
), filtered as materialized (
 select * from normalized where (p_scope->>'region_code' is null or region like (p_scope->>'region_code')||'%')
 and (p_scope->>'law' is null or case when p_scope->>'law'='__none__' then law is null else law=private.screen_law(p_scope->>'law') end)
) , own_done as materialized (
 select distinct on(report_identity) ord from filtered where contributor_id=p_user and done
 order by report_identity,first_accepted_at,ord
), own as materialized (
 select distinct on(report_identity) ord from filtered where contributor_id=p_user
 order by report_identity,first_accepted_at,ord
), sides as materialized (
 select f.*,s.side collate "C" as side,s.report_member,s.done_member,case when day>=p_start then 0 else 1 end as period
 from filtered f left join own m on m.ord=f.ord left join own_done md on md.ord=f.ord
 cross join lateral (select 'all' as side,true as report_member,f.done as done_member where f.is_representative
 union all select 'mine',m.ord is not null,md.ord is not null where (m.ord is not null or md.ord is not null)
 and exists(select 1 from jsonb_array_elements(p_panels) p where p->>'path'='compare')) s
), focus as materialized (
 select distinct substr(p->>'path',8) as key from jsonb_array_elements(p_panels) p where p->>'path' like 'places/pl1:%'
), expanded as not materialized (
 select s.*,g.kind collate "C" as kind,g.k collate "C" as k,g.focus collate "C" as focus from sides s cross join lateral (
 select 'summary' as kind,''::text as k,''::text as focus
 union all select 'month',to_char(day,'YYYY-MM'),'' where period=0
 union all select 'agency',coalesce(nullif(agency_key,''),'agency-unknown'),'' where period=0 and done_member
 union all select 'manager',coalesce(nullif(agency_key,''),'agency-unknown')||':'||coalesce(nullif(manager_key,''),'manager-unknown'),'' where period=0 and done_member
 union all select 'law',coalesce(law,''),'' where period=0 and done_member and side='all'
 union all select 'region',coalesce(region,''),'' where period=0
 union all select 'region',left(region,2),'' where period=0 and region is not null
 union all select 'place',coalesce(place,''),'' where period=0
 union all select 'focus','',place where side='all' and place in(select key from focus)
 union all select 'agency',coalesce(nullif(agency_key,''),'agency-unknown'),place where side='all' and period=0 and done_member and place in(select key from focus)
 union all select 'manager',coalesce(nullif(agency_key,''),'agency-unknown')||':'||coalesce(nullif(manager_key,''),'manager-unknown'),place where side='all' and period=0 and done_member and place in(select key from focus)
 union all select 'heat',case when p_scope->>'agency_key' is null then coalesce(nullif(agency_key,''),'agency-unknown') else
 coalesce(nullif(agency_key,''),'agency-unknown')||':'||coalesce(nullif(manager_key,''),'manager-unknown') end,law where side='all' and period=0 and done_member and law is not null
 ) g
), stats as (
 select side,period,kind,k,focus,min(ord) as ord,
 count(*) filter(where report_member) as n,count(*) filter(where done_member) as c,
 count(*) filter(where done_member and status='accepted') as a,count(*) filter(where done_member and status='partial') as p,count(*) filter(where done_member and status='rejected') as r,
 count(*) filter(where done_member and disposition='fine') as f,count(*) filter(where done_member and disposition='warning') as w,count(*) filter(where done_member and disposition='penalty') as penalty,
 count(*) filter(where report_member and other_day is null) as missing,
 count(*) filter(where done_member and completed_date is null) as answer_missing,
 count(days) filter(where done_member) as dn,sum(days) filter(where done_member) as ds,array_agg(days::bigint) filter(where done_member and days is not null and kind not in ('place','law','heat')) as dvalues,
 min(days) filter(where done_member) as dmin,max(days) filter(where done_member) as dmax,
 count(*) filter(where done_member and status in ('accepted','partial','rejected','completed_unknown') and completed_date is not null and report_date is null) as dnr,
 count(*) filter(where done_member and status in ('accepted','partial','rejected','completed_unknown') and completed_date<report_date) as drev,
 count(*) filter(where done_member and status in ('accepted','partial','rejected','completed_unknown') and completed_date is null) as dna,
 count(*) filter(where done_member and amount_class='confirmed') as an,
 sum(amount_confirmed_won) filter(where done_member and amount_class='confirmed') as asum,
 array_agg(amount_confirmed_won) filter(where kind in ('summary','focus') and done_member and amount_class='confirmed') as avalues,
 count(*) filter(where done_member and amount_class='confirmed' and amount_confirmed_won=0) as az,
 count(*) filter(where done_member and amount_class='unconfirmed') as aunconfirmed,
 count(*) filter(where done_member and amount_class='undisclosed') as aundisclosed,
 count(*) filter(where done_member and amount_class='conflict') as aconflict,
 count(*) filter(where done_member and amount_class='penalty') as apenalty,
 count(*) filter(where done_member and amount_class='combined') as acombined,
 count(stars) filter(where done_member) as rn,sum(stars) filter(where done_member) as rs
 from expanded where kind not in ('heat','place') group by side,period,kind,k,focus
), summary_details as materialized (
 select side,period,
 count(*) filter(where done_member and days between 0 and 6) as h0,
 count(*) filter(where done_member and days between 7 and 13) as h1,
 count(*) filter(where done_member and days between 14 and 20) as h2,
 count(*) filter(where done_member and days between 21 and 27) as h3,
 count(*) filter(where done_member and days between 28 and 34) as h4,
 count(*) filter(where done_member and days between 35 and 41) as h5,
 count(*) filter(where done_member and days between 42 and 48) as h6,
 count(*) filter(where done_member and days between 49 and 55) as h7,
 count(*) filter(where done_member and days between 56 and 62) as h8,
 count(*) filter(where done_member and days between 63 and 69) as h9,
 count(*) filter(where done_member and days between 70 and 76) as h10,
 count(*) filter(where done_member and days between 77 and 83) as h11,
 count(*) filter(where done_member and days >=84) as h12,
 count(*) filter(where done_member and true and stars=1) as rall1,
 count(*) filter(where done_member and true and stars=2) as rall2,
 count(*) filter(where done_member and true and stars=3) as rall3,
 count(*) filter(where done_member and true and stars=4) as rall4,
 count(*) filter(where done_member and true and stars=5) as rall5,
 count(*) filter(where done_member and status='accepted' and stars=1) as raccepted1,
 count(*) filter(where done_member and status='accepted' and stars=2) as raccepted2,
 count(*) filter(where done_member and status='accepted' and stars=3) as raccepted3,
 count(*) filter(where done_member and status='accepted' and stars=4) as raccepted4,
 count(*) filter(where done_member and status='accepted' and stars=5) as raccepted5,
 count(*) filter(where done_member and status='partial' and stars=1) as rpartial1,
 count(*) filter(where done_member and status='partial' and stars=2) as rpartial2,
 count(*) filter(where done_member and status='partial' and stars=3) as rpartial3,
 count(*) filter(where done_member and status='partial' and stars=4) as rpartial4,
 count(*) filter(where done_member and status='partial' and stars=5) as rpartial5,
 count(*) filter(where done_member and status='rejected' and stars=1) as rrejected1,
 count(*) filter(where done_member and status='rejected' and stars=2) as rrejected2,
 count(*) filter(where done_member and status='rejected' and stars=3) as rrejected3,
 count(*) filter(where done_member and status='rejected' and stars=4) as rrejected4,
 count(*) filter(where done_member and status='rejected' and stars=5) as rrejected5,
 count(*) filter(where done_member and disposition='fine' and stars=1) as rfine1,
 count(*) filter(where done_member and disposition='fine' and stars=2) as rfine2,
 count(*) filter(where done_member and disposition='fine' and stars=3) as rfine3,
 count(*) filter(where done_member and disposition='fine' and stars=4) as rfine4,
 count(*) filter(where done_member and disposition='fine' and stars=5) as rfine5,
 count(*) filter(where done_member and status not in ('accepted','partial','rejected') and stars=1) as runknown1,
 count(*) filter(where done_member and status not in ('accepted','partial','rejected') and stars=2) as runknown2,
 count(*) filter(where done_member and status not in ('accepted','partial','rejected') and stars=3) as runknown3,
 count(*) filter(where done_member and status not in ('accepted','partial','rejected') and stars=4) as runknown4,
 count(*) filter(where done_member and status not in ('accepted','partial','rejected') and stars=5) as runknown5
 from sides group by side,period) , stat_values as materialized (
 select s.*,private.screen_quantiles(dvalues) as dq,private.screen_quantiles(avalues) as aq from stats s
), place_counts as (
 select side,period,count(distinct place collate "C") filter(where report_member) as n from sides group by side,period
), light_stats as materialized (
 select side,period,kind,k,focus,min(ord) as ord,
 count(*) filter(where report_member) as n,count(*) filter(where done_member) as c,
 count(*) filter(where done_member and status='accepted') as a,
 count(*) filter(where done_member and status='partial') as p,
 count(*) filter(where done_member and status='rejected') as r,
 count(*) filter(where done_member and disposition='fine') as f,
 count(*) filter(where done_member and disposition='warning') as w
 from expanded where kind in ('place','heat') group by side,period,kind,k,focus
), heat_rows as materialized (
 select k,sum(c) as n,min(ord) as ord from light_stats where kind='heat' group by k
), heat_laws as materialized (
 select focus,sum(c) as n from light_stats where kind='heat' group by focus
), heat_top_rows as materialized (
 select h.*,o.agency_key,coalesce(nullif(o.agency_current_name,''),nullif(o.agency_name,''),'기관 정보 없음') as agency_name,o.manager_key,o.manager_name
 from heat_rows h join ordered o using(ord)
 order by n desc,coalesce(nullif(o.agency_current_name,''),nullif(o.agency_name,''),'기관 정보 없음') collate "ko-x-icu",k collate "en-x-icu" limit 40
), heat_top_laws as materialized (
 select * from heat_laws order by n desc,focus collate "ko-x-icu" limit 16
), stat_json as (
 select json_build_object(
 'side',side,'period',period,'kind',kind,'k',k,'focus',focus,'ord',stats.ord,
 'label',json_build_array(o.agency_key,coalesce(nullif(o.agency_current_name,''),nullif(o.agency_name,''),'기관 정보 없음'),o.manager_key,o.manager_name),
 'n',stats.n,'c',c,'a',a,'p',p,'r',r,'f',f,'w',w,'penalty',penalty,
 'places',case when kind='summary' then pc.n when kind='focus' and stats.n>0 then 1 else 0 end,
 'missing',missing,'answer_missing',answer_missing,
 'duration',json_build_array(dn,ds,dq[1],dq[2],dmin,dmax,dnr,drev,dna),
 'amount',json_build_array(an,asum,aq[1],az,aunconfirmed,aundisclosed,aconflict,apenalty,acombined),
 'rating',json_build_array(rn,rs)) as value,stats.ord
 from stat_values stats join place_counts pc using(side,period) join ordered o on o.ord=stats.ord
 where kind<>'summary'
 union all
 select json_build_object(
 'side',side,'period',period,'kind',kind,'k',k,'focus',focus,'ord',stats.ord,
 'n',stats.n,'c',c,'a',a,'p',p,'r',r,'f',f,'w',w,'penalty',penalty,'places',pc.n,
 'missing',missing,'answer_missing',answer_missing,
 'duration',json_build_array(dn,ds,dq[1],dq[2],dmin,dmax,dnr,drev,dna),
 'amount',json_build_array(an,asum,aq[1],az,aunconfirmed,aundisclosed,aconflict,apenalty,acombined),
 'rating',json_build_array(rn,rs),
 'histogram',json_build_array(h0,h1,h2,h3,h4,h5,h6,h7,h8,h9,h10,h11,h12),
 'ratings',json_build_array(json_build_array(rall1,rall2,rall3,rall4,rall5),json_build_array(raccepted1,raccepted2,raccepted3,raccepted4,raccepted5),json_build_array(rpartial1,rpartial2,rpartial3,rpartial4,rpartial5),json_build_array(rrejected1,rrejected2,rrejected3,rrejected4,rrejected5),json_build_array(rfine1,rfine2,rfine3,rfine4,rfine5),json_build_array(runknown1,runknown2,runknown3,runknown4,runknown5))) as value,stats.ord
 from stat_values stats join place_counts pc using(side,period) join summary_details using(side,period) where kind='summary'
 union all
 select json_build_object('side',side,'period',period,'kind',kind,'k',k,'focus',focus,
 'n',n,'c',c,'a',a,'p',p,'r',r,'f',f,'w',w),ord from light_stats where kind='place'
), coords as (
 select side,place,lat,lng,sum(report_member::int+done_member::int) as n,
 min(report_identity collate "C") as identity from sides where period=0 and place is not null and lat is not null and lng is not null
 group by side,place,lat,lng
) , focus_coords as (
 select side,place,lat,lng,count(*) as n,min(report_identity collate "C") as identity from sides
 where side='all' and period=0 and report_member and place in(select key from focus) and lat is not null and lng is not null
 group by side,place,lat,lng
), anchor_coords as (
 select distinct on(side,place) side,place,lat,lng,identity from (
 select * from coords union all select 'focus',place,lat,lng,n,identity from focus_coords) c
 order by side,place,n desc,identity collate "C"
), anchors as (
 select distinct on(c.side,s.place) c.side,s.place,s.lat,s.lng,s.place_address,s.region
 from sides s join anchor_coords c on (c.side=s.side or (c.side='focus' and s.side='all')) and c.place=s.place and c.lat=s.lat and c.lng=s.lng and c.identity=s.report_identity
 order by c.side,s.place,s.ord
), full_counts as (
 select case when day>=p_start then 0 else 1 end as period,g.place,count(*) as n,count(distinct contributor_id) as people,
 bool_or(contributor_id<>p_user) as shared from filtered cross join lateral (
 select ''::text as place union all select place where place in(select key from focus) or place in(select place from sides where side='mine' and period=0)) g
 group by 1,g.place
), vehicles as (
 select plate,count(*) as n,count(distinct report_date) as days from sides where side='all' and period=0 and plate is not null group by plate
), vehicle_totals as (
 select count(*) filter(where plate is null) as no_plate,count(*) filter(where plate is not null and report_date is null) as no_date
 from sides where side='all' and period=0
)
select (select n from budget),json_build_object('encoding','screen-aggregate-v2',
 'stats',coalesce((select json_agg(value order by ord) from stat_json),'[]'::json),
 'heat',json_build_object('row_kind',case when p_scope->>'agency_key' is null then 'agency' else 'manager' end,
 'rows',coalesce((select json_agg(json_build_object('key',k,'agency_key',agency_key,'manager_key',case when p_scope->>'agency_key' is not null then manager_key end,
 'agency_name',agency_name,'manager_name',case when p_scope->>'agency_key' is not null then manager_name end,'completed_count',n)
 order by n desc,agency_name collate "ko-x-icu",k collate "en-x-icu") from heat_top_rows),'[]'::json),
 'laws',coalesce((select json_agg(json_build_object('law_key',focus,'completed_count',n) order by n desc,focus collate "ko-x-icu") from heat_top_laws),'[]'::json),
 'cells',coalesce((select json_agg(json_build_object('row_key',s.k,'law_key',s.focus,'completed_count',s.c,
 'outcomes',json_build_object('accepted',s.a,'partial',s.p,'rejected',s.r,'result_known',s.a+s.p+s.r,'result_unknown',s.c-s.a-s.p-s.r),'fine_count',s.f)
 order by h.n desc,h.agency_name collate "ko-x-icu",h.k collate "en-x-icu",s.ord)
 from light_stats s join heat_top_rows h on h.k=s.k join heat_top_laws l on l.focus=s.focus where s.kind='heat'),'[]'::json),
 'total_rows',(select count(*) from heat_rows),'total_laws',(select count(*) from heat_laws)),
 'anchors',coalesce((select json_agg(json_build_array(side,place,lat,lng,place_address,region)) from anchors),'[]'::json),
 'full',coalesce((select json_agg(json_build_array(period,place,n,people,shared)) from full_counts),'[]'::json),
 'vehicles',json_build_object('identifiable',coalesce((select sum(n) from vehicles),0),
 'top',coalesce((select json_agg(json_build_array(private.screen_mask_plate(plate),n)) from (select * from vehicles order by n desc,plate collate "en-x-icu" limit 5) v),'[]'::json),
 'days',(select json_build_array(count(*) filter(where days=1),count(*) filter(where days=2),count(*) filter(where days between 3 and 4),count(*) filter(where days>=5)) from vehicles),
 'excluded',(select json_build_array(no_plate,no_date) from vehicle_totals)),
 'source_min',(select min(case p_date_basis when 'report_date' then report_date else completed_date end) from ordered)
) into v_budget,result;
if v_budget>100000 then raise exception 'RESULT_TOO_LARGE';end if;
return result;
end $$;

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
  if p_kind is null and p_options->>'screen_encoding'='screen-aggregate-v2' then
    if p_user is null or p_session is null then raise exception 'INVALID_QUERY';end if;
    data:=private.analytics_screen_aggregate_v2(p_scope,p_user,coalesce(p_options->'panels','[]'::jsonb));
    return json_build_object('state',s,'viewer',v,'aggregate',data);
  end if;
  if p_kind is null and p_options->>'screen_encoding'='screen-aggregate-v1' then
    if p_user is null or p_session is null then raise exception 'INVALID_QUERY';end if;
    data:=private.analytics_screen_aggregate(p_scope,p_user,coalesce(p_options->'panels','[]'::jsonb));
    return json_build_object('state',s,'viewer',v,'aggregate',data);
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
revoke all on function private.analytics_screen_aggregate_v2(jsonb,uuid,jsonb) from public,anon,authenticated;
grant execute on function private.analytics_screen_aggregate_v2(jsonb,uuid,jsonb) to postgres;
notify pgrst,'reload schema';
commit;
