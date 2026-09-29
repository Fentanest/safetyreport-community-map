// Quick screenshot helper: node scripts/browser/shot.mjs <out.png> [width] [height] [theme] [search] [fullPage]
import { chromium, openPage, waitMap, sleep, api } from './harness.mjs';
const [out = 'shot.png', w = '1440', h = '900', theme = 'dark', search = '', full = '1'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
try {
  await api('reset');
  const { page, consoleErrors } = await openPage(browser, { width: +w, height: +h, theme, search });
  await waitMap(page).catch(() => undefined);
  await sleep(2500);
  await page.screenshot({ path: out, fullPage: full === '1' });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  console.log(JSON.stringify({ out, overflow, consoleErrors: consoleErrors.slice(0, 8) }));
} finally { await browser.close(); }
