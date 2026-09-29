import type { DurationDistribution, OutcomeCounts, RatingDistribution, Scope } from './public.ts';

/**
 * Personal comparison (my-analytics) DTO. Returned only to the verified signed-in user, never
 * mixed into the public API, the static snapshot or any shared cache (docs/personal-comparison.md).
 *
 * `all` and `mine` come from ONE fact selection (same scope, same public population, same
 * dataset_version): mine is the subset of all whose contributor is the verified user.
 */

/** Counts and rates of one side (all or mine) for the current scope. */
export interface CompareSummary {
  rating?: { count: number; mean: number | null };
  /** 신고일 기준 */
  report_count: number;
  /** 처리완료일 기준 */
  completed_count: number;
  accepted: number;
  partial: number;
  rejected: number;
  /** D = accepted + partial + rejected among completed */
  result_known: number;
  result_unknown: number;
  fine_count: number;
  /** distinct located report points (신고일 기준) */
  point_count: number;
  /** 수용률 A/D×100, null when D = 0 */
  accept_rate: number | null;
  /** 일부수용률 P/D×100, null when D = 0 */
  partial_rate: number | null;
  /** J/D×100, null when D = 0 */
  reject_rate: number | null;
  /** fine/C×100, null when C = 0 */
  fine_rate: number | null;
  /** 답변까지 걸린 기간(일), answer-date cohort. Averages may exceed the all side — no subset rule. */
  duration: { count: number; mean_days: number | null; median_days: number | null; p90_days: number | null };
  /** 답변에 적힌 과태료 금액 (원), completion cohort; only amounts the consent policy publishes are summed. */
  fine_amount: CompareFineAmount;
}

export interface CompareFineAmount {
  fine_count: number;
  confirmed_count: number;
  /** exact won; null when no amount is confirmed (never shown as 0원) */
  sum_won: number | null;
  mean_won: number | null;
  median_won: number | null;
  unconfirmed_count: number;
  undisclosed_count: number;
  /** some fines lack a usable amount → the sum covers only part of them */
  partial: boolean;
}

export type DiffReason = 'no_all' | 'no_mine' | null;

/** Differences: counts are expressed as my share of all (%), rates as mine − all (%p). */
export interface CompareDiff {
  report_share: number | null;
  completed_share: number | null;
  fine_share: number | null;
  point_share: number | null;
  accept_rate_pp: number | null;
  partial_rate_pp: number | null;
  reject_rate_pp: number | null;
  fine_rate_pp: number | null;
  /** mine − all, in days (null when either side has no computable report) */
  duration_median_days_diff: number | null;
  duration_mean_days_diff: number | null;
  /** my share (%) of the confirmed fine-amount sum; null when all has no confirmed amount */
  fine_amount_sum_share: number | null;
  /** mine − all mean amount per confirmed fine (원) */
  fine_amount_mean_won_diff: number | null;
  /** why rate differences are null: all side has no denominator, or mine side has none */
  rate_reason: DiffReason;
}

export interface CompareSide {
  rating?: { count: number; mean: number | null };
  report_count: number;
  completed_count: number;
  result_known: number;
  accepted: number;
  partial: number;
  rejected: number;
  fine_count: number;
  accept_rate: number | null;
  partial_rate: number | null;
  duration_count: number;
  duration_median_days: number | null;
  fine_amount_confirmed_count: number;
  fine_amount_sum_won: number | null;
}

export interface CompareRegionRow {
  level: 'sido' | 'sgg' | 'unknown';
  region_code: string | null;
  name: string;
  sido_code: string | null;
  all: CompareSide;
  mine: CompareSide;
  accept_rate_pp: number | null;
  partial_rate_pp: number | null;
  duration_median_days_diff: number | null;
}

export interface CompareEntityRow {
  kind: 'agency' | 'manager';
  key: string;
  agency_key: string | null;
  manager_key: string | null;
  agency_name: string;
  manager_name: string | null;
  all: CompareSide;
  mine: CompareSide;
  accept_rate_pp: number | null;
  partial_rate_pp: number | null;
  duration_median_days_diff: number | null;
}

export interface CompareMonth {
  month: string;
  all_report_count: number | null;
  mine_report_count: number | null;
  all_completed_count: number | null;
  mine_completed_count: number | null;
  all_accept_rate: number | null;
  mine_accept_rate: number | null;
  all_duration_median_days: number | null;
  mine_duration_median_days: number | null;
  all_rating?: { count: number; mean: number | null };
  mine_rating?: { count: number; mean: number | null };
  /** A05: the viewer's outcome counts / fines of the completion month (absent on older servers) */
  mine_outcomes?: OutcomeCounts | null;
  mine_fine_count?: number | null;
}

/** A place (address-v1, same key as the public map) that contains at least one of my reports or completions in the scope. */
export interface MyPoint {
  key: string;
  lat: number;
  lng: number;
  region_code: string | null;
  mine_report_count: number;
  mine_completed_count: number;
  /** true when another contributor also recorded this point in the scope (함께 기록한 지점) */
  shared: boolean;
}

/** No account ids, emails or tokens: only what the viewer needs to understand an empty result. */
export interface ViewerState {
  /** active = consent exists and contributor is active; none = never shared; suspended; revoked */
  contributor: 'active' | 'none' | 'suspended' | 'revoked';
  /** facts of this viewer that are part of the public population at all (any date) */
  has_public_facts: boolean;
}

export interface PersonalCompare {
  schema_version: 2;
  dataset_version: string;
  scope: Scope;
  viewer: ViewerState;
  all: CompareSummary;
  mine: CompareSummary;
  diff: CompareDiff;
  regions: CompareRegionRow[];
  agencies: CompareEntityRow[];
  managers: CompareEntityRow[];
  monthly: CompareMonth[];
  my_points: MyPoint[];
  /** A01/A06 of the viewer's own completion cohort; absent on older servers */
  analytics?: { duration: DurationDistribution; rating: RatingDistribution };
}
