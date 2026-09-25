#!/usr/bin/env node
// Composes a verified safeauth artifact into an already-built site as <site>/safeauth/.
// Used by WorklazyTools' Pages workflow from a pinned community-map checkout:
//   node scripts/safeauth/compose-into-site.mjs --site-dist dist --auth-dist .safeauth-src/dist-safeauth \
//        --source-sha <40 hex> [--require-config] [--expect-supabase https://<ref>.supabase.co] --report out.json
// Guarantees: refuses an existing /safeauth folder, symlinks and unverified output;
// stages next to the site and renames atomically; proves every pre-existing site file
// is byte-identical afterwards. Writes nothing outside <site>/safeauth except --report.
import { createHash } from 'node:crypto';
import { cpSync, existsSync, lstatSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyArtifact } from './verify-artifact.mjs';

const MOUNT = 'safeauth';
const PROTOCOL_VERSION = 1;

function hashTree(root, skipTop = null) {
  const out = new Map();
  const walk = dir => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      const relPath = relative(root, path).split(sep).join('/');
      if (skipTop && (relPath === skipTop || relPath.startsWith(`${skipTop}/`))) continue;
      const st = lstatSync(path);
      if (st.isDirectory()) walk(path);
      else out.set(relPath, st.isSymbolicLink() ? 'symlink' : createHash('sha256').update(readFileSync(path)).digest('hex'));
    }
  };
  walk(root);
  return out;
}

export function compose({ siteDist, authDist, sourceSha, requireConfig = false, expectSupabase = null, siteOrigin = 'https://worklazy.net' }) {
  const site = resolve(siteDist);
  const auth = resolve(authDist);
  if (!/^[0-9a-f]{40}$/.test(sourceSha ?? '')) throw new Error('source sha must be a full 40-character commit id');
  for (const required of ['index.html', '404.html']) {
    if (!existsSync(join(site, required))) throw new Error(`site dist is missing ${required}; build the site first`);
  }
  const target = join(site, MOUNT);
  if (existsSync(target)) throw new Error(`site already contains /${MOUNT}/ — refusing to overwrite; resolve the conflict first`);

  const verdict = verifyArtifact({ dir: auth, base: `/${MOUNT}/`, requireConfig, expectSupabase, siteOrigin });
  if (!verdict.ok) throw new Error(`auth artifact failed verification:\n  ${verdict.errors.join('\n  ')}`);

  const before = hashTree(site);
  const staging = join(dirname(site), `.${MOUNT}-staging-${process.pid}`);
  rmSync(staging, { recursive: true, force: true });
  cpSync(auth, staging, { recursive: true, verbatimSymlinks: true, errorOnExist: true });
  renameSync(staging, target); // same filesystem: atomic directory swap-in

  const after = hashTree(site, MOUNT);
  const changed = [];
  for (const [path, hash] of before) if (after.get(path) !== hash) changed.push(path);
  for (const path of after.keys()) if (!before.has(path)) changed.push(path);
  if (changed.length > 0) {
    rmSync(target, { recursive: true, force: true });
    throw new Error(`composition changed files outside /${MOUNT}/: ${changed.slice(0, 10).join(', ')}`);
  }
  const mounted = hashTree(target);
  return {
    protocolVersion: PROTOCOL_VERSION,
    sourceSha,
    mount: `/${MOUNT}/`,
    connectSrc: verdict.connectSrc,
    siteFilesUnchanged: before.size,
    authFiles: Object.fromEntries([...mounted].sort()),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const get = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  try {
    const report = compose({
      siteDist: get('--site-dist') ?? 'dist',
      authDist: get('--auth-dist') ?? 'dist-safeauth',
      sourceSha: get('--source-sha'),
      requireConfig: args.includes('--require-config'),
      expectSupabase: get('--expect-supabase') ?? null,
      siteOrigin: get('--site-origin') ?? 'https://worklazy.net',
    });
    const reportPath = get('--report');
    if (reportPath) writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
    console.log(`composed /safeauth/ from ${report.sourceSha} (protocol ${report.protocolVersion}); ${report.siteFilesUnchanged} site files unchanged; ${Object.keys(report.authFiles).length} auth files`);
  } catch (error) {
    console.error(`safeauth compose FAILED: ${error.message}`);
    process.exit(1);
  }
}
