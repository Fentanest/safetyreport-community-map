import type { DashboardData, Scope } from '../domain/public';
import {
  metaSchema, overviewResponseSchema, pointsResponseSchema, seriesResponseSchema,
  entitiesResponseSchema, vehiclesResponseSchema,
} from './schema';

export type DataMode = 'demo' | 'live';
export const dataMode: DataMode = import.meta.env.VITE_DATA_MODE === 'demo' ? 'demo' : 'live';

export class PublicApiError extends Error {
  constructor(message: string, readonly status: number | null = null, readonly retryAfter: number | null = null) {
    super(message);
    this.name = 'PublicApiError';
  }
}

function query(scope: Scope, version?: string, extra?: Record<string, string>): URLSearchParams {
  const p = new URLSearchParams({ start: scope.start, end: scope.end, category: scope.category });
  if (scope.region_code) p.set('region_code', scope.region_code);
  if (scope.agency_key) p.set('agency_key', scope.agency_key);
  if (scope.manager_key) p.set('manager_key', scope.manager_key);
  if (scope.bbox) p.set('bbox', scope.bbox.join(','));
  if (version) p.set('expected_version', version);
  for (const [key, value] of Object.entries(extra || {})) p.set(key, value);
  return p;
}

async function read(path: string, params: URLSearchParams | null, signal?: AbortSignal): Promise<unknown> {
  const base = import.meta.env.VITE_PUBLIC_ANALYTICS_URL?.replace(/\/+$/, '');
  if (!base) throw new PublicApiError('공개 통계 API 주소가 설정되지 않았습니다.');
  const url = `${base}/public-analytics/${path}${params ? `?${params}` : ''}`;
  const res = await fetch(url, { signal, credentials: 'omit', headers: { Accept: 'application/json' } });
  if (!res.ok) {
    const retry = Number(res.headers.get('retry-after'));
    throw new PublicApiError(res.status === 429 ? '요청이 많아 잠시 후 다시 시도해 주세요.' : '통계 조회에 실패했습니다.',
      res.status, Number.isFinite(retry) && retry > 0 ? retry : null);
  }
  return res.json();
}

export async function loadDashboard(scope: Scope, signal?: AbortSignal): Promise<DashboardData> {
  if (dataMode === 'demo') {
    const { demoDashboard } = await import('./demo');
    const state = new URLSearchParams(window.location.search).get('fixture');
    return demoDashboard(scope, state === 'one' || state === 'empty' ? state : 'overview');
  }
  const meta = metaSchema.parse(await read('meta', null, signal));
  const q = query(scope, meta.dataset_version);
  const [overview, points, series, agencies, managers, vehicles] = await Promise.all([
    read('overview', q, signal).then(v => overviewResponseSchema.parse(v)),
    read('map', q, signal).then(v => pointsResponseSchema.parse(v)),
    read('series', q, signal).then(v => seriesResponseSchema.parse(v)),
    read('entities', query(scope, meta.dataset_version, { kind: 'agency', page_size: '100' }), signal).then(v => entitiesResponseSchema.parse(v)),
    read('entities', query(scope, meta.dataset_version, { kind: 'manager', page_size: '100' }), signal).then(v => entitiesResponseSchema.parse(v)),
    read('vehicles/top', q, signal).then(v => vehiclesResponseSchema.parse(v)),
  ]);
  const parts = [overview, points, series, agencies, managers, vehicles];
  if (parts.some(part => part.dataset_version !== meta.dataset_version || part.sample !== meta.sample ||
      JSON.stringify(part.scope) !== JSON.stringify(scope))) {
    throw new PublicApiError('데이터 버전 또는 조회 범위가 바뀌었습니다. 다시 조회해 주세요.', 409);
  }
  return {
    meta, scope, overview: overview.overview, points: points.points, monthly: series.monthly,
    agencies: agencies.items, managers: managers.items, vehicles: vehicles.items,
    vehicle_total_scope_reports: vehicles.total_scope_reports,
    vehicle_identifiable_reports: vehicles.identifiable_reports,
  };
}
