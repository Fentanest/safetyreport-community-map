// MUSE-ENTRY-RECHECK — narrow recheck of 2cd5442 (eager RankingsPage import).
// Read-only product; own E2E_PORT=5191 mock stack; fixture attached BEFORE rankings entry.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { chromium, ORIGIN, fakeSession, E2E_UID } from '/home/better0101/projects/safetyreport-community-map/.agent-runtime/worktrees/muse-recheck/scripts/browser/harness.mjs';
import { attachRankingFixture } from '/home/better0101/projects/safetyreport-community-map/.agent-runtime/worktrees/muse-recheck/scripts/browser/ranking_fixture.mjs';

const OUT = '/home/better0101/projects/safetyreport-community-map/.agent-runtime/worktrees/muse-recheck/docs/refactoring/map-performance/evidence/muse-entry';
mkdirSync(OUT, { recursive: true });
const MOCK_SDK = readFileSync('/home/better0101/projects/safetyreport-community-map/.agent-runtime/worktrees/muse-recheck/scripts/browser/mock-kakao-sdk.js', 'utf8');

const results = [];
const check = (id, ok, detail = '') => { results.push({ id, status: ok ? 'PASS' : 'FAIL', detail }); if (!ok) console.error(`FAIL ${id}: ${detail}`); else console.log(`PASS ${id} ${detail}`); };
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
const rkRows = page => page.locator('.rk-table:visible tbody tr, .rk-list:visible li');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch({ args: ['--no-sandbox', '--lang=ko-KR'] });
const consoleErrors = [];
let faced = null;
try {
  // ---- A. rankings direct entry (1440 dark): exactly 1 default request ----
  {
    const context = await browser.newContext({ locale: 'ko-KR', viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
    await context.route('https://dapi.kakao.com/**', r => r.fulfill({ contentType: 'text/javascript', body: MOCK_SDK }));
    await context.addInitScript(({ session }) => { localStorage.setItem('cm-map-auth-v1', JSON.stringify(session)); localStorage.setItem('cm-theme', 'dark'); }, { session: fakeSession() });
    const page = await context.newPage();
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push('A:' + m.text()); });
    page.on('pageerror', e => consoleErrors.push('A:pageerror:' + e.message));
    const seen = [];
    page.on('request', r => { const u = new URL(r.url()); if (u.pathname.includes('/functions/v1/user-rankings')) seen.push(u.searchParams); });
    await page.goto(`${ORIGIN}/?screen=map`); // open map first per recipe
    await attachRankingFixture(context);      // fixture BEFORE rankings entry
    const waiter = page.waitForResponse(r => r.url().includes('/functions/v1/user-rankings') && r.status() === 200);
    await page.goto(`${ORIGIN}/?screen=rankings`);
    await waiter;
    await rkRows(page).first().waitFor({ state: 'visible', timeout: 20000 });
    await sleep(400); // settle: ensure no second default request
    const defs = { theme: 'reporters', metric: 'reports_count', period: 'all', date_basis: 'completed_date', category: 'all', min_reports: '1', page: '1' };
    const first = seen[0];
    const matchDefaults = first && Object.entries(defs).every(([k, v]) => (first.get(k) || (k === 'page' ? '1' : null)) === v || (k === 'page' && !first.get(k)));
    check('R-direct-one-default', seen.length === 1 && !!matchDefaults, `requests=${seen.length} q=${first ? first.toString() : 'none'}`);
    check('R-h1-tabs', (await page.locator('.rk-page h1').innerText().catch(() => '')) === '참여자 랭킹' && (await page.locator('.rk-tabs button').allTextContents()).join('|') === '신고 랭킹|과태료 랭킹|불운 랭킹', 'h1+3tabs');
    const headers = await page.locator('.rk-table:visible th').allTextContents().catch(() => []);
    check('R-headers', headers.join('|') === '순위|참여자|완료 신고', headers.join('|'));
    check('R-me-strip', await page.locator('[aria-label="내 순위 요약"]').isVisible().catch(() => false), 'me strip visible');
    const pager = await page.locator('.rk-pager').innerText().catch(() => '');
    check('R-pager', /참여자 1–20 \/ 26명/.test(pager), pager.trim());
    await shot(page, 'A-rankings-direct-dark');
    faced = page;
    // keep context for cross-nav section C
    var ctxA = context, pageA = page;
  }

  // ---- B. statistics direct entry: meta + catalog + exactly one query, NO dashboard ----
  {
    const context = await browser.newContext({ locale: 'ko-KR', viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
    await context.route('https://dapi.kakao.com/**', r => r.fulfill({ contentType: 'text/javascript', body: MOCK_SDK }));
    await context.addInitScript(({ session }) => { localStorage.setItem('cm-map-auth-v1', JSON.stringify(session)); localStorage.setItem('cm-theme', 'dark'); }, { session: fakeSession() });
    const page = await context.newPage();
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push('B:' + m.text()); });
    page.on('pageerror', e => consoleErrors.push('B:pageerror:' + e.message));
    await page.goto(`${ORIGIN}/?screen=statistics`);
    await page.locator('.pivot-table tbody tr, .stats-builder, .statistics-page').first().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
    await sleep(1200);
    const log = await (await fetch(`${ORIGIN}/__e2e/log`, { method: 'POST' })).json();
    const routes = log.map(e => e.route);
    const dash = log.filter(e => e.route === 'dashboard' || e.route === 'overview');
    const meta = log.filter(e => e.route === 'meta').length;
    const catalog = log.filter(e => e.route === 'statistics/catalog').length;
    const query = log.filter(e => e.route === 'statistics/query').length;
    check('S-direct-no-dashboard', dash.length === 0, `dashboard/overview=${dash.length} routes=${JSON.stringify([...new Set(routes)])}`);
    check('S-direct-meta-catalog-query', meta >= 1 && catalog >= 1 && query === 1, `meta=${meta} catalog=${catalog} query=${query}`);
    await shot(page, 'B-statistics-direct-dark');
    await context.close();
    await fetch(`${ORIGIN}/__e2e/reset`, { method: 'POST' }); // reset server log for section C
  }

  // ---- C. cross-nav rankings↔statistics↔map: controls fire, no hidden dashboard ----
  {
    const page = pageA;
    const rk = page.locator('.rk-page');
    // fines tab → one theme=fines request (waiter BEFORE click)
    let w = page.waitForResponse(r => r.url().includes('/functions/v1/user-rankings') && new URL(r.url()).searchParams.get('theme') === 'fines');
    await rk.getByRole('button', { name: '과태료 랭킹', exact: true }).click();
    await w;
    await rkRows(page).first().waitFor({ state: 'visible', timeout: 20000 });
    const fineHeaders = await page.locator('.rk-table:visible th').allTextContents().catch(() => []);
    check('C-fines', fineHeaders.join('|') === '순위|참여자|과태료 처분|완료 신고', fineHeaders.join('|'));
    // unlucky tab → one request
    w = page.waitForResponse(r => r.url().includes('/functions/v1/user-rankings') && new URL(r.url()).searchParams.get('theme') === 'unlucky');
    await rk.getByRole('button', { name: '불운 랭킹', exact: true }).click();
    await w;
    await rkRows(page).first().waitFor({ state: 'visible', timeout: 20000 });
    // month period → one request
    w = page.waitForResponse(r => r.url().includes('/functions/v1/user-rankings') && new URL(r.url()).searchParams.get('period') === 'month');
    await rk.getByRole('button', { name: '월별', exact: true }).click();
    await w;
    await rkRows(page).first().waitFor({ state: 'visible', timeout: 20000 });
    // same tab re-click sends nothing
    const beforeSame = (await (await fetch(`${ORIGIN}/__e2e/log`, { method: 'POST' })).json()).length;
    await rk.getByRole('button', { name: '월별', exact: true }).click().catch(() => {});
    await sleep(400);
    const afterSame = (await (await fetch(`${ORIGIN}/__e2e/log`, { method: 'POST' })).json()).length;
    check('C-same-no-dup', afterSame === beforeSame, `log ${beforeSame}->${afterSame}`);
    // nav across screens via the rail; assert server log incrementally:
    // rankings controls are fixture-handled (zero server entries, proven above);
    // statistics must add only meta/catalog/query; map may add dashboard (its own);
    // returning to rankings must add nothing server-side.
    const nav = page.getByRole('navigation', { name: '주요 화면', exact: true });
    const n0 = (await (await fetch(`${ORIGIN}/__e2e/log`, { method: 'POST' })).json()).length;
    check('C-rankings-controls-server-silent', n0 === 0, `server log entries while on rankings=${n0}`);
    await nav.getByRole('button', { name: '통계' }).click();
    await page.waitForFunction(() => new URLSearchParams(location.search).get('screen') === 'statistics', null, { timeout: 10000 });
    await sleep(1000);
    const logS = await (await fetch(`${ORIGIN}/__e2e/log`, { method: 'POST' })).json();
    const newS = logS.slice(n0).map(e => e.route);
    check('C-stats-no-dashboard', !newS.includes('dashboard') && !newS.includes('overview'), `added=${JSON.stringify(newS)}`);
    await nav.getByRole('button', { name: '지도' }).click();
    await page.waitForFunction(() => !new URLSearchParams(location.search).get('screen'), null, { timeout: 10000 });
    await sleep(1000);
    const logM = await (await fetch(`${ORIGIN}/__e2e/log`, { method: 'POST' })).json();
    const n1 = logM.length;
    await nav.getByRole('button', { name: '유저 랭킹' }).click();
    await page.waitForFunction(() => new URLSearchParams(location.search).get('screen') === 'rankings', null, { timeout: 10000 });
    await rkRows(page).first().waitFor({ state: 'visible', timeout: 20000 });
    await sleep(400);
    const logR = await (await fetch(`${ORIGIN}/__e2e/log`, { method: 'POST' })).json();
    const newR = logR.slice(n1);
    check('C-rankings-return-server-silent', newR.length === 0, `added=${JSON.stringify(newR.map(e => e.route))}`);
    const dashAll = logR.filter(e => e.route === 'dashboard' || e.route === 'overview');
    check('C-no-hidden-dashboard', dashAll.length >= 1 && newS.includes('dashboard') === false, `dashboard only from map screen (total dashboard=${dashAll.length})`);
    await shot(page, 'C-rankings-after-nav');
    await ctxA.close();
    await fetch(`${ORIGIN}/__e2e/reset`, { method: 'POST' });
  }

  // ---- D. theme×viewport matrix (rankings) + representative statistics ----
  {
    for (const width of [360, 390, 768, 1440]) for (const theme of ['dark', 'light']) {
      const context = await browser.newContext({ locale: 'ko-KR', viewport: { width, height: 900 }, colorScheme: theme === 'light' ? 'light' : 'dark' });
      await context.route('https://dapi.kakao.com/**', r => r.fulfill({ contentType: 'text/javascript', body: MOCK_SDK }));
      await context.addInitScript(({ session, theme }) => { localStorage.setItem('cm-map-auth-v1', JSON.stringify(session)); localStorage.setItem('cm-theme', theme); }, { session: fakeSession(), theme });
      const page = await context.newPage();
      page.on('pageerror', e => consoleErrors.push(`D${width}${theme}:` + e.message));
      await page.goto(`${ORIGIN}/?screen=map`);
      await attachRankingFixture(context);
      await page.goto(`${ORIGIN}/?screen=rankings`);
      await rkRows(page).first().waitFor({ state: 'visible', timeout: 20000 });
      await sleep(300);
      const tabs = (await page.locator('.rk-tabs button').allTextContents()).join('|');
      const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
      const dims = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
      const wide = width > 700;
      const tableVisible = await page.locator('.rk-table:visible').count() > 0;
      const listVisible = await page.locator('.rk-list:visible').count() > 0;
      const responsiveOk = wide ? tableVisible : listVisible;
      check(`D-${width}-${theme}`, tabs === '신고 랭킹|과태료 랭킹|불운 랭킹' && noOverflow && responsiveOk, `tabs=${tabs} sw=${dims.sw}/iw=${dims.iw} table=${tableVisible} list=${listVisible}`);
      await shot(page, `D-rankings-${width}-${theme}`);
      await context.close();
    }
    // representative statistics mobile + desktop
    for (const [width, theme] of [[390, 'light'], [1440, 'dark']]) {
      const context = await browser.newContext({ locale: 'ko-KR', viewport: { width, height: 900 }, colorScheme: theme === 'light' ? 'light' : 'dark' });
      await context.route('https://dapi.kakao.com/**', r => r.fulfill({ contentType: 'text/javascript', body: MOCK_SDK }));
      await context.addInitScript(({ session, theme }) => { localStorage.setItem('cm-map-auth-v1', JSON.stringify(session)); localStorage.setItem('cm-theme', theme); }, { session: fakeSession(), theme });
      const page = await context.newPage();
      await page.goto(`${ORIGIN}/?screen=statistics`);
      await page.locator('.pivot-table tbody tr, .stats-builder, .statistics-page').first().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
      await sleep(800);
      const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
      check(`D-stats-${width}-${theme}`, noOverflow, `overflow check`);
      await shot(page, `D-statistics-${width}-${theme}`);
      await context.close();
    }
    await fetch(`${ORIGIN}/__e2e/reset`, { method: 'POST' });
  }

  // ---- E. keyboard focus (representative) ----
  {
    const context = await browser.newContext({ locale: 'ko-KR', viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
    await context.route('https://dapi.kakao.com/**', r => r.fulfill({ contentType: 'text/javascript', body: MOCK_SDK }));
    await context.addInitScript(({ session }) => { localStorage.setItem('cm-map-auth-v1', JSON.stringify(session)); localStorage.setItem('cm-theme', 'dark'); }, { session: fakeSession() });
    const page = await context.newPage();
    await page.goto(`${ORIGIN}/?screen=map`);
    await attachRankingFixture(context);
    await page.goto(`${ORIGIN}/?screen=rankings`);
    await rkRows(page).first().waitFor({ state: 'visible', timeout: 20000 });
    // focus first tab button directly (representative keyboard path), then keyboard-activate
    await page.locator('.rk-tabs button').first().focus();
    const inTabs = await page.evaluate(() => !!document.activeElement?.closest?.('.rk-tabs'));
    const focusVisible = await page.evaluate(() => { const e = document.activeElement; if (!e) return false; const s = getComputedStyle(e); return s.outlineStyle !== 'none' || s.boxShadow !== 'none' || e.matches(':focus-visible'); });
    await page.keyboard.press('Enter');
    await sleep(500);
    check('E-keyboard-focus', inTabs && focusVisible, `inTabs=${inTabs} visible=${focusVisible}`);
    await shot(page, 'E-keyboard-focus');
    await context.close();
  }

  // ---- F. delayed response latest-intent (900ms fines vs immediate unlucky) ----
  {
    const context = await browser.newContext({ locale: 'ko-KR', viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
    await context.route('https://dapi.kakao.com/**', r => r.fulfill({ contentType: 'text/javascript', body: MOCK_SDK }));
    await context.addInitScript(({ session }) => { localStorage.setItem('cm-map-auth-v1', JSON.stringify(session)); localStorage.setItem('cm-theme', 'dark'); }, { session: fakeSession() });
    const page = await context.newPage();
    await page.goto(`${ORIGIN}/?screen=map`);
    await context.route('**/functions/v1/user-rankings?*', async route => {
      const q = new URL(route.request().url()).searchParams;
      const ms = q.get('theme') === 'fines' ? 900 : 0;
      if (ms) await new Promise(r => setTimeout(r, ms));
      const { rankingFixture } = await import('/home/better0101/projects/safetyreport-community-map/.agent-runtime/worktrees/muse-recheck/scripts/browser/ranking_fixture.mjs');
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'cache-control': 'private, no-store' }, body: JSON.stringify(rankingFixture(q, E2E_UID)) }).catch(() => {});
    });
    await page.goto(`${ORIGIN}/?screen=rankings`);
    await rkRows(page).first().waitFor({ state: 'visible', timeout: 20000 });
    const rk = page.locator('.rk-page');
    await rk.getByRole('button', { name: '과태료 랭킹', exact: true }).click(); // slow (900ms)
    await sleep(150); // before fines resolves, express newer intent
    const wLatest = page.waitForResponse(r => r.url().includes('/functions/v1/user-rankings') && new URL(r.url()).searchParams.get('theme') === 'unlucky');
    await rk.getByRole('button', { name: '불운 랭킹', exact: true }).click();
    await wLatest;
    await rkRows(page).first().waitFor({ state: 'visible', timeout: 20000 });
    await sleep(1100); // let stale fines arrive; guard must hold
    const themeNow = new URL(page.url()).searchParams.get('rk_theme');
    const sub = await rk.locator('.rk-sub').innerText().catch(() => '');
    check('F-latest-intent', themeNow === 'unlucky', `rk_theme=${themeNow} sub=${sub.slice(0, 40)}`);
    await shot(page, 'F-latest-intent');
    await context.close();
  }

  // ---- G. one-shot 429: cooldown + latest-intent auto-resume ----
  {
    const context = await browser.newContext({ locale: 'ko-KR', viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
    await context.route('https://dapi.kakao.com/**', r => r.fulfill({ contentType: 'text/javascript', body: MOCK_SDK }));
    await context.addInitScript(({ session }) => { localStorage.setItem('cm-map-auth-v1', JSON.stringify(session)); localStorage.setItem('cm-theme', 'dark'); }, { session: fakeSession() });
    const page = await context.newPage();
    await page.goto(`${ORIGIN}/?screen=map`);
    await attachRankingFixture(context);
    await page.goto(`${ORIGIN}/?screen=rankings`);
    await rkRows(page).first().waitFor({ state: 'visible', timeout: 20000 });
    // arm the one-shot 429 AFTER entry completes, so the fines click consumes it
    let once429 = true;
    await context.route('**/functions/v1/user-rankings?*', async route => {
      if (once429) { once429 = false; await route.fulfill({ status: 429, contentType: 'application/json', headers: { 'retry-after': '2' }, body: JSON.stringify({ error: { code: 'RATE_LIMITED' } }) }).catch(() => {}); return; }
      await route.fallback().catch(() => {});
    });
    const rk = page.locator('.rk-page');
    await rk.getByRole('button', { name: '과태료 랭킹', exact: true }).click(); // gets the 429
    const cooldown = rk.getByRole('button', { name: /초 뒤 다시 시도/ });
    let sawCooldown = false;
    try { await cooldown.waitFor({ timeout: 5000 }); sawCooldown = await cooldown.isDisabled(); } catch { sawCooldown = false; }
    const coolText = sawCooldown ? await cooldown.innerText().catch(() => '') : 'none';
    // mid-cooldown clicks fire nothing extra
    const netBefore = await page.evaluate(() => performance.getEntriesByType('resource').filter(e => e.name.includes('user-rankings')).length);
    await rk.getByRole('button', { name: '불운 랭킹', exact: true }).click().catch(() => {});
    await sleep(600);
    const netAfter = await page.evaluate(() => performance.getEntriesByType('resource').filter(e => e.name.includes('user-rankings')).length);
    check('G-429-cooldown', sawCooldown && netAfter === netBefore, `cooldown=${coolText} net=${netBefore}->${netAfter}`);
    // auto-resume applies latest intent (unlucky)
    await rkRows(page).first().waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
    await page.waitForFunction(() => new URLSearchParams(location.search).get('rk_theme') === 'unlucky', null, { timeout: 15000 }).catch(() => {});
    const resumed = new URL(page.url()).searchParams.get('rk_theme');
    check('G-429-latest-intent', resumed === 'unlucky', `rk_theme=${resumed}`);
    await shot(page, 'G-429-recovery');
    await context.close();
  }
} finally {
  writeFileSync(`${OUT}/results.json`, JSON.stringify({ commit: '2cd5442', origin: ORIGIN, mode: 'headless Chromium, E2E_PORT=5191 mock stack, ranking fixture attached before rankings entry; no real DB', consoleErrors, results }, null, 2));
  console.log(`TOTAL pass=${results.filter(r => r.status === 'PASS').length} fail=${results.filter(r => r.status === 'FAIL').length}`);
  await browser.close();
}
if (results.some(r => r.status === 'FAIL')) process.exit(1);
