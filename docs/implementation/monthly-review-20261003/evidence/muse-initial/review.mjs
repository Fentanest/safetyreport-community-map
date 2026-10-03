// Monthly UI review (Muse contributor, review-only): real browser over the LOCAL e2e
// fixture on :5140 (root-owned server, fixed commit 49c4c6d). Writes ONLY to its own
// directory (shots/, results.json). Never prints/saves JWTs.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, openPage, waitMap, api, sleep } from '../../../../../scripts/browser/harness.mjs';

const EV = dirname(fileURLToPath(import.meta.url));
mkdirSync(join(EV, 'shots'), { recursive: true });
const OUT = { started: new Date().toISOString(), commit: '49c4c6d', steps: [], issues: [], console: {}, network: {} };
const note = (id, ok, detail) => { OUT.steps.push({ id, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${detail ?? ''}`); };
const issue = (id, severity, repro, expected, actual, evidence, fileHint) =>
  OUT.issues.push({ id, severity, repro, expected, actual, evidence, fileHint });
const shot = (page, name) => page.screenshot({ path: join(EV, 'shots', `${name}.png`) });
const waitFor = async (fn, pred, timeout = 8000) => {
  const t0 = Date.now();
  for (;;) { const v = await fn().catch(() => undefined);
    try { if (pred(v)) return v; } catch {}
    if (Date.now() - t0 > timeout) return v; await sleep(150); }
};
const allConsole = [];
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--lang=ko-KR', '--no-sandbox'] });

async function fresh(opts = {}) {
  await api('reset');
  const s = await openPage(browser, { locale: 'ko-KR', height: 1000, ...opts });
  s.page.on('console', (m) => { if (m.type() === 'error') allConsole.push(`[${opts.width ?? 1440}/${opts.theme ?? 'dark'}] ${m.text()}`); });
  s.page.on('pageerror', (e) => allConsole.push(`[pageerror] ${e.message}`));
  await waitMap(s.page);
  await s.page.waitForSelector('.kpi-strip .kpi-row', { timeout: 20000 }).catch(() => {});
  await sleep(700);
  return s;
}
const logRoutes = async () => { const l = await api('log'); const m = {}; for (const e of l) m[e.route] = (m[e.route] || 0) + 1; return m; };

try {
  // ── R1: desktop 1920 dark baseline + sections ──
  {
    const { page, context } = await fresh({ width: 1920, height: 1080, theme: 'dark' });
    await shot(page, 'R1-1920-dark-top');
    for (const id of ['laws', 'entities', 'analytics', 'regions']) {
      const el = page.locator(`#${id}`);
      if (await el.count()) { await el.scrollIntoViewIfNeeded(); await sleep(400); await shot(page, `R1-1920-dark-${id}`); }
    }
    note('R1', true, '1920 dark sections captured');
    await context.close();
  }
  // ── R2: 1440 / 2560 / light + mobile shots ──
  for (const [w, h, th] of [[1440, 900, 'dark'], [2560, 1440, 'dark'], [1920, 1080, 'light'], [1440, 900, 'light']]) {
    const { page, context } = await fresh({ width: w, height: Math.min(h, 1100), theme: th });
    await shot(page, `R2-${w}-${th}-top`);
    await page.locator('#entities').scrollIntoViewIfNeeded().catch(() => {});
    await sleep(300); await shot(page, `R2-${w}-${th}-entities`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    note(`R2-${w}-${th}`, !overflow, overflow ? 'HORIZONTAL OVERFLOW' : 'no page-x-overflow');
    if (overflow) issue(`R-OVERFLOW-${w}-${th}`, 'medium', `load dashboard @${w} ${th}`, 'no horizontal page scroll', 'document scrolls horizontally', `R2-${w}-${th}-entities.png`, 'src/styles/*.css');
    await context.close();
  }
  for (const [w, h, th] of [[390, 844, 'dark'], [390, 844, 'light'], [360, 740, 'dark']]) {
    const { page, context } = await fresh({ width: w, height: h, theme: th });
    await shot(page, `R2-${w}-${th}-top`);
    await page.locator('#entities').scrollIntoViewIfNeeded().catch(() => {});
    await sleep(300); await shot(page, `R2-${w}-${th}-entities`);
    const nav = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('.bottom-nav button')];
      const r = document.querySelector('.bottom-nav')?.getBoundingClientRect();
      return { n: btns.length, labels: btns.map((b) => b.textContent.trim()), widths: btns.map((b) => Math.round(b.getBoundingClientRect().width)), navOverflow: (r?.width ?? 0) > innerWidth + 1, pageOverflow: document.documentElement.scrollWidth > innerWidth + 1 };
    });
    note(`R2-nav-${w}-${th}`, true, `${nav.n} tabs widths=${nav.widths.join('/')} pageOverflow=${nav.pageOverflow}`);
    if (nav.n !== 7) issue('R-NAV-COUNT', 'high', `mobile @${w}`, 'bottom nav tabs', `found ${nav.n}`, `R2-${w}-${th}-top.png`, 'src/components/Rail.tsx');
    if (nav.pageOverflow) issue(`R-OVERFLOW-${w}`, 'medium', `dashboard @${w} ${th}`, 'no horizontal page scroll', 'page overflows horizontally', `R2-${w}-${th}-entities.png`, 'src/styles/app.css');
    OUT.steps.push({ id: `R2-navdetail-${w}-${th}`, ok: true, detail: JSON.stringify(nav) });
    await context.close();
  }

  // ── R3: period draft / apply / back + date basis ──
  {
    const { page, context } = await fresh({ width: 1440, height: 1000 });
    const kpi0 = await page.locator('.kpi-strip').innerText();
    const url0 = page.url();
    await page.locator('.command .control').first().click().catch(() => {});
    const pop = page.locator('.date-pop');
    const hasPop = await pop.count();
    if (hasPop) {
      await shot(page, 'R3-datepop');
      const start = pop.locator('input[type="date"]').first();
      await start.fill('2025-01-01');
      await sleep(500);
      const kpiDraft = await page.locator('.kpi-strip').innerText();
      note('R3-draft', kpiDraft === kpi0, kpiDraft === kpi0 ? 'draft does not move panels' : 'PANELS MOVED DURING DRAFT');
      if (kpiDraft !== kpi0) issue('R-DRAFT', 'high', 'edit start date without 적용', 'panels keep old numbers until 적용', 'panels changed during draft', 'R3-datepop.png', 'src/components/CommandBar.tsx');
      await pop.getByRole('button', { name: '적용' }).click();
      await sleep(1500);
      const url1 = page.url();
      note('R3-apply', url1 !== url0, `url changed: ${url1 !== url0}`);
      await shot(page, 'R3-applied');
      await page.goBack().catch(() => {});
      await sleep(1200);
      const backUrl = page.url();
      note('R3-back', true, `after back: ${backUrl === url0 ? 'restored' : 'NOT restored: ' + backUrl}`);
      if (backUrl !== url0) issue('R-BACK', 'low', '적용 후 browser back', 'previous period restored', backUrl, 'R3-applied.png', 'src/state/filters.ts');
    } else note('R3', false, 'date popover not found');
    const basis = page.locator('.command select[aria-label="날짜 기준"]');
    if (await basis.count()) {
      await basis.selectOption('report_date');
      await sleep(1500);
      await shot(page, 'R3-basis-report');
      const t = await page.locator('.trend-card').first().innerText().catch(() => '');
      note('R3-basis', true, `switched to 신고일; trend head: ${t.slice(0, 60).replace(/\n/g, ' ')}`);
      await basis.selectOption('completed_date');
      await sleep(1200);
    } else note('R3-basis', false, 'no basis select');
    await context.close();
  }

  // ── R4: entity table kind/search/sort/paging/columns ──
  {
    const { page, context } = await fresh({ width: 1440, height: 1000 });
    await page.locator('#entities').scrollIntoViewIfNeeded();
    const tab = async () => page.locator('#entities .kind-switch button.selected').innerText();
    note('R4-kind0', (await tab()) === '기관', 'default 기관');
    await page.locator('#entities .kind-switch button', { hasText: '담당자' }).click();
    await sleep(1200);
    const head1 = await page.locator('#entities thead').innerText();
    note('R4-kind1', head1.includes('담당자'), `manager header: ${head1.slice(0, 80).replace(/\n/g, '|')}`);
    await shot(page, 'R4-manager-tab');
    await page.locator('#entities input[type="search"]').pressSequentially('경찰', { delay: 80 });
    await sleep(900);
    const cap = await page.locator('#entities .table-caption').innerText();
    note('R4-search', true, `caption after search: ${cap.replace(/\n/g, ' ')}`);
    await shot(page, 'R4-search');
    const sorts = page.locator('#entities th button');
    const nSort = await sorts.count();
    if (nSort > 0) {
      const lbl = await sorts.first().innerText().catch(() => '');
      await sorts.first().click();
      await sleep(1000);
      const aria = await page.locator('#entities th[aria-sort]').count();
      note('R4-sort', true, `sortable cols>0 first="${lbl.slice(0, 30)}" aria-sort cells=${aria}`);
      await shot(page, 'R4-sorted');
    } else note('R4-sort', true, 'summary mode: headers not sortable (serverList off?)');
    const exp = page.locator('#entities').getByRole('button', { name: '전체 보기' });
    if (await exp.count()) {
      await exp.click();
      await page.waitForSelector('#entities .table-pager', { timeout: 10000 }).catch(() => {});
      await sleep(800);
      const pager0 = await page.locator('#entities .table-pager').innerText().catch(() => 'no-pager');
      const next = page.locator('#entities').getByRole('button', { name: '다음 페이지' });
      if (await next.count() && await next.isEnabled()) {
        await next.click(); await sleep(1200);
        const pager1 = await page.locator('#entities .table-pager').innerText().catch(() => '');
        note('R4-paging', pager1 !== pager0, `${pager0.replace(/\n/g, ' ')} → ${pager1.replace(/\n/g, ' ')}`);
      } else note('R4-paging', true, `single page (${pager0.replace(/\n/g, ' ')})`);
      await shot(page, 'R4-expanded');
    } else note('R4-expand', true, 'no 전체 보기 (serverList off in fixture?)');
    const colBtn = page.locator('#entities').getByRole('button', { name: '열 선택' });
    if (await colBtn.count()) {
      await colBtn.click(); await sleep(300);
      await shot(page, 'R4-colpicker');
      await page.keyboard.press('Escape'); await sleep(300);
      note('R4-colpicker', (await page.locator('#entity-col-menu').count()) === 0, 'esc closes col menu');
    }
    await context.close();
  }

  // ── R5: delayed entities — old rows under new headers? (priority) ──
  {
    const { page, context } = await fresh({ width: 1440, height: 1000 });
    await page.locator('#entities').scrollIntoViewIfNeeded();
    const exp = page.locator('#entities').getByRole('button', { name: '전체 보기' });
    if (await exp.count()) {
      await exp.click();
      await page.waitForSelector('#entities .table-pager', { timeout: 10000 }).catch(() => {});
      await sleep(800);
      await api('delay', { entities: 2500 });
      const rowsBefore = await page.locator('#entities tbody tr td:first-child').allInnerTexts();
      await page.locator('#entities .kind-switch button', { hasText: '담당자' }).click();
      await sleep(600);
      const midHead = await page.locator('#entities thead').innerText();
      const midRows = await page.locator('#entities tbody tr td:first-child').allInnerTexts();
      const stale = midRows.length > 0 && midRows.join('|') === rowsBefore.join('|');
      await shot(page, 'R5-stale-midload');
      note('R5-stale', !stale, stale ? 'OLD ROWS UNDER NEW HEADERS (agency rows, manager header)' : 'rows cleared/loading during switch');
      if (stale) issue('R-STALE-ROWS', 'medium', '전체 보기 + delay(entities 2.5s) + 기관→담당자', 'loading state, not old-kind rows under new headers', 'previous kind rows kept under new headers', 'R5-stale-midload.png', 'src/components/EntityTable.tsx:165');
      await waitFor(async () => (await page.locator('#entities .table-pager').innerText().catch(() => '')), () => true, 6000);
      await api('delay', {});
      await sleep(500);
      OUT.steps.push({ id: 'R5-midhead', ok: true, detail: midHead.slice(0, 120).replace(/\n/g, '|') });
    } else note('R5', false, 'no 전체 보기; cannot test stale rows');
    await context.close();
  }

  // ── R6: page out of bounds after scope change ──
  {
    const { page, context } = await fresh({ width: 1440, height: 1000 });
    await page.locator('#entities').scrollIntoViewIfNeeded();
    const exp = page.locator('#entities').getByRole('button', { name: '전체 보기' });
    if (await exp.count()) {
      await exp.click();
      await page.waitForSelector('#entities .table-pager', { timeout: 10000 }).catch(() => {});
      await sleep(800);
      const next = page.locator('#entities').getByRole('button', { name: '다음 페이지' });
      let adv = 0;
      while (await next.count() && await next.isEnabled() && adv < 4) { await next.click(); await sleep(900); adv++; }
      const pagerBefore = await page.locator('#entities .table-pager').innerText().catch(() => '');
      const sel = page.locator('.top-region select').first();
      let scopeNote = 'no region select';
      if (await sel.count()) {
        await sel.selectOption('49');
        await sleep(1800);
        scopeNote = 'region→49 제주';
      }
      const pagerAfter = await page.locator('#entities .table-pager').innerText().catch(() => 'no-pager');
      const emptyMsg = await page.locator('#entities .table-empty').innerText().catch(() => '');
      await shot(page, 'R6-oob');
      const m = /(\d+)\s*\/\s*(\d+)쪽/.exec(pagerAfter);
      const oob = m && Number(m[1]) > Number(m[2]);
      note('R6-oob', !oob, `before="${pagerBefore.replace(/\n/g, ' ')}" ${scopeNote} after="${pagerAfter.replace(/\n/g, ' ')}" empty="${emptyMsg.slice(0, 40)}"`);
      if (oob) issue('R-PAGE-OOB', 'medium', 'entities page N + scope narrows total below N', 'page clamps to 1/last with rows', `pager shows ${pagerAfter} (current beyond bounds)`, 'R6-oob.png', 'src/components/EntityTable.tsx (no scopeKey page reset, cf LawTable.tsx:40)');
    } else note('R6', false, 'no 전체 보기');
    await context.close();
  }

  // ── R7: laws table search/sort + delayed ──
  {
    const { page, context } = await fresh({ width: 1440, height: 1000 });
    await page.locator('#laws').scrollIntoViewIfNeeded(); await sleep(400);
    await shot(page, 'R7-laws');
    const inp = page.locator('#laws input[type="search"]');
    if (await inp.count()) {
      await inp.pressSequentially('도로교통', { delay: 80 });
      await sleep(1000);
      const cap = await page.locator('#laws caption').innerText().catch(() => '');
      note('R7-lawsearch', true, cap.replace(/\n/g, ' ').slice(0, 100));
      await shot(page, 'R7-lawsearch');
      await api('delay', { laws: 2000, dashboard: 2000 });
      await page.locator('.top-region select').first().selectOption('11').catch(() => {});
      await sleep(600);
      await shot(page, 'R7-laws-midload');
      await api('delay', {}); await sleep(2500);
      const cap2 = await page.locator('#laws caption').innerText().catch(() => '');
      note('R7-lawdelay', true, `after scope change: ${cap2.replace(/\n/g, ' ').slice(0, 100)}`);
    } else note('R7', true, 'laws summary w/o search (serverList off?)');
    await context.close();
  }

  // ── R8: scope + place panels, copy buttons ──
  {
    const { page, context } = await fresh({ width: 1440, height: 1000 });
    await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    const panel = page.locator('.scope-panel');
    note('R8-scope', (await panel.count()) > 0, `scope h2="${await panel.locator('.place-head h2').innerText().catch(() => '?')}"`);
    await shot(page, 'R8-scope-nation');
    await page.evaluate(() => { const m = window.__kakaoMaps[window.__kakaoMaps.length - 1]; m.setCenter(new kakao.maps.LatLng(37.55, 126.99)); m.setLevel(5); });
    await waitFor(async () => page.evaluate(() => window.__kakaoLiveMarkers().filter((m) => !m.title.includes('묶음')).length), (n) => n >= 3, 10000);
    const title = await page.evaluate(() => { const ms = window.__kakaoLiveMarkers().filter((m) => !m.title.includes('묶음')).sort((a, b) => a.title.localeCompare(b.title)); ms[0].marker.__click(); return ms[0].title; });
    await sleep(1200);
    const pp = page.locator('.place-panel');
    note('R8-place', (await pp.count()) > 0, `pin "${title.slice(0, 40)}" → place panel ${await pp.count() ? 'open' : 'MISSING'}`);
    await shot(page, 'R8-place');
    const copyBtns = pp.getByRole('button', { name: /복사/ });
    const nCopy = await copyBtns.count();
    let clip = 'no-copy-buttons';
    if (nCopy > 0) {
      await copyBtns.first().click(); await sleep(600);
      clip = await page.evaluate(async () => { try { return (await navigator.clipboard.readText()).slice(0, 60); } catch (e) { return 'CLIPBOARD_READ_DENIED:' + e; } });
      const focusAfter = await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 120));
      OUT.steps.push({ id: 'R8-copyfocus', ok: true, detail: `clipboard="${clip}" focusAfter=${focusAfter}` });
      await shot(page, 'R8-copied');
    }
    note('R8-copy', true, `copy buttons=${nCopy} clipboard="${clip}"`);
    await context.close();
  }

  // ── R9: trend chart toggles + manager namesakes ──
  {
    await api('dataset', { name: 'managers' });
    const { page, context } = await fresh({ width: 1440, height: 1000 });
    const card = page.locator('.trend-card');
    await card.scrollIntoViewIfNeeded(); await sleep(400);
    await card.getByRole('button', { name: '처리결과 비율' }).click().catch(() => {});
    await sleep(800);
    await shot(page, 'R9-trend-rate');
    const same = await page.evaluate(() => document.body.innerText.includes('동명이인') || document.body.innerText.includes('같은 이름'));
    note('R9-namesake', true, `namesake note present=${same}`);
    if (!same) issue('R-NAMESAKE', 'low', 'managers dataset, manager rows', 'same-name managers get a disambiguation note', 'no 동명이인 note found', 'R9-trend-rate.png', 'src/components/EntityMetricRow.tsx');
    await page.locator('#entities').scrollIntoViewIfNeeded(); await sleep(300);
    await shot(page, 'R9-managers-dataset-entities');
    await api('dataset', { name: 'synthetic' });
    await context.close();
  }

  // ── R10: statistics member picker — keyboard/modal/IME/paging/export (priority) ──
  {
    const { page, context } = await fresh({ width: 1440, height: 1000 });
    await page.locator('.rail button[aria-label^="통계"]').click();
    await page.waitForSelector('.pivot-table tbody tr', { timeout: 15000 }).catch(() => {});
    await shot(page, 'R10-stats');
    await page.getByRole('button', { name: '비교 대상 선택' }).click();
    const dlg = page.getByRole('dialog', { name: '비교 대상 선택' });
    await dlg.locator('.picker-list li').first().waitFor({ timeout: 10000 }).catch(() => {});
    await sleep(500);
    await shot(page, 'R10-picker');
    const labelled = await page.evaluate(() => { const d = document.querySelector('.picker'); return { role: d?.getAttribute('role'), modal: d?.getAttribute('aria-modal'), labelledby: d?.getAttribute('aria-labelledby') }; });
    note('R10-dialog', labelled.role === 'dialog' && labelled.modal === 'true', JSON.stringify(labelled));
    await page.locator('.picker-search input').first().focus().catch(() => {});
    let leaked = false;
    for (let i = 0; i < 14; i++) { await page.keyboard.press('Tab'); await sleep(60);
      const inside = await page.evaluate(() => !!document.activeElement?.closest('.picker'));
      if (!inside) { leaked = true; break; } }
    note('R10-focus', !leaked, leaked ? 'TAB LEAKED OUT OF DIALOG' : 'tab stayed in dialog (14 tabs)');
    if (leaked) issue('R-PICKER-FOCUS', 'medium', 'picker open, press Tab repeatedly', 'focus stays in aria-modal dialog', 'focus escaped to background', 'R10-picker.png', 'src/components/stats/MemberPicker.tsx (no focus trap)');
    await shot(page, 'R10-picker-tabbed');
    await page.evaluate(() => { document.querySelector('.picker-search input')?.focus(); return true; });
    await page.keyboard.press('Escape'); await sleep(400);
    const closed = await dlg.count() === 0;
    const focusBack = await page.evaluate(() => document.activeElement?.textContent?.slice(0, 40) ?? document.activeElement?.tagName);
    note('R10-esc', closed, `closed=${closed} focusAfter=${focusBack}`);
    if (closed && !/비교 대상 선택/.test(focusBack ?? '')) issue('R-PICKER-ESC-FOCUS', 'low', 'Esc closes picker', 'focus returns to 비교 대상 선택 trigger', `focus on ${focusBack}`, 'R10-picker.png', 'src/components/stats/MemberPicker.tsx:98-107');
    await page.getByRole('button', { name: '비교 대상 선택' }).click();
    await page.getByRole('dialog', { name: '비교 대상 선택' }).locator('.picker-list li').first().waitFor({ timeout: 10000 }).catch(() => {});
    const n0 = (await api('log')).length;
    await page.evaluate(() => {
      const input = document.querySelector('.picker-search input');
      input.focus();
      input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      const setVal = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setVal.call(input, '경찰');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: '경찰' }));
    });
    await sleep(900);
    const duringComp = (await api('log')).length - n0;
    await page.evaluate(() => {
      const input = document.querySelector('.picker-search input');
      input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '경찰' }));
    });
    await sleep(900);
    const afterComp = (await api('log')).length - n0;
    note('R10-ime', duringComp === 0 && afterComp >= 1, `reqs during composition=${duringComp} after commit=${afterComp}`);
    if (!(duringComp === 0 && afterComp >= 1)) issue('R-PICKER-IME', 'medium', 'type during IME composition in picker search', 'no request until compositionend commit', `during=${duringComp} after=${afterComp}`, 'R10-picker.png', 'src/components/stats/MemberPicker.tsx:68-72');
    await shot(page, 'R10-picker-search');
    const nextBtn = page.getByRole('dialog', { name: '비교 대상 선택' }).getByRole('button', { name: '다음' });
    if (await nextBtn.count() && await nextBtn.isEnabled()) {
      const range0 = await page.locator('.place-more .cm-muted').first().innerText().catch(() => '');
      await nextBtn.click(); await sleep(1000);
      const range1 = await page.locator('.place-more .cm-muted').first().innerText().catch(() => '');
      note('R10-paging', range0 !== range1, `${range0} → ${range1}`);
    } else note('R10-paging', true, 'single page (next disabled)');
    const boxes = page.getByRole('dialog', { name: '비교 대상 선택' }).locator('.picker-list input[type=checkbox]');
    if (await boxes.count()) { await boxes.nth(0).check(); await sleep(300); }
    await shot(page, 'R10-picker-checked');
    await page.getByRole('dialog', { name: '비교 대상 선택' }).getByRole('button', { name: '적용', exact: true }).click();
    await sleep(600);
    const chips = await page.locator('.stats-builder .stats-chips').nth(1).innerText().catch(() => '');
    note('R10-apply', true, `chips: ${chips.replace(/\n/g, ' ').slice(0, 80)}`);
    const expBtn = page.locator('.stats-result').getByRole('button', { name: /내보내기|다운로드|Excel|CSV/ });
    const nExp = await expBtn.count();
    const runBtn = page.locator('.stats-run .primary-button');
    note('R10-export', true, `export buttons=${nExp} runBtn="${await runBtn.innerText().catch(() => '?')}"`);
    await shot(page, 'R10-after-apply');
    await context.close();
  }

  // ── R11: network/console summary (excluding injected faults) ──
  OUT.network = await logRoutes();
  OUT.console.errors = allConsole;
  note('R11', true, `routes=${JSON.stringify(OUT.network)} consoleErrors=${allConsole.length}`);
} finally {
  await browser.close();
  OUT.finished = new Date().toISOString();
  writeFileSync(join(EV, 'results.json'), JSON.stringify(OUT, null, 2));
  console.log(`wrote results.json with ${OUT.steps.length} steps, ${OUT.issues.length} issues`);
}
