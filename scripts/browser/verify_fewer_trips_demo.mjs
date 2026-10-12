import { chromium } from './harness.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const origin = process.env.DEMO_ORIGIN || 'http://127.0.0.1:5223';
const out = '.agent-runtime/fewer-trips/demo'; mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const checks = [], errors = [];
try {
 for (const width of [390, 1440]) for (const theme of ['dark', 'light']) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme });
  await context.addInitScript(t => localStorage.setItem('cm-theme', t), theme);
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${origin}/?me=signed`);
  await page.locator('.kpi-strip[aria-busy="false"] .kpi-value').first().waitFor();
  await page.getByRole('switch', { name: '내 신고와 비교' }).check();
  await page.locator('.kpi-mine').first().waitFor();
  await page.getByRole('button', { name: '펼치기', exact: true }).click();
  await page.locator('#more-charts-body canvas').first().waitFor();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  assert.equal(await page.locator('.banner.error').count(), 0);
  await page.screenshot({ path: `${out}/${width}-${theme}.png`, fullPage: true });
  await page.getByRole('button', { name: '접기', exact: true }).click();
  await page.getByRole('tab', { name: '기관·담당자', exact: true }).click();
  await page.locator('#entities tbody tr').first().waitFor();
  const api = await page.evaluate(() => performance.getEntriesByType('resource').filter(r => r.name.includes('/functions/v1/')).length);
  assert.equal(api, 0);
  checks.push({ width, theme, comparison: true, charts: true, entityTable: true, overflow: false, apiRequests: api });
  await context.close();
 }
 assert.equal(errors.length, 0);
} finally { await browser.close(); writeFileSync(`${out}/results.json`, JSON.stringify({ checks, errors }, null, 2)); }
console.log(JSON.stringify({ checks, errors }));
