import type { DashboardData, CountMetric, RateMetric, Scope } from '../domain/public';

// Every value here is synthetic, already public, and only loaded for explicit demo builds.
const count = (value: number | null, basis: 'report_date' | 'completed_date', denominator: number | null = null): CountMetric => ({
  value, basis, denominator, eligible: value ?? 0, missing: 0, previous: null,
  delta: null, delta_percent: null, delta_reason: null,
});

const unavailable = (basis: 'report_date' | 'completed_date'): CountMetric => ({
  ...count(null, basis), note: '이 합성 fixture에는 선택 범위의 집계가 없습니다.',
});

export function demoDashboard(scope: Scope, state: 'overview' | 'one' | 'empty' = 'overview'): DashboardData {
  const supported = state !== 'empty' && scope.category === 'all' && !scope.region_code &&
    !scope.agency_key && !scope.manager_key && !scope.bbox &&
    scope.start === '2025-09-25' && scope.end === '2026-09-24';
  const one = state === 'one';
  const available = supported;
  const R = one ? 1 : 9;
  const C = one ? 1 : 7;
  const D = one ? 1 : 6;
  const accepted = one ? 1 : 4;
  const partial = one ? 0 : 1;
  const rejected = one ? 0 : 1;
  const outcomes = { accepted, partial, rejected, result_known: D, result_unknown: C - D };
  const capability = (status: 'supported' | 'missing', reason: string | null = null) => ({
    status, reason, coverage: status === 'supported' ? { eligible: R, total: R } : null,
  });
  const missingReason = available ? null : '선택 범위의 합성 집계가 준비되지 않았습니다.';
  const metric = (v: number, basis: 'report_date' | 'completed_date', den: number | null = null) =>
    available ? count(v, basis, den) : unavailable(basis);
  const rate: RateMetric = available
    ? { ...count((accepted + partial) / D * 100, 'completed_date', D), numerator: accepted + partial, unit: 'percent', eligible: D, missing: C - D }
    : { ...unavailable('completed_date'), numerator: null, unit: 'percent' };

  return {
    meta: {
      schema_version: 2, dataset_version: 'synthetic-2026-09-24', sample: true,
      source_updated_at: null, generated_at: '2026-09-24T00:00:00Z', published_at: null,
      data_min: '2025-09-25', data_max: '2026-09-24',
      coverage_note: '합성 예시 자료입니다. 실제 신고 통계가 아닙니다.', dedupe_policy_version: 'fixture-v1',
      capabilities: Object.fromEntries([
        'daily_report_dates', 'completion_dates', 'manager_status_cross', 'agency_status_cross',
        'vehicle_top5', 'region_boundaries', 'fine_amount', 'processing_duration',
      ].map(key => [key, capability(available && !['region_boundaries', 'fine_amount', 'processing_duration'].includes(key) ? 'supported' : 'missing',
        ['region_boundaries', 'fine_amount', 'processing_duration'].includes(key) ? '합성 fixture에 해당 원천이 없습니다.' : missingReason)])),
    },
    scope,
    overview: {
      report_count: metric(R, 'report_date'), completed_count: metric(C, 'completed_date'),
      accepted_including_partial: rate, fine_count: metric(one ? 0 : 2, 'completed_date', C),
      point_count: metric(one ? 1 : 3, 'report_date', R), contributor_count: metric(one ? 1 : 4, 'report_date', R),
      outcomes: available ? outcomes : { accepted: 0, partial: 0, rejected: 0, result_known: 0, result_unknown: 0 },
    },
    points: !available ? [] : one ? [
      { key: 'synthetic-point-3', lat: 33.499621, lng: 126.531188, address: '제주특별자치도 제주시 예시 지점', region_code: '50', report_count: 1, completed_count: 1, outcomes, fine_count: 0 },
    ] : [
      { key: 'synthetic-point-1', lat: 37.566535, lng: 126.9779692, address: '서울특별시 중구 예시 지점', region_code: '11', report_count: 5, completed_count: 4, outcomes: { accepted: 2, partial: 1, rejected: 1, result_known: 4, result_unknown: 0 }, fine_count: 1 },
      { key: 'synthetic-point-2', lat: 35.1795543, lng: 129.0756416, address: '부산광역시 연제구 예시 지점', region_code: '26', report_count: 3, completed_count: 2, outcomes: { accepted: 1, partial: 0, rejected: 0, result_known: 1, result_unknown: 1 }, fine_count: 1 },
      { key: 'synthetic-point-3', lat: 33.499621, lng: 126.531188, address: '제주특별자치도 제주시 예시 지점', region_code: '50', report_count: 1, completed_count: 1, outcomes: { accepted: 1, partial: 0, rejected: 0, result_known: 1, result_unknown: 0 }, fine_count: 0 },
    ],
    monthly: !available ? [] : one ? [
      { month: '2026-09', report_count: 1, completed_count: 1, fine_count: 0, outcomes, partial: true, coverage_note: null },
    ] : [
      { month: '2026-07', report_count: 2, completed_count: 1, fine_count: 0, outcomes: { accepted: 1, partial: 0, rejected: 0, result_known: 1, result_unknown: 0 }, partial: false, coverage_note: null },
      { month: '2026-08', report_count: 3, completed_count: 3, fine_count: 1, outcomes: { accepted: 1, partial: 1, rejected: 0, result_known: 2, result_unknown: 1 }, partial: false, coverage_note: null },
      { month: '2026-09', report_count: 4, completed_count: 3, fine_count: 1, outcomes: { accepted: 2, partial: 0, rejected: 1, result_known: 3, result_unknown: 0 }, partial: true, coverage_note: null },
    ],
    agencies: !available ? [] : one ? [
      { key: 'a3', agency_name: '예시 제주 기관', manager_name: null, completed_count: 1, outcomes, fine_count: 0 },
    ] : [
      { key: 'a1', agency_name: '예시 서울 기관', manager_name: null, completed_count: 4, outcomes: { accepted: 2, partial: 1, rejected: 1, result_known: 4, result_unknown: 0 }, fine_count: 1 },
      { key: 'a2', agency_name: '예시 부산 기관', manager_name: null, completed_count: 2, outcomes: { accepted: 1, partial: 0, rejected: 0, result_known: 1, result_unknown: 1 }, fine_count: 1 },
      { key: 'a3', agency_name: '예시 제주 기관', manager_name: null, completed_count: 1, outcomes: { accepted: 1, partial: 0, rejected: 0, result_known: 1, result_unknown: 0 }, fine_count: 0 },
    ],
    managers: !available ? [] : one ? [
      { key: 'm3', agency_name: '예시 제주 기관', manager_name: '김하늘', completed_count: 1, outcomes, fine_count: 0 },
    ] : [
      { key: 'm1', agency_name: '예시 서울 기관', manager_name: '김하늘', completed_count: 4, outcomes: { accepted: 2, partial: 1, rejected: 1, result_known: 4, result_unknown: 0 }, fine_count: 1 },
      { key: 'm2', agency_name: '예시 부산 기관', manager_name: '이서윤', completed_count: 2, outcomes: { accepted: 1, partial: 0, rejected: 0, result_known: 1, result_unknown: 1 }, fine_count: 1 },
      { key: 'm3', agency_name: '예시 제주 기관', manager_name: '김하늘', completed_count: 1, outcomes: { accepted: 1, partial: 0, rejected: 0, result_known: 1, result_unknown: 0 }, fine_count: 0 },
    ],
    vehicles: !available ? [] : one ? [
      { rank: 1, rank_item_id: 'r1', masked_plate: '1*가*4*6', report_count: 1, percentage: 100 },
    ] : [
      { rank: 1, rank_item_id: 'r1', masked_plate: '1*가*4*6', report_count: 3, percentage: 33.3333333333 },
      { rank: 2, rank_item_id: 'r2', masked_plate: '1*3나*5*7', report_count: 2, percentage: 22.2222222222 },
      { rank: 3, rank_item_id: 'r3', masked_plate: '2*다*6*8', report_count: 1, percentage: 11.1111111111 },
      { rank: 4, rank_item_id: 'r4', masked_plate: '1*가*4*6', report_count: 1, percentage: 11.1111111111 },
    ],
    vehicle_total_scope_reports: available ? R : null,
    vehicle_identifiable_reports: available ? (one ? 1 : 7) : null,
  };
}
