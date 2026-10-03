// Read-only production smoke. No fixture, OAuth action, token injection or intercepted requests.
import { chromium } from './harness.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const url = process.env.RELEASE_URL || 'https://safemap.worklazy.net/';
const out = process.env.RELEASE_EVIDENCE_DIR || 'docs/implementation/main-release-20261003/evidence';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const results = [];
try {
  for (const width of [1920, 1440, 2560, 390]) {
    for (const theme of ['dark', 'light']) {
      const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : width === 2560 ? 1440 : width === 1440 ? 900 : 1080 }, locale: 'ko-KR', colorScheme: theme });
      await context.addInitScript((t) => localStorage.setItem('cm-theme', t), theme);
      const page = await context.newPage();
      const errors = [], failures = [], protectedRequests = [], assets = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      page.on('requestfailed', (r) => failures.push({ url: new URL(r.url()).origin + new URL(r.url()).pathname, error: r.failure()?.errorText }));
      page.on('request', (r) => { if (r.url().includes('/functions/v1/')) protectedRequests.push(new URL(r.url()).pathname); });
      page.on('response', (r) => { const u = new URL(r.url()); if (u.origin === new URL(url).origin && u.pathname.startsWith('/assets/')) assets.push({ path: u.pathname, status: r.status() }); });
      const response = await page.goto(`${url}?screen=rankings&rk_period=month&rk_month=2023-07`, { waitUntil: 'networkidle', timeout: 45000 });
      await page.getByRole('heading', { name: '지금은 신고를 10건 이상 공유한 분만 볼 수 있어요' }).waitFor();
      await page.getByRole('button', { name: '카카오로 로그인' }).focus();
      const keyboardFocus = await page.getByRole('button', { name: '카카오로 로그인' }).evaluate((el) => el === document.activeElement);
      await page.reload({ waitUntil: 'networkidle' });
      await page.getByRole('heading', { name: '지금은 신고를 10건 이상 공유한 분만 볼 수 있어요' }).waitFor();
      const metrics = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, width: innerWidth, scrollWidth: document.documentElement.scrollWidth, rankingRows: document.querySelectorAll('.rk-row').length }));
      const screenshot = `${width}-${theme}.png`;
      await page.screenshot({ path: join(out, screenshot), fullPage: true });
      const passed = response.status() === 200 && metrics.theme === theme && metrics.scrollWidth <= metrics.width && keyboardFocus && protectedRequests.length === 0 && metrics.rankingRows === 0 && assets.every((a) => a.status === 200);
      results.push({ width, theme, documentStatus: response.status(), ...metrics, keyboardFocus, protectedRequests, assets: [...new Map(assets.map((a) => [a.path, a])).values()], errors, failures, screenshot, passed });
      await context.close();
    }
  }
  writeFileSync(join(out, 'production-browser.json'), JSON.stringify({ url, browser: browser.version(), dataMode: 'live, anonymous; no fixture or mock', results }, null, 2) + '\n');
  console.log(JSON.stringify(results.map(({ width, theme, passed, errors, failures }) => ({ width, theme, passed, errors, failures })), null, 2));
  if (results.some((r) => !r.passed)) process.exitCode = 1;
} finally {
  await browser.close();
}
