// Browser check that the AliExpress side banner in src/ads/banners.html rotates by itself (data-wlpb-auto="true", 2026-10-18).
// Renders the real srcdoc alone (no app stack) with auto=true and, as a control, auto=false; samples the first product every 6 s.
// Product images come from the AliExpress CDN as-is.   run: node scripts/browser/verify_aliexpress_auto.mjs <dir>
// Playwright: PLAYWRIGHT_PATH=<dir with playwright-core>; browser: CHROME_PATH (default /usr/bin/google-chrome).
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const out = process.argv[2] || 'evidence';
mkdirSync(out, { recursive: true });
const html = readFileSync('src/ads/banners.html', 'utf8');
const srcdoc = html.match(/<section data-ad-slot="side">[\s\S]*?srcdoc="([^"]*)"/)[1]
  .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome' });
const result = { configured: srcdoc.match(/data-wlpb-auto="(true|false)"/)?.[1] ?? null, runs: {} };
for (const auto of ['true', 'false']) {
  const page = await browser.newPage({ viewport: { width: 340, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', c => { if (c.type() === 'error') errors.push(c.text()); });
  await page.setContent(srcdoc.replace(/data-wlpb-auto="(true|false)"/, `data-wlpb-auto="${auto}"`), { waitUntil: 'domcontentloaded' });
  await page.mouse.move(0, 0);
  const first = () => page.evaluate(() => (document.querySelector('.wlpb-v1-details')?.textContent ?? '').trim().slice(0, 40));
  const samples = [await first()];
  for (let i = 0; i < 3; i++) { await page.waitForTimeout(6000); samples.push(await first()); }
  await page.screenshot({ path: `${out}/side-auto-${auto}-t18.png` });
  result.runs[auto] = { samples, distinct: new Set(samples).size, errors };
  await page.close();
}
await browser.close();
const pass = result.configured === 'true' && result.runs.true.distinct > 1 && result.runs.false.distinct === 1 &&
  result.runs.true.errors.length === 0 && result.runs.false.errors.length === 0;
writeFileSync(`${out}/result.json`, JSON.stringify({ ...result, pass }, null, 1));
console.log(JSON.stringify({ pass, configured: result.configured, true: result.runs.true.distinct, false: result.runs.false.distinct }));
process.exit(pass ? 0 : 1);
