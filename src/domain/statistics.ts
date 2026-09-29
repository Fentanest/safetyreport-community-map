/**
 * 맞춤 통계 (S05–S08) contract, shared by the server aggregator (server/statistics.ts), the Edge handlers, the Zod
 * response schema and the page. The request is declarative: registry ids only — never SQL, column or table names.
 */
import type { Scope } from './public.ts';

export type StatRole = 'row' | 'column' | 'filter';
export type DateBasis = 'completed_date' | 'report_date';
export type Population = 'all' | 'mine' | 'compare';
export type MetricUnit = 'count' | 'percent' | 'won' | 'days' | 'score';

export interface DimensionDef {
  id: string;
  label: string;
  group: '지역·장소' | '기관·담당자' | '법규·분류' | '처리 결과' | '날짜' | '구간';
  roles: StatRole[];
  /** member order: calendar order, a fixed natural order, or by answered count */
  order: 'date' | 'natural' | 'count';
  /** members are many (search + pick in the target selector instead of a long list) */
  searchable: boolean;
  description: string;
}

export interface MetricDef {
  id: string;
  label: string;
  unit: MetricUnit;
  kind: 'count' | 'rate' | 'stat' | 'distinct';
  /** rates: which set is the 100% (K = 결과 확인 = 수용+일부+불수용, C = 답변 완료) */
  denominator: 'K' | 'C' | 'amount' | 'duration' | 'rating' | null;
  description: string;
}

export interface StatsFilter {
  dimension: string;
  /** OR within one dimension; different dimensions are AND */
  members: string[];
}

export interface StatisticsSpec {
  version: 1;
  date_basis: DateBasis;
  population: Population;
  rows: string[];
  columns: string[];
  metrics: string[];
  filters: StatsFilter[];
  /** one address place (pl1:…) handed over from the map; null = no address condition */
  place_key: string | null;
}

export const STAT_LIMITS = { rows: 3, columns: 2, metrics: 6, filters: 8, members: 50, cells: 5000, specChars: 6000 } as const;

export interface StatMember { key: string; label: string }
export interface StatValue { value: number | null; numerator: number | null; denominator: number | null; reason: 'zero_denominator' | 'no_data' | null }
export interface StatCell {
  row: string[];
  col: string[];
  side: 'all' | 'mine';
  /** metric id → value */
  values: Record<string, StatValue>;
}
export interface StatTotal { key: string[]; side: 'all' | 'mine'; values: Record<string, StatValue> }

export interface StatisticsResult {
  schema_version: 1;
  dataset_version: string;
  scope: Scope;
  spec: StatisticsSpec;
  /** row / column member tuples in display order (labels per dimension) */
  row_members: Array<{ key: string[]; label: string[] }>;
  col_members: Array<{ key: string[]; label: string[] }>;
  /** only combinations that have at least one answered report (a missing combination is "해당 신고 없음", not 0) */
  cells: StatCell[];
  /** recomputed from the raw union (never a sum/average of cells): per row, per column, and the grand total */
  row_totals: StatTotal[];
  col_totals: StatTotal[];
  grand_totals: StatTotal[];
  /** reports of the cohort per side (one date basis = scope.date_basis = spec.date_basis) */
  population_count: { all: number | null; mine: number | null };
  /**
   * reports whose SELECTED date is empty while their other date is inside the period, per side (never added
   * across all/mine: the same report can be on both sides). `no_report_date` = the first reported side's value.
   */
  excluded: { no_report_date: number; selected_date_missing?: { all: number | null; mine: number | null } };
  /** D17 time axes: 'spine' = every calendar unit of the period listed (0 / null / no_data kept apart);
   *  'explicit' = only the members picked in a filter (a gap is NOT a queried 0); 'other_date' = the other date
   *  used as a classification (its own values, never re-filtered by the selected period) */
  date_axes?: Array<{ dimension: string; role: 'row' | 'column'; mode: 'spine' | 'explicit' | 'other_date' }>;
  cohort_policy_version?: string;
  /** count of every selected filter member under the other conditions (0 = "현재 조건 0건", kept as a chip) */
  filter_members: Array<{ dimension: string; key: string; label: string | null; count: number; status: MemberStatus }>;
  complete: true;
}

/** C05 availability of a selected key under the viewer's current permission:
 *  ok = has reports now · zero = exists in this period's permitted data, only the other conditions exclude it
 *  (현재 조건 0건) · unconfirmed = not found in this period's permitted data (period, policy, withdrawn or unknown key:
 *  deliberately not told apart, so nothing about other people's data is revealed). */
export type MemberStatus = 'ok' | 'zero' | 'unconfirmed';
export interface StatCandidate { key: string; label: string; sub: string | null; count: number; status?: MemberStatus }
export interface StatCandidatesPage {
  dataset_version: string;
  kind: string;
  items: StatCandidate[];
  total: number;
  next_cursor: number | null;
  /** current counts of already-selected keys (0 when the other conditions exclude them) */
  selected: StatCandidate[];
}

export interface StatCatalog { dimensions: DimensionDef[]; metrics: MetricDef[]; limits: typeof STAT_LIMITS }
