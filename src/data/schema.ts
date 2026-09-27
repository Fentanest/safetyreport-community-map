import { z } from 'zod';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const count = z.number().int().nonnegative();
const positive = z.number().finite();
const nullableCount = count.nullable();
const basis = z.enum(['report_date', 'completed_date']);

export const scopeSchema = z.strictObject({
  start: date, end: date, category: z.enum(['all', 'traffic', 'parking', 'other']),
  region_code: z.string().nullable(), agency_key: z.string().nullable(),
  manager_key: z.string().nullable(), bbox: z.tuple([positive, positive, positive, positive]).nullable(),
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
});

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
  basis: z.literal('completed_date'), count,
  mean_days: z.number().min(0).nullable(), median_days: z.number().min(0).nullable(), p90_days: z.number().min(0).nullable(),
  min_days: z.number().min(0).nullable(), max_days: z.number().min(0).nullable(),
  excluded: z.strictObject({ no_report_date: count, reversed: count }), answer_date_missing: count,
}).nullable().optional();

const won = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const fineBrief = z.strictObject({
  fine_count: count, confirmed_count: count, sum_won: won.nullable(), mean_won: z.number().min(0).nullable(),
}).nullable().optional();
const fineSummary = z.strictObject({
  basis: z.literal('completed_date'), fine_count: count, confirmed_count: count, sum_won: won.nullable(),
  mean_won: z.number().min(0).nullable(), median_won: z.number().min(0).nullable(), zero_count: count,
  unconfirmed_count: count, undisclosed_count: count, conflict_count: count, penalty_count: count, combined_count: count,
  partial: z.boolean(),
}).nullable().optional();

export const overviewSchema = z.strictObject({
  report_count: countMetric, completed_count: countMetric, accepted_including_partial: rateMetric,
  fine_count: countMetric, point_count: countMetric, contributor_count: countMetric, outcomes: outcomes.nullable(),
  processing_duration: durationSummary, fine_amount: fineSummary,
});

export const pointSchema = z.strictObject({
  key: z.string(), lat: z.number().min(32).max(39.5), lng: z.number().min(124).max(132),
  aggregate: z.boolean().optional(), point_count: count.optional(),
  bbox: z.tuple([positive, positive, positive, positive]).optional(),
  address: z.string().nullable(), region_code: z.string().nullable(), report_count: count,
  completed_count: nullableCount, outcomes: outcomes.nullable(), fine_count: nullableCount,
});

export const monthlySchema = z.strictObject({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), report_count: nullableCount,
  completed_count: nullableCount, fine_count: nullableCount, outcomes: outcomes.nullable(),
  partial: z.boolean(), coverage_note: z.string().nullable(), duration: durationBrief, fine_amount: fineBrief,
});

export const entitySchema = z.strictObject({
  key: z.string(), agency_key: z.string().nullable(), manager_key: z.string().nullable(),
  agency_name: z.string(), manager_name: z.string().nullable(),
  completed_count: count, outcomes, fine_count: nullableCount, duration: durationBrief, fine_amount: fineBrief,
});

export const regionSchema = z.strictObject({
  level: z.enum(['sido', 'sgg', 'unknown']), region_code: z.string().regex(/^\d{2}(\d{3})?$/).nullable(),
  name: z.string().max(40), sido_code: z.string().regex(/^\d{2}$/).nullable(),
  report_count: count, completed_count: count,
  outcomes, fine_count: count, duration: durationBrief, fine_amount: fineBrief,
});

export const vehicleSchema = z.strictObject({
  rank: z.number().int().min(1).max(5), rank_item_id: z.string().regex(/^r[1-5]$/),
  // Optional short region (kept visible), then the masked number: 경기7*자*6*3, 1*가*4*6.
  masked_plate: z.string().regex(/^(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)?[0-9]\*[0-9가-힣]\*[0-9]\*[0-9]{1,2}$/),
  report_count: z.number().int().positive(), percentage: z.number().min(0).max(100).nullable(),
});

export const pointsResponseSchema = z.strictObject({
  schema_version: z.literal(2), dataset_version: z.string(), scope: scopeSchema,
  sample: z.boolean(), points: z.array(pointSchema).max(1000),
});
export const seriesResponseSchema = z.strictObject({
  schema_version: z.literal(2), dataset_version: z.string(), scope: scopeSchema,
  sample: z.boolean(), monthly: z.array(monthlySchema),
});
export const entitiesResponseSchema = z.strictObject({
  schema_version: z.literal(2), dataset_version: z.string(), scope: scopeSchema,
  sample: z.boolean(), items: z.array(entitySchema).max(100),
  total_rows: count, page: z.number().int().positive(), page_size: z.number().int().min(1).max(100),
});
export const vehiclesResponseSchema = z.strictObject({
  schema_version: z.literal(2), dataset_version: z.string(), scope: scopeSchema,
  sample: z.boolean(), time_basis: z.literal('report_date'),
  total_scope_reports: count, identifiable_reports: count,
  items: z.array(vehicleSchema).max(5),
});
export const overviewResponseSchema = z.strictObject({
  schema_version: z.literal(2), dataset_version: z.string(), scope: scopeSchema,
  sample: z.boolean(), overview: overviewSchema, location_missing: count.optional(),
});

export const dashboardResponseSchema = z.strictObject({
  schema_version: z.literal(2), dataset_version: z.string(), sample: z.boolean(), scope: scopeSchema,
  overview: overviewSchema, points: z.array(pointSchema).max(1000), monthly: z.array(monthlySchema),
  agencies: z.array(entitySchema).max(100), managers: z.array(entitySchema).max(100),
  regions: z.array(regionSchema).max(300).optional(),
  vehicles: z.array(vehicleSchema).max(5), vehicle_total_scope_reports: count,
  vehicle_identifiable_reports: count, location_missing: count.optional(),
});

export const snapshotManifestSchema = z.strictObject({
  schema_version: z.literal(2), dataset_version: z.string().regex(/^[A-Za-z0-9._-]{1,120}$/),
  scope: scopeSchema, generated_at: z.string(),
});
