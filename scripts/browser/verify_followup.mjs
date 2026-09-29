// Browser acceptance run for the 2026-09-30 follow-up R1–R7 (LOCAL stack: real handlers + synthetic facts incl. a
// 2014–2024 synthetic history + MOCK map SDK). node scripts/browser/verify_followup.mjs <evidence-dir>
// Fixture evidence only — not a real Kakao SDK / production pass.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, openPage, waitMap, api, sleep, summarizeLog } from './harness.mjs';

const dir = process.argv[2] || 'evidence';
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args: ['--lang=ko-KR'] });
const out = existsSync(join(dir, 'followup.json')) ? JSON.parse(readFileSync(join(dir, 'followup.json'), 'utf8')) : {};
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
  return fn().then((r) => { out[name] = r; console.log(name, JSON.stringify(r).slice(0, 600)); })
    .catch((e) => { out[name] = { error: String(e && e.stack || e) }; console.log(name, 'ERROR', e); });
}
const dateButton = (page) => page.locator('.command > button.control').first();
const chipsText = (page) => page.locator('.applied-chips, .applied').first().innerText().catch(() => '');
const typeDate = async (page, input, iso) => {
  const [y, m, d] = iso.split('-');
  for (const seq of [[...m, ...d, ...y], [...y, 'ArrowRight', ...m, ...d]]) {
    const box = await input.boundingBox();
    await page.mouse.click(box.x + 12, box.y + box.height / 2);
    for (const key of seq) await page.keyboard.press(key);
    if (await input.inputValue() === iso) return iso;
    await input.fill('');
  }
  return input.inputValue();
};
const pickPlace = async (page) => {
  // choose the place with the most answered reports among the drawn pins (more managers for the chart)
  await page.evaluate(() => {
    const ms = window.__kakaoLiveMarkers().filter((m) => !m.title.includes('묶음'));
    const n = (m) => Number(/(\d+)\s*건/.exec(m.title)?.[1] ?? 0);
    ms.sort((a, b) => n(b) - n(a))[0].marker.__click();
  });
  await page.waitForSelector('.place-entities .pe-row', { timeout: 15000 });
  await sleep(800);
};

try {
  // ── R1: 전체 기간, a typed 12-year range, category 전체 keeps dates, back button ──────────────────
  await step('R1', async () => {
    const { page, consoleErrors, context } = await fresh();
    const res = { consoleErrors };
    await dateButton(page).click();
    await sleep(300);
    const allBtn = page.locator('.preset-row button', { hasText: '전체 기간' });
    res.allPresetTitle = await allBtn.getAttribute('title');
    res.allPresetDisabled = await allBtn.isDisabled();
    const n0 = (await log()).length;
    await allBtn.click();
    await sleep(1500);
    const l1 = (await log()).slice(n0);
    res.afterAll = {
      requests: summarizeLog(l1), dashboardParams: l1.filter((e) => e.route === 'dashboard').map((e) => `${e.params.start}..${e.params.end}`),
      statuses: l1.map((e) => e.status), button: await dateButton(page).innerText(), url: new URL(page.url()).search,
      popoverOpen: await page.locator('.date-pop').count(), chips: await chipsText(page),
      errorBanner: await page.locator('.error-banner, [role=alert]').allInnerTexts(),
      kpi: await page.locator('.kpi-grid').first().innerText().catch(() => null),
    };
    await shot(page, 'R1-all-period-1440');
    // category 전체 is a different control and keeps the dates
    await page.getByRole('button', { name: '교통', exact: true }).click().catch(() => page.locator('.segments button').nth(1).click());
    await sleep(900);
    await page.getByRole('button', { name: '전체 분류' }).click();
    await sleep(900);
    res.afterCategoryAll = { button: await dateButton(page).innerText(), url: new URL(page.url()).search,
      categoryAllTitle: await page.getByRole('button', { name: '전체 분류' }).getAttribute('title') };
    // typed 2014-09-30..2026-09-29 (a start before the first report is allowed; the server clamps nothing silently)
    await dateButton(page).click();
    await sleep(300);
    const inputs = page.locator('.date-pop input[type=date]');
    const n1 = (await log()).length;
    res.typed = [await typeDate(page, inputs.nth(0), '2014-09-30'), await typeDate(page, inputs.nth(1), '2026-09-29')];
    await page.locator('.date-pop').getByRole('button', { name: '적용' }).click();
    await sleep(1500);
    const l2 = (await log()).slice(n1);
    res.afterTyped = { requests: summarizeLog(l2), statuses: l2.map((e) => `${e.route}:${e.status}`), button: await dateButton(page).innerText(),
      url: new URL(page.url()).search, popoverOpen: await page.locator('.date-pop').count(), chips: await chipsText(page),
      alerts: await page.locator('[role=alert]').allInnerTexts() };
    await shot(page, 'R1-12-years-1440');
    // invalid: reversed → stays open, keeps the draft, no request
    await dateButton(page).click();
    await sleep(300);
    const n2 = (await log()).length;
    await typeDate(page, inputs.nth(0), '2026-09-20');
    await typeDate(page, inputs.nth(1), '2026-09-01');
    await page.locator('.date-pop').getByRole('button', { name: '적용' }).click();
    await sleep(700);
    res.reversed = { popoverOpen: await page.locator('.date-pop').count(), error: await page.locator('.date-pop .field-error').innerText().catch(() => null),
      draft: [await inputs.nth(0).inputValue(), await inputs.nth(1).inputValue()], requests: summarizeLog((await log()).slice(n2)) };
    await shot(page, 'R1-reversed-error-1440');
    await page.keyboard.press('Escape');
    await dateButton(page).click().catch(() => undefined);
    // back button returns to the previous applied range
    await page.goBack();
    await sleep(1500);
    res.back = { button: await dateButton(page).innerText(), url: new URL(page.url()).search };
    // over-budget / server failure: the last good screen stays, marked stale, with the code in the message
    await api('inject', { route: 'dashboard', status: 503, times: 5 });
    await page.getByRole('button', { name: '주차', exact: true }).click().catch(() => page.locator('.segments button').nth(2).click());
    await sleep(2500);
    res.failure = { stale: await page.locator('.dash-grid.stale').count(), kpiStill: !!(await page.locator('.kpi-grid').count()),
      alerts: await page.locator('[role=alert]').allInnerTexts() };
    await shot(page, 'R1-failure-keeps-screen-1440');
    await context.close();
    return res;
  });

  // ── R2/R3: metric boxes and the per-manager chart ──────────────────────────────────────────────
  await step('R2_R3', async () => {
    const { page, consoleErrors, context } = await fresh();
    await pickPlace(page);
    const res = { consoleErrors };
    res.rows = await page.locator('.place-entities .pe-row').count();
    res.firstRow = await page.locator('.place-entities .pe-row').first().innerText();
    res.nestedButtons = await page.locator('button button, .pe-metrics button').count();
    res.pickTitle = await page.locator('.pe-pick').first().getAttribute('title');
    res.boxFont = await page.locator('.pe-num').first().evaluate((e) => getComputedStyle(e).fontSize);
    res.labelFont = await page.locator('.pe-label').first().evaluate((e) => getComputedStyle(e).fontSize);
    res.overflowX = await page.evaluate(() => [...document.querySelectorAll('.pe-row')].filter((r) => r.scrollWidth > r.clientWidth + 1).length);
    await page.locator('.place-panel').screenshot({ path: join(dir, 'R2-place-boxes-1440.png') });
    const chart = page.locator('.place-entity-chart');
    await chart.scrollIntoViewIfNeeded();
    await sleep(500);
    res.chartCaption = await chart.locator('.chart-caption').innerText();
    res.legend = await chart.locator('.chart-legend').innerText();
    await chart.screenshot({ path: join(dir, 'R3-chart-accept-1440.png') });
    const n0 = (await log()).length;
    await chart.getByText('과태료처분율', { exact: true }).click();
    await sleep(500);
    res.fineLegend = await chart.locator('.chart-legend').innerText();
    res.fineCaption = await chart.locator('.chart-caption').innerText();
    res.requestsOnRadio = summarizeLog((await log()).slice(n0));
    await chart.screenshot({ path: join(dir, 'R3-chart-fine-1440.png') });
    // tooltip on the first bar
    const host = chart.locator('.chart-host');
    const box = await host.boundingBox();
    await page.mouse.move(box.x + 80, box.y + box.height / 2);
    await sleep(400);
    res.tooltip = await page.evaluate(() => [...document.querySelectorAll('.chart-host div')].map((d) => d.innerText).filter((t) => t && t.includes('%')).slice(0, 1)[0] ?? null);
    await chart.getByRole('button', { name: '표로 보기' }).click();
    await sleep(300);
    res.table = (await chart.locator('table').innerText()).split('\n').slice(0, 4);
    await chart.screenshot({ path: join(dir, 'R3-chart-table-1440.png') });
    await context.close();
    return res;
  });

  // ── R3 crowd: 110 managers at one synthetic address → first page 100, zoom, load more ────────────
  await step('R3_crowd', async () => {
    const { page, consoleErrors, context } = await fresh();
    await lastMap(page, 'm.setCenter(new kakao.maps.LatLng(37.5663, 126.9779)); m.setLevel(2)');
    await sleep(2500);
    await page.evaluate(() => {
      const ms = window.__kakaoLiveMarkers().filter((m) => !m.title.includes('묶음'));
      ms.sort((a, b) => Math.hypot(a.lat - 37.5663, a.lng - 126.9779) - Math.hypot(b.lat - 37.5663, b.lng - 126.9779))[0].marker.__click();
    });
    await page.waitForSelector('.place-entity-chart', { timeout: 15000 });
    await sleep(1200);
    const chart = page.locator('.place-entity-chart');
    await chart.scrollIntoViewIfNeeded();
    const res = { consoleErrors, place: await page.locator('.place-panel h2').innerText() };
    res.captionFirst = await chart.locator('.chart-caption').innerText();
    await chart.screenshot({ path: join(dir, 'R3-crowd-first-page-1440.png') });
    const n0 = (await log()).length;
    await chart.getByRole('button', { name: /나머지 담당자 불러오기/ }).click();
    await sleep(2000);
    const l = (await log()).slice(n0);
    res.loadMore = { requests: summarizeLog(l), entityLimit: l.filter((e) => e.route === 'places/:key').map((e) => e.params.entity_limit),
      caption: await chart.locator('.chart-caption').innerText(), stillSamePlace: await page.locator('.place-panel h2').innerText() };
    await chart.getByRole('button', { name: '표로 보기' }).click();
    await sleep(300);
    res.tableRows = await chart.locator('tbody tr').count();
    await chart.screenshot({ path: join(dir, 'R3-crowd-all-table-1440.png') });
    await context.close();
    return res;
  });

  // ── R4/R5/R6: heatmap without 법규 미상, paired rating rows, no "1건" badges ─────────────────────
  await step('R4_R5_R6', async () => {
    const { page, consoleErrors, context } = await fresh();
    const res = { consoleErrors };
    const heat = page.locator('article[aria-label="기관별 위반법규 처리결과"]');
    await heat.scrollIntoViewIfNeeded();
    await heat.getByRole('button', { name: '표로 보기' }).click();
    await sleep(300);
    res.heatHeader = (await heat.locator('thead').innerText()).replace(/\s+/g, ' ');
    res.heatHasUnknown = res.heatHeader.includes('법규 미상');
    const rating = page.locator('article[aria-label="처리결과별 별점 분포"]');
    await rating.scrollIntoViewIfNeeded();
    await sleep(600);
    res.ratingAria = await rating.locator('.chart-host').getAttribute('aria-label');
    await rating.screenshot({ path: join(dir, 'R5-rating-compare-off-1440.png') });
    const toggle = page.locator('.compare-toggle input');
    if (!(await toggle.isChecked())) await toggle.check();
    await sleep(2000);
    res.ratingAriaCompare = await rating.locator('.chart-host').getAttribute('aria-label');
    await rating.screenshot({ path: join(dir, 'R5-rating-compare-on-1440.png') });
    await rating.getByRole('button', { name: '표로 보기' }).click();
    await sleep(300);
    res.ratingTable = (await rating.locator('tbody').innerText()).split('\n');
    await rating.screenshot({ path: join(dir, 'R5-rating-table-1440.png') });
    await toggle.uncheck();
    await sleep(800);
    res.ratingRowsAfterOff = await rating.locator('tbody tr').count();
    res.sampleOne = await page.locator('.sample-one').count();
    res.oneBadges = await page.evaluate(() => [...document.querySelectorAll('.pill, .badge')].filter((e) => /^1건$/.test(e.textContent.trim())).length);
    await context.close();
    return res;
  });

  // ── R7: rate map = regions, no pins; level by zoom; boundary pref ignored; region click ───────────
  await step('R7', async () => {
    const { page, consoleErrors, context } = await fresh();
    const res = { consoleErrors };
    const maps0 = await page.evaluate(() => window.__kakaoStats.maps);
    res.pinsReports = await page.evaluate(() => window.__kakaoLiveMarkers().length);
    // boundary preference off, then switch to 수용률: shapes still drawn
    const bToggle = page.getByRole('checkbox', { name: /^행정구역 경계/ });
    res.boundaryPrefBefore = await bToggle.isChecked();
    if (res.boundaryPrefBefore) await bToggle.uncheck();
    await sleep(600);
    res.boundaryPrefAfter = await bToggle.isChecked();
    res.polygonsReportsBoundaryOff = await page.evaluate(() => window.__kakaoStats.polygons.filter((p) => p.map).length);
    const runs = {};
    for (const label of ['수용률', '불수용률', '과태료']) {
      await page.locator('.metric-switch').getByRole('button', { name: label, exact: true }).click();
      await sleep(1200);
      runs[label] = {
        pins: await page.evaluate(() => window.__kakaoLiveMarkers().length),
        polygons: await page.evaluate(() => window.__kakaoStats.polygons.filter((p) => p.map).length),
        legend: await page.locator('.map-legend').innerText(),
        placeList: await page.locator('.map-point-alternative li, .map-place-list li').count(),
        boundaryNote: await page.locator('.map-option[role=note]').innerText().catch(() => null),
      };
    }
    res.runs = runs;
    await shot(page, 'R7-fine-sido-1440');
    // zoom: level > 9 → 시도, ≤ 9 → 시군구, and back
    const levels = [];
    for (const target of [8, 11, 7]) {
      await lastMap(page, `m.__userZoom(${target} - m.level)`);
      await sleep(1500);
      levels.push({ zoom: await lastMap(page, 'return m.level'), legend: await page.locator('.map-legend').innerText(),
        polygons: await page.evaluate(() => window.__kakaoStats.polygons.filter((p) => p.map).length),
        pins: await page.evaluate(() => window.__kakaoLiveMarkers().length) });
      if (target === 8) await shot(page, 'R7-fine-sgg-1440');
    }
    res.levels = levels;
    // hover card and a region click → filter + card, same map instance, no request loop
    await lastMap(page, 'm.__userZoom(11 - m.level)');
    await sleep(1500);
    const polyIdx = await page.evaluate(() => window.__kakaoStats.polygons.findIndex((p) => p.map && p.opts.fillOpacity > 0.4));
    await page.evaluate((i) => window.__kakaoStats.polygons[i].__hover(), polyIdx);
    await sleep(300);
    res.hover = await page.locator('.map-hover').innerText().catch(() => null);
    await shot(page, 'R7-hover-1440');
    const n0 = (await log()).length;
    await page.evaluate((i) => window.__kakaoStats.polygons[i].__click(), polyIdx);
    await sleep(2500);
    const l = (await log()).slice(n0);
    res.click = { url: new URL(page.url()).search, requests: summarizeLog(l), card: await page.locator('.region-summary').innerText().catch(() => null),
      pins: await page.evaluate(() => window.__kakaoLiveMarkers().length) };
    await sleep(2500);
    res.click.requestsAfterSettle = summarizeLog((await log()).slice(n0));
    await shot(page, 'R7-region-card-1440');
    // 20 quick operations (pan/zoom/metric) — no pins ever in rate mode, no remount, bounded requests
    const n1 = (await log()).length;
    let maxPins = 0;
    for (let i = 0; i < 20; i++) {
      if (i % 5 === 4) await page.locator('.metric-switch').getByRole('button', { name: i % 10 === 4 ? '불수용률' : '수용률', exact: true }).click();
      else if (i % 2) await lastMap(page, `m.__userPan(${(i % 3) * 40 - 40}, 30)`);
      else await lastMap(page, `m.__userZoom(${i % 4 ? 1 : -1})`);
      await sleep(120);
      maxPins = Math.max(maxPins, await page.evaluate(() => window.__kakaoLiveMarkers().length));
    }
    await sleep(2500);
    res.twenty = { maxPins, requests: summarizeLog((await log()).slice(n1)), maps: await page.evaluate(() => window.__kakaoStats.maps), maps0 };
    // back to 신고 수: the saved boundary preference (off) applies again and pins return
    await page.locator('.metric-switch').getByRole('button', { name: '신고 수', exact: true }).click();
    await sleep(1500);
    res.backToReports = { pins: await page.evaluate(() => window.__kakaoLiveMarkers().length), boundaryPref: await bToggle.isChecked(),
      polygons: await page.evaluate(() => window.__kakaoStats.polygons.filter((p) => p.map).length) };
    await context.close();
    return res;
  });

  // ── widths × themes ────────────────────────────────────────────────────────────────────────────
  await step('widths', async () => {
    const res = {};
    for (const theme of ['dark', 'light']) for (const width of [1920, 1440, 1280, 768, 390]) {
      const { page, consoleErrors, context } = await fresh({ width, height: width < 800 ? 844 : 1000, theme });
      await pickPlace(page);
      const hOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      const rowOverflow = await page.evaluate(() => [...document.querySelectorAll('.pe-row, .pe-box')].filter((r) => r.scrollWidth > r.clientWidth + 1).length);
      await page.locator('.place-panel').screenshot({ path: join(dir, `W-place-${width}-${theme}.png`) });
      await page.locator('.place-entity-chart').screenshot({ path: join(dir, `W-chart-${width}-${theme}.png`) });
      await page.locator('.metric-switch').getByRole('button', { name: '수용률', exact: true }).click();
      await sleep(1200);
      await page.locator('.map-card').screenshot({ path: join(dir, `W-ratemap-${width}-${theme}.png`) });
      const rating = page.locator('article[aria-label="처리결과별 별점 분포"]');
      await rating.scrollIntoViewIfNeeded();
      await sleep(400);
      await rating.screenshot({ path: join(dir, `W-rating-${width}-${theme}.png`) });
      res[`${width}-${theme}`] = { hOverflow, rowOverflow, pinsRate: await page.evaluate(() => window.__kakaoLiveMarkers().length), consoleErrors };
      await context.close();
    }
    return res;
  });
} finally {
  writeFileSync(join(dir, 'followup.json'), JSON.stringify(out, null, 2));
  await browser.close();
}
