// Real Chromium + real frontend/handlers, synthetic facts, MOCK Kakao only; no production requests.
// E2E_PORT=5198 PLAYWRIGHT_PATH=/tmp/map-browser-test/node_modules/playwright-core PW_CHROMIUM=/opt/google/chrome/chrome node scripts/browser/verify_release_map_20261013.mjs <evidence-dir>
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, openPage, api } from './harness.mjs';
const dir = process.argv[2] || '/tmp/map-release-browser';
mkdirSync(dir,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.PW_CHROMIUM,args:['--no-sandbox']});
const evidence={browser:browser.version(), data:'synthetic facts / real handlers / MOCK Kakao', checks:[], requests:[], errors:[]};
async function scenario(name, task) {
  await api('reset');
  const session=await openPage(browser,{search:'?screen=statistics&start=2025-10-01&end=2026-09-30'});
  try {
    await session.page.waitForSelector('.pivot-table');
    await task(session.page);
    await session.page.evaluate(() => new Promise(resolve => setTimeout(resolve, 350)));
    evidence.checks.push({name,pass:true});
  } catch(e) {evidence.checks.push({name,pass:false,error:String(e)});}
  await session.page.screenshot({path:join(dir,`${name}.png`),fullPage:true});
  evidence.errors.push(...session.consoleErrors);
  await session.context.close();
}
// Bound the fixture page size to one row so an ordinary real-handler result exercises collection and turns.
async function smallPages(page) {
  await page.route('**/statistics/query?**',async route=>{
    const url=new URL(route.request().url());
    const offset=Number(url.searchParams.get('row_cursor'));
    const upstream=new URL(url);upstream.searchParams.set('row_cursor','0');
    const response=await route.fetch({url:upstream.toString()});
    const rec={params:Object.fromEntries(url.searchParams),status:response.status()};
    evidence.requests.push(rec);
    if(response.status()!==200) return route.fulfill({response});
    const r=await response.json();
    const members=r.row_members.slice(offset,offset+1);
    const keys=new Set(members.map(m=>JSON.stringify(m.key)));
    return route.fulfill({response,json:{...r,row_members:members,
      cells:r.cells.filter(c=>keys.has(JSON.stringify(c.row))), row_totals:r.row_totals.filter(t=>keys.has(JSON.stringify(t.key))),
      row_page:{offset,limit:1,total:r.row_members.length,has_more:offset+1<r.row_members.length}}});
  });
  // Sorting starts a fresh page-zero run through the route above.
  const done=page.waitForResponse(r=>r.url().includes('/statistics/query?'));
  await page.locator('.pivot-sort').first().click();await done;
  await page.waitForFunction(()=>!document.querySelector('.stats-result .panel-status'));
}
await scenario('P1-collection-pins-version',async page=>{
  await smallPages(page);
  const start=evidence.requests.length;
  await page.getByRole('button',{name:'그래프',exact:true}).click();
  await page.waitForSelector('.stats-chart .chart-host, .pivot-chart .chart-host, .stats-result canvas',{timeout:30000});
  await page.waitForFunction(()=>document.querySelector('.stats-chart-host')?.__chart?.getOption()?.series?.[0]?.data?.length>0);
  const rows=await page.locator('.stats-chart-host').evaluate(el=>el.__chart.getOption().yAxis[0].data.length);
  assert.equal(rows,10);
  const follow=evidence.requests.slice(start);
  assert(follow.length>0);
  for(const r of follow){assert.equal(r.params.expected_version,'e2e-synthetic-1');assert.equal(r.params.consistency,undefined);assert.equal(r.status,200);}
});
await scenario('P1-version-change-stops-page-turn',async page=>{
  await smallPages(page);
  await api('version',{version:'e2e-synthetic-2'});
  const response=page.waitForResponse(r=>r.url().includes('/statistics/query?'));
  await page.getByRole('button',{name:'다음',exact:true}).click();
  assert.equal((await response).status(),409);
  await page.getByText('그사이 새 자료가 들어왔습니다.',{exact:false}).first().waitFor();
  const retry=page.waitForResponse(r=>r.url().includes('/statistics/query?'));
  await page.getByRole('button',{name:'통계 다시 만들기',exact:true}).click();
  const refreshed=await retry;
  assert.equal(refreshed.status(),200);
  assert.equal(new URL(refreshed.url()).searchParams.get('consistency'),'latest');
  assert.equal((await refreshed.json()).dataset_version,'e2e-synthetic-2');
});
await scenario('P2-removed-sort-metric',async page=>{
  let response=page.waitForResponse(r=>r.url().includes('/statistics/query?'));
  await page.locator('.pivot-sort').filter({hasText:'과태료 부과율'}).first().click();
  assert.equal((await response).status(),200);
  await page.waitForFunction(()=>!document.querySelector('.stats-result .panel-status'));
  await page.getByRole('button',{name:'과태료 부과율 빼기',exact:true}).click();
  response=page.waitForResponse(r=>r.url().includes('/statistics/query?'));
  await page.getByRole('button',{name:'통계 만들기',exact:true}).click();
  const r=await response;
  evidence.requests.push({params:Object.fromEntries(new URL(r.url()).searchParams),status:r.status()});
  assert.equal(r.status(),200);
  assert.equal(new URL(r.url()).searchParams.has('sort_metric'),false);
  await page.waitForFunction(()=>!document.querySelector('.stats-result .panel-status'));
  assert.equal(await page.locator('[aria-sort]').count(),0);
});
// Keep the actual chart data, not just its container, across a failed replacement query.
for (const failure of ['422', 'network']) {
  await scenario(`P2-chart-survives-${failure}`, async page => {
    await smallPages(page);
    await page.getByRole('button', {name:'그래프', exact:true}).click();
    await page.waitForFunction(() => document.querySelector('.stats-chart-host')?.__chart?.getOption()?.yAxis?.[0]?.data?.length === 10);
    const chartData = () => page.locator('.stats-chart-host').evaluate(el => {
      const o = el.__chart.getOption();
      return {x:o.xAxis, y:o.yAxis, series:o.series.map(s => s.data)};
    });
    const previous = await chartData();
    await page.getByRole('button', {name:'과태료 부과율 빼기', exact:true}).click();
    let release;
    const held = new Promise(resolve => { release = resolve; });
    let started;
    const requested = new Promise(resolve => { started = resolve; });
    const fail = async route => {
      started();
      await held;
      evidence.requests.push({params:Object.fromEntries(new URL(route.request().url()).searchParams), status:failure});
      if (failure === 'network') await route.abort('failed');
      else await route.fulfill({status:422, contentType:'application/json', body:JSON.stringify({error:'INVALID_QUERY', message:'회귀 시험: 조회 실패'})});
    };
    await page.route('**/statistics/query?**', fail);
    await page.getByRole('button', {name:'통계 만들기', exact:true}).click();
    await requested;
    // Record both assertions even on the old code, releasing the held request before failing the scenario.
    const loadingChartCount = await page.locator('.stats-chart-host').count();
    release();
    await page.getByText('아래는 이전 조건의 결과입니다.', {exact:false}).waitFor();
    assert.equal(await page.locator('.stats-chart-host').count(), 1, 'previous chart remains after failure');
    assert.equal(loadingChartCount, 1, 'previous chart remains while loading');
    assert.deepEqual(await chartData(), previous);
    await page.screenshot({path:join(dir,`P2-chart-survives-${failure}-error.png`),fullPage:true});
    // A successful retry must replace the old full merge with the new recipe's chart.
    await page.unroute('**/statistics/query?**', fail);
    const retry = page.waitForResponse(r => r.url().includes('/statistics/query?') && new URL(r.url()).searchParams.get('row_cursor') === '0');
    await page.getByRole('button', {name:'통계 만들기', exact:true}).click();
    assert.equal((await retry).status(), 200);
    await page.waitForFunction(old => {
      const o = document.querySelector('.stats-chart-host')?.__chart?.getOption();
      return o?.series?.[0]?.data?.length > 0 && JSON.stringify({x:o.xAxis, y:o.yAxis, series:o.series.map(s => s.data)}) !== old;
    }, JSON.stringify(previous));
    assert.notDeepEqual(await chartData(), previous, 'successful replacement renders new metric');
  });
}
// Regression: cancelling an incomplete merge must resume the APPLIED recipe after replacement failure.
await scenario('P2-interrupted-collection-resumes-after-failure', async page => {
  await smallPages(page);
  let release, started;
  const held = new Promise(resolve => { release = resolve; });
  const requested = new Promise(resolve => { started = resolve; });
  let intercepted = false;
  const pause = async route => {
    if (!intercepted && new URL(route.request().url()).searchParams.get('row_cursor') === '2') {
      intercepted = true;
      started();
      await held;
    }
    await route.fallback();
  };
  await page.route('**/statistics/query?**', pause);
  await page.getByRole('button', {name:'그래프', exact:true}).click();
  await requested; // page 1 is cached, page 2 is in flight
  const fail = route => new URL(route.request().url()).searchParams.get('row_cursor') === '0'
    ? route.fulfill({status:422, contentType:'application/json',
      body:JSON.stringify({error:'INVALID_QUERY', message:'회귀 시험: 조회 실패'})})
    : route.fallback();
  await page.route('**/statistics/query?**', fail);
  await page.getByRole('button', {name:'과태료 부과율 빼기', exact:true}).click();
  await page.getByRole('button', {name:'통계 만들기', exact:true}).click();
  // Only the new first-page query fails; recovery pages go through the original real handler.
  release();
  await page.getByText('아래는 이전 조건의 결과입니다.', {exact:false}).waitFor();
  await page.unroute('**/statistics/query?**', fail);
  await page.waitForFunction(() => document.querySelector('.stats-chart-host')?.__chart?.getOption()?.yAxis?.[0]?.data?.length === 10, null, {timeout:5000});
  const last = evidence.requests.at(-1);
  assert.equal(last.params.expected_version, 'e2e-synthetic-1');
  assert(JSON.parse(last.params.spec).metrics.includes('fine_rate'), 'recovery uses applied metrics, not failed draft');
});

await scenario('P2-visibility-resume-failure-restores-chart', async page => {
  await smallPages(page);
  await page.getByRole('button', {name:'그래프', exact:true}).click();
  await page.waitForFunction(() => document.querySelector('.stats-chart-host')?.__chart?.getOption()?.yAxis?.[0]?.data?.length === 10);
  const chartData = () => page.locator('.stats-chart-host').evaluate(el => {
    const o = el.__chart.getOption();
    return {x:o.xAxis, y:o.yAxis, series:o.series.map(s => s.data)};
  });
  const previous = await chartData();
  let release, started;
  const held = new Promise(resolve => { release = resolve; });
  const requested = new Promise(resolve => { started = resolve; });
  let attempts = 0;
  const fail = async route => {
    attempts += 1;
    if (attempts === 1) { started(); await held; }
    await route.fulfill({status:422, contentType:'application/json',
      body:JSON.stringify({error:'INVALID_QUERY', message:'회귀 시험: 재개 실패'})});
  };
  await page.route('**/statistics/query?**', fail);
  await page.getByRole('button', {name:'과태료 부과율 빼기', exact:true}).click();
  await page.getByRole('button', {name:'통계 만들기', exact:true}).click();
  await requested;
  // Headless Chromium visibility is injected; the real component's visibility listener handles it.
  const visibility = hidden => page.evaluate(value => {
    Object.defineProperty(document, 'hidden', {configurable:true, value});
    Object.defineProperty(document, 'visibilityState', {configurable:true, value:value ? 'hidden' : 'visible'});
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
  await visibility(true);
  assert.equal(attempts, 1, 'no replacement request while hidden');
  await visibility(false);
  await page.getByText('아래는 이전 조건의 결과입니다.', {exact:false}).waitFor();
  release();
  assert.equal(attempts, 2, 'suspended query resumes once');
  await page.waitForFunction(() => document.querySelector('.stats-chart-host')?.__chart?.getOption()?.yAxis?.[0]?.data?.length === 10, null, {timeout:5000});
  assert.deepEqual(await chartData(), previous, 'cached pages restore the same complete chart');
});
await browser.close();
writeFileSync(join(dir,'report.json'),JSON.stringify(evidence,null,2));
console.log(JSON.stringify(evidence.checks));
assert(evidence.checks.every(c=>c.pass));
