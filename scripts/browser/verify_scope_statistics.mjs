// Browser acceptance run for scope-statistics-2026-09-29.2 (S01–S10) on the LOCAL stack:
// real frontend + real Edge handler code over SYNTHETIC facts + MOCK Kakao SDK. Not a production or real-SDK pass.
// node scripts/browser/verify_scope_statistics.mjs <evidence-dir>   (ONLY=MT,LD,... to run some steps)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, openPage, waitMap, api, sleep, summarizeLog } from './harness.mjs';

const dir = process.argv[2] || 'evidence';
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args: ['--lang=ko-KR'] });
const out = existsSync(join(dir, 'scope-statistics.json')) ? JSON.parse(readFileSync(join(dir, 'scope-statistics.json'), 'utf8')) : {};
const shot = (page, name, opts = {}) => page.screenshot({ path: join(dir, `${name}.png`), ...opts });
const log = async () => api('log');
const lastMap = (page, fn) => page.evaluate((f) => new Function('m', f)(window.__kakaoMaps[window.__kakaoMaps.length - 1]), fn);
async function fresh(opts = {}) {
  await api('reset');
  const s = await openPage(browser, { locale: 'ko-KR', ...opts });
  await waitMap(s.page);
  await sleep(1800);
  return s;
}
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
function step(name, fn) {
  if (ONLY && !ONLY.has(name)) return Promise.resolve();
  return fn().then((r) => { out[name] = r; console.log(name, JSON.stringify(r).slice(0, 700)); })
    .catch((e) => { out[name] = { error: String(e && e.stack || e) }; console.log(name, 'ERROR', e); });
}
const status = (page) => page.locator('.query-status-text').innerText().catch(() => '');
const series = (page, sel) => page.evaluate((s) => { const h = document.querySelector(s); const c = h && h.__chart; return c ? (c.getOption().series || []).map((x) => x.id) : null; }, sel);
const instanceId = (page, sel) => page.evaluate((s) => document.querySelector(s)?.getAttribute('_echarts_instance_') ?? null, sel);
const pins = (page) => page.evaluate(() => window.__kakaoLiveMarkers().filter((m) => !m.title.includes('묶음')));
const selectedPins = (page) => page.evaluate(() => window.__kakaoLiveMarkers().filter((m) => m.title.includes('(선택됨)')).map((m) => ({ title: m.title, z: m.marker.opts.zIndex })));
const clickPin = (page, i) => page.evaluate((k) => { const ms = window.__kakaoLiveMarkers().filter((m) => !m.title.includes('묶음')).sort((a, b) => a.title.localeCompare(b.title)); ms[k].marker.__click(); return ms[k].title; }, i);
const zoomToPins = async (page) => { await lastMap(page, 'm.setCenter(new kakao.maps.LatLng(37.55, 126.99)); m.setLevel(5)'); await sleep(1500); };

try {
  // ── S09 monthly multi-rate (MT) ────────────────────────────────────────────────────────────────
  await step('MT', async () => {
    const { page, consoleErrors, context } = await fresh();
    const card = page.locator('.trend-card');
    await card.scrollIntoViewIfNeeded();
    await card.getByRole('button', { name: '처리결과 비율' }).click();
    await sleep(500);
    const host = '.trend-card .chart-host';
    const res = { consoleErrors, default: await series(page, host) };
    const inst0 = await instanceId(page, host);
    const n0 = (await log()).length;
    await card.getByRole('button', { name: '전체 선택' }).click();
    await sleep(300);
    res.four = await series(page, host);
    await card.screenshot({ path: join(dir, 'MT-four-rates-1440.png') });
    // 20 checkbox toggles: presentation only
    for (let i = 0; i < 20; i++) { await card.locator('.rate-check').nth(i % 4).click(); await sleep(40); }
    await sleep(300);
    res.after20 = { requests: summarizeLog((await log()).slice(n0)), sameInstance: inst0 === await instanceId(page, host), series: await series(page, host) };
    // none selected: a clear note, no fake 0%, controls stay
    await card.getByRole('button', { name: /전체 (선택|해제)/ }).click();
    if ((await card.locator('.rate-check.checked').count()) > 0) await card.getByRole('button', { name: /전체 (선택|해제)/ }).click();
    await sleep(300);
    res.none = { note: await card.locator('.empty-state').innerText().catch(() => null), checks: await card.locator('.rate-check input').count(), statusDuring: await status(page) };
    await card.screenshot({ path: join(dir, 'MT-none-1440.png') });
    // compare ON with a slow personal answer: public lines stay, "mine" pending is named
    await card.getByRole('button', { name: '전체 선택' }).click();
    await api('delay', { 'my-analytics': 2500 });
    await page.locator('.compare-toggle input').check();
    await sleep(600);
    res.minePending = { note: await card.locator('.cm-chip.is-pending').innerText().catch(() => null), top: await status(page), series: await series(page, host) };
    await shot(page, 'MT-mine-pending-1440');
    await sleep(3000);
    res.eight = await series(page, host);
    await card.screenshot({ path: join(dir, 'MT-eight-lines-1440.png') });
    await card.getByRole('button', { name: '표로 보기' }).click();
    await sleep(300);
    res.tableHead = (await card.locator('thead').innerText()).replace(/\s+/g, ' ');
    res.tableFirst = (await card.locator('tbody tr').first().innerText()).replace(/\s+/g, ' ');
    await card.screenshot({ path: join(dir, 'MT-table-1440.png') });
    // tooltip on a month
    await card.getByRole('button', { name: '그래프로 보기' }).click();
    await sleep(400);
    const box = await page.locator(host).boundingBox();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2);
    await sleep(400);
    res.tooltip = await page.evaluate(() => [...document.querySelectorAll('.trend-card .chart-host div')].map((d) => d.innerText).find((t) => t && t.includes('내 신고')) ?? null);
    await shot(page, 'MT-tooltip-1440');
    // state kept across count↔rate and theme
    await card.getByRole('button', { name: '건수', exact: true }).click();
    await card.getByRole('button', { name: '처리결과 비율' }).click();
    res.keptAfterViewSwitch = await card.locator('.rate-check.checked').count();
    await context.close();
    return res;
  });

  // ── S10 query status (LD) ──────────────────────────────────────────────────────────────────────
  await step('LD', async () => {
    const { page, consoleErrors, context } = await fresh();
    const res = { consoleErrors };
    const maps0 = await page.evaluate(() => window.__kakaoStats.maps);
    await api('delay', { dashboard: 2500 });
    const n0 = (await log()).length;
    await page.getByRole('button', { name: '주정차', exact: true }).click();
    await sleep(400);
    res.during = { top: await status(page), sideBusy: await page.locator('.scope-panel').getAttribute('aria-busy'), line: await page.locator('.query-line.on').count(),
      kpiStill: await page.locator('.kpi-grid').count(), trendBusy: await page.locator('.trend-card').getAttribute('aria-busy') };
    await shot(page, 'LD-refresh-in-flight-1440');
    // scrolled to the bottom: the status stays visible in the sticky header
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await sleep(200);
    res.bottomVisible = await page.locator('.query-status.on').evaluate((e) => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight; }).catch(() => false);
    await shot(page, 'LD-status-at-bottom-1440');
    await sleep(3000);
    res.after = { top: await status(page), line: await page.locator('.query-line.on').count(), requests: summarizeLog((await log()).slice(n0)), maps: await page.evaluate(() => window.__kakaoStats.maps), maps0 };
    await page.evaluate(() => window.scrollTo(0, 0));
    await api('delay', {});
    // LD-05: P1 slow, then P2 — the late P1 never lands and never clears P2's status
    await zoomToPins(page);
    await api('delay', { 'places/:key': 1800 });
    const t1 = await clickPin(page, 0);
    await sleep(250);
    const t2 = await clickPin(page, 1);
    await sleep(300);
    res.placeDuring = { top: await status(page), panel: await page.locator('.place-panel .panel-status').innerText().catch(() => null) };
    await shot(page, 'LD-place-detail-loading-1440');
    await sleep(2600);
    res.placeAfter = { title: await page.locator('.place-panel h2').innerText(), p1: t1, p2: t2, top: await status(page), panelStatus: await page.locator('.place-panel .panel-status').count() };
    await api('delay', {});
    // LD-06: selection cleared while its detail loads → its status goes, nothing else stops
    await api('delay', { 'places/:key': 2000 });
    await clickPin(page, 2);
    await sleep(300);
    await page.getByRole('button', { name: /주소 선택 해제/ }).click();
    await sleep(300);
    res.cancelled = { top: await status(page), scopePanel: await page.locator('.scope-panel').count() };
    await api('delay', {});
    // LD-04: auto OFF + map moves → no statistics request, no status
    const n1 = (await log()).length;
    for (let i = 0; i < 5; i++) { await lastMap(page, `m.__userPan(${40 - i * 20}, 20)`); await sleep(150); }
    await sleep(1200);
    res.autoOffPans = { requests: summarizeLog((await log()).slice(n1).filter((e) => e.route === 'dashboard')), top: await status(page) };
    // LD-19: 429 with Retry-After → a real countdown, no polling
    await api('inject', { route: 'dashboard', status: 429, times: 1, retryAfter: 4 });
    await page.getByRole('button', { name: '교통위반', exact: true }).click();
    await sleep(700);
    res.rateLimited = { top: await status(page), phase: await page.locator('.query-status').getAttribute('class') };
    await shot(page, 'LD-429-wait-1440');
    const n2 = (await log()).length;
    await sleep(5000);
    res.afterRetry = { requests: summarizeLog((await log()).slice(n2)), top: await status(page) };
    await context.close();
    return res;
  });

  // ── S02 pin selection (PI) ────────────────────────────────────────────────────────────────────
  await step('PI', async () => {
    const { page, consoleErrors, context } = await fresh();
    await zoomToPins(page);
    const res = { consoleErrors };
    await clickPin(page, 0);
    await sleep(900);
    res.first = { selected: await selectedPins(page), panel: await page.locator('.place-panel h2').innerText() };
    await page.locator('.map-card').screenshot({ path: join(dir, 'PI-selected-pin-1440.png') });
    await clickPin(page, 0);
    await sleep(700);
    res.reclick = { selected: await selectedPins(page), scopePanel: await page.locator('.scope-panel .place-head h2').innerText().catch(() => null) };
    await clickPin(page, 0); await sleep(300); await clickPin(page, 1); await sleep(700);
    res.swap = { selected: (await selectedPins(page)).length };
    // blank click right after a marker click is ignored (no instant deselect); a real blank click clears
    await clickPin(page, 2); await lastMap(page, 'm.__blankClick()'); await sleep(200);
    res.blankRightAfterMarker = (await selectedPins(page)).length;
    await sleep(600);
    await lastMap(page, 'm.__blankClick()'); await sleep(500);
    res.blankClick = (await selectedPins(page)).length;
    // Esc clears; with the drawer open Esc closes only the drawer
    await clickPin(page, 0); await sleep(600);
    await page.getByRole('button', { name: /상세 필터/ }).click(); await sleep(300);
    await page.keyboard.press('Escape'); await sleep(300);
    res.escWithDrawer = { drawerOpen: await page.locator('section.drawer').count(), selected: (await selectedPins(page)).length };
    await page.keyboard.press('Escape'); await sleep(400);
    res.escClears = (await selectedPins(page)).length;
    // pan after selecting keeps the selection (no blank-click from a drag)
    await clickPin(page, 1); await sleep(400);
    await lastMap(page, 'm.__userPan(60, 0)'); await lastMap(page, 'm.__blankClick()'); await sleep(400);
    res.afterDrag = (await selectedPins(page)).length;
    // rate mode: no pin, no halo
    await page.locator('.metric-switch').getByRole('button', { name: '수용률', exact: true }).click(); await sleep(900);
    res.rateMode = { pins: (await pins(page)).length, selected: (await selectedPins(page)).length };
    // 30 select/clear/mode switches: markers don't accumulate
    await page.locator('.metric-switch').getByRole('button', { name: '신고 수', exact: true }).click(); await sleep(800);
    for (let i = 0; i < 30; i++) {
      if (i % 10 === 9) { await page.locator('.metric-switch').getByRole('button', { name: i % 20 === 9 ? '과태료' : '신고 수', exact: true }).click(); await sleep(200); continue; }
      await clickPin(page, i % 3).catch(() => undefined); await sleep(60);
    }
    await page.locator('.metric-switch').getByRole('button', { name: '신고 수', exact: true }).click(); await sleep(900);
    res.after30 = { live: await page.evaluate(() => window.__kakaoLiveMarkers().length), maps: await page.evaluate(() => window.__kakaoStats.maps) };
    await context.close();
    return res;
  });

  // ── S01 scope detail (SC) + S04 hand-off (PG) ─────────────────────────────────────────────────
  await step('SC_PG', async () => {
    const { page, consoleErrors, context } = await fresh();
    const res = { consoleErrors };
    const panel = page.locator('.scope-panel');
    res.nation = { h2: await panel.locator('.place-head h2').innerText(), children: await panel.locator('.scope-child').count(), agencies: await panel.locator('.place-entities').first().locator('.pe-row').count(),
      shownOfTotal: await panel.locator('.place-more .cm-muted').first().innerText() };
    await panel.screenshot({ path: join(dir, 'SC-nation-panel-1440.png') });
    await panel.locator('.scope-child', { hasText: '서울특별시' }).click();
    await sleep(2000);
    res.seoul = { url: new URL(page.url()).search, h2: await panel.locator('.place-head h2').innerText(), trail: await panel.locator('.scope-trail').innerText(), children: await panel.locator('.scope-child').count() };
    await panel.locator('.scope-child').first().click();
    await sleep(2000);
    res.sgg = { url: new URL(page.url()).search, h2: await panel.locator('.place-head h2').innerText(), trail: (await panel.locator('.scope-trail').innerText()).replace(/\s+/g, ' ') };
    await panel.screenshot({ path: join(dir, 'SC-sgg-panel-1440.png') });
    // search the full manager list of the scope
    const search = panel.locator('input[type=search]').nth(1);
    const n0 = (await log()).length;
    await search.fill('김');
    await sleep(1200);
    res.search = { requests: summarizeLog((await log()).slice(n0)), rows: await panel.locator('.place-entities').nth(1).locator('.pe-row').count() };
    // breadcrumb up to 전국
    await panel.locator('.scope-trail').getByRole('button', { name: '전국' }).click();
    await sleep(2000);
    res.backToNation = { url: new URL(page.url()).search, h2: await panel.locator('.place-head h2').innerText() };
    // hand-off: 서울 → 이 조건으로 통계 만들기
    await panel.locator('.scope-child', { hasText: '서울특별시' }).click();
    await sleep(2000);
    const maps0 = await page.evaluate(() => window.__kakaoStats.maps);
    await panel.getByRole('button', { name: '이 조건으로 통계 만들기' }).click();
    await sleep(2500);
    res.handoff = { url: new URL(page.url()).search, h1: await page.locator('#stats-title').innerText(), focus: await page.evaluate(() => document.activeElement?.id),
      chips: await page.locator('.stats-builder .stats-chips').first().innerText(), resultHead: await page.locator('.stats-result-head h2').innerText(),
      rows: await page.locator('.pivot-table tbody tr').count(), railCurrent: await page.locator('.rail [aria-current="page"]').innerText() };
    await shot(page, 'PG-statistics-from-seoul-1440');
    // refresh on the statistics URL (Pages-style direct entry)
    await page.reload();
    await page.waitForSelector('.pivot-table tbody tr', { timeout: 15000 }).catch(() => undefined);
    await sleep(500);
    res.reload = { h1: await page.locator('#stats-title').innerText().catch(() => null), rows: await page.locator('.pivot-table tbody tr').count(), url: new URL(page.url()).search };
    // back to the map: same map instance count as before the page switch (no remount)
    await page.goBack();
    await sleep(1500);
    res.back = { screen: await page.locator('main').getAttribute('data-screen'), url: new URL(page.url()).search };
    await page.locator('.rail button[aria-label="지도"]').click();
    await sleep(1500);
    res.backToMap = { screen: await page.locator('main').getAttribute('data-screen'), maps: await page.evaluate(() => window.__kakaoStats.maps), maps0 };
    // address → 통계 carries the address as a removable chip
    await zoomToPins(page);
    await clickPin(page, 0);
    await sleep(1200);
    await page.locator('.place-panel').getByRole('button', { name: '이 조건으로 통계 만들기' }).click();
    await sleep(2500);
    res.placeHandoff = { chips: await page.locator('.stats-builder .stats-chips').first().innerText(), total: await page.locator('.stats-result-head .subtitle').innerText() };
    await context.close();
    return res;
  });

  // ── S03 sticky navigation (NV) ────────────────────────────────────────────────────────────────
  await step('NV', async () => {
    const res = {};
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      const { page, context } = await fresh({ width: w, height: h });
      const r = {};
      for (const [label, id] of [['기관', 'entities'], ['추이', 'analytics'], ['지역', 'regions'], ['지도', 'mapsection']]) {
        const nav = w < 800 ? page.locator('.bottom-nav button', { hasText: label }) : page.locator(`.rail button[aria-label="${label}"]`);
        await nav.click();
        await sleep(900);
        r[label] = await page.evaluate((sid) => {
          const bar = document.querySelector('.topbar').getBoundingClientRect().bottom;
          const el = document.getElementById(sid).getBoundingClientRect().top;
          return { topbarBottom: Math.round(bar), sectionTop: Math.round(el), inset: getComputedStyle(document.documentElement).getPropertyValue('--scroll-top-inset').trim() };
        }, id);
        if (label === '기관') await shot(page, `NV-entities-${w}`);
      }
      res[w] = r;
      await context.close();
    }
    return res;
  });

  // ── S06 target selector (MS) + S07 table/chart (CH) ───────────────────────────────────────────
  await step('MS_CH', async () => {
    const { page, consoleErrors, context } = await fresh();
    const res = { consoleErrors };
    await page.locator('.rail button[aria-label^="통계"]').click();
    await sleep(3000);
    await page.getByRole('button', { name: '비교 대상 선택' }).click();
    await sleep(900);
    const dlg = page.getByRole('dialog', { name: '비교 대상 선택' });
    res.firstPage = await dlg.locator('.picker-list li').count();
    const search = dlg.locator('input[type=search]');
    const n0 = (await log()).length;
    await search.pressSequentially('경찰', { delay: 60 });
    await sleep(1000);
    res.searchRequests = summarizeLog((await log()).slice(n0).filter((e) => e.route === 'statistics/candidates'));
    res.searchFocus = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
    const boxes = dlg.locator('.picker-list input[type=checkbox]');
    const nBoxes = await boxes.count();
    for (let i = 0; i < Math.min(3, nBoxes); i++) await boxes.nth(i).check();
    await search.fill('');
    await sleep(900);
    res.keptAfterSearchChange = await dlg.locator('.picker-chosen li').count();
    await dlg.screenshot({ path: join(dir, 'MS-picker-1440.png') });
    await dlg.getByRole('button', { name: '적용' }).click();
    await sleep(300);
    const n1 = (await log()).length;
    await api('delay', { 'statistics/query': 2000 });
    await page.getByRole('button', { name: '통계 만들기' }).click();
    await sleep(500);
    res.runButton = await page.locator('.stats-run .primary-button').innerText();
    res.running = { status: await page.locator('.stats-result .panel-status').innerText().catch(() => null), top: await status(page) };
    await shot(page, 'LD-statistics-running-1440');
    await sleep(2500);
    await api('delay', {});
    res.result = { requests: summarizeLog((await log()).slice(n1)), rows: await page.locator('.pivot-table tbody tr').count(), chips: await page.locator('.stats-builder .stats-chips').nth(1).innerText() };
    await shot(page, 'CH-table-selected-agencies-1440');
    const firstRow = await page.locator('.pivot-table tbody tr').first().innerText();
    const n2 = (await log()).length;
    await page.locator('.stats-result').getByRole('button', { name: '그래프', exact: true }).click();
    await sleep(900);
    res.chart = { series: await series(page, '.stats-chart-host'), requests: summarizeLog((await log()).slice(n2)) };
    await shot(page, 'CH-chart-heatmap-1440');
    await page.locator('.stats-result').getByRole('button', { name: '표', exact: true }).click();
    await sleep(300);
    res.tableSameAfterRoundTrip = firstRow === await page.locator('.pivot-table tbody tr').first().innerText();
    // month recipe: rows 답변 월 → line chart with the selected agencies' values
    await page.getByLabel('열 추가').selectOption('completed_month').catch(() => undefined);
    await page.locator('.stats-list').nth(1).getByRole('button', { name: /위반법규 빼기/ }).click().catch(() => undefined);
    await sleep(200);
    res.unapplied = await page.locator('.unapplied-note').innerText().catch(() => null);
    await page.getByRole('button', { name: '통계 만들기' }).click();
    await sleep(2500);
    await page.locator('.stats-result').getByRole('button', { name: '그래프', exact: true }).click();
    await sleep(900);
    res.monthLine = { series: (await series(page, '.stats-chart-host'))?.length, typeOptions: await page.locator('.stats-result select').first().locator('option').allInnerTexts() };
    await shot(page, 'CH-agency-by-month-line-1440');
    // cancel keeps the query
    await page.getByRole('button', { name: '비교 대상 선택' }).click();
    await sleep(500);
    await page.keyboard.press('Escape');
    await sleep(300);
    res.escClosesPickerOnly = { dialogs: await page.getByRole('dialog', { name: '비교 대상 선택' }).count(), screen: await page.locator('main').getAttribute('data-screen') };
    await context.close();
    return res;
  });

  // ── MT-21: monthly card hand-off (4 rates, compare) ───────────────────────────────────────────
  await step('MT21', async () => {
    const { page, consoleErrors, context } = await fresh();
    const card = page.locator('.trend-card');
    await card.scrollIntoViewIfNeeded();
    await card.getByRole('button', { name: '처리결과 비율' }).click();
    await card.getByRole('button', { name: '전체 선택' }).click();
    await card.getByRole('button', { name: '이 조건으로 통계 만들기' }).click();
    await sleep(3000);
    const res = { consoleErrors, head: await page.locator('.stats-result-head h2').innerText(), rows: await page.locator('.pivot-table tbody tr').count() };
    await page.locator('.stats-result').getByRole('button', { name: '그래프', exact: true }).click();
    await sleep(900);
    res.series = await series(page, '.stats-chart-host');
    await shot(page, 'MT21-handoff-line-1440');
    await context.close();
    return res;
  });

  // ── widths × themes ───────────────────────────────────────────────────────────────────────────
  await step('widths', async () => {
    const res = {};
    for (const theme of ['dark', 'light']) for (const width of [1920, 1440, 1280, 768, 390]) {
      const { page, consoleErrors, context } = await fresh({ width, height: width < 800 ? 844 : 1000, theme });
      const card = page.locator('.trend-card');
      await card.scrollIntoViewIfNeeded();
      await card.getByRole('button', { name: '처리결과 비율' }).click();
      await card.getByRole('button', { name: '전체 선택' }).click();
      await sleep(400);
      await card.screenshot({ path: join(dir, `W-trend-${width}-${theme}.png`) });
      await page.locator('.area-side').screenshot({ path: join(dir, `W-scope-${width}-${theme}.png`) });
      const overflowDash = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      await page.locator('.bottom-nav button:visible, .rail button:visible').filter({ hasText: '통계' }).first().click();
      await sleep(3000);
      await shot(page, `W-stats-${width}-${theme}`);
      res[`${width}-${theme}`] = { overflowDash, overflowStats: await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), consoleErrors };
      await context.close();
    }
    return res;
  });
} finally {
  writeFileSync(join(dir, 'scope-statistics.json'), JSON.stringify(out, null, 2));
  await browser.close();
}
