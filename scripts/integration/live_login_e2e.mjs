#!/usr/bin/env node
// LOCAL composed stack only (never production): a real Chrome runs the LIVE-mode map build against the local
// GoTrue (Kakao = scripts/integration/mock_kakao.mjs), public-analytics and my-analytics.
// Checks: anonymous public view, no Authorization on public requests, PKCE login back to the map, OAuth params
// stripped, compare columns filled from my-analytics with all = public numbers, private headers,
// logout with scope=local, map session storage cleared, public view kept.
//
//   PLAYWRIGHT_CORE=/path/to/playwright-core/index.mjs node scripts/integration/live_login_e2e.mjs <out-dir> [choice]
// Preconditions: stack + mock_kakao + functions serve running; live build served at http://127.0.0.1:56490/ with
// VITE_SUPABASE_URL/VITE_SUPABASE_PUBLISHABLE_KEY/VITE_PUBLIC_ANALYTICS_URL of the local stack
// (see docs/implementation/verification-status.md, personal comparison section).
import { mkdirSync, writeFileSync } from 'node:fs';

const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
const out = process.argv[2] ?? '.agent-runtime/live-login-e2e';
const choice = process.argv[3] ?? 'C';
const MAP = process.env.MAP_URL ?? 'http://127.0.0.1:56490/';
const MOCK = process.env.MOCK_KAKAO_HOST ?? '172.17.0.1';
mkdirSync(out, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); };

const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: true,
  args: [`--host-resolver-rules=MAP host.docker.internal ${MOCK}`],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
const requests = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(`${m.text()} @ ${m.location().url || page.url()}`); });
page.on('pageerror', (e) => errors.push(e.message));
page.on('request', (r) => requests.push({ url: r.url(), auth: r.headers().authorization ?? null, method: r.method() }));
const personal = [];
const failed = [];
page.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url().replace(/\?.*/, '')}`); });
page.on('response', async (r) => {
  if (r.url().includes('/my-analytics/')) personal.push({ status: r.status(), headers: r.headers(), body: await r.json().catch(() => null) });
});

try {
  await page.goto(MAP, { waitUntil: 'networkidle' });
  const publicReport = await page.locator('.compare-table tbody tr').first().locator('td').first().innerText();
  check('anonymous public view renders', /\d/.test(publicReport), `신고 접수 ${publicReport.split('\n')[0]}`);
  check('public requests carry no Authorization', requests.filter((r) => r.url.includes('/public-analytics/')).every((r) => r.auth === null));
  await page.screenshot({ path: `${out}/01-public-anonymous.png` });

  await page.getByRole('switch').check();
  await page.waitForTimeout(300);
  check('compare while signed out asks for login, no personal request', personal.length === 0 &&
    await page.getByText('카카오로 로그인').first().isVisible());
  await page.screenshot({ path: `${out}/02-compare-signed-out.png` });

  await page.getByRole('button', { name: /카카오 로그인/ }).first().click();
  await page.waitForURL(/\/oauth\/authorize/, { timeout: 15000 });
  const authorize = new URL(page.url());
  check('login goes through Supabase Auth to Kakao (PKCE)', requests.some((r) => r.url.includes('/auth/v1/authorize') && r.url.includes('code_challenge')));
  // Harness step standing in for the user's consent click on the (mock) Kakao page.
  await page.goto(`http://host.docker.internal:56410/oauth/decide?${new URLSearchParams({ state: authorize.searchParams.get('state'), choice })}`);
  await page.waitForURL((u) => u.origin === new URL(MAP).origin, { timeout: 15000 });
  await page.waitForFunction(() => !/[?&]code=/.test(location.search), null, { timeout: 15000 });
  check('returned to the map with OAuth params stripped', !/code=|state=/.test(page.url()), page.url());
  await page.waitForSelector('.compare-table .mine-col b', { timeout: 20000 });
  await page.waitForTimeout(500);
  const rows = await page.locator('.compare-table tbody tr').evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => td.innerText.split('\n')[0])));
  check('compare columns filled (all | mine | diff)', rows[0].length >= 3 && /\d/.test(rows[0][1]), JSON.stringify(rows.slice(0, 3)));
  const ok = personal.find((p) => p.status === 200);
  check('my-analytics answered 200 with private no-store', ok && /private/.test(ok.headers['cache-control']) && /no-store/.test(ok.headers['cache-control']),
    ok?.headers['cache-control']);
  const pubResp = requests.find((r) => r.url.includes('/public-analytics/dashboard'));
  check('personal request sent the bearer token and the public dataset_version',
    requests.some((r) => r.url.includes('/my-analytics/compare') && r.auth?.startsWith('Bearer ') && r.url.includes('expected_version=')) && !!pubResp);
  check('all column equals the public number on screen', ok && String(ok.body.all.report_count) === rows[0][0].replace(/,/g, ''),
    `${ok?.body?.all?.report_count} vs ${rows[0][0]}`);
  check('personal body has no account identifiers', ok && !/contributor_id|user_id|session_id|@/.test(JSON.stringify(ok.body)));
  check('public requests still carry no Authorization', requests.filter((r) => r.url.includes('/public-analytics/')).every((r) => r.auth === null));
  const stored = await page.evaluate(() => Object.keys(localStorage));
  check('map session stored under the map-only key', stored.includes('cm-map-auth-v1'), stored.join(','));
  await page.screenshot({ path: `${out}/03-compare-signed-in.png`, fullPage: true });

  await page.locator('.account-menu > button').click();
  const logoutReq = page.waitForRequest((r) => r.url().includes('/auth/v1/logout'));
  await page.getByRole('menuitem', { name: /로그아웃/ }).click();
  const lr = await logoutReq;
  check('logout request uses scope=local', new URL(lr.url()).searchParams.get('scope') === 'local', lr.url().replace(/\?.*/, '?…') + ' scope=' + new URL(lr.url()).searchParams.get('scope'));
  await page.waitForTimeout(800);
  const after = await page.evaluate(() => Object.keys(localStorage));
  check('map session removed from this browser', !after.includes('cm-map-auth-v1'), after.join(','));
  check('public view still shown after logout', await page.locator('.compare-table').isVisible() && await page.getByRole('button', { name: /카카오 로그인/ }).first().isVisible());
  await page.screenshot({ path: `${out}/04-after-local-logout.png` });
  // The mock Kakao page (harness only) has no favicon; everything on the map/API origins must be clean.
  const relevant = failed.filter((f) => !f.includes('host.docker.internal'));
  check('no failed map/API responses', relevant.length === 0, failed.join(' | '));
  const mapErrors = errors.filter((e) => !e.includes('host.docker.internal'));
  check('no console errors on the map (harness Kakao page excluded)', mapErrors.length === 0, errors.join(' | '));
} catch (e) {
  check('scenario completed', false, String(e));
  await page.screenshot({ path: `${out}/99-failure.png` }).catch(() => {});
} finally {
  writeFileSync(`${out}/results.json`, JSON.stringify({ map: MAP, choice, results, errors, failed }, null, 2));
  await browser.close();
}
process.exit(results.every((r) => r.ok) ? 0 : 1);
