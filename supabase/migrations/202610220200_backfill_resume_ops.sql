-- Backfill resume, maintenance switch, required version, app announcements, operations console (2026-10-22).
-- Task: docs/tasks/backfill-resume-20261022.md 2-1, 2-9, 2-10, 2-11, 2-14, 2-15. Console API: docs/implementation/
-- backfill-resume-20261022/OPS-DB-API.md. Client rules: .../CLIENT-RULES.md.
-- Depends on map 202610210100 (community_ingest_config, connection columns, raw tables) and auth 202610220100
-- (community_setup_progress, community_client_seen, private.community_note_client).
--
-- Nothing here is reachable from anon/authenticated. Edge functions call the public.internal_* RPCs with the server key;
-- the operations console logs in as community_ops_login (member of NOLOGIN community_ops) and may only EXECUTE the
-- functions of schema `ops` (no table privileges, no usage on `private`). Every ops function re-checks the caller`s
-- Kakao user id against private.ops_admins; every change is written to an audit table (who, when, before -> after).

begin;
set local lock_timeout = '3s';

-- ── version strings (contracts/community-ingest-v2/version-vectors.json; server/ingest/version.ts is the same rule) ──
-- `[v]N[.N[.N[.N]]][+build]`, each N 1..6 digits. Missing parts are 0 (3.6 = 3.6.0 = 3.6.0.0). Anything else
-- (pre-release `-beta`, empty, spaces inside) is unparseable: null, and callers never block on it.
create function private.community_version_parts(p_version text) returns integer[]
language plpgsql immutable set search_path='' as $$
declare m text[];
begin
    if p_version is null or char_length(p_version) > 40 then return null; end if;
    m := regexp_match(btrim(p_version), '^v?([0-9]{1,6})(?:\.([0-9]{1,6}))?(?:\.([0-9]{1,6}))?(?:\.([0-9]{1,6}))?(?:\+[0-9A-Za-z.-]{1,32})?$');
    if m is null then return null; end if;
    return array[m[1]::integer, coalesce(m[2], '0')::integer, coalesce(m[3], '0')::integer, coalesce(m[4], '0')::integer];
end $$;
-- -1 / 0 / 1, or null when either side is unparseable.
create function private.community_version_cmp(p_a text, p_b text) returns integer
language plpgsql immutable set search_path='' as $$
declare a integer[] := private.community_version_parts(p_a); b integer[] := private.community_version_parts(p_b);
begin
    if a is null or b is null then return null; end if;
    if a = b then return 0; end if;
    return case when a < b then -1 else 1 end;
end $$;
revoke all on function private.community_version_parts(text), private.community_version_cmp(text, text) from public, anon, authenticated, service_role;

-- ── 2-9 maintenance switch and 2-10 required version on the single shared config row ────────────────────────────────
-- client_requirement = contracts/community-ingest-v2/client-requirement.schema.json:
--   {min_version:{pc,mobile}, url:{pc,mobile}, message, enforce_from}; a null platform value = no requirement there.
create function private.community_client_requirement_valid(r jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare k text;
begin
    if r is null then return true; end if;
    if jsonb_typeof(r) <> 'object' then return false; end if;
    if (select array_agg(x order by x) from jsonb_object_keys(r) x) is distinct from array['enforce_from','message','min_version','url'] then return false; end if;
    if jsonb_typeof(r->'min_version') <> 'object' or jsonb_typeof(r->'url') <> 'object' then return false; end if;
    if (select array_agg(x order by x) from jsonb_object_keys(r->'min_version') x) is distinct from array['mobile','pc']
       or (select array_agg(x order by x) from jsonb_object_keys(r->'url') x) is distinct from array['mobile','pc'] then return false; end if;
    foreach k in array array['pc','mobile'] loop
        if jsonb_typeof(r->'min_version'->k) not in ('null','string')
           or (jsonb_typeof(r->'min_version'->k) = 'string' and private.community_version_parts(r->'min_version'->>k) is null) then return false; end if;
        if jsonb_typeof(r->'url'->k) not in ('null','string')
           or (jsonb_typeof(r->'url'->k) = 'string' and ((r->'url'->>k) !~ '^https://[^[:space:]]+$' or char_length(r->'url'->>k) > 2000)) then return false; end if;
    end loop;
    if jsonb_typeof(r->'min_version'->'pc') = 'null' and jsonb_typeof(r->'min_version'->'mobile') = 'null' then return false; end if;
    if jsonb_typeof(r->'message') not in ('null','string')
       or (jsonb_typeof(r->'message') = 'string' and (char_length(r->>'message') not between 1 and 300 or (r->>'message') ~ '[[:cntrl:]]')) then return false; end if;
    if jsonb_typeof(r->'enforce_from') not in ('null','string')
       or (jsonb_typeof(r->'enforce_from') = 'string'
           and (r->>'enforce_from') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$') then return false; end if;
    return true;
end $$;
revoke all on function private.community_client_requirement_valid(jsonb) from public, anon, authenticated, service_role;

alter table private.community_ingest_config
    add column uploads_paused boolean not null default false,
    add column pause_message text check (pause_message is null or (char_length(pause_message) between 1 and 300 and pause_message !~ '[[:cntrl:]]')),
    add column pause_resume_at timestamptz,
    add column paused_at timestamptz,
    add column paused_by text check (paused_by is null or char_length(paused_by) between 1 and 80),
    add column client_requirement jsonb default null
        constraint community_ingest_config_requirement_shape check (private.community_client_requirement_valid(client_requirement));

-- Auto-resume is decided by the reader: paused only while now() < pause_resume_at (or no resume time). No cron.
create function private.community_uploads_paused(p_paused boolean, p_resume timestamptz) returns boolean
language sql stable set search_path='' as $$ select coalesce(p_paused, false) and (p_resume is null or now() < p_resume) $$;
-- The requirement the servers enforce now: null before enforce_from, null when absent.
create function private.community_requirement_in_force(r jsonb) returns jsonb
language sql stable set search_path='' as $$
    select case when r is null then null
                when jsonb_typeof(r->'enforce_from') = 'string' and (r->>'enforce_from')::timestamptz > now() then null
                else r end
$$;
revoke all on function private.community_uploads_paused(boolean, timestamptz), private.community_requirement_in_force(jsonb)
    from public, anon, authenticated, service_role;

-- Audit of every config change (ops functions set the actor; a direct SQL change is recorded with the DB role).
create table private.community_ingest_config_audit (
    audit_id bigint generated always as identity primary key,
    changed_at timestamptz not null default now(),
    actor_user_id uuid,
    actor_label text not null,
    action text not null check (action ~ '^[a-z_]{1,40}$'),
    before jsonb not null,
    after jsonb not null
);
create index community_ingest_config_audit_recent on private.community_ingest_config_audit(changed_at desc);
alter table private.community_ingest_config_audit enable row level security;
revoke all on private.community_ingest_config_audit from public, anon, authenticated, service_role;

create function private.community_ops_actor() returns uuid language plpgsql stable set search_path='' as $$
declare v text := nullif(current_setting('community_ops.actor', true), '');
begin
    return case when v ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then v::uuid end;
end $$;
create function private.community_ops_label() returns text language sql stable set search_path='' as $$
    select coalesce(nullif(current_setting('community_ops.label', true), ''), 'sql:' || current_user)
$$;
create function private.community_ops_action(p_default text) returns text language sql stable set search_path='' as $$
    select coalesce(nullif(current_setting('community_ops.action', true), ''), p_default)
$$;
revoke all on function private.community_ops_actor(), private.community_ops_label(), private.community_ops_action(text)
    from public, anon, authenticated, service_role;

create function private.community_ingest_config_audit_row() returns trigger language plpgsql security definer set search_path='' as $$
begin
    if to_jsonb(old) is distinct from to_jsonb(new) then
        insert into private.community_ingest_config_audit(actor_user_id, actor_label, action, before, after)
        values (private.community_ops_actor(), private.community_ops_label(), private.community_ops_action('sql_update'),
                to_jsonb(old) - 'singleton', to_jsonb(new) - 'singleton');
    end if;
    return new;
end $$;
revoke all on function private.community_ingest_config_audit_row() from public, anon, authenticated, service_role;
create trigger community_ingest_config_audit after update on private.community_ingest_config
for each row execute function private.community_ingest_config_audit_row();

-- Same RPC both Edge functions read (account status + ingest). New keys: paused / pause_message / resume_at (decided
-- here) and client_requirement (only while in force). A missing row reads as v1-only, not paused, no requirement.
create or replace function public.internal_community_ingest_capabilities() returns jsonb
language sql stable security definer set search_path='' as $$
    select coalesce((select jsonb_build_object('contracts',case when coalesce(v2_enabled,false) then '[1,2]'::jsonb else '[1]'::jsonb end,
        'raw_policy_version',raw_policy_version,'v1_sunset',v1_sunset,'client_notice',client_notice,
        'paused',private.community_uploads_paused(uploads_paused,pause_resume_at),
        'pause_message',case when private.community_uploads_paused(uploads_paused,pause_resume_at) then pause_message end,
        'resume_at',case when private.community_uploads_paused(uploads_paused,pause_resume_at) then pause_resume_at end,
        'client_requirement',private.community_requirement_in_force(client_requirement))
        from private.community_ingest_config where singleton),
        jsonb_build_object('contracts','[1]'::jsonb,'raw_policy_version',null,'v1_sunset',null,'client_notice',null,
            'paused',false,'pause_message',null,'resume_at',null,'client_requirement',null))
$$;
revoke all on function public.internal_community_ingest_capabilities() from public,anon,authenticated;
grant execute on function public.internal_community_ingest_capabilities() to service_role;

-- Per-minute counters of refused ingest requests (dashboard "최근 1시간 503·426"). One small upsert per refusal.
create table private.community_ingest_rejections (
    minute timestamptz not null,
    code text not null check (code in ('maintenance','client_upgrade_required')),
    app text not null check (app in ('pc','mobile','unknown')),
    route text not null check (route in ('ingest','manifest','progress')),
    n integer not null default 1 check (n > 0),
    primary key (minute, code, app, route)
);
alter table private.community_ingest_rejections enable row level security;
revoke all on private.community_ingest_rejections from public, anon, authenticated, service_role;
create function public.internal_community_ingest_note_rejection(p_code text, p_app text, p_route text) returns void
language plpgsql volatile security definer set search_path='' as $$
begin
    if p_code not in ('maintenance','client_upgrade_required') or p_route not in ('ingest','manifest','progress') then return; end if;
    insert into private.community_ingest_rejections as r(minute, code, app, route)
    values (date_trunc('minute', now()), p_code, case when p_app in ('pc','mobile') then p_app else 'unknown' end, p_route)
    on conflict (minute, code, app, route) do update set n = r.n + 1;
end $$;
revoke all on function public.internal_community_ingest_note_rejection(text,text,text) from public,anon,authenticated;
grant execute on function public.internal_community_ingest_note_rejection(text,text,text) to service_role;

-- ── 2-1 progress reports ──────────────────────────────────────────────────────────────────────────────────────────
alter table private.community_connections add column last_progress jsonb, add column last_progress_at timestamptz;
-- 30 days, at most 200 per connection (trimmed on every write; the daily prune removes older rows).
create table private.community_progress_history (
    history_id bigint generated always as identity primary key,
    connection_id uuid not null references private.community_connections(connection_id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    received_at timestamptz not null default now(),
    progress jsonb not null check (jsonb_typeof(progress) = 'object' and octet_length(progress::text) <= 8192)
);
create index community_progress_history_conn on private.community_progress_history(connection_id, received_at desc);
create index community_progress_history_age on private.community_progress_history(received_at);
alter table private.community_progress_history enable row level security;
revoke all on private.community_progress_history from public, anon, authenticated, service_role;

-- POST /community-ingest/progress after the Edge validated the body (contracts/community-ingest-v2/progress.schema.json).
-- Same identity/connection checks as ingest, but an OUTDATED consent is accepted (old-version diagnosis); a revoked or
-- missing consent is refused. Stores only: connection last_progress*, last_client_version/parser/seen, history row,
-- client sighting. Never touches facts, raw rows, queue or the ledger. 1 per connection per 60 s.
create function public.internal_community_progress(p_user uuid, p_session uuid, p_connection uuid, p_report jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
    v_profile private.contributor_profiles%rowtype;
    v_conn private.community_connections%rowtype;
    v_id jsonb;
begin
    if jsonb_typeof(p_report) <> 'object' or octet_length(p_report::text) > 8192 then return jsonb_build_object('error','invalid_request'); end if;
    select * into v_profile from private.contributor_profiles where user_id = p_user for share;
    if v_profile.user_id is null then return jsonb_build_object('error','consent_missing'); end if;
    if v_profile.status <> 'active' then return jsonb_build_object('error','contributor_suspended'); end if;
    v_id := private.community_identity_state(p_user, p_session);
    if not (v_id->>'user_ok')::boolean or not (v_id->>'kakao')::boolean then return jsonb_build_object('error','kakao_required'); end if;
    if not (v_id->>'session')::boolean then return jsonb_build_object('error','session_revoked'); end if;
    if not exists (select 1 from private.community_consent_grants g where g.user_id = p_user and g.revoked_at is null) then
        return jsonb_build_object('error', case when exists (select 1 from private.community_consent_grants g where g.user_id = p_user)
                                                then 'consent_revoked' else 'consent_missing' end);
    end if;
    select * into v_conn from private.community_connections where connection_id = p_connection and user_id = p_user for update;
    if v_conn.connection_id is null then return jsonb_build_object('error','connection_unknown'); end if;
    if v_conn.status = 'superseded' then return jsonb_build_object('error','writer_superseded'); end if;
    if v_conn.status <> 'active' then return jsonb_build_object('error','connection_' || v_conn.status); end if;
    if v_conn.bound_session_id <> p_session then return jsonb_build_object('error','connection_session_mismatch'); end if;
    if p_report->>'source_app' is distinct from v_conn.source_app then return jsonb_build_object('error','connection_mode_mismatch'); end if;
    if v_conn.last_progress_at is not null and v_conn.last_progress_at > now() - interval '60 seconds' then
        return jsonb_build_object('error','rate_limited',
            'retry_after', greatest(1, ceil(extract(epoch from (v_conn.last_progress_at + interval '60 seconds' - now())))::int));
    end if;
    update private.community_connections set last_progress = p_report, last_progress_at = now(),
        last_client_version = p_report->>'client_version', last_parser_version = p_report->>'parser_version', last_seen_at = now()
     where connection_id = v_conn.connection_id;
    insert into private.community_progress_history(connection_id, user_id, progress) values (v_conn.connection_id, p_user, p_report);
    delete from private.community_progress_history h
     where h.connection_id = v_conn.connection_id
       and (h.received_at < now() - interval '30 days'
            or h.history_id in (select x.history_id from private.community_progress_history x where x.connection_id = v_conn.connection_id
                                 order by x.received_at desc, x.history_id desc offset 200));
    perform private.community_note_client(p_user, case v_conn.source_app when 'safetyreport' then 'pc' else 'mobile' end,
        coalesce(p_report->>'platform', v_conn.platform), p_report->>'client_version');
    return jsonb_build_object('stored', true);
end $$;
revoke all on function public.internal_community_progress(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.internal_community_progress(uuid,uuid,uuid,jsonb) to service_role;

-- ── 2-10 map web version gate + 2-9 banner: the signed-in user`s own state (no identifiers leave) ────────────────────
-- update_gate.blocked: a requirement is in force and NO app of this user was seen in the last 30 days at or above the
-- requirement of its app (a platform without a requirement counts as satisfied). Unknown versions do not satisfy.
create function private.community_user_meets_requirement(p_user uuid, r jsonb) returns boolean
language sql stable set search_path='' as $$
    with apps as (
        select s.app, s.version from private.community_client_seen s
         where s.user_id = p_user and s.last_seen_at >= now() - interval '30 days'
        union all
        select case c.source_app when 'safetyreport' then 'pc' else 'mobile' end, c.last_client_version from private.community_connections c
         where c.user_id = p_user and c.last_seen_at >= now() - interval '30 days' and c.last_client_version is not null)
    select r is null or exists (select 1 from apps a
        where jsonb_typeof(r->'min_version'->a.app) = 'null'
           or coalesce(private.community_version_cmp(a.version, r->'min_version'->>a.app) >= 0, false))
$$;
revoke all on function private.community_user_meets_requirement(uuid, jsonb) from public, anon, authenticated, service_role;

create or replace function public.internal_map_client_state(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_policy private.community_policies%rowtype; v_consent text; v_cfg private.community_ingest_config%rowtype;
        v_req jsonb; v_paused boolean;
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
    select * into v_cfg from private.community_ingest_config c where c.singleton;
    v_req := private.community_requirement_in_force(v_cfg.client_requirement);
    v_paused := private.community_uploads_paused(v_cfg.uploads_paused, v_cfg.pause_resume_at);
    return jsonb_build_object(
        'consent', v_consent,
        'last_contract', (select c.last_contract from private.community_connections c
                           where c.user_id = p_user and c.status = 'active' and c.last_seen_at is not null
                           order by c.last_seen_at desc, c.connection_id limit 1),
        'v1_connections', (select count(*)::int from private.community_connections c
                            where c.user_id = p_user and c.status = 'active' and c.last_contract = 'community-ingest-v1'
                              and (select l.last_contract from private.community_connections l
                                    where l.user_id = p_user and l.status = 'active' and l.last_seen_at is not null
                                    order by l.last_seen_at desc, l.connection_id limit 1) = 'community-ingest-v1'),
        'v2_enabled', coalesce(v_cfg.v2_enabled, false),
        'notice', v_cfg.client_notice,
        'upload_pause', jsonb_build_object('paused', v_paused,
            'message', case when v_paused then v_cfg.pause_message end,
            'resume_at', case when v_paused then v_cfg.pause_resume_at end),
        'update_gate', case when v_req is null then null else jsonb_build_object(
            'blocked', not private.community_user_meets_requirement(p_user, v_req),
            'min_version', v_req->'min_version', 'url', v_req->'url', 'message', v_req->'message') end);
end $$;
revoke all on function public.internal_map_client_state(uuid) from public,anon,authenticated;
grant execute on function public.internal_map_client_state(uuid) to service_role;

-- ── 2-11 app announcements (contracts/app-announcements/) ─────────────────────────────────────────────────────────────
-- Links: only these three families (the apps check again). No userinfo, no port, https only.
create function private.app_announcement_url_allowed(p_url text) returns boolean
language sql immutable set search_path='' as $$
    select p_url is not null and char_length(p_url) <= 500 and p_url !~ '[[:space:][:cntrl:]<>"\\]' and (
        p_url ~ '^https://play\.google\.com/store/apps/details\?id=com\.fentanest\.mysafetyreport(&[A-Za-z0-9._~=%-]+)*$'
        or p_url ~ '^https://github\.com/Fentanest/[A-Za-z0-9._~/%?=&#+-]*$'
        or p_url ~ '^https://([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)*worklazy\.net(/[A-Za-z0-9._~/%?=&#+-]*)?$')
$$;
create function private.app_announcement_action_valid(a jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
begin
    if a is null then return true; end if;
    if jsonb_typeof(a) <> 'object' or jsonb_typeof(a->'label') <> 'string'
       or char_length(a->>'label') not between 1 and 20 or (a->>'label') ~ '[[:cntrl:]]' then return false; end if;
    if (select array_agg(x order by x) from jsonb_object_keys(a) x) = array['label','url'] then
        return jsonb_typeof(a->'url') = 'string' and private.app_announcement_url_allowed(a->>'url');
    end if;
    if (select array_agg(x order by x) from jsonb_object_keys(a) x) = array['app_action','label'] then
        return jsonb_typeof(a->'app_action') = 'string' and (a->>'app_action') in ('open_mode_switch');
    end if;
    return false;
end $$;
create function private.app_announcement_audience_valid(a jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare v text;
begin
    if jsonb_typeof(a) <> 'object'
       or (select array_agg(x order by x) from jsonb_object_keys(a) x) is distinct from array['apps','max_version','min_version','modes','platforms'] then return false; end if;
    if jsonb_typeof(a->'apps') <> 'array' or jsonb_array_length(a->'apps') not between 1 and 2 then return false; end if;
    for v in select jsonb_array_elements_text(a->'apps') loop if v not in ('pc','mobile') then return false; end if; end loop;
    if (select count(distinct x) from jsonb_array_elements_text(a->'apps') x) <> jsonb_array_length(a->'apps') then return false; end if;
    if jsonb_typeof(a->'modes') not in ('null','array') or (jsonb_typeof(a->'modes') = 'array' and jsonb_array_length(a->'modes') not between 1 and 4) then return false; end if;
    if jsonb_typeof(a->'modes') = 'array' then
        for v in select jsonb_array_elements_text(a->'modes') loop if v not in ('server','standalone','client','demo') then return false; end if; end loop;
    end if;
    if jsonb_typeof(a->'platforms') not in ('null','array') or (jsonb_typeof(a->'platforms') = 'array' and jsonb_array_length(a->'platforms') not between 1 and 7) then return false; end if;
    if jsonb_typeof(a->'platforms') = 'array' then
        for v in select jsonb_array_elements_text(a->'platforms') loop
            if v not in ('windows','linux','macos','docker','android','ios','other') then return false; end if;
        end loop;
    end if;
    foreach v in array array['min_version','max_version'] loop
        if jsonb_typeof(a->v) not in ('null','string') or (jsonb_typeof(a->v) = 'string' and private.community_version_parts(a->>v) is null) then return false; end if;
    end loop;
    if jsonb_typeof(a->'min_version') = 'string' and jsonb_typeof(a->'max_version') = 'string'
       and private.community_version_cmp(a->>'min_version', a->>'max_version') > 0 then return false; end if;
    return true;
end $$;
revoke all on function private.app_announcement_url_allowed(text), private.app_announcement_action_valid(jsonb),
    private.app_announcement_audience_valid(jsonb) from public, anon, authenticated, service_role;

create table private.app_announcements (
    id text primary key check (id ~ '^[a-z0-9][a-z0-9-]{2,63}$'),
    title text not null check (char_length(title) between 1 and 40 and title !~ '[[:cntrl:]]'),
    -- plain text, newline (LF) is the only control character allowed
    body text not null check (char_length(body) between 1 and 600 and body !~ '[\x01-\x09\x0b-\x1f\x7f]'),
    primary_action jsonb check (private.app_announcement_action_valid(primary_action)),
    snooze_days integer not null default 7 check (snooze_days between 0 and 365),
    starts_at timestamptz,
    ends_at timestamptz,
    priority integer not null default 0 check (priority between -1000 and 1000),
    audience jsonb not null check (private.app_announcement_audience_valid(audience)),
    published_at timestamptz,
    ended_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check (ends_at is null or starts_at is null or ends_at > starts_at),
    check (ended_at is null or published_at is not null)
);
create index app_announcements_live on private.app_announcements(priority desc) where published_at is not null and ended_at is null;
alter table private.app_announcements enable row level security;
revoke all on private.app_announcements from public, anon, authenticated, service_role;

create table private.app_announcements_audit (
    audit_id bigint generated always as identity primary key,
    changed_at timestamptz not null default now(),
    actor_user_id uuid,
    actor_label text not null,
    action text not null check (action ~ '^[a-z_]{1,40}$'),
    announcement_id text not null,
    before jsonb,
    after jsonb
);
create index app_announcements_audit_recent on private.app_announcements_audit(changed_at desc);
alter table private.app_announcements_audit enable row level security;
revoke all on private.app_announcements_audit from public, anon, authenticated, service_role;
create function private.app_announcements_audit_row() returns trigger language plpgsql security definer set search_path='' as $$
begin
    insert into private.app_announcements_audit(actor_user_id, actor_label, action, announcement_id, before, after)
    values (private.community_ops_actor(), private.community_ops_label(),
            private.community_ops_action(lower('sql_' || tg_op)), coalesce(new.id, old.id),
            case when tg_op <> 'INSERT' then to_jsonb(old) end, case when tg_op <> 'DELETE' then to_jsonb(new) end);
    return coalesce(new, old);
end $$;
revoke all on function private.app_announcements_audit_row() from public, anon, authenticated, service_role;
create trigger app_announcements_audit after insert or update or delete on private.app_announcements
for each row execute function private.app_announcements_audit_row();

-- GET app-announcements (public key, no login). Live = published, not ended, started (starts_at or published_at), not
-- past ends_at, audience matches. A version that cannot be parsed only gets announcements WITHOUT a version condition.
-- Highest priority first, at most 3. No personal data in or out.
create function public.internal_app_announcements(p_app text, p_mode text, p_platform text, p_version text) returns jsonb
language sql stable security definer set search_path='' as $$
    select coalesce(jsonb_agg(x.item order by x.priority desc, x.starts desc, x.id), '[]'::jsonb) from (
        select a.id, a.priority, coalesce(a.starts_at, a.published_at) as starts,
               jsonb_build_object('id', a.id, 'title', a.title, 'body', a.body, 'primary_action', a.primary_action,
                   'snooze_days', a.snooze_days, 'starts_at', coalesce(a.starts_at, a.published_at), 'ends_at', a.ends_at,
                   'priority', a.priority) as item
          from private.app_announcements a
         where a.published_at is not null and a.ended_at is null
           and coalesce(a.starts_at, a.published_at) <= now() and (a.ends_at is null or a.ends_at > now())
           and a.audience->'apps' ? p_app
           and (jsonb_typeof(a.audience->'modes') = 'null' or a.audience->'modes' ? p_mode)
           and (jsonb_typeof(a.audience->'platforms') = 'null' or a.audience->'platforms' ? p_platform)
           and case when private.community_version_parts(p_version) is null
                    then jsonb_typeof(a.audience->'min_version') = 'null' and jsonb_typeof(a.audience->'max_version') = 'null'
                    else (jsonb_typeof(a.audience->'min_version') = 'null' or private.community_version_cmp(p_version, a.audience->>'min_version') >= 0)
                     and (jsonb_typeof(a.audience->'max_version') = 'null' or private.community_version_cmp(p_version, a.audience->>'max_version') <= 0) end
         order by a.priority desc, coalesce(a.starts_at, a.published_at) desc, a.id
         limit 3) x
$$;
revoke all on function public.internal_app_announcements(text,text,text,text) from public,anon,authenticated;
grant execute on function public.internal_app_announcements(text,text,text,text) to service_role;

-- ── daily prune (progress history 30 days, rejection counters 7 days) ──────────────────────────────────────────────
create function private.prune_backfill_resume_history() returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare a integer; b integer;
begin
    delete from private.community_progress_history where received_at < now() - interval '30 days';
    get diagnostics a = row_count;
    delete from private.community_ingest_rejections where minute < now() - interval '7 days';
    get diagnostics b = row_count;
    return jsonb_build_object('progress_history', a, 'rejections', b);
end $$;
revoke all on function private.prune_backfill_resume_history() from public, anon, authenticated, service_role;
do $$ begin
    if exists (select 1 from pg_extension where extname = 'pg_cron') then
        perform cron.schedule('community-progress-history-prune', '41 18 * * *',
            $cron$set statement_timeout='60s'; select private.prune_backfill_resume_history();$cron$);
    end if;
end $$;

-- ── 2-14 operations console: admins, roles, schema ops ───────────────────────────────────────────────────────────────
-- The first admin is added by the operator with one SQL line (docs/operations/ops-console.md); no user id is stored here.
create table private.ops_admins (
    user_id uuid primary key references auth.users(id) on delete cascade,
    memo text not null check (char_length(memo) between 1 and 80 and memo !~ '[[:cntrl:]]'),
    added_at timestamptz not null default now()
);
alter table private.ops_admins enable row level security;
revoke all on private.ops_admins from public, anon, authenticated, service_role;

do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'community_ops') then
        create role community_ops nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
    end if;
    -- The console login role. Created without LOGIN/password; the operator enables it on the server (ops-console.md).
    if not exists (select 1 from pg_roles where rolname = 'community_ops_login') then
        create role community_ops_login nologin inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
    end if;
end $$;
grant community_ops to community_ops_login;
create schema ops;
revoke all on schema ops from public;
grant usage on schema ops to community_ops;

-- Re-check the caller, then mark the transaction so the audit triggers record who did what.
create function private.ops_require_admin(p_actor uuid, p_action text) returns private.ops_admins
language plpgsql volatile security definer set search_path='' as $$
declare v private.ops_admins%rowtype;
begin
    select * into v from private.ops_admins where user_id = p_actor;
    if p_actor is null or v.user_id is null then
        raise exception 'not_ops_admin' using errcode = '42501';
    end if;
    perform set_config('community_ops.actor', p_actor::text, true);
    perform set_config('community_ops.label', 'ops:' || v.memo, true);
    perform set_config('community_ops.action', coalesce(p_action, ''), true);
    return v;
end $$;
revoke all on function private.ops_require_admin(uuid, text) from public, anon, authenticated, service_role;

-- pseudonymous id: first 8 hex of sha256(user uuid text). Never the uuid itself.
create function private.ops_pseudo(p_user uuid) returns text language sql immutable set search_path='' as $$
    select left(encode(sha256(convert_to(p_user::text, 'UTF8')), 'hex'), 8)
$$;
revoke all on function private.ops_pseudo(uuid) from public, anon, authenticated, service_role;

create function private.ops_config_view() returns jsonb language sql stable set search_path='' as $$
    select jsonb_build_object(
        'uploads', jsonb_build_object(
            'paused', private.community_uploads_paused(c.uploads_paused, c.pause_resume_at),
            'switch_on', c.uploads_paused, 'message', c.pause_message, 'resume_at', c.pause_resume_at,
            'paused_at', c.paused_at, 'paused_by', c.paused_by),
        'client_requirement', c.client_requirement,
        'client_requirement_in_force', private.community_requirement_in_force(c.client_requirement) is not null,
        'v2_enabled', c.v2_enabled, 'v1_sunset', c.v1_sunset, 'client_notice', c.client_notice)
      from private.community_ingest_config c where c.singleton
$$;
revoke all on function private.ops_config_view() from public, anon, authenticated, service_role;

create function ops.whoami(p_actor uuid) returns jsonb language sql stable security definer set search_path='' as $$
    select coalesce((select jsonb_build_object('admin', true, 'memo', a.memo) from private.ops_admins a where a.user_id = p_actor),
                    jsonb_build_object('admin', false, 'memo', null))
$$;

create function ops.audit_list(p_actor uuid, p_limit integer default 50, p_before timestamptz default null) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
begin
    perform private.ops_require_admin(p_actor, null);
    return coalesce((select jsonb_agg(x order by x->>'changed_at' desc, x->>'kind', (x->>'audit_id')::bigint desc) from (
        select jsonb_build_object('kind', k, 'audit_id', audit_id, 'changed_at', changed_at, 'actor', actor_label, 'action', action,
                                  'target', target, 'before', before, 'after', after) x
          from (select 'config' k, audit_id, changed_at, actor_label, action, 'community_ingest_config' target, before, after
                  from private.community_ingest_config_audit where p_before is null or changed_at < p_before
                union all
                select 'announcement', audit_id, changed_at, actor_label, action, announcement_id, before, after
                  from private.app_announcements_audit where p_before is null or changed_at < p_before) u
         order by changed_at desc, audit_id desc
         limit greatest(1, least(coalesce(p_limit, 50), 500))) s), '[]'::jsonb);
end $$;

create function ops.overview(p_actor uuid) returns jsonb language plpgsql volatile security definer set search_path='' as $$
begin
    perform private.ops_require_admin(p_actor, null);
    return private.ops_config_view() || jsonb_build_object(
        'server_time', now(),
        'live_announcements', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'title', a.title, 'ends_at', a.ends_at) order by a.priority desc, a.id)
            from private.app_announcements a where a.published_at is not null and a.ended_at is null
             and coalesce(a.starts_at, a.published_at) <= now() and (a.ends_at is null or a.ends_at > now())), '[]'::jsonb),
        'rejections_last_hour', jsonb_build_object(
            'maintenance', coalesce((select sum(n) from private.community_ingest_rejections where code = 'maintenance' and minute >= now() - interval '1 hour'), 0),
            'client_upgrade_required', coalesce((select sum(n) from private.community_ingest_rejections where code = 'client_upgrade_required' and minute >= now() - interval '1 hour'), 0)),
        'recent_changes', ops.audit_list(p_actor, 10, null));
end $$;

create function ops.pause_uploads(p_actor uuid, p_message text, p_resume_at timestamptz) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare v private.ops_admins%rowtype := private.ops_require_admin(p_actor, 'pause_uploads');
begin
    if p_message is not null and (char_length(p_message) not between 1 and 300 or p_message ~ '[[:cntrl:]]') then
        raise exception 'invalid_message' using errcode = '22023';
    end if;
    if p_resume_at is not null and (p_resume_at <= now() or p_resume_at > now() + interval '7 days') then
        raise exception 'invalid_resume_at' using errcode = '22023';
    end if;
    update private.community_ingest_config set uploads_paused = true, pause_message = p_message, pause_resume_at = p_resume_at,
        paused_at = now(), paused_by = left(v.memo, 80) where singleton;
    return private.ops_config_view();
end $$;

create function ops.resume_uploads(p_actor uuid) returns jsonb language plpgsql volatile security definer set search_path='' as $$
begin
    perform private.ops_require_admin(p_actor, 'resume_uploads');
    update private.community_ingest_config set uploads_paused = false, pause_message = null, pause_resume_at = null where singleton;
    return private.ops_config_view();
end $$;

create function ops.set_client_requirement(p_actor uuid, p_min_pc text, p_min_mobile text, p_url_pc text, p_url_mobile text,
    p_message text, p_enforce_from timestamptz) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare r jsonb;
begin
    perform private.ops_require_admin(p_actor, 'set_client_requirement');
    r := jsonb_build_object('min_version', jsonb_build_object('pc', nullif(btrim(p_min_pc), ''), 'mobile', nullif(btrim(p_min_mobile), '')),
        'url', jsonb_build_object('pc', nullif(btrim(p_url_pc), ''), 'mobile', nullif(btrim(p_url_mobile), '')),
        'message', nullif(btrim(p_message), ''),
        'enforce_from', case when p_enforce_from is null then null else to_jsonb(p_enforce_from) end);
    if not private.community_client_requirement_valid(r) then raise exception 'invalid_requirement' using errcode = '22023'; end if;
    update private.community_ingest_config set client_requirement = r where singleton;
    return private.ops_config_view();
end $$;

create function ops.clear_client_requirement(p_actor uuid) returns jsonb language plpgsql volatile security definer set search_path='' as $$
begin
    perform private.ops_require_admin(p_actor, 'clear_client_requirement');
    update private.community_ingest_config set client_requirement = null where singleton;
    return private.ops_config_view();
end $$;

-- Who would be locked out by a requirement, before saving it. Population: users with a non-revoked consent.
-- rows: every app/platform/version seen in the last 30 days (client_seen ∪ connection versions) with distinct users and
-- whether that version is below the candidate requirement (app lock from 2.5.1/3.6.2, 426 for every version).
-- map_web_blocked_users: users the map web would send to the update screen (no app at/above the requirement in 30 days,
-- unknown versions included).
create function ops.requirement_impact(p_actor uuid, p_min_pc text, p_min_mobile text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare r jsonb;
begin
    perform private.ops_require_admin(p_actor, null);
    if (nullif(btrim(p_min_pc), '') is not null and private.community_version_parts(p_min_pc) is null)
       or (nullif(btrim(p_min_mobile), '') is not null and private.community_version_parts(p_min_mobile) is null) then
        raise exception 'invalid_version' using errcode = '22023';
    end if;
    r := jsonb_build_object('min_version', jsonb_build_object('pc', nullif(btrim(p_min_pc), ''), 'mobile', nullif(btrim(p_min_mobile), '')));
    return (with people as (select distinct g.user_id from private.community_consent_grants g where g.revoked_at is null),
    seen as (
        select s.user_id, s.app, s.platform, s.version from private.community_client_seen s join people using (user_id)
         where s.last_seen_at >= now() - interval '30 days'
        union
        select c.user_id, case c.source_app when 'safetyreport' then 'pc' else 'mobile' end, c.platform, c.last_client_version
          from private.community_connections c join people using (user_id)
         where c.last_seen_at >= now() - interval '30 days' and c.last_client_version is not null),
    rows as (
        select app, platform, version, count(distinct user_id)::int users,
               case when jsonb_typeof(r->'min_version'->app) = 'null' then false
                    else coalesce(private.community_version_cmp(version, r->'min_version'->>app) < 0, false) end below,
               private.community_version_parts(version) is null unparseable
          from seen group by app, platform, version)
    select jsonb_build_object(
        'population', (select count(*) from people),
        'rows', coalesce((select jsonb_agg(jsonb_build_object('app', app, 'platform', platform, 'version', version, 'users', users,
                    'below', below, 'unparseable', unparseable) order by app, platform, users desc, version) from rows), '[]'::jsonb),
        'below_users', jsonb_build_object(
            'pc', (select count(distinct user_id) from seen where app = 'pc' and jsonb_typeof(r->'min_version'->'pc') = 'string'
                     and coalesce(private.community_version_cmp(version, r->'min_version'->>'pc') < 0, false)),
            'mobile', (select count(distinct user_id) from seen where app = 'mobile' and jsonb_typeof(r->'min_version'->'mobile') = 'string'
                     and coalesce(private.community_version_cmp(version, r->'min_version'->>'mobile') < 0, false))),
        'map_web_blocked_users', case when jsonb_typeof(r->'min_version'->'pc') = 'null' and jsonb_typeof(r->'min_version'->'mobile') = 'null' then 0
            else (select count(*) from people p where not private.community_user_meets_requirement(p.user_id, r)) end));
end $$;

-- Announcement document = contracts/app-announcements/announcement.schema.json. Drafts only (published rows are frozen:
-- change the content under a new id).
create function ops.announcement_save(p_actor uuid, p_doc jsonb) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_id text; v_old private.app_announcements%rowtype;
begin
    perform private.ops_require_admin(p_actor, 'announcement_save');
    if jsonb_typeof(p_doc) <> 'object' or (select array_agg(x order by x) from jsonb_object_keys(p_doc) x) is distinct from
       array['audience','body','ends_at','id','primary_action','priority','snooze_days','starts_at','title'] then
        raise exception 'invalid_announcement' using errcode = '22023';
    end if;
    if jsonb_typeof(p_doc->'id') <> 'string' or jsonb_typeof(p_doc->'title') <> 'string' or jsonb_typeof(p_doc->'body') <> 'string'
       or jsonb_typeof(p_doc->'snooze_days') <> 'number' or jsonb_typeof(p_doc->'priority') <> 'number'
       or jsonb_typeof(p_doc->'starts_at') not in ('null','string') or jsonb_typeof(p_doc->'ends_at') not in ('null','string')
       or jsonb_typeof(p_doc->'primary_action') not in ('null','object') or jsonb_typeof(p_doc->'audience') <> 'object'
       or (jsonb_typeof(p_doc->'starts_at') = 'string' and (p_doc->>'starts_at') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$')
       or (jsonb_typeof(p_doc->'ends_at') = 'string' and (p_doc->>'ends_at') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$') then
        raise exception 'invalid_announcement' using errcode = '22023';
    end if;
    v_id := p_doc->>'id';
    select * into v_old from private.app_announcements where id = v_id for update;
    if v_old.id is not null and v_old.published_at is not null then raise exception 'announcement_published' using errcode = '55000'; end if;
    begin
        insert into private.app_announcements(id, title, body, primary_action, snooze_days, starts_at, ends_at, priority, audience)
        values (v_id, p_doc->>'title', p_doc->>'body', case when jsonb_typeof(p_doc->'primary_action') = 'null' then null else p_doc->'primary_action' end,
                (p_doc->>'snooze_days')::integer, (p_doc->>'starts_at')::timestamptz, (p_doc->>'ends_at')::timestamptz,
                (p_doc->>'priority')::integer, p_doc->'audience')
        on conflict (id) do update set title = excluded.title, body = excluded.body, primary_action = excluded.primary_action,
            snooze_days = excluded.snooze_days, starts_at = excluded.starts_at, ends_at = excluded.ends_at, priority = excluded.priority,
            audience = excluded.audience, updated_at = now();
    exception when check_violation or not_null_violation or invalid_text_representation or invalid_datetime_format
                   or datetime_field_overflow or numeric_value_out_of_range then
        raise exception 'invalid_announcement' using errcode = '22023';
    end;
    return (select to_jsonb(a) from private.app_announcements a where a.id = v_id);
end $$;

create function ops.announcement_delete(p_actor uuid, p_id text) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v private.app_announcements%rowtype;
begin
    perform private.ops_require_admin(p_actor, 'announcement_delete');
    select * into v from private.app_announcements where id = p_id for update;
    if v.id is null then raise exception 'announcement_not_found' using errcode = 'P0002'; end if;
    if v.published_at is not null then raise exception 'announcement_published' using errcode = '55000'; end if;
    delete from private.app_announcements where id = p_id;
    return jsonb_build_object('deleted', p_id);
end $$;

create function ops.announcement_publish(p_actor uuid, p_id text) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v private.app_announcements%rowtype;
begin
    perform private.ops_require_admin(p_actor, 'announcement_publish');
    select * into v from private.app_announcements where id = p_id for update;
    if v.id is null then raise exception 'announcement_not_found' using errcode = 'P0002'; end if;
    if v.published_at is not null then raise exception 'announcement_published' using errcode = '55000'; end if;
    if v.ends_at is not null and v.ends_at <= now() then raise exception 'announcement_expired' using errcode = '22023'; end if;
    update private.app_announcements set published_at = now(), updated_at = now() where id = p_id;
    return (select to_jsonb(a) from private.app_announcements a where a.id = p_id);
end $$;

create function ops.announcement_end(p_actor uuid, p_id text) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v private.app_announcements%rowtype;
begin
    perform private.ops_require_admin(p_actor, 'announcement_end');
    select * into v from private.app_announcements where id = p_id for update;
    if v.id is null then raise exception 'announcement_not_found' using errcode = 'P0002'; end if;
    if v.published_at is null then raise exception 'announcement_not_published' using errcode = '55000'; end if;
    if v.ended_at is null then update private.app_announcements set ended_at = now(), updated_at = now() where id = p_id; end if;
    return (select to_jsonb(a) from private.app_announcements a where a.id = p_id);
end $$;

create function ops.announcement_list(p_actor uuid) returns jsonb language plpgsql volatile security definer set search_path='' as $$
begin
    perform private.ops_require_admin(p_actor, null);
    return coalesce((select jsonb_agg(to_jsonb(a) || jsonb_build_object('state', case
            when a.published_at is null then 'draft'
            when a.ended_at is not null then 'ended'
            when a.ends_at is not null and a.ends_at <= now() then 'expired'
            when coalesce(a.starts_at, a.published_at) > now() then 'scheduled'
            else 'live' end) order by a.created_at desc, a.id) from private.app_announcements a), '[]'::jsonb);
end $$;

-- ── 2-15 dashboard: one classification function (docs/implementation/backfill-resume-20261022/OPS-DB-API.md) ────────
-- People = Kakao accounts with a non-revoked consent grant. Each person falls into the FIRST matching category:
--   reconsent  (active grant is not the current policy)
--   old_app    (current policy, but the newest seen app version is below the raw-capable version, or v1-only with no raw)
--   not_tried  (current policy, 0 raw rows, no progress report) — sub reason from the setup stage (2-7)
--   stuck      (backfill paused/holds/waiting_optimize/none, official login needs the user, or running but no report for p_stale_hours, or no reports at
--               all while raw rows exist and the connection was last seen more than p_stale_hours ago)
--   uploading  (listing/filling/uploading with a report inside p_stale_hours; or raw rows, no reports, seen recently)
--   done       (backfill done) — done_latest / done_old against p_latest_pc / p_latest_mobile
-- Single pass over raw/facts (grouped counts), indexes: community_raw_contributor_key, facts PK (contributor_id first),
-- community_connections_user, client_seen PK, setup_progress PK.
create function ops.upload_overview(p_actor uuid, p_stale_hours integer default 24, p_min_raw_pc text default '3.6.0',
    p_min_raw_mobile text default '2.5.0', p_latest_pc text default null, p_latest_mobile text default null) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare v_policy private.community_policies%rowtype; v_stale interval; v_rows jsonb;
begin
    perform private.ops_require_admin(p_actor, null);
    if p_stale_hours is null or p_stale_hours not between 1 and 720 then raise exception 'invalid_stale_hours' using errcode = '22023'; end if;
    if private.community_version_parts(p_min_raw_pc) is null or private.community_version_parts(p_min_raw_mobile) is null
       or (p_latest_pc is not null and private.community_version_parts(p_latest_pc) is null)
       or (p_latest_mobile is not null and private.community_version_parts(p_latest_mobile) is null) then
        raise exception 'invalid_version' using errcode = '22023';
    end if;
    v_stale := make_interval(hours => p_stale_hours);
    select p.* into v_policy from private.community_policies p join private.community_policy_current c on c.version = p.version where c.singleton;
    with g as (
        select g.user_id, g.policy_version, g.granted_via, g.granted_at, private.community_grant_is_current(g, v_policy) as current
          from private.community_consent_grants g where g.revoked_at is null),
    conn as (
        select distinct on (c.user_id) c.user_id, c.source_app, c.source_mode, c.platform, c.last_contract, c.last_client_version,
               c.last_seen_at, c.last_progress, c.last_progress_at
          from private.community_connections c join g using (user_id)
         where c.status = 'active'
         order by c.user_id, coalesce(c.last_progress_at, c.last_seen_at, c.created_at) desc, c.connection_id),
    seen as (
        select distinct on (s.user_id) s.user_id, s.app, s.platform, s.version, s.last_seen_at
          from private.community_client_seen s join g using (user_id) order by s.user_id, s.last_seen_at desc, s.app, s.platform),
    raw as (select r.contributor_id user_id, count(*)::int n from private.community_report_raw r group by r.contributor_id),
    facts as (select f.contributor_id user_id, count(*)::int n from private.community_report_facts f where f.public_state = 'completed' group by f.contributor_id),
    base as (
        select g.user_id, g.policy_version, g.granted_via, g.current, conn.source_mode, conn.last_contract,
               conn.last_seen_at conn_seen, conn.last_progress p, conn.last_progress_at p_at,
               sp.mode setup_mode, sp.stage, sp.reason setup_reason, sp.client setup_client, sp.updated_at setup_at,
               coalesce(raw.n, 0) raw_n, coalesce(facts.n, 0) fact_n,
               -- newest known app: connection version vs client sighting, whichever was seen last
               case when seen.user_id is not null and (conn.user_id is null or conn.last_client_version is null
                         or coalesce(seen.last_seen_at, '-infinity') >= coalesce(conn.last_seen_at, '-infinity')) then seen.app
                    when conn.user_id is not null then case conn.source_app when 'safetyreport' then 'pc' else 'mobile' end
                    when sp.user_id is not null then case sp.source_app when 'safetyreport' then 'pc' else 'mobile' end end app,
               case when seen.user_id is not null and (conn.user_id is null or conn.last_client_version is null
                         or coalesce(seen.last_seen_at, '-infinity') >= coalesce(conn.last_seen_at, '-infinity')) then seen.platform
                    when conn.user_id is not null then conn.platform else sp.platform end platform,
               case when seen.user_id is not null and (conn.user_id is null or conn.last_client_version is null
                         or coalesce(seen.last_seen_at, '-infinity') >= coalesce(conn.last_seen_at, '-infinity')) then seen.version
                    when conn.user_id is not null then conn.last_client_version else sp.client_version end version,
               greatest(seen.last_seen_at, conn.last_seen_at, conn.last_progress_at, sp.updated_at) last_seen
          from g left join conn using (user_id) left join seen using (user_id) left join raw using (user_id) left join facts using (user_id)
          left join private.community_setup_progress sp on sp.user_id = g.user_id),
    cls as (
        select b.*, b.p->'backfill'->>'state' st, b.p->>'official_login' login,
               case b.app when 'pc' then p_min_raw_pc when 'mobile' then p_min_raw_mobile end min_raw,
               case b.app when 'pc' then p_latest_pc when 'mobile' then p_latest_mobile end latest
          from base b),
    decided as (
        select c.*,
          case
            when not c.current then 'reconsent'
            when coalesce(private.community_version_cmp(c.version, c.min_raw) < 0, false)
                 or (c.last_contract = 'community-ingest-v1' and c.raw_n = 0) then 'old_app'
            when c.raw_n = 0 and c.p_at is null then 'not_tried'
            when c.p_at is not null and c.st = 'done' then 'done'
            -- a manual official login blocks listing/filling whatever the state says
            when c.p_at is not null and c.login = 'manual_required' then 'stuck'
            when c.p_at is not null and c.st in ('listing','filling','uploading') and c.p_at >= now() - v_stale then 'uploading'
            when c.p_at is not null then 'stuck'
            when c.conn_seen is not null and c.conn_seen >= now() - v_stale then 'uploading'
            else 'stuck' end category
          from cls c),
    reasoned as (
        select d.*,
          case d.category
            when 'reconsent' then case when d.last_contract = 'community-ingest-v1' then 'last_contract_v1' else 'policy_outdated' end
            when 'old_app' then case when coalesce(private.community_version_cmp(d.version, d.min_raw) < 0, false) then 'version_below_raw' else 'v1_only' end
            when 'not_tried' then case
                when d.stage is null then 'no_record'
                when d.setup_mode = 'client' and d.stage = 'client_server_checked' then case
                    when (d.setup_client->>'server_reachable')::boolean is false then 'client_server_unreachable'
                    when (d.setup_client->>'server_community_supported')::boolean is false then 'client_server_unconfigured'
                    when (d.setup_client->>'server_logged_in')::boolean is false then 'client_server_not_logged_in'
                    when (d.setup_client->>'account_match')::boolean is false then 'client_account_mismatch'
                    when (d.setup_client->>'server_consent_active')::boolean is false then 'client_server_no_consent'
                    else 'client_server_ok' end
                when d.stage in ('kakao_ok','consent_ok','official_login_started') then 'before_official_login'
                when d.stage = 'official_login_failed' then 'official_login_failed'
                when d.stage = 'official_login_ok' then 'before_connection'
                else 'connection_registered' end
            when 'stuck' then case
                when d.p_at is null then 'no_progress_report'
                when d.login = 'manual_required' then 'official_login_required'
                when d.st = 'waiting_optimize' then 'optimize_wait'
                when d.st = 'paused' then 'transient_errors'
                when d.st = 'holds' then 'holds'
                when d.st = 'none' then 'not_started'
                else 'report_gap' end
            when 'uploading' then case when d.p_at is null then 'no_progress_report' else 'reporting' end
            when 'done' then case when d.latest is null or private.community_version_cmp(d.version, d.latest) is null then 'done_version_unknown'
                                  when private.community_version_cmp(d.version, d.latest) >= 0 then 'done_latest' else 'done_old' end
          end sub_reason
          from decided d)
    select jsonb_agg(jsonb_build_object(
            'pseudo_id', private.ops_pseudo(r.user_id), 'category', r.category, 'sub_reason', r.sub_reason,
            'detail', case
                when r.category = 'not_tried' and r.stage = 'official_login_failed' then r.setup_reason
                when r.category = 'stuck' and r.sub_reason = 'holds' then r.p->'backfill'->>'holds'
                when r.category = 'stuck' then r.p->'backfill'->>'reason' end,
            'app', r.app, 'platform', r.platform, 'version', r.version,
            'mode', coalesce(r.setup_mode, r.source_mode), 'last_seen_at', r.last_seen,
            'raw_count', r.raw_n, 'fact_count', r.fact_n,
            'progress', case when r.p is null then null else jsonb_build_object('state', r.st, 'stored', r.p->'backfill'->'stored',
                'total', r.p->'backfill'->'total', 'holds', r.p->'backfill'->'holds', 'reason', r.p->'backfill'->>'reason') end,
            'last_progress_at', r.p_at, 'last_contract', r.last_contract,
            'consent', jsonb_build_object('policy_version', r.policy_version, 'current', r.current, 'via', r.granted_via))
            order by r.category, r.last_seen desc nulls last, private.ops_pseudo(r.user_id))
      into v_rows from reasoned r;
    v_rows := coalesce(v_rows, '[]'::jsonb);
    return jsonb_build_object(
        'generated_at', now(),
        'params', jsonb_build_object('stale_hours', p_stale_hours, 'min_raw_pc', p_min_raw_pc, 'min_raw_mobile', p_min_raw_mobile,
                                     'latest_pc', p_latest_pc, 'latest_mobile', p_latest_mobile),
        'summary', jsonb_build_object(
            'people', jsonb_array_length(v_rows),
            'categories', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (select x->>'category' k, count(*) n from jsonb_array_elements(v_rows) x group by 1) s),
            'by_app', (select coalesce(jsonb_object_agg(a, o), '{}'::jsonb) from (
                select coalesce(x->>'app', 'unknown') a, jsonb_build_object('people', count(*),
                    'raw_count', sum((x->>'raw_count')::int), 'fact_count', sum((x->>'fact_count')::int)) o
                  from jsonb_array_elements(v_rows) x group by 1) s),
            'raw_total', (select count(*) from private.community_report_raw),
            'fact_total', (select count(*) from private.community_report_facts where public_state = 'completed')),
        'rows', v_rows);
end $$;

-- Detail for one row of the dashboard (by pseudonymous id). No Kakao name, official id, dataset, device label, report.
create function ops.user_detail(p_actor uuid, p_pseudo_id text) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_user uuid; v_n integer;
begin
    perform private.ops_require_admin(p_actor, null);
    if p_pseudo_id is null or p_pseudo_id !~ '^[0-9a-f]{8}$' then raise exception 'invalid_pseudo_id' using errcode = '22023'; end if;
    select count(*), min(u.user_id::text)::uuid into v_n, v_user
      from (select distinct g.user_id from private.community_consent_grants g) u where private.ops_pseudo(u.user_id) = p_pseudo_id;
    if v_n = 0 then raise exception 'not_found' using errcode = 'P0002'; end if;
    if v_n > 1 then raise exception 'ambiguous_pseudo_id' using errcode = '21000'; end if;
    return jsonb_build_object(
        'pseudo_id', p_pseudo_id,
        'consents', coalesce((select jsonb_agg(jsonb_build_object('policy_version', g.policy_version, 'via', g.granted_via,
                'granted_at', g.granted_at, 'revoked_at', g.revoked_at, 'revoke_reason', g.revoke_reason) order by g.granted_at desc)
            from private.community_consent_grants g where g.user_id = v_user), '[]'::jsonb),
        'connections', coalesce((select jsonb_agg(jsonb_build_object('source_app', c.source_app, 'source_mode', c.source_mode,
                'platform', c.platform, 'status', c.status, 'created_at', c.created_at, 'last_contract', c.last_contract,
                'last_client_version', c.last_client_version, 'last_parser_version', c.last_parser_version, 'last_seen_at', c.last_seen_at,
                'last_progress_at', c.last_progress_at, 'last_progress', c.last_progress) order by c.created_at desc)
            from private.community_connections c where c.user_id = v_user), '[]'::jsonb),
        'progress_history', coalesce((select jsonb_agg(jsonb_build_object('received_at', h.received_at, 'progress', h.progress) order by h.received_at desc)
            from (select * from private.community_progress_history h where h.user_id = v_user order by h.received_at desc limit 100) h), '[]'::jsonb),
        'setup_progress', (select to_jsonb(s) - 'user_id' from private.community_setup_progress s where s.user_id = v_user),
        'apps_seen', coalesce((select jsonb_agg(jsonb_build_object('app', s.app, 'platform', s.platform, 'version', s.version,
                'first_seen_at', s.first_seen_at, 'last_seen_at', s.last_seen_at) order by s.last_seen_at desc)
            from private.community_client_seen s where s.user_id = v_user), '[]'::jsonb),
        'raw_count', (select count(*) from private.community_report_raw r where r.contributor_id = v_user),
        'fact_count', (select count(*) from private.community_report_facts f where f.contributor_id = v_user and f.public_state = 'completed'));
end $$;

-- Only community_ops may run the console functions; nothing else in schema ops.
do $$
declare f text;
begin
    foreach f in array array[
        'ops.whoami(uuid)', 'ops.overview(uuid)', 'ops.audit_list(uuid, integer, timestamptz)',
        'ops.pause_uploads(uuid, text, timestamptz)', 'ops.resume_uploads(uuid)',
        'ops.set_client_requirement(uuid, text, text, text, text, text, timestamptz)', 'ops.clear_client_requirement(uuid)',
        'ops.requirement_impact(uuid, text, text)',
        'ops.announcement_save(uuid, jsonb)', 'ops.announcement_delete(uuid, text)', 'ops.announcement_publish(uuid, text)',
        'ops.announcement_end(uuid, text)', 'ops.announcement_list(uuid)',
        'ops.upload_overview(uuid, integer, text, text, text, text)', 'ops.user_detail(uuid, text)'] loop
        execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
        execute format('grant execute on function %s to community_ops', f);
    end loop;
end $$;

commit;
