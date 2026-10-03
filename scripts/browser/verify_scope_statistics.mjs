// Assertion-based acceptance run for scope-statistics .2 + closeout C01–C06 on the LOCAL stack:
// real frontend + real Edge handler code over SYNTHETIC facts + MOCK Kakao SDK (window.kakao is a test double).
// This is NOT a real-SDK, real-Supabase or production check.
//   node scripts/browser/verify_scope_statistics.mjs <dir>          → <dir>/runs/<run_id>.json, <dir>/latest.json
//   ONLY=MT,LD …                                                    → other steps are NOT_RUN in this run's file
//   SELFTEST_WRONG='MT-01:default rate series'                     → flips one expectation; the run must exit 1
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, openPage, waitMap, api, sleep, summarizeLog, fakeSession, E2E_UID, E2E_UID_B } from './harness.mjs';
import { createRun, captureConsole, waitFor } from './assert.mjs';

const dir = process.argv[2] || 'evidence';
mkdirSync(join(dir, 'shots'), { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args: ['--lang=ko-KR'] });
const IDS = [
  'MT-01', 'MT-02', 'MT-03', 'MT-04', 'MT-05', 'MT-06', 'MT-16', 'MT-18', 'MT-19', 'MT-20', 'MT-21',
  'LD-02', 'LD-04', 'LD-05', 'LD-06', 'LD-19', 'LD-26', 'LD-12', 'LD-13',
  'PI-01', 'PI-02', 'PI-03', 'PI-04', 'PI-05', 'PI-06', 'PI-07', 'PI-10', 'PI-13',
  'SC-01', 'SC-02', 'SC-03', 'SC-04', 'SC-05', 'SC-09',
  'PG-01', 'PG-02', 'PG-03', 'PG-04', 'PG-06',
  'NV-01', 'NV-02', 'NV-07', 'NV-08', 'NV-09', 'NV-SPY', 'NV-10', 'ZOOM-EMU',
  'MS-01', 'MS-02', 'MS-06', 'MS-10', 'MS-11',
  'CH-01', 'CH-03', 'CH-04', 'CH-CMP',
  'C01-AB', 'C01-NICK', 'C01-RESTORE', 'W-OVERFLOW',
];
const run = createRun({ dir, suite: 'scope-statistics', ids: IDS, meta: {
  browser: `chromium ${browser.version()}`, sdk: 'MOCK (scripts/browser/mock-kakao-sdk.js)', data: 'synthetic (demoFacts + e2e extras)',
  server: 'local Vite middleware running server/publicHandler.ts + server/personalHandler.ts', default_viewport: '1440x1000', theme: 'dark unless noted',
  zoom: 'browser zoom 100% (headless); ZOOM-EMU uses viewport/DSF emulation, not browser zoom' } });
const shot = (page, name) => page.screenshot({ path: join(dir, 'shots', `${name}.png`) });
const log = async () => api('log');
const lastMap = (page, fn) => page.evaluate((f) => new Function('m', f)(window.__kakaoMaps[window.__kakaoMaps.length - 1]), fn);
const status = (page) => page.locator('.query-status-text').innerText().catch(() => '');
const series = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(s)].flatMap((h) => (h.__chart && !h.__chart.isDisposed() ? ((h.__chart.getOption() || {}).series || []).map((x) => x.id) : [])), sel);
const instanceId = (page, sel) => page.evaluate((s) => document.querySelector(s)?.getAttribute('_echarts_instance_') ?? null, sel);
const selectedPins = (page) => page.evaluate(() => window.__kakaoLiveMarkers().filter((m) => m.title.includes('(선택됨)')).length);
const pinCount = (page) => page.evaluate(() => window.__kakaoLiveMarkers().filter((m) => !m.title.includes('묶음')).length);
const clickPin = (page, i) => page.evaluate((k) => { const ms = window.__kakaoLiveMarkers().filter((m) => !m.title.includes('묶음')).sort((a, b) => a.title.localeCompare(b.title)); ms[k].marker.__click(); return ms[k].title; }, i);
const zoomToPins = async (page) => { await lastMap(page, 'm.setCenter(new kakao.maps.LatLng(37.55, 126.99)); m.setLevel(5)'); await waitFor(() => pinCount(page), (n) => n >= 3); };
const maps = (page) => page.evaluate(() => window.__kakaoStats.maps);
/** the viewer's own report count for the page's current scope, asked directly with that viewer's token (oracle) */
const mineOracle = (page, uid) => page.evaluate(async ({ token }) => {
  const p = new URLSearchParams(location.search);
  const q = new URLSearchParams({ start: p.get('start'), end: p.get('end'), category: p.get('category') || 'all' });
  const r = await fetch(`/functions/v1/my-analytics/compare?${q}`, { headers: { Authorization: `Bearer ${token}` } });
  return (await r.json()).mine.report_count;
}, { token: fakeSession(uid).access_token });

async function fresh(ctx, opts = {}) {
  await api('reset');
  const s = await openPage(browser, { locale: 'ko-KR', height: 1000, ...opts });
  captureConsole(s.page, ctx);
  await waitMap(s.page);
  await s.page.waitForSelector('.kpi-strip .kpi-row', { timeout: 20000 });
  await sleep(800);
  return s;
}

try {
  // ── S09 monthly rates ────────────────────────────────────────────────────────────────────────
  await run.step('MT', ['MT-01', 'MT-02', 'MT-03', 'MT-04', 'MT-05', 'MT-06', 'MT-16', 'MT-18', 'MT-19', 'MT-20'], async (ctx) => {
    const { check } = ctx;
    const { page, context } = await fresh(ctx);
    const card = page.locator('.trend-card');
    const host = '.trend-card .chart-host';
    await card.scrollIntoViewIfNeeded();
    await card.getByRole('button', { name: '처리결과 비율' }).click();
    check('MT-01', 'default rate series', await waitFor(() => series(page, host), (x) => x.length === 1), ['rate:accept:all']);
    const inst0 = await instanceId(page, host);
    const n0 = (await log()).length;
    await card.locator('.rate-check', { hasText: '불수용률' }).click();
    check('MT-01', 'two rates on one axis', await waitFor(() => series(page, host), (x) => x.length === 2), ['rate:accept:all', 'rate:reject:all']);
    await card.getByRole('button', { name: '전체 선택' }).click();
    check('MT-02', 'four overlaid series', await waitFor(() => series(page, host), (x) => x.length === 4), ['rate:accept:all', 'rate:reject:all', 'rate:partial:all', 'rate:fine:all']);
    await card.screenshot({ path: join(dir, 'shots', 'MT-four.png') });
    for (let i = 0; i < 20; i++) await card.locator('.rate-check').nth(i % 4).click();
    check('MT-18', 'no request during 20 toggles', summarizeLog((await log()).slice(n0)), {});
    check('MT-18', 'same chart instance', await instanceId(page, host), inst0);
    check('MT-05', 'all unchecked → note, no series', { note: await card.locator('.empty-state').innerText(), series: await series(page, host) },
      { note: '비교할 지표를 선택해 주세요.', series: [] });
    check('MT-05', 'checkboxes stay usable', await card.locator('.rate-check input:not([disabled])').count(), 4);
    await card.getByRole('button', { name: '전체 선택' }).click();
    await card.locator('.rate-check', { hasText: '과태료 부과율' }).click();
    check('MT-04', 'unchecking fine removes only its lines', await waitFor(() => series(page, host), (x) => x.length === 3), ['rate:accept:all', 'rate:reject:all', 'rate:partial:all']);
    await card.locator('.rate-check', { hasText: '과태료 부과율' }).click();
    // compare ON with a slow personal answer: public lines stay, the pending state is named, nothing copied
    await api('delay', { 'my-analytics': 2500 });
    await page.locator('.compare-toggle input').check();
    const pending = await waitFor(async () => ({ note: await card.locator('.cm-chip.is-pending').innerText().catch(() => ''), top: await status(page) }), (x) => !!x.note && x.top.includes('내 신고'), { timeout: 2000 });
    check('MT-19', 'mine pending is named', pending.note, '내 신고를 불러오는 중');
    check('MT-19', 'top status names the personal request', pending.top.includes('내 신고'), true);
    check('MT-19', 'public lines stay while mine loads', (await series(page, host)).length, 4);
    const eight = await waitFor(() => series(page, host), (x) => x.length === 8, { timeout: 8000 });
    check('MT-03', 'compare → exactly 8 ids', eight, ['rate:accept:all', 'rate:accept:mine', 'rate:reject:all', 'rate:reject:mine', 'rate:partial:all', 'rate:partial:mine', 'rate:fine:all', 'rate:fine:mine']);
    await api('delay', {});
    await card.screenshot({ path: join(dir, 'shots', 'MT-eight.png') });
    const box = await page.locator(host).boundingBox();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2);
    const tip = await waitFor(() => page.evaluate(() => [...document.querySelectorAll('.trend-card .chart-host div')].map((d) => d.innerText).find((t) => t && t.includes('내 신고')) ?? ''), (t) => !!t);
    check('MT-16', 'tooltip lists 8 values with num/den or a reason', tip.split('\n').filter((l) => / · (전체|내 신고) /.test(l) && (/\(\d+\/\d+건\)/.test(l) || /계산 불가|자료 없음|제공 안 됨/.test(l))).length, 8);
    await card.getByRole('button', { name: '표로 보기' }).click();
    const head = (await card.locator('thead').innerText()).replace(/\s+/g, ' ');
    check('MT-20', 'table has all/mine per checked rate', ['수용률 전체', '수용률 내 신고', '불수용률 전체', '불수용률 내 신고', '일부수용률 전체', '일부수용률 내 신고', '과태료 부과율 전체', '과태료 부과율 내 신고'].every((h) => head.includes(h)), true);
    await card.getByRole('button', { name: '그래프로 보기' }).click();
    await card.getByRole('button', { name: '건수', exact: true }).click();
    await card.getByRole('button', { name: '처리결과 비율' }).click();
    check('MT-06', 'selection kept across count↔rate and table↔chart', await card.locator('.rate-check.checked').count(), 4);
    await page.locator('.compare-toggle input').uncheck();
    check('MT-06', 'compare OFF removes every mine series', await waitFor(() => series(page, host), (x) => x.length === 4), ['rate:accept:all', 'rate:reject:all', 'rate:partial:all', 'rate:fine:all']);
    await context.close();
  });

  // ── S10 loading ──────────────────────────────────────────────────────────────────────────────
  await run.step('LD', ['LD-02', 'LD-04', 'LD-05', 'LD-06', 'LD-19', 'LD-26'], async (ctx) => {
    const { check } = ctx;
    const { page, context } = await fresh(ctx);
    const maps0 = await maps(page);
    await api('delay', { dashboard: 2500 });
    const n0 = (await log()).length;
    await page.getByRole('button', { name: '주정차', exact: true }).click();
    const during = await waitFor(() => status(page), (t) => t.includes('새 조건으로 통계를 불러오는 중'), { timeout: 1500 });
    check('LD-02', 'top status while refreshing', during.includes('화면은 이전 조건'), true);
    check('LD-02', 'panel busy and previous numbers kept', { busy: await page.locator('.scope-panel').getAttribute('aria-busy'), kpi: await page.locator('.kpi-strip .kpi-row').count() }, { busy: 'true', kpi: 1 });
    await shot(page, 'LD-refresh-in-flight');
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    check('LD-26', 'status visible at the bottom', await page.locator('.query-status.on').evaluate((e) => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }), true);
    await waitFor(() => status(page), (t) => t === '', { timeout: 6000 });
    check('LD-02', 'one request, map instance kept, status cleared', { req: summarizeLog((await log()).slice(n0)), maps: await maps(page), top: await status(page) }, { req: { dashboard: 1 }, maps: maps0, top: '' });
    await page.evaluate(() => window.scrollTo(0, 0));
    await api('delay', {});
    await zoomToPins(page);
    await api('delay', { 'places/:key': 1800 });
    await clickPin(page, 0);
    await sleep(250);
    const t2 = await clickPin(page, 1);
    check('LD-05', 'place status while P2 loads', await waitFor(() => status(page), (t) => t.includes('주소 상세'), { timeout: 1500 }), (t) => t.includes('주소 상세를 불러오는 중'));
    await waitFor(() => page.locator('.place-panel .panel-status').count(), (n) => n === 0, { timeout: 5000 });
    check('LD-05', 'P2 shown, late P1 dropped, status cleared', { title: await page.locator('.place-panel .place-head h2').innerText(), top: await status(page) }, { title: t2.split(' · ')[0], top: '' });
    await api('delay', { 'places/:key': 2000 });
    await clickPin(page, 2);
    await sleep(300);
    await page.getByRole('button', { name: /주소 선택 해제/ }).click();
    check('LD-06', 'cleared selection removes only its status', await waitFor(() => status(page), (t) => t === '', { timeout: 1500 }), '');
    await api('delay', {});
    const n1 = (await log()).length;
    for (let i = 0; i < 5; i++) { await lastMap(page, `m.__userPan(${40 - i * 20}, 20)`); await sleep(120); }
    await sleep(1500);
    check('LD-04', 'auto OFF pans: no statistics request, no status', { req: summarizeLog((await log()).slice(n1).filter((e) => e.route === 'dashboard')), top: await status(page) }, { req: {}, top: '' });
    await api('inject', { route: 'dashboard', status: 429, times: 1, retryAfter: 4 });
    await page.getByRole('button', { name: '교통위반', exact: true }).click();
    const wait = await waitFor(() => status(page), (t) => t.includes('기다리는 중'), { timeout: 3000 });
    check('LD-19', 'retry wait with a countdown', /\d초 후 다시 시도/.test(wait), true);
    await shot(page, 'LD-429');
    const n2 = (await log()).length;
    await waitFor(() => status(page), (t) => t === '', { timeout: 9000 });
    check('LD-19', 'exactly one request after Retry-After', summarizeLog((await log()).slice(n2)), { dashboard: 1 });
    await context.close();
  }, { expectedConsole: [/status of 429/] });

  // ── S02 pins ─────────────────────────────────────────────────────────────────────────────────
  await run.step('PI', ['PI-01', 'PI-02', 'PI-03', 'PI-04', 'PI-05', 'PI-06', 'PI-07', 'PI-10', 'PI-13'], async (ctx) => {
    const { check } = ctx;
    const { page, context } = await fresh(ctx);
    await zoomToPins(page);
    await clickPin(page, 0);
    const sel = await waitFor(() => page.evaluate(() => window.__kakaoLiveMarkers().filter((m) => m.title.includes('(선택됨)')).map((m) => m.marker.opts.zIndex)), (x) => x.length === 1);
    check('PI-01', 'one selected marker on top', sel, [10]);
    check('PI-01', 'place panel opened', await page.locator('.place-panel .place-head .overline').innerText(), '선택한 주소');
    await clickPin(page, 0);
    check('PI-02', 're-click clears', await waitFor(() => selectedPins(page), (n) => n === 0), 0);
    check('PI-02', 'scope panel back', await waitFor(() => page.locator('.scope-panel .place-head h2').innerText().catch(() => ''), (t) => !!t), '전국');
    await clickPin(page, 0); await sleep(200); await clickPin(page, 1);
    check('PI-03', 'P1→P2 one selection', await waitFor(() => selectedPins(page), (n) => n === 1), 1);
    await clickPin(page, 2); await lastMap(page, 'm.__blankClick()');
    check('PI-05', 'blank click right after a marker click is ignored', await selectedPins(page), 1);
    await sleep(600); await lastMap(page, 'm.__blankClick()');
    check('PI-04', 'blank map click clears', await waitFor(() => selectedPins(page), (n) => n === 0), 0);
    await clickPin(page, 0); await waitFor(() => selectedPins(page), (n) => n === 1);
    await page.getByRole('button', { name: /상세 필터/ }).click();
    await page.waitForSelector('section.drawer');
    await page.keyboard.press('Escape');
    check('PI-07', 'Esc closes only the drawer', { drawer: await waitFor(() => page.locator('section.drawer').count(), (n) => n === 0), selected: await selectedPins(page) }, { drawer: 0, selected: 1 });
    await page.keyboard.press('Escape');
    check('PI-04', 'Esc clears the selection', await waitFor(() => selectedPins(page), (n) => n === 0), 0);
    await clickPin(page, 1); await waitFor(() => selectedPins(page), (n) => n === 1);
    await page.getByRole('button', { name: /주소 선택 해제/ }).click();
    check('PI-04', 'panel button clears', await waitFor(() => selectedPins(page), (n) => n === 0), 0);
    await clickPin(page, 1); await waitFor(() => selectedPins(page), (n) => n === 1);
    await lastMap(page, 'm.__userPan(60, 0)'); await lastMap(page, 'm.__blankClick()');
    check('PI-06', 'a drag end is not a blank click', await selectedPins(page), 1);
    await page.locator('.metric-switch').getByRole('button', { name: '수용률', exact: true }).click();
    check('PI-10', 'rate map: no pin, no halo', await waitFor(async () => ({ pins: await pinCount(page), selected: await selectedPins(page) }), (x) => x.pins === 0), { pins: 0, selected: 0 });
    await page.locator('.metric-switch').getByRole('button', { name: '신고 수', exact: true }).click();
    await waitFor(() => pinCount(page), (n) => n > 0);
    const before = await page.evaluate(() => window.__kakaoLiveMarkers().length);
    for (let i = 0; i < 30; i++) {
      if (i % 10 === 9) { await page.locator('.metric-switch').getByRole('button', { name: i % 20 === 9 ? '과태료' : '신고 수', exact: true }).click(); continue; }
      if (await pinCount(page) > 2) await clickPin(page, i % 3);
    }
    await page.locator('.metric-switch').getByRole('button', { name: '신고 수', exact: true }).click();
    const after = await waitFor(() => page.evaluate(() => window.__kakaoLiveMarkers().length), (n) => n === before);
    check('PI-13', 'no marker accumulation after 30 operations', { live: after, maps: await maps(page) }, { live: before, maps: 2 });
    await context.close();
  });

  // ── S01 scope detail + S04 hand-off ─────────────────────────────────────────────────────────
  await run.step('SC_PG', ['SC-01', 'SC-02', 'SC-03', 'SC-04', 'SC-05', 'SC-09', 'PG-01', 'PG-02', 'PG-03', 'PG-04', 'PG-06'], async (ctx) => {
    const { check } = ctx;
    const { page, context } = await fresh(ctx);
    const panel = page.locator('.scope-panel');
    const h2 = () => panel.locator('.place-head h2').innerText();
    check('SC-01', 'nation detail', { h2: await h2(), children: await panel.locator('.scope-child').count() > 0 }, { h2: '전국', children: true });
    check('SC-09', 'shown/total count', await panel.locator('.place-more .cm-muted').first().innerText(), (t) => /^표시 \d+ \/ 전체 \d+$/.test(t));
    await panel.locator('.scope-child', { hasText: '서울특별시' }).click();
    check('SC-02', 'seoul via child list', await waitFor(async () => ({ url: new URL(page.url()).searchParams.get('region_code'), h2: await h2() }), (x) => x.h2 === '서울특별시'), { url: '11', h2: '서울특별시' });
    await panel.locator('.scope-child').first().click();
    const sgg = await waitFor(async () => ({ code: new URL(page.url()).searchParams.get('region_code'), trail: (await panel.locator('.scope-trail').innerText()).replace(/\s+/g, ' ') }), (x) => x.code?.length === 5);
    check('SC-03', '시군구 detail with a 3-level trail', sgg.trail.startsWith('전국 서울특별시'), true);
    await page.locator('.top-region select').first().selectOption('26');
    check('SC-04', 'top selector = same region action', await waitFor(async () => ({ url: new URL(page.url()).searchParams.get('region_code'), h2: await h2() }), (x) => x.url === '26' && x.h2 === '부산광역시'), { url: '26', h2: '부산광역시' });
    await page.locator('.top-region select').first().selectOption('');
    await waitFor(() => h2(), (t) => t === '전국');
    // SC-05: address panel breadcrumb → explicit region move and selection cleared
    await zoomToPins(page);
    const title = await clickPin(page, 0);
    await page.waitForSelector('.place-panel .scope-trail');
    const sido = (await page.locator('.place-panel .scope-trail button').nth(1).innerText()).trim();
    await page.locator('.place-panel .scope-trail button').nth(1).click();
    check('SC-05', 'address breadcrumb → region detail, pin cleared', await waitFor(async () => ({ h2: await h2().catch(() => ''), selected: await selectedPins(page) }), (x) => x.h2 === sido), { h2: sido, selected: 0 });
    ctx.note('breadcrumb_from', title);
    await page.locator('.scope-trail').getByRole('button', { name: '전국' }).click();
    await waitFor(() => h2(), (t) => t === '전국');
    await panel.locator('.scope-child', { hasText: '서울특별시' }).click();
    await waitFor(() => h2(), (t) => t === '서울특별시');
    const maps0 = await maps(page);
    await panel.getByRole('button', { name: '이 조건으로 통계 만들기' }).click();
    await page.waitForSelector('.pivot-table tbody tr');
    check('PG-01', 'separate 맞춤 통계 screen with focus', { url: new URL(page.url()).searchParams.get('screen'), h1: await page.locator('#stats-title').innerText(), focus: await page.evaluate(() => document.activeElement?.id) },
      { url: 'statistics', h1: '맞춤 통계', focus: 'stats-title' });
    check('PG-03', 'displayed region handed over', await page.locator('.stats-builder .stats-chips').first().innerText(), (t) => t.includes('서울특별시'));
    await page.reload();
    check('PG-02', 'direct entry / refresh restores the result', await waitFor(() => page.locator('.pivot-table tbody tr').count(), (n) => n > 0, { timeout: 15000 }), (n) => n > 0);
    await page.goBack();
    await waitFor(() => page.locator('main').getAttribute('data-screen'), (s) => s === 'dashboard');
    await page.locator('.rail button[aria-label="지도"]').click();
    await waitMap(page); // Direct statistics entry defers the SDK until the dashboard is opened.
    await waitFor(() => maps(page), (n) => n > 0);
    check('PG-06', 'map instance kept across the page switch', await maps(page), maps0);
    await zoomToPins(page);
    await clickPin(page, 0);
    await page.waitForSelector('.place-panel .primary-mini');
    await page.locator('.place-panel').getByRole('button', { name: '이 조건으로 통계 만들기' }).click();
    check('PG-04', 'address condition chip', await waitFor(() => page.locator('.stats-builder .stats-chips').first().innerText(), (t) => t.includes('주소')), (t) => t.includes('주소'));
    await context.close();
  });

  // ── S03 navigation, scroll spy, back/forward restore, zoom emulation ────────────────────────
  await run.step('NV', ['NV-01', 'NV-02', 'NV-07', 'NV-08', 'NV-09', 'NV-SPY', 'NV-10', 'ZOOM-EMU'], async (ctx) => {
    const { check } = ctx;
    const offsets = async (page, id) => page.evaluate((sid) => ({ bar: Math.round(document.querySelector('.topbar').getBoundingClientRect().bottom), top: Math.round(document.getElementById(sid).getBoundingClientRect().top) }), id);
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      const { page, context } = await fresh(ctx, { width: w, height: h });
      for (const [label, id] of [['기관', 'entities'], ['추이', 'analytics'], ['지역', 'regions'], ['지도', 'mapsection']]) {
        await page.locator('.bottom-nav button:visible, .rail button:visible').filter({ hasText: label }).first().click();
        const o = await waitFor(() => offsets(page, id), (x) => Math.abs(x.top - (x.bar + 12)) <= 2, { timeout: 3000 });
        check(w < 800 ? 'NV-09' : 'NV-01', `${label} lands 12px under the sticky bar @${w}`, Math.abs(o.top - (o.bar + 12)) <= 2, true);
        if (label === '지역') check('NV-02', `지역 → region list @${w}`, id, 'regions');
      }
      if (w === 1440) {
        check('NV-07', 'focus on the section after menu move', await page.evaluate(() => !!document.activeElement?.closest('#mapsection')), true);
        // scroll spy: manual scrolling moves the current menu item
        await page.evaluate(() => { const y = document.getElementById('entities').getBoundingClientRect().top + scrollY - 76; window.scrollTo(0, y); });
        check('NV-SPY', 'manual scroll to 기관 → current item 기관', await waitFor(() => page.locator('.rail [aria-current="location"]').innerText().catch(() => ''), (t) => t === '기관'), '기관');
        await page.evaluate(() => { const y = document.getElementById('analytics').getBoundingClientRect().top + scrollY - 76; window.scrollTo(0, y); });
        check('NV-SPY', 'manual scroll to 추이 → current item 추이', await waitFor(() => page.locator('.rail [aria-current="location"]').innerText().catch(() => ''), (t) => t === '추이'), '추이');
        // back/forward: dashboard scroll position and filters come back after the statistics page
        await page.getByRole('button', { name: '주정차', exact: true }).click();
        await sleep(1200);
        const y0 = await page.evaluate(() => { window.scrollTo(0, 1400); return window.scrollY; });
        await sleep(400);
        await page.locator('.rail button[aria-label^="통계"]').click();
        await page.waitForSelector('#stats-title');
        check('NV-SPY', 'statistics screen: no dashboard section is current', await page.locator('.rail [aria-current="location"]').count(), 0);
        await page.goBack();
        const back = await waitFor(async () => ({ screen: await page.locator('main').getAttribute('data-screen'), y: await page.evaluate(() => Math.round(window.scrollY)) }), (x) => x.screen === 'dashboard' && Math.abs(x.y - y0) < 30);
        check('NV-10', 'back restores the dashboard scroll position', Math.abs(back.y - y0) < 30, true);
        check('NV-10', 'back keeps the filter', new URL(page.url()).searchParams.get('category'), 'parking');
        await page.goForward();
        check('NV-10', 'forward returns to statistics', await waitFor(() => page.locator('main').getAttribute('data-screen'), (s) => s === 'statistics'), 'statistics');
        await page.locator('.stats-builder .stats-list').nth(0).locator('select').selectOption('sido');
        await page.goBack();
        await page.goForward();
        check('NV-10', 'draft kept through back/forward', await page.locator('.stats-builder .stats-list').nth(0).locator('ol').innerText(), (t) => t.includes('시도'));
        await page.locator('.rail button[aria-label="기관"]').click();
        check('NV-08', 'statistics → 기관 restores the dashboard at #entities', await waitFor(async () => ({ s: await page.locator('main').getAttribute('data-screen'), o: await offsets(page, 'entities') }), (x) => x.s === 'dashboard' && Math.abs(x.o.top - (x.o.bar + 12)) <= 2), (x) => x.s === 'dashboard');
      }
      await context.close();
    }
    // ZOOM-EMU: 125/150/200% emulated as CSS viewport = 1440/zoom with DSF = zoom (browser zoom itself is not available headless)
    for (const z of [1.25, 1.5, 2]) {
      const { page, context } = await fresh(ctx, { width: Math.round(1440 / z), height: Math.round(1000 / z), deviceScaleFactor: z });
      await page.locator('.bottom-nav button:visible, .rail button:visible').filter({ hasText: '기관' }).first().click();
      const o = await waitFor(() => offsets(page, 'entities'), (x) => Math.abs(x.top - (x.bar + 12)) <= 2, { timeout: 3000 });
      check('ZOOM-EMU', `${z * 100}% emulation: title under the bar, no overflow`, { under: Math.abs(o.top - (o.bar + 12)) <= 2, overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1) }, { under: true, overflow: false });
      await shot(page, `ZOOM-EMU-${z * 100}`);
      await context.close();
    }
  });

  // ── S06 target selector (incl. MS-10) + S07 table/chart + C02 compare heatmap ───────────────
  await run.step('MS_CH', ['MS-01', 'MS-02', 'MS-06', 'MS-10', 'MS-11', 'CH-01', 'CH-03', 'CH-04', 'CH-CMP', 'LD-12', 'LD-13'], async (ctx) => {
    const { check } = ctx;
    const { page, context } = await fresh(ctx);
    await page.locator('.rail button[aria-label^="통계"]').click();
    await page.waitForSelector('.pivot-table tbody tr');
    await page.getByRole('button', { name: '비교 대상 선택' }).click();
    const dlg = page.getByRole('dialog', { name: '비교 대상 선택' });
    await dlg.locator('.picker-list li').first().waitFor();
    const n0 = (await log()).length;
    await dlg.locator('input[type=search]').pressSequentially('경찰', { delay: 60 });
    await waitFor(async () => (await log()).slice(n0).filter((e) => e.route === 'statistics/candidates').length, (n) => n >= 1);
    await sleep(500);
    check('MS-11', 'debounced: one candidates request for the typed word; focus kept', { req: (await log()).slice(n0).filter((e) => e.route === 'statistics/candidates').length, focus: await page.evaluate(() => document.activeElement?.getAttribute('aria-label')) }, { req: 1, focus: '기관 검색' });
    const boxes = dlg.locator('.picker-list input[type=checkbox]');
    for (let i = 0; i < 3; i++) await boxes.nth(i).check();
    await dlg.locator('input[type=search]').fill('');
    check('MS-02', 'selection survives a search change', await waitFor(() => dlg.locator('.picker-chosen li').count(), (n) => n === 3), 3);
    const picked = (await dlg.locator('.picker-chosen .picker-name').allInnerTexts());
    await dlg.getByRole('button', { name: '취소', exact: true }).click();
    check('MS-06', 'cancel keeps the query unchanged', await page.locator('.stats-builder .stats-chips').nth(1).innerText(), (t) => t.includes('고르지 않으면 전체'));
    await page.getByRole('button', { name: '비교 대상 선택' }).click();
    await dlg.locator('input[type=search]').pressSequentially('경찰', { delay: 30 });
    await sleep(700);
    for (let i = 0; i < 3; i++) await boxes.nth(i).check();
    await dlg.getByRole('button', { name: '적용', exact: true }).click();
    await api('delay', { 'statistics/query': 1500 });
    const q0 = (await log()).length;
    await page.getByRole('button', { name: '통계 만들기' }).click();
    check('LD-12', 'run status + previous result kept + button locked', { st: await waitFor(() => page.locator('.stats-result .panel-status').innerText().catch(() => ''), (t) => !!t, { timeout: 1500 }), btn: await page.locator('.stats-run .primary-button').innerText(), rows: await page.locator('.pivot-table tbody tr').count() > 0 },
      (x) => x.st.includes('만드는 중') && x.btn === '만드는 중…' && x.rows);
    await waitFor(() => page.locator('.stats-result .panel-status').count(), (n) => n === 0, { timeout: 6000 });
    await api('delay', {});
    const rowNames = await page.locator('.pivot-table tbody th').allInnerTexts();
    check('MS-01', 'only the three picked agencies', rowNames.map((t) => t.trim()).sort(), picked.map((t) => t.trim()).sort());
    check('MS-01', 'one query', summarizeLog((await log()).slice(q0)), { 'statistics/query': 1 });
    // MS-10 with an unknown key (as if saved by another account / a removed target): not 0건, not dropped to 전체
    await page.evaluate(() => {
      const raw = sessionStorage.getItem('cm-stats-state-v2');
      const s = JSON.parse(raw);
      s.draft.spec.filters = s.draft.spec.filters.map((f) => (f.dimension === 'agency' ? { ...f, members: [...f.members, 'a1:not-permitted-0000'] } : f));
      s.draft.labels['a1:not-permitted-0000'] = '예전에 저장한 기관';
      s.applied = s.draft;
      sessionStorage.setItem('cm-stats-state-v2', JSON.stringify(s));
    });
    await page.reload();
    await page.waitForSelector('.pivot-table tbody tr', { timeout: 15000 });
    const chip = await waitFor(() => page.locator('.stats-member.unavailable').innerText().catch(() => ''), (t) => !!t);
    check('MS-10', 'unknown key shown as 확인할 수 없음 with the saved label', chip, '예전에 저장한 기관 (확인할 수 없음)');
    check('MS-10', 'exclusion stated, not switched to 전체', { banner: await page.locator('.banner.warn', { hasText: '확인할 수 없어 결과에서 뺐습니다' }).count(), rows: (await page.locator('.pivot-table tbody th').count()) }, { banner: 1, rows: 3 });
    const c0 = (await log()).length;
    await page.locator('.stats-result').getByRole('button', { name: '그래프', exact: true }).click();
    check('CH-01', 'heatmap of the same result', await waitFor(() => series(page, '.stats-chart-host'), (x) => x.length === 1), ['heatmap:fine_rate:all']);
    check('LD-13', 'complete result → no fetch on the switch', summarizeLog((await log()).slice(c0)), {});
    const first = await page.locator('.stats-result').getByRole('button', { name: '표', exact: true }).click().then(() => page.locator('.pivot-table tbody tr').first().innerText());
    await page.locator('.stats-result').getByRole('button', { name: '그래프', exact: true }).click();
    await page.locator('.stats-result').getByRole('button', { name: '표', exact: true }).click();
    check('CH-03', 'table → chart → table keeps the numbers', await page.locator('.pivot-table tbody tr').first().innerText(), first);
    check('CH-04', 'no request for representation switches', summarizeLog((await log()).slice(c0)), {});
    // C02: compare → two heatmaps with the same axes
    await page.locator('.stats-builder').getByLabel('전체와 비교').check();
    await page.getByRole('button', { name: '통계 만들기' }).click();
    await waitFor(() => page.locator('.pivot-table thead').innerText(), (t) => t.includes('내 신고'), { timeout: 8000 });
    await page.locator('.stats-result').getByRole('button', { name: '그래프', exact: true }).click();
    check('CH-CMP', 'compare heatmap draws 전체 and 내 신고', (await waitFor(() => series(page, '.stats-chart-host'), (x) => x.length === 2)).sort(), ['heatmap:fine_rate:all', 'heatmap:fine_rate:mine']);
    check('CH-CMP', 'both captions present', await page.locator('.heatmap-side figcaption').allInnerTexts(), (x) => x.length === 2 && x[0].startsWith('전체') && x[1].startsWith('내 신고'));
    await shot(page, 'CH-compare-heatmaps');
    await context.close();
  });

  // ── MT-21 hand-off from the monthly card ────────────────────────────────────────────────────
  await run.step('MT21', ['MT-21'], async (ctx) => {
    const { check } = ctx;
    const { page, context } = await fresh(ctx);
    const card = page.locator('.trend-card');
    await card.scrollIntoViewIfNeeded();
    await card.getByRole('button', { name: '처리결과 비율' }).click();
    await card.getByRole('button', { name: '전체 선택' }).click();
    await card.getByRole('button', { name: '이 조건으로 통계 만들기' }).click();
    await page.waitForSelector('.pivot-table tbody tr');
    check('MT-21', 'rows = 답변 월, four rate metrics', await page.locator('.stats-result-head h2').innerText(), '답변 월 · 수용률, 불수용률, 일부수용률, 과태료 부과율');
    await page.locator('.stats-result').getByRole('button', { name: '그래프', exact: true }).click();
    check('MT-21', 'overlaid percent lines', await waitFor(() => series(page, '.stats-chart-host'), (x) => x.length === 4), ['accept_rate:all', 'reject_rate:all', 'partial_rate:all', 'fine_rate:all']);
    await context.close();
  });

  // ── C01 two accounts with the SAME nickname ─────────────────────────────────────────────────
  await run.step('C01', ['C01-AB', 'C01-NICK', 'C01-RESTORE'], async (ctx) => {
    const { check } = ctx;
    const { page, context } = await fresh(ctx, { uid: E2E_UID });
    await page.locator('.compare-toggle input').check();
    const mineA = await waitFor(() => page.locator('.kpi-mine').first().innerText().catch(() => ''), (t) => t.startsWith('내 신고'));
    // Current policy shows the viewer's own ID; a same nickname must still change the account boundary.
    // A drafts a 맞춤 통계 recipe
    await page.locator('.rail button[aria-label^="통계"]').click();
    await page.waitForSelector('.pivot-table tbody tr');
    await page.locator('.stats-builder .stats-list').nth(0).locator('select').selectOption('sido');
    await page.locator('.rail button[aria-label="지도"]').click();
    // A's personal request is slow; B signs in from another tab while it is on the wire
    await api('delay', { 'my-analytics': 3000 });
    await page.getByRole('button', { name: '주정차', exact: true }).click();
    await sleep(400);
    const other = await context.newPage();
    await other.goto(page.url().split('?')[0] + '?screen=none');
    await other.evaluate((b) => {
      localStorage.setItem('cm-map-auth-v1', JSON.stringify(b));
      new BroadcastChannel('cm-map-auth-v1').postMessage({ event: 'SIGNED_IN', session: b });
    }, fakeSession(E2E_UID_B));
    await other.close();
    // A's late answer lands after the switch: it must not show; B's own numbers appear
    await sleep(3500);
    await api('delay', {});
    const expectB = await mineOracle(page, E2E_UID_B);
    const expectA = await mineOracle(page, E2E_UID);
    const shown = await waitFor(() => page.locator('.kpi-mine').first().innerText().catch(() => ''), (t) => t === `내 신고 ${expectB.toLocaleString('ko-KR')}건`, { timeout: 10000 });
    check('C01-AB', "after the switch the numbers are B's own (A's late answer never shown)", { account: await page.locator('.account-name-text').innerText().catch(() => ''), shown, differentAccounts: expectA !== expectB },
      { account: `ID ${E2E_UID_B.replace(/-/g, '').slice(0, 8)}`, shown: `내 신고 ${expectB.toLocaleString('ko-KR')}건`, differentAccounts: true });
    ctx.note('mine_before_switch', mineA);
    check('C01-AB', "no loading left over from A's request", await waitFor(() => status(page), (t) => t === ''), '');
    await page.locator('.rail button[aria-label^="통계"]').click();
    await page.waitForSelector('#stats-title');
    check('C01-RESTORE', "B does not get A's 맞춤 통계 draft", await waitFor(() => page.locator('.stats-builder .stats-list').nth(0).locator('ol').innerText().catch(() => ''), (t) => !!t), (t) => !t.includes('시도'));
    await page.reload();
    await page.waitForSelector('#stats-title');
    check('C01-RESTORE', "after reload as B: still not A's draft", await waitFor(() => page.locator('.stats-builder .stats-list').nth(0).locator('ol').innerText().catch(() => ''), (t) => !!t), (t) => !t.includes('시도'));
    // same account, new nickname (token refresh): no reset, no refetch
    await page.locator('.rail button[aria-label="지도"]').click();
    await sleep(1500);
    const n0 = (await log()).length;
    const other2 = await context.newPage();
    await other2.goto(page.url().split('?')[0] + '?screen=none');
    await other2.evaluate((b) => {
      localStorage.setItem('cm-map-auth-v1', JSON.stringify(b));
      new BroadcastChannel('cm-map-auth-v1').postMessage({ event: 'TOKEN_REFRESHED', session: b });
    }, fakeSession(E2E_UID_B, '새닉네임'));
    await other2.close();
    await sleep(2000);
    check('C01-NICK', 'nickname change of the same account: no refetch', summarizeLog((await log()).slice(n0).filter((e) => e.route === 'dashboard' || e.route === 'my-analytics')), {});
    check('C01-NICK', 'same account keeps its ID after nickname refresh', await page.locator('.account-name-text').innerText().catch(() => ''), `ID ${E2E_UID_B.replace(/-/g, '').slice(0, 8)}`);
    check('C01-NICK', 'auth metadata nickname updates without an account reset', await page.evaluate(async () => (await import('/src/hooks/usePersonal.ts')).mapAuth().snapshot().displayName), '새닉네임');
    await context.close();
  }, { expectedConsole: [] });

  // ── widths × themes ─────────────────────────────────────────────────────────────────────────
  await run.step('W', ['W-OVERFLOW'], async (ctx) => {
    const { check } = ctx;
    for (const theme of ['dark', 'light']) for (const width of [1920, 1440, 1280, 768, 390]) {
      const { page, context } = await fresh(ctx, { width, height: width < 800 ? 844 : 1000, theme });
      check('W-OVERFLOW', `dashboard ${width} ${theme}`, await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      await page.locator('.bottom-nav button:visible, .rail button:visible').filter({ hasText: '통계' }).first().click();
      await page.waitForSelector('.pivot-table tbody tr');
      check('W-OVERFLOW', `statistics ${width} ${theme}`, await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      await shot(page, `W-stats-${width}-${theme}`);
      await context.close();
    }
  });
} finally {
  await browser.close();
  run.finish();
}
