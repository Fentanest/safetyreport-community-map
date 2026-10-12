// Item 2 only. Start VITE_DATA_MODE=demo npx vite --host 127.0.0.1 --port 5294 --strictPort first.
// MAP_UX_ORIGIN=http://127.0.0.1:5294 node scripts/browser/verify_map_ux_heatmap.mjs
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';

const { chromium } = await import('/home/better0101/projects/safetyreport/tools/web-tests/node_modules/playwright/index.mjs');
const out = '.agent-runs/map-ux';
const base = process.env.MAP_UX_ORIGIN || 'http://127.0.0.1:5294';
mkdirSync(out, { recursive: true });
const checks = [], errors = [], failedRequests = [];
let browser;
try {
  browser = await chromium.launch({ executablePath: '/home/better0101/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome', headless: true, args: ['--no-sandbox'] });
  for (const width of [1280, 390]) for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, colorScheme: theme, reducedMotion: 'reduce' });
    await context.addInitScript((value) => localStorage.setItem('cm-theme', value), theme);
    // This is a synthetic analytics review; Kakao SDK integration is outside its scope.
    await context.route('https://dapi.kakao.com/**', (r) => r.fulfill({ contentType: 'text/javascript', body: '' }));
    const page = await context.newPage();
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('requestfailed', (r) => failedRequests.push({ url: r.url(), reason: r.failure()?.errorText }));
    await page.goto(`${base}/?me=signed`);
    await page.getByRole('region', { name: '더 보는 그래프' }).getByRole('button', { name: '펼치기', exact: true }).click();
    const card = page.getByRole('article', { name: '기관별 위반법규 처리결과' });
    const host = card.locator('.chart-host');
    await card.scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelector('[aria-label="기관별 위반법규 처리결과"] .chart-host')?.__chart?.getOption()?.series?.[0]?.data?.length > 0);
    assert.equal(await card.getByRole('button', { name: '과태료', exact: true }).getAttribute('aria-pressed'), 'true');
    async function verify(label) {
      const result = await host.evaluate((el) => {
        const chart = el.__chart, option = chart.getOption();
        const luminance = (color) => {
          // --surface is authored as the 3-digit shorthand (#fff) in src/styles/app.css; expand it first
          // or slice(1).match(/../g) silently drops the third channel and reports white as near-black.
          const hex = color.startsWith('#') && color.length === 4 ? `#${[...color.slice(1)].map((c) => c + c).join('')}` : color;
          const rgb = hex.startsWith('#') ? hex.slice(1).match(/../g).map((v) => parseInt(v, 16)) : hex.match(/[\d.]+/g).slice(0, 3).map(Number);
          return rgb.map((v) => v / 255).map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
            .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
        };
        const ratios = option.series[0].data.map((p, i) => {
          const a = luminance(p.label.color), b = luminance(p.label.backgroundColor || chart.getVisual({ seriesIndex: 0, dataIndex: i }, 'color'));
          return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        });
        return { minContrast: Math.min(...ratios), cells: ratios.length, dimension: option.visualMap[0].dimension,
          overflow: document.documentElement.scrollWidth > innerWidth };
      });
      assert.ok(result.minContrast >= 4.5 && !result.overflow && result.dimension === 2, JSON.stringify(result));
      checks.push({ width, theme, label, ...result });
    }
    await verify('과태료 기본값');
    await page.screenshot({ path: `${out}/heatmap-page-${width}-${theme}.png`, fullPage: true });
    await card.screenshot({ path: `${out}/heatmap-${width}-${theme}.png` });
    for (const name of ['수용률', '불수용률', '과태료']) {
      await card.getByRole('button', { name, exact: true }).click();
      await page.waitForTimeout(250);
      await verify(name);
    }
    await card.getByRole('button', { name: '표로 보기', exact: true }).click();
    assert.ok(await card.locator('tbody tr').count() > 0);
    await card.getByRole('button', { name: '그래프로 보기', exact: true }).click();
    for (let i = 0; i < 6; i++) {
      await page.getByRole('button', { name: /^테마 전환/ }).click();
      await page.waitForTimeout(250);
      await verify(`테마 전환 ${i + 1}`);
      assert.equal(await card.getByRole('button', { name: '과태료', exact: true }).getAttribute('aria-pressed'), 'true');
    }
    await context.close();
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(failedRequests, []);
  writeFileSync(`${out}/browser-summary.json`, JSON.stringify({ mode: 'demo / synthetic; Kakao SDK stubbed', browser: browser.version(), checks, errors, failedRequests }, null, 2));
  console.log(`${checks.length} checks passed; ${out}`);
} catch (e) {
  writeFileSync(`${out}/browser-failure.json`, JSON.stringify({ message: e.message, checks, errors, failedRequests }, null, 2));
  throw e;
} finally { await browser?.close(); }
