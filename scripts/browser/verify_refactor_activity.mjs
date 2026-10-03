// Development Profiler/lifecycle diagnosis. API/SDK and ranking rows are explicit synthetic fixtures.
import assert from 'node:assert/strict';
import { mkdirSync,writeFileSync } from 'node:fs';
import { chromium,api,openPage,waitMap } from './harness.mjs';
import { attachRankingFixture } from './ranking_fixture.mjs';
const out=process.argv[2]||'docs/refactoring/map-performance/evidence/activity-browser';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({args:['--no-sandbox','--lang=ko-KR']});const checks=[],notes=[];
const check=(name,condition)=>{assert.ok(condition,name);checks.push({name,status:'PASS'});};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
try{
 await api('reset');await api('inject',{route:'meta',status:503,times:1});
 let {context,page}=await openPage(browser,{search:'?screen=statistics'});
 await page.getByText(/통계 조회 조건을 불러오지 못했습니다/).waitFor();
 check('metadata error has explicit retry',await page.getByRole('button',{name:'다시 시도',exact:true}).isVisible());
 check('direct statistics has no dashboard request',!(await api('log')).some(r=>r.route==='dashboard'));
 await page.getByRole('button',{name:'다시 시도',exact:true}).click();await page.waitForSelector('.pivot-table tbody tr');
 check('metadata retry reaches actual result',await page.locator('.pivot-table tbody tr').count()>0);
 await context.close();await api('reset');
 ({context,page}=await openPage(browser));await attachRankingFixture(context,{delay:q=>q.get('metric')==='fine_count'?800:40});
 await waitMap(page);await page.waitForSelector('.kpi-strip .kpi-row');await pause(600);
 await page.evaluate(()=>{window.__cmProfileEnabled=true;window.__cmCommits=[];});
 const nav=page.getByRole('navigation',{name:'주요 화면',exact:true});
 const counts=()=>page.evaluate(()=>({builds:window.__cmChartBuilds,live:window.__cmChartLive,observers:window.__cmChartObservers,maps:window.__kakaoStats.maps,markers:window.__kakaoLiveMarkers().length,commits:window.__cmCommits}));
 const original=await counts();const cycles=[];const rankRequests=[];
 page.on('request',r=>{if(r.url().includes('/user-rankings?'))rankRequests.push(new URL(r.url()).searchParams.get('metric'));});
 for(let i=0;i<20;i++){
  await nav.getByRole('button',{name:'유저 랭킹',exact:true}).click();await page.locator('.rk-table:visible tbody tr').first().waitFor();await pause(150);
  await page.locator('.rk-page').getByRole('button',{name:'초기화',exact:true}).click();
  await page.locator('.rk-tabs button[aria-pressed="true"]').filter({hasText:'신고 랭킹'}).waitFor();await pause(150);
  const atHide=await counts(),requestStart=(await api('log')).length;
  await page.evaluate(()=>{window.__cmCommits=[];});
  const rankingStart=rankRequests.length;
  const rk=page.locator('.rk-page');await rk.getByRole('button',{name:'과태료 랭킹',exact:true}).click();await rk.getByRole('button',{name:'비율순',exact:true}).click();
  await page.waitForFunction(()=>new URLSearchParams(location.search).get('rk_metric')==='fine_rate');await pause(900);
  check(`cycle ${i+1}: late count answer cannot overwrite latest rate`,(await rk.locator('.rk-sub').innerText()).includes('과태료 처분율'));
  check(`cycle ${i+1}: exercised both overlapping ranking requests`,rankRequests.length===rankingStart+2);
  const after=await counts();
  check(`cycle ${i+1}: hidden chart builds unchanged`,after.builds===atHide.builds);
  check(`cycle ${i+1}: hidden dashboard has no Profiler commit`,after.commits.length===0);
  check(`cycle ${i+1}: no inactive map/statistics HTTP work`,(await api('log')).length===requestStart);
  await nav.getByRole('button',{name:'지도',exact:true}).click();await page.waitForSelector('.kpi-strip .kpi-row');await pause(200);
  const restored=await counts();cycles.push({iteration:i+1,atHide,after,restored});
  check(`cycle ${i+1}: map/chart instances do not grow`,restored.maps===original.maps&&restored.live===original.live&&restored.observers===original.observers&&restored.markers===original.markers);
 }
 await page.screenshot({path:`${out}/dashboard-after20.png`,fullPage:true});
 await nav.getByRole('button',{name:'통계 — 맞춤 통계 화면',exact:true}).click();await page.waitForSelector('.pivot-table tbody tr');
 const beforeEdit=(await api('log')).length;await page.locator('.stats-builder').getByLabel('예시 설정').selectOption('month_rates');await pause(300);
 check('statistics preset remains a draft',(await api('log')).length===beforeEdit);
 await page.screenshot({path:`${out}/statistics-draft.png`,fullPage:true});
 writeFileSync(`${out}/summary.json`,JSON.stringify({mode:'dev/StrictMode; Profiler boundary overhead; synthetic Node API/SDK/ranking DTOs; not production timings',checks,cycles,notes},null,2));
 await context.close();
}catch(e){writeFileSync(`${out}/failure.json`,JSON.stringify({message:e.message,checks},null,2));throw e;}finally{await browser.close();}
