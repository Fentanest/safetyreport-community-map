// Explicit invented ranking DTOs for UI/ordering/race review only. This never proves SQL/auth/production correctness.
import { createHash } from 'node:crypto';
import { E2E_UID } from './harness.mjs';
export function rankingFixture(query, viewer=E2E_UID) {
 const period=query.get('period')||'all',month=period==='month'?(query.get('month')||'2026-10'):null;
 const metric=query.get('metric')||'reports_count', theme=query.get('theme')||'reporters';
 const start=period==='range'?query.get('start'):month?`${month}-01`:null;
 const end=period==='range'?query.get('end'):month?new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).toISOString().slice(0,10):null;
 const scope={theme,metric,period,start,end,month,date_basis:query.get('date_basis')||'completed_date',category:query.get('category')||'all',min_reports:Number(query.get('min_reports')||1),timezone:'Asia/Seoul',in_progress:month==='2026-10'};
 let rows=Array.from({length:26},(_,i)=>{
  const reports=month?1:53-i, fine=month?Number(i%2===0):Math.floor(reports*(26-i)/30),rejected=month?Number(i%2!==0):Math.floor(reports*(i%5)/10),partial=month?Number(i%2===0):Math.floor(reports/4);
  const numerator=metric==='reports_count'?reports:metric.startsWith('fine')?fine:metric.startsWith('partial')?partial:rejected;
  return {uuid:i===0?viewer:`${(i+1).toString(16).padStart(8,'0')}-2222-4333-8444-${(i+1).toString(16).padStart(12,'0')}`,rank:1,tie_count:1,reports,fine,rejected,partial,completed_unknown:0,numerator,denominator:reports,value:metric.endsWith('_rate')?numerator*100/reports:numerator,is_me:i===0};
 }).filter(r=>r.reports>=scope.min_reports);
 if(month==='2020-01'||start==='2020-01-01')rows=[];
 rows.sort((a,b)=>metric.endsWith('_rate')?(b.numerator*a.denominator-a.numerator*b.denominator)||b.reports-a.reports||a.uuid.localeCompare(b.uuid):b.numerator-a.numerator||b.reports-a.reports||a.uuid.localeCompare(b.uuid));
 rows.forEach((row,i)=>{const equals=r=>metric.endsWith('_rate')?r.numerator*row.denominator===row.numerator*r.denominator:r.numerator===row.numerator;row.rank=rows.findIndex(equals)+1;row.tie_count=rows.filter(equals).length;});
 const size=Number(query.get('page_size')||20),page=Number(query.get('page')||1);
 return {schema_version:'user-rankings-v1',cohort_policy_version:'single-date-v1',dataset_version:createHash('md5').update(JSON.stringify(scope)+size).digest('hex'),generated_at:new Date().toISOString(),scope,total_participants:rows.length,rows:rows.slice((page-1)*size,page*size),me:rows.find(r=>r.is_me)??null,page,page_size:size,next_page:page*size<rows.length?page+1:null,diagnostics:{selected_date_missing:0,completed_unknown:0,inconsistent_disposition:0}};
}
export async function attachRankingFixture(context,{delay=()=>0}={}) {
 await context.route('**/functions/v1/user-rankings?*',async route=>{
  const q=new URL(route.request().url()).searchParams;
  const token=route.request().headers().authorization?.split(' ')[1];let viewer=E2E_UID;
  try{viewer=JSON.parse(Buffer.from(token.split('.')[1],'base64url')).sub;}catch{}
  if(delay(q))await new Promise(r=>setTimeout(r,delay(q)));
  await route.fulfill({status:200,contentType:'application/json',headers:{'cache-control':'private, no-store'},body:JSON.stringify(rankingFixture(q,viewer))}).catch(()=>{});
 });
}
