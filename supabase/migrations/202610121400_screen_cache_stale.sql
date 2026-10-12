-- Bounded public staleness; v1 RPC remains exact for old Edge/rollback.
begin;
set local lock_timeout='3s';
create table private.screen_cache_epoch(singleton boolean primary key default true check(singleton), revision bigint not null default 0);
insert into private.screen_cache_epoch values(true,0);
create table private.screen_user_revision(user_id uuid primary key references auth.users(id) on delete cascade, revision bigint not null);
alter table private.screen_cache_epoch enable row level security;
alter table private.screen_user_revision enable row level security;
revoke all on private.screen_cache_epoch,private.screen_user_revision from public,anon,authenticated,service_role;

-- SQL constants: hard request age 180s; speculative refresh age 60s.
create function private.screen_public_max_age() returns interval language sql immutable set search_path='' as $$select interval '180 seconds'$$;
create function private.screen_public_refresh_age() returns interval language sql immutable set search_path='' as $$select interval '60 seconds'$$;
create function private.screen_privacy_revision() returns text language sql stable security definer set search_path='' as $$
 select revision::text from private.screen_cache_epoch where singleton;
$$;
create function private.screen_privacy_bump() returns trigger language plpgsql security definer set search_path='' as $$
begin
 update private.screen_cache_epoch set revision=revision+1 where singleton;
 return null;
end $$;
-- Old invalidation stays for v1. Separate privacy epoch ignores profile heartbeat updates.
create trigger screen_privacy_profile_add after insert on private.contributor_profiles
 for each row execute function private.screen_privacy_bump();
create trigger screen_privacy_profile after update on private.contributor_profiles for each row
 when (old.status is distinct from new.status) execute function private.screen_privacy_bump();
create trigger screen_privacy_profile_remove after delete or truncate on private.contributor_profiles
 for each statement execute function private.screen_privacy_bump();
create trigger screen_privacy_grant after insert or update or delete or truncate on private.community_consent_grants
 for each statement execute function private.screen_privacy_bump();
create trigger screen_privacy_policy after insert or update or delete or truncate on private.community_policy_disclosures
 for each statement execute function private.screen_privacy_bump();
create trigger screen_privacy_delete after delete or truncate on private.community_report_facts
 for each statement execute function private.screen_privacy_bump();
create trigger screen_privacy_fact after update on private.community_report_facts for each row
 when (row(old.vehicle_raw,old.consent_grant_id,old.public_state,old.contributor_id) is distinct from
       row(new.vehicle_raw,new.consent_grant_id,new.public_state,new.contributor_id))
 execute function private.screen_privacy_bump();

-- Own payload updates (not merely manifest key-set changes), including shared-key election dependencies.
-- Group once per statement; no aggregate recomputation or global invalidation on normal uploads.
create function private.screen_user_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare keys text[]; owners uuid[];
begin
 if tg_op='INSERT' then
  select array_agg(distinct source_report_key),array_agg(distinct contributor_id) into keys,owners from new_screen_rows;
 elsif tg_op='DELETE' then
  select array_agg(distinct source_report_key),array_agg(distinct contributor_id) into keys,owners from old_screen_rows;
 else
  -- Transport-only resend updates do not change the personal result.
  with before_rows as (select to_jsonb(o)-array['updated_at','latest_receipt_id','source_revision','writer_epoch'] as v from old_screen_rows o),
       after_rows as (select to_jsonb(n)-array['updated_at','latest_receipt_id','source_revision','writer_epoch'] as v from new_screen_rows n),
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
create trigger screen_user_insert after insert on private.community_report_facts referencing new table as new_screen_rows
 for each statement execute function private.screen_user_changed();
create trigger screen_user_update after update on private.community_report_facts referencing old table as old_screen_rows new table as new_screen_rows
 for each statement execute function private.screen_user_changed();
create trigger screen_user_delete after delete on private.community_report_facts referencing old table as old_screen_rows
 for each statement execute function private.screen_user_changed();

create type private.screen_stale_read as (
 revision text, state_key text, state jsonb, viewer jsonb,
 public_slot integer, public_key text, public_data json,
 personal_slot integer, personal_key text, personal_data json,
 state_hit boolean, public_hit boolean, personal_hit boolean,
 privacy_revision text, public_state jsonb, public_at timestamptz, personal_at timestamptz,
 personal_dataset text, snapshot_at timestamptz
);
create function private.screen_stale_resolve(p_scope jsonb,p_panels jsonb,p_user uuid,p_session uuid,p_warm boolean default false)
 returns private.screen_stale_read language plpgsql stable security definer set search_path='' as $$
declare r private.screen_stale_read; s jsonb; panels jsonb; personal boolean; data json;
 key_base text; user_version text; envelope json; today date:=(statement_timestamp() at time zone 'Asia/Seoul')::date;
begin
 -- This STABLE function owns ONE MVCC snapshot for gate + revision + cache lookup + every miss calculation.
 -- The VOLATILE entrypoint writes results only AFTER this function returns.
 if not p_warm then
  if p_user is null or p_session is null then raise exception 'INVALID_QUERY';end if;
  r.viewer:=public.internal_analytics_viewer(p_user,p_session);
  if not coalesce((r.viewer->>'user_ok')::boolean,false) or not coalesce((r.viewer->>'kakao')::boolean,false)
   or not coalesce((r.viewer->>'session')::boolean,false) or r.viewer->>'contributor' is distinct from 'active'
   or coalesce((r.viewer->>'public_fact_count')::bigint,0)<10 then
   r.state:='{}'::jsonb;return r;
  end if;
 end if;
 if p_panels is null or jsonb_typeof(p_panels)<>'array' or jsonb_array_length(p_panels)>8 then raise exception 'INVALID_QUERY';end if;
 r.snapshot_at:=statement_timestamp();
 r.privacy_revision:=private.screen_privacy_revision();
 r.revision:=private.screen_cache_revision();
 r.state_key:=private.screen_cache_digest('screen-state-v1|'||r.revision);
 r.state:=private.screen_cache_get(160,r.state_key)::jsonb;r.state_hit:=r.state is not null;
 if r.state is null then r.state:=public.internal_analytics_cohort_state();end if;
 -- A metadata-only call also gets its state from the same stable snapshot.
 if p_scope is null or not coalesce((r.state->>'ready')::boolean,false) then return r;end if;
 s:=jsonb_strip_nulls(p_scope);
 -- The SQL result only depends on focused places and whether comparison was requested.
 -- IDs, sorting, paging/search and panel order are Edge projection, not additional SQL variants.
 select coalesce(jsonb_agg(jsonb_build_object('path',path) order by path),'[]') into panels
 from (select distinct p->>'path' as path from jsonb_array_elements(p_panels) p where p->>'path' like 'places/pl1:%') t;
 personal:=not p_warm and exists(select 1 from jsonb_array_elements(p_panels) p where p->>'path'='compare');
 key_base:='screen-stale-v2|screen-aggregate-v2|fine-estimate-v1|single-date-v1|'||r.privacy_revision||'|'||s::text||'|'||panels::text;
 r.public_key:=private.screen_cache_digest(key_base);
 r.public_slot:=4+(('x'||substr(private.screen_cache_digest(s::text||panels::text),1,7))::bit(28)::integer%28);
 -- Reserve the default two scopes (both axes). Match the browser’s KST/leap-year/all-basis presets exactly.
 if s->>'category'='all' and s-'date_basis'-'start'-'end'-'category'='{}'::jsonb and panels='[]'::jsonb then
  if s->>'start'=((today-interval '1 year')::date+1)::text and s->>'end'=today::text then
   r.public_slot:=case when s->>'date_basis'='report_date' then 2 else 0 end;
  elsif s->>'start'=r.state->'basis_bounds'->(s->>'date_basis')->>'min'
    and s->>'end'=r.state->'basis_bounds'->(s->>'date_basis')->>'max' then
   r.public_slot:=case when s->>'date_basis'='report_date' then 3 else 1 end;
  end if;
 end if;
 select payload into envelope from private.screen_result_cache
 where slot=r.public_slot and cache_key=r.public_key and expires_at>statement_timestamp()
 and created_at>statement_timestamp()-(case when p_warm then private.screen_public_refresh_age() else private.screen_public_max_age() end);
 r.public_hit:=envelope is not null;
 if r.public_hit then
  r.public_data:=envelope->'data';r.public_state:=(envelope->'state')::jsonb;r.public_at:=(envelope->>'at')::timestamptz;
 else r.public_state:=r.state;r.public_at:=r.snapshot_at;end if;
 if personal then
  select coalesce((select revision::text from private.screen_user_revision where user_id=p_user),'0') into user_version;
  r.personal_key:=private.screen_cache_digest(key_base||'|compare|'||p_user::text||'|'||p_session::text||'|'||user_version);
  r.personal_slot:=32+(('x'||substr(private.screen_cache_digest(s::text||panels::text||p_user::text),1,7))::bit(28)::integer%128);
  envelope:=private.screen_cache_get(r.personal_slot,r.personal_key);r.personal_hit:=envelope is not null;
  if r.personal_hit then
   r.personal_data:=envelope->'data';r.personal_at:=(envelope->>'at')::timestamptz;r.personal_dataset:=envelope->>'dataset';
  else r.personal_at:=r.snapshot_at;r.personal_dataset:=r.state->>'dataset_version';end if;
  panels:=panels||'[{"path":"compare"}]'::jsonb;
 end if;
 if not r.public_hit or (personal and not r.personal_hit) then
  data:=private.analytics_screen_parts(s,p_user,panels,
   case when r.public_hit then 'personal' when personal and not r.personal_hit then 'both' else 'public' end);
  if not r.public_hit then r.public_data:=data->'public';end if;
  if personal and not r.personal_hit then r.personal_data:=data->'personal';end if;
 end if;
 return r;
end $$;

create function private.screen_stale_save(r private.screen_stale_read) returns void
 language plpgsql volatile security definer set search_path='' as $$
begin
 -- Compare privacy only: concurrent ordinary uploads must not starve prewarming.
 -- Old user-revision key cannot hit after a concurrent own update; monotonically newer slots win.
 if r.privacy_revision is distinct from private.screen_privacy_revision() then return;end if;
 if not r.state_hit and r.revision=private.screen_cache_revision() then
  perform private.screen_cache_put(160,r.state_key,r.state::json,r.snapshot_at);end if;
 if r.public_key is not null and not r.public_hit then
  perform private.screen_cache_put(r.public_slot,r.public_key,json_build_object('data',r.public_data,'state',r.public_state,'at',r.public_at),r.public_at);end if;
 if r.personal_key is not null and not r.personal_hit then
  perform private.screen_cache_put(r.personal_slot,r.personal_key,json_build_object('data',r.personal_data,'dataset',r.personal_dataset,'at',r.personal_at),r.personal_at);end if;
end $$;
create function public.internal_analytics_screen_stale(p_scope jsonb,p_panels jsonb,p_user uuid,p_session uuid)
 returns json language plpgsql volatile security definer set search_path='' as $$
declare r private.screen_stale_read;
begin
 r:=private.screen_stale_resolve(p_scope,p_panels,p_user,p_session);
 perform private.screen_stale_save(r);
 return json_build_object('state',coalesce(r.public_state,r.state),'viewer',r.viewer,'facts','[]'::json,
  'cache_encoding','screen-cache-v2','public_aggregate',r.public_data,'personal_aggregate',r.personal_data,
  'snapshots',json_build_object('public_at',r.public_at,'personal_at',r.personal_at,
   'comparable',r.personal_dataset is not distinct from r.public_state->>'dataset_version'),
  'cache',json_build_object('public_hit',r.public_hit,'personal_hit',r.personal_hit,'state_hit',r.state_hit));
end $$;
create or replace function private.screen_cache_maintain() returns integer
 language plpgsql volatile security definer set search_path='' set statement_timeout='55s' as $$
declare r private.screen_stale_read; s jsonb; scope jsonb; period text; today date; n integer:=0; row_slot integer;
begin
 -- Skip overlapping jobs. No waits, no row/fact locks, no user enumeration.
 if not pg_try_advisory_xact_lock(121300,1000) then return 0;end if;
 for row_slot in select slot from private.screen_result_cache where expires_at<=statement_timestamp() loop
  if pg_try_advisory_xact_lock(121300,row_slot) then delete from private.screen_result_cache where slot=row_slot and expires_at<=statement_timestamp();end if;
 end loop;
 s:=public.internal_analytics_cached_state();
 if not coalesce((s->>'ready')::boolean,false) then return 0;end if;
 today:=(statement_timestamp() at time zone 'Asia/Seoul')::date;
 foreach period in array array['year','all'] loop
  scope:=jsonb_build_object('date_basis','completed_date','category','all',
   'start',case when period='year' then ((today-interval '1 year')::date+1)::text else s->'basis_bounds'->'completed_date'->>'min' end,
   'end',case when period='year' then today::text else s->'basis_bounds'->'completed_date'->>'max' end);
  if scope->>'start' is null or scope->>'end' is null then continue;end if;
  r:=private.screen_stale_resolve(scope,'[]',null,null,true);
  perform private.screen_stale_save(r);
  if not r.public_hit then n:=n+1;end if;
 end loop;
 return n;
end $$;

revoke all on function private.screen_public_max_age(),private.screen_public_refresh_age(),private.screen_privacy_revision(),
 private.screen_privacy_bump(),private.screen_user_changed(),private.screen_stale_resolve(jsonb,jsonb,uuid,uuid,boolean),
 private.screen_stale_save(private.screen_stale_read) from public,anon,authenticated,service_role;
revoke all on function public.internal_analytics_screen_stale(jsonb,jsonb,uuid,uuid) from public,anon,authenticated;
grant execute on function public.internal_analytics_screen_stale(jsonb,jsonb,uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
