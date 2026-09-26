import type { Scope } from './public.ts';

/**
 * Personal comparison (my-analytics) DTO. Returned only to the verified signed-in user, never
 * mixed into the public API, the static snapshot or any shared cache (docs/personal-comparison.md).
 *
 * `all` and `mine` come from ONE fact selection (same scope, same public population, same
 * dataset_version): mine is the subset of all whose contributor is the verified user.
 */

/** Counts and rates of one side (all or mine) for the current scope. */
export interface CompareSummary {
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
  /** (A+P)/D×100, null when D = 0 */
  accept_rate: number | null;
  /** J/D×100, null when D = 0 */
  reject_rate: number | null;
  /** fine/C×100, null when C = 0 */
  fine_rate: number | null;
}

export type DiffReason = 'no_all' | 'no_mine' | null;

/** Differences: counts are expressed as my share of all (%), rates as mine − all (%p). */
export interface CompareDiff {
  report_share: number | null;
  completed_share: number | null;
  fine_share: number | null;
  point_share: number | null;
  accept_rate_pp: number | null;
  reject_rate_pp: number | null;
  fine_rate_pp: number | null;
  /** why rate differences are null: all side has no denominator, or mine side has none */
  rate_reason: DiffReason;
}

export interface CompareSide {
  report_count: number;
  completed_count: number;
  result_known: number;
  accepted_partial: number;
  rejected: number;
  fine_count: number;
  accept_rate: number | null;
}

export interface CompareRegionRow {
  region_code: string | null;
  all: CompareSide;
  mine: CompareSide;
  accept_rate_pp: number | null;
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
}

export interface CompareMonth {
  month: string;
  all_report_count: number | null;
  mine_report_count: number | null;
  all_completed_count: number | null;
  mine_completed_count: number | null;
  all_accept_rate: number | null;
  mine_accept_rate: number | null;
}

/** A located point that contains at least one of my reports or completions in the scope. */
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
}
