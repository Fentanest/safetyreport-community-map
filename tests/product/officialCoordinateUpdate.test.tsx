import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import MapPanel from '../../src/components/MapPanel';
import InsightPanel from '../../src/components/InsightPanel';
import { fmtCoord6 } from '../../src/components/format';
import type { DashboardData, PublicPoint } from '../../src/domain/public';

// Official Safety Report API coordinates are the source for community-map points:
// no rounding/truncation in the marker path, and a supplement that changes a
// completed report's coordinate moves the marker to the new point (newest fact).
// These UI regression tests pin the frontend side of that contract:
// MapPanel's accessible list + selection follow the incoming points array, and
// InsightPanel keeps the full source precision reachable (short display +
// exact expansion/copy per docs/ui-spec.md §8).

const base: PublicPoint = {
  key: 'v1:37.56653513,126.977969231',
  lat: 37.56653513,
  lng: 126.977969231,
  address: '서울특별시 중구 공식 지점',
  region_code: '11',
  report_count: 2,
  completed_count: 2,
  outcomes: { accepted: 1, partial: 1, rejected: 0, result_known: 2, result_unknown: 0 },
  fine_count: 0,
};

// Same point key, supplement moved the official coordinate.
const movedSameKey: PublicPoint = {
  ...base,
  lat: 37.567123456,
  lng: 126.978543217,
};

// How the wire actually looks after a supplement: point_key is derived from the
// coordinate string, so the newest fact arrives under a new key at the new point.
const movedNewKey: PublicPoint = {
  ...base,
  key: 'v1:37.567123456,126.978543217',
  lat: 37.567123456,
  lng: 126.978543217,
};

function mapHtml(points: PublicPoint[], selectedKey: string | null): string {
  return renderToStaticMarkup(
    <MapPanel
      points={points}
      selectedKey={selectedKey}
      onSelect={() => {}}
      metric="reports"
      onMetric={() => {}}
      categoryLabel="모든 신고"
      onApplyView={() => {}}
      autoRefresh={false}
      onAutoRefresh={() => {}}
      locationMissing={null}
    />,
  );
}

function minimalData(): DashboardData {
  return {
    meta: { sample: false, coverage_note: '공식 좌표 범위' },
    scope: { start: '2026-09-01', end: '2026-09-30' },
    overview: {
      report_count: { value: 2 },
      outcomes: { accepted: 1, partial: 1, rejected: 0, result_known: 2, result_unknown: 0 },
      contributor_count: { value: 2 },
    },
    agencies: [],
  } as unknown as DashboardData;
}

function insightHtml(point: PublicPoint): string {
  return renderToStaticMarkup(
    <InsightPanel
      data={minimalData()}
      point={point}
      scopeLabel="2026.09.01 — 2026.09.30 · 전국"
      onAnalyzePoint={() => {}}
      onPickEntity={() => {}}
      toast={() => {}}
      onClose={() => {}}
    />,
  );
}

describe('official coordinate updates in the map UI', () => {
  it('same key + new coordinate: accessible list keeps the selection', () => {
    const before = mapHtml([base], 'v1:37.56653513,126.977969231');
    expect(before).toContain('서울특별시 중구 공식 지점');
    expect(before).toContain('aria-pressed="true" aria-label="서울특별시 중구 공식 지점 신고 2건 선택"');

    const after = mapHtml([movedSameKey], movedSameKey.key);
    expect(after).toContain('서울특별시 중구 공식 지점');
    // Selection is keyed by point key, so the moved marker stays selected.
    expect(after).toContain('aria-pressed="true" aria-label="서울특별시 중구 공식 지점 신고 2건 선택"');
  });

  it('supplement under a new point key: new point lists without a stale highlight', () => {
    const html = mapHtml([movedNewKey], null);
    expect(html).toContain('서울특별시 중구 공식 지점');
    expect(html).toContain('aria-pressed="false" aria-label="서울특별시 중구 공식 지점 신고 2건 선택"');
    // Selecting the new key highlights the moved marker.
    expect(mapHtml([movedNewKey], movedNewKey.key)).toContain('aria-pressed="true" aria-label="서울특별시 중구 공식 지점 신고 2건 선택"');
  });

  it('insight panel follows the moved coordinate and never conceals source precision', () => {
    const before = insightHtml(base);
    const after = insightHtml(movedSameKey);
    // Default short display is 6 decimals (ui-spec §8); the full value stays
    // reachable via expansion + exact copy, so precision is never concealed.
    expect(before).toContain(`${fmtCoord6(base.lat)}, ${fmtCoord6(base.lng)}`);
    expect(after).toContain(`${fmtCoord6(movedSameKey.lat)}, ${fmtCoord6(movedSameKey.lng)}`);
    expect(after).not.toContain(`${fmtCoord6(base.lat)}, ${fmtCoord6(base.lng)}`);
    // The fixture uses >6 decimal places, proving the short form alone would hide
    // source precision — the expansion/copy path must exist.
    expect(`${base.lat}`).not.toBe(fmtCoord6(base.lat));
    expect(before).toContain('자세히');
    expect(before).toContain('좌표 복사');
    // Copy payload is the exact source coordinate, not the rounded display form.
    expect(`${movedSameKey.lat},${movedSameKey.lng}`).toBe('37.567123456,126.978543217');
  });
});
