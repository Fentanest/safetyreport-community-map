-- Exact viewer gate, same global number fallback and permissions; no cached eligibility or new index.
-- Measured cause: old hash semi join ran lineage checks over all 600k observations for a 10-key viewer.
-- Rollback: restore 202609281900 function in a forward migration (keep the 10-report count).
begin;
create or replace function public.internal_analytics_viewer(p_user uuid, p_session uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
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
    -- Kept verbatim (exists check) so the key’s meaning cannot drift from the personal-comparison source.
    if v_contributor = 'active' then
        select exists (select 1 from private.community_report_facts f
                        where f.contributor_id = p_user and private.community_fact_publicly_listed(f)) into v_has;
        -- Viewer threshold count (2026-09-28): distinct report_identity over the same publicly-listed rows.
        -- Same identity expression as 202609281500 H1; the key’s first number follows 202609281600 R2
        -- (consent-active full history, no date window) restricted to this viewer’s keys, so identities
        -- join exactly as the public projection elects them. Rows of other accounts never count
        -- (per-account contribution rule, 2026-09-28); two datasets of this viewer collapse to one.
        with mine as (
            select f.source_report_key, f.report_number
              from private.community_report_facts f
             where f.contributor_id = p_user
               and private.community_fact_publicly_listed(f)
        ),
        key_numbers as (
            -- Only NULL-number observations need the global historical number fallback. LIMIT keeps
            -- each lookup keyed by source_report_key before evaluating the unchanged consent predicate.
            select keys.source_report_key, k.key_number
              from (select distinct source_report_key from mine where report_number is null) keys
              left join lateral (
                select f.report_number as key_number
                  from private.community_report_facts f
                  join private.contributor_profiles c on c.user_id=f.contributor_id and c.status='active'
                 where f.source_report_key=keys.source_report_key and f.report_number is not null
                   and f.public_state='completed' and private.community_lineage_active(f.consent_grant_id)
                 order by f.first_accepted_at,f.contributor_id limit 1
              ) k on true
        )
        select count(distinct (m.source_report_key || '|' || coalesce(m.report_number, k.key_number, 'legacy')))
          into v_count
          from mine m left join key_numbers k using (source_report_key);
    end if;
    return jsonb_build_object(
        'user_ok', (v_id->>'user_ok')::boolean, 'kakao', (v_id->>'kakao')::boolean,
        'session', (v_id->>'session')::boolean, 'contributor', v_contributor, 'has_public_facts', v_has,
        'public_fact_count', v_count);
end;
$$;

revoke all on function public.internal_analytics_viewer(uuid, uuid) from public, anon, authenticated;
grant execute on function public.internal_analytics_viewer(uuid, uuid) to service_role;

commit;
