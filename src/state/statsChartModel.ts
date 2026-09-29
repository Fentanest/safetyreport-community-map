/**
 * 맞춤 통계 chart semantics (F01/F03/F06): ONE model of what a category chart draws — categories by member key,
 * series by a stable key (metric × population × line member), the exact StatValue behind every point — shared by the
 * ECharts renderer (PivotChart), the series legend (hide/show) and the Excel exporter. Pure (no DOM, no ECharts).
 *
 * Series keys never contain a display name, so two people with the same name (different agency keys) or the same
 * metric for 전체 and 내 신고 are always different series.
 */
import type { MetricDef, MetricUnit, StatCatalog, StatisticsResult, StatValue } from '../domain/statistics';
import { cellIndex, tupleKey, type ChartPlan, type ChartType } from './statistics';

export type Side = 'all' | 'mine';
/** colour: a semantic theme token (resolved per theme / per file) or a fixed hex (member colours) */
export type SeriesColor = { token: 'accepted' | 'partial' | 'rejected' | 'fine' | 'unknown' | 'brand' } | { hex: string };

export interface SeriesPoint { sv: StatValue | undefined; row: string[]; col: string[] }
export interface SeriesModel {
  key: string;
  /** legend / file name (unique within the chart) */
  name: string;
  metric: string;
  side: Side;
  /** the other dimension's member drawn as this line (two-dimension charts), else null */
  line: { key: string[]; label: string } | null;
  color: SeriesColor;
  dashed: boolean;
  points: SeriesPoint[];
}
export interface CartesianModel {
  type: Extract<ChartType, 'bar' | 'hbar' | 'line' | 'stack' | 'stack100'>;
  categories: Array<{ key: string[]; label: string }>;
  series: SeriesModel[];
  /** axis unit ('percent' for stack100: shares of the ORIGINAL partition total) */
  unit: MetricUnit;
  /** stack100: per side, per category the partition total over ALL its series (hidden or not); null = no bar */
  partitionTotals: Partial<Record<Side, Array<number | null>>>;
}

const PALETTE = ['#3B82F6', '#14B8A6', '#F97316', '#A855F7', '#EAB308', '#EC4899', '#22C55E', '#0EA5E9', '#EF4444', '#84CC16', '#6366F1', '#F43F5E'];
/** the same member keeps its colour through re-sorting and type switches (hash of the key, not the position) */
export function memberColor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
const SEMANTIC: Record<string, 'accepted' | 'partial' | 'rejected' | 'fine' | 'unknown'> = {
  accept_rate: 'accepted', accepted_count: 'accepted', reject_rate: 'rejected', rejected_count: 'rejected',
  partial_rate: 'partial', partial_count: 'partial', fine_rate: 'fine', fine_count: 'fine', unknown_count: 'unknown',
};
const isDate = (id: string) => /_(year|quarter|month|day)$/.test(id);

export const sidesOf = (result: StatisticsResult): Side[] =>
  result.spec.population === 'compare' ? ['all', 'mine'] : [result.spec.population === 'mine' ? 'mine' : 'all'];
export const sideWord = (result: StatisticsResult, s: Side) => (result.spec.population === 'compare' ? (s === 'all' ? ' · 전체' : ' · 내 신고') : '');

/** value of a one-dimension chart point: the row cell (rows) or the column total (columns only) */
export function oneDimValue(result: StatisticsResult, cell: ReturnType<typeof cellIndex>, side: Side, key: string[], m: string): StatValue | undefined {
  return result.spec.rows.length ? cell(side, key, [])?.values[m]
    : result.col_totals.find((t) => t.side === side && tupleKey(t.key) === tupleKey(key))?.values[m];
}

/** the category chart of a plan (bar/hbar/line/stack/stack100); null for heatmap/scatter/summary */
export function cartesianModel(result: StatisticsResult, catalog: StatCatalog, plan: ChartPlan): CartesianModel | null {
  if (plan.type === 'heatmap' || plan.type === 'scatter' || plan.type === 'summary') return null;
  const cell = cellIndex(result);
  const metric = (id: string): MetricDef | undefined => catalog.metrics.find((m) => m.id === id);
  const sides = sidesOf(result);
  const { rows, columns } = result.spec;
  const oneDim = rows.length + columns.length === 1;
  const series: SeriesModel[] = [];
  let categories: CartesianModel['categories'];
  if (oneDim) {
    const members = rows.length ? result.row_members : result.col_members;
    categories = members.map((mb) => ({ key: mb.key, label: mb.label.join(' · ') }));
    for (const m of plan.metrics) for (const s of sides) {
      series.push({ key: `${m}:${s}`, name: `${metric(m)?.label ?? m}${sideWord(result, s)}`, metric: m, side: s, line: null,
        color: SEMANTIC[m] ? { token: SEMANTIC[m] } : { hex: memberColor(m) }, dashed: s === 'mine',
        points: members.map((mb) => ({ sv: oneDimValue(result, cell, s, mb.key, m), row: rows.length ? mb.key : [], col: rows.length ? [] : mb.key })) });
    }
  } else {
    // two dimensions with a date: dates on the x axis, the other dimension as lines (display mapping only)
    const dateIsCol = columns.some(isDate);
    const xs = dateIsCol ? result.col_members : result.row_members;
    const lines = dateIsCol ? result.row_members : result.col_members;
    categories = xs.map((x) => ({ key: x.key, label: x.label.join(' · ') }));
    for (const ln of lines) for (const m of plan.metrics) for (const s of sides) {
      const lineLabel = ln.label.join(' · ');
      series.push({ key: `${tupleKey(ln.key)}:${m}:${s}`, name: `${lineLabel} · ${metric(m)?.label ?? m}${sideWord(result, s)}`, metric: m, side: s,
        line: { key: ln.key, label: lineLabel }, color: { hex: memberColor(tupleKey(ln.key)) }, dashed: s === 'mine',
        points: xs.map((x) => {
          const row = dateIsCol ? ln.key : x.key, col = dateIsCol ? x.key : ln.key;
          return { sv: cell(s, row, col)?.values[m], row, col };
        }) });
    }
  }
  uniqueNames(series);
  const partitionTotals: CartesianModel['partitionTotals'] = {};
  if (plan.type === 'stack100') {
    for (const s of sides) {
      const own = series.filter((x) => x.side === s);
      partitionTotals[s] = categories.map((_, i) => {
        const vals = own.map((x) => x.points[i].sv?.value ?? null);
        if (vals.every((v) => v === null)) return null;
        const sum = vals.reduce<number>((a, v) => a + (v ?? 0), 0);
        return sum > 0 ? sum : null;
      });
    }
  }
  const unit = plan.type === 'stack100' ? 'percent' : metric(plan.metrics[0])?.unit ?? 'count';
  return { type: plan.type, categories, series, unit, partitionTotals };
}

/** a display name that repeats (same label, different key) gets a counter, so legend entries stay distinguishable */
function uniqueNames(series: SeriesModel[]) {
  const seen = new Map<string, number>();
  for (const s of series) seen.set(s.name, (seen.get(s.name) ?? 0) + 1);
  const used = new Map<string, number>();
  for (const s of series) {
    if ((seen.get(s.name) ?? 0) < 2) continue;
    const n = (used.get(s.name) ?? 0) + 1;
    used.set(s.name, n);
    s.name = `${s.name} (${n})`;
  }
}

/** stack100 point: share of the original partition total (0–100); hiding other series never changes it */
export function shareOf(model: CartesianModel, s: SeriesModel, i: number): number | null {
  const v = s.points[i].sv?.value ?? null;
  const total = model.partitionTotals[s.side]?.[i] ?? null;
  return v === null || total === null ? null : (v / total) * 100;
}

/** F03: the hidden keys that still exist in this chart (a key of a series that no longer exists is dropped) */
export function effectiveHidden(model: CartesianModel | null, hidden: readonly string[]): string[] {
  if (!model) return [];
  const keys = new Set(model.series.map((s) => s.key));
  return hidden.filter((k) => keys.has(k));
}

export interface ScatterModel { x: string; y: string; side: Side; points: Array<{ key: string[]; label: string; vx: StatValue; vy: StatValue; row: string[]; col: string[] }> }
export function scatterModel(result: StatisticsResult, plan: ChartPlan): ScatterModel | null {
  if (plan.type !== 'scatter') return null;
  const cell = cellIndex(result);
  const side = sidesOf(result)[0];
  const [x, y] = plan.metrics;
  const { rows } = result.spec;
  const members = rows.length ? result.row_members : result.col_members;
  const points = members.flatMap((mb) => {
    const vx = oneDimValue(result, cell, side, mb.key, x), vy = oneDimValue(result, cell, side, mb.key, y);
    return vx?.value != null && vy?.value != null
      ? [{ key: mb.key, label: mb.label.join(' · '), vx, vy, row: rows.length ? mb.key : [], col: rows.length ? [] : mb.key }] : [];
  });
  return { x, y, side, points };
}

type Axis = Array<{ key: string[]; label: string[] }>;
/** the heatmap's axes: rows × columns, or the first two row dimensions when there are no columns */
export function heatmapAxes(result: StatisticsResult): { xs: Axis; ys: Axis; rowOf: (y: string[], x: string[]) => string[]; colOf: (x: string[]) => string[] } {
  const hasCols = result.spec.columns.length > 0;
  const dedupe = (list: Axis) => [...new Map(list.map((m) => [tupleKey(m.key), m])).values()];
  const xs = dedupe(hasCols ? result.col_members : result.row_members.map((r) => ({ key: r.key.slice(1), label: r.label.slice(1) })));
  const ys = dedupe(hasCols ? result.row_members : result.row_members.map((r) => ({ key: r.key.slice(0, 1), label: r.label.slice(0, 1) })));
  return { xs, ys, rowOf: (y, x) => (hasCols ? y : [...y, ...x]), colOf: (x) => (hasCols ? x : []) };
}

/** one cell list per population with the SAME axes (member keys, order) — never another population's values */
export function heatmapCells(result: StatisticsResult, side: Side, metricId: string) {
  const cell = cellIndex(result);
  const { xs, ys, rowOf, colOf } = heatmapAxes(result);
  const out: Array<{ value: [number, number, number | null]; sv: StatValue; row: string[]; col: string[] }> = [];
  ys.forEach((y, yi) => xs.forEach((x, xi) => {
    const row = rowOf(y.key, x.key), col = colOf(x.key);
    const v = cell(side, row, col)?.values[metricId];
    if (v) out.push({ value: [xi, yi, v.value], sv: v, row, col });
  }));
  return out;
}

/** heatmap colour scale shared by both populations: 0–100 for rates, else 0..max over BOTH populations */
export function heatmapMax(result: StatisticsResult, catalog: StatCatalog, metricId: string): number {
  const m = catalog.metrics.find((x) => x.id === metricId);
  if (m?.unit === 'percent') return 100;
  return Math.max(1, ...sidesOf(result).flatMap((s) => heatmapCells(result, s, metricId).map((d) => d.value[2] ?? 0)));
}
