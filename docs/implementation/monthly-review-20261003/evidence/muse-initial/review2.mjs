// Monthly review part 2: R5b (stale-row disambiguation), R6 (page OOB, fixed),
// R7 (laws), R8 (place/copy), R9 (trend/namesakes), R10 (picker), R11 (summary).
// Same constraints as review.mjs: approved dir only, no JWT printing.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, openPage, waitMap, api, sleep } from '../../../../../scripts/browser/harness.mjs';

const EV = dirname(fileURLToPath(import.meta.url));
mkdirSync(join(EV, 'shots'), { recursive: true });
const OUT = { started: new Date().toISOString(), commit: '49c4c6d', steps: [], issues: [] };
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
const guard = async (id, fn) => { try { await fn(); } catch (e) { note(id, false, String(e?.message ?? e).split('\n')[0].slice(0, 220)); } };

async function fresh(opts = {}) {
  await api('reset');
  const s = await openPage(browser, { locale: 'ko-KR', height: 1000, ...opts });
  s.page.on('console', (m) => { if (m.type() === 'error') allConsole.push(`[p2/${opts.width ?? 1440}] ${m.text()}`); });
  s.page.on('pageerror', (e) => allConsole.push(`[pageerror] ${e.message}`));
  await waitMap(s.page);
  await s.page.waitForSelector('.kpi-strip .kpi-row', { timeout: 20000 }).catch(() => {});
  await sleep(700);
  return s;
}

try {
  await guard('R5b', async () => {
    const { page, context } = await fresh({ width: 1440, height: 1000 });
    await page.locator('#entities').scrollIntoViewIfNeeded();
    await page.locator('#entities').getByRole('button', { name: '전체 보기' }).click();
    await page.waitForSelector('#entities .table-pager', { timeout: 10000 }).catch(() => {});
    await sleep(800);
    await api('delay', { entities: 3000 });
    const rowsBefore = await page.locator('#entities tbody tr td:first-child').allInnerTexts();
    await page.locator('#entities .kind-switch button', { hasText: '담당자' }).click();
    await sleep(600);
    const midEmpty = await page.locator('#entities .table-empty').innerText().catch(() => '');
    const midRows = await page.locator('#entities tbody tr td:first-child').allInnerTexts();
    const midPager = await page.locator('#entities .table-pager').innerText().catch(() => '').catch(() => '');
    await shot(page, 'R5b-stale-midload');
    const stale = midRows.length > 0 && !midEmpty && midRows.join('|') === rowsBefore.join('|');
    note('R5b-stale', !stale, stale ? 'OLD ROWS UNDER NEW HEADERS' : `loadingMsg="${midEmpty.slice(0, 30)}" pager="${midPager.replace(/\n/g, ' ')}" rows=${midRows.length}`);
    if (stale) issue('R-STALE-ROWS', 'medium', '전체 보기 + delay(entities 3s) + 기관→담당자', 'loading state, not old-kind rows under new headers', 'previous kind rows kept under new headers', 'R5b-stale-midload.png', 'src/components/EntityTable.tsx:165');
    await api('delay', {});
    await waitFor(async () => page.locator('#entities tbody tr').count(), (n) => n > 1, 8000);
    await context.close();
  });

  await guard('R6', async () => {
    const { page, context } = await fresh({ width: 1440, height: 1000 });
    await page.locator('#entities').scrollIntoViewIfNeeded();
    await page.locator('#entities').getByRole('button', { name: '전체 보기' }).click();
    await page.waitForSelector('#entities .table-pager', { timeout: 10000 }).catch(() => {});
    await sleep(800);
    const next = page.locator('#entities').getByRole('button', { name: '다음 페이지' });
    let adv = 0;
    while (await next.count() && await next.isEnabled() && adv < 4) { await next.click(); await sleep(900); adv++; }
    const pagerBefore = await page.locator('#entities .table-pager').innerText().catch(() => '');
    const sel = page.locator('.top-region select').first();
    let scopeNote = 'no region select';
    if (await sel.count()) {
      const vals = await sel.evaluate((e) => [...e.options].map((o) => ({ v: o.value, t: o.text.slice(0, 12) })));
      OUT.steps.push({ id: 'R6-options', ok: true, detail: JSON.stringify(vals.slice(0, 20)) });
      const small = vals.find((o) => /제주|세종/.test(o.t)) ?? vals.filter((o) => o.v)[vals.filter((o) => o.v).length - 1];
      if (small) {
        await sel.selectOption(small.v, { timeout: 5000 }).catch(async () => {});
        await sleep(2000);
        scopeNote = `region→${small.t} (${small.v})`;
      }
    }
    const pagerAfter = await page.locator('#entities .table-pager').innerText().catch(() => 'no-pager');
    const emptyMsg = await page.locator('#entities .table-empty').innerText().catch(() => '');
    await shot(page, 'R6-oob');
    const m = /(\d+)\s*\/\s*(\d+)쪽/.exec(pagerAfter);
    const oob = m && Number(m[1]) > Number(m[2]);
    note('R6-oob', !oob, `before="${pagerBefore.replace(/\n/g, ' ')}" ${scopeNote} after="${pagerAfter.replace(/\n/g, ' ')}" empty="${emptyMsg.slice(0, 40)}"`);
    if (oob) issue('R-PAGE-OOB', 'medium', 'entities page N + scope narrows total below N', 'page clamps to 1/last with rows', `pager shows ${pagerAfter} (current beyond bounds)`, 'R6-oob.png', 'src/components/EntityTable.tsx (no scopeKey page reset, cf LawTable.tsx:40)');
    await context.close();
  });

  await guard('R7', async () => {
    const { page, context } = await fresh({ width: 1440, height: 1000 });
    await page.locator('#laws').scrollIntoViewIfNeeded(); await sleep(400);
    await shot(page, 'R7-laws');
    const inp = page.locator('#laws input[type="search"]');
    if (await inp.count()) {
      await inp.pressSequentially('도로교통', { delay: 80 });
      await sleep(1000);
      note('R7-lawsearch', true, (await page.locator('#laws caption').innerText().catch(() => '')).replace(/\n/g, ' ').slice(0, 100));
      await shot(page, 'R7-lawsearch');
      await api('delay', { laws: 2000, dashboard: 2000 });
      await page.locator('.top-region select').first().selectOption('11', { timeout: 5000 }).catch(() => {});
      await sleep(600);
      await shot(page, 'R7-laws-midload');
      await api('delay', {}); await sleep(2500);
      note('R7-lawdelay', true, `after scope change: ${(await page.locator('#laws caption').innerText().catch(() => '')).replace(/\n/g, ' ').slice(0, 100)}`);
    } else note('R7', true, 'laws summary w/o search (serverList off?)');
    await context.close();
  });

  await guard('R8', async () => {
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
  });

  await guard('R9', async () => {
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
  });

  await guard('R10', async () => {
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
    note('R10-export', true, `export buttons=${await expBtn.count()} runBtn="${await page.locator('.stats-run .primary-button').innerText().catch(() => '?')}"`);
    await shot(page, 'R10-after-apply');
    await context.close();
  });

  await guard('R11', async () => {
    OUT.network = await api('log').then((l) => { const m = {}; for (const e of l) m[e.route] = (m[e.route] || 0) + 1; return m; });
    OUT.consoleErrors = allConsole;
    note('R11', true, `routes=${JSON.stringify(OUT.network)} consoleErrors=${allConsole.length}`);
  });
} finally {
  await browser.close();
  OUT.finished = new Date().toISOString();
  writeFileSync(join(EV, 'results2.json'), JSON.stringify(OUT, null, 2));
  console.log(`wrote results2.json with ${OUT.steps.length} steps, ${OUT.issues.length} issues`);
}
