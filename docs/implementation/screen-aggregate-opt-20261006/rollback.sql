-- Roll back only screen v2 optimization; retain deterministic dataset election.
begin;
create or replace function public.internal_analytics_read_snapshot(
  p_scope jsonb, p_previous boolean default false,
  p_kind text default null, p_options jsonb default '{}'::jsonb,
  p_user uuid default null, p_session uuid default null
) returns json language plpgsql stable security definer set search_path='' as $$
declare s jsonb; v jsonb; data json; box double precision[];
begin
  s := public.internal_analytics_cohort_state();
  if p_user is not null then
    v := public.internal_analytics_viewer(p_user,p_session);
    if not coalesce((v->>'user_ok')::boolean,false) or
       not coalesce((v->>'kakao')::boolean,false) or
       not coalesce((v->>'session')::boolean,false) or
       v->>'contributor' is distinct from 'active' or
       coalesce((v->>'public_fact_count')::bigint,0)<10 then
      return json_build_object('state',s,'viewer',v,'facts','[]'::json);
    end if;
  end if;
  if p_kind is null and p_options->>'screen_encoding' in ('screen-aggregate-v1','screen-aggregate-v2') then
    if p_user is null or p_session is null then raise exception 'INVALID_QUERY';end if;
    data:=private.analytics_screen_aggregate(p_scope,p_user,coalesce(p_options->'panels','[]'::jsonb));
    return json_build_object('state',s,'viewer',v,'aggregate',data);
  end if;
  if p_kind is not null then
    data := public.internal_analytics_rollup(p_scope,p_kind,
      coalesce(p_options,'{}'::jsonb) || jsonb_build_object('expected_version',s->>'dataset_version'));
    return json_build_object('state',s,'rollup',data);
  end if;
  if jsonb_typeof(p_scope->'bbox')='array' then
    select array_agg(x::double precision order by n) into box
      from jsonb_array_elements_text(p_scope->'bbox') with ordinality a(x,n);
  end if;
  data := private.analytics_cohort_payload(
    p_scope->>'date_basis',(p_scope->>'start')::date,(p_scope->>'end')::date,p_previous,
    p_scope->>'category',null,p_scope->>'agency_key',p_scope->>'manager_key',box,coalesce(p_options->>'fact_encoding'='columns-v1',false));
  return json_build_object('state',s,'viewer',v,'facts',data);
end $$;
drop function private.analytics_screen_aggregate_v2(jsonb,uuid,jsonb);
notify pgrst,'reload schema';
commit;
