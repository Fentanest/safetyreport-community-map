// Same machine/data/routes: production UI builds; explicit demo engine + mock SDK/ranking DTOs. No operational claim.
import { spawn,execFileSync } from 'node:child_process';
import { mkdirSync,readFileSync,writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from './harness.mjs';
import { attachRankingFixture } from './ranking_fixture.mjs';
const out=process.argv[2]||'docs/refactoring/map-performance/evidence/production-browser';mkdirSync(out,{recursive:true});
const root=process.cwd(),before=resolve('.agent-runtime/worktrees/before');const results=[],failures=[];
const browser=await chromium.launch({args:['--no-sandbox','--lang=ko-KR']});let server;
const save=()=>writeFileSync(`${out}/measurements.json`,JSON.stringify({mode:'production builds; cold browser contexts; existing demoEngine seed + mock SDK/ranking DTO; frontend-only, no real auth/SQL or hosted verification',browser:browser.version(),viewport:'1440x900',repeats:30,first_included:true,compression:'plain local static server, uncompressed JS response body',readiness:'requestAnimationFrame visible content; Playwright locator exponential polling removed; wall-clock includes page navigation and readiness confirmation',results,failures},null,2));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
try{
 for(const [variant,cwd]of [['before',before],['after',root]]){
  const dist=resolve(`.agent-runtime/production-${variant}`);
  execFileSync('npx',['--no-install','vite','build','--outDir',dist,'--emptyOutDir'],{cwd,env:{...process.env,VITE_DATA_MODE:'demo',VITE_BASE_PATH:'/safetyreport-community-map/',VITE_KAKAO_MAP_JS_KEY:'mock-e2e-key',VITE_PUBLIC_ANALYTICS_URL:'http://127.0.0.1:5198/functions/v1'},stdio:['ignore','pipe','pipe']});
  server=spawn('node',['scripts/browser/static_pages.mjs'],{cwd:root,env:{...process.env,PORT:'5198',DIST:dist},stdio:['ignore','pipe','pipe']});
  await new Promise((ok,fail)=>{server.stdout.once('data',ok);server.on('exit',code=>{if(code)fail(new Error('static preview exit '+code));});});
  for(const screen of ['dashboard','statistics','rankings']){
   const samples=[];
   for(let i=0;i<30;i++){
    const context=await browser.newContext({viewport:{width:1440,height:900},locale:'ko-KR'});
    await context.route('https://dapi.kakao.com/**',r=>r.fulfill({contentType:'text/javascript',body:readFileSync(new URL('./mock-kakao-sdk.js',import.meta.url),'utf8')}));
    await attachRankingFixture(context);
    await context.addInitScript(()=>{localStorage.setItem('cm-theme','dark');window.__perfLongTasks=[];try{new PerformanceObserver(list=>window.__perfLongTasks.push(...list.getEntries().map(e=>({ms:e.duration,at:e.startTime})))).observe({type:'longtask',buffered:true});}catch{}});
    const page=await context.newPage();const requests=[];const errors=[];
    page.on('request',r=>requests.push(new URL(r.url()).pathname));page.on('pageerror',e=>errors.push(e.message));
    const started=performance.now();let success=true;
    try{
     await page.goto(`http://127.0.0.1:5198/safetyreport-community-map/?screen=${screen}&me=signed`);
     await page.waitForFunction(selector=>{const e=document.querySelector(selector);return !!e&&e.getBoundingClientRect().height>0&&getComputedStyle(e).visibility!=='hidden';},screen==='dashboard'?'.kpi-strip .kpi-row':screen==='statistics'?'.pivot-table tbody tr':'.rk-table tbody tr',{timeout:30000,polling:'raf'});
    }catch(e){success=false;failures.push({variant,screen,i,message:e.message});}
    const ms=performance.now()-started;
    const data=await page.evaluate(()=>({resources:performance.getEntriesByType('resource').map(e=>({path:new URL(e.name).pathname,bytes:e.encodedBodySize,duration:e.duration})),long_tasks:window.__perfLongTasks,maps:window.__kakaoStats?.maps??0,chart_hosts:[...document.querySelectorAll('[_echarts_instance_]')].length}));
    samples.push({ms,success,requests:requests.length,api_requests:requests.filter(x=>x.includes('/functions/')).length,js_bytes:data.resources.filter(x=>x.path.endsWith('.js')).reduce((n,r)=>n+r.bytes,0),...data,errors});
    if(i===0)await page.screenshot({path:`${out}/${variant}-${screen}.png`,fullPage:true});
    await context.close();
   }
   const times=samples.filter(x=>x.success).map(x=>x.ms).sort((a,b)=>a-b);
   results.push({variant,screen,requests:samples.reduce((n,s)=>n+s.requests,0),p50_ms:times[Math.ceil(times.length*.5)-1],p95_ms:times[Math.ceil(times.length*.95)-1],max_ms:times.at(-1),failure_rate:samples.filter(s=>!s.success).length/30,samples});save();
  }
  server.kill('SIGTERM');await new Promise(ok=>server.once('exit',ok));server=null;await wait(150);
 }
 save();if(failures.length)throw new Error(`${failures.length} production fixture entry failures`);
}finally{server?.kill('SIGTERM');await browser.close();}
