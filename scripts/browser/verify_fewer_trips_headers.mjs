// Run with Wrangler `dev --local --port 5225`; no deployment. Also proves Chrome preflight-cache behavior.
import { chromium } from './harness.mjs';
import { createServer } from 'node:http';
import { readdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const report = { static: [], cors: [] };
const asset = readdirSync('dist/assets').find(s => s.startsWith('index-') && s.endsWith('.js'));
for (const path of ['/', '/index.html', '/deep/link', `/assets/${asset}`]) {
 const r = await fetch((process.env.WRANGLER_ORIGIN || 'http://127.0.0.1:5225') + path);
 const cacheControl = r.headers.get('cache-control');
 assert.equal(r.status, 200);
 assert.equal(cacheControl, path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate');
 report.static.push({ path, status: r.status, cacheControl, etag: !!r.headers.get('etag') });
}
const log = [];
const ui = createServer((_q, r) => r.end('<html>local probe</html>'));
const api = createServer((q, r) => {
 log.push(q.method); r.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:5230');
 r.setHeader('Access-Control-Allow-Headers', 'authorization'); r.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
 r.setHeader('Access-Control-Max-Age', '600'); r.setHeader('Cache-Control', 'private, no-store, max-age=0');
 r.writeHead(q.method === 'OPTIONS' ? 204 : 200); r.end();
});
await new Promise(r => ui.listen(5230, '127.0.0.1', r)); await new Promise(r => api.listen(5231, '127.0.0.1', r));
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
try {
 for (const cache of ['no-store', 'default']) {
  const context = await browser.newContext(), page = await context.newPage();
  await page.goto('http://127.0.0.1:5230'); log.length = 0;
  await page.evaluate(async cache => { for (let i = 0; i < 2; i++) await fetch('http://127.0.0.1:5231/', { cache, headers: { Authorization: 'Bearer synthetic' } }); }, cache);
  assert.deepEqual(log, cache === 'no-store' ? ['OPTIONS', 'GET', 'OPTIONS', 'GET'] : ['OPTIONS', 'GET', 'GET']);
  report.cors.push({ requestCache: cache, responseCache: 'private, no-store, max-age=0', network: [...log] });
  await context.close();
 }
} finally { await browser.close(); await new Promise(r => ui.close(r)); await new Promise(r => api.close(r)); }
writeFileSync('.agent-runtime/fewer-trips/headers.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
