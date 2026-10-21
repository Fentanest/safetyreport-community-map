#!/usr/bin/env node
// LOCAL composed stack only (never production): the contributor-only map in a real Chrome (user decision 2026-09-27).
// Checks: anonymous visit → stable login gate and no statistics/OAuth request until the user clicks;
// Kakao sign-in as a user without a share consent (F) → "not sharing" gate; H with nine distinct reports
// → upload_required with required/current progress; E with ten distinct reports → the map loads.
// Every statistics request carries the map session token; a direct unauthenticated API call
// from the page is refused; the built artifact has no data files.
// App-update guidance (2026-10-21): the page reads only its own GET /my-analytics/client-status with the map token,
// never community-account; the notice appears only when the server sends one (no built-in versions or links),
// and the gate's "다시 확인" re-reads it.
//
//   PLAYWRIGHT_CORE=/path/to/playwright-core/index.mjs node scripts/integration/access_gate_e2e.mjs <out-dir> [dist-dir]
// Preconditions as scripts/integration/live_login_e2e.mjs (stack + mock_kakao + functions serve, live build of the
// local stack served at http://127.0.0.1:56490/). Run community-stack.test.ts on the composed stack first:
// its H fixture has exactly nine distinct public reports (including a duplicate in a second dataset), and E has ten.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
const out = process.argv[2] ?? '.agent-runtime/access-gate-e2e';
const dist = process.argv[3] ?? null;
const MAP = process.env.MAP_URL ?? 'http://127.0.0.1:56490/';
const API = process.env.API_URL ?? 'http://127.0.0.1:56321/functions/v1';
const MOCK = process.env.MOCK_KAKAO_HOST ?? '172.17.0.1';
mkdirSync(out, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); };

const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: true,
  args: [`--host-resolver-rules=MAP host.docker.internal ${MOCK}`],
});
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors = [];
const stats = [];
page.on('pageerror', (e) => errors.push(e.message));
// Failed responses are judged by URL (browser console lines carry no URL): the expected 401/403 refusals of the
// statistics API and anything on the mock Kakao host (a stand-in page, e.g. its missing favicon) are not errors.
page.on('response', (r) => {
  const u = r.url();
  if (r.status() < 400 || u.includes(':56410') || (u.includes('/public-analytics/') && [401, 403].includes(r.status()))) return;
  errors.push(`${r.status()} ${u.replace(/\?.*/, '')}`);
});
page.on('response', (r) => {
  if (r.url().includes('/public-analytics/')) stats.push({
    path: new URL(r.url()).pathname.split('/public-analytics/')[1], status: r.status(),
    auth: r.request().headers().authorization ? 'bearer' : null, body: r.json().catch(() => null),
  });
});
const clientStatus = [];
const accountCalls = [];
page.on('request', (r) => { if (/community-account|community-auth-relay|safeauth\.worklazy/.test(r.url())) accountCalls.push(r.url().replace(/\?.*/, '')); });
page.on('response', (r) => {
  if (r.url().includes('/my-analytics/client-status')) clientStatus.push({ status: r.status(),
    auth: r.request().headers().authorization ? 'bearer' : null, body: r.json().catch(() => null) });
});
const dashboardRule = (s) => !!s?.notice && s.v2_enabled === true && (s.consent === 'outdated' || s.v1_connections > 0);
const consentRule = (s) => !!s?.notice && s.consent !== 'active';
const lastStatus = async () => (clientStatus.length ? await clientStatus.at(-1).body : null);
const noticeShown = () => page.locator('.client-update-notice').count();
const statsSummary = () => JSON.stringify(stats.map(({ path, status, auth }) => ({ path, status, auth })));

const gateTitle = () => page.locator('#gate-title').count();
const dashboardShown = () => page.locator('.compare-table').count();
async function login(choice) {
  if (!page.url().includes('56410')) {
    await page.getByRole('button', { name: /카카오로 로그인|카카오 로그인/ }).first().click();
  }
  await page.waitForURL(/56410/, { timeout: 15000 });
  const authorize = new URL(page.url());
  // Harness step standing in for the user's choice on the (mock) Kakao page.
  await page.goto(`http://host.docker.internal:56410/oauth/decide?${new URLSearchParams({ state: authorize.searchParams.get('state'), choice })}`);
  await page.waitForURL((u) => u.toString().startsWith(MAP), { timeout: 20000 });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
}

try {
  await page.goto(MAP, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  check('anonymous visit stays on login gate without showing the map',
    page.url().startsWith(MAP) && await gateTitle() === 1 && await dashboardShown() === 0,
    page.url().replace(/\?.*/, ''));
  check('anonymous visit did not start OAuth', !page.url().includes('56410'));
  check('anonymous page made no statistics requests', stats.length === 0, statsSummary());
  const anonymous = await fetch(`${API}/public-analytics/meta`, { headers: { Origin: new URL(MAP).origin } });
  check('direct anonymous API request is refused', anonymous.status === 401, String(anonymous.status));
  await page.screenshot({ path: `${out}/01-map-login-gate.png`, fullPage: true });

  stats.length = 0;
  await login('F');
  const text = await page.locator('.access-card').innerText().catch(() => '');
  const fStatus = await lastStatus();
  check('client-status was read with the map token and answered 200',
    clientStatus.length > 0 && clientStatus.every((s) => s.auth === 'bearer') && clientStatus.at(-1).status === 200,
    JSON.stringify(clientStatus.map(({ status, auth }) => ({ status, auth }))));
  check('client-status body has exactly the five contract fields',
    !!fStatus && JSON.stringify(Object.keys(fStatus).sort()) === JSON.stringify(['consent', 'last_contract', 'notice', 'v1_connections', 'v2_enabled']),
    JSON.stringify(fStatus));
  check('consent gate shows the update notice only when the server sends one',
    (await noticeShown()) === (consentRule(fStatus) ? 1 : 0), JSON.stringify(fStatus?.notice ?? null));
  if (fStatus?.notice && consentRule(fStatus)) check('the gate notice text is the server message', text.includes(fStatus.notice.message));
  check('no built-in version text on the gate', fStatus?.notice ? true : !/PC 3\.6\.0|모바일 2\.5\.0/.test(text), text.slice(0, 120));
  check('consent gate names the new consent title', /\[필수\] 신고내용 공유 동의/.test(text));
  const beforeRetry = clientStatus.length;
  await page.getByRole('button', { name: '다시 확인' }).click();
  await page.waitForTimeout(1500);
  check('"다시 확인" re-reads client-status', clientStatus.length > beforeRetry, `${beforeRetry} → ${clientStatus.length}`);
  check('signed in without a share consent → "not sharing" gate', /동의하지 않았거나/.test(text) && await dashboardShown() === 0, text.slice(0, 80));
  check('that request carried the token and got 403', stats.some((s) => s.status === 403 && s.auth === 'bearer'), statsSummary());
  await page.screenshot({ path: `${out}/02-not-sharing-gate.png`, fullPage: true });

  await page.getByRole('button', { name: '다른 계정으로 로그인' }).click();
  await page.waitForSelector('#gate-title', { timeout: 15000 });
  await page.waitForTimeout(1200);
  check('switching account leaves the login gate until another click',
    page.url().startsWith(MAP) && await gateTitle() === 1);
  stats.length = 0;
  await login('H');
  const shortText = await page.locator('.access-card').innerText().catch(() => '');
  check('nine distinct reports show the upload gate and progress',
    /지금 9건 \/ 10건 공유됨/.test(shortText) && await dashboardShown() === 0, shortText.slice(0, 160));
  const shortBodies = await Promise.all(stats.filter((s) => s.status === 403 && s.auth === 'bearer').map((s) => s.body));
  check('nine reports are refused with required 10 and current 9',
    shortBodies.some((body) => body?.error?.code === 'upload_required' &&
      body.error.details?.required === 10 && body.error.details?.current === 9), statsSummary());
  await page.screenshot({ path: `${out}/03-nine-report-gate.png`, fullPage: true });

  await page.getByRole('button', { name: '다른 계정으로 로그인' }).click();
  await page.waitForSelector('#gate-title', { timeout: 15000 });
  stats.length = 0;
  await login('E');
  check('a contributor with ten distinct reports sees the map', await dashboardShown() === 1 && await gateTitle() === 0);
  const eStatus = await lastStatus();
  check('dashboard update banner follows the server rule (notice + v2 + outdated consent or v1 app)',
    (await noticeShown()) === (dashboardRule(eStatus) ? 1 : 0), JSON.stringify(eStatus));
  if (dashboardRule(eStatus)) {
    const links = await page.locator('.client-update-notice a').evaluateAll((as) => as.map((a) => ({ href: a.href, target: a.target, rel: a.rel, label: a.getAttribute('aria-label') })));
    check('banner links are https, open a new tab and say so', links.every((l) => l.href.startsWith('https://') && l.target === '_blank' &&
      /noopener/.test(l.rel) && /새 탭/.test(l.label ?? '')), JSON.stringify(links));
  }
  check('every statistics request carried the token and succeeded',
    stats.length > 0 && stats.every((s) => s.auth === 'bearer' && s.status === 200), statsSummary());
  await page.screenshot({ path: `${out}/04-ten-report-map.png` });

  const direct = await page.evaluate(async (api) => (await fetch(`${api}/public-analytics/meta`, { credentials: 'omit' })).status, API);
  check('a direct call without the token is refused even from the signed-in page', direct === 401, String(direct));
  if (dist) check('the built artifact has no data files', !existsSync(`${dist}/data`));
  check('the page never called community-account or the relay', accountCalls.length === 0, accountCalls.join(' | '));
  check('no page errors', errors.length === 0, errors.join(' | ').slice(0, 300));
} catch (e) {
  check('run', false, e instanceof Error ? e.message : String(e));
  await page.screenshot({ path: `${out}/99-failure.png`, fullPage: true }).catch(() => undefined);
} finally {
  writeFileSync(`${out}/results.json`, JSON.stringify({ map: MAP, results, errors }, null, 2));
  await browser.close();
}
process.exit(results.every((r) => r.ok) ? 0 : 1);
