-- One STABLE call uses the caller statement MVCC snapshot for every nested read.
-- No lock against ingest, stored snapshots, raw browser payload or timeout changes.
begin;
create or replace function public.internal_analytics_read_snapshot(
  p_scope jsonb, p_previous boolean default false,
  p_kind text default null, p_options jsonb default '{}'::jsonb,
  p_user uuid default null, p_session uuid default null
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s jsonb; v jsonb; data jsonb; box double precision[];
begin
  s := public.internal_analytics_cohort_state();
  if p_user is not null then
    v := public.internal_analytics_viewer(p_user,p_session);
    if not coalesce((v->>'user_ok')::boolean,false) or
       not coalesce((v->>'kakao')::boolean,false) or
       not coalesce((v->>'session')::boolean,false) or
       v->>'contributor' is distinct from 'active' or
       coalesce((v->>'public_fact_count')::bigint,0)<10 then
      return jsonb_build_object('state',s,'viewer',v,'facts','[]'::jsonb);
    end if;
  end if;
  if p_kind is not null then
    data := public.internal_analytics_rollup(p_scope,p_kind,
      coalesce(p_options,'{}'::jsonb) || jsonb_build_object('expected_version',s->>'dataset_version'));
    return jsonb_build_object('state',s,'rollup',data);
  end if;
  if jsonb_typeof(p_scope->'bbox')='array' then
    select array_agg(x::double precision order by n) into box
      from jsonb_array_elements_text(p_scope->'bbox') with ordinality a(x,n);
  end if;
  data := public.internal_analytics_cohort_facts(
    p_scope->>'date_basis',(p_scope->>'start')::date,(p_scope->>'end')::date,p_previous,
    p_scope->>'category',null,p_scope->>'agency_key',p_scope->>'manager_key',box);
  return jsonb_build_object('state',s,'viewer',v,'facts',data);
end $$;
revoke all on function public.internal_analytics_read_snapshot(jsonb,boolean,text,jsonb,uuid,uuid) from public,anon,authenticated;
grant execute on function public.internal_analytics_read_snapshot(jsonb,boolean,text,jsonb,uuid,uuid) to service_role;
comment on function public.internal_analytics_read_snapshot(jsonb,boolean,text,jsonb,uuid,uuid)
  is 'Service-only single-statement snapshot for version, eligible facts/rollup and optional screen viewer.';
-- A ranking page and own-rank already share one stable snapshot. Latest mode replaces a whole page.
create or replace function public.internal_user_rankings(p_user uuid,p_session uuid,p_query jsonb)
returns jsonb language plpgsql stable security definer set search_path='' set work_mem='32MB' set statement_timeout='20s' as $$
declare
 q jsonb:=p_query; v_gate jsonb; v_scope jsonb; v_result jsonb;
 v_theme text; v_metric text; v_period text; v_basis text; v_category text; v_month text;
 v_start date; v_end date; v_today date:=(statement_timestamp() at time zone 'Asia/Seoul')::date;
 v_min bigint; v_page bigint; v_size integer; v_expected text;
begin
 if p_user is null or p_session is null or q is null or jsonb_typeof(q)<>'object' then raise exception 'INVALID_QUERY'; end if;
 if exists(select 1 from jsonb_object_keys(q) k where k not in ('theme','metric','period','start','end','month','date_basis','category','min_reports','page','page_size','expected_version','consistency')) then raise exception 'INVALID_QUERY'; end if;
 v_theme:=q->>'theme'; v_metric:=q->>'metric'; v_period:=q->>'period'; v_basis:=q->>'date_basis'; v_category:=q->>'category';
 v_min:=(q->>'min_reports')::bigint; v_page:=(q->>'page')::bigint; v_size:=(q->>'page_size')::integer; v_expected:=q->>'expected_version';
 if v_theme is null or v_metric is null or v_period is null or v_basis is null or v_category is null
   or v_min is null or v_page is null or v_size is null or v_min<1 or v_min>9007199254740991 or v_page<1 or v_page>9007199254740991 or v_size not between 1 and 50
   or v_theme not in ('reporters','fines','unlucky') or v_period not in ('all','range','month')
   or v_basis not in ('completed_date','report_date') or v_category not in ('all','traffic','parking','other')
   or not ((v_theme='reporters' and v_metric='reports_count') or (v_theme='fines' and v_metric in ('fine_count','fine_rate'))
        or (v_theme='unlucky' and v_metric in ('rejected_count','rejected_rate','partial_count','partial_rate')))
   or (v_expected is not null and v_expected !~ '^[a-f0-9]{32}$') or (q ? 'consistency' and q->>'consistency' is distinct from 'latest') or (v_page>1 and v_expected is null and q->>'consistency' is distinct from 'latest')
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
 v_gate:=public.internal_analytics_viewer(p_user,p_session);
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
   from private.ranking_representatives() r
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
 ) select case when q->>'consistency' is distinct from 'latest' and v_expected is not null and v_expected<>v.value then jsonb_build_object('error','DATASET_CHANGED') else
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
$$;

revoke all on function public.internal_user_rankings(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.internal_user_rankings(uuid,uuid,jsonb) to service_role;
commit;
