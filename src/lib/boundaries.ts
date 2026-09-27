/**
 * Administrative boundary layer data (docs/region-boundaries.md): public/boundaries/v20260701/{sido,sgg}.topo.json.
 * Loaded lazily, only when the map shows boundaries; a failure here never affects markers or statistics.
 * Display only — statistics are grouped on the server by official code, never by these simplified shapes.
 */

export type BoundaryLevel = 'sido' | 'sgg';
type Position = [number, number];
export interface BoundaryFeature {
  /** 2-digit 시도 or 5-digit 시군구 code (2026-07-01) */
  code: string;
  sido: string;
  /** polygons → rings (first ring outer) → [lng, lat] */
  polygons: Position[][][];
  bbox: [number, number, number, number];
}
export interface BoundaryMeta { version: string; attribution: string }

interface Topology {
  type: 'Topology';
  transform?: { scale: [number, number]; translate: [number, number] };
  arcs: number[][][];
  objects: Record<string, { type: 'GeometryCollection'; geometries: TopoGeometry[] }>;
}
type TopoGeometry =
  | { type: 'Polygon'; arcs: number[][]; properties: Record<string, string> }
  | { type: 'MultiPolygon'; arcs: number[][][]; properties: Record<string, string> }
  | { type: null; properties?: Record<string, string> };

export const BOUNDARY_VERSION = 'v20260701';
/** Extra display simplification per level, in degrees (arcs are shared, so neighbours stay seamless). */
const TOLERANCE: Record<BoundaryLevel, number> = { sido: 0.004, sgg: 0.0012 };

function sqSegDist(p: Position, a: Position, b: Position): number {
  let [x, y] = a;
  let dx = b[0] - x, dy = b[1] - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) { x = b[0]; y = b[1]; } else if (t > 0) { x += dx * t; y += dy * t; }
  }
  dx = p[0] - x; dy = p[1] - y;
  return dx * dx + dy * dy;
}

/** Douglas–Peucker keeping both ends; a closed arc is split at its farthest point first. */
export function simplifyLine(points: Position[], tolerance: number): Position[] {
  if (points.length <= 2 || tolerance <= 0) return points;
  const first = points[0], last = points[points.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) {
    let far = 1, best = -1;
    for (let i = 1; i < points.length - 1; i++) {
      const d = (points[i][0] - first[0]) ** 2 + (points[i][1] - first[1]) ** 2;
      if (d > best) { best = d; far = i; }
    }
    const a = simplifyLine(points.slice(0, far + 1), tolerance);
    const b = simplifyLine(points.slice(far), tolerance);
    return [...a, ...b.slice(1)];
  }
  const sq = tolerance * tolerance;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let index = -1, max = sq;
    for (let i = s + 1; i < e; i++) {
      const d = sqSegDist(points[i], points[s], points[e]);
      if (d > max) { max = d; index = i; }
    }
    if (index > 0) { keep[index] = 1; stack.push([s, index], [index, e]); }
  }
  return points.filter((_, i) => keep[i]);
}

/** Decode one TopoJSON object to features with display simplification. Pure; tested without a browser. */
export function decodeTopology(topo: Topology, name: BoundaryLevel, tolerance = TOLERANCE[name]): BoundaryFeature[] {
  const object = topo.objects[name];
  if (topo.type !== 'Topology' || !object || object.type !== 'GeometryCollection') throw new Error('bad topology');
  const t = topo.transform;
  const raw: Position[][] = topo.arcs.map((arc) => {
    let x = 0, y = 0;
    return arc.map(([a, b]): Position => {
      if (!t) return [a, b];
      x += a; y += b;
      return [x * t.scale[0] + t.translate[0], y * t.scale[1] + t.translate[1]];
    });
  });
  const simple = tolerance > 0 ? raw.map((line) => simplifyLine(line, tolerance)) : raw;
  const ring = (indexes: number[], arcs: Position[][]): Position[] => {
    const out: Position[] = [];
    indexes.forEach((i, n) => {
      const arc = i < 0 ? [...arcs[~i]].reverse() : arcs[i];
      out.push(...(n === 0 ? arc : arc.slice(1)));
    });
    return out;
  };
  // A ring that collapsed at display tolerance (tiny island or hole) is dropped; a polygon needs its outer ring.
  const polygon = (rings: number[][], arcs: Position[][]): Position[][] | null => {
    const outer = ring(rings[0], arcs);
    if (outer.length < 4) return null;
    return [outer, ...rings.slice(1).map((r) => ring(r, arcs)).filter((r) => r.length >= 4)];
  };
  const features: BoundaryFeature[] = [];
  for (const g of object.geometries) {
    if (!g.type || !g.properties) continue;
    const code = name === 'sido' ? g.properties.sido : g.properties.code;
    if (!code) continue;
    const parts = g.type === 'Polygon' ? [g.arcs] : g.arcs;
    let polygons = parts.map((rings) => polygon(rings, simple)).filter((x): x is Position[][] => x !== null);
    // never drop a region: if everything collapsed, keep this one at full detail
    if (!polygons.length) polygons = parts.map((rings) => polygon(rings, raw)).filter((x): x is Position[][] => x !== null);
    if (!polygons.length) continue;
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    for (const p of polygons) for (const [lng, lat] of p[0]) {
      if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
    }
    features.push({ code, sido: g.properties.sido ?? code.slice(0, 2), polygons, bbox: [minLng, minLat, maxLng, maxLat] });
  }
  return features;
}

const base = () => `${(import.meta.env.BASE_URL ?? '/').replace(/\/?$/, '/')}boundaries/${BOUNDARY_VERSION}/`;
const cache = new Map<string, Promise<unknown>>();

function fetchJson<T>(file: string): Promise<T> {
  let p = cache.get(file);
  if (!p) {
    p = fetch(base() + file, { credentials: 'omit', referrerPolicy: 'no-referrer' }).then((res) => {
      if (!res.ok) throw new Error(`boundary ${file}: HTTP ${res.status}`);
      return res.json();
    });
    p.catch(() => cache.delete(file)); // a failed load can be retried
    cache.set(file, p);
  }
  return p as Promise<T>;
}

const decoded = new Map<BoundaryLevel, Promise<BoundaryFeature[]>>();
export function loadBoundaries(level: BoundaryLevel): Promise<BoundaryFeature[]> {
  let p = decoded.get(level);
  if (!p) {
    p = fetchJson<Topology>(`${level}.topo.json`).then((topo) => decodeTopology(topo, level));
    p.catch(() => decoded.delete(level));
    decoded.set(level, p);
  }
  return p;
}

export const loadBoundaryMeta = (): Promise<BoundaryMeta> => fetchJson<BoundaryMeta>('meta.json');

export const intersects = (a: readonly number[], b: readonly number[]): boolean =>
  a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
