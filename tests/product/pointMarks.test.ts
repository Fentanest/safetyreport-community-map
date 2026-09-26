import { describe, expect, it } from 'vitest';
import { filterPoints, markPoints } from '../../src/state/pointMarks';
import { sanitizeInterest, toggleInterest, viewFromSearch } from '../../src/state/view';
import type { PublicPoint } from '../../src/domain/public';
import type { MyPoint } from '../../src/domain/personal';

const pt = (key: string, lat: number, lng: number, region: string | null, extra: Partial<PublicPoint> = {}): PublicPoint => ({
  key, lat, lng, address: null, region_code: region, report_count: 3, completed_count: 1, outcomes: null, fine_count: 0, ...extra,
});
const mine = (key: string, lat: number, lng: number, shared: boolean, n = 1): MyPoint => ({
  key, lat, lng, region_code: null, mine_report_count: n, mine_completed_count: 0, shared,
});

describe('display marks never change the data', () => {
  const points = [
    pt('a', 37.5, 127.0, '서울 중구'), pt('b', 35.1, 129.0, '부산 연제구'), pt('c', 33.5, 126.5, '제주 제주시'),
    pt('cluster:1', 36.0, 127.5, null, { aggregate: true, point_count: 4, bbox: [127.4, 35.9, 127.6, 36.1] }),
  ];
  const my = [mine('a', 37.5, 127.0, true, 2), mine('c', 33.5, 126.5, false, 1), mine('hidden', 36.05, 127.45, false, 3)];

  it('marks exact points by key and clusters by bbox containment', () => {
    const marks = markPoints(points, my, ['부산 연제구']);
    expect(marks.get('a')).toEqual({ mine: true, shared: true, mineCount: 2, interest: false });
    expect(marks.get('c')).toEqual({ mine: true, shared: false, mineCount: 1, interest: false });
    expect(marks.get('b')).toEqual({ mine: false, shared: false, mineCount: 0, interest: true });
    expect(marks.get('cluster:1')).toMatchObject({ mine: true, shared: false, mineCount: 3 });
  });

  it('filters for display only and returns copies', () => {
    const marks = markPoints(points, my, ['부산 연제구']);
    expect(filterPoints(points, marks, 'mine').map(p => p.key)).toEqual(['a', 'c', 'cluster:1']);
    expect(filterPoints(points, marks, 'shared').map(p => p.key)).toEqual(['a']);
    expect(filterPoints(points, marks, 'interest').map(p => p.key)).toEqual(['b']);
    expect(filterPoints(points, marks, 'all')).toHaveLength(4);
    expect(points).toHaveLength(4);
  });

  it('without a comparison nothing is marked as mine', () => {
    const marks = markPoints(points, null, []);
    expect([...marks.values()].every(m => !m.mine && !m.shared && !m.interest)).toBe(true);
  });
});

describe('interest regions and view state', () => {
  it('keeps at most 10 short public codes and toggles', () => {
    expect(sanitizeInterest(['a', 'a', 1, '', 'x'.repeat(25), 'b'])).toEqual(['a', 'b']);
    expect(sanitizeInterest(Array.from({ length: 20 }, (_, i) => `r${i}`))).toHaveLength(10);
    expect(sanitizeInterest('not-a-list')).toEqual([]);
    expect(toggleInterest(['a'], 'a')).toEqual([]);
    expect(toggleInterest(['a'], 'b')).toEqual(['a', 'b']);
  });
  it('reads only known view modes from the URL', () => {
    expect(viewFromSearch('?view=map')).toBe('map');
    expect(viewFromSearch('?view=stats')).toBe('stats');
    expect(viewFromSearch('?view=<script>')).toBe('both');
  });
});
