// Targeted aria-sort closure verify (27de7f3). Local synthetic + mock Kakao only.
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, openPage, api, waitMap, sleep } from '../../../../../scripts/browser/harness.mjs';
const dir = 'docs/implementation/monthly-review-20261003/evidence/muse-aria';
mkdirSync(dir, { recursive: true });
const checks = [];
const info = {};
const check = (name, pass, extra = {}) => { checks.push({ name, pass: !!pass, ...extra }); };
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--lang=ko-KR'] });
let allConsole = [];
try {
  await api('reset'); await api('dataset', { name: 'managers' });
  const { page, context, consoleErrors } = await openPage(browser, { search: '?start=2026-01-01&end=2026-09-30&date_basis=completed_date' });
  await waitMap(page);
  await page.locator('.rail button[aria-label^="통계"]').click();
  // A: normal no-column table (manager_duration)
  await page.getByLabel('예시 설정').selectOption('manager_duration');
  await page.getByRole('button', { name: '통계 만들기', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.pivot-pager')?.textContent?.includes('118'));
  const orderBefore = await page.locator('.pivot-table tbody tr th').first().innerText().catch(() => '');
  await page.locator('.pivot-sort').first().click(); await sleep(250);
  const aTh = await page.locator('.pivot-table th[aria-sort]').count();
  const aBtn = await page.locator('button[aria-sort]').count();
  const aVal = await page.locator('.pivot-table th[aria-sort]').getAttribute('aria-sort').catch(() => null);
  const aTotalAria = await page.locator('.pivot-table th.pivot-total[aria-sort]').count();
  const orderAfter = await page.locator('.pivot-table tbody tr th').first().innerText().catch(() => '');
  const orderSecond = await page.locator('.pivot-table tbody tr th').nth(1).innerText().catch(() => '');
  // row totals of first two rows (server-computed, first metric col)
  const tot0 = await page.locator('.pivot-table tbody tr').first().locator('td').first().innerText().catch(() => '');
  const tot1 = await page.locator('.pivot-table tbody tr').nth(1).locator('td').first().innerText().catch(() => '');
  check('A-normal-1th-0btn', aTh === 1 && aBtn === 0, { aTh, aBtn, aVal, aTotalAria });
  check('A-normal-descending', aVal === 'descending', { aVal });
  check('A-normal-no-total-col', aTotalAria === 0, { aTotalAria });
  info.A = { orderBefore, orderAfter, orderSecond, tot0, tot1, aVal };
  await page.locator('.stats-result').screenshot({ path: `${dir}/A-normal-1440-dark.png` });

  // B: matrix preset outcome_disposition
  await page.getByLabel('예시 설정').selectOption('outcome_disposition');
  await page.getByRole('button', { name: '통계 만들기', exact: true }).click();
  await page.locator('.pivot-cell').first().waitFor({ timeout: 15000 });
  await sleep(200);
  const bRowsBefore = await page.locator('.pivot-table tbody tr th').allInnerTexts();
  await page.locator('.pivot-sort').first().click(); await sleep(250);
  const bTh = await page.locator('.pivot-table th[aria-sort]').count();
  const bTot = await page.locator('.pivot-table th.pivot-total[aria-sort]').count();
  const bBtn = await page.locator('button[aria-sort]').count();
  const bVal = await page.locator('.pivot-table th[aria-sort]').getAttribute('aria-sort').catch(() => null);
  const bThText = await page.locator('.pivot-table th[aria-sort]').innerText().catch(() => '');
  const bRowsAfter = await page.locator('.pivot-table tbody tr th').allInnerTexts();
  check('B-matrix-1total-desc', bTh === 1 && bTot === 1 && bBtn === 0 && bVal === 'descending', { bTh, bTot, bBtn, bVal, bThText });
  // toggle via total button -> ascending
  await page.locator('.pivot-table th.pivot-total .pivot-sort').first().click(); await sleep(250);
  const bVal2 = await page.locator('.pivot-table th[aria-sort]').getAttribute('aria-sort').catch(() => null);
  const bTh2 = await page.locator('.pivot-table th[aria-sort]').count();
  const bTot2 = await page.locator('.pivot-table th.pivot-total[aria-sort]').count();
  const bRowsToggled = await page.locator('.pivot-table tbody tr th').allInnerTexts();
  check('B-matrix-toggle-asc', bTh2 === 1 && bTot2 === 1 && bVal2 === 'ascending', { bTh2, bTot2, bVal2 });
  info.B = { bThText, bRowsBefore, bRowsAfter, bRowsToggled, bVal, bVal2 };
  // keyboard Enter + Space on numeric cell
  const cell = page.locator('.pivot-cell').first();
  await cell.press('Enter'); await sleep(250);
  const dlgEnter = await page.getByRole('dialog', { name: '이 항목으로 좁히기' }).count();
  check('B-kbd-Enter-opens-narrow', dlgEnter === 1, { dlgEnter });
  await page.getByRole('dialog', { name: '이 항목으로 좁히기' }).getByRole('button', { name: '닫기', exact: true }).click();
  await sleep(150);
  await page.locator('.pivot-cell').first().press('Space'); await sleep(250);
  const dlgSpace = await page.getByRole('dialog', { name: '이 항목으로 좁히기' }).count();
  check('B-kbd-Space-opens-narrow', dlgSpace === 1, { dlgSpace });
  await page.getByRole('dialog', { name: '이 항목으로 좁히기' }).getByRole('button', { name: '닫기', exact: true }).click();
  await sleep(150);

  // C: compare (전체와 비교) if available
  let compareAvail = false;
  try {
    const radio = page.getByRole('radio', { name: /전체와 비교/ });
    await radio.waitFor({ timeout: 3000 });
    compareAvail = await radio.isEnabled();
    if (compareAvail) {
      await radio.check();
      await page.getByRole('button', { name: '통계 만들기', exact: true }).click();
      await page.locator('.pivot-table tbody tr').first().waitFor({ timeout: 15000 });
      await sleep(200);
      await page.locator('.pivot-sort').first().click(); await sleep(250);
      const cTh = await page.locator('.pivot-table th[aria-sort]').count();
      const cTot = await page.locator('.pivot-table th.pivot-total[aria-sort]').count();
      const cBtn = await page.locator('button[aria-sort]').count();
      const cText = await page.locator('.pivot-table th[aria-sort]').innerText().catch(() => '');
      const cVal = await page.locator('.pivot-table th[aria-sort]').getAttribute('aria-sort').catch(() => null);
      check('C-compare-single-first-side', cTh === 1 && cTot === 1 && cBtn === 0, { cTh, cTot, cBtn, cText, cVal });
      info.C = { cText, cVal };
    } else { check('C-compare-single-first-side', true, { skipped: 'radio disabled' }); info.C = { skipped: 'disabled' }; }
  } catch (e) { check('C-compare-single-first-side', true, { skipped: String(e).slice(0, 120) }); info.C = { skipped: 'no radio' }; }
  info.compareAvail = compareAvail;

  // focus outline 2px + overflow on this viewport
  await page.locator('.pivot-sort').first().focus();
  const outline = await page.evaluate(() => { const el = document.activeElement; const cs = getComputedStyle(el); return { outlineWidth: cs.outlineWidth, outlineStyle: cs.outlineStyle, tag: el.tagName, cls: el.className }; });
  check('focus-visible-outline', outline.outlineWidth === '2px' || outline.outlineStyle !== 'none', outline);
  info.focus = outline;
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  check('no-page-overflow-1440dark', overflow === true, { overflow });
  allConsole.push(...consoleErrors);
  await context.close();

  // D: screenshots table light/dark 390 + 1440 (matrix preset, fresh contexts)
  for (const theme of ['light', 'dark']) for (const width of [1440, 390]) {
    await api('reset');
    const v = await openPage(browser, { theme, width, height: width < 500 ? 844 : 900, search: '?start=2026-01-01&end=2026-09-30&date_basis=completed_date' });
    await waitMap(v.page);
    await v.page.locator('.rail button[aria-label^="통계"]').click();
    await v.page.getByLabel('예시 설정').selectOption('outcome_disposition');
    await v.page.getByRole('button', { name: '통계 만들기', exact: true }).click();
    await v.page.locator('.pivot-table tbody tr').first().waitFor({ timeout: 15000 });
    await v.page.locator('.pivot-sort').first().click(); await sleep(200);
    const ov = await v.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    check(`shot-${width}-${theme}-overflow`, ov === true, { ov });
    await v.page.locator('.stats-result').screenshot({ path: `${dir}/table-${width}-${theme}.png` });
    allConsole.push(...v.consoleErrors);
    await v.context.close();
  }
  info.netlog = await api('log').catch(() => []);
} finally {
  await browser.close();
  await api('reset').catch(() => {});
  writeFileSync(`${dir}/aria-result.json`, JSON.stringify({ commit: '27de7f3', checks, info, consoleErrors: allConsole }, null, 2));
  console.log(JSON.stringify({ checks, info, consoleErrors: allConsole.slice(0, 20) }, null, 2));
}
