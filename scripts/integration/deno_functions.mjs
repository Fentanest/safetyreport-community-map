#!/usr/bin/env node
// F04 local Edge check WITHOUT the edge-runtime container (its npm download fails behind this environment's TLS proxy):
// every function of the composed stack runs under the Deno CLI (same source files, `Deno.serve` bound to a local port),
// and a small gateway on GATEWAY_PORT sends `/functions/v1/<name>/…` to that function and everything else (auth, rest)
// to the stack's Kong. The trust chain for npm/jsr downloads is the environment's CA bundle (DENO_CERT) — TLS
// verification is never disabled. Evidence only: this is `deno-local`, NOT Supabase's edge-runtime and NOT production.
// The gateway's verify_jwt step is not reproduced here (every function still verifies the user itself).
//
//   node scripts/integration/deno_functions.mjs --stack .integration-stack --deno /tmp/denotool/node_modules/.bin/deno
import { spawn, execFileSync } from 'node:child_process';
import { createServer, request } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const stack = resolve(opt('--stack', '.integration-stack'));
const functionsRoot = resolve(opt('--functions-root', stack));
const deno = opt('--deno', 'deno');
const KONG = opt('--kong', 'http://127.0.0.1:56321');
const GATEWAY_PORT = Number(opt('--port', '56999'));
const FUNCTIONS = opt('--functions', 'public-analytics,my-analytics,community-ingest,community-account,community-auth-relay,my-reports,user-rankings').split(',');
const functionPortBase = Number(opt('--function-port-base', '8101'));

// stack keys (never printed): `supabase status -o env`
const statusEnv = Object.fromEntries(execFileSync('npx', ['supabase', 'status', '-o', 'env'], { cwd: stack, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  .split('\n').map((l) => /^([A-Z_]+)="?(.*?)"?$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2]]));
const readEnv = root => Object.fromEntries(readFileSync(join(root, 'supabase/functions/.env'), 'utf8').split('\n')
  .map((l) => /^([A-Z_]+)=(.*)$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2].replace(/^"|"$/g, '')]));
const fnEnv = { ...readEnv(functionsRoot), ...readEnv(stack) };
const env = {
  ...process.env, ...fnEnv,
  SUPABASE_URL: KONG, SUPABASE_ANON_KEY: statusEnv.ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: statusEnv.SERVICE_ROLE_KEY,
  SUPABASE_DB_URL: statusEnv.DB_URL,
  DENO_CERT: process.env.DENO_CERT || fnEnv.DENO_CERT || '/root/.ccr/ca-bundle.crt', DENO_DIR: process.env.DENO_DIR || '/tmp/denotool/cache',
};
if (!env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('stack not running (no service key from `supabase status`)');

const work = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'deno-fn-'));
chmodSync(work, 0o700);
const ports = new Map();
const procs = [];
let ready = 0;
FUNCTIONS.forEach((fn, i) => {
  const port = functionPortBase + i;
  ports.set(fn, port);
  const wrapper = join(work, `${fn}.ts`);
  writeFileSync(wrapper, `const orig = Deno.serve.bind(Deno);
// deno-lint-ignore no-explicit-any
(Deno as any).serve = (h: unknown) => orig({ port: ${port}, hostname: '127.0.0.1', onListen() { console.log('LISTEN ${fn} ${port}'); } }, h as Deno.ServeHandler);
await import(${JSON.stringify(`file://${join(functionsRoot, 'supabase/functions', fn, 'index.ts')}`)});
`);
  const config = join(functionsRoot, 'supabase/functions', fn, 'deno.json');
  const p = spawn(deno, ['run', ...(existsSync(config) ? ['--config', config] : []), '--unstable-sloppy-imports', '--allow-net', '--allow-env', '--allow-read', '--no-prompt', wrapper], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout.on('data', (d) => { const t = d.toString(); if (t.includes('LISTEN')) { ready += 1; console.log(t.trim()); } });
  p.stderr.on('data', (d) => process.stderr.write(`[${fn}] ${d}`));
  p.on('exit', (c) => console.log(`[${fn}] exited ${c}`));
  procs.push(p);
});

createServer((req, res) => {
  const m = /^\/functions\/v1\/([a-z-]+)(\/.*)?$/.exec(req.url.split('?')[0]);
  const target = m && ports.has(m[1]) ? { host: '127.0.0.1', port: ports.get(m[1]), path: req.url.replace(/^\/functions\/v1/, '') } : (() => {
    const k = new URL(KONG); return { host: k.hostname, port: Number(k.port), path: req.url };
  })();
  const up = request({ ...target, method: req.method, headers: { ...req.headers, host: `${target.host}:${target.port}` } }, (r) => {
    // evidence line: which process answered (path only — no query string, no headers, no tokens)
    if (m) console.log(`[gateway] ${req.method} ${req.url.split('?')[0]} → deno:${m[1]} ${r.statusCode}`);
    res.writeHead(r.statusCode, r.headers); r.pipe(res);
  });
  up.on('error', (e) => { res.writeHead(502, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'gateway', detail: String(e) })); });
  req.pipe(up);
}).listen(GATEWAY_PORT, '127.0.0.1', () => console.log(`gateway http://127.0.0.1:${GATEWAY_PORT} → deno functions ${[...ports].map(([f, p]) => `${f}:${p}`).join(' ')}; else → ${KONG}`));

const stop = () => { for (const p of procs) p.kill(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setInterval(() => { if (ready === FUNCTIONS.length) { console.log('ALL FUNCTIONS LISTENING'); ready = -1; } }, 500);
