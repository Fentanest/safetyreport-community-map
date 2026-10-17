// Browser check of Google Analytics (2026-10-17): what the page actually sends to Google.
// LOCAL stack + MOCK Kakao SDK, REAL gtag.js from googletagmanager.com (so the property's own enhanced-measurement
// settings apply). Collection hits (*/g/collect) are intercepted and answered 204 locally: nothing reaches the real
// GA property. Checks that no hit carries the OAuth code, scope/share/ranking parameters or the session token.
//   E2E server:  VITE_GA=on E2E_PORT=5190 npx vite --config scripts/browser/vite.e2e.config.ts
//   run:         LANG=C.UTF-8 node scripts/browser/verify_google_analytics.mjs <dir>
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, openPage, waitMap, api, sleep, ORIGIN } from './harness.mjs';

const dir = process.argv[2] || 'evidence';
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ args: ['--lang=ko-KR'] });
const SCOPE = '?code=E2E-OAUTH-CODE-CANARY&date_basis=completed_date&start=2025-09-25&end=2026-09-24&category=all&sr=E2E-SHARE-CANARY';
const FORBIDDEN = ['E2E-OAUTH-CODE-CANARY', 'E2E-SHARE-CANARY', 'date_basis', 'start=', 'category', 'rk_', 'access_token', 'e2e-refresh', 'eyJ'];
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`); };

const hits = [];
const loaded = [];
const failed = [];
let consoleErrors = [];
try {
  await api('reset');
  const s = await openPage(browser, { width: 1440, height: 900, search: SCOPE, beforeGoto: async (context, page) => {
    page.on('request', (req) => { if (req.url().startsWith('https://www.googletagmanager.com/')) loaded.push(req.url()); });
    page.on('requestfailed', (req) => failed.push(`${req.url()} ${req.failure()?.errorText ?? ''}`));
    // the Coupang widget is not under test and unreachable from the sandbox: a blank stub keeps the console clean
    await context.route('https://ads-partners.coupang.com/**', (route) => route.fulfill({ contentType: 'text/html', body: '<body></body>' }));
    // every collection hit is answered locally (installed before the first navigation: nothing reaches the property)
    await context.route(/https:\/\/([a-z0-9-]+\.)*(google-analytics\.com|analytics\.google\.com|googletagmanager\.com)\/([a-z0-9]+\/)?g\/collect.*/, (route) => {
      const req = route.request();
      const shared = new URL(req.url()).search.slice(1);
      const body = req.postData() ?? '';
      // a batched POST carries one event per line; the line's own parameters (dl, en …) win over the shared URL ones
      for (const line of (body ? body.split(/\r?\n/).filter(Boolean) : [''])) {
        const params = new URLSearchParams(`${line}&${shared}`);
        hits.push({ en: params.get('en'), dl: params.get('dl'), dr: params.get('dr'), raw: `${req.url()}\n${line}` });
      }
      route.fulfill({ status: 204, body: '' });
    });
  } });
  consoleErrors = s.consoleErrors;
  const { page, context } = s;
  await waitMap(page);
  await sleep(4000);
  for (const label of ['맞춤 통계', '유저 랭킹', '대시보드']) {
    await page.locator('.app-tabs .app-tab', { hasText: label }).click();
    await sleep(2500);
  }
  await page.goBack();
  await sleep(2500);
  // flush the queued batch (gtag sends on page hide)
  await page.goto('about:blank');
  await sleep(1500);
  await context.close();

  const pageViews = hits.filter(h => h.en === 'page_view');
  check('gtag.js loaded from googletagmanager.com', loaded.some(u => u.includes('/gtag/js?id=G-44DVBQZ1S8')), loaded);
  check('at least one hit was collected', hits.length > 0, hits.length);
  // exactly one page_view per screen visit: a second one means the property's "page changes based on browser history
  // events" (enhanced measurement) is still on, and that one carries the raw address (docs/deployment.md §Google Analytics)
  const expected = [`${ORIGIN}/`, `${ORIGIN}/?screen=statistics`, `${ORIGIN}/?screen=rankings`, `${ORIGIN}/`, `${ORIGIN}/?screen=rankings`];
  check('page_view sequence = one per screen visit, path + screen name only', JSON.stringify(pageViews.map(h => h.dl)) === JSON.stringify(expected), pageViews.map(h => h.dl));
  const leaks = hits.filter(h => FORBIDDEN.some(f => h.raw.includes(f)));
  check('no hit carries the OAuth code, scope, share recipe, ranking state or session token', leaks.length === 0, leaks.map(h => h.raw));
  check('every hit address is path + screen name only', hits.every(h => h.dl === null || /^http:\/\/127\.0\.0\.1:\d+\/(\?screen=(statistics|rankings))?$/.test(h.dl)), [...new Set(hits.map(h => h.dl))]);
  check('no page console errors', consoleErrors.length === 0, consoleErrors);
  check('no Google request failed except intercepted hits aborted by page unload', failed.every(f => !/google/.test(f) || /\/g\/collect.* net::ERR_ABORTED$/.test(f)), failed.filter(f => /google/.test(f) && !/\/g\/collect.* net::ERR_ABORTED$/.test(f)));
} finally {
  writeFileSync(join(dir, 'google-analytics.json'), JSON.stringify({ at: new Date().toISOString(), browser: `chromium ${browser.version()}`, results, hits: hits.map(h => ({ en: h.en, dl: h.dl, dr: h.dr, raw: h.raw })), consoleErrors, failed }, null, 2));
  await browser.close();
}
process.exit(results.every(r => r.ok) ? 0 : 1);
