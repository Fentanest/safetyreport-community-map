// Follow-up: fresh-state aria, keyboard focus 2px, 390 shots. Synthetic+mock only.
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, openPage, api, waitMap, sleep } from '../../../../../scripts/browser/harness.mjs';
const dir = 'docs/implementation/monthly-review-20261003/evidence/muse-aria';
mkdirSync(dir, { recursive: true });
const checks = []; const info = {};
const check = (n, p, x = {}) => checks.push({ name: n, pass: !!p, ...x });
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--lang=ko-KR'] });
let consoles = [];
try {
  await api('reset'); await api('dataset', { name: 'managers' });
  const { page, context, consoleErrors } = await openPage(browser, { search: '?start=2026-01-01&end=2026-09-30&date_basis=completed_date' });
  await waitMap(page);
  await page.locator('.rail button[aria-label^="통계"]').click();
  await page.getByLabel('예시 설정').selectOption('outcome_disposition');
  await page.getByRole('button', { name: '통계 만들기', exact: true }).click();
  await page.locator('.pivot-cell').first().waitFor({ timeout: 15000 }); await sleep(200);
  // fresh state after preset switch: default sort? capture
  const fTh = await page.locator('.pivot-table th[aria-sort]').count();
  const fTot = await page.locator('.pivot-table th.pivot-total[aria-sort]').count();
  const fVal = fTh ? await page.locator('.pivot-table th[aria-sort]').getAttribute('aria-sort') : null;
  const fText = fTh ? await page.locator('.pivot-table th[aria-sort]').innerText() : '';
  info.fresh = { fTh, fTot, fVal, fText };
  // click a NON-total column sort -> aria must still land on single TOTAL th
  await page.locator('.pivot-table thead th:not(.pivot-total) .pivot-sort').first().click(); await sleep(250);
  const gTh = await page.locator('.pivot-table th[aria-sort]').count();
  const gTot = await page.locator('.pivot-table th.pivot-total[aria-sort]').count();
  const gBtn = await page.locator('button[aria-sort]').count();
  const gVal = await page.locator('.pivot-table th[aria-sort]').getAttribute('aria-sort');
  const gRows = await page.locator('.pivot-table tbody tr th').allInnerTexts();
  check('B-fresh-nonTotalClick-single-total', gTh === 1 && gTot === 1 && gBtn === 0, { gTh, gTot, gBtn, gVal, fVal });
  info.afterNonTotal = { gVal, gRows };
  // visible arrow matches aria (▾=desc, ▴=asc)
  const arrow = await page.evaluate(() => { const b = document.querySelector('.pivot-table th[aria-sort] .pivot-sort'); const cs = getComputedStyle(b, '::after'); return cs.content; });
  check('B-arrow-matches-aria', (gVal === 'descending' && arrow.includes('▾')) || (gVal === 'ascending' && arrow.includes('▴')), { gVal, arrow });
  // toggle via total button flips dir, still single
  await page.locator('.pivot-table th.pivot-total .pivot-sort').first().click(); await sleep(250);
  const hVal = await page.locator('.pivot-table th[aria-sort]').getAttribute('aria-sort');
  const hTh = await page.locator('.pivot-table th[aria-sort]').count();
  const hRows = await page.locator('.pivot-table tbody tr th').allInnerTexts();
  check('B-total-toggle-flips', hTh === 1 && hVal !== gVal, { gVal, hVal, hRows });
  // totals preserved across sort (server recomputed): grand total cell unchanged
  const gt = async () => await page.locator('.pivot-table tfoot td').last().innerText().catch(() => '');
  const gtBefore = await gt();
  await page.locator('.pivot-table th.pivot-total .pivot-sort').first().click(); await sleep(250);
  const gtAfter = await gt();
  check('B-grandtotal-preserved', gtBefore === gtAfter && gtBefore !== '', { gtBefore, gtAfter });
  // keyboard focus 2px: Tab to first pivot-sort
  await page.locator('.stats-result').screenshot({ path: `${dir}/table-1440-dark.png` });
  await page.keyboard.press('Tab');
  // ensure a pivot-sort gets focus via keyboard
  for (let i = 0; i < 30; i++) { const cls = await page.evaluate(() => document.activeElement?.className || ''); if (String(cls).includes('pivot-sort')) break; await page.keyboard.press('Tab'); }
  const foc = await page.evaluate(() => { const el = document.activeElement; const cs = getComputedStyle(el); return { cls: el.className, ow: cs.outlineWidth, os: cs.outlineStyle, oc: cs.outlineColor, off: cs.outlineOffset }; });
  check('focus-2px-keyboard', foc.ow === '2px', foc);
  info.focus = foc;
  await page.locator('.stats-result').screenshot({ path: `${dir}/table-focus-1440-dark.png` });
  consoles.push(...consoleErrors); await context.close();
  // 390 + 1440 light/dark matrix shots (mobile via bottom-nav)
  for (const theme of ['light', 'dark']) for (const width of [1440, 390]) {
    if (width === 1440 && theme === 'dark') continue; // already have
    await api('reset');
    const v = await openPage(browser, { theme, width, height: width < 500 ? 844 : 900, search: '?start=2026-01-01&end=2026-09-30&date_basis=completed_date' });
    await waitMap(v.page);
    if (width < 500) { await v.page.locator('.bottom-nav button').filter({ hasText: '통계' }).click(); }
    else { await v.page.locator('.rail button[aria-label^="통계"]').click(); }
    await v.page.getByLabel('예시 설정').selectOption('outcome_disposition');
    await v.page.getByRole('button', { name: '통계 만들기', exact: true }).click();
    await v.page.locator('.pivot-table tbody tr').first().waitFor({ timeout: 15000 });
    await v.page.locator('.pivot-sort').first().click(); await sleep(200);
    const ov = await v.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    check(`shot-${width}-${theme}-overflow`, ov === true, { ov });
    await v.page.locator('.stats-result').screenshot({ path: `${dir}/table-${width}-${theme}.png` });
    consoles.push(...v.consoleErrors); await v.context.close();
  }
  info.netlog = await api('log').catch(() => []);
} finally {
  await browser.close(); await api('reset').catch(() => {});
  writeFileSync(`${dir}/aria-result2.json`, JSON.stringify({ commit: '27de7f3', checks, info, consoles }, null, 2));
  console.log(JSON.stringify({ checks, info }, null, 2));
}
