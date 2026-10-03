// Monthly review part 3: disambiguation probes.
// E1: entities delay effectiveness + stale rows (log timestamps).
// E2: picker IME follow-up (does composing flag clear? does later typing fire?).
// E2b: picker focus-leak target. E3: true page-OOB (last page + narrow scope).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, openPage, waitMap, api, sleep } from '../../../../../scripts/browser/harness.mjs';

const EV = dirname(fileURLToPath(import.meta.url));
const OUT = { started: new Date().toISOString(), steps: [], issues: [] };
const note = (id, ok, detail) => { OUT.steps.push({ id, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${detail ?? ''}`); };
const issue = (id, severity, repro, expected, actual, evidence, fileHint) =>
  OUT.issues.push({ id, severity, repro, expected, actual, evidence, fileHint });
const shot = (page, name) => page.screenshot({ path: join(EV, 'shots', `${name}.png`) });
const guard = async (id, fn) => { try { await fn(); } catch (e) { note(id, false, String(e?.message ?? e).split('\n')[0].slice(0, 220)); } };
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--lang=ko-KR', '--no-sandbox'] });

async function fresh(opts = {}) {
  await api('reset');
  const s = await openPage(browser, { locale: 'ko-KR', height: 1000, ...opts });
  s.page.on('pageerror', (e) => OUT.steps.push({ id: 'pageerror', ok: false, detail: e.message }));
  await waitMap(s.page);
  await s.page.waitForSelector('.kpi-strip .kpi-row', { timeout: 20000 }).catch(() => {});
  await sleep(700);
  return s;
}

try {
  await guard('E1', async () => {
    const { page, context } = await fresh({ width: 1440, height: 1000 });
    await page.locator('#entities').scrollIntoViewIfNeeded();
    await page.locator('#entities').getByRole('button', { name: '전체 보기' }).click();
    await page.waitForSelector('#entities .table-pager', { timeout: 10000 }).catch(() => {});
    await sleep(800);
    await api('delay', { entities: 3000 });
    const rowsBefore = await page.locator('#entities tbody tr td:first-child').allInnerTexts();
    const n0 = (await api('log')).filter((e) => e.route === 'entities').length;
    const t0 = Date.now();
    await page.locator('#entities .kind-switch button', { hasText: '담당자' }).click();
    await sleep(600);
    await page.locator('#entities').scrollIntoViewIfNeeded();
    await shot(page, 'E1-midload');
    const midHead = await page.locator('#entities thead th').first().innerText();
    const midRows = await page.locator('#entities tbody tr td:first-child').allInnerTexts();
    const midEmpty = await page.locator('#entities .table-empty').innerText().catch(() => '');
    // wait for the new request to land in the log
    let elapsed = -1;
    for (let i = 0; i < 40; i++) {
      const n = (await api('log')).filter((e) => e.route === 'entities').length;
      if (n > n0) { elapsed = Date.now() - t0; break; }
      await sleep(250);
    }
    await api('delay', {});
    const stale = midRows.length > 0 && !midEmpty && midRows.join('|') === rowsBefore.join('|');
    note('E1', true, `head="${midHead}" rowsBefore=${rowsBefore.length} midRows=${midRows.length} stale=${stale} entitiesReqElapsed=${elapsed}ms empty="${midEmpty.slice(0, 30)}"`);
    OUT.steps.push({ id: 'E1-rows', ok: true, detail: `before=${rowsBefore.slice(0, 3).join('/')} mid=${midRows.slice(0, 3).join('/')}` });
    if (stale) issue('R-STALE-ROWS', 'medium', '전체 보기 + delay(entities 3s) + 기관→담당자', 'loading state, not old-kind rows under new headers', 'previous kind rows kept under new headers', 'E1-midload.png', 'src/components/EntityTable.tsx:165');
    await context.close();
  });

  await guard('E2', async () => {
    const { page, context } = await fresh({ width: 1440, height: 1000 });
    await page.locator('.rail button[aria-label^="통계"]').click();
    await page.waitForSelector('.pivot-table tbody tr', { timeout: 15000 }).catch(() => {});
    await page.getByRole('button', { name: '비교 대상 선택' }).click();
    await page.getByRole('dialog', { name: '비교 대상 선택' }).locator('.picker-list li').first().waitFor({ timeout: 10000 }).catch(() => {});
    const n0 = (await api('log')).length;
    await page.evaluate(() => {
      const input = document.querySelector('.picker-search input');
      input.focus();
      input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '경찰');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: '경찰' }));
    });
    await sleep(900);
    const during = (await api('log')).length - n0;
    await page.evaluate(() => {
      document.querySelector('.picker-search input').dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '경찰' }));
    });
    await sleep(1000);
    const afterCommit = (await api('log')).length - n0;
    const valAfter = await page.locator('.picker-search input').inputValue().catch(() => '?');
    // follow-up: type one more syllable normally — if a request fires, composing flag cleared (handler ran)
    await page.locator('.picker-search input').pressSequentially('서', { delay: 60 });
    await sleep(1000);
    const afterTyping = (await api('log')).length - n0;
    note('E2-ime', true, `during=${during} afterCommit=${afterCommit} val="${valAfter}" afterTyping="${afterTyping}"`);
    if (during === 0 && afterCommit === 0 && afterTyping >= 1)
      issue('R-PICKER-IME', 'medium', 'picker search: IME composition of 경찰 then compositionend (final value == last intermediate input value)', 'committed query runs a candidates request', 'no request: compositionend setInput is a no-op so the debounce effect never re-runs (same-state bailout)', 'R10-picker-search.png', 'src/components/stats/MemberPicker.tsx:68-72 (same pattern EntityTable.tsx:123-128, LawTable.tsx:41-45)');
    else if (afterTyping === 0)
      note('E2-inconclusive', false, 'even normal typing fired no request — synthetic composition may not have engaged React handlers');
    await shot(page, 'E2-ime');
    await context.close();
  });

  await guard('E2b', async () => {
    const { page, context } = await fresh({ width: 1440, height: 1000 });
    await page.locator('.rail button[aria-label^="통계"]').click();
    await page.waitForSelector('.pivot-table tbody tr', { timeout: 15000 }).catch(() => {});
    await page.getByRole('button', { name: '비교 대상 선택' }).click();
    await page.getByRole('dialog', { name: '비교 대상 선택' }).locator('.picker-list li').first().waitFor({ timeout: 10000 }).catch(() => {});
    await page.locator('.picker-search input').first().focus().catch(() => {});
    let leakedTo = '';
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Tab'); await sleep(60);
      const inside = await page.evaluate(() => !!document.activeElement?.closest('.picker'));
      if (!inside) { leakedTo = await page.evaluate(() => (document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent || document.activeElement?.tagName || '').slice(0, 80)); break; }
    }
    await shot(page, 'E2b-focus-leak');
    note('E2b-focus', !!leakedTo === false, leakedTo ? `LEAKED to: ${leakedTo}` : 'no leak in 20 tabs');
    if (leakedTo) issue('R-PICKER-FOCUS', 'medium', '비교 대상 선택 dialog open, Tab from search', 'focus cycles inside role=dialog aria-modal=true', `focus escaped to background ("${leakedTo}") — no focus trap; Esc works but keyboard users can tab behind the modal`, 'E2b-focus-leak.png', 'src/components/stats/MemberPicker.tsx (autofocus only, no trap; Esc at :98-107)');
    await context.close();
  });

  await guard('E3', async () => {
    const { page, context } = await fresh({ width: 1440, height: 1000 });
    await page.locator('#entities').scrollIntoViewIfNeeded();
    await page.locator('#entities input[type="search"]').pressSequentially('경찰', { delay: 60 });
    await sleep(1200);
    await page.locator('#entities').getByRole('button', { name: '전체 보기' }).click().catch(() => {});
    await page.waitForSelector('#entities .table-pager', { timeout: 10000 }).catch(() => {});
    await sleep(800);
    const next = page.locator('#entities').getByRole('button', { name: '다음 페이지' });
    let adv = 0;
    while (await next.count() && await next.isEnabled() && adv < 10) { await next.click(); await sleep(800); adv++; }
    const pagerLast = await page.locator('#entities .table-pager').innerText().catch(() => '');
    const sel = page.locator('.top-region select').first();
    let scopeNote = 'no region select';
    if (await sel.count()) {
      const vals = await sel.evaluate((e) => [...e.options].map((o) => ({ v: o.value, t: o.text.slice(0, 12) })));
      const small = vals.find((o) => /세종|제주/.test(o.t)) ?? vals.filter((o) => o.v).pop();
      if (small) { await sel.selectOption(small.v, { timeout: 5000 }).catch(() => {}); await sleep(2000); scopeNote = `region→${small.t}`; }
    }
    const pagerAfter = await page.locator('#entities .table-pager').innerText().catch(() => 'no-pager');
    const emptyMsg = await page.locator('#entities .table-empty').innerText().catch(() => '');
    const capAfter = await page.locator('#entities .table-caption').innerText().catch(() => '');
    await shot(page, 'E3-oob');
    const m = /(\d+)\s*\/\s*(\d+)쪽/.exec(pagerAfter);
    const oob = m && Number(m[1]) > Number(m[2]);
    note('E3-oob', !oob, `adv=${adv} last="${pagerLast.replace(/\n/g, ' ')}" ${scopeNote} after="${pagerAfter.replace(/\n/g, ' ')}" empty="${emptyMsg.slice(0, 50)}" cap="${capAfter.replace(/\n/g, ' ').slice(0, 80)}"`);
    if (oob) issue('R-PAGE-OOB', 'medium', 'entities last page + scope narrows total', 'page clamps to 1/last with rows', `pager shows ${pagerAfter} (current beyond bounds)`, 'E3-oob.png', 'src/components/EntityTable.tsx (no scopeKey page reset, cf LawTable.tsx:40)');
    await context.close();
  });
} finally {
  await browser.close();
  OUT.finished = new Date().toISOString();
  writeFileSync(join(EV, 'results3.json'), JSON.stringify(OUT, null, 2));
  console.log(`wrote results3.json with ${OUT.steps.length} steps, ${OUT.issues.length} issues`);
}
