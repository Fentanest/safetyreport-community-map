// Deterministic synthetic responses, actual before/after production builds, Chromium CDP throttling.
// Run `npx vitest run tests/product/fewerTrips.test.ts` first to produce payloads.
// A baseline export of the starting HEAD must exist in FEW_TRIPS_BASELINE (no commits required).
import { chromium, fakeSession } from './harness.mjs';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const root = resolve('.'), out = resolve('.agent-runtime/fewer-trips');
const baseline = resolve(process.env.FEW_TRIPS_BASELINE || `${out}/baseline`);
const ports = { api: 5220, before: 5221, after: 5222 };
const api = `http://127.0.0.1:${ports.api}`;
const payloads = Object.fromEntries(['before', 'after', 'meta'].map(p => [p, readFileSync(`${out}/${p}.json`)]));
const scope = JSON.parse(payloads.after).dashboard.scope;
const env = { ...process.env, VITE_DATA_MODE: 'live', VITE_BASE_PATH: '/', VITE_PUBLIC_ANALYTICS_URL: `${api}/functions/v1`, VITE_SUPABASE_URL: api, VITE_SUPABASE_PUBLISHABLE_KEY: 'synthetic-local-key', VITE_KAKAO_MAP_JS_KEY: '' };
for (const [phase, cwd] of [['before', baseline], ['after', root]]) {
 writeFileSync(`${out}/${phase}-benchmark-build.log`, execFileSync('npm', ['run', 'build'], { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
}
const servers = [], traffic = [];
function listen(port, handler) { const server = createServer(handler); servers.push(server); return new Promise(r => server.listen(port, '127.0.0.1', r)); }
await listen(ports.api, (req, res) => {
 const origin = req.headers.origin, phase = origin?.endsWith(String(ports.before)) ? 'before' : 'after';
 traffic.push({ phase, method: req.method, path: new URL(req.url, api).pathname });
 res.setHeader('Access-Control-Allow-Origin', origin || '*');
 res.setHeader('Cache-Control', 'private, no-store, max-age=0');
 res.setHeader('Vary', 'Origin, Authorization, Accept');
 if (req.method === 'OPTIONS') {
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'authorization, apikey, accept');
  if (phase === 'after' || req.url.includes('/meta')) res.setHeader('Access-Control-Max-Age', '600');
  res.writeHead(204); return res.end();
 }
 const body = req.url.includes('/meta') ? payloads.meta : req.url.includes('/screen') ? payloads[phase] : null;
 if (!body) { res.writeHead(404); return res.end(); }
 res.setHeader('Content-Type', 'application/json'); res.setHeader('Content-Encoding', 'gzip'); res.end(gzipSync(body));
});
for (const phase of ['before', 'after']) {
 const dist = resolve(phase === 'before' ? baseline : root, 'dist');
 await listen(ports[phase], (req, res) => {
  const path = new URL(req.url, 'http://local').pathname;
  let file = resolve(dist, `.${path === '/' ? '/index.html' : path}`);
  if (!file.startsWith(`${dist}/`) || !existsSync(file)) file = `${dist}/index.html`;
  res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' })[extname(file)] || 'application/octet-stream');
  res.setHeader('Cache-Control', phase === 'after' && path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate');
  // Ads excluded equally in both phases; no Playwright routing (which disables the HTTP cache).
  res.setHeader('Content-Security-Policy', "frame-src 'none'");
  const bytes = gzipSync(readFileSync(file)), etag = '"' + createHash('sha256').update(bytes).digest('hex') + '"';
  res.setHeader('ETag', etag);
  if (req.headers['if-none-match'] === etag) { res.writeHead(304); return res.end(); }
  res.setHeader('Content-Encoding', 'gzip'); res.end(bytes);
 });
}
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const rows = [];
try {
 for (let run = 1; run <= Number(process.env.FEW_TRIPS_RUNS || 3); run++) for (const phase of ['before', 'after']) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(session => {
   localStorage.setItem('cm-map-auth-v1', JSON.stringify(session)); localStorage.setItem('cm-theme', 'dark');
  }, fakeSession());
  const page = await context.newPage(), cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 1500, downloadThroughput: 50 * 1024, uploadThroughput: 50 * 1024, connectionType: 'cellular3g' });
  for (const cache of ['cold', 'warm']) {
   const startTraffic = traffic.length, start = performance.now();
   const search = new URLSearchParams({ date_basis: scope.date_basis, start: scope.start, end: scope.end, category: scope.category });
   await page.goto(`http://127.0.0.1:${ports[phase]}/?${search}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
   await page.locator('.kpi-strip[aria-busy="false"] .kpi-value').first().waitFor({ timeout: 120000 });
   const ms = performance.now() - start;
   const resources = await page.evaluate(() => performance.getEntriesByType('resource').map(r => ({ name: new URL(r.name).pathname, transfer: r.transferSize, encoded: r.encodedBodySize })));
   const calls = traffic.slice(startTraffic).filter(r => r.phase === phase);
   assert.equal(calls.filter(r => r.method === 'GET' && r.path.includes('/meta')).length, phase === 'before' ? 1 : 0);
   assert.equal(calls.filter(r => r.method === 'GET' && r.path.includes('/screen')).length, 1);
   if (phase === 'after') assert.equal(calls.filter(r => r.method === 'OPTIONS').length, cache === 'cold' ? 1 : 0);
   rows.push({ run, phase, cache, firstKpiMs: Math.round(ms), calls, staticTransferBytes: resources.filter(r => r.name.startsWith('/assets/')).reduce((n, r) => n + r.transfer, 0) });
   console.log(JSON.stringify(rows.at(-1)));
   // Let chart downloads settle before warm navigation so it tests cached assets, not in-flight competition.
   await page.waitForLoadState('networkidle', { timeout: 120000 });
  }
  await context.close();
 }
} finally {
 await browser.close(); for (const s of servers) await new Promise(r => s.close(r));
 writeFileSync(`${out}/throttle.json`, JSON.stringify({ browser: browser.version(), mode: 'actual builds, synthetic handler payloads; no real auth/SDK/DB/Cloudflare; ads excluded', latencyMs: 1500, bytesPerSecond: 51200, rows }, null, 2));
}
