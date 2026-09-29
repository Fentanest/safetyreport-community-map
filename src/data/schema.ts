import { z } from 'zod';
import { COHORT_POLICY_VERSION, isLawParam } from '../domain/public';
import { SORT_COLUMNS } from '../domain/tableSort';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const count = z.number().int().nonnegative();
const positive = z.number().finite();
const nullableCount = count.nullable();
const basis = z.enum(['report_date', 'completed_date']);

export const scopeSchema = z.strictObject({
  date_basis: basis, start: date, end: date, category: z.enum(['all', 'traffic', 'parking', 'other']),
  region_code: z.string().nullable(), agency_key: z.string().nullable(),
  manager_key: z.string().nullable(), bbox: z.tuple([positive, positive, positive, positive]).nullable(),
  // 위반법규 exact text or '__none__' (법규 미상); null = all laws
  law: z.string().min(1).max(120).refine(isLawParam).nullable(),
});

const capability = z.strictObject({
  status: z.enum(['supported', 'partial', 'missing']), reason: z.string().nullable(),
  coverage: z.strictObject({ eligible: count, total: count }).nullable(),
});

export const metaSchema = z.strictObject({
  schema_version: z.literal(2), dataset_version: z.string().min(1), sample: z.boolean(),
  source_updated_at: z.string().nullable(), generated_at: z.string().nullable(), published_at: z.string().nullable(),
  data_min: date.nullable(), data_max: date.nullable(), coverage_note: z.string(),
  dedupe_policy_version: z.string(), capabilities: z.record(z.string(), capability),
  cohort_policy_version: z.string().max(40).optional(), today_kst: date.optional(),
  basis_bounds: z.strictObject({
    report_date: z.strictObject({ min: date.nullable(), max: date.nullable() }),
    completed_date: z.strictObject({ min: date.nullable(), max: date.nullable() }),
  }).nullable().optional(),
});
/** Every analytics response of the single-date contract echoes this exact value (EX-09: an older dual-set server
 *  omits it, and its numbers are never shown under the new labels). */
const cohortPolicy = z.literal(COHORT_POLICY_VERSION);
const cohortDiagnostics = z.strictObject({ date_basis: basis, selected_date_missing: count, other_date_missing: count });

const countMetric = z.strictObject({
  value: nullableCount, basis, denominator: nullableCount, eligible: count, missing: count,
  previous: nullableCount, delta: z.number().int().nullable(), delta_percent: z.number().nullable(),
  delta_reason: z.enum(['new', 'no_baseline']).nullable(), note: z.string().optional(),
});
const rateMetric = countMetric.extend({
  value: z.number().min(0).max(100).nullable(), previous: z.number().min(0).max(100).nullable(),
  delta: z.number().nullable(), numerator: nullableCount, unit: z.literal('percent'),
});
const outcomes = z.strictObject({
  accepted: count, partial: count, rejected: count, result_known: count, result_unknown: count,
});

const durationBrief = z.strictObject({
  count, median_days: z.number().min(0).nullable(), mean_days: z.number().min(0).nullable(),
}).nullable().optional();
const durationSummary = z.strictObject({
  basis, count,
  mean_days: z.number().min(0).nullable(), median_days: z.number().min(0).nullable(), p90_days: z.number().min(0).nullable(),
  min_days: z.number().min(0).nullable(), max_days: z.number().min(0).nullable(),
  excluded: z.strictObject({ no_report_date: count, reversed: count, no_answer_date: count.optional() }), answer_date_missing: count,
}).nullable().optional();

const won = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const fineBrief = z.strictObject({
  fine_count: count, confirmed_count: count, sum_won: won.nullable(), mean_won: z.number().min(0).nullable(),
}).nullable().optional();
const fineSummary = z.strictObject({
  basis, fine_count: count, confirmed_count: count, sum_won: won.nullable(),
  mean_won: z.number().min(0).nullable(), median_won: z.number().min(0).nullable(), zero_count: count,
  unconfirmed_count: count, undisclosed_count: count, conflict_count: count, penalty_count: count, combined_count: count,
  partial: z.boolean(),
}).nullable().optional();
const rating = z.strictObject({ count, mean: z.number().min(1).max(5).nullable() }).nullable().optional();

export const overviewSchema = z.strictObject({
  report_count: countMetric, completed_count: countMetric, accepted_including_partial: rateMetric,
  fine_count: countMetric, point_count: countMetric, contributor_count: countMetric, outcomes: outcomes.nullable(),
  processing_duration: durationSummary, fine_amount: fineSummary, rating,
  warning_count: nullableCount.optional(), cohort: cohortDiagnostics.nullable().optional(),
});

export const pointSchema = z.strictObject({
  key: z.string(), lat: z.number().min(32).max(39.5), lng: z.number().min(124).max(132),
  aggregate: z.boolean().optional(), point_count: count.optional(),
  bbox: z.tuple([positive, positive, positive, positive]).optional(),
  address: z.string().nullable(), region_code: z.string().regex(/^\d{5}$/).nullable(), report_count: count,
  completed_count: nullableCount, outcomes: outcomes.nullable(), fine_count: nullableCount,
  // R06/R07 (address-v1). Optional: an older server omits them and the UI shows "지원하지 않음", never 0.
  warning_count: nullableCount.optional(), place_key: z.string().max(40).optional(), grouping_version: z.string().max(40).optional(),
});

export const monthlySchema = z.strictObject({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), report_count: nullableCount,
  completed_count: nullableCount, fine_count: nullableCount, outcomes: outcomes.nullable(),
  partial: z.boolean(), coverage_note: z.string().nullable(), duration: durationBrief, fine_amount: fineBrief, rating,
  interval_start: date.optional(), interval_end: date.optional(), range_partial: z.boolean().optional(), in_progress: z.boolean().optional(),
});

export const entitySchema = z.strictObject({
  key: z.string(), agency_key: z.string().nullable(), manager_key: z.string().nullable(),
  agency_name: z.string(), manager_name: z.string().nullable(),
  completed_count: count, outcomes, fine_count: nullableCount, duration: durationBrief, fine_amount: fineBrief, rating,
  warning_count: nullableCount.optional(), agency_type: z.enum(['police', 'non_police', 'unknown']).optional(),
});

export const regionSchema = z.strictObject({
  level: z.enum(['sido', 'sgg', 'unknown']), region_code: z.string().regex(/^\d{2}(\d{3})?$/).nullable(),
  name: z.string().max(40), sido_code: z.string().regex(/^\d{2}$/).nullable(),
  report_count: count, completed_count: count,
  outcomes, fine_count: count, duration: durationBrief, fine_amount: fineBrief, rating,
});

const rate = z.number().min(0).max(100).nullable();
export const lawSchema = z.strictObject({
  // row text is displayed as text only; no refine here so one odd stored value cannot break the whole dashboard
  law: z.string().min(1).max(120).nullable(),
  completed_count: count, outcomes, accept_rate: rate, partial_rate: rate,
  fine_count: count, fine_rate: rate, penalty_count: count, warning_count: count,
  fine_amount: z.strictObject({
    fine_count: count, confirmed_count: count, sum_won: won.nullable(), mean_won: z.number().min(0).nullable(),
  }),
  rating,
});

export const vehicleSchema = z.strictObject({
  rank: z.number().int().min(1).max(5), rank_item_id: z.string().regex(/^r[1-5]$/),
  // Optional short region (kept visible), then the masked number: 경기7*자*6*3, 1*가*4*6.
  masked_plate: z.string().regex(/^(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)?[0-9]\*[0-9가-힣]\*[0-9]\*[0-9]{1,2}$/),
  report_count: z.number().int().positive(), percentage: z.number().min(0).max(100).nullable(),
});

// ── A01–A04, A06 (docs/implementation/dashboard-redesign) ──────────────────────────────────────────────
const pctN = z.number().min(0).max(100).nullable();
export const durationDistributionSchema = z.strictObject({
  basis, bucket_width_days: z.number().int().positive(),
  buckets: z.array(z.strictObject({ lower: count, upper: count.nullable(), label: z.string().max(20), count, percentage: pctN })).max(60),
  valid_count: count, excluded: z.strictObject({ no_report_date: count, reversed: count }),
  median_days: z.number().min(0).nullable(), mean_days: z.number().min(0).nullable(), p90_days: z.number().min(0).nullable(),
});
const heatmapSchema = z.strictObject({
  row_kind: z.enum(['agency', 'manager']),
  rows: z.array(z.strictObject({ key: z.string().max(330), agency_key: z.string().nullable(), manager_key: z.string().nullable(),
    agency_name: z.string().max(200), manager_name: z.string().max(160).nullable(), completed_count: count })).max(40),
  laws: z.array(z.strictObject({ law_key: z.string().min(1).max(120), completed_count: count })).max(16),
  cells: z.array(z.strictObject({ row_key: z.string().max(330), law_key: z.string().min(1).max(120), completed_count: count, outcomes, fine_count: count })).max(640),
  total_rows: count, total_laws: count,
});
const scatterEntity = z.strictObject({
  key: z.string().max(330), agency_key: z.string().nullable(), manager_key: z.string().nullable(),
  agency_name: z.string().max(200), manager_name: z.string().max(160).nullable(), completed_count: count,
  duration_count: count, median_days: z.number().min(0).nullable(), outcomes, fine_count: count,
});
export const ratingDistributionSchema = z.strictObject({
  basis, unrated: count,
  rows: z.array(z.strictObject({ status: z.enum(['all', 'accepted', 'partial', 'rejected', 'fine', 'unknown']),
    counts: z.tuple([count, count, count, count, count]), rating_count: count, mean: z.number().min(1).max(5).nullable() })).max(6),
});
export const analyticsSchema = z.strictObject({
  duration: durationDistributionSchema,
  heatmap: heatmapSchema,
  scatter: z.strictObject({ agencies: z.array(scatterEntity).max(500), managers: z.array(scatterEntity).max(500), agency_total: count, manager_total: count }),
  // no plate text / hash: buckets and denominators only
  vehicle_days: z.strictObject({
    basis,
    buckets: z.array(z.strictObject({ label: z.string().max(20), min: count, max: count.nullable(), vehicle_count: count, percentage: pctN })).max(8),
    vehicle_count: count, repeat_vehicle_count: count, repeat_share: pctN,
    excluded: z.strictObject({ no_plate: count, no_report_date: count }),
  }),
  rating: ratingDistributionSchema,
});
const unplacedSchema = z.strictObject({
  no_address: z.strictObject({ reported: count, completed: count }),
  no_coordinates: z.strictObject({ reported: count, completed: count }),
});

export const placeDetailResponseSchema = z.strictObject({
  schema_version: z.literal(2), dataset_version: z.string(), scope: scopeSchema, sample: z.boolean(),
  cohort_policy_version: cohortPolicy, overview: overviewSchema,
  place: pointSchema, agencies: z.array(entitySchema).max(1000), managers: z.array(entitySchema).max(1000),
  agency_total: count, manager_total: count,
});
export const placesResponseSchema = z.strictObject({
  schema_version: z.literal(2), dataset_version: z.string(), scope: scopeSchema, sample: z.boolean(), cohort_policy_version: cohortPolicy,
  view_bbox: z.tuple([positive, positive, positive, positive]), points: z.array(pointSchema).max(1000),
  total_places: count, compacted: z.boolean(),
});

export const pointsResponseSchema = z.strictObject({
  schema_version: z.literal(2), dataset_version: z.string(), scope: scopeSchema, cohort_policy_version: cohortPolicy,
  sample: z.boolean(), points: z.array(pointSchema).max(1000),
});
export const seriesResponseSchema = z.strictObject({
  schema_version: z.literal(2), dataset_version: z.string(), scope: scopeSchema, cohort_policy_version: cohortPolicy,
  sample: z.boolean(), monthly: z.array(monthlySchema),
});
const sortSchema = z.strictObject({
  column: z.string().refine((c) => c in SORT_COLUMNS), value: z.enum(['count', 'rate', 'median', 'sum', 'mean']), dir: z.enum(['asc', 'desc']),
});
export const entitiesResponseSchema = z.strictObject({
  schema_version: z.literal(2), dataset_version: z.string(), scope: scopeSchema, cohort_policy_version: cohortPolicy,
  sample: z.boolean(), items: z.array(entitySchema).max(100), sort: sortSchema,
  total_rows: count, page: z.number().int().positive(), page_size: z.number().int().min(1).max(100),
});
export const lawsResponseSchema = z.strictObject({
  schema_version: z.literal(2), dataset_version: z.string(), scope: scopeSchema, cohort_policy_version: cohortPolicy,
  sample: z.boolean(), items: z.array(lawSchema).max(100), sort: sortSchema,
  total_rows: count, page: z.number().int().positive(), page_size: z.number().int().min(1).max(100),
});
export const vehiclesResponseSchema = z.strictObject({
  schema_version: z.literal(2), dataset_version: z.string(), scope: scopeSchema, cohort_policy_version: cohortPolicy,
  sample: z.boolean(), time_basis: basis,
  total_scope_reports: count, identifiable_reports: count,
  items: z.array(vehicleSchema).max(5),
});
export const overviewResponseSchema = z.strictObject({
  schema_version: z.literal(2), dataset_version: z.string(), scope: scopeSchema, cohort_policy_version: cohortPolicy,
  sample: z.boolean(), overview: overviewSchema, location_missing: count.optional(),
});

export const dashboardResponseSchema = z.strictObject({
  schema_version: z.literal(2), dataset_version: z.string(), sample: z.boolean(), scope: scopeSchema, cohort_policy_version: cohortPolicy,
  overview: overviewSchema, points: z.array(pointSchema).max(1000), monthly: z.array(monthlySchema),
  agencies: z.array(entitySchema).max(100), managers: z.array(entitySchema).max(100),
  agency_total: count.optional(), manager_total: count.optional(),
  regions: z.array(regionSchema).max(400).optional(),
  laws: z.array(lawSchema).max(300).optional(),
  vehicles: z.array(vehicleSchema).max(5), vehicle_total_scope_reports: count,
  vehicle_identifiable_reports: count, location_missing: count.optional(),
  analytics: analyticsSchema.nullable().optional(), map_unplaced: unplacedSchema.nullable().optional(),
});

export const snapshotManifestSchema = z.strictObject({
  schema_version: z.literal(2), dataset_version: z.string().regex(/^[A-Za-z0-9._-]{1,120}$/),
  scope: scopeSchema, generated_at: z.string(),
});

// Access refusal envelope (contributor-only map). The error code stays stable ('upload_required' etc.);
// `details` is present only on upload_required so the UI can show threshold progress ("now N of 10").
// `current` is null when the database did not report a usable count (pre-threshold SQL) — the UI then
// shows the requirement without a number. Strict: unknown error shapes fall back to code-only handling.
export const accessErrorDetailsSchema = z.strictObject({
  required: z.number().int().positive(),
  current: z.number().int().nonnegative().nullable(),
});

export const errorResponseSchema = z.strictObject({
  error: z.strictObject({
    code: z.string(), message: z.string(), details: accessErrorDetailsSchema.optional(),
  }),
});

export type AccessErrorDetails = z.infer<typeof accessErrorDetailsSchema>;
