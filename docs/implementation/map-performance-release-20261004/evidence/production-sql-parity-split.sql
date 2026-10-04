begin isolation level repeatable read;set local statement_timeout='25s';set local lock_timeout='3s';create temporary table cm_release_comparisons(label text,passed boolean,comparisons integer) on commit drop;
CREATE OR REPLACE FUNCTION pg_temp.before_ranking_representatives()
 RETURNS TABLE(contributor_id uuid, identity text, report_date date, completed_date date, category text, status text, disposition text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET work_mem TO '32MB'
AS $function$
 with grants as materialized (
   select g.grant_id, g.user_id
   from private.community_consent_grants g
   join private.contributor_profiles p on p.user_id=g.user_id and p.status='active'
   join auth.users u on u.id=g.user_id and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now()) and not coalesce(u.is_anonymous,false)
   where private.community_lineage_active(g.grant_id)
     and exists(select 1 from auth.identities i where i.user_id=g.user_id and i.provider='kakao')
 ), own as materialized (
   select f.contributor_id, f.source_report_key collate "C" as source_report_key, f.dataset_key collate "C" as dataset_key,
     f.report_number collate "C" as report_number, f.report_date, f.completed_date, f.category, f.status, f.disposition,
     f.payload_sha256 collate "C" as payload_sha256, f.answer_accepted_at, f.first_accepted_at
   from private.community_report_facts f join grants g on g.grant_id=f.consent_grant_id and g.user_id=f.contributor_id
   where f.public_state='completed' and f.status in ('accepted','partial','rejected','completed_unknown')
 ), key_numbers as (
   select distinct on (o.contributor_id,o.source_report_key) o.contributor_id,o.source_report_key,o.report_number as key_number
   from own o order by o.contributor_id,o.source_report_key,(o.report_number is null),o.first_accepted_at,o.dataset_key
 ), identified as (
   select o.*,o.source_report_key||'|'||coalesce(o.report_number,k.key_number,'legacy') as rid,
     max(o.answer_accepted_at) over(partition by o.contributor_id,o.source_report_key,coalesce(o.report_number,k.key_number,'legacy'),o.payload_sha256) as answer_time
   from own o join key_numbers k using(contributor_id,source_report_key)
 ), elected as (
   select i.*,row_number() over(partition by i.contributor_id,i.rid order by i.answer_time desc,i.completed_date desc nulls last,i.first_accepted_at,i.dataset_key) as rn
   from identified i
 ) select e.contributor_id,e.rid,e.report_date,e.completed_date,e.category,e.status,e.disposition from elected e where e.rn=1;
$function$
;
CREATE OR REPLACE FUNCTION pg_temp.before_internal_analytics_viewer(p_user uuid, p_session uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
    v_id jsonb;
    v_profile private.contributor_profiles%rowtype;
    v_contributor text;
    v_has boolean := false;
    v_count integer := 0;
begin
    if p_user is null or p_session is null then raise exception 'INVALID_QUERY'; end if;
    v_id := private.community_identity_state(p_user, p_session);
    select * into v_profile from private.contributor_profiles where user_id = p_user;
    -- same states as internal_my_analytics_source: 'active' = active profile with an unrevoked share consent
    v_contributor := case
        when v_profile.user_id is null then 'none'
        when v_profile.status <> 'active' then 'suspended'
        when exists (select 1 from private.community_consent_grants g where g.user_id = p_user and g.revoked_at is null) then 'active'
        when exists (select 1 from private.community_consent_grants g where g.user_id = p_user) then 'revoked'
        else 'none' end;
    -- "shared at least one report": a fact of this user that the public map actually lists (completed, active
    -- contributor, active consent lineage) — the same rule as internal_my_analytics_source.has_public_facts.
    -- Kept verbatim (exists check) so the key's meaning cannot drift from the personal-comparison source.
    if v_contributor = 'active' then
        select exists (select 1 from private.community_report_facts f
                        where f.contributor_id = p_user and private.community_fact_publicly_listed(f)) into v_has;
        -- Viewer threshold count (2026-09-28): distinct report_identity over the same publicly-listed rows.
        -- Same identity expression as 202609281500 H1; the key's first number follows 202609281600 R2
        -- (consent-active full history, no date window) restricted to this viewer's keys, so identities
        -- join exactly as the public projection elects them. Rows of other accounts never count
        -- (per-account contribution rule, 2026-09-28); two datasets of this viewer collapse to one.
        with mine as (
            select f.source_report_key, f.report_number
              from private.community_report_facts f
             where f.contributor_id = p_user
               and private.community_fact_publicly_listed(f)
        ),
        key_numbers as (
            select distinct on (f.source_report_key) f.source_report_key,
                   f.report_number as key_number
              from private.community_report_facts f
              join private.contributor_profiles c on c.user_id = f.contributor_id and c.status = 'active'
             where f.public_state = 'completed'
               and private.community_lineage_active(f.consent_grant_id)
               and f.source_report_key in (select m.source_report_key from mine m)
             order by f.source_report_key, (f.report_number is null), f.first_accepted_at, f.contributor_id
        )
        select count(distinct (m.source_report_key || '|' || coalesce(m.report_number, k.key_number, 'legacy')))
          into v_count
          from mine m left join key_numbers k using (source_report_key);
    end if;
    return jsonb_build_object(
        'user_ok', (v_id->>'user_ok')::boolean, 'kakao', (v_id->>'kakao')::boolean,
        'session', (v_id->>'session')::boolean, 'contributor', v_contributor, 'has_public_facts', v_has,
        'public_fact_count', v_count);
end;
$function$
;
CREATE OR REPLACE FUNCTION pg_temp.before_internal_analytics_cohort_state()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with bounds as (
    select min(f.report_date) as report_min, max(f.report_date) as report_max,
           min(f.completed_date) as completed_min, max(f.completed_date) as completed_max
      from private.community_report_facts f
      join private.contributor_profiles c on c.user_id = f.contributor_id and c.status = 'active'
     where f.public_state = 'completed'
       and private.community_lineage_active(f.consent_grant_id)
  )
  select public.internal_analytics_v2_state() || jsonb_build_object(
    'cohort_policy_version', 'single-date-v1',
    'basis_bounds', jsonb_build_object(
      'report_date', jsonb_build_object('min', b.report_min, 'max', b.report_max),
      'completed_date', jsonb_build_object('min', b.completed_min, 'max', b.completed_max)))
    from bounds b;
$function$
;
CREATE OR REPLACE FUNCTION pg_temp.before_internal_user_rankings(p_user uuid, p_session uuid, p_query jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET work_mem TO '32MB'
 SET statement_timeout TO '20s'
AS $function$
declare
 q jsonb:=p_query; v_gate jsonb; v_scope jsonb; v_result jsonb;
 v_theme text; v_metric text; v_period text; v_basis text; v_category text; v_month text;
 v_start date; v_end date; v_today date:=(statement_timestamp() at time zone 'Asia/Seoul')::date;
 v_min bigint; v_page bigint; v_size integer; v_expected text;
begin
 if p_user is null or p_session is null or q is null or jsonb_typeof(q)<>'object' then raise exception 'INVALID_QUERY'; end if;
 if exists(select 1 from jsonb_object_keys(q) k where k not in ('theme','metric','period','start','end','month','date_basis','category','min_reports','page','page_size','expected_version')) then raise exception 'INVALID_QUERY'; end if;
 v_theme:=q->>'theme'; v_metric:=q->>'metric'; v_period:=q->>'period'; v_basis:=q->>'date_basis'; v_category:=q->>'category';
 v_min:=(q->>'min_reports')::bigint; v_page:=(q->>'page')::bigint; v_size:=(q->>'page_size')::integer; v_expected:=q->>'expected_version';
 if v_theme is null or v_metric is null or v_period is null or v_basis is null or v_category is null
   or v_min is null or v_page is null or v_size is null or v_min<1 or v_min>9007199254740991 or v_page<1 or v_page>9007199254740991 or v_size not between 1 and 50
   or v_theme not in ('reporters','fines','unlucky') or v_period not in ('all','range','month')
   or v_basis not in ('completed_date','report_date') or v_category not in ('all','traffic','parking','other')
   or not ((v_theme='reporters' and v_metric='reports_count') or (v_theme='fines' and v_metric in ('fine_count','fine_rate'))
        or (v_theme='unlucky' and v_metric in ('rejected_count','rejected_rate','partial_count','partial_rate')))
   or (v_expected is not null and v_expected !~ '^[a-f0-9]{32}$') or (v_page>1 and v_expected is null)
 then raise exception 'INVALID_QUERY'; end if;
 if v_period='range' then
   if q->>'month' is not null or q->>'start' is null or q->>'end' is null
      or q->>'start' !~ '^\d{4}-\d{2}-\d{2}$' or q->>'end' !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'INVALID_QUERY'; end if;
   v_start:=(q->>'start')::date; v_end:=(q->>'end')::date;
   if v_start>v_end then raise exception 'INVALID_QUERY'; end if;
 else
   if q->>'start' is not null or q->>'end' is not null then raise exception 'INVALID_QUERY'; end if;
   if v_period='month' then
     v_month:=coalesce(q->>'month',to_char(v_today,'YYYY-MM'));
     if v_month !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'INVALID_QUERY'; end if;
     v_start:=(v_month||'-01')::date; v_end:=(v_start+interval '1 month'-interval '1 day')::date;
   elsif q->>'month' is not null then raise exception 'INVALID_QUERY'; end if;
 end if;
 -- Same map eligibility; checked again inside the aggregate RPC on every page.
 v_gate:=pg_temp.before_internal_analytics_viewer(p_user,p_session);
 if not coalesce((v_gate->>'user_ok')::boolean,false) then return jsonb_build_object('error','session_expired'); end if;
 if not coalesce((v_gate->>'kakao')::boolean,false) then return jsonb_build_object('error','kakao_required'); end if;
 if not coalesce((v_gate->>'session')::boolean,false) then return jsonb_build_object('error','session_expired'); end if;
 if v_gate->>'contributor' is distinct from 'active' then return jsonb_build_object('error','contributor_required'); end if;
 if coalesce((v_gate->>'public_fact_count')::bigint,0)<10 then
   return jsonb_build_object('error','upload_required','details',jsonb_build_object('required',10,'current',v_gate->'public_fact_count'));
 end if;
 v_scope:=jsonb_build_object('theme',v_theme,'metric',v_metric,'period',v_period,'start',v_start,'end',v_end,'month',v_month,
   'date_basis',v_basis,'category',v_category,'min_reports',v_min,'timezone','Asia/Seoul',
   'in_progress',v_period='month' and v_month=to_char(v_today,'YYYY-MM'));
 with reps as materialized (
   select r.*,case v_basis when 'report_date' then r.report_date else r.completed_date end as selected_date
   from pg_temp.before_ranking_representatives() r
 ), scoped as materialized (
   select * from reps r where (v_category='all' or r.category=v_category) and r.selected_date is not null
     and (v_start is null or r.selected_date between v_start and v_end)
 ), stats as materialized (
   select s.contributor_id,count(*) as reports,
     count(*) filter(where s.status in ('accepted','partial') and s.disposition='fine') as fine,
     count(*) filter(where s.status='rejected') as rejected,count(*) filter(where s.status='partial') as partial,
     count(*) filter(where s.status='completed_unknown') as completed_unknown
   from scoped s group by s.contributor_id
 ), diagnostics as (
   select jsonb_build_object('selected_date_missing',(select count(*) from reps where selected_date is null and (v_category='all' or category=v_category)),
     'completed_unknown',(select count(*) from scoped where status='completed_unknown'),
     'inconsistent_disposition',(select count(*) from scoped where (disposition in ('fine','penalty','warning') and status not in ('accepted','partial')))) as value
 ), version as (
   -- Hash ALL participant aggregates + full scope + diagnostics. No raw identity/UUID list is exported.
   select left(encode(sha256(convert_to(v_scope::text||'#size='||v_size||'#'||d.value::text||'#'||
     coalesce((select string_agg(s::text,E'\n' order by s.contributor_id) from stats s),''),'UTF8')),'hex'),32) as value from diagnostics d
 ), measures as (
   select s.*,case v_metric when 'reports_count' then s.reports when 'fine_count' then s.fine when 'fine_rate' then s.fine
     when 'rejected_count' then s.rejected when 'rejected_rate' then s.rejected else s.partial end as numerator,
     case when right(v_metric,5)='_rate' then s.reports else 1::bigint end as sort_denominator
   from stats s where s.reports>=v_min
 ), scores as (
   -- Exact order embedding on safe integer counts (N <= 2^53-1): distinct fractions differ by
   -- at least 1/(2^53-1)^2 > 10^-32. Integer quotient at scale 10^40 cannot merge
   -- unequal fractions. Equal fractions produce equal keys. No rounded/display rate sorts.
   select m.*,div(m.numerator::numeric * 10000000000000000000000000000000000000000::numeric,m.sort_denominator::numeric) as score
   from measures m
 ), ranks as (
   select s.*,rank() over(order by s.score desc) as rank from scores s
 ), ordered as (
   select r.*,count(*) over(partition by r.rank) as tie_count,
     row_number() over(order by r.rank,r.reports desc,r.contributor_id) as ord
   from ranks r
 ), rows as (
   select o.ord,o.contributor_id,jsonb_build_object('uuid',o.contributor_id,'rank',o.rank,'tie_count',o.tie_count,
     'reports',o.reports,'fine',o.fine,'rejected',o.rejected,'partial',o.partial,'completed_unknown',o.completed_unknown,
     'numerator',o.numerator,'denominator',o.reports,
     'value',case when right(v_metric,5)='_rate' then o.numerator*100.0/nullif(o.reports,0) else o.numerator::numeric end,
     'is_me',o.contributor_id=p_user) as value from ordered o
 ) select case when v_expected is not null and v_expected<>v.value then jsonb_build_object('error','DATASET_CHANGED') else
   jsonb_build_object('schema_version','user-rankings-v1','cohort_policy_version','single-date-v1','dataset_version',v.value,
    'generated_at',to_char(statement_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'scope',v_scope,
    'total_participants',(select count(*) from measures),
    'rows',coalesce((select jsonb_agg(r.value order by r.ord) from rows r where r.ord>(v_page-1)*v_size and r.ord<=v_page*v_size),'[]'::jsonb),
    'me',(select r.value from rows r where r.contributor_id=p_user), 'page',v_page,'page_size',v_size,
    'next_page',case when (select count(*) from measures)>v_page*v_size then v_page+1 else null end,'diagnostics',d.value) end
   into v_result from version v cross join diagnostics d;
 return v_result;
exception when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range then raise exception 'INVALID_QUERY';
end;
$function$
;
insert into cm_release_comparisons
select 'full representative rows',not exists((select * from pg_temp.before_ranking_representatives() except all select * from private.ranking_representatives()) union all (select * from private.ranking_representatives() except all select * from pg_temp.before_ranking_representatives())),1;
insert into cm_release_comparisons select 'cohort state',pg_temp.before_internal_analytics_cohort_state()=public.internal_analytics_cohort_state(),1;
create temporary table cm_release_context(user_id uuid,session_id uuid) on commit drop;
do $$declare s record;v_old jsonb;v_new jsonb;checks integer:=0;begin
 for s in select user_id,id from auth.sessions order by created_at desc limit 20 loop
  v_old:=pg_temp.before_internal_analytics_viewer(s.user_id,s.id);v_new:=public.internal_analytics_viewer(s.user_id,s.id);
  if v_old is distinct from v_new then raise exception 'viewer parity mismatch';end if;checks:=checks+1;
  if not exists(select 1 from cm_release_context) and (v_new->>'user_ok')::boolean and (v_new->>'kakao')::boolean and (v_new->>'session')::boolean and v_new->>'contributor'='active' and (v_new->>'public_fact_count')::integer>=10 then insert into cm_release_context values(s.user_id,s.id);end if;
 end loop;
 insert into cm_release_comparisons values('existing session viewer states',true,checks);
end;$$;
insert into cm_release_comparisons select 'reports_count/report_date/all',(a.body-'generated_at')=(b.body-'generated_at') and not(a.body ? 'error') and not(b.body ? 'error'),1 from cm_release_context c cross join lateral(select pg_temp.before_internal_user_rankings(c.user_id,c.session_id,'{"theme": "reporters", "metric": "reports_count", "period": "all", "start": null, "end": null, "month": null, "date_basis": "report_date", "category": "all", "min_reports": 1, "page": 1, "page_size": 20, "expected_version": null}'::jsonb) body)a cross join lateral(select public.internal_user_rankings(c.user_id,c.session_id,'{"theme": "reporters", "metric": "reports_count", "period": "all", "start": null, "end": null, "month": null, "date_basis": "report_date", "category": "all", "min_reports": 1, "page": 1, "page_size": 20, "expected_version": null}'::jsonb) body)b;
insert into cm_release_comparisons select 'reports_count/report_date/month',(a.body-'generated_at')=(b.body-'generated_at') and not(a.body ? 'error') and not(b.body ? 'error'),1 from cm_release_context c cross join lateral(select pg_temp.before_internal_user_rankings(c.user_id,c.session_id,'{"theme": "reporters", "metric": "reports_count", "period": "month", "start": null, "end": null, "month": "2023-07", "date_basis": "report_date", "category": "all", "min_reports": 1, "page": 1, "page_size": 20, "expected_version": null}'::jsonb) body)a cross join lateral(select public.internal_user_rankings(c.user_id,c.session_id,'{"theme": "reporters", "metric": "reports_count", "period": "month", "start": null, "end": null, "month": "2023-07", "date_basis": "report_date", "category": "all", "min_reports": 1, "page": 1, "page_size": 20, "expected_version": null}'::jsonb) body)b;
insert into cm_release_comparisons select 'reports_count/completed_date/all',(a.body-'generated_at')=(b.body-'generated_at') and not(a.body ? 'error') and not(b.body ? 'error'),1 from cm_release_context c cross join lateral(select pg_temp.before_internal_user_rankings(c.user_id,c.session_id,'{"theme": "reporters", "metric": "reports_count", "period": "all", "start": null, "end": null, "month": null, "date_basis": "completed_date", "category": "all", "min_reports": 1, "page": 1, "page_size": 20, "expected_version": null}'::jsonb) body)a cross join lateral(select public.internal_user_rankings(c.user_id,c.session_id,'{"theme": "reporters", "metric": "reports_count", "period": "all", "start": null, "end": null, "month": null, "date_basis": "completed_date", "category": "all", "min_reports": 1, "page": 1, "page_size": 20, "expected_version": null}'::jsonb) body)b;
insert into cm_release_comparisons select 'reports_count/completed_date/month',(a.body-'generated_at')=(b.body-'generated_at') and not(a.body ? 'error') and not(b.body ? 'error'),1 from cm_release_context c cross join lateral(select pg_temp.before_internal_user_rankings(c.user_id,c.session_id,'{"theme": "reporters", "metric": "reports_count", "period": "month", "start": null, "end": null, "month": "2023-07", "date_basis": "completed_date", "category": "all", "min_reports": 1, "page": 1, "page_size": 20, "expected_version": null}'::jsonb) body)a cross join lateral(select public.internal_user_rankings(c.user_id,c.session_id,'{"theme": "reporters", "metric": "reports_count", "period": "month", "start": null, "end": null, "month": "2023-07", "date_basis": "completed_date", "category": "all", "min_reports": 1, "page": 1, "page_size": 20, "expected_version": null}'::jsonb) body)b;
insert into cm_release_comparisons select 'fine_count/report_date/all',(a.body-'generated_at')=(b.body-'generated_at') and not(a.body ? 'error') and not(b.body ? 'error'),1 from cm_release_context c cross join lateral(select pg_temp.before_internal_user_rankings(c.user_id,c.session_id,'{"theme": "fines", "metric": "fine_count", "period": "all", "start": null, "end": null, "month": null, "date_basis": "report_date", "category": "all", "min_reports": 1, "page": 1, "page_size": 20, "expected_version": null}'::jsonb) body)a cross join lateral(select public.internal_user_rankings(c.user_id,c.session_id,'{"theme": "fines", "metric": "fine_count", "period": "all", "start": null, "end": null, "month": null, "date_basis": "report_date", "category": "all", "min_reports": 1, "page": 1, "page_size": 20, "expected_version": null}'::jsonb) body)b;
insert into cm_release_comparisons select 'fine_count/report_date/month',(a.body-'generated_at')=(b.body-'generated_at') and not(a.body ? 'error') and not(b.body ? 'error'),1 from cm_release_context c cross join lateral(select pg_temp.before_internal_user_rankings(c.user_id,c.session_id,'{"theme": "fines", "metric": "fine_count", "period": "month", "start": null, "end": null, "month": "2023-07", "date_basis": "report_date", "category": "all", "min_reports": 1, "page": 1, "page_size": 20, "expected_version": null}'::jsonb) body)a cross join lateral(select public.internal_user_rankings(c.user_id,c.session_id,'{"theme": "fines", "metric": "fine_count", "period": "month", "start": null, "end": null, "month": "2023-07", "date_basis": "report_date", "category": "all", "min_reports": 1, "page": 1, "page_size": 20, "expected_version": null}'::jsonb) body)b;
insert into cm_release_comparisons select 'fine_count/completed_date/all',(a.body-'generated_at')=(b.body-'generated_at') and not(a.body ? 'error') and not(b.body ? 'error'),1 from cm_release_context c cross join lateral(select pg_temp.before_internal_user_rankings(c.user_id,c.session_id,'{"theme": "fines", "metric": "fine_count", "period": "all", "start": null, "end": null, "month": null, "date_basis": "completed_date", "category": "all", "min_reports": 1, "page": 1, "page_size": 20, "expected_version": null}'::jsonb) body)a cross join lateral(select public.internal_user_rankings(c.user_id,c.session_id,'{"theme": "fines", "metric": "fine_count", "period": "all", "start": null, "end": null, "month": null, "date_basis": "completed_date", "category": "all", "min_reports": 1, "page": 1, "page_size": 20, "expected_version": null}'::jsonb) body)b;
insert into cm_release_comparisons select 'fine_count/completed_date/month',(a.body-'generated_at')=(b.body-'generated_at') and not(a.body ? 'error') and not(b.body ? 'error'),1 from cm_release_context c cross join lateral(select pg_temp.before_internal_user_rankings(c.user_id,c.session_id,'{"theme": "fines", "metric": "fine_count", "period": "month", "start": null, "end": null, "month": "2023-07", "date_basis": "completed_date", "category": "all", "min_reports": 1, "page": 1, "page_size": 20, "expected_version": null}'::jsonb) body)a cross join lateral(select public.internal_user_rankings(c.user_id,c.session_id,'{"theme": "fines", "metric": "fine_count", "period": "month", "start": null, "end": null, "month": "2023-07", "date_basis": "completed_date", "category": "all", "min_reports": 1, "page": 1, "page_size": 20, "expected_version": null}'::jsonb) body)b;
insert into cm_release_comparisons select 'fine_rate/report_date/all',(a.body-'generated_at')=(b.body-'generated_at') and not(a.body ? 'error') and not(b.body ? 'error'),1 from cm_release_context c cross join lateral(select pg_temp.before_internal_user_rankings(c.user_id,c.session_id,'{"theme": "fines", "metric": "fine_rate", "period": "all", "start": null, "end": null, "month": null, "date_basis": "report_date", "category": "all", "min_reports": 1, "page": 1, "page_size": 20, "expected_version": null}'::jsonb) body)a cross join lateral(select public.internal_user_rankings(c.user_id,c.session_id,'{"theme": "fines", "metric": "fine_rate", "period": "all", "start": null, "end": null, "month": null, "date_basis": "report_date", "category": "all", "min_reports": 1, "page": 1, "page_size": 20, "expected_version": null}'::jsonb) body)b;
insert into cm_release_comparisons select 'fine_rate/report_date/month',(a.body-'generated_at')=(b.body-'generated_at') and not(a.body ? 'error') and not(b.body ? 'error'),1 from cm_release_context c cross join lateral(select pg_temp.before_internal_user_rankings(c.user_id,c.session_id,'{"theme": "fines", "metric": "fine_rate", "period": "month", "start": null, "end": null, "month": "2023-07", "date_basis": "report_date", "category": "all", "min_reports": 1, "page": 1, "page_size": 20, "expected_version": null}'::jsonb) body)a cross join lateral(select public.internal_user_rankings(c.user_id,c.session_id,'{"theme": "fines", "metric": "fine_rate", "period": "month", "start": null, "end": null, "month": "2023-07", "date_basis": "report_date", "category": "all", "min_reports": 1, "page": 1, "page_size": 20, "expected_version": null}'::jsonb) body)b;
insert into cm_release_comparisons select 'fine_rate/completed_date/all',(a.body-'generated_at')=(b.body-'generated_at') and not(a.body ? 'error') and not(b.body ? 'error'),1 from cm_release_context c cross join lateral(select pg_temp.before_internal_user_rankings(c.user_id,c.session_id,'{"theme": "fines", "metric": "fine_rate", "period": "all", "start": null, "end": null, "month": null, "date_basis": "completed_date", "category": "all", "min_reports": 1, "page": 1, "page_size": 20, "expected_version": null}'::jsonb) body)a cross join lateral(select public.internal_user_rankings(c.user_id,c.session_id,'{"theme": "fines", "metric": "fine_rate", "period": "all", "start": null, "end": null, "month": null, "date_basis": "completed_date", "category": "all", "min_reports": 1, "page": 1, "page_size": 20, "expected_version": null}'::jsonb) body)b;
insert into cm_release_comparisons select 'fine_rate/completed_date/month',(a.body-'generated_at')=(b.body-'generated_at') and not(a.body ? 'error') and not(b.body ? 'error'),1 from cm_release_context c cross join lateral(select pg_temp.before_internal_user_rankings(c.user_id,c.session_id,'{"theme": "fines", "metric": "fine_rate", "period": "month", "start": null, "end": null, "month": "2023-07", "date_basis": "completed_date", "category": "all", "min_reports": 1, "page": 1, "page_size": 20, "expected_version": null}'::jsonb) body)a cross join lateral(select public.internal_user_rankings(c.user_id,c.session_id,'{"theme": "fines", "metric": "fine_rate", "period": "month", "start": null, "end": null, "month": "2023-07", "date_basis": "completed_date", "category": "all", "min_reports": 1, "page": 1, "page_size": 20, "expected_version": null}'::jsonb) body)b;
insert into cm_release_comparisons select 'rejected_count/report_date/all',(a.body-'generated_at')=(b.body-'generated_at') and not(a.body ? 'error') and not(b.body ? 'error'),1 from cm_release_context c cross join lateral(select pg_temp.before_internal_user_rankings(c.user_id,c.session_id,'{"theme": "unlucky", "metric": "rejected_count", "period": "all", "start": null, "end": null, "month": null, "date_basis": "report_date", "category": "all", "min_reports": 1, "page": 1, "page_size": 20, "expected_version": null}'::jsonb) body)a cross join lateral(select public.internal_user_rankings(c.user_id,c.session_id,'{"theme": "unlucky", "metric": "rejected_count", "period": "all", "start": null, "end": null, "month": null, "date_basis": "report_date", "category": "all", "min_reports": 1, "page": 1, "page_size": 20, "expected_version": null}'::jsonb) body)b;
insert into cm_release_comparisons select 'rejected_count/report_date/month',(a.body-'generated_at')=(b.body-'generated_at') and not(a.body ? 'error') and not(b.body ? 'error'),1 from cm_release_context c cross join lateral(select pg_temp.before_internal_user_rankings(c.user_id,c.session_id,'{"theme": "unlucky", "metric": "rejected_count", "period": "month", "start": null, "end": null, "month": "2023-07", "date_basis": "report_date", "category": "all", "min_reports": 1, "page": 1, "page_size": 20, "expected_version": null}'::jsonb) body)a cross join lateral(select public.internal_user_rankings(c.user_id,c.session_id,'{"theme": "unlucky", "metric": "rejected_count", "period": "month", "start": null, "end": null, "month": "2023-07", "date_basis": "report_date", "category": "all", "min_reports": 1, "page": 1, "page_size": 20, "expected_version": null}'::jsonb) body)b;
insert into cm_release_comparisons select 'rejected_count/completed_date/all',(a.body-'generated_at')=(b.body-'generated_at') and not(a.body ? 'error') and not(b.body ? 'error'),1 from cm_release_context c cross join lateral(select pg_temp.before_internal_user_rankings(c.user_id,c.session_id,'{"theme": "unlucky", "metric": "rejected_count", "period": "all", "start": null, "end": null, "month": null, "date_basis": "completed_date", "category": "all", "min_reports": 1, "page": 1, "page_size": 20, "expected_version": null}'::jsonb) body)a cross join lateral(select public.internal_user_rankings(c.user_id,c.session_id,'{"theme": "unlucky", "metric": "rejected_count", "period": "all", "start": null, "end": null, "month": null, "date_basis": "completed_date", "category": "all", "min_reports": 1, "page": 1, "page_size": 20, "expected_version": null}'::jsonb) body)b;
insert into cm_release_comparisons select 'rejected_count/completed_date/month',(a.body-'generated_at')=(b.body-'generated_at') and not(a.body ? 'error') and not(b.body ? 'error'),1 from cm_release_context c cross join lateral(select pg_temp.before_internal_user_rankings(c.user_id,c.session_id,'{"theme": "unlucky", "metric": "rejected_count", "period": "month", "start": null, "end": null, "month": "2023-07", "date_basis": "completed_date", "category": "all", "min_reports": 1, "page": 1, "page_size": 20, "expected_version": null}'::jsonb) body)a cross join lateral(select public.internal_user_rankings(c.user_id,c.session_id,'{"theme": "unlucky", "metric": "rejected_count", "period": "month", "start": null, "end": null, "month": "2023-07", "date_basis": "completed_date", "category": "all", "min_reports": 1, "page": 1, "page_size": 20, "expected_version": null}'::jsonb) body)b;
insert into cm_release_comparisons select 'rejected_rate/report_date/all',(a.body-'generated_at')=(b.body-'generated_at') and not(a.body ? 'error') and not(b.body ? 'error'),1 from cm_release_context c cross join lateral(select pg_temp.before_internal_user_rankings(c.user_id,c.session_id,'{"theme": "unlucky", "metric": "rejected_rate", "period": "all", "start": null, "end": null, "month": null, "date_basis": "report_date", "category": "all", "min_reports": 1, "page": 1, "page_size": 20, "expected_version": null}'::jsonb) body)a cross join lateral(select public.internal_user_rankings(c.user_id,c.session_id,'{"theme": "unlucky", "metric": "rejected_rate", "period": "all", "start": null, "end": null, "month": null, "date_basis": "report_date", "category": "all", "min_reports": 1, "page": 1, "page_size": 20, "expected_version": null}'::jsonb) body)b;
insert into cm_release_comparisons select 'rejected_rate/report_date/month',(a.body-'generated_at')=(b.body-'generated_at') and not(a.body ? 'error') and not(b.body ? 'error'),1 from cm_release_context c cross join lateral(select pg_temp.before_internal_user_rankings(c.user_id,c.session_id,'{"theme": "unlucky", "metric": "rejected_rate", "period": "month", "start": null, "end": null, "month": "2023-07", "date_basis": "report_date", "category": "all", "min_reports": 1, "page": 1, "page_size": 20, "expected_version": null}'::jsonb) body)a cross join lateral(select public.internal_user_rankings(c.user_id,c.session_id,'{"theme": "unlucky", "metric": "rejected_rate", "period": "month", "start": null, "end": null, "month": "2023-07", "date_basis": "report_date", "category": "all", "min_reports": 1, "page": 1, "page_size": 20, "expected_version": null}'::jsonb) body)b;
insert into cm_release_comparisons select 'rejected_rate/completed_date/all',(a.body-'generated_at')=(b.body-'generated_at') and not(a.body ? 'error') and not(b.body ? 'error'),1 from cm_release_context c cross join lateral(select pg_temp.before_internal_user_rankings(c.user_id,c.session_id,'{"theme": "unlucky", "metric": "rejected_rate", "period": "all", "start": null, "end": null, "month": null, "date_basis": "completed_date", "category": "all", "min_reports": 1, "page": 1, "page_size": 20, "expected_version": null}'::jsonb) body)a cross join lateral(select public.internal_user_rankings(c.user_id,c.session_id,'{"theme": "unlucky", "metric": "rejected_rate", "period": "all", "start": null, "end": null, "month": null, "date_basis": "completed_date", "category": "all", "min_reports": 1, "page": 1, "page_size": 20, "expected_version": null}'::jsonb) body)b;
insert into cm_release_comparisons select 'rejected_rate/completed_date/month',(a.body-'generated_at')=(b.body-'generated_at') and not(a.body ? 'error') and not(b.body ? 'error'),1 from cm_release_context c cross join lateral(select pg_temp.before_internal_user_rankings(c.user_id,c.session_id,'{"theme": "unlucky", "metric": "rejected_rate", "period": "month", "start": null, "end": null, "month": "2023-07", "date_basis": "completed_date", "category": "all", "min_reports": 1, "page": 1, "page_size": 20, "expected_version": null}'::jsonb) body)a cross join lateral(select public.internal_user_rankings(c.user_id,c.session_id,'{"theme": "unlucky", "metric": "rejected_rate", "period": "month", "start": null, "end": null, "month": "2023-07", "date_basis": "completed_date", "category": "all", "min_reports": 1, "page": 1, "page_size": 20, "expected_version": null}'::jsonb) body)b;
insert into cm_release_comparisons select 'partial_count/report_date/all',(a.body-'generated_at')=(b.body-'generated_at') and not(a.body ? 'error') and not(b.body ? 'error'),1 from cm_release_context c cross join lateral(select pg_temp.before_internal_user_rankings(c.user_id,c.session_id,'{"theme": "unlucky", "metric": "partial_count", "period": "all", "start": null, "end": null, "month": null, "date_basis": "report_date", "category": "all", "min_reports": 1, "page": 1, "page_size": 20, "expected_version": null}'::jsonb) body)a cross join lateral(select public.internal_user_rankings(c.user_id,c.session_id,'{"theme": "unlucky", "metric": "partial_count", "period": "all", "start": null, "end": null, "month": null, "date_basis": "report_date", "category": "all", "min_reports": 1, "page": 1, "page_size": 20, "expected_version": null}'::jsonb) body)b;
insert into cm_release_comparisons select 'partial_count/report_date/month',(a.body-'generated_at')=(b.body-'generated_at') and not(a.body ? 'error') and not(b.body ? 'error'),1 from cm_release_context c cross join lateral(select pg_temp.before_internal_user_rankings(c.user_id,c.session_id,'{"theme": "unlucky", "metric": "partial_count", "period": "month", "start": null, "end": null, "month": "2023-07", "date_basis": "report_date", "category": "all", "min_reports": 1, "page": 1, "page_size": 20, "expected_version": null}'::jsonb) body)a cross join lateral(select public.internal_user_rankings(c.user_id,c.session_id,'{"theme": "unlucky", "metric": "partial_count", "period": "month", "start": null, "end": null, "month": "2023-07", "date_basis": "report_date", "category": "all", "min_reports": 1, "page": 1, "page_size": 20, "expected_version": null}'::jsonb) body)b;
insert into cm_release_comparisons select 'partial_count/completed_date/all',(a.body-'generated_at')=(b.body-'generated_at') and not(a.body ? 'error') and not(b.body ? 'error'),1 from cm_release_context c cross join lateral(select pg_temp.before_internal_user_rankings(c.user_id,c.session_id,'{"theme": "unlucky", "metric": "partial_count", "period": "all", "start": null, "end": null, "month": null, "date_basis": "completed_date", "category": "all", "min_reports": 1, "page": 1, "page_size": 20, "expected_version": null}'::jsonb) body)a cross join lateral(select public.internal_user_rankings(c.user_id,c.session_id,'{"theme": "unlucky", "metric": "partial_count", "period": "all", "start": null, "end": null, "month": null, "date_basis": "completed_date", "category": "all", "min_reports": 1, "page": 1, "page_size": 20, "expected_version": null}'::jsonb) body)b;
insert into cm_release_comparisons select 'partial_count/completed_date/month',(a.body-'generated_at')=(b.body-'generated_at') and not(a.body ? 'error') and not(b.body ? 'error'),1 from cm_release_context c cross join lateral(select pg_temp.before_internal_user_rankings(c.user_id,c.session_id,'{"theme": "unlucky", "metric": "partial_count", "period": "month", "start": null, "end": null, "month": "2023-07", "date_basis": "completed_date", "category": "all", "min_reports": 1, "page": 1, "page_size": 20, "expected_version": null}'::jsonb) body)a cross join lateral(select public.internal_user_rankings(c.user_id,c.session_id,'{"theme": "unlucky", "metric": "partial_count", "period": "month", "start": null, "end": null, "month": "2023-07", "date_basis": "completed_date", "category": "all", "min_reports": 1, "page": 1, "page_size": 20, "expected_version": null}'::jsonb) body)b;
insert into cm_release_comparisons select 'partial_rate/report_date/all',(a.body-'generated_at')=(b.body-'generated_at') and not(a.body ? 'error') and not(b.body ? 'error'),1 from cm_release_context c cross join lateral(select pg_temp.before_internal_user_rankings(c.user_id,c.session_id,'{"theme": "unlucky", "metric": "partial_rate", "period": "all", "start": null, "end": null, "month": null, "date_basis": "report_date", "category": "all", "min_reports": 1, "page": 1, "page_size": 20, "expected_version": null}'::jsonb) body)a cross join lateral(select public.internal_user_rankings(c.user_id,c.session_id,'{"theme": "unlucky", "metric": "partial_rate", "period": "all", "start": null, "end": null, "month": null, "date_basis": "report_date", "category": "all", "min_reports": 1, "page": 1, "page_size": 20, "expected_version": null}'::jsonb) body)b;
insert into cm_release_comparisons select 'partial_rate/report_date/month',(a.body-'generated_at')=(b.body-'generated_at') and not(a.body ? 'error') and not(b.body ? 'error'),1 from cm_release_context c cross join lateral(select pg_temp.before_internal_user_rankings(c.user_id,c.session_id,'{"theme": "unlucky", "metric": "partial_rate", "period": "month", "start": null, "end": null, "month": "2023-07", "date_basis": "report_date", "category": "all", "min_reports": 1, "page": 1, "page_size": 20, "expected_version": null}'::jsonb) body)a cross join lateral(select public.internal_user_rankings(c.user_id,c.session_id,'{"theme": "unlucky", "metric": "partial_rate", "period": "month", "start": null, "end": null, "month": "2023-07", "date_basis": "report_date", "category": "all", "min_reports": 1, "page": 1, "page_size": 20, "expected_version": null}'::jsonb) body)b;
insert into cm_release_comparisons select 'partial_rate/completed_date/all',(a.body-'generated_at')=(b.body-'generated_at') and not(a.body ? 'error') and not(b.body ? 'error'),1 from cm_release_context c cross join lateral(select pg_temp.before_internal_user_rankings(c.user_id,c.session_id,'{"theme": "unlucky", "metric": "partial_rate", "period": "all", "start": null, "end": null, "month": null, "date_basis": "completed_date", "category": "all", "min_reports": 1, "page": 1, "page_size": 20, "expected_version": null}'::jsonb) body)a cross join lateral(select public.internal_user_rankings(c.user_id,c.session_id,'{"theme": "unlucky", "metric": "partial_rate", "period": "all", "start": null, "end": null, "month": null, "date_basis": "completed_date", "category": "all", "min_reports": 1, "page": 1, "page_size": 20, "expected_version": null}'::jsonb) body)b;
insert into cm_release_comparisons select 'partial_rate/completed_date/month',(a.body-'generated_at')=(b.body-'generated_at') and not(a.body ? 'error') and not(b.body ? 'error'),1 from cm_release_context c cross join lateral(select pg_temp.before_internal_user_rankings(c.user_id,c.session_id,'{"theme": "unlucky", "metric": "partial_rate", "period": "month", "start": null, "end": null, "month": "2023-07", "date_basis": "completed_date", "category": "all", "min_reports": 1, "page": 1, "page_size": 20, "expected_version": null}'::jsonb) body)a cross join lateral(select public.internal_user_rankings(c.user_id,c.session_id,'{"theme": "unlucky", "metric": "partial_rate", "period": "month", "start": null, "end": null, "month": "2023-07", "date_basis": "completed_date", "category": "all", "min_reports": 1, "page": 1, "page_size": 20, "expected_version": null}'::jsonb) body)b;
insert into cm_release_comparisons select 'ranking existing eligible session unavailable',null,0 where not exists(select 1 from cm_release_context);
select label,passed,comparisons from cm_release_comparisons;rollback;
