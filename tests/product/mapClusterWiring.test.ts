import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createKakaoMap, type KakaoPointInput } from '../../src/lib/kakao';

/**
 * SDK wiring test with a minimal fake of the documented Kakao primitives
 * (Map/Marker/MarkerImage/LatLng/LatLngBounds/Size/event). No network, no key.
 */

interface FakeMarker {
  opts: { position: { lat: number; lng: number }; image: { src: string }; title: string };
  mapSet: Array<unknown>;
  handlers: Map<string, () => void>;
}

function installFakeKakao(levelHolder: { level: number }, idleCbs: Array<() => void>) {
  const markers: FakeMarker[] = [];
  const calls = { setBounds: 0, setCenter: 0, setLevel: 0 };
  const latLng = (lat: number, lng: number) => ({ lat, lng, getLat: () => lat, getLng: () => lng });
  const fakeMap = {
    getLevel: () => levelHolder.level,
    setLevel: (l: number) => { calls.setLevel += 1; levelHolder.level = l; },
    setCenter: () => { calls.setCenter += 1; },
    setBounds: () => { calls.setBounds += 1; },
    getBounds: () => ({
      getSouthWest: () => latLng(33, 124),
      getNorthEast: () => latLng(39, 132),
    }),
    relayout: () => {},
  };
  const FakeMarkerCtor = function (this: unknown, opts: FakeMarker['opts']) {
    const m: FakeMarker = { opts, mapSet: [], handlers: new Map() };
    markers.push(m);
    return {
      setMap: (t: unknown) => { m.mapSet.push(t); },
      __fake: m,
    };
  };
  const g = globalThis as Record<string, unknown>;
  const prevWindow = g.window;
  g.window = {
    kakao: {
      maps: {
        load: (cb: () => void) => cb(),
        LatLng: function (this: unknown, lat: number, lng: number) { return latLng(lat, lng); },
        Map: function (this: unknown) { return fakeMap; },
        Marker: FakeMarkerCtor,
        MarkerImage: function (this: unknown, src: string, size: unknown) { return { src, size }; },
        Size: function (this: unknown, w: number, h: number) { return { w, h }; },
        LatLngBounds: function (this: unknown, sw?: unknown, ne?: unknown) { return { sw, ne }; },
        event: {
          addListener: (obj: unknown, type: string, cb: () => void) => {
            if (obj === fakeMap && type === 'idle') idleCbs.push(cb);
            const rec = (obj as { __fake?: FakeMarker })?.__fake;
            if (rec) rec.handlers.set(type, cb);
          },
          removeListener: (_o: unknown, type: string, _c: () => void) => {
            const i = idleCbs.findIndex(() => type === 'idle');
            if (i >= 0) idleCbs.splice(i, 1);
          },
        },
      },
    },
    setTimeout: (cb: () => void) => setTimeout(cb, 0),
    clearTimeout: (t: unknown) => clearTimeout(t as NodeJS.Timeout),
  };
  return {
    markers, calls,
    restore: () => { g.window = prevWindow; },
  };
}

const pts = (counts: number[]): KakaoPointInput[] =>
  counts.map((count, i) => ({
    key: `k${i}`, lat: 37.5 + i * 0.002, lng: 127.0 + i * 0.002,
    label: `지점 ${i}`, count, selected: i === 0, metricValue: null,
  }));

describe('kakao map wiring (fake SDK)', () => {
  const levelHolder = { level: 13 };
  const idleCbs: Array<() => void> = [];
  let env: ReturnType<typeof installFakeKakao> | null = null;

  afterEach(() => {
    env?.restore();
    env = null;
    idleCbs.length = 0;
    levelHolder.level = 13;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    // Fake key only: the SDK itself is faked below, no network or credentials.
    vi.stubEnv('VITE_KAKAO_MAP_JS_KEY', 'fixture-key');
  });

  it('renders one summed cluster bubble at far zoom; click zooms to members', async () => {
    env = installFakeKakao(levelHolder, idleCbs);
    const selected: string[] = [];
    const host = {} as HTMLElement;
    const handle = await createKakaoMap(host, { onSelect: (k) => selected.push(k) });
    handle.setPoints(pts([3, 1, 2]));
    expect(env.markers).toHaveLength(1);
    const bubble = env.markers[0];
    // Bubble number is the SUM (6), not the node count (3). The SVG is URL-encoded.
    expect(bubble.opts.image.src).toContain('%3E6%3C');
    expect(bubble.opts.title).toContain('3곳 묶음');
    bubble.handlers.get('click')!();
    expect(env.calls.setBounds + env.calls.setCenter).toBeGreaterThan(0);
    expect(selected).toHaveLength(0);
    handle.destroy();
  });

  it('splits into exact markers on zoom-in, keeps selection clicks, and cleans up', async () => {
    env = installFakeKakao(levelHolder, idleCbs);
    const selected: string[] = [];
    const host = {} as HTMLElement;
    const handle = await createKakaoMap(host, { onSelect: (k) => selected.push(k) });
    handle.setPoints(pts([3, 1, 2]));
    const before = env.markers.length;
    expect(before).toBe(1);
    // Zoom in -> idle fires -> exact-coordinate markers.
    levelHolder.level = 5;
    for (const cb of [...idleCbs]) cb();
    expect(env.markers.length).toBeGreaterThan(before);
    const live = env.markers.slice(before).filter((m) => m.mapSet.at(-1) !== null);
    expect(live).toHaveLength(3);
    expect(live.map((m) => [m.opts.position.lat, m.opts.position.lng])).toEqual([
      [37.5, 127.0], [37.502, 127.002], [37.504, 127.004],
    ]);
    live[1].handlers.get('click')!();
    expect(selected).toEqual(['k1']);
    // Update with new points replaces old markers; destroy detaches everything.
    handle.setPoints(pts([5]));
    handle.destroy();
    const detached = env.markers.filter((m) => m.mapSet.at(-1) === null);
    expect(detached.length).toBe(env.markers.length);
  });
});
