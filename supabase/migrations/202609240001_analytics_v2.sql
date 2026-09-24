-- Local proposal only. Do not apply to production until the upstream v2 fact contract is supplied and reviewed.
-- V1 yearly aggregates cannot be backfilled into report_date/completed_date or vehicle identity.

begin;

create table if not exists private.report_facts_v2 (
  snapshot_id uuid not null references private.upload_snapshots(id) on delete cascade,
  fact_identity text not null check (char_length(fact_identity) between 1 and 160),
  report_date date,
  completed_date date,
  category text not null check (category in ('traffic', 'parking', 'other')),
  status text not null check (status in ('accepted','partial','rejected','processing','supplement','withdrawn','transferred','completed_unknown','other')),
  disposition text not null check (disposition in ('fine','warning','penalty','none','unknown')),
  vehicle_raw text check (char_length(vehicle_raw) <= 64),
  point_key text not null check (char_length(point_key) between 1 and 160),
  lat double precision not null check (lat between 32 and 39.5),
  lng double precision not null check (lng between 124 and 132),
  address text check (char_length(address) <= 200),
  region_code text check (char_length(region_code) <= 24),
  agency_key text check (char_length(agency_key) <= 160),
  agency_name text check (char_length(agency_name) <= 200),
  manager_key text check (char_length(manager_key) <= 160),
  manager_name text check (char_length(manager_name) <= 160),
  primary key (snapshot_id, fact_identity)
);

create index if not exists report_facts_v2_report_date_idx on private.report_facts_v2(report_date, category, region_code);
create index if not exists report_facts_v2_completed_date_idx on private.report_facts_v2(completed_date, category, region_code);
create index if not exists report_facts_v2_point_idx on private.report_facts_v2(point_key);
alter table private.report_facts_v2 enable row level security;
revoke all on private.report_facts_v2 from public, anon, authenticated;
grant select, insert, update, delete on private.report_facts_v2 to service_role;

-- A version is marked ready only after a complete upstream ingestion and validation transaction.
create table if not exists private.analytics_state (
  singleton boolean primary key default true check (singleton),
  dataset_version text not null default gen_random_uuid()::text,
  ready boolean not null default false,
  source_updated_at timestamptz,
  generated_at timestamptz,
  published_at timestamptz,
  data_min date,
  data_max date,
  coverage_note text not null default 'v2 원천 사실이 아직 제공되지 않았습니다.',
  dedupe_policy_version text not null default 'active-snapshot-v1'
);
insert into private.analytics_state(singleton) values (true) on conflict (singleton) do nothing;
alter table private.analytics_state enable row level security;
revoke all on private.analytics_state from public, anon, authenticated;
grant select, update on private.analytics_state to service_role;

-- A source withdrawal or snapshot replacement invalidates the public version immediately.
create or replace function private.invalidate_analytics_v2()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update private.analytics_state
     set ready = false,
         dataset_version = gen_random_uuid()::text,
         generated_at = now(),
         coverage_note = '원천 변경으로 공개 집계를 다시 생성해야 합니다.'
   where singleton = true;
  return new;
end;
$$;

create trigger invalidate_analytics_v2_contributor
after update of revoked_at, status on private.contributor_profiles
for each row when (old.revoked_at is distinct from new.revoked_at or old.status is distinct from new.status)
execute function private.invalidate_analytics_v2();

create trigger invalidate_analytics_v2_snapshot
after update of state on private.upload_snapshots
for each row when (old.state is distinct from new.state)
execute function private.invalidate_analytics_v2();

-- RPCs remain service_role-only. The public Edge Function projects a fixed DTO before returning data.
create or replace function public.internal_analytics_v2_state()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'dataset_version', dataset_version, 'ready', ready,
    'source_updated_at', source_updated_at, 'generated_at', generated_at,
    'published_at', published_at, 'data_min', data_min, 'data_max', data_max,
    'coverage_note', coverage_note, 'dedupe_policy_version', dedupe_policy_version
  ) from private.analytics_state where singleton = true;
$$;

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
    select f.*, s.user_id, s.id as active_snapshot_id
      from private.report_facts_v2 f
      join private.upload_snapshots s on s.id = f.snapshot_id and s.state = 'active'
      join private.contributor_profiles c on c.user_id = s.user_id and c.status = 'active' and c.revoked_at is null
     where (f.report_date between v_previous_start and p_end or f.completed_date between v_previous_start and p_end)
       and (p_category = 'all' or f.category = p_category)
       and (p_region_code is null or f.region_code = p_region_code)
       and (p_agency_key is null or f.agency_key = p_agency_key)
       and (p_manager_key is null or f.manager_key = p_manager_key)
       and (p_bbox is null or (f.lng between p_bbox[1] and p_bbox[3] and f.lat between p_bbox[2] and p_bbox[4]))
     limit 100001
  )
  select count(*), coalesce(jsonb_agg(jsonb_build_object(
    'fact_identity', fact_identity, 'contributor_id', user_id,
    'snapshot_id', active_snapshot_id, 'snapshot_generation', 1,
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

revoke all on function public.internal_analytics_v2_state() from public, anon, authenticated;
revoke all on function public.internal_analytics_v2_facts(date,date,text,text,text,text,double precision[]) from public, anon, authenticated;
grant execute on function public.internal_analytics_v2_state() to service_role;
grant execute on function public.internal_analytics_v2_facts(date,date,text,text,text,text,double precision[]) to service_role;

create or replace function public.internal_analytics_v2_rate_limit(p_bucket text)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare v_count integer;
begin
  if p_bucket is null or char_length(p_bucket) <> 64 then raise exception 'INVALID_BUCKET'; end if;
  insert into private.rate_limits(bucket, window_start, request_count)
  values (p_bucket, date_trunc('minute', now()), 1)
  on conflict (bucket, window_start) do update
    set request_count = private.rate_limits.request_count + 1
  returning request_count into v_count;
  return v_count <= 60;
end;
$$;
revoke all on function public.internal_analytics_v2_rate_limit(text) from public, anon, authenticated;
grant execute on function public.internal_analytics_v2_rate_limit(text) to service_role;

commit;
