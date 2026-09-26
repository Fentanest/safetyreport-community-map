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
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  return problems;
}

function copyTree(src, dst) {
  cpSync(src, dst, { recursive: true, filter: s => !/node_modules|\.git(\/|$)/.test(s) });
}

function compose(manifest) {
  const st = manifest.staging;
  if (existsSync(outDir)) {
    const marker = join(outDir, '.composed-by-compose_supabase');
    if (!existsSync(marker)) throw new Error(`refusing to overwrite ${outDir}: not a composed staging dir`);
    for (const d of ['supabase/migrations', 'supabase/functions', 'server']) rmSync(join(outDir, d), { recursive: true, force: true });
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
