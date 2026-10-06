/** Service-only sufficient statistics. No fact identities, account IDs or raw observations.
 * SQL owns elections, exact counts and quantiles; this module owns DTOs, locale sorting and paging.
 */
import { basisWindow, growth, mapNodes, monthSpine, previousWindow, todayKst } from './aggregate.ts';
import { agencyTypeOf } from './agencyType.ts';
import { placesInView } from './places.ts';
import { regionName } from './regions.ts';
import { diffOf } from './compare.ts';
import { computeSameNames } from '../src/domain/managerNames.ts';
import { compareRows } from '../src/domain/tableSort.ts';
import { COHORT_POLICY_VERSION, PLACE_GROUPING_VERSION, type DateBasis, type Scope, type PublicEntity, type PublicPoint } from '../src/domain/public.ts';
import { QueryError, parseSort, pageOf, type AnalyticsState, type ViewerCheck } from './publicHandler.ts';

interface Stat {
  side: 'all' | 'mine'; period: number; kind: string; k: string; focus: string; ord: number;
  label: [string | null, string, string | null, string | null];
  n: number; c: number; a: number; p: number; r: number; f: number; w: number; penalty: number;
  places: number; missing: number; answer_missing: number;
  duration: [number, number | null, number | null, number | null, number | null, number | null, number, number, number];
  amount: [number, number | null, number | null, number, number, number, number, number, number];
  rating: [number, number | null]; histogram: number[]; ratings: number[][];
}
export interface ScreenAggregate {
  encoding: 'screen-aggregate-v1'; stats: Stat[];
  anchors: [string, string, number, number, string, string | null][];
  full: [number, string, number, number, boolean][];
  vehicles: { identifiable: number; top: [string, number][]; days: number[]; excluded: [number, number] };
  source_min: string | null;
}
const empty: Stat = { side: 'all', period: 0, kind: '', k: '', focus: '', ord: 0, label: [null,'기관 정보 없음',null,null],
  n:0,c:0,a:0,p:0,r:0,f:0,w:0,penalty:0,places:0,missing:0,answer_missing:0,
  duration:[0,null,null,null,null,null,0,0,0],amount:[0,null,null,0,0,0,0,0,0],rating:[0,null],
  histogram:Array(13).fill(0),ratings:Array.from({length:6},()=>Array(5).fill(0)) };
const pct = (n: number, d: number) => d ? n * 100 / d : null;
const minus = (a: number | null, b: number | null) => a === null || b === null ? null : a-b;
const outcomes = (s: Stat) => ({ accepted:s.a,partial:s.p,rejected:s.r,result_known:s.a+s.p+s.r,result_unknown:s.c-s.a-s.p-s.r });
const rating = (s: Stat) => ({ count:s.rating[0],mean:s.rating[0] ? s.rating[1]!/s.rating[0] : null });
const briefDuration = (s: Stat) => ({ count:s.duration[0],median_days:s.duration[2],mean_days:s.duration[0] ? s.duration[1]!/s.duration[0] : null });
const briefAmount = (s: Stat) => ({ fine_count:s.f,confirmed_count:s.amount[0],sum_won:s.amount[1],mean_won:s.amount[0] ? s.amount[1]!/s.amount[0] : null });
const duration = (s: Stat,basis: DateBasis) => ({ basis,...briefDuration(s),p90_days:s.duration[3],min_days:s.duration[4],max_days:s.duration[5],
  excluded:{no_report_date:s.duration[6],reversed:s.duration[7],no_answer_date:s.duration[8]} });
const amount = (s: Stat,basis: DateBasis) => ({ basis,...briefAmount(s),median_won:s.amount[2],zero_count:s.amount[3],unconfirmed_count:s.amount[4],
  undisclosed_count:s.amount[5],conflict_count:s.amount[6],penalty_count:s.amount[7],combined_count:s.amount[8],partial:s.f>0 && s.amount[0]<s.f });
const diagnostics = (s: Stat,basis: DateBasis) => ({ date_basis:basis,selected_date_missing:0,other_date_missing:s.missing });
const distribution = (s: Stat,basis: DateBasis) => ({ basis,bucket_width_days:7,
  buckets:s.histogram.map((count,i)=>({ lower:i*7,upper:i===12?null:i*7+6,label:i===12?'84일 이상':`${i*7}~${i*7+6}일`,count,percentage:pct(count,s.duration[0]) })),
  valid_count:s.duration[0],excluded:{no_report_date:s.duration[6],reversed:s.duration[7]},median_days:s.duration[2],
  mean_days:briefDuration(s).mean_days,p90_days:s.duration[3] });
const ratingDistribution = (s: Stat,basis: DateBasis) => ({ basis,
  rows:s.ratings.map((counts,i)=>{ const n=counts.reduce((a,b)=>a+b,0);return {
    status:['all','accepted','partial','rejected','fine','unknown'][i],counts,rating_count:n,mean:n?counts.reduce((a,b,j)=>a+b*(j+1),0)/n:null }; }),
  unrated:s.c-s.rating[0] });

export class ScreenAggregates {
  private rows: Map<string, Stat[]> = new Map();
  constructor(readonly data: ScreenAggregate,readonly scope: Scope,readonly state: AnalyticsState) {
    if (data?.encoding !== 'screen-aggregate-v1' || !Array.isArray(data.stats) || !Array.isArray(data.anchors) || !Array.isArray(data.full) || !data.vehicles) {
      throw new Error('invalid aggregate encoding');
    }
    for (const s of data.stats) {
      const key=JSON.stringify([s.side,s.period,s.kind,s.focus]);
      const list=this.rows.get(key); if(list) list.push(s); else this.rows.set(key,[s]);
    }
  }
  private list(kind: string,side='all',period=0,focus='') { return this.rows.get(JSON.stringify([side,period,kind,focus])) ?? []; }
  private stat(kind='summary',side='all',period=0,focus='',key='') { return this.list(kind,side,period,focus).find(s=>s.k===key) ?? empty; }
  private common() { return { schema_version:2,dataset_version:this.state.dataset_version,sample:false,scope:this.scope,cohort_policy_version:COHORT_POLICY_VERSION }; }
  private window(fallback=true) {
    const w=basisWindow(this.scope.date_basis,{basisBounds:this.state.basis_bounds,dataMin:this.state.data_min,asOf:this.state.data_max || this.scope.end});
    return { ...w,min:w.min ?? (fallback ? this.data.source_min : null) };
  }
  private full(period=0,focus='') { return this.data.full.find(s=>s[0]===period && s[1]===focus) ?? [period,focus,0,0,false] as const; }
  overview(focus='') {
    const s=this.stat(focus?'focus':'summary','all',0,focus),p=this.stat(focus?'focus':'summary','all',1,focus);
    const basis=this.scope.date_basis,prev=previousWindow(this.scope.start,this.scope.end);
    const min=this.window().min,covered=min===null || prev.start>=min;
    const metric=(n:number,prior:number,missing=0,denominator:number|null=null)=>({value:n,basis,denominator,eligible:n,missing,previous:covered?prior:null,
      ...(covered?growth(n,prior):{delta:null,delta_percent:null,delta_reason:null,note:'비교기간 자료 없음'})});
    const D=s.a+s.p+s.r,priorD=p.a+p.p+p.r;
    return { report_count:metric(s.n,p.n),completed_count:metric(s.c,p.c,s.answer_missing,s.n),
      accepted_including_partial:{value:pct(s.a+s.p,D),basis,denominator:D,numerator:s.a+s.p,unit:'percent',eligible:D,missing:s.c-D,
        previous:covered?pct(p.a+p.p,priorD):null,delta:D&&priorD&&covered?pct(s.a+s.p,D)!-pct(p.a+p.p,priorD)!:null,
        delta_percent:null,delta_reason:!covered?null:priorD?null:D?'new':'no_baseline'},
      fine_count:metric(s.f,p.f,0,s.c),point_count:metric(s.places,p.places,0,s.n),
      contributor_count:metric(this.full(0,focus)[3],this.full(1,focus)[3],0,this.full(0,focus)[2]),outcomes:outcomes(s),
      processing_duration:{...duration(s,basis),answer_date_missing:s.duration[8]},fine_amount:amount(s,basis),rating:rating(s),warning_count:s.w,cohort:diagnostics(s,basis) };
  }
  entities(kind: 'agency'|'manager',focus=''): PublicEntity[] {
    const rows=this.list(kind,'all',0,focus).map(s=>({key:s.k,agency_key:s.label[0],manager_key:kind==='manager'?s.label[2]:null,
      agency_name:s.label[1],manager_name:kind==='manager'?s.label[3]:null,agency_type:agencyTypeOf(s.label[0],s.label[1]),
      completed_count:s.c,outcomes:outcomes(s),fine_count:s.f,warning_count:s.w,duration:briefDuration(s),fine_amount:briefAmount(s),rating:rating(s)}))
      .sort((a,b)=>b.completed_count-a.completed_count || a.agency_name.localeCompare(b.agency_name,'ko'));
    if(kind==='agency') return rows;
    const names=computeSameNames(rows);return rows.map(r=>({...r,same_name:names.get(r.key)??null}));
  }
  private laws() {
    return this.list('law').map(s=>({law:s.k||null,completed_count:s.c,outcomes:outcomes(s),accept_rate:pct(s.a,s.a+s.p+s.r),partial_rate:pct(s.p,s.a+s.p+s.r),
      fine_count:s.f,fine_rate:pct(s.f,s.c),penalty_count:s.penalty,warning_count:s.w,fine_amount:briefAmount(s),rating:rating(s)}))
      .sort((a,b)=>b.completed_count-a.completed_count || Number(a.law===null)-Number(b.law===null) || (a.law??'').localeCompare(b.law??'','ko'));
  }
  private regionLabel(s:Stat) {
    return {level:s.k.length===2?'sido' as const:s.k?'sgg' as const:'unknown' as const,region_code:s.k||null,
      name:s.k?regionName(s.k)??s.k:'지역 미확인',sido_code:s.k.length===5?s.k.slice(0,2):null};
  }
  private regions() {
    return this.list('region').map(s=>({...this.regionLabel(s),report_count:s.n,completed_count:s.c,outcomes:outcomes(s),fine_count:s.f,
      duration:briefDuration(s),fine_amount:briefAmount(s),rating:rating(s)})).sort(regionSort);
  }
  private anchor(side:string,key:string) { return this.data.anchors.find(a=>a[0]===side&&a[1]===key); }
  private place(s:Stat,anchor:ScreenAggregate['anchors'][number]):PublicPoint {
    return {key:s.k,place_key:s.k,grouping_version:PLACE_GROUPING_VERSION,lat:anchor[2],lng:anchor[3],address:anchor[4],region_code:anchor[5],
      report_count:s.n,completed_count:s.c,outcomes:outcomes(s),fine_count:s.f,warning_count:s.w};
  }
  private places():PublicPoint[] {
    return this.list('place').flatMap(s=>{const a=this.anchor('all',s.k);return a?[this.place(s,a)]:[];})
      .sort((a,b)=>b.report_count-a.report_count || b.completed_count!-a.completed_count! || a.key.localeCompare(b.key));
  }
  private unplaced() {
    const result={no_address:{reported:0,completed:0},no_coordinates:{reported:0,completed:0}};
    for(const s of this.list('place')) {
      const target=!s.k?result.no_address:!this.anchor('all',s.k)?result.no_coordinates:null;
      if(target) {target.reported+=s.n;target.completed+=s.c;}
    }
    return result;
  }
  private monthly() {
    return monthSpine(this.scope,this.window(),todayKst()).map(slot=>{
      const {no_data,...fields}=slot,frame={...fields,partial:slot.range_partial||slot.in_progress};
      if(no_data) return {...frame,report_count:null,completed_count:null,fine_count:null,outcomes:null,duration:null,fine_amount:null};
      const s=this.stat('month','all',0,'',slot.month);
      return {...frame,report_count:s.n,completed_count:s.c,fine_count:s.f,outcomes:outcomes(s),duration:briefDuration(s),fine_amount:briefAmount(s),rating:rating(s)};
    });
  }
  private scatter() {
    const rows=(kind:string)=>this.list(kind).map(s=>({key:s.k,agency_key:s.label[0],manager_key:kind==='manager'?s.label[2]:null,
      agency_name:s.label[1],manager_name:kind==='manager'?s.label[3]:null,completed_count:s.c,duration_count:s.duration[0],median_days:s.duration[2],
      outcomes:outcomes(s),fine_count:s.f})).sort((a,b)=>b.completed_count-a.completed_count || a.agency_name.localeCompare(b.agency_name,'ko') || a.key.localeCompare(b.key));
    const agencies=rows('agency'),managers=rows('manager');return {agencies:agencies.slice(0,500),managers:managers.slice(0,500),agency_total:agencies.length,manager_total:managers.length};
  }
  private heatmap() {
    // Cell order follows the first occurrence of each law inside each entity, as in the raw aggregator.
    const cells=[...this.rows.values()].flat().filter(s=>s.kind==='heat').sort((a,b)=>a.ord-b.ord);
    const rows=new Map<string,{s:Stat,n:number}>(),laws=new Map<string,number>();
    for(const s of cells){const r=rows.get(s.k);if(r)r.n+=s.c;else rows.set(s.k,{s,n:s.c});laws.set(s.focus,(laws.get(s.focus)??0)+s.c);}
    const rowList=[...rows].sort((a,b)=>b[1].n-a[1].n||a[1].s.label[1].localeCompare(b[1].s.label[1],'ko')||a[0].localeCompare(b[0])).slice(0,40);
    const lawList=[...laws].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'ko')).slice(0,16),lawSet=new Set(lawList.map(s=>s[0]));
    const manager=this.scope.agency_key!==null;
    return {row_kind:manager?'manager':'agency',rows:rowList.map(([key,{s,n}])=>({key,agency_key:s.label[0],manager_key:manager?s.label[2]:null,
      agency_name:s.label[1],manager_name:manager?s.label[3]:null,completed_count:n})),laws:lawList.map(([law_key,completed_count])=>({law_key,completed_count})),
      cells:rowList.flatMap(([key])=>cells.filter(s=>s.k===key&&lawSet.has(s.focus)).map(s=>({row_key:key,law_key:s.focus,completed_count:s.c,outcomes:outcomes(s),fine_count:s.f}))),
      total_rows:rows.size,total_laws:laws.size};
  }
  private vehicleDays() {
    const counts=this.data.vehicles.days,n=counts.reduce((a,b)=>a+b,0),repeat=n-counts[0];
    return {basis:this.scope.date_basis,buckets:[{label:'1일',min:1,max:1},{label:'2일',min:2,max:2},{label:'3~4일',min:3,max:4},{label:'5일 이상',min:5,max:null}]
      .map((b,i)=>({...b,vehicle_count:counts[i],percentage:pct(counts[i],n)})),vehicle_count:n,repeat_vehicle_count:repeat,repeat_share:pct(repeat,n),
      excluded:{no_plate:this.data.vehicles.excluded[0],no_report_date:this.data.vehicles.excluded[1]}};
  }
  dashboard() {
    const s=this.stat(),agencies=this.entities('agency'),managers=this.entities('manager'),unplaced=this.unplaced();
    return {...this.common(),location_missing:unplaced.no_address.reported+unplaced.no_coordinates.reported,overview:this.overview(),points:mapNodes(this.places()),
      monthly:this.monthly(),agencies:agencies.slice(0,100),managers:managers.slice(0,100),agency_total:agencies.length,manager_total:managers.length,
      regions:this.regions().slice(0,400),laws:this.laws().slice(0,300),vehicles:this.data.vehicles.top.map(([plate,n],i)=>({rank:i+1,rank_item_id:`r${i+1}`,
        masked_plate:plate,report_count:n,percentage:pct(n,s.n)})),vehicle_total_scope_reports:s.n,vehicle_identifiable_reports:this.data.vehicles.identifiable,
      analytics:{duration:distribution(s,this.scope.date_basis),heatmap:this.heatmap(),scatter:this.scatter(),vehicle_days:this.vehicleDays(),rating:ratingDistribution(s,this.scope.date_basis)},map_unplaced:unplaced};
  }
  read(route:string,params:URLSearchParams) {
    const common=this.common();
    if(route==='dashboard') return this.dashboard();
    if(route==='entities'||route==='laws') {
      const {page,pageSize}=pageOf(params),sort=parseSort(params),raw=params.get('q')??'';
      if(raw.length>160)throw new QueryError('INVALID_QUERY',400);
      const q=raw.trim(),type=params.get('agency_type');
      if(route==='laws') {
        let rows=this.laws();if(q)rows=rows.filter(r=>(r.law??'법규 미상').includes(q));
        rows.sort(compareRows(sort,r=>r.law??'법규 미상',r=>r.law??'\uffff'));
        return {...common,sort,items:rows.slice((page-1)*pageSize,page*pageSize),total_rows:rows.length,page,page_size:pageSize};
      }
      let rows=this.entities(params.get('kind')==='manager'?'manager':'agency');
      if(type)rows=rows.filter(r=>r.agency_type===type);
      if(q)rows=rows.filter(r=>r.agency_name.includes(q)||(r.manager_name??'').includes(q));
      rows.sort(compareRows(sort,r=>`${r.agency_name}\u0000${r.manager_name??''}`,r=>r.key));
      return {...common,sort,items:rows.slice((page-1)*pageSize,page*pageSize),total_rows:rows.length,page,page_size:pageSize};
    }
    if(route==='places') {
      const box=params.get('view_bbox')!.split(',').map(Number) as [number,number,number,number];
      const places=placesInView(this.places(),box),nodes=mapNodes(places);
      return {...common,view_bbox:box,points:nodes,total_places:places.length,compacted:nodes.length<places.length};
    }
    if(route.startsWith('places/')) {
      const key=route.slice(7),s=this.stat('place','all',0,'',key),a=this.anchor('focus',key);
      if(!a)throw new QueryError('NOT_FOUND',404);
      const n=Number(params.get('entity_limit')??100),agencies=this.entities('agency',key),managers=this.entities('manager',key);
      return {...common,place:this.place(s,a),overview:this.overview(key),agencies:agencies.slice(0,n),managers:managers.slice(0,n),agency_total:agencies.length,manager_total:managers.length};
    }
    throw new Error('unsupported screen route');
  }
  compare(viewer:ViewerCheck) {
    const allStat=this.stat(),mineStat=this.stat('summary','mine'),basis=this.scope.date_basis;
    const all=summary(allStat),mine=summary(mineStat);
    const regions=new Map<string,Stat>();for(const s of [...this.list('region'),...this.list('region','mine')])if(!regions.has(s.k))regions.set(s.k,s);
    const regionRows=[...regions.values()].map(s=>{
      const a=side(this.stat('region','all',0,'',s.k)),m=side(this.stat('region','mine',0,'',s.k));
      return {...this.regionLabel(s),all:a,mine:m,accept_rate_pp:minus(m.accept_rate,a.accept_rate),partial_rate_pp:minus(m.partial_rate,a.partial_rate),duration_median_days_diff:minus(m.duration_median_days,a.duration_median_days)};
    }).sort((a,b)=>regionSort({...a,report_count:a.all.report_count,completed_count:a.all.completed_count},{...b,report_count:b.all.report_count,completed_count:b.all.completed_count})).slice(0,300);
    const entities=(kind:'agency'|'manager')=>this.list(kind,'mine').map(s=>{
      const full=this.stat(kind,'all',0,'',s.k),first=full===empty?s:full,a=side(full,true),m=side(s,true);
      return {kind,key:s.k,agency_key:first.label[0],manager_key:kind==='manager'?first.label[2]:null,agency_name:first.label[1],manager_name:kind==='manager'?first.label[3]:null,
        all:a,mine:m,accept_rate_pp:minus(m.accept_rate,a.accept_rate),partial_rate_pp:minus(m.partial_rate,a.partial_rate),duration_median_days_diff:minus(m.duration_median_days,a.duration_median_days)};
    }).sort((a,b)=>b.mine.completed_count-a.mine.completed_count||b.all.completed_count-a.all.completed_count||a.agency_name.localeCompare(b.agency_name,'ko')||a.key.localeCompare(b.key)).slice(0,50);
    const monthly=monthSpine(this.scope,this.window(false),todayKst()).map(({month,no_data})=>{
      if(no_data)return {month,all_report_count:null,mine_report_count:null,all_completed_count:null,mine_completed_count:null,all_accept_rate:null,mine_accept_rate:null,
        all_duration_median_days:null,mine_duration_median_days:null,mine_outcomes:null,mine_fine_count:null};
      const a=this.stat('month','all',0,'',month),m=this.stat('month','mine',0,'',month);
      return {month,all_report_count:a.n,mine_report_count:m.n,all_completed_count:a.c,mine_completed_count:m.c,all_accept_rate:pct(a.a,a.a+a.p+a.r),mine_accept_rate:pct(m.a,m.a+m.p+m.r),
        all_duration_median_days:a.duration[2],mine_duration_median_days:m.duration[2],all_rating:rating(a),mine_rating:rating(m),mine_outcomes:outcomes(m),mine_fine_count:m.f};
    });
    const my_points=this.list('place','mine').flatMap(s=>{const a=this.anchor('all',s.k)??this.anchor('mine',s.k);return a?[{key:s.k,lat:a[2],lng:a[3],region_code:a[5],
      mine_report_count:s.n,mine_completed_count:s.c,shared:this.full(0,s.k)[4]}]:[];}).sort((a,b)=>b.mine_report_count-a.mine_report_count||a.key.localeCompare(b.key)).slice(0,1000);
    return {schema_version:2,dataset_version:this.state.dataset_version,scope:this.scope,viewer:{contributor:viewer.contributor,has_public_facts:viewer.has_public_facts},
      cohort_policy_version:COHORT_POLICY_VERSION,cohort:{all:diagnostics(allStat,basis),mine:diagnostics(mineStat,basis)},all,mine,diff:diffOf(all,mine),regions:regionRows,
      agencies:entities('agency'),managers:entities('manager'),monthly,my_points,
      analytics:{duration:distribution(mineStat,'completed_date'),rating:ratingDistribution(mineStat,'completed_date')}};
  }
}
function regionSort(a:{level:'sido'|'sgg'|'unknown';report_count:number;completed_count:number;region_code:string|null},b:typeof a) {
  const order={sido:0,sgg:1,unknown:2};return order[a.level]-order[b.level]||b.report_count-a.report_count||b.completed_count-a.completed_count||(a.region_code??'').localeCompare(b.region_code??'');
}
function summary(s:Stat) {
  const o=outcomes(s),d=duration(s,'completed_date'),a=amount(s,'completed_date');
  return {report_count:s.n,completed_count:s.c,...o,fine_count:s.f,point_count:s.places,accept_rate:pct(s.a,o.result_known),partial_rate:pct(s.p,o.result_known),
    reject_rate:pct(s.r,o.result_known),fine_rate:pct(s.f,s.c),duration:{count:d.count,mean_days:d.mean_days,median_days:d.median_days,p90_days:d.p90_days},
    fine_amount:{fine_count:a.fine_count,confirmed_count:a.confirmed_count,sum_won:a.sum_won,mean_won:a.mean_won,median_won:a.median_won,unconfirmed_count:a.unconfirmed_count,undisclosed_count:a.undisclosed_count,partial:a.partial},rating:rating(s)};
}
function side(s:Stat,entity=false) {
  const o=outcomes(s);return {report_count:entity?0:s.n,completed_count:s.c,result_known:o.result_known,accepted:s.a,partial:s.p,rejected:s.r,fine_count:s.f,
    accept_rate:pct(s.a,o.result_known),partial_rate:pct(s.p,o.result_known),duration_count:s.duration[0],duration_median_days:s.duration[2],
    fine_amount_confirmed_count:s.amount[0],fine_amount_sum_won:s.amount[1],rating:rating(s)};
}
