import type { DashboardData, PublicEntity, Scope } from '../domain/public';
import {
  entitiesResponseSchema, metaSchema, dashboardResponseSchema, snapshotManifestSchema,
} from './schema';

export type DataMode = 'demo' | 'live';
export const dataMode: DataMode = import.meta.env.VITE_DATA_MODE === 'demo' ? 'demo' : 'live';

// SOL-08: the entity table uses full /entities browsing only when the live analytics base URL exists.
export function entitiesAvailable(): boolean {
  return dataMode === 'live' && !!import.meta.env.VITE_PUBLIC_ANALYTICS_URL?.replace(/\/+$/, '');
}

export class PublicApiError extends Error {
  constructor(message: string, readonly status: number | null = null, readonly retryAfter: number | null = null) {
    super(message);
    this.name = 'PublicApiError';
  }
}

function scopeParams(scope: Scope, version?: string, extra?: Record<string, string>): URLSearchParams {
  const p = new URLSearchParams({ start: scope.start, end: scope.end, category: scope.category });
  if (scope.region_code) p.set('region_code', scope.region_code);
  if (scope.agency_key) p.set('agency_key', scope.agency_key);
  if (scope.manager_key) p.set('manager_key', scope.manager_key);
  if (scope.bbox) p.set('bbox', scope.bbox.join(','));
  if (version) p.set('expected_version', version);
  for (const [key, value] of Object.entries(extra || {})) p.set(key, value);
  return p;
}

function sameScope(a: Scope, b: Scope): boolean {
  return a.start === b.start && a.end === b.end && a.category === b.category &&
    a.region_code === b.region_code && a.agency_key === b.agency_key &&
    a.manager_key === b.manager_key && JSON.stringify(a.bbox) === JSON.stringify(b.bbox);
}

async function readSnapshot(scope: Scope, version: string, signal?: AbortSignal) {
  try {
    const base = import.meta.env.BASE_URL;
    const manifestResponse = await fetch(`${base}data/manifest.json`, { signal, cache: 'no-store' });
    if (!manifestResponse.ok) return null;
    const manifest = snapshotManifestSchema.parse(await manifestResponse.json());
    if (manifest.dataset_version !== version || !sameScope(manifest.scope, scope)) return null;
    const response = await fetch(`${base}data/${encodeURIComponent(version)}/dashboard.json`, { signal, cache: 'no-store' });
    if (!response.ok) return null;
    const snapshot = dashboardResponseSchema.parse(await response.json());
    return snapshot.dataset_version === version && !snapshot.sample && sameScope(snapshot.scope, scope) ? snapshot : null;
  } catch (error) {
    if (signal?.aborted) throw error;
    return null;
  }
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

export type EntityKind = 'agency' | 'manager';
export type EntitySortKey = 'completed' | 'accepted' | 'partial' | 'rejected' | 'fine' | 'acceptRate';
export type SortDir = 'asc' | 'desc';

export interface EntitiesQuery {
  kind: EntityKind;
  q?: string;
  sort?: EntitySortKey;
  dir?: SortDir;
  page?: number;
  pageSize?: number;
}

export interface EntitiesPage {
  datasetVersion: string;
  scope: Scope;
  items: PublicEntity[];
  totalRows: number;
  page: number;
  pageSize: number;
}

// SOL-08: full-list entity browsing over /entities (server search/sort/pagination). The dashboard
// top-100 arrays stay summary-only; this is the table's data source in live mode.
export async function loadEntities(scope: Scope, query: EntitiesQuery, version?: string, signal?: AbortSignal): Promise<EntitiesPage> {
  const extra: Record<string, string> = {
    kind: query.kind,
    page: String(query.page ?? 1),
    page_size: String(query.pageSize ?? 50),
  };
  if (query.q !== undefined && query.q.trim() !== '') extra.q = query.q.trim();
  if (query.sort !== undefined) extra.sort = query.sort;
  if (query.dir !== undefined) extra.dir = query.dir;
  const parsed = entitiesResponseSchema.parse(await read('entities', scopeParams(scope, version, extra), signal));
  if (version !== undefined && parsed.dataset_version !== version) {
    throw new PublicApiError('데이터 버전 또는 조회 범위가 바뀌었습니다. 다시 조회해 주세요.', 409);
  }
  if (!sameScope(parsed.scope, scope)) {
    throw new PublicApiError('데이터 버전 또는 조회 범위가 바뀌었습니다. 다시 조회해 주세요.', 409);
  }
  return {
    datasetVersion: parsed.dataset_version, scope: parsed.scope, items: parsed.items,
    totalRows: parsed.total_rows, page: parsed.page, pageSize: parsed.page_size,
  };
}

export async function loadDashboard(scope: Scope, signal?: AbortSignal): Promise<DashboardData> {
  if (dataMode === 'demo') {
    const { demoDashboard } = await import('./demo');
    const state = new URLSearchParams(window.location.search).get('fixture');
    if (state === 'offline') throw new PublicApiError('네트워크 연결을 확인한 뒤 다시 시도해 주세요.');
    if (state === 'rate') throw new PublicApiError('요청이 많아 잠시 후 다시 시도해 주세요.', 429, 60);
    if (state === 'stale') throw new PublicApiError('데이터 버전이 변경됐습니다. 다시 조회해 주세요.', 409);
    return demoDashboard(scope, state === 'one' || state === 'empty' ? state : 'overview');
  }
  const meta = metaSchema.parse(await read('meta', null, signal));
  if (meta.capabilities.daily_report_dates?.status !== 'supported') {
    throw new PublicApiError('임의 기간의 공개 집계가 아직 준비되지 않았습니다.', 503);
  }
  const q = scopeParams(scope, meta.dataset_version);
  const result = await readSnapshot(scope, meta.dataset_version, signal) ??
    dashboardResponseSchema.parse(await read('dashboard', q, signal));
  if (result.dataset_version !== meta.dataset_version || result.sample !== meta.sample ||
      !sameScope(result.scope, scope)) {
    throw new PublicApiError('데이터 버전 또는 조회 범위가 바뀌었습니다. 다시 조회해 주세요.', 409);
  }
  return {
    meta: { ...meta, location_missing: result.location_missing ?? undefined },
    scope, overview: result.overview, points: result.points, monthly: result.monthly,
    agencies: result.agencies, managers: result.managers, vehicles: result.vehicles,
    vehicle_total_scope_reports: result.vehicle_total_scope_reports,
    vehicle_identifiable_reports: result.vehicle_identifiable_reports,
  };
}
