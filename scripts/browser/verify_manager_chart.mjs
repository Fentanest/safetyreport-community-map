// Browser acceptance for 담당자별 처리 현황 (2026-09-30): 동명이인 labels + '1–8 / N명' navigation over ONE dataZoom state.
// LOCAL stack only: real frontend (Vite dev) + real server/publicHandler.ts over SYNTHETIC facts (demoEngine.managersFacts:
// 118 managers at one address; 김지원 4th = 서울강서경찰서 and 105th = 서울양천경찰서, beyond the first 100) + MOCK Kakao SDK.
//   E2E server:  E2E_PORT=5190 npx vite --config scripts/browser/vite.e2e.config.ts
//   run:         LANG=C.UTF-8 node scripts/browser/verify_manager_chart.mjs <dir>
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, openPage, waitMap, api, sleep, summarizeLog } from './harness.mjs';
import { createRun, captureConsole, waitFor } from './assert.mjs';
import { inspect } from '../xlsx/ooxml.mjs';

const dir = process.argv[2] || 'evidence';
mkdirSync(join(dir, 'shots'), { recursive: true });
mkdirSync(join(dir, 'files'), { recursive: true });
const browser = await chromium.launch({ args: ['--lang=ko-KR'], env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } });
const IDS = ['MC-NAME-FIRST', 'MC-NAME-FAR', 'MC-NAME-ORDINAL', 'MC-TIP-BAR', 'MC-TIP-AXIS', 'MC-TIP-TOUCH',
  'MC-NAV-FIRST', 'MC-NAV-STEP', 'MC-NAV-SLIDER', 'MC-NAV-SMALL', 'MC-LOAD-SCOPE', 'MC-LOAD-FAIL', 'MC-LOAD-PLACE', 'MC-LOAD-NOAUTO',
  'MC-MODE-KEEP', 'MC-SCOPE-RESET', 'MC-SCOPE-LATE', 'MC-TABLE', 'MC-EXCEL', 'MC-LEAK', 'MC-LAYOUT', 'MC-ESC'];
const run = createRun({ dir, suite: 'manager-chart', ids: IDS, meta: {
  browser: `chromium ${browser.version()}`, sdk: 'MOCK (scripts/browser/mock-kakao-sdk.js)', data: 'synthetic (demoEngine.managersFacts, 118 managers)',
  server: 'local Vite middleware running server/publicHandler.ts (Node, not Edge Runtime)' } });
const { check, step } = run;
const SCOPE = '?date_basis=completed_date&start=2026-06-01&end=2026-09-24&category=all';
const log = async () => api('log');

async function fresh(ctx, opts = {}) {
  await api('reset');
  await api('dataset', { name: 'managers' });
  const s = await openPage(browser, { height: 1100, search: SCOPE, ...opts });
  captureConsole(s.page, ctx);
  await waitMap(s.page);
  return s;
}
const card = (page) => page.locator('.place-entity-chart');
async function scopeChart(page) {
  await page.waitForSelector('.place-entity-chart .chart-host', { timeout: 20000 });
  const c = card(page);
  await c.scrollIntoViewIfNeeded();
  await waitFor(() => zoomOf(page), (z) => z && z.length > 0, { timeout: 8000 });
  return c;
}
/** the chart's own dataZoom (the one state) and what the card says */
const zoomOf = (page) => page.evaluate(() => {
  const c = document.querySelector('.place-entity-chart .chart-host')?.__chart;
  if (!c) return null;
  return (c.getOption()?.dataZoom ?? []).map((d) => [d.startValue, d.endValue]);
});
const rangeTextOf = (page) => card(page).locator('.pe-nav-range').innerText();
// null while a freshly mounted instance has no option yet (the option lands one effect later)
const axisOf = (page) => page.evaluate(() => document.querySelector('.place-entity-chart .chart-host')?.__chart?.getOption()?.xAxis[0].data ?? null);
/** the axis labels ECharts actually draws right now (formatted text, in order) */
const drawnLabels = (page) => page.evaluate(() => document.querySelector('.place-entity-chart .chart-host').__chart
  .getModel().getComponent('xAxis', 0).axis.getViewLabels().map((l) => l.formattedLabel.replace('\n', ' ')));
const nextBtn = (page) => card(page).getByRole('button', { name: '다음 담당자 8명' });
const prevBtn = (page) => card(page).getByRole('button', { name: '이전 담당자 8명' });
const moreBtn = (page) => card(page).locator('.pe-nav-more');
const counters = (page) => page.evaluate(() => ({ live: window.__cmChartLive, observers: window.__cmChartObservers, zoom: window.__cmChartZoomListeners,
  charts: document.querySelectorAll('.chart-host').length }));
const toEnd = async (page) => { for (let i = 0; i < 20 && await nextBtn(page).count() && await nextBtn(page).isEnabled(); i++) { await nextBtn(page).click(); await sleep(60); } };
/** hover a category (bar middle) and return the tooltip text */
async function hoverCategory(page, index) {
  const pt = await page.evaluate((i) => {
    const host = document.querySelector('.place-entity-chart .chart-host');
    const c = host.__chart;
    const [x, y] = c.convertToPixel({ gridIndex: 0 }, [i, 50]);
    const r = host.getBoundingClientRect();
    return { x: r.left + x, y: r.top + y };
  }, index);
  await page.mouse.move(pt.x, pt.y);
  await sleep(350);
  return page.evaluate(() => [...document.querySelectorAll('.place-entity-chart .chart-host > div')].map((d) => d.innerText).filter((t) => t && t.includes('답변')).join('\n'));
}

try {
  await step('names-first', ['MC-NAME-FIRST', 'MC-NAV-FIRST', 'MC-TIP-BAR', 'MC-TIP-AXIS', 'MC-LOAD-NOAUTO'], async (ctx) => {
    const { page, context } = await fresh(ctx);
    const c = await scopeChart(page);
    const axis = await axisOf(page);
    check('MC-NAME-FIRST', '4th manager: 김지원 carries 서울강서경찰서 though the other 김지원 is 105th (not loaded)', axis[3], '김지원 (서울강서경찰서)');
    check('MC-NAME-FIRST', 'unique names carry no agency', axis.filter((a) => a.includes('(')).length, 5);
    check('MC-NAME-FIRST', '100 loaded', axis.length, 100);
    check('MC-NAV-FIRST', 'range text', await rangeTextOf(page), '담당자 1–8 / 불러온 100명 · 전체 118명');
    check('MC-NAV-FIRST', 'chart dataZoom = 0..7 (both components)', await zoomOf(page), [[0, 7], [0, 7]]);
    check('MC-NAV-FIRST', 'prev disabled, next enabled', [await prevBtn(page).isDisabled(), await nextBtn(page).isEnabled()], [true, true]);
    check('MC-NAME-FIRST', 'namesake note under the chart', await c.locator('.pe-namesake').innerText(), (t) => t.includes('김지원 2명: 서울강서경찰서 · 서울양천경찰서'));
    await c.screenshot({ path: join(dir, 'shots', 'first-window-1440-dark.png') });
    const tip = await hoverCategory(page, 3);
    check('MC-TIP-BAR', 'bar tooltip: name, full agency, why, namesakes', tip, (t) => t.includes('김지원') && t.includes('서울특별시경찰청 서울강서경찰서')
      && t.includes('동명이인 구분을 위해 소속 기관을 함께 표시합니다.') && t.includes('같은 이름의 담당자 2명: 서울강서경찰서, 서울양천경찰서'));
    await c.screenshot({ path: join(dir, 'shots', 'tooltip-bar-kim-1440-dark.png') });
    const tipOther = await hoverCategory(page, 0);
    check('MC-TIP-BAR', 'a unique name: no namesake text', tipOther, (t) => !t.includes('동명이인') && t.includes('서울특별시경찰청'));
    // axis label (canvas text): hover the label area under the 4th bar → the same tooltip
    await page.mouse.move(5, 5);
    await sleep(300);
    const lab = await page.evaluate(() => {
      const host = document.querySelector('.place-entity-chart .chart-host');
      const c = host.__chart;
      const [x, y0] = c.convertToPixel({ gridIndex: 0 }, [3, 0]);
      const r = host.getBoundingClientRect();
      return { x: r.left + x - 6, y: r.top + y0 + 14 };
    });
    await page.mouse.move(lab.x, lab.y);
    await sleep(400);
    const tipAxis = await page.evaluate(() => [...document.querySelectorAll('.place-entity-chart .chart-host > div')].map((d) => d.innerText).filter((t) => t.includes('답변')).join('\n'));
    check('MC-TIP-AXIS', 'axis-label hover shows the namesake tooltip', tipAxis, (t) => t.includes('동명이인 구분을 위해') && t.includes('서울특별시경찰청 서울강서경찰서'));
    await c.screenshot({ path: join(dir, 'shots', 'tooltip-axis-kim-1440-dark.png') });
    const l = await log();
    check('MC-LOAD-NOAUTO', 'no extra manager page requested without a click', l.filter((e) => e.route === 'entities' && e.params.kind === 'manager').length, 0);
    await context.close();
  });

  await step('nav-step-slider', ['MC-NAV-STEP', 'MC-NAV-SLIDER', 'MC-MODE-KEEP', 'MC-NAME-ORDINAL'], async (ctx) => {
    const { page, context } = await fresh(ctx);
    const c = await scopeChart(page);
    await nextBtn(page).click();
    await waitFor(() => rangeTextOf(page), (t) => t.startsWith('담당자 9–16'));
    check('MC-NAV-STEP', 'next → 9–16', [await rangeTextOf(page), await zoomOf(page)], ['담당자 9–16 / 불러온 100명 · 전체 118명', [[8, 15], [8, 15]]]);
    check('MC-NAV-STEP', 'the drawn axis names are categories 9–16', JSON.stringify(await drawnLabels(page)), JSON.stringify((await axisOf(page)).slice(8, 16)));
    await prevBtn(page).click();
    await waitFor(() => rangeTextOf(page), (t) => t.startsWith('담당자 1–8'));
    check('MC-NAV-STEP', 'prev → 1–8, prev disabled again', [await rangeTextOf(page), await prevBtn(page).isDisabled()], ['담당자 1–8 / 불러온 100명 · 전체 118명', true]);
    for (let i = 0; i < 3; i++) await nextBtn(page).click();
    await waitFor(() => rangeTextOf(page), (t) => t.startsWith('담당자 25–32'));
    const axis = await axisOf(page);
    check('MC-NAME-ORDINAL', 'same agency name, two identities → ordinal, never merged', [axis[29], axis[30]], ['정민호 (서울마포경찰서 1번)', '정민호 (서울마포경찰서 2번)']);
    check('MC-NAME-ORDINAL', 'note says they are told apart by number', await c.locator('.pe-namesake').innerText(), (t) => t.includes('번호로 구분'));
    await sleep(500); // let the dataZoom transition finish before the capture
    await c.screenshot({ path: join(dir, 'shots', 'ordinal-25-32-1440-dark.png') });
    // mode: the window stays
    await c.getByLabel('과태료 부과율').check();
    await sleep(300);
    check('MC-MODE-KEEP', 'fine mode keeps 25–32', [await rangeTextOf(page), await zoomOf(page)], ['담당자 25–32 / 불러온 100명 · 전체 118명', [[24, 31], [24, 31]]]);
    await c.getByLabel('수용률').check();
    await sleep(300);
    check('MC-MODE-KEEP', 'accept mode again keeps 25–32', await zoomOf(page), [[24, 31], [24, 31]]);
    // slider drag: the text follows the chart's own window
    const geo = await page.evaluate(() => {
      const host = document.querySelector('.place-entity-chart .chart-host');
      const c = host.__chart;
      const rect = c.getModel().getComponent('grid', 0).coordinateSystem.getRect();
      const z = c.getOption().dataZoom[1];
      const r = host.getBoundingClientRect();
      return { x: r.left + rect.x + rect.width * ((z.start + z.end) / 200), y: r.bottom - 6 - 7, w: rect.width };
    });
    await page.mouse.move(geo.x, geo.y);
    await page.mouse.down();
    await page.mouse.move(geo.x + geo.w * 0.2, geo.y, { steps: 12 });
    await page.mouse.up();
    await sleep(400);
    const z = await zoomOf(page);
    const txt = await rangeTextOf(page);
    check('MC-NAV-SLIDER', 'slider moved the window', z[0][0], (v) => v > 30);
    check('MC-NAV-SLIDER', 'range text = chart window (1-based)', txt, `담당자 ${z[0][0] + 1}–${z[0][1] + 1} / 불러온 100명 · 전체 118명`);
    ctx.note('afterDrag', { z, txt });
    await c.screenshot({ path: join(dir, 'shots', 'after-slider-drag-1440-dark.png') });
    // a button after a drag continues from the chart's window (one state)
    await nextBtn(page).click();
    await sleep(300);
    const z2 = await zoomOf(page);
    check('MC-NAV-SLIDER', 'next after drag starts right after the dragged window', z2[0][0], z[0][1] + 1);
    check('MC-NAV-SLIDER', 'text follows', await rangeTextOf(page), `담당자 ${z2[0][0] + 1}–${z2[0][1] + 1} / 불러온 100명 · 전체 118명`);
    check('MC-NAV-SLIDER', 'drawn axis names follow the window', JSON.stringify(await drawnLabels(page)), JSON.stringify((await axisOf(page)).slice(z2[0][0], z2[0][1] + 1)));
    await context.close();
  });

  await step('load-scope', ['MC-LOAD-SCOPE', 'MC-NAME-FAR', 'MC-TABLE'], async (ctx) => {
    const { page, context } = await fresh(ctx);
    const c = await scopeChart(page);
    await toEnd(page);
    check('MC-LOAD-SCOPE', 'end of the loaded list', await rangeTextOf(page), '담당자 97–100 / 불러온 100명 · 전체 118명');
    check('MC-LOAD-SCOPE', 'next replaced by load-rest', [await nextBtn(page).count(), await moreBtn(page).innerText()], [0, '나머지 18명 불러오기']);
    await c.screenshot({ path: join(dir, 'shots', 'end-of-loaded-1440-dark.png') });
    await api('delay', { entities: 1500 });
    const n0 = (await log()).length;
    await moreBtn(page).click();
    await sleep(300);
    check('MC-LOAD-SCOPE', 'loading: button says so, chart and range stay', [await moreBtn(page).innerText(), await moreBtn(page).isDisabled(),
      await c.locator('.chart-host').isVisible(), await rangeTextOf(page)], ['불러오는 중…', true, true, '담당자 97–100 / 불러온 100명 · 전체 118명']);
    await c.screenshot({ path: join(dir, 'shots', 'loading-more-1440-dark.png') });
    await waitFor(() => rangeTextOf(page), (t) => t.includes('/ 118명'), { timeout: 8000 });
    const req = (await log()).slice(n0).filter((e) => e.route === 'entities');
    check('MC-LOAD-SCOPE', 'one click → the existing server pages (1 and 2, 100 each)', req.map((e) => [e.params.kind, e.params.page, e.params.page_size]), [['manager', '1', '100'], ['manager', '2', '100']]);
    check('MC-LOAD-SCOPE', 'window kept after the list grew', [await rangeTextOf(page), await zoomOf(page)], ['담당자 97–100 / 118명', [[96, 99], [96, 99]]]);
    await nextBtn(page).click();
    await waitFor(() => rangeTextOf(page), (t) => t.startsWith('담당자 101–108'));
    const axis = await axisOf(page);
    check('MC-NAME-FAR', '105th: the other 김지원 with 서울양천경찰서', axis[104], '김지원 (서울양천경찰서)');
    check('MC-NAME-FAR', 'the 4th keeps its label', axis[3], '김지원 (서울강서경찰서)');
    check('MC-NAME-FAR', 'drawn axis names are 101–108 (incl. 김지원 (서울양천경찰서) on two lines)', JSON.stringify(await drawnLabels(page)), JSON.stringify(axis.slice(100, 108)));
    await sleep(500);
    await c.screenshot({ path: join(dir, 'shots', 'far-namesake-101-108-1440-dark.png') });
    await nextBtn(page).click();
    await sleep(200);
    check('MC-LOAD-SCOPE', '109–116', await rangeTextOf(page), '담당자 109–116 / 118명');
    await nextBtn(page).click();
    await sleep(200);
    check('MC-LOAD-SCOPE', 'last window 117–118, next disabled, nothing more to load', [await rangeTextOf(page), await nextBtn(page).isDisabled(), await moreBtn(page).count()], ['담당자 117–118 / 118명', true, 0]);
    // table: the same names, all 118 rows
    await c.getByRole('button', { name: '표로 보기' }).click();
    await sleep(200);
    const cells = await c.locator('tbody tr td:first-child').allInnerTexts();
    check('MC-TABLE', 'table rows = loaded rows', cells.length, 118);
    check('MC-TABLE', 'table names = chart names', JSON.stringify(cells), JSON.stringify(axis));
    check('MC-TABLE', 'table range text', await c.locator('.pe-nav-range').innerText(), '표: 담당자 118명');
    await c.screenshot({ path: join(dir, 'shots', 'table-118-1440-dark.png') });
    await context.close();
  });

  await step('load-fail', ['MC-LOAD-FAIL'], async (ctx) => {
    const { page, context } = await fresh(ctx);
    const c = await scopeChart(page);
    await toEnd(page);
    await api('inject', { route: 'entities', status: 503, times: 1 });
    await moreBtn(page).click();
    await waitFor(() => c.locator('.pe-nav-error').count(), (n) => n > 0, { timeout: 8000 });
    check('MC-LOAD-FAIL', 'error shown, the 100 stay, same window', [await c.locator('.pe-nav-error').innerText(), await rangeTextOf(page), (await axisOf(page)).length],
      ['담당자를 더 불러오지 못했습니다. 지금 보이는 100명은 그대로입니다.', '담당자 97–100 / 불러온 100명 · 전체 118명', 100]);
    check('MC-LOAD-FAIL', 'retry button', await moreBtn(page).innerText(), '다시 시도');
    await sleep(400);
    await c.screenshot({ path: join(dir, 'shots', 'load-failed-1440-dark.png') });
    const n0 = (await log()).length;
    await moreBtn(page).click();
    await waitFor(() => rangeTextOf(page), (t) => t.includes('/ 118명'), { timeout: 8000 });
    const pages = (await log()).slice(n0).filter((e) => e.route === 'entities').map((e) => e.params.page);
    check('MC-LOAD-FAIL', 'retry asks the same pages again (not one page further)', pages, (p) => p.at(-1) === '2' && !p.includes('3'));
    check('MC-LOAD-FAIL', 'after retry: 118, window kept', await rangeTextOf(page), '담당자 97–100 / 118명');
    await context.close();
  }, { expectedConsole: [/503|Service Unavailable|Failed to load resource/] });

  await step('load-place', ['MC-LOAD-PLACE'], async (ctx) => {
    const { page, context } = await fresh(ctx);
    await page.evaluate(() => { const m = window.__kakaoMaps[window.__kakaoMaps.length - 1]; m.setCenter(new kakao.maps.LatLng(37.5509, 126.8495)); m.setLevel(2); });
    await sleep(2000);
    await page.evaluate(() => {
      const ms = window.__kakaoLiveMarkers().filter((m) => !m.title.includes('묶음'));
      ms.sort((a, b) => Math.hypot(a.lat - 37.5509, a.lng - 126.8495) - Math.hypot(b.lat - 37.5509, b.lng - 126.8495))[0].marker.__click();
    });
    await page.waitForSelector('.place-entity-chart h2:has-text("이 주소")', { timeout: 15000 });
    const c = await scopeChart(page);
    check('MC-LOAD-PLACE', 'address chart: first 100 of 118', await rangeTextOf(page), '담당자 1–8 / 불러온 100명 · 전체 118명');
    check('MC-LOAD-PLACE', 'namesake label from the address list metadata', (await axisOf(page))[3], '김지원 (서울강서경찰서)');
    await toEnd(page);
    await api('delay', { 'places/:key': 1500 });
    const n0 = (await log()).length;
    await moreBtn(page).click();
    await sleep(400);
    check('MC-LOAD-PLACE', 'while loading the chart and the address panel stay', [await c.locator('.chart-host').isVisible(), await page.locator('.place-panel .place-entities .pe-row').count() > 0,
      await moreBtn(page).innerText()], [true, true, '불러오는 중…']);
    await waitFor(() => rangeTextOf(page), (t) => t.includes('/ 118명'), { timeout: 8000 });
    const req = (await log()).slice(n0).filter((e) => e.route === 'places/:key');
    check('MC-LOAD-PLACE', 'one request with entity_limit=118', req.map((e) => e.params.entity_limit), ['118']);
    check('MC-LOAD-PLACE', 'window kept (not back to 1–8)', await rangeTextOf(page), '담당자 97–100 / 118명');
    await api('delay', {});
    await context.close();
  });

  await step('scope-reset-late', ['MC-SCOPE-RESET', 'MC-SCOPE-LATE'], async (ctx) => {
    const { page, context } = await fresh(ctx);
    await scopeChart(page);
    await nextBtn(page).click();
    await nextBtn(page).click();
    await waitFor(() => rangeTextOf(page), (t) => t.startsWith('담당자 17–24'));
    await page.getByLabel('날짜 기준').first().selectOption('report_date');
    await waitFor(() => rangeTextOf(page).catch(() => ''), (t) => t.startsWith('담당자 1–8'), { timeout: 10000 });
    check('MC-SCOPE-RESET', 'a new scope starts at 1–8', await rangeTextOf(page), (t) => t.startsWith('담당자 1–8 / 불러온 100명'));
    // late response: the load-more of the OLD scope lands after the scope changed → must not show up
    await toEnd(page);
    await api('delay', { entities: 2500 });
    await moreBtn(page).click();
    await sleep(200);
    await api('delay', {});
    // narrow the scope to one agency (서울강서경찰서): only one 김지원 left there → no agency on the name
    const panel = page.locator('.scope-panel section[aria-label="처리 기관"]');
    await panel.getByLabel('기관 이름 검색').fill('강서경찰서');
    await waitFor(() => panel.locator('.pe-pick', { hasText: '서울강서경찰서' }).count(), (n) => n > 0, { timeout: 8000 });
    await panel.locator('.pe-pick', { hasText: '서울강서경찰서' }).first().click();
    await waitFor(async () => (await card(page).count()) && (await card(page).locator('.chart-host').isVisible()) ? axisOf(page) : null, (a) => Array.isArray(a) && a.length === 1, { timeout: 10000 });
    await sleep(3000); // the old scope's delayed page would have landed by now
    const axis = await axisOf(page);
    check('MC-SCOPE-LATE', 'the late page of the old scope did not replace the new list', axis, ['김지원']);
    check('MC-SCOPE-RESET', 'duplicate state recomputed for the new scope (one 김지원 → plain name, no note)', [axis[0], await card(page).locator('.pe-namesake').count()], ['김지원', 0]);
    check('MC-SCOPE-RESET', 'no nav for one manager', await card(page).locator('.pe-nav').count(), 0);
    await card(page).screenshot({ path: join(dir, 'shots', 'scope-one-agency-1440-dark.png') });
    await context.close();
  });

  await step('small-lists', ['MC-NAV-SMALL'], async (ctx) => {
    const { page, context } = await fresh(ctx);
    await scopeChart(page);
    // 3 managers: search the manager list is a list filter, not the chart scope; use an agency with few managers instead
    const panel = page.locator('.scope-panel section[aria-label="처리 기관"]');
    await panel.getByLabel('기관 이름 검색').fill('서울강남경찰서');
    await waitFor(() => panel.locator('.pe-pick', { hasText: '서울강남경찰서' }).count(), (n) => n > 0, { timeout: 8000 });
    await panel.locator('.pe-pick', { hasText: '서울강남경찰서' }).first().click();
    await waitFor(async () => (await card(page).count()) ? axisOf(page).catch(() => null) : null, (a) => Array.isArray(a) && a.length > 1 && a.length < 30, { timeout: 10000 });
    const n = (await axisOf(page)).length;
    ctx.note('managersInAgency', n);
    check('MC-NAV-SMALL', `${n} managers (≤ 16): nav reflects the size`, await card(page).locator('.pe-nav').count() > 0 ? await rangeTextOf(page) : 'none',
      n > 8 ? `담당자 1–8 / ${n}명` : 'none');
    if (n > 8) {
      await nextBtn(page).click();
      await sleep(200);
      check('MC-NAV-SMALL', 'next → 9–n, then disabled', [await rangeTextOf(page), await nextBtn(page).isDisabled()], [`담당자 9–${n} / ${n}명`, true]);
    }
    await card(page).screenshot({ path: join(dir, 'shots', `small-agency-${n}-1440-dark.png`) });
    await context.close();
  });

  await step('excel', ['MC-EXCEL'], async (ctx) => {
    const { page, context } = await fresh(ctx);
    const c = await scopeChart(page);
    const downloads = [];
    page.on('download', (d) => downloads.push(d));
    await c.locator('.export-btn').click();
    await waitFor(() => page.evaluate(() => window.__cmExport?.snapshot().status), (x) => x === 'ready' || x === 'error', { timeout: 60000 });
    let d = downloads.at(-1);
    if (!d) { [d] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), c.locator('.export-ready .mini-btn').click()]); }
    const path = join(dir, 'files', 'managers-100-of-118.xlsx');
    await d.saveAs(path);
    const x = inspect(readFileSync(path));
    const values = Object.values(x.sheets['통계표'].cells).map((v) => String(v.value ?? ''));
    check('MC-EXCEL', 'name cells = chart names', ['김지원 (서울강서경찰서)', '박서준 (서울중부경찰서)', '정민호 (서울마포경찰서 1번)', '정민호 (서울마포경찰서 2번)'].map((s) => values.includes(s)), [true, true, true, true]);
    check('MC-EXCEL', 'agency column keeps the official name', values.includes('서울특별시경찰청 서울강서경찰서'), true);
    check('MC-EXCEL', 'note explains the short agency on namesakes', values.some((v) => v.includes('소속 기관을 짧게')), true);
    await context.close();
  });

  await step('leak-esc-touch', ['MC-LEAK', 'MC-ESC', 'MC-TIP-TOUCH'], async (ctx) => {
    const { page, context } = await fresh(ctx);
    await scopeChart(page);
    await sleep(500);
    const before = await counters(page);
    for (let i = 0; i < 15; i++) { await nextBtn(page).click(); await prevBtn(page).click(); }
    for (let i = 0; i < 30; i++) { if (await nextBtn(page).count() && await nextBtn(page).isEnabled()) await nextBtn(page).click(); }
    for (let i = 0; i < 30; i++) { if (await prevBtn(page).isEnabled()) await prevBtn(page).click(); }
    for (let i = 0; i < 20; i++) { await card(page).getByLabel(i % 2 ? '수용률' : '과태료 부과율').check(); }
    await sleep(400);
    const mid = await counters(page);
    check('MC-LEAK', '30 next/prev (+ 12 more each way) + 20 mode switches: no new chart instance / listener / observer', [mid.live, mid.zoom, mid.observers], [before.live, before.zoom, before.observers]);
    for (let i = 0; i < 10; i++) {
      await page.getByLabel('날짜 기준').first().selectOption(i % 2 ? 'completed_date' : 'report_date');
      await waitFor(() => rangeTextOf(page).catch(() => ''), (t) => t.startsWith('담당자 1–8'), { timeout: 10000 });
    }
    await sleep(600);
    const after = await counters(page);
    ctx.note('counters', { before, mid, after });
    check('MC-LEAK', '10 scope changes: instances = mounted chart hosts, listeners = instances', [after.live === before.live, after.zoom === after.live, after.observers === before.observers], [true, true, true]);
    await hoverCategory(page, 3);
    await page.keyboard.press('Escape');
    await sleep(200);
    check('MC-ESC', 'Esc with a tooltip open: no error, card intact', await rangeTextOf(page), (t) => t.startsWith('담당자 1–8'));
    await context.close();
    // touch: a tap on a bar / on the name opens the explanation
    const t = await openPage(browser, { width: 390, height: 844, search: SCOPE });
    captureConsole(t.page, ctx);
    await waitMap(t.page);
    await scopeChart(t.page);
    const pt = await t.page.evaluate(() => {
      const host = document.querySelector('.place-entity-chart .chart-host');
      const [x, y] = host.__chart.convertToPixel({ gridIndex: 0 }, [3, 50]);
      const r = host.getBoundingClientRect();
      return { x: r.left + x, y: r.top + y };
    });
    await t.page.mouse.click(pt.x, pt.y);
    await sleep(400);
    const tip = await t.page.evaluate(() => [...document.querySelectorAll('.place-entity-chart .chart-host > div')].map((d) => d.innerText).filter((x) => x.includes('답변')).join('\n'));
    check('MC-TIP-TOUCH', '390px tap: namesake tooltip', tip, (x) => x.includes('동명이인 구분을 위해'));
    await card(t.page).screenshot({ path: join(dir, 'shots', 'tap-tooltip-390-dark.png') });
    await t.context.close();
  });

  await step('layout', ['MC-LAYOUT'], async (ctx) => {
    for (const theme of ['dark', 'light']) {
      for (const width of [1920, 1440, 1280, 768, 390]) {
        await api('reset');
        await api('dataset', { name: 'managers' });
        const s = await openPage(browser, { width, height: 1000, theme, search: SCOPE });
        captureConsole(s.page, ctx);
        await waitMap(s.page);
        const c = await scopeChart(s.page);
        await sleep(400);
        const m = await s.page.evaluate(() => {
          const el = document.querySelector('.place-entity-chart');
          const nav = el.querySelector('.pe-nav').getBoundingClientRect();
          const btns = [...el.querySelectorAll('.pe-nav button')].map((b) => b.getBoundingClientRect());
          const host = el.querySelector('.chart-host').getBoundingClientRect();
          return { pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            cardOverflow: el.scrollWidth - el.clientWidth, navInCard: nav.left >= el.getBoundingClientRect().left - 1 && nav.right <= el.getBoundingClientRect().right + 1,
            navBelowChart: nav.top >= host.bottom - 1, minBtnH: Math.min(...btns.map((b) => b.height)) };
        });
        check('MC-LAYOUT', `${width} ${theme}: no overflow, nav inside the card under the chart, buttons ≥ 32px`, [m.pageOverflow <= 0, m.cardOverflow <= 0, m.navInCard, m.navBelowChart, m.minBtnH >= 32], [true, true, true, true, true]);
        await c.screenshot({ path: join(dir, 'shots', `card-${width}-${theme}.png`) });
        await s.context.close();
      }
    }
  });
} finally {
  run.finish();
  await browser.close();
}
