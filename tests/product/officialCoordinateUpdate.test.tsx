import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import MapPanel from '../../src/components/MapPanel';
import PlaceDetailsPanel from '../../src/components/PlaceDetailsPanel';
import { fmtCoord6 } from '../../src/components/format';
import type { PublicPoint } from '../../src/domain/public';

// Official Safety Report API coordinates are the source for community-map points:
// no rounding/truncation in the marker path, and a supplement that changes a
// completed report's coordinate moves the marker to the new point (newest fact).
// These UI regression tests pin the frontend side of that contract:
// MapPanel's accessible list + selection follow the incoming points array.
// R07 (2026-09-29): the place panel is address-centred — the full address and 주소 복사 replace the
// latitude/longitude display and 좌표 복사 (the source coordinate itself is still stored untouched).

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
     
      autoRefresh={false}
      onAutoRefresh={() => {}}
      locationMissing={null}
    />,
  );
}

function placeHtml(point: PublicPoint): string {
  return renderToStaticMarkup(
    <PlaceDetailsPanel point={point} detail={{ status: 'loading' }} scopeLabel="2026.09.01 — 2026.09.30 · 전국"
      onClose={() => {}} onRetry={() => {}} onPickEntity={() => {}} toast={() => {}} />,
  );
}

describe('official coordinate updates in the map UI', () => {
  it('same key + new coordinate: accessible list keeps the selection', () => {
    const before = mapHtml([base], 'v1:37.56653513,126.977969231');
    expect(before).toContain('서울특별시 중구 공식 지점');
    expect(before).toContain('aria-pressed="true" aria-label="서울특별시 중구 공식 지점 · 신고 수 2건 선택"');

    const after = mapHtml([movedSameKey], movedSameKey.key);
    expect(after).toContain('서울특별시 중구 공식 지점');
    // Selection is keyed by point key, so the moved marker stays selected.
    expect(after).toContain('aria-pressed="true" aria-label="서울특별시 중구 공식 지점 · 신고 수 2건 선택"');
  });

  it('supplement under a new point key: new point lists without a stale highlight', () => {
    const html = mapHtml([movedNewKey], null);
    expect(html).toContain('서울특별시 중구 공식 지점');
    expect(html).toContain('aria-pressed="false" aria-label="서울특별시 중구 공식 지점 · 신고 수 2건 선택"');
    // Selecting the new key highlights the moved marker.
    expect(mapHtml([movedNewKey], movedNewKey.key)).toContain('aria-pressed="true" aria-label="서울특별시 중구 공식 지점 · 신고 수 2건 선택"');
  });

  it('place panel shows the full address with 주소 복사 and no coordinate UI (R07)', () => {
    const html = placeHtml(movedSameKey);
    expect(html).toContain('서울특별시 중구 공식 지점');
    expect(html).toContain('주소 복사');
    expect(html).not.toContain('좌표 복사');
    expect(html).not.toContain('자세히');
    expect(html).not.toContain(fmtCoord6(movedSameKey.lat));
    expect(html).not.toContain(String(movedSameKey.lat));
    // tabs were removed (R05): no tablist in the place panel
    expect(html).not.toContain('role="tab"');
  });
});
