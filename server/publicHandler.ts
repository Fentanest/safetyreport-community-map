import {
  aggregateDashboard, basisWindow, entityRows, focusSelection, lawRows, mapNodes, overviewOf, previousWindow, representatives,
  selectScope, todayKst, type PrivateFact,
} from './aggregate.ts';
import { placeKey as placeKeyOfFact, placeRows, placesInView, placeSummary, representativeOf } from './places.ts';
import { codeForLegacyKey } from './regions.ts';
import { aggregateStatistics, parseFilters, parseSpec, statisticsCandidates, statisticsCatalog, StatsQueryError } from './statistics.ts';
import { authenticate, mapViewerEligibility, ViewerAuthError, type ViewerAuthDeps } from './viewerAuth.ts';
import {
  COHORT_POLICY_VERSION, DEFAULT_DATE_BASIS, isDateBasis, isLawParam, LAW_NONE, lawKey, parseBbox,
  type BasisBounds, type PublicEntity, type PublicLaw, type PublicMeta, type Scope,
} from '../src/domain/public.ts';
import { compareRows, DEFAULT_SORT, isSortSpec, legacySort, type SortSpec, type SortValue } from '../src/domain/tableSort.ts';

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
  /** 전체 기간 per basis (internal_analytics_cohort_state); absent on the older state RPC */
  basis_bounds?: BasisBounds | null;
}

export interface FactsOptions {
  /** read the previous window too (only routes that show a comparison ask for it; D14) */
  previous: boolean;
}

export interface AnalyticsRepository {
  getState(): Promise<AnalyticsState>;
  /** facts of the scope's cohort window on scope.date_basis (representative elected before the date condition) */
  getFacts(scope: Scope, options?: FactsOptions): Promise<PrivateFact[]>;
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
  'date_basis', 'start', 'end', 'category', 'region_code', 'agency_key', 'manager_key', 'bbox', 'law',
  'expected_version', 'kind', 'page', 'page_size', 'q', 'sort', 'sort_value', 'dir', 'agency_type', 'view_bbox', 'entity_limit',
]);
/** 맞춤 통계 parameters (S05–S08): the declarative spec / candidate search; never part of the scope */
export const STATS_ONLY = ['spec', 'kind', 'q', 'cursor', 'limit', 'filters', 'keys', 'basis', 'place_key'];
// list-only parameters: never part of the statistics scope
const ENTITY_ONLY = ['kind', 'page', 'page_size', 'q', 'sort', 'sort_value', 'dir', 'agency_type'];
const LAW_LIST_ONLY = ['page', 'page_size', 'q', 'sort', 'sort_value', 'dir'];
const date = /^\d{4}-\d{2}-\d{2}$/;
const key = /^[\p{L}\p{N}._:-]{1,160}$/u;

function json(body: unknown, status: number, headers: Headers): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

const ACCESS_MESSAGES: Record<string, string> = {
  auth_required: '카카오 로그인이 필요합니다.',
  session_expired: '로그인이 만료되었습니다. 다시 로그인해 주세요.',
  kakao_required: '카카오 계정으로 로그인해 주세요.',
  contributor_required: '지금은 신고내용 공유에 동의한 사람만 볼 수 있습니다.',
  upload_required: '지도에 올라간 내 신고가 10건 이상이면 볼 수 있습니다. 앱에서 답변 받은 신고를 공유하면 볼 수 있습니다.',
  origin_forbidden: '허용되지 않은 요청입니다.',
};

function errorWith(code: string, status: number, headers: Headers, details?: ViewerThresholdDetails): Response {
  const res = json({ error: { code, message: code === 'RATE_LIMITED' ? '잠시 후 다시 시도해 주세요.' :
    code === 'AGGREGATE_NOT_READY' ? '통계가 아직 준비되지 않았습니다. 잠시 뒤 다시 확인해 주세요.' :
      code === 'DATASET_CHANGED' ? '그사이 새 자료가 들어왔습니다. 다시 불러와 주세요.' :
        code === 'RESULT_TOO_LARGE' ? '이 조건의 신고가 한 번에 집계할 수 있는 양을 넘었습니다. 기간이나 지역을 좁혀 주세요.' :
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
  // U01: one date selects the reports. An old link without it opens on the default (답변일); anything else is refused.
  const basisRaw = params.get('date_basis');
  if (basisRaw !== null && !isDateBasis(basisRaw)) throw new QueryError('INVALID_QUERY', 400);
  const dateBasis = basisRaw ?? DEFAULT_DATE_BASIS;
  // No length cap (2026-09-30): the whole shared history must be queryable. The only bounds are a real calendar
  // range (start ≤ end) and a comparison window that stays on the calendar; the data volume is guarded by the
  // repository's row budget (RESULT_TOO_LARGE), never by silently shortening the period.
  try {
    const previous = previousWindow(start, end);
    if (previous.start < '1900-01-01') throw new Error('range');
  } catch { throw new QueryError('INVALID_QUERY', 400); }
  // A valid calendar range outside the data is a normal empty result (DT-13/DT-15), never an invalid query:
  // `state` bounds are no longer used to refuse a period.
  void state;
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
  return { date_basis: dateBasis, start, end, category: category as Scope['category'], region_code: regionCode,
    agency_key: optional('agency_key'), manager_key: optional('manager_key'), bbox, law };
}

function meta(state: AnalyticsState): PublicMeta {
  const capability = (supported: boolean, reason: string | null = null) => ({
    status: supported ? 'supported' as const : 'missing' as const,
    reason, coverage: null,
  });
  const reason = state.ready ? null : '통계 자료가 아직 준비되지 않았습니다.';
  return {
    schema_version: 2, dataset_version: state.dataset_version, sample: false,
    source_updated_at: state.source_updated_at, generated_at: state.generated_at,
    published_at: state.published_at, data_min: state.data_min, data_max: state.data_max,
    coverage_note: state.coverage_note, dedupe_policy_version: state.dedupe_policy_version,
    // 전체 기간 of each basis (DT-15) and the server's KST today (D12); the policy version tells old servers apart
    cohort_policy_version: COHORT_POLICY_VERSION, today_kst: todayKst(), basis_bounds: state.basis_bounds ?? null,
    capabilities: Object.fromEntries([
      'daily_report_dates', 'completion_dates', 'manager_status_cross', 'agency_status_cross', 'vehicle_top5',
      'fine_amount', 'processing_duration', 'region_boundaries', 'violation_law',
    ].map(name => [name, capability(state.ready, reason)])),
  };
}

/** U03: one sort spec from `sort`/`sort_value`/`dir` (registry allowlist; legacy SOL-08 keys still accepted). */
function parseSort(params: URLSearchParams): SortSpec {
  const rawSort = params.get('sort'), rawValue = params.get('sort_value'), rawDir = params.get('dir');
  if (rawSort === null && rawValue === null && rawDir === null) return DEFAULT_SORT;
  const legacy = legacySort(rawSort ?? DEFAULT_SORT.column);
  if (!legacy) throw new QueryError('INVALID_QUERY', 400);
  const value = (rawValue ?? legacy.value) as SortValue, dir = rawDir ?? 'desc';
  if (!isSortSpec(legacy.column, value, dir)) throw new QueryError('INVALID_QUERY', 400);
  return { column: legacy.column, value, dir: dir as SortSpec['dir'] };
}

function pageOf(params: URLSearchParams): { page: number; pageSize: number } {
  const page = Number(params.get('page') || '1'), pageSize = Number(params.get('page_size') || '50');
  if (!Number.isInteger(page) || page < 1 || page > 10000 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new QueryError('INVALID_QUERY', 400);
  }
  return { page, pageSize };
}

function routeName(pathname: string): string {
  const marker = '/public-analytics/';
  const index = pathname.indexOf(marker);
  return index < 0 ? '' : pathname.slice(index + marker.length).replace(/\/+$/, '');
}

/** 맞춤 통계 routes of the PUBLIC API: population 'all' only (the viewer's own rows are served by my-analytics). */
async function statisticsRoute(route: string, url: URL, state: AnalyticsState, repo: AnalyticsRepository): Promise<unknown> {
  const statsAllowed = new Set([...allowed, ...STATS_ONLY].filter(n => !['page', 'page_size', 'sort', 'dir', 'agency_type', 'view_bbox', 'entity_limit'].includes(n)));
  for (const name of url.searchParams.keys()) if (!statsAllowed.has(name) || url.searchParams.getAll(name).length !== 1) throw new QueryError('INVALID_QUERY', 400);
  const scopeParams = new URLSearchParams(url.searchParams);
  for (const n of STATS_ONLY) scopeParams.delete(n);
  const scopeBasisGiven = scopeParams.has('date_basis');
  let scope = parseScope(scopeParams, state);
  if (url.searchParams.get('expected_version') && url.searchParams.get('expected_version') !== state.dataset_version) throw new QueryError('DATASET_CHANGED', 409);
  if (!state.ready || !state.generated_at) throw new QueryError('AGGREGATE_NOT_READY', 503);
  if (route === 'statistics/query') {
    for (const n of ['kind', 'q', 'cursor', 'limit', 'filters', 'keys', 'basis', 'place_key']) if (url.searchParams.has(n)) throw new QueryError('INVALID_QUERY', 400);
    const spec = parseSpec(url.searchParams.get('spec'));
    if (spec.population !== 'all') throw new QueryError('INVALID_QUERY', 400);
    scope = unifyBasis(scope, scopeBasisGiven, spec.date_basis);
    const facts = await repo.getFacts(scope, { previous: false });
    return aggregateStatistics({ facts, scope, spec, datasetVersion: state.dataset_version, dataWindow: basisWindow(scope.date_basis, windowOptions(state)) });
  }
  if (url.searchParams.has('spec')) throw new QueryError('INVALID_QUERY', 400);
  const q = url.searchParams.get('q') ?? '';
  if (q.length > 80) throw new QueryError('INVALID_QUERY', 400);
  const cursor = Number(url.searchParams.get('cursor') ?? '0'), limit = Number(url.searchParams.get('limit') ?? '30');
  if (!Number.isInteger(cursor) || cursor < 0 || cursor > 100000 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new QueryError('INVALID_QUERY', 400);
  const basisParam = url.searchParams.get('basis');
  if (basisParam !== null && !isDateBasis(basisParam)) throw new QueryError('INVALID_QUERY', 400);
  scope = unifyBasis(scope, scopeBasisGiven, basisParam ?? scope.date_basis);
  const basis = scope.date_basis;
  const placeKey = url.searchParams.get('place_key');
  if (placeKey !== null && !/^pl1:[0-9a-f]{16}$/.test(placeKey)) throw new QueryError('INVALID_QUERY', 400);
  let keys: string[] = [];
  const rawKeys = url.searchParams.get('keys');
  if (rawKeys !== null) {
    try { keys = JSON.parse(rawKeys); } catch { throw new QueryError('INVALID_QUERY', 400); }
    if (!Array.isArray(keys) || keys.length > 50 || keys.some(k => typeof k !== 'string' || k.length > 160)) throw new QueryError('INVALID_QUERY', 400);
  }
  const facts = await repo.getFacts(scope, { previous: false });
  return statisticsCandidates({ facts, scope, datasetVersion: state.dataset_version, kind: url.searchParams.get('kind') ?? '', q, cursor, limit,
    filters: parseFilters(url.searchParams.get('filters')), basis, placeKey, keys });
}

/** EX-08: the scope's date_basis and the recipe's date_basis are ONE value. Two different values are refused
 *  (never silently choosing one); a request without the scope value uses the recipe's (old recipes keep theirs). */
export function unifyBasis(scope: Scope, scopeGiven: boolean, specBasis: Scope['date_basis']): Scope {
  if (scopeGiven && scope.date_basis !== specBasis) throw new QueryError('BASIS_CONFLICT', 400);
  return { ...scope, date_basis: specBasis };
}

export function windowOptions(state: AnalyticsState) {
  return { basisBounds: state.basis_bounds ?? null, dataMin: state.data_min, asOf: state.data_max ?? '' };
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
    if (!['meta', 'dashboard', 'overview', 'map', 'series', 'entities', 'laws', 'vehicles/top', 'places',
      'statistics/catalog', 'statistics/query', 'statistics/candidates'].includes(route) &&
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
      if (route === 'statistics/catalog') {
        if ([...url.searchParams].length) throw new QueryError('INVALID_QUERY', 400);
        return json(statisticsCatalog(), 200);
      }
      if (route === 'statistics/query' || route === 'statistics/candidates') return json(await statisticsRoute(route, url, state, repo), 200);
      if (route !== 'entities' && ENTITY_ONLY.some(name => url.searchParams.has(name) && !(route === 'laws' && LAW_LIST_ONLY.includes(name)))) {
        throw new QueryError('INVALID_QUERY', 400);
      }
      // view_bbox = the map viewport of a display refinement (R07/F04); it never enters the statistics scope
      if (route !== 'places' && url.searchParams.has('view_bbox')) throw new QueryError('INVALID_QUERY', 400);
      // entity_limit: how many agencies/managers a place detail returns (R3 "더 보기"); place detail only
      if (!route.startsWith('places/') && url.searchParams.has('entity_limit')) throw new QueryError('INVALID_QUERY', 400);
      const entityLimitRaw = url.searchParams.get('entity_limit');
      const entityLimit = entityLimitRaw === null ? 100 : Number(entityLimitRaw);
      if (!Number.isInteger(entityLimit) || entityLimit < 1 || entityLimit > 1000) throw new QueryError('INVALID_QUERY', 400);
      let viewBbox: [number, number, number, number] | null = null;
      if (route === 'places') {
        const raw = url.searchParams.get('view_bbox');
        viewBbox = raw === null || url.searchParams.getAll('view_bbox').length !== 1 ? null : parseBbox(raw);
        if (!viewBbox) throw new QueryError('INVALID_QUERY', 400);
      }
      const scopeParams = new URLSearchParams(url.searchParams);
      scopeParams.delete('view_bbox');
      scopeParams.delete('entity_limit');
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
      // D14: only the routes that show a comparison read the previous window
      const previous = route === 'dashboard' || route === 'overview' || placeKey !== null;
      const facts = await repo.getFacts(scope, { previous });
      const common = { schema_version: 2, dataset_version: state.dataset_version, sample: false, scope,
        cohort_policy_version: COHORT_POLICY_VERSION };
      const window = basisWindow(scope.date_basis, windowOptions(state));
      if (placeKey !== null) {
        // R05/R07 + U02: one address, every fact of the place key under the scope (never a coordinate bbox);
        // the focus overview uses the SAME builder as the dashboard, restricted to this address
        const key = placeKey;
        const inPlace = (fact: PrivateFact) => placeKeyOfFact(fact) === key;
        const selection = focusSelection(selectScope(representatives(facts), scope), inPlace);
        const full = focusSelection(selectScope(facts, scope), inPlace);
        const anchor = representativeOf(selection.cohort);
        // only drawable places have a detail (a place without any coordinate is counted in map_unplaced)
        if (!anchor) return errorResponse('NOT_FOUND', 404);
        const agencies = entityRows(selection.done, 'agency'), managers = entityRows(selection.done, 'manager');
        const overview = overviewOf({ sel: selection, full, comparisonCovered: window.min === null || selection.prev.start >= window.min });
        return json({ ...common, place: placeSummary(placeKey, selection.cohort, selection.done, anchor), overview,
          agencies: agencies.slice(0, entityLimit), managers: managers.slice(0, entityLimit),
          agency_total: agencies.length, manager_total: managers.length }, 200);
      }
      if (route === 'laws') {
        // U03: the full law list of the scope, searched and sorted on the server, then paged
        const { page, pageSize } = pageOf(url.searchParams);
        const rawQ = url.searchParams.get('q');
        if (rawQ !== null && rawQ.length > 160) throw new QueryError('INVALID_QUERY', 400);
        const needle = (rawQ || '').trim();
        const sort = parseSort(url.searchParams);
        const selection = selectScope(representatives(facts), scope);
        const nameOf = (row: PublicLaw) => row.law ?? '법규 미상';
        let rows = lawRows(selection.done);
        if (needle) rows = rows.filter(row => nameOf(row).includes(needle));
        rows = [...rows].sort(compareRows(sort, nameOf, row => row.law ?? '\uffff'));
        return json({ ...common, sort, items: rows.slice((page - 1) * pageSize, page * pageSize),
          total_rows: rows.length, page, page_size: pageSize }, 200);
      }
      if (route === 'places') {
        // display refinement of the map only: exact address places inside the viewport under the SAME scope
        const selection = selectScope(representatives(facts), scope);
        const inView = placesInView(placeRows(selection.cohort, selection.done).places, viewBbox!);
        const nodes = mapNodes(inView);
        return json({ ...common, view_bbox: viewBbox, points: nodes, total_places: inView.length,
          compacted: nodes.length < inView.length }, 200);
      }
      const data = aggregateDashboard(facts, scope, {
        datasetVersion: state.dataset_version, sourceUpdatedAt: state.source_updated_at,
        generatedAt: state.generated_at, asOf: state.data_max || scope.end, sample: false,
        dataMin: state.data_min, basisBounds: state.basis_bounds ?? null, today: todayKst(),
      });
      // location_missing: unique facts actually in the current range's report/completion indicators
      // but without coordinates (SOL-07 basis: comparison-window-only facts excluded, counted once).
      if (route === 'dashboard') return json({ ...common, location_missing: data.meta.location_missing ?? 0,
        overview: data.overview, points: data.points,
        monthly: data.monthly, agencies: data.agencies.slice(0, 100), managers: data.managers.slice(0, 100),
        agency_total: data.agencies.length, manager_total: data.managers.length,
        regions: (data.regions ?? []).slice(0, 400), laws: (data.laws ?? []).slice(0, 300), vehicles: data.vehicles, vehicle_total_scope_reports: data.vehicle_total_scope_reports,
        vehicle_identifiable_reports: data.vehicle_identifiable_reports,
        analytics: data.analytics ?? null, map_unplaced: data.map_unplaced ?? null }, 200);
      if (route === 'overview') return json({ ...common, location_missing: data.meta.location_missing ?? 0, overview: data.overview }, 200);
      if (route === 'map') return json({ ...common, points: data.points }, 200);
      if (route === 'series') return json({ ...common, monthly: data.monthly }, 200);
      if (route === 'vehicles/top') return json({ ...common, time_basis: scope.date_basis,
        total_scope_reports: data.vehicle_total_scope_reports, identifiable_reports: data.vehicle_identifiable_reports,
        items: data.vehicles }, 200);
      if (route === 'entities') {
        const { page, pageSize } = pageOf(url.searchParams);
        // U03: filter → the full entity list of the scope → sort (count or exact rate, nulls last) → page
        const rawQ = url.searchParams.get('q');
        if (rawQ !== null && rawQ.length > 160) throw new QueryError('INVALID_QUERY', 400);
        const needle = (rawQ || '').trim();
        const sort = parseSort(url.searchParams);
        let rows = url.searchParams.get('kind') === 'agency' ? data.agencies : data.managers;
        const agencyType = url.searchParams.get('agency_type');
        if (agencyType) rows = rows.filter(row => row.agency_type === agencyType);
        if (needle) rows = rows.filter(row => row.agency_name.includes(needle) || (row.manager_name ?? '').includes(needle));
        rows = [...rows].sort(compareRows<PublicEntity>(sort, row => `${row.agency_name}\u0000${row.manager_name ?? ''}`, row => row.key));
        return json({ ...common, sort, items: rows.slice((page - 1) * pageSize, page * pageSize),
          total_rows: rows.length, page, page_size: pageSize }, 200);
      }
      let pointKey: string;
      try { pointKey = decodeURIComponent(route.slice('points/'.length)); }
      catch { throw new QueryError('INVALID_QUERY', 400); }
      if (!pointKey || pointKey.length > 160) throw new QueryError('INVALID_QUERY', 400);
      const point = data.points.find(row => row.key === pointKey);
      return point ? json({ ...common, point }, 200) : errorResponse('NOT_FOUND', 404);
    } catch (e) {
      if (e instanceof QueryError) return e.code === 'BASIS_CONFLICT'
        ? json({ error: { code: 'BASIS_CONFLICT', message: '조회 조건의 날짜 기준과 맞춤 통계 구성의 날짜 기준이 다릅니다. 하나로 맞춰 다시 요청해 주세요.' } }, 400)
        : errorResponse(e.code, e.status);
      if (e instanceof StatsQueryError) {
        // the budget message tells the user how to narrow the query (never a raw SQL/stack detail)
        if (e.code === 'RESULT_TOO_LARGE') {
          const res = errorResponse('RESULT_TOO_LARGE', 422);
          return new Response(JSON.stringify({ error: { code: 'RESULT_TOO_LARGE', message: e.message } }), { status: 422, headers: res.headers });
        }
        return errorResponse('INVALID_QUERY', 400);
      }
      // the repository refused to materialise more facts than its budget: say so (never a partial result)
      if (e instanceof Error && e.message === 'RESULT_TOO_LARGE') return errorResponse('RESULT_TOO_LARGE', 422);
      if (e instanceof ViewerAuthError) {
        return e.code === 'service_unavailable' ? errorResponse('AGGREGATE_NOT_READY', 503)
          : errorResponse(e.code, e.code === 'kakao_required' ? 403 : 401);
      }
      return errorResponse('AGGREGATE_NOT_READY', 503);
    }
  };
}
