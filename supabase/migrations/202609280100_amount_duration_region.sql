-- Incremental: fine amounts and official region codes for analytics (docs/metrics-catalog.md fine_amount,
-- processing_duration, region_boundaries). Owner: safetyreport-community-map. Applied migrations are never edited.
-- Depends on map 202609260200 and auth 202609260100. No destructive change: adds a table, a column-free projection
-- change and grants only. Rollback: drop the new function body back to 202609260200's (re-run its definition).

begin;

-- 1) Which consent policy versions publish ANSWERED FINE AMOUNTS (aggregates on the public map).
--    The 2026-09-26.1 consent says amounts are SENT but does not list them as PUBLISHED, so it is not registered here.
--    A later policy whose text lists amount statistics as public is registered in the same migration that adds it.
--    Never infer this from "a newer version exists" — only an explicit row publishes amounts.
create table if not exists private.community_policy_disclosures (
    version text primary key references private.community_policies(version),
    amounts_public boolean not null default false,
    created_at timestamptz not null default now()
);
alter table private.community_policy_disclosures enable row level security;
revoke all on private.community_policy_disclosures from public, anon, authenticated;
grant select on private.community_policy_disclosures to service_role;

-- 2) Public fact projection: same population and filters as before, plus the amount fields and a per-fact
--    `amount_public` flag (the fact's consent grant policy publishes amounts). Amount values of facts without
--    that flag never leave the database (they are returned as null; only the kind is kept for counting).
create or replace function public.internal_analytics_v2_facts(
    p_start date, p_end date, p_category text, p_region_code text,
    p_agency_key text, p_manager_key text, p_bbox double precision[]
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
    v_previous_start date;
    v_rows jsonb;
    v_count integer;
begin
    if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 1826 or
       p_category is null or p_category not in ('all','traffic','parking','other') or
       (p_bbox is not null and (array_length(p_bbox,1) <> 4 or p_bbox[1] > p_bbox[3] or p_bbox[2] > p_bbox[4])) then
        raise exception 'INVALID_QUERY';
    end if;
    perform set_config('statement_timeout', '8000', true);
    v_previous_start := p_start - (p_end - p_start + 1);
    with bounded as (
        select f.*,
               coalesce((select d.amounts_public from private.community_consent_grants g
                           join private.community_policy_disclosures d on d.version = g.policy_version
                          where g.grant_id = f.consent_grant_id), false) as amount_public
          from private.community_report_facts f
          join private.contributor_profiles c on c.user_id = f.contributor_id and c.status = 'active'
         where f.public_state = 'completed'
           and private.community_lineage_active(f.consent_grant_id)
           and (f.report_date between v_previous_start and p_end or f.completed_date between v_previous_start and p_end)
           and (p_category = 'all' or f.category = p_category)
           and (p_region_code is null or f.region_code = p_region_code)
           and (p_agency_key is null or f.agency_key = p_agency_key)
           and (p_manager_key is null or f.manager_key = p_manager_key)
           and (p_bbox is null or (f.lat is not null and f.lng between p_bbox[1] and p_bbox[3] and f.lat between p_bbox[2] and p_bbox[4]))
         limit 100001
    )
    select count(*), coalesce(jsonb_agg(jsonb_build_object(
        'fact_identity', dataset_key || ':' || source_report_key, 'contributor_id', contributor_id,
        'snapshot_id', 'ingest-v1', 'snapshot_generation', 1,
        'report_date', report_date, 'completed_date', completed_date,
        'category', category, 'status', status, 'disposition', disposition,
        'vehicle_raw', vehicle_raw, 'point_key', point_key, 'lat', lat, 'lng', lng,
        'address', address, 'region_code', region_code,
        'agency_key', agency_key, 'agency_name', agency_name,
        'manager_key', manager_key, 'manager_name', manager_name,
        'amount_kind', amount_kind,
        'amount_confirmed_won', case when amount_public then amount_confirmed_won else null end,
        'amount_public', amount_public,
        -- whether the answer stated an amount at all (existence only, never the value) — keeps 'not stated' apart from 'not published'
        'amount_stated', amount_confirmed_won is not null
    )), '[]'::jsonb) into v_count, v_rows from bounded;
    if v_count > 100000 then raise exception 'AGGREGATE_NOT_READY'; end if;
    return v_rows;
end;
$$;

revoke all on function public.internal_analytics_v2_facts(date, date, text, text, text, text, double precision[]) from public, anon, authenticated;
grant execute on function public.internal_analytics_v2_facts(date, date, text, text, text, text, double precision[]) to service_role;

commit;
