// Viewport-height slices of the page (easier to read than one very tall capture). node slices.mjs <prefix> <w> <h> <theme> [count]
import { chromium, openPage, waitMap, sleep, api } from './harness.mjs';
const [prefix, w = '390', h = '844', theme = 'dark', count = '8'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
try {
  await api('reset');
  const { page } = await openPage(browser, { width: +w, height: +h, theme });
  await waitMap(page); await sleep(2000);
  const total = await page.evaluate(() => document.documentElement.scrollHeight);
  const n = Math.min(+count, Math.ceil(total / +h));
  for (let i = 0; i < n; i++) {
    await page.evaluate((y) => window.scrollTo(0, y), i * +h);
    await sleep(500);
    await page.screenshot({ path: `${prefix}-${i}.png` });
  }
  console.log(JSON.stringify({ total, n }));
} finally { await browser.close(); }
