/**
 * Kakao Maps Web SDK adapter (owned by Muse UI worktree).
 * - SDK single-load with timeout; no invented classes (no fake Heatmap/Dark layer).
 * - Markers only; low-zoom points are labelled as aggregated display.
 * - Attribution/logo must never be covered by floating panels (CSS keeps corners clear).
 * - Without VITE_KAKAO_MAP_JS_KEY the caller renders the failure card + point list.
 * - Boundary polygons (docs/region-boundaries.md) sit under the markers; they are display only.
 */
import type { BoundaryFeature } from './boundaries';

export interface BoundaryStyle {
  /** the region currently used as a filter (thick outline) */
  selected: string | null;
  /** 0..1 fill strength per code (share of the largest report count shown); missing = no data */
  weight: Map<string, number>;
}

export interface KakaoPointInput {
  key: string;
  lat: number;
  lng: number;
  label: string;
  count: number;
  selected: boolean;
  metricValue: number | null;
  /** personal display marks (docs/personal-comparison.md §5.3); display only */
  mine?: boolean;
  shared?: boolean;
  interest?: boolean;
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

function markerDataUrl(count: number, selected: boolean, ratio: number | null, colors: MarkColors, mark?: { mine?: boolean; shared?: boolean; interest?: boolean }): string {
  const size = 40;
  const clamped = ratio == null ? 0.35 : Math.max(0.12, Math.min(1, ratio));
  const r = Math.round(13 + 109 * (1 - clamped));
  const g = Math.round(110 + 70 * clamped);
  const b = 253;
  const { mineInk, cyan, partial } = colors;
  const ring = selected ? '#F8FAFC' : 'rgba(248,250,252,0.55)';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">`
    + (mark?.shared ? `<circle cx="20" cy="20" r="19" fill="none" stroke="${cyan}" stroke-width="1.5" stroke-dasharray="3 2"/>` : '')
    + `<circle cx="20" cy="20" r="16" fill="rgba(${r},${g},${b},0.92)" stroke="${mark?.mine ? mineInk : ring}" stroke-width="${selected ? 3 : mark?.mine ? 2.5 : 1.5}"/>`
    + (mark?.interest ? `<text x="33" y="10" font-size="10" fill="${partial}">★</text>` : '')
    + `<text x="20" y="24" text-anchor="middle" font-size="11" font-weight="700" fill="#0B1220" font-family="system-ui">${count > 999 ? '999+' : String(count)}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export async function createKakaoMap(
  el: HTMLElement,
  opts: {
    onSelect(key: string): void;
    /** `programmatic` is true for moves made by fitBounds (not by the user) */
    onIdle?(bounds: [number, number, number, number], zoom: number, programmatic: boolean): void;
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
  let programmatic = false;
  let hovered: string | null = null;
  let boundaryStyle: BoundaryStyle = { selected: null, weight: new Map() };

  const onIdle = () => {
    if (disposed || !opts.onIdle) return;
    const moved = programmatic;
    programmatic = false;
    try {
      const b = map.getBounds();
      const sw = b.getSouthWest();
      const ne = b.getNorthEast();
      opts.onIdle([sw.getLng(), sw.getLat(), ne.getLng(), ne.getLat()], map.getLevel(), moved);
    } catch {
      /* bounds unavailable — ignore */
    }
  };

  const shapeOptions = (code: string) => {
    const w = boundaryStyle.weight.get(code);
    const selected = boundaryStyle.selected === code;
    const hover = hovered === code;
    // The Kakao base map is light in both app themes, so outlines use fixed dark-enough colors, not theme tokens.
    return {
      strokeWeight: selected ? 3 : hover ? 2.5 : 1.5,
      strokeColor: selected ? '#D97706' : '#1D4ED8',
      strokeOpacity: selected || hover ? 0.95 : 0.7,
      fillColor: '#2563EB',
      // no data → almost clear (never looks like a low value); data → 0.08..0.38 by share
      fillOpacity: (w == null ? 0.02 : 0.08 + 0.3 * Math.max(0, Math.min(1, w))) + (hover ? 0.12 : 0),
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
      for (const m of markers) m.setMap(null);
      markers = [];
      const max = Math.max(1, ...points.map((p) => p.count));
      const colors = markColors();
      for (const p of points) {
        const pos = new kakao.LatLng(p.lat, p.lng);
        const img = new kakao.MarkerImage(
          markerDataUrl(p.count, p.selected, p.metricValue ?? p.count / max, colors, p),
          new kakao.Size(40, 40),
        );
        const marker = new kakao.Marker({ position: pos, image: img, title: p.label });
        kakao.event.addListener(marker, 'click', () => opts.onSelect(p.key));
        marker.setMap(map);
        markers.push(marker);
      }
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
      for (const m of markers) {
        try {
          m.setMap(null);
        } catch {
          /* ignore */
        }
      }
      markers = [];
      clearShapes();
    },
  };
}
