-- Map viewer threshold: 10 shared reports (user decision 2026-09-28).
-- Owner: safetyreport-community-map.
-- Depends on map 202609281800 (report_identity isolation 1500 + answer recency 1600 + rating 1800;
-- the public-listing predicate private.community_fact_publicly_listed itself is unchanged since 202609260200
-- and is reused here as-is so the viewer count and the public map list the same rows).
-- No destructive change: redefines public.internal_analytics_viewer only (same signature, same security
-- definer / search_path / service_role-only grants). Existing keys (user_ok, kakao, session, contributor,
-- has_public_facts) keep their exact meaning; has_public_facts still answers "at least one publicly-listed
-- fact" and internal_my_analytics_source (personal comparison) is NOT touched by this migration.
-- Adds public_fact_count: the viewer's DISTINCT publicly-listed report count that the Edge gate compares
-- against MAP_VIEWER_MIN_REPORTS = 10 (server/viewerAuth.ts compares, so the number stays a code constant).
--
-- 고유 신고 수 정의 (근거):
-- - 저장 단위는 PK (contributor_id, dataset_key, source_report_key) (202609260200)라서 같은 신고를 PC·모바일·
--   복원본 dataset 에 올리면 행이 여러 개 생긴다. 단순 행 수는 중복 집계가 되므로 쓰지 않는다.
-- - 공개 통계의 "고유 신고 1건"은 202609281500 H1의 report_identity =
--   source_report_key || '|' || coalesce(자기 행의 report_number, 키의 최초 번호, 'legacy') 이다
--   (번호가 둘 다 있고 다르면 별도 identity 로 격리, 번호 없는 구버전 관측은 키의 최초 번호 그룹에 합류,
--   번호가 하나도 없으면 'legacy' 그룹). 같은 identity 는 대표행만 집계(contribution-dedupe-v1)한다.
-- - public_fact_count 는 이 사용자의 공개 목록 행(private.community_fact_publicly_listed = true)들에 같은
--   report_identity 식을 적용한 distinct 개수다. 즉 "이 사용자가 공개 통계에 기여하는 고유 신고 수"와 같다.
-- - 키의 최초 번호(key_number)는 202609281600 R2와 같은 범위(동의 계보 활성 전체 이력, 날짜창 없음,
--   순서 (report_number is null), first_accepted_at, contributor_id)로 구하되, 이 사용자의 키로만 제한한다.
--   전역 정의를 그대로 쓰므로 공개 projection 의 identity 와 같은 값으로 합쳐진다.
-- - 타 계정의 같은 identity 업로드는 이 사용자의 행이 아니므로 세지 않는다(2026-09-28 계정별 기여 규칙).
-- - contributor 가 active 가 아니면 0이다(정지·철회·미동의 계정은 공개 목록이 비므로 has_public_facts=false 와 일치).
-- Rollback: re-run 202609280700's internal_analytics_viewer (drops the public_fact_count key; the Edge gate
-- then fail-closes to upload_required until the matching Edge function is redeployed).

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
    -- same states as internal_my_analytics_source: 'active' = active profile with an unrevoked share consent
    v_contributor := case
        when v_profile.user_id is null then 'none'
        when v_profile.status <> 'active' then 'suspended'
        when exists (select 1 from private.community_consent_grants g where g.user_id = p_user and g.revoked_at is null) then 'active'
        when exists (select 1 from private.community_consent_grants g where g.user_id = p_user) then 'revoked'
        else 'none' end;
    -- "shared at least one report": a fact of this user that the public map actually lists (completed, active
    -- contributor, active consent lineage) — the same rule as internal_my_analytics_source.has_public_facts.
    -- Kept verbatim (exists check) so the key's meaning cannot drift from the personal-comparison source.
    if v_contributor = 'active' then
        select exists (select 1 from private.community_report_facts f
                        where f.contributor_id = p_user and private.community_fact_publicly_listed(f)) into v_has;
        -- Viewer threshold count (2026-09-28): distinct report_identity over the same publicly-listed rows.
        -- Same identity expression as 202609281500 H1; the key's first number follows 202609281600 R2
        -- (consent-active full history, no date window) restricted to this viewer's keys, so identities
        -- join exactly as the public projection elects them. Rows of other accounts never count
        -- (per-account contribution rule, 2026-09-28); two datasets of this viewer collapse to one.
        with mine as (
            select f.source_report_key, f.report_number
              from private.community_report_facts f
             where f.contributor_id = p_user
               and private.community_fact_publicly_listed(f)
        ),
        key_numbers as (
            select distinct on (f.source_report_key) f.source_report_key,
                   f.report_number as key_number
              from private.community_report_facts f
              join private.contributor_profiles c on c.user_id = f.contributor_id and c.status = 'active'
             where f.public_state = 'completed'
               and private.community_lineage_active(f.consent_grant_id)
               and f.source_report_key in (select m.source_report_key from mine m)
             order by f.source_report_key, (f.report_number is null), f.first_accepted_at, f.contributor_id
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
