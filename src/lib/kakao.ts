/**
 * Kakao Maps Web SDK adapter (owned by Muse UI worktree).
 * - SDK single-load with timeout; no invented classes (no fake Heatmap/Dark layer).
 * - Markers only; low-zoom points are labelled as aggregated display.
 * - Attribution/logo must never be covered by floating panels (CSS keeps corners clear).
 * - Without VITE_KAKAO_MAP_JS_KEY the caller renders the failure card + point list.
 */

export interface KakaoPointInput {
  key: string;
  lat: number;
  lng: number;
  label: string;
  count: number;
  selected: boolean;
  metricValue: number | null;
}

export interface KakaoHandle {
  setPoints(points: KakaoPointInput[]): void;
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

function markerDataUrl(count: number, selected: boolean, ratio: number | null): string {
  const size = 40;
  const clamped = ratio == null ? 0.35 : Math.max(0.12, Math.min(1, ratio));
  const r = Math.round(13 + 109 * (1 - clamped));
  const g = Math.round(110 + 70 * clamped);
  const b = 253;
  const ring = selected ? '#F8FAFC' : 'rgba(248,250,252,0.55)';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">`
    + `<circle cx="20" cy="20" r="16" fill="rgba(${r},${g},${b},0.92)" stroke="${ring}" stroke-width="${selected ? 3 : 1.5}"/>`
    + `<text x="20" y="24" text-anchor="middle" font-size="11" font-weight="700" fill="#0B1220" font-family="system-ui">${count > 999 ? '999+' : String(count)}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export async function createKakaoMap(
  el: HTMLElement,
  opts: { onSelect(key: string): void; onIdle?(bounds: [number, number, number, number]): void },
): Promise<KakaoHandle> {
  const key = kakaoKey();
  if (!key) throw new Error('Kakao JavaScript 키가 설정되지 않았습니다.');
  await loadSdk(key);
  const kakao = window.kakao!.maps;
  const center = new kakao.LatLng(36.35, 127.9);
  const map = new kakao.Map(el, { center, level: 13 });
  let markers: KakaoMarkerInstance[] = [];
  let disposed = false;

  const onIdle = () => {
    if (disposed || !opts.onIdle) return;
    try {
      const b = map.getBounds();
      const sw = b.getSouthWest();
      const ne = b.getNorthEast();
      opts.onIdle([sw.getLng(), sw.getLat(), ne.getLng(), ne.getLat()]);
    } catch {
      /* bounds unavailable — ignore */
    }
  };
  kakao.event.addListener(map, 'idle', onIdle);
  onIdle();

  return {
    setPoints(points: KakaoPointInput[]) {
      if (disposed) return;
      for (const m of markers) m.setMap(null);
      markers = [];
      const max = Math.max(1, ...points.map((p) => p.count));
      for (const p of points) {
        const pos = new kakao.LatLng(p.lat, p.lng);
        const img = new kakao.MarkerImage(
          markerDataUrl(p.count, p.selected, p.metricValue ?? p.count / max),
          new kakao.Size(40, 40),
        );
        const marker = new kakao.Marker({ position: pos, image: img, title: p.label });
        kakao.event.addListener(marker, 'click', () => opts.onSelect(p.key));
        marker.setMap(map);
        markers.push(marker);
      }
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
    },
  };
}
