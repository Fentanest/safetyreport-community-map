create or replace function public.internal_community_ingest_v2(
    p_user uuid, p_session uuid, p_request_id text, p_envelope jsonb, p_events jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
    v_policy private.community_policies%rowtype;
    v_profile private.contributor_profiles%rowtype;
    v_grant private.community_consent_grants%rowtype;
    v_conn private.community_connections%rowtype;
    v_fact private.community_report_facts%rowtype;
    v_raw private.community_report_raw%rowtype;
    v_cfg record;
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
    select v2_enabled, raw_policy_version into v_cfg from private.community_ingest_config where singleton;
    if not coalesce(v_cfg.v2_enabled, false) or v_cfg.raw_policy_version is null then return jsonb_build_object('error','service_unavailable'); end if;
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
    if not private.community_policy_version_at_least(v_grant.policy_version, v_cfg.raw_policy_version) then
        return jsonb_build_object('error','consent_outdated');
    end if;
    -- FOR UPDATE (not SHARE): this transaction later raises last_accepted_revision, and a shared lock held by a
    -- parallel ingest of the same connection would deadlock with it (S-09-R). Same-connection ingests serialize.
    select * into v_conn from private.community_connections
     where connection_id = (p_envelope->>'connection_id')::uuid and user_id = p_user for update;
    if v_conn.connection_id is null then return jsonb_build_object('error', 'connection_unknown'); end if;
    update private.community_connections set last_contract='community-ingest-v2',
        last_client_version=p_envelope->>'client_version', last_parser_version=p_envelope->>'parser_version', last_seen_at=now()
     where connection_id=v_conn.connection_id;
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
            contract, trigger, payload, payload_sha256, captured_at, quarantine_reason, report_number)
        values (p_user, v_event_id, p_request_id, v_conn.connection_id, v_grant.grant_id, v_conn.dataset_key, v_epoch,
            'safetyreport', v_key, e->>'source_report_id', v_rev, e->>'event_type', 'community-ingest-v2', p_envelope->>'trigger',
            null, e->>'payload_sha256', (e->>'captured_at')::timestamptz, e->>'quarantine_reason', e->>'report_number')
        on conflict (contributor_id, event_id) do nothing
        returning receipt_id into v_receipt;
        if v_receipt is null then
            -- Immutable event fields (contract): event_type, source_report_id/key, source_revision, writer_epoch,
            -- captured_at, payload_sha256 and the dataset of the connection. Grant/connection/trigger/request are transport
            -- context and may legitimately differ on a retry after rebind or policy re-consent.
            select contract, receipt_id, payload_sha256, result, rejection_reason, dataset_key, source_report_key, source_report_id, source_revision,
                   writer_epoch, event_type, captured_at, report_number
              into v_existing from private.community_ingest_events where contributor_id = p_user and event_id = v_event_id;
            if v_existing.contract = 'community-ingest-v2' and v_existing.payload_sha256 = e->>'payload_sha256' and v_existing.dataset_key = v_conn.dataset_key
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
        if exists(select 1 from private.community_report_facts f where f.dataset_key<>v_conn.dataset_key
            and (f.source_report_key=v_key or (e->>'report_number' is not null and f.report_number=e->>'report_number')))
           or exists(select 1 from private.community_report_raw r where r.dataset_key<>v_conn.dataset_key
            and (r.source_report_key=v_key or (e->>'report_number' is not null and r.report_number=e->>'report_number'))) then
            update private.community_ingest_events set result='rejected',rejection_reason='report_owned_elsewhere' where receipt_id=v_receipt;
            insert into private.community_report_ownership_audit(receipt_id,request_id,user_id,dataset_key,source_report_key,report_number)
                values(v_receipt,p_request_id,p_user,v_conn.dataset_key,v_key,e->>'report_number');
            v_results:=v_results||jsonb_build_object('event_id',v_event_id,'status','rejected','durable',false,'receipt_id',null,
                'projection_status','not_applicable','error',jsonb_build_object('code','report_owned_elsewhere','retryable',false));
            continue;
        end if;
        -- Lock order (shared with the parser worker and revoke): profile -> grant -> report advisory -> raw -> fact -> queue.
        select * into v_raw from private.community_report_raw where contributor_id=p_user and dataset_key=v_conn.dataset_key and source_report_key=v_key for update;
        select * into v_fact from private.community_report_facts where contributor_id=p_user and dataset_key=v_conn.dataset_key and source_report_key=v_key for update;
        if (v_raw.contributor_id is not null and (v_epoch,v_rev)<(v_raw.writer_epoch,v_raw.source_revision))
           or (v_fact.contributor_id is not null and (v_epoch,v_rev)<(v_fact.writer_epoch,v_fact.source_revision)) then
            v_result:='stale_ignored';
        elsif v_raw.contributor_id is not null and v_raw.raw_sha256=e->'raw'->>'sha256'
            and v_raw.supplement_sha256=e->>'supplement_sha256'
            and v_raw.consent_grant_id=v_grant.grant_id
            and ((v_raw.parse_state='parsed' and v_fact.fact_source='raw') or v_raw.parse_state='dead')
            and (v_epoch,v_rev)=(v_raw.writer_epoch,v_raw.source_revision) then
            -- dead: identical bytes would fail identically; only new bytes or a new parse key re-queue it.
            v_result:='no_change';
        else
            insert into private.community_report_raw(contributor_id,dataset_key,source_report_key,source_report_id,report_number,
                consent_grant_id,latest_receipt_id,event_type,captured_at,raw_text,raw_sha256,raw_size,fetched_at,raw_source,
                supplement,supplement_sha256,client_observation,client_observation_sha256,client_parser_version,writer_epoch,source_revision)
            values(p_user,v_conn.dataset_key,v_key,e->>'source_report_id',e->>'report_number',v_grant.grant_id,v_receipt,e->>'event_type',
                (e->>'captured_at')::timestamptz,e->'raw'->>'body',e->'raw'->>'sha256',(e->'raw'->>'size')::integer,
                (e->'raw'->>'fetched_at')::timestamptz,e->'raw'->>'source',e->'supplement',e->>'supplement_sha256',
                e->'client_observation',e->>'client_observation_sha256',p_envelope->>'parser_version',v_epoch,v_rev)
            on conflict(contributor_id,dataset_key,source_report_key) do update set
                source_report_id=excluded.source_report_id,
                report_number=coalesce(excluded.report_number,private.community_report_raw.report_number),
                consent_grant_id=excluded.consent_grant_id,
                latest_receipt_id=excluded.latest_receipt_id,event_type=excluded.event_type,captured_at=excluded.captured_at,
                raw_text=excluded.raw_text,raw_sha256=excluded.raw_sha256,raw_size=excluded.raw_size,fetched_at=excluded.fetched_at,raw_source=excluded.raw_source,
                supplement=excluded.supplement,supplement_sha256=excluded.supplement_sha256,client_observation=excluded.client_observation,
                client_observation_sha256=excluded.client_observation_sha256,client_parser_version=excluded.client_parser_version,
                writer_epoch=excluded.writer_epoch,source_revision=excluded.source_revision,received_at=now(),parse_state='pending',parse_error=null;
            -- A new body resets attempts and any lease: an in-flight worker on the old bytes ends `superseded`.
            insert into private.community_parse_queue(contributor_id,dataset_key,source_report_key)
                values(p_user,v_conn.dataset_key,v_key) on conflict(contributor_id,dataset_key,source_report_key)
                do update set priority='ingest',attempts=0,next_attempt_at=now(),leased_until=null,lease_token=null;
            v_result:='stored';
        end if;
        update private.community_ingest_events set result=v_result where receipt_id=v_receipt;
        v_max_rev:=greatest(v_max_rev,v_rev);
        v_results:=v_results||jsonb_build_object('event_id',v_event_id,'status',v_result,'durable',true,'receipt_id',v_receipt,
            'projection_status',case when v_result='stored' then 'parse_pending' else 'not_applicable' end);
    end loop;
    if v_max_rev > v_conn.last_accepted_revision then
        update private.community_connections set last_accepted_revision=v_max_rev where connection_id=v_conn.connection_id;
    end if;
    select dataset_version into v_version from private.analytics_state where singleton;
    return jsonb_build_object('results',v_results,'dataset_version',v_version);
end $$;
revoke all on function public.internal_community_ingest_v2(uuid,uuid,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.internal_community_ingest_v2(uuid,uuid,text,jsonb,jsonb) to service_role;
