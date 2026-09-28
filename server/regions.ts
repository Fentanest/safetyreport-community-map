/**
 * Region keys → official 2026-07-01 법정 codes (docs/region-boundaries.md).
 *
 * Facts carry `region_code` = ingest's display key "<시도약칭> <시군구명>" (observation.ts regionCode) and exact
 * coordinates. Statistics are grouped by the CURRENT (2026-07-01) 법정 시군구 code, 5 digits, and its 시도 (2 digits):
 * - explicit table lookup (시도 + 시군구 name), never a string-prefix guess on codes;
 * - 세종 is one unit (36110) whatever the second token (its keys hold a 동/읍/road name);
 * - renamed/moved units follow the official history (인천 남구 → 미추홀구, 경북 군위군 → 대구 군위군, 인천 동구 → 제물포구,
 *   충북 청원군 → 청주시 — shared registry event 2014_cheongju, merge_parent with the single
 *   successor 4311000000: past facts count in today's 청주시 total, never split by ratio);
 * - split districts (인천 중구, 인천 서구) are assigned by the report's own coordinates inside the new districts'
 *   display polygons; without coordinates they stay 지역 미확인 (null) — never distributed by ratio;
 * - anything else unmatched is 지역 미확인 (null) and stays in every total.
 * Policy: past facts are counted in today's units (re-classification is by name/coordinates only, as above).
 */
import regions from '../contracts/regions/regions-20260701.json' with { type: 'json' };

export interface RegionRef { sgg: string; sido: string }
type Ring = number[][];
type Geometry = { type: 'Polygon'; coordinates: Ring[] } | { type: 'MultiPolygon'; coordinates: Ring[][] };

const table = regions as unknown as {
  version: string;
  sido: Array<{ code: string; name: string; short: string }>;
  sgg: Array<{ code: string; sido: string; name: string }>;
  split: Record<string, string[]>;
  renamed: Record<string, string>;
  pip: Array<{ code: string; geometry: Geometry }>;
};

export const REGION_VERSION = table.version;

/** 시도 token (short form used by ingest keys, full name, legacy names) → current 2-digit code. */
const SIDO_TOKEN = new Map<string, string>();
for (const s of table.sido) {
  SIDO_TOKEN.set(s.short, s.code);
  SIDO_TOKEN.set(s.name, s.code);
}
for (const [token, code] of Object.entries({
  광주: '12', 전남: '12', 광주광역시: '12', 전라남도: '12', // merged into 전남광주통합특별시 (2026-07-01)
  강원도: '51', 전라북도: '52', 제주도: '50', 세종시: '36', 서울시: '11', 부산시: '26', 대구시: '27', 인천시: '28',
  대전시: '30', 울산시: '31',
})) SIDO_TOKEN.set(token, code);

const SGG_BY_NAME = new Map(table.sgg.map((s) => [`${s.sido}|${s.name}`, s.code]));
const SGG = new Map(table.sgg.map((s) => [s.code, s]));
const SIDO = new Map(table.sido.map((s) => [s.code, s]));

function inRing(lng: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function inPolygon(lng: number, lat: number, rings: Ring[]): boolean {
  return inRing(lng, lat, rings[0]) && !rings.slice(1).some((hole) => inRing(lng, lat, hole));
}
function contains(geometry: Geometry, lng: number, lat: number): boolean {
  return geometry.type === 'Polygon' ? inPolygon(lng, lat, geometry.coordinates)
    : geometry.coordinates.some((poly) => inPolygon(lng, lat, poly));
}
const PIP = new Map(table.pip.map((p) => [p.code, p.geometry]));

const cache = new Map<string, RegionRef | null>();

/** Resolve a fact's region. `key` is the ingest display key; coordinates only break splits. */
export function resolveRegion(key: string | null, lat: number | null = null, lng: number | null = null): RegionRef | null {
  if (!key) return null;
  const tokens = key.trim().split(/\s+/);
  if (tokens.length < 2) return null;
  const sido = SIDO_TOKEN.get(tokens[0]);
  if (!sido) return null;
  if (sido === '36') return { sgg: '36110', sido: '36' };
  const name = tokens[1];
  const nameKey = `${sido}|${name}`;
  const split = table.split[nameKey];
  if (split) {
    if (lat == null || lng == null) return null;
    const hit = split.find((code) => { const g = PIP.get(code); return g ? contains(g, lng, lat) : false; });
    return hit ? { sgg: hit, sido } : null;
  }
  const cached = cache.get(nameKey);
  if (cached !== undefined) return cached;
  const code = SGG_BY_NAME.get(nameKey) ?? table.renamed[nameKey];
  const ref = code ? { sgg: code, sido: code.slice(0, 2) } : null;
  cache.set(nameKey, ref);
  return ref;
}

/** Official code (2-digit 시도 or 5-digit 시군구) → display name, e.g. '서울 중구', '경기도'. */
export function regionName(code: string): string | null {
  if (code.length === 2) return SIDO.get(code)?.name ?? null;
  const s = SGG.get(code);
  if (!s) return null;
  if (s.sido === '36') return '세종특별자치시';
  return `${SIDO.get(s.sido)?.short ?? ''} ${s.name}`.trim();
}

export function isRegionCode(code: string): boolean {
  return code.length === 2 ? SIDO.has(code) : code.length === 5 ? SGG.has(code) : false;
}

/** Does the resolved region fall inside the selected official code (시도 includes its 시군구)? */
export function regionMatches(ref: RegionRef | null, selected: string): boolean {
  if (!ref) return false;
  return selected.length === 2 ? ref.sido === selected : ref.sgg === selected;
}

/** Convert a legacy display key used in old URLs ('서울 중구') into an official code when unambiguous. */
export function codeForLegacyKey(key: string): string | null {
  if (isRegionCode(key)) return key;
  const ref = resolveRegion(key);
  return ref ? ref.sgg : null;
}
