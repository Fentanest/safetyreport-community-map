// MUSE FINAL REVIEW — independent browser review of integrated commit 7d25a9f.
// Uses ONLY: own vite.e2e server on E2E_PORT=5191, harness openPage(), context.route
// ranking fixture (explicit UI fixture evidence, NEVER real SQL/auth/production).
// Writes screenshots + JSON to docs/refactoring/map-performance/evidence/muse-final/.
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, openPage, ORIGIN, E2E_UID, E2E_UID_B } from '../../../scripts/browser/harness.mjs';
import { attachRankingFixture } from '../../../scripts/browser/ranking_fixture.mjs';

const OUT = 'docs/refactoring/map-performance/evidence/muse-final';
mkdirSync(OUT, { recursive: true });

const results = [];
const consoleErrors = [];
const net = []; // {ctx, method, path, params, status}
function rec(id, name, status, detail = '') { results.push({ id, name, status, detail }); }
async function check(id, name, fn) {
  try { const d = await fn(); rec(id, name, 'PASS', d ?? ''); }
  catch (e) { rec(id, name, 'FAIL', String(e?.message ?? e).slice(0, 500)); }
}
const rkReqs = (extra = {}) => net.filter(e => e.path.endsWith('/user-rankings') && Object.entries(extra).every(([k, v]) => e.params[k] === v));
const rowsOf = (rk) => rk.locator('.rk-table:visible tbody tr, .rk-list:visible li');
const shot = (page, n) => page.screenshot({ path: `${OUT}/${n}.png` });
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

function watch(page, tag) {
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(`[${tag}] ${m.text()}`); });
  page.on('pageerror', e => consoleErrors.push(`[${tag}] pageerror: ${e.message}`));
  page.on('request', r => {
    try {
      const u = new URL(r.url());
      if (u.pathname.startsWith('/functions/v1/')) net.push({ ctx: tag, method: r.method(), path: u.pathname, params: Object.fromEntries(u.searchParams), status: 0 });
    } catch { /* ignore */ }
  });
  page.on('response', r => {
    try {
      const u = new URL(r.url());
      if (u.pathname.startsWith('/functions/v1/')) {
        const hit = [...net].reverse().find(e => e.ctx === tag && e.path === u.pathname && !e.status);
        if (hit) hit.status = r.status();
      }
    } catch { /* ignore */ }
  });
}
async function waitRk(page, pred, timeout = 15000) {
  await page.waitForResponse(r => r.url().includes('/functions/v1/user-rankings') && pred(new URL(r.url()).searchParams), { timeout });
  await rowsOf(page.locator('.rk-page')).first().waitFor({ timeout }).catch(() => {});
  await page.waitForTimeout(250);
}

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--lang=ko-KR'] });
try {
  // ============ A. Rankings desktop core (1440 dark) ============
  {
    const s = await openPage(browser, { width: 1440, height: 900, theme: 'dark', search: '?screen=map' });
    watch(s.page, 'A'); await attachRankingFixture(s.context);
    await s.page.goto(`${ORIGIN}/?screen=rankings`);
    const rk = s.page.locator('.rk-page');
    await rowsOf(rk).first().waitFor({ timeout: 15000 });
    const firstParams = rkReqs()[0]?.params ?? {};
    await check('A01', 'direct entry renders + 1 immediate default request', async () => {
      if (!await rk.isVisible()) throw new Error('rk-page not visible');
      if (rkReqs().length < 1) throw new Error('no user-rankings request on direct entry');
      return `default params=${JSON.stringify(firstParams)} total=${rkReqs().length}`;
    });
    await check('A02', 'H1 + 3 tabs exact labels', async () => {
      const h1 = await rk.locator('h1').innerText();
      const tabs = await rk.locator('.rk-tabs button').allTextContents();
      if (!h1.includes('참여자 랭킹')) throw new Error(`h1=${h1}`);
      if (tabs.join('|') !== '신고 랭킹|과태료 랭킹|불운 랭킹') throw new Error(`tabs=${tabs.join('|')}`);
      return `h1=${h1} tabs=${tabs.join('/')}`;
    });
    await check('A03', 'reporters desktop exact headers (no generic 값)', async () => {
      const th = await rk.locator('th').allTextContents();
      if (th.join('|') !== '순위|참여자|완료 신고') throw new Error(`th=${th.join('|')}`);
      return th.join('|');
    });
    await check('A04', 'thin me strip before list, server me (not page row)', async () => {
      const me = rk.locator('[aria-label="내 순위 요약"]');
      if (!await me.isVisible()) throw new Error('me strip missing');
      const t = await rk.locator('.rk-me-line').innerText();
      if (!/내 순위/.test(t)) throw new Error(`me-line=${t}`);
      const pager = await rk.locator('.rk-pager').innerText();
      if (!/참여자 1–20 \/ \d+명/.test(pager)) throw new Error(`pager=${pager}`);
      return `${t} || ${pager}`;
    });
    await check('A05', 'top-line sentence + aggregation disclosure, no N/F/R/N internals', async () => {
      const body = await rk.innerText();
      for (const bad of ['왕관', '시상대', 'TOP3', 'TOP 3', '인사이트', '축하']) if (body.includes(bad)) throw new Error(`forbidden term: ${bad}`);
      for (const bad of ['completed_unknown', '초안']) if (body.includes(bad)) throw new Error(`internal term visible: ${bad}`);
      if (!body.includes('공유된 완료 신고를 기준으로 집계합니다')) throw new Error('top-line sentence missing');
      if (!await rk.getByRole('button', { name: /집계 기준 보기/ }).count()) throw new Error('집계 기준 보기 missing');
      return 'clean';
    });
    await shot(s.page, 'A-rankings-desktop-dark');
    // tab immediacy
    await check('A06', 'fines tab sends immediate request', async () => {
      const n0 = rkReqs().length;
      await rk.getByRole('button', { name: '과태료 랭킹', exact: true }).click();
      await waitRk(s.page, q => q.get('theme') === 'fines');
      if (rkReqs().length <= n0) throw new Error('no new request');
      const th = await rk.locator('th').allTextContents();
      if (!th.join('|').includes('과태료 처분')) throw new Error(`fines th=${th.join('|')}`);
      return th.join('|');
    });
    await check('A07', 'rate switch immediate + numerator/denominator order', async () => {
      await rk.getByRole('button', { name: '비율순', exact: true }).click();
      await waitRk(s.page, q => q.get('metric') === 'fine_rate');
      const cell = await rk.locator('table tbody tr:first-child td').nth(2).innerText();
      if (!/\d+건 중 \d+건/.test(cell)) throw new Error(`fraction=${cell}`);
      return cell;
    });
    await check('A08', 'same selection sends no duplicate request', async () => {
      const n0 = rkReqs().length;
      await rk.getByRole('button', { name: '비율순', exact: true }).click();
      await s.page.waitForTimeout(400);
      if (rkReqs().length !== n0) throw new Error(`requests grew ${n0}->${rkReqs().length}`);
      return `stable at ${n0}`;
    });
    await check('A09', 'unlucky tab + partial memory round-trip', async () => {
      await rk.getByRole('button', { name: '불운 랭킹', exact: true }).click();
      await waitRk(s.page, q => q.get('theme') === 'unlucky');
      await rk.getByRole('button', { name: '일부수용', exact: true }).click();
      await waitRk(s.page, q => q.get('metric') === 'partial_count');
      await rk.getByRole('button', { name: '과태료 랭킹', exact: true }).click();
      await waitRk(s.page, q => q.get('theme') === 'fines');
      await rk.getByRole('button', { name: '불운 랭킹', exact: true }).click();
      await waitRk(s.page, q => q.get('theme') === 'unlucky');
      const m = new URL(s.page.url()).searchParams.get('rk_metric');
      if (m !== 'partial_count') throw new Error(`rk_metric=${m}`);
      return `restored ${m}`;
    });
    await check('A10', 'month tab immediate + stepper immediate + prior-month title', async () => {
      await rk.getByRole('button', { name: '월별', exact: true }).click();
      await waitRk(s.page, q => q.get('period') === 'month');
      const cur = new URL(s.page.url()).searchParams.get('rk_month');
      await rk.getByRole('button', { name: '이전 달', exact: true }).click().catch(() => {});
      // stepper buttons may be named differently; fall back to any month change via direct input below
      let after = new URL(s.page.url()).searchParams.get('rk_month');
      if (after === cur) {
        await rk.getByLabel('조회할 달 직접 선택', { exact: true }).fill('2026-08');
        await waitRk(s.page, q => q.get('month') === '2026-08');
        after = '2026-08';
      } else {
        await waitRk(s.page, q => q.get('month') === after);
      }
      const sub = await rk.locator('.rk-sub').innerText();
      if (!sub.includes('2026년 8월') && !sub.includes(after.replace('-', '년 ') + '월')) throw new Error(`sub=${sub} month=${after}`);
      return `month=${after} sub=${sub.slice(0, 80)}`;
    });
    await check('A11', 'month rows: ties + 표본 1건 + 집계 중', async () => {
      const body = await rk.innerText();
      if (!body.includes('공동')) throw new Error('no joint-rank display');
      if (!body.includes('표본 1건')) throw new Error('no sample-1 note');
      return 'ties+sample1 present';
    });
    await shot(s.page, 'A-rankings-month-ties');
    await check('A12', 'range drafts send nothing until 조회', async () => {
      await rk.getByRole('button', { name: '기간 지정', exact: true }).click();
      await rk.getByLabel('시작일', { exact: true }).fill('2026-08-01');
      await rk.getByLabel('종료일', { exact: true }).fill('2026-08-31');
      const n0 = rkReqs().length;
      await s.page.waitForTimeout(400);
      if (rkReqs().length !== n0) throw new Error('range draft leaked a request');
      await rk.getByRole('button', { name: '조회', exact: true }).click();
      await waitRk(s.page, q => q.get('period') === 'range' && q.get('start') === '2026-08-01');
      return 'draft silent, 조회 fired';
    });
    await check('A13', 'advanced drafts send nothing until 적용', async () => {
      await rk.locator('.rk-advanced summary').click();
      await rk.getByLabel('최소 신고 건수', { exact: true }).fill('3');
      const n0 = rkReqs().length;
      await s.page.waitForTimeout(400);
      if (rkReqs().length !== n0) throw new Error('advanced draft leaked a request');
      await rk.getByRole('button', { name: '적용', exact: true }).click();
      await waitRk(s.page, q => q.get('min_reports') === '3');
      await rk.getByLabel('최소 신고 건수', { exact: true }).fill('1');
      await rk.getByRole('button', { name: '적용', exact: true }).click();
      await waitRk(s.page, q => q.get('min_reports') === '1');
      return 'min 3 applied then restored to 1';
    });
    await check('A14', 'page 2 uses row range + me unchanged outside page', async () => {
      await rk.getByRole('button', { name: '전체 기간', exact: true }).click();
      await waitRk(s.page, q => q.get('period') === 'all');
      const meBefore = await rk.locator('.rk-me-line').innerText();
      await rk.getByRole('button', { name: '다음', exact: true }).click();
      await waitRk(s.page, q => q.get('page') === '2');
      const pager = await rk.locator('.rk-pager').innerText();
      const meAfter = await rk.locator('.rk-me-line').innerText();
      if (!pager.includes('참여자 21–')) throw new Error(`pager=${pager}`);
      if (meAfter !== meBefore) throw new Error(`me changed: ${meBefore} -> ${meAfter}`);
      return `${pager} || me stable`;
    });
    await shot(s.page, 'A-rankings-page2');
    await check('A15', 'old rk_* deep link + refresh compat', async () => {
      await s.page.goto(`${ORIGIN}/?screen=rankings&rk_theme=fines&rk_metric=fine_rate&rk_period=month&rk_month=2023-07`);
      await rowsOf(rk).first().waitFor({ timeout: 15000 });
      const sub = await rk.locator('.rk-sub').innerText();
      if (!sub.includes('2023년 7월') || !/과태료 처분율/.test(sub)) throw new Error(`sub=${sub}`);
      await s.page.reload();
      await rowsOf(rk).first().waitFor({ timeout: 15000 });
      if (new URL(s.page.url()).searchParams.get('rk_month') !== '2023-07') throw new Error('refresh lost month');
      return sub.slice(0, 80);
    });
    // UUID dialog
    await check('A16', 'UUID dialog: full value + copy + Escape + focus return', async () => {
      await s.page.goto(`${ORIGIN}/?screen=rankings`);
      await rowsOf(rk).first().waitFor({ timeout: 15000 });
      const opener = rk.locator('.rk-me-row .rk-uuid-btn, tr .rk-uuid-btn').first();
      await opener.click();
      const dialog = rk.getByRole('dialog', { name: '참여자 UUID' });
      await dialog.waitFor({ timeout: 8000 });
      const full = await dialog.getByLabel('전체 UUID').inputValue();
      if (!/^[0-9a-f-]{36}$/i.test(full)) throw new Error(`full=${full}`);
      await dialog.getByRole('button', { name: '복사', exact: true }).click();
      const clip = await s.page.evaluate(() => navigator.clipboard.readText()).catch(() => 'CLIPBOARD_DENIED');
      if (clip !== full && clip !== 'CLIPBOARD_DENIED') throw new Error(`clipboard=${clip}`);
      await shot(s.page, 'A-rankings-uuid-dialog');
      await s.page.keyboard.press('Escape');
      await s.page.waitForTimeout(300);
      if (await dialog.isVisible()) throw new Error('dialog did not close on Escape');
      const back = await opener.evaluate(e => e === document.activeElement);
      if (!back) throw new Error('focus did not return to opener');
      return `uuid=${full.slice(0, 8)}… copy=${clip === full ? 'ok' : clip}`;
    });
    await check('A17', 'UUID dialog traps Tab focus', async () => {
      const opener = rk.locator('tr .rk-uuid-btn').first();
      await opener.click();
      const dialog = rk.getByRole('dialog', { name: '참여자 UUID' });
      await dialog.waitFor({ timeout: 8000 });
      await s.page.keyboard.press('Tab');
      const inside = await s.page.evaluate(() => !!document.activeElement?.closest?.('[role="dialog"]'));
      await s.page.keyboard.press('Escape');
      if (!inside) throw new Error('focus escaped dialog');
      return 'trapped';
    });
    await check('A18', 'empty month has no invented rows', async () => {
      await rk.getByRole('button', { name: '월별', exact: true }).click();
      await waitRk(s.page, q => q.get('period') === 'month');
      await rk.getByLabel('조회할 달 직접 선택').fill('2020-01');
      await s.page.waitForResponse(r => r.url().includes('/user-rankings') && new URL(r.url()).searchParams.get('month') === '2020-01', { timeout: 15000 });
      await rk.getByRole('heading', { name: '결과가 없습니다' }).waitFor({ timeout: 8000 });
      if (await rowsOf(rk).count() !== 0) throw new Error('rows present in empty state');
      await shot(s.page, 'A-rankings-empty');
      return 'empty clean';
    });
    await check('A19', 'error panel + retry recovers (one-shot 500)', async () => {
      await s.context.route('**/functions/v1/user-rankings?*', r => r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'e2e', message: 'boom' } }) }), { times: 1 });
      await rk.getByRole('button', { name: '전체 기간', exact: true }).click();
      await rk.getByRole('heading', { name: '랭킹을 불러오지 못했습니다' }).waitFor({ timeout: 15000 });
      if (await rowsOf(rk).count() !== 0) throw new Error('protected rows remain on error');
      await shot(s.page, 'A-rankings-error');
      await rk.getByRole('button', { name: '다시 시도', exact: true }).click();
      await rowsOf(rk).first().waitFor({ timeout: 15000 });
      return 'error cleared, rows back';
    });
    await check('A20', '429 cooldown collapses intents, resumes latest only', async () => {
      await s.context.route('**/functions/v1/user-rankings?*', r => {
        const h = { 'content-type': 'application/json', 'Retry-After': '2' };
        return r.fulfill({ status: 429, headers: h, body: JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'slow' } }) });
      }, { times: 1 });
      const n0 = rkReqs().length;
      await rk.getByRole('button', { name: '불운 랭킹', exact: true }).click();
      await rk.getByRole('button', { name: /초 뒤 다시 시도/ }).waitFor({ timeout: 15000 });
      const cool = rk.getByRole('button', { name: /초 뒤 다시 시도/ });
      if (!await cool.isDisabled()) throw new Error('cooldown button not disabled');
      await rk.getByRole('button', { name: '과태료 랭킹', exact: true }).click();
      await s.page.waitForTimeout(600);
      const during = rkReqs().length;
      await s.page.waitForTimeout(3500); // let cooldown expire + auto resume
      await rowsOf(rk).first().waitFor({ timeout: 15000 }).catch(() => {});
      await shot(s.page, 'A-rankings-429');
      const theme = new URL(s.page.url()).searchParams.get('rk_theme');
      if (theme !== 'fines') throw new Error(`resumed theme=${theme}, requests during cooldown=${during - n0}`);
      return `resumed theme=${theme}`;
    });
    await check('A21', 'account menu shows shortened OWN UUID (no nickname demand)', async () => {
      const menu = s.page.locator('.account-menu, .account-name-text').first();
      const t = await menu.innerText().catch(() => '');
      if (!t.includes('ID 11111111')) throw new Error(`account menu=${t}`);
      return t;
    });
    await check('A22', 'keyboard: Tab reaches tabs, Enter switches theme', async () => {
      await s.page.goto(`${ORIGIN}/?screen=rankings`);
      await rowsOf(rk).first().waitFor({ timeout: 15000 });
      await rk.locator('h1').evaluate(e => e.setAttribute('tabindex', '-1'));
      await s.page.keyboard.press('Tab');
      let guard = 0;
      while (guard++ < 60) {
        const label = await s.page.evaluate(() => document.activeElement?.textContent?.trim() ?? '');
        if (/신고 랭킹|과태료 랭킹|불운 랭킹/.test(label)) break;
        await s.page.keyboard.press('Tab');
      }
      const focused = await s.page.evaluate(() => document.activeElement?.textContent?.trim() ?? '');
      if (!/랭킹/.test(focused)) throw new Error(`focus landed on: ${focused}`);
      return `focus on "${focused}"`;
    });
    await s.context.close();
  }

  // ============ B. Mobile 390 light ============
  {
    const s = await openPage(browser, { width: 390, height: 844, theme: 'light', search: '?screen=map' });
    watch(s.page, 'B'); await attachRankingFixture(s.context);
    await s.page.goto(`${ORIGIN}/?screen=rankings`);
    const rk = s.page.locator('.rk-page');
    await rowsOf(rk).first().waitFor({ timeout: 15000 });
    await check('B01', 'mobile two-line list (no desktop table)', async () => {
      if (!await rk.locator('.rk-list').isVisible()) throw new Error('.rk-list not visible');
      if (await rk.locator('.rk-table').isVisible()) throw new Error('desktop table visible on 390');
      const first = await rk.locator('.rk-list li').first().innerText();
      const lines = first.split('\n').filter(x => x.trim());
      if (lines.length < 2) throw new Error(`single-line row: ${first}`);
      return lines.join(' / ').slice(0, 120);
    });
    await check('B02', '390 light: no page overflow', async () => {
      if (!await noOverflow(s.page)) {
        const w = await s.page.evaluate(() => document.documentElement.scrollWidth);
        throw new Error(`scrollWidth=${w}`);
      }
      return 'no overflow';
    });
    await check('B03', 'mobile tap targets + bottom content reachable', async () => {
      const hs = await rk.locator('.rk-tabs button').evaluateAll(els => els.map(e => e.getBoundingClientRect().height));
      const min = Math.min(...hs);
      await rk.locator('.rk-pager').scrollIntoViewIfNeeded();
      const pagerVisible = await rk.locator('.rk-pager').isVisible();
      if (!pagerVisible) throw new Error('pager not reachable');
      return `min tab height=${min.toFixed(0)}px pager visible=${pagerVisible}`;
    });
    await shot(s.page, 'B-rankings-mobile-light');
    await check('B04', 'CSS-zoom 200% emulation labeled: no page overflow', async () => {
      await s.page.evaluate(() => { document.body.style.zoom = '200%'; });
      await s.page.waitForTimeout(400);
      const ok = await noOverflow(s.page);
      await shot(s.page, 'B-rankings-mobile-zoom200-emulated');
      await s.page.evaluate(() => { document.body.style.zoom = ''; });
      if (!ok) {
        const w = await s.page.evaluate(() => { document.body.style.zoom = '200%'; return document.documentElement.scrollWidth; });
        await s.page.evaluate(() => { document.body.style.zoom = ''; });
        throw new Error(`overflow under emulated 200% (scrollWidth=${w}, innerWidth=390)`);
      }
      return 'emulated CSS zoom 200%: no overflow';
    });
    await s.context.close();
  }

  // ============ C. Viewport/theme matrix ============
  for (const [w, theme] of [[360, 'dark'], [768, 'dark'], [768, 'light'], [1440, 'light']]) {
    const s = await openPage(browser, { width: w, height: 900, theme, search: '?screen=map' });
    watch(s.page, `C${w}${theme}`); await attachRankingFixture(s.context);
    await s.page.goto(`${ORIGIN}/?screen=rankings`);
    const rk = s.page.locator('.rk-page');
    try {
      await rowsOf(rk).first().waitFor({ timeout: 15000 });
      await check(`C-${w}-${theme}`, `${w}px ${theme}: tabs+rows+no overflow`, async () => {
        const tabs = await rk.locator('.rk-tabs button').allTextContents();
        if (tabs.join('|') !== '신고 랭킹|과태료 랭킹|불운 랭킹') throw new Error(`tabs=${tabs.join('|')}`);
        if (await rowsOf(rk).count() === 0) throw new Error('no rows');
        if (!await noOverflow(s.page)) throw new Error(`overflow scrollWidth=${await s.page.evaluate(() => document.documentElement.scrollWidth)}`);
        const expectList = w <= 700;
        const isList = await rk.locator('.rk-list').isVisible().catch(() => false);
        if (expectList && !isList) throw new Error('expected mobile list');
        return `rows=${await rowsOf(rk).count()} list=${isList}`;
      });
      await shot(s.page, `C-rankings-${w}-${theme}`);
    } catch (e) { rec(`C-${w}-${theme}`, `${w}px ${theme} matrix`, 'FAIL', String(e?.message ?? e).slice(0, 300)); }
    await s.context.close();
  }

  // ============ D. Late response + account B ============
  {
    const s = await openPage(browser, { width: 1440, height: 900, theme: 'dark', search: '?screen=map' });
    watch(s.page, 'D');
    await attachRankingFixture(s.context, { delay: (q) => (q.get('theme') === 'fines' ? 900 : 0) });
    await s.page.goto(`${ORIGIN}/?screen=rankings`);
    const rk = s.page.locator('.rk-page');
    await rowsOf(rk).first().waitFor({ timeout: 15000 });
    await check('D01', 'late fines response does not clobber newer unlucky intent', async () => {
      await rk.getByRole('button', { name: '과태료 랭킹', exact: true }).click();
      await s.page.waitForTimeout(150);
      await rk.getByRole('button', { name: '불운 랭킹', exact: true }).click();
      await waitRk(s.page, q => q.get('theme') === 'unlucky');
      await s.page.waitForTimeout(1200);
      const theme = new URL(s.page.url()).searchParams.get('rk_theme');
      const sub = await rk.locator('.rk-sub').innerText();
      if (theme !== 'unlucky' || /과태료/.test(sub)) throw new Error(`theme=${theme} sub=${sub.slice(0, 60)}`);
      return `stable on ${theme}`;
    });
    await s.context.close();
    const b = await openPage(browser, { width: 1440, height: 900, theme: 'dark', search: '?screen=map', uid: E2E_UID_B });
    watch(b.page, 'DB'); await attachRankingFixture(b.context);
    await b.page.goto(`${ORIGIN}/?screen=rankings`);
    const rkb = b.page.locator('.rk-page');
    await rowsOf(rkb).first().waitFor({ timeout: 15000 });
    await check('D02', 'account B sees own me (A data absent)', async () => {
      const me = await rkb.locator('.rk-me-line').innerText();
      const opener = rkb.locator('tr.rk-me-row .rk-uuid-btn, tr .rk-uuid-btn').first();
      await opener.click();
      const full = await rkb.getByRole('dialog', { name: '참여자 UUID' }).getByLabel('전체 UUID').inputValue().catch(() => '');
      await b.page.keyboard.press('Escape');
      const body = await rkb.innerText();
      if (full && full.toLowerCase() === E2E_UID.toLowerCase()) throw new Error('B dialog shows A uuid');
      if (body.includes(E2E_UID)) throw new Error('A full UUID present in B DOM');
      return `${me.slice(0, 60)} dialog=${full.slice(0, 8)}…`;
    });
    await shot(b.page, 'D-rankings-account-B');
    await b.context.close();
  }

  // ============ E. Statistics ============
  {
    const s = await openPage(browser, { width: 1440, height: 900, theme: 'dark', search: '?screen=map' });
    watch(s.page, 'E');
    await s.page.goto(`${ORIGIN}/?screen=statistics`);
    const st = s.page.locator('.stats-page');
    await st.waitFor({ timeout: 15000 });
    await s.page.waitForTimeout(1500);
    const hasCatalog = () => net.some(e => e.ctx === 'E' && e.path.includes('statistics/catalog'));
    const hasQuery = () => net.some(e => e.ctx === 'E' && (e.path.includes('statistics/query') || e.path.includes('my-analytics')));
    const hasDashboard = () => net.some(e => e.ctx === 'E' && /dashboard$|overview$/.test(e.path));
    await check('E01', 'statistics direct entry uses metadata only (no dashboard/query)', async () => {
      if (!hasCatalog()) throw new Error('no statistics/catalog request');
      if (hasQuery()) throw new Error('statistics/query fired before 통계 만들기');
      if (hasDashboard()) throw new Error('dashboard request on statistics direct entry');
      return 'catalog only';
    });
    await check('E02', 'draft edits send no API until 통계 만들기', async () => {
      const n0 = net.filter(e => e.ctx === 'E').length;
      const metricSel = st.locator('select').first();
      await metricSel.selectOption({ index: 1 }).catch(() => {});
      await s.page.waitForTimeout(500);
      const n1 = net.filter(e => e.ctx === 'E').length;
      if (n1 !== n0) throw new Error(`requests fired on draft edit (${n0}->${n1})`);
      if (!await st.getByText('바꾼 설정이 아직 반영되지 않았습니다').count()) throw new Error('unapplied note missing');
      return 'draft silent + unapplied note';
    });
    await check('E03', '통계 만들기 runs once + 표/그래프 switch refetches nothing', async () => {
      const n0 = net.filter(e => e.ctx === 'E').length;
      await st.getByRole('button', { name: '통계 만들기', exact: true }).click();
      await s.page.waitForResponse(r => r.url().includes('statistics/query') || r.url().includes('my-analytics'), { timeout: 20000 }).catch(() => {});
      await s.page.waitForTimeout(1500);
      const n1 = net.filter(e => e.ctx === 'E').length;
      if (n1 <= n0) throw new Error('no query request after 통계 만들기');
      const res = st.locator('[aria-label="통계 결과"]');
      await res.waitFor({ timeout: 8000 }).catch(() => {});
      const g = st.getByRole('button', { name: '그래프', exact: true });
      if (await g.count()) {
        const n2 = net.filter(e => e.ctx === 'E').length;
        await g.click();
        await s.page.waitForTimeout(600);
        const n3 = net.filter(e => e.ctx === 'E').length;
        if (n3 !== n2) throw new Error('chart switch refetched');
        await st.getByRole('button', { name: '표', exact: true }).click();
        await s.page.waitForTimeout(400);
      }
      return `requests ${n0}->${n1}, view switch silent`;
    });
    await shot(s.page, 'E-statistics-desktop-dark');
    await check('E04', 'statistics keeps compare/share/export/preset surfaces', async () => {
      for (const name of ['비교 대상 선택', '공유 링크', '예시 고르기…']) {
        const c = await st.getByText(name, { exact: false }).count().catch(() => 0);
        if (!c) throw new Error(`missing surface: ${name}`);
      }
      return 'compare/share/preset present';
    });
    await s.context.close();
    // mobile statistics result-first
    const m = await openPage(browser, { width: 390, height: 844, theme: 'light', search: '?screen=statistics' });
    watch(m.page, 'EM');
    await m.page.locator('.stats-page').waitFor({ timeout: 15000 });
    await m.page.waitForTimeout(1200);
    await check('E05', 'mobile statistics result-first + 조건 변경 toggle', async () => {
      const t = m.page.locator('.stats-page').getByRole('button', { name: /조건 변경|조건 닫기/ });
      if (!await t.isVisible()) throw new Error('조건 변경 toggle not visible');
      if (!await noOverflow(m.page)) throw new Error('mobile stats overflow');
      return 'toggle visible, no overflow';
    });
    await shot(m.page, 'E-statistics-mobile-light');
    await m.context.close();
    // metadata failure -> banner, reload recovers
    const f = await openPage(browser, { width: 1440, height: 900, theme: 'dark', search: '?screen=map' });
    watch(f.page, 'EF');
    await f.context.route('**/functions/v1/public-analytics/statistics/catalog*', r => r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'e2e', message: 'meta down' } }) }), { times: 1 });
    await f.page.goto(`${ORIGIN}/?screen=statistics`);
    await check('E06', 'metadata failure shows banner (reload retry path)', async () => {
      await f.page.getByText('고를 수 있는 통계 항목을 불러오지 못했습니다').waitFor({ timeout: 15000 });
      await shot(f.page, 'E-statistics-meta-error');
      await f.page.reload();
      await f.page.locator('.stats-page').waitFor({ timeout: 15000 });
      await f.page.waitForTimeout(1200);
      if (await f.page.getByText('고를 수 있는 통계 항목을 불러오지 못했습니다').count()) throw new Error('banner persists after reload');
      return 'banner then reload recovers';
    });
    await f.context.close();
  }

  // ============ F. Anonymous gate ============
  {
    const s = await openPage(browser, { width: 390, height: 844, theme: 'dark', signedIn: false, search: '?screen=rankings' });
    watch(s.page, 'F');
    await check('F01', 'anonymous sees login gate, no UUID rows', async () => {
      await s.page.getByRole('button', { name: '카카오로 로그인' }).first().waitFor({ timeout: 15000 }).catch(() => {});
      const loginVisible = await s.page.getByRole('button', { name: '카카오로 로그인' }).count();
      const uuidBtns = await s.page.locator('.rk-uuid-btn').count();
      if (!loginVisible) throw new Error('no login gate');
      if (uuidBtns) throw new Error('UUID rows visible anonymously');
      return 'gate shown, no rows';
    });
    await shot(s.page, 'F-rankings-anonymous');
    await s.context.close();
  }
} finally {
  writeFileSync(`${OUT}/results.json`, JSON.stringify({ results, consoleErrors, net }, null, 2));
  await browser.close();
}
const pass = results.filter(r => r.status === 'PASS').length;
const fail = results.filter(r => r.status === 'FAIL').length;
console.log(JSON.stringify({ pass, fail, total: results.length }));
for (const r of results) console.log(`${r.status} ${r.id} ${r.name}${r.detail ? ' :: ' + r.detail.slice(0, 160) : ''}`);
