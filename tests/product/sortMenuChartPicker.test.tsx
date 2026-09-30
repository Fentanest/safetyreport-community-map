// UI follow-up 2026-09-30: chart type availability (one rule source with planChart) and the words-only sort menu
// (visible values only, exact fractions, unknown last). Browser checks: scripts/browser/verify_sort_chart_ux.mjs.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { baseSpec, chartAvailability, DEFAULT_CHART, PICKER_TYPES, planChart } from '../../src/state/statistics';
import { statisticsCatalog } from '../../server/statistics';
import { compareRows, SORT_COLUMNS, sortLabel, sortWords, type SortableRow, type SortSpec } from '../../src/domain/tableSort';
import SortHeader from '../../src/components/SortHeader';

const catalog = statisticsCatalog();
const avail = (patch: Parameters<typeof baseSpec>[0]) => chartAvailability(baseSpec(patch), catalog);
const plan = (patch: Parameters<typeof baseSpec>[0], type: Parameters<typeof planChart>[2]['type'] = 'auto') =>
  planChart(baseSpec(patch), catalog, { ...DEFAULT_CHART, type });
const dimLabel = (id: string) => catalog.dimensions.find((d) => d.id === id)!.label;
const dateDim = catalog.dimensions.find((d) => /_month$/.test(d.id) && d.id.startsWith('completed'))!.id;

describe('chart availability = planChart.compatible (one judgment)', () => {
  const cases: Array<Parameters<typeof baseSpec>[0]> = [
    { rows: ['agency'], columns: ['law'] }, { rows: ['agency', 'sido'], columns: ['law'] }, { rows: [dateDim], columns: ['agency'] },
    { rows: ['agency'], columns: [], metrics: ['fine_rate', 'accept_rate'] }, { rows: ['agency'], columns: [], metrics: ['accept_rate', 'fine_rate'] },
    { rows: ['agency'], columns: [], metrics: ['accepted_count', 'partial_count', 'rejected_count'] }, { rows: [], columns: [] },
    { rows: ['agency'], columns: [], metrics: ['fine_rate', 'accept_rate'], population: 'compare' },
  ];
  it.each(cases.map((c) => [JSON.stringify(c), c] as const))('%s', (_n, c) => {
    const p = plan(c);
    for (const t of PICKER_TYPES) {
      expect(p.availability[t].ok, t).toBe(p.compatible.includes(t));
      if (!p.availability[t].ok) {
        expect(p.availability[t].reason, t).toBeTruthy();
        // user words only: no internal terms, no bare "not available" text
        expect(`${p.availability[t].reason} ${p.availability[t].fix ?? ''}`).not.toMatch(/dims|metric|partition|population|지금 설정에선 못 씀|지원 안 됨/);
      }
    }
  });

  it('agency × law: bar and heatmap available, horizontal bar explained with the actual items', () => {
    const a = avail({ rows: ['agency'], columns: ['law'] });
    expect(a.bar.ok && a.heatmap.ok).toBe(true);
    expect(a.hbar.ok).toBe(false);
    expect(a.hbar.reason).toContain(`${dimLabel('agency')}·${dimLabel('law')}, 총 2개 기준`);
  });
  it('agency·sido × law: only the heatmap, with the three items named and the limit stated', () => {
    const p = plan({ rows: ['agency', 'sido'], columns: ['law'] });
    expect(p.compatible).toEqual(['heatmap']);
    expect(p.availability.bar.reason).toBe(`${dimLabel('agency')}·${dimLabel('sido')}·${dimLabel('law')}, 총 3개 기준으로 나누고 있습니다.`);
    expect(p.availability.bar.fix).toMatch(/2개 기준까지/);
    expect(p.note).toMatch(/앞의 두 기준/);
  });
  it('answer month × agency: line available; without a date the line explains how to get one', () => {
    expect(avail({ rows: [dateDim], columns: ['agency'] }).line.ok).toBe(true);
    const a = avail({ rows: ['agency'], columns: ['law'] });
    expect(a.line.ok).toBe(false);
    expect(a.line.fix).toMatch(/날짜 항목을 추가/);
  });
  it('agency + two metrics: scatter available; one metric or 전체와 내 신고 explain why not', () => {
    expect(avail({ rows: ['agency'], columns: [], metrics: ['fine_rate', 'accept_rate'] }).scatter.ok).toBe(true);
    expect(avail({ rows: ['agency'], columns: [], metrics: ['fine_rate'] }).scatter.reason).toBe('숫자 지표가 1개입니다.');
    const cmp = avail({ rows: ['agency'], columns: [], metrics: ['fine_rate', 'accept_rate'], population: 'compare' }).scatter;
    expect(cmp.ok).toBe(false);
    expect(cmp.reason).toContain('전체와 내 신고');
  });
  it('rates cannot be a 100% stack; the reason names the chosen rates', () => {
    const a = avail({ rows: ['agency'], columns: [], metrics: ['accept_rate', 'fine_rate'] });
    expect(a.stack100.ok).toBe(false);
    const names = ['accept_rate', 'fine_rate'].map((m) => catalog.metrics.find((x) => x.id === m)!.label);
    expect(a.stack100.reason).toContain(names.join('·'));
    expect(a.stack100.fix).toMatch(/합하면 하나의 전체/);
    expect(avail({ rows: ['agency'], columns: [], metrics: ['accepted_count', 'partial_count', 'rejected_count'] }).stack100.ok).toBe(true);
  });
  it('an unavailable requested type keeps the settings and falls back to the recommendation with the same reason', () => {
    const spec = baseSpec({ rows: ['agency', 'sido'], columns: ['law'] });
    const p = planChart(spec, catalog, { ...DEFAULT_CHART, type: 'bar' });
    expect(p.type).toBe('heatmap');
    expect(p.refusal).toContain(p.availability.bar.reason!);
    expect(spec.rows).toEqual(['agency', 'sido']);
  });
});

type Row = SortableRow & { name: string; key: string };
const row = (name: string, fine: number | null, completed: number, extra: Partial<SortableRow> = {}): Row => ({
  name, key: name, completed_count: completed, fine_count: fine,
  outcomes: { accepted: 0, partial: 0, rejected: 0, result_known: 0, result_unknown: 0 } as unknown as SortableRow['outcomes'], ...extra });
const order = (rows: Row[], spec: SortSpec) => [...rows].sort(compareRows(spec, (r) => r.name, (r) => r.key)).map((r) => r.name);

describe('sort menu: exact values, words, visible values only', () => {
  const abc = [row('A', 10, 20), row('B', 6, 6), row('C', 20, 100)]; // 50% · 100% · 20%
  it('A 10/50%, B 6/100%, C 20/20%', () => {
    expect(order(abc, { column: 'fine', value: 'count', dir: 'desc' })).toEqual(['C', 'A', 'B']);
    expect(order(abc, { column: 'fine', value: 'count', dir: 'asc' })).toEqual(['B', 'A', 'C']);
    expect(order(abc, { column: 'fine', value: 'rate', dir: 'desc' })).toEqual(['B', 'A', 'C']);
    expect(order(abc, { column: 'fine', value: 'rate', dir: 'asc' })).toEqual(['C', 'A', 'B']);
  });
  it('rates that round to the same text (33.3%) still sort by the exact fraction', () => {
    const r = [row('x', 333, 1000), row('y', 1, 3), row('z', 3333, 10000)]; // 33.30% · 33.33…% · 33.33%
    expect(order(r, { column: 'fine', value: 'rate', dir: 'desc' })).toEqual(['y', 'z', 'x']);
  });
  it('a real 0% is a value; no denominator / unreported sorts after it in both directions', () => {
    const r = [row('zero', 0, 5), row('none', 0, 0), row('unknown', null, 5), row('half', 1, 2)];
    expect(order(r, { column: 'fine', value: 'rate', dir: 'desc' })).toEqual(['half', 'zero', 'none', 'unknown']);
    expect(order(r, { column: 'fine', value: 'rate', dir: 'asc' })).toEqual(['zero', 'half', 'none', 'unknown']);
  });
  it('rating: mean and number of ratings are separate orders', () => {
    const r = [row('p', 0, 1, { rating: { mean: 4.5, count: 2 } as SortableRow['rating'] }), row('q', 0, 1, { rating: { mean: 3.9, count: 40 } as SortableRow['rating'] }),
      row('s', 0, 1, { rating: null })];
    expect(order(r, { column: 'rating', value: 'mean', dir: 'desc' })).toEqual(['p', 'q', 's']);
    expect(order(r, { column: 'rating', value: 'mean', dir: 'asc' })).toEqual(['q', 'p', 's']);
    expect(order(r, { column: 'rating', value: 'count', dir: 'desc' })).toEqual(['q', 'p', 's']);
    expect(order(r, { column: 'rating', value: 'count', dir: 'asc' })).toEqual(['p', 'q', 's']);
  });
  it('menu words, no arrows; only the values the cells show (server keys unchanged)', () => {
    expect(sortWords({ column: 'fine', value: 'count', dir: 'desc' })).toBe('건수 많은 순');
    expect(sortWords({ column: 'fine', value: 'rate', dir: 'asc' })).toBe('비율 낮은 순');
    expect(sortWords({ column: 'rating', value: 'mean', dir: 'desc' })).toBe('별점 높은 순');
    expect(sortWords({ column: 'rating', value: 'count', dir: 'asc' })).toBe('평가 적은 순');
    expect(sortWords({ column: 'duration', value: 'median', dir: 'desc' })).toBe('기간 긴 순');
    expect(sortWords({ column: 'amount', value: 'sum', dir: 'asc' })).toBe('금액 적은 순');
    expect(SORT_COLUMNS.duration.shown).toEqual(['median']);
    expect(SORT_COLUMNS.amount.shown).toEqual(['sum']);
    expect(SORT_COLUMNS.duration.values).toContain('count');
    expect(sortLabel({ column: 'fine', value: 'count', dir: 'desc' })).toBe('과태료 · 건수 많은 순');
    for (const def of Object.values(SORT_COLUMNS)) for (const w of Object.values(def.words)) expect(`${w!.desc}${w!.asc}`).not.toMatch(/[▼▲↑↓]/);
  });
  it('header: current order as text, no arrow; the menu is not rendered until opened', () => {
    const html = renderToStaticMarkup(<table><thead><tr>
      <SortHeader column="fine" current={{ column: 'fine', value: 'rate', dir: 'desc' }} onSort={() => {}} enabled label="과태료" className="num" />
      <SortHeader column="completed" current={{ column: 'fine', value: 'rate', dir: 'desc' }} onSort={() => {}} enabled label="답변" className="num" />
    </tr></thead></table>);
    expect(html).toContain('비율 높은 순');
    expect(html).not.toMatch(/[▼▲↑↓]/);
    expect(html).toContain('aria-sort="descending"');
    expect(html).toContain('aria-label="과태료 정렬, 지금 비율 높은 순"');
    expect(html).not.toContain('role="menu"');
  });
});
