import type { MetricDef, StatValue } from '../../domain/statistics';

const int = (v: number) => Math.round(v).toLocaleString('ko-KR');

/** one formatting rule for the table, the tooltip and the chart labels (rounding happens here only) */
export function fmtStat(v: StatValue | undefined, m: Pick<MetricDef, 'unit'> | undefined, withParts = true): string {
  if (!v) return '—';
  if (v.value === null) return v.reason === 'zero_denominator' ? '분모 없음' : '자료 없음';
  const unit = m?.unit ?? 'count';
  const main = unit === 'percent' ? `${v.value.toFixed(1)}%` : unit === 'won' ? `${int(v.value)}원`
    : unit === 'days' ? `${v.value.toFixed(1)}일` : unit === 'score' ? `${v.value.toFixed(2)}점` : `${int(v.value)}건`;
  if (!withParts) return main;
  if (unit === 'percent' && v.numerator !== null && v.denominator !== null) return `${main} (${int(v.numerator)}/${int(v.denominator)})`;
  if ((unit === 'won' || unit === 'days' || unit === 'score') && v.denominator !== null) return `${main} · ${int(v.denominator)}건 기준`;
  return main;
}

export const UNIT_WORD: Record<MetricDef['unit'], string> = { count: '건', percent: '%', won: '원', days: '일', score: '점' };
