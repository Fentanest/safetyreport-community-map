// Actual Chromium page zoom via isolated profile Preferences; headed under Xvfb. No CSS/device emulation.
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {chromium,fakeSession,ORIGIN} from './harness.mjs';
import {attachRankingFixture} from './ranking_fixture.mjs';
const out=process.argv[2]||'docs/refactoring/map-performance/evidence/browser-zoom';mkdirSync(out,{recursive:true});
const profile=resolve('.agent-runtime/tmp/zoom-profile-'+Date.now());mkdirSync(profile+'/Default',{recursive:true});
writeFileSync(profile+'/Default/Preferences',JSON.stringify({partition:{default_zoom_level:{x:Math.log(2)/Math.log(1.2)}}}));
const context=await chromium.launchPersistentContext(profile,{headless:false,viewport:null,args:['--no-sandbox','--window-size=768,1080','--lang=ko-KR']});
const checks=[];
try{
 await context.route('https://dapi.kakao.com/**',r=>r.fulfill({contentType:'text/javascript',body:readFileSync(new URL('./mock-kakao-sdk.js',import.meta.url),'utf8')}));await attachRankingFixture(context);
 await context.addInitScript(session=>localStorage.setItem('cm-map-auth-v1',JSON.stringify(session)),fakeSession());
 const page=context.pages()[0];const cdp=await context.newCDPSession(page);
 for(const theme of ['dark','light'])for(const screen of ['rankings','statistics']){
  await page.goto(`${ORIGIN}/?screen=${screen}`);await page.evaluate(t=>{localStorage.setItem('cm-theme',t);document.documentElement.dataset.theme=t;},theme);
  await page.locator(screen==='rankings'?'.rk-table tbody tr':'.pivot-table tbody tr').first().waitFor({state:'attached',timeout:20000});
  const dimensions=await page.evaluate(()=>({innerWidth,outerWidth,dpr:devicePixelRatio,scrollWidth:document.documentElement.scrollWidth,cssZoom:getComputedStyle(document.body).zoom}));
  console.log(JSON.stringify(dimensions));await page.keyboard.press('Tab');const keyboard=await page.evaluate(()=>document.activeElement!==document.body);
  const shot=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(`${out}/${screen}-${theme}-actual200.png`,Buffer.from(shot.data,'base64'));
  checks.push({screen,theme,...dimensions,keyboard,pass:dimensions.dpr===2&&dimensions.outerWidth/dimensions.innerWidth>1.9&&dimensions.cssZoom==='1'&&dimensions.scrollWidth<=dimensions.innerWidth&&keyboard});
 }
 writeFileSync(`${out}/results.json`,JSON.stringify({method:'headed Chromium, isolated profile partition.default_zoom_level.x = log(2)/log(1.2), viewport:null; browser window768 yields layout viewport384; no CSS zoom or device override',checks},null,2));
 if(checks.some(c=>!c.pass))throw new Error('actual 200% zoom verification failed');
}finally{await context.close();}
