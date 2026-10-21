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
    -- @@PARSED_UPSERT@@
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
