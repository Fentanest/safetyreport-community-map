import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLUSTER_LEVEL, createKakaoMap, densityClusterSize, densityDiameter, densityPinGeometry, type KakaoPointInput } from '../../src/lib/kakao';

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
    label: `지점 ${i}`, kind: 'count' as const, num: count, den: 0, weight: count, selected: i === 0,
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
    expect(bubble.opts.title).toContain('서로 다른 주소');
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

/** R1 (2026-10-13): density pins (색=수용률, 크기/숫자=신고 건수) go through the SAME Marker/MarkerImage/Size/Point
 *  wiring as the count/rate pins above, just with their own SVG + size. This exercises the actual render() branch
 *  inside createKakaoMap (not just the pure svg/geometry helpers tested in mapDensityPins.test.ts). */
const densityPts = (reportCounts: number[]): KakaoPointInput[] =>
  reportCounts.map((n, i) => ({
    key: `d${i}`, lat: 37.5 + i * 0.002, lng: 127.0 + i * 0.002, label: `밀집 지점 ${i}`,
    kind: 'density' as const, num: Math.round(n / 2), den: n, weight: n, selected: i === 0,
  }));

describe('kakao map wiring (fake SDK) — R1 density pins', () => {
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
    vi.stubEnv('VITE_KAKAO_MAP_JS_KEY', 'fixture-key');
  });

  it('exact-zoom density pin: text is the report count, size follows densityDiameter, selected gets its own offset', async () => {
    env = installFakeKakao(levelHolder, idleCbs);
    const host = {} as HTMLElement;
    const handle = await createKakaoMap(host, { onSelect: () => {} });
    levelHolder.level = CLUSTER_LEVEL - 1; // exact-coordinate markers, no clustering
    handle.setPoints(densityPts([37])); // one single point, report_count 37 -> 38px step
    expect(env.markers).toHaveLength(1);
    const m = env.markers[0];
    expect(m.opts.image.src).toContain('%3E37%3C'); // pin number = report count (37), never a %
    expect(m.opts.image.src).not.toContain('%25%3C'); // never a '%' pin
    const size = densityPinGeometry(densityDiameter(37), true).size;
    expect((m.opts.image as unknown as { size: { w: number; h: number } }).size).toEqual({ w: size, h: size });
    handle.destroy();
  });

  it('far-zoom density cluster: number is Σreport_count, sized via densityClusterSize, never the node count', async () => {
    env = installFakeKakao(levelHolder, idleCbs);
    const handle = await createKakaoMap({} as HTMLElement, { onSelect: () => {} });
    handle.setPoints(densityPts([3, 4, 5])); // far zoom (level 13) -> one cluster, Σ=12
    expect(env.markers).toHaveLength(1);
    const bubble = env.markers[0];
    expect(bubble.opts.image.src).toContain('%3E12%3C');
    const size = densityClusterSize(densityDiameter(12));
    expect((bubble.opts.image as unknown as { size: { w: number; h: number } }).size).toEqual({ w: size, h: size });
    handle.destroy();
  });
});
