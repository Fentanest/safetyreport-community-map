import { describe, expect, it } from 'vitest';
import vectors from '../../contracts/masking-vectors.json';
import { maskPlate, parsePlate } from '../../server/plate';

describe('private canonical plate → public display', () => {
  it('preserves the regional prefix for identity and removes it before masking', () => {
    expect(parsePlate('서울12가3456')?.canonical).toBe('서울12가3456');
    expect(parsePlate('부산12가3456')?.canonical).toBe('부산12가3456');
    expect(maskPlate('서울12가3456')).toBe('1*가*4*6');
    expect(maskPlate('부산12가3456')).toBe('1*가*4*6');
  });
  it('matches the package vectors and fails closed', () => {
    for (const entry of vectors) expect(maskPlate(entry.input)).toBe(entry.output);
    expect(maskPlate('UNKNOWN-PRIVATE-PLATE')).toBe('번호 확인 불가');
    expect(maskPlate(null)).toBe('번호 확인 불가');
  });
});
