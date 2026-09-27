/**
 * Processing duration (답변까지 걸린 기간) — docs/metrics-catalog.md "processing_duration".
 *
 * - Cohort: facts whose ANSWER date (completed_date = day(response_date), set only for answered statuses) is inside
 *   the selected period, restricted to answered statuses. Withdrawn/transferred end a report but are not answers.
 * - days = KST calendar day(completed_date) − KST calendar day(report_date). Same-day answer = 0. Day data only:
 *   no hour precision is invented. No other date (upload, crawl, today) ever replaces completed_date.
 * - Excluded with a reason (never silently fixed): no report date; answer date before report date.
 * - Answered facts without any answer date cannot be placed in a period: they are counted separately
 *   (answer_date_missing, report-date cohort), never as a missing value of the selected period.
 * - mean = arithmetic mean of days; median = middle value (even n: mean of the two middle values);
 *   p90 = nearest-rank: the value at rank ceil(0.9 × n) of the ascending list. Always from raw values of the
 *   scope — never an average of group medians or means.
 */
import { kstDate, type PrivateFact, type Status } from './aggregate.ts';

export const ANSWERED: ReadonlySet<Status> = new Set<Status>(['accepted', 'partial', 'rejected', 'completed_unknown']);

export interface DurationSummary {
  basis: 'completed_date';
  /** facts with a valid duration */
  count: number;
  mean_days: number | null;
  median_days: number | null;
  p90_days: number | null;
  min_days: number | null;
  max_days: number | null;
  excluded: { no_report_date: number; reversed: number };
}

const DAY = 86400000;

function dayIndex(value: string | null): number | null {
  const day = kstDate(value);
  if (day === null) return null;
  return Math.round(Date.parse(`${day}T00:00:00Z`) / DAY);
}

export type DurationResult = { days: number } | { reason: 'no_report_date' | 'reversed' | 'not_answered' | 'no_answer_date' };

export function durationOf(fact: PrivateFact): DurationResult {
  if (!ANSWERED.has(fact.status)) return { reason: 'not_answered' };
  const done = dayIndex(fact.completed_date);
  if (done === null) return { reason: 'no_answer_date' };
  const reported = dayIndex(fact.report_date);
  if (reported === null) return { reason: 'no_report_date' };
  const days = done - reported;
  return days < 0 ? { reason: 'reversed' } : { days };
}

/** Median (even n: mean of the two middle values) of an ascending list. */
export function median(sorted: readonly number[]): number | null {
  const n = sorted.length;
  if (n === 0) return null;
  const mid = Math.floor(n / 2);
  return n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Nearest-rank percentile: value at rank ceil(q × n) (1-based) of an ascending list. */
export function nearestRank(sorted: readonly number[], q: number): number | null {
  const n = sorted.length;
  if (n === 0) return null;
  return sorted[Math.min(n, Math.max(1, Math.ceil(q * n))) - 1];
}

/** `done` = the completion-date cohort of the scope (already filtered by period and dimensions). */
export function durationSummary(done: readonly PrivateFact[]): DurationSummary {
  const days: number[] = [];
  let noReport = 0, reversed = 0;
  for (const fact of done) {
    const r = durationOf(fact);
    if ('days' in r) days.push(r.days);
    else if (r.reason === 'no_report_date') noReport++;
    else if (r.reason === 'reversed') reversed++;
  }
  days.sort((a, b) => a - b);
  const n = days.length;
  return {
    basis: 'completed_date', count: n,
    mean_days: n ? days.reduce((a, b) => a + b, 0) / n : null,
    median_days: median(days), p90_days: nearestRank(days, 0.9),
    min_days: n ? days[0] : null, max_days: n ? days[n - 1] : null,
    excluded: { no_report_date: noReport, reversed },
  };
}

/** Answered facts reported in the period that carry no answer date at all (their period is unknown). */
export function answerDateMissing(reported: readonly PrivateFact[]): number {
  return reported.filter(fact => ANSWERED.has(fact.status) && kstDate(fact.completed_date) === null).length;
}

/** Compact row form (region, agency, manager, month) from the same raw values. */
export function durationBrief(done: readonly PrivateFact[]): { count: number; median_days: number | null; mean_days: number | null } {
  const s = durationSummary(done);
  return { count: s.count, median_days: s.median_days, mean_days: s.mean_days };
}
