import { aggregateDashboard, previousWindow, type PrivateFact } from './aggregate';
import type { PublicMeta, Scope } from '../src/domain/public';

export interface AnalyticsState {
  dataset_version: string;
  ready: boolean;
  source_updated_at: string | null;
  generated_at: string | null;
  published_at: string | null;
  data_min: string | null;
  data_max: string | null;
  coverage_note: string;
  dedupe_policy_version: string;
}

export interface AnalyticsRepository {
  getState(): Promise<AnalyticsState>;
  getFacts(scope: Scope): Promise<PrivateFact[]>;
  allowRequest(request: Request): Promise<boolean>;
}

class QueryError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}

const cors = {
  'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Accept', 'Content-Type': 'application/json; charset=utf-8',
};
const allowed = new Set([
  'start', 'end', 'category', 'region_code', 'agency_key', 'manager_key', 'bbox',
  'expected_version', 'kind', 'page', 'page_size',
]);
const date = /^\d{4}-\d{2}-\d{2}$/;
const key = /^[\p{L}\p{N}._:-]{1,160}$/u;

function json(body: unknown, status = 200, _cache = 0): Response {
  return new Response(JSON.stringify(body), { status, headers: {
    ...cors, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
  } });
}

function errorResponse(code: string, status: number): Response {
  const res = json({ error: { code, message: code === 'RATE_LIMITED' ? '잠시 후 다시 시도해 주세요.' :
    code === 'AGGREGATE_NOT_READY' ? '공개 집계가 아직 준비되지 않았습니다.' :
      code === 'DATASET_CHANGED' ? '데이터 버전이 변경됐습니다. 다시 조회해 주세요.' :
        '요청을 처리할 수 없습니다.' } }, status);
  if (status === 429) res.headers.set('Retry-After', '60');
  return res;
}

function parseScope(params: URLSearchParams, state: AnalyticsState): Scope {
  for (const name of params.keys()) if (!allowed.has(name) || params.getAll(name).length !== 1) throw new QueryError('INVALID_QUERY', 400);
  const start = params.get('start'), end = params.get('end');
  if (!start || !end || !date.test(start) || !date.test(end)) throw new QueryError('INVALID_QUERY', 400);
  try {
    const previous = previousWindow(start, end);
    if (Date.parse(end) - Date.parse(start) > 1826 * 86400000 || previous.start < '1900-01-01') throw new Error('range');
  } catch { throw new QueryError('INVALID_QUERY', 400); }
  if (state.data_min && end < state.data_min || state.data_max && start > state.data_max) throw new QueryError('INVALID_QUERY', 400);
  const category = params.get('category') || 'all';
  if (!['all', 'traffic', 'parking', 'other'].includes(category)) throw new QueryError('INVALID_QUERY', 400);
  const optional = (name: string) => {
    const value = params.get(name);
    if (value !== null && !key.test(value)) throw new QueryError('INVALID_QUERY', 400);
    return value;
  };
  const bboxRaw = params.get('bbox');
  let bbox: Scope['bbox'] = null;
  if (bboxRaw !== null) {
    const values = bboxRaw.split(',').map(Number);
    if (values.length !== 4 || values.some(v => !Number.isFinite(v)) ||
      values[0] < 124 || values[2] > 132 || values[1] < 32 || values[3] > 39.5 ||
      values[0] > values[2] || values[1] > values[3]) throw new QueryError('INVALID_QUERY', 400);
    bbox = values as Scope['bbox'];
  }
  return { start, end, category: category as Scope['category'], region_code: optional('region_code'),
    agency_key: optional('agency_key'), manager_key: optional('manager_key'), bbox };
}

function meta(state: AnalyticsState): PublicMeta {
  const capability = (supported: boolean, reason: string | null = null) => ({
    status: supported ? 'supported' as const : 'missing' as const,
    reason, coverage: null,
  });
  const reason = state.ready ? null : 'v2 원천 사실이 아직 제공되지 않았습니다.';
  return {
    schema_version: 2, dataset_version: state.dataset_version, sample: false,
    source_updated_at: state.source_updated_at, generated_at: state.generated_at,
    published_at: state.published_at, data_min: state.data_min, data_max: state.data_max,
    coverage_note: state.coverage_note, dedupe_policy_version: state.dedupe_policy_version,
    capabilities: Object.fromEntries([
      'daily_report_dates', 'completion_dates', 'manager_status_cross', 'agency_status_cross', 'vehicle_top5',
      'fine_amount', 'processing_duration', 'region_boundaries',
    ].map(name => [name, capability(state.ready && !['fine_amount', 'processing_duration', 'region_boundaries'].includes(name),
      ['fine_amount', 'processing_duration', 'region_boundaries'].includes(name) ? '해당 원천이 없습니다.' : reason)])),
  };
}

function routeName(pathname: string): string {
  const marker = '/public-analytics/';
  const index = pathname.indexOf(marker);
  return index < 0 ? '' : pathname.slice(index + marker.length).replace(/\/+$/, '');
}

export function createPublicHandler(repo: AnalyticsRepository) {
  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'GET') return errorResponse('METHOD_NOT_ALLOWED', 405);
    const url = new URL(request.url);
    const route = routeName(url.pathname);
    if (!['meta', 'dashboard', 'overview', 'map', 'series', 'entities', 'vehicles/top'].includes(route) && !route.startsWith('points/')) {
      return errorResponse('NOT_FOUND', 404);
    }
    try {
      if (!await repo.allowRequest(request)) return errorResponse('RATE_LIMITED', 429);
      const state = await repo.getState();
      if (route === 'meta') {
        if ([...url.searchParams].length) throw new QueryError('INVALID_QUERY', 400);
        return json(meta(state), 200, 30);
      }
      if (route !== 'entities' && ['kind', 'page', 'page_size'].some(name => url.searchParams.has(name))) {
        throw new QueryError('INVALID_QUERY', 400);
      }
      const scope = parseScope(url.searchParams, state);
      if (url.searchParams.get('expected_version') && url.searchParams.get('expected_version') !== state.dataset_version) {
        throw new QueryError('DATASET_CHANGED', 409);
      }
      if (!state.ready) throw new QueryError('AGGREGATE_NOT_READY', 503);
      if (!state.generated_at) throw new QueryError('AGGREGATE_NOT_READY', 503);
      if (route === 'entities') {
        if (!['agency', 'manager'].includes(url.searchParams.get('kind') || '')) throw new QueryError('INVALID_QUERY', 400);
      }
      const facts = await repo.getFacts(scope);
      const data = aggregateDashboard(facts, scope, {
        datasetVersion: state.dataset_version, sourceUpdatedAt: state.source_updated_at,
        generatedAt: state.generated_at, asOf: state.data_max || scope.end, sample: false,
        dataMin: state.data_min,
      });
      const common = { schema_version: 2, dataset_version: state.dataset_version, sample: false, scope };
      if (route === 'dashboard') return json({ ...common, overview: data.overview, points: data.points,
        monthly: data.monthly, agencies: data.agencies.slice(0, 100), managers: data.managers.slice(0, 100),
        vehicles: data.vehicles, vehicle_total_scope_reports: data.vehicle_total_scope_reports,
        vehicle_identifiable_reports: data.vehicle_identifiable_reports }, 200, 30);
      if (route === 'overview') return json({ ...common, overview: data.overview }, 200, 60);
      if (route === 'map') return json({ ...common, points: data.points }, 200, 30);
      if (route === 'series') return json({ ...common, monthly: data.monthly }, 200, 60);
      if (route === 'vehicles/top') return json({ ...common, time_basis: 'report_date',
        total_scope_reports: data.vehicle_total_scope_reports, identifiable_reports: data.vehicle_identifiable_reports,
        items: data.vehicles }, 200, 30);
      if (route === 'entities') {
        const page = Number(url.searchParams.get('page') || '1'), pageSize = Number(url.searchParams.get('page_size') || '50');
        if (!Number.isInteger(page) || page < 1 || page > 10000 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
          throw new QueryError('INVALID_QUERY', 400);
        }
        const rows = url.searchParams.get('kind') === 'agency' ? data.agencies : data.managers;
        return json({ ...common, items: rows.slice((page - 1) * pageSize, page * pageSize),
          total_rows: rows.length, page, page_size: pageSize }, 200, 30);
      }
      let pointKey: string;
      try { pointKey = decodeURIComponent(route.slice('points/'.length)); }
      catch { throw new QueryError('INVALID_QUERY', 400); }
      if (!pointKey || pointKey.length > 160) throw new QueryError('INVALID_QUERY', 400);
      const point = data.points.find(row => row.key === pointKey);
      return point ? json({ ...common, point }, 200, 30) : errorResponse('NOT_FOUND', 404);
    } catch (e) {
      if (e instanceof QueryError) return errorResponse(e.code, e.status);
      return errorResponse('AGGREGATE_NOT_READY', 503);
    }
  };
}
