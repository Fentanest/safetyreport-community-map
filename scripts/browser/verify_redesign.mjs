// Browser acceptance run for the dashboard redesign (LOCAL stack: real handlers + synthetic facts + MOCK map SDK).
// node scripts/browser/verify_redesign.mjs <evidence-dir>
// Writes <dir>/verify.json and screenshots. Fixture evidence only — not a real Kakao SDK / production pass.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, openPage, waitMap, api, sleep, summarizeLog } from './harness.mjs';

const dir = process.argv[2] || 'evidence';
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args: ['--lang=ko-KR'] });
// partial runs (ONLY=...) merge into the previous results
const out = existsSync(join(dir, 'verify.json')) ? JSON.parse(readFileSync(join(dir, 'verify.json'), 'utf8')) : {};
const shot = (page, name, opts = {}) => page.screenshot({ path: join(dir, `${name}.png`), ...opts });
const log = async () => api('log');
const since = (all, n) => all.slice(n);
const lastMap = (page, fn, arg) => page.evaluate(([f, a]) => { const m = window.__kakaoMaps[window.__kakaoMaps.length - 1]; return new Function('m', 'a', f)(m, a); }, [fn, arg]);
const active = (page) => page.evaluate(() => {
  const a = document.activeElement;
  return `${a?.tagName}${a?.getAttribute('type') ? `[${a.getAttribute('type')}]` : ''}${a?.getAttribute('aria-label') ? `(${a.getAttribute('aria-label')})` : ''}`;
});
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
  return fn().then((r) => { out[name] = r; console.log(name, JSON.stringify(r).slice(0, 400)); })
    .catch((e) => { out[name] = { error: String(e && e.stack || e) }; console.log(name, 'ERROR', e); });
}

try {
  // ── R01/R02/R03 + P01 (metric switch) ──────────────────────────────────────────────────────────
  await step('R01_R02_R03', async () => {
    const { page, consoleErrors, context } = await fresh();
    const text = await page.locator('.map-card').innerText();
    const n0 = (await log()).length;
    const maps0 = await page.evaluate(() => window.__kakaoStats.maps);
    const runs = {};
    for (const label of ['신고 수', '수용률', '불수용률', '과태료']) {
      await page.locator('.metric-switch').getByRole('button', { name: label, exact: true }).click();
      await sleep(250);
      runs[label] = await page.evaluate(() => window.__kakaoLiveMarkers().slice(0, 5).map((m) => ({
        text: />([^<>]+)<\/text><\/svg>$/.exec(m.src)?.[1], fill: /circle cx="\d+" cy="\d+" r="(?:16|22)" fill="([^"]+)"/.exec(m.src)?.[1] })));
      runs[`${label}_legend`] = await page.locator('.map-legend').innerText();
      if (label === '과태료') await shot(page, 'R03-metric-fine-1440');
      if (label === '불수용률') await shot(page, 'R03-metric-rejection-1440');
    }
    const after = await log();
    const res = {
      buttons: await page.locator('.metric-switch button').allInnerTexts(),
      removedTexts: ['내 신고가 있는 곳', '함께 신고한 곳', '관심 지역', '보이는 지역만 보기'].filter((t) => text.includes(t)),
      pointFilterNodes: await page.locator('.point-filter, .map-apply').count(),
      metricRuns: runs,
      requestsDuringMetricSwitch: summarizeLog(since(after, n0)),
      mapInstancesBefore: maps0, mapInstancesAfter: await page.evaluate(() => window.__kakaoStats.maps),
      consoleErrors,
    };
    // old ?pointFilter-like values in storage/URL cannot hide pins: load with junk params
    const p2 = await context.newPage();
    await p2.goto(`${page.url().split('?')[0]}?filter=mine&pointFilter=mine&point_filter=interest`);
    await p2.waitForFunction(() => window.__kakaoLiveMarkers && window.__kakaoLiveMarkers().length > 0, null, { timeout: 15000 });
    res.markersWithLegacyParams = await p2.evaluate(() => window.__kakaoLiveMarkers().length);
    res.markersDefault = await page.evaluate(() => { document.querySelector('.metric-switch button')?.click(); return 0; });
    await sleep(200);
    res.markersDefault = await page.evaluate(() => window.__kakaoLiveMarkers().length);
    await context.close();
    return res;
  });

  // ── R04 / P01 / P02: auto refresh with 20 fast pans ───────────────────────────────────────────
  await step('R04_P01_P02', async () => {
    const { page, context, navs } = await fresh();
    const maps0 = await page.evaluate(() => window.__kakaoStats.maps);
    await page.getByText('지도를 움직이면 통계도 바꾸기').click();
    await sleep(300);
    const scrollBefore = await page.evaluate(() => window.scrollY);
    const n0 = (await log()).length;
    const level0 = await lastMap(page, 'return m.level');
    const hist0 = await page.evaluate(() => history.length);
    for (let i = 0; i < 20; i++) { await lastMap(page, 'm.__userPan(a % 2 ? 30 : -25, 8)', i); await sleep(90); }
    await sleep(3500);
    const all = await log();
    const during = since(all, n0);
    const res = {
      mapInstancesBefore: maps0, mapInstancesAfter: await page.evaluate(() => window.__kakaoStats.maps),
      levelBefore: level0, levelAfter: await lastMap(page, 'return m.level'),
      scrollYBefore: scrollBefore, scrollYAfter: await page.evaluate(() => window.scrollY),
      requests: summarizeLog(during), statuses: during.map((e) => `${e.route}:${e.status}`),
      lastDashboardBbox: during.filter((e) => e.route === 'dashboard').at(-1)?.params.bbox ?? null,
      urlBbox: new URL(page.url()).searchParams.get('bbox'),
      historyGrowth: (await page.evaluate(() => history.length)) - hist0,
      documentNavigations: navs(), skeletonsShown: await page.evaluate(() => window.__skeletons),
      chips: await page.locator('.applied-chip').allInnerTexts(),
    };
    await shot(page, 'R04-after-20-pans-1440');
    // stale response: delay dashboard, explicit A then B
    await api('delay', { dashboard: 1200 });
    const n1 = (await log()).length;
    await page.locator('.command .segments').getByRole('button', { name: '교통위반' }).click();
    await sleep(150);
    await page.locator('.command .segments').getByRole('button', { name: '주정차' }).click();
    await sleep(3500);
    await api('delay', {});
    res.staleTest = { requests: since(await log(), n1).map((e) => `${e.route}:${e.params.category}`),
      kpiScope: await page.locator('.kpi-panel .subtitle').first().innerText(),
      categoryPressed: await page.locator('.command .segments[aria-label="신고 분류"] button[aria-pressed="true"]').innerText() };
    await context.close();
    return res;
  });

  // ── P03: 429 / 409 / 5xx ─────────────────────────────────────────────────────────────────────
  await step('P03', async () => {
    const { page, context } = await fresh();
    await page.getByText('지도를 움직이면 통계도 바꾸기').click();
    await api('inject', { route: 'dashboard', status: 429, times: 1, retryAfter: 10 });
    const n0 = (await log()).length;
    await lastMap(page, 'm.__userPan(40, 0)');
    await sleep(1800);
    const banner = await page.locator('.banner').first().innerText().catch(() => null);
    const kpiDuring = await page.locator('.kpi-card .kpi-value').first().innerText();
    await shot(page, 'P03-429-banner-1440', { fullPage: false });
    const t429 = Date.now();
    for (let i = 0; i < 4; i++) { await lastMap(page, 'm.__userPan(-20, 10)'); await sleep(900); }
    const beforeWait = since(await log(), n0).filter((e) => e.route === 'dashboard');
    await sleep(Math.max(0, 11000 - (Date.now() - t429)) + 2500);
    const allDash = since(await log(), n0).filter((e) => e.route === 'dashboard');
    const res = { banner, kpiDuring, dashboardDuringWait: beforeWait.map((e) => e.status),
      afterWait: allDash.slice(beforeWait.length).map((e) => ({ status: e.status, bbox: e.params.bbox })),
      finalUrlBbox: new URL(page.url()).searchParams.get('bbox') };
    // 409 once → meta re-read → success
    await api('inject', { route: 'dashboard', status: 409, times: 1 });
    const n1 = (await log()).length;
    await page.locator('.command .segments').getByRole('button', { name: '기타' }).click();
    await sleep(2500);
    res.conflict = since(await log(), n1).map((e) => `${e.route}:${e.status}`);
    res.conflictBanner = await page.locator('.banner.error, .banner.warn').count();
    // 503 twice → one retry then visible error, old data kept
    await api('inject', { route: 'dashboard', status: 503, times: 2 });
    const n2 = (await log()).length;
    await page.locator('.command .segments').getByRole('button', { name: '전체' }).click();
    await sleep(4000);
    res.serverError = { requests: since(await log(), n2).map((e) => `${e.route}:${e.status}`),
      banner: await page.locator('.banner').first().innerText().catch(() => null),
      mapStillMounted: await page.locator('.map-card').count(), kpiStill: await page.locator('.kpi-card').count() };
    await context.close();
    return res;
  });

  // ── P04: access loss clears data ────────────────────────────────────────────────────────────
  await step('P04', async () => {
    const { page, context } = await fresh();
    const before = await page.locator('.kpi-card .kpi-value').first().innerText();
    await api('access', { access: 'revoked' });
    await page.locator('.command .segments').getByRole('button', { name: '주정차' }).click();
    await sleep(3000);
    const res = { kpiBefore: before, gate: await page.locator('.access-gate').count(), gateTitle: await page.locator('#gate-title').innerText().catch(() => null),
      kpiAfter: await page.locator('.kpi-card').count(), mapAfter: await page.locator('.map-card').count(),
      localStorageKeys: await page.evaluate(() => Object.keys(localStorage)),
      sessionStorageHasResponses: await page.evaluate(() => Object.values(sessionStorage).some((v) => v.includes('overview'))) };
    await shot(page, 'P04-access-gate-1440', { fullPage: false });
    await api('access', { access: 'ok' });
    await context.close();
    return res;
  });

  // ── R05/R06/R07: address pins + place panel ─────────────────────────────────────────────────
  await step('R05_R06_R07', async () => {
    const { page, context } = await fresh();
    // zoom into Seoul (programmatic, auto refresh is off)
    await lastMap(page, 'm.setCenter(new kakao.maps.LatLng(37.54, 127.02)); m.setLevel(6)');
    await sleep(800);
    const pins = await page.evaluate(() => window.__kakaoLiveMarkers().map((m) => m.title));
    const n0 = (await log()).length;
    await api('delay', { 'places/:key': 700 });
    // A → B fast: only B may land
    await page.evaluate(() => { const ms = window.__kakaoLiveMarkers().filter((m) => !m.title.includes('묶음')); ms[0].marker.__click(); setTimeout(() => ms[1].marker.__click(), 150); });
    await sleep(2500);
    await api('delay', {});
    const panel = page.locator('.place-panel');
    const head = await panel.locator('h2').innerText();
    const expectedB = await page.evaluate(() => window.__kakaoLiveMarkers().filter((m) => !m.title.includes('묶음'))[1].title.split(' · ')[0]);
    const text = await panel.innerText();
    const sections = await panel.locator('section, h3').allInnerTexts();
    const req = since(await log(), n0);
    await shot(page, 'R05-place-panel-1440', { fullPage: false });
    const res = {
      pinTitles: pins, distinctTitles: new Set(pins).size === pins.length,
      panelTitle: head, expectedB, bWins: head === expectedB,
      hasTabs: await panel.locator('[role="tab"]').count(),
      order: ['요약', '처리 결과', '처리 기관', '담당자'].map((s) => text.indexOf(s)),
      hasAddressCopy: text.includes('주소 복사'), hasCoordinateUi: /좌표|위도|경도/.test(text),
      warningLabel: text.includes('계도'), completedLabelInSummary: /답변 완료/.test(await panel.locator('.place-summary').innerText()),
      requestsOnClick: summarizeLog(req), placeKeys: req.filter((e) => e.route === 'places/:key').length,
      sectionsSample: sections.slice(0, 6),
    };
    // pick an agency from the place → filter applied and chip shown
    await panel.locator('.place-entity').first().click();
    await sleep(1500);
    res.chipsAfterPick = await page.locator('.applied-chip').allInnerTexts();
    await context.close();
    return res;
  });

  // ── R08: active filters / chips / back ──────────────────────────────────────────────────────
  await step('R08', async () => {
    const res = {};
    for (const theme of ['dark', 'light']) {
      const { page, context } = await fresh({ theme });
      await page.locator('.region-list .region-pick').first().click();
      await sleep(1500);
      await page.locator('.command .law-select select').selectOption({ index: 2 });
      await sleep(1500);
      const btn = page.locator('.control-extra');
      const styles = await btn.evaluate((el) => { const c = getComputedStyle(el); return { bg: c.backgroundColor, fg: c.color, cls: el.className, label: el.getAttribute('aria-label') }; });
      const chips = await page.locator('.applied-chip').allInnerTexts();
      await page.evaluate(() => window.scrollTo(0, 0));
      await sleep(300);
      await shot(page, `R08-active-filters-${theme}-1440`, { fullPage: false, clip: { x: 0, y: 60, width: 1440, height: 420 } });
      const url1 = page.url();
      await page.locator('.applied-chip').filter({ hasText: '법규' }).getByRole('button').click();
      await sleep(1200);
      const afterRemove = await page.locator('.applied-chip').allInnerTexts();
      await page.goBack();
      await sleep(1500);
      const afterBack = await page.locator('.applied-chip').allInnerTexts();
      const lawSelect = await page.locator('.command .law-select select').inputValue();
      const regionActive = await page.locator('.region-row.active').count();
      res[theme] = { buttonStyle: styles, chips, afterRemove, afterBack, backRestoredUrl: page.url() === url1, lawSelect, regionActive };
      await context.close();
    }
    return res;
  });

  // ── R09: table toolbar / columns / server list ──────────────────────────────────────────────
  await step('R09', async () => {
    const res = {};
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      const { page, context } = await fresh({ width: w, height: h });
      const table = page.locator('#entities');
      await table.scrollIntoViewIfNeeded();
      const order = await table.locator('.entity-toolbar > *').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') || e.textContent?.trim().slice(0, 12)));
      const kind = await table.locator('.kind-switch').boundingBox();
      const r = { order, kindSwitchBox: kind, kindInViewportX: kind ? kind.x >= 0 && kind.x + kind.width <= w : false };
      if (w === 1440) {
        const n0 = (await log()).length;
        await table.getByRole('button', { name: '열 선택' }).click();
        await table.locator('.col-menu label').filter({ hasText: /^수용률$/ }).locator('input').uncheck();
        r.headersAfterHide = await table.locator('thead th').allInnerTexts();
        await table.locator('.col-menu label').filter({ hasText: /^계도$/ }).locator('input').check();
        r.headersAfterAdd = await table.locator('thead th').allInnerTexts();
        await page.keyboard.press('Escape');
        await table.locator('.kind-switch').getByRole('button', { name: '담당자' }).click();
        await sleep(400);
        r.requestsAfterKindSwitch = summarizeLog(since(await log(), n0));
        const search = table.getByRole('searchbox', { name: '기관·담당자 이름 검색' });
        const n1 = (await log()).length;
        await search.pressSequentially('김하늘', { delay: 60 });
        await sleep(1200);
        r.searchRequests = since(await log(), n1).filter((e) => e.route === 'entities').map((e) => e.params.q);
        r.rowsAfterSearch = await table.locator('tbody tr').count();
        await search.fill('');
        await sleep(800);
        await table.locator('.kind-switch').getByRole('button', { name: '기관' }).click();
        await table.getByRole('button', { name: '경찰', exact: true }).click();
        await sleep(1200);
        r.policeRows = await table.locator('tbody .table-name').allInnerTexts();
        r.policeRequest = (await log()).filter((e) => e.route === 'entities').at(-1)?.params;
        await table.getByRole('button', { name: '전체 보기' }).click();
        await sleep(1200);
        r.expandedPager = await table.locator('.table-pager').innerText().catch(() => null);
        await shot(page, 'R09-entity-table-expanded-1440', { fullPage: false, clip: await table.boundingBox().then((b) => ({ x: 0, y: Math.max(0, b.y), width: 1440, height: Math.min(700, b.height) })) }).catch(() => undefined);
        // local error: inject failure only for entities
        await api('inject', { route: 'entities', status: 503, times: 3 });
        await table.getByRole('button', { name: '비경찰' }).click();
        await sleep(1500);
        r.localError = await table.locator('.banner.error').innerText().catch(() => null);
        r.mapStillThere = await page.locator('.map-card').count();
      } else {
        await table.screenshot({ path: join(dir, 'R09-entity-table-390.png') });
        r.pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      }
      res[w] = r;
      await context.close();
    }
    return res;
  });

  // ── R10: drawer date sequential typing ──────────────────────────────────────────────────────
  await step('R10', async () => {
    const { page, context } = await fresh();
    const n0 = (await log()).length;
    await page.getByRole('button', { name: /상세 필터/ }).click();
    await sleep(300);
    const start = page.locator('.drawer input[type=date]').nth(0);
    const end = page.locator('.drawer input[type=date]').nth(1);
    // Type into the first (leftmost) segment and let the browser decide the segment order. This Chromium build
    // renders mm/dd/yyyy even with a ko-KR context, so the sequence is chosen from the rendered order.
    // The segment order depends on the browser UI locale (this headless build shows mm/dd/yyyy even with ko-KR),
    // so both orders are tried; `.fill('')` is used only to reset between the two attempts, never to type the date.
    const typeDate = async (input, iso) => {
      const [y, m, d] = iso.split('-');
      let last = null;
      for (const [order, seq] of [['mm/dd/yyyy', [...m, ...d, ...y]], ['yyyy.mm.dd', [...y, 'ArrowRight', ...m, ...d]]]) {
        const box = await input.boundingBox();
        await page.mouse.click(box.x + 12, box.y + box.height / 2);
        const trace = [];
        for (const key of seq) {
          await page.keyboard.press(key);
          await sleep(60);
          trace.push({ key, active: await active(page), value: await input.inputValue() });
        }
        last = { order, trace, value: await input.inputValue() };
        if (last.value === iso) return last;
        await input.fill('');
      }
      return last;
    };
    const startRun = await typeDate(start, '2026-03-15');
    const steps = startRun.trace;
    const endRun = await typeDate(end, '2026-02-01');
    const endValue = endRun.value;
    const whileTyping = summarizeLog(since(await log(), n0));
    await page.locator('.drawer').getByRole('button', { name: '적용' }).click();
    await sleep(600);
    const reversedError = await page.locator('#drawer-date-error').innerText().catch(() => null);
    const draftKept = [await start.inputValue(), await end.inputValue()];
    await shot(page, 'R10-drawer-reversed-error-1440', { fullPage: false });
    // fix the end date and apply → one refresh
    const fixRun = await typeDate(end, '2026-05-31');
    const n1 = (await log()).length;
    await page.locator('.drawer').getByRole('button', { name: '적용' }).click();
    await sleep(2000);
    const applied = summarizeLog(since(await log(), n1));
    const topDate = await page.locator('.command .control').first().innerText();
    const drawerOpenAfterApply = await page.locator('.drawer').count();
    if (drawerOpenAfterApply) await page.keyboard.press('Escape');
    // Escape restores focus to the opener
    await page.getByRole('button', { name: /상세 필터/ }).click();
    await sleep(200);
    await page.keyboard.press('Escape');
    await sleep(200);
    const focusAfterEsc = await active(page);
    // calendar-free paste path: fill once is also accepted
    await context.close();
    return { drawerOpenAfterApply, order: startRun.order, startValue: startRun.value, steps, endValue, fixValue: fixRun.value, whileTyping, reversedError, draftKept, appliedRequests: applied, topDate, focusAfterEsc };
  });

  // ── A01–A06 + personal compare ─────────────────────────────────────────────────────────────
  await step('A_charts', async () => {
    const { page, context } = await fresh();
    const charts = page.locator('#analytics');
    await charts.scrollIntoViewIfNeeded();
    await sleep(800);
    await charts.screenshot({ path: join(dir, 'A-analytics-dark-1440.png') });
    const titles = await charts.locator('.chart-card h2').allInnerTexts();
    const captions = await charts.locator('.chart-caption').allInnerTexts();
    // A05 rate view
    await page.locator('.trend-card').getByRole('button', { name: '처리결과 비율' }).click();
    await sleep(400);
    const trendAria = await page.locator('.trend-card .chart-host').getAttribute('aria-label');
    // A02 cell click → agency + law in ONE request
    const heat = page.locator('.chart-card').filter({ hasText: '위반법규 처리결과' }).locator('.chart-host');
    await heat.scrollIntoViewIfNeeded();
    await sleep(300);
    const box = await heat.boundingBox();
    const n0 = (await log()).length;
    // first data cell: grid left 150px, top 8px; cells ≈ (width-166)/laws × 30px
    await page.mouse.move(box.x + 190, box.y + 22);
    await sleep(300);
    const cellTooltip = await page.locator('.chart-card div[style*="z-index: 9999999"]').allInnerTexts().catch(() => null);
    await page.mouse.click(box.x + 190, box.y + 22);
    await sleep(2000);
    const cellReq = since(await log(), n0).filter((e) => e.route === 'dashboard').map((e) => e.params);
    const chips = await page.locator('.applied-chip').allInnerTexts();
    // personal compare on
    const n1 = (await log()).length;
    await page.locator('.compare-toggle input').check();
    await sleep(2500);
    const personalReq = summarizeLog(since(await log(), n1));
    const mineLines = await page.locator('.kpi-mine').allInnerTexts();
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, 'A-personal-compare-1440', { fullPage: false });
    await charts.screenshot({ path: join(dir, 'A-analytics-personal-1440.png') });
    await context.close();
    return { cellTooltip, titles, captions, trendAria: trendAria?.slice(0, 160), cellRequest: cellReq, chipsAfterCell: chips, personalReq, mineLines: mineLines.slice(0, 4) };
  });

  // ── P01: view/theme/selection never recreate the map (dev StrictMode mounts twice at start) ─────────
  await step('P01_views', async () => {
    const { page, context } = await fresh();
    const maps0 = await page.evaluate(() => window.__kakaoStats.maps);
    const n0 = (await log()).length;
    const seq = [];
    for (const v of ['지도 크게', '통계 크게', '지도+통계']) {
      await page.locator('.view-switch').getByRole('button', { name: v }).click(); await sleep(500);
      seq.push({ view: v, maps: await page.evaluate(() => window.__kakaoStats.maps), relayouts: await page.evaluate(() => window.__kakaoStats.relayout) });
      if (v === '지도 크게') await shot(page, 'P01-view-map-1440', { fullPage: false });
    }
    await page.locator('.topbar').getByRole('button', { name: /다크|라이트|시스템/ }).click(); await sleep(500);
    seq.push({ theme: 'toggled', maps: await page.evaluate(() => window.__kakaoStats.maps) });
    await lastMap(page, 'm.setCenter(new kakao.maps.LatLng(37.54, 127.02)); m.setLevel(6)'); await sleep(600);
    await page.evaluate(() => window.__kakaoLiveMarkers().find((m) => !m.title.includes('묶음')).marker.__click()); await sleep(1200);
    seq.push({ selected: await page.locator('.place-panel h2').innerText(), maps: await page.evaluate(() => window.__kakaoStats.maps) });
    const req = summarizeLog(since(await log(), n0));
    await context.close();
    return { mapsAtStart: maps0, seq, requests: req, navigationsNote: 'view switch uses pushState only' };
  });

  // ── P07: widths × themes ───────────────────────────────────────────────────────────────────
  await step('P07', async () => {
    const res = {};
    for (const theme of ['dark', 'light']) {
      for (const [w, h] of [[390, 844], [768, 1024], [1440, 900], [1920, 1080]]) {
        const { page, context, consoleErrors } = await fresh({ width: w, height: h, theme });
        await shot(page, `P07-${w}-${theme}`, { fullPage: true });
        res[`${w}-${theme}`] = {
          overflow: await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
          offscreenButtons: await page.evaluate(() => [...document.querySelectorAll('main button')].filter((b) => {
            const r = b.getBoundingClientRect(); if (!r.width) return false;
            let el = b.parentElement; while (el) { const o = getComputedStyle(el).overflowX; if (o === 'auto' || o === 'scroll') return false; el = el.parentElement; }
            return r.right > window.innerWidth + 1 || r.left < -1;
          }).map((b) => b.textContent.trim().slice(0, 20))),
          consoleErrors: consoleErrors.slice(0, 5),
        };
        await context.close();
      }
    }
    return res;
  });
} finally {
  writeFileSync(join(dir, 'verify.json'), JSON.stringify(out, null, 2));
  await browser.close();
}
