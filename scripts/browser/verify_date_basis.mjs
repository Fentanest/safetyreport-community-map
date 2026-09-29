// Assertion run for date-basis-dashboard (U01–U05) on the LOCAL stack: real frontend (Vite dev) + real
// server/publicHandler.ts and server/personalHandler.ts over SYNTHETIC facts (the synthetic year, or the cohort oracle
// via /__e2e/dataset) + MOCK Kakao SDK. The .xlsx is produced by excelize-wasm in Chromium.
// NOT a real-SDK, real-Supabase, Edge Runtime, Excel or production check.
//   E2E server:  E2E_PORT=5190 npx vite --config scripts/browser/vite.e2e.config.ts
//   run:         LANG=C.UTF-8 node scripts/browser/verify_date_basis.mjs <dir>
//   ONLY=<step>,… → other steps NOT_RUN · SELFTEST_WRONG='<ID>:<label>' → the run must exit 1
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, openPage, waitMap, api, sleep, E2E_UID } from './harness.mjs';
import { createRun, captureConsole, waitFor } from './assert.mjs';
import { inspect } from '../xlsx/ooxml.mjs';

const dir = process.argv[2] || 'evidence';
mkdirSync(join(dir, 'shots'), { recursive: true });
mkdirSync(join(dir, 'files'), { recursive: true });
const browser = await chromium.launch({ args: ['--lang=ko-KR'], env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } });
const IDS = [
  'DT-01', 'DT-02', 'DT-03', 'DT-04', 'DT-05', 'DT-06', 'DT-07', 'DT-13', 'DT-14', 'DT-15', 'DT-16',
  'MP-01', 'MP-04', 'MP-05', 'MP-06', 'MP-07', 'MP-11',
  'KP-01', 'KP-02', 'KP-05', 'KP-06', 'KP-07', 'KP-12',
  'SO-01', 'SO-07', 'SO-13', 'SO-06',
  'LY-01', 'LY-02', 'LY-03', 'LY-05', 'LY-06', 'LY-08', 'LY-10', 'LY-11',
  'EX-01', 'EX-03', 'EX-10', 'EX-11',
];
const run = createRun({ dir, suite: 'date-basis', ids: IDS, meta: {
  browser: `chromium ${browser.version()}`, sdk: 'MOCK (scripts/browser/mock-kakao-sdk.js)',
  data: 'synthetic: demoFacts + e2e extras, or the cohort oracle (docs/implementation/date-basis-dashboard/fixtures/cohort-oracle.json)',
  server: 'local Vite middleware running server/publicHandler.ts + server/personalHandler.ts (Node, not Edge Runtime)',
  zoom: 'browser zoom 100% (headless); LY-11 widths via viewport, not a real browser zoom' } });
const { check, step } = run;
const shot = (page, name) => page.screenshot({ path: join(dir, 'shots', `${name}.png`) });
const log = async () => api('log');
const dashReq = (l) => l.filter((e) => e.route === 'dashboard');
const kpi = (page, id) => page.locator(`.kpi-strip [data-kpi="${id}"] .kpi-value`).innerText().catch(() => null);
const focusLabel = (page) => page.locator('.kpi-strip .kpi-focus-label').innerText().catch(() => null);
const kpiState = (page) => page.locator('.kpi-strip').getAttribute('aria-busy');
const pins = (page) => page.evaluate(() => window.__kakaoLiveMarkers().filter((m) => !m.title.includes('묶음')).map((m) => m.title).sort());
const clickPin = (page, i) => page.evaluate((k) => { const ms = window.__kakaoLiveMarkers().filter((m) => !m.title.includes('묶음')).sort((a, b) => a.title.localeCompare(b.title)); ms[k].marker.__click(); return ms[k].title; }, i);
const lastMap = (page, fn) => page.evaluate((f) => new Function('m', f)(window.__kakaoMaps[window.__kakaoMaps.length - 1]), fn);
const idle = (page) => waitFor(() => kpiState(page), (b) => b === 'false', { timeout: 15000 });
const urlParams = (page) => page.evaluate(() => Object.fromEntries(new URLSearchParams(location.search)));

async function fresh(ctx, { dataset = 'synthetic', search = '', ...opts } = {}) {
  await api('reset');
  if (dataset === 'oracle') await api('dataset', { name: 'oracle' });
  const s = await openPage(browser, { height: 1000, search, ...opts });
  captureConsole(s.page, ctx);
  await waitMap(s.page);
  await s.page.waitForSelector('.kpi-strip [data-kpi="report"]', { timeout: 20000 });
  await idle(s.page);
  return s;
}
const ORACLE_Q = (basis) => `?date_basis=${basis}&start=2025-07-01&end=2025-08-31&category=all`;

try {
  await step('basis-default', ['DT-01', 'LY-02'], async (ctx) => {
    // an old link: no date_basis, the removed layout parameter; other parameters must survive
    const s = await fresh(ctx, { search: '?start=2026-06-01&end=2026-08-31&category=parking&view=stats' });
    const { page } = s;
    check('DT-01', 'selector shows 답변일', await page.getByLabel('날짜 기준').first().inputValue(), 'completed_date');
    const l = dashReq(await log());
    check('DT-01', 'request carries date_basis=completed_date', l.at(-1)?.params.date_basis, 'completed_date');
    const p = await urlParams(page);
    check('DT-01', 'URL rewritten with the basis', p.date_basis, 'completed_date');
    check('LY-02', 'old view parameter dropped, the rest kept', [p.view ?? null, p.category, p.start], [null, 'parking', '2026-06-01']);
    check('LY-02', 'no layout attribute on main/body', await page.evaluate(() => [document.querySelector('main')?.dataset.view ?? null, document.body.dataset.view ?? null]), [null, null]);
    check('DT-01', 'period text names the basis', await page.locator('.kpi-strip .kpi-period').innerText(), (t) => t.startsWith('답변일 기준'));
    await s.context.close();
  });

  await step('basis-top', ['DT-02', 'DT-16'], async (ctx) => {
    const s = await fresh(ctx, { search: '?date_basis=completed_date&start=2026-03-01&end=2026-08-31&category=all' });
    const { page } = s;
    const before = dashReq(await log()).length;
    await page.getByLabel('날짜 기준').first().selectOption('report_date');
    await idle(page);
    await sleep(400);
    const reqs = dashReq(await log()).slice(before);
    check('DT-02', 'exactly one dashboard request', reqs.length, 1);
    check('DT-02', 'same dates, new basis', reqs.map((r) => [r.params.date_basis, r.params.start, r.params.end]), [['report_date', '2026-03-01', '2026-08-31']]);
    await page.getByRole('button', { name: /상세 필터/ }).click();
    check('DT-02', 'drawer reopens on the applied basis', await page.locator('input[name="drawer-basis"][value="report_date"]').isChecked(), true);
    await page.getByRole('button', { name: '닫기' }).click();
    // 전체 분류 keeps dates and basis
    await page.getByRole('button', { name: '교통위반' }).click();
    await idle(page);
    await page.getByRole('button', { name: '전체 분류' }).click();
    await idle(page);
    const p = await urlParams(page);
    check('DT-16', '전체 분류 keeps basis and dates', [p.date_basis, p.start, p.end, p.category], ['report_date', '2026-03-01', '2026-08-31', 'all']);
    await s.context.close();
  });

  await step('drawer', ['DT-03', 'DT-04', 'DT-14'], async (ctx) => {
    const s = await fresh(ctx, { search: '?date_basis=completed_date&start=2026-03-01&end=2026-08-31&category=all' });
    const { page } = s;
    const n0 = dashReq(await log()).length;
    await page.getByRole('button', { name: /상세 필터/ }).click();
    await page.locator('input[name="drawer-basis"][value="report_date"]').check();
    await page.locator('.drawer input[type="date"]').first().fill('2026-05-01');
    await page.getByRole('button', { name: '닫기' }).click();
    await sleep(500);
    check('DT-03', 'cancel sends nothing', dashReq(await log()).length - n0, 0);
    check('DT-03', 'top selector unchanged', await page.getByLabel('날짜 기준').first().inputValue(), 'completed_date');
    await page.getByRole('button', { name: /상세 필터/ }).click();
    check('DT-03', 'reopen shows the applied basis and dates', [await page.locator('input[name="drawer-basis"][value="completed_date"]').isChecked(),
      await page.locator('.drawer input[type="date"]').first().inputValue()], [true, '2026-03-01']);
    // DT-14: an invalid range is refused, the typed values and the drawer stay
    await page.locator('.drawer input[type="date"]').first().fill('2026-09-01');
    await page.locator('.drawer input[type="date"]').nth(1).fill('2026-08-01');
    await page.locator('.drawer .primary-button').click();
    await sleep(300);
    check('DT-14', 'error shown, drawer open, input kept', [await page.locator('#drawer-date-error').isVisible(), await page.locator('.drawer input[type="date"]').first().inputValue()], [true, '2026-09-01']);
    check('DT-14', 'no request for the invalid range', dashReq(await log()).length - n0, 0);
    // DT-04: basis + dates + law applied together → one request
    await page.locator('input[name="drawer-basis"][value="report_date"]').check();
    await page.locator('.drawer input[type="date"]').first().fill('2026-04-01');
    await page.locator('.drawer input[type="date"]').nth(1).fill('2026-06-30');
    const lawValue = await page.locator('.drawer select').last().locator('option').nth(2).getAttribute('value');
    await page.locator('.drawer select').last().selectOption(lawValue);
    await page.locator('.drawer .primary-button').click();
    await idle(page);
    await sleep(400);
    const reqs = dashReq(await log()).slice(n0);
    check('DT-04', 'one request with basis, dates and law together', reqs.map((r) => [r.params.date_basis, r.params.start, r.params.end, r.params.law]), [['report_date', '2026-04-01', '2026-06-30', lawValue]]);
    await s.context.close();
  });

  await step('oracle', ['DT-05', 'DT-06', 'DT-07', 'MP-01', 'EX-01', 'DT-15'], async (ctx) => {
    const s = await fresh(ctx, { dataset: 'oracle', search: ORACLE_Q('report_date'), width: 1440 });
    const { page } = s;
    const rep = { report: await kpi(page, 'report'), warning: await kpi(page, 'warning'), fine: await kpi(page, 'fine'), places: await kpi(page, 'places') };
    await lastMap(page, 'm.setCenter(new kakao.maps.LatLng(37.556, 126.99)); m.setLevel(4)');
    await sleep(500);
    const repPins = await pins(page);
    await shot(page, 'oracle-report-basis');
    // monthly table of the card (report basis: A in July, C/E in August)
    await page.locator('.trend-card').getByRole('button', { name: '표로 보기' }).click();
    const repMonths = await page.locator('.trend-card .trend-table tbody tr').evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll('td')].slice(0, 3).map((td) => td.innerText)));
    const title = await page.locator('.trend-card h2').innerText();
    await page.getByLabel('날짜 기준').first().selectOption('completed_date');
    await idle(page);
    const ans = { report: await kpi(page, 'report'), warning: await kpi(page, 'warning'), fine: await kpi(page, 'fine'), places: await kpi(page, 'places') };
    await sleep(500);
    const ansPins = await pins(page);
    const ansMonths = await page.locator('.trend-card .trend-table tbody tr').evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll('td')].slice(0, 3).map((td) => td.innerText)));
    await shot(page, 'oracle-answer-basis');
    check('DT-05', 'report basis: 3 reports, 계도 2 (C, E), places 2', [rep.report, rep.warning?.split('·')[0].trim(), rep.places], ['3건', '2건', '2곳']);
    check('DT-06', 'answer basis: 3 reports, 계도 1 (C), places 3', [ans.report, ans.warning?.split('·')[0].trim(), ans.places], ['3건', '1건', '3곳']);
    check('DT-05', 'same count, different reports (pins differ)', JSON.stringify(repPins) !== JSON.stringify(ansPins), true);
    check('MP-01', 'report basis draws A\'s place (answered in September)', repPins.some((t) => t.includes('종로구')), true);
    check('DT-07', 'report basis: July holds A with its September result', repMonths.find((r) => r[0].includes('07'))?.slice(1), ['1', '1']);
    check('EX-01', 'answer basis: July 0, August B/C/D', [ansMonths.find((r) => r[0].includes('07'))?.slice(1), ansMonths.find((r) => r[0].includes('08'))?.slice(1)], [['0', '0'], ['3', '3']]);
    check('EX-01', 'card title names the month basis', title, (t) => t.startsWith('신고월별'));
    // DT-15: 전체 기간 follows the selected basis
    await page.locator('.command .control').filter({ hasText: '—' }).first().click();
    await page.getByRole('button', { name: '전체 기간' }).click();
    await idle(page);
    const pAns = await urlParams(page);
    await page.getByLabel('날짜 기준').first().selectOption('report_date');
    await idle(page);
    const pKeep = await urlParams(page);
    await page.locator('.command .control').filter({ hasText: '—' }).first().click();
    await page.getByRole('button', { name: '전체 기간' }).click();
    await idle(page);
    const pRep = await urlParams(page);
    // oracle reports A–E, G (the F rows are SQL-only): answers 06-10 (G) … 09-03 (A); reports 05-20 (B) … 08-25 (E)
    check('DT-15', '전체 기간 on 답변일 = answer-date bounds', [pAns.start, pAns.end], ['2025-06-10', '2025-09-03']);
    check('DT-15', 'changing only the basis keeps the dates', [pKeep.start, pKeep.end], ['2025-06-10', '2025-09-03']);
    check('DT-15', '전체 기간 on 신고일 = report-date bounds', [pRep.start, pRep.end], ['2025-05-20', '2025-08-25']);
    await s.context.close();
  });

  await step('zero', ['DT-13'], async (ctx) => {
    const s = await fresh(ctx, { dataset: 'oracle', search: '?date_basis=report_date&start=2025-10-01&end=2025-10-31&category=all' });
    const { page } = s;
    const p = await urlParams(page);
    check('DT-13', 'normal 0 without moving the dates or the basis', [await kpi(page, 'report'), p.start, p.date_basis], ['0건', '2025-10-01', 'report_date']);
    check('DT-13', 'no error banner', await page.locator('.banner.error').count(), 0);
    await s.context.close();
  });

  await step('race', ['MP-04', 'MP-07'], async (ctx) => {
    const s = await fresh(ctx, { dataset: 'oracle', search: ORACLE_Q('report_date') });
    const { page } = s;
    // same range, same version: basis A (slow) then basis B (fast); A's late answer must never be shown
    await api('delay', { dashboard: 1500 });
    await page.getByLabel('날짜 기준').first().selectOption('completed_date');
    await sleep(150);
    await api('delay', {});
    await page.getByLabel('날짜 기준').first().selectOption('report_date');
    await sleep(2200);
    await idle(page);
    check('MP-04', 'screen shows the last choice (report basis: 계도 2)', [await page.getByLabel('날짜 기준').first().inputValue(), (await kpi(page, 'warning'))?.split('·')[0].trim()], ['report_date', '2건']);
    check('MP-07', 'period text follows the displayed basis', await page.locator('.kpi-strip .kpi-period').innerText(), (t) => t.startsWith('신고일 기준'));
    await s.context.close();
  });

  await step('refine', ['MP-05', 'MP-06'], async (ctx) => {
    // dense dataset: 1,100 addresses reported in January, answered in March (server compacts → the map refines on zoom)
    const s = await fresh(ctx, { dataset: 'dense', search: '?date_basis=report_date&start=2026-01-01&end=2026-01-31&category=all' });
    const { page } = s;
    const markers = () => page.evaluate(() => window.__kakaoLiveMarkers().map((m) => m.title));
    const placesReq = async () => (await log()).filter((e) => e.route === 'places');
    check('MP-05', 'January report view is compacted (묶음 nodes)', (await markers()).some((t) => t.includes('묶음')), true);
    // MP-05: a refinement asked for the report-date view arrives AFTER the view switched to answer-date (0 places)
    await api('delay', { places: 2500 });
    await lastMap(page, 'm.setCenter(new kakao.maps.LatLng(37.56, 126.98)); m.setLevel(5)');
    await waitFor(placesReq, (l) => l.length >= 1, { timeout: 5000 });
    await page.getByLabel('날짜 기준').first().selectOption('completed_date');
    await idle(page);
    await sleep(3200);
    const late = (await placesReq()).filter((e) => e.params.date_basis === 'report_date');
    check('MP-05', 'the report-date refinement did answer (late)', late.map((e) => e.status), (v) => v.length >= 1 && v.every((x) => x === 200));
    check('MP-05', 'answer-date view shows no pin of the late answer', await markers(), []);
    check('MP-05', 'KPI is the answer-date view (0 reports)', await kpi(page, 'report'), '0건');
    // MP-06: a refinement still WAITING in its debounce when the basis changes is never sent
    await api('delay', {});
    await page.getByLabel('날짜 기준').first().selectOption('report_date');
    await idle(page);
    await sleep(800);
    const before = (await placesReq()).length;
    await lastMap(page, 'm.setCenter(new kakao.maps.LatLng(37.575, 126.99)); m.setLevel(5)');
    await sleep(150); // inside the 600ms debounce
    await page.getByLabel('날짜 기준').first().selectOption('completed_date');
    await idle(page);
    await sleep(1200);
    const after = (await placesReq()).slice(before);
    check('MP-06', 'no report-date refinement was sent after the switch', after.filter((e) => e.params.date_basis === 'report_date').length, 0);
    check('MP-06', 'no pin from the cancelled view', await markers(), []);
    await s.context.close();
  });

  await step('focus', ['KP-01', 'KP-02', 'KP-05', 'KP-06', 'KP-07'], async (ctx) => {
    const s = await fresh(ctx, { dataset: 'oracle', search: ORACLE_Q('completed_date') });
    const { page } = s;
    check('KP-01', 'one KPI strip, before the map, none in the side panel', await page.evaluate(() => {
      const strips = document.querySelectorAll('.kpi-strip');
      const map = document.querySelector('.area-map');
      return [strips.length, !!(strips[0] && map && (strips[0].compareDocumentPosition(map) & Node.DOCUMENT_POSITION_FOLLOWING)), document.querySelectorAll('.area-side .kpi-strip, .area-side .kpi-grid').length];
    }), [1, true, 0]);
    const scopeReport = await kpi(page, 'report');
    await lastMap(page, 'm.setCenter(new kakao.maps.LatLng(37.556, 126.99)); m.setLevel(4)');
    await waitFor(() => pins(page), (p) => p.length >= 3);
    const titles = await pins(page);
    const d = titles.findIndex((t) => t.includes('용산구'));
    await clickPin(page, d);
    await idle(page);
    await waitFor(() => focusLabel(page), (t) => (t || '').includes('용산구'));
    check('KP-02', 'focus = the address (D only on the answer basis: 1 report, 2 participants)', [await focusLabel(page), await kpi(page, 'report'), await kpi(page, 'contributors')],
      (v) => v[0].includes('용산구') && v[1] === '1건' && v[2] === '2명');
    await shot(page, 'focus-place');
    // KP-05: P1 slow, then P2 → P2 wins (never P1's numbers under P2's title)
    await api('delay', { 'places/:key': 1500 });
    const other = titles.findIndex((t) => t.includes('중구'));
    await clickPin(page, d); // deselect
    await clickPin(page, d); // P1 (slow)
    await sleep(100);
    await api('delay', {});
    await clickPin(page, other); // P2
    await sleep(2000);
    await idle(page);
    check('KP-05', 'P2 title with P2 numbers (B only: 1 report)', [await focusLabel(page), await kpi(page, 'report')], (v) => v[0].includes('중구') && v[1] === '1건');
    // KP-06: P1 slow, then deselect → back to the scope values; P1 never appears
    await api('delay', { 'places/:key': 1500 });
    await clickPin(page, other); // deselect P2
    await clickPin(page, d); // P1 slow
    await sleep(100);
    await page.keyboard.press('Escape'); // KP-07 deselect by Esc
    await api('delay', {});
    await sleep(2000);
    check('KP-06', 'back to the applied scope; the late address answer is not shown', [await focusLabel(page), await kpi(page, 'report')], (v) => !v[0].includes('용산구') && v[1] === scopeReport);
    check('KP-07', 'Esc cleared the selection', await page.evaluate(() => window.__kakaoLiveMarkers().filter((m) => m.title.includes('(선택됨)')).length), 0);
    await s.context.close();
  });

  await step('sort', ['SO-01', 'SO-13', 'SO-07', 'SO-06'], async (ctx) => {
    const s = await fresh(ctx, { search: '?date_basis=completed_date&start=2025-09-25&end=2026-09-24&category=all' });
    const { page } = s;
    const table = page.locator('#entities');
    await table.scrollIntoViewIfNeeded();
    await page.locator('#entities .ghost-btn', { hasText: '전체 보기' }).click();
    await waitFor(() => log().then((l) => l.filter((e) => e.route === 'entities').length), (n) => n >= 1);
    await sleep(500);
    const n0 = (await log()).filter((e) => e.route === 'entities').length;
    const fineHead = page.locator('#entities th').filter({ hasText: '과태료' }).first();
    await fineHead.locator('.sort-head').click();
    const items = await page.locator('#entities .sort-menu [role="menuitemradio"]').allInnerTexts();
    check('SO-01', 'four choices (count/rate × desc/asc)', items.map((t) => t.replace(/\s*[↓↑]$/, '').trim()), ['건수 많은 순', '건수 적은 순', '비율 높은 순', '비율 낮은 순']);
    await sleep(300);
    check('SO-13', 'opening the menu sends nothing', (await log()).filter((e) => e.route === 'entities').length - n0, 0);
    await page.locator('#entities .sort-menu [role="menuitemradio"]', { hasText: '비율 높은 순' }).click();
    await waitFor(() => log().then((l) => l.filter((e) => e.route === 'entities').length - n0), (n) => n >= 1);
    await sleep(600);
    const reqs = (await log()).filter((e) => e.route === 'entities').slice(n0);
    check('SO-13', 'choosing sends one request with sort, value, dir and page 1', reqs.map((r) => [r.params.sort, r.params.sort_value, r.params.dir, r.params.page]), [['fine', 'rate', 'desc', '1']]);
    check('SO-13', 'header, aria-sort and caption agree', [await fineHead.getAttribute('aria-sort'), await fineHead.locator('.sort-mark').innerText(), await page.locator('#entities caption').innerText()],
      (v) => v[0] === 'descending' && v[1].includes('비율') && v[2].includes('과태료 · 비율 ▼'));
    // SO-07: the first row is the highest exact rate of the FULL list (asked directly from the same API)
    const full = await page.evaluate(async () => {
      const token = JSON.parse(localStorage.getItem('cm-map-auth-v1')).access_token;
      const q = new URLSearchParams(location.search);
      const out = [];
      for (let p = 1; p <= 5; p++) {
        const r = await fetch(`/functions/v1/public-analytics/entities?date_basis=${q.get('date_basis')}&start=${q.get('start')}&end=${q.get('end')}&category=all&kind=agency&page=${p}&page_size=100`, { headers: { Authorization: `Bearer ${token}` } });
        const j = await r.json(); out.push(...j.items); if (out.length >= j.total_rows) break;
      }
      return out.filter((e) => e.fine_count !== null && e.completed_count > 0).map((e) => [e.agency_name, e.fine_count / e.completed_count]);
    });
    const best = full.reduce((a, b) => (b[1] > a[1] || (b[1] === a[1] && b[0].localeCompare(a[0], 'ko') < 0) ? b : a));
    check('SO-07', 'first row = highest fine rate of the full list', await page.locator('#entities tbody tr').first().locator('.table-name').innerText(), best[0]);
    // SO-06: the law table has the same menu and a server sort
    const l0 = (await log()).filter((e) => e.route === 'laws').length;
    await page.locator('#laws th').filter({ hasText: '과태료' }).first().locator('.sort-head').click();
    await page.locator('#laws .sort-menu [role="menuitemradio"]', { hasText: '건수 적은 순' }).click();
    await waitFor(() => log().then((l) => l.filter((e) => e.route === 'laws').length - l0), (n) => n >= 1);
    const lr = (await log()).filter((e) => e.route === 'laws').slice(l0);
    check('SO-06', 'law table: one server request with the registry sort', lr.map((r) => [r.params.sort, r.params.sort_value, r.params.dir]), [['fine', 'count', 'asc']]);
    await shot(page, 'sort-menu');
    await s.context.close();
  });

  await step('layout', ['LY-01', 'LY-05', 'LY-06', 'LY-08', 'KP-12', 'LY-11'], async (ctx) => {
    const order = (page) => page.evaluate(() => {
      const ids = ['summary', 'mapsection', 'laws', 'entities', 'analytics', 'regions'];
      const el = ids.map((id) => document.getElementById(id));
      const pos = (a, b) => !!(a && b && (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING));
      return { dom: [pos(el[0], el[2]), pos(el[2], el[3]), pos(el[3], el[4]), pos(el[4], el[5])],
        trend: pos(document.querySelector('#laws'), document.querySelector('.trend-card')) && pos(document.querySelector('.trend-card'), document.querySelector('.duration-card, [aria-label*="걸린 기간"]')) };
    });
    const s = await fresh(ctx, {});
    const { page } = s;
    check('LY-01', 'no layout buttons', await page.getByRole('button', { name: /지도 크게|통계 크게|지도\+통계/ }).count(), 0);
    check('LY-05', 'DOM order: KPI → laws → entities → trend → regions', (await order(page)).dom, [true, true, true, true]);
    const tops = await page.evaluate(() => ['laws', 'entities'].map((id) => Math.round(document.getElementById(id).getBoundingClientRect().top)));
    check('LY-05', 'laws and entities side by side on desktop', Math.abs(tops[0] - tops[1]) < 4, true);
    await page.locator('.rail .nav-item', { hasText: '법규' }).click();
    await sleep(1200);
    const r = await page.evaluate(() => {
      const t = document.getElementById('laws').getBoundingClientRect().top;
      const inset = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--scroll-top-inset'));
      return { visible: t >= inset - 2 && t < inset + 60, current: document.querySelector('.rail .nav-item[aria-current="location"]')?.innerText };
    });
    check('LY-08', 'menu 법규 → #laws below the sticky band, menu marks it', [r.visible, (r.current || '').includes('법규') || (r.current || '').includes('기관')], [true, true]);
    await s.context.close();
    const widths = [1920, 1440, 1280, 768, 390];
    for (const theme of ['dark', 'light']) for (const w of widths) {
      const v = await fresh(ctx, { width: w, height: 900, theme });
      const o = await v.page.evaluate(() => ({ page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        kpiScroll: (() => { const r = document.querySelector('.kpi-row'); return r ? r.scrollWidth > r.clientWidth + 1 : false; })(),
        cells: document.querySelectorAll('.kpi-row .kpi-cell').length, h: Math.round(document.querySelector('.kpi-strip').getBoundingClientRect().height) }));
      check('LY-11', `${w}px ${theme}: no page overflow`, o.page, (n) => n <= 0);
      if (w === 390) {
        check('KP-12', '390px: all cells kept, the row scrolls inside', [o.cells >= 11, o.kpiScroll], [true, true]);
        check('LY-06', '390px: laws → entities → trend → regions in DOM', (await order(v.page)).dom, [true, true, true, true]);
      }
      // prompt §2.1: about 90–120px (header line + one row of cells), never clipped
      if (w === 1440) check('KP-12', '1440px strip height 90–130px', o.h, (h) => h >= 90 && h <= 130);
      await shot(v.page, `layout-${w}-${theme}`);
      await v.context.close();
    }
  });

  await step('statistics', ['LY-03', 'LY-10', 'EX-03'], async (ctx) => {
    const s = await fresh(ctx, { dataset: 'oracle', search: ORACLE_Q('report_date') });
    const { page } = s;
    const n0 = (await log()).length;
    await page.locator('.trend-card .trend-to-stats').click();
    await page.waitForSelector('.pivot-table tbody tr', { timeout: 20000 });
    const q = (await log()).slice(n0).find((e) => e.route === 'statistics/query');
    const spec = q ? JSON.parse(q.params.spec) : null;
    check('EX-03', 'hand-off: report_month rows with the report basis on both scope and recipe', [spec?.rows, spec?.date_basis, q?.params.date_basis], [['report_month'], 'report_date', 'report_date']);
    check('LY-03', 'screen=statistics kept', (await urlParams(page)).screen, 'statistics');
    await page.locator('.stats-result').getByRole('button', { name: '그래프', exact: true }).click();
    await page.locator('.stats-result').getByRole('button', { name: '표', exact: true }).click();
    check('LY-03', 'table/chart switch still there', await page.locator('.pivot-table').count(), 1);
    const nav = await page.evaluate(() => document.querySelector('.rail .nav-item[aria-current="location"]'));
    check('LY-10', 'hidden dashboard does not mark a section while 통계 is open', nav, null);
    await s.context.close();
  });

  await step('share-account', ['EX-10', 'MP-11'], async (ctx) => {
    const s = await fresh(ctx, { dataset: 'oracle', search: ORACLE_Q('report_date') });
    const { page } = s;
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.getByRole('button', { name: '링크 복사' }).click();
    const link = await page.evaluate(() => navigator.clipboard.readText());
    check('EX-10', 'link keeps the basis and dates, no token or account id', [new URL(link).searchParams.get('date_basis'), link.includes(E2E_UID), /token|access_token/.test(link)], ['report_date', false, false]);
    const other = await openPage(browser, { height: 1000, search: new URL(link).search, uid: '22222222-3333-4444-8555-666666666666' });
    captureConsole(other.page, ctx);
    await other.page.waitForSelector('.kpi-strip [data-kpi="report"]', { timeout: 20000 });
    await idle(other.page);
    check('EX-10', 'another account restores the same basis', await other.page.getByLabel('날짜 기준').first().inputValue(), 'report_date');
    check('MP-11', 'the other account sees the same public numbers', await kpi(other.page, 'report'), await kpi(page, 'report'));
    await other.context.close();
    await s.context.close();
  });

  await step('excel', ['EX-11'], async (ctx) => {
    const s = await fresh(ctx, { dataset: 'oracle', search: ORACLE_Q('report_date') });
    const { page } = s;
    const downloads = [];
    page.on('download', (d) => downloads.push(d));
    await page.locator('[data-export-source="trend"] .export-btn').click();
    await waitFor(() => page.evaluate(() => window.__cmExport?.snapshot().status), (x) => x === 'ready' || x === 'error', { timeout: 60000 });
    let d = downloads.at(-1);
    if (!d) { [d] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.locator('[data-export-source="trend"] .export-ready .mini-btn').click()]); }
    const path = join(dir, 'files', 'trend-report-basis.xlsx');
    await d.saveAs(path);
    const x = inspect(readFileSync(path));
    const cond = Object.values(x.sheets['조회 조건'].cells).map((c) => String(c.value ?? ''));
    check('EX-11', 'conditions name the basis and the fixed period', [cond.some((v) => v.startsWith('신고일')), cond.some((v) => v.startsWith('2025-07-01 — 2025-08-31'))], [true, true]);
    const head = Object.values(x.sheets['통계표'].cells).map((c) => String(c.value ?? ''));
    check('EX-11', 'month column is 신고월 (same model as the card)', head.includes('신고월'), true);
    await s.context.close();
  });
} finally {
  run.finish();
  await browser.close();
}
