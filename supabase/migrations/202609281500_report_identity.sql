-- Report identity isolation + elect-then-filter representative + agency code preservation
-- (REVIEW2 높음-1·높음-2·높음-4, 높음-3 기관 연결 저장, 2026-09-28).
--
-- H1: 같은 source_report_id 에 서로 다른 실제 신고번호가 오면 하나의 공개 신고로
-- 합치지 않는다. 신고번호가 둘 다 있을 때 다르면 별도 identity 로 격리하고,
-- 번호가 없는 구버전 관측(null)은 같은 키의 최초 번호 그룹에 붙는다(와일드카드).
-- 번호가 하나도 없는 키는 'legacy' 그룹 하나로 묶는다(기존 동작 유지).
-- report_identity = source_report_key || '|' || coalesce(자기 번호, 키의 최초 번호, 'legacy').
--
-- H2: 공개 대표는 범위 필터와 무관하게 identity 단위로 먼저 확정한다.
-- 대표는 '최신 실제 처리 결과' = 가장 나중에 처음 관측된 서로 다른 답변
-- (payload_sha256 그룹의 최초 관측 시각이 가장 늦은 그룹; 같은 답변의 단순
-- 재전송(no_change)은 대표를 뒤집지 않는다). 동률은 first_accepted_at,
-- contributor_id 순. 그 다음 category/region/agency/manager/bbox 필터를
-- 대표 행에만 적용한다. contribution_count 는 필터 전 identity 전체 기여 수.
--
-- H4: 구버전(v1/v2) payload 에는 source_agency_code 키 자체가 없다. 키가 없을
-- 때는 저장된 코드를 NULL 로 지우지 않고 보존한다. 키가 있으면서 null 이면
-- (v3 앱의 명시적 NULL: 코드 없는 답변) null 로 쓴다. 키 존재 검사는
-- 원문 payload(`e->'payload' ? 'source_agency_code'`)로 한다 — 파서 버전이
-- 아니라 계약(observation.md §3: v1 12키·v2 13키·v3 14키)이 근거다.
--
-- H3(기관 연결 저장): edge deriveFact 가 계산한 agency_current_name(확인된 1:1
-- 승계의 현행명, 미확정이면 원문과 동일)을 저장·공개한다. agency_name 원문은
-- 그대로 둔다. agency_key 는 확인된 승계면 inst:<institution_id>, 아니면 기존
-- a1:<name-hash> (manager_key 는 agency_key 기준이므로 승계 rows 의 manager
-- 키도 함께 바뀐다 — 같은 기관의 같은 담당자는 한 키로 묶인다).
-- 현행명은 이미 공개 중인 agency_name 원문 + 공개 registry 의 결정적 변환이라
-- 동의 범위를 넓히지 않는다(파생값 근거: MUSE2 규칙 4).
-- No backfill: legacy facts keep agency_current_name null until re-observed;
-- the API falls back to agency_name then.
-- Rollback: re-run 202609281400's functions, then
-- `alter table private.community_report_facts drop column agency_current_name`.
begin;
alter table private.community_report_facts
    add column agency_current_name text check (agency_current_name is null or char_length(agency_current_name) between 1 and 200);
create or replace function public.internal_community_ingest(
    p_user uuid, p_session uuid, p_request_id text, p_envelope jsonb, p_events jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
    v_policy private.community_policies%rowtype;
    v_profile private.contributor_profiles%rowtype;
    v_grant private.community_consent_grants%rowtype;
    v_conn private.community_connections%rowtype;
    v_fact private.community_report_facts%rowtype;
    v_lock_key text;
    v_id jsonb;
    v_ready boolean;
    v_generated timestamptz;
    v_changed boolean := false;
    v_results jsonb := '[]'::jsonb;
    v_result text;
    v_receipt uuid;
    v_existing record;
    v_max_rev bigint := 0;
    v_version text;
    e jsonb;
    d jsonb;
    v_event_id uuid;
    v_epoch bigint;
    v_rev bigint;
    v_key text;
    v_keep_grant boolean;
    v_target_grant uuid;
    v_visible boolean;
    v_was_visible boolean;
    v_fence timestamptz;
    v_projection text;
begin
    if jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) not between 1 and 20 then
        return jsonb_build_object('error', 'invalid_request');
    end if;
    -- One event per report per request (S-11-B): per-event ACKs then equal the committed state.
    if (select count(distinct x->>'source_report_key') from jsonb_array_elements(p_events) x) <> jsonb_array_length(p_events) then
        return jsonb_build_object('error', 'invalid_request');
    end if;
    v_policy := private.community_current_policy(true);
    select * into v_profile from private.contributor_profiles where user_id = p_user for share;
    if v_profile.user_id is null then return jsonb_build_object('error', 'consent_missing'); end if;
    if v_profile.status <> 'active' then return jsonb_build_object('error', 'contributor_suspended'); end if;
    v_id := private.community_identity_state(p_user, p_session);
    if not (v_id->>'user_ok')::boolean or not (v_id->>'kakao')::boolean then
        return jsonb_build_object('error', 'kakao_required');
    end if;
    if not (v_id->>'session')::boolean then return jsonb_build_object('error', 'session_revoked'); end if;
    select * into v_grant from private.community_consent_grants
     where grant_id = (p_envelope->>'consent_grant_id')::uuid and user_id = p_user for share;
    if v_grant.grant_id is null then return jsonb_build_object('error', 'consent_grant_unknown'); end if;
    if v_grant.revoked_at is not null then return jsonb_build_object('error', 'consent_revoked'); end if;
    if not private.community_grant_is_current(v_grant, v_policy) then return jsonb_build_object('error', 'consent_outdated'); end if;
    -- FOR UPDATE (not SHARE): this transaction later raises last_accepted_revision, and a shared lock held by a
    -- parallel ingest of the same connection would deadlock with it (S-09-R). Same-connection ingests serialize.
    select * into v_conn from private.community_connections
     where connection_id = (p_envelope->>'connection_id')::uuid and user_id = p_user for update;
    if v_conn.connection_id is null then return jsonb_build_object('error', 'connection_unknown'); end if;
    if v_conn.status = 'superseded' then return jsonb_build_object('error', 'writer_superseded'); end if;
    if v_conn.status <> 'active' then return jsonb_build_object('error', 'connection_' || v_conn.status); end if;
    if v_conn.bound_session_id <> p_session then return jsonb_build_object('error', 'connection_session_mismatch'); end if;
    if v_conn.source_app <> p_envelope->>'source_app' or v_conn.source_mode <> p_envelope->>'source_mode' then
        return jsonb_build_object('error', 'connection_mode_mismatch');
    end if;
    select fenced_at into v_fence from private.community_deletion_fences where contributor_id = p_user;
    select ready, generated_at into v_ready, v_generated from private.analytics_state where singleton;

    -- A batch can contain many reports. Acquire every report lock in a stable order before any fact row lock.
    for v_lock_key in select distinct x->>'source_report_key' from jsonb_array_elements(p_events) x
                      order by 1 loop
        perform pg_advisory_xact_lock(hashtextextended(v_lock_key, 913784));
    end loop;

    for e in select * from jsonb_array_elements(p_events) loop
        v_event_id := (e->>'event_id')::uuid;
        v_epoch := (e->>'writer_epoch')::bigint;
        v_rev := (e->>'source_revision')::bigint;
        v_key := e->>'source_report_key';
        d := e->'derived';
        if v_epoch <> v_conn.writer_epoch then
            v_results := v_results || jsonb_build_object('event_id', v_event_id, 'status', 'rejected', 'durable', false,
                'receipt_id', null, 'projection_status', 'not_applicable',
                'error', jsonb_build_object('code', 'writer_epoch_mismatch', 'retryable', false));
            continue;
        end if;
        if exists (select 1 from private.community_fact_tombstones t
                    where t.contributor_id = p_user and t.source_report_key = v_key)
           or (v_fence is not null and (e->>'captured_at')::timestamptz <= v_fence) then
            v_results := v_results || jsonb_build_object('event_id', v_event_id, 'status', 'rejected', 'durable', false,
                'receipt_id', null, 'projection_status', 'not_applicable',
                'error', jsonb_build_object('code', 'deleted', 'retryable', false));
            continue;
        end if;
        insert into private.community_ingest_events(contributor_id, event_id, request_id, connection_id, consent_grant_id,
            dataset_key, writer_epoch, source_system, source_report_key, source_report_id, source_revision, event_type,
            trigger, payload, payload_sha256, captured_at, quarantine_reason, report_number)
        values (p_user, v_event_id, p_request_id, v_conn.connection_id, v_grant.grant_id, v_conn.dataset_key, v_epoch,
            'safetyreport', v_key, e->>'source_report_id', v_rev, e->>'event_type', p_envelope->>'trigger',
            e->'payload', e->>'payload_sha256', (e->>'captured_at')::timestamptz, e->>'quarantine_reason', e->>'report_number')
        on conflict (contributor_id, event_id) do nothing
        returning receipt_id into v_receipt;
        if v_receipt is null then
            -- Immutable event fields (contract): event_type, source_report_id/key, source_revision, writer_epoch,
            -- captured_at, payload_sha256 and the connection's dataset. Grant/connection/trigger/request are transport
            -- context and may legitimately differ on a retry after rebind or policy re-consent.
            select receipt_id, payload_sha256, result, rejection_reason, dataset_key, source_report_key, source_report_id, source_revision,
                   writer_epoch, event_type, captured_at, report_number
              into v_existing from private.community_ingest_events where contributor_id = p_user and event_id = v_event_id;
            if v_existing.payload_sha256 = e->>'payload_sha256' and v_existing.dataset_key = v_conn.dataset_key
               and v_existing.source_report_key = v_key and v_existing.source_report_id = e->>'source_report_id'
               and v_existing.source_revision = v_rev and v_existing.writer_epoch = v_epoch
               and v_existing.event_type = e->>'event_type' and v_existing.captured_at = (e->>'captured_at')::timestamptz
               and v_existing.report_number is not distinct from e->>'report_number' then
                if v_existing.result = 'rejected' then
                    v_results := v_results || jsonb_build_object('event_id', v_event_id, 'status', 'rejected', 'durable', false,
                        'receipt_id', null, 'projection_status', 'not_applicable',
                        'error', jsonb_build_object('code', v_existing.rejection_reason, 'retryable', false));
                else
                    v_results := v_results || jsonb_build_object('event_id', v_event_id, 'status', 'duplicate', 'durable', true,
                        'receipt_id', v_existing.receipt_id, 'original_status', v_existing.result, 'projection_status', 'not_applicable');
                end if;
            else
                v_results := v_results || jsonb_build_object('event_id', v_event_id, 'status', 'conflict', 'durable', false,
                    'receipt_id', null, 'projection_status', 'not_applicable',
                    'error', jsonb_build_object('code', 'event_id_conflict', 'retryable', false));
            end if;
            continue;
        end if;
        -- 2026-09-28: only final-answer observations are stored. A non-eligible payload or a legacy
        -- status_correction event is rejected per event (durable=false) so the rest of the batch still
        -- processes. The central fact keeps its last answered state.
        if (e->'payload'->>'status') not in ('accepted','partial','rejected','completed_unknown')
           or e->>'event_type' = 'status_correction' then
            update private.community_ingest_events set result = 'rejected', rejection_reason = 'non_final_not_accepted'
             where receipt_id = v_receipt;
            v_results := v_results || jsonb_build_object('event_id', v_event_id, 'status', 'rejected',
                'durable', false, 'receipt_id', null, 'projection_status', 'not_applicable',
                'error', jsonb_build_object('code', 'non_final_not_accepted', 'retryable', false));
            continue;
        end if;
        if e->>'quarantine_reason' is not null then
            update private.community_ingest_events set result = 'quarantined' where receipt_id = v_receipt;
            v_results := v_results || jsonb_build_object('event_id', v_event_id, 'status', 'quarantined', 'durable', true,
                'receipt_id', v_receipt, 'projection_status', 'not_applicable');
            continue;
        end if;
        -- Sol 2026-09-28: last_accepted_revision advances only for events that reach fact processing.
        -- Rejected (non-final etc.) or quarantined events must not inflate the app's next-revision lower bound.
        v_max_rev := greatest(v_max_rev, v_rev);
        select * into v_fact from private.community_report_facts
         where contributor_id = p_user and dataset_key = v_conn.dataset_key and source_report_key = v_key for update;
        v_was_visible := v_fact.contributor_id is not null and private.community_fact_publicly_listed(v_fact);
        -- 2026-09-28 account rule: another account's fact for the same identity is left alone; this
        -- event creates (or updates) only the uploader's own contribution row. The public projection
        -- elects one representative per identity (see internal_analytics_v2_facts below).
        if v_fact.contributor_id is null then
            insert into private.community_report_facts(contributor_id, dataset_key, source_report_key, source_report_id,
                latest_receipt_id, consent_grant_id, writer_epoch, source_revision, payload_sha256, report_number, public_state,
                report_date, completed_date, category, status, disposition, amount_kind, amount_confirmed_won, penalty_points,
                vehicle_raw, lat, lng, lat_text, lng_text, coord_source, address, region_code, point_key, agency_key,
                agency_name, agency_current_name, manager_key, manager_name, violation_law, source_agency_code)
            values (p_user, v_conn.dataset_key, v_key, e->>'source_report_id', v_receipt, v_grant.grant_id, v_epoch, v_rev,
                e->>'payload_sha256', e->>'report_number', d->>'public_state', (d->>'report_date')::date, (d->>'completed_date')::date,
                d->>'category', d->>'status', d->>'disposition', d->>'amount_kind', (d->>'amount_confirmed_won')::bigint,
                (d->>'penalty_points')::integer, d->>'vehicle_raw', (d->>'lat')::double precision,
                (d->>'lng')::double precision, d->>'lat_text', d->>'lng_text', d->>'coord_source', d->>'address',
                d->>'region_code', d->>'point_key', d->>'agency_key', d->>'agency_name', d->>'agency_current_name',
                d->>'manager_key', d->>'manager_name',
                d->>'violation_law', d->>'source_agency_code');
            v_result := 'accepted';
        elsif (v_epoch, v_rev) > (v_fact.writer_epoch, v_fact.source_revision) then
            -- A fact accepted under a lineage the USER revoked stays under that (hidden) grant unless this event is an
            -- explicit reshare; policy-version supersession keeps the lineage active, so it re-attributes normally.
            v_keep_grant := v_fact.consent_grant_id <> v_grant.grant_id and e->>'event_type' <> 'reshare'
                            and not private.community_lineage_active(v_fact.consent_grant_id);
            v_target_grant := case when v_keep_grant then v_fact.consent_grant_id else v_grant.grant_id end;
            if v_fact.payload_sha256 = e->>'payload_sha256' and v_fact.consent_grant_id = v_target_grant then
                update private.community_report_facts set writer_epoch = v_epoch, source_revision = v_rev,
                    latest_receipt_id = v_receipt, report_number = coalesce(e->>'report_number', v_fact.report_number), updated_at = now()
                 where contributor_id = p_user and dataset_key = v_conn.dataset_key and source_report_key = v_key;
                v_result := 'no_change';
            else
                update private.community_report_facts set latest_receipt_id = v_receipt, consent_grant_id = v_target_grant,
                    writer_epoch = v_epoch, source_revision = v_rev, payload_sha256 = e->>'payload_sha256',
                    report_number = coalesce(e->>'report_number', v_fact.report_number),
                    public_state = d->>'public_state', report_date = (d->>'report_date')::date,
                    completed_date = (d->>'completed_date')::date, category = d->>'category', status = d->>'status',
                    disposition = d->>'disposition', amount_kind = d->>'amount_kind',
                    amount_confirmed_won = (d->>'amount_confirmed_won')::bigint, penalty_points = (d->>'penalty_points')::integer,
                    vehicle_raw = d->>'vehicle_raw', lat = (d->>'lat')::double precision, lng = (d->>'lng')::double precision,
                    lat_text = d->>'lat_text', lng_text = d->>'lng_text', coord_source = d->>'coord_source',
                    address = d->>'address', region_code = d->>'region_code', point_key = d->>'point_key',
                    agency_key = d->>'agency_key', agency_name = d->>'agency_name',
                    agency_current_name = d->>'agency_current_name',
                    manager_key = d->>'manager_key',
                    manager_name = d->>'manager_name', violation_law = d->>'violation_law',
                    -- REVIEW2 높음-4: v1/v2 payload 에는 source_agency_code 키가 없다.
                    -- 키가 없을 때는 저장된 코드를 보존하고, 키가 있을 때만(명시적 NULL 포함) 쓴다.
                    source_agency_code = case when (e->'payload') ? 'source_agency_code'
                                              then d->>'source_agency_code' else v_fact.source_agency_code end,
                    updated_at = now()
                 where contributor_id = p_user and dataset_key = v_conn.dataset_key and source_report_key = v_key;
                v_result := 'accepted';
            end if;
        else
            v_result := 'stale_ignored';
        end if;
        update private.community_ingest_events set result = v_result where receipt_id = v_receipt;
        if v_result = 'accepted' then v_changed := true; end if;
        select private.community_fact_publicly_listed(f) into v_visible from private.community_report_facts f
         where f.contributor_id = p_user and f.dataset_key = v_conn.dataset_key and f.source_report_key = v_key;
        -- published: after commit the anonymous API lists the fact; removed: it was listed and no longer is;
        -- held: listable but projection not live (ready=false / generated_at null) or its consent lineage is revoked;
        -- not_public: stored but never listed (not completed, or no report/completion date).
        v_projection := case
            when v_result <> 'accepted' then 'not_applicable'
            when coalesce(v_visible, false) and coalesce(v_ready, false) and v_generated is not null then 'published'
            when coalesce(v_was_visible, false) and not coalesce(v_visible, false) and coalesce(v_ready, false) then 'removed'
            when coalesce(v_visible, false) then 'held'
            when (select f.public_state = 'completed' and (f.report_date is not null or f.completed_date is not null)
                    from private.community_report_facts f
                   where f.contributor_id = p_user and f.dataset_key = v_conn.dataset_key and f.source_report_key = v_key)
                 then 'held'
            else 'not_public' end;
        v_results := v_results || jsonb_build_object('event_id', v_event_id, 'status', v_result, 'durable', true,
            'receipt_id', v_receipt, 'projection_status', v_projection);
    end loop;

    if v_max_rev > v_conn.last_accepted_revision then
        update private.community_connections set last_accepted_revision = v_max_rev where connection_id = v_conn.connection_id;
    end if;
    select dataset_version into v_version from private.analytics_state where singleton;
    return jsonb_build_object('results', v_results, 'dataset_version', v_version);
end;
$$;

revoke all on function public.internal_community_ingest(uuid, uuid, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.internal_community_ingest(uuid, uuid, text, jsonb, jsonb) to service_role;


-- 2) Public fact projection: report_identity isolation (H1) + elect-then-filter representative (H2).
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
    with listed as (
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
               -- H1: the number the key was first seen with (legacy nulls join it; see identified below)
               first_value(f.report_number) over (
                   partition by f.source_report_key
                   order by (f.report_number is null), f.first_accepted_at, f.contributor_id) as key_number
          from private.community_report_facts f
          join private.contributor_profiles c on c.user_id = f.contributor_id and c.status = 'active'
         where f.public_state = 'completed'
           and private.community_lineage_active(f.consent_grant_id)
           and (f.report_date between v_previous_start and p_end or f.completed_date between v_previous_start and p_end)
         limit 100001
    ),
    identified as (
        select l.*,
               -- H1: both numbers present and different -> separate identities;
               -- a missing number joins the key's first numbered group, else the legacy group.
               (l.source_report_key || '|' || coalesce(l.report_number, l.key_number, 'legacy')) as report_identity,
               -- H2: the latest DISTINCT answer wins (same answer re-sent does not flip the representative)
               min(l.first_accepted_at) over (
                   partition by l.source_report_key, coalesce(l.report_number, l.key_number, 'legacy'), l.payload_sha256
               ) as answer_first_seen
          from listed l
    ),
    ranked as (
        select i.*,
               -- H2: the representative is elected per identity BEFORE scope filters (see final select).
               row_number() over (partition by i.report_identity
                                  order by i.answer_first_seen desc, i.first_accepted_at, i.contributor_id) = 1
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
        'violation_law', case when law_public then violation_law else null end
    )), '[]'::jsonb) into v_count, v_rows from ranked
     where (p_category = 'all' or category = p_category)
       and (p_region_code is null or region_code = p_region_code)
       and (p_agency_key is null or agency_key = p_agency_key)
       and (p_manager_key is null or manager_key = p_manager_key)
       and (p_bbox is null or (lat is not null and lng between p_bbox[1] and p_bbox[3] and lat between p_bbox[2] and p_bbox[4]));
    if v_count > 100000 then raise exception 'AGGREGATE_NOT_READY'; end if;
    return v_rows;
end;
$$;

revoke all on function public.internal_analytics_v2_facts(date, date, text, text, text, text, double precision[]) from public, anon, authenticated;
grant execute on function public.internal_analytics_v2_facts(date, date, text, text, text, text, double precision[]) to service_role;

-- 3) Backfill the one verified 1:1 link (registry seed 2026-09-28.1:
-- 1812314 광주광역시경찰청 → 1815198 광주경찰청, institution ag-gwangju-police-hq)
-- so pre-migration facts join the same institution key without waiting for
-- re-observation. manager_key follows the same rule as deriveFact
-- (m1:sha256(agency_key|NFC(manager_name))[:24]); manager names from the
-- official answers are NFC in practice. first_accepted_at is untouched, so
-- representative election (answer_first_seen) does not move.
update private.community_report_facts
   set agency_key = 'inst:ag-gwangju-police-hq',
       agency_current_name = '광주경찰청',
       manager_key = case when manager_name is null then manager_key
                          else 'm1:' || substring(encode(extensions.digest('inst:ag-gwangju-police-hq' || '|' || manager_name, 'sha256'), 'hex'), 1, 24) end,
       updated_at = now()
 where source_agency_code in ('1812314', '1815198');

commit;
