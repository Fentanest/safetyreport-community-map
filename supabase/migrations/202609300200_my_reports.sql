-- Private, owner-scoped completed reports for the browser extension.
-- Apply after the community fact/identity/rating migrations. Never expose this RPC to a browser role.
begin;

create index if not exists community_report_facts_my_reports_owner
  on private.community_report_facts(contributor_id, source_report_key, completed_date desc)
  where public_state = 'completed';

create or replace function public.internal_my_reports(
  p_user uuid, p_session uuid, p_mode text, p_kind text, p_query text,
  p_offset integer, p_limit integer, p_expected_version text default null)
returns jsonb language plpgsql stable security definer set search_path = '' set statement_timeout = '5s' as $$
declare
  v_identity jsonb;
  v_profile_status text;
  v_version text;
  v_total integer;
  v_missing integer;
  v_page_total integer;
  v_recent integer;
  v_summary jsonb;
  v_managers jsonb;
  v_manager_total integer;
  v_items jsonb;
  v_today date := (now() at time zone 'Asia/Seoul')::date;
begin
  if p_user is null or p_session is null or p_mode not in ('summary','search','numbers')
     or p_offset is null or p_offset < 0 or p_offset > 5000
     or p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'INVALID_QUERY';
  end if;
  if p_mode = 'summary' then
    if p_kind is not null or p_query is not null then raise exception 'INVALID_QUERY'; end if;
  elsif p_kind not in ('vehicle','address') or p_query is null then
    raise exception 'INVALID_QUERY';
  elsif p_kind = 'vehicle' and (char_length(p_query) < 6 or char_length(p_query) > 64
        or p_query <> regexp_replace(normalize(p_query, NFC), '[[:space:]]+', '', 'g')) then
    raise exception 'INVALID_QUERY';
  elsif p_kind = 'address' and (char_length(p_query) < 5 or char_length(p_query) > 200) then
    raise exception 'INVALID_QUERY';
  end if;

  v_identity := private.community_identity_state(p_user, p_session);
  if not coalesce((v_identity->>'user_ok')::boolean, false)
     or not coalesce((v_identity->>'kakao')::boolean, false)
     or not coalesce((v_identity->>'session')::boolean, false) then
    raise exception 'ACCOUNT_INELIGIBLE';
  end if;
  select status into v_profile_status from private.contributor_profiles where user_id = p_user;
  if v_profile_status is not null and v_profile_status <> 'active' then
    raise exception 'ACCOUNT_INELIGIBLE';
  end if;

  -- Identity is elected AFTER owner scoping. Public-map representative rows can belong to another user.
  -- The key number comes from all active owner observations, before a vehicle/address filter.
  with owner_history as materialized (
    select f.* from private.community_report_facts f
    where f.contributor_id = p_user and v_profile_status = 'active' and f.public_state = 'completed'
      and private.community_lineage_active(f.consent_grant_id)
  ), mine as materialized (
    select * from owner_history where (report_date is not null or completed_date is not null)
      and status in ('accepted','partial','rejected','completed_unknown')
  ), key_numbers as (
    select distinct on (source_report_key) source_report_key, report_number as key_number
    from owner_history where report_number is not null
    order by source_report_key,first_accepted_at,dataset_key
  ), identified as (
    select f.*, f.source_report_key || '|' || coalesce(f.report_number,k.key_number,'legacy') as report_identity
    from mine f left join key_numbers k using (source_report_key)
  ), elected as (
    select i.*, row_number() over (
      partition by report_identity order by answer_accepted_at desc, completed_date desc nulls last,
      first_accepted_at asc, dataset_key asc) as identity_rank
    from identified i
  ), selected as materialized (
    select * from elected e where identity_rank = 1 and (
      p_mode = 'summary' or
      (p_kind = 'vehicle' and position(p_query in regexp_replace(normalize(coalesce(vehicle_raw,''),NFC),'[[:space:]]+','','g')) > 0) or
      (p_kind = 'address' and regexp_replace(trim(coalesce(address,'')),'[[:space:]]+',' ','g') =
        regexp_replace(trim(p_query),'[[:space:]]+',' ','g')))
  ), stats as (
    select count(*)::integer as total,
      count(*) filter (where status='accepted')::integer as accepted,
      count(*) filter (where status='partial')::integer as partial,
      count(*) filter (where status='rejected')::integer as rejected,
      count(*) filter (where status='completed_unknown')::integer as completed_unknown,
      count(*) filter (where completed_date between v_today - 2 and v_today)::integer as recent_count,
      count(*) filter (where disposition='fine')::integer as fine,
      count(*) filter (where disposition='warning')::integer as warning,
      count(*) filter (where disposition='penalty')::integer as penalty,
      count(*) filter (where disposition='none')::integer as disposition_none,
      count(*) filter (where disposition='unknown')::integer as disposition_unknown,
      coalesce(sum(amount_confirmed_won) filter (where disposition='fine' and amount_kind='fine'),0)::bigint as confirmed_fine_won,
      count(*) filter (where disposition='fine' and amount_kind='fine' and amount_confirmed_won is not null)::integer as confirmed_fine_count,
      count(*) filter (where report_number is null)::integer as missing_numbers
    from selected
  ), versions as (
    select md5(coalesce(string_agg(report_identity || ':' || updated_at::text, '|' order by report_identity),'')) as version from selected
  ), manager_groups as materialized (
      select agency_key, agency_name as agency_name_original, agency_current_name, manager_key, manager_name,
        count(*)::integer as total,
        count(*) filter (where status='accepted')::integer as accepted,
        count(*) filter (where status='partial')::integer as partial,
        count(*) filter (where status='rejected')::integer as rejected,
        count(*) filter (where disposition='fine')::integer as fine,
        coalesce(sum(amount_confirmed_won) filter (where disposition='fine' and amount_kind='fine'),0)::bigint as confirmed_fine_won
      from selected where manager_name is not null
      group by agency_key,agency_name,agency_current_name,manager_key,manager_name
  ), managers as (
    select coalesce(jsonb_agg(to_jsonb(m) order by m.total desc,m.agency_key,m.manager_key),'[]'::jsonb) as value,
      (select count(*)::integer from manager_groups) as total
    from (select * from manager_groups order by total desc,agency_key,manager_key limit 100) m
  ), page as (
    select * from selected where (p_mode <> 'summary' or completed_date between v_today - 2 and v_today)
      and (p_mode <> 'numbers' or report_number is not null)
    order by completed_date desc nulls last,report_date desc nulls last,report_identity
    limit p_limit offset p_offset
  ), records as (
    select coalesce(jsonb_agg(
      case when p_mode='numbers' then jsonb_build_object('report_number',report_number)
      else jsonb_build_object(
        'report_number',report_number,'source_report_id',source_report_id,'vehicle_number',vehicle_raw,
        'report_date',report_date,'completed_date',completed_date,'category',category,'status',status,
        'disposition',disposition,'amount_kind',amount_kind,'confirmed_amount_won',amount_confirmed_won,
        'penalty_points',penalty_points,'address',address,'lat',lat,'lng',lng,
        'agency_key',agency_key,'agency_name_original',agency_name,'agency_name_current',agency_current_name,
        'manager_key',manager_key,'manager_name',manager_name,'violation_law',violation_law,'rating',rating)
      end order by completed_date desc nulls last,report_date desc nulls last,report_identity
    ),'[]'::jsonb) as value from page
  )
  select versions.version, stats.total, stats.missing_numbers,stats.recent_count,
    to_jsonb(stats) - 'missing_numbers', managers.value,managers.total, records.value
    into v_version,v_total,v_missing,v_recent,v_summary,v_managers,v_manager_total,v_items
    from versions cross join stats cross join managers cross join records;

  if p_expected_version is not null and p_expected_version <> v_version then
    raise exception 'DATASET_CHANGED';
  end if;
  v_page_total := case when p_mode='numbers' then v_total-v_missing when p_mode='summary' then v_recent else v_total end;
  return jsonb_build_object('version',v_version,'total',v_total,'missing_numbers',v_missing,
    'summary',v_summary,'managers',case when p_mode='numbers' then '[]'::jsonb else v_managers end,
    'manager_total',v_manager_total,'managers_truncated',v_manager_total > 100,
    'items',v_items,'next_offset',case when p_offset + jsonb_array_length(v_items) < v_page_total
      then p_offset + jsonb_array_length(v_items) else null end);
end;
$$;

revoke all on function public.internal_my_reports(uuid,uuid,text,text,text,integer,integer,text) from public,anon,authenticated;
grant execute on function public.internal_my_reports(uuid,uuid,text,text,text,integer,integer,text) to service_role;
commit;
