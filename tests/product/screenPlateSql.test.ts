import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import vectors from '../fixtures/plate_normalize_vectors.json';
import { normalizePlate, parsePlate } from '../../server/plate';

const migration = readFileSync('supabase/migrations/202610131000_motorcycle_plate.sql', 'utf8');
// PostgreSQL 없는 CI에서 SQL 사전·정규식을 검증한다. 실제 SQL 실행은 tests/sql/verify-screen-plate.mjs.
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
    const region = names[match[1]] ?? '';
    let body = match[2];
    if (/^[가-힣]{2,5}[0-9]{4}$/u.test(body)) {
      if (!region) continue;
      let city = body.slice(0, -5);
      if (city.length > 1) city = city.replace(/[시군구]$/u, '');
      if (city.length > 1 && /[시군구]$/u.test(city)) continue;
      if (city.length > 3) continue;
      if (names[region + city[0]] === region) continue;
      body = city + body.slice(-5);
    }
    const candidate = region + body;
    if (found !== null && found !== candidate) return null;
    found = candidate;
  }
  return found;
}

describe('P2 screen SQL normalization parity (pure fallback)', () => {
  for (const c of vectors.cases) it(c.name, () => {
    expect(sqlModel(c.raw)).toBe(c.expected);
    expect(sqlModel(c.raw)).toBe(parsePlate(c.raw)?.canonical ?? null);
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
  it('계산 함수·저장 투영·캐시만 갱신하며 원문은 수정하지 않는다', () => {
    expect([...migration.matchAll(/create or replace function ([^(]+)/g)].map((m) => m[1]))
      .toEqual(['private.screen_normalize_plate', 'private.screen_plate_strict', 'private.screen_plate', 'private.screen_mask_plate']);
    expect(migration).toContain('select private.community_bump_projection();');
    expect(migration).toContain('update private.screen_cache_epoch set revision=revision+1');
    expect(migration).toContain('select private.screen_precompute_lock();');
    expect(migration).toContain('update private.screen_observations o set plate=p.plate,plate_mask=p.plate_mask');
    expect(migration).not.toMatch(/update\s+private\.community_report_facts/i);
    const verification = readFileSync('tests/sql/verify-screen-plate.mjs', 'utf8');
    expect(verification).toContain('202610131000_motorcycle_plate.sql');
    expect(verification).toContain('tests/fixtures/plate_normalize_vectors.json');
  });
});
