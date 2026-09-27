-- Incremental: register share-consent policy 2026-09-28.1 as publishing answered fine-amount statistics, and let the
-- lineage's current grant decide amount publication (docs/data-contract.md, docs/metrics-catalog.md fine_amount).
-- Owner: safetyreport-community-map. Depends on map 202609280100 and auth 202609280200 (the policy row).
-- No destructive change: one insert and a function body replacement with the same signature and grants.
-- Rollback: delete the disclosure row (amounts are then withheld again) and re-run 202609280100's function.

begin;

-- The 2026-09-28.1 text lists amount statistics under "무엇이 공개되나요" (user approval 2026-09-27).
insert into private.community_policy_disclosures(version, amounts_public) values ('2026-09-28.1', true);

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
               -- the lineage's CURRENT grant decides: consenting to a disclosing version covers facts sent under
               -- the earlier version of the same lineage (the 2026-09-28.1 text says so); an older consent alone never does
               exists(select 1 from private.community_consent_grants g0
                        join private.community_consent_grants g on g.lineage_id = g0.lineage_id and g.revoked_at is null
                        join private.community_policy_disclosures d on d.version = g.policy_version and d.amounts_public
                       where g0.grant_id = f.consent_grant_id) as amount_public
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
