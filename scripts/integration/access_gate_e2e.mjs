#!/usr/bin/env node
// LOCAL composed stack only (never production): the contributor-only map in a real Chrome (user decision 2026-09-27).
// Checks: anonymous visit → access gate and a 401 from the statistics API (no dashboard data in the page);
// Kakao sign-in as a user without a share consent (F) → "not sharing" gate; switch account to a sharing user (E)
// → the map loads and every statistics request carries the map session token; a direct unauthenticated API call
// from the page is refused; the built artifact has no data files.
//
//   PLAYWRIGHT_CORE=/path/to/playwright-core/index.mjs node scripts/integration/access_gate_e2e.mjs <out-dir> [dist-dir]
// Preconditions as scripts/integration/live_login_e2e.mjs (stack + mock_kakao + functions serve, live build of the
// local stack served at http://127.0.0.1:56490/). E must already have an active share consent and one
// shared report on the map (the stack tests give it both).
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
  if (r.url().includes('/public-analytics/')) stats.push({ path: new URL(r.url()).pathname.split('/public-analytics/')[1], status: r.status(), auth: r.request().headers().authorization ? 'bearer' : null });
});

const gateTitle = () => page.locator('#gate-title').count();
const dashboardShown = () => page.locator('.compare-table').count();
async function login(choice) {
  const [popupless] = await Promise.all([
    page.waitForURL(/\/auth\/v1\/authorize|oauth\/authorize|56410/, { timeout: 15000 }).catch(() => null),
    page.getByRole('button', { name: /카카오로 로그인|카카오 로그인/ }).first().click(),
  ]);
  void popupless;
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
  check('anonymous visit shows the access gate', await gateTitle() === 1 && await dashboardShown() === 0);
  check('statistics API refused the anonymous page (401, no token sent)', stats.some((s) => s.status === 401 && s.auth === null), JSON.stringify(stats));
  await page.screenshot({ path: `${out}/01-anonymous-gate.png`, fullPage: true });

  stats.length = 0;
  await login('F');
  const text = await page.locator('.access-card').innerText().catch(() => '');
  check('signed in without a share consent → "not sharing" gate', /동의하지 않았거나/.test(text) && await dashboardShown() === 0, text.slice(0, 80));
  check('that request carried the token and got 403', stats.some((s) => s.status === 403 && s.auth === 'bearer'), JSON.stringify(stats));
  await page.screenshot({ path: `${out}/02-not-sharing-gate.png`, fullPage: true });

  await page.getByRole('button', { name: '다른 계정으로 로그인' }).click();
  await page.waitForTimeout(1500);
  check('switching account returns to the login gate', await gateTitle() === 1 && /카카오로 로그인/.test(await page.locator('.access-card').innerText()));
  stats.length = 0;
  await login('E');
  check('a sharing contributor sees the map', await dashboardShown() === 1 && await gateTitle() === 0);
  check('every statistics request carried the token and succeeded',
    stats.length > 0 && stats.every((s) => s.auth === 'bearer' && s.status === 200), JSON.stringify(stats));
  await page.screenshot({ path: `${out}/03-contributor-map.png` });

  const direct = await page.evaluate(async (api) => (await fetch(`${api}/public-analytics/meta`, { credentials: 'omit' })).status, API);
  check('a direct call without the token is refused even from the signed-in page', direct === 401, String(direct));
  if (dist) check('the built artifact has no data files', !existsSync(`${dist}/data`));
  check('no page errors', errors.length === 0, errors.join(' | ').slice(0, 300));
} catch (e) {
  check('run', false, e instanceof Error ? e.message : String(e));
  await page.screenshot({ path: `${out}/99-failure.png`, fullPage: true }).catch(() => undefined);
} finally {
  writeFileSync(`${out}/results.json`, JSON.stringify({ map: MAP, results, errors }, null, 2));
  await browser.close();
}
process.exit(results.every((r) => r.ok) ? 0 : 1);
