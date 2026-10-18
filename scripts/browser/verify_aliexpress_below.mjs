// Browser check of the AliExpress line banner under the map (slot "below", 2026-10-18): below 1440px — where the side rail
// is not drawn — the photo-strip banner sits right under the map row and rotates; from 1440px the vertical side rail shows
// instead and the "below" iframe is not created at all (and vice versa, the hidden rail iframe is not created below 1440px).
// DEMO data (VITE_DATA_MODE=demo), product images from the AliExpress CDN as-is. Resizing across 1440px is checked too.
//   server: VITE_DATA_MODE=demo npx vite --host 127.0.0.1 --port 5231
//   run:    DEMO_ORIGIN=http://127.0.0.1:5231 node scripts/browser/verify_aliexpress_below.mjs <dir>
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from './harness.mjs';

const origin = process.env.DEMO_ORIGIN || 'http://127.0.0.1:5231';
const out = process.argv[2] || 'evidence';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const checks = [];
const check = (name, actual, expected) => checks.push({ name, actual, expected, pass: JSON.stringify(actual) === JSON.stringify(expected) });
const box = (page, sel) => page.evaluate((q) => {
  const e = document.querySelector(q);
  if (!e) return null;
  const b = e.getBoundingClientRect();
  return { l: Math.round(b.left), t: Math.round(b.top + scrollY), r: Math.round(b.right), b: Math.round(b.bottom + scrollY), w: Math.round(b.width), h: Math.round(b.height) };
}, sel);
const frames = (page) => page.evaluate(() => ({ below: document.querySelectorAll('.ad-below iframe').length, side: document.querySelectorAll('.ad-side iframe').length }));
const inner = async (page) => {
  const handle = await page.$('.ad-below iframe');
  const frame = await handle?.contentFrame();
  return frame?.evaluate(() => ({
    design: document.querySelector('[data-wlpb-root]')?.getAttribute('data-wlpb-design'),
    items: document.querySelectorAll('.wlpb-v1-item:not([hidden])').length,
    first: (document.querySelector('.wlpb-v1-item:not([hidden]) .wlpb-v1-name')?.textContent ?? '').slice(0, 30),
    content: Math.ceil(document.querySelector('[data-wlpb-root]').getBoundingClientRect().height),
  })).catch((e) => String(e));
};
try {
  for (const [width, theme] of [[1366, 'light'], [1024, 'dark'], [390, 'dark'], [1440, 'light'], [1920, 'dark']]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme });
    // runs in every frame: the sandboxed banner has no storage, so only the app frame sets the theme
    await context.addInitScript((t) => { try { localStorage.setItem('cm-theme', t); } catch { /* sandboxed banner */ } }, theme);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(origin);
    await page.locator('.kpi-strip[aria-busy="false"] .kpi-value').first().waitFor();
    await page.waitForTimeout(1500);
    const f = await frames(page);
    if (width < 1440) {
      check(`${width}: only the below banner iframe exists`, f, { below: 1, side: 0 });
      await page.locator('.ad-below').scrollIntoViewIfNeeded();
      await page.waitForTimeout(1500);
      const map = await box(page, '.dash-grid');
      const ad = await box(page, '.ad-below');
      const charts = await box(page, '.scope-strip');
      const col = await box(page, '.dashboard-body');
      check(`${width}: under the map row, above the analysis strip, centred, ≤ 1030px`,
        [ad.t >= map.b, ad.b <= charts.t, Math.abs((ad.l + ad.w / 2) - (col.l + col.w / 2)) <= 1, ad.w <= 1030], [true, true, true, true]);
      const a = await inner(page);
      const per = width >= 742 ? 3 : width >= 442 ? 2 : 1;
      check(`${width}: photo-strip renders products, iframe takes its content height`, [a?.design, a?.items > 0, Math.abs((await box(page, '.ad-below iframe')).h - a?.content) <= 1], ['photo-strip', true, true]);
      await page.screenshot({ path: `${out}/below-${width}-${theme}.png` });
      await page.waitForTimeout(6000);
      const b = await inner(page);
      check(`${width}: rotates by itself (first product changes within 6 s)`, a?.first !== b?.first, true);
      checks.at(-1).detail = { per, before: a?.first, after: b?.first, items: a?.items };
    } else {
      check(`${width}: only the side rail iframe exists`, f, { below: 0, side: 1 });
      await page.screenshot({ path: `${out}/side-${width}-${theme}.png` });
    }
    check(`${width} ${theme}: no horizontal overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (width === 1366) {
      await page.setViewportSize({ width: 1600, height: 900 });
      await page.waitForTimeout(800);
      check('resize 1366→1600: below removed, side rail created', await frames(page), { below: 0, side: 1 });
      await page.setViewportSize({ width: 1200, height: 900 });
      await page.waitForTimeout(800);
      check('resize 1600→1200: side rail removed, below created', await frames(page), { below: 1, side: 0 });
    }
    check(`${width}: no console/page errors`, errors, []);
    await context.close();
  }
} finally {
  await browser.close();
}
const pass = checks.every((c) => c.pass);
writeFileSync(`${out}/result.json`, JSON.stringify({ pass, checks }, null, 1));
for (const c of checks) console.log(c.pass ? 'PASS' : 'FAIL', c.name, c.pass ? '' : JSON.stringify(c.actual));
process.exit(pass ? 0 : 1);
