import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { aggregateDashboard, type PrivateFact } from '../../server/aggregate';
import { aggregateCompare } from '../../server/compare';
import { overviewSchema } from '../../src/data/schema';
import { personalCompareSchema } from '../../src/data/personal';
import type { PersonalCompare } from '../../src/domain/personal';
import type { Overview } from '../../src/domain/public';
import type { Scope } from '../../src/domain/public';
import KpiPanel from '../../src/components/KpiPanel';
import CompareKpis from '../../src/components/CompareKpis';
import { DurationCard } from '../../src/components/AnalyticsCharts';

/**
 * 2026-10-12 (U-mean-primary): '답변까지' 박스의 큰 값을 중앙값에서 평균으로 바꾼다(작은 줄에 중앙값 병기, 평균
 * 우선). mean_days 필드 자체가 없는 구버전 응답(선택 필드 — count=0이라 null인 경우와는 다르다)에서는 기존처럼
 * 중앙값을 큰 값으로 쓰는 표기로 돌아간다(화면이 깨지지 않게).
 */
let n = 0;
const f = (patch: Partial<PrivateFact>): PrivateFact => {
  n += 1;
  return {
    fact_identity: `d-${n}`, contributor_id: 'other', snapshot_id: 's', snapshot_generation: 1,
    report_date: '2026-08-01', completed_date: '2026-08-09', category: 'traffic', status: 'accepted', disposition: 'none',
    vehicle_raw: null, point_key: null, lat: null, lng: null, address: null, region_code: null,
    agency_key: 'a1:x', agency_name: '예시 기관', manager_key: 'm1:x', manager_name: '김하늘', ...patch,
  };
};
// all 4건: 8,8,8,10일 → 평균 8.5일 · 중앙값 8일. mine 2건(viewer): 8,10일 → 평균 9일 · 중앙값 9일.
const facts: PrivateFact[] = [
  f({}), f({}), f({ contributor_id: 'viewer' }), f({ contributor_id: 'viewer', completed_date: '2026-08-11' }),
];
const scope: Scope = { date_basis: 'completed_date', start: '2026-08-01', end: '2026-08-11', category: 'all',
  region_code: null, agency_key: null, manager_key: null, bbox: null, law: null };
const dashOpts = { datasetVersion: 't', sourceUpdatedAt: null, generatedAt: '2026-08-11T00:00:00Z', asOf: '2026-08-11', sample: false, dataMin: '2026-08-01' };
const compareOpts = { datasetVersion: 't', asOf: '2026-08-11', dataMin: '2026-08-01', viewer: { contributor: 'active' as const, has_public_facts: true } };

const pub = aggregateDashboard(facts, scope, dashOpts);
const cmp = aggregateCompare(facts, scope, 'viewer', compareOpts);

const baseProps = {
  focus: { kind: 'nation' as const, label: '전국', basis: scope.date_basis, start: scope.start, end: scope.end },
  overview: pub.overview, state: 'ready' as const, showMine: true, unsupported: false, detail: null,
};

const durationHero = (html: string): string => html.match(/<div class="kpi-hero-cell" data-kpi="duration">[\s\S]*?<\/div>/)?.[0] ?? '';

describe('server: current server always sends mean_days alongside median_days', () => {
  it('all = 평균 8.5일 · 중앙값 8일(count 4: 8,8,8,10), mine = 평균 9일 · 중앙값 9일(2건: 8,10)', () => {
    expect(pub.overview.processing_duration).toMatchObject({ count: 4, median_days: 8, mean_days: 8.5 });
    expect(cmp.mine.duration).toMatchObject({ count: 2, median_days: 9, mean_days: 9 });
    expect(overviewSchema.safeParse(JSON.parse(JSON.stringify(pub.overview))).success).toBe(true);
    expect(personalCompareSchema.safeParse(JSON.parse(JSON.stringify(cmp))).success).toBe(true);
  });
});

describe('KpiPanel 답변까지 — mean is the hero value, median is the secondary line (U-mean-primary)', () => {
  it('shows "평균 · 중앙값 N일 · 계산 M건" and "내 평균 X일 · 중앙값 Y일" when mean is known', () => {
    const personal = { status: 'ready' as const, data: cmp, error: null, retry: () => {} };
    const html = renderToStaticMarkup(<KpiPanel {...baseProps} personal={personal} />);
    const cell = durationHero(html);
    expect(cell).toContain('8.5일'); // hero value = mean (8.5), not the median (8)
    expect(cell).toContain('평균 · 중앙값 8일 · 계산 4건');
    expect(cell).toContain('class="kpi-mine mine-col"');
    expect(cell).toContain('내 평균 9일 · 중앙값 9일');
  });

  it('falls back to the pre-existing median-as-hero display when mean_days is absent entirely (older server)', () => {
    // JSON round-trip drops the key outright (not just null) — the exact shape an older server sends.
    const older: Overview = JSON.parse(JSON.stringify({ ...pub.overview,
      processing_duration: { ...pub.overview.processing_duration!, mean_days: undefined } }));
    const olderMine: PersonalCompare = JSON.parse(JSON.stringify({ ...cmp,
      mine: { ...cmp.mine, duration: { ...cmp.mine.duration, mean_days: undefined } } }));
    expect(overviewSchema.safeParse(older).success).toBe(true);
    expect('mean_days' in older.processing_duration!).toBe(false);
    const personal = { status: 'ready' as const, data: olderMine, error: null, retry: () => {} };
    const html = renderToStaticMarkup(<KpiPanel {...baseProps} overview={older} personal={personal} />);
    const cell = durationHero(html);
    expect(cell).toContain('8일'); // hero value falls back to median (8), same number here but via the old path
    expect(cell).toContain('중앙값 · 계산 4건');
    expect(cell).not.toContain('평균');
    expect(cell).toContain('내 9일'); // old mine format: just the median, no "평균"
    expect(cell).not.toContain('내 평균');
  });
});

describe('CompareKpis 답변까지 걸린 기간 행 — same mean-primary swap, with median kept as a diff note', () => {
  it('leads with 평균 in both the all/mine cells and the basis label', () => {
    const personal = { status: 'ready' as const, data: cmp, error: null, retry: () => {} };
    const auth = { status: 'signed_in' as const, message: null };
    const html = renderToStaticMarkup(<CompareKpis overview={pub.overview} personal={personal} compareOn auth={auth as any} onSignIn={() => {}} unsupported={false} />);
    const row = html.match(/<tr>[\s\S]*?답변까지 걸린 기간[\s\S]*?<\/tr>/)?.[0] ?? '';
    expect(row).toContain('평균 · 신고한 날부터 답변 받은 날까지');
    expect(row).toContain('<b class="cm-number">8.5일</b>'); // all hero = mean (8.5), not median (8)
    expect(row).toContain('중앙값 8일'); // allNote keeps median
    expect(row).toContain('<b class="cm-number">9일</b>'); // mine hero = mean
    expect(row).toContain('중앙값 차이'); // diffNote keeps the median diff alongside the (now primary) mean diff
  });
});

describe('AnalyticsCharts DurationCard caption — 평균 우선, 중앙값 병기', () => {
  it('leads the caption with 평균 for both 전체 and 내 신고 lines', () => {
    const card = renderToStaticMarkup(<DurationCard all={pub.analytics!.duration!} mine={cmp.analytics!.duration} theme="light" />);
    expect(card).toContain('전체 평균 8.5일 · 중앙값 8일');
    expect(card).toContain('내 신고 평균 9일 · 중앙값 9일');
  });
});
