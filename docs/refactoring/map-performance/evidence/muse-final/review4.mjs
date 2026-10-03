// MUSE FINAL REVIEW part 4 — clipboard SUCCESS path + clean page-2 evidence.
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, ORIGIN, E2E_UID, fakeSession } from '../../../scripts/browser/harness.mjs';
import { attachRankingFixture } from '../../../scripts/browser/ranking_fixture.mjs';
import { readFileSync } from 'node:fs';
const OUT = 'docs/refactoring/map-performance/evidence/muse-final';
mkdirSync(OUT, { recursive: true });
const results = [];
const MOCK = readFileSync(new URL('../../../scripts/browser/mock-kakao-sdk.js', import.meta.url), 'utf8');
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--lang=ko-KR'] });
try {
  const context = await browser.newContext({ locale: 'ko-KR', viewport: { width: 1440, height: 900 }, colorScheme: 'dark', permissions: ['clipboard-read', 'clipboard-write'] });
  await context.route('https://dapi.kakao.com/**', r => r.fulfill({ contentType: 'text/javascript', body: MOCK }));
  await context.addInitScript(({ session }) => {
    localStorage.setItem('cm-map-auth-v1', JSON.stringify(session));
    localStorage.setItem('cm-theme', 'dark');
  }, { session: fakeSession(E2E_UID) });
  await attachRankingFixture(context);
  const page = await context.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(`${ORIGIN}/?screen=rankings`);
  const rk = page.locator('.rk-page');
  await rk.locator('.rk-table tbody tr').first().waitFor({ timeout: 15000 });
  try {
    const opener = rk.locator('tr .rk-uuid-btn').first();
    await opener.click();
    const dialog = rk.getByRole('dialog', { name: '참여자 UUID' });
    await dialog.waitFor({ timeout: 8000 });
    await dialog.getByRole('button', { name: '복사', exact: true }).click();
    await page.waitForTimeout(500);
    const okMsg = await dialog.getByText('복사했습니다.').count();
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    await page.screenshot({ path: `${OUT}/U-uuid-copy-success.png` });
    if (!okMsg) throw new Error('no success message');
    if (clip !== E2E_UID) throw new Error(`clipboard=${clip}`);
    results.push({ id: 'U01', name: 'UUID copy success path', status: 'PASS', detail: `clipboard=${clip.slice(0, 8)}… + success message` });
  } catch (e) { results.push({ id: 'U01', name: 'UUID copy success path', status: 'FAIL', detail: String(e.message).slice(0, 300) }); }
  try {
    await page.keyboard.press('Escape');
    const next = rk.getByRole('button', { name: '다음', exact: true });
    const w = page.waitForResponse(r => r.url().includes('/functions/v1/user-rankings') && new URL(r.url()).searchParams.get('page') === '2', { timeout: 15000 });
    await next.click(); await w;
    await page.waitForTimeout(400);
    await rk.locator('.rk-pager').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${OUT}/U-rankings-page2-clean.png` });
    const pager = await rk.locator('.rk-pager').innerText();
    const me = await rk.locator('.rk-me-line').innerText();
    if (!pager.includes('참여자 21–')) throw new Error(`pager=${pager}`);
    results.push({ id: 'U02', name: 'clean page-2 evidence (defaults)', status: 'PASS', detail: `${pager.replace(/\n/g, ' ')} || ${me.replace(/\n/g, ' ')}` });
  } catch (e) { results.push({ id: 'U02', name: 'clean page-2 evidence (defaults)', status: 'FAIL', detail: String(e.message).slice(0, 300) }); }
  results.push({ id: 'U03', name: 'no page errors in success-path run', status: errs.length ? 'FAIL' : 'PASS', detail: errs.join('; ').slice(0, 300) });
  await context.close();
} finally {
  writeFileSync(`${OUT}/results4.json`, JSON.stringify({ results }, null, 2));
  await browser.close();
}
console.log(JSON.stringify(results, null, 1));
