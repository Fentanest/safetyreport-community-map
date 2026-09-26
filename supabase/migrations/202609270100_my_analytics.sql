-- Personal comparison source (read-only). Owner: safetyreport-community-map. LOCAL PROPOSAL — not applied to
-- production; operational apply needs separate approval (docs/personal-comparison.md).
-- service_role only; called by the `my-analytics` Edge Function after server/personalHandler.ts verified the user
-- JWT (getUser + claims). The viewer id is the verified auth user; nothing here trusts a client-supplied id.
-- Depends on map 202609260200 (community facts, public listing) and auth 202609260100 (identity state, profiles,
-- consent grants). Writes nothing, changes no ingest/consent/writer/upload policy.

begin;

-- One STABLE function = one snapshot of the calling query: analytics state (dataset_version), the viewer identity
-- and the fact rows cannot come from different database states, so all/mine share one published version.
create or replace function public.internal_my_analytics_source(
    p_user uuid, p_session uuid, p_start date, p_end date, p_category text, p_region_code text,
    p_agency_key text, p_manager_key text, p_bbox double precision[])
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
        'state', public.internal_analytics_v2_state(),
        'viewer', jsonb_build_object(
            'user_ok', (v_id->>'user_ok')::boolean, 'kakao', (v_id->>'kakao')::boolean,
            'session', (v_id->>'session')::boolean, 'contributor', v_contributor, 'has_public_facts', v_has),
        -- The same public fact source as the anonymous API (same population); a failed identity gets no rows.
        'facts', case when v_ok then public.internal_analytics_v2_facts(
            p_start, p_end, p_category, p_region_code, p_agency_key, p_manager_key, p_bbox) else '[]'::jsonb end);
end;
$$;

revoke all on function public.internal_my_analytics_source(uuid, uuid, date, date, text, text, text, text, double precision[])
    from public, anon, authenticated;
grant execute on function public.internal_my_analytics_source(uuid, uuid, date, date, text, text, text, text, double precision[])
    to service_role;

commit;
