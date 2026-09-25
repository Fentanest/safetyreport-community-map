#!/usr/bin/env node
// HTTP-level route check of a composed site (D04-D08). Serves <site-dist> with the
// GitHub-Pages-like local server and asserts that the auth routes return the auth
// documents (not the site's SPA fallback), that /safeauth redirects to /safeauth/
// keeping the query, and that core site routes still return their own documents.
//   node scripts/safeauth/verify-composed-site.mjs --site-dist dist [--port 8490]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStaticServer } from '../../tests/safeauth/stack/static-server.mjs';

export async function verifyComposedSite({ siteDist, port = 8490, siteRoutes = ['/', '/ko/', '/robots.txt', '/sitemap.xml', '/ads.txt'] }) {
  const { server } = await startStaticServer({ root: siteDist, port });
  const base = `http://127.0.0.1:${port}`;
  const results = [];
  const check = (name, ok, detail = '') => results.push({ name, ok, detail });
  try {
    for (const [path, page] of [['/safeauth/', 'index'], ['/safeauth/index.html', 'index'], ['/safeauth/callback.html', 'callback'],
      ['/safeauth/callback.html?code=probe', 'callback'], ['/safeauth/help.html', 'help'], ['/safeauth/privacy.html', 'privacy']]) {
      const r = await fetch(base + path, { redirect: 'manual' });
      const body = await r.text();
      const type = r.headers.get('content-type') ?? '';
      check(`GET ${path}`, r.status === 200 && type.startsWith('text/html') && body.includes(`<meta name="safeauth-page" content="${page}">`),
        `${r.status} ${type}`);
      for (const m of body.matchAll(/\b(?:src|href)="(\/safeauth\/[^"]+)"/g)) {
        const asset = await fetch(base + m[1]);
        check(`asset ${m[1]}`, asset.status === 200);
      }
    }
    const bare = await fetch(`${base}/safeauth?x=1`, { redirect: 'manual' });
    check('GET /safeauth?x=1 -> 301 /safeauth/?x=1', bare.status === 301 && bare.headers.get('location') === '/safeauth/?x=1', `${bare.status} ${bare.headers.get('location')}`);
    const missing = await fetch(`${base}/safeauth/not-a-page.html`, { redirect: 'manual' });
    check('unknown /safeauth/* is not an auth document', !(await missing.text()).includes('safeauth-page'), String(missing.status));
    const sibling = await fetch(`${base}/safeauthx/`, { redirect: 'manual' });
    check('/safeauthx/ is not an auth route', !(await sibling.text()).includes('safeauth-page'), String(sibling.status));
    for (const path of siteRoutes) {
      const r = await fetch(base + path, { redirect: 'manual' });
      const body = await r.text();
      const expected = readFileSync(join(siteDist, path.endsWith('/') ? `${path}index.html` : path), 'utf8');
      check(`site ${path} unchanged`, r.status === 200 && body === expected, String(r.status));
    }
  } finally {
    await new Promise(r => server.close(r));
  }
  return { ok: results.every(r => r.ok), results };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const get = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  const out = await verifyComposedSite({ siteDist: get('--site-dist') ?? 'dist', port: Number(get('--port') ?? 8490) });
  for (const r of out.results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.detail ? ` (${r.detail})` : ''}`);
  console.log(out.ok ? 'COMPOSED SITE PASS' : 'COMPOSED SITE FAIL');
  process.exit(out.ok ? 0 : 1);
}
