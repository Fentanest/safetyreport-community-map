// Probe actual DOM for picker kind control, pivot headers, scope chart pager. Synthetic only.
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
  out.pivotHeaders = await page.evaluate(() => Array.from(document.querySelectorAll('.pivot-table thead th')).map(th => ({
    text: th.innerText.trim().slice(0, 30), ariaSort: th.getAttribute('aria-sort'),
    inner: th.innerHTML.slice(0, 200),
  })));
  out.pivotSortBtns = await page.evaluate(() => Array.from(document.querySelectorAll('.pivot-table thead button')).map(b => b.outerHTML.slice(0, 200)));
  const opener = page.getByRole('button', { name: '비교 대상 선택' });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: '비교 대상 선택' });
  await dialog.locator('.picker-list li').first().waitFor();
  out.pickerControls = await page.evaluate(() => {
    const d = document.querySelector('[role=dialog]');
    return {
      html: d.innerHTML.slice(0, 1500),
      radios: d.querySelectorAll('[role=radio],input[type=radio]').length,
      buttons: Array.from(d.querySelectorAll('button')).map(b => b.textContent.trim().slice(0, 20)),
      selects: d.querySelectorAll('select').length,
      tabs: Array.from(d.querySelectorAll('[role=tab]')).map(t => t.textContent.trim().slice(0, 20)),
    };
  });
  // Inject 503 then search: capture what the picker shows.
  await api('inject', { route: 'statistics/candidates', status: 503, times: 1 });
  await dialog.getByRole('searchbox').fill('재시도유발'); await sleep(900);
  out.pickerAfter503 = await page.evaluate(() => {
    const d = document.querySelector('[role=dialog]');
    return { html: d.innerHTML.slice(-1200), alerts: d.querySelectorAll('[role=alert]').length, retry: Array.from(d.querySelectorAll('button')).filter(b => b.textContent.includes('다시')).length, items: d.querySelectorAll('.picker-list li').length };
  });
  const netlog = await api('log');
  out.candidateRequests = netlog.filter(x => x.route === 'statistics/candidates').slice(-5);
  await page.keyboard.press('Escape');
  // Scope panel chart pager selectors.
  out.scopePanel = await page.evaluate(() => {
    const s = document.querySelector('.scope-panel');
    if (!s) return 'NO_SCOPE_PANEL';
    const btns = Array.from(s.querySelectorAll('button')).map(b => b.textContent.trim().slice(0, 25));
    const navs = Array.from(s.querySelectorAll('nav')).map(n => (n.getAttribute('aria-label') || '') + '|' + n.innerHTML.slice(0, 150));
    return { btns, navs, htmlLen: s.innerHTML.length, chartBits: s.innerHTML.slice(0, 800) };
  });
  await context.close();
} finally { await api('reset'); await browser.close(); }
console.log(JSON.stringify(out, null, 2));
