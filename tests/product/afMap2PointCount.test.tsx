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
  date_basis: 'completed_date' as const, start: '2026-09-01', end: '2026-09-30', category: 'all', region_code: null,
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
  // Migrated 2026-09-29 (date-basis-dashboard §0.2): point_count, the map and every count follow the ONE date basis.
  it('keeps point_count on the selected basis, the same set the map draws', () => {
    const data = aggregateDashboard([crossFact], sept, aopts);
    expect(data.overview.report_count.value).toBe(1);
    expect(data.overview.completed_count.value).toBe(1);
    expect(data.overview.point_count).toMatchObject({ value: 1, basis: 'completed_date', denominator: 1 });
    // The August report predates data_min (2026-08-10), so the equal-duration comparison
    // window is only partly covered and previous is null — same rule as the other indicators.
    expect(data.overview.point_count.previous).toBeNull();
    // With a fully covered comparison window the previous value is the previous window of the SAME basis
    // (August answers: none) — never the other date's set.
    const covered = aggregateDashboard([crossFact], sept, { ...aopts, dataMin: '2026-01-01' });
    expect(covered.overview.point_count.previous).toBe(0);
    expect(aggregateDashboard([crossFact], { ...sept, date_basis: 'report_date', start: '2026-09-01' }, { ...aopts, dataMin: '2026-01-01' })
      .overview.point_count.previous).toBe(1); // report basis: the August report is in the previous window
    expect(data.points).toHaveLength(1);
    expect(data.points[0]).toMatchObject({ key: placeKeyOf('예시 지점'), report_count: 1, completed_count: 1 });
  });

  it('shows the result screen instead of the empty banner (render test, no mocks)', () => {
    const data = aggregateDashboard([crossFact], sept, aopts);
    expect(isEmptyResult(data)).toBe(false);
    const bannerText = '현재 필터에 결과가 없습니다';
    // The comparison table replaced the 6-KPI row (docs/personal-comparison.md §5.1); public column only here.
    const kpi = renderToStaticMarkup(<CompareKpis overview={data.overview} compareOn={false} unsupported={false}
      personal={{ status: 'off', data: null, error: null, retry: () => {} }} onSignIn={() => {}}
      auth={{ status: 'signed_out', displayName: null, viewerId: null, synthetic: false, message: null }} />);
    expect(kpi).toContain('답변일 기준');
    expect(kpi).toContain('신고 장소');
    expect(kpi).toMatch(/<b class="cm-number">1<\/b>/);
    expect(kpi).not.toContain('내 신고');
    const reportMap = renderToStaticMarkup(
      <MapPanel points={data.points} selectedKey={null} onSelect={() => {}} metric="reports"
        onMetric={() => {}} categoryLabel="전체 분류" autoRefresh={false}
        onAutoRefresh={() => {}} locationMissing={data.meta.location_missing ?? null} />,
    );
    // MP-01: the place is listed (nothing hidden for its other date) and the old note is gone
    expect(reportMap).toContain('예시 지점');
    expect(reportMap).not.toContain('답변만 있는');
    const completionMap = renderToStaticMarkup(
      <MapPanel points={data.points} selectedKey={null} onSelect={() => {}} metric="acceptance"
        onMetric={() => {}} categoryLabel="전체 분류" autoRefresh={false}
        onAutoRefresh={() => {}} locationMissing={data.meta.location_missing ?? null} />,
    );
    // R7: a rate metric is a region map — the completion-only place is counted in the region rows, not drawn as a pin
    expect(completionMap).not.toContain('예시 지점');
    expect(completionMap).toContain('시도별 수용률');
    const guide = renderToStaticMarkup(<DataGuide data={data} />);
    expect(guide).not.toContain('답변만 받은 신고의 장소');
    expect(guide).toContain('날짜 기준(신고일 또는 답변일)이 기간 안인 신고로 모든 수치를 셉니다');
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
