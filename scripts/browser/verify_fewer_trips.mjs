// Real Chrome + real handlers over synthetic demo facts. Auth and Kakao are explicitly mocked.
import { chromium, openPage, ORIGIN } from './harness.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const out = process.env.FEW_TRIPS_OUT || '.agent-runtime/fewer-trips/browser';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const results = { mode: 'synthetic local real handlers / fake auth / mock Kakao', browser: browser.version(), checks: [], console: [] };
try {
 for (const theme of ['dark', 'light']) for (const width of [390, 1440, 1920, 2560]) {
  const { page, context, consoleErrors } = await openPage(browser, { width, height: width === 390 ? 844 : 1080, theme, search: '?start=2025-09-25&end=2026-09-24&date_basis=completed_date' });
  // Resource timing includes requests made before page.goto finished.
  await page.locator('.kpi-strip[aria-busy="false"] .kpi-value').first().waitFor();
  await page.waitForTimeout(400);
  const requests = await page.evaluate(() => performance.getEntriesByType('resource').map(r => r.name).filter(n => n.includes('/functions/v1/')));
  assert.equal(requests.filter(n => n.includes('public-analytics/meta')).length, 0);
  assert.equal(requests.filter(n => n.includes('my-analytics/screen')).length, 1);
  assert(!requests.some(n => decodeURIComponent(n).includes('dashboard-analytics')));
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  assert.equal(await page.locator('.banner.error').count(), 0);
  await page.screenshot({ path: `${out}/${width}-${theme}.png`, fullPage: true });
  const [response] = await Promise.all([
    page.waitForResponse(r => r.url().includes('my-analytics/screen') && decodeURIComponent(r.url()).includes('dashboard-analytics')),
    page.getByRole('button', { name: '펼치기', exact: true }).click(),
  ]);
  assert.equal(response.status(), 200);
  const packet = await response.json();
  assert.equal(packet.dashboard.analytics, null);
  const charts = packet.panels.find(p => p.id === 'charts');
  assert(charts.body.analytics); assert.equal(charts.body.dataset_version, packet.meta.dataset_version);
  await page.locator('#more-charts-body').waitFor();
  await page.locator('#more-charts-body canvas').first().waitFor();
  await page.screenshot({ path: `${out}/${width}-${theme}-charts.png`, fullPage: true });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  if (width === 390) {
   await page.getByRole('switch', { name: '내 신고와 비교' }).check();
   await page.locator('.kpi-mine').first().waitFor();
   await page.getByRole('tab', { name: '위반법규', exact: true }).click();
   await page.waitForTimeout(300);
   assert.equal(await page.locator('.banner.error').count(), 0);
  }
  if (width === 1440 && theme === 'dark') {
   await page.getByRole('button', { name: '접기', exact: true }).click();
   await Promise.all([page.waitForResponse(r => r.url().includes('my-analytics/screen') && r.url().includes('category=traffic')),
     page.getByRole('button', { name: '교통위반', exact: true }).click()]);
   assert.equal(await page.locator('#more-charts-body').count(), 0);
   await page.getByRole('button', { name: '펼치기', exact: true }).click();
   await page.locator('#more-charts-body canvas').first().waitFor();
   assert.equal(await page.locator('.more-charts [role="alert"]').count(), 0);
   results.checks.push({ closeChangeScopeReopen: true });
  }
  results.console.push(...consoleErrors);
  results.checks.push({ width, theme, firstScreenRequests: 1, metaRequests: 0, deferredCharts: true, overflow: false });
  await context.close();
 }
 // Failed chart load remains an error until explicit retry; retry must actually issue a fresh request.
 const { page, context, consoleErrors } = await openPage(browser, { search: '?start=2025-09-25&end=2026-09-24' });
 await page.locator('.kpi-strip[aria-busy="false"] .kpi-value').first().waitFor();
 let failed = false;
 await context.route('**/my-analytics/screen?*', route => {
  if (!failed && decodeURIComponent(route.request().url()).includes('dashboard-analytics')) {
   failed = true;
   return route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ error: { code: 'RESULT_TOO_LARGE', message: 'synthetic retry test' } }) });
  }
  return route.continue();
 });
 await page.getByRole('button', { name: '펼치기', exact: true }).click();
 await page.locator('.more-charts [role="alert"]').waitFor();
 await page.locator('.more-charts').getByRole('button', { name: '다시 시도' }).click();
 await page.locator('#more-charts-body canvas').first().waitFor();
 assert(failed); results.checks.push({ chartErrorAndExplicitRetry: true });
 results.console.push(...consoleErrors.filter(e => !e.includes('422')));
 await context.close();
 assert.equal(results.console.length, 0);
 results.status = 'PASS';
} finally {
 await browser.close(); writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 2));
}
console.log(JSON.stringify(results));
