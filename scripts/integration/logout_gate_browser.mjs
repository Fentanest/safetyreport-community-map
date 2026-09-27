#!/usr/bin/env node
// Live-mode browser regression for the logout/login loop. The Supabase Auth module is replaced with an in-memory
// session; no real account, JWT, OAuth provider, or analytics response is used. Run against a locally served live
// build: PLAYWRIGHT_CORE=/path/to/playwright-core/index.mjs node scripts/integration/logout_gate_browser.mjs <out-dir>
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';

const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
const mapUrl = process.env.MAP_URL ?? 'http://127.0.0.1:4173/';
const out = process.argv[2] ?? '.agent-runtime/logout-gate-browser';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));
await page.addInitScript(() => {
  localStorage.setItem('cm-map-auth-v1', '{}');
  window.__authProbe = { oauthCalls: 0, signOutScopes: [] };
});
await page.route('**/assets/dist-*.js', async (route) => {
  await route.fulfill({ contentType: 'text/javascript', body: `
    let session = { access_token: 'synthetic-browser-token', user: { user_metadata: { nickname: '예시 사용자' } } };
    let listener = null;
    export function createClient() {
      return { auth: {
        onAuthStateChange(callback) { listener = callback; return { data: { subscription: { unsubscribe() {} } } }; },
        async getSession() { return { data: { session }, error: null }; },
        async refreshSession() { return { data: { session }, error: null }; },
        async signOut(options) {
          window.__authProbe.signOutScopes.push(options?.scope ?? null);
          session = null;
          listener?.('SIGNED_OUT', null);
          localStorage.removeItem('cm-map-auth-v1');
          return { error: null };
        },
        async signInWithOAuth() {
          window.__authProbe.oauthCalls++;
          return { data: {}, error: null };
        },
      } };
    }
  ` });
});
await page.route('**/public-analytics/**', (route) => route.fulfill({
  status: 503, contentType: 'application/json',
  headers: { 'access-control-allow-origin': '*' },
  body: JSON.stringify({ error: { code: 'fixture_unavailable' } }),
}));

const checks = {};
try {
  await page.goto(mapUrl, { waitUntil: 'domcontentloaded' });
  await page.locator('.account-menu > button').waitFor();
  checks.initialSignedIn = true;
  await page.locator('.account-menu > button').click();
  await page.getByRole('menuitem', { name: '로그아웃' }).click();
  await page.getByRole('button', { name: '카카오로 로그인' }).waitFor();
  await page.waitForTimeout(1200);
  const probe = await page.evaluate(() => window.__authProbe);
  checks.localSignOut = JSON.stringify(probe.signOutScopes) === '["local"]';
  checks.noAutomaticLogin = probe.oauthCalls === 0 && new URL(page.url()).origin === new URL(mapUrl).origin;
  checks.sessionRemoved = await page.evaluate(() => localStorage.getItem('cm-map-auth-v1') === null);
  checks.mapHidden = await page.locator('.map-card').count() === 0;
  await page.locator('.access-card').screenshot({ path: `${out}/after-logout.png` });
  await page.getByRole('button', { name: '카카오로 로그인' }).click();
  checks.explicitLoginOnly = await page.evaluate(() => window.__authProbe.oauthCalls === 1);
  checks.noPageErrors = pageErrors.length === 0;
  for (const [name, ok] of Object.entries(checks)) assert.equal(ok, true, name);
  console.log(JSON.stringify({ browser: browser.version(), mode: 'live-build/auth-fixture', checks }));
} finally {
  writeFileSync(`${out}/result.json`, JSON.stringify({ browser: browser.version(), mode: 'live-build/auth-fixture', checks, pageErrors }, null, 2));
  await browser.close();
}
