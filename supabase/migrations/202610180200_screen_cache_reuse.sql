-- Screen cache reuse on top of 202610121400 (bounded stale) and 202610180100 (stored normalization).
-- 1) Unchanged data is never recomputed: an entry older than the age limit whose dataset revision equals the
--    current one is the current result; only its timestamp moves (no payload rewrite). The per-minute cron
--    therefore costs nothing while no data changes.
-- 2) Focused places (map pin) are no longer part of the public key. The cached base never contains focus rows;
--    focus rows come from a run restricted to the source keys at those places and are appended.
-- 3) A personal miss next to a public hit runs only over the keys of the viewer and the keys at places of the viewer.
-- 2) and 3) need stored normalization for every completed fact; otherwise the old full runs are used.
--    That check is cached per dataset revision in slot 161 (64 KiB class, like the state slot 160).
-- Election, eligibility, staleness bounds, privacy revision and the Edge contract are unchanged.
begin;
set local lock_timeout='3s';

alter type private.screen_stale_read add attribute public_restamp boolean, add attribute focus_data json,
 add attribute norm_key text, add attribute norm_complete boolean;
alter table private.screen_result_cache drop constraint screen_result_cache_slot_check,
 add constraint screen_result_cache_slot_check check(slot between 0 and 161);

create function private.screen_norm_complete() returns boolean language sql stable security definer set search_path='' set enable_nestloop=off as $$
 select not exists (select 1 from private.community_report_facts f where f.public_state='completed' and not exists (
  select 1 from private.screen_fact_norm n
  where n.contributor_id=f.contributor_id and n.dataset_key=f.dataset_key and n.source_report_key=f.source_report_key
    and n.v=private.screen_norm_version() and n.address is not distinct from f.address and n.vehicle_raw is not distinct from f.vehicle_raw
    and n.violation_law is not distinct from f.violation_law and n.region_code is not distinct from f.region_code
    and n.lat is not distinct from f.lat and n.lng is not distinct from f.lng));
$$;

-- Array concatenation on json text: the cached base is never re-parsed into jsonb.
create function private.screen_json_append(p_arr json, p_items json) returns json language sql immutable set search_path='' as $$
 select case when p_items is null or json_array_length(p_items)=0 then p_arr
  when json_array_length(p_arr)=0 then p_items
  else (left(rtrim(p_arr::text),-1)||','||substr(ltrim(p_items::text),2))::json end
$$;
-- Base public part + the focus rows of a restricted run (its other rows are partial and dropped).
create function private.screen_focus_merge(p_base json, p_extra json) returns json language sql immutable set search_path='' as $$
 select json_object_agg(b.key, case b.key
  when 'stats' then private.screen_json_append(b.value, (select coalesce(json_agg(e),'[]') from json_array_elements(p_extra->'stats') e
   where e->>'kind'='focus' or e->>'focus'<>''))
  when 'anchors' then private.screen_json_append(b.value, (select coalesce(json_agg(e),'[]') from json_array_elements(p_extra->'anchors') e where e->>0='focus'))
  when 'full' then private.screen_json_append(b.value, (select coalesce(json_agg(e),'[]') from json_array_elements(p_extra->'full') e where e->>1<>''))
  else b.value end)
 from json_each(p_base) b
$$;

create function private.screen_cache_touch(p_slot integer,p_key text,p_at timestamptz) returns boolean
 language plpgsql volatile security definer set search_path='' as $$
begin
 if not pg_try_advisory_xact_lock(121300,p_slot) then return false;end if;
 update private.screen_result_cache set created_at=p_at,expires_at=p_at+interval '15 minutes'
 where slot=p_slot and cache_key=p_key and created_at<=p_at;
 return true;
 exception when others then return false;
end $$;

create or replace function private.screen_stale_resolve(p_scope jsonb,p_panels jsonb,p_user uuid,p_session uuid,p_warm boolean default false)
 returns private.screen_stale_read language plpgsql stable security definer set search_path='' as $$
declare r private.screen_stale_read; s jsonb; focus jsonb; personal boolean; data json; extra json; complete boolean; norm json;
 v_keys text[]; key_base text; user_version text; envelope json; v_created timestamptz; v_revision text;
 today date:=(statement_timestamp() at time zone 'Asia/Seoul')::date;
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
 r.norm_key:=private.screen_cache_digest('screen-norm-v'||private.screen_norm_version()||'|'||r.revision);
 -- A metadata-only call also gets its state from the same stable snapshot.
 if p_scope is null or not coalesce((r.state->>'ready')::boolean,false) then return r;end if;
 s:=jsonb_strip_nulls(p_scope);
 -- The SQL result only depends on focused places and whether comparison was requested.
 -- IDs, sorting, paging/search and panel order are Edge projection, not additional SQL variants.
 select coalesce(jsonb_agg(jsonb_build_object('path',path) order by path),'[]') into focus
 from (select distinct p->>'path' as path from jsonb_array_elements(p_panels) p where p->>'path' like 'places/pl1:%') t;
 personal:=not p_warm and exists(select 1 from jsonb_array_elements(p_panels) p where p->>'path'='compare');
 -- Neither key depends on focused places any more.
 key_base:='screen-stale-v3|screen-aggregate-v2|fine-estimate-v1|single-date-v1|'||r.privacy_revision||'|'||s::text;
 r.public_key:=private.screen_cache_digest(key_base);
 r.public_slot:=4+(('x'||substr(private.screen_cache_digest(s::text),1,7))::bit(28)::integer%28);
 -- Reserve the default two scopes (both axes). Match the browser’s KST/leap-year/all-basis presets exactly.
 if s->>'category'='all' and s-'date_basis'-'start'-'end'-'category'='{}'::jsonb then
  if s->>'start'=((today-interval '1 year')::date+1)::text and s->>'end'=today::text then
   r.public_slot:=case when s->>'date_basis'='report_date' then 2 else 0 end;
  elsif s->>'start'=r.state->'basis_bounds'->(s->>'date_basis')->>'min'
    and s->>'end'=r.state->'basis_bounds'->(s->>'date_basis')->>'max' then
   r.public_slot:=case when s->>'date_basis'='report_date' then 3 else 1 end;
  end if;
 end if;
 select payload,created_at into envelope,v_created from private.screen_result_cache
 where slot=r.public_slot and cache_key=r.public_key and expires_at>statement_timestamp();
 -- Each json field access re-reads the payload text: read the revision once.
 v_revision:=envelope->>'revision';
 r.public_hit:=envelope is not null and (v_revision=r.revision or v_created>statement_timestamp()-
  (case when p_warm then private.screen_public_refresh_age() else private.screen_public_max_age() end));
 if r.public_hit then
  r.public_data:=envelope->'data';r.public_state:=(envelope->'state')::jsonb;
  -- Same revision: the stored result IS the current one, so it is dated now (timestamp-only write).
  r.public_restamp:=v_revision is not distinct from r.revision and v_created<r.snapshot_at;
  r.public_at:=case when r.public_restamp then r.snapshot_at else v_created end;
 else r.public_state:=r.state;r.public_at:=r.snapshot_at;end if;
 if personal then
  select coalesce((select revision::text from private.screen_user_revision where user_id=p_user),'0') into user_version;
  r.personal_key:=private.screen_cache_digest(key_base||'|compare|'||p_user::text||'|'||p_session::text||'|'||user_version);
  r.personal_slot:=32+(('x'||substr(private.screen_cache_digest(s::text||p_user::text),1,7))::bit(28)::integer%128);
  envelope:=private.screen_cache_get(r.personal_slot,r.personal_key);r.personal_hit:=envelope is not null;
  if r.personal_hit then
   r.personal_data:=envelope->'data';r.personal_at:=(envelope->>'at')::timestamptz;r.personal_dataset:=envelope->>'dataset';
  else r.personal_at:=r.snapshot_at;r.personal_dataset:=r.state->>'dataset_version';end if;
 end if;
 if not r.public_hit then
  data:=private.analytics_screen_parts(s,p_user,case when personal and not r.personal_hit then '[{"path":"compare"}]'::jsonb else '[]' end,
   case when personal and not r.personal_hit then 'both' else 'public' end,null);
  r.public_data:=data->'public';
  if personal and not r.personal_hit then r.personal_data:=data->'personal';end if;
 elsif personal and not r.personal_hit then
  norm:=private.screen_cache_get(161,r.norm_key);
  if norm is null then r.norm_complete:=private.screen_norm_complete();complete:=r.norm_complete;
  else complete:=(norm->>'complete')::boolean;end if;
  if complete then
   -- Every row at places of the viewer (people/shared counters) and every row of keys of the viewer.
   select coalesce(array_agg(distinct k),'{}') into v_keys from (
    select f.source_report_key as k from private.community_report_facts f where f.contributor_id=p_user
    union all
    select n.source_report_key from private.screen_fact_norm n where n.place in (
     select m.place from private.screen_fact_norm m where m.contributor_id=p_user and m.place is not null)) t;
  end if;
  data:=private.analytics_screen_parts(s,p_user,'[{"path":"compare"}]','personal',case when complete then v_keys end);
  r.personal_data:=data->'personal';
 end if;
 if focus<>'[]'::jsonb then
  if complete is null then
   norm:=private.screen_cache_get(161,r.norm_key);
   if norm is null then r.norm_complete:=private.screen_norm_complete();complete:=r.norm_complete;
   else complete:=(norm->>'complete')::boolean;end if;
  end if;
  if complete then
   select coalesce(array_agg(distinct n.source_report_key),'{}') into v_keys from private.screen_fact_norm n
   where n.place in (select substr(p->>'path',8) from jsonb_array_elements(focus) p);
  end if;
  extra:=private.analytics_screen_parts(s,p_user,focus,'public',case when complete then v_keys end);
  -- The focus merge is per request; the stored base stays focus-free.
  r.focus_data:=private.screen_focus_merge(r.public_data,extra->'public');
 end if;
 return r;
end $$;

create or replace function private.screen_stale_save(r private.screen_stale_read) returns void
 language plpgsql volatile security definer set search_path='' as $$
begin
 -- Compare privacy only: concurrent ordinary uploads must not starve prewarming.
 -- Old user-revision key cannot hit after a concurrent own update; monotonically newer slots win.
 if r.privacy_revision is distinct from private.screen_privacy_revision() then return;end if;
 if not r.state_hit and r.revision=private.screen_cache_revision() then
  perform private.screen_cache_put(160,r.state_key,r.state::json,r.snapshot_at);end if;
 if r.norm_complete is not null and r.revision=private.screen_cache_revision() then
  perform private.screen_cache_put(161,r.norm_key,json_build_object('complete',r.norm_complete),r.snapshot_at);end if;
 if r.public_key is not null and not r.public_hit then
  perform private.screen_cache_put(r.public_slot,r.public_key,json_build_object('revision',r.revision,'state',r.public_state,'data',r.public_data),r.public_at);
 elsif r.public_key is not null and r.public_restamp then
  perform private.screen_cache_touch(r.public_slot,r.public_key,r.public_at);end if;
 if r.personal_key is not null and not r.personal_hit then
  perform private.screen_cache_put(r.personal_slot,r.personal_key,json_build_object('data',r.personal_data,'dataset',r.personal_dataset,'at',r.personal_at),r.personal_at);end if;
end $$;

create or replace function public.internal_analytics_screen_stale(p_scope jsonb,p_panels jsonb,p_user uuid,p_session uuid)
 returns json language plpgsql volatile security definer set search_path='' as $$
declare r private.screen_stale_read;
begin
 r:=private.screen_stale_resolve(p_scope,p_panels,p_user,p_session);
 perform private.screen_stale_save(r);
 return json_build_object('state',coalesce(r.public_state,r.state),'viewer',r.viewer,'facts','[]'::json,
  'cache_encoding','screen-cache-v2','public_aggregate',coalesce(r.focus_data,r.public_data),'personal_aggregate',r.personal_data,
  'snapshots',json_build_object('public_at',r.public_at,'personal_at',r.personal_at,
   'comparable',r.personal_dataset is not distinct from r.public_state->>'dataset_version'),
  'cache',json_build_object('public_hit',r.public_hit,'personal_hit',r.personal_hit,'state_hit',r.state_hit));
end $$;

revoke all on function private.screen_norm_complete(),private.screen_json_append(json,json),private.screen_focus_merge(json,json),
 private.screen_cache_touch(integer,text,timestamptz) from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
