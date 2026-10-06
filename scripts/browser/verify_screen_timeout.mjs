// Local synthetic HTTP/auth/SDK fixtures. Tests the real frontend read deadline and recovery.
import { chromium, openPage, api, sleep } from './harness.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const out = process.env.SCREEN_BROWSER_OUT ?? 'docs/implementation/screen-snapshot-timeout-20261006/evidence/r2/browser';
mkdirSync(out,{recursive:true});
const browser = await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
const results={mode:'local synthetic HTTP; fake auth; mocked Kakao SDK; no production',checks:[],console:[],network:[]};
try {
 for(const width of [390,1440,1920,2560]) {
  await api('reset');
  const {page,context,consoleErrors}=await openPage(browser,{width,height:width===390?844:1080});
  await page.locator('.kpi-strip[aria-busy="false"] .kpi-value').first().waitFor({timeout:30000});
  await sleep(1500);
  assert.equal(await page.locator('.banner.error').count(),0);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.screenshot({path:`${out}/${width}-loaded.png`,fullPage:true});
  results.checks.push({width,loaded:true,overflow:false});
  if(width===390) {
   // The first screen succeeds; the next scope stalls for longer than the real 20s deadline.
   let stalled=true,requests=0;
   await page.route('**/my-analytics/screen?**',async route=>{
    requests++;
    if(stalled){await sleep(26000);try{await route.continue();}catch{}return;}
    await route.continue();
   });
   page.on('response',r=>{if(r.url().includes('/functions/v1/'))results.network.push({path:new URL(r.url()).pathname,status:r.status()});});
   const start=Date.now();
   await page.getByRole('button',{name:'교통위반',exact:true}).click();
   await page.getByText(/오류 코드 REQUEST_TIMEOUT/).first().waitFor({timeout:25000});
   const elapsed=Date.now()-start;
   assert(elapsed>=19000 && elapsed<25000);
   await sleep(3000);assert.equal(requests,1,'deadline must not automatically retry');
   await page.screenshot({path:`${out}/390-timeout.png`,fullPage:true});
   stalled=false;
   await page.getByRole('button',{name:'다시 시도',exact:true}).click();
   await page.getByText(/오류 코드 REQUEST_TIMEOUT/).first().waitFor({state:'hidden',timeout:10000});
   await sleep(1000);assert.equal(await page.locator('.banner.error').count(),0);
   await page.screenshot({path:`${out}/390-recovered.png`,fullPage:true});
   results.checks.push({timeout_ms:elapsed,no_automatic_retry:true,manual_retry:true});
  }
  results.console.push(...consoleErrors);await context.close();
 }
} finally {
 await api('reset');await browser.close();
 writeFileSync(`${out}/results.json`,JSON.stringify(results,null,2)+'\n');
}
console.log(JSON.stringify(results.checks));
