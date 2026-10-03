-- Local measurement showed a generic parameter plan timing out on 500k global identities.
-- The grant/user join estimated one observation on the 500k fixture and chose quadratic nested loops.
-- Use hash/merge alternatives within this function only, and plan the constant SQL for the bound scope. No user SQL interpolation, cached results or larger cap/budget.
-- EXPLAIN also found per-row law normalization after the 6.7s election extending source time to28s.
-- Normalize distinct disclosed strings once per query with unchanged public values. Same election/projection; rollback restores analytics_rollup_source from 040300 in a forward migration.
begin;
create or replace function private.analytics_rollup_source(p_scope jsonb)
returns table(identity text,report_date date,completed_date date,category text,status text,disposition text,
 agency_key text,agency_name text,manager_key text,manager_name text,law text,amount_won bigint,rating integer)
language plpgsql stable security definer set search_path='' set work_mem='32MB' set enable_nestloop=off as $$
begin
 return query execute $plan$
 with grants as materialized (
   select g.grant_id,g.user_id,
     bool_or(d.amounts_public) as amounts_public,bool_or(d.violation_law_public) as law_public,bool_or(d.rating_public) as rating_public
   from private.community_consent_grants g
   join private.contributor_profiles c on c.user_id=g.user_id and c.status='active'
   join private.community_consent_grants a on a.lineage_id=g.lineage_id and a.user_id=g.user_id and a.revoked_at is null
   left join private.community_policy_disclosures d on d.version=a.policy_version
   group by g.grant_id,g.user_id
 ), candidates as (
   -- A safe candidate superset, including earlier observations. No grouping/election within the period.
   select distinct f.source_report_key from private.community_report_facts f
   join grants g on g.grant_id=f.consent_grant_id and g.user_id=f.contributor_id
   where f.public_state='completed'
     and (case $1->>'date_basis' when 'report_date' then f.report_date else f.completed_date end)
       between ($1->>'start')::date and ($1->>'end')::date
     and ($1->>'category'='all' or f.category=$1->>'category')
     and ($1->>'agency_key' is null or f.agency_key=$1->>'agency_key')
     and ($1->>'manager_key' is null or f.manager_key=$1->>'manager_key')
 ), observations as materialized (
   select f.source_report_key collate "C" as source_report_key,f.report_number collate "C" as report_number,
     f.payload_sha256 collate "C" as payload_sha256,f.contributor_id,f.answer_accepted_at,f.first_accepted_at,
     f.report_date,f.completed_date,f.category,f.status,f.disposition,f.agency_key,
     coalesce(nullif(f.agency_current_name,''),nullif(f.agency_name,''),'기관 정보 없음') as agency_name,
     f.manager_key,f.manager_name,f.region_code,f.lat,f.lng,
     case when g.law_public then f.violation_law else null end as law,
     case when g.rating_public then f.rating else null end as rating,
     case when g.amounts_public and f.amount_kind='fine' and f.disposition='fine' and f.status in ('accepted','partial')
       then f.amount_confirmed_won else null end as amount_won
   from private.community_report_facts f join grants g on g.grant_id=f.consent_grant_id and g.user_id=f.contributor_id
   where f.public_state='completed' and f.source_report_key in (select source_report_key from candidates)
 ), normalized_laws as materialized (
   -- Pure text normalization once per distinct disclosed input in this query, never a saved result.
   select k.raw,private.analytics_law(k.raw) as normalized
   from (select distinct law as raw from observations where law is not null) k
 ), key_numbers as (
   select distinct on(source_report_key) source_report_key,report_number as key_number from observations
   where report_number is not null order by source_report_key,first_accepted_at,contributor_id
 ), identified as (
   select o.*,o.source_report_key||'|'||coalesce(o.report_number,k.key_number,'legacy') as rid,
     max(o.answer_accepted_at) over(partition by (o.source_report_key||'|'||coalesce(o.report_number,k.key_number,'legacy')),o.payload_sha256) as answer_time
   from observations o left join key_numbers k using(source_report_key)
 ), elected as (
   select i.*,row_number() over(partition by rid order by answer_time desc,completed_date desc nulls last,first_accepted_at,contributor_id) as rn
   from identified i
 ) select e.rid,e.report_date,e.completed_date,e.category,e.status,e.disposition,e.agency_key,e.agency_name,e.manager_key,e.manager_name,
   l.normalized,e.amount_won,e.rating::integer
 from elected e left join normalized_laws l on l.raw=e.law where e.rn=1
   and (case $1->>'date_basis' when 'report_date' then e.report_date else e.completed_date end)
     between ($1->>'start')::date and ($1->>'end')::date
   and ($1->>'category'='all' or e.category=$1->>'category')
   and ($1->>'agency_key' is null or e.agency_key=$1->>'agency_key')
   and ($1->>'manager_key' is null or e.manager_key=$1->>'manager_key')
   and ($1->>'region_code' is null or private.analytics_region(e.region_code,e.lat,e.lng) like ($1->>'region_code')||'%')
   and ($1->>'law' is null or case when $1->>'law'='__none__' then l.normalized is null else l.normalized=private.analytics_law($1->>'law') end)
   and ($1->'bbox'='null'::jsonb or not $1?'bbox' or (e.lat is not null and e.lng between ($1->'bbox'->>0)::double precision and ($1->'bbox'->>2)::double precision
     and e.lat between ($1->'bbox'->>1)::double precision and ($1->'bbox'->>3)::double precision));
 $plan$ using p_scope;
end;
$$;

revoke all on function private.analytics_rollup_source(jsonb) from public,anon,authenticated;
commit;
