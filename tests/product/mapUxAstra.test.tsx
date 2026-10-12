import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import EntityTable from '../../src/components/EntityTable';
import KpiPanel from '../../src/components/KpiPanel';
import { DurationCard } from '../../src/components/AnalyticsCharts';
import { demoEngineDashboard, demoFacts, DEMO_VIEWER_ID, DEMO_AS_OF, DEMO_DATA_MIN } from '../../src/data/demoEngine';
import { aggregateCompare } from '../../server/compare';
import { personalCompareSchema } from '../../src/data/personal';
import { DEMO_SCOPE } from '../../src/domain/public';
import type { CompareEntityRow, CompareSide } from '../../src/domain/personal';

const dashboard = demoEngineDashboard(DEMO_SCOPE);
const comparison = personalCompareSchema.parse(aggregateCompare(demoFacts(), DEMO_SCOPE, DEMO_VIEWER_ID, {
  datasetVersion: dashboard.meta.dataset_version, asOf: DEMO_AS_OF, dataMin: DEMO_DATA_MIN,
  viewer: { contributor: 'active', has_public_facts: true },
}));
const entity = dashboard.agencies[0];
const side: CompareSide = {
  report_count: 10, completed_count: 10, result_known: 4, accepted: 2, partial: 1, rejected: 1,
  fine_count: 2, accept_rate: 50, partial_rate: 25, duration_count: 2, duration_median_days: 0, duration_mean_days: 0,
  fine_amount_confirmed_count: 0, fine_amount_sum_won: null,
};
const row = (mine: CompareSide): CompareEntityRow => ({
  kind: 'agency', key: entity.key, agency_key: entity.agency_key, manager_key: null,
  agency_name: entity.agency_name, manager_name: null, all: side, mine,
  accept_rate_pp: 0, partial_rate_pp: 0, duration_median_days_diff: 0,
});
const table = (mine?: Map<string, CompareEntityRow>) => renderToStaticMarkup(
  <EntityTable scope={DEMO_SCOPE} version={dashboard.meta.dataset_version} agencies={[entity]} managers={[]}
    tab="agency" onTab={() => {}} onPick={() => {}} mine={mine} serverList={false} activeAgency={null} activeManager={null} />,
);
const cells = (html: string) => [...html.matchAll(/<small class="entity-mine"[^>]*>(.*?)<\/small>/g)].map((m) => m[1]);

// Exercise real personal DTOs and edge cases that must not become plausible but false numbers.
describe('map UX 3 / 5', () => {
  it('puts five own values in the existing columns, using each metric denominator and retaining valid zero days', () => {
    const html = table(new Map([[entity.key, row(side)]]));
    expect(cells(html)).toEqual(['내 10', '내 50.0%', '내 25.0%', '내 2건 · 20.0%', '내 0일 · 중앙값 0일']);
    expect(html.match(/<th scope="col"/g)).toHaveLength(6);
    expect(html).not.toContain('>내\u00A0답변<');
    expect(html).not.toContain('>내\u00A0수용률<');
  });
  it('distinguishes no comparison row, actual zero counts, and undefined rates/duration', () => {
    expect(cells(table(new Map()))).toEqual(Array(5).fill('내 자료 없음'));
    const zero = { ...side, completed_count: 0, result_known: 0, rejected: 0, fine_count: 0,
      accept_rate: null, duration_count: 0, duration_median_days: null };
    expect(cells(table(new Map([[entity.key, row(zero)]])))).toEqual(['내 0', '내 —', '내 —', '내 0건 · —', '내 —']);
    expect(cells(table())).toEqual([]);
  });
  it('shows supplied mean and median for both populations without substituting the overall mean', () => {
    const personal = { status: 'ready' as const, data: comparison, error: null, retry: () => {} };
    const overview = { ...dashboard.overview, processing_duration: { ...dashboard.overview.processing_duration!, count: 3, median_days: 2, mean_days: 10 } };
    personal.data = { ...comparison, mine: { ...comparison.mine, duration: { count: 2, median_days: 1, mean_days: 7, p90_days: 13 } } };
    const props = { focus: { kind: 'nation' as const, label: '전국', basis: DEMO_SCOPE.date_basis, start: DEMO_SCOPE.start, end: DEMO_SCOPE.end },
      overview, state: 'ready' as const, personal, showMine: true, unsupported: false, detail: null };
    const html = renderToStaticMarkup(<KpiPanel {...props} />);
    // U-mean-primary (2026-10-12): 큰 값은 평균, 중앙값은 작은 줄에 병기.
    // dotParts (components/dotParts.tsx, U-letter-break fix): each " · "-joined piece is its own unbreakable
    // <span class="nb">, joined by a plain breakable space — same words, new markup.
    expect(html).toContain('<span class="dp">평균</span> <span class="dp">·\u00A0중앙값 2일</span> <span class="dp">·\u00A0계산 3건</span>');
    expect(html).toContain('<span class="dp">내\u00A0평균 7일</span> <span class="dp">·\u00A0중앙값 1일</span>');
    expect(renderToStaticMarkup(<KpiPanel {...props} showMine={false} />)).not.toContain('내 평균');
    expect(renderToStaticMarkup(<KpiPanel {...props} focus={{ ...props.focus, kind: 'place' }} />)).not.toContain('내 평균');
    const card = renderToStaticMarkup(<DurationCard all={{ ...dashboard.analytics!.duration!, median_days: 2, mean_days: 10 }}
      mine={{ ...comparison.analytics!.duration, median_days: 1, mean_days: 7 }} theme="light" />);
    expect(card).toContain('전체 평균 10일 · 중앙값 2일');
    expect(card).toContain('내 신고 평균 7일 · 중앙값 1일');
  });
});
