-- Personal comparison / 맞춤 통계 source as columns-v1 (the public statistics path already asks for it).
-- Same gate, state, population and 35 fields as internal_my_analytics_cohort_source, which stays for old Edge.
begin;
create function public.internal_my_analytics_cohort_columns(p_user uuid, p_session uuid, p_date_basis text, p_start date, p_end date,
 p_with_previous boolean, p_category text, p_region_code text, p_agency_key text, p_manager_key text, p_bbox double precision[])
returns json language plpgsql stable security definer set search_path='' as $$
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
        'facts', case when v_ok then private.analytics_cohort_payload(
            p_date_basis, p_start, p_end, p_with_previous, p_category, p_region_code, p_agency_key, p_manager_key, p_bbox, true)
            else '[]'::json end);
end;
$$;
revoke all on function public.internal_my_analytics_cohort_columns(uuid,uuid,text,date,date,boolean,text,text,text,text,double precision[]) from public,anon,authenticated;
grant execute on function public.internal_my_analytics_cohort_columns(uuid,uuid,text,date,date,boolean,text,text,text,text,double precision[]) to service_role;
notify pgrst,'reload schema';
commit;
