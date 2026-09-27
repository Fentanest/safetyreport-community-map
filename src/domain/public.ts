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
}

/** Region row (region_code as stored by ingest, e.g. '서울 중구'; null = 지역 미상).
 *  report_count uses the report date; completed/outcomes/fine use the completion date. */
export interface PublicRegion {
  region_code: string | null;
  report_count: number;
  completed_count: number;
  outcomes: OutcomeCounts;
  fine_count: number;
  duration?: DurationBrief | null;
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
  vehicles: PublicVehicle[];
  vehicle_total_scope_reports: number | null;
  vehicle_identifiable_reports: number | null;
}

export const DEMO_SCOPE: Scope = {
  start: '2025-09-25', end: '2026-09-24', category: 'all', region_code: null,
  agency_key: null, manager_key: null, bbox: null,
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
