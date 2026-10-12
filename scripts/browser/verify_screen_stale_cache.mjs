// Real Chrome + real screen handler + local PostgreSQL exported aggregate; fake auth and Kakao SDK.
import { chromium, fakeSession, ORIGIN, sleep } from './harness.mjs';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const out='/tmp/cm-stale-fix-browser';
mkdirSync(out,{recursive:true});
const uid=createHash('md5').update('cohort-timeout-user-1').digest('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/,'$1-$2-$3-$4-$5');
const sdk=readFileSync('scripts/browser/mock-kakao-sdk.js','utf8');
const source=JSON.parse(readFileSync('/tmp/cm-stale-browser-year.json','utf8'));
const expectedCount=source.public_aggregate.stats.find(s=>s.kind==='summary'&&s.period===0).n;
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
const results={status:'RUNNING',mode:'local SQL aggregate + actual screen handler + Chrome; fake auth, mock Kakao; not hosted Edge or production',browser:browser.version(),checks:[],console:[],network:[]};
try {
 for(const theme of ['dark','light']) for(const [width,height] of [[390,844],[1440,900],[1920,1080],[2560,1440]]) {
  const context=await browser.newContext({locale:'ko-KR',viewport:{width,height},colorScheme:theme});
  await context.route('https://dapi.kakao.com/**',r=>r.fulfill({contentType:'text/javascript',body:sdk}));
  await context.addInitScript(({session,theme})=>{localStorage.setItem('cm-map-auth-v1',JSON.stringify(session));localStorage.setItem('cm-theme',theme);},{session:fakeSession(uid),theme});
  const page=await context.newPage();
  page.on('console',m=>{if(m.type()==='error')results.console.push(m.text());});
  page.on('pageerror',e=>results.console.push(e.message));
  page.on('response',async r=>{if(r.url().includes('/my-analytics/screen?'))results.network.push({width,theme,status:r.status(),path:new URL(r.url()).pathname});});
  const search=new URLSearchParams({date_basis:'completed_date',start:'2025-10-13',end:'2026-10-12',category:'all'});
  await page.goto(`${ORIGIN}/?${search}`);
  await page.locator('.kpi-strip[aria-busy="false"] .kpi-value').first().waitFor({timeout:30000});
  await sleep(800);
  assert.equal(await page.locator('.banner.error').count(),0);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  const text=await page.locator('body').innerText();
  assert(!text.includes(uid));assert(!text.includes('12가1000'));
  assert(text.includes(expectedCount.toLocaleString('ko-KR')));
  assert(text.includes('전체 '));
  assert(await page.locator('.kpi-period[title]').getAttribute('title'));
  if(width===390) {
   await page.getByRole('switch',{name:'내 신고와 비교'}).check();
   await page.locator('.kpi-period').filter({hasText:'내 신고'}).waitFor();
   await page.getByRole('button',{name:'전체와 내 신고 상세 비교'}).click();
   const diffText=await page.locator('.compare-table .diff-col').first().innerText();
   assert(diffText.includes('%'));assert(!diffText.includes('—'));
   assert(!(await page.locator('body').innerText()).includes('표시하지 않습니다'));
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  }
  await page.screenshot({path:`${out}/${width}-${theme}.png`,fullPage:true});
  results.checks.push({width,height,theme,loaded:true,overflow:false,sql_report_count:expectedCount});
  if(width===1440 && theme==='dark') {
   await page.getByRole('tab',{name:'위반법규',exact:true}).click();
   await page.locator('.sort-head').first().click();
   await page.getByRole('menuitemradio',{name:'건수 적은 순',exact:true}).click();
   await page.locator('th[aria-sort="ascending"]').first().waitFor();
   const [compared]=await Promise.all([page.waitForResponse(r=>r.url().includes('/my-analytics/screen?')&&decodeURIComponent(r.url()).includes('compare')),
     page.getByRole('switch',{name:'내 신고와 비교'}).check()]);assert.equal(compared.status(),200);
   const comparedPacket=await compared.json(),mine=comparedPacket.panels.find(p=>p.body?.mine)?.body;
   assert(mine);assert.equal(mine.snapshots.comparable,false);assert(Math.abs(mine.diff.report_share-mine.mine.report_count/mine.all.report_count*100)<1e-9);assert.notEqual(mine.diff.accept_rate_pp,null);
   await page.locator('.kpi-period').filter({hasText:'내 신고'}).waitFor();
   assert.equal(mine.all.report_count,comparedPacket.dashboard.overview.report_count.value);
   assert(comparedPacket.panels.filter(p=>p.status===200).every(p=>p.body.dataset_version===comparedPacket.meta.dataset_version));
   await page.locator('.date-control').click();await page.getByLabel('시작일',{exact:true}).fill('2023-01-01');
   const [ranged]=await Promise.all([page.waitForResponse(r=>r.url().includes('/my-analytics/screen?')&&r.url().includes('2023-01-01')),
     page.getByRole('region',{name:'조건',exact:true}).getByRole('button',{name:'적용',exact:true}).click()]);assert.equal(ranged.status(),200);
   const rangePacket=await ranged.json();assert.equal(rangePacket.dashboard.scope.start,'2023-01-01');
   await sleep(800);assert.equal(await page.locator('.banner.error').count(),0);
   await page.screenshot({path:`${out}/1440-dark-sorted-compare-all.png`,fullPage:true});
   results.checks.push({sort:'ascending',personal_compare:true,whole_range:true,version_consistent:true});
  }
  await context.close();
 }
 // Explicit synthetic mine > all response, exercising browser schema + rendered annotation.
 for(const theme of ['dark','light']) {
  const context=await browser.newContext({locale:'ko-KR',viewport:{width:390,height:844},colorScheme:theme});
  await context.route('https://dapi.kakao.com/**',r=>r.fulfill({contentType:'text/javascript',body:sdk}));
  await context.route('**/my-analytics/screen?*',async route=>{
   const response=await route.fetch();const packet=await response.json();
   for(const p of packet.panels??[]) if(p.body?.mine) {
    p.body.mine.report_count=p.body.all.report_count*2;
    p.body.diff.report_share=200;
   }
   await route.fulfill({response,json:packet});
  });
  await context.addInitScript(({session,theme})=>{localStorage.setItem('cm-map-auth-v1',JSON.stringify(session));localStorage.setItem('cm-theme',theme);},{session:fakeSession(uid),theme});
  const page=await context.newPage();
  page.on('pageerror',e=>results.console.push(e.message));
  page.on('console',m=>{if(m.type()==='error')results.console.push(m.text());});
  page.on('response',r=>{if(r.url().includes('/my-analytics/screen?'))results.network.push({width:390,theme,synthetic_over_share:true,status:r.status()});});
  await page.goto(`${ORIGIN}/?date_basis=completed_date&start=2025-10-13&end=2026-10-12&category=all`);
  await page.locator('.kpi-strip[aria-busy="false"] .kpi-value').first().waitFor({timeout:30000});
  await page.getByRole('switch',{name:'내 신고와 비교'}).check();
  await page.locator('.kpi-period').filter({hasText:'내 신고'}).waitFor();
  await page.getByRole('button',{name:'전체와 내 신고 상세 비교'}).click();
  const cell=page.locator('.compare-table .diff-col').first();
  assert((await cell.innerText()).includes('200.0%'));
  assert((await cell.innerText()).includes('최근 업로드 반영 차이'));
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.locator('.compare-table-scroll').evaluate(el=>{el.scrollLeft=el.scrollWidth;});
  await page.locator('.compare-kpis').evaluate(el=>window.scrollTo(0,window.scrollY+el.getBoundingClientRect().top-260));
  await sleep(200);
  await page.screenshot({path:`${out}/390-${theme}-over-share.png`});
  results.checks.push({width:390,theme,synthetic_over_share:200,annotation:true,overflow:false});
  await context.close();
 }
 assert.equal(results.console.length,0);assert(results.network.length>=8);assert(results.network.every(r=>r.status===200));results.status='PASS';
} finally {
 if(results.status!=='PASS')results.status='FAIL';
 await browser.close();writeFileSync(`${out}/results.json`,JSON.stringify(results,null,2)+'\n');
}
console.log(JSON.stringify(results.checks));
