import type { MonthlyBucket, PublicEntity, PublicLaw, Scope } from '../src/domain/public.ts';
import type { SortSpec } from '../src/domain/tableSort.ts';
import { monthSpine } from './aggregate.ts';
/** Calendar frames are shared without pulling the Edge's Zod validator into personal analytics. */
export type RollupMonth = Pick<MonthlyBucket, 'month' | 'report_count' | 'completed_count' | 'fine_count' | 'outcomes' | 'duration' | 'fine_amount' | 'rating'>;
export type RollupKind = 'agency' | 'manager' | 'laws' | 'series';
export interface RollupOptions { page: number; page_size: number; q: string; sort: SortSpec; agency_type: string | null; expected_version: string }
export interface RollupResult { items: PublicEntity[] | PublicLaw[] | RollupMonth[]; total_rows: number }
export function rollupMonths(result: RollupResult, scope: Scope, window: { min: string | null; max: string | null }, today: string): MonthlyBucket[] {
  const groups = new Map((result.items as RollupMonth[]).map(item => [item.month, item]));
  return monthSpine(scope, window, today).map(slot => {
    const frame = { month: slot.month, interval_start: slot.interval_start, interval_end: slot.interval_end,
      range_partial: slot.range_partial, in_progress: slot.in_progress, partial: slot.range_partial || slot.in_progress, coverage_note: slot.coverage_note };
    if (slot.no_data) return { ...frame, report_count: null, completed_count: null, fine_count: null, outcomes: null, duration: null, fine_amount: null };
    const group = groups.get(slot.month);
    if (group) return { ...group, ...frame };
    return { ...frame, report_count: 0, completed_count: 0, fine_count: 0,
      outcomes: { accepted: 0, partial: 0, rejected: 0, result_known: 0, result_unknown: 0 },
      duration: { count: 0, median_days: null, mean_days: null },
      fine_amount: { fine_count: 0, confirmed_count: 0, sum_won: null, mean_won: null }, rating: { count: 0, mean: null } };
  });
}
