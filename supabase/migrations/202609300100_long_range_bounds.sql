-- 2026-09-30 · long periods and the real data range (dashboard follow-up R1).
--
-- Root cause (confirmed in code): a 2014-09-30..2026-09-29 request was refused by FOUR stacked caps —
--   API     → server/publicHandler.ts parseScope   (> 1826 days → 400 INVALID_QUERY, the first one hit)
--   server  → server/aggregate.ts selectScope       (> 1827 days → throw → 503)
--   SQL     → internal_analytics_v2_facts           (p_end - p_start > 1826 → INVALID_QUERY → 503)
-- and '전체 기간' could not move the dates because private.analytics_state.data_min/data_max are never
-- maintained by the community ingest (NULL), so the client fell back to its fixed last-12-months default.
--
-- This migration (incremental; earlier files are not edited):
--   1. internal_analytics_v2_facts: no length cap; the row budget is checked on the candidate rows BEFORE
--      materialising (RESULT_TOO_LARGE), instead of `limit 100001` which could silently return a partial set.
--      Everything else (consent lineage, representative election, identity numbering, projections) is unchanged.
--   2. internal_analytics_v2_state: data_min/data_max = stored value if set, else the earliest/latest of
--      report_date and completed_date over the publicly listed facts (same eligibility as the facts RPC).
--
-- Rollback: re-run the function bodies of 202609281800_rating.sql (facts) and 202609240001_analytics_v2.sql
-- (state) in a new migration. No table or data changes here.

begin;

create or replace function public.internal_analytics_v2_facts(
    p_start date, p_end date, p_category text, p_region_code text,
    p_agency_key text, p_manager_key text, p_bbox double precision[]
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
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
    -- Row budget BEFORE materialising: the old `limit 100001` inside the CTE could cut the candidate rows and
    -- still return a (partial) result when the filtered count stayed under 100000. Now an over-budget scope is
    -- refused as a whole (RESULT_TOO_LARGE) and nothing partial ever leaves the database.
    select count(*) into v_scoped
      from private.community_report_facts f
      join private.contributor_profiles c on c.user_id = f.contributor_id and c.status = 'active'
     where f.public_state = 'completed'
       and private.community_lineage_active(f.consent_grant_id)
       and (f.report_date between v_previous_start and p_end or f.completed_date between v_previous_start and p_end);
    if v_scoped > 100000 then raise exception 'RESULT_TOO_LARGE'; end if;
    with scoped as (
        select f.*,
               -- the lineage's CURRENT grant decides: consenting to a disclosing version covers facts sent under
               -- the earlier version of the same lineage (the 2026-09-28.1 text says so); an older consent alone never does
               exists(select 1 from private.community_consent_grants g0
                        join private.community_consent_grants g on g.lineage_id = g0.lineage_id and g.revoked_at is null
                        join private.community_policy_disclosures d on d.version = g.policy_version and d.amounts_public
                       where g0.grant_id = f.consent_grant_id) as amount_public,
               -- the same rule for the violation law (위반법규): only a lineage whose current grant's policy lists it
               -- as published (2026-09-28.2 text: '위반법규' row) exposes it; otherwise it leaves the database as null
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
           and (f.report_date between v_previous_start and p_end or f.completed_date between v_previous_start and p_end)
    ),
    -- R2: the number a key was first seen with, fixed over the consent-active
    -- full history (no date window), so a numberless observation joins the same
    -- report_identity whatever period is queried. Only keys inside the queried
    -- window are numbered here, so widening the window never renumbers a key.
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
               -- H1: both numbers present and different -> separate identities;
               -- a missing number joins the key's first numbered group, else the legacy group.
               (s.source_report_key || '|' || coalesce(s.report_number, k.key_number, 'legacy')) as report_identity,
               -- R1: the latest DISTINCT answer wins: the answer group adopted
               -- most recently (same answer re-sent does not move it, because
               -- no_change/stale/grant-only reshare keep answer_accepted_at).
               max(s.answer_accepted_at) over (
                   partition by s.source_report_key, coalesce(s.report_number, k.key_number, 'legacy'), s.payload_sha256
               ) as answer_time
          from scoped s
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
    select count(*), coalesce(jsonb_agg(jsonb_build_object(
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
        -- whether the answer stated an amount at all (existence only, never the value) — keeps 'not stated' apart from 'not published'
        'amount_stated', amount_confirmed_won is not null,
        -- 위반법규 (observation-v2): exact text for the law filter and the per-law table; null = 법규 미상
        -- (v1 payload, not extracted, or the lineage's policy does not publish it)
        'violation_law', case when law_public then violation_law else null end,
        'rating', case when rating_public then rating else null end
    )), '[]'::jsonb) into v_count, v_rows from ranked
     where (p_category = 'all' or category = p_category)
       and (p_region_code is null or region_code = p_region_code)
       and (p_agency_key is null or agency_key = p_agency_key)
       and (p_manager_key is null or manager_key = p_manager_key)
       and (p_bbox is null or (lat is not null and lng between p_bbox[1] and p_bbox[3] and lat between p_bbox[2] and p_bbox[4]));
    if v_count > 100000 then raise exception 'RESULT_TOO_LARGE'; end if;
    return v_rows;
end;
$$;

revoke all on function public.internal_analytics_v2_facts(date, date, text, text, text, text, double precision[]) from public, anon, authenticated;
grant execute on function public.internal_analytics_v2_facts(date, date, text, text, text, text, double precision[]) to service_role;

create or replace function public.internal_analytics_v2_state()
returns jsonb language sql stable security definer set search_path = '' as $$
  with bounds as (
    select min(least(coalesce(f.report_date, f.completed_date), coalesce(f.completed_date, f.report_date))) as lo,
           max(greatest(coalesce(f.report_date, f.completed_date), coalesce(f.completed_date, f.report_date))) as hi
      from private.community_report_facts f
      join private.contributor_profiles c on c.user_id = f.contributor_id and c.status = 'active'
     where f.public_state = 'completed'
       and private.community_lineage_active(f.consent_grant_id)
  )
  select jsonb_build_object(
    'dataset_version', s.dataset_version, 'ready', s.ready,
    'source_updated_at', s.source_updated_at, 'generated_at', s.generated_at,
    'published_at', s.published_at,
    -- whole publicly listed history (report date AND answer date), never a filtered or last-screen range
    'data_min', coalesce(s.data_min, b.lo), 'data_max', coalesce(s.data_max, b.hi),
    'coverage_note', s.coverage_note, 'dedupe_policy_version', s.dedupe_policy_version
  ) from private.analytics_state s cross join bounds b where s.singleton = true;
$$;
revoke all on function public.internal_analytics_v2_state() from public, anon, authenticated;
grant execute on function public.internal_analytics_v2_state() to service_role;

commit;
