import { describe, expect, it } from 'vitest';
import vectors from '../../contracts/masking-vectors.json';
import { vehicleSchema } from '../../src/data/schema';
import { maskPlate, parsePlate } from '../../server/plate';

describe('private canonical plate → public display', () => {
  it('keeps the short region visible and skips it when choosing the masked positions', () => {
    expect(parsePlate('서울12가3456')?.canonical).toBe('서울12가3456');
    expect(parsePlate('부산12가3456')?.canonical).toBe('부산12가3456');
    expect(maskPlate('경기76자3623')).toBe('경기7*자*6*3');
    expect(maskPlate('서울12가3456')).toBe('서울1*가*4*6');
    expect(maskPlate('부산12가3456')).toBe('부산1*가*4*6');
    expect(maskPlate('경기도 76자-3623')).toBe('경기7*자*6*3');
    expect(maskPlate('12가3456')).toBe('1*가*4*6');
  });
  it('matches the package vectors and fails closed', () => {
    for (const entry of vectors) expect(maskPlate(entry.input)).toBe(entry.output);
    expect(maskPlate('UNKNOWN-PRIVATE-PLATE')).toBe('번호 확인 불가');
    expect(maskPlate(null)).toBe('번호 확인 불가');
  });
});

it('이륜 공개 DTO는 가림만 허용하고 원번호·과다 노출은 거절한다', () => {
  const row = {rank:1,rank_item_id:'r1',report_count:1,percentage:100};
  for (const masked_plate of ['경기군포다*6*1','서울강남다*0*5','광주북바*2*1','1오**3*7','가*2*4','1*3가*5*7']) {
    expect(vehicleSchema.safeParse({...row,masked_plate}).success).toBe(true);
  }
  for (const masked_plate of ['경기군포다2671','1오41357','1*3*4*67','경기군포다26*1','여수사*3*1']) {
    expect(vehicleSchema.safeParse({...row,masked_plate}).success).toBe(false);
  }
});
