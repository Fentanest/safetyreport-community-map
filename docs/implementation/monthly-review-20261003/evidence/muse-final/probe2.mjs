// Follow-up probes: sort-click aria-sort, picker kind clear + retry, scope more-reset. Synthetic only.
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
  await page.locator('.pivot-table button.pivot-sort').first().click(); await sleep(600);
  out.sortAfterClick = await page.evaluate(() => ({
    thSort: Array.from(document.querySelectorAll('.pivot-table th[aria-sort]')).map(th => th.getAttribute('aria-sort') + ':' + th.innerText.trim().slice(0, 20)),
    btnSort: document.querySelectorAll('.pivot-table button[aria-sort]').length,
  }));
  const opener = page.getByRole('button', { name: '비교 대상 선택' });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: '비교 대상 선택' });
  await dialog.locator('.picker-list li').first().waitFor();
  const beforeKind = await dialog.locator('.picker-list li').count();
  await api('delay', { 'statistics/candidates': 1500 });
  await dialog.getByRole('button', { name: '담당자', exact: true }).click(); await sleep(300);
  out.kindChangeClears = { before: beforeKind, during: await dialog.locator('.picker-list li').count() };
  await api('delay', {}); await sleep(1800);
  out.kindChangeRestores = await dialog.locator('.picker-list li').count();
  await api('inject', { route: 'statistics/candidates', status: 503, times: 1 });
  await dialog.getByRole('searchbox').fill('재시도유발2'); await sleep(900);
  out.retryVisible = await dialog.getByRole('button', { name: '다시 시도' }).count();
  if (out.retryVisible) { await dialog.getByRole('button', { name: '다시 시도' }).click(); await sleep(1500); }
  out.retryRestores = await dialog.locator('.picker-list li').count();
  await page.screenshot({ path: 'docs/implementation/monthly-review-20261003/evidence/muse-final/picker-probe.png' });
  await page.keyboard.press('Escape');
  await page.locator('.rail button[aria-label^="지도"]').click(); await sleep(400);
  const scope = page.locator('.scope-panel');
  const moreBtns = scope.getByRole('button', { name: '더 보기' });
  out.moreCount = await moreBtns.count();
  if (await moreBtns.count()) {
    const list = scope.locator('ul li, ol li').first();
    const n0 = await scope.locator('li').count();
    await moreBtns.first().click(); await sleep(600);
    const n1 = await scope.locator('li').count();
    // Narrow cohort: click first region button.
    const regionBtn = scope.getByRole('button', { name: /신고.*답변/ }).first();
    if (await regionBtn.count()) { await regionBtn.click(); await sleep(1000); }
    out.scopeMoreReset = { n0, n1, after: await scope.locator('li').count() };
  }
  await context.close();
} finally { await api('reset'); await browser.close(); }
console.log(JSON.stringify(out, null, 2));
