// MUSE FINAL REVIEW part 3 — current-month notice, save/share, zoom-overflow forensics.
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, openPage, ORIGIN } from '../../../scripts/browser/harness.mjs';
import { attachRankingFixture } from '../../../scripts/browser/ranking_fixture.mjs';
const OUT = 'docs/refactoring/map-performance/evidence/muse-final';
mkdirSync(OUT, { recursive: true });
const results = []; const consoleErrors = []; const net = [];
function rec(id, name, status, detail = '') { results.push({ id, name, status, detail }); }
async function check(id, name, fn) {
  try { const d = await fn(); rec(id, name, 'PASS', d ?? ''); }
  catch (e) { rec(id, name, 'FAIL', String(e?.message ?? e).slice(0, 400)); }
}
const rowsOf = (rk) => rk.locator('.rk-table:visible tbody tr, .rk-list:visible li');
const shot = (page, n) => page.screenshot({ path: `${OUT}/${n}.png` });
function watch(page, tag) {
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(`[${tag}] ${m.text()}`); });
  page.on('pageerror', e => consoleErrors.push(`[${tag}] pageerror: ${e.message}`));
}
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--lang=ko-KR'] });
try {
  const s = await openPage(browser, { width: 1440, height: 900, theme: 'dark', search: '?screen=map' });
  watch(s.page, 'T'); await attachRankingFixture(s.context);
  await s.page.goto(`${ORIGIN}/?screen=rankings`);
  const rk = s.page.locator('.rk-page');
  await rowsOf(rk).first().waitFor({ timeout: 15000 });
  await check('T01', 'current month shows 집계 중 + ties + sample1', async () => {
    const w = s.page.waitForResponse(r => r.url().includes('/functions/v1/user-rankings') && new URL(r.url()).searchParams.get('period') === 'month', { timeout: 15000 });
    await rk.getByRole('button', { name: '월별', exact: true }).click();
    await w;
    await rowsOf(rk).first().waitFor({ timeout: 15000 });
    await s.page.waitForTimeout(300);
    const body = await rk.innerText();
    const month = new URL(s.page.url()).searchParams.get('rk_month');
    if (!body.includes('집계 중')) throw new Error(`no in-progress note (month=${month})`);
    if (!body.includes('공동')) throw new Error('no ties');
    if (!body.includes('표본 1건')) throw new Error('no sample1');
    await shot(s.page, 'T-rankings-current-month');
    return `month=${month} notice+ties+sample1`;
  });
  await s.context.close();

  const t = await openPage(browser, { width: 1440, height: 900, theme: 'dark', search: '?screen=statistics' });
  watch(t.page, 'TS');
  await t.page.locator('.stats-page').waitFor({ timeout: 15000 });
  await t.page.waitForTimeout(2000);
  const st = t.page.locator('.stats-page');
  await check('T02', 'saved recipe round-trip (details first) + share panel', async () => {
    await st.locator('.stats-save summary').click();
    await st.getByLabel('설정 이름').fill('검수저장');
    await st.getByRole('button', { name: '저장', exact: true }).click();
    await t.page.waitForTimeout(400);
    if (!await st.getByRole('button', { name: '검수저장', exact: true }).count()) throw new Error('saved recipe missing');
    await st.getByRole('button', { name: '검수저장', exact: true }).click();
    await t.page.waitForTimeout(400);
    await st.getByRole('button', { name: '공유 링크', exact: true }).click();
    await t.page.waitForTimeout(500);
    const body = await st.innerText();
    await shot(t.page, 'T-statistics-save-share');
    if (!/공유|복사|링크/.test(body)) throw new Error('share panel missing');
    return 'save listed + reloads draft, share panel open';
  });
  await t.context.close();

  const m = await openPage(browser, { width: 390, height: 844, theme: 'light', search: '?screen=map' });
  watch(m.page, 'TZ'); await attachRankingFixture(m.context);
  await m.page.goto(`${ORIGIN}/?screen=rankings`);
  await rowsOf(m.page.locator('.rk-page')).first().waitFor({ timeout: 15000 });
  await check('T03', '200%-zoom overflow forensics (rect-based)', async () => {
    await m.page.evaluate(() => { document.body.style.zoom = '200%'; });
    await m.page.waitForTimeout(400);
    const info = await m.page.evaluate(() => {
      const iw = window.innerWidth;
      const over = [];
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect();
        if ((r.right > iw + 1 || r.left < -1) && r.width > 0 && r.height > 0) {
          const cls = (el.className?.baseVal ?? el.className ?? '').toString().split(' ').slice(0, 2).join('.');
          over.push(`${el.tagName}.${cls} L=${r.left.toFixed(0)} R=${r.right.toFixed(0)} W=${r.width.toFixed(0)} pos=${getComputedStyle(el).position}`);
        }
        if (over.length >= 15) break;
      }
      return { innerWidth: iw, docSW: document.documentElement.scrollWidth, bodySW: document.body.scrollWidth, over };
    });
    await shot(m.page, 'T-zoom200-forensics');
    return JSON.stringify(info).slice(0, 600);
  });
  await m.context.close();
} finally {
  writeFileSync(`${OUT}/results3.json`, JSON.stringify({ results, consoleErrors }, null, 2));
  await browser.close();
}
const pass = results.filter(r => r.status === 'PASS').length;
console.log(JSON.stringify({ pass, fail: results.length - pass, total: results.length }));
for (const r of results) console.log(`${r.status} ${r.id} ${r.name}${r.detail ? ' :: ' + r.detail.slice(0, 400) : ''}`);
