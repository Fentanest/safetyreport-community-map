begin;
-- Write-time projection. No changes to internal_community_ingest or its handler.
-- Migration installs dual writes first; the explicit bounded backfill and activation follow separately.

set local lock_timeout='3s';
-- Auth cascade removes the parent user before the fact AFTER DELETE statement trigger.
-- Do not recreate a manifest for a deleted account (the original trigger violated its FK).
create or replace function private.community_facts_manifest_delete_batch()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
    insert into private.community_manifest_generations(contributor_id,dataset_key,generation)
    select contributor_id,dataset_key,count(*) from old_facts
     where public_state='completed' and exists(select 1 from auth.users u where u.id=old_facts.contributor_id)
     group by contributor_id,dataset_key order by contributor_id,dataset_key
    on conflict(contributor_id,dataset_key) do update
       set generation=private.community_manifest_generations.generation+excluded.generation;
    return null;
end;
$$;

create table private.screen_precompute_control (
 singleton boolean primary key default true check(singleton), ready boolean not null default false,
 epoch bigint not null default 0, backfill_cursor text, format_version integer not null default 1
);
insert into private.screen_precompute_control(singleton) values(true);
create table private.screen_observations as
    with disclosures as materialized (
        select g.lineage_id,
               coalesce(bool_or(d.amounts_public), false) as amount_public,
               coalesce(bool_or(d.violation_law_public), false) as law_public,
               coalesce(bool_or(d.rating_public), false) as rating_public
          from private.community_consent_grants g
          left join private.community_policy_disclosures d on d.version = g.policy_version
         where g.revoked_at is null
         group by g.lineage_id
    ), active_grants as materialized (
        select g.grant_id, d.amount_public, d.law_public, d.rating_public
          from private.community_consent_grants g
          join private.community_consent_grants a
            on a.lineage_id = g.lineage_id and a.user_id = g.user_id and a.revoked_at is null
          join disclosures d on d.lineage_id = g.lineage_id
    ), scoped as materialized (
        -- D13: keep the whole eligible history of each candidate key for election.
        select f.dataset_key, f.source_report_key, f.report_number, f.payload_sha256, f.answer_accepted_at, f.contributor_id, f.first_accepted_at, f.report_date, f.completed_date, f.status, f.disposition, f.vehicle_raw, f.lat, f.lng, f.address, f.region_code, f.agency_key, f.agency_name, f.agency_current_name, f.manager_key, f.manager_name, f.amount_kind, f.amount_confirmed_won, f.violation_law, f.rating, f.category, g.amount_public, g.law_public, g.rating_public
          from private.community_report_facts f
          join private.contributor_profiles c on c.user_id = f.contributor_id and c.status = 'active'
          join active_grants g on g.grant_id = f.consent_grant_id
          
         where f.public_state = 'completed' and f.source_report_key = any('{}'::text[])
    ), budget as materialized (
        select count(*) as n from scoped
    ), admitted as materialized (
        -- Do not rank or build any JSON if the whole-history row budget is exceeded.
        select s.* from scoped s
    ), key_numbers as (
        -- R2: first known number over exactly the same eligible history as scoped.
        select distinct on (f.source_report_key) f.source_report_key, f.report_number as key_number
          from admitted f
         order by f.source_report_key, (f.report_number is null), f.first_accepted_at, f.contributor_id, f.dataset_key
    ),
    identified as (
        select s.*,
               k.key_number,
               (s.source_report_key || '|' || coalesce(s.report_number, k.key_number, 'legacy')) as report_identity,
               max(s.answer_accepted_at) over (
                   partition by s.source_report_key, coalesce(s.report_number, k.key_number, 'legacy'), s.payload_sha256
               ) as answer_time
          from admitted s
          join key_numbers k using (source_report_key)
    ),
    ranked as (
        select i.*,
               -- R1 order (unchanged): latest adopted answer, newer official answer date, earliest contributor
               row_number() over w = 1 as is_representative,
               first_value(i.report_date) over w as identity_report_date,
               first_value(i.completed_date) over w as identity_completed_date,
               count(*) over (partition by i.report_identity) as contribution_count
          from identified i
        window w as (partition by i.report_identity
                     order by i.answer_time desc, i.completed_date desc nulls last, i.first_accepted_at, i.contributor_id, i.dataset_key
                     rows between unbounded preceding and unbounded following)
    )
select r.*,private.screen_address(address) as place_address,
 private.screen_place_key(private.screen_address(address)) as place,
 coalesce(private.analytics_region(region_code,null,null),private.analytics_region(region_code,lat,lng)) as region,
 case when law_public then private.screen_law(violation_law) end as law,
 private.screen_plate(vehicle_raw) as plate,
 private.screen_mask_plate(private.screen_plate(vehicle_raw)) as plate_mask,
 status in ('accepted','partial','rejected','withdrawn','transferred','completed_unknown') as done,
 case when status in ('accepted','partial','rejected','completed_unknown') and completed_date>=report_date then completed_date-report_date end as days,
 case when amount_kind='combined' then 'combined' when amount_kind='penalty' then case when disposition='fine' then 'conflict' else 'penalty' end
 when amount_kind='fine' and disposition<>'fine' then 'conflict' when disposition<>'fine' then 'none'
 when amount_kind is distinct from 'fine' or status not in ('accepted','partial') then 'conflict'
 when not amount_public then case when amount_confirmed_won is null then 'unconfirmed' else 'undisclosed' end
 when amount_confirmed_won is null then 'unconfirmed' else 'confirmed' end as amount_class,
 case when rating_public then rating end as stars
 from ranked r with no data;
alter table private.screen_observations add primary key(contributor_id,dataset_key,source_report_key);
create index screen_observations_key on private.screen_observations(source_report_key);
create index screen_observations_report on private.screen_observations(identity_report_date);
create index screen_observations_completed on private.screen_observations(identity_completed_date);
create index screen_observations_order on private.screen_observations(report_identity,answer_time desc,completed_date desc nulls last,first_accepted_at,contributor_id,dataset_key);
create index screen_observations_bounds_report on private.screen_observations(report_date);
create index screen_observations_bounds_completed on private.screen_observations(completed_date);

-- SERIALIZABLE/REPEATABLE READ callers get a serialization failure rather than silently writing a
-- stale projection after a competing writer. READ COMMITTED trigger substatements see the lock holder.
-- All mutation/backfill paths take this same transaction row lock before reading derived state.
create function private.screen_precompute_lock() returns void
language plpgsql security definer set search_path='' as $$
begin
 -- Existing fact projection triggers take analytics_state first. Use that same order for every path.
 perform singleton from private.analytics_state where singleton for update;
 update private.screen_precompute_control set epoch=epoch+1 where singleton;
end $$;
create function private.screen_refresh_keys(p_keys text[]) returns void
language plpgsql security definer set search_path='' set enable_nestloop=off as $$
begin
 if coalesce(cardinality(p_keys),0)=0 then return; end if;
 perform private.screen_precompute_lock();
 delete from private.screen_observations where source_report_key=any(p_keys);
 insert into private.screen_observations
    with disclosures as materialized (
        select g.lineage_id,
               coalesce(bool_or(d.amounts_public), false) as amount_public,
               coalesce(bool_or(d.violation_law_public), false) as law_public,
               coalesce(bool_or(d.rating_public), false) as rating_public
          from private.community_consent_grants g
          left join private.community_policy_disclosures d on d.version = g.policy_version
         where g.revoked_at is null
         group by g.lineage_id
    ), active_grants as materialized (
        select g.grant_id, d.amount_public, d.law_public, d.rating_public
          from private.community_consent_grants g
          join private.community_consent_grants a
            on a.lineage_id = g.lineage_id and a.user_id = g.user_id and a.revoked_at is null
          join disclosures d on d.lineage_id = g.lineage_id
    ), scoped as materialized (
        -- D13: keep the whole eligible history of each candidate key for election.
        select f.dataset_key, f.source_report_key, f.report_number, f.payload_sha256, f.answer_accepted_at, f.contributor_id, f.first_accepted_at, f.report_date, f.completed_date, f.status, f.disposition, f.vehicle_raw, f.lat, f.lng, f.address, f.region_code, f.agency_key, f.agency_name, f.agency_current_name, f.manager_key, f.manager_name, f.amount_kind, f.amount_confirmed_won, f.violation_law, f.rating, f.category, g.amount_public, g.law_public, g.rating_public
          from private.community_report_facts f
          join private.contributor_profiles c on c.user_id = f.contributor_id and c.status = 'active'
          join active_grants g on g.grant_id = f.consent_grant_id
          
         where f.public_state = 'completed' and f.source_report_key = any(p_keys)
    ), budget as materialized (
        select count(*) as n from scoped
    ), admitted as materialized (
        -- Do not rank or build any JSON if the whole-history row budget is exceeded.
        select s.* from scoped s
    ), key_numbers as (
        -- R2: first known number over exactly the same eligible history as scoped.
        select distinct on (f.source_report_key) f.source_report_key, f.report_number as key_number
          from admitted f
         order by f.source_report_key, (f.report_number is null), f.first_accepted_at, f.contributor_id, f.dataset_key
    ),
    identified as materialized (
        select s.*, k.key_number,
               (s.source_report_key || '|' || coalesce(s.report_number, k.key_number, 'legacy')) as report_identity
          from admitted s join key_numbers k using (source_report_key)
    ), answers as (
        select report_identity,payload_sha256,max(answer_accepted_at) as answer_time
          from identified group by report_identity,payload_sha256
    ), answered as materialized (
        select i.*,a.answer_time from identified i join answers a using(report_identity,payload_sha256)
    ), elected as (
        -- Avoid unbounded-window tuple stores for a single identity with a very large history.
        select distinct on (report_identity) report_identity,contributor_id,dataset_key,report_date,completed_date
          from answered
         order by report_identity,answer_time desc,completed_date desc nulls last,first_accepted_at,contributor_id,dataset_key
    ), contributions as (
        select report_identity,count(*) as contribution_count from answered group by report_identity
    ), ranked as (
        select i.*,(i.contributor_id=e.contributor_id and i.dataset_key=e.dataset_key) as is_representative,
               e.report_date as identity_report_date,e.completed_date as identity_completed_date,c.contribution_count
          from answered i join elected e using(report_identity) join contributions c using(report_identity)
    )
select r.*,private.screen_address(address) as place_address,
 private.screen_place_key(private.screen_address(address)) as place,
 coalesce(private.analytics_region(region_code,null,null),private.analytics_region(region_code,lat,lng)) as region,
 case when law_public then private.screen_law(violation_law) end as law,
 private.screen_plate(vehicle_raw) as plate,
 private.screen_mask_plate(private.screen_plate(vehicle_raw)) as plate_mask,
 status in ('accepted','partial','rejected','withdrawn','transferred','completed_unknown') as done,
 case when status in ('accepted','partial','rejected','completed_unknown') and completed_date>=report_date then completed_date-report_date end as days,
 case when amount_kind='combined' then 'combined' when amount_kind='penalty' then case when disposition='fine' then 'conflict' else 'penalty' end
 when amount_kind='fine' and disposition<>'fine' then 'conflict' when disposition<>'fine' then 'none'
 when amount_kind is distinct from 'fine' or status not in ('accepted','partial') then 'conflict'
 when not amount_public then case when amount_confirmed_won is null then 'unconfirmed' else 'undisclosed' end
 when amount_confirmed_won is null then 'unconfirmed' else 'confirmed' end as amount_class,
 case when rating_public then rating end as stars
 from ranked r;
end $$;

create function private.screen_facts_changed() returns trigger
language plpgsql security definer set search_path='' as $$
declare keys text[];
begin
 if TG_OP='INSERT' then select array_agg(distinct source_report_key) into keys from new_rows;
 elsif TG_OP='DELETE' then select array_agg(distinct source_report_key) into keys from old_rows;
 else select array_agg(source_report_key) into keys from
  (select source_report_key from old_rows union select source_report_key from new_rows) k;
 end if;
 perform private.screen_refresh_keys(keys);
 return null;
end $$;
create trigger screen_precompute_insert after insert on private.community_report_facts referencing new table as new_rows
 for each statement execute function private.screen_facts_changed();
create trigger screen_precompute_update after update on private.community_report_facts referencing old table as old_rows new table as new_rows
 for each statement execute function private.screen_facts_changed();
create trigger screen_precompute_delete after delete on private.community_report_facts referencing old table as old_rows
 for each statement execute function private.screen_facts_changed();

-- Eligibility/disclosure changes can affect every participant of the changed source keys.
-- Include old and new users/lineages/versions so moves and deletions cannot strand public rows.
create function private.screen_eligibility_changed() returns trigger
language plpgsql security definer set search_path='' as $$
declare users uuid[]; lineages uuid[]; versions text[]; keys text[];
begin
 perform private.screen_precompute_lock();
 if TG_TABLE_NAME='contributor_profiles' then
  if TG_OP='INSERT' then select array_agg(user_id) into users from new_rows;
  elsif TG_OP='DELETE' then select array_agg(user_id) into users from old_rows;
  else select array_agg(user_id) into users from (select user_id from old_rows union select user_id from new_rows) u; end if;
 elsif TG_TABLE_NAME='community_consent_grants' then
  if TG_OP='INSERT' then select array_agg(lineage_id),array_agg(user_id) into lineages,users from new_rows;
  elsif TG_OP='DELETE' then select array_agg(lineage_id),array_agg(user_id) into lineages,users from old_rows;
  else select array_agg(lineage_id),array_agg(user_id) into lineages,users from
   (select lineage_id,user_id from old_rows union select lineage_id,user_id from new_rows) g; end if;
  select array_agg(distinct user_id) into users from
   (select unnest(users) as user_id union select user_id from private.community_consent_grants where lineage_id=any(lineages)) u;
 else
  if TG_OP='INSERT' then select array_agg(version) into versions from new_rows;
  elsif TG_OP='DELETE' then select array_agg(version) into versions from old_rows;
  else select array_agg(version) into versions from (select version from old_rows union select version from new_rows) d; end if;
  select array_agg(distinct lineage_id) into lineages from private.community_consent_grants where policy_version=any(versions);
  select array_agg(distinct user_id) into users from private.community_consent_grants where lineage_id=any(lineages);
 end if;
 select array_agg(source_report_key) into keys from (
  select source_report_key from private.community_report_facts where contributor_id=any(users)
  union select source_report_key from private.screen_observations where contributor_id=any(users)) k;
 perform private.screen_refresh_keys(keys);
 -- Unlike fact mutation, operator disclosure/profile DML may have no existing version trigger.
 if coalesce(cardinality(keys),0)>0 then perform private.community_bump_projection(); end if;
 return null;
end $$;
create trigger screen_precompute_insert after insert on private.contributor_profiles referencing new table as new_rows for each statement execute function private.screen_eligibility_changed();
create trigger screen_precompute_update after update on private.contributor_profiles referencing old table as old_rows new table as new_rows for each statement execute function private.screen_eligibility_changed();
create trigger screen_precompute_delete after delete on private.contributor_profiles referencing old table as old_rows for each statement execute function private.screen_eligibility_changed();
create trigger screen_precompute_insert after insert on private.community_consent_grants referencing new table as new_rows for each statement execute function private.screen_eligibility_changed();
create trigger screen_precompute_update after update on private.community_consent_grants referencing old table as old_rows new table as new_rows for each statement execute function private.screen_eligibility_changed();
create trigger screen_precompute_delete after delete on private.community_consent_grants referencing old table as old_rows for each statement execute function private.screen_eligibility_changed();
create trigger screen_precompute_insert after insert on private.community_policy_disclosures referencing new table as new_rows for each statement execute function private.screen_eligibility_changed();
create trigger screen_precompute_update after update on private.community_policy_disclosures referencing old table as old_rows new table as new_rows for each statement execute function private.screen_eligibility_changed();
create trigger screen_precompute_delete after delete on private.community_policy_disclosures referencing old table as old_rows for each statement execute function private.screen_eligibility_changed();

alter table private.screen_precompute_control enable row level security;
alter table private.screen_observations enable row level security;
revoke all on private.screen_precompute_control,private.screen_observations from public,anon,authenticated,service_role;
revoke all on function private.screen_precompute_lock() from public,anon,authenticated,service_role;
revoke all on function private.screen_refresh_keys(text[]) from public,anon,authenticated,service_role;
revoke all on function private.screen_facts_changed() from public,anon,authenticated,service_role;
revoke all on function private.screen_eligibility_changed() from public,anon,authenticated,service_role;



grant select on private.screen_precompute_control to postgres;
-- Panel-separated monthly rollups, maintained transactionally from stored observations.
-- Date-boundary days and compound spatial/entity scopes use the exact stored projection.

set local lock_timeout='3s';
create table private.screen_month_rollups as
with base as materialized (
 select o.*,b.basis,b.day,date_trunc('month',b.day)::date as month,
 true as report_member,done as done_member,
 case b.basis when 'report_date' then completed_date else report_date end as other_day
 from private.screen_observations o cross join lateral
 (values('report_date',identity_report_date),('completed_date',identity_completed_date)) b(basis,day)
 where is_representative and b.day is not null
 and (false)
), expanded as (
 select s.*,g.kind collate "C" as kind,g.k collate "C" as k,g.focus collate "C" as focus from base s cross join lateral (
 select 'summary' as kind,''::text as k,''::text as focus
 union all select 'agency',coalesce(nullif(agency_key,''),'agency-unknown'),'' where done_member
 union all select 'manager',coalesce(nullif(agency_key,''),'agency-unknown')||':'||coalesce(nullif(manager_key,''),'manager-unknown'),'' where done_member
 union all select 'law',coalesce(law,''),'' where done_member
 union all select 'region',coalesce(region,''),''
 union all select 'region',left(region,2),'' where region is not null
 union all select 'place',coalesce(place,''),''
 union all select 'heat',coalesce(nullif(agency_key,''),'agency-unknown'),law where done_member and law is not null
 ) g
)
 select basis,month,category,kind,k,focus,min(report_identity collate "C") as first_identity,
 count(*) filter(where report_member) as n,count(*) filter(where done_member) as c,
 count(*) filter(where done_member and status='accepted') as a,count(*) filter(where done_member and status='partial') as p,count(*) filter(where done_member and status='rejected') as r,
 count(*) filter(where done_member and disposition='fine') as f,count(*) filter(where done_member and disposition='warning') as w,count(*) filter(where done_member and disposition='penalty') as penalty,
 count(*) filter(where report_member and other_day is null) as missing,
 count(*) filter(where done_member and completed_date is null) as answer_missing,
 count(days) filter(where done_member) as dn,sum(days) filter(where done_member) as ds,array_agg(days::bigint) filter(where done_member and days is not null and kind not in ('place','law','heat')) as dvalues,
 min(days) filter(where done_member) as dmin,max(days) filter(where done_member) as dmax,
 count(*) filter(where done_member and status in ('accepted','partial','rejected','completed_unknown') and completed_date is not null and report_date is null) as dnr,
 count(*) filter(where done_member and status in ('accepted','partial','rejected','completed_unknown') and completed_date<report_date) as drev,
 count(*) filter(where done_member and status in ('accepted','partial','rejected','completed_unknown') and completed_date is null) as dna,
 count(*) filter(where done_member and amount_class='confirmed') as an,
 sum(amount_confirmed_won) filter(where done_member and amount_class='confirmed') as asum,
 array_agg(amount_confirmed_won) filter(where kind in ('summary','focus') and done_member and amount_class='confirmed') as avalues,
 count(*) filter(where done_member and amount_class='confirmed' and amount_confirmed_won=0) as az,
 count(*) filter(where done_member and amount_class='unconfirmed') as aunconfirmed,
 count(*) filter(where done_member and amount_class='undisclosed') as aundisclosed,
 count(*) filter(where done_member and amount_class='conflict') as aconflict,
 count(*) filter(where done_member and amount_class='penalty') as apenalty,
 count(*) filter(where done_member and amount_class='combined') as acombined,
 count(stars) filter(where done_member) as rn,sum(stars) filter(where done_member) as rs,
 count(*) filter(where kind='summary' and done_member and days between 0 and 6) as h0,
 count(*) filter(where kind='summary' and done_member and days between 7 and 13) as h1,
 count(*) filter(where kind='summary' and done_member and days between 14 and 20) as h2,
 count(*) filter(where kind='summary' and done_member and days between 21 and 27) as h3,
 count(*) filter(where kind='summary' and done_member and days between 28 and 34) as h4,
 count(*) filter(where kind='summary' and done_member and days between 35 and 41) as h5,
 count(*) filter(where kind='summary' and done_member and days between 42 and 48) as h6,
 count(*) filter(where kind='summary' and done_member and days between 49 and 55) as h7,
 count(*) filter(where kind='summary' and done_member and days between 56 and 62) as h8,
 count(*) filter(where kind='summary' and done_member and days between 63 and 69) as h9,
 count(*) filter(where kind='summary' and done_member and days between 70 and 76) as h10,
 count(*) filter(where kind='summary' and done_member and days between 77 and 83) as h11,
 count(*) filter(where kind='summary' and done_member and days >=84) as h12,
 count(*) filter(where kind='summary' and done_member and true and stars=1) as rall1,
 count(*) filter(where kind='summary' and done_member and true and stars=2) as rall2,
 count(*) filter(where kind='summary' and done_member and true and stars=3) as rall3,
 count(*) filter(where kind='summary' and done_member and true and stars=4) as rall4,
 count(*) filter(where kind='summary' and done_member and true and stars=5) as rall5,
 count(*) filter(where kind='summary' and done_member and status='accepted' and stars=1) as raccepted1,
 count(*) filter(where kind='summary' and done_member and status='accepted' and stars=2) as raccepted2,
 count(*) filter(where kind='summary' and done_member and status='accepted' and stars=3) as raccepted3,
 count(*) filter(where kind='summary' and done_member and status='accepted' and stars=4) as raccepted4,
 count(*) filter(where kind='summary' and done_member and status='accepted' and stars=5) as raccepted5,
 count(*) filter(where kind='summary' and done_member and status='partial' and stars=1) as rpartial1,
 count(*) filter(where kind='summary' and done_member and status='partial' and stars=2) as rpartial2,
 count(*) filter(where kind='summary' and done_member and status='partial' and stars=3) as rpartial3,
 count(*) filter(where kind='summary' and done_member and status='partial' and stars=4) as rpartial4,
 count(*) filter(where kind='summary' and done_member and status='partial' and stars=5) as rpartial5,
 count(*) filter(where kind='summary' and done_member and status='rejected' and stars=1) as rrejected1,
 count(*) filter(where kind='summary' and done_member and status='rejected' and stars=2) as rrejected2,
 count(*) filter(where kind='summary' and done_member and status='rejected' and stars=3) as rrejected3,
 count(*) filter(where kind='summary' and done_member and status='rejected' and stars=4) as rrejected4,
 count(*) filter(where kind='summary' and done_member and status='rejected' and stars=5) as rrejected5,
 count(*) filter(where kind='summary' and done_member and disposition='fine' and stars=1) as rfine1,
 count(*) filter(where kind='summary' and done_member and disposition='fine' and stars=2) as rfine2,
 count(*) filter(where kind='summary' and done_member and disposition='fine' and stars=3) as rfine3,
 count(*) filter(where kind='summary' and done_member and disposition='fine' and stars=4) as rfine4,
 count(*) filter(where kind='summary' and done_member and disposition='fine' and stars=5) as rfine5,
 count(*) filter(where kind='summary' and done_member and status not in ('accepted','partial','rejected') and stars=1) as runknown1,
 count(*) filter(where kind='summary' and done_member and status not in ('accepted','partial','rejected') and stars=2) as runknown2,
 count(*) filter(where kind='summary' and done_member and status not in ('accepted','partial','rejected') and stars=3) as runknown3,
 count(*) filter(where kind='summary' and done_member and status not in ('accepted','partial','rejected') and stars=4) as runknown4,
 count(*) filter(where kind='summary' and done_member and status not in ('accepted','partial','rejected') and stars=5) as runknown5
 from expanded group by basis,month,category,kind,k,focus
 with no data;
alter table private.screen_month_rollups add primary key(basis,month,category,kind,k,focus);
create index screen_month_rollups_range on private.screen_month_rollups(basis,month,category);
create index screen_month_rollups_summary on private.screen_month_rollups(basis,month,category) where kind='summary';
create aggregate private.screen_array_concat(bigint[]) (sfunc=array_cat,stype=bigint[],initcond='{}');
create function private.screen_refresh_months(p_months date[]) returns void
language plpgsql security definer set search_path='' as $$
begin
 if coalesce(cardinality(p_months),0)=0 then return;end if;
 delete from private.screen_month_rollups where month=any(p_months);
 insert into private.screen_month_rollups
with base as materialized (
 select o.*,b.basis,b.day,date_trunc('month',b.day)::date as month,
 true as report_member,done as done_member,
 case b.basis when 'report_date' then completed_date else report_date end as other_day
 from private.screen_observations o cross join lateral
 (values('report_date',identity_report_date),('completed_date',identity_completed_date)) b(basis,day)
 where is_representative and b.day is not null
 and (p_months is null or date_trunc('month',b.day)::date=any(p_months))
), expanded as (
 select s.*,g.kind collate "C" as kind,g.k collate "C" as k,g.focus collate "C" as focus from base s cross join lateral (
 select 'summary' as kind,''::text as k,''::text as focus
 union all select 'agency',coalesce(nullif(agency_key,''),'agency-unknown'),'' where done_member
 union all select 'manager',coalesce(nullif(agency_key,''),'agency-unknown')||':'||coalesce(nullif(manager_key,''),'manager-unknown'),'' where done_member
 union all select 'law',coalesce(law,''),'' where done_member
 union all select 'region',coalesce(region,''),''
 union all select 'region',left(region,2),'' where region is not null
 union all select 'place',coalesce(place,''),''
 union all select 'heat',coalesce(nullif(agency_key,''),'agency-unknown'),law where done_member and law is not null
 ) g
)
 select basis,month,category,kind,k,focus,min(report_identity collate "C") as first_identity,
 count(*) filter(where report_member) as n,count(*) filter(where done_member) as c,
 count(*) filter(where done_member and status='accepted') as a,count(*) filter(where done_member and status='partial') as p,count(*) filter(where done_member and status='rejected') as r,
 count(*) filter(where done_member and disposition='fine') as f,count(*) filter(where done_member and disposition='warning') as w,count(*) filter(where done_member and disposition='penalty') as penalty,
 count(*) filter(where report_member and other_day is null) as missing,
 count(*) filter(where done_member and completed_date is null) as answer_missing,
 count(days) filter(where done_member) as dn,sum(days) filter(where done_member) as ds,array_agg(days::bigint) filter(where done_member and days is not null and kind not in ('place','law','heat')) as dvalues,
 min(days) filter(where done_member) as dmin,max(days) filter(where done_member) as dmax,
 count(*) filter(where done_member and status in ('accepted','partial','rejected','completed_unknown') and completed_date is not null and report_date is null) as dnr,
 count(*) filter(where done_member and status in ('accepted','partial','rejected','completed_unknown') and completed_date<report_date) as drev,
 count(*) filter(where done_member and status in ('accepted','partial','rejected','completed_unknown') and completed_date is null) as dna,
 count(*) filter(where done_member and amount_class='confirmed') as an,
 sum(amount_confirmed_won) filter(where done_member and amount_class='confirmed') as asum,
 array_agg(amount_confirmed_won) filter(where kind in ('summary','focus') and done_member and amount_class='confirmed') as avalues,
 count(*) filter(where done_member and amount_class='confirmed' and amount_confirmed_won=0) as az,
 count(*) filter(where done_member and amount_class='unconfirmed') as aunconfirmed,
 count(*) filter(where done_member and amount_class='undisclosed') as aundisclosed,
 count(*) filter(where done_member and amount_class='conflict') as aconflict,
 count(*) filter(where done_member and amount_class='penalty') as apenalty,
 count(*) filter(where done_member and amount_class='combined') as acombined,
 count(stars) filter(where done_member) as rn,sum(stars) filter(where done_member) as rs,
 count(*) filter(where kind='summary' and done_member and days between 0 and 6) as h0,
 count(*) filter(where kind='summary' and done_member and days between 7 and 13) as h1,
 count(*) filter(where kind='summary' and done_member and days between 14 and 20) as h2,
 count(*) filter(where kind='summary' and done_member and days between 21 and 27) as h3,
 count(*) filter(where kind='summary' and done_member and days between 28 and 34) as h4,
 count(*) filter(where kind='summary' and done_member and days between 35 and 41) as h5,
 count(*) filter(where kind='summary' and done_member and days between 42 and 48) as h6,
 count(*) filter(where kind='summary' and done_member and days between 49 and 55) as h7,
 count(*) filter(where kind='summary' and done_member and days between 56 and 62) as h8,
 count(*) filter(where kind='summary' and done_member and days between 63 and 69) as h9,
 count(*) filter(where kind='summary' and done_member and days between 70 and 76) as h10,
 count(*) filter(where kind='summary' and done_member and days between 77 and 83) as h11,
 count(*) filter(where kind='summary' and done_member and days >=84) as h12,
 count(*) filter(where kind='summary' and done_member and true and stars=1) as rall1,
 count(*) filter(where kind='summary' and done_member and true and stars=2) as rall2,
 count(*) filter(where kind='summary' and done_member and true and stars=3) as rall3,
 count(*) filter(where kind='summary' and done_member and true and stars=4) as rall4,
 count(*) filter(where kind='summary' and done_member and true and stars=5) as rall5,
 count(*) filter(where kind='summary' and done_member and status='accepted' and stars=1) as raccepted1,
 count(*) filter(where kind='summary' and done_member and status='accepted' and stars=2) as raccepted2,
 count(*) filter(where kind='summary' and done_member and status='accepted' and stars=3) as raccepted3,
 count(*) filter(where kind='summary' and done_member and status='accepted' and stars=4) as raccepted4,
 count(*) filter(where kind='summary' and done_member and status='accepted' and stars=5) as raccepted5,
 count(*) filter(where kind='summary' and done_member and status='partial' and stars=1) as rpartial1,
 count(*) filter(where kind='summary' and done_member and status='partial' and stars=2) as rpartial2,
 count(*) filter(where kind='summary' and done_member and status='partial' and stars=3) as rpartial3,
 count(*) filter(where kind='summary' and done_member and status='partial' and stars=4) as rpartial4,
 count(*) filter(where kind='summary' and done_member and status='partial' and stars=5) as rpartial5,
 count(*) filter(where kind='summary' and done_member and status='rejected' and stars=1) as rrejected1,
 count(*) filter(where kind='summary' and done_member and status='rejected' and stars=2) as rrejected2,
 count(*) filter(where kind='summary' and done_member and status='rejected' and stars=3) as rrejected3,
 count(*) filter(where kind='summary' and done_member and status='rejected' and stars=4) as rrejected4,
 count(*) filter(where kind='summary' and done_member and status='rejected' and stars=5) as rrejected5,
 count(*) filter(where kind='summary' and done_member and disposition='fine' and stars=1) as rfine1,
 count(*) filter(where kind='summary' and done_member and disposition='fine' and stars=2) as rfine2,
 count(*) filter(where kind='summary' and done_member and disposition='fine' and stars=3) as rfine3,
 count(*) filter(where kind='summary' and done_member and disposition='fine' and stars=4) as rfine4,
 count(*) filter(where kind='summary' and done_member and disposition='fine' and stars=5) as rfine5,
 count(*) filter(where kind='summary' and done_member and status not in ('accepted','partial','rejected') and stars=1) as runknown1,
 count(*) filter(where kind='summary' and done_member and status not in ('accepted','partial','rejected') and stars=2) as runknown2,
 count(*) filter(where kind='summary' and done_member and status not in ('accepted','partial','rejected') and stars=3) as runknown3,
 count(*) filter(where kind='summary' and done_member and status not in ('accepted','partial','rejected') and stars=4) as runknown4,
 count(*) filter(where kind='summary' and done_member and status not in ('accepted','partial','rejected') and stars=5) as runknown5
 from expanded group by basis,month,category,kind,k,focus
;
end $$;

-- Transition tables avoid N repeated refreshes for a batch mutation. Only dirty calendar partitions
-- are rebuilt; old and new dates are both included, including identity date changes on re-election.
create table private.screen_dirty_months(month date primary key);
insert into private.screen_dirty_months select distinct date_trunc('month',d)::date
 from private.screen_observations cross join lateral (values(identity_report_date),(identity_completed_date)) x(d) where d is not null;
update private.screen_precompute_control set ready=false where singleton;
create function private.screen_rollup_changed() returns trigger
language plpgsql security definer set search_path='' as $$
declare months date[];
begin
 if TG_OP='INSERT' then
  select array_agg(distinct date_trunc('month',d)::date) filter(where d is not null) into months
  from new_observations cross join lateral (values(identity_report_date),(identity_completed_date)) x(d);
 else
  select array_agg(distinct date_trunc('month',d)::date) filter(where d is not null) into months
  from old_observations cross join lateral (values(identity_report_date),(identity_completed_date)) x(d);
 end if;
 insert into private.screen_dirty_months select unnest(months) on conflict do nothing;
 return null;
end $$;
-- Coalesce all statements of a 20-event RPC. A constraint trigger runs before COMMIT, not in a
-- background worker. Other transactions see either the old fact+rollup pair or the new pair.
create function private.screen_rollup_flush() returns trigger
language plpgsql security definer set search_path='' as $$
declare months date[];
begin
 if (select ready from private.screen_precompute_control where singleton) then
  select array_agg(month) into months from private.screen_dirty_months;
  if cardinality(months)>0 then
   perform private.screen_refresh_months(months);
   delete from private.screen_dirty_months where month=any(months);
  end if;
 end if;
 return null;
end $$;
create constraint trigger screen_rollup_flush after insert on private.screen_dirty_months
 deferrable initially deferred for each row execute function private.screen_rollup_flush();
revoke all on function private.screen_rollup_flush() from public,anon,authenticated,service_role;
create trigger screen_rollup_insert after insert on private.screen_observations referencing new table as new_observations
 for each statement execute function private.screen_rollup_changed();
create trigger screen_rollup_delete after delete on private.screen_observations referencing old table as old_observations
 for each statement execute function private.screen_rollup_changed();
create or replace function private.screen_precompute_backfill(p_limit integer default 250) returns jsonb
language plpgsql security definer set search_path='' as $$
declare keys text[]; cursor_value text; is_ready boolean; months date[];
begin
 if p_limit is null or p_limit not between 1 and 1000 then raise exception 'INVALID_QUERY'; end if;
 perform private.screen_precompute_lock();
 update private.screen_precompute_control set epoch=epoch+1 where singleton
 returning backfill_cursor,ready into cursor_value,is_ready;
 if is_ready then return jsonb_build_object('done',true,'keys',0,'months',0); end if;
 select array_agg(source_report_key order by source_report_key) into keys from (
  select distinct source_report_key from private.community_report_facts
  where cursor_value is null or source_report_key>cursor_value order by source_report_key limit p_limit) k;
 if coalesce(cardinality(keys),0)>0 then
  perform private.screen_refresh_keys(keys);
  update private.screen_precompute_control set backfill_cursor=keys[cardinality(keys)] where singleton;
  return jsonb_build_object('done',false,'keys',cardinality(keys),'months',0);
 end if;
 select array_agg(month) into months from (select month from private.screen_dirty_months order by month limit 1) m;
 if coalesce(cardinality(months),0)>0 then
  perform private.screen_refresh_months(months);
  delete from private.screen_dirty_months where month=any(months);
  return jsonb_build_object('done',false,'keys',0,'months',cardinality(months));
 end if;
 update private.screen_precompute_control set ready=true where singleton;
 return jsonb_build_object('done',true,'keys',0,'months',0);
end $$;
revoke all on function private.screen_precompute_backfill(integer) from public,anon,authenticated,service_role;
alter table private.screen_dirty_months enable row level security;
revoke all on private.screen_dirty_months from public,anon,authenticated,service_role;
grant select on private.screen_dirty_months to postgres;
alter table private.screen_month_rollups enable row level security;
revoke all on private.screen_month_rollups from public,anon,authenticated,service_role;
revoke all on function private.screen_array_concat(bigint[]),private.screen_refresh_months(date[]),private.screen_rollup_changed()
 from public,anon,authenticated,service_role;

create function private.analytics_screen_precomputed(p_scope jsonb,p_user uuid,p_panels jsonb)
returns json language plpgsql stable security definer set search_path='' set enable_nestloop=off set enable_sort=off as $$
declare p_date_basis text:=p_scope->>'date_basis'; p_start date:=(p_scope->>'start')::date; p_end date:=(p_scope->>'end')::date;
 p_category text:=p_scope->>'category';p_agency_key text:=p_scope->>'agency_key';p_manager_key text:=p_scope->>'manager_key';
 p_bbox double precision[];use_rollups boolean;v_from date;result json;v_budget bigint;
begin
 if not (select ready from private.screen_precompute_control where singleton)
   or exists(select 1 from private.screen_dirty_months) then
  return private.analytics_screen_aggregate_v2(p_scope,p_user,p_panels);
 end if;

 if p_date_basis is null or p_date_basis not in ('report_date','completed_date') or p_start is null or p_end is null or p_end<p_start
 or p_start-(p_end-p_start+1)<date '1900-01-01' or p_category is null or p_category not in ('all','traffic','parking','other')
 or jsonb_typeof(p_panels)<>'array' or jsonb_array_length(p_panels)>8 then raise exception 'INVALID_QUERY';end if;
 if jsonb_typeof(p_scope->'bbox')='array' then select array_agg(x::double precision order by n) into p_bbox
 from jsonb_array_elements_text(p_scope->'bbox') with ordinality a(x,n);end if;
 v_from:=p_start-(p_end-p_start+1);
 use_rollups:=p_agency_key is null and p_manager_key is null and p_bbox is null
  and p_scope->>'region_code' is null and p_scope->>'law' is null;
    with candidates as materialized (
 select distinct source_report_key from private.screen_observations
 where (case p_date_basis when 'report_date' then report_date else completed_date end) between v_from and p_end
 and (p_category='all' or category=p_category)
 and (p_agency_key is null or agency_key=p_agency_key) and (p_manager_key is null or manager_key=p_manager_key)
 and (p_bbox is null or (lat is not null and lng between p_bbox[1] and p_bbox[3] and lat between p_bbox[2] and p_bbox[4]))
), budget as materialized (
 select count(*) as n from private.screen_observations where source_report_key in (select source_report_key from candidates)
), ordered as materialized (
 select r.report_identity,r.contributor_id,r.first_accepted_at,r.report_date,r.completed_date,r.identity_report_date,r.identity_completed_date,r.status,r.disposition,r.lat,r.lng,r.agency_key,r.agency_name,r.agency_current_name,r.manager_key,r.manager_name,r.is_representative,r.amount_confirmed_won,r.place_address,r.place,r.region,r.law,r.plate,r.plate_mask,r.done,r.days,r.amount_class,r.stars,row_number() over(order by report_identity,answer_time desc,completed_date desc nulls last,first_accepted_at,contributor_id,dataset_key) as ord
 from private.screen_observations r where (select n<=100000 from budget)
 and source_report_key in (select source_report_key from candidates)
 and (p_category='all' or category=p_category)
 and (p_agency_key is null or agency_key=p_agency_key) and (p_manager_key is null or manager_key=p_manager_key)
 and (p_bbox is null or (lat is not null and lng between p_bbox[1] and p_bbox[3] and lat between p_bbox[2] and p_bbox[4]))
 and (case p_date_basis when 'report_date' then identity_report_date else identity_completed_date end) between v_from and p_end
), normalized as materialized (
 select o.*,case p_date_basis when 'report_date' then identity_report_date else identity_completed_date end as day,
 case p_date_basis when 'report_date' then completed_date else report_date end as other_day from ordered o
), filtered as materialized (
 select * from normalized where (p_scope->>'region_code' is null or region like (p_scope->>'region_code')||'%')
 and (p_scope->>'law' is null or case when p_scope->>'law'='__none__' then law is null else law=private.screen_law(p_scope->>'law') end)
) , own_done as materialized (
 select distinct on(report_identity) ord from filtered where contributor_id=p_user and done
 order by report_identity,first_accepted_at,ord
), own as materialized (
 select distinct on(report_identity) ord from filtered where contributor_id=p_user
 order by report_identity,first_accepted_at,ord
), sides as materialized (
 select f.*,s.side collate "C" as side,s.report_member,s.done_member,case when day>=p_start then 0 else 1 end as period
 from filtered f left join own m on m.ord=f.ord left join own_done md on md.ord=f.ord
 cross join lateral (select 'all' as side,true as report_member,f.done as done_member where f.is_representative
 union all select 'mine',m.ord is not null,md.ord is not null where (m.ord is not null or md.ord is not null)
 and exists(select 1 from jsonb_array_elements(p_panels) p where p->>'path'='compare')) s
), focus as materialized (
 select distinct substr(p->>'path',8) as key from jsonb_array_elements(p_panels) p where p->>'path' like 'places/pl1:%'
), complete_months as materialized (
 select distinct month,case when month>=p_start then 0 else 1 end as period
 from private.screen_month_rollups where use_rollups and kind='summary' and basis=p_date_basis
 and month>=v_from and month<=p_end
 and month>=case when month>=p_start then p_start else v_from end
 and (month+interval '1 month'-interval '1 day')::date<=case when month>=p_start then p_end else p_start-1 end
), saved as not materialized (
 select 'all'::text as side,m.period,t.*,o.ord
 from private.screen_month_rollups t join complete_months m using(month)
 join ordered o on o.report_identity=t.first_identity and o.is_representative
 where t.basis=p_date_basis and (p_category='all' or t.category=p_category)
), rollup_rows as not materialized (
 select s.*,g.kind as output_kind,g.k as output_key from saved s cross join lateral (
 select s.kind,s.k where (period=0 or kind='summary')
 union all select 'month',to_char(month,'YYYY-MM') where period=0 and kind='summary') g
), expanded as not materialized (
 select s.*,g.kind collate "C" as kind,g.k collate "C" as k,g.focus collate "C" as focus from sides s cross join lateral (
 select 'summary' as kind,''::text as k,''::text as focus
 union all select 'month',to_char(day,'YYYY-MM'),'' where period=0
 union all select 'agency',coalesce(nullif(agency_key,''),'agency-unknown'),'' where period=0 and done_member
 union all select 'manager',coalesce(nullif(agency_key,''),'agency-unknown')||':'||coalesce(nullif(manager_key,''),'manager-unknown'),'' where period=0 and done_member
 union all select 'law',coalesce(law,''),'' where period=0 and done_member and side='all'
 union all select 'region',coalesce(region,''),'' where period=0
 union all select 'region',left(region,2),'' where period=0 and region is not null
 union all select 'place',coalesce(place,''),'' where period=0
 union all select 'focus','',place where side='all' and place in(select key from focus)
 union all select 'agency',coalesce(nullif(agency_key,''),'agency-unknown'),place where side='all' and period=0 and done_member and place in(select key from focus)
 union all select 'manager',coalesce(nullif(agency_key,''),'agency-unknown')||':'||coalesce(nullif(manager_key,''),'manager-unknown'),place where side='all' and period=0 and done_member and place in(select key from focus)
 union all select 'heat',case when p_scope->>'agency_key' is null then coalesce(nullif(agency_key,''),'agency-unknown') else
 coalesce(nullif(agency_key,''),'agency-unknown')||':'||coalesce(nullif(manager_key,''),'manager-unknown') end,law where side='all' and period=0 and done_member and law is not null
 ) g
 where s.side<>'all' or g.focus<>'' and g.kind<>'heat'
 or not exists(select 1 from complete_months m where m.month=date_trunc('month',s.day)::date)
), raw_stats as (
 select side,period,kind,k,focus,min(ord) as ord,
 count(*) filter(where report_member) as n,count(*) filter(where done_member) as c,
 count(*) filter(where done_member and status='accepted') as a,count(*) filter(where done_member and status='partial') as p,count(*) filter(where done_member and status='rejected') as r,
 count(*) filter(where done_member and disposition='fine') as f,count(*) filter(where done_member and disposition='warning') as w,count(*) filter(where done_member and disposition='penalty') as penalty,
 count(*) filter(where report_member and other_day is null) as missing,
 count(*) filter(where done_member and completed_date is null) as answer_missing,
 count(days) filter(where done_member) as dn,sum(days) filter(where done_member) as ds,array_agg(days::bigint) filter(where done_member and days is not null and kind not in ('place','law','heat')) as dvalues,
 min(days) filter(where done_member) as dmin,max(days) filter(where done_member) as dmax,
 count(*) filter(where done_member and status in ('accepted','partial','rejected','completed_unknown') and completed_date is not null and report_date is null) as dnr,
 count(*) filter(where done_member and status in ('accepted','partial','rejected','completed_unknown') and completed_date<report_date) as drev,
 count(*) filter(where done_member and status in ('accepted','partial','rejected','completed_unknown') and completed_date is null) as dna,
 count(*) filter(where done_member and amount_class='confirmed') as an,
 sum(amount_confirmed_won) filter(where done_member and amount_class='confirmed') as asum,
 array_agg(amount_confirmed_won) filter(where kind in ('summary','focus') and done_member and amount_class='confirmed') as avalues,
 count(*) filter(where done_member and amount_class='confirmed' and amount_confirmed_won=0) as az,
 count(*) filter(where done_member and amount_class='unconfirmed') as aunconfirmed,
 count(*) filter(where done_member and amount_class='undisclosed') as aundisclosed,
 count(*) filter(where done_member and amount_class='conflict') as aconflict,
 count(*) filter(where done_member and amount_class='penalty') as apenalty,
 count(*) filter(where done_member and amount_class='combined') as acombined,
 count(stars) filter(where done_member) as rn,sum(stars) filter(where done_member) as rs
 from expanded where kind not in ('heat','place') group by side,period,kind,k,focus
), stats_inputs as (
 select side,period,kind,k,focus,ord,n,c,a,p,r,f,w,penalty,missing,answer_missing,dn,ds,dvalues,dmin,dmax,dnr,drev,dna,an,asum,avalues,az,aunconfirmed,aundisclosed,aconflict,apenalty,acombined,rn,rs from raw_stats
 union all
 select side,period,output_kind,output_key,focus,ord,n,c,a,p,r,f,w,penalty,missing,answer_missing,dn,ds,dvalues,dmin,dmax,dnr,drev,dna,an,asum,avalues,az,aunconfirmed,aundisclosed,aconflict,apenalty,acombined,rn,rs from rollup_rows where kind not in ('heat','place')
), stats as (
 select side,period,kind,k,focus,min(ord) as ord,sum(n) as n,sum(c) as c,sum(a) as a,sum(p) as p,sum(r) as r,sum(f) as f,sum(w) as w,sum(penalty) as penalty,sum(missing) as missing,sum(answer_missing) as answer_missing,sum(dn) as dn,sum(ds) as ds,private.screen_array_concat(dvalues) as dvalues,min(dmin) as dmin,max(dmax) as dmax,sum(dnr) as dnr,sum(drev) as drev,sum(dna) as dna,sum(an) as an,sum(asum) as asum,private.screen_array_concat(avalues) as avalues,sum(az) as az,sum(aunconfirmed) as aunconfirmed,sum(aundisclosed) as aundisclosed,sum(aconflict) as aconflict,sum(apenalty) as apenalty,sum(acombined) as acombined,sum(rn) as rn,sum(rs) as rs
 from stats_inputs group by side,period,kind,k,focus
), summary_details as materialized (
 select side,period,
 count(*) filter(where done_member and days between 0 and 6) as h0,
 count(*) filter(where done_member and days between 7 and 13) as h1,
 count(*) filter(where done_member and days between 14 and 20) as h2,
 count(*) filter(where done_member and days between 21 and 27) as h3,
 count(*) filter(where done_member and days between 28 and 34) as h4,
 count(*) filter(where done_member and days between 35 and 41) as h5,
 count(*) filter(where done_member and days between 42 and 48) as h6,
 count(*) filter(where done_member and days between 49 and 55) as h7,
 count(*) filter(where done_member and days between 56 and 62) as h8,
 count(*) filter(where done_member and days between 63 and 69) as h9,
 count(*) filter(where done_member and days between 70 and 76) as h10,
 count(*) filter(where done_member and days between 77 and 83) as h11,
 count(*) filter(where done_member and days >=84) as h12,
 count(*) filter(where done_member and true and stars=1) as rall1,
 count(*) filter(where done_member and true and stars=2) as rall2,
 count(*) filter(where done_member and true and stars=3) as rall3,
 count(*) filter(where done_member and true and stars=4) as rall4,
 count(*) filter(where done_member and true and stars=5) as rall5,
 count(*) filter(where done_member and status='accepted' and stars=1) as raccepted1,
 count(*) filter(where done_member and status='accepted' and stars=2) as raccepted2,
 count(*) filter(where done_member and status='accepted' and stars=3) as raccepted3,
 count(*) filter(where done_member and status='accepted' and stars=4) as raccepted4,
 count(*) filter(where done_member and status='accepted' and stars=5) as raccepted5,
 count(*) filter(where done_member and status='partial' and stars=1) as rpartial1,
 count(*) filter(where done_member and status='partial' and stars=2) as rpartial2,
 count(*) filter(where done_member and status='partial' and stars=3) as rpartial3,
 count(*) filter(where done_member and status='partial' and stars=4) as rpartial4,
 count(*) filter(where done_member and status='partial' and stars=5) as rpartial5,
 count(*) filter(where done_member and status='rejected' and stars=1) as rrejected1,
 count(*) filter(where done_member and status='rejected' and stars=2) as rrejected2,
 count(*) filter(where done_member and status='rejected' and stars=3) as rrejected3,
 count(*) filter(where done_member and status='rejected' and stars=4) as rrejected4,
 count(*) filter(where done_member and status='rejected' and stars=5) as rrejected5,
 count(*) filter(where done_member and disposition='fine' and stars=1) as rfine1,
 count(*) filter(where done_member and disposition='fine' and stars=2) as rfine2,
 count(*) filter(where done_member and disposition='fine' and stars=3) as rfine3,
 count(*) filter(where done_member and disposition='fine' and stars=4) as rfine4,
 count(*) filter(where done_member and disposition='fine' and stars=5) as rfine5,
 count(*) filter(where done_member and status not in ('accepted','partial','rejected') and stars=1) as runknown1,
 count(*) filter(where done_member and status not in ('accepted','partial','rejected') and stars=2) as runknown2,
 count(*) filter(where done_member and status not in ('accepted','partial','rejected') and stars=3) as runknown3,
 count(*) filter(where done_member and status not in ('accepted','partial','rejected') and stars=4) as runknown4,
 count(*) filter(where done_member and status not in ('accepted','partial','rejected') and stars=5) as runknown5
 from sides group by side,period) , stat_values as materialized (
 select s.*,private.screen_quantiles(dvalues) as dq,private.screen_quantiles(avalues) as aq from stats s
), place_counts as (
 select side,period,count(distinct place collate "C") filter(where report_member) as n from sides group by side,period
), raw_light_stats as (
 select side,period,kind,k,focus,min(ord) as ord,
 count(*) filter(where report_member) as n,count(*) filter(where done_member) as c,
 count(*) filter(where done_member and status='accepted') as a,
 count(*) filter(where done_member and status='partial') as p,
 count(*) filter(where done_member and status='rejected') as r,
 count(*) filter(where done_member and disposition='fine') as f,
 count(*) filter(where done_member and disposition='warning') as w
 from expanded where kind in ('place','heat') group by side,period,kind,k,focus
), light_inputs as (
 select * from raw_light_stats union all
 select side,period,output_kind,output_key,focus,ord,n,c,a,p,r,f,w from rollup_rows where kind in ('heat','place')
), light_stats as materialized (
 select side,period,kind,k,focus,min(ord) as ord,sum(n) as n,sum(c) as c,sum(a) as a,sum(p) as p,sum(r) as r,sum(f) as f,sum(w) as w
 from light_inputs group by side,period,kind,k,focus
), heat_rows as materialized (
 select k,sum(c) as n,min(ord) as ord from light_stats where kind='heat' group by k
), heat_laws as materialized (
 select focus,sum(c) as n from light_stats where kind='heat' group by focus
), heat_top_rows as materialized (
 select h.*,o.agency_key,coalesce(nullif(o.agency_current_name,''),nullif(o.agency_name,''),'기관 정보 없음') as agency_name,o.manager_key,o.manager_name
 from heat_rows h join ordered o using(ord)
 order by n desc,coalesce(nullif(o.agency_current_name,''),nullif(o.agency_name,''),'기관 정보 없음') collate "ko-x-icu",k collate "en-x-icu" limit 40
), heat_top_laws as materialized (
 select * from heat_laws order by n desc,focus collate "ko-x-icu" limit 16
), stat_json as (
 select json_build_array(side,period,kind,k,focus,stats.ord,json_build_array(o.agency_key,coalesce(nullif(o.agency_current_name,''),nullif(o.agency_name,''),'기관 정보 없음'),o.manager_key,o.manager_name),stats.n,c,a,p,r,f,w,penalty,case when kind='summary' then pc.n when kind='focus' and stats.n>0 then 1 else 0 end,missing,answer_missing,json_build_array(dn,ds,dq[1],dq[2],dmin,dmax,dnr,drev,dna),json_build_array(an,asum,aq[1],az,aunconfirmed,aundisclosed,aconflict,apenalty,acombined),json_build_array(rn,rs),null,null) as value,stats.ord
 from stat_values stats join place_counts pc using(side,period) join ordered o on o.ord=stats.ord
 where kind<>'summary'
 union all
 select json_build_array(side,period,kind,k,focus,stats.ord,null,stats.n,c,a,p,r,f,w,penalty,pc.n,missing,answer_missing,json_build_array(dn,ds,dq[1],dq[2],dmin,dmax,dnr,drev,dna),json_build_array(an,asum,aq[1],az,aunconfirmed,aundisclosed,aconflict,apenalty,acombined),json_build_array(rn,rs),json_build_array(h0,h1,h2,h3,h4,h5,h6,h7,h8,h9,h10,h11,h12),json_build_array(json_build_array(rall1,rall2,rall3,rall4,rall5),json_build_array(raccepted1,raccepted2,raccepted3,raccepted4,raccepted5),json_build_array(rpartial1,rpartial2,rpartial3,rpartial4,rpartial5),json_build_array(rrejected1,rrejected2,rrejected3,rrejected4,rrejected5),json_build_array(rfine1,rfine2,rfine3,rfine4,rfine5),json_build_array(runknown1,runknown2,runknown3,runknown4,runknown5))) as value,stats.ord
 from stat_values stats join place_counts pc using(side,period) join summary_details using(side,period) where kind='summary'
 union all
 select json_build_array(side,period,kind,k,focus,null,null,n,c,a,p,r,f,w,null,null,null,null,null,null,null,null,null),ord from light_stats where kind='place'
), coords as (
 select side,place,lat,lng,sum(report_member::int+done_member::int) as n,
 min(report_identity collate "C") as identity from sides where period=0 and place is not null and lat is not null and lng is not null
 group by side,place,lat,lng
) , focus_coords as (
 select side,place,lat,lng,count(*) as n,min(report_identity collate "C") as identity from sides
 where side='all' and period=0 and report_member and place in(select key from focus) and lat is not null and lng is not null
 group by side,place,lat,lng
), anchor_coords as (
 select distinct on(side,place) side,place,lat,lng,identity from (
 select * from coords union all select 'focus',place,lat,lng,n,identity from focus_coords) c
 order by side,place,n desc,identity collate "C"
), anchors as (
 select distinct on(c.side,s.place) c.side,s.place,s.lat,s.lng,s.place_address,s.region
 from sides s join anchor_coords c on (c.side=s.side or (c.side='focus' and s.side='all')) and c.place=s.place and c.lat=s.lat and c.lng=s.lng and c.identity=s.report_identity
 order by c.side,s.place,s.ord
), full_counts as (
 select case when day>=p_start then 0 else 1 end as period,g.place,count(*) as n,count(distinct contributor_id) as people,
 bool_or(contributor_id<>p_user) as shared from filtered cross join lateral (
 select ''::text as place union all select place where place in(select key from focus) or place in(select place from sides where side='mine' and period=0)) g
 group by 1,g.place
), vehicles as (
 select plate,max(plate_mask) as plate_mask,count(*) as n,count(distinct report_date) as days from sides where side='all' and period=0 and plate is not null group by plate
), vehicle_totals as (
 select count(*) filter(where plate is null) as no_plate,count(*) filter(where plate is not null and report_date is null) as no_date
 from sides where side='all' and period=0
)
select (select n from budget),json_build_object('encoding','screen-precompute-v1',
 'stats',coalesce((select json_agg(value order by ord) from stat_json),'[]'::json),
 'heat',json_build_object('row_kind',case when p_scope->>'agency_key' is null then 'agency' else 'manager' end,
 'rows',coalesce((select json_agg(json_build_object('key',k,'agency_key',agency_key,'manager_key',case when p_scope->>'agency_key' is not null then manager_key end,
 'agency_name',agency_name,'manager_name',case when p_scope->>'agency_key' is not null then manager_name end,'completed_count',n)
 order by n desc,agency_name collate "ko-x-icu",k collate "en-x-icu") from heat_top_rows),'[]'::json),
 'laws',coalesce((select json_agg(json_build_object('law_key',focus,'completed_count',n) order by n desc,focus collate "ko-x-icu") from heat_top_laws),'[]'::json),
 'cells',coalesce((select json_agg(json_build_object('row_key',s.k,'law_key',s.focus,'completed_count',s.c,
 'outcomes',json_build_object('accepted',s.a,'partial',s.p,'rejected',s.r,'result_known',s.a+s.p+s.r,'result_unknown',s.c-s.a-s.p-s.r),'fine_count',s.f)
 order by h.n desc,h.agency_name collate "ko-x-icu",h.k collate "en-x-icu",s.ord)
 from light_stats s join heat_top_rows h on h.k=s.k join heat_top_laws l on l.focus=s.focus where s.kind='heat'),'[]'::json),
 'total_rows',(select count(*) from heat_rows),'total_laws',(select count(*) from heat_laws)),
 'anchors',coalesce((select json_agg(json_build_array(side,place,lat,lng,place_address,region)) from anchors),'[]'::json),
 'full',coalesce((select json_agg(json_build_array(period,place,n,people,shared)) from full_counts),'[]'::json),
 'vehicles',json_build_object('identifiable',coalesce((select sum(n) from vehicles),0),
 'top',coalesce((select json_agg(json_build_array(plate_mask,n)) from (select * from vehicles order by n desc,plate collate "en-x-icu" limit 5) v),'[]'::json),
 'days',(select json_build_array(count(*) filter(where days=1),count(*) filter(where days=2),count(*) filter(where days between 3 and 4),count(*) filter(where days>=5)) from vehicles),
 'excluded',(select json_build_array(no_plate,no_date) from vehicle_totals)),
 'source_min',(select min(case p_date_basis when 'report_date' then report_date else completed_date end) from ordered)
) into v_budget,result;
if v_budget>100000 then raise exception 'RESULT_TOO_LARGE';end if;
return result;
end $$;



revoke all on function private.analytics_screen_precomputed(jsonb,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.analytics_screen_precomputed(jsonb,uuid,jsonb) to postgres;

CREATE FUNCTION private.screen_precomputed_state()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with bounds as (
    select (select min(report_date) from private.screen_observations) as report_min,
           (select max(report_date) from private.screen_observations) as report_max,
           (select min(completed_date) from private.screen_observations) as completed_min,
           (select max(completed_date) from private.screen_observations) as completed_max
  )
  select jsonb_build_object(
    'dataset_version', s.dataset_version, 'ready', s.ready,
    'source_updated_at', s.source_updated_at, 'generated_at', s.generated_at, 'published_at', s.published_at,
    'data_min', coalesce(s.data_min, least(b.report_min,b.completed_min)),
    'data_max', coalesce(s.data_max, greatest(b.report_max,b.completed_max)),
    'coverage_note', s.coverage_note, 'dedupe_policy_version', s.dedupe_policy_version) || jsonb_build_object(
    'cohort_policy_version', 'single-date-v1',
    -- 전체 기간 of each basis over the publicly listed history (never the other date, never a filtered range)
    'basis_bounds', jsonb_build_object(
      'report_date', jsonb_build_object('min', b.report_min, 'max', b.report_max),
      'completed_date', jsonb_build_object('min', b.completed_min, 'max', b.completed_max)))
    from bounds b cross join private.analytics_state s where s.singleton=true;
$function$
;
revoke all on function private.screen_precomputed_state() from public,anon,authenticated,service_role;
grant execute on function private.screen_precomputed_state() to postgres;

create or replace function public.internal_analytics_read_snapshot(
  p_scope jsonb, p_previous boolean default false,
  p_kind text default null, p_options jsonb default '{}'::jsonb,
  p_user uuid default null, p_session uuid default null
) returns json language plpgsql stable security definer set search_path='' as $$
declare s jsonb; v jsonb; data json; box double precision[];
begin
  if p_kind is null and p_options->>'screen_encoding'='screen-precompute-v1'
    and (select ready from private.screen_precompute_control where singleton) then
    s := private.screen_precomputed_state();
  else
    s := public.internal_analytics_cohort_state();
  end if;
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
  if p_kind is null and p_options->>'screen_encoding'='screen-precompute-v1' then
    if p_user is null or p_session is null then raise exception 'INVALID_QUERY';end if;
    if (select ready from private.screen_precompute_control where singleton)
      and not exists(select 1 from private.screen_dirty_months) then
      data:=private.analytics_screen_precomputed(p_scope,p_user,coalesce(p_options->'panels','[]'::jsonb));
    else
      data:=private.analytics_screen_aggregate_v2(p_scope,p_user,coalesce(p_options->'panels','[]'::jsonb));
    end if;
    return json_build_object('state',s,'viewer',v,'aggregate',data);
  end if;
  if p_kind is null and p_options->>'screen_encoding'='screen-aggregate-v2' then
    if p_user is null or p_session is null then raise exception 'INVALID_QUERY';end if;
    data:=private.analytics_screen_aggregate_v2(p_scope,p_user,coalesce(p_options->'panels','[]'::jsonb));
    return json_build_object('state',s,'viewer',v,'aggregate',data);
  end if;
  if p_kind is null and p_options->>'screen_encoding'='screen-aggregate-v1' then
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

create function private.screen_precompute_no_truncate() returns trigger
language plpgsql set search_path='' as $$
begin raise exception 'PRECOMPUTE_TRUNCATE_REQUIRES_REBUILD'; end $$;
revoke all on function private.screen_precompute_no_truncate() from public,anon,authenticated,service_role;
create trigger screen_precompute_no_truncate before truncate on private.community_report_facts for each statement execute function private.screen_precompute_no_truncate();
create trigger screen_precompute_no_truncate before truncate on private.community_consent_grants for each statement execute function private.screen_precompute_no_truncate();
create trigger screen_precompute_no_truncate before truncate on private.contributor_profiles for each statement execute function private.screen_precompute_no_truncate();
create trigger screen_precompute_no_truncate before truncate on private.community_policy_disclosures for each statement execute function private.screen_precompute_no_truncate();
create trigger screen_precompute_no_truncate before truncate on private.screen_observations for each statement execute function private.screen_precompute_no_truncate();
create trigger screen_precompute_no_truncate before truncate on private.screen_month_rollups for each statement execute function private.screen_precompute_no_truncate();
notify pgrst,'reload schema';
commit;
