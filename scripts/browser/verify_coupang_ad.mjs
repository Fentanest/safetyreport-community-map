// Browser check of the 쿠팡 파트너스 slots (2026-09-30): position, size/scale, disclosure, referrer policy, no overflow.
// LOCAL stack + MOCK Kakao SDK. The Coupang widget itself is STUBBED (route → a plain page of the widget's size), because
// the review sandbox cannot reach ads-partners.coupang.com: the real widget render is NOT verified here.
//   E2E server:  E2E_PORT=5190 npx vite --config scripts/browser/vite.e2e.config.ts
//   run:         LANG=C.UTF-8 node scripts/browser/verify_coupang_ad.mjs <dir>
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, openPage, waitMap, api, sleep } from './harness.mjs';
import { createRun, captureConsole, waitFor } from './assert.mjs';

const dir = process.argv[2] || 'evidence';
mkdirSync(join(dir, 'shots'), { recursive: true });
const browser = await chromium.launch({ args: ['--lang=ko-KR'] });
const run = createRun({ dir, suite: 'coupang-ad', ids: ['AD-GATE', 'AD-MAP', 'AD-DISCLOSURE', 'AD-LAYOUT'], meta: {
  browser: `chromium ${browser.version()}`, widget: 'STUB (ads-partners.coupang.com routed to a local page)', sdk: 'MOCK' } });
const { check, step } = run;
const SCOPE = '?date_basis=completed_date&start=2025-09-25&end=2026-09-24&category=all';
const DISCLOSURE = '이 페이지는 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.';

async function open(ctx, opts) {
  await api('reset');
  const s = await openPage(browser, { height: 1000, search: SCOPE, ...opts });
  captureConsole(s.page, ctx);
  await s.context.route('https://ads-partners.coupang.com/**', (route) => {
    const u = new URL(route.request().url());
    route.fulfill({ contentType: 'text/html', body: `<body style="margin:0;background:#ffe9d6;font:14px sans-serif;display:grid;place-items:center;height:100vh">STUB coupang ${u.searchParams.get('id')} ${u.searchParams.get('width')}&times;${u.searchParams.get('height')} referer=${route.request().headers().referer ?? '(none)'}</body>` });
  });
  await s.page.reload();
  return s;
}
const slot = (page, cls) => page.evaluate((c) => {
  const a = document.querySelector(`.ad-slot.${c}`);
  if (!a) return null;
  const f = a.querySelector('iframe');
  const r = (e) => { const b = e.getBoundingClientRect(); return { l: Math.round(b.left), t: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height), b: Math.round(b.bottom) }; };
  return { slot: r(a), frame: f ? r(f) : null, src: f?.src ?? null, referrerpolicy: f?.getAttribute('referrerpolicy') ?? null, sandbox: f?.getAttribute('sandbox'),
    disclosure: a.querySelector('.ad-disclosure')?.textContent ?? null, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
}, cls);

try {
  await step('gate', ['AD-GATE', 'AD-DISCLOSURE'], async (ctx) => {
    for (const width of [1920, 390]) {
      const { page, context } = await open(ctx, { width, signedIn: false });
      await page.waitForSelector('.access-card .kakao-login', { timeout: 15000 });
      await waitFor(() => slot(page, 'ad-gate'), (s) => s && s.frame, { timeout: 8000 });
      const s = await slot(page, 'ad-gate');
      const card = await page.evaluate(() => { const b = document.querySelector('.access-card').getBoundingClientRect(); return { l: Math.round(b.left), w: Math.round(b.width), b: Math.round(b.bottom) }; });
      ctx.note(`gate-${width}`, { s, card });
      check('AD-GATE', `${width}: below the login card, same left edge and width`, [s.slot.t > card.b, s.slot.l === card.l, s.slot.w === card.w], [true, true, true]);
      check('AD-GATE', `${width}: widget 640×200 at scale ${Math.min(1, card.w / 640).toFixed(2)}`, [s.frame.w, s.frame.h], width >= 700 ? [640, 200] : [card.w, Math.round(200 * card.w / 640)]);
      check('AD-GATE', `${width}: widget id 1034414, origin-only referrer, no page overflow`, [new URL(s.src).searchParams.get('id'), s.referrerpolicy, s.overflow <= 0], ['1034414', 'strict-origin', true]);
      check('AD-DISCLOSURE', `${width}: gate disclosure`, s.disclosure, DISCLOSURE);
      await page.screenshot({ path: join(dir, 'shots', `gate-${width}.png`) });
      await context.close();
    }
  });
  await step('map', ['AD-MAP', 'AD-DISCLOSURE', 'AD-LAYOUT'], async (ctx) => {
    for (const [width, theme] of [[1920, 'light'], [1440, 'dark'], [1280, 'light'], [768, 'dark'], [390, 'light']]) {
      const { page, context } = await open(ctx, { width, theme });
      await waitMap(page);
      await waitFor(() => slot(page, 'ad-map'), (s) => s && (s.frame || width < 700), { timeout: 8000 });
      await sleep(600);
      const s = await slot(page, 'ad-map');
      const map = await page.evaluate(() => { const b = document.querySelector('.area-map .cm-panel').getBoundingClientRect(); return { l: Math.round(b.left), w: Math.round(b.width), b: Math.round(b.bottom) }; });
      ctx.note(`map-${width}`, { s, map });
      const scale = Math.min(1, map.w / 1030);
      if (scale >= 0.6) {
        const centred = Math.abs((s.slot.l + s.slot.w / 2) - (map.l + map.w / 2)) <= 1;
        check('AD-MAP', `${width}: under the map card, centred in its column, never wider`, [s.slot.t >= map.b, centred, s.frame.w <= map.w], [true, true, true]);
        check('AD-MAP', `${width}: 1030×250 scaled ${scale.toFixed(2)}`, [s.frame.w, s.frame.h], [Math.round(1030 * scale), Math.round(250 * scale)]);
        check('AD-DISCLOSURE', `${width}: map disclosure`, s.disclosure, DISCLOSURE);
      } else {
        check('AD-MAP', `${width}: column ${map.w}px < 60% of the widget → hidden (no frame, no disclosure)`, [s.frame, s.disclosure], [null, null]);
      }
      check('AD-LAYOUT', `${width} ${theme}: no horizontal page overflow`, s.overflow <= 0, true);
      if (scale >= 0.6) {
        await page.locator('.ad-map').scrollIntoViewIfNeeded();
        const body = await waitFor(async () => (await page.frame({ url: /ads-partners\.coupang\.com/ })?.evaluate(() => document.body.innerText).catch(() => '')) ?? '', (t) => t.includes('STUB'), { timeout: 8000 });
        check('AD-MAP', `${width}: lazy widget loads when scrolled to; referer is the origin only (no query)`, body.trim(), `STUB coupang 1034404 1030×250 referer=http://127.0.0.1:5190/`);
      }
      await sleep(400);
      await page.screenshot({ path: join(dir, 'shots', `map-${width}-${theme}.png`) });
      await context.close();
    }
  });
} finally {
  run.finish();
  await browser.close();
}
