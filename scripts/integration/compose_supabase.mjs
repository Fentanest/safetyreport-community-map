#!/usr/bin/env node
// Compose ONE local Supabase project from the map and auth repositories, for integration tests only.
//
//   node scripts/integration/compose_supabase.mjs check   --auth <auth checkout> [--manifest <file>]
//   node scripts/integration/compose_supabase.mjs compose --auth <auth checkout> [--manifest <file>] [--out <dir>]
//
// Repositories: map = env SR_MAP_REPO (default: this checkout); auth = --auth <dir> or env SR_AUTH_REPO (required, no default).
// "check" fails on: duplicate version, same version with different content, missing dependency,
// dependency ordered after its dependent, file hash different from the manifest, shared server file clash.
// "compose" copies each migration exactly once into <out>/supabase/migrations in manifest order, copies the
// functions and the shared server/ modules they import, and writes an isolated config.toml
// (project_id / ports from the manifest). It never runs `supabase init` in a real repository and never
// touches another project's database. Secrets for the local stack are generated into <out>/supabase/functions/.env
// (0600) and are never printed.
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const cmd = args[0];
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

const mapRoot = resolve(process.env.SR_MAP_REPO || join(here, '../..'));
// 인증 저장소 경로는 반드시 명시한다(감사 SOL-09): 예전 기본값은 병렬 작업용 임시 worktree 를 가리켜, 그 worktree 를
// 정리한 뒤에는 검사가 실패하거나 엉뚱한 사본을 읽을 수 있었다. `--auth <dir>` 또는 env SR_AUTH_REPO.
const authArg = opt('--auth') || process.env.SR_AUTH_REPO;
if (!authArg && (cmd === 'check' || cmd === 'compose')) {
  console.error('auth repository path required: pass --auth <safetyreport-community-auth checkout> or set SR_AUTH_REPO');
  process.exit(2);
}
const authRoot = authArg ? resolve(authArg) : '';
if (authRoot && !existsSync(join(authRoot, 'supabase', 'migrations'))) {
  console.error(`auth repository not found or not a community-auth checkout: ${authRoot} (no supabase/migrations)`);
  process.exit(2);
}
const roots = { map: mapRoot, auth: authRoot };
const manifestPath = resolve(opt('--manifest') || join(mapRoot, 'docs/integration/community-ingest/migration-manifest.json'));
const outDir = resolve(opt('--out') || join(mapRoot, '.integration-stack'));

const sha256 = buf => createHash('sha256').update(buf).digest('hex');

function load() {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  for (const k of ['staging', 'migrations', 'functions']) if (!manifest[k]) throw new Error(`manifest missing ${k}`);
  return manifest;
}

// Every relative import reachable from a function's index.ts must resolve to a file
// that compose stages (a file inside the function directory, or an entry of
// functions[].shared). Otherwise `supabase start` fails at the Edge bundle step with
// "failed to read file". Conversely a shared entry nothing imports is dead weight and
// fails as well, so (shared entries) == (import closure outside the function directory).
//
// Import extraction uses the `typescript` package already in devDependencies
// (createSourceFile + AST walk), never regular expressions, so imports mentioned only
// in comments or string literals are not mistaken for real ones:
// - `import`/`export ... from './x'` — value or `import type`. Type-only edges are
//   included on purpose: the Deno-based Edge bundler resolves the full module graph
//   (including type-only edges) before type-stripping, so a missing file can still fail
//   the bundle step. This matches the staged type-only chain in community-account
//   (server/relay.ts, server/config.ts) that REVIEW6's parser run confirmed necessary.
// - dynamic `import('./x')` and `import(`./x`)`, including the two-argument form
//   `import('./x', { with: ... })` — only the first argument is a module specifier;
//   the import-attributes argument is ignored. A template with interpolation has no
//   fixed target, so this manifest-based check cannot resolve it statically.
// - JSON modules (`import data from './d.json' with { type: 'json' }`) are plain
//   ImportDeclarations, so they are covered too. `import ... = require('./x')` as well.
let tsMod = null;
function loadTs(problems) {
  if (!tsMod) {
    try {
      tsMod = require('typescript');
    } catch {
      problems.push("import-closure check needs the 'typescript' devDependency (run npm install)");
      return null;
    }
  }
  return tsMod;
}

function relativeImportSpecs(ts, source, filename) {
  const specs = new Set();
  const add = s => { if (typeof s === 'string' && s.startsWith('.')) specs.add(s); };
  const sf = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const visit = node => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const ms = node.moduleSpecifier;
      if (ms && ts.isStringLiteral(ms)) add(ms.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const first = node.arguments && node.arguments[0];
      // NoSubstitutionTemplateLiteral is a fixed module specifier too. Checking only
      // StringLiteral silently misses valid import(`./module.ts`) expressions.
      if (first && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first))) add(first.text);
    } else if (ts.isImportEqualsDeclaration(node)) {
      const ref = node.moduleReference;
      if (ref && ts.isExternalModuleReference(ref) && ref.expression && ts.isStringLiteral(ref.expression)) {
        add(ref.expression.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return specs;
}

// Keep the predicate shared with copyTree: fs.cp's filter sees the full source path,
// including files whose NAME merely contains "node_modules". Those files are omitted
// by compose too, even though they are not inside a node_modules directory.
const copiedByCopyTree = source => !/node_modules|\.git(\/|$)/.test(source);

// compose() copies the filtered function directory plus fn.shared. An import of an
// included file inside the function directory is fine without a shared entry.
function functionDirFiles(root, fnName) {
  const base = join(root, 'supabase/functions', fnName);
  const out = [];
  const walk = dir => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, e.name);
      if (!copiedByCopyTree(abs)) continue;
      if (e.isDirectory()) walk(abs);
      else if (e.isFile()) out.push(relative(root, abs));
    }
  };
  if (copiedByCopyTree(base) && existsSync(base) && statSync(base).isDirectory()) walk(base);
  return out;
}

function checkStagingCoverage(manifest, problems) {
  const ts = loadTs(problems);
  if (!ts) return;
  for (const fn of manifest.functions) {
    const root = roots[fn.repo];
    if (!root || !existsSync(join(root, 'supabase/functions', fn.name, 'index.ts'))) continue;
    const entry = `supabase/functions/${fn.name}/index.ts`;
    const staged = new Set([...functionDirFiles(root, fn.name), ...(fn.shared || [])]);
    if (!staged.has(entry)) {
      problems.push(`function ${fn.name}: index.ts is excluded by the compose copy filter`);
      continue;
    }
    const seen = new Set([entry]);
    const queue = [entry];
    while (queue.length) {
      const rel = queue.shift();
      if (!/\.(ts|tsx|js|jsx|mjs|cjs|json)$/.test(rel)) continue;
      let source;
      try { source = readFileSync(join(root, rel), 'utf8'); } catch { continue; }
      if (rel.endsWith('.json')) continue; // data file: staged for content, never an import source
      for (const spec of relativeImportSpecs(ts, source, rel)) {
        let target = resolve(join(root, dirname(rel)), spec);
        if (statSync(target, { throwIfNoEntry: false })?.isDirectory()) target = join(target, 'index.ts');
        const targetRel = relative(root, target);
        if (targetRel === '' || targetRel.startsWith('..')) {
          problems.push(`function ${fn.name}: import escapes ${fn.repo} repo (${rel} -> ${spec})`);
          continue;
        }
        if (!existsSync(target) || !statSync(target).isFile()) {
          problems.push(`function ${fn.name}: unresolvable relative import ${spec} (from ${rel})`);
          continue;
        }
        if (!staged.has(targetRel)) {
          problems.push(`function ${fn.name}: import ${targetRel} (from ${rel}) is not staged — add it to functions[${fn.name}].shared`);
        } else if (!seen.has(targetRel)) { seen.add(targetRel); queue.push(targetRel); }
      }
    }
    for (const rel of fn.shared || []) {
      if (!seen.has(rel)) problems.push(`function ${fn.name}: staged ${rel} is not imported — remove it from functions[${fn.name}].shared`);
    }
  }
}

function check(manifest) {
  const problems = [];
  const seen = new Map();
  manifest.migrations.forEach((m, index) => {
    const root = roots[m.repo];
    if (!root) { problems.push(`${m.version}: unknown repo ${m.repo}`); return; }
    const file = join(root, m.path);
    if (!existsSync(file)) { problems.push(`${m.version}: missing file ${m.repo}:${m.path}`); return; }
    const digest = sha256(readFileSync(file));
    if (m.sha256 && m.sha256 !== digest) problems.push(`${m.version}: sha256 mismatch for ${m.repo}:${m.path}`);
    if (!/^\d{12}$/.test(m.version) || !m.path.includes(m.version)) problems.push(`${m.version}: version/file name mismatch`);
    if (seen.has(m.version)) {
      const prev = seen.get(m.version);
      problems.push(prev.digest === digest ? `${m.version}: listed twice` : `${m.version}: same version, different content`);
    }
    seen.set(m.version, { index, digest });
    for (const dep of m.depends_on || []) {
      const d = seen.get(dep);
      if (!d) problems.push(`${m.version}: dependency ${dep} missing or ordered after it`);
    }
  });
  // Every *.sql in either repo must be listed (no silent extra history).
  for (const [repo, root] of Object.entries(roots)) {
    const dir = join(root, 'supabase/migrations');
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter(n => n.endsWith('.sql'))) {
      if (!manifest.migrations.some(m => m.repo === repo && m.path === `supabase/migrations/${f}`)) {
        problems.push(`unlisted migration ${repo}:supabase/migrations/${f}`);
      }
    }
  }
  const shared = new Map();
  for (const fn of manifest.functions) {
    const root = roots[fn.repo];
    if (!existsSync(join(root, 'supabase/functions', fn.name, 'index.ts'))) problems.push(`function ${fn.name}: missing index.ts in ${fn.repo}`);
    for (const rel of fn.shared || []) {
      const file = join(root, rel);
      if (!existsSync(file)) { problems.push(`function ${fn.name}: missing shared ${fn.repo}:${rel}`); continue; }
      const digest = sha256(readFileSync(file));
      const prev = shared.get(rel);
      if (prev && prev.digest !== digest) problems.push(`shared module clash ${rel} (${prev.repo} vs ${fn.repo})`);
      shared.set(rel, { repo: fn.repo, digest });
    }
  }
  checkStagingCoverage(manifest, problems);
  return problems;
}

function copyTree(src, dst) {
  cpSync(src, dst, { recursive: true, filter: copiedByCopyTree });
}

function compose(manifest) {
  const st = manifest.staging;
  if (existsSync(outDir)) {
    const marker = join(outDir, '.composed-by-compose_supabase');
    if (!existsSync(marker)) throw new Error(`refusing to overwrite ${outDir}: not a composed staging dir`);
    for (const d of ['supabase/migrations', 'supabase/functions', 'server', 'contracts']) rmSync(join(outDir, d), { recursive: true, force: true });
  }
  mkdirSync(join(outDir, 'supabase/migrations'), { recursive: true });
  writeFileSync(join(outDir, '.composed-by-compose_supabase'), 'integration staging, safe to delete\n');
  for (const m of manifest.migrations) {
    cpSync(join(roots[m.repo], m.path), join(outDir, 'supabase/migrations', m.path.split('/').pop()));
  }
  for (const fn of manifest.functions) {
    copyTree(join(roots[fn.repo], 'supabase/functions', fn.name), join(outDir, 'supabase/functions', fn.name));
    for (const rel of fn.shared || []) {
      mkdirSync(dirname(join(outDir, rel)), { recursive: true });
      cpSync(join(roots[fn.repo], rel), join(outDir, rel));
    }
  }
  const envFile = join(outDir, 'supabase/functions/.env');
  const secrets = existsSync(join(outDir, '.stack-secrets.json'))
    ? JSON.parse(readFileSync(join(outDir, '.stack-secrets.json'), 'utf8'))
    : { AUTH_RELAY_HASH_PEPPER: randomBytes(32).toString('base64url'), AUTH_RELAY_ENCRYPTION_KEY: randomBytes(32).toString('base64url'),
        ANALYTICS_RATE_SALT: randomBytes(24).toString('base64url'), KAKAO_SECRET: randomBytes(24).toString('base64url') };
  writeFileSync(join(outDir, '.stack-secrets.json'), JSON.stringify(secrets), { mode: 0o600 });
  const fnEnv = { ...st.function_env, AUTH_RELAY_HASH_PEPPER: secrets.AUTH_RELAY_HASH_PEPPER,
    AUTH_RELAY_ENCRYPTION_KEY: secrets.AUTH_RELAY_ENCRYPTION_KEY, ANALYTICS_RATE_SALT: secrets.ANALYTICS_RATE_SALT };
  writeFileSync(envFile, Object.entries(fnEnv).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600 });
  chmodSync(envFile, 0o600);
  const p = st.ports;
  const fnBlocks = manifest.functions.map(fn => `[functions.${fn.name}]\nenabled = true\nverify_jwt = ${fn.verify_jwt ? 'true' : 'false'}\n`).join('\n');
  const config = `# GENERATED by scripts/integration/compose_supabase.mjs — local integration stack only.
project_id = "${st.project_id}"

[api]
enabled = true
port = ${p.api}
schemas = ["public", "graphql_public"]
extra_search_path = ["public", "extensions"]
max_rows = 1000

[db]
port = ${p.db}
shadow_port = ${p.shadow}
major_version = 17

[db.pooler]
enabled = false

[db.migrations]
enabled = true

[db.seed]
enabled = false

[realtime]
enabled = true

[studio]
enabled = false

[local_smtp]
enabled = false

[storage]
# 운영 프로젝트와 같이 Storage API 를 켠다 — 버킷 없음·익명/사용자 업로드 거절을 실제로 시험한다(§14, Sol M-02).
enabled = true
file_size_limit = "1MiB"

[analytics]
enabled = false

[edge_runtime]
enabled = true
policy = "per_worker"
inspector_port = ${p.inspector}

[auth]
enabled = true
site_url = "${st.site_url}"
additional_redirect_urls = ${JSON.stringify(st.redirect_urls)}
jwt_expiry = 3600
enable_refresh_token_rotation = true
refresh_token_reuse_interval = 10
enable_signup = true
enable_anonymous_sign_ins = true

[auth.email]
enable_signup = true
enable_confirmations = false

[auth.external.kakao]
enabled = true
client_id = "mock-kakao-client"
secret = "${secrets.KAKAO_SECRET}"
url = "${st.kakao_mock_url}"
email_optional = true

${fnBlocks}`;
  writeFileSync(join(outDir, 'supabase/config.toml'), config, { mode: 0o600 });  // holds the local mock provider secret
  chmodSync(join(outDir, 'supabase/config.toml'), 0o600);
  return outDir;
}

const manifest = load();
if (cmd === 'check' || cmd === 'compose') {
  const problems = check(manifest);
  if (problems.length) { console.error('manifest check FAILED:\n  ' + problems.join('\n  ')); process.exit(1); }
  console.log(`manifest check ok: ${manifest.migrations.length} migrations, ${manifest.functions.length} functions (map=${relative(process.cwd(), mapRoot) || '.'}, auth=${authRoot})`);
  if (cmd === 'compose') console.log(`composed ${compose(manifest)}`);
} else {
  console.error('usage: compose_supabase.mjs check|compose --auth <dir> [--manifest f] [--out dir]');
  process.exit(2);
}
