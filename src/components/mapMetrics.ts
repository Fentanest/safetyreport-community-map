/**
 * Map metrics (R03/R1): 신고 수(수용률 핀, 기본) / 수용률 / 불수용률 / 과태료(부과율). One definition used by the
 * pins, the clusters, the boundary fill, the hover card, the legend and the list fallback, so they can never
 * disagree. Rates are numerator/denominator pairs; the display value (%) and the colour input (0..1) are derived
 * separately.
 *
 * R1 fix (2026-10-13, Astra P2): the requirement is "핀 채움색=수용률, 크기·숫자=신고 건수" for the DEFAULT 신고
 * pin, not an opt-in extra mode. A first pass added a separate 'density' toggle and left 'reports' on the old
 * blue report-COUNT colour (which rescaled with whatever was on screen — exactly the "화면 안 최대·최솟값으로 색
 * 기준을 바꾸지 마" violation Astra reproduced). Fixed by folding the density pin encoding into 'reports' itself
 * and removing the separate button, so there are four buttons again. PINS coloured by 수용률 (fixed red→orange→
 * green scale, never rescaled by the on-screen max/min) and SIZED/labelled by report_count (densityDiameter in
 * lib/kakao.ts) — the two roles never share one number. Visibility = report_count > 0, so an answered-but-unknown
 * place still shows its pin. This is a different number from the 'acceptance' region choropleth below, which
 * stays untouched (R1: "기존 지역별 수용률 지도 유지").
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
  kind: 'count' | 'rate' | 'density';
  /** unit of the denominator shown next to a rate */
  denLabel: string;
}

export const MAP_METRICS: readonly MetricDef[] = [
  { id: 'reports', label: '신고 수·수용률', legend: '신고 수', basis: '색=수용률(수용 ÷ 수용+일부수용+불수용) · 크기·숫자=신고 건수', kind: 'density', denLabel: '분류된 답변' },
  { id: 'acceptance', label: '수용률', legend: '수용률', basis: '수용 ÷ (수용+일부수용+불수용)', kind: 'rate', denLabel: '분류된 답변' },
  { id: 'rejection', label: '불수용률', legend: '불수용률', basis: '불수용 ÷ (수용+일부수용+불수용)', kind: 'rate', denLabel: '분류된 답변' },
  { id: 'fine', label: '과태료', legend: '과태료 부과율', basis: '과태료 ÷ 답변', kind: 'rate', denLabel: '답변' },
];
const KNOWN_METRIC_IDS = new Set<string>(MAP_METRICS.map((d) => d.id));
/** R1 fix: a value that is not one of the current four ids (e.g. a stored/shared 'density' value from the
 *  short-lived separate toggle, or any other stale/unknown string) safely lands on 'reports' — which now carries
 *  the exact same colour+size pin encoding by default, so nothing is lost by the fallback. */
export function resolveMapMetric(m: string | null | undefined): MapMetric {
  return m != null && KNOWN_METRIC_IDS.has(m) ? (m as MapMetric) : 'reports';
}
export const metricDef = (m: MapMetric): MetricDef => MAP_METRICS.find((d) => d.id === resolveMapMetric(m)) ?? MAP_METRICS[0];

export interface MetricRow {
  report_count: number;
  completed_count: number | null;
  outcomes: OutcomeCounts | null;
  fine_count: number | null;
}

export interface MetricParts {
  kind: 'count' | 'rate' | 'density';
  num: number;
  den: number;
  /** > 0 when the row is drawn for this metric: reported places for 신고 수(수용률 핀), answered places for rates */
  weight: number;
}

export function metricParts(row: MetricRow, rawMetric: MapMetric): MetricParts {
  const m = resolveMapMetric(rawMetric);
  if (m === 'reports') {
    // R1 (2026-10-13 fix): the DEFAULT 신고 pin encoding — fill colour = 수용률, size/number = report_count.
    // Visibility/size/number follow report_count (never completed_count) so a place without any known result
    // yet still keeps its pin; num/den (수용/분류된 답변) only feed the fill colour, never the size or text.
    const o = row.outcomes;
    return { kind: 'density', num: o?.accepted ?? 0, den: o?.result_known ?? 0, weight: row.report_count };
  }
  const completed = row.completed_count ?? 0;
  if (m === 'fine') {
    return { kind: 'rate', num: row.fine_count ?? 0, den: row.fine_count === null ? 0 : completed, weight: completed };
  }
  const o = row.outcomes;
  const known = o?.result_known ?? 0;
  return { kind: 'rate', num: m === 'acceptance' ? (o?.accepted ?? 0) : (o?.rejected ?? 0), den: known, weight: completed };
}

/** Rate as a 0..100 display number, or null without a denominator (never 0%). 'density' carries a rate too
 *  (the colour input), on top of its report-count weight. */
export function metricPercent(p: MetricParts): number | null {
  return (p.kind === 'rate' || p.kind === 'density') && p.den > 0 ? (p.num / p.den) * 100 : null;
}

/** Human value: '12건', '10.0% (1/10건)', the no-denominator reason, or (density) count + rate together. */
export function metricText(p: MetricParts, m: MapMetric): string {
  if (p.kind === 'count') return `${fmtInt(p.num)}건`;
  if (p.kind === 'density') {
    const pct = metricPercent(p);
    const countTxt = `${fmtInt(p.weight)}건`;
    return pct === null ? `${countTxt} · 수용률 계산 불가(분류된 답변 0건)` : `${countTxt} · 수용률 ${pct.toFixed(1)}% (${fmtInt(p.num)}/${fmtInt(p.den)}건)`;
  }
  const pct = metricPercent(p);
  const def = metricDef(m);
  if (pct === null) return `${def.legend} 계산 불가 · ${def.denLabel} 0건`;
  return `${pct.toFixed(1)}% (${fmtInt(p.num)}/${fmtInt(p.den)}건)`;
}
