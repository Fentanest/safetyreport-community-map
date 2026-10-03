// Retry-restore with a REAL matching query. Synthetic only.
import { chromium, openPage, api, sleep, waitMap } from '../../../../../scripts/browser/harness.mjs';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--lang=ko-KR'] });
const search = '?date_basis=completed_date&start=2025-09-25&end=2026-09-24&category=all';
const out = {};
try {
  await api('reset');
  const { page, context } = await openPage(browser, { search });
  await waitMap(page);
  await page.locator('.rail button[aria-label^="통계"]').click();
  await page.waitForSelector('.pivot-table tbody tr');
  await page.getByRole('button', { name: '비교 대상 선택' }).click();
  const dialog = page.getByRole('dialog', { name: '비교 대상 선택' });
  await dialog.locator('.picker-list li').first().waitFor();
  await api('inject', { route: 'statistics/candidates', status: 503, times: 1 });
  await dialog.getByRole('searchbox').fill('경찰'); await sleep(900);
  out.errorState = await page.evaluate(() => ({ alerts: document.querySelector('[role=dialog]').querySelectorAll('[role=alert]').length, items: document.querySelector('[role=dialog]').querySelectorAll('.picker-list li').length }));
  await dialog.getByRole('button', { name: '다시 시도' }).click(); await sleep(1500);
  out.afterRetry = await page.evaluate(() => {
    const d = document.querySelector('[role=dialog]');
    return { alerts: d.querySelectorAll('[role=alert]').length, items: d.querySelectorAll('.picker-list li').length, first: d.querySelector('.picker-list li')?.textContent.trim().slice(0, 40) };
  });
  await context.close();
} finally { await api('reset'); await browser.close(); }
console.log(JSON.stringify(out, null, 2));
