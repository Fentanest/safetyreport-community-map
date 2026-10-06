-- Exact screen sufficient statistics. No raw fact JSON or stored cache on the opt-in path.
begin;
create function private.screen_address(raw text) returns text language plpgsql immutable set search_path='' as $$
declare t text; first text; names jsonb := '{"서울": "서울특별시", "서울시": "서울특별시", "서울특별시": "서울특별시", "부산": "부산광역시", "부산시": "부산광역시", "부산광역시": "부산광역시", "대구": "대구광역시", "대구시": "대구광역시", "대구광역시": "대구광역시", "인천": "인천광역시", "인천시": "인천광역시", "인천광역시": "인천광역시", "광주": "광주광역시", "광주광역시": "광주광역시", "대전": "대전광역시", "대전시": "대전광역시", "대전광역시": "대전광역시", "울산": "울산광역시", "울산시": "울산광역시", "울산광역시": "울산광역시", "세종": "세종특별자치시", "세종시": "세종특별자치시", "세종특별자치시": "세종특별자치시", "경기": "경기도", "경기도": "경기도", "강원": "강원특별자치도", "강원도": "강원특별자치도", "강원특별자치도": "강원특별자치도", "충북": "충청북도", "충청북도": "충청북도", "충남": "충청남도", "충청남도": "충청남도", "전북": "전북특별자치도", "전라북도": "전북특별자치도", "전북특별자치도": "전북특별자치도", "전남": "전라남도", "전라남도": "전라남도", "경북": "경상북도", "경상북도": "경상북도", "경남": "경상남도", "경상남도": "경상남도", "제주": "제주특별자치도", "제주도": "제주특별자치도", "제주특별자치도": "제주특별자치도"}'::jsonb;
begin
 if raw is null then return null; end if;
 t:=regexp_replace(normalize(raw,NFC), '['||U&'\0001-\001F\007F-\009F\200B-\200D\FEFF'||']',' ','g');
 t:=btrim(regexp_replace(t,'['||U&'\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF'||']+',' ','g'));
 t:=regexp_replace(t,'([0-9]) *- *([0-9])','\1-\2','g');
 if t='' then return null;end if;
 first:=split_part(t,' ',1);
 return coalesce(names->>first,first)||substr(t,length(first)+1);
end $$;
-- Match JavaScript trim/\s, including NBSP and BOM; POSIX \s alone has different semantics.
create function private.screen_law(raw text) returns text language plpgsql immutable set search_path='' as $$
declare ws text:=U&'\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF';t text;m text[];
begin
 t:=regexp_replace(raw,'^['||ws||']+|['||ws||']+$','','g');
 if t is null or t='' then return null;end if;
 m:=regexp_match(regexp_replace(t,'['||ws||']',' ','g'),'^([가-힣·\s]{1,60}?법)\s*제\s*0*([0-9]+)\s*조(?:\s*의\s*0*([0-9]+))?(?:\s*제?\s*[0-9]{1,3}\s*항)?$');
 if m is null then return t;end if;
 return replace(m[1],' ','')||' 제'||m[2]||'조'||case when m[3] is null then '' else '의'||m[3] end;
end $$;
create function private.screen_plate(raw text) returns text language plpgsql immutable set search_path='' as $$
declare t text; prefix text; region text:=''; names jsonb := '{"서울특별시": "서울", "부산광역시": "부산", "대구광역시": "대구", "인천광역시": "인천", "광주광역시": "광주", "대전광역시": "대전", "울산광역시": "울산", "세종특별자치시": "세종", "경기도": "경기", "강원특별자치도": "강원", "강원도": "강원", "충청북도": "충북", "충청남도": "충남", "전북특별자치도": "전북", "전라북도": "전북", "전라남도": "전남", "경상북도": "경북", "경상남도": "경남", "제주특별자치도": "제주", "제주도": "제주", "서울": "서울", "부산": "부산", "대구": "대구", "인천": "인천", "광주": "광주", "대전": "대전", "울산": "울산", "세종": "세종", "경기": "경기", "강원": "강원", "충북": "충북", "충남": "충남", "전북": "전북", "전남": "전남", "경북": "경북", "경남": "경남", "제주": "제주"}'::jsonb;
begin
 if raw is null or length(raw)>64 then return null;end if;
 t:=regexp_replace(normalize(raw,NFKC),'['||U&'\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF'||'-]','','g');
 for prefix in select key from jsonb_each_text(names) order by length(key) desc loop
  if starts_with(t,prefix) then region:=names->>prefix;t:=substr(t,length(prefix)+1);exit;end if;
 end loop;
 if t !~ '^[0-9]{2,3}[가-힣][0-9]{4}$' then return null;end if;
 return region||t;
end $$;
-- Only already-parsed canonical values reach this projection. No global vehicle key leaves SQL.
create function private.screen_mask_plate(t text) returns text language plpgsql immutable strict set search_path='' as $$
declare body text:=substring(t from '[0-9]{2,3}[가-힣][0-9]{4}$');
begin
 if body is null then raise exception 'INVALID_PLATE';end if;
 return left(t,length(t)-length(body))||substr(body,1,1)||'*'||substr(body,3,1)||'*'||substr(body,5,1)||'*'||substr(body,7);
end $$;
create function private.screen_place_key(t text) returns text language plpgsql immutable strict set search_path='' as $$
declare a bigint:=2166136261; b bigint:=16777619 # 1540483477; c int; cp int; i int; units int[];
begin
 for i in 1..length(t) loop
  cp:=ascii(substr(t,i,1));
  units:=case when cp>65535 then array[55296+((cp-65536)>>10),56320+((cp-65536)&1023)] else array[cp] end;
  foreach c in array units loop
   a:=((a # c)*16777619)&4294967295;
   -- low 32 bits without overflowing signed bigint
   b:=((((b # c)&65535)*1540483477)+((((b # c)>>16)*1540483477&65535)<<16))&4294967295;
   b:=(b # (b>>15))&4294967295;
  end loop;
 end loop;
 return 'pl1:'||lpad(to_hex(a),8,'0')||lpad(to_hex(b),8,'0');
end $$;
-- Sorting per aggregate group permits a hash aggregation of the expanded dimensions instead of
-- sorting a wide copy of every fact for every dimension. Values never leave PostgreSQL.
create function private.screen_quantiles(p_values bigint[]) returns double precision[] language plpgsql immutable set search_path='' as $$
declare a bigint[]; n int:=coalesce(cardinality(p_values),0); med double precision;
begin
 if n=0 then return array[null,null]::double precision[];end if;
 select array_agg(v order by v) into a from unnest(p_values) v;
 med:=case when n%2=1 then a[(n+1)/2]::double precision else (a[n/2]+a[n/2+1])::double precision/2 end;
 return array[med,a[ceil(n*0.9::double precision)::int]::double precision];
end $$;
create function private.analytics_screen_aggregate(p_scope jsonb,p_user uuid,p_panels jsonb)
returns json language plpgsql stable security definer set search_path='' set enable_nestloop=off set enable_sort=off as $$
declare p_date_basis text:=p_scope->>'date_basis'; p_start date:=(p_scope->>'start')::date; p_end date:=(p_scope->>'end')::date;
 p_category text:=p_scope->>'category';p_agency_key text:=p_scope->>'agency_key';p_manager_key text:=p_scope->>'manager_key';
 p_bbox double precision[];v_from date;result json;v_budget bigint;
begin
 if p_date_basis is null or p_date_basis not in ('report_date','completed_date') or p_start is null or p_end is null or p_end<p_start
 or p_start-(p_end-p_start+1)<date '1900-01-01' or p_category is null or p_category not in ('all','traffic','parking','other')
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
        select f.source_report_key, f.report_number, f.payload_sha256, f.answer_accepted_at, f.contributor_id, f.first_accepted_at, f.report_date, f.completed_date, f.status, f.disposition, f.vehicle_raw, f.lat, f.lng, f.address, f.region_code, f.agency_key, f.agency_name, f.agency_current_name, f.manager_key, f.manager_name, f.amount_kind, f.amount_confirmed_won, f.violation_law, f.rating, f.category, g.amount_public, g.law_public, g.rating_public
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
         order by f.source_report_key, (f.report_number is null), f.first_accepted_at, f.contributor_id
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
                     order by i.answer_time desc, i.completed_date desc nulls last, i.first_accepted_at, i.contributor_id
                     rows between unbounded preceding and unbounded following)
    ), ordered as materialized (
 select r.report_identity,r.contributor_id,r.first_accepted_at,r.report_date,r.completed_date,r.identity_report_date,r.identity_completed_date,r.status,r.disposition,r.vehicle_raw,r.lat,r.lng,r.address,r.region_code,r.agency_key,r.agency_name,r.agency_current_name,r.manager_key,r.manager_name,r.is_representative,r.amount_kind,r.amount_confirmed_won,r.amount_public,r.law_public,r.rating_public,r.violation_law,r.rating,row_number() over () as ord from ranked r
 where (p_category='all' or category=p_category)
 and (p_agency_key is null or agency_key=p_agency_key) and (p_manager_key is null or manager_key=p_manager_key)
 and (p_bbox is null or (lat is not null and lng between p_bbox[1] and p_bbox[3] and lat between p_bbox[2] and p_bbox[4]))
 and (case p_date_basis when 'report_date' then identity_report_date else identity_completed_date end) between v_from and p_end
) , address_inputs as materialized (
 select raw,private.screen_address(raw) as address from (select distinct address as raw from ordered) a
), addresses as materialized (
 select raw,address,private.screen_place_key(address) as place from address_inputs
), plates as materialized (
 select raw,private.screen_plate(raw) as plate from (select distinct vehicle_raw as raw from ordered) a
), region_names as materialized (
 select raw,private.analytics_region(raw,null,null) as code from (select distinct region_code as raw from ordered) a
), region_points as materialized (
 select k.*,private.analytics_region(k.raw,k.lat,k.lng) as code from (
 select distinct o.region_code as raw,o.lat,o.lng from ordered o left join region_names n on n.raw=o.region_code
 where n.code is null and o.lat is not null and o.lng is not null) k
), laws as materialized (
 select raw,private.screen_law(raw) as law from (select distinct violation_law as raw from ordered where law_public) a
), normalized as materialized (
 select o.ord,o.report_identity,o.contributor_id,o.first_accepted_at,o.report_date,o.completed_date,o.status,o.disposition,o.lat,o.lng,o.agency_key,o.agency_name,o.agency_current_name,o.manager_key,o.manager_name,o.is_representative,o.amount_confirmed_won,a.address as place_address,a.place,
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
), expanded as (
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
 from expanded group by side,period,kind,k,focus
) , stat_values as materialized (
 select s.*,private.screen_quantiles(dvalues) as dq,private.screen_quantiles(avalues) as aq from stats s
), place_counts as (
 select side,period,count(distinct place collate "C") filter(where report_member) as n from sides group by side,period
), stat_json as (
 select case when kind='place' then json_build_object('side',side,'period',period,'kind',kind,'k',k,'focus',focus,
 'n',stats.n,'c',c,'a',a,'p',p,'r',r,'f',f,'w',w) else json_build_object(
 'side',side,
 'period',period,
 'kind',kind,
 'k',k,
 'focus',focus,
 'ord',stats.ord,
 'label',json_build_array(o.agency_key,coalesce(nullif(o.agency_current_name,''),nullif(o.agency_name,''),'기관 정보 없음'),o.manager_key,o.manager_name),
 'n',stats.n,
 'c',c,
 'a',a,
 'p',p,
 'r',r,
 'f',f,
 'w',w,
 'penalty',penalty,
 'places',case when kind='summary' then pc.n when kind='focus' and stats.n>0 then 1 else 0 end,
 'missing',missing,
 'answer_missing',answer_missing,
 'duration',json_build_array(dn,ds,dq[1],dq[2],dmin,dmax,dnr,drev,dna),
 'amount',json_build_array(an,asum,aq[1],az,aunconfirmed,aundisclosed,aconflict,apenalty,acombined),
 'rating',json_build_array(rn,rs),
 'histogram',json_build_array(h0,h1,h2,h3,h4,h5,h6,h7,h8,h9,h10,h11,h12),
 'ratings',json_build_array(json_build_array(rall1,rall2,rall3,rall4,rall5),json_build_array(raccepted1,raccepted2,raccepted3,raccepted4,raccepted5),json_build_array(rpartial1,rpartial2,rpartial3,rpartial4,rpartial5),json_build_array(rrejected1,rrejected2,rrejected3,rrejected4,rrejected5),json_build_array(rfine1,rfine2,rfine3,rfine4,rfine5),json_build_array(runknown1,runknown2,runknown3,runknown4,runknown5))
 ) end as value from stat_values stats join place_counts pc using(side,period) join ordered o on o.ord=stats.ord order by stats.ord
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
 select ''::text as place union all select place where place is not null) g
 group by 1,g.place
), vehicles as (
 select plate,count(*) as n,count(distinct report_date) as days from sides where side='all' and period=0 and plate is not null group by plate
), vehicle_totals as (
 select count(*) filter(where plate is null) as no_plate,count(*) filter(where plate is not null and report_date is null) as no_date
 from sides where side='all' and period=0
)
select (select n from budget),json_build_object('encoding','screen-aggregate-v1',
 'stats',coalesce((select json_agg(value) from stat_json),'[]'::json),
 'anchors',coalesce((select json_agg(json_build_array(side,place,lat,lng,place_address,region)) from anchors),'[]'::json),
 'full',coalesce((select json_agg(json_build_array(period,place,n,people,shared)) from full_counts),'[]'::json),
 'vehicles',json_build_object('identifiable',coalesce((select sum(n) from vehicles),0),
 'top',coalesce((select json_agg(json_build_array(private.screen_mask_plate(plate),n)) from (select * from vehicles order by n desc,plate collate "en-x-icu" limit 5) v),'[]'::json),
 'days',(select json_build_array(count(*) filter(where days=1),count(*) filter(where days=2),count(*) filter(where days between 3 and 4),count(*) filter(where days>=5)) from vehicles),
 'excluded',(select json_build_array(no_plate,no_date) from vehicle_totals)),
 'source_min',(select min(case p_date_basis when 'report_date' then report_date else completed_date end) from ordered)
) into v_budget,result;
if v_budget>100000 then raise exception 'RESULT_TOO_LARGE';end if;
return result;
end $$;
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
revoke all on function public.internal_analytics_read_snapshot(jsonb,boolean,text,jsonb,uuid,uuid) from public,anon,authenticated;
grant execute on function public.internal_analytics_read_snapshot(jsonb,boolean,text,jsonb,uuid,uuid) to service_role;
comment on function public.internal_analytics_read_snapshot(jsonb,boolean,text,jsonb,uuid,uuid)
  is 'Service-only single-statement snapshot for version, eligible facts/rollup and optional screen viewer.';

revoke all on function private.screen_address(text),private.screen_law(text),private.screen_plate(text),private.screen_mask_plate(text),private.screen_place_key(text),
 private.screen_quantiles(bigint[]),private.analytics_screen_aggregate(jsonb,uuid,jsonb) from public,anon,authenticated;
grant execute on function private.screen_address(text),private.screen_law(text),private.screen_plate(text),private.screen_mask_plate(text),private.screen_place_key(text),
 private.screen_quantiles(bigint[]),private.analytics_screen_aggregate(jsonb,uuid,jsonb) to postgres;
notify pgrst,'reload schema';
commit;
