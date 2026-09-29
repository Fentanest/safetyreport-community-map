import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  CLUSTER_LEVEL, clusterPoints, colorScalar, markerSvg, pinText, rampColor, METRIC_NULL, type KakaoPointInput,
} from '../../src/lib/kakao';
import MapPanel, { pointTitle, toKakaoInputs, visiblePoints } from '../../src/components/MapPanel';
import { metricParts, type MapMetric } from '../../src/components/mapMetrics';
import type { PublicPoint } from '../../src/domain/public';

/**
 * Muse UI tests for map clustering + metric filtering + map-top back control.
 * Pure logic runs without the Kakao SDK; MapPanel markup renders through the
 * no-key fallback list (node has no VITE_KAKAO_MAP_JS_KEY), which mirrors the
 * drawn points.
 */

// Live-issue reproduction shape: 368 point DTO nodes — 312 with report-date
// points and 56 completion-only points (report_count = 0).
function liveLikePoints(): PublicPoint[] {
  const pts: PublicPoint[] = [];
  const hubs: Array<[number, number]> = [[37.56, 126.97], [35.18, 129.07], [37.32, 127.25], [36.35, 127.38]];
  for (let i = 0; i < 312; i++) {
    const [la, ln] = hubs[i % hubs.length];
    pts.push({
      key: `pt-report-${i}`, lat: la + (i % 25) * 0.004, lng: ln + (i % 17) * 0.004,
      address: `예시 지점 ${i}`, region_code: '11',
      report_count: 1 + (i % 4), completed_count: i % 3, outcomes: null, fine_count: i % 2,
    });
  }
  for (let i = 0; i < 56; i++) {
    const [la, ln] = hubs[i % hubs.length];
    pts.push({
      key: `pt-completion-only-${i}`, lat: la + (i % 7) * 0.003, lng: ln + (i % 5) * 0.003,
      address: `완료만 지점 ${i}`, region_code: '26',
      report_count: 0, completed_count: 1 + (i % 2), outcomes: null, fine_count: 0,
    });
  }
  return pts;
}

const toInputs = (pts: PublicPoint[], metric: MapMetric): KakaoPointInput[] => toKakaoInputs(pts, metric, null);

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

describe('client grid clustering (sum bubbles, exact positions)', () => {
  it('clusters far-zoom bubbles by SUM of report counts, never node count or 0', () => {
    const inputs = toInputs(liveLikePoints(), 'reports');
    expect(inputs).toHaveLength(312); // completion-only nodes are not drawn in the report metric
    const groups = clusterPoints(inputs, 13);
    const clusters = groups.filter((g) => g.kind === 'cluster');
    expect(clusters.length).toBeGreaterThan(0);
    expect(groups.length).toBeLessThan(inputs.length);
    for (const g of groups) {
      if (g.kind === 'single') { expect(g.point.num).toBeGreaterThan(0); continue; }
      expect(g.members.length).toBeGreaterThanOrEqual(2);
      expect(g.num).toBe(sum(g.members.map((m) => m.num)));
      expect(g.places).toBe(g.members.length);
    }
    expect(sum(groups.map((g) => (g.kind === 'single' ? g.point.num : g.num)))).toBe(sum(inputs.map((p) => p.num)));
  });

  it('splits into exact markers when zoomed in, leaving sources untouched', () => {
    const pts = liveLikePoints();
    const before = pts.map((p) => [p.lat, p.lng]);
    const inputs = toInputs(pts, 'acceptance');
    const groups = clusterPoints(inputs, CLUSTER_LEVEL - 1);
    expect(groups.every((g) => g.kind === 'single')).toBe(true);
    expect(groups).toHaveLength(inputs.length);
    expect(pts.map((p) => [p.lat, p.lng])).toEqual(before);
  });
});

describe('F01 metric units and weighted clusters (client)', () => {
  const place = (key: string, lat: number, o: [number, number, number], completed: number, fine: number): PublicPoint => ({
    key, lat, lng: 127, address: key, region_code: null, report_count: completed, completed_count: completed,
    outcomes: { accepted: o[0], partial: o[1], rejected: o[2], result_known: o[0] + o[1] + o[2], result_unknown: completed - (o[0] + o[1] + o[2]) },
    fine_count: fine,
  });
  const A = place('A', 37.5, [1, 0, 0], 1, 1);
  const B = place('B', 37.5001, [0, 0, 9], 9, 2);
  const cluster = (m: MapMetric) => clusterPoints(toInputs([A, B], m), 13).find((g) => g.kind === 'cluster')!;
  it('cluster rate = Σnum/Σden: 10% / 90% / 30%, never the 50% average', () => {
    const acc = cluster('acceptance'), rej = cluster('rejection'), fine = cluster('fine');
    if (acc.kind !== 'cluster' || rej.kind !== 'cluster' || fine.kind !== 'cluster') throw new Error('expected clusters');
    expect(pinText('rate', acc.num, acc.den)).toBe('10%');
    expect(pinText('rate', rej.num, rej.den)).toBe('90%');
    expect(pinText('rate', fine.num, fine.den)).toBe('30%');
    expect(colorScalar('rate', acc.num, acc.den, 1)).toBeCloseTo(0.1);
    expect(colorScalar('rate', rej.num, rej.den, 1)).toBeCloseTo(0.9);
    expect(colorScalar('rate', fine.num, fine.den, 1)).toBeCloseTo(0.3);
  });
  it('the colour input is 0..1 (not a 0..100 percent) and null differs from 0%', () => {
    const colors = [0, 0.1, 0.5, 0.9, 1].map((t) => rampColor(t));
    expect(new Set(colors).size).toBe(5);
    expect(rampColor(null)).toBe(METRIC_NULL);
    expect(rampColor(0)).not.toBe(METRIC_NULL);
    expect(colorScalar('rate', 0, 0, 10)).toBeNull();
    expect(pinText('rate', 0, 0)).toBe('–');
    expect(pinText('rate', 0, 5)).toBe('0%');
    const zero = markerSvg('0%', false, 0, { mineInk: '#00f', cyan: '#0ff', partial: '#fa0' });
    const none = markerSvg('–', false, null, { mineInk: '#00f', cyan: '#0ff', partial: '#fa0' });
    expect(zero).not.toBe(none);
    expect(none).toContain('stroke-dasharray');
  });
  it('switching 수용률 → 불수용률 changes the pin text and colour for the same completed count', () => {
    const [a] = toInputs([B], 'acceptance');
    const [r] = toInputs([B], 'rejection');
    expect(pinText(a.kind, a.num, a.den)).toBe('0%');
    expect(pinText(r.kind, r.num, r.den)).toBe('100%');
    expect(colorScalar(a.kind, a.num, a.den, 1)).not.toBe(colorScalar(r.kind, r.num, r.den, 1));
  });
  it('an answered place without a known result is kept (grey) in rate metrics; 신고 0 places stay in rates', () => {
    const unknown = place('U', 37.6, [0, 0, 0], 3, 0);
    unknown.report_count = 0;
    expect(visiblePoints([unknown], 'acceptance')).toHaveLength(1);
    expect(visiblePoints([unknown], 'reports')).toHaveLength(0);
    expect(metricParts(unknown, 'acceptance')).toMatchObject({ den: 0, weight: 3 });
    expect(pointTitle(unknown, 'acceptance')).toContain('계산 불가');
  });
});

describe('metric filtering and titles', () => {
  const pts = liveLikePoints();
  const completionOnly = pts.find((p) => p.key === 'pt-completion-only-0')!;
  it('hides completion-only places in the report metric, draws answered places in rate metrics', () => {
    expect(visiblePoints(pts, 'reports')).toHaveLength(312);
    expect(visiblePoints(pts, 'reports').some((p) => p.key === completionOnly.key)).toBe(false);
    for (const m of ['acceptance', 'rejection', 'fine'] as const) {
      const shown = visiblePoints(pts, m);
      expect(shown.every((p) => (p.completed_count ?? 0) > 0)).toBe(true);
      expect(shown.some((p) => p.key === completionOnly.key)).toBe(true);
    }
  });
  it('titles name the metric with its value and sample', () => {
    expect(pointTitle(completionOnly, 'reports')).toContain('신고 수 0건');
    expect(pointTitle(completionOnly, 'fine')).toMatch(/과태료 부과율 .* · 답변 \d+건/);
  });
});

describe('MapPanel markup (R01/R02/R03)', () => {
  const base = {
    selectedKey: null, onSelect: () => {}, onMetric: () => {}, categoryLabel: '모든 신고',
    autoRefresh: false, onAutoRefresh: () => {},
  };
  const pts = liveLikePoints();
  it('has exactly the four metric buttons, no place-filter tabs and no manual viewport button', () => {
    const html = renderToStaticMarkup(<MapPanel {...base} points={pts} metric="reports" />);
    for (const label of ['신고 수', '수용률', '불수용률', '과태료']) expect(html).toContain(`>${label}</button>`);
    expect(html).not.toContain('일부수용률');
    for (const gone of ['내 신고가 있는 곳', '함께 신고한 곳', '관심 지역', '보이는 지역만 보기', 'point-filter', 'map-apply']) {
      expect(html).not.toContain(gone);
    }
  });
  it('신고 수 lists pins; rate metrics draw regions and list no place at all (R7)', () => {
    const html = renderToStaticMarkup(<MapPanel {...base} points={pts} metric="reports" />);
    expect(html).not.toContain('완료만 지점 0');
    // MP-01 (2026-09-29): nothing is hidden for its other date, so the old note is gone
    expect(html).not.toContain('비율 지표에서 보입니다');
    for (const m of ['acceptance', 'rejection', 'fine'] as const) {
      const done = renderToStaticMarkup(<MapPanel {...base} points={pts} metric={m} />);
      expect(done).not.toContain('완료만 지점 0');
      expect(done).not.toContain('예시 지점');
      expect(done).toContain('시도별');
    }
  });
  it('shows a one-step-up back button only when a region is active', () => {
    const none = renderToStaticMarkup(<MapPanel {...base} points={pts} metric="reports" activeRegion={null} onPickRegion={() => {}} />);
    expect(none).not.toContain('map-back');
    const sgg = renderToStaticMarkup(<MapPanel {...base} points={pts} metric="reports" activeRegion="11110" onPickRegion={() => {}} />);
    expect(sgg).toContain('map-back');
    expect(sgg).toContain('서울특별시');
  });
});
