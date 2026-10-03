-- LOCAL refactor; same live election and ranking DTO/version. No cache or work_mem increase.
-- NULL-only keys need no numbered-key sort; answer grouping shares the election identity sort prefix.
-- Hex lower-case keys are constrained to 64 characters; byte order preserves C-collation election order.
-- Return the unchanged text identity/version. Payload hash stays text (no hex constraint).
-- Rollback: restore private.ranking_representatives from 202610040100 in a forward migration.
begin;
create or replace function private.ranking_representatives()
returns table(contributor_id uuid, identity text, report_date date, completed_date date, category text, status text, disposition text)
language sql stable security definer set search_path='' set work_mem='32MB' as $$
 with grants as materialized (
   select g.grant_id, g.user_id
   from private.community_consent_grants g
   join private.contributor_profiles p on p.user_id=g.user_id and p.status='active'
   join auth.users u on u.id=g.user_id and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now()) and not coalesce(u.is_anonymous,false)
   where private.community_lineage_active(g.grant_id)
     and exists(select 1 from auth.identities i where i.user_id=g.user_id and i.provider='kakao')
 ), own as materialized (
   select f.contributor_id, decode(f.source_report_key,'hex') as source_report_key, decode(f.dataset_key,'hex') as dataset_key,
     f.report_number collate "C" as report_number, f.report_date, f.completed_date, f.category, f.status, f.disposition,
     f.payload_sha256 collate "C" as payload_sha256, f.answer_accepted_at, f.first_accepted_at
   from private.community_report_facts f join grants g on g.grant_id=f.consent_grant_id and g.user_id=f.contributor_id
   where f.public_state='completed' and f.status in ('accepted','partial','rejected','completed_unknown')
 ), key_numbers as (
   select distinct on (o.contributor_id,o.source_report_key) o.contributor_id,o.source_report_key,o.report_number as key_number
   from own o where o.report_number is not null order by o.contributor_id,o.source_report_key,o.first_accepted_at,o.dataset_key
 ), identified as (
   select o.*,o.source_report_key||convert_to('|'||coalesce(o.report_number,k.key_number,'legacy'),'UTF8') as rid,
     max(o.answer_accepted_at) over(partition by o.contributor_id,(o.source_report_key||convert_to('|'||coalesce(o.report_number,k.key_number,'legacy'),'UTF8')),o.payload_sha256) as answer_time
   from own o left join key_numbers k using(contributor_id,source_report_key)
 ), elected as (
   select i.*,row_number() over(partition by i.contributor_id,i.rid order by i.answer_time desc,i.completed_date desc nulls last,i.first_accepted_at,i.dataset_key) as rn
   from identified i
 ) select e.contributor_id,encode(substring(e.rid from 1 for 32),'hex')||convert_from(substring(e.rid from 33),'UTF8'),e.report_date,e.completed_date,e.category,e.status,e.disposition from elected e where e.rn=1;
$$;

revoke all on function private.ranking_representatives() from public,anon,authenticated;
commit;
