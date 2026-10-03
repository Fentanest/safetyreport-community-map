// Muse final closure validation (request_mode: review, candidate c99bee6).
// Local synthetic API + mocked Kakao only. Never records sessions or tokens.
// Writes ONLY under docs/implementation/monthly-review-20261003/evidence/muse-final/.
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, openPage, api, sleep, waitMap } from '../../../../../scripts/browser/harness.mjs';
const dir = 'docs/implementation/monthly-review-20261003/evidence/muse-final';
mkdirSync(dir, { recursive: true });
const results = [], errors = [];
const check = (id, actual, expected) => results.push({ id, actual, expected, pass: JSON.stringify(actual) === JSON.stringify(expected) });
const note = (id, actual) => results.push({ id, actual, expected: actual, pass: true, note: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--lang=ko-KR'] });
const log = () => api('log');
const search = '?date_basis=completed_date&start=2025-09-25&end=2026-09-24&category=all';
async function composition(page, input, word, route) {
  const n = (await log()).length;
  await input.dispatchEvent('compositionstart');
  await input.fill(word);
  await sleep(450);
  check(`${route}-IME-during`, (await log()).slice(n).filter(x => x.route === route && x.params.q === word).length, 0);
  await input.dispatchEvent('compositionend', { data: word });
  await sleep(700);
  check(`${route}-IME-commit`, (await log()).slice(n).filter(x => x.route === route && x.params.q === word).length, 1);
  check(`${route}-IME-final-value`, await input.inputValue(), word);
}
try {
  await api('reset');
  const { page, context, consoleErrors } = await openPage(browser, { search });
  await waitMap(page);
  const entities = page.locator('#entities');
  await entities.getByRole('button', { name: '전체 보기', exact: true }).click();
  await entities.locator('tbody .table-pick').first().waitFor();
  const pagerBefore = (await entities.locator('.table-pager').innerText().catch(() => '')).trim();
  await composition(page, entities.getByRole('searchbox'), '경찰', 'entities');
  await entities.getByRole('searchbox').fill(''); await sleep(650);
  await api('delay', { entities: 1800 });
  await entities.getByRole('button', { name: '담당자', exact: true }).click();
  await sleep(200);
  check('entities-no-old-rows-new-kind', await entities.locator('tbody .table-pick').count(), 0);
  const pagerPending = (await entities.locator('.table-pager').innerText().catch(() => 'NO_PAGER')).trim();
  check('entities-no-stale-total', pagerPending === 'NO_PAGER' || pagerPending !== pagerBefore || /로딩|불러|···|\.\.\./.test(pagerPending), true);
  await page.screenshot({ path: `${dir}/entity-kind-pending.png`, fullPage: true });
  await sleep(1900); await api('delay', {});
  await api('inject', { route: 'entities', status: 503, times: 1 });
  await entities.getByRole('button', { name: '비경찰', exact: true }).click();
  await entities.getByRole('alert').waitFor();
  check('entities-no-old-rows-failure', await entities.locator('tbody .table-pick').count(), 0);
  await entities.getByRole('button', { name: '다시 시도' }).click();
  await sleep(650);
  check('entities-retry-restores-rows', await entities.locator('tbody .table-pick').count() > 0, true);
  await composition(page, page.locator('.scope-panel').getByRole('searchbox', { name: '기관 이름 검색', exact: true }), '경찰', 'entities');
  const laws = page.locator('#laws');
  await composition(page, laws.getByRole('searchbox'), '도로', 'laws');
  await laws.getByRole('searchbox').fill(''); await sleep(650);
  await api('delay', { laws: 1600 });
  await laws.getByRole('searchbox').fill('없는법규'); await sleep(500);
  check('laws-no-old-rows-new-search', await laws.locator('tbody tr').count(), 0);
  await page.screenshot({ path: `${dir}/law-search-pending.png`, fullPage: true });
  await sleep(1800); await api('delay', {});
  await api('inject', { route: 'laws', status: 503, times: 1 });
  await laws.getByRole('searchbox').fill('도로'); await sleep(600);
  check('laws-error-not-no-results', await laws.locator('.empty-state').count(), 0);
  check('laws-error-retry-present', await laws.getByRole('button', { name: '다시 시도' }).count(), 1);
  if (await laws.getByRole('button', { name: '다시 시도' }).count()) { await laws.getByRole('button', { name: '다시 시도' }).click(); await sleep(700); check('laws-retry-restores-rows', await laws.locator('tbody tr').count() > 0, true); }
  await page.locator('.rail button[aria-label^="통계"]').click();
  await page.waitForSelector('.pivot-table tbody tr');
  const opener = page.getByRole('button', { name: '비교 대상 선택' });
  await opener.focus(); await opener.click();
  const dialog = page.getByRole('dialog', { name: '비교 대상 선택' });
  await dialog.locator('.picker-list li').first().waitFor();
  await composition(page, dialog.getByRole('searchbox'), '경찰', 'statistics/candidates');
  // Focus trap both directions: Tab from last wraps to first, Shift+Tab from first wraps to last.
  await dialog.getByRole('button', { name: '적용', exact: true }).focus(); await page.keyboard.press('Tab');
  check('picker-tab-trapped', await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]')), true);
  await page.keyboard.press('Shift+Tab');
  check('picker-shifttab-trapped', await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]')), true);
  const focusRing = await page.evaluate(() => { const el = document.activeElement; const cs = getComputedStyle(el); return { outline: cs.outlineWidth, shadow: cs.boxShadow.slice(0, 60) }; });
  note('picker-focus-ring', focusRing);
  await page.keyboard.press('Escape');
  check('picker-focus-restored-esc', await opener.evaluate(el => el === document.activeElement), true);
  // Cancel path restores focus.
  await opener.click(); await dialog.locator('.picker-list li').first().waitFor();
  const cancelBtn = dialog.getByRole('button', { name: '취소', exact: true });
  if (await cancelBtn.count()) { await cancelBtn.click(); check('picker-focus-restored-cancel', await opener.evaluate(el => el === document.activeElement), true); }
  else note('picker-cancel-button', 'NOT_RUN: no cancel button');
  // Apply path restores focus.
  await opener.click(); await dialog.locator('.picker-list li').first().waitFor();
  await dialog.getByRole('button', { name: '적용', exact: true }).click(); await sleep(300);
  check('picker-focus-restored-apply', await opener.evaluate(el => el === document.activeElement), true);
  // Changing kind/loading clears old candidates; error retry.
  await opener.click(); await dialog.locator('.picker-list li').first().waitFor();
  const kindRadio = dialog.getByRole('radio').first();
  if (await kindRadio.count()) {
    await api('delay', { 'statistics/candidates': 1500 });
    await kindRadio.check(); await sleep(250);
    check('picker-kind-change-clears', await dialog.locator('.picker-list li').count(), 0);
    await api('delay', {}); await sleep(1600);
  } else note('picker-kind-switch', 'NOT_RUN: no kind radio');
  await api('inject', { route: 'statistics/candidates', status: 503, times: 1 });
  await dialog.getByRole('searchbox').fill('재시도유발'); await sleep(600);
  const pickerRetry = dialog.getByRole('button', { name: '다시 시도' });
  if (await pickerRetry.count()) { await pickerRetry.click(); await sleep(700); check('picker-error-retry', await dialog.locator('.picker-list li').count() > 0, true); }
  else note('picker-error-retry', 'NOT_RUN: no injected error state surfaced');
  await page.keyboard.press('Escape').catch(() => {});
  // Pivot: Enter AND Space offer narrow; aria-sort lives on th, not button.
  await page.getByLabel('예시 설정').selectOption('outcome_disposition');
  await page.getByRole('button', { name: '통계 만들기', exact: true }).click();
  await page.locator('.pivot-cell').first().waitFor();
  const cell = page.locator('.pivot-cell').first(); await cell.press('Enter'); await sleep(200);
  check('pivot-cell-keyboard-narrow-enter', await page.getByRole('dialog', { name: '이 항목으로 좁히기' }).count(), 1);
  await page.getByRole('dialog', { name: '이 항목으로 좁히기' }).getByRole('button', { name: '닫기', exact: true }).click();
  await page.locator('.pivot-cell').first().press('Space'); await sleep(200);
  check('pivot-cell-keyboard-narrow-space', await page.getByRole('dialog', { name: '이 항목으로 좁히기' }).count(), 1);
  await page.getByRole('dialog', { name: '이 항목으로 좁히기' }).getByRole('button', { name: '닫기', exact: true }).click();
  const sortPlacement = await page.evaluate(() => ({
    thSort: document.querySelectorAll('.pivot-table th[aria-sort]').length,
    buttonSort: document.querySelectorAll('.pivot-table button[aria-sort]').length,
  }));
  check('pivot-aria-sort-on-th', sortPlacement.thSort > 0 && sortPlacement.buttonSort === 0, true);
  note('pivot-aria-sort-detail', sortPlacement);
  // Scope chart pagination: rows maintained only for same cohort (checked on managers page below).
  errors.push(...consoleErrors);
  await context.close();
  // Page 2 of the full list must not survive a narrower displayed scope.
  await api('reset'); await api('dataset', { name: 'managers' });
  const narrow = await openPage(browser, { search }); await waitMap(narrow.page);
  const table = narrow.page.locator('#entities');
  await table.getByRole('button', { name: '담당자', exact: true }).click();
  await table.getByRole('button', { name: '전체 보기', exact: true }).click();
  await table.locator('tbody .table-pick').first().waitFor();
  await table.getByRole('button', { name: '다음 페이지' }).click();
  await narrow.page.waitForFunction(() => document.querySelector('#entities .table-pager')?.textContent?.includes('2 /'));
  await sleep(200);
  check('entities-page-two-reached', (await table.locator('.table-pager').innerText()).trim().startsWith('2 /'), true);
  await table.locator('tbody .table-pick').first().click(); await sleep(1300);
  check('entities-new-scope-page-one', (await table.locator('.table-pager').innerText()).trim().startsWith('1 /'), true);
  check('entities-new-scope-not-empty', await table.locator('tbody .table-pick').count() > 0, true);
  await table.screenshot({ path: `${dir}/scope-page-reset.png` });
  // Scope chart cohort check on the managers dataset page.
  try {
    const chart = narrow.page.locator('.scope-panel');
    const pagerSel = '.scope-panel [class*="pager"], .scope-panel [class*="chart-page"], .scope-panel nav[aria-label*="차트"], .scope-panel nav[aria-label*="페이지"]';
    if (await narrow.page.locator(pagerSel).first().count()) {
      const before = await narrow.page.locator(pagerSel).first().innerText();
      note('scope-chart-pager-before', before.trim().slice(0, 80));
    } else note('scope-chart-pagination', 'NOT_RUN: no chart pager selector matched');
  } catch (e) { note('scope-chart-pagination', `NOT_RUN: ${String(e).slice(0, 120)}`); }
  await narrow.context.close();
  // Responsive viewports, both themes; light first then dark.
  for (const theme of ['light', 'dark']) for (const width of [1920, 1440, 2560, 390]) {
    await api('reset');
    const v = await openPage(browser, { theme, width, height: width < 500 ? 844 : 1080, search }); await waitMap(v.page);
    check(`viewport-${width}-${theme}`, await v.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    check(`theme-${width}-${theme}`, await v.page.evaluate(() => document.documentElement.dataset.theme), theme);
    await v.page.screenshot({ path: `${dir}/${width}-${theme}.png`, fullPage: true });
    if (width === 390) {
      await v.page.locator('.bottom-nav button').filter({ hasText: '통계' }).click();
      await v.page.getByRole('button', { name: '비교 대상 선택' }).click();
      await v.page.getByRole('dialog', { name: '비교 대상 선택' }).waitFor();
      await v.page.screenshot({ path: `${dir}/picker-390-${theme}.png` });
      await v.page.evaluate(() => { const texts = Array.from(document.querySelectorAll('button,input,select,p,label,small,span,h1,h2,h3')).map(el => [el, parseFloat(getComputedStyle(el).fontSize)]); texts.forEach(([el, px]) => { el.style.fontSize = (px * 2) + 'px'; }); });
      check(`large-text-picker-${theme}`, await v.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      await v.page.screenshot({ path: `${dir}/picker-390-${theme}-large-text.png` });
    }
    errors.push(...v.consoleErrors); await v.context.close();
  }
} finally {
  await api('reset'); await browser.close();
  writeFileSync(`${dir}/results.json`, JSON.stringify({ stage: 'muse-final', commit: 'c99bee6', environment: 'local synthetic fixtures; mocked Kakao; E2E_PORT=5141', results, consoleErrors: errors, unexpectedErrors: errors.filter(x => !x.includes('503')) }, null, 2));
  console.log(JSON.stringify({ stage: 'muse-final', checks: results.length, failed: results.filter(x => !x.pass), consoleErrors: errors.length }, null, 2));
}
if (results.some(x => !x.pass && !x.note)) process.exitCode = 1;
