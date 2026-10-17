// Browser check of the ad slots read from src/ads/banners.html (2026-10-17): the sticky AliExpress rail right of the
// dashboard, the centred Coupang map banner, and the gate order (news capture → Coupang → MBC capture → login card).
// LOCAL stack + MOCK Kakao SDK. The Coupang widget is STUBBED (route → a plain page): the real widget render is NOT verified.
// The AliExpress banner is the real srcdoc from banners.html; its product images come from the AliExpress CDN as-is.
//   E2E server:  E2E_PORT=5190 npx vite --config scripts/browser/vite.e2e.config.ts
//   run:         LANG=C.UTF-8 node scripts/browser/verify_ad_banners.mjs <dir>
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, openPage, waitMap, api, sleep } from './harness.mjs';
import { createRun, captureConsole, waitFor } from './assert.mjs';

const dir = process.argv[2] || 'evidence';
mkdirSync(join(dir, 'shots'), { recursive: true });
const browser = await chromium.launch({ args: ['--lang=ko-KR'] });
const run = createRun({ dir, suite: 'ad-banners', ids: ['AD-RAIL', 'AD-MAP', 'AD-GATE', 'AD-LAYOUT'], meta: {
  browser: `chromium ${browser.version()}`, coupang: 'STUB (ads-partners.coupang.com routed to a local page)', aliexpress: 'real srcdoc, CDN images unrouted', sdk: 'MOCK' } });
const { check, step } = run;
const SCOPE = '?date_basis=completed_date&start=2025-09-25&end=2026-09-24&category=all';

async function open(ctx, opts) {
  await api('reset');
  const s = await openPage(browser, { height: 1000, search: SCOPE, ...opts, beforeGoto: (context) => context.route('https://ads-partners.coupang.com/**', (route) => {
    const u = new URL(route.request().url());
    route.fulfill({ contentType: 'text/html', body: `<body style="margin:0;background:#ffe9d6;font:14px sans-serif;display:grid;place-items:center;height:100vh">STUB coupang ${u.searchParams.get('id')}</body>` });
  }) });
  captureConsole(s.page, ctx);
  return s;
}
const box = (page, sel) => page.evaluate((q) => {
  const e = document.querySelector(q);
  if (!e) return null;
  const b = e.getBoundingClientRect();
  return { l: Math.round(b.left), t: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom), w: Math.round(b.width), h: Math.round(b.height), visible: b.width > 0 && b.height > 0 };
}, sel);
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

try {
  await step('rail', ['AD-RAIL', 'AD-MAP', 'AD-LAYOUT'], async (ctx) => {
    for (const [width, theme] of [[1920, 'light'], [1440, 'dark'], [1366, 'light'], [390, 'dark']]) {
      const { page, context } = await open(ctx, { width, theme });
      await waitMap(page);
      await sleep(800);
      const rail = await box(page, '.ad-rail .ad-side iframe');
      const column = await box(page, '.dashboard-body');
      const map = await box(page, '.area-map .cm-panel');
      const mapAd = await box(page, '.ad-map');
      ctx.note(`rail-${width}`, { rail, column, map, mapAd });
      if (width >= 1440) {
        const attrs = await page.evaluate(() => { const f = document.querySelector('.ad-side iframe'); return { sandbox: f.getAttribute('sandbox'), src: f.getAttribute('src'), title: f.title }; });
        check('AD-RAIL', `${width}: rail 320px wide, right of the dashboard column, top aligned with it`, [rail.w, rail.l > column.r, Math.abs(rail.t - column.t) <= 1], [320, true, true]);
        check('AD-RAIL', `${width}: srcdoc banner sandboxed without allow-same-origin`, attrs, { sandbox: 'allow-scripts allow-popups allow-popups-to-escape-sandbox', src: null, title: '알리익스프레스 광고 배너 만들기' });
        const frame = await waitFor(() => page.frames().find((f) => f.url() === 'about:srcdoc') ?? null, Boolean, { timeout: 8000 });
        const inner = await waitFor(() => frame.evaluate(() => ({ items: document.querySelectorAll('.wlpb-v1-item:not([hidden])').length, ad: document.querySelector('.wlpb-v1-ad')?.textContent,
          storage: (() => { try { return typeof localStorage.length; } catch (e) { return e.name; } })() })).catch(() => null), (v) => v && v.items > 0, { timeout: 8000 });
        check('AD-RAIL', `${width}: banner renders 4 products + its '광고' footer; cannot read this site's storage`, inner, { items: 4, ad: '광고', storage: 'SecurityError' });
        const fit = await waitFor(async () => [(await box(page, '.ad-side iframe')).h, await frame.evaluate(() => Math.ceil(document.querySelector('[data-wlpb-root]').getBoundingClientRect().height))],
          ([h, c]) => h === c, { timeout: 5000 });
        check('AD-RAIL', `${width}: iframe takes the banner's reported content height (no empty area under it)`, fit[0], fit[1]);
        await page.mouse.wheel(0, 2400);
        await sleep(700);
        const after = await box(page, '.ad-rail .ad-side iframe');
        const topbar = await box(page, '.topbar');
        check('AD-RAIL', `${width}: stays in view after scrolling 2400px (sticky under the top bar), fits the viewport`, [after.t >= topbar.b && after.t <= topbar.b + 24, after.b <= 1000], [true, true]);
        await page.screenshot({ path: join(dir, 'shots', `rail-${width}-${theme}-scrolled.png`) });
        await page.mouse.wheel(0, -2400);
        await sleep(500);
        const centred = Math.abs((mapAd.l + mapAd.w / 2) - (column.l + column.w / 2)) <= 1;
        check('AD-MAP', `${width}: Coupang map banner above the map, centred in the dashboard column, never wider`, [mapAd.b <= map.t, centred, mapAd.w <= column.w], [true, true, true]);
      } else {
        check('AD-RAIL', `${width}: no rail below 1440px; the column takes the full width`, [rail?.visible ?? false, column.w >= map.w], [false, true]);
      }
      check('AD-LAYOUT', `${width} ${theme}: no horizontal page overflow`, (await overflow(page)) <= 0, true);
      await page.screenshot({ path: join(dir, 'shots', `rail-${width}-${theme}.png`) });
      await context.close();
    }
  });
  await step('gate', ['AD-GATE', 'AD-LAYOUT'], async (ctx) => {
    for (const [width, theme] of [[1920, 'dark'], [390, 'light']]) {
      const { page, context } = await open(ctx, { width, theme, signedIn: false });
      await page.waitForSelector('.access-card .kakao-login', { timeout: 15000 });
      await page.evaluate(() => document.querySelectorAll('.access-gate img').forEach((i) => { i.loading = 'eager'; }));
      await waitFor(() => page.evaluate(() => [...document.querySelectorAll('.access-gate img')].every((i) => i.complete && i.naturalWidth > 0)), Boolean, { timeout: 8000 });
      const order = await page.evaluate(() => [...document.querySelector('.access-gate').children].map((e) => e.className || e.tagName));
      const fig = await page.evaluate(() => { const f = document.querySelectorAll('.gate-figure')[1]; return { caption: f.querySelector('b').textContent, source: f.querySelector('small').textContent, natural: f.querySelector('img').naturalWidth }; });
      const ad = await box(page, '.ad-gate');
      const second = await box(page, '.gate-figure-next');
      const card = await box(page, '.access-card');
      ctx.note(`gate-${width}`, { order, fig, ad, second, card });
      check('AD-GATE', `${width}: order news capture → Coupang → MBC capture → login card`, order, ['gate-figure', 'ad-slot ad-gate', 'gate-figure gate-figure-next', 'cm-panel access-card']);
      const coupang = await waitFor(() => page.frames().find((f) => f.url().startsWith('https://ads-partners.coupang.com/')) ?? null, Boolean, { timeout: 8000 });
      check('AD-GATE', `${width}: Coupang gate widget from banners.html (id 1034414) loads`, [new URL(coupang.url()).searchParams.get('id'), (await coupang.evaluate(() => document.body.innerText)).trim()], ['1034414', 'STUB coupang 1034414']);
      check('AD-GATE', `${width}: caption and source`, fig, { caption: '더 많은 신고가 필요한 이유', source: '출처: MBC 뉴스데스크 화면 갈무리', natural: 1280 });
      check('AD-GATE', `${width}: same width as the banner and the card, stacked without overlap`, [second.w === card.w, second.t > ad.b, card.t > second.b], [true, true, true]);
      check('AD-LAYOUT', `${width} gate: no horizontal page overflow`, (await overflow(page)) <= 0, true);
      await page.locator('.gate-figure-next').scrollIntoViewIfNeeded();
      await sleep(300);
      await page.screenshot({ path: join(dir, 'shots', `gate-${width}-${theme}.png`), fullPage: true });
      await context.close();
    }
  });
} finally {
  run.finish();
  await browser.close();
}
