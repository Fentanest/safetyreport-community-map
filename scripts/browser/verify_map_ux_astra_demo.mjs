// Items 3 and 5, synthetic demo only. No DB/Edge operations.
// VITE_DATA_MODE=demo npx vite --host 127.0.0.1 --port 5293 --strictPort
// MAP_UX_ORIGIN=http://127.0.0.1:5293 node scripts/browser/verify_map_ux_astra_demo.mjs
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
const { chromium } = await import('/home/better0101/projects/safetyreport/tools/web-tests/node_modules/playwright/index.mjs');
const origin = process.env.MAP_UX_ORIGIN || 'http://127.0.0.1:5293';
const out = '.agent-runs/map-ux';
mkdirSync(out, { recursive: true });
const errors = [], failedRequests = [], checks = [];
const browser = await chromium.launch({ executablePath: '/home/better0101/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome', headless: true, args: ['--no-sandbox', '--lang=ko-KR'] });
try {
  for (const width of [1280, 390]) for (const theme of ['light', 'dark']) {
    const label = `${width}-${theme}`;
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce', colorScheme: theme });
    await context.addInitScript((t) => localStorage.setItem('cm-theme', t), theme);
    // Keep synthetic UI verification independent of a live map key; not a Kakao integration test.
    await context.route('https://dapi.kakao.com/**', (r) => r.fulfill({ contentType: 'text/javascript', body: '' }));
    const page = await context.newPage();
    page.on('console', (m) => { if (m.type() === 'error') errors.push({ label, message: m.text() }); });
    page.on('pageerror', (e) => errors.push({ label, message: e.message }));
    page.on('requestfailed', (r) => failedRequests.push({ label, url: r.url(), error: r.failure()?.errorText }));
    await page.goto(`${origin}/?me=signed`);
    const compare = page.getByRole('switch', { name: '내 신고와 비교', exact: true });
    await compare.check();
    await page.locator('[data-kpi="duration"] .kpi-mine').waitFor();
    const kpi = page.locator('[data-kpi="duration"]');
    assert.match(await kpi.innerText(), /중앙값.*평균/s);
    assert.match(await kpi.locator('.kpi-mine').innerText(), /내 중앙값.*평균/s);
    await page.locator('#summary').screenshot({ path: `${out}/kpi-${label}.png` });
    await page.getByRole('tab', { name: '기관·담당자', exact: true }).click();
    const table = page.locator('#entities');
    await table.locator('tbody .entity-mine').first().waitFor();
    assert.equal(await table.locator('thead th').count(), 6);
    assert.equal(await table.locator('tbody tr').first().locator('.entity-mine').count(), 5);
    assert.equal(await table.locator('.entity-mine').first().evaluate((e) => getComputedStyle(e).color), theme === 'light' ? 'rgb(11, 78, 215)' : 'rgb(96, 165, 250)');
    for (const kind of ['기관', '담당자']) {
      await table.getByRole('button', { name: kind, exact: true }).click();
      await table.locator('tbody .entity-mine').first().waitFor();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await table.screenshot({ path: `${out}/${kind === '기관' ? 'agencies' : 'managers'}-${label}.png` });
      if (width === 390) {
        const scroll = table.locator('.table-scroll');
        await scroll.evaluate((e) => { e.scrollLeft = e.scrollWidth; });
        assert.ok(await scroll.evaluate((e) => e.scrollLeft > 0));
        await table.screenshot({ path: `${out}/${kind === '기관' ? 'agencies' : 'managers'}-scrolled-${label}.png` });
        await scroll.evaluate((e) => { e.scrollLeft = 0; });
      }
    }
    await compare.uncheck();
    assert.equal(await table.locator('.entity-mine').count(), 0);
    await compare.check();
    await table.locator('.entity-mine').first().waitFor();
    await page.getByRole('button', { name: '펼치기', exact: true }).click();
    const duration = page.getByRole('article', { name: '답변까지 걸린 기간의 분포', exact: true });
    await duration.locator('.chart-caption .mine-col').waitFor();
    assert.match(await duration.locator('.chart-caption').innerText(), /전체 중앙값.*평균.*내 신고 중앙값.*평균/s);
    await duration.screenshot({ path: `${out}/duration-${label}.png` });
    await duration.getByRole('button', { name: '표로 보기' }).click();
    assert.ok(await duration.locator('tbody tr').count() > 0);
    await duration.screenshot({ path: `${out}/duration-table-${label}.png` });
    checks.push(`${label}: KPI mean/median, inline five metrics, both entity tabs, comparison toggle, duration table, page overflow`);
    await context.close();
  }
  assert.deepEqual(errors, [], 'console/page errors');
  assert.deepEqual(failedRequests, [], 'failed requests');
} finally {
  writeFileSync(`${out}/browser-results.json`, JSON.stringify({ origin, mode: 'synthetic demo; Kakao SDK stubbed', checks, errors, failedRequests }, null, 2));
  await browser.close();
}
