-- Local candidate only. Requires the composed map/auth schema through 202610180400.
begin;
set local lock_timeout = '3s';
alter table private.community_report_facts
    add column fact_source text not null default 'dto' check (fact_source in ('dto','raw')),
    add column fact_parser_version text,
    add column raw_sha256 text;
alter table private.community_connections
    add column last_contract text, add column last_client_version text,
    add column last_parser_version text, add column last_seen_at timestamptz;
-- Keep immutable identity/hash/result metadata indefinitely; scrub only the 30-day payload.
alter table private.community_ingest_events alter column payload drop not null;
alter table private.community_ingest_events add column contract text not null default 'community-ingest-v1';
alter table private.community_ingest_events drop constraint community_ingest_events_trigger_check;
alter table private.community_ingest_events add constraint community_ingest_events_trigger_check
    check (trigger in ('realtime','manual','midnight','recovery','rebuild','reshare','raw_backfill'));
alter table private.community_ingest_events drop constraint community_ingest_events_result_check;
alter table private.community_ingest_events add constraint community_ingest_events_result_check
    check (result in ('pending','accepted','no_change','stale_ignored','quarantined','rejected','stored'));
-- M4: the payload purge walks only rows that still carry a payload, oldest first.
create index community_ingest_events_payload_due on private.community_ingest_events(received_at) where payload is not null;

create table private.community_report_raw (
    contributor_id uuid not null references private.contributor_profiles(user_id) on delete cascade,
    dataset_key text not null check (dataset_key ~ '^[0-9a-f]{64}$'),
    source_report_key text not null check (source_report_key ~ '^[0-9a-f]{64}$'),
    source_report_id text not null, report_number text,
    consent_grant_id uuid not null references private.community_consent_grants(grant_id) on delete cascade,
    latest_receipt_id uuid not null references private.community_ingest_events(receipt_id) on delete cascade,
    event_type text not null, captured_at timestamptz not null,
    raw_text text not null, raw_sha256 text not null check (raw_sha256 ~ '^[0-9a-f]{64}$'),
    raw_size integer not null check (raw_size=octet_length(raw_text) and raw_size between 1 and 1048576),
    fetched_at timestamptz not null, raw_source text not null,
    supplement jsonb not null, supplement_sha256 text not null,
    client_observation jsonb, client_observation_sha256 text, client_parser_version text not null,
    writer_epoch bigint not null, source_revision bigint not null, received_at timestamptz not null default now(),
    -- dead: permanent failure after the attempt limit; a new raw/supplement hash or a new parse key re-queues it.
    parse_state text not null default 'pending' check (parse_state in ('pending','parsed','failed','dead')),
    parsed_parser_version text, parse_error text,
    primary key(contributor_id,dataset_key,source_report_key)
);
-- M2: v1/v2 cross-dataset reservation lookups. M6: per-contributor tombstone purge. FK cascades from the ledger.
create index community_raw_report_number on private.community_report_raw(report_number) where report_number is not null;
create index community_raw_source_key on private.community_report_raw(source_report_key);
create index community_raw_contributor_key on private.community_report_raw(contributor_id,source_report_key);
create index community_raw_receipt on private.community_report_raw(latest_receipt_id);
create index community_raw_grant on private.community_report_raw(consent_grant_id);
create table private.community_report_parsed (
    contributor_id uuid not null, dataset_key text not null, source_report_key text not null,
    entry_value text,
    ssnpc_cd text,
    ssnpc_type text,
    car_number text,
    occurrence_date text,
    occurrence_time text,
    violation_location text,
    violation_latitude double precision,
    violation_longitude double precision,
    progress_status text,
    processing_status text,
    processing_finish text,
    processing_agency text,
    processing_agency_code text,
    person_in_charge text,
    response_date text,
    processing_content text,
    violation_law text,
    penalty_amount text,
    penalty_points text,
    report_content text,
    attachment_files text,
    attached_photos text,
    map_image text,
    raw_content text,
    raw_type text,
    report_number text,
    report_title text,
    report_date text,
    list_status text,
    survey_state text,
    rating integer,
    rating_cause text,
    photo_first_at text,
    photo_last_at text,
    photo_count integer,
    category text,
    supplement_count integer,
    supplement_is_open text,
    supplement_requester text,
    supplement_requested_at text,
    supplement_completed_at text,
    supplement_request_text text,
    supplement_reporter_opinion text,
    supplement_requester_phone text,
    parser_version text not null, parsed_at timestamptz not null default now(),
    primary key(contributor_id,dataset_key,source_report_key),
    foreign key(contributor_id,dataset_key,source_report_key) references private.community_report_raw on delete cascade
);
create table private.community_parse_diffs (
    contributor_id uuid not null, dataset_key text not null, source_report_key text not null,
    -- differences is NULL when the client sent no observation (nothing to compare), {} when they agree.
    parser_version text not null, client_parser_version text not null, differences jsonb,
    recorded_at timestamptz not null default now(),
    primary key(contributor_id,dataset_key,source_report_key,parser_version),
    foreign key(contributor_id,dataset_key,source_report_key) references private.community_report_raw on delete cascade
);
-- H1: a claim only sets a lease (next_attempt_at := leased_until) and commits; each job is then processed in its own
-- short transaction with the ingest/revoke lock order. `ingest` sorts before `reparse`, so the index matches the claim.
create table private.community_parse_queue (
    contributor_id uuid not null, dataset_key text not null, source_report_key text not null,
    priority text not null default 'ingest' check (priority in ('ingest','reparse')),
    attempts integer not null default 0, next_attempt_at timestamptz not null default now(),
    leased_until timestamptz, lease_token uuid,
    primary key(contributor_id,dataset_key,source_report_key),
    foreign key(contributor_id,dataset_key,source_report_key) references private.community_report_raw on delete cascade
);
create index community_parse_due on private.community_parse_queue(priority,next_attempt_at);
do $$ begin
    if not exists (select 1 from pg_roles where rolname='community_parser') then
        create role community_parser nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
    end if;
end $$;
-- Applies when operations give community_parser itself LOGIN; the worker also sets them per session.
alter role community_parser set lock_timeout = '5s';
alter role community_parser set statement_timeout = '30s';
alter role community_parser set idle_in_transaction_session_timeout = '60s';
grant usage on schema private to community_parser;
alter table private.community_report_raw enable row level security;
revoke all on private.community_report_raw from public, anon, authenticated, service_role, community_parser;
grant select on private.community_report_raw to community_parser;
create policy parser_read on private.community_report_raw for select to community_parser using (true);
alter table private.community_report_parsed enable row level security;
revoke all on private.community_report_parsed from public, anon, authenticated, service_role, community_parser;
alter table private.community_parse_diffs enable row level security;
revoke all on private.community_parse_diffs from public, anon, authenticated, service_role, community_parser;
alter table private.community_parse_queue enable row level security;
revoke all on private.community_parse_queue from public, anon, authenticated, service_role, community_parser;

create or replace function private.project_raw_fact(
    p_user uuid, p_dataset text, p_grant uuid, v_receipt uuid, e jsonb,
    p_source text, p_parser text, p_raw_sha text)
returns text language plpgsql security definer set search_path='' as $$
declare
    v_fact private.community_report_facts%rowtype;
    v_epoch bigint := (e->>'writer_epoch')::bigint;
    v_rev bigint := (e->>'source_revision')::bigint;
    v_key text := e->>'source_report_key';
    d jsonb := e->'derived';
    v_result text;
    v_keep_grant boolean;
    v_target_grant uuid;
begin
    if p_source not in ('dto','raw') then raise exception 'invalid_fact_source'; end if;
        select * into v_fact from private.community_report_facts
         where contributor_id = p_user and dataset_key = p_dataset and source_report_key = v_key for update;
        -- Same dataset retries retain the existing contribution/projection behavior.
        if v_fact.contributor_id is null then
            insert into private.community_report_facts(contributor_id, dataset_key, source_report_key, source_report_id,
                latest_receipt_id, consent_grant_id, writer_epoch, source_revision, payload_sha256, report_number, public_state,
                report_date, completed_date, category, status, disposition, amount_kind, amount_confirmed_won, penalty_points,
                vehicle_raw, lat, lng, lat_text, lng_text, coord_source, address, region_code, point_key, agency_key,
                agency_name, agency_current_name, manager_key, manager_name, violation_law, source_agency_code, rating, fine_estimate_won, fine_estimate_rule, fine_estimate_rule_version,
                answer_accepted_at, fact_source, fact_parser_version, raw_sha256)
            values (p_user, p_dataset, v_key, e->>'source_report_id', v_receipt, p_grant, v_epoch, v_rev,
                e->>'payload_sha256', e->>'report_number', d->>'public_state', (d->>'report_date')::date, (d->>'completed_date')::date,
                d->>'category', d->>'status', d->>'disposition', d->>'amount_kind', (d->>'amount_confirmed_won')::bigint,
                (d->>'penalty_points')::integer, d->>'vehicle_raw', (d->>'lat')::double precision,
                (d->>'lng')::double precision, d->>'lat_text', d->>'lng_text', d->>'coord_source', d->>'address',
                d->>'region_code', d->>'point_key', d->>'agency_key', d->>'agency_name', d->>'agency_current_name',
                d->>'manager_key', d->>'manager_name',
                d->>'violation_law', d->>'source_agency_code', (d->>'rating')::integer,
                (d->>'fine_estimate_won')::bigint, d->>'fine_estimate_rule', d->>'fine_estimate_rule_version',
                clock_timestamp(), p_source, p_parser, p_raw_sha);
            v_result := 'accepted';
        elsif (v_epoch, v_rev) > (v_fact.writer_epoch, v_fact.source_revision)
           or ((v_epoch, v_rev) = (v_fact.writer_epoch, v_fact.source_revision) and p_source = 'raw') then
            -- A fact accepted under a lineage the USER revoked stays under that (hidden) grant unless this event is an
            -- explicit reshare; policy-version supersession keeps the lineage active, so it re-attributes normally.
            v_keep_grant := v_fact.consent_grant_id <> p_grant and e->>'event_type' <> 'reshare'
                            and not private.community_lineage_active(v_fact.consent_grant_id);
            v_target_grant := case when v_keep_grant then v_fact.consent_grant_id else p_grant end;
            if v_fact.payload_sha256 = e->>'payload_sha256' and v_fact.consent_grant_id = v_target_grant
               and not (p_source = 'raw' and v_fact.fact_source = 'raw' and v_fact.fact_parser_version is distinct from p_parser) then
                update private.community_report_facts set writer_epoch = v_epoch, source_revision = v_rev,
                    latest_receipt_id = v_receipt, report_number = coalesce(e->>'report_number', v_fact.report_number), updated_at = now(),
                    fact_source = p_source, fact_parser_version = p_parser, raw_sha256 = p_raw_sha
                 where contributor_id = p_user and dataset_key = p_dataset and source_report_key = v_key;
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
                                                or (p_source = 'raw' and v_fact.raw_sha256 is not distinct from p_raw_sha
                                                    and (v_fact.writer_epoch, v_fact.source_revision) = (v_epoch, v_rev))
                                              then v_fact.answer_accepted_at else clock_timestamp() end,
                    updated_at = now(),
                    fact_source = p_source, fact_parser_version = p_parser, raw_sha256 = p_raw_sha
                 where contributor_id = p_user and dataset_key = p_dataset and source_report_key = v_key;
                v_result := 'accepted';
            end if;
        else
            v_result := 'stale_ignored';
        end if;
        return v_result;
end;
$$;

create or replace function private.screen_user_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare keys text[]; owners uuid[];
begin
 if tg_op='INSERT' then
  select array_agg(distinct source_report_key),array_agg(distinct contributor_id) into keys,owners from new_screen_rows;
 elsif tg_op='DELETE' then
  select array_agg(distinct source_report_key),array_agg(distinct contributor_id) into keys,owners from old_screen_rows;
 else
  -- Transport-only resend updates do not change the personal result.
  with before_rows as (select to_jsonb(o)-array['updated_at','latest_receipt_id','source_revision','writer_epoch','fact_source','fact_parser_version','raw_sha256'] as v from old_screen_rows o),
       after_rows as (select to_jsonb(n)-array['updated_at','latest_receipt_id','source_revision','writer_epoch','fact_source','fact_parser_version','raw_sha256'] as v from new_screen_rows n),
       changed as ((select v from before_rows except select v from after_rows)
                   union (select v from after_rows except select v from before_rows))
  select array_agg(distinct v->>'source_report_key'),array_agg(distinct (v->>'contributor_id')::uuid) into keys,owners from changed;
 end if;
 insert into private.screen_user_revision(user_id,revision)
 select u.id,1 from auth.users u where u.id=any(owners) or u.id in
 (select f.contributor_id from private.community_report_facts f where f.source_report_key=any(keys)) order by u.id
 on conflict(user_id) do update set revision=private.screen_user_revision.revision+1;
 return null;
end $$;

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
    update private.community_connections set last_contract='community-ingest-v1',
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
            select contract, receipt_id, payload_sha256, result, rejection_reason, dataset_key, source_report_key, source_report_id, source_revision,
                   writer_epoch, event_type, captured_at, report_number
              into v_existing from private.community_ingest_events where contributor_id = p_user and event_id = v_event_id;
            if v_existing.contract = 'community-ingest-v1' and v_existing.payload_sha256 = e->>'payload_sha256' and v_existing.dataset_key = v_conn.dataset_key
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
        if exists (select 1 from private.community_report_raw r where r.dataset_key<>v_conn.dataset_key
            and (r.source_report_key=v_key or (e->>'report_number' is not null and r.report_number=e->>'report_number'))) then
            update private.community_ingest_events set result='rejected', rejection_reason='report_owned_elsewhere' where receipt_id=v_receipt;
            insert into private.community_report_ownership_audit(receipt_id,request_id,user_id,dataset_key,source_report_key,report_number)
            values (v_receipt,p_request_id,p_user,v_conn.dataset_key,v_key,e->>'report_number');
            v_results := v_results || jsonb_build_object('event_id',v_event_id,'status','rejected','durable',false,
                'receipt_id',null,'projection_status','not_applicable','error',jsonb_build_object('code','report_owned_elsewhere','retryable',false));
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
         where contributor_id=p_user and dataset_key=v_conn.dataset_key and source_report_key=v_key for update;
        v_was_visible := v_fact.contributor_id is not null and private.community_fact_publicly_listed(v_fact);
        v_result := private.project_raw_fact(p_user, v_conn.dataset_key, v_grant.grant_id, v_receipt, e,
            'dto', p_envelope->>'parser_version', null);
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

-- One authoritative flag/notice shared by both Edge functions; disabled until operations explicitly enable it.
-- client_notice shape = contracts/community-ingest-v2/client-notice.schema.json (message <= 1000 chars, same as the schema).
create function private.community_client_notice_valid(n jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare k text;
begin
    if n is null then return true; end if;
    if jsonb_typeof(n) <> 'object' then return false; end if;
    if (select array_agg(x order by x) from jsonb_object_keys(n) x) is distinct from array['deadline','level','message','min_version','url'] then return false; end if;
    if jsonb_typeof(n->'level') <> 'string' or n->>'level' not in ('info','warning','required') then return false; end if;
    if jsonb_typeof(n->'message') <> 'string' or char_length(n->>'message') not between 1 and 1000 then return false; end if;
    if jsonb_typeof(n->'min_version') <> 'object' or jsonb_typeof(n->'url') <> 'object' then return false; end if;
    if (select array_agg(x order by x) from jsonb_object_keys(n->'min_version') x) is distinct from array['mobile','pc']
       or (select array_agg(x order by x) from jsonb_object_keys(n->'url') x) is distinct from array['mobile','pc'] then return false; end if;
    foreach k in array array['pc','mobile'] loop
        if jsonb_typeof(n->'min_version'->k) not in ('null','string')
           or (jsonb_typeof(n->'min_version'->k) = 'string' and char_length(n->'min_version'->>k) not between 1 and 40) then return false; end if;
        if jsonb_typeof(n->'url'->k) not in ('null','string')
           or (jsonb_typeof(n->'url'->k) = 'string' and (n->'url'->>k) !~ '^https://[^[:space:]]+$') then return false; end if;
    end loop;
    if jsonb_typeof(n->'deadline') not in ('null','string')
       or (jsonb_typeof(n->'deadline') = 'string'
           and (n->>'deadline') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$') then return false; end if;
    return true;
end $$;
revoke all on function private.community_client_notice_valid(jsonb) from public,anon,authenticated,service_role;
create table private.community_ingest_config (
    singleton boolean primary key default true check(singleton),
    v2_enabled boolean not null default false,
    raw_policy_version text not null default '2026-10-21.1' check (raw_policy_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}\.[0-9]{1,9}$'),
    v1_sunset timestamptz,
    -- NULL until operations publish a notice; a default object would reach every client the moment this applies.
    client_notice jsonb default null constraint community_ingest_config_notice_shape check (private.community_client_notice_valid(client_notice))
);
insert into private.community_ingest_config(singleton) values(true);
alter table private.community_ingest_config enable row level security;
revoke all on private.community_ingest_config from public,anon,authenticated,service_role;
-- L1: a missing config row reads as v1-only with no notice.
create function public.internal_community_ingest_capabilities() returns jsonb
language sql stable security definer set search_path='' as $$
    select coalesce((select jsonb_build_object('contracts',case when coalesce(v2_enabled,false) then '[1,2]'::jsonb else '[1]'::jsonb end,
        'raw_policy_version',raw_policy_version,'v1_sunset',v1_sunset,'client_notice',client_notice)
        from private.community_ingest_config where singleton),
        jsonb_build_object('contracts','[1]'::jsonb,'raw_policy_version',null,'v1_sunset',null,'client_notice',null))
$$;
revoke all on function public.internal_community_ingest_capabilities() from public,anon,authenticated;
grant execute on function public.internal_community_ingest_capabilities() to service_role;

-- M1: policy versions are `YYYY-MM-DD.N`. Compare (date, N) numerically; anything else never qualifies.
create function private.community_policy_version_at_least(p_version text, p_min text) returns boolean
language plpgsql immutable set search_path='' as $$
declare a text[]; b text[];
begin
    a := regexp_match(p_version, '^([0-9]{4})-([0-9]{2})-([0-9]{2})\.([0-9]{1,9})$');
    b := regexp_match(p_min, '^([0-9]{4})-([0-9]{2})-([0-9]{2})\.([0-9]{1,9})$');
    if a is null or b is null then return false; end if;
    return (a[1]::int, a[2]::int, a[3]::int, a[4]::bigint) >= (b[1]::int, b[2]::int, b[3]::int, b[4]::bigint);
end $$;
revoke all on function private.community_policy_version_at_least(text,text) from public,anon,authenticated,service_role;

-- H1 lock order, identical to ingest (v1/v2) and auth revoke/deletion:
--   contributor profile (ingest/worker FOR SHARE, revoke/delete FOR UPDATE) -> consent grant -> report advisory locks
--   (sorted `key:`/`number:`, seed 913784, same as ingest) -> raw row -> fact row (+ fact triggers) -> parsed/diffs -> queue row.
-- The claim and release only touch queue rows, one statement each, and never wait (SKIP LOCKED / single row).
create function private.community_lock_report(p_key text, p_number text) returns void
language plpgsql volatile security definer set search_path='' as $$
declare k text;
begin
    for k in select x from unnest(array['key:' || p_key,
                 case when nullif(p_number, '') is not null then 'number:' || p_number end]) x
              where x is not null order by x loop
        perform pg_advisory_xact_lock(hashtextextended(k, 913784));
    end loop;
end $$;
revoke all on function private.community_lock_report(text,text) from public,anon,authenticated,service_role;

create function private.claim_raw_parse_jobs(p_limit integer, p_lease_seconds integer default 300)
returns table(contributor_id uuid, dataset_key text, source_report_key text, lease_token uuid, attempts integer)
language plpgsql volatile security definer set search_path='' as $$
#variable_conflict use_column
begin
    if p_limit is null or p_limit not between 1 and 200 or p_lease_seconds is null or p_lease_seconds not between 30 and 3600 then
        raise exception 'invalid_claim';
    end if;
    -- next_attempt_at := leased_until, so the (priority, next_attempt_at) index alone selects due, unleased rows.
    return query
    with due as (
        select q.contributor_id, q.dataset_key, q.source_report_key from private.community_parse_queue q
         where q.next_attempt_at <= now()
         order by q.priority, q.next_attempt_at
         limit p_limit
         for update skip locked)
    update private.community_parse_queue q
       set lease_token = gen_random_uuid(), leased_until = now() + make_interval(secs => p_lease_seconds),
           next_attempt_at = now() + make_interval(secs => p_lease_seconds), attempts = q.attempts + 1
      from due
     where (q.contributor_id, q.dataset_key, q.source_report_key) = (due.contributor_id, due.dataset_key, due.source_report_key)
    returning q.contributor_id, q.dataset_key, q.source_report_key, q.lease_token, q.attempts;
end $$;
revoke all on function private.claim_raw_parse_jobs(integer,integer) from public,anon,authenticated,service_role;
grant execute on function private.claim_raw_parse_jobs(integer,integer) to community_parser;

-- Graceful shutdown: hand an unstarted job back without spending an attempt.
create function private.release_raw_parse_job(p_user uuid, p_dataset text, p_key text, p_lease uuid) returns boolean
language sql volatile security definer set search_path='' as $$
    with r as (
        update private.community_parse_queue set attempts = greatest(attempts - 1, 0), leased_until = null, lease_token = null, next_attempt_at = now()
         where contributor_id = p_user and dataset_key = p_dataset and source_report_key = p_key and lease_token = p_lease
        returning 1)
    select exists(select 1 from r)
$$;
revoke all on function private.release_raw_parse_job(uuid,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function private.release_raw_parse_job(uuid,text,text,uuid) to community_parser;

-- One job, one short transaction. Projects only under the lineage`s ACTIVE grant (M5) and only the leased, unchanged bytes.
-- Returns accepted/no_change/stale_ignored (projected), superseded, revoked, lease_lost or gone.
create function private.finish_raw_parse(p_user uuid, p_dataset text, p_key text, p_lease uuid, p_sha text, p_supp_sha text,
    p_parser text, p_payload jsonb, p_payload_sha text, p_derived jsonb, p_parsed jsonb, p_diff jsonb) returns text
language plpgsql volatile security definer set search_path='' as $$
declare
    r private.community_report_raw%rowtype;
    g private.community_consent_grants%rowtype;
    v_grant uuid; v_number text; v_lease uuid; v_result text;
begin
    if p_lease is null or p_sha is null or p_parser is null then raise exception 'invalid_finish'; end if;
    perform 1 from private.contributor_profiles where user_id = p_user for share;
    if not found then return 'gone'; end if;
    select consent_grant_id, report_number into v_grant, v_number from private.community_report_raw
     where contributor_id = p_user and dataset_key = p_dataset and source_report_key = p_key;
    if v_grant is null then return 'gone'; end if;
    select a.* into g from private.community_consent_grants o
      join private.community_consent_grants a on a.user_id = o.user_id and a.lineage_id = o.lineage_id and a.revoked_at is null
     where o.grant_id = v_grant and o.user_id = p_user
     for share of a;
    perform private.community_lock_report(p_key, v_number);
    select * into r from private.community_report_raw
     where contributor_id = p_user and dataset_key = p_dataset and source_report_key = p_key for update;
    if r.contributor_id is null then return 'gone'; end if;
    select q.lease_token into v_lease from private.community_parse_queue q
     where q.contributor_id = p_user and q.dataset_key = p_dataset and q.source_report_key = p_key for update;
    if g.grant_id is null then
        -- Lineage closed: never project. A user withdrawal already purged the raw row via community_revoke_raw.
        delete from private.community_parse_queue
         where contributor_id = p_user and dataset_key = p_dataset and source_report_key = p_key and lease_token = p_lease;
        return 'revoked';
    end if;
    if r.raw_sha256 is distinct from p_sha or r.supplement_sha256 is distinct from p_supp_sha then
        -- A new body re-queued the row (lease reset), so this only removes our own stale lease if it somehow survived.
        delete from private.community_parse_queue
         where contributor_id = p_user and dataset_key = p_dataset and source_report_key = p_key and lease_token = p_lease;
        return 'superseded';
    end if;
    if v_lease is distinct from p_lease then return 'lease_lost'; end if;
    -- The derived agency keys were computed with the worker`s registry snapshot. If the authoritative singleton is another
    -- version (worker image and registry migration out of step), projecting would stamp mismatching keys. 55P03 is
    -- lock_not_available: the worker treats it as transient and releases the job without spending an attempt.
    if p_derived->>'agency_registry_version' is distinct from (select s.version from private.community_registry_state s where s.id = 1) then
        raise exception 'registry_version_mismatch' using errcode = '55P03';
    end if;
    if coalesce(p_payload->>'status', '') not in ('accepted','partial','rejected','completed_unknown') then
        raise exception 'non_final_not_accepted';
    end if;
    v_result := private.project_raw_fact(p_user, p_dataset, g.grant_id, r.latest_receipt_id,
        jsonb_build_object('source_report_key', p_key, 'source_report_id', r.source_report_id, 'report_number', r.report_number,
            'source_revision', r.source_revision, 'writer_epoch', r.writer_epoch, 'event_type', r.event_type,
            'payload', p_payload, 'payload_sha256', p_payload_sha, 'derived', p_derived),
        'raw', p_parser, p_sha);
    insert into private.community_report_parsed(contributor_id,dataset_key,source_report_key,entry_value,ssnpc_cd,ssnpc_type,car_number,occurrence_date,occurrence_time,violation_location,violation_latitude,violation_longitude,progress_status,processing_status,processing_finish,processing_agency,processing_agency_code,person_in_charge,response_date,processing_content,violation_law,penalty_amount,penalty_points,report_content,attachment_files,attached_photos,map_image,raw_content,raw_type,report_number,report_title,report_date,list_status,survey_state,rating,rating_cause,photo_first_at,photo_last_at,photo_count,category,supplement_count,supplement_is_open,supplement_requester,supplement_requested_at,supplement_completed_at,supplement_request_text,supplement_reporter_opinion,supplement_requester_phone,parser_version)
    select p_user,p_dataset,p_key,x.entry_value,x.ssnpc_cd,x.ssnpc_type,x.car_number,x.occurrence_date,x.occurrence_time,x.violation_location,x.violation_latitude,x.violation_longitude,x.progress_status,x.processing_status,x.processing_finish,x.processing_agency,x.processing_agency_code,x.person_in_charge,x.response_date,x.processing_content,x.violation_law,x.penalty_amount,x.penalty_points,x.report_content,x.attachment_files,x.attached_photos,x.map_image,x.raw_content,x.raw_type,x.report_number,x.report_title,x.report_date,x.list_status,x.survey_state,x.rating,x.rating_cause,x.photo_first_at,x.photo_last_at,x.photo_count,x.category,x.supplement_count,x.supplement_is_open,x.supplement_requester,x.supplement_requested_at,x.supplement_completed_at,x.supplement_request_text,x.supplement_reporter_opinion,x.supplement_requester_phone,p_parser
      from jsonb_populate_record(null::private.community_report_parsed, coalesce(p_parsed,'{}'::jsonb)) x
    on conflict(contributor_id,dataset_key,source_report_key) do update set
        entry_value=excluded.entry_value,ssnpc_cd=excluded.ssnpc_cd,ssnpc_type=excluded.ssnpc_type,car_number=excluded.car_number,occurrence_date=excluded.occurrence_date,occurrence_time=excluded.occurrence_time,violation_location=excluded.violation_location,violation_latitude=excluded.violation_latitude,violation_longitude=excluded.violation_longitude,progress_status=excluded.progress_status,processing_status=excluded.processing_status,processing_finish=excluded.processing_finish,processing_agency=excluded.processing_agency,processing_agency_code=excluded.processing_agency_code,person_in_charge=excluded.person_in_charge,response_date=excluded.response_date,processing_content=excluded.processing_content,violation_law=excluded.violation_law,penalty_amount=excluded.penalty_amount,penalty_points=excluded.penalty_points,report_content=excluded.report_content,attachment_files=excluded.attachment_files,attached_photos=excluded.attached_photos,map_image=excluded.map_image,raw_content=excluded.raw_content,raw_type=excluded.raw_type,report_number=excluded.report_number,report_title=excluded.report_title,report_date=excluded.report_date,list_status=excluded.list_status,survey_state=excluded.survey_state,rating=excluded.rating,rating_cause=excluded.rating_cause,photo_first_at=excluded.photo_first_at,photo_last_at=excluded.photo_last_at,photo_count=excluded.photo_count,category=excluded.category,supplement_count=excluded.supplement_count,supplement_is_open=excluded.supplement_is_open,supplement_requester=excluded.supplement_requester,supplement_requested_at=excluded.supplement_requested_at,supplement_completed_at=excluded.supplement_completed_at,supplement_request_text=excluded.supplement_request_text,supplement_reporter_opinion=excluded.supplement_reporter_opinion,supplement_requester_phone=excluded.supplement_requester_phone,parser_version=excluded.parser_version,parsed_at=now();
    insert into private.community_parse_diffs(contributor_id, dataset_key, source_report_key, parser_version, client_parser_version, differences)
    values (p_user, p_dataset, p_key, p_parser, r.client_parser_version,
            case when r.client_observation is null then null else coalesce(p_diff, '{}'::jsonb) end)
    on conflict (contributor_id, dataset_key, source_report_key, parser_version) do update set
        differences = excluded.differences, client_parser_version = excluded.client_parser_version, recorded_at = now();
    update private.community_report_raw set parse_state = 'parsed', parsed_parser_version = p_parser, parse_error = null
     where contributor_id = p_user and dataset_key = p_dataset and source_report_key = p_key;
    delete from private.community_parse_queue
     where contributor_id = p_user and dataset_key = p_dataset and source_report_key = p_key and lease_token = p_lease;
    return v_result;
end $$;
-- Hash of DTO must use the same canonical bytes as v1, supplied explicitly by the verified worker.
-- The worker functions are private and executable only by its restricted DB role.
revoke all on function private.project_raw_fact(uuid,text,uuid,uuid,jsonb,text,text,text) from public,anon,authenticated,service_role;
revoke all on function private.finish_raw_parse(uuid,text,text,uuid,text,text,text,jsonb,text,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.finish_raw_parse(uuid,text,text,uuid,text,text,text,jsonb,text,jsonb,jsonb,jsonb) to community_parser;

-- Failure in its own transaction. After 8 attempts the row is `dead` and leaves the queue (L5); a new body/parse key revives it.
create function private.fail_raw_parse(p_user uuid, p_dataset text, p_key text, p_lease uuid, p_sha text, p_parser text, p_error text)
returns text language plpgsql volatile security definer set search_path='' as $$
declare r private.community_report_raw%rowtype; q private.community_parse_queue%rowtype; v_number text;
begin
    perform 1 from private.contributor_profiles where user_id = p_user for share;
    if not found then return 'gone'; end if;
    select report_number into v_number from private.community_report_raw
     where contributor_id = p_user and dataset_key = p_dataset and source_report_key = p_key;
    if not found then return 'gone'; end if;
    perform private.community_lock_report(p_key, v_number);
    select * into r from private.community_report_raw
     where contributor_id = p_user and dataset_key = p_dataset and source_report_key = p_key for update;
    if r.contributor_id is null then return 'gone'; end if;
    select * into q from private.community_parse_queue
     where contributor_id = p_user and dataset_key = p_dataset and source_report_key = p_key for update;
    if q.contributor_id is null or q.lease_token is distinct from p_lease then return 'lease_lost'; end if;
    if r.raw_sha256 is distinct from p_sha then
        update private.community_parse_queue set leased_until = null, lease_token = null, next_attempt_at = now()
         where contributor_id = p_user and dataset_key = p_dataset and source_report_key = p_key;
        return 'superseded';
    end if;
    if q.attempts >= 8 then
        update private.community_report_raw set parse_state = 'dead', parse_error = left(coalesce(p_error, 'unknown'), 80),
               parsed_parser_version = p_parser
         where contributor_id = p_user and dataset_key = p_dataset and source_report_key = p_key;
        delete from private.community_parse_queue
         where contributor_id = p_user and dataset_key = p_dataset and source_report_key = p_key;
        return 'dead';
    end if;
    update private.community_report_raw set parse_state = 'failed', parse_error = left(coalesce(p_error, 'unknown'), 80)
     where contributor_id = p_user and dataset_key = p_dataset and source_report_key = p_key;
    update private.community_parse_queue set leased_until = null, lease_token = null,
           next_attempt_at = now() + least(interval '1 hour', interval '30 seconds' * power(2, least(q.attempts, 7)))
     where contributor_id = p_user and dataset_key = p_dataset and source_report_key = p_key;
    return 'retry';
end $$;
revoke all on function private.fail_raw_parse(uuid,text,text,uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function private.fail_raw_parse(uuid,text,text,uuid,text,text,text) to community_parser;

-- Parse-key change (parser/worker/registry version): enqueue a bounded batch. Rows whose report lock is held by an
-- ingest or a finishing job are skipped (try-lock, never waits) and picked up by the next call.
create function private.enqueue_raw_reparse(p_parser text, p_limit integer default 200) returns integer
language plpgsql volatile security definer set search_path='' as $$
declare n integer;
begin
    if p_parser is null or p_limit is null or p_limit not between 1 and 500 then raise exception 'invalid_reparse'; end if;
    with candidates as materialized (
        select r.contributor_id, r.dataset_key, r.source_report_key from private.community_report_raw r
         where r.parsed_parser_version is distinct from p_parser and r.parse_state in ('parsed','failed','dead')
           and not exists (select 1 from private.community_parse_queue q
                            where q.contributor_id = r.contributor_id and q.dataset_key = r.dataset_key and q.source_report_key = r.source_report_key)
         limit p_limit
         -- Never wait on a row that a revoke/withdrawal purge or an ingest is changing: KEY SHARE conflicts only with
         -- DELETE / key updates, and SKIP LOCKED turns that conflict into "pick it up on the next call".
         for key share of r skip locked)
    insert into private.community_parse_queue(contributor_id, dataset_key, source_report_key, priority)
    select c.contributor_id, c.dataset_key, c.source_report_key, 'reparse' from candidates c
     where pg_try_advisory_xact_lock(hashtextextended('key:' || c.source_report_key, 913784))
    on conflict do nothing;
    get diagnostics n = row_count;
    return n;
end $$;
revoke all on function private.enqueue_raw_reparse(text,integer) from public,anon,authenticated,service_role;
grant execute on function private.enqueue_raw_reparse(text,integer) to community_parser;

-- Operations: move `dead` rows back to the queue after the cause is fixed (worker bug, registry/parse-key deployment).
-- Owner only (psql as the migration owner); NOT executable by the worker role or any API role.
-- p_since limits to rows RECEIVED at or after that time, p_error to one parse_error (exception class name).
-- Rows locked by a concurrent ingest/revoke are skipped, so run it again if the count looks short.
create function private.requeue_dead_raw(p_since timestamptz default null, p_error text default null) returns integer
language plpgsql volatile security definer set search_path='' as $$
declare n integer;
begin
    with dead as (
        select r.contributor_id, r.dataset_key, r.source_report_key from private.community_report_raw r
         where r.parse_state = 'dead' and (p_since is null or r.received_at >= p_since) and (p_error is null or r.parse_error = p_error)
         for no key update of r skip locked),
    upd as (
        update private.community_report_raw r set parse_state = 'pending', parse_error = null
          from dead d
         where (r.contributor_id, r.dataset_key, r.source_report_key) = (d.contributor_id, d.dataset_key, d.source_report_key)
        returning r.contributor_id, r.dataset_key, r.source_report_key)
    insert into private.community_parse_queue(contributor_id, dataset_key, source_report_key, priority)
    select u.contributor_id, u.dataset_key, u.source_report_key, 'reparse' from upd u
    on conflict do nothing;
    get diagnostics n = row_count;
    return n;
end $$;
revoke all on function private.requeue_dead_raw(timestamptz,text) from public,anon,authenticated,service_role,community_parser;

create function private.purge_revoked_raw() returns trigger language plpgsql security definer set search_path='' as $$
begin
    if new.revoked_at is not null and new.revoke_reason is distinct from 'superseded_policy' then
        delete from private.community_report_raw r where r.contributor_id=new.user_id
          and exists(select 1 from private.community_consent_grants g where g.grant_id=r.consent_grant_id and g.lineage_id=new.lineage_id);
    end if;
    return new;
end $$;
revoke all on function private.purge_revoked_raw() from public,anon,authenticated,service_role;
create trigger community_revoke_raw after update of revoked_at on private.community_consent_grants
    for each row execute function private.purge_revoked_raw();

create function private.purge_deleted_raw() returns trigger language plpgsql security definer set search_path='' as $$
begin
    delete from private.community_report_raw r where r.contributor_id=new.contributor_id
       and (not(to_jsonb(new) ? 'dataset_key') or r.dataset_key=to_jsonb(new)->>'dataset_key');
    return new;
end $$;
revoke all on function private.purge_deleted_raw() from public,anon,authenticated,service_role;
create trigger raw_user_fence after insert or update on private.community_deletion_fences for each row execute function private.purge_deleted_raw();
create trigger raw_dataset_fence after insert or update on private.community_dataset_deletion_fences for each row execute function private.purge_deleted_raw();
-- M6: tombstones arrive in bulk (one row per deleted report); purge once per statement with an indexed join.
create function private.purge_tombstoned_raw() returns trigger language plpgsql security definer set search_path='' as $$
begin
    delete from private.community_report_raw r
     using (select distinct contributor_id, source_report_key from raw_tombstones) t
     where r.contributor_id = t.contributor_id and r.source_report_key = t.source_report_key;
    return null;
end $$;
create function private.purge_dataset_tombstoned_raw() returns trigger language plpgsql security definer set search_path='' as $$
begin
    delete from private.community_report_raw r
     using (select distinct contributor_id, dataset_key, source_report_key from raw_tombstones) t
     where r.contributor_id = t.contributor_id and r.dataset_key = t.dataset_key and r.source_report_key = t.source_report_key;
    return null;
end $$;
revoke all on function private.purge_tombstoned_raw(), private.purge_dataset_tombstoned_raw() from public,anon,authenticated,service_role;
create trigger raw_user_tombstone_insert after insert on private.community_fact_tombstones
    referencing new table as raw_tombstones for each statement execute function private.purge_tombstoned_raw();
create trigger raw_user_tombstone_update after update on private.community_fact_tombstones
    referencing new table as raw_tombstones for each statement execute function private.purge_tombstoned_raw();
create trigger raw_dataset_tombstone_insert after insert on private.community_dataset_fact_tombstones
    referencing new table as raw_tombstones for each statement execute function private.purge_dataset_tombstoned_raw();
create trigger raw_dataset_tombstone_update after update on private.community_dataset_fact_tombstones
    referencing new table as raw_tombstones for each statement execute function private.purge_dataset_tombstoned_raw();

-- M4: payload retention is 30 days, run by pg_cron (not the worker). Bounded batches within a time budget; small immutable
-- dedupe receipts survive so v1 retries remain idempotent. SKIP LOCKED never blocks ingest.
create function private.prune_community_ingest_payloads(p_batch integer default 5000, p_budget interval default interval '45 seconds')
returns bigint language plpgsql volatile security definer set search_path='' as $$
declare n bigint := 0; k bigint; started timestamptz := clock_timestamp();
begin
    if p_batch is null or p_batch not between 1 and 50000 then raise exception 'invalid_batch'; end if;
    loop
        update private.community_ingest_events e set payload = null
         where e.receipt_id in (select x.receipt_id from private.community_ingest_events x
                                 where x.payload is not null and x.received_at < now() - interval '30 days'
                                 order by x.received_at limit p_batch for update skip locked);
        get diagnostics k = row_count;
        n := n + k;
        exit when k < p_batch or clock_timestamp() - started > p_budget;
    end loop;
    return n;
end $$;
revoke all on function private.prune_community_ingest_payloads(integer,interval) from public,anon,authenticated,service_role;
-- Daily 03:17 KST (pg_cron runs in UTC). Scheduled only where pg_cron already exists (202610121301); never installed here.
do $$ begin
    if exists (select 1 from pg_extension where extname = 'pg_cron') then
        perform cron.schedule('community-ingest-payload-prune', '17 18 * * *',
            $cron$set statement_timeout='60s'; select private.prune_community_ingest_payloads(5000, interval '45 seconds');$cron$);
    end if;
end $$;

create function public.internal_account_ingest_state(p_user uuid) returns jsonb
language sql stable security definer set search_path='' as $$
    select coalesce((select jsonb_build_object('last_contract',last_contract,'last_client_version',last_client_version,'last_parser_version',last_parser_version,'last_seen_at',last_seen_at)
        from private.community_connections where user_id=p_user and last_seen_at is not null order by last_seen_at desc,connection_id limit 1),case when exists(select 1 from private.community_report_facts where contributor_id=p_user and fact_source='dto') then '{"last_contract":"community-ingest-v1"}'::jsonb else '{}'::jsonb end)
$$;
revoke all on function public.internal_account_ingest_state(uuid) from public,anon,authenticated;
grant execute on function public.internal_account_ingest_state(uuid) to service_role;

-- Map web: the signed-in user`s own update/consent state. No identifiers (dataset, grant, connection) leave this function.
create function public.internal_map_client_state(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_policy private.community_policies%rowtype; v_consent text; v_enabled boolean; v_notice jsonb;
begin
    if p_user is null then raise exception 'invalid_user'; end if;
    select p.* into v_policy from private.community_policies p
      join private.community_policy_current c on c.version = p.version where c.singleton;
    v_consent := case
        when exists (select 1 from private.community_consent_grants g where g.user_id = p_user and g.revoked_at is null
                       and private.community_grant_is_current(g, v_policy)) then 'active'
        when exists (select 1 from private.community_consent_grants g where g.user_id = p_user and g.revoked_at is null) then 'outdated'
        when exists (select 1 from private.community_consent_grants g where g.user_id = p_user) then 'revoked'
        else 'none' end;
    select coalesce(c.v2_enabled, false), c.client_notice into v_enabled, v_notice
      from private.community_ingest_config c where c.singleton;
    return jsonb_build_object(
        'consent', v_consent,
        'last_contract', (select c.last_contract from private.community_connections c
                           where c.user_id = p_user and c.status = 'active' and c.last_seen_at is not null
                           order by c.last_seen_at desc, c.connection_id limit 1),
        -- Decided by the MOST RECENT active connection: an old v1 connection left behind after the user moved to the new app
        -- must not keep the update banner alive. 0 when the newest connection already speaks v2.
        'v1_connections', (select count(*)::int from private.community_connections c
                            where c.user_id = p_user and c.status = 'active' and c.last_contract = 'community-ingest-v1'
                              and (select l.last_contract from private.community_connections l
                                    where l.user_id = p_user and l.status = 'active' and l.last_seen_at is not null
                                    order by l.last_seen_at desc, l.connection_id limit 1) = 'community-ingest-v1'),
        'v2_enabled', coalesce(v_enabled, false),
        'notice', v_notice);
end $$;
revoke all on function public.internal_map_client_state(uuid) from public,anon,authenticated;
grant execute on function public.internal_map_client_state(uuid) to service_role;

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

commit;
