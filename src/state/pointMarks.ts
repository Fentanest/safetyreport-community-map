import type { PublicPoint } from '../domain/public';
import type { MyPoint } from '../domain/personal';
import type { PointFilter } from './view';

export interface PointMark {
  /** contains at least one of my reports/completions in the current scope */
  mine: boolean;
  /** contains one of my points that another contributor also recorded (함께 기록한 지점) */
  shared: boolean;
  /** my own report count at this node (exact point or sum inside an aggregate node) */
  mineCount: number;
  interest: boolean;
}

const EMPTY: PointMark = { mine: false, shared: false, mineCount: 0, interest: false };

function inside(bbox: [number, number, number, number], p: { lat: number; lng: number }): boolean {
  return p.lng >= bbox[0] && p.lng <= bbox[2] && p.lat >= bbox[1] && p.lat <= bbox[3];
}

/**
 * Display marks only — never changes scope or statistics. Exact points match by key; an aggregate
 * (cluster) node is marked when its bbox contains one of my exact points (its centroid is not a source coordinate).
 */
export function markPoints(points: readonly PublicPoint[], myPoints: readonly MyPoint[] | null, interest: readonly string[]): Map<string, PointMark> {
  const byKey = new Map((myPoints ?? []).map(p => [p.key, p]));
  const interestSet = new Set(interest);
  const marks = new Map<string, PointMark>();
  for (const point of points) {
    let mine = false, shared = false, mineCount = 0;
    if (point.aggregate && point.bbox) {
      for (const own of myPoints ?? []) {
        if (!inside(point.bbox, own)) continue;
        mine = true;
        shared ||= own.shared;
        mineCount += own.mine_report_count;
      }
    } else {
      const own = byKey.get(point.key);
      if (own) {
        mine = true;
        shared = own.shared;
        mineCount = own.mine_report_count;
      }
    }
    // interest can be a 시도 (2 digits) or a 시군구 (5 digits); points carry their 시군구 code
    const isInterest = point.region_code !== null &&
      (interestSet.has(point.region_code) || interestSet.has(point.region_code.slice(0, 2)));
    marks.set(point.key, mine || isInterest ? { mine, shared, mineCount, interest: isInterest } : EMPTY);
  }
  return marks;
}

export function filterPoints(points: readonly PublicPoint[], marks: Map<string, PointMark>, filter: PointFilter): PublicPoint[] {
  if (filter === 'all') return [...points];
  return points.filter((point) => {
    const mark = marks.get(point.key) ?? EMPTY;
    if (filter === 'mine') return mark.mine;
    if (filter === 'shared') return mark.shared;
    return mark.interest;
  });
}
