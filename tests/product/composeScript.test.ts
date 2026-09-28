// 합성 검사 스크립트는 인증 저장소 경로를 반드시 받는다(감사 SOL-09) — 정리된 임시 worktree 를 기본값으로 읽지 않는다.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const script = join(__dirname, '../../scripts/integration/compose_supabase.mjs');
const run = (args: string[], env: Record<string, string | undefined> = {}) => {
  const e = { ...process.env, ...env };
  if (env.SR_AUTH_REPO === undefined) delete e.SR_AUTH_REPO;
  return spawnSync(process.execPath, [script, ...args], { env: e, encoding: 'utf8' });
};

describe('compose_supabase.mjs auth path', () => {
  it('fails clearly when no auth repository is given', () => {
    const r = run(['check']);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('auth repository path required');
  });

  it('fails clearly when the auth path is not a community-auth checkout', () => {
    const empty = mkdtempSync(join(tmpdir(), 'sr-no-auth-'));
    expect(run(['check', '--auth', empty]).status).toBe(2);
    const viaEnv = run(['check'], { SR_AUTH_REPO: empty });
    expect(viaEnv.status).toBe(2);
    expect(viaEnv.stderr).toContain('not a community-auth checkout');
  });
});

describe('compose_supabase.mjs staging coverage', () => {
  // Hermetic fixture repos: a demo edge function whose handler transitively imports a
  // JSON data file (with { type: 'json' }) and a resolver module — the shape of the
  // community-ingest resolve.ts bundling failure. npm: imports must be ignored.
  const fixture = (shared: string[], extraFiles: Record<string, string> = {}) => {
    const map = mkdtempSync(join(tmpdir(), 'sr-fix-map-'));
    const auth = mkdtempSync(join(tmpdir(), 'sr-fix-auth-'));
    mkdirSync(join(auth, 'supabase/migrations'), { recursive: true });
    const files: Record<string, string> = {
      'supabase/functions/demo/index.ts': `import { createClient } from 'npm:@supabase/supabase-js@2.117.1';
import { handle } from '../../../server/handler.ts';
Deno.serve(handle);`,
      'server/handler.ts': `import data from '../shared/reg/data.json' with { type: 'json' };
import { resolve } from '../shared/reg/resolve.ts';
import type { Cfg } from '../shared/reg/types.ts';
export const handle = (d = data, r = resolve, _c: Cfg | null = null) => new Response(String(d) + String(r));`,
      'shared/reg/data.json': '{"v":1}',
      'shared/reg/resolve.ts': `export const resolve = () => 'ok';`,
      'shared/reg/types.ts': `export type Cfg = { v: number };`,
      ...extraFiles,
    };
    for (const [rel, content] of Object.entries(files)) {
      const abs = join(map, rel);
      mkdirSync(join(abs, '..'), { recursive: true });
      writeFileSync(abs, content);
    }
    const manifest = {
      schema: 1,
      staging: { project_id: 'fix', ports: { api: 1, db: 2, shadow: 3, inspector: 4 },
        site_url: 'http://127.0.0.1/', redirect_urls: [], kakao_mock_url: 'http://127.0.0.1/',
        function_env: {} },
      migrations: [],
      functions: [{ name: 'demo', repo: 'map', verify_jwt: true, shared }],
    };
    const manifestPath = join(map, 'manifest.json');
    writeFileSync(manifestPath, JSON.stringify(manifest));
    const check = (args: string[] = []) =>
      run(['check', '--auth', auth, '--manifest', manifestPath, ...args], { SR_MAP_REPO: map, SR_AUTH_REPO: auth });
    return { check };
  };

  it('fails when a transitive import (json with-attribute, resolver, type-only) is not staged', () => {
    const { check } = fixture(['server/handler.ts']);
    const r = check();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('shared/reg/data.json');
    expect(r.stderr).toContain('shared/reg/resolve.ts');
    expect(r.stderr).toContain('shared/reg/types.ts');
    expect(r.stderr).toContain('is not staged');
  });

  it('passes when the full import closure is staged', () => {
    const { check } = fixture(['server/handler.ts', 'shared/reg/data.json', 'shared/reg/resolve.ts', 'shared/reg/types.ts']);
    const r = check();
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('manifest check ok');
  });

  it('fails when a staged shared file is not imported', () => {
    const { check } = fixture(
      ['server/handler.ts', 'shared/reg/data.json', 'shared/reg/resolve.ts', 'shared/reg/types.ts', 'server/unused.ts'],
      { 'server/unused.ts': `export const unused = 1;` },
    );
    const r = check();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('server/unused.ts');
    expect(r.stderr).toContain('is not imported');
  });

  it('ignores fake imports inside comments and string literals', () => {
    // The old regex check mistook `from './removed.ts'` in a comment or a string for a
    // real import. The AST check must pass with only the real closure staged.
    const handler = [
      `import data from '../shared/reg/data.json' with { type: 'json' };`,
      `import { resolve } from '../shared/reg/resolve.ts';`,
      `import type { Cfg } from '../shared/reg/types.ts';`,
      `// from './removed.ts'`,
      `// import './removed2.ts';`,
      `/* export * from './removed3.ts'; import './removed4.ts'; */`,
      `const s1 = "import x from './fake.ts'";`,
      `const s2 = 'from "./fake2.ts"';`,
      `const s3 = 'import("./fake3.ts")';`,
      `export const handle = (d = data, r = resolve, _c: Cfg | null = null) => new Response(String(d) + String(r) + s1 + s2 + s3);`,
    ].join('\n');
    const { check } = fixture(
      ['server/handler.ts', 'shared/reg/data.json', 'shared/reg/resolve.ts', 'shared/reg/types.ts'],
      { 'server/handler.ts': handler },
    );
    const r = check();
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('manifest check ok');
  });

  it('detects a two-argument dynamic import (import attributes as second argument)', () => {
    const handler = [
      `export const handle = async () => {`,
      `  const lazy = await import('../shared/reg/lazy.ts', { with: { type: 'json' } });`,
      `  return new Response(String(lazy));`,
      `};`,
    ].join('\n');
    const missing = fixture(['server/handler.ts'], {
      'server/handler.ts': handler,
      'shared/reg/lazy.ts': `export const lazy = 1;`,
    });
    const fail = missing.check();
    expect(fail.status).toBe(1);
    expect(fail.stderr).toContain('shared/reg/lazy.ts');
    expect(fail.stderr).toContain('is not staged');

    const staged = fixture(
      ['server/handler.ts', 'shared/reg/lazy.ts'],
      { 'server/handler.ts': handler, 'shared/reg/lazy.ts': `export const lazy = 1;` },
    );
    expect(staged.check().status).toBe(0);
  });

  it('allows imports of other files inside the same function directory', () => {
    // compose() copies the whole function directory, so './helper.ts' must not fail even
    // though it is not listed in shared. The shared closure behind the helper still applies.
    const index = [
      `import { help } from './helper.ts';`,
      `Deno.serve(() => help());`,
    ].join('\n');
    const helper = [
      `import data from '../../../shared/reg/data.json' with { type: 'json' };`,
      `export const help = () => new Response(String(data));`,
    ].join('\n');
    const { check } = fixture(
      ['shared/reg/data.json'],
      {
        'supabase/functions/demo/index.ts': index,
        'supabase/functions/demo/helper.ts': helper,
        'shared/reg/data.json': '{"v":1}',
      },
    );
    const r = check();
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('manifest check ok');
  });

  it('still fails when a JSON import target is missing', () => {
    const handler = [
      `import data from '../shared/reg/data.json' with { type: 'json' };`,
      `export const handle = () => new Response(String(data));`,
    ].join('\n');
    const { check } = fixture(['server/handler.ts'], { 'server/handler.ts': handler });
    const r = check();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('shared/reg/data.json');
    expect(r.stderr).toContain('is not staged');
  });
});
