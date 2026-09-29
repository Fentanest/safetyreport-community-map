import { aggregateDashboard, entityRows, mapNodes, previousWindow, representatives, selectScope, type PrivateFact } from './aggregate.ts';
import { placeFacts, placeRows, placesInView, placeSummary, representativeOf } from './places.ts';
import { codeForLegacyKey } from './regions.ts';
import { authenticate, mapViewerEligibility, ViewerAuthError, type ViewerAuthDeps } from './viewerAuth.ts';
import { isLawParam, LAW_NONE, lawKey, parseBbox, type PublicEntity, type PublicMeta, type Scope } from '../src/domain/public.ts';

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
  /** Rate limit the verified viewer. */
  allowRequest(request: Request, viewerId: string): Promise<boolean>;
}

/** Viewer eligibility from the database (internal_analytics_viewer), for the verified user and session only. */
export interface ViewerCheck {
  user_ok: boolean;
  kakao: boolean;
  session: boolean;
  contributor: 'active' | 'none' | 'suspended' | 'revoked';
  /** at least one of the viewer's reports is on the map (completed, active consent lineage) */
  has_public_facts: boolean;
  /**
   * distinct publicly-listed report identities of the viewer (202609281900; multiple datasets of the
   * same report count once). Absent on pre-threshold databases — the gate then fail-closes.
   */
  public_fact_count?: number | null;
}

/** Details carried on the upload_required refusal so the UI can show "now N of 10" progress. */
export interface ViewerThresholdDetails {
  required: number;
  /** null when the database did not report a usable count (older SQL); the UI then shows no number */
  current: number | null;
}

/** Every route, including meta, requires a verified Kakao contributor with a shared report. */
export interface PublicAccess extends ViewerAuthDeps {
  allowedOrigins: string[];
  viewer(uid: string, session: string): Promise<ViewerCheck>;
}

export class QueryError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}

type Headers = Record<string, string>;
const allowed = new Set([
  'start', 'end', 'category', 'region_code', 'agency_key', 'manager_key', 'bbox', 'law',
  'expected_version', 'kind', 'page', 'page_size', 'q', 'sort', 'dir', 'agency_type', 'view_bbox',
]);
// list-only parameters: never part of the statistics scope
const ENTITY_ONLY = ['kind', 'page', 'page_size', 'q', 'sort', 'dir', 'agency_type'];
const date = /^\d{4}-\d{2}-\d{2}$/;
const key = /^[\p{L}\p{N}._:-]{1,160}$/u;
// SOL-08: server-side search/sort keys for /entities. Value semantics mirror the EntityTable
// client so summary and full-list ordering agree (nulls sort as -Infinity, as in the table).
const entitySorts = new Set(['completed', 'accepted', 'partial', 'rejected', 'fine', 'acceptRate']);

function json(body: unknown, status: number, headers: Headers): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

const ACCESS_MESSAGES: Record<string, string> = {
  auth_required: '카카오 로그인이 필요합니다.',
  session_expired: '로그인이 만료되었습니다. 다시 로그인해 주세요.',
  kakao_required: '카카오 계정으로 로그인해 주세요.',
  contributor_required: '지금은 신고내용 공유에 동의한 사람만 볼 수 있습니다.',
  upload_required: '지도에 올라간 내 신고가 10건 이상이면 볼 수 있습니다. 앱에서 답변 완료 신고를 공유하면 볼 수 있습니다.',
  origin_forbidden: '허용되지 않은 요청입니다.',
};

function errorWith(code: string, status: number, headers: Headers, details?: ViewerThresholdDetails): Response {
  const res = json({ error: { code, message: code === 'RATE_LIMITED' ? '잠시 후 다시 시도해 주세요.' :
    code === 'AGGREGATE_NOT_READY' ? '공개 집계가 아직 준비되지 않았습니다.' :
      code === 'DATASET_CHANGED' ? '데이터 버전이 변경됐습니다. 다시 조회해 주세요.' :
        ACCESS_MESSAGES[code] ?? '요청을 처리할 수 없습니다.',
    ...(details !== undefined ? { details } : {}) } }, status, headers);
  if (status === 429) res.headers.set('Retry-After', '60');
  if (status === 401) res.headers.set('WWW-Authenticate', 'Bearer');
  return res;
}

/** Scope parser shared by the public API and the personal comparison API (same rules, same Scope). */
export function parseScope(params: URLSearchParams, state: Pick<AnalyticsState, 'data_min' | 'data_max'>,
  names: ReadonlySet<string> = allowed): Scope {
  for (const name of params.keys()) if (!names.has(name) || params.getAll(name).length !== 1) throw new QueryError('INVALID_QUERY', 400);
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
    bbox = parseBbox(bboxRaw);
    if (!bbox) throw new QueryError('INVALID_QUERY', 400);
  }
  // region_code: an official code, or an old display key such as '서울 중구' (letters, digits, single spaces)
  const region = params.get('region_code');
  if (region !== null && !/^[\p{L}\p{N}]+( [\p{L}\p{N}]+){0,2}$/u.test(region) || (region?.length ?? 0) > 40) {
    throw new QueryError('INVALID_QUERY', 400);
  }
  // Official 2026-07-01 code (2-digit 시도 / 5-digit 시군구); a legacy display key is converted when unambiguous.
  const regionCode = region === null ? null : codeForLegacyKey(region);
  if (region !== null && regionCode === null) throw new QueryError('INVALID_QUERY', 400);
  // law: exact 위반법규 text (1..60 code points, no control characters or outer spaces) or '__none__' (법규 미상)
  const rawLaw = params.get('law');
  if (rawLaw !== null && !isLawParam(rawLaw)) throw new QueryError('INVALID_QUERY', 400);
  // echoed and filtered as the 조 단위 key: '도로교통법 제32조제1항' selects (and echoes) '도로교통법 제32조'
  const law = rawLaw === null || rawLaw === LAW_NONE ? rawLaw : lawKey(rawLaw);
  if (rawLaw !== null && law === null) throw new QueryError('INVALID_QUERY', 400);
  return { start, end, category: category as Scope['category'], region_code: regionCode,
    agency_key: optional('agency_key'), manager_key: optional('manager_key'), bbox, law };
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
      'fine_amount', 'processing_duration', 'region_boundaries', 'violation_law',
    ].map(name => [name, capability(state.ready, reason)])),
  };
}

function entityValue(row: PublicEntity, sort: string): number | null {
  const known = row.outcomes.result_known;
  switch (sort) {
    case 'accepted': return row.outcomes.accepted;
    case 'partial': return row.outcomes.partial;
    case 'rejected': return row.outcomes.rejected;
    case 'fine': return row.fine_count;
    // 수용률 = 수용 ÷ 결과 확인 (일부 수용 제외, 화면 표와 같은 정의)
    case 'acceptRate': return known > 0 ? (row.outcomes.accepted / known) * 100 : null;
    default: return row.completed_count;
  }
}

function compareEntities(sort: string, dir: string): (a: PublicEntity, b: PublicEntity) => number {
  return (a, b) => {
    const va = entityValue(a, sort), vb = entityValue(b, sort);
    const na = va === null ? -Infinity : va, nb = vb === null ? -Infinity : vb;
    const primary = dir === 'desc' ? nb - na : na - nb;
    if (primary !== 0) return primary;
    return a.agency_name.localeCompare(b.agency_name, 'ko') ||
      (a.manager_name ?? '').localeCompare(b.manager_name ?? '', 'ko') ||
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  };
}

function routeName(pathname: string): string {
  const marker = '/public-analytics/';
  const index = pathname.indexOf(marker);
  return index < 0 ? '' : pathname.slice(index + marker.length).replace(/\/+$/, '');
}

export function createPublicHandler(repo: AnalyticsRepository, access: PublicAccess) {
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get('origin');
    const originAllowed = origin !== null && access.allowedOrigins.includes(origin);
    const headers: Headers = {
      'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store, max-age=0',
      Pragma: 'no-cache', 'X-Content-Type-Options': 'nosniff', Vary: 'Origin, Authorization',
      ...(originAllowed && origin ? { 'Access-Control-Allow-Origin': origin } : {}),
    };
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
    const errorResponse = (code: string, status: number, details?: ViewerThresholdDetails) =>
      errorWith(code, status, headers, details);
    if (origin !== null && !originAllowed) return errorResponse('origin_forbidden', 403);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { ...headers, 'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, apikey, accept', 'Access-Control-Max-Age': '600' } });
    }
    if (request.method !== 'GET') return errorResponse('METHOD_NOT_ALLOWED', 405);
    const url = new URL(request.url);
    const route = routeName(url.pathname);
    if (!['meta', 'dashboard', 'overview', 'map', 'series', 'entities', 'vehicles/top', 'places'].includes(route) &&
      !route.startsWith('points/') && !route.startsWith('places/')) {
      return errorResponse('NOT_FOUND', 404);
    }
    try {
      const { uid, session } = await authenticate(request, access);
      const v = await access.viewer(uid, session);
      if (!v.user_ok) return errorResponse('contributor_required', 403);
      if (!v.kakao) return errorResponse('kakao_required', 403);
      if (!v.session) return errorResponse('session_expired', 401);
      if (v.contributor !== 'active') return errorResponse('contributor_required', 403);
      if (v.has_public_facts !== true) {
        const gate = mapViewerEligibility(v);
        return errorResponse('upload_required', 403, { required: gate.required, current: gate.current });
      }
      // Map viewer threshold (user decision 2026-09-28): 10+ publicly-listed reports. Compared here in
      // the Edge layer (server/viewerAuth.ts), never in SQL, and fail-closed on pre-threshold databases.
      const gate = mapViewerEligibility(v);
      if (!gate.ok) return errorResponse('upload_required', 403, { required: gate.required, current: gate.current });
      if (!await repo.allowRequest(request, uid)) return errorResponse('RATE_LIMITED', 429);
      const state = await repo.getState();
      if (route === 'meta') {
        if ([...url.searchParams].length) throw new QueryError('INVALID_QUERY', 400);
        return json(meta(state), 200);
      }
      if (route !== 'entities' && ENTITY_ONLY.some(name => url.searchParams.has(name))) {
        throw new QueryError('INVALID_QUERY', 400);
      }
      // view_bbox = the map viewport of a display refinement (R07/F04); it never enters the statistics scope
      if (route !== 'places' && url.searchParams.has('view_bbox')) throw new QueryError('INVALID_QUERY', 400);
      let viewBbox: [number, number, number, number] | null = null;
      if (route === 'places') {
        const raw = url.searchParams.get('view_bbox');
        viewBbox = raw === null || url.searchParams.getAll('view_bbox').length !== 1 ? null : parseBbox(raw);
        if (!viewBbox) throw new QueryError('INVALID_QUERY', 400);
      }
      const scopeParams = new URLSearchParams(url.searchParams);
      scopeParams.delete('view_bbox');
      const scope = parseScope(scopeParams, state);
      if (url.searchParams.get('expected_version') && url.searchParams.get('expected_version') !== state.dataset_version) {
        throw new QueryError('DATASET_CHANGED', 409);
      }
      if (!state.ready) throw new QueryError('AGGREGATE_NOT_READY', 503);
      if (!state.generated_at) throw new QueryError('AGGREGATE_NOT_READY', 503);
      if (route === 'entities') {
        if (!['agency', 'manager'].includes(url.searchParams.get('kind') || '')) throw new QueryError('INVALID_QUERY', 400);
        const type = url.searchParams.get('agency_type');
        if (type !== null && type !== 'police' && type !== 'non_police') throw new QueryError('INVALID_QUERY', 400);
      }
      let placeKey: string | null = null;
      if (route.startsWith('places/')) {
        try { placeKey = decodeURIComponent(route.slice('places/'.length)); }
        catch { throw new QueryError('INVALID_QUERY', 400); }
        if (!/^pl1:[0-9a-f]{16}$/.test(placeKey)) throw new QueryError('INVALID_QUERY', 400);
      }
      const facts = await repo.getFacts(scope);
      const common = { schema_version: 2, dataset_version: state.dataset_version, sample: false, scope };
      if (placeKey !== null) {
        // R05/R07: one address, every fact of the place key under the scope (never a coordinate bbox)
        const selection = selectScope(representatives(facts), scope);
        const own = placeFacts(placeKey, selection.reported, selection.done);
        const anchor = representativeOf([...own.reported, ...own.done]);
        // only drawable places have a detail (a place without any coordinate is counted in map_unplaced)
        if (!anchor) return errorResponse('NOT_FOUND', 404);
        const agencies = entityRows(own.done, 'agency'), managers = entityRows(own.done, 'manager');
        return json({ ...common, place: placeSummary(placeKey, own.reported, own.done, anchor),
          agencies: agencies.slice(0, 100), managers: managers.slice(0, 100),
          agency_total: agencies.length, manager_total: managers.length }, 200);
      }
      if (route === 'places') {
        // display refinement of the map only: exact address places inside the viewport under the SAME scope
        const selection = selectScope(representatives(facts), scope);
        const inView = placesInView(placeRows(selection.reported, selection.done).places, viewBbox!);
        const nodes = mapNodes(inView);
        return json({ ...common, view_bbox: viewBbox, points: nodes, total_places: inView.length,
          compacted: nodes.length < inView.length }, 200);
      }
      const data = aggregateDashboard(facts, scope, {
        datasetVersion: state.dataset_version, sourceUpdatedAt: state.source_updated_at,
        generatedAt: state.generated_at, asOf: state.data_max || scope.end, sample: false,
        dataMin: state.data_min,
      });
      // location_missing: unique facts actually in the current range's report/completion indicators
      // but without coordinates (SOL-07 basis: comparison-window-only facts excluded, counted once).
      if (route === 'dashboard') return json({ ...common, location_missing: data.meta.location_missing ?? 0,
        overview: data.overview, points: data.points,
        monthly: data.monthly, agencies: data.agencies.slice(0, 100), managers: data.managers.slice(0, 100),
        regions: (data.regions ?? []).slice(0, 300), laws: (data.laws ?? []).slice(0, 300), vehicles: data.vehicles, vehicle_total_scope_reports: data.vehicle_total_scope_reports,
        vehicle_identifiable_reports: data.vehicle_identifiable_reports,
        analytics: data.analytics ?? null, map_unplaced: data.map_unplaced ?? null }, 200);
      if (route === 'overview') return json({ ...common, location_missing: data.meta.location_missing ?? 0, overview: data.overview }, 200);
      if (route === 'map') return json({ ...common, points: data.points }, 200);
      if (route === 'series') return json({ ...common, monthly: data.monthly }, 200);
      if (route === 'vehicles/top') return json({ ...common, time_basis: 'report_date',
        total_scope_reports: data.vehicle_total_scope_reports, identifiable_reports: data.vehicle_identifiable_reports,
        items: data.vehicles }, 200);
      if (route === 'entities') {
        const page = Number(url.searchParams.get('page') || '1'), pageSize = Number(url.searchParams.get('page_size') || '50');
        if (!Number.isInteger(page) || page < 1 || page > 10000 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
          throw new QueryError('INVALID_QUERY', 400);
        }
        // SOL-08: backward-compatible server search/sort over the full entity list. Existing callers
        // that omit q/sort/dir get the previous ordering and page shape unchanged (no response fields removed).
        const rawQ = url.searchParams.get('q');
        if (rawQ !== null && rawQ.length > 160) throw new QueryError('INVALID_QUERY', 400);
        const needle = (rawQ || '').trim();
        const sort = url.searchParams.get('sort') || 'completed';
        const dir = url.searchParams.get('dir') || 'desc';
        if (!entitySorts.has(sort) || (dir !== 'asc' && dir !== 'desc')) throw new QueryError('INVALID_QUERY', 400);
        let rows = url.searchParams.get('kind') === 'agency' ? data.agencies : data.managers;
        const agencyType = url.searchParams.get('agency_type');
        if (agencyType) rows = rows.filter(row => row.agency_type === agencyType);
        if (needle) rows = rows.filter(row => row.agency_name.includes(needle) || (row.manager_name ?? '').includes(needle));
        if (needle || agencyType || url.searchParams.get('sort') !== null || url.searchParams.get('dir') !== null) {
          rows = [...rows].sort(compareEntities(sort, dir));
        }
        return json({ ...common, items: rows.slice((page - 1) * pageSize, page * pageSize),
          total_rows: rows.length, page, page_size: pageSize }, 200);
      }
      let pointKey: string;
      try { pointKey = decodeURIComponent(route.slice('points/'.length)); }
      catch { throw new QueryError('INVALID_QUERY', 400); }
      if (!pointKey || pointKey.length > 160) throw new QueryError('INVALID_QUERY', 400);
      const point = data.points.find(row => row.key === pointKey);
      return point ? json({ ...common, point }, 200) : errorResponse('NOT_FOUND', 404);
    } catch (e) {
      if (e instanceof QueryError) return errorResponse(e.code, e.status);
      if (e instanceof ViewerAuthError) {
        return e.code === 'service_unavailable' ? errorResponse('AGGREGATE_NOT_READY', 503)
          : errorResponse(e.code, e.code === 'kakao_required' ? 403 : 401);
      }
      return errorResponse('AGGREGATE_NOT_READY', 503);
    }
  };
}
