import { describe, expect, it } from 'vitest';
import vectors from '../fixtures/plate_normalize_vectors.json';
import { normalizePlate, parsePlate, maskPlate } from '../../server/plate';

// 세 레포(safetyreport, safetyreport-mobile, safetyreport-community-map) 공유 벡터 —
// tests/fixtures/plate_normalize_vectors.json 는 세 레포에서 바이트가 같다.
describe('normalizePlate — shared cross-repo vectors', () => {
  for (const c of vectors.cases as Array<{ name: string; raw: unknown; expected: string | null; masked: string }>) {
    it(`${c.name}: ${JSON.stringify(c.raw)} -> ${JSON.stringify(c.expected)}`, () => {
      expect(normalizePlate(c.raw)).toBe(c.expected);
      expect(parsePlate(c.raw)?.canonical ?? null).toBe(c.expected);
      expect(maskPlate(c.raw)).toBe(c.masked);
      if (c.expected) expect((c.masked.slice(-4).match(/[0-9]/g) ?? []).length).toBe(2);
    });
  }
});
