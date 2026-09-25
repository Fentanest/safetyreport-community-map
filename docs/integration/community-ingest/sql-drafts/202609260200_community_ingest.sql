-- Per-report community ingest: durable events, latest fact per (contributor, dataset, report),
-- deletion tombstones, owner manifest and the public projection source.
-- Owner: safetyreport-community-map. service_role only; called by the `community-ingest` Edge Function (and by
-- the auth repository's `community-account` function for deletion) after the user JWT was verified.
-- Depends on map 202608150001 + 202609240001 and auth 202609260100 (policies, grants, connections, identity state).
-- Lock order: policy_current -> contributor_profiles -> consent_grants -> connections -> tombstones/facts -> analytics_state.

begin;

-- Legacy guard (S-10): no client ever wrote v2 snapshot facts (code search 2026-09-26). If PUBLIC legacy facts
-- (v2 facts of an active snapshot) exist, the source switch below would hide them: stop and let the operator
-- decide (scripts/integration/preflight_counts.sql + decision table in deployment-and-rollback.md). Non-public
-- staged/expired snapshot rows do not block (nothing public is lost).
do $$
begin
    if exists (select 1 from private.report_facts_v2 f
                 join private.upload_snapshots s on s.id = f.snapshot_id and s.state = 'active' limit 1) then
        raise exception 'LEGACY_SNAPSHOT_DATA_PRESENT: public v2 snapshot facts exist; run scripts/integration/preflight_counts.sql and decide the transition before applying';
    end if;
end $$;

create table private.community_ingest_events (
    receipt_id uuid primary key default gen_random_uuid(),
    contributor_id uuid not null references auth.users(id) on delete cascade,
    event_id uuid not null,
    request_id text not null check (char_length(request_id) between 8 and 80),
    connection_id uuid not null,
    consent_grant_id uuid not null,
    dataset_key text not null check (dataset_key ~ '^[0-9a-f]{64}$'),
    writer_epoch bigint not null,
    source_system text not null check (source_system = 'safetyreport'),
    source_report_key text not null check (source_report_key ~ '^[0-9a-f]{64}$'),
    source_report_id text not null check (source_report_id ~ '^[0-9A-Za-z_-]{1,40}$'),
    source_revision bigint not null check (source_revision > 0),
    event_type text not null check (event_type in ('completed_observation', 'status_correction', 'location_supplement', 'reshare')),
    trigger text not null check (trigger in ('realtime', 'manual', 'midnight', 'recovery', 'rebuild', 'reshare')),
    payload jsonb not null check (jsonb_typeof(payload) = 'object'),
    payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
    captured_at timestamptz not null,
    received_at timestamptz not null default now(),
    result text not null default 'pending' check (result in ('pending', 'accepted', 'no_change', 'stale_ignored', 'quarantined')),
    quarantine_reason text,
    unique (contributor_id, event_id)
);
create index community_ingest_events_report_idx on private.community_ingest_events(contributor_id, dataset_key, source_report_key);
create index community_ingest_events_received_idx on private.community_ingest_events(received_at);

create table private.community_report_facts (
    contributor_id uuid not null references auth.users(id) on delete cascade,
    dataset_key text not null check (dataset_key ~ '^[0-9a-f]{64}$'),
    source_report_key text not null check (source_report_key ~ '^[0-9a-f]{64}$'),
    source_report_id text not null,
    latest_receipt_id uuid not null,
    consent_grant_id uuid not null,
    writer_epoch bigint not null,
    source_revision bigint not null,
    payload_sha256 text not null,
    public_state text not null check (public_state in ('completed', 'not_completed')),
    report_date date,
    completed_date date,
    category text not null check (category in ('traffic', 'parking', 'other')),
    status text not null check (status in ('accepted','partial','rejected','processing','supplement','withdrawn','transferred','completed_unknown','other')),
    disposition text not null check (disposition in ('fine','warning','penalty','none','unknown')),
    amount_kind text not null check (amount_kind in ('fine','penalty','combined','unknown')),
    amount_confirmed_won bigint check (amount_confirmed_won is null or amount_confirmed_won between 0 and 100000000),
    penalty_points integer check (penalty_points is null or penalty_points between 0 and 1000),
    vehicle_raw text check (char_length(vehicle_raw) <= 64),
    lat double precision check (lat is null or lat between 32 and 39.5),
    lng double precision check (lng is null or lng between 124 and 132),
    lat_text text check (char_length(lat_text) <= 24),
    lng_text text check (char_length(lng_text) <= 24),
    coord_source text not null check (coord_source in ('geocode', 'none')),
    address text check (char_length(address) <= 200),
    region_code text check (char_length(region_code) <= 24),
    point_key text check (char_length(point_key) <= 160),
    agency_key text check (char_length(agency_key) <= 160),
    agency_name text check (char_length(agency_name) <= 200),
    manager_key text check (char_length(manager_key) <= 160),
    manager_name text check (char_length(manager_name) <= 160),
    first_accepted_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (contributor_id, dataset_key, source_report_key),
    check ((lat is null) = (lng is null)),
    check ((lat is null) = (coord_source = 'none'))
);
create index community_report_facts_report_date_idx on private.community_report_facts(report_date, category, region_code) where public_state = 'completed';
create index community_report_facts_completed_date_idx on private.community_report_facts(completed_date, category, region_code) where public_state = 'completed';
create index community_report_facts_point_idx on private.community_report_facts(point_key);
create index community_report_facts_grant_idx on private.community_report_facts(consent_grant_id);

-- Every change of the completed key set of a (contributor, dataset) bumps its manifest generation in the same
-- transaction, whatever code path (RPC or operator DML) made it (N-07). Order-only updates do not bump.
create or replace function private.community_facts_manifest_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
    if tg_op = 'INSERT' then
        if new.public_state = 'completed' then perform private.community_bump_manifest(new.contributor_id, new.dataset_key); end if;
    elsif tg_op = 'DELETE' then
        if old.public_state = 'completed' then perform private.community_bump_manifest(old.contributor_id, old.dataset_key); end if;
    elsif old.public_state is distinct from new.public_state or old.source_report_key is distinct from new.source_report_key
          or old.dataset_key is distinct from new.dataset_key or old.contributor_id is distinct from new.contributor_id then
        perform private.community_bump_manifest(old.contributor_id, old.dataset_key);
        if old.contributor_id <> new.contributor_id or old.dataset_key <> new.dataset_key then
            perform private.community_bump_manifest(new.contributor_id, new.dataset_key);
        end if;
    end if;
    return null;
end;
$$;
revoke all on function private.community_facts_manifest_trigger() from public, anon, authenticated;

-- Deleted identities stay blocked forever, whatever captured_at a later client claims (S-02).
-- Keyed by the official report identity only, so re-registering another dataset_key cannot re-upload it.
create table private.community_fact_tombstones (
    contributor_id uuid not null references auth.users(id) on delete cascade,
    source_report_key text not null,
    deletion_id uuid not null,
    deleted_at timestamptz not null default now(),
    primary key (contributor_id, source_report_key)
);

-- Deletion fence (S-02-R): events captured at or before the user's last deletion request are refused even when the
-- report never reached the centre before; deletion also revokes the user's writer connections so pending events
-- bound to them fail with connection_revoked. New sharing needs a new connection registration.
create table private.community_deletion_fences (
    contributor_id uuid primary key references auth.users(id) on delete cascade,
    deletion_id uuid not null,
    fenced_at timestamptz not null default now()
);

-- Manifest generation (S-04-T): bumped in the same transaction as every fact insert/update/delete of a
-- (contributor, dataset); a manifest page carries it so a client can reject pages from different states.
create table private.community_manifest_generations (
    contributor_id uuid not null references auth.users(id) on delete cascade,
    dataset_key text not null,
    generation bigint not null default 0,
    primary key (contributor_id, dataset_key)
);

create or replace function private.community_bump_manifest(p_user uuid, p_dataset text)
returns void language sql volatile security definer set search_path = '' as $$
    insert into private.community_manifest_generations(contributor_id, dataset_key, generation) values (p_user, p_dataset, 1)
    on conflict (contributor_id, dataset_key) do update set generation = private.community_manifest_generations.generation + 1;
$$;
revoke all on function private.community_bump_manifest(uuid, text) from public, anon, authenticated;

alter table private.community_ingest_events enable row level security;
alter table private.community_report_facts enable row level security;
alter table private.community_fact_tombstones enable row level security;
alter table private.community_deletion_fences enable row level security;
alter table private.community_manifest_generations enable row level security;
revoke all on private.community_ingest_events, private.community_report_facts, private.community_fact_tombstones,
    private.community_deletion_fences, private.community_manifest_generations from public, anon, authenticated;
grant select, insert, update, delete on private.community_ingest_events, private.community_report_facts,
    private.community_fact_tombstones, private.community_deletion_fences, private.community_manifest_generations to service_role;
create trigger community_report_facts_manifest after insert or update or delete on private.community_report_facts
for each row execute function private.community_facts_manifest_trigger();

-- A fact is listed by the public API when completed, has a report or completion date, its contributor is active and
-- its consent lineage is active (mirrors internal_analytics_v2_facts; ready/generated_at are checked separately).
create or replace function private.community_fact_publicly_listed(f private.community_report_facts)
returns boolean language sql stable security definer set search_path = '' as $$
    select f.public_state = 'completed' and (f.report_date is not null or f.completed_date is not null)
       and exists (select 1 from private.contributor_profiles c where c.user_id = f.contributor_id and c.status = 'active')
       and private.community_lineage_active(f.consent_grant_id);
$$;
revoke all on function private.community_fact_publicly_listed(private.community_report_facts) from public, anon, authenticated;

-- p_events: array of {event_id, event_type, source_report_id, source_report_key(server computed), source_revision,
--   writer_epoch, captured_at, payload, payload_sha256(server computed), quarantine_reason?, derived:{...}}
create or replace function public.internal_community_ingest(
    p_user uuid, p_session uuid, p_request_id text, p_envelope jsonb, p_events jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
    v_policy private.community_policies%rowtype;
    v_profile private.contributor_profiles%rowtype;
    v_grant private.community_consent_grants%rowtype;
    v_conn private.community_connections%rowtype;
    v_fact private.community_report_facts%rowtype;
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
            trigger, payload, payload_sha256, captured_at, quarantine_reason)
        values (p_user, v_event_id, p_request_id, v_conn.connection_id, v_grant.grant_id, v_conn.dataset_key, v_epoch,
            'safetyreport', v_key, e->>'source_report_id', v_rev, e->>'event_type', p_envelope->>'trigger',
            e->'payload', e->>'payload_sha256', (e->>'captured_at')::timestamptz, e->>'quarantine_reason')
        on conflict (contributor_id, event_id) do nothing
        returning receipt_id into v_receipt;
        if v_receipt is null then
            -- Immutable event fields (contract): event_type, source_report_id/key, source_revision, writer_epoch,
            -- captured_at, payload_sha256 and the connection's dataset. Grant/connection/trigger/request are transport
            -- context and may legitimately differ on a retry after rebind or policy re-consent.
            select receipt_id, payload_sha256, result, dataset_key, source_report_key, source_report_id, source_revision,
                   writer_epoch, event_type, captured_at
              into v_existing from private.community_ingest_events where contributor_id = p_user and event_id = v_event_id;
            if v_existing.payload_sha256 = e->>'payload_sha256' and v_existing.dataset_key = v_conn.dataset_key
               and v_existing.source_report_key = v_key and v_existing.source_report_id = e->>'source_report_id'
               and v_existing.source_revision = v_rev and v_existing.writer_epoch = v_epoch
               and v_existing.event_type = e->>'event_type' and v_existing.captured_at = (e->>'captured_at')::timestamptz then
                v_results := v_results || jsonb_build_object('event_id', v_event_id, 'status', 'duplicate', 'durable', true,
                    'receipt_id', v_existing.receipt_id, 'original_status', v_existing.result, 'projection_status', 'not_applicable');
            else
                v_results := v_results || jsonb_build_object('event_id', v_event_id, 'status', 'conflict', 'durable', false,
                    'receipt_id', null, 'projection_status', 'not_applicable',
                    'error', jsonb_build_object('code', 'event_id_conflict', 'retryable', false));
            end if;
            continue;
        end if;
        v_max_rev := greatest(v_max_rev, v_rev);
        if e->>'quarantine_reason' is not null then
            update private.community_ingest_events set result = 'quarantined' where receipt_id = v_receipt;
            v_results := v_results || jsonb_build_object('event_id', v_event_id, 'status', 'quarantined', 'durable', true,
                'receipt_id', v_receipt, 'projection_status', 'not_applicable');
            continue;
        end if;
        select * into v_fact from private.community_report_facts
         where contributor_id = p_user and dataset_key = v_conn.dataset_key and source_report_key = v_key for update;
        v_was_visible := v_fact.contributor_id is not null and private.community_fact_publicly_listed(v_fact);
        if v_fact.contributor_id is null then
            insert into private.community_report_facts(contributor_id, dataset_key, source_report_key, source_report_id,
                latest_receipt_id, consent_grant_id, writer_epoch, source_revision, payload_sha256, public_state,
                report_date, completed_date, category, status, disposition, amount_kind, amount_confirmed_won, penalty_points,
                vehicle_raw, lat, lng, lat_text, lng_text, coord_source, address, region_code, point_key, agency_key,
                agency_name, manager_key, manager_name)
            values (p_user, v_conn.dataset_key, v_key, e->>'source_report_id', v_receipt, v_grant.grant_id, v_epoch, v_rev,
                e->>'payload_sha256', d->>'public_state', (d->>'report_date')::date, (d->>'completed_date')::date,
                d->>'category', d->>'status', d->>'disposition', d->>'amount_kind', (d->>'amount_confirmed_won')::bigint,
                (d->>'penalty_points')::integer, d->>'vehicle_raw', (d->>'lat')::double precision,
                (d->>'lng')::double precision, d->>'lat_text', d->>'lng_text', d->>'coord_source', d->>'address',
                d->>'region_code', d->>'point_key', d->>'agency_key', d->>'agency_name', d->>'manager_key', d->>'manager_name');
            v_result := 'accepted';
        elsif (v_epoch, v_rev) > (v_fact.writer_epoch, v_fact.source_revision) then
            -- A fact accepted under a lineage the USER revoked stays under that (hidden) grant unless this event is an
            -- explicit reshare; policy-version supersession keeps the lineage active, so it re-attributes normally.
            v_keep_grant := v_fact.consent_grant_id <> v_grant.grant_id and e->>'event_type' <> 'reshare'
                            and not private.community_lineage_active(v_fact.consent_grant_id);
            v_target_grant := case when v_keep_grant then v_fact.consent_grant_id else v_grant.grant_id end;
            if v_fact.payload_sha256 = e->>'payload_sha256' and v_fact.consent_grant_id = v_target_grant then
                update private.community_report_facts set writer_epoch = v_epoch, source_revision = v_rev,
                    latest_receipt_id = v_receipt, updated_at = now()
                 where contributor_id = p_user and dataset_key = v_conn.dataset_key and source_report_key = v_key;
                v_result := 'no_change';
            else
                update private.community_report_facts set latest_receipt_id = v_receipt, consent_grant_id = v_target_grant,
                    writer_epoch = v_epoch, source_revision = v_rev, payload_sha256 = e->>'payload_sha256',
                    public_state = d->>'public_state', report_date = (d->>'report_date')::date,
                    completed_date = (d->>'completed_date')::date, category = d->>'category', status = d->>'status',
                    disposition = d->>'disposition', amount_kind = d->>'amount_kind',
                    amount_confirmed_won = (d->>'amount_confirmed_won')::bigint, penalty_points = (d->>'penalty_points')::integer,
                    vehicle_raw = d->>'vehicle_raw', lat = (d->>'lat')::double precision, lng = (d->>'lng')::double precision,
                    lat_text = d->>'lat_text', lng_text = d->>'lng_text', coord_source = d->>'coord_source',
                    address = d->>'address', region_code = d->>'region_code', point_key = d->>'point_key',
                    agency_key = d->>'agency_key', agency_name = d->>'agency_name', manager_key = d->>'manager_key',
                    manager_name = d->>'manager_name', updated_at = now()
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
    if v_changed then
        perform private.community_bump_projection();
    end if;
    select dataset_version into v_version from private.analytics_state where singleton;
    return jsonb_build_object('results', v_results, 'dataset_version', v_version);
end;
$$;

-- Owner manifest (S-04): completed fact keys (24 hex prefix) of the caller's connection dataset, paged.
-- Never cached or logged by the Edge layer (prefixes of low-entropy official IDs are guessable).
create or replace function public.internal_community_manifest(p_user uuid, p_session uuid, p_connection uuid,
    p_after text, p_limit integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
    v_id jsonb := private.community_identity_state(p_user, p_session);
    v_conn private.community_connections%rowtype;
    v_keys jsonb;
    v_total integer;
    v_limit integer := least(greatest(coalesce(p_limit, 5000), 1), 5000);
    v_token text;
begin
    if not ((v_id->>'user_ok')::boolean and (v_id->>'kakao')::boolean) then return jsonb_build_object('error', 'kakao_required'); end if;
    if not (v_id->>'session')::boolean then return jsonb_build_object('error', 'session_revoked'); end if;
    if p_after is not null and p_after !~ '^[0-9a-f]{64}$' then return jsonb_build_object('error', 'invalid_request'); end if;
    select * into v_conn from private.community_connections where connection_id = p_connection and user_id = p_user;
    if v_conn.connection_id is null then return jsonb_build_object('error', 'connection_unknown'); end if;
    if v_conn.status <> 'active' then return jsonb_build_object('error', 'connection_' || v_conn.status); end if;
    if v_conn.bound_session_id <> p_session then return jsonb_build_object('error', 'connection_session_mismatch'); end if;
    select count(*) into v_total from private.community_report_facts f
     where f.contributor_id = p_user and f.dataset_key = v_conn.dataset_key and f.public_state = 'completed';
    -- manifest_token = generation bumped with every accepted fact change / deletion of this dataset (S-04-T).
    select coalesce((select generation::text from private.community_manifest_generations g
                      where g.contributor_id = p_user and g.dataset_key = v_conn.dataset_key), '0')
      into v_token;
    select coalesce(jsonb_agg(k order by k), '[]'::jsonb) into v_keys from (
        select f.source_report_key as k from private.community_report_facts f
         where f.contributor_id = p_user and f.dataset_key = v_conn.dataset_key and f.public_state = 'completed'
           and (p_after is null or f.source_report_key > p_after)
         order by f.source_report_key limit v_limit) page;
    return jsonb_build_object('dataset_key', v_conn.dataset_key, 'writer_epoch', v_conn.writer_epoch, 'total', v_total,
        'manifest_token', v_token,
        'key_prefixes', (select coalesce(jsonb_agg(left(x #>> '{}', 24)), '[]'::jsonb) from jsonb_array_elements(v_keys) x),
        'next_after', case when jsonb_array_length(v_keys) = v_limit then v_keys->>(v_limit - 1) else null end);
end;
$$;

-- Deletion of everything this user shared (called by community-account after JWT verification).
create or replace function public.internal_community_delete_contributions(p_user uuid, p_session uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
    v_policy private.community_policies%rowtype := private.community_current_policy(true);
    v_id jsonb := private.community_identity_state(p_user, p_session);
    v_deletion uuid := gen_random_uuid();
    v_count integer;
    v_conns integer;
    v_fence_at timestamptz;
begin
    if not ((v_id->>'user_ok')::boolean and (v_id->>'kakao')::boolean and (v_id->>'session')::boolean) then
        return jsonb_build_object('error', 'kakao_required');
    end if;
    perform private.community_lock_contributor(p_user, false);
    perform 1 from private.community_consent_grants where user_id = p_user for update;
    perform 1 from private.community_connections where user_id = p_user for update;
    update private.community_connections set status = 'revoked', revoked_at = now(), revoke_reason = 'contributions_deleted'
     where user_id = p_user and status = 'active';
    get diagnostics v_conns = row_count;
    -- clock_timestamp() AFTER the locks (now() is the transaction start and can be older than a concurrent deletion);
    -- the stored fence never moves backwards (N-06).
    v_fence_at := clock_timestamp();
    insert into private.community_deletion_fences(contributor_id, deletion_id, fenced_at) values (p_user, v_deletion, v_fence_at)
    on conflict (contributor_id) do update
        set deletion_id = excluded.deletion_id,
            fenced_at = greatest(private.community_deletion_fences.fenced_at, excluded.fenced_at)
    returning fenced_at into v_fence_at;
    insert into private.community_fact_tombstones(contributor_id, source_report_key, deletion_id)
    select distinct contributor_id, source_report_key, v_deletion from private.community_report_facts
     where contributor_id = p_user
    on conflict do nothing;
    delete from private.community_report_facts where contributor_id = p_user;
    get diagnostics v_count = row_count;
    perform private.community_bump_projection();
    return jsonb_build_object('deletion_id', v_deletion, 'deleted_facts', v_count, 'revoked_connections', v_conns,
        'deleted_at', v_fence_at);
end;
$$;

-- Incremental model: a contributor change bumps the version (no longer switches the whole map off).
-- A legacy snapshot state change keeps the old meaning (ready=false) for that unused path.
create or replace function private.invalidate_analytics_v2()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
    if tg_table_name = 'upload_snapshots' then
        update private.analytics_state
           set ready = false, dataset_version = gen_random_uuid()::text, generated_at = now(),
               coverage_note = '원천 변경으로 공개 집계를 다시 생성해야 합니다.'
         where singleton = true;
    else
        update private.analytics_state
           set dataset_version = gen_random_uuid()::text, source_updated_at = now(), generated_at = now()
         where singleton = true;
    end if;
    return new;
end;
$$;

update private.analytics_state
   set dataset_version = gen_random_uuid()::text, generated_at = coalesce(generated_at, now()),
       coverage_note = '커뮤니티 사용자가 공유한 답변 완료 신고만 집계합니다. 전국 전체 신고를 대표하지 않습니다.',
       dedupe_policy_version = 'ingest-latest-v1'
 where singleton = true;

-- Public facts: ingest facts only, whose accepting grant lineage was not revoked by the user, not deleted.
-- A policy-version change alone does not hide facts consented under the older terms; new uploads need the
-- current policy (consent_outdated) and a user revocation hides the whole lineage.
-- Facts without coordinates are included (statistics); the bbox filter keeps only located facts (S-01).
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
    with bounded as (
        select f.*
          from private.community_report_facts f
          join private.contributor_profiles c on c.user_id = f.contributor_id and c.status = 'active'
         where f.public_state = 'completed'
           and private.community_lineage_active(f.consent_grant_id)
           and (f.report_date between v_previous_start and p_end or f.completed_date between v_previous_start and p_end)
           and (p_category = 'all' or f.category = p_category)
           and (p_region_code is null or f.region_code = p_region_code)
           and (p_agency_key is null or f.agency_key = p_agency_key)
           and (p_manager_key is null or f.manager_key = p_manager_key)
           and (p_bbox is null or (f.lat is not null and f.lng between p_bbox[1] and p_bbox[3] and f.lat between p_bbox[2] and p_bbox[4]))
         limit 100001
    )
    select count(*), coalesce(jsonb_agg(jsonb_build_object(
        'fact_identity', dataset_key || ':' || source_report_key, 'contributor_id', contributor_id,
        'snapshot_id', 'ingest-v1', 'snapshot_generation', 1,
        'report_date', report_date, 'completed_date', completed_date,
        'category', category, 'status', status, 'disposition', disposition,
        'vehicle_raw', vehicle_raw, 'point_key', point_key, 'lat', lat, 'lng', lng,
        'address', address, 'region_code', region_code,
        'agency_key', agency_key, 'agency_name', agency_name,
        'manager_key', manager_key, 'manager_name', manager_name
    )), '[]'::jsonb) into v_count, v_rows from bounded;
    if v_count > 100000 then raise exception 'AGGREGATE_NOT_READY'; end if;
    return v_rows;
end;
$$;

create or replace function public.internal_community_ingest_rate_limit(p_bucket text, p_limit integer)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare v_count integer;
begin
    if p_bucket is null or p_bucket !~ '^[0-9a-f]{64}$' or p_limit not between 1 and 100000 then raise exception 'INVALID_BUCKET'; end if;
    insert into private.rate_limits(bucket, window_start, request_count)
    values (p_bucket, date_trunc('minute', now()), 1)
    on conflict (bucket, window_start) do update set request_count = private.rate_limits.request_count + 1
    returning request_count into v_count;
    return v_count <= p_limit;
end;
$$;

do $$
declare f text;
begin
    foreach f in array array[
        'public.internal_community_ingest(uuid, uuid, text, jsonb, jsonb)',
        'public.internal_community_manifest(uuid, uuid, uuid, text, integer)',
        'public.internal_community_delete_contributions(uuid, uuid)',
        'public.internal_analytics_v2_facts(date, date, text, text, text, text, double precision[])',
        'public.internal_community_ingest_rate_limit(text, integer)'] loop
        execute format('revoke all on function %s from public, anon, authenticated', f);
        execute format('grant execute on function %s to service_role', f);
    end loop;
end $$;

commit;
