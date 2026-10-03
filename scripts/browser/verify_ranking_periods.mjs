// Actual Chrome + LOCAL GoTrue/JWT/DB ranking RPC; synthetic users only, never a static ranking mock.
import { chromium } from './harness.mjs';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const base = process.env.RANKINGS_ORIGIN || 'http://127.0.0.1:5192';
const out = process.argv[2] || 'docs/implementation/ranking-periods/evidence/browser';
mkdirSync(out, { recursive: true });
const { session } = await (await fetch(`${base}/__rankings/session`)).json();
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--lang=ko-KR'] });
const checks = [], responses = [], errors = [];
const check = (name, condition) => { assert.ok(condition, name); checks.push({ name, status: 'PASS' }); };
const entries = ['최다 신고자', '최다 과태료 수용자', '최다 불운자', '월별 최다 신고자', '월별 최다 과태료 수용자', '월별 불운자'];
let failure = null;
async function open(width, theme, search = '?screen=rankings') {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme: theme });
  await context.addInitScript(({ session, theme }) => {
    localStorage.setItem('cm-map-auth-v1', JSON.stringify(session)); localStorage.setItem('cm-theme', theme);
  }, { session, theme });
  await context.route('https://dapi.kakao.com/**', r => r.fulfill({ contentType: 'text/javascript', body: readFileSync(new URL('./mock-kakao-sdk.js', import.meta.url), 'utf8') }));
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${base}/${search}`); await page.locator('.rk-page tbody tr').first().waitFor();
  return { page, context, rk: page.locator('.rk-page') };
}
async function apply(page, expected) {
  const received = page.waitForResponse(r => {
    const u = new URL(r.url());
    return u.pathname.includes('/user-rankings') && Object.entries(expected).every(([k, v]) => u.searchParams.get(k) === String(v));
  });
  await page.locator('.rk-page').getByRole('button', { name: '적용', exact: true }).click();
  const reply = await received;
  assert.equal(reply.status(), 200);
  const data = await reply.json();
  await page.locator('.rk-page tbody tr').first().waitFor();
  responses.push({ status: reply.status(), cache_control: reply.headers()['cache-control'], scope: data.scope, participants: data.total_participants,
    own: data.me && { rank: data.me.rank, numerator: data.me.numerator, denominator: data.me.denominator, reports: data.me.reports, fine: data.me.fine, rejected: data.me.rejected, partial: data.me.partial }, bytes: Buffer.byteLength(JSON.stringify(data)) });
  return data;
}
try {
  for (const width of [1440, 1920, 2560, 390]) for (const theme of ['light', 'dark']) {
    const { page, context, rk } = await open(width, theme);
    for (const name of entries) check(`${width}/${theme} entry ${name}`, await rk.getByRole('button', { name, exact: true }).count() === 1);
    await rk.getByRole('button', { name: '월별 최다 신고자', exact: true }).click();
    await rk.getByLabel('조회 달', { exact: true }).fill('2023-07');
    await apply(page, { theme: 'reporters', period: 'month', month: '2023-07' });
    check(`${width}/${theme} July title and own summary`, await rk.locator('h1').innerText() === '2023년 7월의 최다 신고자' && await rk.getByRole('heading', { name: '내 순위', exact: true }).isVisible());
    check(`${width}/${theme} no horizontal page overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: `${out}/${width}-${theme}-july.png`, fullPage: true });
    if (width === 390 && theme === 'light') {
      // Enlarge every actual rendered text, rather than only changing an unused rem base.
      await page.evaluate(() => { const nodes = [...document.querySelectorAll('.rk-page, .rk-page *')]; const sizes = nodes.map(n => parseFloat(getComputedStyle(n).fontSize)); nodes.forEach((n, i) => { n.style.fontSize = `${sizes[i] * 2}px`; }); });
      check('mobile 200% rendered font no horizontal page overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: `${out}/390-light-font200.png`, fullPage: true });
    }
    await context.close();
  }
  const { page, context, rk } = await open(1440, 'dark');
  let requests = 0;
  page.on('request', r => { if (r.url().includes('/user-rankings')) requests++; });
  await rk.getByRole('button', { name: '월별 최다 신고자', exact: true }).click();
  await rk.getByLabel('조회 달', { exact: true }).fill('2023-07');
  check('draft controls retain old applied heading before apply', await rk.locator('h1').innerText() === '최다 신고자' && requests === 0);
  const reporter = await apply(page, { theme: 'reporters', period: 'month', month: '2023-07' });
  check('July reporters complete cohort N=2, winner N=5 with joint rank', reporter.me.reports === 2 && reporter.rows[0].reports === 5 && reporter.rows[0].rank === 1 && reporter.rows[0].tie_count === 6);
  for (const [name, theme, metric] of [['월별 최다 과태료 수용자', 'fines', 'fine_rate'], ['월별 불운자', 'unlucky', 'rejected_rate']]) {
    await rk.getByRole('button', { name, exact: true }).click();
    check(`${name} preserves selected July`, await rk.getByLabel('조회 달', { exact: true }).inputValue() === '2023-07');
    await rk.getByLabel('지표', { exact: true }).selectOption(metric);
    const data = await apply(page, { theme, metric, period: 'month', month: '2023-07' });
    check(`${name} same scope and N with fraction 1/2`, data.scope.start === '2023-07-01' && data.scope.end === '2023-07-31' && data.me.denominator === 2 && data.me.numerator === 1 && data.me.value === 50);
    check(`${name} fraction rendered`, (await rk.locator('[aria-label="내 순위 요약"]').innerText()).includes('1/2건'));
    await page.screenshot({ path: `${out}/july-${theme}-rate.png`, fullPage: true });
  }
  for (const metric of ['rejected_count', 'rejected_rate', 'partial_count', 'partial_rate']) {
    await rk.getByLabel('지표', { exact: true }).selectOption(metric);
    const data = await apply(page, { theme: 'unlucky', metric, period: 'month', month: '2023-07' });
    check(`monthly unlucky ${metric} supported separately`, data.me.numerator === 1 && data.me.denominator === 2);
  }
  await rk.getByRole('button', { name: '월별 최다 신고자', exact: true }).click();
  await apply(page, { theme: 'reporters', period: 'month', month: '2023-07' });
  await rk.getByRole('button', { name: '다음', exact: true }).click();
  await rk.getByText('2페이지 · 20명씩', { exact: true }).waitFor();
  check('historical month page2 preserves global own rank', (await rk.locator('[aria-label="내 순위 요약"]').innerText()).includes('20위'));
  await rk.getByRole('button', { name: '최다 불운자', exact: true }).click();
  await rk.getByLabel('지표', { exact: true }).selectOption('partial_rate');
  const cumulative = await apply(page, { theme: 'unlucky', period: 'all', metric: 'partial_rate' });
  check('cumulative unlucky includes all months and keeps metric', cumulative.me.reports === 53 && cumulative.me.partial === 14 && cumulative.scope.month === null && await rk.locator('h1').innerText() === '최다 불운자');
  await page.screenshot({ path: `${out}/cumulative-unlucky.png`, fullPage: true });
  await rk.getByRole('button', { name: '직접 범위', exact: true }).click();
  await rk.getByLabel('시작일', { exact: true }).fill('2023-07-01'); await rk.getByLabel('종료일', { exact: true }).fill('2023-07-31');
  const range = await apply(page, { theme: 'unlucky', period: 'range' });
  check('cumulative unlucky custom range equals July cohort', range.me.reports === 2 && range.me.partial === 1);
  await rk.getByRole('button', { name: '월별 최다 신고자', exact: true }).click();
  const current = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 7);
  await rk.getByLabel('조회 달', { exact: true }).fill(current);
  for (const [name, theme] of [['월별 최다 신고자', 'reporters'], ['월별 최다 과태료 수용자', 'fines'], ['월별 불운자', 'unlucky']]) {
    await rk.getByRole('button', { name, exact: true }).click();
    const data = await apply(page, { theme, period: 'month', month: current });
    check(`${name} current month same N=50 and progress label`, data.me.reports === 50 && data.scope.in_progress && (await rk.locator('h1').innerText()).startsWith('이달의 ') && await rk.getByText(/진행 중인 달이라/).isVisible());
  }
  await rk.getByLabel('조회 달', { exact: true }).fill('2023-07'); await rk.getByLabel('날짜 기준', { exact: true }).selectOption('report_date');
  const reportDate = await apply(page, { theme: 'unlucky', period: 'month', month: '2023-07', date_basis: 'report_date' });
  check('report-date changes whole July cohort N=1 and R=0', reportDate.me.reports === 1 && reportDate.me.rejected === 0 && reportDate.me.partial === 1);
  await page.reload(); await rk.locator('table tbody tr').first().waitFor();
  check('refresh preserves historical month/metric/date basis', await rk.getByLabel('조회 달', { exact: true }).inputValue() === '2023-07' && await rk.getByLabel('날짜 기준', { exact: true }).inputValue() === 'report_date' && (await rk.locator('h1').innerText()).startsWith('2023년 7월의 '));
  await page.locator('nav').getByRole('button', { name: '지도', exact: true }).click();
  await page.waitForFunction(() => new URLSearchParams(location.search).get('screen') !== 'rankings');
  await page.locator('nav').getByRole('button', { name: '유저 랭킹', exact: true }).click(); await rk.locator('table tbody tr').first().waitFor();
  await page.goBack(); await page.goForward(); await rk.locator('table tbody tr').first().waitFor();
  check('route/back/forward preserves selected historical month', await rk.getByLabel('조회 달', { exact: true }).inputValue() === '2023-07');
  await rk.getByRole('button', { name: '월별 최다 신고자', exact: true }).focus(); await page.keyboard.press('Enter');
  check('keyboard activates monthly entry and preserves filters', await rk.getByRole('button', { name: '월별 최다 신고자', exact: true }).getAttribute('aria-pressed') === 'true' && await rk.getByLabel('날짜 기준', { exact: true }).inputValue() === 'report_date');
  check('actual ranking JS/console errors absent', errors.length === 0);
  await context.close();
} catch (e) { failure = e.stack || String(e); throw e; }
finally {
  writeFileSync(`${out}/result.json`, JSON.stringify({ environment: 'LOCAL Chrome/GoTrue/SQL RPC, synthetic users/reports; adjacent Kakao SDK mocked; no deployment', browser: browser.version(), checks, responses, errors, failure }, null, 2) + '\n');
  await browser.close();
}
