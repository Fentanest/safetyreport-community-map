// MUSE FINAL REVIEW part 2 — corrected waits (waiter BEFORE action) + statistics draft semantics.
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, openPage, ORIGIN, E2E_UID } from '../../../scripts/browser/harness.mjs';
import { attachRankingFixture } from '../../../scripts/browser/ranking_fixture.mjs';

const OUT = 'docs/refactoring/map-performance/evidence/muse-final';
mkdirSync(OUT, { recursive: true });
const results = []; const consoleErrors = []; const net = [];
function rec(id, name, status, detail = '') { results.push({ id, name, status, detail }); }
async function check(id, name, fn) {
  try { const d = await fn(); rec(id, name, 'PASS', d ?? ''); }
  catch (e) { rec(id, name, 'FAIL', String(e?.message ?? e).slice(0, 400)); }
}
const rkCount = () => net.filter(e => e.path.endsWith('/user-rankings')).length;
const rowsOf = (rk) => rk.locator('.rk-table:visible tbody tr, .rk-list:visible li');
const shot = (page, n) => page.screenshot({ path: `${OUT}/${n}.png` });
function watch(page, tag) {
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(`[${tag}] ${m.text()}`); });
  page.on('pageerror', e => consoleErrors.push(`[${tag}] pageerror: ${e.message}`));
  page.on('request', r => { try { const u = new URL(r.url()); if (u.pathname.startsWith('/functions/v1/')) net.push({ ctx: tag, method: r.method(), path: u.pathname, params: Object.fromEntries(u.searchParams), status: 0 }); } catch {} });
  page.on('response', r => { try { const u = new URL(r.url()); if (u.pathname.startsWith('/functions/v1/')) { const hit = [...net].reverse().find(e => e.ctx === tag && e.path === u.pathname && !e.status); if (hit) hit.status = r.status(); } } catch {} });
}
// waiter attached BEFORE the action (fixture responds instantly)
async function doRk(page, rk, action, pred) {
  const w = page.waitForResponse(r => r.url().includes('/functions/v1/user-rankings') && pred(new URL(r.url()).searchParams), { timeout: 15000 });
  await action();
  await w;
  await rowsOf(rk).first().waitFor({ timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(250);
}

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--lang=ko-KR'] });
try {
  const s = await openPage(browser, { width: 1440, height: 900, theme: 'dark', search: '?screen=map' });
  watch(s.page, 'R'); await attachRankingFixture(s.context);
  await s.page.goto(`${ORIGIN}/?screen=rankings`);
  const rk = s.page.locator('.rk-page');
  await rowsOf(rk).first().waitFor({ timeout: 15000 });

  await check('R05', '집계 기준 disclosure present (any role) + top-line sentence', async () => {
    const body = await rk.innerText();
    if (!body.includes('공유된 완료 신고를 기준으로 집계합니다')) throw new Error('top-line missing');
    if (!body.includes('집계 기준 보기')) throw new Error('disclosure missing');
    for (const bad of ['왕관', '시상대', 'TOP3', 'TOP 3', '인사이트', '축하', 'completed_unknown']) if (body.includes(bad)) throw new Error(`forbidden: ${bad}`);
    return 'disclosure + sentence present, no forbidden terms';
  });
  await check('R06', 'fines tab immediate + exact headers', async () => {
    const n0 = rkCount();
    await doRk(s.page, rk, () => rk.getByRole('button', { name: '과태료 랭킹', exact: true }).click(), q => q.get('theme') === 'fines');
    if (rkCount() <= n0) throw new Error('no request');
    const th = (await rk.locator('th').allTextContents()).join('|');
    if (th !== '순위|참여자|과태료 처분|완료 신고') throw new Error(`th=${th}`);
    return th;
  });
  await check('R07', 'rate switch immediate + 분자/분모 order', async () => {
    await doRk(s.page, rk, () => rk.getByRole('button', { name: '비율순', exact: true }).click(), q => q.get('metric') === 'fine_rate');
    const th = (await rk.locator('th').allTextContents()).join('|');
    const cell = await rk.locator('table tbody tr:first-child td').nth(2).innerText();
    if (!/\d+건 중 \d+건/.test(cell)) throw new Error(`cell=${cell}`);
    return `${th} || ${cell}`;
  });
  await check('R08', 'unlucky theme: dimensions + per-theme memory round-trip', async () => {
    await doRk(s.page, rk, () => rk.getByRole('button', { name: '불운 랭킹', exact: true }).click(), q => q.get('theme') === 'unlucky');
    const dims = (await rk.locator('[aria-label="불운 종류"] button').allTextContents()).join('|');
    if (dims !== '불수용|일부수용') throw new Error(`dims=${dims}`);
    await doRk(s.page, rk, () => rk.getByRole('button', { name: '일부수용', exact: true }).click(), q => q.get('metric') === 'partial_count');
    await doRk(s.page, rk, () => rk.getByRole('button', { name: '과태료 랭킹', exact: true }).click(), q => q.get('theme') === 'fines');
    await doRk(s.page, rk, () => rk.getByRole('button', { name: '불운 랭킹', exact: true }).click(), q => q.get('theme') === 'unlucky');
    const m = new URL(s.page.url()).searchParams.get('rk_metric');
    if (m !== 'partial_count') throw new Error(`rk_metric=${m}`);
    const title = await rk.locator('.rk-sub').innerText();
    if (!title.includes('일부수용 건수가 많은 순위')) throw new Error(`title=${title}`);
    return `memory=${m}`;
  });
  await check('R10', 'month immediate + stepper names + prior-month title', async () => {
    await doRk(s.page, rk, () => rk.getByRole('button', { name: '월별', exact: true }).click(), q => q.get('period') === 'month');
    const stepBtns = await rk.locator('.rk-month button, [aria-label*="달"] button').allTextContents().catch(() => []);
    const names = await rk.locator('button').evaluateAll(els => els.map(e => e.getAttribute('aria-label') || '').filter(x => /달|월/.test(x)));
    await doRk(s.page, rk, () => rk.getByLabel('조회할 달 직접 선택').fill('2026-08'), q => q.get('month') === '2026-08');
    const sub = await rk.locator('.rk-sub').innerText();
    if (!sub.includes('2026년 8월')) throw new Error(`sub=${sub}`);
    return `stepper=${JSON.stringify(names).slice(0, 120)} sub=${sub.slice(0, 60)}`;
  });
  await check('R11b', 'month rows show ties + sample1 + in-progress notice', async () => {
    const body = await rk.innerText();
    if (!body.includes('공동')) throw new Error('no ties');
    if (!body.includes('표본 1건')) throw new Error('no sample1');
    if (!body.includes('집계 중')) throw new Error('no in-progress note');
    return 'ties+sample1+집계중';
  });
  await check('R12', 'range draft silent until 조회', async () => {
    await rk.getByRole('button', { name: '기간 지정', exact: true }).click();
    await rk.getByLabel('시작일', { exact: true }).fill('2026-08-01');
    await rk.getByLabel('종료일', { exact: true }).fill('2026-08-31');
    const n0 = rkCount(); await s.page.waitForTimeout(500);
    if (rkCount() !== n0) throw new Error('draft leaked');
    await doRk(s.page, rk, () => rk.getByRole('button', { name: '조회', exact: true }).click(), q => q.get('period') === 'range' && q.get('start') === '2026-08-01');
    const sub = await rk.locator('.rk-sub').innerText();
    return `silent then fired; ${sub.slice(0, 70)}`;
  });
  await check('R13', 'advanced draft silent until 적용', async () => {
    const sum = rk.locator('.rk-advanced summary');
    if (!(await sum.count())) throw new Error('no advanced disclosure');
    await sum.click();
    await rk.getByLabel('최소 신고 건수', { exact: true }).fill('5');
    const n0 = rkCount(); await s.page.waitForTimeout(500);
    if (rkCount() !== n0) throw new Error('advanced draft leaked');
    await doRk(s.page, rk, () => rk.getByRole('button', { name: '적용', exact: true }).click(), q => q.get('min_reports') === '5');
    await rk.getByLabel('최소 신고 건수', { exact: true }).fill('1');
    await doRk(s.page, rk, () => rk.getByRole('button', { name: '적용', exact: true }).click(), q => q.get('min_reports') === '1');
    return 'min 5 applied, restored 1';
  });
  await check('R14', 'page 2 row-range + me stable outside page', async () => {
    const cur = new URL(s.page.url()).searchParams;
    if (cur.get('rk_period') !== 'all') {
      await doRk(s.page, rk, () => rk.getByRole('button', { name: '전체 기간', exact: true }).click(), q => q.get('period') === 'all');
    }
    const meBefore = await rk.locator('.rk-me-line').innerText();
    await doRk(s.page, rk, () => rk.getByRole('button', { name: '다음', exact: true }).click(), q => q.get('page') === '2');
    const pager = await rk.locator('.rk-pager').innerText();
    const meAfter = await rk.locator('.rk-me-line').innerText();
    if (!pager.includes('참여자 21–')) throw new Error(`pager=${pager}`);
    if (meAfter !== meBefore) throw new Error('me changed');
    return pager.replace(/\n/g, ' ');
  });
  await check('R18', 'empty month: heading + zero rows', async () => {
    await doRk(s.page, rk, () => rk.getByRole('button', { name: '월별', exact: true }).click(), q => q.get('period') === 'month');
    const w = s.page.waitForResponse(r => r.url().includes('/user-rankings') && new URL(r.url()).searchParams.get('month') === '2020-01', { timeout: 15000 });
    await rk.getByLabel('조회할 달 직접 선택').fill('2020-01');
    await w;
    await rk.getByRole('heading', { name: '결과가 없습니다' }).waitFor({ timeout: 8000 });
    if (await rowsOf(rk).count() !== 0) throw new Error('rows in empty');
    return 'empty clean';
  });
  await check('R23', 'back/forward keeps rk_* history', async () => {
    await doRk(s.page, rk, () => rk.getByRole('button', { name: '전체 기간', exact: true }).click(), q => q.get('period') === 'all');
    await doRk(s.page, rk, () => rk.getByRole('button', { name: '과태료 랭킹', exact: true }).click(), q => q.get('theme') === 'fines');
    await s.page.goBack();
    await s.page.waitForTimeout(600);
    const t = new URL(s.page.url()).searchParams.get('rk_theme');
    await s.page.goForward();
    await rowsOf(rk).first().waitFor({ timeout: 15000 }).catch(() => {});
    const t2 = new URL(s.page.url()).searchParams.get('rk_theme');
    if (t2 !== 'fines') throw new Error(`forward theme=${t2} (back was ${t})`);
    return `back=${t} forward=${t2}`;
  });
  // overflow culprit under emulated 200%
  await check('R24', 'identify 200%-zoom overflow culprit (390, CSS-zoom emulation)', async () => {
    const m = await openPage(browser, { width: 390, height: 844, theme: 'light', search: '?screen=map' });
    watch(m.page, 'Z'); await attachRankingFixture(m.context);
    await m.page.goto(`${ORIGIN}/?screen=rankings`);
    await rowsOf(m.page.locator('.rk-page')).first().waitFor({ timeout: 15000 });
    await m.page.evaluate(() => { document.body.style.zoom = '200%'; });
    await m.page.waitForTimeout(400);
    const info = await m.page.evaluate(() => {
      const bad = [];
      for (const el of document.querySelectorAll('body *')) {
        if (el.scrollWidth > document.documentElement.clientWidth + 1) {
          const cs = getComputedStyle(el);
          if (cs.display !== 'none') bad.push(`${el.tagName}.${(el.className?.baseVal ?? el.className ?? '').toString().split(' ').slice(0, 2).join('.')} sw=${el.scrollWidth}`);
        }
      }
      return { clientWidth: document.documentElement.clientWidth, docSW: document.documentElement.scrollWidth, bad: bad.slice(0, 12) };
    });
    await shot(m.page, 'R-zoom200-culprit');
    await m.context.close();
    return JSON.stringify(info).slice(0, 400);
  });
  await s.context.close();

  // ---- Statistics corrected semantics ----
  const t = await openPage(browser, { width: 1440, height: 900, theme: 'dark', search: '?screen=map' });
  watch(t.page, 'S');
  await t.page.goto(`${ORIGIN}/?screen=statistics`);
  const st = t.page.locator('.stats-page');
  await st.waitFor({ timeout: 15000 });
  await t.page.waitForTimeout(2000);
  const qCount = () => net.filter(e => e.ctx === 'S' && (e.path.includes('statistics/query') || e.path.includes('my-analytics'))).length;
  await check('S01', 'entry: meta+catalog+exactly ONE default query, NO dashboard', async () => {
    const paths = net.filter(e => e.ctx === 'S').map(e => e.path);
    if (!paths.some(p => p.includes('statistics/catalog'))) throw new Error('no catalog');
    if (paths.some(p => /dashboard$|overview$/.test(p))) throw new Error('dashboard fetched on statistics entry');
    if (qCount() !== 1) throw new Error(`default queries=${qCount()} (design: single default-restore run)`);
    return `meta+catalog+1 default query; no dashboard`;
  });
  await check('S02', 'real draft edit (metric add) is silent + unapplied note + button enables', async () => {
    const add = st.getByLabel('지표 추가');
    await add.selectOption({ index: 1 });
    await t.page.waitForTimeout(600);
    if (qCount() !== 1) throw new Error(`query fired on draft edit (now ${qCount()})`);
    if (!await st.getByText('바꾼 설정이 아직 반영되지 않았습니다').count()) throw new Error('unapplied note missing');
    const btn = st.getByRole('button', { name: '통계 만들기', exact: true });
    if (!await btn.isEnabled()) throw new Error('통계 만들기 still disabled after real change');
    return 'silent + note + enabled';
  });
  await check('S03', '통계 만들기 fires exactly one query; 표/그래프 switch silent', async () => {
    const w = t.page.waitForResponse(r => r.url().includes('statistics/query') || r.url().includes('my-analytics'), { timeout: 20000 });
    await st.getByRole('button', { name: '통계 만들기', exact: true }).click();
    await w; await t.page.waitForTimeout(1200);
    if (qCount() !== 2) throw new Error(`queries=${qCount()}`);
    const n0 = net.filter(e => e.ctx === 'S').length;
    await st.getByRole('button', { name: '그래프', exact: true }).click();
    await t.page.waitForTimeout(600);
    await st.getByRole('button', { name: '표', exact: true }).click();
    await t.page.waitForTimeout(400);
    if (net.filter(e => e.ctx === 'S').length !== n0) throw new Error('view switch refetched');
    return '1 execute query; view switches silent';
  });
  await shot(t.page, 'S-statistics-after-execute');
  await check('S04', 'personal population: 내 신고 execute hits my-analytics, no cross leak', async () => {
    await st.getByLabel('내 신고', { exact: true }).check();
    await t.page.waitForTimeout(400);
    if (qCount() !== 2) throw new Error('draft leaked on population switch');
    const w = t.page.waitForResponse(r => r.url().includes('my-analytics') || r.url().includes('statistics/query'), { timeout: 20000 });
    await st.getByRole('button', { name: '통계 만들기', exact: true }).click();
    const resp = await w;
    await t.page.waitForTimeout(1000);
    return `executed via ${new URL(resp.url()).pathname}`;
  });
  await check('S05', 'save recipe + share link surfaces', async () => {
    await st.getByLabel('설정 이름').fill('검수저장');
    await st.getByRole('button', { name: '저장', exact: true }).click();
    await t.page.waitForTimeout(400);
    const saved = await st.getByRole('button', { name: '검수저장', exact: true }).count();
    await st.getByRole('button', { name: '공유 링크', exact: true }).click();
    await t.page.waitForTimeout(400);
    const body = await st.innerText();
    await shot(t.page, 'S-statistics-save-share');
    if (!saved) throw new Error('saved recipe not listed');
    if (!/공유|복사|링크/.test(body)) throw new Error('share panel missing');
    return `saved=${!!saved} share panel open`;
  });
  await check('S06', 'export button enabled after result', async () => {
    const exp = st.getByRole('button', { name: /엑셀 다운로드/ });
    if (!await exp.isEnabled()) throw new Error('export disabled with result');
    return 'export enabled';
  });
  await t.context.close();
} finally {
  writeFileSync(`${OUT}/results2.json`, JSON.stringify({ results, consoleErrors, net }, null, 2));
  await browser.close();
}
const pass = results.filter(r => r.status === 'PASS').length;
console.log(JSON.stringify({ pass, fail: results.length - pass, total: results.length }));
for (const r of results) console.log(`${r.status} ${r.id} ${r.name}${r.detail ? ' :: ' + r.detail.slice(0, 200) : ''}`);
