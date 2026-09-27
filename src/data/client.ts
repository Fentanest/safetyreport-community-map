import type { DashboardData, PublicEntity, Scope } from '../domain/public';
import { entitiesResponseSchema, metaSchema, dashboardResponseSchema } from './schema';
import { mapAuth } from '../hooks/usePersonal';

export type DataMode = 'demo' | 'live';
export const dataMode: DataMode = import.meta.env.VITE_DATA_MODE === 'demo' ? 'demo' : 'live';

// SOL-08: the entity table uses full /entities browsing only when the live analytics base URL exists.
export function entitiesAvailable(): boolean {
  return dataMode === 'live' && !!import.meta.env.VITE_PUBLIC_ANALYTICS_URL?.replace(/\/+$/, '');
}

export class PublicApiError extends Error {
  constructor(message: string, readonly status: number | null = null, readonly retryAfter: number | null = null,
    /** server error code, e.g. auth_required / contributor_required while the map is contributor-only */
    readonly code: string | null = null) {
    super(message);
    this.name = 'PublicApiError';
  }
}

/** Errors that mean "sign in / share first", shown as the access gate instead of a data error. */
export const ACCESS_CODES = ['auth_required', 'session_expired', 'kakao_required', 'contributor_required', 'upload_required'] as const;
export type AccessCode = typeof ACCESS_CODES[number];
export const isAccessError = (e: unknown): e is PublicApiError & { code: AccessCode } =>
  e instanceof PublicApiError && (ACCESS_CODES as readonly string[]).includes(e.code ?? '');

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

// No static snapshot: while the map is contributor-only every read goes through the API's viewer check, and the
// Pages artifact carries no data files (publish-pages.yml no longer exports one).
async function read(path: string, params: URLSearchParams | null, signal?: AbortSignal): Promise<unknown> {
  const base = import.meta.env.VITE_PUBLIC_ANALYTICS_URL?.replace(/\/+$/, '');
  if (!base) throw new PublicApiError('통계 서버에 연결할 수 없습니다.');
  const url = `${base}/public-analytics/${path}${params ? `?${params}` : ''}`;
  const auth = mapAuth();
  await auth.settled();
  const send = (token: string | null) => fetch(url, { signal, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
    headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  let token = await auth.accessToken();
  let res = await send(token);
  if (res.status === 401 && token) {
    token = await auth.refreshToken();
    if (token) res = await send(token);
  }
  if (!res.ok) {
    const retry = Number(res.headers.get('retry-after'));
    let code: string | null = null;
    let message: string | null = null;
    try {
      const body = (await res.json()) as { error?: { code?: unknown; message?: unknown } };
      code = typeof body.error?.code === 'string' ? body.error.code : null;
      message = typeof body.error?.message === 'string' ? body.error.message : null;
    } catch { /* not JSON */ }
    const access = (ACCESS_CODES as readonly string[]).includes(code ?? '');
    throw new PublicApiError(res.status === 429 ? '요청이 많아 잠시 후 다시 시도해 주세요.'
      : access && message ? message : '통계를 불러오지 못했습니다.',
      res.status, Number.isFinite(retry) && retry > 0 ? retry : null, code);
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
    throw new PublicApiError('통계가 방금 새로 바뀌었습니다. 다시 불러와 주세요.', 409);
  }
  if (!sameScope(parsed.scope, scope)) {
    throw new PublicApiError('통계가 방금 새로 바뀌었습니다. 다시 불러와 주세요.', 409);
  }
  return {
    datasetVersion: parsed.dataset_version, scope: parsed.scope, items: parsed.items,
    totalRows: parsed.total_rows, page: parsed.page, pageSize: parsed.page_size,
  };
}

export async function loadDashboard(scope: Scope, signal?: AbortSignal): Promise<DashboardData> {
  // Literal env check (not `dataMode`) so live builds drop the demo chunks entirely.
  if (import.meta.env.VITE_DATA_MODE === 'demo') {
    const state = new URLSearchParams(window.location.search).get('fixture');
    // contributor-only gate previews (demo only): not signed in / signed in without an active share consent
    if (state === 'login') throw new PublicApiError('카카오 로그인이 필요합니다.', 401, null, 'auth_required');
    if (state === 'noshare') throw new PublicApiError('지금은 신고내용 공유에 동의한 사람만 볼 수 있습니다.', 403, null, 'contributor_required');
    if (state === 'noupload') throw new PublicApiError('지도에 올라간 내 신고가 아직 없습니다.', 403, null, 'upload_required');
    if (state === 'offline') throw new PublicApiError('네트워크 연결을 확인한 뒤 다시 시도해 주세요.');
    if (state === 'rate') throw new PublicApiError('요청이 많아 잠시 후 다시 시도해 주세요.', 429, 60);
    if (state === 'stale') throw new PublicApiError('통계가 방금 새로 바뀌었습니다. 다시 불러와 주세요.', 409);
    if (state === 'one' || state === 'empty') {
      const { demoDashboard } = await import('./demo');
      return demoDashboard(scope, state);
    }
    const { demoEngineDashboard } = await import('./demoEngine');
    return demoEngineDashboard(scope);
  }
  const meta = metaSchema.parse(await read('meta', null, signal));
  if (meta.capabilities.daily_report_dates?.status !== 'supported') {
    throw new PublicApiError('통계가 아직 준비되지 않았습니다. 잠시 후 다시 확인해 주세요.', 503);
  }
  const q = scopeParams(scope, meta.dataset_version);
  const result = dashboardResponseSchema.parse(await read('dashboard', q, signal));
  if (result.dataset_version !== meta.dataset_version || result.sample !== meta.sample ||
      !sameScope(result.scope, scope)) {
    throw new PublicApiError('통계가 방금 새로 바뀌었습니다. 다시 불러와 주세요.', 409);
  }
  return {
    meta: { ...meta, location_missing: result.location_missing ?? undefined },
    scope, overview: result.overview, points: result.points, monthly: result.monthly,
    agencies: result.agencies, managers: result.managers, regions: result.regions ?? null, vehicles: result.vehicles,
    vehicle_total_scope_reports: result.vehicle_total_scope_reports,
    vehicle_identifiable_reports: result.vehicle_identifiable_reports,
  };
}
