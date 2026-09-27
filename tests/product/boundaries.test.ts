import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeTopology, simplifyLine } from '../../src/lib/boundaries';
import names from '../../contracts/regions/names-20260701.json';

const topo = (level: 'sido' | 'sgg') => JSON.parse(readFileSync(`public/boundaries/v20260701/${level}.topo.json`, 'utf8'));
const vertices = (f: ReturnType<typeof decodeTopology>) => f.reduce((n, x) => n + x.polygons.reduce((m, p) => m + p.reduce((k, r) => k + r.length, 0), 0), 0);

describe('boundary layers (display only)', () => {
  const sido = decodeTopology(topo('sido'), 'sido');
  const sgg = decodeTopology(topo('sgg'), 'sgg');

  it('every official code has exactly one shape, and nothing else', () => {
    expect(sido.map(f => f.code).sort()).toEqual(names.sido.map(s => s.code).sort());
    expect(sgg.map(f => f.code).sort()).toEqual(names.sgg.map(s => s.code).sort());
    for (const f of sgg) expect(f.sido).toBe(f.code.slice(0, 2));
  });
  it('shapes are closed rings inside Korea with a sane bbox', () => {
    for (const f of [...sido, ...sgg]) {
      expect(f.polygons.length).toBeGreaterThan(0);
      for (const ring of f.polygons.flat()) {
        expect(ring.length).toBeGreaterThanOrEqual(4);
        expect(ring[0]).toEqual(ring[ring.length - 1]);
      }
      const [w, s, e, n] = f.bbox;
      expect(w).toBeGreaterThan(124); expect(e).toBeLessThan(132); expect(s).toBeGreaterThan(32); expect(n).toBeLessThan(39.5);
      expect(w).toBeLessThan(e); expect(s).toBeLessThan(n);
    }
  });
  it('display simplification keeps the nationwide layer light', () => {
    console.log('vertices', { sido: vertices(sido), sgg: vertices(sgg) });
    expect(vertices(sido)).toBeLessThan(30000);
    expect(vertices(sgg)).toBeLessThan(80000);
  });
  it('simplification keeps line ends and closed rings', () => {
    const line: Array<[number, number]> = [[0, 0], [1, 0.0001], [2, 0], [3, 0.0001], [4, 0]];
    expect(simplifyLine(line, 0.01)).toEqual([[0, 0], [4, 0]]);
    const square: Array<[number, number]> = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
    const s = simplifyLine(square, 0.01);
    expect(s[0]).toEqual(s[s.length - 1]);
    expect(s.length).toBeGreaterThanOrEqual(4);
  });
});
