import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  CLUSTER_LEVEL, clusterPoints, type KakaoPointInput,
} from '../../src/lib/kakao';
import MapPanel, { displayCount, pointCountLabel, visiblePoints } from '../../src/components/MapPanel';
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

const toInputs = (pts: PublicPoint[], metric: 'reports' | 'acceptance'): KakaoPointInput[] =>
  visiblePoints(pts, metric).map((p) => ({
    key: p.key, lat: p.lat, lng: p.lng, label: p.key,
    count: displayCount(p, metric), selected: false, metricValue: null,
  }));

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

describe('client grid clustering (sum bubbles, exact coordinates)', () => {
  it('clusters far-zoom bubbles by SUM of display counts, never node count or 0', () => {
    const inputs = toInputs(liveLikePoints(), 'reports');
    expect(inputs).toHaveLength(312); // completion-only nodes are not drawn in the report metric
    const groups = clusterPoints(inputs, 13);
    const clusters = groups.filter((g) => g.kind === 'cluster');
    expect(clusters.length).toBeGreaterThan(0);
    expect(groups.length).toBeLessThan(inputs.length); // nationwide view actually collapses
    for (const g of groups) {
      if (g.kind === 'single') {
        expect(g.point.count).toBeGreaterThan(0);
        continue;
      }
      expect(g.members.length).toBeGreaterThanOrEqual(2);
      // Bubble number is the SUM of member display counts, not the node count.
      expect(g.count).toBe(sum(g.members.map((m) => m.count)));
      expect(g.count).toBeGreaterThan(0);
      if (g.members.length > 1 && sum(g.members.map((m) => m.count)) !== g.members.length) {
        expect(g.count).not.toBe(g.members.length);
      }
    }
    // Nothing is lost or created: totals match the drawn set.
    expect(sum(groups.map((g) => (g.kind === 'single' ? g.point.count : g.count))))
      .toBe(sum(inputs.map((p) => p.count)));
  });

  it('splits into exact-coordinate markers when zoomed in, leaving sources untouched', () => {
    const pts = liveLikePoints();
    const before = pts.map((p) => [p.lat, p.lng]);
    const inputs = toInputs(pts, 'acceptance');
    const groups = clusterPoints(inputs, CLUSTER_LEVEL - 1);
    expect(groups.every((g) => g.kind === 'single')).toBe(true);
    expect(groups).toHaveLength(inputs.length);
    for (const [i, g] of groups.entries()) {
      if (g.kind !== 'single') continue;
      // Exact source coordinates: the same object the caller passed in.
      expect(g.point.lat).toBe(inputs[i].lat);
      expect(g.point.lng).toBe(inputs[i].lng);
    }
    // Cluster centroids are display-only: source coordinates never move.
    expect(pts.map((p) => [p.lat, p.lng])).toEqual(before);
  });

  it('uses the completion-date count for completion metrics', () => {
    const inputs = toInputs(liveLikePoints(), 'acceptance');
    expect(inputs.every((p) => p.count > 0)).toBe(true);
    const groups = clusterPoints(inputs, 13);
    expect(sum(groups.map((g) => (g.kind === 'single' ? g.point.count : g.count))))
      .toBe(sum(inputs.map((p) => p.count)));
  });
});

describe('metric filtering and basis labels', () => {
  const pts = liveLikePoints();
  const completionOnly = pts.find((p) => p.key === 'pt-completion-only-0')!;

  it('hides completion-only places in the report metric, draws completed places in completion metrics', () => {
    expect(visiblePoints(pts, 'reports')).toHaveLength(312);
    expect(visiblePoints(pts, 'reports').some((p) => p.key === completionOnly.key)).toBe(false);
    for (const m of ['acceptance', 'partial', 'fine'] as const) {
      const shown = visiblePoints(pts, m);
      expect(shown.every((p) => (p.completed_count ?? 0) > 0)).toBe(true);
      expect(shown.some((p) => p.key === completionOnly.key)).toBe(true);
    }
  });

  it('never labels a completion count as a 신고', () => {
    expect(pointCountLabel(completionOnly, 'reports')).toBe('신고 0건');
    expect(pointCountLabel(completionOnly, 'acceptance')).toMatch(/^완료 \d+건$/);
  });
});

describe('MapPanel markup (fallback list mirrors drawn points + back control)', () => {
  const base = {
    selectedKey: null, onSelect: () => {}, onMetric: () => {}, categoryLabel: '모든 신고',
    onApplyView: () => {}, autoRefresh: false, onAutoRefresh: () => {},
  };
  const pts = liveLikePoints();

  it('hides report_count=0 places from the report-metric list and explains the basis', () => {
    const html = renderToStaticMarkup(<MapPanel {...base} points={pts} metric="reports" />);
    expect(html).not.toContain('완료만 지점 0');
    expect(html).toContain('신고 0건인 56곳은 지도에 표시하지 않습니다');
    const done = renderToStaticMarkup(<MapPanel {...base} points={pts} metric="acceptance" />);
    expect(done).toContain('완료만 지점 0');
    expect(done).toContain('완료 1건');
    expect(done).not.toContain('신고 0건인');
  });

  it('shows a one-step-up back button beside the map top controls only when a region is active', () => {
    const none = renderToStaticMarkup(
      <MapPanel {...base} points={pts} metric="reports" activeRegion={null} onPickRegion={() => {}} />,
    );
    expect(none).not.toContain('map-back');
    const sido = renderToStaticMarkup(
      <MapPanel {...base} points={pts} metric="reports" activeRegion="11" onPickRegion={() => {}} />,
    );
    expect(sido).toContain('map-back');
    expect(sido).toContain('전국으로');
    const sgg = renderToStaticMarkup(
      <MapPanel {...base} points={pts} metric="reports" activeRegion="11110" onPickRegion={() => {}} />,
    );
    expect(sgg).toContain('map-back');
    expect(sgg).toContain('서울특별시');
    expect(sgg).toContain('한 단계 위 지역');
  });
});
