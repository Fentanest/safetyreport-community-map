-- 랭킹 한 페이지 보드(2026-10-11 사용자 결정): 기간만 고르면 테마 3 × 지표 7 의 TOP K 를 한 화면에 보인다.
-- public.internal_user_rankings 를 지표마다 7번 부르면 열람 자격·대표 선출(ranking_representatives)·집계를 7번 하므로,
-- 이 함수는 자격 확인·reps·scoped·stats 를 **한 번만** 계산하고 지표 7개에 기존 함수와 같은 순위 규칙을 적용한다.
--   - competition rank(1,1,3), 비율은 정확한 분수 정렬 키 div(분자·10^40, N), 표시 순서는 순위 → N 내림차순 → UUID.
--   - min_reports 는 모든 지표에 같게, 행 JSON·value 식·is_me 도 기존 함수와 같다.
--   - 지표마다 top K(기본 5, 최대 10) + 그 지표의 내 순위(me, TOP 밖이어도 전체 기준) + total_participants.
--   - dataset_version 은 기존과 같은 방식: 정규화한 scope·진단·**전체 참여자 집계**의 SHA-256 앞 32자.
-- 5분류(observation-v5, 202610110100)로 처음부터 작성한다. service_role 전용, search_path 비움(기존 함수와 같은 보안 패턴).
-- 기존 internal_user_rankings(페이지형 전체 보기 목록)는 그대로 둔다.
-- 되돌리기: drop function public.internal_user_rankings_board(uuid,uuid,jsonb); (다른 객체·자료 변경 없음)
begin;
create or replace function public.internal_user_rankings_board(p_user uuid,p_session uuid,p_query jsonb)
returns jsonb language plpgsql stable security definer set search_path='' set work_mem='32MB' set statement_timeout='20s' as $$
declare
 q jsonb:=p_query; v_gate jsonb; v_scope jsonb; v_result jsonb;
 v_period text; v_basis text; v_category text; v_month text;
 v_start date; v_end date; v_today date:=(statement_timestamp() at time zone 'Asia/Seoul')::date;
 v_min bigint; v_top integer;
begin
 if p_user is null or p_session is null or q is null or jsonb_typeof(q)<>'object' then raise exception 'INVALID_QUERY'; end if;
 if exists(select 1 from jsonb_object_keys(q) k where k not in ('period','start','end','month','date_basis','category','min_reports','top','consistency')) then raise exception 'INVALID_QUERY'; end if;
 v_period:=q->>'period'; v_basis:=q->>'date_basis'; v_category:=q->>'category';
 v_min:=(q->>'min_reports')::bigint; v_top:=(q->>'top')::integer;
 if v_period is null or v_basis is null or v_category is null or v_min is null or v_top is null
   or v_min<1 or v_min>9007199254740991 or v_top not between 1 and 10
   or v_period not in ('all','range','month') or v_basis not in ('completed_date','report_date')
   or v_category not in ('all','traffic','parking','safety','living','other')
   or (q ? 'consistency' and q->>'consistency' is distinct from 'latest')
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
 -- 지도와 같은 열람 자격. 매 요청 다시 확인한다(기존 함수와 같은 오류 코드).
 v_gate:=public.internal_analytics_viewer(p_user,p_session);
 if not coalesce((v_gate->>'user_ok')::boolean,false) then return jsonb_build_object('error','session_expired'); end if;
 if not coalesce((v_gate->>'kakao')::boolean,false) then return jsonb_build_object('error','kakao_required'); end if;
 if not coalesce((v_gate->>'session')::boolean,false) then return jsonb_build_object('error','session_expired'); end if;
 if v_gate->>'contributor' is distinct from 'active' then return jsonb_build_object('error','contributor_required'); end if;
 if coalesce((v_gate->>'public_fact_count')::bigint,0)<10 then
   return jsonb_build_object('error','upload_required','details',jsonb_build_object('required',10,'current',v_gate->'public_fact_count'));
 end if;
 v_scope:=jsonb_build_object('period',v_period,'start',v_start,'end',v_end,'month',v_month,
   'date_basis',v_basis,'category',v_category,'min_reports',v_min,'top',v_top,'timezone','Asia/Seoul',
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
   -- 전체 참여자 집계 + 정규화 scope(top 포함) + 진단의 해시. UUID 목록·원문은 내보내지 않는다.
   select left(encode(sha256(convert_to(v_scope::text||'#board#'||d.value::text||'#'||
     coalesce((select string_agg(s::text,E'\n' order by s.contributor_id) from stats s),''),'UTF8')),'hex'),32) as value from diagnostics d
 ), metrics(metric,theme,pos) as (
   values ('reports_count','reporters',1),('fine_count','fines',2),('fine_rate','fines',3),
     ('rejected_count','unlucky',4),('rejected_rate','unlucky',5),('partial_count','unlucky',6),('partial_rate','unlucky',7)
 ), eligible as materialized (
   select s.* from stats s where s.reports>=v_min
 ), measures as (
   select x.metric,e.*,case x.metric when 'reports_count' then e.reports when 'fine_count' then e.fine when 'fine_rate' then e.fine
     when 'rejected_count' then e.rejected when 'rejected_rate' then e.rejected else e.partial end as numerator,
     case when right(x.metric,5)='_rate' then e.reports else 1::bigint end as sort_denominator
   from metrics x cross join eligible e
 ), scores as (
   -- 기존 함수와 같은 정확한 분수 정렬 키(안전 정수 N ≤ 2^53-1 에서 서로 다른 분수는 10^-32 보다 멀다).
   select m.*,div(m.numerator::numeric * 10000000000000000000000000000000000000000::numeric,m.sort_denominator::numeric) as score
   from measures m
 ), ranks as (
   select s.*,rank() over(partition by s.metric order by s.score desc) as rank from scores s
 ), ordered as (
   select r.*,count(*) over(partition by r.metric,r.rank) as tie_count,
     row_number() over(partition by r.metric order by r.rank,r.reports desc,r.contributor_id) as ord
   from ranks r
 ), picked as (
   select o.metric,o.ord,o.contributor_id,jsonb_build_object('uuid',o.contributor_id,'rank',o.rank,'tie_count',o.tie_count,
     'reports',o.reports,'fine',o.fine,'rejected',o.rejected,'partial',o.partial,'completed_unknown',o.completed_unknown,
     'numerator',o.numerator,'denominator',o.reports,
     'value',case when right(o.metric,5)='_rate' then o.numerator*100.0/nullif(o.reports,0) else o.numerator::numeric end,
     'is_me',o.contributor_id=p_user) as value
   from ordered o where o.ord<=v_top or o.contributor_id=p_user
 ), boards as (
   select x.pos,jsonb_build_object('theme',x.theme,'metric',x.metric,
     'total_participants',(select count(*) from eligible),
     'rows',coalesce((select jsonb_agg(p.value order by p.ord) from picked p where p.metric=x.metric and p.ord<=v_top),'[]'::jsonb),
     'me',(select p.value from picked p where p.metric=x.metric and p.contributor_id=p_user)) as value
   from metrics x
 ) select jsonb_build_object('schema_version','user-rankings-board-v1','cohort_policy_version','single-date-v1','dataset_version',v.value,
    'generated_at',to_char(statement_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'scope',v_scope,
    'total_participants',(select count(*) from eligible),
    'boards',(select jsonb_agg(b.value order by b.pos) from boards b),'diagnostics',d.value)
   into v_result from version v cross join diagnostics d;
 return v_result;
exception when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range then raise exception 'INVALID_QUERY';
end;
$$;

revoke all on function public.internal_user_rankings_board(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.internal_user_rankings_board(uuid,uuid,jsonb) to service_role;
comment on function public.internal_user_rankings_board(uuid,uuid,jsonb)
  is 'Service-only ranking board: one gate/election/aggregate, seven metrics top K + own rank with internal_user_rankings rules.';
commit;
