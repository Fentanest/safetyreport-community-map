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
  /** 위반법규 article key (lawKey: `{법} 제N조[의M]`, 항 dropped); LAW_NONE selects facts without a law (법규 미상); null = all laws */
  law: string | null;
}

/** Scope value that selects facts whose violation law is unknown (null). Never a real law text. */
export const LAW_NONE = '__none__';
/** Filter parameter bound: a stored law is ≤ 60 code points, and its article key can be one longer
 *  ('도로교통법제32조' → '도로교통법 제32조'), so parameters allow some room. The ingest bound stays 60. */
export const LAW_MAX_CODE_POINTS = 80;

/** Characters the upload rule clean() never leaves in a text (C0 controls, DEL); the ingest refuses them. */
export const LAW_FORBIDDEN = /[\u0000-\u001f\u007f]/;

/** 조 단위 key (user decision 2026-09-28): `{법이름} 제{N}조[의{M}]`. The parser writes
 *  `{법이름} 제{N}조[의{M}][제{K}항|{K}항]` (safetyreport services/parser.py); the paragraph (항) is dropped,
 *  `조의M` is a different article and is kept, whitespace differences and leading zeros are absorbed.
 *  A value outside that form is kept as its trimmed text (never dropped); null or blank → null (법규 미상). */
// law name as the parser captures it: Hangul, '·' and spaces, ending in 법 (「…법」 or 도로교통법)
const LAW_ARTICLE = /^([가-힣·\s]{1,60}?법)\s*제\s*0*(\d+)\s*조(?:\s*의\s*0*(\d+))?(?:\s*제?\s*\d{1,3}\s*항)?$/u;
export function lawKey(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const text = raw.trim();
  if (!text) return null;
  const m = LAW_ARTICLE.exec(text);
  if (!m) return text;
  const name = m[1].replace(/\s+/g, '');
  return `${name} 제${m[2]}조${m[3] ? `의${m[3]}` : ''}`;
}

/** A law filter value: LAW_NONE, or a law text / article key (1..80 code points without C0 controls or DEL).
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

/** Numeric response satisfaction only. Count is the denominator of mean; no free-text reason. */
export interface RatingBrief { count: number; mean: number | null }

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
  rating?: RatingBrief | null;
  /** S01: 계도(경고) count of the completion cohort; undefined = older server (shown as 서버 미지원, never 0) */
  warning_count?: number | null;
}

/** Map place grouping (R07). 'address-v1' = one pin per normalized full address (server/places.ts).
 *  Older servers grouped by exact coordinate (point_key) and send no grouping_version. */
export const PLACE_GROUPING_VERSION = 'address-v1';

export interface PublicPoint {
  /** place key (address-v1: `pl1:<hash of the normalized address>`); a cluster key for aggregate nodes */
  key: string;
  /** display position only: a deterministic representative of the place's own source coordinates,
   *  or the report-weighted centroid of an aggregate node. Never written back to any source fact. */
  lat: number;
  lng: number;
  /** Aggregated map node; lat/lng is a display centroid, never a source coordinate. */
  aggregate?: boolean;
  /** places inside an aggregate node (address-v1: distinct addresses) */
  point_count?: number;
  bbox?: [number, number, number, number];
  address: string | null;
  region_code: string | null;
  report_count: number;
  completed_count: number | null;
  outcomes: OutcomeCounts | null;
  fine_count: number | null;
  /** 계도(경고) 처분 건수, completion basis. undefined = the server does not report it (never shown as 0). */
  warning_count?: number | null;
  /** same as key for an address place; absent on aggregate nodes and on pre-address servers */
  place_key?: string;
  grouping_version?: string;
}

/** Facts of the current range that cannot be drawn as an address pin (R07), by reason; disjoint.
 *  sum(points.report_count) + no_address.reported + no_coordinates.reported = overview.report_count (same for completed). */
export interface MapUnplaced {
  no_address: { reported: number; completed: number };
  no_coordinates: { reported: number; completed: number };
}

/** Place detail (R05/R06): every agency and manager that handled the answered reports of ONE address
 *  under the current scope, aggregated from raw facts by place_key (never by a coordinate bbox). */
export interface PlaceDetail {
  dataset_version: string;
  scope: Scope;
  place: PublicPoint;
  agencies: PublicEntity[];
  managers: PublicEntity[];
  agency_total: number;
  manager_total: number;
}

/** A01 답변까지 걸린 기간 구간별 건수 (completion cohort). Equal-width bins plus one open tail bin. */
export interface DurationBucket { lower: number; upper: number | null; label: string; count: number; percentage: number | null }
export interface DurationDistribution {
  basis: 'completed_date';
  bucket_width_days: number;
  buckets: DurationBucket[];
  valid_count: number;
  excluded: { no_report_date: number; reversed: number };
  median_days: number | null;
  mean_days: number | null;
  p90_days: number | null;
}

/** A02 기관(또는 선택 기관의 담당자) × 위반법규 cross-tab; each cell counted from raw facts. */
export interface HeatmapRow {
  key: string;
  agency_key: string | null;
  manager_key: string | null;
  agency_name: string;
  manager_name: string | null;
  completed_count: number;
}
export interface HeatmapCell {
  row_key: string;
  /** lawKey value, or LAW_NONE for 법규 미상 */
  law_key: string;
  completed_count: number;
  outcomes: OutcomeCounts;
  fine_count: number;
}
export interface LawHeatmap {
  row_kind: 'agency' | 'manager';
  rows: HeatmapRow[];
  laws: Array<{ law_key: string; completed_count: number }>;
  cells: HeatmapCell[];
  total_rows: number;
  total_laws: number;
}

/** A03 처리기간 × 처리결과: one point per agency/manager of the completion cohort. */
export interface ScatterEntity {
  key: string;
  agency_key: string | null;
  manager_key: string | null;
  agency_name: string;
  manager_name: string | null;
  completed_count: number;
  /** answered reports with a computable duration (x is null when 0) */
  duration_count: number;
  median_days: number | null;
  outcomes: OutcomeCounts;
  fine_count: number;
}
export interface EntityScatter {
  agencies: ScatterEntity[];
  managers: ScatterEntity[];
  agency_total: number;
  manager_total: number;
}

/** A04 차량별 서로 다른 신고일 수 분포 (completion cohort, parsed plates only; no plate text or hash). */
export interface VehicleDayBucket { label: string; min: number; max: number | null; vehicle_count: number; percentage: number | null }
export interface VehicleDayDistribution {
  basis: 'completed_date';
  buckets: VehicleDayBucket[];
  vehicle_count: number;
  repeat_vehicle_count: number;
  repeat_share: number | null;
  excluded: { no_plate: number; no_report_date: number };
}

/** A06 처리결과별 별점 분포. counts[i] = number of (i+1)-point ratings; mean over rating_count. */
export interface RatingRow { status: 'all' | 'accepted' | 'partial' | 'rejected' | 'fine' | 'unknown'; counts: [number, number, number, number, number]; rating_count: number; mean: number | null }
export interface RatingDistribution { basis: 'completed_date'; rows: RatingRow[]; unrated: number }

/** New analytics A01–A06 computed from ONE selection with the dashboard (same scope/version). A05 uses `monthly`. */
export interface DashboardAnalytics {
  duration: DurationDistribution;
  heatmap: LawHeatmap;
  scatter: EntityScatter;
  vehicle_days: VehicleDayDistribution;
  rating: RatingDistribution;
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
  rating?: RatingBrief | null;
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
  /** 계도(경고) 처분 건수; undefined on older servers */
  warning_count?: number | null;
  /** 경찰 구분 (server/agencyType.ts); undefined on older servers */
  agency_type?: 'police' | 'non_police' | 'unknown';
  duration?: DurationBrief | null;
  fine_amount?: FineAmountBrief | null;
  rating?: RatingBrief | null;
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
  rating?: RatingBrief | null;
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
  rating?: RatingBrief | null;
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
  /** S01: how many agencies/managers the scope really has (the arrays are a first page of at most 100);
   *  undefined = older server (the UI then says "많은 순 N개" without claiming a total) */
  agency_total?: number;
  manager_total?: number;
  /** null = the source did not provide region rows (never replaced by an empty list). */
  regions: PublicRegion[] | null;
  /** 위반법규별 현황; null = the source did not provide law rows (never replaced by an empty list) */
  laws: PublicLaw[] | null;
  vehicles: PublicVehicle[];
  vehicle_total_scope_reports: number | null;
  vehicle_identifiable_reports: number | null;
  /** null = the server does not provide A01–A04/A06 yet (never replaced by empty charts) */
  analytics?: DashboardAnalytics | null;
  /** null = the server does not report the unplaced breakdown */
  map_unplaced?: MapUnplaced | null;
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
