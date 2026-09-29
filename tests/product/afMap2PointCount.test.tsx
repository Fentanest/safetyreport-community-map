import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { aggregateDashboard, type PrivateFact } from '../../server/aggregate';
import { placeKeyOf } from '../../server/places';
import { isEmptyResult } from '../../src/pages/Dashboard';
import CompareKpis from '../../src/components/CompareKpis';
import MapPanel from '../../src/components/MapPanel';
import DataGuide from '../../src/components/DataGuide';
import type { Scope } from '../../src/domain/public';

// AF-MAP2: August report / September completion with coordinates, viewed in September.
// Real aggregation input, no mocks.
const sept: Scope = {
  start: '2026-09-01', end: '2026-09-30', category: 'all', region_code: null,
  agency_key: null, manager_key: null, bbox: null, law: null,
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
    expect(data.points[0]).toMatchObject({ key: placeKeyOf('예시 지점'), report_count: 0, completed_count: 1 });
  });

  it('shows the result screen instead of the empty banner (render test, no mocks)', () => {
    const data = aggregateDashboard([crossFact], sept, aopts);
    expect(isEmptyResult(data)).toBe(false);
    const bannerText = '현재 필터에 결과가 없습니다';
    // The comparison table replaced the 6-KPI row (docs/personal-comparison.md §5.1); public column only here.
    const kpi = renderToStaticMarkup(<CompareKpis overview={data.overview} compareOn={false} unsupported={false}
      personal={{ status: 'off', data: null, error: null, retry: () => {} }} onSignIn={() => {}}
      auth={{ status: 'signed_out', displayName: null, viewerId: null, synthetic: false, message: null }} />);
    expect(kpi).toContain('신고한 날 기준');
    expect(kpi).toContain('신고 장소');
    expect(kpi).toMatch(/<b class="cm-number">0<\/b>/);
    expect(kpi).not.toContain('내 신고');
    const reportMap = renderToStaticMarkup(
      <MapPanel points={data.points} selectedKey={null} onSelect={() => {}} metric="reports"
        onMetric={() => {}} categoryLabel="전체 분류" autoRefresh={false}
        onAutoRefresh={() => {}} locationMissing={data.meta.location_missing ?? null} />,
    );
    expect(reportMap).not.toContain('예시 지점');
    expect(reportMap).toContain('이 기간에 신고가 없고 답변만 있는 1곳은 비율 지표에서 보입니다');
    const completionMap = renderToStaticMarkup(
      <MapPanel points={data.points} selectedKey={null} onSelect={() => {}} metric="acceptance"
        onMetric={() => {}} categoryLabel="전체 분류" autoRefresh={false}
        onAutoRefresh={() => {}} locationMissing={data.meta.location_missing ?? null} />,
    );
    // R7: a rate metric is a region map — the completion-only place is counted in the region rows, not drawn as a pin
    expect(completionMap).not.toContain('예시 지점');
    expect(completionMap).toContain('시도별 수용률');
    expect(renderToStaticMarkup(<DataGuide data={data} />)).toContain('답변만 받은 신고의 장소는 비율 지표(수용률·불수용률·과태료)를 고르면 볼 수 있습니다');
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
