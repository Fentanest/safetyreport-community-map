// Browser evidence for the 2026-10-22 map web changes (maintenance banner, required-version screen) on a DEMO build.
// Synthetic fixtures only (?me=signed&client_status=paused|paused-open|update-required|update-ok). Run:
//   VITE_DATA_MODE=demo VITE_BASE_PATH=/ npx vite build --outDir <dir> && node scripts/browser/verify_backfill_resume_demo.mjs <dir> <out dir> <playwright module path>
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { createRequire } from 'node:module';
const [dist, out, pwPath] = process.argv.slice(2);
const require = createRequire(import.meta.url);
const { chromium } = require(pwPath);
mkdirSync(out, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webmanifest': 'application/json', '.woff2': 'font/woff2' };
const server = createServer((req, res) => {
  let p = join(dist, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!existsSync(p) || statSync(p).isDirectory()) p = join(dist, 'index.html');
  res.writeHead(200, { 'content-type': types[extname(p)] ?? 'application/octet-stream' }); res.end(readFileSync(p));
}).listen(0, '127.0.0.1');
await new Promise(r => server.on('listening', r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();
const cases = [['paused', '?me=signed&client_status=paused'], ['paused-open', '?me=signed&client_status=paused-open'],
  ['update-required', '?me=signed&client_status=update-required'], ['update-ok', '?me=signed&client_status=update-ok'], ['none', '?me=signed']];
const report = [];
for (const [name, q] of cases) for (const [w, h, tag] of [[1366, 900, 'desktop'], [390, 844, 'mobile']]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const errors = []; const requests = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  page.on('request', r => { if (!r.url().startsWith(base)) requests.push(r.url()); });
  await page.goto(base + q, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const banner = await page.locator('.upload-pause-banner').count();
  const bannerText = banner ? (await page.locator('.upload-pause-banner').innerText()).replace(/\s+/g, ' ') : null;
  const update = await page.locator('.update-required').count();
  const updateText = update ? (await page.locator('.update-required').innerText()).replace(/\s+/g, ' ') : null;
  const mapShown = await page.locator('[data-screen]').count();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  await page.screenshot({ path: join(out, `${name}-${tag}.png`), fullPage: false });
  report.push({ case: name, viewport: tag, banner: !!banner, bannerText, updateScreen: !!update, updateText, dashboardMounted: mapShown > 0,
    horizontalOverflow: overflow, consoleErrors: errors, externalRequests: [...new Set(requests.map(u => new URL(u).host))] });
  await page.close();
}
// "다시 확인" button exists and is clickable on the update screen
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto(base + '?me=signed&client_status=update-required', { waitUntil: 'networkidle' });
await page.getByRole('button', { name: '다시 확인' }).click();
const stillShown = await page.locator('.update-required').count();
report.push({ case: 'update-required retry click', stillShownWithSameServerAnswer: stillShown > 0 });
await browser.close(); server.close();
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report.map(r => ({ c: r.case, v: r.viewport, b: r.banner, u: r.updateScreen, d: r.dashboardMounted, o: r.horizontalOverflow, e: r.consoleErrors?.length, x: r.externalRequests })), null, 0));
