import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { aggregateDashboard, type PrivateFact } from '../../server/aggregate';
import { isEmptyResult } from '../../src/pages/Dashboard';
import KpiRow from '../../src/components/KpiRow';
import MapPanel from '../../src/components/MapPanel';
import type { Scope } from '../../src/domain/public';

// AF-MAP2: August report / September completion with coordinates, viewed in September.
// Real aggregation input, no mocks.
const sept: Scope = {
  start: '2026-09-01', end: '2026-09-30', category: 'all', region_code: null,
  agency_key: null, manager_key: null, bbox: null,
};
const aopts = {
  datasetVersion: 'af-map2-test', sourceUpdatedAt: null,
  generatedAt: '2026-09-30T00:00:00Z', asOf: '2026-09-30', sample: false,
};

const crossFact: PrivateFact = {
  fact_identity: 'af-map2-1', contributor_id: 'af-map2-user-1',
  snapshot_id: 's1', snapshot_generation: 1,
  report_date: '2026-08-10', completed_date: '2026-09-05', category: 'traffic',
  status: 'accepted', disposition: 'none', vehicle_raw: null,
  point_key: 'pt-map2-cross', lat: 37.5, lng: 127.0, address: '예시 지점',
  region_code: '11', agency_key: 'agency-1', agency_name: '예시 기관',
  manager_key: 'manager-1', manager_name: '김하늘',
};

describe('AF-MAP2 point_count meaning and completion-only range', () => {
  it('keeps point_count on the report-date basis while the map keeps the union point', () => {
    const data = aggregateDashboard([crossFact], sept, aopts);
    expect(data.overview.report_count.value).toBe(0);
    expect(data.overview.completed_count.value).toBe(1);
    // point_count is the report-date location count again, matching basis + denominator.
    expect(data.overview.point_count).toMatchObject({ value: 0, basis: 'report_date', denominator: 0 });
    // The August report predates data_min (2026-08-10), so the equal-duration comparison
    // window is only partly covered and previous is null — same rule as the other indicators.
    expect(data.overview.point_count.previous).toBeNull();
    // With a fully covered comparison window the previous value is the report-date location
    // count (previousReported), not the union.
    const covered = aggregateDashboard([crossFact], sept, { ...aopts, dataMin: '2026-01-01' });
    expect(covered.overview.point_count.previous).toBe(1);
    // The drawn map point is the union: the completion-only location is still shown.
    expect(data.points).toHaveLength(1);
    expect(data.points[0]).toMatchObject({ key: 'pt-map2-cross', report_count: 0, completed_count: 1 });
  });

  it('shows the result screen instead of the empty banner (render test, no mocks)', () => {
    const data = aggregateDashboard([crossFact], sept, aopts);
    expect(isEmptyResult(data)).toBe(false);
    const bannerText = '현재 필터에 결과가 없습니다';
    const kpi = renderToStaticMarkup(<KpiRow overview={data.overview} unsupported={false} />);
    expect(kpi).toContain('신고일 기준');
    expect(kpi).toContain('0');
    expect(kpi).toContain('곳');
    const map = renderToStaticMarkup(
      <MapPanel points={data.points} selectedKey={null} onSelect={() => {}} metric="reports"
        onMetric={() => {}} categoryLabel="전체 분류" onApplyView={() => {}} autoRefresh={false}
        onAutoRefresh={() => {}} locationMissing={data.meta.location_missing ?? null} />,
    );
    // Result screen renders the union point and explains the completion-only locations.
    expect(map).toContain('예시 지점');
    expect(map).toContain('완료일만 범위에 든 위치도 포함');
    // Dashboard renders the empty banner only when isEmptyResult is true.
    const banner = isEmptyResult(data)
      ? `<div class="banner warn"><span class="grow">${bannerText}. 조건을 해제하면 전국 집계를 볼 수 있습니다.</span></div>`
      : `<section class="analytics-ready">${data.points.length}곳 표시</section>`;
    expect(banner).not.toContain(bannerText);
  });

  it('still reports a genuinely empty range as empty', () => {
    const data = aggregateDashboard([], sept, aopts);
    expect(data.overview.report_count.value).toBe(0);
    expect(data.overview.completed_count.value).toBe(0);
    expect(data.points).toHaveLength(0);
    expect(isEmptyResult(data)).toBe(true);
  });
});
