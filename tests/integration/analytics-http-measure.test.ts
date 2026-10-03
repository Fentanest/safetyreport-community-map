// Real local Deno entrypoints + GoTrue + PostgREST + live SQL/rate checks over synthetic reports.
// Two gateways run the frozen original and candidate public-analytics code against the SAME local database.
import { describe,it,expect } from 'vitest';
import { mkdirSync,writeFileSync } from 'node:fs';
import { createUser,deleteUsers,insertFacts,serviceClient,stackKeys,type TestUser } from './helpers/myReportsSeed';
const enabled=process.env.COMMUNITY_STACK==='1'&&process.env.HTTP_PERF==='1';
describe.skipIf(!enabled)('public analytics normal local HTTP measurements',()=>{
 it('records 30 genuine authenticated/rate-limited requests per route/code version with exact body equality',async()=>{
  const out=process.env.HTTP_PERF_OUT??'docs/refactoring/map-performance/evidence/http';mkdirSync(out,{recursive:true});
  const concurrency=Number(process.env.HTTP_CONCURRENCY??1);if(![1,3,5].includes(concurrency))throw new Error('supported concurrency 1/3/5');
  const users:TestUser[]=[];const results:unknown[]=[];
  const save=()=>writeFileSync(`${out}/measurements.json`,JSON.stringify({mode:'local Deno CLI, real GoTrue/PostgREST/RPC/rate gates; synthetic identities/reports; not hosted Edge, OAuth or production',size:500,concurrency,normal_repeats_per_user:30,original_viewer_state_aliases:process.env.HTTP_FROZEN_GATES==='1',results},null,2));
  try{
   const keys=stackKeys(),svc=serviceClient(keys);
   for(let u=0;u<3*concurrency;u++)users.push(await createUser(svc,keys.ANON_KEY,'http-'+u));
   insertFacts(users.flatMap((user,u)=>Array.from({length:u===0?500:10},(_,i)=>({user,dataset:'pc',key:`http-perf-${u}-${i}`,sourceId:'9100000001',reportDate:u===0?'2042-01-01':'2025-01-01',completedDate:u===0?'2042-09-30':'2025-01-01',agencyKey:`agency-${i%100}`,agencyName:`합성 기관 ${i%100}`,managerKey:`manager-${i%500}`,managerName:`합성 담당 ${i%500}`,law:`합성법 제${1+i%10}조`,status:(i%4===0?'partial':i%4===1?'rejected':i%4===2?'completed_unknown':'accepted') as 'partial'|'rejected'|'completed_unknown'|'accepted',disposition:i%4===0?'fine':'warning'}))));
   for(const [u,route]of ['entities?kind=manager&','laws?','series?'].entries()){
    let oracle:unknown=null;
    for(const [variant,origin]of [['before',process.env.HTTP_BEFORE_ORIGIN??'http://127.0.0.1:57098'],['after',process.env.HTTP_AFTER_ORIGIN??'http://127.0.0.1:57099']]){
     const samples=[];
     for(let i=0;i<30;i++){
      await Promise.all(Array.from({length:concurrency},async(_,participant)=>{const start=performance.now();const r=await fetch(`${origin}/functions/v1/public-analytics/${route}start=2042-01-01&end=2042-12-31&category=all&date_basis=completed_date${route.startsWith('series')?'':'&page_size=100'}`,{headers:{Authorization:`Bearer ${users[u*concurrency+participant].token}`}});
      const text=await r.text();const ms=performance.now()-start; samples.push({ms,status:r.status,bytes:Buffer.byteLength(text),participant});
      const body=JSON.parse(text); if(r.status!==200){results.push({variant,route,samples,failure:true,code:body.error??body.code});save();}expect(r.status,text).toBe(200);
      const stable={...body};delete stable.generated_at;
      if(oracle===null)oracle=stable;else expect(stable,`${variant} ${route} sample${i}`).toEqual(oracle);
      expect(r.headers.get('cache-control')).toMatch(/no-store/); }));
     }
     const ordered=samples.map(s=>s.ms).sort((a,b)=>a-b);
     results.push({variant,route,requests:samples.length,p50_ms:ordered[Math.ceil(ordered.length*.5)-1],p95_ms:ordered[Math.ceil(ordered.length*.95)-1],bytes:samples[0].bytes,failure_rate:samples.filter(s=>s.status!==200).length/(30*concurrency),samples});save();
    }
   }
  }finally{deleteUsers(users);}
 },600000);
});
