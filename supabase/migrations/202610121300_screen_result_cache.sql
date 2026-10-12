-- Exact-version screen result cache. Derived from 202610121201 (five categories + fine estimates).
-- No ingest-time aggregation. No stale-version serving. Existing functions remain as rollback/baseline.
begin;
set local lock_timeout='3s';

create or replace function private.analytics_screen_parts(p_scope jsonb,p_user uuid,p_panels jsonb,p_part text)
returns json language plpgsql stable security definer set search_path='' set enable_nestloop=off set enable_sort=off set work_mem='16MB' as $$
declare p_date_basis text:=p_scope->>'date_basis'; p_start date:=(p_scope->>'start')::date; p_end date:=(p_scope->>'end')::date;
 p_category text:=p_scope->>'category';p_agency_key text:=p_scope->>'agency_key';p_manager_key text:=p_scope->>'manager_key';
 p_bbox double precision[];v_from date;result json;v_budget bigint;
begin
 if p_part not in ('both','public','personal') then raise exception 'INVALID_QUERY';end if;
 if p_date_basis is null or p_date_basis not in ('report_date','completed_date') or p_start is null or p_end is null or p_end<p_start
 or p_start-(p_end-p_start+1)<date '1900-01-01' or p_category is null or p_category not in ('all','traffic','parking','safety','living','other')
 or jsonb_typeof(p_panels)<>'array' or jsonb_array_length(p_panels)>8 then raise exception 'INVALID_QUERY';end if;
 if jsonb_typeof(p_scope->'bbox')='array' then select array_agg(x::double precision order by n) into p_bbox
 from jsonb_array_elements_text(p_scope->'bbox') with ordinality a(x,n);end if;
 v_from:=p_start-(p_end-p_start+1);
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
    ), candidates as materialized (
        -- Keep date indexes available for narrow or empty windows; no national wide-row spool.
        select distinct f.source_report_key
          from private.community_report_facts f
          join private.contributor_profiles c on c.user_id = f.contributor_id and c.status = 'active'
          join active_grants g on g.grant_id = f.consent_grant_id
         where f.public_state = 'completed'
           and (case when p_date_basis = 'report_date' then f.report_date else f.completed_date end) between v_from and p_end
           and (p_category = 'all' or f.category = p_category)
           and (p_agency_key is null or f.agency_key = p_agency_key)
           and (p_manager_key is null or f.manager_key = p_manager_key)
           and (p_bbox is null or (f.lat is not null and f.lng between p_bbox[1] and p_bbox[3] and f.lat between p_bbox[2] and p_bbox[4]))
    ), scoped as materialized (
        -- D13: keep the whole eligible history of each candidate key for election.
        select f.dataset_key, f.source_report_key, f.report_number, f.payload_sha256, f.answer_accepted_at, f.contributor_id, f.first_accepted_at, f.report_date, f.completed_date, f.status, f.disposition, f.vehicle_raw, f.lat, f.lng, f.address, f.region_code, f.agency_key, f.agency_name, f.agency_current_name, f.manager_key, f.manager_name, f.amount_kind, f.amount_confirmed_won, f.fine_estimate_won, f.violation_law, f.rating, f.category, g.amount_public, g.law_public, g.rating_public
          from private.community_report_facts f
          join private.contributor_profiles c on c.user_id = f.contributor_id and c.status = 'active'
          join active_grants g on g.grant_id = f.consent_grant_id
          join candidates k using (source_report_key)
         where f.public_state = 'completed'
    ), budget as materialized (
        select count(*) as n from scoped
    ), admitted as materialized (
        -- Do not rank or build any JSON if the whole-history row budget is exceeded.
        select s.* from scoped s where (select n <= 100000 from budget)
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
    ), ordered as materialized (
 select r.report_identity,r.contributor_id,r.first_accepted_at,r.report_date,r.completed_date,r.identity_report_date,r.identity_completed_date,r.status,r.disposition,r.vehicle_raw,r.lat,r.lng,r.address,r.region_code,r.agency_key,r.agency_name,r.agency_current_name,r.manager_key,r.manager_name,r.is_representative,r.amount_kind,r.amount_confirmed_won,r.fine_estimate_won,r.amount_public,r.law_public,r.rating_public,r.violation_law,r.rating,row_number() over () as ord from ranked r
 where (p_category='all' or category=p_category)
 and (p_agency_key is null or agency_key=p_agency_key) and (p_manager_key is null or manager_key=p_manager_key)
 and (p_bbox is null or (lat is not null and lng between p_bbox[1] and p_bbox[3] and lat between p_bbox[2] and p_bbox[4]))
 and (case p_date_basis when 'report_date' then identity_report_date else identity_completed_date end) between v_from and p_end
) , address_inputs as materialized (
 select raw,private.screen_address(raw) as address from (select distinct address as raw from ordered) a
), addresses as materialized (
 select raw,address,private.screen_place_key(address) as place from address_inputs
), plates as materialized (
 select raw,private.screen_plate(raw) as plate from (select distinct vehicle_raw as raw from ordered where p_part<>'personal') a
), region_names as materialized (
 select raw,private.analytics_region(raw,null,null) as code from (select distinct region_code as raw from ordered) a
), region_points as materialized (
 select k.*,private.analytics_region(k.raw,k.lat,k.lng) as code from (
 select distinct o.region_code as raw,o.lat,o.lng from ordered o left join region_names n on n.raw=o.region_code
 where n.code is null and o.lat is not null and o.lng is not null) k
), laws as materialized (
 select raw,private.screen_law(raw) as law from (select distinct violation_law as raw from ordered where law_public) a
), normalized as materialized (
 select o.ord,o.report_identity,o.contributor_id,o.first_accepted_at,o.report_date,o.completed_date,o.status,o.disposition,o.lat,o.lng,o.agency_key,o.agency_name,o.agency_current_name,o.manager_key,o.manager_name,o.is_representative,o.amount_confirmed_won,
 case when o.amount_public and o.disposition='fine' and o.amount_confirmed_won is null then o.fine_estimate_won end as estimate_won,a.address as place_address,a.place,
 coalesce(rn.code,rp.code) as region,l.law,p.plate,
 case p_date_basis when 'report_date' then identity_report_date else identity_completed_date end as day,
 case p_date_basis when 'report_date' then completed_date else report_date end as other_day,
 status in ('accepted','partial','rejected','withdrawn','transferred','completed_unknown') as done,
 case when status in ('accepted','partial','rejected','completed_unknown') and completed_date>=report_date then completed_date-report_date end as days,
 case when amount_kind='combined' then 'combined' when amount_kind='penalty' then case when disposition='fine' then 'conflict' else 'penalty' end
 when amount_kind='fine' and disposition<>'fine' then 'conflict' when disposition<>'fine' then 'none'
 when amount_kind is distinct from 'fine' or status not in ('accepted','partial') then 'conflict'
 when not amount_public then case when amount_confirmed_won is null then 'unconfirmed' else 'undisclosed' end
 when amount_confirmed_won is null then 'unconfirmed' else 'confirmed' end as amount_class,
 case when rating_public then rating end as stars
 from ordered o left join addresses a on a.raw=o.address left join plates p on p.raw=o.vehicle_raw
 left join region_names rn on rn.raw=o.region_code
 left join region_points rp on rn.code is null and rp.raw is not distinct from o.region_code and rp.lat=o.lat and rp.lng=o.lng
 left join laws l on law_public and l.raw=o.violation_law
), filtered as materialized (
 select * from normalized where (p_scope->>'region_code' is null or region like (p_scope->>'region_code')||'%')
 and (p_scope->>'law' is null or case when p_scope->>'law'='__none__' then law is null else law=private.screen_law(p_scope->>'law') end)
) , own_done as materialized (
 select distinct on(report_identity) ord from filtered where p_part<>'public' and contributor_id=p_user and done
 order by report_identity,first_accepted_at,ord
), own as materialized (
 select distinct on(report_identity) ord from filtered where p_part<>'public' and contributor_id=p_user
 order by report_identity,first_accepted_at,ord
), sides as materialized (
 select f.*,s.side collate "C" as side,s.report_member,s.done_member,case when day>=p_start then 0 else 1 end as period
 from filtered f left join own m on m.ord=f.ord left join own_done md on md.ord=f.ord
 cross join lateral (select 'all' as side,true as report_member,f.done as done_member where f.is_representative and p_part<>'personal'
 union all select 'mine',m.ord is not null,md.ord is not null where (m.ord is not null or md.ord is not null)
 and exists(select 1 from jsonb_array_elements(p_panels) p where p->>'path'='compare')) s
), focus as materialized (
 select distinct substr(p->>'path',8) as key from jsonb_array_elements(p_panels) p where p->>'path' like 'places/pl1:%'
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
), stats as (
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
 count(estimate_won) filter(where done_member and kind in ('summary','focus')) as en,
 sum(estimate_won) filter(where done_member and kind in ('summary','focus')) as esum,
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
), light_stats as materialized (
 select side,period,kind,k,focus,min(ord) as ord,
 count(*) filter(where report_member) as n,count(*) filter(where done_member) as c,
 count(*) filter(where done_member and status='accepted') as a,
 count(*) filter(where done_member and status='partial') as p,
 count(*) filter(where done_member and status='rejected') as r,
 count(*) filter(where done_member and disposition='fine') as f,
 count(*) filter(where done_member and disposition='warning') as w
 from expanded where kind in ('place','heat') group by side,period,kind,k,focus
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
 select json_build_object(
 'side',side,'period',period,'kind',kind,'k',k,'focus',focus,'ord',stats.ord,
 'label',json_build_array(o.agency_key,coalesce(nullif(o.agency_current_name,''),nullif(o.agency_name,''),'기관 정보 없음'),o.manager_key,o.manager_name),
 'n',stats.n,'c',c,'a',a,'p',p,'r',r,'f',f,'w',w,'penalty',penalty,
 'places',case when kind='summary' then pc.n when kind='focus' and stats.n>0 then 1 else 0 end,
 'missing',missing,'answer_missing',answer_missing,
 'duration',json_build_array(dn,ds,dq[1],dq[2],dmin,dmax,dnr,drev,dna),
 'amount',json_build_array(an,asum,aq[1],az,aunconfirmed,aundisclosed,aconflict,apenalty,acombined),
 'estimate',json_build_array(en,esum),
 'rating',json_build_array(rn,rs)) as value,stats.ord,stats.side
 from stat_values stats join place_counts pc using(side,period) join ordered o on o.ord=stats.ord
 where kind<>'summary'
 union all
 select json_build_object(
 'side',side,'period',period,'kind',kind,'k',k,'focus',focus,'ord',stats.ord,
 'n',stats.n,'c',c,'a',a,'p',p,'r',r,'f',f,'w',w,'penalty',penalty,'places',pc.n,
 'missing',missing,'answer_missing',answer_missing,
 'duration',json_build_array(dn,ds,dq[1],dq[2],dmin,dmax,dnr,drev,dna),
 'amount',json_build_array(an,asum,aq[1],az,aunconfirmed,aundisclosed,aconflict,apenalty,acombined),
 'estimate',json_build_array(en,esum),
 'rating',json_build_array(rn,rs),
 'histogram',json_build_array(h0,h1,h2,h3,h4,h5,h6,h7,h8,h9,h10,h11,h12),
 'ratings',json_build_array(json_build_array(rall1,rall2,rall3,rall4,rall5),json_build_array(raccepted1,raccepted2,raccepted3,raccepted4,raccepted5),json_build_array(rpartial1,rpartial2,rpartial3,rpartial4,rpartial5),json_build_array(rrejected1,rrejected2,rrejected3,rrejected4,rrejected5),json_build_array(rfine1,rfine2,rfine3,rfine4,rfine5),json_build_array(runknown1,runknown2,runknown3,runknown4,runknown5))) as value,stats.ord,stats.side
 from stat_values stats join place_counts pc using(side,period) join summary_details using(side,period) where kind='summary'
 union all
 select json_build_object('side',side,'period',period,'kind',kind,'k',k,'focus',focus,
 'n',n,'c',c,'a',a,'p',p,'r',r,'f',f,'w',w),ord,side from light_stats where kind='place'
), packed_stats as (
 select side,json_agg(value order by ord) as value from stat_json group by side
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
 select plate,count(*) as n,count(distinct report_date) as days from sides where side='all' and period=0 and plate is not null group by plate
), vehicle_totals as (
 select count(*) filter(where plate is null) as no_plate,count(*) filter(where plate is not null and report_date is null) as no_date
 from sides where side='all' and period=0
)
select (select n from budget),json_build_object('public',case when p_part<>'personal' then json_build_object('encoding','screen-aggregate-v2','estimate_version',1,
 'stats',coalesce((select value from packed_stats where side='all'),'[]'::json),
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
 'anchors',coalesce((select json_agg(json_build_array(side,place,lat,lng,place_address,region)) from anchors where side<>'mine'),'[]'::json),
 'full',coalesce((select json_agg(json_build_array(period,place,n,people,false)) from full_counts where place='' or place in(select key from focus)),'[]'::json),
 'vehicles',json_build_object('identifiable',coalesce((select sum(n) from vehicles),0),
 'top',coalesce((select json_agg(json_build_array(private.screen_mask_plate(plate),n)) from (select * from vehicles order by n desc,plate collate "en-x-icu" limit 5) v),'[]'::json),
 'days',(select json_build_array(count(*) filter(where days=1),count(*) filter(where days=2),count(*) filter(where days between 3 and 4),count(*) filter(where days>=5)) from vehicles),
 'excluded',(select json_build_array(no_plate,no_date) from vehicle_totals)),
 'source_min',(select min(case p_date_basis when 'report_date' then report_date else completed_date end) from ordered)
 ) end,
 'personal',case when p_part<>'public' then json_build_object(
 'stats',coalesce((select value from packed_stats where side='mine'),'[]'::json),
 'anchors',coalesce((select json_agg(json_build_array(side,place,lat,lng,place_address,region)) from anchors where side='mine'),'[]'::json),
 'full',coalesce((select json_agg(json_build_array(period,place,n,people,shared)) from full_counts),'[]'::json)) end
) into v_budget,result;
if v_budget>100000 then raise exception 'RESULT_TOO_LARGE';end if;
return result;
end $$;

-- Direct-mapped, bounded live payload: 32 public slots x 16 MiB + 128 personal x 4 MiB + state 64 KiB.
-- Keys are checked in full after slot lookup; a collision is ONLY a miss. No unbounded key/cardinality table.
create table private.screen_result_cache (
 slot smallint primary key check(slot between 0 and 160),
 cache_key text not null check(length(cache_key)=64),
 payload json not null,
 created_at timestamptz not null,
 expires_at timestamptz not null,
 check(octet_length(payload::text)<=case when slot<32 then 16777216 when slot<160 then 4194304 else 65536 end)
) with (autovacuum_vacuum_scale_factor=0,autovacuum_vacuum_threshold=32,
 toast.autovacuum_vacuum_scale_factor=0,toast.autovacuum_vacuum_threshold=32);
alter table private.screen_result_cache enable row level security;
revoke all on private.screen_result_cache from public,anon,authenticated,service_role;

-- Eligibility / disclosure DML must invalidate even when it does not touch facts.
-- Constant-time version update only; never recompute an aggregate in the write transaction.
create function private.screen_cache_invalidate() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform private.community_bump_projection();
 return null;
end $$;
create trigger screen_cache_invalidate after insert or update or delete or truncate on private.community_consent_grants
 for each statement execute function private.screen_cache_invalidate();
create trigger screen_cache_invalidate after insert or update or delete or truncate on private.contributor_profiles
 for each statement execute function private.screen_cache_invalidate();
create trigger screen_cache_invalidate after insert or update or delete or truncate on private.community_policy_disclosures
 for each statement execute function private.screen_cache_invalidate();
create trigger screen_cache_truncate after truncate on private.community_report_facts
 for each statement execute function private.screen_cache_invalidate();

create function private.screen_cache_digest(p_text text) returns text language sql immutable set search_path='' as $$
 select encode(sha256(convert_to(p_text,'UTF8')),'hex');
$$;
-- Include readiness/bounds/timestamps as well as dataset_version (operator metadata updates invalidate too).
create function private.screen_cache_revision() returns text language sql stable security definer set search_path='' as $$
 select private.screen_cache_digest(to_jsonb(s)::text) from private.analytics_state s where singleton;
$$;
create function private.screen_cache_get(p_slot integer,p_key text) returns json
 language sql stable security definer set search_path='' as $$
 select payload from private.screen_result_cache where slot=p_slot and cache_key=p_key and expires_at>statement_timestamp();
$$;
create function private.screen_cache_put(p_slot integer,p_key text,p_payload json,p_at timestamptz) returns boolean
 language plpgsql volatile security definer set search_path='' as $$
begin
 if p_payload is null or octet_length(p_payload::text)>(case when p_slot<32 then 16777216 when p_slot<160 then 4194304 else 65536 end)
   or not pg_try_advisory_xact_lock(121300,p_slot) then return false;end if;
 insert into private.screen_result_cache values(p_slot,p_key,p_payload,p_at,p_at+interval '15 minutes')
 on conflict(slot) do update set cache_key=excluded.cache_key,payload=excluded.payload,created_at=excluded.created_at,expires_at=excluded.expires_at
 where private.screen_result_cache.created_at<=excluded.created_at;
 return true;
 -- An optional cache write must not turn a successfully computed screen into a failure.
 exception when others then return false;
end $$;

create type private.screen_cache_read as (
 revision text, state_key text, state jsonb, viewer jsonb,
 public_slot integer, public_key text, public_data json,
 personal_slot integer, personal_key text, personal_data json,
 state_hit boolean, public_hit boolean, personal_hit boolean
);
create function private.screen_cache_resolve(p_scope jsonb,p_panels jsonb,p_user uuid,p_session uuid,p_warm boolean default false)
 returns private.screen_cache_read language plpgsql stable security definer set search_path='' as $$
declare r private.screen_cache_read; s jsonb; panels jsonb; personal boolean; data json;
 key_base text; user_version text; today date:=(statement_timestamp() at time zone 'Asia/Seoul')::date;
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
 r.revision:=private.screen_cache_revision();
 r.state_key:=private.screen_cache_digest('screen-state-v1|'||r.revision);
 r.state:=private.screen_cache_get(160,r.state_key)::jsonb;r.state_hit:=r.state is not null;
 if r.state is null then r.state:=public.internal_analytics_cohort_state();end if;
 -- A metadata-only call also gets its state from the same stable snapshot.
 if p_scope is null then return r;end if;
 s:=jsonb_strip_nulls(p_scope);
 -- The SQL result only depends on focused places and whether comparison was requested.
 -- IDs, sorting, paging/search and panel order are Edge projection, not additional SQL variants.
 select coalesce(jsonb_agg(jsonb_build_object('path',path) order by path),'[]') into panels
 from (select distinct p->>'path' as path from jsonb_array_elements(p_panels) p where p->>'path' like 'places/pl1:%') t;
 personal:=not p_warm and exists(select 1 from jsonb_array_elements(p_panels) p where p->>'path'='compare');
 key_base:='screen-v1|screen-aggregate-v2|fine-estimate-v1|split-v1|single-date-v1|'||r.revision||'|'||s::text||'|'||panels::text;
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
 r.public_data:=private.screen_cache_get(r.public_slot,r.public_key);r.public_hit:=r.public_data is not null;
 if personal then
  -- Conservative user-data version: the global revision covers EVERY own payload change, deletion,
  -- election/consent change; manifest generations additionally bind all of this user’s datasets.
  select private.screen_cache_digest(r.revision||'|'||coalesce(string_agg(dataset_key||':'||generation,',' order by dataset_key),''))
   into user_version from private.community_manifest_generations where contributor_id=p_user;
  r.personal_key:=private.screen_cache_digest(key_base||'|compare|'||p_user::text||'|'||user_version);
  r.personal_slot:=32+(('x'||substr(private.screen_cache_digest(s::text||panels::text||p_user::text),1,7))::bit(28)::integer%128);
  r.personal_data:=private.screen_cache_get(r.personal_slot,r.personal_key);r.personal_hit:=r.personal_data is not null;
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

create function private.screen_cache_save(r private.screen_cache_read) returns void
 language plpgsql volatile security definer set search_path='' as $$
begin
 -- A changing dataset never acquires an ingest lock and never publishes obsolete work over a fresh slot.
 if r.revision is distinct from private.screen_cache_revision() then return;end if;
 if not r.state_hit then perform private.screen_cache_put(160,r.state_key,r.state::json,statement_timestamp());end if;
 if r.public_key is not null and not r.public_hit then
  perform private.screen_cache_put(r.public_slot,r.public_key,r.public_data,statement_timestamp());end if;
 if r.personal_key is not null and not r.personal_hit then
  perform private.screen_cache_put(r.personal_slot,r.personal_key,r.personal_data,statement_timestamp());end if;
end $$;

create function public.internal_analytics_screen_cached(p_scope jsonb,p_panels jsonb,p_user uuid,p_session uuid)
 returns json language plpgsql volatile security definer set search_path='' as $$
declare r private.screen_cache_read;
begin
 r:=private.screen_cache_resolve(p_scope,p_panels,p_user,p_session);
 perform private.screen_cache_save(r);
 return json_build_object('state',r.state,'viewer',r.viewer,'facts','[]'::json,
  'cache_encoding','screen-cache-v1','public_aggregate',r.public_data,'personal_aggregate',r.personal_data,
  'cache',json_build_object('public_hit',r.public_hit,'personal_hit',r.personal_hit,'state_hit',r.state_hit));
end $$;

-- State is a shared result, never an authorization result. Public Edge keeps its existing live viewer gate.
create function public.internal_analytics_cached_state() returns jsonb
 language plpgsql volatile security definer set search_path='' as $$
declare r private.screen_cache_read;
begin
 r:=private.screen_cache_resolve(null,'[]',null,null,true);
 perform private.screen_cache_save(r);return r.state;
end $$;

create function private.screen_cache_maintain() returns integer
 language plpgsql volatile security definer set search_path='' set statement_timeout='55s' as $$
declare r private.screen_cache_read; s jsonb; scope jsonb; period text; today date; n integer:=0; row_slot integer;
begin
 -- Skip overlapping jobs. No waits, no row/fact locks, no user enumeration.
 if not pg_try_advisory_xact_lock(121300,1000) then return 0;end if;
 for row_slot in select slot from private.screen_result_cache where expires_at<=statement_timestamp() loop
  if pg_try_advisory_xact_lock(121300,row_slot) then delete from private.screen_result_cache where slot=row_slot and expires_at<=statement_timestamp();end if;
 end loop;
 -- Churn admission: do not start speculative full aggregates in the middle of a burst.
 -- Exact misses still work; this intentionally does NOT serve an old version during continuous ingest.
 if exists(select 1 from private.analytics_state where source_updated_at>statement_timestamp()-interval '5 seconds') then return 0;end if;
 s:=public.internal_analytics_cached_state();
 if not coalesce((s->>'ready')::boolean,false) then return 0;end if;
 today:=(statement_timestamp() at time zone 'Asia/Seoul')::date;
 foreach period in array array['year','all'] loop
  scope:=jsonb_build_object('date_basis','completed_date','category','all',
   'start',case when period='year' then ((today-interval '1 year')::date+1)::text else s->'basis_bounds'->'completed_date'->>'min' end,
   'end',case when period='year' then today::text else s->'basis_bounds'->'completed_date'->>'max' end);
  if scope->>'start' is null or scope->>'end' is null then continue;end if;
  r:=private.screen_cache_resolve(scope,'[]',null,null,true);
  perform private.screen_cache_save(r);
  if not r.public_hit then n:=n+1;end if;
 end loop;
 return n;
end $$;

revoke all on function private.analytics_screen_parts(jsonb,uuid,jsonb,text),private.screen_cache_invalidate(),
 private.screen_cache_digest(text),private.screen_cache_revision(),private.screen_cache_get(integer,text),
 private.screen_cache_put(integer,text,json,timestamptz),private.screen_cache_resolve(jsonb,jsonb,uuid,uuid,boolean),
 private.screen_cache_save(private.screen_cache_read),private.screen_cache_maintain() from public,anon,authenticated,service_role;
revoke all on function public.internal_analytics_screen_cached(jsonb,jsonb,uuid,uuid),public.internal_analytics_cached_state() from public,anon,authenticated;
grant execute on function public.internal_analytics_screen_cached(jsonb,jsonb,uuid,uuid),public.internal_analytics_cached_state() to service_role;
notify pgrst,'reload schema';
commit;
