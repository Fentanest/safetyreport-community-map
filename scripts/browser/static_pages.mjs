// LOCAL stand-in for GitHub Pages (evidence only): serves `dist/` under a sub path the way Pages does for this site —
// static files, `.gz` as application/gzip WITHOUT Content-Encoding, no COOP/COEP, cache headers — plus optional
// switches used by the F06 checks: CSP=1 adds a strict Content-Security-Policy; GZ_ENCODING=1 serves the WASM
// archive with Content-Encoding: gzip (a server that decodes it for the browser).
//   BASE=/safetyreport-community-map/ PORT=5192 node scripts/browser/static_pages.mjs
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const BASE = process.env.BASE || '/safetyreport-community-map/';
const PORT = Number(process.env.PORT || 5192);
const ROOT = process.env.DIST || new URL('../../dist/', import.meta.url).pathname;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.gz': 'application/gzip', '.wasm': 'application/wasm', '.geojson': 'application/json' };
const CSP = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://dapi.kakao.com https://t1.daumcdn.net; worker-src 'self'; connect-src 'self' blob: https://*.kakao.com https://*.daumcdn.net; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline'; font-src 'self' data:";

const hits = {};
createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/__hits') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(hits)); return; }
  hits[url.pathname] = (hits[url.pathname] ?? 0) + 1;
  if (!url.pathname.startsWith(BASE)) { res.writeHead(404, { 'content-type': 'text/html' }); res.end('<!doctype html><h1>404</h1>'); return; }
  let rel = normalize(decodeURIComponent(url.pathname.slice(BASE.length))).replace(/^(\.\.[/\\])+/, '');
  if (rel === '.' || rel === '') rel = 'index.html';
  else if (rel.endsWith('/')) rel += 'index.html';
  const file = join(ROOT, rel);
  try {
    if (!(await stat(file)).isFile()) throw new Error('dir');
    const body = await readFile(file);
    const headers = { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': rel.startsWith('assets/') ? 'max-age=600' : 'max-age=0' };
    if (process.env.CSP === '1' && rel.endsWith('.html')) headers['content-security-policy'] = CSP;
    if (process.env.GZ_ENCODING === '1' && /excelize\.wasm-.*\.gz$/.test(rel)) { headers['content-encoding'] = 'gzip'; headers['content-type'] = 'application/wasm'; }
    res.writeHead(200, headers);
    res.end(body);
  } catch {
    // Pages serves 404.html for unknown paths (an HTML page, never the asset)
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><title>404</title><h1>Not Found</h1>');
  }
}).listen(PORT, '127.0.0.1', () => console.log(`static pages on http://127.0.0.1:${PORT}${BASE} (csp=${process.env.CSP === '1'})`));
