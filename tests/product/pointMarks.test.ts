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
    pt('a', 37.5, 127.0, '11140'), pt('b', 35.1, 129.0, '26470'), pt('c', 33.5, 126.5, '50110'),
    pt('cluster:1', 36.0, 127.5, null, { aggregate: true, point_count: 4, bbox: [127.4, 35.9, 127.6, 36.1] }),
  ];
  const my = [mine('a', 37.5, 127.0, true, 2), mine('c', 33.5, 126.5, false, 1), mine('hidden', 36.05, 127.45, false, 3)];

  it('marks exact points by key and clusters by bbox containment', () => {
    const marks = markPoints(points, my, ['26470']);
    expect(marks.get('a')).toEqual({ mine: true, shared: true, mineCount: 2, interest: false });
    expect(marks.get('c')).toEqual({ mine: true, shared: false, mineCount: 1, interest: false });
    expect(marks.get('b')).toEqual({ mine: false, shared: false, mineCount: 0, interest: true });
    expect(marks.get('cluster:1')).toMatchObject({ mine: true, shared: false, mineCount: 3 });
  });

  it('filters for display only and returns copies', () => {
    const marks = markPoints(points, my, ['26470']);
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
    expect(sanitizeInterest(['11140', '11140', 1, '', 'x'.repeat(25), '26', '99999', 'abc'])).toEqual(['11140', '26']);
    const sgg = ['11110', '11140', '11170', '11200', '11215', '11230', '11260', '11290', '11305', '11320', '11350', '11380'];
    expect(sanitizeInterest(sgg)).toHaveLength(10);
    expect(sanitizeInterest('not-a-list')).toEqual([]);
    expect(toggleInterest(['11140'], '11140')).toEqual([]);
    expect(toggleInterest(['11140'], '26')).toEqual(['11140', '26']);
  });
  it('converts interest regions saved as old display keys; drops split or unknown ones', () => {
    expect(sanitizeInterest(['서울 중구', '광주 북구', '세종 조치원읍', '인천 남구', '인천 중구', '없는 곳'])).toEqual(['11140', '12300', '36110', '28177']);
  });
  it('a 시도 interest marks the points of its 시군구', () => {
    const marks = markPoints([pt('x', 35.1, 129.0, '26470'), pt('y', 37.5, 127.0, '11140')], null, ['26']);
    expect(marks.get('x')!.interest).toBe(true);
    expect(marks.get('y')!.interest).toBe(false);
  });
  it('reads only known view modes from the URL', () => {
    expect(viewFromSearch('?view=map')).toBe('map');
    expect(viewFromSearch('?view=stats')).toBe('stats');
    expect(viewFromSearch('?view=<script>')).toBe('both');
  });
});
