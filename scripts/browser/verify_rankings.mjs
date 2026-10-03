// Chromium + local real GoTrue/SQL rankings over invented reports. Forced errors/rate bypass are diagnostic fixtures.
import { chromium } from './harness.mjs';
import { mkdirSync,readFileSync,writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const base=process.env.RANKINGS_ORIGIN||'http://127.0.0.1:5192';
const out=process.argv[2]||'docs/refactoring/map-performance/evidence/rankings-browser';mkdirSync(out,{recursive:true});
await fetch(base+'/__rankings/fail?status=0');await fetch(base+'/__rankings/restore');
const {session}=await(await fetch(base+'/__rankings/session')).json();
const browser=await chromium.launch({executablePath:process.env.RANKINGS_BROWSER||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--lang=ko-KR']});
const checks=[],errors=[],network=[];
const check=(name,ok)=>{assert.ok(ok,name);checks.push({name,status:'PASS'});};
const shot=(page,name)=>page.screenshot({path:`${out}/${name}.png`,fullPage:true});
const log=async()=>await(await fetch(base+'/__rankings/log')).json();
const visibleRows=page=>page.locator('.rk-table:visible tbody tr,.rk-list:visible li');
const ready=async page=>{await visibleRows(page).first().waitFor();};
async function open(width,theme,signed=true,search='?screen=rankings'){
 const context=await browser.newContext({viewport:{width,height:900},colorScheme:theme,permissions:['clipboard-read','clipboard-write']});
 await context.addInitScript(({session,theme,signed})=>{localStorage.setItem('cm-theme',theme);if(signed)localStorage.setItem('cm-map-auth-v1',JSON.stringify(session));},{session,theme,signed});
 await context.route('https://dapi.kakao.com/**',r=>r.fulfill({contentType:'text/javascript',body:readFileSync(new URL('./mock-kakao-sdk.js',import.meta.url),'utf8')}));
 const page=await context.newPage();page.on('console',m=>{if(m.type()==='error'||m.type()==='warning')errors.push(m.text());});page.on('pageerror',e=>errors.push(e.message));
 page.on('response',r=>{if(r.url().includes('/functions/'))network.push({path:new URL(r.url()).pathname,status:r.status()});});
 await page.goto(base+'/'+search);if(signed)await ready(page);return {context,page};
}
async function query(page,action,predicate){
 const wait=page.waitForResponse(r=>r.url().includes('/functions/v1/user-rankings')&&predicate(new URL(r.url()).searchParams)&&r.status()===200);
 await action();await wait;await ready(page);
}
try{
 for(const width of [360,390,768,1440,1920,2560])for(const theme of ['dark','light']){
  const {page,context}=await open(width,theme);const rk=page.locator('.rk-page');
  check(`${width}/${theme} direct entry`,await rk.isVisible());
  check(`${width}/${theme} no page overflow`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  check(`${width}/${theme} three tabs`,await rk.locator('.rk-tabs button').allTextContents().then(x=>x.join('|')==='신고 랭킹|과태료 랭킹|불운 랭킹'));
  check(`${width}/${theme} own summary`,await rk.locator('[aria-label="내 순위 요약"]').isVisible()&&await rk.locator('.rk-me-badge:visible').count()===1);
  check(`${width}/${theme} responsive rows`,width<=700?await rk.locator('.rk-list').isVisible()&&!await rk.locator('table').isVisible():await rk.locator('table').isVisible());
  check(`${width}/${theme} exact header`,await rk.locator('th').allTextContents().then(x=>x.join('|')==='순위|참여자|완료 신고'));
  await shot(page,`${width}-${theme}`);
  if(width===390&&theme==='light'){
   await page.evaluate(()=>{const els=[...document.querySelectorAll('body *')].filter(e=>e instanceof HTMLElement);const sizes=els.map(e=>[e,parseFloat(getComputedStyle(e).fontSize)]);for(const [e,s]of sizes)e.style.fontSize=`${s*2}px`;});
   check('actual 200% computed text no page overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   check('200% text is doubled',await rk.locator('h1').evaluate(e=>parseFloat(getComputedStyle(e).fontSize)>=40));
   await shot(page,'390-light-text-200');
  }
  await context.close();
 }
 const {page,context}=await open(1440,'dark');const rk=page.locator('.rk-page');
 check('first pager is participant row range',await rk.locator('.rk-pager').innerText().then(x=>/참여자 1–20 \/ \d+명/.test(x)));
 const me=await rk.locator('.rk-me-line').innerText();
 await query(page,()=>rk.getByRole('button',{name:'다음',exact:true}).click(),q=>q.get('page')==='2');
 check('page 2 global me unchanged',await rk.locator('.rk-me-line').innerText()===me);
 check('page range uses rows, not ranks',await rk.locator('.rk-pager').innerText().then(x=>x.includes('참여자 21–')));
 await shot(page,'page2');
 await query(page,()=>rk.getByRole('button',{name:'과태료 랭킹',exact:true}).click(),q=>q.get('theme')==='fines');
 await query(page,()=>rk.getByRole('button',{name:'비율순',exact:true}).click(),q=>q.get('metric')==='fine_rate');
 check('rate fraction has correct denominator/numerator order',await rk.locator('table tbody tr:first-child td').nth(2).innerText().then(x=>/\d+건 중 \d+건/.test(x)&&parseFloat(x)<=100));
 const beforeSame=(await log()).length;await rk.getByRole('button',{name:'비율순',exact:true}).click();await page.waitForTimeout(150);
 check('same selection does not duplicate request',(await log()).length===beforeSame);await shot(page,'fine-rate');
 await query(page,()=>rk.getByRole('button',{name:'불운 랭킹',exact:true}).click(),q=>q.get('theme')==='unlucky');
 await query(page,()=>rk.getByRole('button',{name:'월별',exact:true}).click(),q=>q.get('period')==='month');
 await query(page,()=>rk.getByLabel('조회할 달 직접 선택',{exact:true}).fill('2026-08'),q=>q.get('month')==='2026-08');
 await query(page,()=>rk.getByRole('button',{name:'비율순',exact:true}).click(),q=>q.get('metric')==='rejected_rate');
 check('prior month exact metric title',await rk.locator('.rk-sub').innerText().then(x=>x.includes('2026년 8월')&&x.includes('불수용 비율이 높은 순위')));
 check('single report and competition ties kept',await rk.getByText('표본 1건',{exact:true}).count()>0&&await visibleRows(page).first().innerText().then(x=>x.includes('공동')));await shot(page,'prior-month-single-sample');
 await query(page,()=>rk.getByRole('button',{name:'일부수용',exact:true}).click(),q=>q.get('metric')==='partial_rate');
 await query(page,()=>rk.getByRole('button',{name:'건수순',exact:true}).click(),q=>q.get('metric')==='partial_count');
 await query(page,()=>rk.getByRole('button',{name:'과태료 랭킹',exact:true}).click(),q=>q.get('metric')==='fine_rate');
 await query(page,()=>rk.getByRole('button',{name:'불운 랭킹',exact:true}).click(),q=>q.get('metric')==='partial_count');
 check('partial metric restored after round trip',new URL(page.url()).searchParams.get('rk_metric')==='partial_count');
 const emptyWait=page.waitForResponse(r=>r.url().includes('/user-rankings')&&new URL(r.url()).searchParams.get('month')==='2020-01');
 await rk.getByLabel('조회할 달 직접 선택').fill('2020-01');await emptyWait;await rk.getByRole('heading',{name:'결과가 없습니다'}).waitFor();
 check('empty has no invented row',await visibleRows(page).count()===0);await shot(page,'empty');
 await query(page,()=>rk.getByRole('button',{name:'초기화',exact:true}).click(),q=>q.get('theme')==='reporters'&&q.get('period')==='all');
 const opener=rk.locator('tr.rk-me-row .rk-uuid-btn');await opener.click();const dialog=rk.getByRole('dialog',{name:'참여자 UUID'});
 await dialog.waitFor();check('UUID full value',await dialog.getByLabel('전체 UUID').inputValue()===session.user.id);
 await dialog.getByRole('button',{name:'복사',exact:true}).click();check('full UUID copy',await page.evaluate(()=>navigator.clipboard.readText())===session.user.id);await shot(page,'uuid-copy');
 await page.keyboard.press('Escape');check('UUID closes and restores keyboard focus',!await dialog.isVisible()&&await opener.evaluate(e=>e===document.activeElement));
 await opener.click();await page.keyboard.press('Tab');check('UUID traps focus',await page.evaluate(()=>!!document.activeElement.closest('[role="dialog"]')));await page.keyboard.press('Escape');
 await shot(page,'keyboard-focus');
 // Separate drafts must not leak into immediate requests.
 await rk.locator('.rk-advanced summary').click();
 await rk.getByLabel('최소 신고 건수',{exact:true}).fill('3');const preDraft=(await log()).length;await page.waitForTimeout(100);check('advanced draft sends no request',(await log()).length===preDraft);
 await query(page,()=>rk.getByRole('button',{name:'과태료 랭킹',exact:true}).click(),q=>q.get('theme')==='fines'&&q.get('min_reports')==='1');
 check('immediate tab did not apply advanced draft',new URL(page.url()).searchParams.get('rk_min')!=='3');
 await query(page,()=>rk.getByRole('button',{name:'적용',exact:true}).click(),q=>q.get('min_reports')==='3');
 await rk.getByLabel('최소 신고 건수',{exact:true}).fill('1');
 await query(page,()=>rk.getByRole('button',{name:'적용',exact:true}).click(),q=>q.get('min_reports')==='1');
 await rk.getByRole('button',{name:'기간 지정',exact:true}).click();await rk.getByLabel('시작일',{exact:true}).fill('2026-08-01');await rk.getByLabel('종료일',{exact:true}).fill('2026-08-31');
 const preRange=(await log()).length;await page.waitForTimeout(100);check('range draft sends no request',(await log()).length===preRange);
 await query(page,()=>rk.getByRole('button',{name:'조회',exact:true}).click(),q=>q.get('period')==='range'&&q.get('start')==='2026-08-01');
 await fetch(base+'/__rankings/fail?status=429');await rk.getByRole('button',{name:'신고 랭킹',exact:true}).click();await rk.getByRole('button',{name:/초 뒤 다시 시도/}).waitFor();
 check('429 respects cooldown',await rk.getByRole('button',{name:/초 뒤 다시 시도/}).isDisabled());const limited=(await log()).length;
 await rk.getByRole('button',{name:'과태료 랭킹',exact:true}).click();await rk.getByRole('button',{name:'불운 랭킹',exact:true}).click();await page.waitForTimeout(500);
 check('429 does not fire pending intents',(await log()).length===limited);await shot(page,'rate-limited');await ready(page);
 check('429 resumes only latest intent',new URL(page.url()).searchParams.get('rk_theme')==='unlucky');
 await fetch(base+'/__rankings/fail?status=503');await rk.getByRole('button',{name:'신고 랭킹',exact:true}).click();await rk.getByRole('heading',{name:'랭킹을 불러오지 못했습니다'}).waitFor();
 check('5xx clears protected rank rows',await visibleRows(page).count()===0);await shot(page,'error');await rk.getByRole('button',{name:'다시 시도',exact:true}).click();await ready(page);
 await query(page,()=>rk.getByRole('button',{name:'전체 기간',exact:true}).click(),q=>q.get('period')==='all');
 await fetch(base+'/__rankings/fail?status=409');await rk.getByRole('button',{name:'다음',exact:true}).click();await page.waitForFunction(()=>new URLSearchParams(location.search).get('rk_page')==='1');await ready(page);
 check('409 restarts complete version',await rk.locator('.rk-pager').innerText().then(x=>x.includes('참여자 1–20')));
 await page.reload();await ready(page);check('refresh deep link',new URL(page.url()).searchParams.get('screen')==='rankings');
 const nav=page.getByRole('navigation',{name:'주요 화면',exact:true});await nav.getByRole('button',{name:'지도',exact:true}).click();await page.waitForSelector('.kpi-strip [data-kpi="report"]');
 const mapBefore=Object.fromEntries(new URL(page.url()).searchParams);await nav.getByRole('button',{name:'유저 랭킹',exact:true}).click();await ready(page);
 await query(page,()=>rk.getByRole('button',{name:'월별',exact:true}).click(),q=>q.get('period')==='month');
 const mapAfter=Object.fromEntries(new URL(page.url()).searchParams);check('ranking preserves map filters',['start','end','date_basis','category'].every(k=>mapBefore[k]===mapAfter[k]));
 await nav.getByRole('button',{name:'지도',exact:true}).click();await page.goBack();await ready(page);check('history back returns ranking',new URL(page.url()).searchParams.get('screen')==='rankings');await page.goForward();await page.waitForFunction(()=>new URLSearchParams(location.search).get('screen')!=='rankings');
 await nav.getByRole('button',{name:'유저 랭킹',exact:true}).click();await ready(page);
 await fetch(base+'/__rankings/withdraw');await page.reload();await rk.getByText(/활성|동의/).first().waitFor();await page.waitForTimeout(300);check('withdrawal clears protected rows',await visibleRows(page).count()===0);await shot(page,'withdrawn');await fetch(base+'/__rankings/restore');await context.close();
 const anon=await open(390,'dark',false);check('anonymous login gate',await anon.page.getByRole('button',{name:'카카오로 로그인'}).isVisible());check('anonymous no UUID rows',await visibleRows(anon.page).count()===0);await shot(anon.page,'anonymous');await anon.context.close();
 const unexpected=errors.filter(x=>!/^Failed to load resource: the server responded with a status of (429|503|409|403)/.test(x));check('no unexpected console or page errors',unexpected.length===0);
 writeFileSync(out+'/summary.json',JSON.stringify({browser:browser.version(),data:'real local Postgres/GoTrue, invented observations; Node runtime; forced errors/rate bypass; mock Kakao SDK; no hosted integration',checks,console_errors:errors,network,requests:await log(),live:'NOT_RUN; no deploy'},null,2));console.log(JSON.stringify({checks:checks.length,out,unexpected},null,2));
}catch(e){writeFileSync(out+'/failure.json',JSON.stringify({message:e.message,checks,errors,network},null,2));throw e;}finally{await browser.close();}
