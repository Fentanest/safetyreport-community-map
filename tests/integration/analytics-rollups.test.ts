// Real local PostgreSQL + GoTrue sessions; observations and OAuth identity labels are synthetic.
import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import { entityRows,lawRows,representatives,selectScope,seriesOf,todayKst,type PrivateFact } from '../../server/aggregate';
import { rollupMonths,type RollupKind } from '../../server/rollups';
import { parseRollup } from '../../server/rollupSchema';
import { SORT_COLUMNS,compareRows,type SortSpec } from '../../src/domain/tableSort';
import { lawKey,type PublicEntity,type PublicLaw,type Scope } from '../../src/domain/public';
import { resolveRegion } from '../../server/regions';
import { createUser,deleteUsers,insertFacts,lit,serviceClient,sql,stackKeys,type TestUser,type Fact } from './helpers/myReportsSeed';
const users:TestUser[]=[];
const scope:Scope={date_basis:'completed_date',start:'2040-09-01',end:'2040-09-30',category:'all',region_code:null,agency_key:null,manager_key:null,bbox:null,law:null};
const window={min:'2025-01-01',max:'2040-12-31'};
function facts(s:Scope):PrivateFact[]{return JSON.parse(sql(`select public.internal_analytics_cohort_facts(${lit(s.date_basis)},${lit(s.start)},${lit(s.end)},false,${lit(s.category)},null,${lit(s.agency_key)},${lit(s.manager_key)},${s.bbox?`array[${s.bbox.join(',')}]::double precision[]`:'null'})`));}
function rollup(s:Scope,kind:RollupKind,extra:Record<string,unknown>={}){
 const version=JSON.parse(sql('select public.internal_analytics_cohort_state()')).dataset_version;
 return parseRollup(kind,JSON.parse(sql(`select public.internal_analytics_rollup(${lit(JSON.stringify(s))}::jsonb,${lit(kind)},${lit(JSON.stringify({page:1,page_size:100,q:'',sort:{column:'completed',value:'count',dir:'desc'},agency_type:null,expected_version:version,...extra}))}::jsonb)`)));
}
function row(user:TestUser,key:string,patch:Partial<Fact>={}):Fact{return {user,key,dataset:'pc',sourceId:'9100000001',reportDate:'2040-08-31',completedDate:'2040-09-01',agencyKey:'a1',agencyName:'서울중구청',managerKey:'m1',managerName:'김예시',...patch};}
describe.skipIf(process.env.COMMUNITY_STACK!=='1')('DB rollup equivalence and private boundary',()=>{
 beforeAll(async()=>{
  const keys=stackKeys(),svc=serviceClient(keys);
  for(const label of ['rollup-a','rollup-b','rollup-c'])users.push(await createUser(svc,keys.ANON_KEY,label));
  const [a,b,c]=users;
  insertFacts([
   ...Array.from({length:10},(_,i)=>row(a,'rollup-gate-'+i,{completedDate:'2025-01-01',reportDate:'2025-01-01'})),
   row(a,'zero',{status:'accepted',disposition:'fine',amountKind:'fine',amount:0,rating:5,law:'도로교통법 제05조 1항'}),
   row(a,'partial',{status:'partial',disposition:'fine',amountKind:'fine',amount:40000,rating:1,law:'도로교통법 제5조2항'}),
   row(a,'rejected',{status:'rejected',disposition:'warning'}),
   row(a,'unknown',{status:'completed_unknown'}),
   row(a,'null-report',{reportDate:null,agencyKey:'a2',agencyName:'서울예시경찰서',managerKey:'m2',disposition:'fine',amountKind:'fine',amount:0}),
   row(a,'reversed',{reportDate:'2040-10-01',agencyKey:'a2',agencyName:'서울예시경찰서',managerKey:'m2'}),
   row(a,'same-day',{reportDate:'2040-09-01',agencyKey:'a3',agencyName:'이름 미상',managerKey:null,managerName:null,category:'traffic'}),
   row(a,'null-answer',{completedDate:null,reportDate:'2040-09-01',agencyKey:null,agencyName:null}),
   row(a,'duplicate',{status:'partial',disposition:'fine',payload:'same'}),row(a,'duplicate',{dataset:'mobile',status:'partial',disposition:'fine',payload:'same'}),
   row(b,'duplicate',{status:'rejected',answerAt:'2040-10-01T00:00:00Z'}),
   row(a,'moved',{category:'traffic',completedDate:'2040-08-31',answerAt:'2040-08-31T00:00:00Z',payload:'old'}),
   row(b,'moved',{category:'parking',completedDate:'2040-10-01',answerAt:'2040-10-01T00:00:00Z',payload:'new'}),
   row(c,'numbered',{number:'SPP-2609-00000001',dataset:'pc'}),row(c,'numbered',{number:null,dataset:'mobile'}),
   row(c,'numbered',{number:'SPP-2609-00000002',dataset:'restored',status:'rejected'}),
  ]);
  sql(`update private.community_report_facts set region_code=case agency_key when 'a1' then '서울 중구' when 'a2' then '인천 남구' else '미확인' end where contributor_id in (${users.map(u=>lit(u.id)).join(',')})`);
 },60000);
 afterAll(()=>deleteUsers(users),60000);
 it('oracle and old RPC agree; SQL aggregation/sort/page/type/search and full namesakes match every JS sort',()=>{
  for(const basis of ['completed_date','report_date'] as const){
   const s={...scope,date_basis:basis};const selected=selectScope(representatives(facts(s)),s);
   if(basis==='completed_date'){
    expect(selected.cohort).toHaveLength(10); // zero,partial,rejected,unknown,null-report,reversed,same-day,duplicate,A-1,A-2
    expect(selected.done.filter(f=>f.status==='partial')).toHaveLength(1); // newer b's rejected duplicate wins globally
    expect(selected.cohort.some(f=>f.source_report_key?.includes('moved'))).toBe(false);
   }
   for(const kind of ['agency','manager','laws'] as const){
    const original=kind==='laws'?lawRows(selected.done):entityRows(selected.done,kind);
    for(const [column,def] of Object.entries(SORT_COLUMNS))for(const value of def.values)for(const dir of ['asc','desc'] as const){
     const sort:SortSpec={column,value,dir};
     const sorted=kind==='laws'?[...original as PublicLaw[]].sort(compareRows(sort,r=>r.law??'법규 미상',r=>r.law??'\uffff'))
       :[...original as PublicEntity[]].sort(compareRows(sort,r=>`${r.agency_name}\u0000${r.manager_name??''}`,r=>r.key));
     const actual=rollup(s,kind,{sort,page:2,page_size:1});
     expect(actual.total_rows,JSON.stringify({basis,kind,sort})).toBe(original.length);
     expect(actual.items,JSON.stringify({basis,kind,sort})).toEqual(sorted.slice(1,2));
    }
   }
   expect(rollupMonths(rollup(s,'series'),s,window,todayKst())).toEqual(seriesOf(selected,s,window,todayKst()));
   const managers=entityRows(selected.done,'manager');
   expect(rollup(s,'manager',{q:'경찰',agency_type:'police'}).items).toEqual(managers.filter(x=>x.agency_type==='police'&&x.agency_name.includes('경찰')));
  }
 },120000);
 it('selected date/category/parent-region/law/bbox preserve the elected representative and current region',()=>{
  for(const patch of [{category:'traffic'},{region_code:'11'},{region_code:'28'},{region_code:'28177'},{law:'도로교통법 제005조2항'},{law:'__none__'},{bbox:[126,37,128,38]}] as Partial<Scope>[]){
   const s={...scope,...patch},sel=selectScope(representatives(facts(s)),s);
   expect(rollup(s,'agency').items).toEqual(entityRows(sel.done,'agency'));
  }
  const s={...scope,start:'2040-08-01',end:'2040-08-31',category:'traffic' as const};
  expect(rollup(s,'agency').total_rows).toBe(0); // latest moved representative is October parking, never resurrect August traffic
 });
 it('SQL region and law classifiers match JS including split/hole, rename, unknown, article/paragraph and zeros',()=>{
  const regions:[string|null,number|null,number|null][]=[['서울 중구',null,null],['인천 남구',null,null],['충북 청원군',null,null],['경북 군위군',null,null],['세종 나성동',null,null],['전남 무안군',null,null],['인천 중구',null,null],['인천 서구',37.5,126.6],['인천 중구',37.49,126.55],[null,null,null],['unknown',37,127]];
  for(const [key,lat,lng]of regions)expect(sql(`select coalesce(private.analytics_region(${lit(key)},${lit(lat)},${lit(lng)}),'NULL')`)).toBe(resolveRegion(key,lat,lng)?.sgg??'NULL');
  for(const raw of [null,'','  ','도로 교통법 제0005조 제2항','도로교통법 제05조의02 제2항','예시','도로교통법 제0조','도로교통법 제000조'])
   expect(sql(`select coalesce(private.analytics_law(${lit(raw)}),'NULL')`)).toBe(lawKey(raw)??'NULL');
 });
 it('anon/authenticated cannot execute the service-only aggregate or private helpers; stale version fails closed',()=>{
  expect(sql("select has_function_privilege('anon','public.internal_analytics_rollup(jsonb,text,jsonb)','execute') or has_function_privilege('authenticated','public.internal_analytics_rollup(jsonb,text,jsonb)','execute')")).toBe('f');
  expect(()=>rollup(scope,'agency',{expected_version:'stale'})).toThrow(/DATASET_CHANGED/);
 });
 it('withdrawal, suspension and account deletion take effect on the next live aggregate',()=>{
  const [a,b,c]=users;
  sql(`update private.community_consent_grants set revoked_at=now() where user_id='${b.id}'`);
  expect(rollup(scope,'agency').items).toEqual(entityRows(selectScope(representatives(facts(scope)),scope).done,'agency'));
  sql(`update private.contributor_profiles set status='suspended' where user_id='${c.id}'`);
  expect(rollup(scope,'agency').items).toEqual(entityRows(selectScope(representatives(facts(scope)),scope).done,'agency'));
  sql(`update auth.users set deleted_at=now() where id='${b.id}'`);
  expect(rollup(scope,'agency').items).toEqual(entityRows(selectScope(representatives(facts(scope)),scope).done,'agency'));
  expect(a.id).toBeTruthy();
 });
});
