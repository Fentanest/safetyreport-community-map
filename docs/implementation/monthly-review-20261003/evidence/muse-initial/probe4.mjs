// E3b: true page-OOB — manager tab + '경찰' (multi-page) to last page, then narrow scope.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, openPage, waitMap, api, sleep } from '../../../../../scripts/browser/harness.mjs';

const EV = dirname(fileURLToPath(import.meta.url));
const OUT = { steps: [], issues: [] };
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--lang=ko-KR', '--no-sandbox'] });
try {
  await api('reset');
  const { page, context } = await openPage(browser, { locale: 'ko-KR', width: 1440, height: 1000 });
  await waitMap(page);
  await page.waitForSelector('.kpi-strip .kpi-row', { timeout: 20000 }).catch(() => {});
  await sleep(700);
  await page.locator('#entities').scrollIntoViewIfNeeded();
  await page.locator('#entities .kind-switch button', { hasText: '담당자' }).click();
  await sleep(1000);
  await page.locator('#entities input[type="search"]').pressSequentially('경찰', { delay: 60 });
  await sleep(1200);
  await page.locator('#entities').getByRole('button', { name: '전체 보기' }).click().catch(() => {});
  await page.waitForSelector('#entities .table-pager', { timeout: 10000 }).catch(() => {});
  await sleep(800);
  const next = page.locator('#entities').getByRole('button', { name: '다음 페이지' });
  let adv = 0;
  while (await next.count() && await next.isEnabled() && adv < 10) { await next.click(); await sleep(800); adv++; }
  const pagerLast = await page.locator('#entities .table-pager').innerText().catch(() => '');
  const capLast = await page.locator('#entities .table-caption').innerText().catch(() => '');
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
  await page.screenshot({ path: join(EV, 'shots', 'E3b-oob.png') });
  const m = /(\d+)\s*\/\s*(\d+)쪽/.exec(pagerAfter);
  const oob = m && Number(m[1]) > Number(m[2]);
  OUT.steps.push({ id: 'E3b-oob', ok: !oob, detail: `adv=${adv} last="${pagerLast.replace(/\n/g, ' ')}" capLast="${capLast.replace(/\n/g, ' ')}" ${scopeNote} after="${pagerAfter.replace(/\n/g, ' ')}" empty="${emptyMsg.slice(0, 60)}" capAfter="${capAfter.replace(/\n/g, ' ')}"` });
  console.log(`${!oob ? 'PASS' : 'FAIL'} E3b-oob ${OUT.steps[0].detail}`);
  if (oob) OUT.issues.push({ id: 'R-PAGE-OOB', severity: 'medium', repro: 'entities last page + scope narrows total', expected: 'page clamps to 1/last with rows', actual: `pager shows ${pagerAfter} (current beyond bounds)`, evidence: 'E3b-oob.png', fileHint: 'src/components/EntityTable.tsx (no scopeKey page reset, cf LawTable.tsx:40)' });
  await context.close();
} finally {
  await browser.close();
  writeFileSync(join(EV, 'results4.json'), JSON.stringify(OUT, null, 2));
  console.log('wrote results4.json');
}
