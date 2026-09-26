// 합성 검사 스크립트는 인증 저장소 경로를 반드시 받는다(감사 SOL-09) — 정리된 임시 worktree 를 기본값으로 읽지 않는다.
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
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
