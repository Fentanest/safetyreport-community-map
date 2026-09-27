-- Incremental: who may view the community map while it is contributor-only (user decision 2026-09-27: until enough
-- people join, only people who share their reports see the map). Owner: safetyreport-community-map.
-- Depends on auth 202609260100 (identity state, profiles, grants). No destructive change: one new read-only function.
-- The Edge function calls it with the VERIFIED user and session only (server/viewerAuth.ts); nothing client-supplied.
-- Rollback: drop the function (the API's ANALYTICS_ACCESS=public mode does not call it).

begin;

create or replace function public.internal_analytics_viewer(p_user uuid, p_session uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
    v_id jsonb;
    v_profile private.contributor_profiles%rowtype;
    v_contributor text;
begin
    if p_user is null or p_session is null then raise exception 'INVALID_QUERY'; end if;
    v_id := private.community_identity_state(p_user, p_session);
    select * into v_profile from private.contributor_profiles where user_id = p_user;
    -- same states as internal_my_analytics_source: 'active' = active profile with an unrevoked share consent
    v_contributor := case
        when v_profile.user_id is null then 'none'
        when v_profile.status <> 'active' then 'suspended'
        when exists (select 1 from private.community_consent_grants g where g.user_id = p_user and g.revoked_at is null) then 'active'
        when exists (select 1 from private.community_consent_grants g where g.user_id = p_user) then 'revoked'
        else 'none' end;
    return jsonb_build_object(
        'user_ok', (v_id->>'user_ok')::boolean, 'kakao', (v_id->>'kakao')::boolean,
        'session', (v_id->>'session')::boolean, 'contributor', v_contributor);
end;
$$;

revoke all on function public.internal_analytics_viewer(uuid, uuid) from public, anon, authenticated;
grant execute on function public.internal_analytics_viewer(uuid, uuid) to service_role;

commit;
