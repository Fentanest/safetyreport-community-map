import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import vectors from '../fixtures/plate_normalize_vectors.json';
import { normalizePlate, parsePlate } from '../../server/plate';

const migration = readFileSync('supabase/migrations/202610130100_screen_plate_normalization.sql', 'utf8');
// Pure fallback for CI without PostgreSQL: execute the SQL's literal dictionary, token and strip expressions
// using the same advancing scanner. Actual PostgreSQL execution: tests/sql/verify-screen-plate.mjs.
const names = JSON.parse(migration.match(/names constant jsonb := '(.*?)'::jsonb/)![1]) as Record<string, string>;
const token = new RegExp(migration.match(/token constant text := '(.*?)';/)![1], 'gu');
const unicode = migration.match(/U&'([^']+)'/)![1].replace(/\\\+([0-9a-f]{6})|\\([0-9a-f]{4})/gi,
  (_, long: string, short: string) => String.fromCodePoint(parseInt(long || short, 16)));
const strip = new RegExp(`[${unicode}-]`, 'gu');
const adjacent = /[0-9ᄀ-ᇿㄱ-ㆎ가-힣]/u;
function sqlModel(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 64) return null;
  const text = raw.normalize('NFKC').replace(strip, '');
  let found: string | null = null;
  for (const match of text.matchAll(token)) {
    const first = match.index!;
    const end = first + match[0].length;
    if ((first > 0 && adjacent.test(text[first - 1])) || adjacent.test(text[end] ?? '')) continue;
    const candidate = (names[match[1]] ?? '') + match[2];
    if (found !== null && found !== candidate) return null;
    found = candidate;
  }
  return found;
}
const publicPlate = (raw: unknown) => {
  const plate = sqlModel(raw);
  return plate && /^([가-힣]+)?[0-9]{2,3}[가-힣][0-9]{4}$/u.test(plate) ? plate : null;
};

describe('P2 screen SQL normalization parity (pure fallback)', () => {
  for (const c of vectors.cases) it(c.name, () => {
    expect(sqlModel(c.raw)).toBe(c.expected);
    expect(publicPlate(c.raw)).toBe(parsePlate(c.raw)?.canonical ?? null);
  });
  it('all Unicode format characters and UTF-16 length agree with TypeScript', () => {
    for (let cp = 0; cp <= 0x10ffff; cp++) {
      const ch = String.fromCodePoint(cp);
      if (/\p{Cf}/u.test(ch)) expect(sqlModel(`12${ch}가3456`)).toBe('12가3456');
    }
    for (const raw of ['😀'.repeat(29) + '12가3456', '12가3456/12가3456', '서울특별시12가3456/서울12가3456', '12가3456/34나5678']) {
      expect(sqlModel(raw)).toBe(normalizePlate(raw));
    }
  });
  it('only adds the normalization helper/replaces screen_plate; invalidates cached projections', () => {
    expect([...migration.matchAll(/create or replace function ([^(]+)/g)].map((m) => m[1]))
      .toEqual(['private.screen_normalize_plate', 'private.screen_plate_strict', 'private.screen_plate']);
    expect(migration).toContain('select private.community_bump_projection();');
    expect(migration).toContain('update private.screen_cache_epoch set revision=revision+1');
    const verification = readFileSync('docs/implementation/plate-sql-20261013/verify.sql', 'utf8');
    expect(verification).toContain(migration.replace(/\bbegin;\n/, '').replace(/commit;\s*$/, '').trim());
    expect(JSON.parse(verification.match(/\$vectors\$([\s\S]*?)\$vectors\$/)![1])).toEqual(vectors);
    expect(verification.trim().endsWith('rollback;')).toBe(true);
  });
});
