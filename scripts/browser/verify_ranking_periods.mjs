// LOCAL real GoTrue/SQL, synthetic reports; current three tabs/common periods. SDK is mocked.
import { chromium } from './harness.mjs';
import assert from 'node:assert/strict';
import { mkdirSync,readFileSync,writeFileSync } from 'node:fs';
const base=process.env.RANKINGS_ORIGIN||'http://127.0.0.1:5192';
const out=process.argv[2]||'docs/implementation/ranking-periods/evidence/browser';mkdirSync(out,{recursive:true});
const {session}=await(await fetch(base+'/__rankings/session')).json();
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--lang=ko-KR']});
const checks=[],responses=[],errors=[];let failure=null;
const check=(name,ok)=>{assert.ok(ok,name);checks.push({name,status:'PASS'});};
const ready=p=>p.locator('.rk-table:visible tbody tr,.rk-list:visible li').first().waitFor();
async function open(width,theme){
 const context=await browser.newContext({viewport:{width,height:1000},colorScheme:theme});
 await context.addInitScript(({session,theme})=>{localStorage.setItem('cm-map-auth-v1',JSON.stringify(session));localStorage.setItem('cm-theme',theme);},{session,theme});
 await context.route('https://dapi.kakao.com/**',r=>r.fulfill({contentType:'text/javascript',body:readFileSync(new URL('./mock-kakao-sdk.js',import.meta.url),'utf8')}));
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto(base+'/?screen=rankings');await ready(page);return{page,context,rk:page.locator('.rk-page')};
}
async function change(page,action,scope){
 const wait=page.waitForResponse(r=>r.url().includes('/functions/v1/user-rankings')&&Object.entries(scope).every(([k,v])=>new URL(r.url()).searchParams.get(k)===String(v)));
 await action();const reply=await wait;assert.equal(reply.status(),200);const data=await reply.json();await ready(page);
 check('every response no-store',/no-store/.test(reply.headers()['cache-control']));responses.push({status:reply.status(),scope:data.scope,participants:data.total_participants,own:data.me,bytes:Buffer.byteLength(JSON.stringify(data))});return data;
}
try{
 for(const width of [1440,1920,2560,390])for(const theme of ['light','dark']){
  const{page,context,rk}=await open(width,theme);
  for(const name of ['신고 랭킹','과태료 랭킹','불운 랭킹'])check(`${width}/${theme} ${name}`,await rk.getByRole('button',{name,exact:true}).count()===1);
  await change(page,()=>rk.getByRole('button',{name:'월별',exact:true}).click(),{period:'month'});
  await change(page,()=>rk.getByLabel('조회할 달 직접 선택').fill('2023-07'),{month:'2023-07'});
  check(`${width}/${theme} historical month and own summary`,(await rk.locator('.rk-sub').innerText()).includes('2023년 7월')&&await rk.getByRole('heading',{name:'내 순위',exact:true}).isVisible());
  check(`${width}/${theme} no overflow`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:`${out}/${width}-${theme}-july.png`,fullPage:true});await context.close();
 }
 const{page,context,rk}=await open(1440,'dark');
 await change(page,()=>rk.getByRole('button',{name:'월별',exact:true}).click(),{period:'month'});
 const reporter=await change(page,()=>rk.getByLabel('조회할 달 직접 선택').fill('2023-07'),{theme:'reporters',month:'2023-07'});
 check('July exact reports and competition tie',reporter.me.reports===2&&reporter.rows[0].reports===5&&reporter.rows[0].rank===1&&reporter.rows[0].tie_count===6);
 await change(page,()=>rk.getByRole('button',{name:'과태료 랭킹',exact:true}).click(),{theme:'fines'});
 const fine=await change(page,()=>rk.getByRole('button',{name:'비율순',exact:true}).click(),{metric:'fine_rate'});
 check('July fine exact fraction',fine.me.denominator===2&&fine.me.numerator===1&&fine.me.value===50&&fine.scope.start==='2023-07-01'&&fine.scope.end==='2023-07-31');
 check('correct fraction words',(await rk.locator('.rk-me-line').innerText()).includes('2건 중 1건'));
 await change(page,()=>rk.getByRole('button',{name:'불운 랭킹',exact:true}).click(),{theme:'unlucky'});
 for(const[button,metric]of [['비율순','rejected_rate'],['건수순','rejected_count'],['일부수용','partial_count'],['비율순','partial_rate']]){
  const d=await change(page,()=>rk.getByRole('button',{name:button,exact:true}).click(),{metric});check(`July ${metric} exact`,d.me.numerator===1&&d.me.denominator===2&&d.me.reports===2);
 }
 await change(page,()=>rk.getByRole('button',{name:'신고 랭킹',exact:true}).click(),{theme:'reporters'});
 const second=await change(page,()=>rk.getByRole('button',{name:'다음',exact:true}).click(),{page:2});check('page2 global own rank outside page',second.me.rank===20&&second.page===2);
 await change(page,()=>rk.getByRole('button',{name:'불운 랭킹',exact:true}).click(),{theme:'unlucky',metric:'partial_rate'});
 const cumulative=await change(page,()=>rk.getByRole('button',{name:'전체 기간',exact:true}).click(),{period:'all'});
 check('cumulative exact N53/P14 no month',cumulative.me.reports===53&&cumulative.me.partial===14&&cumulative.scope.month===null);
 await rk.getByRole('button',{name:'기간 지정',exact:true}).click();await rk.getByLabel('시작일',{exact:true}).fill('2023-07-01');await rk.getByLabel('종료일',{exact:true}).fill('2023-07-31');
 const ranged=await change(page,()=>rk.getByRole('button',{name:'조회',exact:true}).click(),{period:'range'});check('custom range exact July cohort',ranged.me.reports===2&&ranged.me.partial===1);
 await change(page,()=>rk.getByRole('button',{name:'월별',exact:true}).click(),{period:'month'});
 const current=new Date(Date.now()+9*3600000).toISOString().slice(0,7);
 if(await rk.getByLabel('조회할 달 직접 선택').inputValue()!==current)await change(page,()=>rk.getByLabel('조회할 달 직접 선택').fill(current),{month:current});
 for(const[name,theme]of [['신고 랭킹','reporters'],['과태료 랭킹','fines'],['불운 랭킹','unlucky']]){
  const d=await change(page,()=>rk.getByRole('button',{name,exact:true}).click(),{theme,month:current});check(`${theme} current exact N50/progress`,d.me.reports===50&&d.scope.in_progress&&await rk.getByText(/진행 중인 달이라/).isVisible());
 }
 await change(page,()=>rk.getByLabel('조회할 달 직접 선택').fill('2023-07'),{month:'2023-07'});
 await rk.locator('.rk-advanced summary').click();await rk.getByLabel('날짜 기준',{exact:true}).selectOption('report_date');
 const reported=await change(page,()=>rk.getByRole('button',{name:'적용',exact:true}).click(),{date_basis:'report_date'});check('report-date exact July N1/R0/P1',reported.me.reports===1&&reported.me.rejected===0&&reported.me.partial===1);
 const refreshed=page.waitForResponse(r=>r.url().includes('/functions/v1/user-rankings')&&r.status()===200);await page.reload();const refreshedBody=await(await refreshed).json();await ready(page);check('refresh restores ACTUAL applied scope and exact N1',refreshedBody.scope.month==='2023-07'&&refreshedBody.scope.date_basis==='report_date'&&refreshedBody.scope.metric==='partial_rate'&&refreshedBody.me.reports===1);check('refresh retains old month/date/metric',new URL(page.url()).searchParams.get('rk_month')==='2023-07'&&new URL(page.url()).searchParams.get('rk_basis')==='report_date');
 const nav=page.getByRole('navigation',{name:'주요 화면',exact:true});await nav.getByRole('button',{name:'지도',exact:true}).click();await page.waitForSelector('.kpi-strip [data-kpi="report"]');await nav.getByRole('button',{name:'유저 랭킹',exact:true}).click();await ready(page);await page.goBack();await page.waitForFunction(()=>new URLSearchParams(location.search).get('screen')!=='rankings');await page.goForward();await page.waitForFunction(()=>new URLSearchParams(location.search).get('screen')==='rankings');await ready(page);
 check('back/forward retains old month',await rk.getByLabel('조회할 달 직접 선택').inputValue()==='2023-07');
 await change(page,async()=>{await rk.getByRole('button',{name:'신고 랭킹',exact:true}).focus();await page.keyboard.press('Enter');},{theme:'reporters'});check('keyboard preserves date filter',new URL(page.url()).searchParams.get('rk_basis')==='report_date');
 check('no unexpected console errors',errors.length===0);await page.screenshot({path:`${out}/historical-keyboard.png`,fullPage:true});await context.close();
}catch(e){failure=e.stack;throw e;}finally{writeFileSync(out+'/result.json',JSON.stringify({environment:'local real GoTrue/SQL synthetic reports; SDK mock; not production',browser:browser.version(),checks,responses,errors,failure},null,2));await browser.close();}
console.log(`${checks.length} period checks PASS`);
