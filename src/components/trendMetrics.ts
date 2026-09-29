/**
 * S09 monthly 처리결과 비율 — one definition for the lines, the tooltip, the table and the 맞춤 통계 hand-off.
 *   수용률 A/K · 불수용률 R/K · 일부수용률 P/K (K = A+P+R, 결과 미상 excluded) · 과태료처분율 F/C (C = 답변 완료).
 * A value is null with a reason whenever it cannot be computed; a real 0/positive denominator is a normal 0%.
 * Support is decided per metric (a missing fine field never hides the outcome lines, and vice versa).
 */
import type { MonthlyBucket, OutcomeCounts } from '../domain/public';
import type { CompareMonth } from '../domain/personal';

export type TrendRate = 'accept' | 'reject' | 'partial' | 'fine';
/** display / legend / table order (also the order of the checkboxes) */
export const TREND_RATES: readonly TrendRate[] = ['accept', 'reject', 'partial', 'fine'];
export const TREND_RATE_LABEL: Record<TrendRate, string> = {
  accept: '수용률', reject: '불수용률', partial: '일부수용률', fine: '과태료처분율',
};
/** semantic colour token of each metric (never by position, so a metric keeps its colour whatever else is checked) */
export const TREND_RATE_TOKEN: Record<TrendRate, 'accepted' | 'rejected' | 'partial' | 'fine'> = {
  accept: 'accepted', reject: 'rejected', partial: 'partial', fine: 'fine',
};
/** 맞춤 통계 registry metric ids for the hand-off (server/statistics.ts) */
export const TREND_RATE_METRIC_ID: Record<TrendRate, string> = {
  accept: 'accept_rate', reject: 'reject_rate', partial: 'partial_rate', fine: 'fine_rate',
};
export const DEFAULT_TREND_RATES: readonly TrendRate[] = ['accept'];

export type RateReason = 'zero_denominator' | 'missing_field' | 'missing_outcomes' | 'no_data';
export interface RateCell { numerator: number | null; denominator: number | null; value: number | null; reason: RateReason | null }

/** the parts of a month a rate needs; `undefined` = the server did not send the field, `null` = no value */
export interface MonthParts {
  completed_count?: number | null;
  outcomes?: OutcomeCounts | null;
  fine_count?: number | null;
}

export function rateCell(m: MonthParts | null | undefined, metric: TrendRate): RateCell {
  if (!m) return { numerator: null, denominator: null, value: null, reason: 'no_data' };
  if (metric === 'fine') {
    const den = m.completed_count ?? null;
    const num = m.fine_count ?? null;
    if (num === null) return { numerator: null, denominator: den, value: null, reason: 'missing_field' };
    if (den === null) return { numerator: num, denominator: null, value: null, reason: 'missing_field' };
    return { numerator: num, denominator: den, value: den > 0 ? (num / den) * 100 : null, reason: den > 0 ? null : 'zero_denominator' };
  }
  const o = m.outcomes;
  if (!o) return { numerator: null, denominator: null, value: null, reason: 'missing_outcomes' };
  const num = metric === 'accept' ? o.accepted : metric === 'partial' ? o.partial : o.rejected;
  const den = o.result_known;
  return { numerator: num, denominator: den, value: den > 0 ? (num / den) * 100 : null, reason: den > 0 ? null : 'zero_denominator' };
}

export const mineParts = (x: CompareMonth): MonthParts => ({
  completed_count: x.mine_completed_count, outcomes: x.mine_outcomes, fine_count: x.mine_fine_count,
});

export interface TrendRateRow {
  month: string;
  partial: boolean;
  all: Record<TrendRate, RateCell>;
  /** null when the comparison is off; cells carry their own reason when my month is missing */
  mine: Record<TrendRate, RateCell> | null;
}

const cells = (m: MonthParts | null | undefined): Record<TrendRate, RateCell> =>
  Object.fromEntries(TREND_RATES.map((k) => [k, rateCell(m, k)])) as Record<TrendRate, RateCell>;

/** Rows keyed by YYYY-MM (sorted); my months are joined by key, never by array index. */
export function trendRateRows(monthly: readonly MonthlyBucket[], mine: readonly CompareMonth[] | null): TrendRateRow[] {
  const mineBy = mine ? new Map(mine.map((m) => [m.month, m])) : null;
  // a month whose outcomes AND completion are both absent is outside the data window → no_data (not a 0)
  const allParts = (m: MonthlyBucket): MonthParts | null =>
    m.completed_count === null && m.outcomes === null ? null : m;
  const mineOf = (month: string): MonthParts | null => {
    const x = mineBy?.get(month);
    if (!x) return null;
    if (x.mine_completed_count === null && (x.mine_outcomes === null || x.mine_outcomes === undefined)) return null;
    return mineParts(x);
  };
  return [...monthly].sort((a, b) => a.month.localeCompare(b.month)).map((m) => ({
    month: m.month,
    partial: m.partial,
    all: cells(allParts(m)),
    mine: mineBy ? cells(mineOf(m.month)) : null,
  }));
}

export const REASON_TEXT: Record<RateReason, string> = {
  zero_denominator: '분모 없음', missing_field: '서버 미지원', missing_outcomes: '서버 미지원', no_data: '자료 없음',
};

/** '66.7% (12/18건)' or the reason; rounding happens here only */
export function rateCellText(c: RateCell): string {
  if (c.value !== null) return `${c.value.toFixed(1)}% (${c.numerator}/${c.denominator}건)`;
  return c.reason ? REASON_TEXT[c.reason] : '—';
}

// ── selection preference (a per-viewer convenience; never data) ──────────────────────────────────────────────
const PREF_KEY = 'cm-trend-rates';
const LEGACY_KEY = 'cm-trend-rate';

export function normalizeRates(input: unknown): TrendRate[] | null {
  if (!Array.isArray(input)) return null;
  const set = new Set(input.filter((x): x is TrendRate => typeof x === 'string' && (TREND_RATES as readonly string[]).includes(x)));
  return TREND_RATES.filter((k) => set.has(k));
}

export function readTrendRates(storage: Pick<Storage, 'getItem'> | null = safeStorage()): TrendRate[] {
  try {
    const raw = storage?.getItem(PREF_KEY);
    if (raw != null) {
      const list = normalizeRates(JSON.parse(raw));
      if (list) return list; // an explicit empty choice stays empty
    }
    const legacy = storage?.getItem(LEGACY_KEY);
    if (legacy && (TREND_RATES as readonly string[]).includes(legacy)) return [legacy as TrendRate];
  } catch { /* ignore */ }
  return [...DEFAULT_TREND_RATES];
}

export function writeTrendRates(list: readonly TrendRate[], storage: Pick<Storage, 'setItem' | 'removeItem'> | null = safeStorage()): void {
  try {
    storage?.setItem(PREF_KEY, JSON.stringify(TREND_RATES.filter((k) => list.includes(k))));
    storage?.removeItem(LEGACY_KEY);
  } catch { /* ignore */ }
}

function safeStorage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}
