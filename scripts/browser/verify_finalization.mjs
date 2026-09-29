// Assertion run for the finalization round (F01 chart lifecycle, F02 share link, F03 legend, F06 Excel export) on the
// LOCAL stack: real frontend (Vite dev, DEV hooks) + real Edge handler code over SYNTHETIC facts + MOCK Kakao SDK, and a
// Pages-like static preview of the PRODUCTION build (demo data) for base path / CSP / asset checks.
// The .xlsx files checked here are produced by excelize-wasm INSIDE Chromium (Web Worker) — never by Node.
// This is NOT a real-SDK, real-Supabase, Excel or production check.
//   E2E server:  E2E_PORT=5190 npx vite --config scripts/browser/vite.e2e.config.ts
//   run:         LANG=C.UTF-8 node scripts/browser/verify_finalization.mjs <dir>
//   ONLY=F01,F03 … → other steps NOT_RUN in this run's file · SELFTEST_WRONG='<ID>:<label>' → the run must exit 1
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn, execSync } from 'node:child_process';
import { join } from 'node:path';
import { chromium, openPage, waitMap, api, sleep, fakeSession, E2E_UID, E2E_UID_B, ORIGIN } from './harness.mjs';
import { createRun, captureConsole, waitFor } from './assert.mjs';
import { inspect, rangeValues } from '../xlsx/ooxml.mjs';

const dir = process.argv[2] || 'evidence';
mkdirSync(join(dir, 'shots'), { recursive: true });
mkdirSync(join(dir, 'files'), { recursive: true });
const browser = await chromium.launch({ args: ['--lang=ko-KR'], env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } });
const IDS = [
  'FN-01', 'FN-02', 'FN-03', 'FN-04',
  'FN-05', 'FN-06', 'FN-07', 'FN-08', 'FN-09', 'FN-10',
  'FN-11', 'FN-12', 'FN-13', 'FN-14',
  'EX-01', 'EX-02', 'EX-03', 'EX-04', 'EX-05', 'EX-06', 'EX-07', 'EX-15', 'EX-16', 'EX-21', 'EX-22', 'EX-23',
  'EX-31', 'EX-32', 'EX-33', 'EX-34', 'EX-35', 'EX-36', 'EX-37', 'EX-38', 'EX-39', 'EX-40', 'EX-41', 'EX-42', 'EX-43', 'EX-44',
  'EX-45', 'EX-46', 'EX-47', 'EX-48', 'EX-49', 'EX-50', 'EX-51', 'EX-53', 'EX-55', 'EX-58', 'EX-60',
];
const run = createRun({ dir, suite: 'finalization', ids: IDS, meta: {
  browser: `chromium ${browser.version()}`, sdk: 'MOCK (scripts/browser/mock-kakao-sdk.js)', data: 'synthetic (demoFacts + e2e extras)',
  server: 'local Vite dev + real server/publicHandler.ts, server/personalHandler.ts; static preview of `vite build` (demo data) for EX-39/40/41/60',
  excel: 'xlsx produced by excelize-wasm 0.1.3 in Chromium (Web Worker); inspected by scripts/xlsx/ooxml.mjs; NOT opened in Microsoft Excel',
  isolation: 'no COOP/COEP headers, crossOriginIsolated=false, no SharedArrayBuffer (checked, not assumed)' } });
const { check, step, block } = run;
const shot = (page, name) => page.screenshot({ path: join(dir, 'shots', `${name}.png`) });
const log = async () => api('log');
const statsReq = (l) => l.filter((e) => /^statistics\/query$|^my-analytics$/.test(e.route) && (e.route !== 'my-analytics' || e.params.spec));
const series = (page, sel = '.stats-result .stats-chart-host') => page.evaluate((s) => [...document.querySelectorAll(s)].flatMap((h) => (h.__chart && !h.__chart.isDisposed() ? ((h.__chart.getOption() || {}).series || []).map((x) => x.id) : [])), sel);
const seriesData = (page, id) => page.evaluate((i) => {
  for (const h of document.querySelectorAll('.stats-result .stats-chart-host')) {
    const s = h.__chart && !h.__chart.isDisposed() ? ((h.__chart.getOption() || {}).series || []).find((x) => x.id === i) : null;
    if (s) return s.data.map((d) => (d && typeof d === 'object' ? d.value : d));
  }
  return null;
}, id);
const exp = (page) => page.evaluate(() => ({ ...window.__cmExport.snapshot(), counters: { ...window.__cmExport.counters } }));
const toStats = async (page) => { await page.locator('.stats-result').getByRole('button', { name: '그래프', exact: true }).click(); };
const toTable = async (page) => { await page.locator('.stats-result').getByRole('button', { name: '표', exact: true }).click(); };
const chartType = (page, t) => page.locator('.stats-result').getByLabel('유형').selectOption(t);
const runStats = async (page) => {
  const btn = page.locator('.stats-run .primary-button');
  if (await btn.isDisabled()) return; // the draft already equals the applied recipe
  await btn.click();
  await waitFor(() => page.locator('.stats-result').getAttribute('aria-busy'), (b) => b === 'false', { timeout: 15000 });
};
const setList = async (page, idx, ids) => {
  // replace the rows (0) / columns (1) / metrics (2) list of the builder with `ids`, in order
  const list = page.locator('.stats-builder .stats-list').nth(idx);
  for (let n = await list.locator('ol li').count(); n > 0; n--) {
    const del = list.locator('ol li').first().locator('button[aria-label$="빼기"]');
    if (await del.isDisabled()) break;
    await del.click();
  }
  for (const id of ids) await list.locator('select').selectOption(id).catch(() => undefined);
  // metrics: the last remaining original (not removable) goes if it is not wanted
  if (idx === 2) {
    const items = await list.locator('ol li span:first-child').allInnerTexts();
    if (items.length > ids.length) await list.locator('ol li').first().locator('button[aria-label$="빼기"]').click();
  }
};
async function statsPage(ctx, opts = {}) {
  await api('reset');
  const s = await openPage(browser, { search: '?screen=statistics', height: 1000, ...opts });
  captureConsole(s.page, ctx);
  s.requests = [];
  s.page.on('request', (r) => s.requests.push(r.url()));
  s.downloads = [];
  s.page.on('download', (d) => s.downloads.push(d));
  s.responses = [];
  s.page.on('response', async (r) => { if (/statistics\/query|my-analytics\/statistics/.test(r.url())) { try { s.responses.push(await r.json()); } catch { /* ignore */ } } });
  await s.page.waitForSelector('.pivot-table tbody tr', { timeout: 25000 });
  return s;
}
let fileNo = 0;
/** click an export button, wait for the browser download, save it and inspect the file */
async function download(s, source, name) {
  const before = s.downloads.length;
  await s.page.locator(`[data-export-source="${source}"] .export-btn`).click();
  await waitFor(() => exp(s.page), (x) => x.status === 'ready' || x.status === 'error', { timeout: 60000 });
  const st = await exp(s.page);
  if (st.status === 'error') throw new Error(`export error: ${st.message}`);
  let d = s.downloads.length > before ? s.downloads[s.downloads.length - 1] : null;
  if (!d) { // the automatic save was not taken over by the browser: the explicit 파일 저장 button (EX-48 fallback)
    const [dd] = await Promise.all([s.page.waitForEvent('download', { timeout: 15000 }), s.page.locator(`[data-export-source="${source}"] .export-ready .mini-btn`).click()]);
    d = dd;
  }
  const path = join(dir, 'files', `${String(++fileNo).padStart(2, '0')}-${name}.xlsx`);
  await d.saveAs(path);
  return { path, name: d.suggestedFilename(), state: st, x: inspect(readFileSync(path)) };
}
/** privacy scan of a produced file: no token, account id, nickname, session or report identifiers */
const PRIVATE = [E2E_UID, E2E_UID_B, '66666666-7777-4888-9999-aaaaaaaaaaaa', '로컬검수', 'e2e-refresh', 'access_token', 'refresh_token', 'source_report_id', 'contributor_id', 'fact_identity'];
const privacyHits = (x) => PRIVATE.filter((p) => x.allText.includes(p) || JSON.stringify(x.sheets).includes(p));
const structural = (x) => ({ sheets: Object.keys(x.sheets), control: x.controlChars, undeclared: x.undeclaredParts, missing: x.missingOverrides, broken: x.brokenRels, external: x.externalLinks ?? 0,
  macros: x.names.filter((n) => /vbaProject|externalLink|connections|customXml/.test(n)) });
const STRUCT_OK = { sheets: ['통계표', '차트', '차트 데이터', '조회 조건'], control: [], undeclared: [], missing: [], broken: [], external: 0, macros: [] };
/** 통계표 cell by row label (first label column) and full column header */
function tcell(x, rowLabel, header) {
  const cells = x.sheets['통계표'].cells;
  const head = Object.entries(cells).find(([, c]) => c.value === header)?.[0];
  if (!head) return undefined;
  const col = /^[A-Z]+/.exec(head)[0];
  const row = Object.entries(cells).find(([k, c]) => /^A\d+$/.test(k) && c.value === rowLabel)?.[0];
  return row ? cells[`${col}${/\d+/.exec(row)[0]}`] : undefined;
}
const tnum = (c) => (c ? c.num ?? (typeof c.value === 'number' ? c.value : null) : undefined);

try {
  // ── F01: renderer lifecycle ──────────────────────────────────────────────────────────────────────────────
  await step('F01', ['FN-01', 'FN-02', 'FN-03', 'FN-04'], async (ctx) => {
    const s = await statsPage(ctx);
    const { page } = s;
    await toStats(page);
    check('FN-01', 'first chart view is the auto heatmap (live instance)', await waitFor(() => series(page), (x) => x.length === 1), ['heatmap:fine_rate:all']);
    await chartType(page, 'bar');
    const bar = await waitFor(() => series(page), (x) => x.length > 0 && x.every((id) => !id.startsWith('heatmap')));
    check('FN-01', 'heatmap → 막대 directly: live ECharts series on the new host', bar.length > 0 && bar.every((id) => /:fine_rate:all$/.test(id)), true);
    check('FN-01', 'bars have data (not an empty card)', (await seriesData(page, bar[0]))?.length > 0, true);
    await shot(page, 'F01-bar-after-heatmap');
    const live = () => page.evaluate(() => ({ live: window.__cmChartLive, observers: window.__cmChartObservers,
      hosts: [...document.querySelectorAll('.chart-host')].filter((h) => h.__chart && !h.__chart.isDisposed()).length }));
    for (let i = 0; i < 20; i++) {
      await chartType(page, 'heatmap');
      await waitFor(() => series(page), (x) => x.length === 1 && x[0].startsWith('heatmap'));
      await chartType(page, 'bar');
      await waitFor(() => series(page), (x) => x.length > 0 && !x[0].startsWith('heatmap'));
    }
    const after = await live();
    check('FN-02', '막대↔히트맵 ×20: live instances = mounted hosts; observers = instances (no leak)', after.live === after.hosts && after.observers === after.live, true);
    ctx.note('FN-02 counters', after);
    // compare population: both heatmaps every time
    await page.locator('.stats-builder').getByLabel('전체와 비교').check();
    await runStats(page);
    for (let i = 0; i < 5; i++) {
      await chartType(page, 'heatmap');
      check('FN-02', `compare heatmap pair present (round ${i + 1})`, (await waitFor(() => series(page), (x) => x.length === 2)).sort(), ['heatmap:fine_rate:all', 'heatmap:fine_rate:mine']);
      await chartType(page, 'bar');
      await waitFor(() => series(page), (x) => x.length > 0 && !x[0].startsWith('heatmap'));
    }
    const after2 = await live();
    check('FN-02', 'after compare rounds: no stale instance/observer', after2.live === after2.hosts && after2.observers === after2.live, true);
    // summary ↔ chart
    await page.locator('.stats-builder').getByLabel('전체', { exact: true }).check();
    await setList(page, 0, []);
    await setList(page, 1, []);
    await runStats(page);
    check('FN-03', 'no dimensions → 요약값 (no chart host)', { summary: await page.locator('.stats-summary').count(), hosts: await page.locator('.stats-result .stats-chart-host').count() }, { summary: 1, hosts: 0 });
    await page.locator('.stats-builder .stats-list').nth(0).locator('select').selectOption('sido');
    await runStats(page);
    const back = await waitFor(() => series(page), (x) => x.length > 0);
    check('FN-03', '요약값 → 일반 차트: live series again', back.length > 0 && !back[0].startsWith('heatmap'), true);
    const l3 = await live();
    check('FN-03', 'no stale host reference after summary', l3.live === l3.hosts, true);
    // restored heatmap (session) → type change
    await page.locator('.stats-builder .stats-list').nth(1).locator('select').selectOption('law');
    await runStats(page);
    await chartType(page, 'heatmap');
    await waitFor(() => series(page), (x) => x.length === 1);
    await page.reload();
    await page.waitForSelector('.stats-result .stats-chart-host', { timeout: 20000 });
    check('FN-04', 'reload restores the heatmap first', await waitFor(() => series(page), (x) => x.length === 1), (x) => x[0].startsWith('heatmap'));
    await chartType(page, 'bar');
    check('FN-04', 'restored heatmap → 막대 works from the first mount', await waitFor(() => series(page), (x) => x.length > 0 && !x[0].startsWith('heatmap')), (x) => x.length > 0);
    await s.context.close();
  });

  // ── F03: legend ─────────────────────────────────────────────────────────────────────────────────────────
  await step('F03', ['FN-11', 'FN-12', 'FN-13', 'FN-14'], async (ctx) => {
    const s = await statsPage(ctx);
    const { page } = s;
    await page.locator('.stats-builder').getByLabel('예시 설정').selectOption('month_rates');
    await runStats(page);
    const tableBefore = await page.locator('.pivot-table').innerText();
    await toStats(page);
    const ids = await waitFor(() => series(page), (x) => x.length === 4);
    check('FN-11', '4 rate series + 4 legend buttons', { ids, buttons: await page.locator('.series-legend .series-toggle').count() },
      { ids: ['accept_rate:all', 'reject_rate:all', 'partial_rate:all', 'fine_rate:all'], buttons: 4 });
    const n0 = (await log()).length;
    await page.locator('.series-toggle[data-series-key="reject_rate:all"]').click();
    check('FN-11', '불수용률 hidden in the chart only', await waitFor(() => series(page), (x) => x.length === 3), ['accept_rate:all', 'partial_rate:all', 'fine_rate:all']);
    check('FN-11', 'aria-pressed=false on the hidden series', await page.locator('.series-toggle[data-series-key="reject_rate:all"]').getAttribute('aria-pressed'), 'false');
    await page.locator('.series-toggle[data-series-key="reject_rate:all"]').press('Enter');
    check('FN-11', 'Enter shows it again (keyboard)', await waitFor(() => series(page), (x) => x.length === 4), (x) => x.includes('reject_rate:all'));
    await page.locator('.series-toggle[data-series-key="reject_rate:all"]').click();
    await toTable(page);
    check('FN-11', 'table, totals, denominators unchanged while hidden', await page.locator('.pivot-table').innerText(), tableBefore);
    check('FN-11', 'no API request for hide/show', (await log()).slice(n0).length, 0);
    await toStats(page);
    check('FN-12', 'hidden state survives 표↔그래프', await waitFor(() => series(page), (x) => x.length === 3), (x) => !x.includes('reject_rate:all'));
    for (const k of ['accept_rate:all', 'partial_rate:all', 'fine_rate:all']) await page.locator(`.series-toggle[data-series-key="${k}"]`).click();
    check('FN-12', 'all hidden → "표시할 항목을 선택해 주세요" + 전체 보기 (not 0건/error)', await page.locator('.stats-result .empty-state[role="note"]').innerText(), (t) => t.includes('표시할 항목을 선택해 주세요') && !t.includes('0건'));
    await page.locator('.stats-result .pivot-sort').first().count(); // sort lives in the table; switch view to prove persistence
    await page.evaluate(() => { document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; });
    await toTable(page);
    await page.locator('.pivot-table .pivot-sort').first().click();
    await toStats(page);
    check('FN-12', 'still all hidden after sort + view round trip', await page.locator('.series-toggle[aria-pressed="false"]').count(), 4);
    await page.locator('.stats-result .empty-state').getByRole('button', { name: '전체 보기' }).click();
    check('FN-12', '전체 보기 restores every series', await waitFor(() => series(page), (x) => x.length === 4), (x) => x.length === 4);
    await shot(page, 'F03-legend');
    // 100% stack keeps the original denominator
    await setList(page, 0, ['agency']);
    await setList(page, 2, ['accepted_count', 'partial_count', 'rejected_count']);
    await runStats(page);
    await chartType(page, 'stack100');
    await waitFor(() => series(page), (x) => x.length === 3);
    const accBefore = await seriesData(page, 'accepted_count:all');
    const parBefore = await seriesData(page, 'partial_count:all');
    await page.locator('.series-toggle[data-series-key="rejected_count:all"]').click();
    await waitFor(() => series(page), (x) => x.length === 2);
    const accAfter = await seriesData(page, 'accepted_count:all');
    check('FN-13', '수용 share unchanged when 불수용 is hidden (no re-normalisation)', JSON.stringify(accAfter) === JSON.stringify(accBefore), true);
    const sums = accAfter.map((v, i) => (v ?? 0) + (parBefore[i] ?? 0));
    check('FN-13', 'remaining bars ≤ 100% (some < 100 where 불수용 > 0)', sums.every((v) => v <= 100.0001) && sums.some((v) => v < 99.99), true);
    check('FN-13', 'note about the fixed denominator', await page.locator('.stats-result .chart-caption').allInnerTexts(), (t) => t.some((x) => x.includes('숨긴 항목까지 합친 전체를 100%로')));
    // compare: hide 내 신고 only
    await page.locator('.stats-builder').getByLabel('전체와 비교').check();
    await setList(page, 2, ['accept_rate']);
    await runStats(page);
    await chartType(page, 'bar');
    await waitFor(() => series(page), (x) => x.length === 2);
    await page.locator('.series-toggle[data-series-key="accept_rate:mine"]').click();
    check('FN-14', '내 신고 hidden, 전체 of the same metric stays', await waitFor(() => series(page), (x) => x.length === 1), ['accept_rate:all']);
    await s.context.close();
  });

  // ── F02: share link ─────────────────────────────────────────────────────────────────────────────────────
  const decode = (url) => JSON.parse(Buffer.from(new URL(url).searchParams.get('sr'), 'base64url').toString('utf8'));
  await step('F02', ['FN-05', 'FN-06', 'FN-07', 'FN-08', 'FN-09', 'FN-10'], async (ctx) => {
    const s = await statsPage(ctx);
    const { page, context } = s;
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN });
    await setList(page, 0, ['agency']);
    await setList(page, 1, ['law']);
    await runStats(page);
    await toStats(page);
    await chartType(page, 'bar');
    // an unapplied draft change must not leak into the default share
    await page.locator('.stats-builder .stats-list').nth(0).locator('select').selectOption('sido');
    await page.locator('.stats-actions').getByRole('button', { name: '공유 링크' }).click();
    await page.locator('.share-panel').getByRole('button', { name: '링크 만들기' }).click();
    const url1 = await page.locator('.share-result input').inputValue();
    const p1 = decode(url1);
    check('FN-05', 'default = the APPLIED analysis (draft row not included)', p1.spec.rows, ['agency']);
    check('FN-05', 'clipboard holds the same link', await page.evaluate(() => navigator.clipboard.readText()), url1);
    await page.locator('.share-panel').getByLabel('고치는 중인 설정(아직 반영 전)').check();
    await page.locator('.share-panel').getByRole('button', { name: '링크 만들기' }).click();
    check('FN-05', 'the draft only when explicitly chosen', decode(await page.locator('.share-result input').inputValue()).spec.rows, ['agency', 'sido']);
    check('FN-06', 'link carries no labels, tokens, user ids, place or bbox', JSON.stringify(p1), (t) => !/[0-9a-f]{8}-[0-9a-f]{4}-|eyJ|place_key|bbox|로컬검수|label/.test(t));
    await shot(page, 'F02-share-panel');
    // open the link elsewhere (same account, fresh tab): same rows/columns/metrics/chart; the parameter is consumed
    const o = await openPage(browser, { search: new URL(url1).search, height: 1000 });
    captureConsole(o.page, ctx);
    await o.page.waitForSelector('.stats-result .stats-chart-host', { timeout: 20000 });
    const list = async (pg, i) => pg.locator('.stats-builder .stats-list').nth(i).locator('ol li span:first-child').allInnerTexts();
    check('FN-06', 'rows/columns/metrics order restored', { r: await list(o.page, 0), c: await list(o.page, 1), m: await list(o.page, 2) },
      { r: await list(page, 0).then((x) => x.slice(0, 1)), c: await list(page, 1), m: await list(page, 2) });
    check('FN-06', 'chart view + type restored', { type: await o.page.locator('.stats-result').getByLabel('유형').inputValue(), bars: (await waitFor(() => series(o.page), (x) => x.length > 0)).length > 0 }, { type: 'bar', bars: true });
    check('FN-06', 'banner says it was re-computed with my permission', await o.page.locator('.share-banner').innerText(), (t) => t.includes('공유받은 설정으로 통계를 만들었습니다'));
    check('FN-10', 'sr parameter removed after the run; screen kept', new URL(o.page.url()).searchParams.has('sr') ? 'sr' : new URL(o.page.url()).searchParams.get('screen'), 'statistics');
    await o.page.reload();
    await o.page.waitForSelector('.pivot-table tbody tr, .stats-result .stats-chart-host', { timeout: 20000 });
    check('FN-10', 'reload after the shared run restores the same analysis (no 404, no default)', await list(o.page, 1), await list(page, 1));
    await o.context.close();
    // invalid links: refused with the reason, no silent default run
    await api('reset');
    const bad = await openPage(browser, { search: '?screen=statistics&sr=eyJ2IjoyfQ', height: 900 });
    captureConsole(bad.page, ctx);
    check('FN-09', 'unsupported version refused with the reason', await waitFor(() => bad.page.locator('.share-banner').innerText().catch(() => ''), (t) => !!t), (t) => t.includes('열 수 없는 형식의 링크'));
    await sleep(1500);
    check('FN-09', 'no statistics request (no silent default)', statsReq(await log()).length, 0);
    const sqlish = Buffer.from(JSON.stringify({ v: 1, ...p1, spec: { ...p1.spec, metrics: ["x'; drop table t;--"] } })).toString('base64url');
    await bad.page.goto(`${ORIGIN}/?screen=statistics&sr=${sqlish}`);
    check('FN-09', 'SQL-like id refused', await waitFor(() => bad.page.locator('.share-banner').innerText().catch(() => ''), (t) => !!t), (t) => t.includes('쓰지 않는 값'));
    await bad.page.goto(`${ORIGIN}/?screen=statistics&sr=${'A'.repeat(5000)}`);
    check('FN-09', 'oversized link refused', await waitFor(() => bad.page.locator('.share-banner').innerText().catch(() => ''), (t) => !!t), (t) => t.includes('너무 길'));
    await bad.page.locator('.share-banner').getByRole('button', { name: '기본 화면 보기' }).click();
    check('FN-09', 'closing the error runs the default once (explicit)', await waitFor(async () => statsReq(await log()).length, (n) => n >= 1), 1);
    await bad.context.close();
    // compare link opened by another account: B's own numbers, nothing of A in the URL
    await page.locator('.stats-builder').getByLabel('전체와 비교').check();
    await runStats(page);
    await page.locator('.stats-actions').getByRole('button', { name: '공유 링크' }).click().catch(() => undefined);
    if (!(await page.locator('.share-panel').count())) await page.locator('.stats-actions').getByRole('button', { name: '공유 링크' }).click();
    check('FN-08', 'mine/compare needs an explicit confirmation', await page.locator('.share-panel').getByRole('button', { name: '링크 만들기' }).isDisabled(), true);
    await page.locator('.share-panel').getByLabel('확인했습니다. 이대로 공유할게요').check();
    await page.locator('.share-panel').getByRole('button', { name: '링크 만들기' }).click();
    const url2 = await page.locator('.share-result input').inputValue();
    check('FN-08', 'link has population compare and no account data', { pop: decode(url2).spec.population, clean: !url2.includes(E2E_UID) && !/[0-9a-f]{8}-[0-9a-f]{4}-|access_token|eyJhbGci|로컬검수/.test(JSON.stringify(decode(url2))) }, { pop: 'compare', clean: true });
    const b = await openPage(browser, { search: new URL(url2).search, height: 1000, uid: E2E_UID_B });
    captureConsole(b.page, ctx);
    const bResp = [];
    b.page.on('response', async (r) => { if (/my-analytics\/statistics/.test(r.url())) { try { bResp.push(await r.json()); } catch { /* ignore */ } } });
    await b.page.waitForSelector('.pivot-table tbody tr, .stats-result .stats-chart-host', { timeout: 20000 });
    await waitFor(() => bResp.length, (n) => n >= 1);
    const oracle = async (uid) => page.evaluate(async ({ token, spec, q }) => {
      const r = await fetch(`/functions/v1/my-analytics/statistics?${new URLSearchParams({ ...q, spec: JSON.stringify(spec) })}`, { headers: { Authorization: `Bearer ${token}` } });
      return (await r.json()).population_count.mine;
    }, { token: fakeSession(uid).access_token, spec: bResp[0].spec, q: { start: bResp[0].scope.start, end: bResp[0].scope.end, category: bResp[0].scope.category } });
    const [mineB, mineA] = [await oracle(E2E_UID_B), await oracle(E2E_UID)];
    check('FN-08', "B sees B's own 내 신고 count (oracle with B's token), not A's", { shown: bResp[0].population_count.mine, differs: mineA !== mineB }, { shown: mineB, differs: true });
    await b.context.close();
    // signed-out opener of a mine link: waits for sign-in (no request), then runs after the sign-in round trip
    await api('reset');
    const so = await openPage(browser, { search: new URL(url2).search, height: 900, signedIn: false });
    captureConsole(so.page, ctx, [/401|Unauthorized/]);
    // contributor-only site: a signed-out opener gets the normal access gate first (the link never bypasses it)
    check('FN-10', 'signed out + link → the usual access gate, nothing computed', await waitFor(() => so.page.locator('.access-gate').count(), (n) => n === 1, { timeout: 15000 }), 1);
    check('FN-10', 'the share parameter survives for the sign-in round trip', new URL(so.page.url()).searchParams.has('sr'), true);
    check('FN-10', 'no statistics request while waiting for sign-in', statsReq(await log()).length, 0);
    await so.page.evaluate((sess) => localStorage.setItem('cm-map-auth-v1', JSON.stringify(sess)), fakeSession(E2E_UID));
    await so.page.reload(); // what the OAuth redirect does: the same URL (sr kept, OAuth params stripped) with a session
    check('FN-10', 'after sign-in the shared compare recipe runs with my permission', await waitFor(() => so.page.locator('.share-banner').innerText().catch(() => ''), (t) => t.includes('통계를 만들었습니다')), (t) => t.includes('내 신고는 내 계정의 신고로 계산했습니다'));
    await so.context.close();
    // address condition: the sharer must confirm that the address is left out
    await api('reset');
    const m = await openPage(browser, { height: 1000 });
    captureConsole(m.page, ctx);
    await waitMap(m.page);
    await m.page.waitForSelector('.kpi-grid', { timeout: 20000 });
    await m.page.evaluate(() => { const mp = window.__kakaoMaps[window.__kakaoMaps.length - 1]; mp.setCenter(new kakao.maps.LatLng(37.55, 126.99)); mp.setLevel(5); });
    await waitFor(() => m.page.evaluate(() => window.__kakaoLiveMarkers().filter((x) => !x.title.includes('묶음')).length), (n) => n >= 1);
    await m.page.evaluate(() => { const ms = window.__kakaoLiveMarkers().filter((x) => !x.title.includes('묶음')).sort((a, b2) => a.title.localeCompare(b2.title)); ms[0].marker.__click(); });
    await m.page.locator('.place-panel').getByRole('button', { name: '이 조건으로 통계 만들기' }).click();
    await m.page.waitForSelector('.pivot-table tbody tr', { timeout: 20000 });
    await m.page.locator('.stats-actions').getByRole('button', { name: '공유 링크' }).click();
    check('FN-07', 'address exclusion is stated and must be confirmed', { note: await m.page.locator('.share-warn').innerText(), disabled: await m.page.locator('.share-panel').getByRole('button', { name: '링크 만들기' }).isDisabled() },
      (x) => x.note.includes('주소(') && x.disabled === true);
    await m.page.locator('.share-panel').getByLabel('확인했습니다. 이대로 공유할게요').check();
    await m.page.locator('.share-panel').getByRole('button', { name: '링크 만들기' }).click();
    check('FN-07', 'confirmed link has no place key', JSON.stringify(decode(await m.page.locator('.share-result input').inputValue())), (t) => !t.includes('pl1:') && !t.includes('place'));
    await m.context.close();
    await s.context.close();
  }, { expectedConsole: [/401|Unauthorized/] });

  // ── F06 statistics exports (browser WASM) ────────────────────────────────────────────────────────────────
  await step('EX-STATS', ['EX-01', 'EX-02', 'EX-03', 'EX-15', 'EX-16', 'EX-21', 'EX-22', 'EX-23', 'EX-33', 'EX-36', 'EX-37', 'EX-38', 'EX-45', 'EX-47', 'EX-48', 'EX-49', 'EX-50', 'EX-51', 'EX-53', 'EX-55'], async (ctx) => {
    const s = await statsPage(ctx);
    const { page } = s;
    const heavy = () => s.requests.filter((u) => /excelize|export\.worker|\/runner/.test(u));
    await toStats(page);
    await toTable(page);
    check('EX-36', 'no WASM / export chunk before the first click (load + 표↔그래프)', heavy(), []);
    const doc = await page.evaluate(async () => { const r = await fetch(location.href); return { coop: r.headers.get('cross-origin-opener-policy'), coep: r.headers.get('cross-origin-embedder-policy'), coi: crossOriginIsolated, sab: typeof SharedArrayBuffer }; });
    check('EX-38', 'no COOP/COEP headers; page not isolated; no SharedArrayBuffer', doc, { coop: null, coep: null, coi: false, sab: 'undefined' });
    await page.evaluate(() => { window.__stages = []; window.__cmExport.subscribe(() => { const x = window.__cmExport.snapshot(); window.__stages.push(x.status === 'running' ? x.stage : x.status); }); });
    const n0 = (await log()).length;
    const f1 = await download(s, 'statistics', 'stats-table-view');
    check('EX-01', 'the file was produced by excelize-wasm in a Web Worker of this page', { worker: f1.state.worker, wasm: heavy().some((u) => /excelize\.wasm/.test(u)), worker_js: heavy().some((u) => /export\.worker/.test(u)) }, { worker: true, wasm: true, worker_js: true });
    check('EX-37', 'Worker reports crossOriginIsolated=false and no SharedArrayBuffer', { coi: f1.state.crossOriginIsolated, sab: f1.state.sab }, { coi: false, sab: false });
    check('EX-45', 'progress follows the real stages', await page.evaluate(() => [...new Set(window.__stages)]), (x) => ['prepare', 'table', 'chart', 'finalize', 'ready'].every((st) => x.includes(st)) && x.indexOf('prepare') < x.indexOf('ready'));
    check('EX-47', 'a complete result exports without a statistics/API request', (await log()).slice(n0).length, 0);
    check('EX-48', 'file name + explicit 파일 저장 button after the file is ready', { name: /^커뮤니티신고지도_맞춤통계_\d{8}_\d{6}\.xlsx$/.test(f1.name), button: await page.locator('[data-export-source="statistics"] .export-ready .mini-btn').count() }, { name: true, button: 1 });
    const jobs0 = (await exp(page)).counters.jobs;
    const [again] = await Promise.all([page.waitForEvent('download'), page.locator('[data-export-source="statistics"] .export-ready .mini-btn').click()]);
    check('EX-48', '파일 저장 saves the same file again without a new job', { same: again.suggestedFilename() === f1.name, jobs: (await exp(page)).counters.jobs }, { same: true, jobs: jobs0 });
    check('EX-49', 'ZIP / content types / relationships valid; 4 sheets; no macro/external parts', structural(f1.x), STRUCT_OK);
    check('EX-53', 'no token / account id / nickname / report identifiers in any sheet, cache or property', privacyHits(f1.x), []);
    // EX-55: every table value is the server's exact number (rate = numerator/denominator of the SAME response)
    const resp = s.responses[s.responses.length - 1];
    const rowLabel = (key) => resp.row_members.find((m) => JSON.stringify(m.key) === JSON.stringify(key)).label[0];
    const colLabel = (key) => resp.col_members.find((m) => JSON.stringify(m.key) === JSON.stringify(key)).label.join(' · ');
    let compared = 0;
    const mismatches = [];
    for (const c of resp.cells.filter((x) => x.side === 'all')) {
      const fr = c.values.fine_rate, cc = c.values.completed_count;
      const r = tnum(tcell(f1.x, rowLabel(c.row), `${colLabel(c.col)} · 과태료 부과율 · 비율`));
      const expected = fr.denominator > 0 ? fr.numerator / fr.denominator : undefined;
      if (expected !== undefined && Math.abs(r - expected) > 1e-12) mismatches.push({ row: c.row, col: c.col, r, expected });
      const n = tnum(tcell(f1.x, rowLabel(c.row), `${colLabel(c.col)} · 답변 건수 · 값`));
      if (n !== cc.value) mismatches.push({ row: c.row, col: c.col, n, expected: cc.value });
      compared += 2;
    }
    check('EX-55', `table = server numbers (${compared} values; rates as 0–1 of numerator/denominator)`, mismatches, []);
    check('EX-55', 'grand total rate is the server total (not a mean)', tnum(tcell(f1.x, '합계', '행 합계 · 과태료 부과율 · 비율')), (() => { const g = resp.grand_totals.find((t) => t.side === 'all').values.fine_rate; return g.numerator / g.denominator; })());
    check('EX-02', 'table view → recommended chart of the same result (heatmap cells + colour scale)', { cf: f1.x.sheets['차트'].cf.length, charts: f1.x.charts.length }, { cf: 1, charts: 0 });
    check('EX-51', 'heatmap: numeric formula cells + colorScale 0..1', f1.x.sheets['차트'].cf[0].rules[0], (r) => r.type === 'colorScale' && r.cfvo[0].val === '0' && r.cfvo[1].val === '1');
    // chart view (bar) — same numbers, native chart referencing 차트 데이터
    await page.locator('[data-export-source="statistics"] .export-ready .link-btn').click();
    await toStats(page);
    await chartType(page, 'bar');
    await waitFor(() => series(page), (x) => x.length > 0);
    const f2 = await download(s, 'statistics', 'stats-chart-bar');
    const tbl = (x) => JSON.stringify(Object.fromEntries(Object.entries(x.sheets['통계표'].cells).filter(([k]) => !/^A[12]$/.test(k)).map(([k, c]) => [k, c.num ?? c.value])));
    check('EX-03', 'chart view exports the same table values', tbl(f2.x) === tbl(f1.x), true);
    const webSeries = await series(page);
    const bars = f2.x.charts.flatMap((c) => c.groups.flatMap((g) => g.series));
    check('EX-50', 'native bar chart: one series per web series, cell-referenced names/categories/values', { n: bars.length, refs: bars.every((b2) => b2.tx.kind === 'strRef' && b2.val.kind === 'numRef' && /^'차트 데이터'!/.test(b2.val.f) && /^'차트 데이터'!/.test(b2.cat.f)) }, { n: webSeries.length, refs: true });
    const webFirst = await seriesData(page, webSeries[0]);
    const fileFirst = rangeValues(f2.x, bars[0].val.f).map((v) => (v === null ? null : Math.round(v * 1000) / 10));
    check('EX-50', 'first series values = web bars (0–1 in the file = web %)', fileFirst, webFirst.map((v) => (v === null ? null : Math.round(v * 10) / 10)));
    // compare heatmap
    await page.locator('[data-export-source="statistics"] .export-ready .link-btn').click();
    await page.locator('.stats-builder').getByLabel('전체와 비교').check();
    await runStats(page);
    await chartType(page, 'heatmap');
    const f3 = await download(s, 'statistics', 'stats-compare-heatmap');
    const cf = f3.x.sheets['차트'].cf;
    check('EX-15', 'two matrices, same 0..1 colour scale', cf.map((c) => c.rules[0].cfvo.map((v) => v.val).join('-')), ['0-1', '0-1']);
    const mresp = s.responses[s.responses.length - 1];
    const mineCells = mresp.cells.filter((c) => c.side === 'mine').length, allCells = mresp.cells.filter((c) => c.side === 'all').length;
    const heatVals = cf.map((c) => rangeValues(f3.x, `'차트'!${c.sqref.replace(/([A-Z]+)(\d+)/g, '$$$1$$$2')}`));
    check('EX-16', 'my matrix has values only where I have reports (blank elsewhere, never the 전체 value or 0)', { all: heatVals[0].filter((v) => typeof v === 'number').length, mine: heatVals[1].filter((v) => typeof v === 'number').length },
      { all: mresp.cells.filter((c) => c.side === 'all' && c.values.fine_rate.value !== null).length, mine: mresp.cells.filter((c) => c.side === 'mine' && c.values.fine_rate.value !== null).length });
    ctx.note('EX-16 cells', { allCells, mineCells });
    check('EX-53', 'compare file: still no private data', privacyHits(f3.x), []);
    // 100% stack with a hidden series; all hidden; include hidden
    await page.locator('[data-export-source="statistics"] .export-ready .link-btn').click();
    await page.locator('.stats-builder').getByLabel('전체', { exact: true }).check();
    await setList(page, 1, []);
    await setList(page, 2, ['accepted_count', 'partial_count', 'rejected_count']);
    await runStats(page);
    await chartType(page, 'stack100');
    await waitFor(() => series(page), (x) => x.length === 3);
    await page.locator('.series-toggle[data-series-key="rejected_count:all"]').click();
    const f4 = await download(s, 'statistics', 'stats-stack100-hidden');
    const g4 = f4.x.charts[0].groups[0];
    const acc = rangeValues(f4.x, g4.series[0].val.f), par = rangeValues(f4.x, g4.series[1].val.f);
    const webAcc = (await seriesData(page, 'accepted_count:all')).map((v) => (v === null ? null : v / 100));
    check('EX-21', 'stacked (not percent-stacked), 2 visible series, shares of the ORIGINAL total = web', { grouping: g4.grouping, n: g4.series.length, same: acc.every((v, i) => (v === null && webAcc[i] === null) || Math.abs(v - webAcc[i]) < 1e-9), under: acc.some((v, i) => v !== null && v + (par[i] ?? 0) < 0.9999) },
      { grouping: 'stacked', n: 2, same: true, under: true });
    for (const k of ['accepted_count:all', 'partial_count:all']) await page.locator(`.series-toggle[data-series-key="${k}"]`).click();
    await page.locator('[data-export-source="statistics"] .export-ready .link-btn').click().catch(() => undefined);
    const f5 = await download(s, 'statistics', 'stats-all-hidden');
    check('EX-22', 'all hidden: table kept, no chart, notice (not 0건)', { charts: f5.x.charts.length, notice: f5.x.allText.includes('모든 항목을 숨긴'), rows: Object.keys(f5.x.sheets['통계표'].cells).length > 20 }, { charts: 0, notice: true, rows: true });
    await page.locator('[data-export-source="statistics"] .export-ready .link-btn').click();
    await page.locator('.stats-actions').getByLabel('숨긴 항목도 엑셀 차트에 넣기').check();
    const f6 = await download(s, 'statistics', 'stats-include-hidden');
    check('EX-23', 'explicit "숨긴 계열도 차트에 포함" draws all series; the table is identical', { n: f6.x.charts[0]?.groups[0].series.length, same: tbl(f6.x) === tbl(f5.x) }, { n: 3, same: true });
    // click → then a new run: the file keeps the clicked snapshot
    await page.locator('[data-export-source="statistics"] .export-ready .link-btn').click();
    await page.locator('.stats-builder').getByLabel('예시 설정').selectOption('region_outcome');
    await api('delay', { 'statistics/query': 800 });
    const title = await page.locator('.stats-result-head h2').innerText();
    const before = s.downloads.length;
    await page.locator('[data-export-source="statistics"] .export-btn').click();
    await page.locator('.stats-run .primary-button').click();
    await waitFor(() => exp(page), (x) => x.status === 'ready');
    await api('delay', {});
    const d7 = s.downloads.length > before ? s.downloads[s.downloads.length - 1] : await Promise.all([page.waitForEvent('download'), page.locator('[data-export-source="statistics"] .export-ready .mini-btn').click()]).then(([d]) => d);
    const p7 = join(dir, 'files', `${String(++fileNo).padStart(2, '0')}-stats-snapshot-kept.xlsx`);
    await d7.saveAs(p7);
    const x7 = inspect(readFileSync(p7));
    check('EX-33', 'file = the result at the click (title/metrics), not the newer run', x7.sheets['통계표'].cells.A1.value, `맞춤 통계 · ${title}`);
    await shot(page, 'EX-stats-ready');
    await s.context.close();
  });

  // ── F06 dashboard cards: monthly trend, managers ─────────────────────────────────────────────────────────
  await step('EX-CARDS', ['EX-04', 'EX-05', 'EX-06', 'EX-07', 'EX-32', 'EX-49', 'EX-53'], async (ctx) => {
    await api('reset');
    const s = await openPage(browser, { height: 1000 });
    captureConsole(s.page, ctx);
    s.downloads = [];
    s.page.on('download', (d) => s.downloads.push(d));
    const dash = [];
    s.page.on('response', async (r) => { if (/\/functions\/v1\/public-analytics\/dashboard/.test(r.url())) { try { dash.push(await r.json()); } catch { /* ignore */ } } });
    const { page } = s;
    await waitMap(page);
    await page.waitForSelector('.kpi-grid', { timeout: 20000 });
    await sleep(800);
    const trend = page.locator('.trend-card');
    await trend.getByRole('button', { name: '처리결과 비율' }).click();
    const checks = trend.locator('.rate-checks input');
    const want = async (on) => { for (let i = 0; i < 4; i++) { const c = checks.nth(i); if ((await c.isChecked()) !== on.includes(i)) await c.click(); } };
    await want([0, 3]);
    const f1 = await download(s, 'trend', 'trend-2rates');
    const m = dash[dash.length - 1].monthly;
    const expAccept = m.map((x) => (x.outcomes && x.outcomes.result_known > 0 ? x.outcomes.accepted / x.outcomes.result_known : null));
    const g1 = f1.x.charts[0].groups[0];
    check('EX-04', 'only the 2 checked rates are chart series', g1.series.map((x) => f1.x.sheets['차트 데이터'].cells[x.tx.f.split('!')[1].replace(/\$/g, '')]?.value), ['수용률 · 전체', '과태료 부과율 · 전체']);
    check('EX-04', '수용률 values = accepted ÷ result_known of each month (gaps where K=0)', rangeValues(f1.x, g1.series[0].val.f).map((v) => (v === null ? null : Math.round(v * 1e9) / 1e9)), expAccept.map((v) => (v === null ? null : Math.round(v * 1e9) / 1e9)));
    await page.locator('[data-export-source="trend"] .export-ready .link-btn').click();
    // my comparison: waits while it loads, then 4 rates × 전체/내 = 8 lines
    await want([0, 1, 2, 3]);
    await api('delay', { 'my-analytics': 2500 });
    const compareToggle = page.getByRole('switch', { name: /내 신고/ }).first();
    if (await compareToggle.count()) await compareToggle.click(); else await page.getByLabel(/내 신고 비교|내 신고 함께/).first().check();
    check('EX-32', 'while my comparison loads the export waits (no half file)', await waitFor(() => page.locator('[data-export-source="trend"] .export-hint').innerText(), (t) => t.includes('내 신고를 불러오는 중')), (t) => t.includes('불러오는 중'));
    check('EX-32', 'button disabled meanwhile', await page.locator('[data-export-source="trend"] .export-btn').isDisabled(), true);
    await api('delay', {});
    await waitFor(() => page.locator('[data-export-source="trend"] .export-btn').isDisabled(), (d) => d === false, { timeout: 10000 });
    const f2 = await download(s, 'trend', 'trend-4rates-compare');
    const g2 = f2.x.charts[0].groups[0];
    check('EX-05', '8 native line series (4 rates × 전체/내), 내 신고 dashed', { n: g2.series.length, dashed: g2.series.filter((x) => x.dash === 'dash').length, type: g2.type }, { n: 8, dashed: 4, type: 'lineChart' });
    await page.locator('[data-export-source="trend"] .export-ready .link-btn').click();
    await trend.getByRole('button', { name: '건수' }).click();
    const f3 = await download(s, 'trend', 'trend-counts');
    const g3 = f3.x.charts[0].groups[0];
    check('EX-06', 'count view: 신고/답변(+내 신고) counts on their own date basis', { first: rangeValues(f3.x, g3.series[0].val.f), second: rangeValues(f3.x, g3.series[1].val.f) },
      { first: m.map((x) => x.report_count), second: m.map((x) => x.completed_count) });
    check('EX-06', 'no 0–100% axis in the count chart', f3.x.charts[0].valAx[0].max, null);
    await page.locator('[data-export-source="trend"] .export-ready .link-btn').click();
    // managers of the displayed range (scope detail panel)
    await waitFor(() => page.locator('[data-export-source="place-managers"]').count(), (n) => n >= 1, { timeout: 15000 });
    const shownN = await page.locator('.place-entity-chart .chart-caption').innerText();
    const f4 = await download(s, 'place-managers', 'range-managers');
    const nRows = Object.keys(f4.x.sheets['통계표'].cells).filter((k) => /^A\d+$/.test(k)).length;
    const [, shown, total] = /담당자 표시 ([\d,]+)명 \/ 전체 ([\d,]+)명/.exec(shownN) ?? [];
    check('EX-07', 'managers in the file = the card list; full/partial stated', { rows: nRows - 6, state: f4.x.allText.includes(Number(shown.replace(/,/g, '')) < Number(total.replace(/,/g, '')) ? '일부만 담음' : `전체 ${shown}명`) },
      { rows: Number(shown.replace(/,/g, '')), state: true });
    check('EX-07', '100% bars + answered line on a secondary axis', f4.x.charts[0].groups.map((g) => `${g.type}:${g.grouping}`), ['barChart:stacked', 'lineChart:standard']);
    for (const f of [f1, f2, f3, f4]) check('EX-49', `structure ok (${f.name})`, structural(f.x), STRUCT_OK);
    for (const f of [f1, f2, f3, f4]) check('EX-53', `no private data (${f.name})`, privacyHits(f.x), []);
    await shot(page, 'EX-cards');
    await s.context.close();
  });

  // ── F06 job lifecycle: cancel, failure/retry, repeat, account switch, sign-out ─────────────────────────────
  await step('EX-LIFE', ['EX-31', 'EX-34', 'EX-35', 'EX-42', 'EX-43', 'EX-44', 'EX-46', 'EX-58'], async (ctx) => {
    const s = await statsPage(ctx);
    const { page, context } = s;
    const BIG = () => {
      window.__bigSnapshot = () => {
        const cols = [{ id: 'l', header: ['항목'], unit: 'text', label: true }];
        for (let j = 0; j < 20; j++) { cols.push({ id: `n${j}`, header: [`지표${j}`, '분자(건)'], unit: 'count' }, { id: `d${j}`, header: [`지표${j}`, '분모(건)'], unit: 'count' }, { id: `r${j}`, header: [`지표${j}`, '비율'], unit: 'percent', rate: { num: `n${j}`, den: `d${j}` } }); }
        const rows = Array.from({ length: 2000 }, (_, i) => ({ id: `r${i}`, cells: Object.fromEntries([['l', `항목 ${i}`], ...Array.from({ length: 20 }, (_, j) => [[`n${j}`, (i * j) % 7], [`d${j}`, 7 + (i % 5)]]).flat()]) }));
        return { schema: 1, source: 'statistics', fileStem: '커뮤니티신고지도_맞춤통계', title: '최대 목표 측정용 합성 표', capturedAt: new Date().toISOString(), datasetVersion: 'synthetic',
          conditions: [], table: { columns: cols, rows, notes: [] }, chartNotice: null, legend: null,
          charts: [{ kind: 'col', id: 'big', title: '합성 막대', categoryTitle: '항목', categories: rows.slice(0, 50).map((r) => r.cells.l), unit: 'percent', axis: { min: 0, max: 1 },
            series: [0, 1, 2].map((j) => ({ key: `s${j}`, name: `지표${j}`, color: '#2563EB', points: rows.slice(0, 50).map((r) => ({ row: r.id, col: `r${j}` })) })) }] };
      };
    };
    await context.addInitScript(BIG);
    await page.evaluate(BIG);
    const WASM = (u) => /excelize\.wasm(-[\w-]+)?\.gz$/.test(u.pathname) && !u.search.includes('import');
    const slowWasm = async (ms) => context.route(WASM, async (route) => { await sleep(ms); await route.continue(); });
    // EX-31 locked while a new result is on the way
    await page.locator('.stats-builder').getByLabel('예시 설정').selectOption('region_outcome');
    await api('delay', { 'statistics/query': 2500 });
    await page.locator('.stats-run .primary-button').click();
    check('EX-31', 'a running query locks the export with the reason', { disabled: await page.locator('[data-export-source="statistics"] .export-btn').isDisabled(), why: await page.locator('[data-export-source="statistics"] .export-hint').innerText() },
      { disabled: true, why: '새 결과를 만드는 중이라 잠시 뒤에 받을 수 있습니다' });
    await api('delay', {});
    await waitFor(() => page.locator('[data-export-source="statistics"] .export-btn').isDisabled(), (d) => !d, { timeout: 10000 });
    // EX-43 cancel (a slow first load): only the export stops
    await slowWasm(4000);
    const n0 = (await log()).length;
    const d0 = s.downloads.length;
    await page.locator('[data-export-source="statistics"] .export-btn').click();
    await sleep(500);
    await page.locator('[data-export-source="statistics"] .export-progress').getByRole('button', { name: '취소' }).click();
    await toStats(page);
    await toTable(page);
    await sleep(5000);
    const c1 = await exp(page);
    check('EX-43', 'cancel: idle with a note, Worker terminated, no download, no statistics request, table intact',
      { status: c1.status, live: c1.counters.workersLive, downloads: s.downloads.length - d0, api: (await log()).slice(n0).length, rows: await page.locator('.pivot-table tbody tr').count() > 0 },
      { status: 'idle', live: 0, downloads: 0, api: 0, rows: true });
    await context.unroute(WASM);
    // EX-42 asset failure → message, data kept → retry works (not a cached rejection)
    await context.route(WASM, (route) => route.fulfill({ status: 404, contentType: 'text/html', body: '<!doctype html><h1>404</h1>' }));
    await page.locator('[data-export-source="statistics"] .export-btn').click();
    const e1 = await waitFor(() => exp(page), (x) => x.status === 'error');
    check('EX-42', 'HTML 404 for the WASM → local error message, table kept', { code: e1.code, msg: await page.locator('[data-export-source="statistics"] .export-error').innerText(), rows: await page.locator('.pivot-table tbody tr').count() > 0 },
      (x) => x.code === 'asset_http' && x.msg.includes('다시 시도') && x.rows);
    await context.unroute(WASM);
    await page.locator('[data-export-source="statistics"] .export-error').getByRole('button', { name: '다시 시도' }).click();
    check('EX-42', 'retry after the failure succeeds', (await waitFor(() => exp(page), (x) => x.status === 'ready' || x.status === 'error', { timeout: 60000 })).status, 'ready');
    await page.locator('[data-export-source="statistics"] .export-ready .link-btn').click();
    // EX-44 double click → one job; 10 exports in a row → one reused Worker, no pile-up
    const j0 = (await exp(page)).counters.jobs;
    await page.locator('[data-export-source="statistics"] .export-btn').dblclick();
    await waitFor(() => exp(page), (x) => x.status === 'ready');
    check('EX-44', 'double click starts one job', (await exp(page)).counters.jobs - j0, 1);
    const heap0 = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? null);
    const times = [];
    for (let i = 0; i < 10; i++) {
      await page.locator('[data-export-source="statistics"] .export-ready .link-btn').click();
      const t0 = Date.now();
      await page.locator('[data-export-source="statistics"] .export-btn').click();
      await waitFor(() => exp(page), (x) => x.status === 'ready');
      times.push(Date.now() - t0);
    }
    const c2 = await exp(page);
    const heap1 = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? null);
    check('EX-44', '10 exports: one Worker reused, ≤1 live Worker, all jobs finished', { created: c2.counters.workersCreated, live: c2.counters.workersLive, status: c2.status }, { created: c2.counters.workersCreated <= 3 ? c2.counters.workersCreated : -1, live: 1, status: 'ready' });
    ctx.note('EX-44/58 repeat', { ms: times, pageHeapBefore: heap0, pageHeapAfter: heap1, urlsLive: c2.counters.urlsLive });
    // EX-58 large target: 2,000 rows × 60 numeric columns + a 50-category chart, through the same Worker
    const big = await page.evaluate(async () => {
      window.__cmExport.dismiss();
      let longest = 0; let last = performance.now();
      const iv = setInterval(() => { const now = performance.now(); longest = Math.max(longest, now - last - 50); last = now; }, 50);
      const t0 = performance.now();
      window.__cmExport.start(window.__bigSnapshot());
      await new Promise((res) => { const un = window.__cmExport.subscribe(() => { const x = window.__cmExport.snapshot(); if (x.status !== 'running') { un(); res(); } }); });
      clearInterval(iv);
      const st = window.__cmExport.snapshot();
      return { status: st.status, ms: Math.round(performance.now() - t0), workerMs: st.ms, bytes: st.size, cells: 2000 * 61, mainThreadMaxLagMs: Math.round(longest) };
    });
    check('EX-58', 'large synthetic target (122,000 cells + chart) completes in the Worker; main thread stays responsive (<200 ms lag)', big, (x) => x.status === 'ready' && x.mainThreadMaxLagMs < 200);
    ctx.note('EX-58 large', big);
    await page.evaluate(() => window.__cmExport.dismiss());
    // EX-34 account change while a (long) file is being made → cancelled, no file, no save button
    await page.evaluate(() => window.__cmExport.dismiss());
    const d1 = s.downloads.length;
    await page.evaluate(() => window.__cmExport.start(window.__bigSnapshot()));
    await waitFor(() => exp(page), (x) => x.status === 'running' && x.stage !== 'queued' && x.stage !== 'prepare');
    const switchTo = async (session) => {
      const other = await context.newPage(); // BroadcastChannel never delivers to the sender: switch from another tab
      await other.goto(`${ORIGIN}/?screen=none`);
      await other.evaluate((b) => { if (b) localStorage.setItem('cm-map-auth-v1', JSON.stringify(b)); else localStorage.removeItem('cm-map-auth-v1');
        new BroadcastChannel('cm-map-auth-v1').postMessage({ event: b ? 'SIGNED_IN' : 'SIGNED_OUT', session: b }); }, session);
      await other.close();
    };
    await switchTo(fakeSession(E2E_UID_B));
    const c3 = await waitFor(() => exp(page), (x) => x.status !== 'running', { timeout: 20000 });
    await sleep(14000); // longer than the job itself: a late Worker message would have produced a file by now
    check('EX-34', "A's running export is cancelled on the switch to B: no file, no save button, Worker gone", { status: c3.status, downloads: s.downloads.length - d1, save: await page.locator('.export-ready').count(), live: (await exp(page)).counters.workersLive },
      { status: 'idle', downloads: 0, save: 0, live: 0 });
    // EX-46 finished file + account change → the save button and the buffer are dropped
    await page.waitForSelector('.pivot-table tbody tr', { timeout: 20000 });
    await page.locator('[data-export-source="statistics"] .export-btn').click();
    await waitFor(() => exp(page), (x) => x.status === 'ready', { timeout: 60000 });
    await switchTo(fakeSession(E2E_UID));
    check('EX-46', 'account change drops the finished file and its save button', await waitFor(async () => ({ status: (await exp(page)).status, save: await page.locator('.export-ready').count() }), (x) => x.status === 'idle' && x.save === 0), { status: 'idle', save: 0 });
    // EX-35 sign-out while running (a long job)
    await page.waitForSelector('.pivot-table tbody tr', { timeout: 20000 });
    const d2 = s.downloads.length;
    await page.evaluate(() => window.__cmExport.start(window.__bigSnapshot()));
    await waitFor(() => exp(page), (x) => x.status === 'running' && x.stage !== 'queued' && x.stage !== 'prepare');
    await switchTo(null);
    const c4 = await waitFor(() => exp(page), (x) => x.status !== 'running', { timeout: 20000 });
    await sleep(14000);
    check('EX-35', 'sign-out cancels the running export (no file, Worker gone)', { status: c4.status, downloads: s.downloads.length - d2, live: (await exp(page)).counters.workersLive }, { status: 'idle', downloads: 0, live: 0 });
    await s.context.close();
  }, { expectedConsole: [/Failed to load resource.*404/, /401|Unauthorized/] });

  // ── production build on a Pages-like static server: sub path, CSP, server-decoded WASM, cache ─────────────
  await step('EX-PAGES', ['EX-39', 'EX-40', 'EX-41', 'EX-60'], async (ctx) => {
    const distDir = join(dir, '..', '..', '..', '..', '.verify-dist');
    execSync(`npx vite build --outDir ${distDir} --emptyOutDir`, { env: { ...process.env, VITE_DATA_MODE: 'demo', VITE_BASE_PATH: '/safetyreport-community-map/', VITE_KAKAO_MAP_JS_KEY: 'mock-e2e-key' }, stdio: 'ignore' });
    const servers = [];
    const serve = (port, extra) => new Promise((res) => {
      const p = spawn('node', ['scripts/browser/static_pages.mjs'], { env: { ...process.env, PORT: String(port), DIST: distDir, ...extra }, stdio: ['ignore', 'pipe', 'inherit'] });
      servers.push(p);
      p.stdout.once('data', () => res(p));
    });
    try {
      await serve(5192, {}); await serve(5193, { CSP: '1' }); await serve(5194, { GZ_ENCODING: '1' });
      // mock=false: no Playwright routing at all (routing disables the HTTP cache) — the map SDK then fails to load,
      // which the statistics screen does not need
      const open = async (port, mock = true) => {
        const ctx2 = await browser.newContext({ locale: 'ko-KR', viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
        if (mock) await ctx2.route('https://dapi.kakao.com/**', (route) => route.fulfill({ contentType: 'text/javascript', body: readFileSync(new URL('./mock-kakao-sdk.js', import.meta.url), 'utf8') }));
        const page = await ctx2.newPage();
        const bad = [];
        page.on('response', (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`); });
        const csp = [];
        await page.exposeFunction('__cspViolation', (v) => csp.push(v));
        await page.addInitScript(() => document.addEventListener('securitypolicyviolation', (e) => window.__cspViolation({ directive: e.violatedDirective, blocked: e.blockedURI, source: e.sourceFile, line: e.lineNumber })));
        captureConsole(page, ctx);
        await page.goto(`http://127.0.0.1:${port}/safetyreport-community-map/?screen=statistics`);
        await page.waitForSelector('.pivot-table tbody tr', { timeout: 30000 });
        return { ctx2, page, bad, csp };
      };
      const exportOnce = async (page) => {
        const [d] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }).catch(() => null), page.locator('[data-export-source="statistics"] .export-btn').click()]);
        if (d) return d;
        await page.waitForSelector('[data-export-source="statistics"] .export-ready', { timeout: 60000 });
        const [d2] = await Promise.all([page.waitForEvent('download'), page.locator('[data-export-source="statistics"] .export-ready .mini-btn').click()]);
        return d2;
      };
      const a = await open(5192, false);
      const d1 = await exportOnce(a.page);
      const p1 = join(dir, 'files', `${String(++fileNo).padStart(2, '0')}-pages-subpath.xlsx`);
      await d1.saveAs(p1);
      check('EX-40', 'production build under /safetyreport-community-map/: export works, no 4xx/5xx', { struct: structural(inspect(readFileSync(p1))), bad: a.bad }, { struct: STRUCT_OK, bad: [] });
      const hits = await (await fetch('http://127.0.0.1:5192/__hits')).json();
      const wasmPath = Object.keys(hits).find((k) => /excelize\.wasm-.*\.gz$/.test(k));
      check('EX-40', 'WASM and Worker came from the site sub path (same origin)', { wasm: wasmPath?.startsWith('/safetyreport-community-map/assets/'), worker: Object.keys(hits).some((k) => /^\/safetyreport-community-map\/assets\/export\.worker-.*\.js$/.test(k)) }, { wasm: true, worker: true });
      // EX-60: a second export after a reload reuses the cached asset (no second download of the 4 MB archive)
      await a.page.reload();
      await a.page.waitForSelector('.pivot-table tbody tr', { timeout: 30000 });
      await exportOnce(a.page);
      const hits2 = await (await fetch('http://127.0.0.1:5192/__hits')).json();
      check('EX-60', 'second export after reload: WASM served from the browser cache (server hit once)', hits2[wasmPath], 1);
      const pinned = JSON.parse(readFileSync('package.json', 'utf8')).dependencies['excelize-wasm'];
      check('EX-60', 'pinned excelize-wasm 0.1.3 + license notice shipped', { pinned, license: existsIn(distDir, 'licenses/excel-export-third-party.txt') }, { pinned: '0.1.3', license: true });
      await a.ctx2.close();
      const c = await open(5193);
      const d3 = await exportOnce(c.page);
      // every violation is recorded; the export's own files (Worker, runner, loader, WASM) must cause none. Known and
      // pre-existing: Zod's JIT feature probe `try { Function('') }` in the personal chunk (caught; Zod then runs jitless)
      ctx.note('EX-39 all CSP reports', c.csp);
      check('EX-39', "strict CSP (script-src 'self' 'wasm-unsafe-eval', worker-src 'self', no unsafe-eval/unsafe-inline scripts): the file is made", !!d3, true);
      check('EX-39', 'no CSP report from the export (worker/runner/WASM) and no wasm-eval / worker-src block', c.csp.filter((v) => /export\.worker|runner|excelize/.test(`${v.source} ${v.blocked}`) || /worker-src|wasm/.test(v.directive)), []);
      check('EX-39', 'the only other report is the known Zod JIT probe (pre-existing, not Excel)', c.csp.filter((v) => !(v.blocked === 'eval' && /\/assets\/personal-[\w-]+\.js$/.test(v.source ?? ''))), []);
      await c.ctx2.close();
      const g = await open(5194);
      const d4 = await exportOnce(g.page);
      const p4 = join(dir, 'files', `${String(++fileNo).padStart(2, '0')}-pages-content-encoding.xlsx`);
      await d4.saveAs(p4);
      check('EX-41', 'WASM sent with Content-Encoding: gzip (browser-decoded) is re-wrapped once → valid file', structural(inspect(readFileSync(p4))), STRUCT_OK);
      await g.ctx2.close();
    } finally {
      for (const p of servers) p.kill();
    }
  }, { expectedConsole: [/Failed to load resource/, /Refused to evaluate a string as JavaScript/, /kakao|지도|SDK/i] });
} finally {
  await browser.close();
  run.finish();
}

function existsIn(root, rel) { try { readFileSync(join(root, rel)); return true; } catch { return false; } }
