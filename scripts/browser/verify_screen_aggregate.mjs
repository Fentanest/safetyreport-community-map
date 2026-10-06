// Real Chrome + real screen handler + local PostgreSQL exported aggregate; fake auth and Kakao SDK.
import { chromium, fakeSession, ORIGIN, sleep } from './harness.mjs';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const out='docs/implementation/screen-server-aggregate-20261006/evidence/browser';
mkdirSync(out,{recursive:true});
const uid=createHash('md5').update('cohort-timeout-user-1').digest('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/,'$1-$2-$3-$4-$5');
const sdk=readFileSync('scripts/browser/mock-kakao-sdk.js','utf8');
const expected=JSON.parse(readFileSync('.agent-runtime/screen-aggregate/30000-diverse-year-public.json','utf8'));
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
  const search=new URLSearchParams({date_basis:'completed_date',start:'2025-10-07',end:'2026-10-06',category:'all'});
  await page.goto(`${ORIGIN}/?${search}`);
  await page.locator('.kpi-strip[aria-busy="false"] .kpi-value').first().waitFor({timeout:30000});
  await sleep(800);
  assert.equal(await page.locator('.banner.error').count(),0);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  const text=await page.locator('body').innerText();
  assert(!text.includes(uid));assert(!text.includes('12가1000'));
  assert(text.includes(expected.dashboard.overview.report_count.value.toLocaleString('ko-KR')));
  await page.screenshot({path:`${out}/${width}-${theme}.png`,fullPage:true});
  results.checks.push({width,height,theme,loaded:true,overflow:false,sql_report_count:expected.dashboard.overview.report_count.value});
  if(width===1440 && theme==='dark') {
   await page.getByRole('tab',{name:'위반법규',exact:true}).click();
   await page.locator('.sort-head').first().click();
   await page.getByRole('menuitemradio',{name:'건수 적은 순',exact:true}).click();
   await page.locator('th[aria-sort="ascending"]').first().waitFor();
   const [compared]=await Promise.all([page.waitForResponse(r=>r.url().includes('/my-analytics/screen?')&&decodeURIComponent(r.url()).includes('compare')),
     page.getByRole('switch',{name:'내 신고와 비교'}).check()]);assert.equal(compared.status(),200);
   const comparedPacket=await compared.json(),mine=comparedPacket.panels.find(p=>p.body?.mine)?.body;
   assert(mine);assert.equal(mine.all.report_count,comparedPacket.dashboard.overview.report_count.value);
   assert(comparedPacket.panels.filter(p=>p.status===200).every(p=>p.body.dataset_version===comparedPacket.meta.dataset_version));
   await page.locator('.date-control').click();await page.getByLabel('시작일',{exact:true}).fill('2019-04-23');
   const [ranged]=await Promise.all([page.waitForResponse(r=>r.url().includes('/my-analytics/screen?')&&r.url().includes('2019-04-23')),
     page.getByRole('region',{name:'조건',exact:true}).getByRole('button',{name:'적용',exact:true}).click()]);assert.equal(ranged.status(),200);
   const rangePacket=await ranged.json();assert.equal(rangePacket.dashboard.scope.start,'2019-04-23');
   await sleep(800);assert.equal(await page.locator('.banner.error').count(),0);
   await page.screenshot({path:`${out}/1440-dark-sorted-compare-all.png`,fullPage:true});
   results.checks.push({sort:'ascending',personal_compare:true,whole_range:true,version_consistent:true});
  }
  await context.close();
 }
 assert.equal(results.console.length,0);assert(results.network.length>=8);assert(results.network.every(r=>r.status===200));results.status='PASS';
} finally {
 if(results.status!=='PASS')results.status='FAIL';
 await browser.close();writeFileSync(`${out}/results.json`,JSON.stringify(results,null,2)+'\n');
}
console.log(JSON.stringify(results.checks));
