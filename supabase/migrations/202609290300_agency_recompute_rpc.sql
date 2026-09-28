-- Service-role bridge for registry recompute. Keep private out of PostgREST exposed schemas.
-- The three RPCs are created in public, execute as the owner, and reveal only the
-- source/derived agency fields needed by the offline recompute script.
begin;

create function public.internal_agency_recompute_state()
returns text language sql stable security definer set search_path = '' as $$
  select version from private.community_registry_state where id = 1
$$;
revoke all on function public.internal_agency_recompute_state() from public, anon, authenticated;
grant execute on function public.internal_agency_recompute_state() to service_role;

create function public.internal_agency_recompute_page(
  p_version text, p_limit integer,
  p_after_contributor_id uuid default null,
  p_after_dataset_key text default null,
  p_after_source_report_key text default null
)
returns table (
  contributor_id uuid, dataset_key text, source_report_key text,
  source_agency_code text, agency_name text, manager_name text,
  agency_key text, agency_current_name text, manager_key text,
  agency_registry_version text
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_version is null or p_version is distinct from
      (select s.version from private.community_registry_state s where s.id = 1) then
    raise exception 'REGISTRY_VERSION_MISMATCH';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 5000 then
    raise exception 'INVALID_PAGE_LIMIT';
  end if;
  if (p_after_contributor_id is null and
      (p_after_dataset_key is not null or p_after_source_report_key is not null)) or
     (p_after_contributor_id is not null and
      (p_after_dataset_key is null or p_after_source_report_key is null)) then
    raise exception 'INVALID_PAGE_CURSOR';
  end if;

  return query
  select f.contributor_id, f.dataset_key, f.source_report_key,
         f.source_agency_code, f.agency_name, f.manager_name,
         f.agency_key, f.agency_current_name, f.manager_key,
         f.agency_registry_version
    from private.community_report_facts f
   where f.agency_registry_version is distinct from p_version
     and (p_after_contributor_id is null or
          (f.contributor_id, f.dataset_key, f.source_report_key) >
          (p_after_contributor_id, p_after_dataset_key, p_after_source_report_key))
   order by f.contributor_id, f.dataset_key, f.source_report_key
   limit p_limit;
end;
$$;
revoke all on function public.internal_agency_recompute_page(text, integer, uuid, text, text) from public, anon, authenticated;
grant execute on function public.internal_agency_recompute_page(text, integer, uuid, text, text) to service_role;

create function public.internal_agency_recompute_apply(p_version text, p_updates jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_state text;
  v_row record;
  v_count integer;
  v_applied integer := 0;
  v_skipped integer := 0;
begin
  -- Lock the singleton through this transaction. A concurrent version change
  -- cannot commit between the version check and the fact updates.
  select s.version into v_state from private.community_registry_state s
   where s.id = 1 for share;
  if p_version is null or p_version is distinct from v_state then
    raise exception 'REGISTRY_VERSION_MISMATCH';
  end if;
  if p_updates is null or jsonb_typeof(p_updates) <> 'array' or
     jsonb_array_length(p_updates) > 5000 then
    raise exception 'INVALID_RECOMPUTE_BATCH';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_updates) as x(
      contributor_id uuid, dataset_key text, source_report_key text)
    group by x.contributor_id, x.dataset_key, x.source_report_key having count(*) > 1
  ) then
    raise exception 'DUPLICATE_RECOMPUTE_ROW';
  end if;

  for v_row in select * from jsonb_to_recordset(p_updates) as x(
    contributor_id uuid, dataset_key text, source_report_key text,
    source_agency_code text, agency_name text, manager_name text,
    expected_agency_key text, expected_agency_current_name text,
    expected_manager_key text, expected_agency_registry_version text,
    agency_key text, agency_current_name text, manager_key text)
  loop
    if v_row.contributor_id is null or v_row.dataset_key is null or
       v_row.source_report_key is null then
      raise exception 'INVALID_RECOMPUTE_ROW';
    end if;
    update private.community_report_facts f
       set agency_key = v_row.agency_key,
           agency_current_name = v_row.agency_current_name,
           manager_key = v_row.manager_key,
           agency_registry_version = p_version
     where f.contributor_id = v_row.contributor_id
       and f.dataset_key = v_row.dataset_key
       and f.source_report_key = v_row.source_report_key
       and f.agency_registry_version is not distinct from v_row.expected_agency_registry_version
       and f.agency_registry_version is distinct from p_version
       and f.source_agency_code is not distinct from v_row.source_agency_code
       and f.agency_name is not distinct from v_row.agency_name
       and f.manager_name is not distinct from v_row.manager_name
       and f.agency_key is not distinct from v_row.expected_agency_key
       and f.agency_current_name is not distinct from v_row.expected_agency_current_name
       and f.manager_key is not distinct from v_row.expected_manager_key;
    get diagnostics v_count = row_count;
    v_applied := v_applied + v_count;
    v_skipped := v_skipped + 1 - v_count;
  end loop;
  return jsonb_build_object('applied', v_applied, 'skipped', v_skipped);
end;
$$;
revoke all on function public.internal_agency_recompute_apply(text, jsonb) from public, anon, authenticated;
grant execute on function public.internal_agency_recompute_apply(text, jsonb) to service_role;
commit;
