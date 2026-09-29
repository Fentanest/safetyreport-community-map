// Shared Playwright harness for the LOCAL e2e stack (scripts/browser/vite.e2e.config.ts). Evidence only.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
function loadPlaywright() {
  for (const candidate of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(candidate); } catch { /* next */ }
  }
  throw new Error('playwright not found (local or /opt/node22 global)');
}
export const { chromium } = loadPlaywright();
export const PORT = Number(process.env.E2E_PORT || 5190);
export const ORIGIN = `http://127.0.0.1:${PORT}`;
export const E2E_UID = '11111111-2222-4333-8444-555555555555';
/** C01: second synthetic account, SAME nickname ('로컬검수') as the first */
export const E2E_UID_B = '22222222-3333-4444-8555-666666666666';
const SESSION = '66666666-7777-4888-9999-aaaaaaaaaaaa';
const MOCK_SDK = readFileSync(join(here, 'mock-kakao-sdk.js'), 'utf8');

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
export function fakeSession(uid = E2E_UID, nickname = '로컬검수') {
  const exp = Math.floor(Date.now() / 1000) + 3600 * 24;
  const token = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: uid, role: 'authenticated', aud: 'authenticated', session_id: SESSION, exp, is_anonymous: false })}.e2e`;
  return { access_token: token, refresh_token: 'e2e-refresh', token_type: 'bearer', expires_in: 86400, expires_at: exp,
    user: { id: uid, aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'kakao' }, user_metadata: { nickname } } };
}

export async function api(path, body) {
  const res = await fetch(`${ORIGIN}/__e2e/${path}`, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
  return res.json();
}

export async function openPage(browser, { width = 1440, height = 900, theme = 'dark', signedIn = true, search = '', mockSdk = true, locale = 'ko-KR', uid = E2E_UID, deviceScaleFactor = 1 } = {}) {
  const context = await browser.newContext({ locale, viewport: { width, height }, colorScheme: theme === 'light' ? 'light' : 'dark', deviceScaleFactor });
  if (mockSdk) await context.route('https://dapi.kakao.com/**', route => route.fulfill({ contentType: 'text/javascript', body: MOCK_SDK }));
  await context.addInitScript(({ session, theme, signedIn }) => {
    try {
      if (signedIn && !sessionStorage.getItem('e2e-seeded')) { localStorage.setItem('cm-map-auth-v1', JSON.stringify(session)); sessionStorage.setItem('e2e-seeded', '1'); }
      if (!localStorage.getItem('cm-theme')) localStorage.setItem('cm-theme', theme);
    } catch { /* ignore */ }
    window.__navCount = (window.__navCount || 0);
    window.__skeletons = 0;
    const count = () => {
      const obs = new MutationObserver((list) => {
        for (const m of list) for (const n of m.addedNodes) {
          if (n.nodeType === 1 && (n.matches?.('.skeleton') || n.querySelector?.('.skeleton'))) window.__skeletons += 1;
        }
      });
      obs.observe(document.documentElement, { childList: true, subtree: true });
    };
    if (document.documentElement) count(); else document.addEventListener('DOMContentLoaded', count);
  }, { session: fakeSession(uid), theme, signedIn });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  let documentNavs = 0;
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) documentNavs += 1; });
  await page.goto(`${ORIGIN}/${search}`);
  return { context, page, consoleErrors, navs: () => documentNavs };
}

export async function waitMap(page) {
  await page.waitForFunction(() => window.__kakaoStats && window.__kakaoStats.maps > 0 && window.__kakaoMaps?.length, null, { timeout: 20000 });
}

export const lastMap = (page) => page.evaluate(() => window.__kakaoMaps.length);
export const sleep = (ms) => new Promise(r => setTimeout(r, ms));
export function summarizeLog(log) {
  const byRoute = {};
  for (const e of log) byRoute[e.route] = (byRoute[e.route] || 0) + 1;
  return byRoute;
}
