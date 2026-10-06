-- Query audit: batch guarded agency corrections, keeping the version lock and every CAS predicate.
begin;
CREATE OR REPLACE FUNCTION public.internal_agency_recompute_apply(p_version text, p_updates jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_state text;
  v_applied integer := 0;
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

  if exists(select 1 from jsonb_to_recordset(p_updates) as x(
    contributor_id uuid,dataset_key text,source_report_key text)
    where contributor_id is null or dataset_key is null or source_report_key is null) then
    raise exception 'INVALID_RECOMPUTE_ROW';
  end if;
  -- An empty legacy batch executed no UPDATE at all and did not invalidate the projection.
  if jsonb_array_length(p_updates)=0 then return jsonb_build_object('applied',0,'skipped',0); end if;
  -- One statement invalidates the projection once; compare-and-set guards stay identical.
  with changed as (
    update private.community_report_facts f
       set agency_key = x.agency_key,
           agency_current_name = x.agency_current_name,
           manager_key = x.manager_key,
           agency_registry_version = p_version
      from jsonb_to_recordset(p_updates) as x(
    contributor_id uuid, dataset_key text, source_report_key text,
    source_agency_code text, agency_name text, manager_name text,
    expected_agency_key text, expected_agency_current_name text,
    expected_manager_key text, expected_agency_registry_version text,
    agency_key text, agency_current_name text, manager_key text)
     where f.contributor_id = x.contributor_id
       and f.dataset_key = x.dataset_key
       and f.source_report_key = x.source_report_key
       and f.agency_registry_version is not distinct from x.expected_agency_registry_version
       and f.agency_registry_version is distinct from p_version
       and f.source_agency_code is not distinct from x.source_agency_code
       and f.agency_name is not distinct from x.agency_name
       and f.manager_name is not distinct from x.manager_name
       and f.agency_key is not distinct from x.expected_agency_key
       and f.agency_current_name is not distinct from x.expected_agency_current_name
       and f.manager_key is not distinct from x.expected_manager_key
    returning 1
  ) select count(*) into v_applied from changed;
  return jsonb_build_object('applied',v_applied,'skipped',jsonb_array_length(p_updates)-v_applied);
end;
$function$;

commit;
