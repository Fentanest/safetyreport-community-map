// Browser acceptance for the 2026-09-30 UI follow-up: words-only floating sort menus and the chart type picker.
// LOCAL stack only: real frontend (Vite dev) + real server/publicHandler.ts over SYNTHETIC facts + MOCK Kakao SDK.
//   E2E server:  E2E_PORT=5190 npx vite --config scripts/browser/vite.e2e.config.ts
//   run:         LANG=C.UTF-8 node scripts/browser/verify_sort_chart_ux.mjs <dir>
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, openPage, waitMap, api, sleep, summarizeLog } from './harness.mjs';
import { createRun, captureConsole, waitFor } from './assert.mjs';

const dir = process.argv[2] || 'evidence';
mkdirSync(join(dir, 'shots'), { recursive: true });
const browser = await chromium.launch({ args: ['--lang=ko-KR'], env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } });
const IDS = ['SM-VERT', 'SM-WORDS', 'SM-STABLE', 'SM-VIEWPORT', 'SM-CLOSE', 'SM-SWITCH', 'SM-SCROLL', 'SM-REQ', 'SM-FULL', 'SM-OPTIONS',
  'SM-A11Y', 'CP-AVAIL', 'CP-REASON', 'CP-NOREQ', 'CP-NOCHANGE', 'CP-SELECT', 'CP-REGRESS'];
const run = createRun({ dir, suite: 'sort-chart-ux', ids: IDS, meta: {
  browser: `chromium ${browser.version()}`, sdk: 'MOCK (scripts/browser/mock-kakao-sdk.js)', data: 'synthetic (demoFacts + e2e extras)',
  server: 'local Vite middleware running server/publicHandler.ts (Node, not Edge Runtime)' } });
const { check, step } = run;
const shot = (page, name) => page.screenshot({ path: join(dir, 'shots', `${name}.png`) });
const log = async () => api('log');
const SCOPE = '?date_basis=completed_date&start=2025-09-25&end=2026-09-24&category=all';
const WIDTHS = [1920, 1440, 1280, 768, 390];

async function fresh(ctx, { search = SCOPE, ...opts } = {}) {
  await api('reset');
  const s = await openPage(browser, { height: 1000, search, ...opts });
  captureConsole(s.page, ctx);
  // React/dev warnings arrive as console.warn too
  s.page.on('console', (m) => { if (m.type() === 'warning' && /Warning|React/.test(m.text())) ctx.consoleSeen.push(`warn: ${m.text()}`); });
  return s;
}
async function entitiesTable(page) {
  await waitMap(page);
  await page.waitForSelector('.kpi-strip [data-kpi="report"]', { timeout: 20000 });
  const t = page.locator('#entities');
  await t.scrollIntoViewIfNeeded();
  const full = page.locator('#entities .ghost-btn', { hasText: '전체 보기' });
  if (await full.count()) await full.click();
  await waitFor(() => page.locator('#entities tbody tr').count(), (n) => n > 1, { timeout: 15000 });
  await sleep(400);
  return t;
}
/** geometry of the table header + page width (what must NOT move when a menu opens) */
const layout = (page, scope) => page.evaluate((sel) => {
  const table = document.querySelector(`${sel} table`);
  const ths = [...table.querySelectorAll('thead th')].map((th) => { const r = th.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.width)]; });
  const head = table.querySelector('thead').getBoundingClientRect();
  const row = table.querySelector('tbody tr')?.getBoundingClientRect();
  return { ths, headH: Math.round(head.height), tableW: Math.round(table.getBoundingClientRect().width), rowH: Math.round(row?.height ?? 0),
    pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
}, scope);
const menuInfo = (page) => page.evaluate(() => {
  const menus = [...document.querySelectorAll('.floating-menu.sort-menu')];
  if (!menus.length) return { count: 0 };
  const m = menus[0], r = m.getBoundingClientRect();
  const items = [...m.querySelectorAll('[role="menuitemradio"]')].map((b) => { const q = b.getBoundingClientRect(); return { text: b.innerText.trim(), label: b.getAttribute('aria-label'), top: Math.round(q.top), left: Math.round(q.left), h: Math.round(q.height), w: Math.round(q.width) }; });
  return { count: menus.length, inBody: m.parentElement === document.body, rect: { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), w: Math.round(r.width) },
    vw: document.documentElement.clientWidth, vh: window.innerHeight, items, bg: getComputedStyle(m).backgroundColor, color: getComputedStyle(m).color };
});
const vertical = (items) => items.length > 1 && items.every((it, i) => i === 0 || (it.top >= items[i - 1].top + items[i - 1].h - 1 && Math.abs(it.left - items[0].left) <= 1));
const inViewport = (m) => m.rect.l >= 0 && m.rect.t >= 0 && m.rect.r <= m.vw && m.rect.b <= m.vh;
const header = (page, scope, text) => page.locator(`${scope} th.sortable`).filter({ hasText: text }).first();
const entitiesReq = async (from) => (await log()).slice(from).filter((e) => e.route === 'entities');

try {
  await step('sort-viewports', ['SM-VERT', 'SM-WORDS', 'SM-STABLE', 'SM-VIEWPORT', 'SM-OPTIONS'], async (ctx) => {
    for (const theme of ['light', 'dark']) {
      for (const width of WIDTHS) {
        const s = await fresh(ctx, { width, height: width < 800 ? 844 : 1000, theme });
        const { page } = s;
        await entitiesTable(page);
        // bring the header into view first (a click would scroll the table otherwise): only the menu may change things after this
        await header(page, '#entities', '과태료').locator('.sort-head').scrollIntoViewIfNeeded();
        await sleep(200);
        const before = await layout(page, '#entities');
        const n0 = (await log()).length;
        await header(page, '#entities', '과태료').locator('.sort-head').click();
        const m = await waitFor(() => menuInfo(page), (x) => x.count === 1 && x.items.length === 4);
        const after = await layout(page, '#entities');
        const tag = `${theme} ${width}`;
        check('SM-VERT', `${tag}: 4 items, one per line, floating (portal in body)`, { vertical: vertical(m.items), inBody: m.inBody, n: m.items.length }, { vertical: true, inBody: true, n: 4 });
        check('SM-WORDS', `${tag}: words only, no arrows`, m.items.map((i) => i.text), ['건수 많은 순', '건수 적은 순', '비율 높은 순', '비율 낮은 순']);
        check('SM-STABLE', `${tag}: header columns / header height / table width / row height / page width unchanged`,
          { same: JSON.stringify(before) === JSON.stringify(after), overflow: after.pageOverflow, ...(JSON.stringify(before) === JSON.stringify(after) ? {} : { before, after }) },
          (x) => x.same && x.overflow === 0);
        check('SM-VIEWPORT', `${tag}: menu inside the viewport, 36–40px items, width 160–240`,
          { inside: inViewport(m), h: m.items.every((i) => i.h >= 36 && i.h <= 40), w: m.rect.w >= 160 && m.rect.w <= 240 }, { inside: true, h: true, w: true });
        check('SM-VERT', `${tag}: opening the menu sends nothing`, summarizeLog((await log()).slice(n0)), {});
        if (width === 1440 || width === 390) await shot(page, `sort-menu-${theme}-${width}`);
        await page.keyboard.press('Escape');
        // rightmost sortable column: flips into the viewport
        const last = page.locator('#entities th.sortable').last();
        await last.scrollIntoViewIfNeeded();
        await last.locator('.sort-head').click();
        const mr = await waitFor(() => menuInfo(page), (x) => x.count === 1);
        check('SM-VIEWPORT', `${tag}: rightmost column menu inside the viewport`, inViewport(mr), true);
        await page.keyboard.press('Escape');
        if (theme === 'light' && width === 1440) {
          // SM-OPTIONS: single-value columns offer only what the cell shows
          await header(page, '#entities', '답변까지').locator('.sort-head').click();
          check('SM-OPTIONS', '답변까지 (median shown) → 기간 긴/짧은 순 only', (await waitFor(() => menuInfo(page), (x) => x.count === 1)).items.map((i) => i.text), ['기간 긴 순', '기간 짧은 순']);
          await page.keyboard.press('Escape');
          await header(page, '#entities', '답변(건)').locator('.sort-head').click();
          check('SM-OPTIONS', '답변(건) → 건수 많은/적은 순 only', (await waitFor(() => menuInfo(page), (x) => x.count === 1)).items.map((i) => i.text), ['건수 많은 순', '건수 적은 순']);
          await page.keyboard.press('Escape');
          const laws = page.locator('#laws');
          await laws.scrollIntoViewIfNeeded();
          const fullLaws = page.locator('#laws .ghost-btn', { hasText: '전체 보기' });
          if (await fullLaws.count()) await fullLaws.click();
          await sleep(600);
          for (const [label, expected] of [['평균 별점', ['별점 높은 순', '별점 낮은 순', '평가 많은 순', '평가 적은 순']],
            ['과태료 금액', ['금액 많은 순', '금액 적은 순']], ['수용', ['건수 많은 순', '건수 적은 순', '비율 높은 순', '비율 낮은 순']]]) {
            const h = page.locator('#laws th.sortable').filter({ hasText: label }).first();
            if (!(await h.count())) { ctx.note(`laws_missing_${label}`, true); continue; }
            await h.locator('.sort-head').click();
            check('SM-OPTIONS', `law table ${label}`, (await waitFor(() => menuInfo(page), (x) => x.count === 1)).items.map((i) => i.text), expected);
            await page.keyboard.press('Escape');
          }
        }
        await s.context.close();
      }
    }
  });

  await step('sort-behaviour', ['SM-CLOSE', 'SM-SWITCH', 'SM-SCROLL', 'SM-REQ', 'SM-FULL', 'SM-A11Y'], async (ctx) => {
    const s = await fresh(ctx, { width: 1280 });
    const { page } = s;
    await entitiesTable(page);
    const fine = header(page, '#entities', '과태료');
    // outside click
    await fine.locator('.sort-head').click();
    await waitFor(() => menuInfo(page), (x) => x.count === 1);
    await page.mouse.click(5, 5);
    check('SM-CLOSE', 'outside click closes', (await menuInfo(page)).count, 0);
    // Esc → closed, focus back on the header button
    await fine.locator('.sort-head').click();
    await waitFor(() => menuInfo(page), (x) => x.count === 1);
    check('SM-A11Y', 'menu focus on the checked (or first) item; ArrowDown moves', await page.evaluate(() => document.activeElement?.getAttribute('role')), 'menuitemradio');
    await page.keyboard.press('ArrowDown');
    check('SM-A11Y', 'items are menuitemradio with visible names (no direction words added)',
      (await menuInfo(page)).items.map((i) => i.label), [null, null, null, null]);
    await page.keyboard.press('Escape');
    check('SM-CLOSE', 'Esc closes and returns focus to the header', { menus: (await menuInfo(page)).count, focus: await page.evaluate(() => document.activeElement?.className) }, { menus: 0, focus: 'sort-head' });
    // A → B
    await fine.locator('.sort-head').click();
    await waitFor(() => menuInfo(page), (x) => x.count === 1);
    await header(page, '#entities', '수용률').locator('.sort-head').click();
    const b = await waitFor(() => menuInfo(page), (x) => x.count === 1 && x.items.length === 2);
    check('SM-SWITCH', 'opening column B closes A and opens B', { count: b.count, items: b.items.map((i) => i.text) }, { count: 1, items: ['비율 높은 순', '비율 낮은 순'] });
    await page.keyboard.press('Escape');
    // table scrolled horizontally + page scrolled vertically: the menu stays under its header
    await page.locator('#entities .table-scroll').evaluate((el) => { el.scrollLeft = el.scrollWidth; });
    const last = page.locator('#entities th.sortable').last();
    await last.locator('.sort-head').click();
    await waitFor(() => menuInfo(page), (x) => x.count === 1);
    const near = async () => { const hb = await last.locator('.sort-head').boundingBox(); const m = await menuInfo(page); return { dy: Math.round(m.rect.t - (hb.y + hb.height)), inside: inViewport(m) }; };
    check('SM-SCROLL', 'after horizontal table scroll: menu right under its header, inside the viewport', await near(), (x) => x.dy >= 0 && x.dy <= 8 && x.inside);
    await page.mouse.wheel(0, 120);
    await sleep(300);
    check('SM-SCROLL', 'page scrolled while open: menu follows the header', await near(), (x) => (x.dy >= 0 && x.dy <= 8) || x.dy < -100 /* flipped above */);
    await page.setViewportSize({ width: 1100, height: 900 });
    await sleep(300);
    check('SM-SCROLL', 'window resized while open: still under the header, inside', await near(), (x) => x.dy >= 0 && x.dy <= 8 && x.inside);
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.locator('#entities .table-scroll').evaluate((el) => { el.scrollLeft = 0; });
    // each choice: exactly one server request with the SortSpec and page 1; the first row is the full-list extreme
    const fullList = await page.evaluate(async () => {
      const token = JSON.parse(localStorage.getItem('cm-map-auth-v1')).access_token;
      const q = new URLSearchParams(location.search), out = [];
      for (let p = 1; p <= 20; p++) {
        const r = await fetch(`/functions/v1/public-analytics/entities?date_basis=${q.get('date_basis')}&start=${q.get('start')}&end=${q.get('end')}&category=all&kind=agency&page=${p}&page_size=100`, { headers: { Authorization: `Bearer ${token}` } });
        const j = await r.json(); out.push(...j.items); if (out.length >= j.total_rows) break;
      }
      return out.map((e) => ({ name: e.agency_name, count: e.fine_count, rate: e.fine_count !== null && e.completed_count > 0 ? e.fine_count / e.completed_count : null }));
    });
    for (const [text, value, dir] of [['건수 많은 순', 'count', 'desc'], ['건수 적은 순', 'count', 'asc'], ['비율 높은 순', 'rate', 'desc'], ['비율 낮은 순', 'rate', 'asc']]) {
      // go to page 2 first when possible: a choice must bring the table back to page 1
      const next = page.locator('#entities .table-footer button', { hasText: '다음' });
      if (await next.count() && await next.isEnabled()) { await next.click(); await sleep(500); }
      const n0 = (await log()).length;
      await fine.locator('.sort-head').click();
      await waitFor(() => menuInfo(page), (x) => x.count === 1);
      await page.locator('.floating-menu.sort-menu [role="menuitemradio"]', { hasText: text }).click();
      await waitFor(async () => (await entitiesReq(n0)).length, (n) => n >= 1);
      await sleep(600);
      const reqs = await entitiesReq(n0);
      check('SM-REQ', `${text}: one request, sort=fine sort_value=${value} dir=${dir} page=1`, reqs.map((r) => [r.params.sort, r.params.sort_value, r.params.dir, r.params.page]), [['fine', value, dir, '1']]);
      check('SM-REQ', `${text}: menu closed after the choice`, (await menuInfo(page)).count, 0);
      const vals = fullList.map((e) => e[value]).filter((v) => v !== null);
      const want = dir === 'desc' ? Math.max(...vals) : Math.min(...vals);
      const firstName = (await page.locator('#entities tbody tr').first().locator('.table-name').innerText()).trim();
      const firstVal = fullList.find((e) => e.name === firstName)?.[value];
      check('SM-FULL', `${text}: first row holds the ${dir === 'desc' ? 'largest' : 'smallest'} value of the whole list`, firstVal, (v) => v !== null && Math.abs(v - want) < 1e-12);
      const cap = await page.locator('#entities caption').innerText();
      check('SM-WORDS', `${text}: header and caption state the order in words`, { head: (await fine.locator('.sort-now-label').innerText()).trim(), cap: cap.includes(`과태료 · ${text}`), arrows: /[▼▲↑↓]/.test(cap) },
        { head: text, cap: true, arrows: false });
    }
    await shot(page, 'sort-applied');
    await s.context.close();
  });

  await step('chart-picker', ['CP-AVAIL', 'CP-REASON', 'CP-NOREQ', 'CP-NOCHANGE', 'CP-SELECT', 'CP-REGRESS'], async (ctx) => {
    const s = await fresh(ctx, { width: 1440, search: `${SCOPE}&screen=statistics` });
    const { page } = s;
    await page.waitForSelector('#stats-title', { timeout: 20000 });
    const runBtn = page.getByRole('button', { name: '통계 만들기' });
    if (await runBtn.count()) await runBtn.click();
    await page.waitForSelector('.pivot-table tbody tr', { timeout: 20000 });
    // settings are changed the same way a saved/shared recipe would be restored (sessionStorage state, reload)
    const applySpec = async (patch) => {
      await page.evaluate((p) => {
        const st = JSON.parse(sessionStorage.getItem('cm-stats-state-v2'));
        st.draft.spec = { ...st.draft.spec, ...p, filters: [] }; st.applied = st.draft; st.view = 'chart'; st.chart = { ...st.chart, type: 'auto' };
        sessionStorage.setItem('cm-stats-state-v2', JSON.stringify(st));
      }, patch);
      await page.reload();
      await page.waitForSelector('.chart-type-picker .picker-btn', { timeout: 20000 });
      await sleep(500);
    };
    const openPicker = async () => {
      await page.locator('.chart-type-picker .picker-btn').click();
      return waitFor(() => page.evaluate(() => {
        const m = document.querySelector('.floating-menu.chart-menu');
        if (!m) return null;
        const usable = [...m.querySelectorAll('[role="menuitemradio"]:not([aria-disabled])')].map((b) => b.innerText.trim());
        const blocked = [...m.querySelectorAll('.chart-menu-blocked')].map((b) => ({ name: b.querySelector('.chart-menu-name').innerText.trim(),
          // own reason, or the reason stated once for its group
          reason: (b.querySelector('.chart-menu-reason') ?? b.closest('.chart-menu-group')?.querySelector('.chart-menu-shared'))?.innerText.trim() ?? '',
          fix: b.querySelector('.chart-menu-fix')?.innerText.trim() ?? '' }));
        const r = m.getBoundingClientRect();
        return { usable, blocked, inside: r.left >= 0 && r.right <= document.documentElement.clientWidth && r.top >= 0 };
      }), (x) => !!x);
    };
    const specNow = () => page.evaluate(() => { const st = JSON.parse(sessionStorage.getItem('cm-stats-state-v2')); return JSON.stringify([st.draft.spec, st.applied.spec]); });
    const monthDim = await page.evaluate(async () => {
      const token = JSON.parse(localStorage.getItem('cm-map-auth-v1')).access_token;
      const c = await (await fetch('/functions/v1/public-analytics/statistics/catalog', { headers: { Authorization: `Bearer ${token}` } })).json();
      return c.dimensions.find((d) => /^completed.*_month$/.test(d.id))?.id ?? null;
    });
    ctx.note('month_dimension', monthDim);

    await applySpec({ rows: ['agency'], columns: ['law'], metrics: ['fine_rate'] });
    let p = await openPicker();
    check('CP-AVAIL', '기관 × 위반법규: 막대·히트맵 usable; 가로 막대 blocked', { u: p.usable, b: p.blocked.map((x) => x.name) },
      (x) => x.u.includes('막대') && x.u.includes('히트맵') && !x.u.includes('가로 막대') && x.b.includes('가로 막대'));
    check('CP-REASON', 'reasons name the chosen items; no generic "지금 설정에선 못 씀"', p.blocked, (b) => b.every((x) => x.reason && !/지금 설정에선 못 씀|지원 안 됨/.test(`${x.reason}${x.fix}`)) && b.find((x) => x.name === '꺾은선').fix.includes('날짜 항목'));
    await shot(page, 'chart-picker-agency-law');
    await page.keyboard.press('Escape');

    await applySpec({ rows: ['agency', 'sido'], columns: ['law'], metrics: ['fine_rate'] });
    const n0 = (await log()).length;
    const before = await specNow();
    p = await openPicker();
    check('CP-AVAIL', '기관·시도 × 위반법규: only the heatmap', p.usable.filter((u) => !u.startsWith('자동')), ['히트맵']);
    check('CP-REASON', 'bar reason lists the three items and the 2-item limit', p.blocked.find((x) => x.name === '막대'), (x) => /·.*·.*총 3개 기준/.test(x.reason) && /2개 기준까지/.test(x.fix));
    // a blocked item: shows how to fix it, changes nothing
    await page.locator('.chart-menu-blocked', { hasText: '꺾은선' }).click({ force: true }); // aria-disabled: Playwright would wait, a user can click
    check('CP-NOCHANGE', 'blocked item → hint only; menu stays open', await page.locator('.chart-menu-hint').innerText().catch(() => ''), (t) => t.startsWith('꺾은선:') && t.includes('날짜'));
    await page.keyboard.press('Escape');
    check('CP-NOCHANGE', 'rows/columns/metrics/population unchanged', await specNow(), before);
    check('CP-NOREQ', 'open/close/blocked click: 0 API requests', summarizeLog((await log()).slice(n0)), {});
    await shot(page, 'chart-picker-three-dims');

    if (monthDim) {
      await applySpec({ rows: [monthDim], columns: ['agency'], metrics: ['fine_rate'] });
      p = await openPicker();
      check('CP-AVAIL', '답변 월 × 기관: 꺾은선 usable', p.usable.includes('꺾은선'), true);
      await page.keyboard.press('Escape');
    } else ctx.note('month_missing', true);

    await applySpec({ rows: ['agency'], columns: [], metrics: ['fine_rate', 'accept_rate'] });
    p = await openPicker();
    check('CP-AVAIL', '기관 + 두 지표: 산점도 usable; 100% 누적 blocked with the rate names', { sc: p.usable.includes('산점도'), s100: p.blocked.find((x) => x.name === '100% 누적') },
      (x) => x.sc && x.s100 && /비율·통계 지표/.test(x.s100.reason) && /합하면 하나의 전체/.test(x.s100.fix));
    // choosing a usable type: display only (0 requests), chart redrawn, settings kept
    const n1 = (await log()).length, before2 = await specNow();
    await page.locator('.floating-menu.chart-menu [role="menuitemradio"]', { hasText: '산점도' }).click();
    check('CP-SELECT', 'usable type chosen → button shows it, spec unchanged, 0 requests',
      { btn: (await page.locator('.chart-type-picker .picker-btn').innerText()).trim(), spec: (await specNow()) === before2, req: summarizeLog((await log()).slice(n1)) },
      (x) => x.btn.startsWith('산점도') && x.spec && Object.keys(x.req).length === 0);
    await shot(page, 'chart-picker-scatter');
    // regression: table ↔ chart switch and the share link still work without requests
    await page.locator('.stats-result').getByRole('button', { name: '표', exact: true }).click();
    await page.locator('.stats-result').getByRole('button', { name: '그래프', exact: true }).click();
    await page.locator('.stats-actions').getByRole('button', { name: '공유 링크' }).click();
    check('CP-REGRESS', 'table↔chart switch and the share panel: no request (share/Excel flows: verify_finalization)',
      { req: summarizeLog((await log()).slice(n1)), panel: await page.locator('.share-panel').count(), chart: await page.locator('.stats-chart-host').count() },
      (x) => Object.keys(x.req).length === 0 && x.panel === 1 && x.chart === 1);
    await page.locator('.stats-actions').getByRole('button', { name: '공유 링크' }).click();
    for (const theme of ['light', 'dark']) {
      await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
      await applySpec({ rows: ['agency', 'sido'], columns: ['law'], metrics: ['fine_rate'] });
      await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
      p = await openPicker();
      check('CP-REASON', `${theme}: picker inside the viewport`, p.inside, true);
      await shot(page, `chart-picker-${theme}`);
      await page.keyboard.press('Escape');
    }
    await s.context.close();
  });
} finally {
  run.finish();
  await browser.close();
}
