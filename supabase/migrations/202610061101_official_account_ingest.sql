-- Official account binding v1. Depends on AUTH 202610061100 and map 202609281800.
begin;
create table private.community_report_ownership_audit (
    audit_id uuid primary key default gen_random_uuid(),
    occurred_at timestamptz not null default clock_timestamp(),
    receipt_id uuid not null unique,
    request_id text not null,
    user_id uuid not null,
    dataset_key text not null,
    source_report_key text not null,
    report_number text,
    reason text not null default 'report_owned_elsewhere' check (reason='report_owned_elsewhere')
);
alter table private.community_report_ownership_audit enable row level security;
revoke all on private.community_report_ownership_audit from public, anon, authenticated, service_role;
grant select on private.community_report_ownership_audit to service_role;
create index community_report_facts_report_number_binding on private.community_report_facts(report_number)
where report_number is not null;
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
    if not exists (select 1 from private.community_official_account_bindings
                   where user_id=p_user and dataset_key=v_conn.dataset_key) then
        return jsonb_build_object('error', 'official_account_mismatch');
    end if;
    select max(fenced_at) into v_fence from (
        select fenced_at from private.community_deletion_fences where contributor_id=p_user
        union all
        select fenced_at from private.community_dataset_deletion_fences
         where contributor_id=p_user and dataset_key=v_conn.dataset_key
    ) fences;
    select ready, generated_at into v_ready, v_generated from private.analytics_state where singleton;

    -- A batch can contain many reports. Acquire every report lock in a stable order before any fact row lock.
    for v_lock_key in select lock_key from (
        select 'key:' || (x->>'source_report_key') as lock_key from jsonb_array_elements(p_events) x
        union
        select 'number:' || (x->>'report_number') from jsonb_array_elements(p_events) x
         where nullif(x->>'report_number','') is not null
    ) locks order by lock_key loop
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
           or exists (select 1 from private.community_dataset_fact_tombstones t
                       where t.contributor_id=p_user and t.dataset_key=v_conn.dataset_key and t.source_report_key=v_key)
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
            -- captured_at, payload_sha256 and the dataset of the connection. Grant/connection/trigger/request are transport
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
        -- Global identity locks above cover BOTH identity forms, including different link IDs
        -- sharing a report number. Hidden/revoked facts still reserve their report identity.
        if exists (select 1 from private.community_report_facts f
                    where f.dataset_key <> v_conn.dataset_key
                      and (f.source_report_key=v_key or
                           (e->>'report_number' is not null and f.report_number=e->>'report_number'))) then
            update private.community_ingest_events set result='rejected', rejection_reason='report_owned_elsewhere'
             where receipt_id=v_receipt;
            insert into private.community_report_ownership_audit(receipt_id,request_id,user_id,dataset_key,source_report_key,report_number)
            values (v_receipt,p_request_id,p_user,v_conn.dataset_key,v_key,e->>'report_number');
            v_results := v_results || jsonb_build_object('event_id',v_event_id,'status','rejected',
                'durable',false,'receipt_id',null,'projection_status','not_applicable',
                'error',jsonb_build_object('code','report_owned_elsewhere','retryable',false));
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
        -- Rejected (non-final etc.) or quarantined events must not inflate the next-revision lower bound.
        v_max_rev := greatest(v_max_rev, v_rev);
        select * into v_fact from private.community_report_facts
         where contributor_id = p_user and dataset_key = v_conn.dataset_key and source_report_key = v_key for update;
        v_was_visible := v_fact.contributor_id is not null and private.community_fact_publicly_listed(v_fact);
        -- Same dataset retries retain the existing contribution/projection behavior.
        if v_fact.contributor_id is null then
            insert into private.community_report_facts(contributor_id, dataset_key, source_report_key, source_report_id,
                latest_receipt_id, consent_grant_id, writer_epoch, source_revision, payload_sha256, report_number, public_state,
                report_date, completed_date, category, status, disposition, amount_kind, amount_confirmed_won, penalty_points,
                vehicle_raw, lat, lng, lat_text, lng_text, coord_source, address, region_code, point_key, agency_key,
                agency_name, agency_current_name, manager_key, manager_name, violation_law, source_agency_code, rating,
                answer_accepted_at)
            values (p_user, v_conn.dataset_key, v_key, e->>'source_report_id', v_receipt, v_grant.grant_id, v_epoch, v_rev,
                e->>'payload_sha256', e->>'report_number', d->>'public_state', (d->>'report_date')::date, (d->>'completed_date')::date,
                d->>'category', d->>'status', d->>'disposition', d->>'amount_kind', (d->>'amount_confirmed_won')::bigint,
                (d->>'penalty_points')::integer, d->>'vehicle_raw', (d->>'lat')::double precision,
                (d->>'lng')::double precision, d->>'lat_text', d->>'lng_text', d->>'coord_source', d->>'address',
                d->>'region_code', d->>'point_key', d->>'agency_key', d->>'agency_name', d->>'agency_current_name',
                d->>'manager_key', d->>'manager_name',
                d->>'violation_law', d->>'source_agency_code', (d->>'rating')::integer,
                clock_timestamp());
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
                    -- REVIEW4 중간: 키 없는 payload(v1/v2)의 같은 기관명 갱신은
                    -- 저장된 기관 키·현행명도 보존한다. derived(d)는 코드가 없어
                    -- 기관명 해시(a1:)라서 그대로 덮으면 승계 기관의 inst: 통계가
                    -- a1:로 갈라진다. 키가 있거나(명시 null 포함) 기관명이 다르면
                    -- d 값을 쓴다(개명 답변에 옛 키 부착 금지).
                    agency_key = case when (e->'payload') ? 'source_agency_code'
                                              then d->>'agency_key'
                                              when d->>'agency_name' is not distinct from v_fact.agency_name
                                              then v_fact.agency_key
                                              else d->>'agency_key' end,
                    agency_name = d->>'agency_name',
                    agency_current_name = case when (e->'payload') ? 'source_agency_code'
                                              then d->>'agency_current_name'
                                              when d->>'agency_name' is not distinct from v_fact.agency_name
                                              then v_fact.agency_current_name
                                              else d->>'agency_current_name' end,
                    manager_key = case when (e->'payload') ? 'source_agency_code'
                                              then d->>'manager_key'
                                              when d->>'agency_name' is not distinct from v_fact.agency_name
                                              then case when d->>'manager_name' is not distinct from v_fact.manager_name
                                                        then v_fact.manager_key
                                                        when d->>'manager_name' is null
                                                        then null
                                                        else 'm1:' || substring(encode(extensions.digest(
                                                            coalesce(v_fact.agency_key, 'agency-unknown')
                                                            || '|' || normalize((d->>'manager_name'), NFC), 'sha256'), 'hex'), 1, 24) end
                                              else d->>'manager_key' end,
                    manager_name = d->>'manager_name', violation_law = d->>'violation_law',
                    rating = case when (e->'payload') ? 'rating' then (d->>'rating')::integer else v_fact.rating end,
                    -- REVIEW3 R3: v1/v2 payload 에는 source_agency_code 키가 없다.
                    -- 키가 있을 때만(명시적 NULL 포함) 쓰고, 키가 없을 때는 기관명이
                    -- 같으면 보존(같은 기관의 새 답변), 다르면 NULL(새 기관 답변에
                    -- 옛 코드를 붙이지 않는다).
                    source_agency_code = case when (e->'payload') ? 'source_agency_code'
                                              then d->>'source_agency_code'
                                              when d->>'agency_name' is not distinct from v_fact.agency_name
                                              then v_fact.source_agency_code
                                              else null end,
                    -- REVIEW3 R1: 대표 선출용 답변 수신 시각. 내용이 실제로 바뀔
                    -- 때만 갱신한다(grant 만 바뀌는 reshare·no_change 는 유지).
                    answer_accepted_at = case when v_fact.payload_sha256 is not distinct from e->>'payload_sha256'
                                              then v_fact.answer_accepted_at else clock_timestamp() end,
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
commit;
