/**
 * Kakao Maps Web SDK adapter (owned by Muse UI worktree).
 * - SDK single-load with timeout; no invented classes (no fake Heatmap/Dark layer).
 * - Client-side grid clustering at far zoom: nearby markers collapse into one
 *   bubble whose number is the SUM of the members' display counts (report or
 *   completion counts for the active metric), never the marker node count.
 *   Zooming in splits clusters back into exact-coordinate markers.
 *   Why not kakao.maps.MarkerClusterer: its documented `texts`/`calculator`
 *   callbacks receive only the member-node count, so a summed-count bubble is
 *   impossible with it. Clustering here uses only documented SDK primitives
 *   (Marker/MarkerImage/LatLng/LatLngBounds/event), exact source coordinates
 *   are never moved, and a cluster centroid is display-only.
 * - Attribution/logo must never be covered by floating panels (CSS keeps corners clear).
 * - Without VITE_KAKAO_MAP_JS_KEY the caller renders the failure card + point list.
 * - Boundary polygons (docs/region-boundaries.md) sit under the markers; they are display only.
 */
import type { BoundaryFeature } from './boundaries';

export interface BoundaryStyle {
  /** the region currently used as a filter (thick outline) */
  selected: string | null;
  /** 0..1 colour scalar of the ACTIVE metric per code; null = the code has rows but no denominator;
   *  missing = no data for the code (drawn almost clear) */
  weight: Map<string, number | null>;
}

/**
 * One drawable place for the active metric (R03). Display value and colour input are separate:
 * - kind 'count': `num` = the count, `den` = 0; colour scalar = count on the metric's count scale;
 * - kind 'rate':  `num`/`den` = numerator/denominator; value = num/den (0..1) — never a 0..100 number;
 *   den 0 → no value (grey '–'), which is different from a real 0%.
 * `weight` (> 0) decides whether the place is drawn at all and sizes cluster sums.
 */
export interface KakaoPointInput {
  key: string;
  lat: number;
  lng: number;
  label: string;
  kind: 'count' | 'rate';
  num: number;
  den: number;
  weight: number;
  selected: boolean;
  /** personal display marks (docs/personal-comparison.md §5.3); display only */
  mine?: boolean;
  shared?: boolean;
  interest?: boolean;
}

/** Text drawn on a pin/cluster: a count, or a whole percent for a rate, or '–' without a denominator. */
export function pinText(kind: 'count' | 'rate', num: number, den: number): string {
  if (kind === 'count') return num > 9999 ? '9999+' : String(num);
  if (den <= 0) return '–';
  return `${Math.round((num / den) * 100)}%`;
}

/** Colour scalar (0..1) or null (no denominator). Counts use a log scale against `maxCount`. */
export function colorScalar(kind: 'count' | 'rate', num: number, den: number, maxCount: number): number | null {
  if (kind === 'rate') return den > 0 ? Math.max(0, Math.min(1, num / den)) : null;
  if (num <= 0) return 0;
  return Math.max(0, Math.min(1, Math.log1p(num) / Math.log1p(Math.max(1, maxCount))));
}

/** Fixed sequential ramp (light → deep blue); the same stops as the CSS legend (--metric-0 … --metric-4). */
export const METRIC_RAMP = ['#e0f2fe', '#7dd3fc', '#38bdf8', '#2563eb', '#1e3a8a'] as const;
export const METRIC_NULL = '#9ca3af';
export function rampColor(t: number | null): string {
  if (t === null) return METRIC_NULL;
  const x = Math.max(0, Math.min(1, t)) * (METRIC_RAMP.length - 1);
  const i = Math.min(METRIC_RAMP.length - 2, Math.floor(x));
  const f = x - i;
  const a = METRIC_RAMP[i], b = METRIC_RAMP[i + 1];
  const ch = (h: string, k: number) => parseInt(h.slice(1 + k * 2, 3 + k * 2), 16);
  const mix = [0, 1, 2].map(k => Math.round(ch(a, k) + (ch(b, k) - ch(a, k)) * f));
  return `#${mix.map(v => v.toString(16).padStart(2, '0')).join('')}`;
}
const inkFor = (t: number | null) => (t !== null && t > 0.6 ? '#FFFFFF' : '#0B1220');

/**
 * Client-side grid clustering (pure; unit-tested without the SDK).
 * - `level` is the Kakao map level (1 = closest, 14 = farthest).
 * - Far zoom (level >= CLUSTER_LEVEL) groups points that fall in the same
 *   lat/lng cell; zooming in (level < CLUSTER_LEVEL) always returns singles
 *   at their exact coordinates.
 * - A group only becomes a cluster with >= MIN_CLUSTER_SIZE members;
 *   lone points stay exact markers at every zoom.
 * - `count` of a cluster is the SUM of member display counts, never the node
 *   count. Members with count <= 0 are dropped (no 0-circles).
 * - Cluster lat/lng is the member mean and is display-only; source
 *   coordinates in `members` are untouched.
 */
export const CLUSTER_LEVEL = 8;
/** grid cell in degrees at the nationwide level 13 (~60px on a 640px+ map). Halves per zoom-in level. */
export const CLUSTER_CELL_DEG_AT_13 = 0.35;
export const MIN_CLUSTER_SIZE = 2;

export function clusterCellDeg(level: number): number {
  return CLUSTER_CELL_DEG_AT_13 * 2 ** (level - 13);
}

export type ClusterGroup =
  | { kind: 'single'; point: KakaoPointInput }
  /** num/den are the SUMS of the members' numerators/denominators (a rate is Σnum/Σden, never a mean of rates);
   *  weight is the summed display weight; places = number of member places */
  | { kind: 'cluster'; members: KakaoPointInput[]; lat: number; lng: number; count: number; num: number; den: number; places: number };

export function clusterPoints(points: readonly KakaoPointInput[], level: number): ClusterGroup[] {
  const live = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && p.weight > 0);
  if (level < CLUSTER_LEVEL) return live.map((point) => ({ kind: 'single', point }));
  const cell = clusterCellDeg(level);
  const cells = new Map<string, KakaoPointInput[]>();
  for (const p of live) {
    const key = `${Math.floor(p.lat / cell)}:${Math.floor(p.lng / cell)}`;
    const list = cells.get(key);
    if (list) list.push(p);
    else cells.set(key, [p]);
  }
  const out: ClusterGroup[] = [];
  for (const members of cells.values()) {
    if (members.length < MIN_CLUSTER_SIZE) {
      for (const point of members) out.push({ kind: 'single', point });
      continue;
    }
    let lat = 0;
    let lng = 0;
    let count = 0;
    let num = 0;
    let den = 0;
    for (const m of members) {
      lat += m.lat;
      lng += m.lng;
      count += m.weight;
      num += m.num;
      den += m.den;
    }
    out.push({ kind: 'cluster', members, lat: lat / members.length, lng: lng / members.length, count, num, den, places: members.length });
  }
  return out;
}

export interface KakaoHandle {
  setPoints(points: KakaoPointInput[]): void;
  /** replace the boundary layer (null clears it) */
  setBoundaries(features: BoundaryFeature[] | null, style: BoundaryStyle): void;
  /** move to a region without it counting as a user map move (auto-refresh ignores it) */
  fitBounds(bbox: [number, number, number, number]): void;
  relayout(): void;
  reset(): void;
  zoomIn(): void;
  zoomOut(): void;
  destroy(): void;
  onIdle?: (bounds: { sw: { lat: number; lng: number }; ne: { lat: number; lng: number } }) => void;
}

declare global {
  interface Window {
    kakao?: {
      maps: {
        load(cb: () => void): void;
        LatLng: new (lat: number, lng: number) => unknown;
        Map: new (el: HTMLElement, opts: unknown) => KakaoMapInstance;
        Marker: new (opts: unknown) => KakaoMarkerInstance;
        MarkerImage: new (src: string, size: unknown, opts?: unknown) => unknown;
        Polygon: new (opts: unknown) => KakaoPolygonInstance;
        LatLngBounds: new (sw?: unknown, ne?: unknown) => unknown;
        Size: new (w: number, h: number) => unknown;
        event: { addListener(obj: unknown, type: string, cb: () => void): void; removeListener(obj: unknown, type: string, cb: () => void): void };
      };
    };
  }
}

interface KakaoMapInstance {
  setCenter(p: unknown): void;
  getCenter(): unknown;
  setLevel(l: number, opts?: unknown): void;
  getLevel(): number;
  getBounds(): { getSouthWest(): { getLat(): number; getLng(): number }; getNorthEast(): { getLat(): number; getLng(): number } };
  relayout(): void;
  setBounds(bounds: unknown, top?: number, right?: number, bottom?: number, left?: number): void;
}

interface KakaoPolygonInstance {
  setMap(m: KakaoMapInstance | null): void;
  setOptions(opts: unknown): void;
}

interface KakaoMarkerInstance {
  setMap(m: KakaoMapInstance | null): void;
  getPosition?(): unknown;
}

let sdkPromise: Promise<void> | null = null;

export function kakaoKey(): string {
  return (import.meta.env.VITE_KAKAO_MAP_JS_KEY as string | undefined)?.trim() ?? '';
}

function loadSdk(key: string): Promise<void> {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise<void>((resolve, reject) => {
    if (window.kakao?.maps) {
      window.kakao.maps.load(() => resolve());
      return;
    }
    const timer = window.setTimeout(() => reject(new Error('Kakao SDK 로딩 시간이 초과되었습니다.')), 12000);
    const script = document.querySelector<HTMLScriptElement>('script[data-cm-kakao]');
    const done = () => {
      window.clearTimeout(timer);
      if (!window.kakao?.maps) {
        reject(new Error('Kakao SDK를 초기화할 수 없습니다.'));
        return;
      }
      window.kakao.maps.load(() => resolve());
    };
    if (script) {
      script.addEventListener('load', done, { once: true });
      script.addEventListener('error', () => {
        window.clearTimeout(timer);
        reject(new Error('Kakao SDK 스크립트를 불러오지 못했습니다.'));
      }, { once: true });
      return;
    }
    const el = document.createElement('script');
    el.dataset.cmKakao = '1';
    el.async = true;
    el.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(key)}&autoload=false&libraries=clusterer`;
    el.addEventListener('load', done, { once: true });
    el.addEventListener('error', () => {
      window.clearTimeout(timer);
      reject(new Error('Kakao SDK 스크립트를 불러오지 못했습니다.'));
    }, { once: true });
    document.head.appendChild(el);
  });
  sdkPromise.catch(() => {
    sdkPromise = null;
    document.querySelector('script[data-cm-kakao]')?.remove();
  });
  return sdkPromise;
}

function cssVar(name: string, fallback: string): string {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch {
    return fallback;
  }
}

interface MarkColors { mineInk: string; cyan: string; partial: string }

/** Token colors for personal marks, read once per render pass (not per marker). */
function markColors(): MarkColors {
  return { mineInk: cssVar('--brand-ink', '#60a5fa'), cyan: cssVar('--cyan', '#06B6D4'), partial: cssVar('--partial', '#F59E0B') };
}

/** Place pin: fill = ramp(scalar), grey dashed when there is no denominator; the text is the metric value. */
export function markerSvg(text: string, selected: boolean, scalar: number | null, colors: MarkColors, mark?: { mine?: boolean; shared?: boolean; interest?: boolean }): string {
  const size = 40;
  const fill = rampColor(scalar);
  const { mineInk, cyan, partial } = colors;
  const ring = selected ? '#0B1220' : 'rgba(11,18,32,0.55)';
  const fontSize = text.length >= 4 ? 10 : 11;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">`
    + (mark?.shared ? `<circle cx="20" cy="20" r="19" fill="none" stroke="${cyan}" stroke-width="1.5" stroke-dasharray="3 2"/>` : '')
    + `<circle cx="20" cy="20" r="16" fill="${fill}" fill-opacity="0.95" stroke="${mark?.mine ? mineInk : ring}" stroke-width="${selected ? 3.5 : mark?.mine ? 2.5 : 1.25}"${scalar === null ? ' stroke-dasharray="3 2"' : ''}/>`
    + (mark?.interest ? `<text x="33" y="10" font-size="10" fill="${partial}">★</text>` : '')
    + `<text x="20" y="24" text-anchor="middle" font-size="${fontSize}" font-weight="700" fill="${inkFor(scalar)}" font-family="system-ui">${text}</text></svg>`;
}
const svgUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/** Cluster bubble: larger than a pin with a double ring so aggregates never read as one address. */
export function clusterSvg(text: string, hasSelected: boolean, scalar: number | null): string {
  const size = 52;
  const fill = rampColor(scalar);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">`
    + `<circle cx="26" cy="26" r="22" fill="${fill}" fill-opacity="0.96" stroke="#F8FAFC" stroke-width="${hasSelected ? 4 : 3}"/>`
    + `<circle cx="26" cy="26" r="17" fill="none" stroke="rgba(11,18,32,0.4)" stroke-width="1" stroke-dasharray="3 2"/>`
    + `<text x="26" y="31" text-anchor="middle" font-size="${text.length >= 5 ? 11 : 13}" font-weight="800" fill="${inkFor(scalar)}" font-family="system-ui">${text}</text></svg>`;
}

export async function createKakaoMap(
  el: HTMLElement,
  opts: {
    onSelect(key: string): void;
    /** `user` is true only for moves the user made (drag, wheel, zoom buttons); map creation, fitBounds and
     *  relayout are programmatic and never feed the statistics scope (R04 §5) */
    onIdle?(bounds: [number, number, number, number], zoom: number, user: boolean): void;
    onRegionHover?(code: string | null): void;
    onRegionClick?(code: string): void;
  },
): Promise<KakaoHandle> {
  const key = kakaoKey();
  if (!key) throw new Error('Kakao JavaScript 키가 설정되지 않았습니다.');
  await loadSdk(key);
  const kakao = window.kakao!.maps;
  const center = new kakao.LatLng(36.35, 127.9);
  const map = new kakao.Map(el, { center, level: 13 });
  let markers: KakaoMarkerInstance[] = [];
  let shapes: Array<{ code: string; polygons: KakaoPolygonInstance[] }> = [];
  let disposed = false;
  // the first idle after creation is the SDK settling, not a user move
  let programmatic = true;
  let hovered: string | null = null;
  let boundaryStyle: BoundaryStyle = { selected: null, weight: new Map() };
  let lastInputs: KakaoPointInput[] = [];
  let lastLevel = 13;

  const clearMarkers = () => {
    for (const m of markers) {
      try {
        m.setMap(null);
      } catch {
        /* ignore */
      }
    }
    markers = [];
  };

  /** Draw singles at exact coordinates and far-zoom clusters with summed counts. */
  const render = () => {
    if (disposed) return;
    clearMarkers();
    let level = lastLevel;
    try {
      level = map.getLevel();
      lastLevel = level;
    } catch {
      /* keep last known level */
    }
    const groups = clusterPoints(lastInputs, level);
    // count scale: the largest drawn value at this zoom (clusters included), so colours stay comparable on screen
    const maxCount = Math.max(1, ...groups.map((g) => (g.kind === 'single' ? g.point.num : g.num)));
    const colors = markColors();
    for (const g of groups) {
      if (g.kind === 'single') {
        const p = g.point;
        const pos = new kakao.LatLng(p.lat, p.lng);
        const img = new kakao.MarkerImage(
          svgUrl(markerSvg(pinText(p.kind, p.num, p.den), p.selected, colorScalar(p.kind, p.num, p.den, maxCount), colors, p)),
          new kakao.Size(40, 40),
        );
        const marker = new kakao.Marker({ position: pos, image: img, title: p.label });
        kakao.event.addListener(marker, 'click', () => opts.onSelect(p.key));
        marker.setMap(map);
        markers.push(marker);
        continue;
      }
      // Cluster bubble: counts are SUMS; a rate is Σnumerator/Σdenominator of the member places (F01).
      // Position is the member mean, display-only; member positions stay as they are.
      const kind = g.members[0].kind;
      const text = pinText(kind, g.num, g.den);
      const pos = new kakao.LatLng(g.lat, g.lng);
      const img = new kakao.MarkerImage(
        svgUrl(clusterSvg(text, g.members.some((m) => m.selected), colorScalar(kind, g.num, g.den, maxCount))),
        new kakao.Size(52, 52),
      );
      const marker = new kakao.Marker({
        position: pos,
        image: img,
        title: kind === 'count'
          ? `서로 다른 주소 ${g.places.toLocaleString('ko-KR')}곳 묶음 · 합계 ${g.num.toLocaleString('ko-KR')}건 (눌러서 확대)`
          : `서로 다른 주소 ${g.places.toLocaleString('ko-KR')}곳 묶음 · ${text} (${g.num.toLocaleString('ko-KR')}/${g.den.toLocaleString('ko-KR')}건, 눌러서 확대)`,
      });
      kakao.event.addListener(marker, 'click', () => zoomToMembers(g.members, g.lat, g.lng));
      marker.setMap(map);
      markers.push(marker);
    }
  };

  /** User-initiated zoom to a cluster's members (a real user move, so no programmatic flag). */
  const zoomToMembers = (members: KakaoPointInput[], lat: number, lng: number) => {
    if (disposed) return;
    try {
      let w = Infinity;
      let s = Infinity;
      let e = -Infinity;
      let n = -Infinity;
      for (const m of members) {
        if (m.lng < w) w = m.lng;
        if (m.lat < s) s = m.lat;
        if (m.lng > e) e = m.lng;
        if (m.lat > n) n = m.lat;
      }
      if (!Number.isFinite(w) || (w === e && s === n)) {
        map.setCenter(new kakao.LatLng(lat, lng));
        map.setLevel(Math.max(1, map.getLevel() - 2));
        return;
      }
      const pad = 0.002;
      map.setBounds(
        new kakao.LatLngBounds(new kakao.LatLng(s - pad, w - pad), new kakao.LatLng(n + pad, e + pad)),
        80, 80, 80, 80,
      );
    } catch {
      /* map move unavailable — ignore */
    }
  };

  const onIdle = () => {
    if (disposed) return;
    // Re-cluster when the zoom level changed (grid cells depend on the level only).
    try {
      const level = map.getLevel();
      if (level !== lastLevel) {
        lastLevel = level;
        render();
      }
    } catch {
      /* level unavailable — ignore */
    }
    if (!opts.onIdle) return;
    const user = !programmatic;
    programmatic = false;
    try {
      const b = map.getBounds();
      const sw = b.getSouthWest();
      const ne = b.getNorthEast();
      opts.onIdle([sw.getLng(), sw.getLat(), ne.getLng(), ne.getLat()], map.getLevel(), user);
    } catch {
      /* bounds unavailable — ignore */
    }
  };

  const shapeOptions = (code: string) => {
    const has = boundaryStyle.weight.has(code);
    const w = boundaryStyle.weight.get(code) ?? null;
    const selected = boundaryStyle.selected === code;
    const hover = hovered === code;
    // The Kakao base map is light in both app themes, so outlines use fixed dark-enough colors, not theme tokens.
    // Fill follows the ACTIVE metric's colour ramp (R03-6): no rows → almost clear; rows without a denominator
    // → neutral grey; otherwise the same ramp as the pins.
    return {
      strokeWeight: selected ? 3 : hover ? 2.5 : 1.5,
      strokeColor: selected ? '#D97706' : '#1D4ED8',
      strokeOpacity: selected || hover ? 0.95 : 0.7,
      fillColor: has ? rampColor(w) : '#2563EB',
      fillOpacity: (!has ? 0.02 : w === null ? 0.18 : 0.22 + 0.3 * w) + (hover ? 0.12 : 0),
    };
  };
  const restyle = (code: string) => {
    const shape = shapes.find((x) => x.code === code);
    if (shape) for (const polygon of shape.polygons) polygon.setOptions(shapeOptions(code));
  };
  const clearShapes = () => {
    for (const shape of shapes) for (const polygon of shape.polygons) {
      try { polygon.setMap(null); } catch { /* ignore */ }
    }
    shapes = [];
  };
  kakao.event.addListener(map, 'idle', onIdle);
  onIdle();

  return {
    setPoints(points: KakaoPointInput[]) {
      if (disposed) return;
      lastInputs = points;
      render();
    },
    setBoundaries(features: BoundaryFeature[] | null, style: BoundaryStyle) {
      if (disposed) return;
      const same = features && shapes.length === features.length && shapes.every((x, i) => x.code === features[i].code);
      boundaryStyle = style;
      if (same) {
        for (const shape of shapes) restyle(shape.code);
        return;
      }
      clearShapes();
      hovered = null;
      for (const f of features ?? []) {
        const polygons = f.polygons.map((rings) => {
          const polygon = new kakao.Polygon({
            map, zIndex: 1,
            path: rings.map((ring) => ring.map(([lng, lat]) => new kakao.LatLng(lat, lng))),
            ...shapeOptions(f.code),
          });
          kakao.event.addListener(polygon, 'mouseover', () => {
            const before = hovered;
            hovered = f.code;
            if (before && before !== f.code) restyle(before);
            restyle(f.code);
            opts.onRegionHover?.(f.code);
          });
          kakao.event.addListener(polygon, 'mouseout', () => {
            if (hovered !== f.code) return;
            hovered = null;
            restyle(f.code);
            opts.onRegionHover?.(null);
          });
          kakao.event.addListener(polygon, 'click', () => opts.onRegionClick?.(f.code));
          return polygon;
        });
        shapes.push({ code: f.code, polygons });
      }
    },
    fitBounds([w, s, e, n]) {
      if (disposed) return;
      programmatic = true;
      // if the map does not actually move no idle fires; don't let the flag swallow the next user move
      window.setTimeout(() => { programmatic = false; }, 1500);
      map.setBounds(new kakao.LatLngBounds(new kakao.LatLng(s, w), new kakao.LatLng(n, e)), 24, 24, 24, 24);
    },
    relayout() {
      try {
        // a size change may emit idle; it is not a user move
        programmatic = true;
        window.setTimeout(() => { programmatic = false; }, 600);
        map.relayout();
      } catch {
        /* ignore */
      }
    },
    reset() {
      map.setCenter(center);
      map.setLevel(13);
    },
    zoomIn() {
      map.setLevel(Math.max(1, map.getLevel() - 1));
    },
    zoomOut() {
      map.setLevel(Math.min(14, map.getLevel() + 1));
    },
    destroy() {
      disposed = true;
      kakao.event.removeListener(map, 'idle', onIdle);
      clearMarkers();
      lastInputs = [];
      clearShapes();
    },
  };
}
