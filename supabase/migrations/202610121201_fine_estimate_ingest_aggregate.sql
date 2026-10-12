-- Requires 202610121200_fine_estimate_columns.sql. No table rewrite or backfill.
begin;
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
                agency_name, agency_current_name, manager_key, manager_name, violation_law, source_agency_code, rating, fine_estimate_won, fine_estimate_rule, fine_estimate_rule_version,
                answer_accepted_at)
            values (p_user, v_conn.dataset_key, v_key, e->>'source_report_id', v_receipt, v_grant.grant_id, v_epoch, v_rev,
                e->>'payload_sha256', e->>'report_number', d->>'public_state', (d->>'report_date')::date, (d->>'completed_date')::date,
                d->>'category', d->>'status', d->>'disposition', d->>'amount_kind', (d->>'amount_confirmed_won')::bigint,
                (d->>'penalty_points')::integer, d->>'vehicle_raw', (d->>'lat')::double precision,
                (d->>'lng')::double precision, d->>'lat_text', d->>'lng_text', d->>'coord_source', d->>'address',
                d->>'region_code', d->>'point_key', d->>'agency_key', d->>'agency_name', d->>'agency_current_name',
                d->>'manager_key', d->>'manager_name',
                d->>'violation_law', d->>'source_agency_code', (d->>'rating')::integer,
                (d->>'fine_estimate_won')::bigint, d->>'fine_estimate_rule', d->>'fine_estimate_rule_version',
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
                    fine_estimate_won = (d->>'fine_estimate_won')::bigint,
                    fine_estimate_rule = d->>'fine_estimate_rule',
                    fine_estimate_rule_version = d->>'fine_estimate_rule_version',
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

create or replace function private.analytics_cohort_payload(
    p_date_basis text, p_start date, p_end date, p_with_previous boolean, p_category text, p_region_code text,
    p_agency_key text, p_manager_key text, p_bbox double precision[], p_compact boolean
)
returns json language plpgsql stable security definer set search_path = '' set enable_nestloop = off as $$
declare
    v_from date;
    v_rows json;
    v_count integer;
    v_scoped integer;
begin
    if p_date_basis is null or p_date_basis not in ('report_date', 'completed_date') or p_with_previous is null or
       p_start is null or p_end is null or p_end < p_start or p_start - (p_end - p_start + 1) < date '1900-01-01' or
       p_category is null or p_category not in ('all','traffic','parking','safety','living','other') or
       (p_bbox is not null and (array_length(p_bbox,1) <> 4 or p_bbox[1] > p_bbox[3] or p_bbox[2] > p_bbox[4])) then
        raise exception 'INVALID_QUERY';
    end if;
    perform set_config('statement_timeout', '8000', true);
    v_from := case when p_with_previous then p_start - (p_end - p_start + 1) else p_start end;

    -- Resolve active lineage once per grant, not once per fact. Eligibility includes user_id;
    -- disclosure deliberately follows the existing lineage-only EXISTS semantics.
    with disclosures as materialized (
        select g.lineage_id,
               coalesce(bool_or(d.amounts_public), false) as amount_public,
               coalesce(bool_or(d.violation_law_public), false) as law_public,
               coalesce(bool_or(d.rating_public), false) as rating_public
          from private.community_consent_grants g
          left join private.community_policy_disclosures d on d.version = g.policy_version
         where g.revoked_at is null
         group by g.lineage_id
    ), active_grants as materialized (
        select g.grant_id, d.amount_public, d.law_public, d.rating_public
          from private.community_consent_grants g
          join private.community_consent_grants a
            on a.lineage_id = g.lineage_id and a.user_id = g.user_id and a.revoked_at is null
          join disclosures d on d.lineage_id = g.lineage_id
    ), candidates as materialized (
        -- Keep date indexes available for narrow or empty windows; no national wide-row spool.
        select distinct f.source_report_key
          from private.community_report_facts f
          join private.contributor_profiles c on c.user_id = f.contributor_id and c.status = 'active'
          join active_grants g on g.grant_id = f.consent_grant_id
         where f.public_state = 'completed'
           and (case when p_date_basis = 'report_date' then f.report_date else f.completed_date end) between v_from and p_end
           and (p_category = 'all' or f.category = p_category)
           and (p_agency_key is null or f.agency_key = p_agency_key)
           and (p_manager_key is null or f.manager_key = p_manager_key)
           and (p_bbox is null or (f.lat is not null and f.lng between p_bbox[1] and p_bbox[3] and f.lat between p_bbox[2] and p_bbox[4]))
    ), scoped as materialized (
        -- D13: keep the whole eligible history of each candidate key for election.
        select f.*, g.amount_public, g.law_public, g.rating_public
          from private.community_report_facts f
          join private.contributor_profiles c on c.user_id = f.contributor_id and c.status = 'active'
          join active_grants g on g.grant_id = f.consent_grant_id
          join candidates k using (source_report_key)
         where f.public_state = 'completed'
    ), budget as materialized (
        select count(*) as n from scoped
    ), admitted as materialized (
        -- Do not rank or build any JSON if the whole-history row budget is exceeded.
        select s.* from scoped s where (select n <= 100000 from budget)
    ), key_numbers as (
        -- R2: first known number over exactly the same eligible history as scoped.
        select distinct on (f.source_report_key) f.source_report_key, f.report_number as key_number
          from admitted f
         order by f.source_report_key, (f.report_number is null), f.first_accepted_at, f.contributor_id, f.dataset_key
    ),
    identified as (
        select s.*,
               k.key_number,
               (s.source_report_key || '|' || coalesce(s.report_number, k.key_number, 'legacy')) as report_identity,
               max(s.answer_accepted_at) over (
                   partition by s.source_report_key, coalesce(s.report_number, k.key_number, 'legacy'), s.payload_sha256
               ) as answer_time
          from admitted s
          join key_numbers k using (source_report_key)
    ),
    ranked as (
        select i.*,
               -- R1 order (unchanged): latest adopted answer, newer official answer date, earliest contributor
               row_number() over w = 1 as is_representative,
               first_value(i.report_date) over w as identity_report_date,
               first_value(i.completed_date) over w as identity_completed_date,
               count(*) over (partition by i.report_identity) as contribution_count
          from identified i
        window w as (partition by i.report_identity
                     order by i.answer_time desc, i.completed_date desc nulls last, i.first_accepted_at, i.contributor_id, i.dataset_key
                     rows between unbounded preceding and unbounded following)
    )
    select (select n from budget), count(*), coalesce(json_agg(case when p_compact then json_build_array(
        dataset_key || ':' || source_report_key,
        contributor_id,
        report_identity,
        report_number,
        source_report_key,
        first_accepted_at,
        'ingest-v1',
        1,
        report_date,
        completed_date,
        identity_report_date,
        identity_completed_date,
        category,
        status,
        disposition,
        vehicle_raw,
        point_key,
        lat,
        lng,
        address,
        region_code,
        agency_key,
        agency_name,
        agency_current_name,
        manager_key,
        manager_name,
        is_representative,
        contribution_count,
        amount_kind,
        case when amount_public then amount_confirmed_won else null end,
        amount_public,
        amount_confirmed_won is not null,
        case when law_public then violation_law else null end,
        case when rating_public then rating else null end,
        case when amount_public then fine_estimate_won else null end
    ) else json_build_object(
        'fact_identity', dataset_key || ':' || source_report_key, 'contributor_id', contributor_id,
        'report_identity', report_identity, 'report_number', report_number,
        'source_report_key', source_report_key, 'first_accepted_at', first_accepted_at,
        'snapshot_id', 'ingest-v1', 'snapshot_generation', 1,
        'report_date', report_date, 'completed_date', completed_date,
        'identity_report_date', identity_report_date, 'identity_completed_date', identity_completed_date,
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
        'amount_stated', amount_confirmed_won is not null,
        'violation_law', case when law_public then violation_law else null end,
        'rating', case when rating_public then rating else null end,
        'fine_estimate_won', case when amount_public then fine_estimate_won else null end
    ) end), '[]'::json) into v_scoped, v_count, v_rows from ranked
     where (p_category = 'all' or category = p_category)
       and (p_region_code is null or region_code = p_region_code)
       and (p_agency_key is null or agency_key = p_agency_key)
       and (p_manager_key is null or manager_key = p_manager_key)
       and (p_bbox is null or (lat is not null and lng between p_bbox[1] and p_bbox[3] and lat between p_bbox[2] and p_bbox[4]))
       -- the representative’s SELECTED date decides for every row of the identity (never the row’s own copy)
       and (case when p_date_basis = 'report_date' then identity_report_date else identity_completed_date end)
           between v_from and p_end;
    if v_scoped > 100000 or v_count > 100000 then raise exception 'RESULT_TOO_LARGE'; end if;
    return case when p_compact then json_build_object('encoding','columns-v1','columns',
        json_build_array('fact_identity','contributor_id','report_identity','report_number','source_report_key','first_accepted_at','snapshot_id','snapshot_generation','report_date','completed_date','identity_report_date','identity_completed_date','category','status','disposition','vehicle_raw','point_key','lat','lng','address','region_code','agency_key','agency_name','agency_current_name','manager_key','manager_name','is_representative','contribution_count','amount_kind','amount_confirmed_won','amount_public','amount_stated','violation_law','rating','fine_estimate_won'),'rows',v_rows) else v_rows end;
end;
$$;


create or replace function private.analytics_screen_aggregate_v2(p_scope jsonb,p_user uuid,p_panels jsonb)
returns json language plpgsql stable security definer set search_path='' set enable_nestloop=off set enable_sort=off set work_mem='16MB' as $$
declare p_date_basis text:=p_scope->>'date_basis'; p_start date:=(p_scope->>'start')::date; p_end date:=(p_scope->>'end')::date;
 p_category text:=p_scope->>'category';p_agency_key text:=p_scope->>'agency_key';p_manager_key text:=p_scope->>'manager_key';
 p_bbox double precision[];v_from date;result json;v_budget bigint;
begin
 if p_date_basis is null or p_date_basis not in ('report_date','completed_date') or p_start is null or p_end is null or p_end<p_start
 or p_start-(p_end-p_start+1)<date '1900-01-01' or p_category is null or p_category not in ('all','traffic','parking','safety','living','other')
 or jsonb_typeof(p_panels)<>'array' or jsonb_array_length(p_panels)>8 then raise exception 'INVALID_QUERY';end if;
 if jsonb_typeof(p_scope->'bbox')='array' then select array_agg(x::double precision order by n) into p_bbox
 from jsonb_array_elements_text(p_scope->'bbox') with ordinality a(x,n);end if;
 v_from:=p_start-(p_end-p_start+1);
    with disclosures as materialized (
        select g.lineage_id,
               coalesce(bool_or(d.amounts_public), false) as amount_public,
               coalesce(bool_or(d.violation_law_public), false) as law_public,
               coalesce(bool_or(d.rating_public), false) as rating_public
          from private.community_consent_grants g
          left join private.community_policy_disclosures d on d.version = g.policy_version
         where g.revoked_at is null
         group by g.lineage_id
    ), active_grants as materialized (
        select g.grant_id, d.amount_public, d.law_public, d.rating_public
          from private.community_consent_grants g
          join private.community_consent_grants a
            on a.lineage_id = g.lineage_id and a.user_id = g.user_id and a.revoked_at is null
          join disclosures d on d.lineage_id = g.lineage_id
    ), candidates as materialized (
        -- Keep date indexes available for narrow or empty windows; no national wide-row spool.
        select distinct f.source_report_key
          from private.community_report_facts f
          join private.contributor_profiles c on c.user_id = f.contributor_id and c.status = 'active'
          join active_grants g on g.grant_id = f.consent_grant_id
         where f.public_state = 'completed'
           and (case when p_date_basis = 'report_date' then f.report_date else f.completed_date end) between v_from and p_end
           and (p_category = 'all' or f.category = p_category)
           and (p_agency_key is null or f.agency_key = p_agency_key)
           and (p_manager_key is null or f.manager_key = p_manager_key)
           and (p_bbox is null or (f.lat is not null and f.lng between p_bbox[1] and p_bbox[3] and f.lat between p_bbox[2] and p_bbox[4]))
    ), scoped as materialized (
        -- D13: keep the whole eligible history of each candidate key for election.
        select f.dataset_key, f.source_report_key, f.report_number, f.payload_sha256, f.answer_accepted_at, f.contributor_id, f.first_accepted_at, f.report_date, f.completed_date, f.status, f.disposition, f.vehicle_raw, f.lat, f.lng, f.address, f.region_code, f.agency_key, f.agency_name, f.agency_current_name, f.manager_key, f.manager_name, f.amount_kind, f.amount_confirmed_won, f.fine_estimate_won, f.violation_law, f.rating, f.category, g.amount_public, g.law_public, g.rating_public
          from private.community_report_facts f
          join private.contributor_profiles c on c.user_id = f.contributor_id and c.status = 'active'
          join active_grants g on g.grant_id = f.consent_grant_id
          join candidates k using (source_report_key)
         where f.public_state = 'completed'
    ), budget as materialized (
        select count(*) as n from scoped
    ), admitted as materialized (
        -- Do not rank or build any JSON if the whole-history row budget is exceeded.
        select s.* from scoped s where (select n <= 100000 from budget)
    ), key_numbers as (
        -- R2: first known number over exactly the same eligible history as scoped.
        select distinct on (f.source_report_key) f.source_report_key, f.report_number as key_number
          from admitted f
         order by f.source_report_key, (f.report_number is null), f.first_accepted_at, f.contributor_id, f.dataset_key
    ),
    identified as (
        select s.*,
               k.key_number,
               (s.source_report_key || '|' || coalesce(s.report_number, k.key_number, 'legacy')) as report_identity,
               max(s.answer_accepted_at) over (
                   partition by s.source_report_key, coalesce(s.report_number, k.key_number, 'legacy'), s.payload_sha256
               ) as answer_time
          from admitted s
          join key_numbers k using (source_report_key)
    ),
    ranked as (
        select i.*,
               -- R1 order (unchanged): latest adopted answer, newer official answer date, earliest contributor
               row_number() over w = 1 as is_representative,
               first_value(i.report_date) over w as identity_report_date,
               first_value(i.completed_date) over w as identity_completed_date,
               count(*) over (partition by i.report_identity) as contribution_count
          from identified i
        window w as (partition by i.report_identity
                     order by i.answer_time desc, i.completed_date desc nulls last, i.first_accepted_at, i.contributor_id, i.dataset_key
                     rows between unbounded preceding and unbounded following)
    ), ordered as materialized (
 select r.report_identity,r.contributor_id,r.first_accepted_at,r.report_date,r.completed_date,r.identity_report_date,r.identity_completed_date,r.status,r.disposition,r.vehicle_raw,r.lat,r.lng,r.address,r.region_code,r.agency_key,r.agency_name,r.agency_current_name,r.manager_key,r.manager_name,r.is_representative,r.amount_kind,r.amount_confirmed_won,r.fine_estimate_won,r.amount_public,r.law_public,r.rating_public,r.violation_law,r.rating,row_number() over () as ord from ranked r
 where (p_category='all' or category=p_category)
 and (p_agency_key is null or agency_key=p_agency_key) and (p_manager_key is null or manager_key=p_manager_key)
 and (p_bbox is null or (lat is not null and lng between p_bbox[1] and p_bbox[3] and lat between p_bbox[2] and p_bbox[4]))
 and (case p_date_basis when 'report_date' then identity_report_date else identity_completed_date end) between v_from and p_end
) , address_inputs as materialized (
 select raw,private.screen_address(raw) as address from (select distinct address as raw from ordered) a
), addresses as materialized (
 select raw,address,private.screen_place_key(address) as place from address_inputs
), plates as materialized (
 select raw,private.screen_plate(raw) as plate from (select distinct vehicle_raw as raw from ordered) a
), region_names as materialized (
 select raw,private.analytics_region(raw,null,null) as code from (select distinct region_code as raw from ordered) a
), region_points as materialized (
 select k.*,private.analytics_region(k.raw,k.lat,k.lng) as code from (
 select distinct o.region_code as raw,o.lat,o.lng from ordered o left join region_names n on n.raw=o.region_code
 where n.code is null and o.lat is not null and o.lng is not null) k
), laws as materialized (
 select raw,private.screen_law(raw) as law from (select distinct violation_law as raw from ordered where law_public) a
), normalized as materialized (
 select o.ord,o.report_identity,o.contributor_id,o.first_accepted_at,o.report_date,o.completed_date,o.status,o.disposition,o.lat,o.lng,o.agency_key,o.agency_name,o.agency_current_name,o.manager_key,o.manager_name,o.is_representative,o.amount_confirmed_won,
 case when o.amount_public and o.disposition='fine' and o.amount_confirmed_won is null then o.fine_estimate_won end as estimate_won,a.address as place_address,a.place,
 coalesce(rn.code,rp.code) as region,l.law,p.plate,
 case p_date_basis when 'report_date' then identity_report_date else identity_completed_date end as day,
 case p_date_basis when 'report_date' then completed_date else report_date end as other_day,
 status in ('accepted','partial','rejected','withdrawn','transferred','completed_unknown') as done,
 case when status in ('accepted','partial','rejected','completed_unknown') and completed_date>=report_date then completed_date-report_date end as days,
 case when amount_kind='combined' then 'combined' when amount_kind='penalty' then case when disposition='fine' then 'conflict' else 'penalty' end
 when amount_kind='fine' and disposition<>'fine' then 'conflict' when disposition<>'fine' then 'none'
 when amount_kind is distinct from 'fine' or status not in ('accepted','partial') then 'conflict'
 when not amount_public then case when amount_confirmed_won is null then 'unconfirmed' else 'undisclosed' end
 when amount_confirmed_won is null then 'unconfirmed' else 'confirmed' end as amount_class,
 case when rating_public then rating end as stars
 from ordered o left join addresses a on a.raw=o.address left join plates p on p.raw=o.vehicle_raw
 left join region_names rn on rn.raw=o.region_code
 left join region_points rp on rn.code is null and rp.raw is not distinct from o.region_code and rp.lat=o.lat and rp.lng=o.lng
 left join laws l on law_public and l.raw=o.violation_law
), filtered as materialized (
 select * from normalized where (p_scope->>'region_code' is null or region like (p_scope->>'region_code')||'%')
 and (p_scope->>'law' is null or case when p_scope->>'law'='__none__' then law is null else law=private.screen_law(p_scope->>'law') end)
) , own_done as materialized (
 select distinct on(report_identity) ord from filtered where contributor_id=p_user and done
 order by report_identity,first_accepted_at,ord
), own as materialized (
 select distinct on(report_identity) ord from filtered where contributor_id=p_user
 order by report_identity,first_accepted_at,ord
), sides as materialized (
 select f.*,s.side collate "C" as side,s.report_member,s.done_member,case when day>=p_start then 0 else 1 end as period
 from filtered f left join own m on m.ord=f.ord left join own_done md on md.ord=f.ord
 cross join lateral (select 'all' as side,true as report_member,f.done as done_member where f.is_representative
 union all select 'mine',m.ord is not null,md.ord is not null where (m.ord is not null or md.ord is not null)
 and exists(select 1 from jsonb_array_elements(p_panels) p where p->>'path'='compare')) s
), focus as materialized (
 select distinct substr(p->>'path',8) as key from jsonb_array_elements(p_panels) p where p->>'path' like 'places/pl1:%'
), expanded as not materialized (
 select s.*,g.kind collate "C" as kind,g.k collate "C" as k,g.focus collate "C" as focus from sides s cross join lateral (
 select 'summary' as kind,''::text as k,''::text as focus
 union all select 'month',to_char(day,'YYYY-MM'),'' where period=0
 union all select 'agency',coalesce(nullif(agency_key,''),'agency-unknown'),'' where period=0 and done_member
 union all select 'manager',coalesce(nullif(agency_key,''),'agency-unknown')||':'||coalesce(nullif(manager_key,''),'manager-unknown'),'' where period=0 and done_member
 union all select 'law',coalesce(law,''),'' where period=0 and done_member and side='all'
 union all select 'region',coalesce(region,''),'' where period=0
 union all select 'region',left(region,2),'' where period=0 and region is not null
 union all select 'place',coalesce(place,''),'' where period=0
 union all select 'focus','',place where side='all' and place in(select key from focus)
 union all select 'agency',coalesce(nullif(agency_key,''),'agency-unknown'),place where side='all' and period=0 and done_member and place in(select key from focus)
 union all select 'manager',coalesce(nullif(agency_key,''),'agency-unknown')||':'||coalesce(nullif(manager_key,''),'manager-unknown'),place where side='all' and period=0 and done_member and place in(select key from focus)
 union all select 'heat',case when p_scope->>'agency_key' is null then coalesce(nullif(agency_key,''),'agency-unknown') else
 coalesce(nullif(agency_key,''),'agency-unknown')||':'||coalesce(nullif(manager_key,''),'manager-unknown') end,law where side='all' and period=0 and done_member and law is not null
 ) g
), stats as (
 select side,period,kind,k,focus,min(ord) as ord,
 count(*) filter(where report_member) as n,count(*) filter(where done_member) as c,
 count(*) filter(where done_member and status='accepted') as a,count(*) filter(where done_member and status='partial') as p,count(*) filter(where done_member and status='rejected') as r,
 count(*) filter(where done_member and disposition='fine') as f,count(*) filter(where done_member and disposition='warning') as w,count(*) filter(where done_member and disposition='penalty') as penalty,
 count(*) filter(where report_member and other_day is null) as missing,
 count(*) filter(where done_member and completed_date is null) as answer_missing,
 count(days) filter(where done_member) as dn,sum(days) filter(where done_member) as ds,array_agg(days::bigint) filter(where done_member and days is not null and kind not in ('place','law','heat')) as dvalues,
 min(days) filter(where done_member) as dmin,max(days) filter(where done_member) as dmax,
 count(*) filter(where done_member and status in ('accepted','partial','rejected','completed_unknown') and completed_date is not null and report_date is null) as dnr,
 count(*) filter(where done_member and status in ('accepted','partial','rejected','completed_unknown') and completed_date<report_date) as drev,
 count(*) filter(where done_member and status in ('accepted','partial','rejected','completed_unknown') and completed_date is null) as dna,
 count(estimate_won) filter(where done_member and kind in ('summary','focus')) as en,
 sum(estimate_won) filter(where done_member and kind in ('summary','focus')) as esum,
 count(*) filter(where done_member and amount_class='confirmed') as an,
 sum(amount_confirmed_won) filter(where done_member and amount_class='confirmed') as asum,
 array_agg(amount_confirmed_won) filter(where kind in ('summary','focus') and done_member and amount_class='confirmed') as avalues,
 count(*) filter(where done_member and amount_class='confirmed' and amount_confirmed_won=0) as az,
 count(*) filter(where done_member and amount_class='unconfirmed') as aunconfirmed,
 count(*) filter(where done_member and amount_class='undisclosed') as aundisclosed,
 count(*) filter(where done_member and amount_class='conflict') as aconflict,
 count(*) filter(where done_member and amount_class='penalty') as apenalty,
 count(*) filter(where done_member and amount_class='combined') as acombined,
 count(stars) filter(where done_member) as rn,sum(stars) filter(where done_member) as rs
 from expanded where kind not in ('heat','place') group by side,period,kind,k,focus
), summary_details as materialized (
 select side,period,
 count(*) filter(where done_member and days between 0 and 6) as h0,
 count(*) filter(where done_member and days between 7 and 13) as h1,
 count(*) filter(where done_member and days between 14 and 20) as h2,
 count(*) filter(where done_member and days between 21 and 27) as h3,
 count(*) filter(where done_member and days between 28 and 34) as h4,
 count(*) filter(where done_member and days between 35 and 41) as h5,
 count(*) filter(where done_member and days between 42 and 48) as h6,
 count(*) filter(where done_member and days between 49 and 55) as h7,
 count(*) filter(where done_member and days between 56 and 62) as h8,
 count(*) filter(where done_member and days between 63 and 69) as h9,
 count(*) filter(where done_member and days between 70 and 76) as h10,
 count(*) filter(where done_member and days between 77 and 83) as h11,
 count(*) filter(where done_member and days >=84) as h12,
 count(*) filter(where done_member and true and stars=1) as rall1,
 count(*) filter(where done_member and true and stars=2) as rall2,
 count(*) filter(where done_member and true and stars=3) as rall3,
 count(*) filter(where done_member and true and stars=4) as rall4,
 count(*) filter(where done_member and true and stars=5) as rall5,
 count(*) filter(where done_member and status='accepted' and stars=1) as raccepted1,
 count(*) filter(where done_member and status='accepted' and stars=2) as raccepted2,
 count(*) filter(where done_member and status='accepted' and stars=3) as raccepted3,
 count(*) filter(where done_member and status='accepted' and stars=4) as raccepted4,
 count(*) filter(where done_member and status='accepted' and stars=5) as raccepted5,
 count(*) filter(where done_member and status='partial' and stars=1) as rpartial1,
 count(*) filter(where done_member and status='partial' and stars=2) as rpartial2,
 count(*) filter(where done_member and status='partial' and stars=3) as rpartial3,
 count(*) filter(where done_member and status='partial' and stars=4) as rpartial4,
 count(*) filter(where done_member and status='partial' and stars=5) as rpartial5,
 count(*) filter(where done_member and status='rejected' and stars=1) as rrejected1,
 count(*) filter(where done_member and status='rejected' and stars=2) as rrejected2,
 count(*) filter(where done_member and status='rejected' and stars=3) as rrejected3,
 count(*) filter(where done_member and status='rejected' and stars=4) as rrejected4,
 count(*) filter(where done_member and status='rejected' and stars=5) as rrejected5,
 count(*) filter(where done_member and disposition='fine' and stars=1) as rfine1,
 count(*) filter(where done_member and disposition='fine' and stars=2) as rfine2,
 count(*) filter(where done_member and disposition='fine' and stars=3) as rfine3,
 count(*) filter(where done_member and disposition='fine' and stars=4) as rfine4,
 count(*) filter(where done_member and disposition='fine' and stars=5) as rfine5,
 count(*) filter(where done_member and status not in ('accepted','partial','rejected') and stars=1) as runknown1,
 count(*) filter(where done_member and status not in ('accepted','partial','rejected') and stars=2) as runknown2,
 count(*) filter(where done_member and status not in ('accepted','partial','rejected') and stars=3) as runknown3,
 count(*) filter(where done_member and status not in ('accepted','partial','rejected') and stars=4) as runknown4,
 count(*) filter(where done_member and status not in ('accepted','partial','rejected') and stars=5) as runknown5
 from sides group by side,period) , stat_values as materialized (
 select s.*,private.screen_quantiles(dvalues) as dq,private.screen_quantiles(avalues) as aq from stats s
), place_counts as (
 select side,period,count(distinct place collate "C") filter(where report_member) as n from sides group by side,period
), light_stats as materialized (
 select side,period,kind,k,focus,min(ord) as ord,
 count(*) filter(where report_member) as n,count(*) filter(where done_member) as c,
 count(*) filter(where done_member and status='accepted') as a,
 count(*) filter(where done_member and status='partial') as p,
 count(*) filter(where done_member and status='rejected') as r,
 count(*) filter(where done_member and disposition='fine') as f,
 count(*) filter(where done_member and disposition='warning') as w
 from expanded where kind in ('place','heat') group by side,period,kind,k,focus
), heat_rows as materialized (
 select k,sum(c) as n,min(ord) as ord from light_stats where kind='heat' group by k
), heat_laws as materialized (
 select focus,sum(c) as n from light_stats where kind='heat' group by focus
), heat_top_rows as materialized (
 select h.*,o.agency_key,coalesce(nullif(o.agency_current_name,''),nullif(o.agency_name,''),'기관 정보 없음') as agency_name,o.manager_key,o.manager_name
 from heat_rows h join ordered o using(ord)
 order by n desc,coalesce(nullif(o.agency_current_name,''),nullif(o.agency_name,''),'기관 정보 없음') collate "ko-x-icu",k collate "en-x-icu" limit 40
), heat_top_laws as materialized (
 select * from heat_laws order by n desc,focus collate "ko-x-icu" limit 16
), stat_json as (
 select json_build_object(
 'side',side,'period',period,'kind',kind,'k',k,'focus',focus,'ord',stats.ord,
 'label',json_build_array(o.agency_key,coalesce(nullif(o.agency_current_name,''),nullif(o.agency_name,''),'기관 정보 없음'),o.manager_key,o.manager_name),
 'n',stats.n,'c',c,'a',a,'p',p,'r',r,'f',f,'w',w,'penalty',penalty,
 'places',case when kind='summary' then pc.n when kind='focus' and stats.n>0 then 1 else 0 end,
 'missing',missing,'answer_missing',answer_missing,
 'duration',json_build_array(dn,ds,dq[1],dq[2],dmin,dmax,dnr,drev,dna),
 'amount',json_build_array(an,asum,aq[1],az,aunconfirmed,aundisclosed,aconflict,apenalty,acombined),
 'estimate',json_build_array(en,esum),
 'rating',json_build_array(rn,rs)) as value,stats.ord
 from stat_values stats join place_counts pc using(side,period) join ordered o on o.ord=stats.ord
 where kind<>'summary'
 union all
 select json_build_object(
 'side',side,'period',period,'kind',kind,'k',k,'focus',focus,'ord',stats.ord,
 'n',stats.n,'c',c,'a',a,'p',p,'r',r,'f',f,'w',w,'penalty',penalty,'places',pc.n,
 'missing',missing,'answer_missing',answer_missing,
 'duration',json_build_array(dn,ds,dq[1],dq[2],dmin,dmax,dnr,drev,dna),
 'amount',json_build_array(an,asum,aq[1],az,aunconfirmed,aundisclosed,aconflict,apenalty,acombined),
 'estimate',json_build_array(en,esum),
 'rating',json_build_array(rn,rs),
 'histogram',json_build_array(h0,h1,h2,h3,h4,h5,h6,h7,h8,h9,h10,h11,h12),
 'ratings',json_build_array(json_build_array(rall1,rall2,rall3,rall4,rall5),json_build_array(raccepted1,raccepted2,raccepted3,raccepted4,raccepted5),json_build_array(rpartial1,rpartial2,rpartial3,rpartial4,rpartial5),json_build_array(rrejected1,rrejected2,rrejected3,rrejected4,rrejected5),json_build_array(rfine1,rfine2,rfine3,rfine4,rfine5),json_build_array(runknown1,runknown2,runknown3,runknown4,runknown5))) as value,stats.ord
 from stat_values stats join place_counts pc using(side,period) join summary_details using(side,period) where kind='summary'
 union all
 select json_build_object('side',side,'period',period,'kind',kind,'k',k,'focus',focus,
 'n',n,'c',c,'a',a,'p',p,'r',r,'f',f,'w',w),ord from light_stats where kind='place'
), coords as (
 select side,place,lat,lng,sum(report_member::int+done_member::int) as n,
 min(report_identity collate "C") as identity from sides where period=0 and place is not null and lat is not null and lng is not null
 group by side,place,lat,lng
) , focus_coords as (
 select side,place,lat,lng,count(*) as n,min(report_identity collate "C") as identity from sides
 where side='all' and period=0 and report_member and place in(select key from focus) and lat is not null and lng is not null
 group by side,place,lat,lng
), anchor_coords as (
 select distinct on(side,place) side,place,lat,lng,identity from (
 select * from coords union all select 'focus',place,lat,lng,n,identity from focus_coords) c
 order by side,place,n desc,identity collate "C"
), anchors as (
 select distinct on(c.side,s.place) c.side,s.place,s.lat,s.lng,s.place_address,s.region
 from sides s join anchor_coords c on (c.side=s.side or (c.side='focus' and s.side='all')) and c.place=s.place and c.lat=s.lat and c.lng=s.lng and c.identity=s.report_identity
 order by c.side,s.place,s.ord
), full_counts as (
 select case when day>=p_start then 0 else 1 end as period,g.place,count(*) as n,count(distinct contributor_id) as people,
 bool_or(contributor_id<>p_user) as shared from filtered cross join lateral (
 select ''::text as place union all select place where place in(select key from focus) or place in(select place from sides where side='mine' and period=0)) g
 group by 1,g.place
), vehicles as (
 select plate,count(*) as n,count(distinct report_date) as days from sides where side='all' and period=0 and plate is not null group by plate
), vehicle_totals as (
 select count(*) filter(where plate is null) as no_plate,count(*) filter(where plate is not null and report_date is null) as no_date
 from sides where side='all' and period=0
)
select (select n from budget),json_build_object('encoding','screen-aggregate-v2','estimate_version',1,
 'stats',coalesce((select json_agg(value order by ord) from stat_json),'[]'::json),
 'heat',json_build_object('row_kind',case when p_scope->>'agency_key' is null then 'agency' else 'manager' end,
 'rows',coalesce((select json_agg(json_build_object('key',k,'agency_key',agency_key,'manager_key',case when p_scope->>'agency_key' is not null then manager_key end,
 'agency_name',agency_name,'manager_name',case when p_scope->>'agency_key' is not null then manager_name end,'completed_count',n)
 order by n desc,agency_name collate "ko-x-icu",k collate "en-x-icu") from heat_top_rows),'[]'::json),
 'laws',coalesce((select json_agg(json_build_object('law_key',focus,'completed_count',n) order by n desc,focus collate "ko-x-icu") from heat_top_laws),'[]'::json),
 'cells',coalesce((select json_agg(json_build_object('row_key',s.k,'law_key',s.focus,'completed_count',s.c,
 'outcomes',json_build_object('accepted',s.a,'partial',s.p,'rejected',s.r,'result_known',s.a+s.p+s.r,'result_unknown',s.c-s.a-s.p-s.r),'fine_count',s.f)
 order by h.n desc,h.agency_name collate "ko-x-icu",h.k collate "en-x-icu",s.ord)
 from light_stats s join heat_top_rows h on h.k=s.k join heat_top_laws l on l.focus=s.focus where s.kind='heat'),'[]'::json),
 'total_rows',(select count(*) from heat_rows),'total_laws',(select count(*) from heat_laws)),
 'anchors',coalesce((select json_agg(json_build_array(side,place,lat,lng,place_address,region)) from anchors),'[]'::json),
 'full',coalesce((select json_agg(json_build_array(period,place,n,people,shared)) from full_counts),'[]'::json),
 'vehicles',json_build_object('identifiable',coalesce((select sum(n) from vehicles),0),
 'top',coalesce((select json_agg(json_build_array(private.screen_mask_plate(plate),n)) from (select * from vehicles order by n desc,plate collate "en-x-icu" limit 5) v),'[]'::json),
 'days',(select json_build_array(count(*) filter(where days=1),count(*) filter(where days=2),count(*) filter(where days between 3 and 4),count(*) filter(where days>=5)) from vehicles),
 'excluded',(select json_build_array(no_plate,no_date) from vehicle_totals)),
 'source_min',(select min(case p_date_basis when 'report_date' then report_date else completed_date end) from ordered)
) into v_budget,result;
if v_budget>100000 then raise exception 'RESULT_TOO_LARGE';end if;
return result;
end $$;


notify pgrst,'reload schema';
commit;
