export type Category = 'all' | 'traffic' | 'parking' | 'other';
export type CapabilityState = 'supported' | 'partial' | 'missing';
export type TimeBasis = 'report_date' | 'completed_date';

export interface Scope {
  start: string;
  end: string;
  category: Category;
  region_code: string | null;
  agency_key: string | null;
  manager_key: string | null;
  bbox: [number, number, number, number] | null;
  /** 위반법규 exact match (observation-v2); LAW_NONE selects facts without a law (법규 미상); null = all laws */
  law: string | null;
}

/** Scope value that selects facts whose violation law is unknown (null). Never a real law text. */
export const LAW_NONE = '__none__';
export const LAW_MAX_CODE_POINTS = 60;

/** Characters the upload rule clean() never leaves in a text (C0 controls, DEL); the ingest refuses them. */
export const LAW_FORBIDDEN = /[\u0000-\u001f\u007f]/;

/** A law filter value: LAW_NONE, or any storable law text (1..60 code points without C0 controls or DEL).
 *  Outer spaces are allowed: clean() truncates after trimming, so a stored law may end with a space. */
export function isLawParam(value: string): boolean {
  if (value === LAW_NONE) return true;
  const n = [...value].length;
  return n >= 1 && n <= LAW_MAX_CODE_POINTS && !LAW_FORBIDDEN.test(value);
}

/** A map viewport may extend beyond Korea at nationwide zoom. Keep real geographic bounds intact. */
export function parseBbox(raw: string): Scope['bbox'] {
  const parts = raw.split(',');
  const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
  if (parts.length !== 4 || parts.some(part => !decimal.test(part.trim()))) return null;
  const values = parts.map(Number);
  if (values.some(value => !Number.isFinite(value))) return null;
  const [west, south, east, north] = values;
  if (west < -180 || east > 180 || south < -90 || north > 90 || west > east || south > north) return null;
  return values as NonNullable<Scope['bbox']>;
}

export interface Capability {
  status: CapabilityState;
  reason: string | null;
  coverage: { eligible: number; total: number } | null;
}

export interface PublicMeta {
  schema_version: 2;
  dataset_version: string;
  sample: boolean;
  source_updated_at: string | null;
  generated_at: string | null;
  published_at: string | null;
  data_min: string | null;
  data_max: string | null;
  coverage_note: string;
  /** Who the numbers describe. 'shared_completed_reports' = only answered reports community users shared. */
  population?: 'shared_completed_reports';
  /** Facts in scope without coordinates: counted in statistics, never drawn as map points. */
  location_missing?: number;
  dedupe_policy_version: string;
  capabilities: Record<string, Capability>;
}

export interface CountMetric {
  value: number | null;
  basis: TimeBasis;
  denominator: number | null;
  eligible: number;
  missing: number;
  previous: number | null;
  delta: number | null;
  delta_percent: number | null;
  delta_reason: 'new' | 'no_baseline' | null;
  note?: string;
}

export interface RateMetric extends CountMetric {
  numerator: number | null;
  unit: 'percent';
}

export interface OutcomeCounts {
  accepted: number;
  partial: number;
  rejected: number;
  result_known: number;
  result_unknown: number;
}

/** 답변까지 걸린 기간 (docs/metrics-catalog.md processing_duration). Days, answer-date cohort. */
export interface DurationSummary {
  basis: 'completed_date';
  count: number;
  mean_days: number | null;
  median_days: number | null;
  p90_days: number | null;
  min_days: number | null;
  max_days: number | null;
  excluded: { no_report_date: number; reversed: number };
  /** answered reports of the report-date period without any answer date (period unknown) */
  answer_date_missing: number;
}

/** Compact duration for rows (region, agency, manager, month). */
export interface DurationBrief {
  count: number;
  median_days: number | null;
  mean_days: number | null;
}

/** 답변에 적힌 과태료 금액 (docs/metrics-catalog.md fine_amount). Not a paid or legally final amount. */
export interface FineAmountSummary {
  basis: 'completed_date';
  fine_count: number;
  confirmed_count: number;
  sum_won: number | null;
  mean_won: number | null;
  median_won: number | null;
  zero_count: number;
  unconfirmed_count: number;
  undisclosed_count: number;
  conflict_count: number;
  penalty_count: number;
  combined_count: number;
  partial: boolean;
}

export interface FineAmountBrief {
  fine_count: number;
  confirmed_count: number;
  sum_won: number | null;
  mean_won: number | null;
}

export interface Overview {
  report_count: CountMetric;
  completed_count: CountMetric;
  accepted_including_partial: RateMetric;
  fine_count: CountMetric;
  point_count: CountMetric;
  contributor_count: CountMetric;
  outcomes: OutcomeCounts | null;
  /** null = not provided by the source (never replaced by an empty summary) */
  processing_duration?: DurationSummary | null;
  fine_amount?: FineAmountSummary | null;
}

export interface PublicPoint {
  key: string;
  lat: number;
  lng: number;
  /** Aggregated map node; lat/lng is a display centroid, never a source coordinate. */
  aggregate?: boolean;
  point_count?: number;
  bbox?: [number, number, number, number];
  address: string | null;
  region_code: string | null;
  report_count: number;
  completed_count: number | null;
  outcomes: OutcomeCounts | null;
  fine_count: number | null;
}

export interface MonthlyBucket {
  month: string;
  report_count: number | null;
  completed_count: number | null;
  fine_count: number | null;
  outcomes: OutcomeCounts | null;
  partial: boolean;
  coverage_note: string | null;
  duration?: DurationBrief | null;
  fine_amount?: FineAmountBrief | null;
}

export interface PublicEntity {
  key: string;
  agency_key: string | null;
  manager_key: string | null;
  agency_name: string;
  manager_name: string | null;
  completed_count: number;
  outcomes: OutcomeCounts;
  fine_count: number | null;
  duration?: DurationBrief | null;
  fine_amount?: FineAmountBrief | null;
}

/** Region row at one level (docs/region-boundaries.md). region_code = official 2026-07-01 법정 code
 *  (2-digit 시도 or 5-digit 시군구); null with level 'unknown' = 지역 미확인 (kept in every total).
 *  report_count uses the report date; completed/outcomes/fine use the completion date. */
export interface PublicRegion {
  level: 'sido' | 'sgg' | 'unknown';
  region_code: string | null;
  name: string;
  /** parent 시도 of a 시군구 row */
  sido_code: string | null;
  report_count: number;
  completed_count: number;
  outcomes: OutcomeCounts;
  fine_count: number;
  duration?: DurationBrief | null;
  fine_amount?: FineAmountBrief | null;
}

/** 위반법규별 현황 row (docs/metrics-catalog.md law_results). Completion-date cohort of the scope, same facts and
 *  denominators as the rest of the dashboard. law null = 법규 미상 (not stated, v1 upload or not published). */
export interface PublicLaw {
  law: string | null;
  /** C: answered reports whose completion date is in the range */
  completed_count: number;
  outcomes: OutcomeCounts;
  /** A/D×100, null when D = 0 */
  accept_rate: number | null;
  /** P/D×100, null when D = 0 (shown separately from accept_rate) */
  partial_rate: number | null;
  /** F: 과태료 처분 */
  fine_count: number;
  /** F/C×100, null when C = 0 */
  fine_rate: number | null;
  penalty_count: number;
  warning_count: number;
  /** answered fine amounts, confirmed and published only (same masking as every other amount) */
  fine_amount: FineAmountBrief;
}

export interface PublicVehicle {
  rank: number;
  rank_item_id: string;
  masked_plate: string;
  report_count: number;
  percentage: number | null;
}

export interface DashboardData {
  meta: PublicMeta;
  scope: Scope;
  overview: Overview;
  points: PublicPoint[];
  monthly: MonthlyBucket[];
  agencies: PublicEntity[];
  managers: PublicEntity[];
  /** null = the source did not provide region rows (never replaced by an empty list). */
  regions: PublicRegion[] | null;
  /** 위반법규별 현황; null = the source did not provide law rows (never replaced by an empty list) */
  laws: PublicLaw[] | null;
  vehicles: PublicVehicle[];
  vehicle_total_scope_reports: number | null;
  vehicle_identifiable_reports: number | null;
}

export const DEMO_SCOPE: Scope = {
  start: '2025-09-25', end: '2026-09-24', category: 'all', region_code: null,
  agency_key: null, manager_key: null, bbox: null, law: null,
};

function recentTwelveMonths(): Pick<Scope, 'start' | 'end'> {
  const end = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const [year, month, day] = end.split('-').map(Number);
  const priorMonthDays = new Date(Date.UTC(year - 1, month, 0)).getUTCDate();
  const first = new Date(Date.UTC(year - 1, month - 1, Math.min(day, priorMonthDays)));
  first.setUTCDate(first.getUTCDate() + 1);
  return { start: first.toISOString().slice(0, 10), end };
}

export const DEFAULT_SCOPE: Scope = { ...DEMO_SCOPE, ...recentTwelveMonths() };
