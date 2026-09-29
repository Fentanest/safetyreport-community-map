-- my-reports-v1 (contracts/my-reports/README.md): the Chrome extension's read-only view of the signed-in user's
-- OWN completed reports. Owner: safetyreport-community-map. Depends on 202610010100 and the AUTH registry
-- (private.community_identity_state, private.community_lineage_active, community_consent_grants).
--
-- Order (contract §1.3): verified account → the user's own consent-active completed uploads → identity and
-- representative elected INSIDE that own set (another account's observation never elects, fills a number or
-- hides a row) → search condition on the representative → full-scope aggregates and the page. Everything is
-- computed here; the Edge function receives only the page, the aggregates and a version hash.
--
-- Additive only: one composite type, private helpers and three service_role-only RPCs. No table, trigger, upload,
-- consent or public-analytics change. No index: the per-user scan uses the existing primary key
-- (contributor_id, dataset_key, source_report_key) — docs/integration/chromeextension/MEASUREMENTS.md.
--
-- Supersedes 202609300200_my_reports.sql (first offset-based draft on main): its public.internal_my_reports is dropped
-- here whether or not that migration was applied; its owner index is kept (harmless, measured in MEASUREMENTS.md).
--
-- Rollback: drop the three public.internal_my_reports_* functions, then the private.my_reports_* functions and the
-- private.my_reports_row type (nothing else depends on them).

begin;

drop function if exists public.internal_my_reports(uuid, uuid, text, text, text, integer, integer, text);

-- Normalisation, byte-identical to contracts/my-reports/types.ts (WHITESPACE = JS `\s`).
create or replace function private.my_reports_norm_vehicle(p text)
returns text language sql immutable parallel safe set search_path = '' as $$
    select regexp_replace(normalize(p, NFC),
        '[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]', '', 'g');
$$;

create or replace function private.my_reports_norm_address(p text)
returns text language sql immutable parallel safe set search_path = '' as $$
    select btrim(regexp_replace(normalize(p, NFC),
        '[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+', ' ', 'g'), ' ');
$$;

-- same-address key: the normalised address without ONE trailing " (…)" reference group
create or replace function private.my_reports_address_base(p text)
returns text language sql immutable parallel safe set search_path = '' as $$
    select regexp_replace(private.my_reports_norm_address(p), '^(.*[^ ]) \([^()]*\)$', '\1');
$$;

create type private.my_reports_row as (
    identity text,
    report_number text,
    source_report_id text,
    vehicle_raw text,
    report_date date,
    completed_date date,
    category text,
    status text,
    disposition text,
    amount_kind text,
    amount_confirmed_won bigint,
    penalty_points integer,
    address text,
    lat double precision,
    lng double precision,
    agency_key text,
    agency_name text,
    agency_current_name text,
    manager_key text,
    manager_name text,
    violation_law text,
    rating integer
);

-- The user's own representative completed reports (one row per report identity, no search condition).
create or replace function private.my_reports_own(p_user uuid)
returns setof private.my_reports_row language sql stable security definer set search_path = '' as $$
    with grants as (
        select g.grant_id, private.community_lineage_active(g.grant_id) as active
          from (select distinct f.consent_grant_id as grant_id
                  from private.community_report_facts f where f.contributor_id = p_user) g
    ),
    own as (
        select f.*
          from private.community_report_facts f
          join grants g on g.grant_id = f.consent_grant_id and g.active
         where f.contributor_id = p_user
           and f.public_state = 'completed'
           and f.status in ('accepted', 'partial', 'rejected', 'completed_unknown')
    ),
    -- the number a key was first seen with, over the user's own consent-active completed history only
    key_numbers as (
        select distinct on (o.source_report_key) o.source_report_key, o.report_number as key_number
          from own o
         order by o.source_report_key, (o.report_number is null), o.first_accepted_at, o.dataset_key
    ),
    identified as (
        select o.*,
               o.source_report_key || '|' || coalesce(o.report_number, k.key_number, 'legacy') as rid,
               max(o.answer_accepted_at) over (
                   partition by o.source_report_key, coalesce(o.report_number, k.key_number, 'legacy'), o.payload_sha256
               ) as answer_time
          from own o join key_numbers k using (source_report_key)
    ),
    ranked as (
        select i.*,
               row_number() over (partition by i.rid
                                  order by i.answer_time desc, i.completed_date desc nulls last,
                                           i.first_accepted_at, i.dataset_key) as rn
          from identified i
    )
    select (r.rid, r.report_number, r.source_report_id, r.vehicle_raw, r.report_date, r.completed_date, r.category,
            r.status, r.disposition, r.amount_kind, r.amount_confirmed_won, r.penalty_points, r.address, r.lat, r.lng,
            r.agency_key, r.agency_name, r.agency_current_name, r.manager_key, r.manager_name, r.violation_law,
            r.rating)::private.my_reports_row
      from ranked r
     where r.rn = 1;
$$;

-- Aggregates of a set of reports (contract §5). One definition for the whole scope, a recent window and a manager.
create or replace function private.my_reports_stats(p private.my_reports_row[])
returns jsonb language sql immutable set search_path = '' as $$
    with r as (
        select u.*,
               (u.disposition = 'fine' and u.amount_kind = 'fine' and u.status in ('accepted', 'partial')
                and u.amount_confirmed_won is not null) as confirmed
          from unnest(coalesce(p, '{}'::private.my_reports_row[])) u
    )
    select jsonb_build_object(
        'total', count(*),
        'status', jsonb_build_object(
            'accepted', count(*) filter (where status = 'accepted'),
            'partial', count(*) filter (where status = 'partial'),
            'rejected', count(*) filter (where status = 'rejected'),
            'completed_unknown', count(*) filter (where status = 'completed_unknown')),
        'accept_rate', case when count(*) = 0 then null
                            else round(count(*) filter (where status = 'accepted') * 100.0 / count(*), 1) end,
        'disposition', jsonb_build_object(
            'fine', count(*) filter (where disposition = 'fine'),
            'warning', count(*) filter (where disposition = 'warning'),
            'penalty', count(*) filter (where disposition = 'penalty'),
            'none', count(*) filter (where disposition = 'none'),
            'unknown', count(*) filter (where disposition = 'unknown')),
        'fine_amount', jsonb_build_object(
            'fine_count', count(*) filter (where disposition = 'fine'),
            'confirmed_count', count(*) filter (where confirmed),
            'confirmed_sum_won', (sum(amount_confirmed_won) filter (where confirmed))::bigint,
            'unconfirmed_count', count(*) filter (where disposition = 'fine' and amount_confirmed_won is null),
            'other_count', count(*) filter (where disposition = 'fine' and amount_confirmed_won is not null and not confirmed)),
        'category', jsonb_build_object(
            'traffic', count(*) filter (where category = 'traffic'),
            'parking', count(*) filter (where category = 'parking'),
            'other', count(*) filter (where category = 'other')),
        'completed_date_missing', count(*) filter (where completed_date is null))
      from r;
$$;

-- The row as the SQL half of the DTO (the Edge adds status_label and official_url from its allowlist).
create or replace function private.my_reports_row_json(r private.my_reports_row)
returns jsonb language sql immutable set search_path = '' as $$
    select jsonb_build_object(
        'report_number', r.report_number, 'source_report_id', r.source_report_id,
        'vehicle_number', r.vehicle_raw, 'report_date', r.report_date, 'completed_date', r.completed_date,
        'category', r.category, 'status', r.status, 'disposition', r.disposition,
        'amount_kind', r.amount_kind, 'confirmed_amount_won', r.amount_confirmed_won,
        'penalty_points', r.penalty_points, 'address', r.address, 'lat', r.lat, 'lng', r.lng,
        'agency_key', r.agency_key, 'agency_name_original', r.agency_name,
        'agency_name_current', r.agency_current_name, 'manager_key', r.manager_key,
        'manager_name', r.manager_name, 'violation_law', r.violation_law, 'rating', r.rating);
$$;

-- Personal data version: every returned field of every own report + the identity + the account state.
-- Another account's upload cannot change it; a content/rating/amount/agency/manager/number/consent change does.
create or replace function private.my_reports_version(p private.my_reports_row[], p_contributor text)
returns text language sql immutable set search_path = '' as $$
    select left(encode(sha256(convert_to(
        coalesce((select string_agg(to_jsonb(u)::text, E'\n' order by u.identity collate "C")
                    from unnest(coalesce(p, '{}'::private.my_reports_row[])) u), '')
        || E'\n#' || coalesce(p_contributor, ''), 'UTF8')), 'hex'), 32);
$$;

-- Account gate, re-checked on every request (cursor pages and number copies included).
create or replace function private.my_reports_gate(p_user uuid, p_session uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
    v_id jsonb;
    v_profile private.contributor_profiles%rowtype;
    v_contributor text;
begin
    v_id := private.community_identity_state(p_user, p_session);
    select * into v_profile from private.contributor_profiles where user_id = p_user;
    v_contributor := case
        when v_profile.user_id is null then 'none'
        when v_profile.status <> 'active' then 'suspended'
        when exists (select 1 from private.community_consent_grants g where g.user_id = p_user and g.revoked_at is null) then 'active'
        when exists (select 1 from private.community_consent_grants g where g.user_id = p_user) then 'revoked'
        else 'none' end;
    return jsonb_build_object(
        'error', case
            when not coalesce((v_id->>'user_ok')::boolean, false) then 'ACCOUNT_INELIGIBLE'
            when not coalesce((v_id->>'kakao')::boolean, false) then 'KAKAO_REQUIRED'
            when not coalesce((v_id->>'session')::boolean, false) then 'SESSION_EXPIRED'
            when v_contributor = 'suspended' then 'ACCOUNT_INELIGIBLE'
            else null end,
        'contributor', v_contributor);
end;
$$;

create or replace function private.my_reports_matches(r private.my_reports_row, p_kind text, p_query text)
returns boolean language sql immutable set search_path = '' as $$
    select case p_kind
        when 'vehicle' then r.vehicle_raw is not null
                            and strpos(private.my_reports_norm_vehicle(r.vehicle_raw), p_query) > 0
        when 'address' then r.address is not null
                            and private.my_reports_address_base(r.address) = private.my_reports_address_base(p_query)
        else false end;
$$;

create or replace function private.my_reports_check_query(p_kind text, p_query text)
returns text language plpgsql immutable set search_path = '' as $$
declare v text;
begin
    if p_kind = 'vehicle' then
        v := private.my_reports_norm_vehicle(p_query);
        if v is null or char_length(v) not between 6 and 64 then raise exception 'INVALID_QUERY'; end if;
    elsif p_kind = 'address' then
        v := private.my_reports_norm_address(p_query);
        if v is null or char_length(v) not between 5 and 200 then raise exception 'INVALID_QUERY'; end if;
    else
        raise exception 'INVALID_QUERY';
    end if;
    if v ~ '[\u0001-\u001f\u007f-\u009f]' then raise exception 'INVALID_QUERY'; end if;
    return v;
end;
$$;

-- Page of report rows in the contract order.
create or replace function private.my_reports_page(p private.my_reports_row[], p_offset integer, p_limit integer)
returns jsonb language sql immutable set search_path = '' as $$
    select coalesce(jsonb_agg(private.my_reports_row_json(s.x) order by s.ord), '[]'::jsonb)
      from (select u, row_number() over (order by u.completed_date desc nulls last, u.report_date desc nulls last,
                                                  u.report_number collate "C" desc nulls last, u.identity collate "C") as ord
              from unnest(coalesce(p, '{}'::private.my_reports_row[])) u) s(x, ord)
     where s.ord > p_offset and s.ord <= p_offset + p_limit;
$$;

-- Page of manager groups (agency_key, manager_key) in the contract order.
create or replace function private.my_reports_managers(p private.my_reports_row[], p_offset integer, p_limit integer)
returns jsonb language sql immutable set search_path = '' as $$
    with rows as (select u.* from unnest(coalesce(p, '{}'::private.my_reports_row[])) u where u.manager_key is not null),
    groups as (
        select g.agency_key, g.manager_key,
               private.my_reports_stats(array_agg(g::private.my_reports_row)) as st,
               (array_agg(g.manager_name order by g.completed_date desc nulls last, g.report_date desc nulls last,
                          g.identity collate "C"))[1] as manager_name,
               (array_agg(g.agency_name order by g.completed_date desc nulls last, g.report_date desc nulls last,
                          g.identity collate "C"))[1] as agency_name,
               (array_agg(g.agency_current_name order by g.completed_date desc nulls last, g.report_date desc nulls last,
                          g.identity collate "C"))[1] as agency_current_name
          from rows g
         group by g.agency_key, g.manager_key
    ),
    ordered as (
        select gr.*, row_number() over (order by (gr.st->>'total')::integer desc, gr.manager_name collate "C" nulls last,
                                                  gr.agency_key collate "C" nulls last, gr.manager_key collate "C") as ord
          from groups gr
    )
    select jsonb_build_object(
        'items', coalesce((select jsonb_agg(jsonb_build_object(
                    'agency_key', o.agency_key, 'manager_key', o.manager_key, 'manager_name', o.manager_name,
                    'agency_name_original', o.agency_name, 'agency_name_current', o.agency_current_name,
                    'total', o.st->'total', 'status', o.st->'status', 'accept_rate', o.st->'accept_rate',
                    'disposition', o.st->'disposition', 'fine_amount', o.st->'fine_amount') order by o.ord)
                  from ordered o where o.ord > p_offset and o.ord <= p_offset + p_limit), '[]'::jsonb),
        'total_managers', (select count(*) from groups),
        'unassigned_count', (select count(*) from unnest(coalesce(p, '{}'::private.my_reports_row[])) u where u.manager_key is null));
$$;

-- ---------------------------------------------------------------------------------------------- RPCs (service_role)
-- Each RPC is ONE statement over one snapshot: gate, own set, version, selection, aggregates and page.
-- A failed gate or a version mismatch returns {"error": code} and no data.

create or replace function public.internal_my_reports_search(
    p_user uuid, p_session uuid, p_kind text, p_query text,
    p_with_summary boolean, p_reports_offset integer, p_reports_limit integer,
    p_managers_offset integer, p_managers_limit integer, p_expected_version text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
    v_gate jsonb;
    v_query text;
    v_own private.my_reports_row[];
    v_sel private.my_reports_row[];
    v_version text;
    v_total integer;
begin
    if p_user is null or p_session is null or p_with_summary is null
       or (p_reports_offset is not null and (p_reports_offset < 0 or p_reports_limit is null or p_reports_limit not between 1 and 50))
       or (p_managers_offset is not null and (p_managers_offset < 0 or p_managers_limit is null or p_managers_limit not between 1 and 50)) then
        raise exception 'INVALID_QUERY';
    end if;
    v_query := private.my_reports_check_query(p_kind, p_query);
    v_gate := private.my_reports_gate(p_user, p_session);
    if v_gate->>'error' is not null then return jsonb_build_object('error', v_gate->>'error'); end if;

    select array_agg(o) into v_own from private.my_reports_own(p_user) o;
    v_version := private.my_reports_version(v_own, v_gate->>'contributor');
    if p_expected_version is not null and p_expected_version <> v_version then
        return jsonb_build_object('error', 'DATASET_CHANGED');
    end if;
    select array_agg(u) into v_sel from unnest(coalesce(v_own, '{}'::private.my_reports_row[])) u
     where private.my_reports_matches(u, p_kind, v_query);
    v_total := coalesce(cardinality(v_sel), 0);

    return jsonb_build_object(
        'contributor', v_gate->>'contributor',
        'data_version', v_version,
        'query_normalized', v_query,
        'summary', case when p_with_summary then private.my_reports_stats(v_sel) end,
        'reports', case when p_reports_offset is not null then jsonb_build_object(
            'items', private.my_reports_page(v_sel, p_reports_offset, p_reports_limit), 'total', v_total) end,
        'managers', case when p_managers_offset is not null then
            private.my_reports_managers(v_sel, p_managers_offset, p_managers_limit) end);
end;
$$;

create or replace function public.internal_my_reports_summary(
    p_user uuid, p_session uuid, p_recent_start date, p_recent_end date,
    p_with_summary boolean, p_offset integer, p_limit integer, p_expected_version text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
    v_gate jsonb;
    v_own private.my_reports_row[];
    v_recent private.my_reports_row[];
    v_version text;
begin
    if p_user is null or p_session is null or p_with_summary is null or p_recent_start is null or p_recent_end is null
       or p_recent_end - p_recent_start <> 2 or p_offset is null or p_offset < 0 or p_limit is null
       or p_limit not between 1 and 50 then
        raise exception 'INVALID_QUERY';
    end if;
    v_gate := private.my_reports_gate(p_user, p_session);
    if v_gate->>'error' is not null then return jsonb_build_object('error', v_gate->>'error'); end if;

    select array_agg(o) into v_own from private.my_reports_own(p_user) o;
    v_version := private.my_reports_version(v_own, v_gate->>'contributor');
    if p_expected_version is not null and p_expected_version <> v_version then
        return jsonb_build_object('error', 'DATASET_CHANGED');
    end if;
    -- by the official answer date only; a report without one is never "recent"
    select array_agg(u) into v_recent from unnest(coalesce(v_own, '{}'::private.my_reports_row[])) u
     where u.completed_date between p_recent_start and p_recent_end;

    return jsonb_build_object(
        'contributor', v_gate->>'contributor',
        'data_version', v_version,
        'summary', case when p_with_summary then private.my_reports_stats(v_own) end,
        'recent_summary', case when p_with_summary then private.my_reports_stats(v_recent) end,
        'recent', jsonb_build_object('items', private.my_reports_page(v_recent, p_offset, p_limit),
                                     'total', coalesce(cardinality(v_recent), 0)));
end;
$$;

create or replace function public.internal_my_reports_numbers(
    p_user uuid, p_session uuid, p_kind text, p_query text,
    p_offset integer, p_limit integer, p_max_total integer, p_expected_version text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
    v_gate jsonb;
    v_query text;
    v_own private.my_reports_row[];
    v_sel private.my_reports_row[];
    v_version text;
    v_unique integer;
begin
    if p_user is null or p_session is null or p_offset is null or p_offset < 0 or p_limit is null
       or p_limit not between 1 and 500 or p_max_total is null or p_max_total not between 1 and 100000 then
        raise exception 'INVALID_QUERY';
    end if;
    v_query := private.my_reports_check_query(p_kind, p_query);
    v_gate := private.my_reports_gate(p_user, p_session);
    if v_gate->>'error' is not null then return jsonb_build_object('error', v_gate->>'error'); end if;

    select array_agg(o) into v_own from private.my_reports_own(p_user) o;
    v_version := private.my_reports_version(v_own, v_gate->>'contributor');
    if p_expected_version is not null and p_expected_version <> v_version then
        return jsonb_build_object('error', 'DATASET_CHANGED');
    end if;
    select array_agg(u) into v_sel from unnest(coalesce(v_own, '{}'::private.my_reports_row[])) u
     where private.my_reports_matches(u, p_kind, v_query);
    select count(distinct u.report_number) into v_unique from unnest(coalesce(v_sel, '{}'::private.my_reports_row[])) u;
    if v_unique > p_max_total then return jsonb_build_object('error', 'NUMBERS_LIMIT_EXCEEDED'); end if;

    return jsonb_build_object(
        'contributor', v_gate->>'contributor',
        'data_version', v_version,
        'query_normalized', v_query,
        'matched_reports', coalesce(cardinality(v_sel), 0),
        'without_number', (select count(*) from unnest(coalesce(v_sel, '{}'::private.my_reports_row[])) u where u.report_number is null),
        'unique_numbers', v_unique,
        'items', coalesce((select jsonb_agg(n order by n collate "C" desc)
                             from (select distinct u.report_number collate "C" as n
                                     from unnest(coalesce(v_sel, '{}'::private.my_reports_row[])) u
                                    where u.report_number is not null
                                    order by n desc
                                    offset p_offset limit p_limit) x), '[]'::jsonb));
end;
$$;

do $$
declare f text;
begin
    foreach f in array array[
        'private.my_reports_norm_vehicle(text)',
        'private.my_reports_norm_address(text)',
        'private.my_reports_address_base(text)',
        'private.my_reports_own(uuid)',
        'private.my_reports_stats(private.my_reports_row[])',
        'private.my_reports_row_json(private.my_reports_row)',
        'private.my_reports_version(private.my_reports_row[], text)',
        'private.my_reports_gate(uuid, uuid)',
        'private.my_reports_matches(private.my_reports_row, text, text)',
        'private.my_reports_check_query(text, text)',
        'private.my_reports_page(private.my_reports_row[], integer, integer)',
        'private.my_reports_managers(private.my_reports_row[], integer, integer)'] loop
        execute format('revoke all on function %s from public, anon, authenticated', f);
    end loop;
    foreach f in array array[
        'public.internal_my_reports_search(uuid, uuid, text, text, boolean, integer, integer, integer, integer, text)',
        'public.internal_my_reports_summary(uuid, uuid, date, date, boolean, integer, integer, text)',
        'public.internal_my_reports_numbers(uuid, uuid, text, text, integer, integer, integer, text)'] loop
        execute format('revoke all on function %s from public, anon, authenticated', f);
        execute format('grant execute on function %s to service_role', f);
    end loop;
end $$;
revoke all on type private.my_reports_row from public;

commit;
