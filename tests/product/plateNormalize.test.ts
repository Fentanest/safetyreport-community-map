import { describe, expect, it } from 'vitest';
import vectors from '../fixtures/plate_normalize_vectors.json';
import { normalizePlate } from '../../server/plate';

// 세 레포(safetyreport, safetyreport-mobile, safetyreport-community-map) 공유 벡터 —
// tests/fixtures/plate_normalize_vectors.json 는 세 레포에서 바이트가 같다.
describe('normalizePlate — shared cross-repo vectors', () => {
  for (const c of vectors.cases as Array<{ name: string; raw: unknown; expected: string | null }>) {
    it(`${c.name}: ${JSON.stringify(c.raw)} -> ${JSON.stringify(c.expected)}`, () => {
      expect(normalizePlate(c.raw)).toBe(c.expected);
    });
  }
});
