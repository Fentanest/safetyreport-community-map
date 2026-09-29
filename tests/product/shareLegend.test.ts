/** F02 share recipe (allowlist, limits, exclusions) and F03 legend model (stable keys, fixed 100% denominator). */
import { describe, expect, it } from 'vitest';
import { statisticsCatalog } from '../../server/statistics';
import type { StatisticsResult, StatValue } from '../../src/domain/statistics';
import { baseSpec, planChart, type StatsRecipe } from '../../src/state/statistics';
import { checkAgainstCatalog, decodeShare, recipeFromPayload, shareExclusions, shareUrl, toPayload, SHARE_LIMITS } from '../../src/state/share';
import { cartesianModel, effectiveHidden, shareOf } from '../../src/state/statsChartModel';

const catalog = statisticsCatalog();
const base = { origin: 'https://example.github.io', pathname: '/safetyreport-community-map/' };
const recipe = (patch: Partial<StatsRecipe['spec']> = {}, scope: Partial<StatsRecipe['scope']> = {}): StatsRecipe => ({
  scope: { start: '2026-01-01', end: '2026-06-30', category: 'traffic', region_code: '11', agency_key: null, manager_key: null, bbox: null, law: null, ...scope },
  spec: baseSpec({ rows: ['agency', 'completed_month'], columns: ['law'], metrics: ['fine_rate', 'completed_count'], filters: [{ dimension: 'agency', members: ['ag:서울 "강남"경찰서', 'ag:부산'] }], ...patch }),
  labels: { 'ag:부산': '부산경찰서 이름은 링크에 없음' }, origin: 'test',
});
const sp = (url: string) => new URL(url).searchParams.get('sr');

describe('F02 share link', () => {
  it('FN-06 round trip keeps rows/columns/metrics/filters order, Korean and quotes; no labels, place or bbox', () => {
    const r = recipe({ place_key: 'pl1:abc' }, { bbox: [126.9, 37.5, 127.1, 37.6] });
    const out = shareUrl(toPayload(r, { type: 'heatmap', primary: 'completed_count', overlay: false }, 'chart'), base);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.url.startsWith(`${base.origin}${base.pathname}?screen=statistics&sr=`)).toBe(true);
    const d = decodeShare(sp(out.url));
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.payload.spec.rows).toEqual(['agency', 'completed_month']);
    expect(d.payload.spec.metrics).toEqual(['fine_rate', 'completed_count']);
    expect(d.payload.spec.filters[0].members).toEqual(['ag:서울 "강남"경찰서', 'ag:부산']);
    expect(d.payload.chart).toEqual({ type: 'heatmap', primary: 'completed_count', overlay: false });
    const raw = JSON.stringify(d.payload);
    expect(raw).not.toContain('pl1:abc');
    expect(raw).not.toContain('126.9');
    expect(raw).not.toContain('이름은 링크에 없음');
    const back = recipeFromPayload(d.payload);
    expect(back.recipe.scope.bbox).toBeNull();
    expect(back.recipe.spec.place_key).toBeNull();
    expect(back.recipe.labels).toEqual({});
    expect(checkAgainstCatalog(d.payload, catalog)).toBeNull();
  });
  it('FN-07/08 exclusions are reported to the sharer (address, bbox, mine) — never silently dropped', () => {
    expect(shareExclusions(recipe({ place_key: 'pl1:x', population: 'compare' }, { bbox: [1, 2, 3, 4] }))).toEqual({ place: true, bbox: true, mine: true });
    expect(shareExclusions(recipe())).toEqual({ place: false, bbox: false, mine: false });
  });
  it('FN-09 unknown fields, SQL-ish ids, wrong versions, oversize and garbage are refused', () => {
    const good = toPayload(recipe(), { type: 'auto', primary: null, overlay: true }, 'table');
    const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    expect(decodeShare(enc({ ...good, extra: 1 })).ok).toBe(false);
    expect(decodeShare(enc({ ...good, spec: { ...good.spec, metrics: ["fine_rate'; drop table x;--"] } })).ok).toBe(false);
    expect(decodeShare(enc({ ...good, v: 2 }))).toEqual({ ok: false, reason: '이 사이트에서 열 수 없는 형식의 링크입니다.' });
    expect(decodeShare(enc({ ...good, scope: { ...good.scope, start: '2026-07-01' } })).ok).toBe(false);
    expect(decodeShare('%%%').ok).toBe(false);
    expect(decodeShare('A'.repeat(SHARE_LIMITS.encodedChars + 1)).ok).toBe(false);
    expect(decodeShare(enc({ ...good, spec: { ...good.spec, metrics: ['no_such_metric'] } })).ok).toBe(true);
    const unknown = decodeShare(enc({ ...good, spec: { ...good.spec, metrics: ['no_such_metric'] } }));
    expect(unknown.ok && checkAgainstCatalog(unknown.payload, catalog)).toMatch(/지표/);
    const many = recipe({ filters: Array.from({ length: 8 }, (_, i) => ({ dimension: ['agency', 'manager', 'law', 'sgg', 'sido', 'category', 'outcome', 'disposition'][i], members: Array.from({ length: 50 }, (_, j) => `k${i}-${j}-${'x'.repeat(30)}`) })) });
    const long = shareUrl(toPayload(many, { type: 'auto', primary: null, overlay: true }, 'table'), base);
    expect(long.ok).toBe(false); // refused with the reason, never truncated
    expect(!long.ok && long.reason).toMatch(/줄여 주세요/);
  });
});

const v = (value: number | null): StatValue => ({ value, numerator: null, denominator: null, reason: null });
function res(): StatisticsResult {
  return { schema_version: 1, dataset_version: 'v', scope: recipe().scope, spec: baseSpec({ rows: ['manager'], columns: [], metrics: ['accepted_count', 'partial_count', 'rejected_count'], population: 'compare' }),
    row_members: [{ key: ['a|m1'], label: ['김철수 · 갑서'] }, { key: ['b|m1'], label: ['김철수 · 을서'] }], col_members: [],
    cells: [
      { row: ['a|m1'], col: [], side: 'all', values: { accepted_count: v(12), partial_count: v(3), rejected_count: v(3) } },
      { row: ['a|m1'], col: [], side: 'mine', values: { accepted_count: v(1), partial_count: v(0), rejected_count: v(1) } },
      { row: ['b|m1'], col: [], side: 'all', values: { accepted_count: v(1), partial_count: v(0), rejected_count: v(0) } },
    ], row_totals: [], col_totals: [], grand_totals: [], population_count: { all: 19, mine: 2 }, excluded: { no_report_date: 0 }, filter_members: [], complete: true };
}

describe('F03 legend model', () => {
  it('FN-14 stable keys per metric × population; 전체 and 내 신고 never share a key', () => {
    const m = cartesianModel(res(), catalog, planChart(res().spec, catalog, { type: 'bar', primary: null, overlay: true }))!;
    expect(m.series.map((s) => s.key)).toEqual(['accepted_count:all', 'accepted_count:mine', 'partial_count:all', 'partial_count:mine', 'rejected_count:all', 'rejected_count:mine']);
    expect(new Set(m.series.map((s) => s.name)).size).toBe(m.series.length);
  });
  it('FN-13 100% stack keeps the original partition total when a series is hidden', () => {
    const m = cartesianModel(res(), catalog, planChart(res().spec, catalog, { type: 'stack100', primary: null, overlay: true }))!;
    const acc = m.series.find((s) => s.key === 'accepted_count:all')!;
    const par = m.series.find((s) => s.key === 'partial_count:all')!;
    // hiding 불수용 does not change the other shares: 12/18 and 3/18 → together 5/6 of the bar
    expect(shareOf(m, acc, 0)).toBeCloseTo((12 / 18) * 100, 10);
    expect(shareOf(m, acc, 0)! + shareOf(m, par, 0)!).toBeCloseTo((15 / 18) * 100, 10);
    // my 을서 row has no reports: no bar (null), not 0
    expect(shareOf(m, m.series.find((s) => s.key === 'accepted_count:mine')!, 1)).toBeNull();
  });
  it('a hidden key of a series that no longer exists is dropped; others are not hidden in its place', () => {
    const m = cartesianModel(res(), catalog, planChart(res().spec, catalog, { type: 'bar', primary: null, overlay: true }))!;
    expect(effectiveHidden(m, ['fine_rate:all', 'partial_count:mine'])).toEqual(['partial_count:mine']);
  });
});
