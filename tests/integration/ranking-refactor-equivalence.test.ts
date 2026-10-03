// Same transaction snapshot: compare original and candidate SQL, including their exact version hashes.
import { beforeAll,afterAll,describe,it,expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createUser,deleteUsers,insertFacts,lit,serviceClient,sql,stackKeys,type TestUser,type Fact } from './helpers/myReportsSeed';
import { querySchema } from '../../contracts/user-rankings/types';
const users:TestUser[]=[];
const read=(path:string)=>readFileSync(path,'utf8').replace(/^begin;\s*$/gm,'').replace(/^commit;\s*$/gm,'');
const f=(user:TestUser,key:string,extra:Partial<Fact>={}):Fact=>({user,key,dataset:'pc',sourceId:'9100000001',reportDate:'2040-09-01',completedDate:'2040-09-30',...extra});
describe.skipIf(process.env.COMMUNITY_STACK!=='1')('ranking refactor exact SQL equivalence',()=>{
 beforeAll(async()=>{
  const keys=stackKeys(),svc=serviceClient(keys);
  for(const label of ['ranking-differential-a','ranking-differential-b','ranking-differential-c'])users.push(await createUser(svc,keys.ANON_KEY,label));
  const[a,b,c]=users;
  insertFacts([...Array.from({length:10},(_,i)=>f(a,'rank-gate-'+i,{completedDate:'2025-01-01'})),
   f(a,'rank-number',{number:'SPP-2609-00000001',payload:'same',status:'partial',disposition:'fine'}),
   f(a,'rank-number',{number:null,dataset:'mobile',payload:'same',status:'partial',disposition:'fine'}),
   f(a,'rank-number',{number:'SPP-2609-00000001',dataset:'restored',payload:'same',status:'partial',disposition:'fine'}),
   f(a,'rank-rej',{status:'rejected',disposition:'fine'}),f(a,'rank-unknown',{status:'completed_unknown'}),
   f(b,'rank-number',{number:'SPP-2609-00000001',status:'rejected',answerAt:'2040-10-01T00:00:00Z'}),
   f(a,'rank-moved',{completedDate:'2040-08-31',category:'traffic',answerAt:'2040-08-31T00:00:00Z',payload:'old'}),
   f(a,'rank-moved',{completedDate:'2040-10-01',category:'parking',dataset:'mobile',answerAt:'2040-10-01T00:00:00Z',payload:'new'}),
   f(a,'rank-missing',{completedDate:null}),
   f(b,'rank-fine',{disposition:'fine'}),
   ...Array.from({length:6},(_,i)=>f(c,'rank-c-'+i,{disposition:i<3?'fine':'warning'}))]);
 },60000);
 afterAll(()=>deleteUsers(users),60000);
 it('all theme/metric/date/period/minimum/page combinations preserve election, diagnostics, global me, rank and version',()=>{
  const [a,b,c]=users;
  // Freeze the actual original bodies: this stays a before/after oracle even after the candidate is installed.
  const clone=read('supabase/migrations/202610030100_user_rankings.sql').match(/create function private\.ranking_representatives[\s\S]*?\$\$;/)![0]
   .replace('create function', 'create or replace function').replace('private.ranking_representatives()', 'private.ranking_representatives_before_refactor()');
  const old=read('supabase/migrations/202610030200_user_ranking_periods.sql').match(/create or replace function public\.internal_user_rankings[\s\S]*?\$\$;/)![0]
   .replace('public.internal_user_rankings(', 'private.user_rankings_before_refactor(').replace('private.ranking_representatives()', 'private.ranking_representatives_before_refactor()');
  const cases=[];
  for(const [theme,metric] of [['reporters','reports_count'],['fines','fine_count'],['fines','fine_rate'],['unlucky','rejected_count'],['unlucky','rejected_rate'],['unlucky','partial_count'],['unlucky','partial_rate']] as const)
   for(const date_basis of ['completed_date','report_date'] as const)for(const period of ['all','month','range'] as const)
    for(const min_reports of [1,3,100])cases.push(querySchema.parse({theme,metric,date_basis,period,min_reports,page_size:1,...(period==='month'?{month:'2040-09'}:period==='range'?{start:'2040-09-01',end:'2040-09-30'}:{})}));
  const compare=(q:unknown)=>`select jsonb_build_object('before',private.user_rankings_before_refactor('${a.id}','${a.session}',${lit(JSON.stringify(q))}::jsonb),'after',public.internal_user_rankings('${a.id}','${a.session}',${lit(JSON.stringify(q))}::jsonb));`;
  const mutations=[`update private.community_consent_grants set revoked_at=now() where user_id='${b.id}';`,
   `update private.contributor_profiles set status='suspended' where user_id='${c.id}';`,
   `update auth.users set deleted_at=now() where id='${b.id}';`,
   `update private.community_consent_grants set revoked_at=null where user_id='${b.id}';`];
  const sample=querySchema.parse({theme:'fines',metric:'fine_rate',period:'month',month:'2040-09',page_size:1});
  const paged=`with v as (select private.user_rankings_before_refactor('${a.id}','${a.session}',${lit(JSON.stringify(sample))}::jsonb) r)
   select jsonb_build_object('before',private.user_rankings_before_refactor('${a.id}','${a.session}',${lit(JSON.stringify({...sample,page:2}))}::jsonb||jsonb_build_object('expected_version',r->>'dataset_version')),
    'after',public.internal_user_rankings('${a.id}','${a.session}',${lit(JSON.stringify({...sample,page:2}))}::jsonb||jsonb_build_object('expected_version',r->>'dataset_version'))) from v;`;
  const result=sql('begin;\n'+clone+';\n'+old+';\n'+read(process.env.RANKINGS_CANDIDATE_SQL??'supabase/migrations/202610040700_ranking_binary_sort.sql')+'\n'+read('supabase/migrations/202610040200_ranking_grouped_diagnostics.sql')+'\n'+
   "select to_jsonb(t) from (select count(*) as mismatches from ((select * from private.ranking_representatives_before_refactor() except select * from private.ranking_representatives()) union all (select * from private.ranking_representatives() except select * from private.ranking_representatives_before_refactor())) s) t;\n"+
   cases.map(compare).join('\n')+'\n'+paged+'\n'+mutations.map(m=>m+compare(sample)).join('\n')+'\nrollback;');
  const rows=result.split('\n').filter(line=>line.startsWith('{')).map(line=>JSON.parse(line));
  expect(rows[0]).toEqual({mismatches:0});
  for(let i=1;i<rows.length;i++)expect(rows[i].after,`comparison ${i}: ${JSON.stringify(cases[i-1]??'page/lifecycle')}`).toEqual(rows[i].before);
  expect(rows.length).toBe(1+cases.length+1+mutations.length);
  const fine=rows[cases.findIndex(q=>q.theme==='fines'&&q.metric==='fine_rate'&&q.date_basis==='completed_date'&&q.period==='month'&&q.min_reports===1)+1].after;
  expect(fine.me).toMatchObject({reports:3,fine:1,rejected:1,completed_unknown:1,rank:3,numerator:1,denominator:3});
  expect(fine.rows[0]).toMatchObject({rank:1,tie_count:2});
 },120000);
});
