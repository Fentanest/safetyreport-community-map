import { z } from 'zod';
import { COHORT_POLICY_VERSION, isLawParam } from '../domain/public';
import { SORT_COLUMNS } from '../domain/tableSort';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const count = z.number().int().nonnegative();
const positive = z.number().finite();
const nullableCount = count.nullable();
const basis = z.enum(['report_date', 'completed_date']);

export const scopeSchema = z.strictObject({
  date_basis: basis, start: date, end: date,
  // 5분류(observation-v5, 2026-10-11): traffic·parking·safety·living·other.
  category: z.enum(['all', 'traffic', 'parking', 'safety', 'living', 'other']),
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
  snapshot_at: z.iso.datetime({ offset: true }).optional(),
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

export const fineEstimateSchema = z.strictObject({
  count: z.number().int().min(0), sum_won: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).nullable(),
  mean_won: z.number().min(1).max(100000000).nullable(),
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
  basis, count,
  // U-mean-primary (2026-10-12): optional — an older server omits the key entirely (never just null), and
  // KpiPanel/CompareKpis fall back to the pre-existing median-as-hero display.
  mean_days: z.number().min(0).nullable().optional(), median_days: z.number().min(0).nullable(), p90_days: z.number().min(0).nullable(),
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
  processing_duration: durationSummary, fine_amount: fineSummary, fine_estimate: fineEstimateSchema.optional(), rating,
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
  same_name: z.strictObject({ count: z.number().int().min(2), label: z.string().min(1).max(200),
    peers: z.array(z.string().max(200)).max(12), same_agency: z.boolean() }).nullable().optional(),
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

const PLATE_REGIONS = '(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)';
/** 현재 공개 가림(2026-10-13): 일반형·이륜형 모두 끝 4자리는 둘째·넷째만 공개한다. 시군구는 지역 접두가 필수다.
 *  `1*가*4*6`, `1*3가*5*7`, `경기군포다*6*1`, `1오**3*7`, `가*2*4`. */
export const MASKED_PLATE_RE = new RegExp(`^(?:${PLATE_REGIONS}?(?:[0-9]\\*[0-9]?[가-힣]|[0-9]?[가-힣]\\*?)|${PLATE_REGIONS}[가-힣]{2,4})\\*[0-9]\\*[0-9]$`, 'u');
/** 옛 공개 가림(202610131000 migration 적용 전 DB의 `private.screen_mask_plate`): 3자리 일반형만 새 형식과 다르다.
 *  `123가4567 → 1*3*4*67`로 용도 글자는 가리지만 끝 4자리 중 첫째·셋째·넷째 세 자리를 공개한다.
 *  2자리 일반형(`1*가*4*6`)은 옛·새 결과가 같아 위 MASKED_PLATE_RE가 그대로 받는다. 이륜형은 옛 서버가 가림을 만들지 못했다. */
export const LEGACY_MASKED_PLATE_RE = new RegExp(`^(${PLATE_REGIONS}?)([0-9])\\*([0-9])\\*[0-9]\\*[0-9]([0-9])$`, 'u');
/** 브라우저가 옛 형식을 줄여 보인 결과(`1*3****7`). 다시 검증해도 같은 값이 되도록 받는다. */
const REDUCED_LEGACY_PLATE_RE = new RegExp(`^${PLATE_REGIONS}?[0-9]\\*[0-9]\\*{4}[0-9]$`, 'u');
/** 형식이 맞지 않는 차량 행을 대시보드 전체 실패 대신 이 문구로 보인다. 받은 문자열은 화면에 쓰지 않는다. */
export const PLATE_HIDDEN_LABEL = '번호 표시 생략';

/**
 * 옛 3자리 가림은 새 형식이 공개하지 않는 끝 첫째·셋째 숫자를 담고 있다. 화면에는 옛·새 형식이 모두 공개하는
 * 자리(앞 숫자 첫째·셋째, 끝 넷째)만 남긴다: `1*3*4*67 → 1*3****7`. 운영 DB가 옛 형식과 새 형식을 번갈아 내보내도
 * 화면에서 합쳐 알 수 있는 자리가 새 형식(`1*3가*5*7`)보다 늘지 않는다. 응답 원문 자체의 노출은 migration 적용으로만 없어진다.
 */
export function displayMaskedPlate(masked: string): string | null {
  if (MASKED_PLATE_RE.test(masked) || REDUCED_LEGACY_PLATE_RE.test(masked)) return masked;
  const legacy = LEGACY_MASKED_PLATE_RE.exec(masked);
  if (legacy) return `${legacy[1]}${legacy[2]}*${legacy[3]}****${legacy[4]}`;
  return null;
}

const vehicleRowFields = {
  rank: z.number().int().min(1).max(5), rank_item_id: z.string().regex(/^r[1-5]$/),
  report_count: z.number().int().positive(), percentage: z.number().min(0).max(100).nullable(),
};
/** 서버 공개 출력 계약(현재 형식만). 서버 집계·Edge 회귀 시험이 이 스키마로 새 형식을 고정한다. */
export const vehicleSchema = z.strictObject({ ...vehicleRowFields, masked_plate: z.string().regex(MASKED_PLATE_RE) });

const vehicleRowShape = z.strictObject({ ...vehicleRowFields, masked_plate: z.string() });
/**
 * 브라우저가 받는 차량 TOP5 목록. 옛 형식은 위 displayMaskedPlate로 줄여 받고, 가림 형식이 아닌 한 행은 번호만
 * PLATE_HIDDEN_LABEL로 바꾼다(받은 문자열은 버린다). 행 모양 자체가 다르면(알 수 없는 키·순위 범위 밖 등) 그 행만 뺀다.
 * 어느 경우에도 대시보드 전체 응답을 실패시키지 않는다.
 */
export const vehicleListSchema = z.array(z.unknown()).max(5).transform((rows) => rows.flatMap((row) => {
  const shape = vehicleRowShape.safeParse(row);
  if (!shape.success) return [];
  return [{ ...shape.data, masked_plate: displayMaskedPlate(shape.data.masked_plate) ?? PLATE_HIDDEN_LABEL }];
}));

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
  items: vehicleListSchema,
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
  vehicles: vehicleListSchema, vehicle_total_scope_reports: count,
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

/** Deferred charts are fenced to the replacement screen, never mixed into an older dashboard. */
export const dashboardAnalyticsResponseSchema = z.strictObject({
  dataset_version: z.string().min(1), scope: scopeSchema, analytics: analyticsSchema.nullable(),
});
