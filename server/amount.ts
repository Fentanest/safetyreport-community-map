/**
 * 답변에 적힌 과태료 금액 (docs/metrics-catalog.md fine_amount). Not a paid, collected or legally final amount.
 *
 * Cohort: the completion-date cohort of the scope (same as fine_count F). Only amounts the answer states as
 * 과태료 are summed. Classification of each fact of the cohort:
 *   confirmed     disposition=fine, kind=fine, status accepted|partial, amount stated (confirmed_won not null)
 *                 AND its consent policy publishes amounts (amount_public). An explicit 0원 is a real 0.
 *   undisclosed   as confirmed, but the consent policy does not publish amounts: counted, value never used
 *   unconfirmed   disposition=fine but no stated amount (not written, bare '과태료', parse failure)
 *   conflict      the fields disagree (kind=fine with disposition≠fine, disposition=fine with kind≠fine,
 *                 or a fine amount on a non-accepted status): excluded, counted
 *   penalty       kind=penalty (범칙금) — never added to fine totals
 *   combined      kind=combined (과태료·범칙금 inseparable) — never split, never added
 * Nothing is estimated from violation type, legal ranges or typical amounts; missing is never 0.
 * Sums are exact integers of won (≤ 100,000,000 per fact, ≤ 100,000 facts per query → < 2^53).
 */
import type { PrivateFact } from './aggregate.ts';

export type AmountClass = 'confirmed' | 'undisclosed' | 'unconfirmed' | 'conflict' | 'penalty' | 'combined' | 'none';

export interface FineAmountSummary {
  basis: 'completed_date';
  /** F: facts with a 과태료 disposition in the cohort */
  fine_count: number;
  confirmed_count: number;
  /** exact won; null when no amount is confirmed (never shown as 0원) */
  sum_won: number | null;
  mean_won: number | null;
  median_won: number | null;
  /** confirmed facts whose answer states exactly 0원 */
  zero_count: number;
  unconfirmed_count: number;
  undisclosed_count: number;
  conflict_count: number;
  penalty_count: number;
  combined_count: number;
  /** some fines lack a usable amount → the sum covers only part of F */
  partial: boolean;
}

export interface FineAmountBrief {
  fine_count: number;
  confirmed_count: number;
  sum_won: number | null;
  mean_won: number | null;
}

const ACCEPTED = new Set(['accepted', 'partial']);

export function classifyAmount(fact: PrivateFact): AmountClass {
  const kind = fact.amount_kind ?? 'unknown';
  const fine = fact.disposition === 'fine';
  if (kind === 'combined') return 'combined';
  if (kind === 'penalty') return fine ? 'conflict' : 'penalty';
  if (kind === 'fine' && !fine) return 'conflict';
  if (!fine) return 'none';
  if (kind !== 'fine') return 'conflict';
  if (!ACCEPTED.has(fact.status)) return 'conflict';
  if (fact.amount_public !== true) return fact.amount_stated === false ? 'unconfirmed' : 'undisclosed';
  return fact.amount_confirmed_won == null ? 'unconfirmed' : 'confirmed';
}

function medianOf(sorted: readonly number[]): number | null {
  const n = sorted.length;
  if (!n) return null;
  const mid = Math.floor(n / 2);
  return n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function fineAmountSummary(done: readonly PrivateFact[]): FineAmountSummary {
  const values: number[] = [];
  const counts = { fine: 0, zero: 0, unconfirmed: 0, undisclosed: 0, conflict: 0, penalty: 0, combined: 0 };
  for (const fact of done) {
    if (fact.disposition === 'fine') counts.fine++;
    const c = classifyAmount(fact);
    if (c === 'confirmed') {
      const won = fact.amount_confirmed_won!;
      values.push(won);
      if (won === 0) counts.zero++;
    } else if (c !== 'none') counts[c]++;
  }
  values.sort((a, b) => a - b);
  const n = values.length;
  const sum = values.reduce((a, b) => a + b, 0);
  return {
    basis: 'completed_date', fine_count: counts.fine, confirmed_count: n,
    sum_won: n ? sum : null, mean_won: n ? sum / n : null, median_won: medianOf(values),
    zero_count: counts.zero, unconfirmed_count: counts.unconfirmed, undisclosed_count: counts.undisclosed,
    conflict_count: counts.conflict, penalty_count: counts.penalty, combined_count: counts.combined,
    partial: counts.fine > 0 && n < counts.fine,
  };
}

export function fineAmountBrief(done: readonly PrivateFact[]): FineAmountBrief {
  const s = fineAmountSummary(done);
  return { fine_count: s.fine_count, confirmed_count: s.confirmed_count, sum_won: s.sum_won, mean_won: s.mean_won };
}
