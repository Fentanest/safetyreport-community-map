/**
 * U03 combined count/rate columns: ONE registry for the server list endpoints (/entities, /laws), the table
 * headers and menus, and the Excel export. The wire format is `sort=<column>&sort_value=<value>&dir=asc|desc`
 * (allowlist only — never a column or SQL name). Rules shared by every caller:
 *  - rates compare the exact fraction numerator/denominator (never a rounded '33.3%' string): 1/3 ≠ 3333/10000
 *  - a value that cannot be computed (denominator 0, not reported by the server) sorts LAST in both directions;
 *    a real 0 / 0% is a normal value
 *  - ties break on the display name, then the stable key, so pages never repeat or skip a row
 */
import type { FineAmountBrief, OutcomeCounts, RatingBrief, DurationBrief } from './public.ts';

export type SortValue = 'count' | 'rate' | 'median' | 'sum' | 'mean';
export type SortDir = 'asc' | 'desc';

export interface SortableRow {
  completed_count: number;
  outcomes: OutcomeCounts;
  fine_count: number | null;
  warning_count?: number | null;
  penalty_count?: number | null;
  duration?: DurationBrief | null;
  fine_amount?: FineAmountBrief | null;
  rating?: RatingBrief | null;
}

export interface SortColumnDef {
  label: string;
  /** every value the server accepts for this column (shared links, other callers) */
  values: SortValue[];
  /** the values the table offers in its menu = the values its cell actually shows (never a hidden number) */
  shown: SortValue[];
  /** menu text per value (desc, asc) */
  words: Partial<Record<SortValue, { name: string; desc: string; asc: string }>>;
}

// Menu words say the direction themselves (많은/적은, 높은/낮은 …): no arrow is shown or read next to them.
const countWords = { name: '건수', desc: '건수 많은 순', asc: '건수 적은 순' };
const rateWords = { name: '비율', desc: '비율 높은 순', asc: '비율 낮은 순' };

export const SORT_COLUMNS: Record<string, SortColumnDef> = {
  completed: { label: '답변', values: ['count'], shown: ['count'], words: { count: countWords } },
  accepted: { label: '수용', values: ['count', 'rate'], shown: ['count', 'rate'], words: { count: countWords, rate: rateWords } },
  partial: { label: '일부 수용', values: ['count', 'rate'], shown: ['count', 'rate'], words: { count: countWords, rate: rateWords } },
  rejected: { label: '불수용', values: ['count', 'rate'], shown: ['count', 'rate'], words: { count: countWords, rate: rateWords } },
  fine: { label: '과태료', values: ['count', 'rate'], shown: ['count', 'rate'], words: { count: countWords, rate: rateWords } },
  warning: { label: '계도', values: ['count', 'rate'], shown: ['count', 'rate'], words: { count: countWords, rate: rateWords } },
  penalty: { label: '범칙금', values: ['count', 'rate'], shown: ['count', 'rate'], words: { count: countWords, rate: rateWords } },
  // the cells show the median only / the confirmed sum only: the count keys stay valid for the server, not offered here
  duration: { label: '처리기간', values: ['median', 'count'], shown: ['median'], words: {
    median: { name: '기간', desc: '기간 긴 순', asc: '기간 짧은 순' },
    count: { name: '계산 건수', desc: '계산 건수 많은 순', asc: '계산 건수 적은 순' } } },
  amount: { label: '확인 금액', values: ['sum', 'count'], shown: ['sum'], words: {
    sum: { name: '금액', desc: '금액 많은 순', asc: '금액 적은 순' },
    count: { name: '확인 건수', desc: '확인 건수 많은 순', asc: '확인 건수 적은 순' } } },
  rating: { label: '평균 별점', values: ['mean', 'count'], shown: ['mean', 'count'], words: {
    mean: { name: '별점', desc: '별점 높은 순', asc: '별점 낮은 순' },
    count: { name: '평가 수', desc: '평가 많은 순', asc: '평가 적은 순' } } },
};

/** '건수 많은 순' — the words of one sort (what the menu item and the header say) */
export function sortWords(spec: SortSpec): string {
  const w = SORT_COLUMNS[spec.column]?.words[spec.value];
  return w ? (spec.dir === 'desc' ? w.desc : w.asc) : '';
}

export interface SortSpec { column: string; value: SortValue; dir: SortDir }
export const DEFAULT_SORT: SortSpec = { column: 'completed', value: 'count', dir: 'desc' };

export function isSortSpec(column: string, value: string, dir: string): boolean {
  const def = SORT_COLUMNS[column];
  return !!def && (def.values as string[]).includes(value) && (dir === 'asc' || dir === 'desc');
}

/** Legacy `sort` keys of the /entities endpoint (SOL-08) → the registry. */
export function legacySort(sort: string): Pick<SortSpec, 'column' | 'value'> | null {
  if (sort === 'acceptRate') return { column: 'accepted', value: 'rate' };
  if (SORT_COLUMNS[sort]) return { column: sort, value: SORT_COLUMNS[sort].values[0] };
  return null;
}

type Fraction = { num: number; den: number } | null;
const whole = (n: number | null | undefined): Fraction => (typeof n === 'number' && Number.isFinite(n) ? { num: n, den: 1 } : null);
const frac = (num: number | null | undefined, den: number | null | undefined): Fraction =>
  typeof num === 'number' && typeof den === 'number' && den > 0 ? { num, den } : null;

/** The exact value of a sort key for a row (null = cannot be computed → always last). */
export function sortFraction(row: SortableRow, column: string, value: SortValue): Fraction {
  const K = row.outcomes.result_known, C = row.completed_count;
  switch (column) {
    case 'completed': return whole(C);
    case 'accepted': return value === 'rate' ? frac(row.outcomes.accepted, K) : whole(row.outcomes.accepted);
    case 'partial': return value === 'rate' ? frac(row.outcomes.partial, K) : whole(row.outcomes.partial);
    case 'rejected': return value === 'rate' ? frac(row.outcomes.rejected, K) : whole(row.outcomes.rejected);
    // 과태료·계도·범칙금 비율의 분모는 답변 완료(C); an unreported count is unknown, never 0
    case 'fine': return value === 'rate' ? frac(row.fine_count, C) : whole(row.fine_count);
    case 'warning': return value === 'rate' ? frac(row.warning_count, C) : whole(row.warning_count);
    case 'penalty': return value === 'rate' ? frac(row.penalty_count, C) : whole(row.penalty_count);
    case 'duration': return value === 'count' ? whole(row.duration?.count) : whole(row.duration?.median_days);
    case 'amount': return value === 'count' ? whole(row.fine_amount?.confirmed_count) : whole(row.fine_amount?.sum_won);
    case 'rating': return value === 'count' ? whole(row.rating?.count) : whole(row.rating?.mean);
    default: return null;
  }
}

/** Comparator over the full list (nulls last in both directions, stable tie-break by name then key). */
export function compareRows<T extends SortableRow>(spec: SortSpec, nameOf: (row: T) => string, keyOf: (row: T) => string): (a: T, b: T) => number {
  return (a, b) => {
    const fa = sortFraction(a, spec.column, spec.value), fb = sortFraction(b, spec.column, spec.value);
    if (fa === null || fb === null) {
      if (fa !== fb) return fa === null ? 1 : -1;
    } else {
      // exact: num_a/den_a ? num_b/den_b  ⇔  num_a·den_b ? num_b·den_a (dens > 0)
      const diff = fa.num * fb.den - fb.num * fa.den;
      if (diff !== 0) return spec.dir === 'desc' ? -Math.sign(diff) : Math.sign(diff);
    }
    const na = nameOf(a), nb = nameOf(b);
    if (na !== nb) return na.localeCompare(nb, 'ko');
    const ka = keyOf(a), kb = keyOf(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  };
}

/** '과태료 · 건수 많은 순' — the active sort in words (table caption); direction is stated, never an arrow. */
export function sortLabel(spec: SortSpec): string {
  const def = SORT_COLUMNS[spec.column];
  if (!def) return '';
  return `${def.label} · ${sortWords(spec)}`;
}
