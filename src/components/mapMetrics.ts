/**
 * Map metrics (R03): 신고 수 / 수용률 / 불수용률 / 과태료(부과율). One definition used by the pins, the clusters,
 * the boundary fill, the hover card, the legend and the list fallback, so they can never disagree.
 * Rates are numerator/denominator pairs; the display value (%) and the colour input (0..1) are derived separately.
 */
import type { OutcomeCounts } from '../domain/public';
import { fmtInt } from './format';

export type MapMetric = 'reports' | 'acceptance' | 'rejection' | 'fine';

export interface MetricDef {
  id: MapMetric;
  /** button text (exact wording of the requirement) */
  label: string;
  /** legend / tooltip name */
  legend: string;
  basis: string;
  kind: 'count' | 'rate';
  /** unit of the denominator shown next to a rate */
  denLabel: string;
}

export const MAP_METRICS: readonly MetricDef[] = [
  { id: 'reports', label: '신고 수', legend: '신고 수', basis: '적용한 날짜 기준의 신고', kind: 'count', denLabel: '' },
  { id: 'acceptance', label: '수용률', legend: '수용률', basis: '수용 ÷ 결과가 나온 신고', kind: 'rate', denLabel: '결과가 나온 신고' },
  { id: 'rejection', label: '불수용률', legend: '불수용률', basis: '불수용 ÷ 결과가 나온 신고', kind: 'rate', denLabel: '결과가 나온 신고' },
  { id: 'fine', label: '과태료', legend: '과태료 부과율', basis: '과태료 ÷ 답변 완료', kind: 'rate', denLabel: '답변 완료' },
];
export const metricDef = (m: MapMetric): MetricDef => MAP_METRICS.find((d) => d.id === m) ?? MAP_METRICS[0];

export interface MetricRow {
  report_count: number;
  completed_count: number | null;
  outcomes: OutcomeCounts | null;
  fine_count: number | null;
}

export interface MetricParts {
  kind: 'count' | 'rate';
  num: number;
  den: number;
  /** > 0 when the row is drawn for this metric: reported places for 신고 수, answered places for rates */
  weight: number;
}

export function metricParts(row: MetricRow, m: MapMetric): MetricParts {
  if (m === 'reports') return { kind: 'count', num: row.report_count, den: 0, weight: row.report_count };
  const completed = row.completed_count ?? 0;
  if (m === 'fine') {
    return { kind: 'rate', num: row.fine_count ?? 0, den: row.fine_count === null ? 0 : completed, weight: completed };
  }
  const o = row.outcomes;
  const known = o?.result_known ?? 0;
  return { kind: 'rate', num: m === 'acceptance' ? (o?.accepted ?? 0) : (o?.rejected ?? 0), den: known, weight: completed };
}

/** Rate as a 0..100 display number, or null without a denominator (never 0%). */
export function metricPercent(p: MetricParts): number | null {
  return p.kind === 'rate' && p.den > 0 ? (p.num / p.den) * 100 : null;
}

/** Human value: '12건', '10.0% (1/10건)', or the no-denominator reason. */
export function metricText(p: MetricParts, m: MapMetric): string {
  if (p.kind === 'count') return `${fmtInt(p.num)}건`;
  const pct = metricPercent(p);
  const def = metricDef(m);
  if (pct === null) return `${def.legend} 계산 불가 · ${def.denLabel} 0건`;
  return `${pct.toFixed(1)}% (${fmtInt(p.num)}/${fmtInt(p.den)}건)`;
}
