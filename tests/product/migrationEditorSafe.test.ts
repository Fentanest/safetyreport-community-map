// Migrations from 202610010100 on are applied per file (shared project with the auth repo), often by pasting into the
// Supabase SQL Editor. The editor treats an ASCII apostrophe inside a `--` comment as an opening quote and then splits
// function bodies at their `;` (2026-09-30: "syntax error at or near if"). Comments use ’ or backticks instead.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dir = new URL('../../supabase/migrations/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.sql') && f >= '202610010100');

describe('migrations paste cleanly into the Supabase SQL Editor', () => {
  it.each(files)('%s has no ASCII apostrophe in a comment', (f) => {
    const bad = readFileSync(new URL(f, dir), 'utf8').split('\n')
      .map((line, i) => [i + 1, line] as const)
      .filter(([, line]) => { const c = line.indexOf('--'); return c >= 0 && line.slice(0, c).split("'").length % 2 === 1 && line.slice(c).includes("'"); });
    expect(bad).toEqual([]);
  });
});
