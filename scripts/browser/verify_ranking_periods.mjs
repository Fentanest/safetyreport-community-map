// LOCAL real GoTrue/SQL, synthetic reports; 2026-10-11 one-page board (three themes in one request) + common periods.
// SDK is mocked. Exact numbers come from the seed in scripts/browser/vite.rankings.config.ts.
import { chromium } from './harness.mjs';
import assert from 'node:assert/strict';
import { mkdirSync,readFileSync,writeFileSync } from 'node:fs';
const base=process.env.RANKINGS_ORIGIN||'http://127.0.0.1:5192';
const out=process.argv[2]||'docs/implementation/ranking-periods/evidence/browser';mkdirSync(out,{recursive:true});
const {session}=await(await fetch(base+'/__rankings/session')).json();
const browser=await chromium.launch({executablePath:process.env.RANKINGS_BROWSER||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--lang=ko-KR']});
const checks=[],responses=[],errors=[];let failure=null;
const check=(name,ok)=>{assert.ok(ok,name);checks.push({name,status:'PASS'});};
const boardReady=p=>p.locator('.rk-page .rk-card').nth(6).waitFor();
const listReady=p=>p.locator('.rk-table:visible tbody tr,.rk-list:visible li').first().waitFor();
const isBoard=u=>u.includes('/functions/v1/user-rankings/board');
const isList=u=>/\/functions\/v1\/user-rankings\?/.test(u);
const of=(board,metric)=>board.boards.find(b=>b.metric===metric);
async function open(width,theme){
 const context=await browser.newContext({viewport:{width,height:1000},colorScheme:theme});
 await context.addInitScript(({session,theme})=>{localStorage.setItem('cm-map-auth-v1',JSON.stringify(session));localStorage.setItem('cm-theme',theme);},{session,theme});
 await context.route('https://dapi.kakao.com/**',r=>r.fulfill({contentType:'text/javascript',body:readFileSync(new URL('./mock-kakao-sdk.js',import.meta.url),'utf8')}));
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!/status of 404/.test(m.text()))errors.push(m.text());});
 await page.goto(base+'/?screen=rankings');await boardReady(page);return{page,context,rk:page.locator('.rk-page')};
}
async function change(page,action,scope,route='board'){
 const wait=page.waitForResponse(r=>(route==='board'?isBoard(r.url()):isList(r.url()))&&Object.entries(scope).every(([k,v])=>new URL(r.url()).searchParams.get(k)===String(v)));
 await action();const reply=await wait;assert.equal(reply.status(),200);const data=await reply.json();
 if(route==='board')await boardReady(page);else await listReady(page);
 check('every response no-store',/no-store/.test(reply.headers()['cache-control']));
 responses.push({route,status:reply.status(),scope:data.scope,participants:data.total_participants,bytes:Buffer.byteLength(JSON.stringify(data))});return data;
}
try{
 for(const width of [1440,1920,2560,390])for(const theme of ['light','dark']){
  const{page,context,rk}=await open(width,theme);
  check(`${width}/${theme} three themes on one page`,(await rk.locator('.rk-theme h2').allTextContents()).join('|')==='신고 랭킹|과태료 랭킹|불운 랭킹');
  await change(page,()=>rk.getByRole('button',{name:'월별',exact:true}).click(),{period:'month'});
  await change(page,()=>rk.getByLabel('조회할 달 직접 선택').fill('2023-07'),{month:'2023-07'});
  check(`${width}/${theme} historical month and own rank in every card`,(await rk.locator('.rk-sub').innerText()).includes('2023년 7월')&&await rk.locator('.rk-card-me').count()===7);
  check(`${width}/${theme} no overflow`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.waitForTimeout(1300);
  await page.screenshot({path:`${out}/${width}-${theme}-july.png`,fullPage:true});await context.close();
 }
 const{page,context,rk}=await open(1440,'dark');
 const current=new Date(Date.now()+9*3600000).toISOString().slice(0,7);
 const now=await change(page,()=>rk.getByRole('button',{name:'월별',exact:true}).click(),{period:'month'});
 check('current month exact N50 and in progress in all seven boards',now.scope.month===current&&now.scope.in_progress&&now.boards.every(b=>b.me?.reports===50)&&await rk.getByText(/진행 중인 달이라/).isVisible());
 const july=await change(page,()=>rk.getByLabel('조회할 달 직접 선택').fill('2023-07'),{month:'2023-07'});
 const reporter=of(july,'reports_count');
 check('July exact reports and competition tie',reporter.me.reports===2&&reporter.rows[0].reports===5&&reporter.rows[0].rank===1&&reporter.rows[0].tie_count===6);
 const fine=of(july,'fine_rate');
 check('July fine exact fraction',fine.me.denominator===2&&fine.me.numerator===1&&fine.me.value===50&&july.scope.start==='2023-07-01'&&july.scope.end==='2023-07-31');
 check('correct fraction words',(await rk.locator('.rk-card[data-metric="fine_rate"] .rk-card-me').innerText()).includes('2건 중 1건'));
 for(const metric of ['rejected_rate','rejected_count','partial_count','partial_rate']){
  const d=of(july,metric);check(`July ${metric} exact`,d.me.numerator===1&&d.me.denominator===2&&d.me.reports===2);
 }
 const list=await change(page,()=>rk.getByRole('button',{name:'완료 신고 건수 전체 보기',exact:true}).click(),{theme:'reporters',month:'2023-07'},'list');
 check('full list = board rows (same snapshot rules)',JSON.stringify(list.rows.slice(0,5))===JSON.stringify(reporter.rows));
 const second=await change(page,()=>rk.getByRole('button',{name:'다음',exact:true}).click(),{page:2},'list');check('page2 global own rank outside page',second.me.rank===20&&second.page===2);
 await rk.getByRole('button',{name:/테마별 랭킹으로/}).click();await boardReady(page);
 // the cumulative board was answered on entry (< 120 s): shown from memory, checked on screen
 await rk.getByRole('button',{name:'전체 기간',exact:true}).click();await page.waitForFunction(()=>new URLSearchParams(location.search).get('rk_period')==='all'&&!new URLSearchParams(location.search).has('rk_month'));await boardReady(page);
 check('cumulative exact N53/P14 no month',(await rk.locator('.rk-card[data-metric="partial_rate"] .rk-card-me').innerText()).includes('53건 중 14건'));
 await rk.getByRole('button',{name:'기간 지정',exact:true}).click();await rk.getByLabel('시작일',{exact:true}).fill('2023-07-01');await rk.getByLabel('종료일',{exact:true}).fill('2023-07-31');
 const ranged=await change(page,()=>rk.getByRole('button',{name:'조회',exact:true}).click(),{period:'range'});check('custom range exact July cohort',of(ranged,'reports_count').me.reports===2&&of(ranged,'partial_count').me.partial===1);
 // both boards below were answered < 120 s ago: shown from memory without a request
 await rk.getByRole('button',{name:'월별',exact:true}).click();await page.waitForFunction(m=>new URLSearchParams(location.search).get('rk_month')===m,current);await boardReady(page);
 await rk.getByLabel('조회할 달 직접 선택').fill('2023-07');
 await page.waitForFunction(()=>new URLSearchParams(location.search).get('rk_month')==='2023-07');await boardReady(page);
 await rk.locator('.rk-advanced summary').click();await rk.getByLabel('날짜 기준',{exact:true}).selectOption('report_date');
 const reported=await change(page,()=>rk.getByRole('button',{name:'적용',exact:true}).click(),{date_basis:'report_date'});
 check('report-date exact July N1/R0/P1',of(reported,'reports_count').me.reports===1&&of(reported,'rejected_count').me.rejected===0&&of(reported,'partial_count').me.partial===1);
 const refreshed=page.waitForResponse(r=>isBoard(r.url())&&r.status()===200);await page.reload();const refreshedBody=await(await refreshed).json();await boardReady(page);
 check('refresh restores ACTUAL applied scope and exact N1',refreshedBody.scope.month==='2023-07'&&refreshedBody.scope.date_basis==='report_date'&&of(refreshedBody,'reports_count').me.reports===1);
 check('refresh retains old month/date',new URL(page.url()).searchParams.get('rk_month')==='2023-07'&&new URL(page.url()).searchParams.get('rk_basis')==='report_date');
 const nav=page.getByRole('navigation',{name:'주요 화면',exact:true});await nav.getByRole('button',{name:/^(지도|대시보드)$/}).click();await page.waitForFunction(()=>new URLSearchParams(location.search).get('screen')!=='rankings');await nav.getByRole('button',{name:'유저 랭킹',exact:true}).click();await boardReady(page);await page.goBack();await page.waitForFunction(()=>new URLSearchParams(location.search).get('screen')!=='rankings');await page.goForward();await page.waitForFunction(()=>new URLSearchParams(location.search).get('screen')==='rankings');await boardReady(page);
 check('back/forward retains old month',await rk.getByLabel('조회할 달 직접 선택').inputValue()==='2023-07');
 await change(page,async()=>{await rk.getByRole('button',{name:'일부수용 비율 전체 보기',exact:true}).focus();await page.keyboard.press('Enter');},{theme:'unlucky',metric:'partial_rate'},'list');
 check('keyboard 전체 보기 preserves date filter',new URL(page.url()).searchParams.get('rk_basis')==='report_date'&&new URL(page.url()).searchParams.get('rk_metric')==='partial_rate');
 check('no unexpected console errors',errors.length===0);await page.screenshot({path:`${out}/historical-keyboard.png`,fullPage:true});await context.close();
}catch(e){failure=e.stack;throw e;}finally{writeFileSync(out+'/result.json',JSON.stringify({environment:'local real GoTrue/SQL synthetic reports; SDK mock; not production',browser:browser.version(),checks,responses,errors,failure},null,2));await browser.close();}
console.log(`${checks.length} period checks PASS`);
