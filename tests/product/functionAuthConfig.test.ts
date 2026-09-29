import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);
const config = readFileSync(new URL('supabase/config.toml', root), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('docs/integration/community-ingest/migration-manifest.json', root), 'utf8')) as {
  functions: Array<{ name: string; verify_jwt: boolean }>;
};

describe('deployed Edge function authentication configuration', () => {
  it('requires user JWTs for every data and account function; only the pre-login relay uses capabilities', () => {
    const flags = Object.fromEntries(manifest.functions.map(fn => [fn.name, fn.verify_jwt]));
    expect(flags).toEqual({
      'public-analytics': true, 'my-analytics': true, 'community-ingest': true,
      'community-account': true, 'community-auth-relay': false, 'my-reports': true,
    });
    for (const name of ['public-analytics', 'my-analytics', 'community-ingest', 'my-reports']) {
      expect(config).toMatch(new RegExp(`\\[functions\\.${name}\\]\\s+verify_jwt = true`));
    }
  });
});
