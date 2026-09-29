// Runtime-agnostic handler for the user-only `my-analytics` function (docs/personal-comparison.md).
// Order: CORS/method/route → user JWT (getUser + claims; the viewer id comes ONLY from the verified user) →
// per-user rate limit → scope (same parser as the public API) → one RPC snapshot {state, viewer, facts} →
// all/mine over one selection → private, non-cacheable response. No admin-key fallback, no ids/tokens in logs.

import { aggregateCompare } from './compare.ts';
import { aggregateStatistics, parseSpec, StatsQueryError } from './statistics.ts';
import type { PrivateFact } from './aggregate.ts';
import { parseScope, QueryError, unifyBasis, type AnalyticsState } from './publicHandler.ts';
import { todayKst } from './aggregate.ts';
import { authenticate, ViewerAuthError, type ViewerAuthDeps, type ViewerUser } from './viewerAuth.ts';
import type { ViewerState } from '../src/domain/personal.ts';

export type Rpc = (name: string, args: Record<string, unknown>) => Promise<unknown>;
export type PersonalUser = ViewerUser;
export interface PersonalDeps extends ViewerAuthDeps {
  enabled: boolean;
  allowedOrigins: string[];
  rpc: Rpc;
  log?(entry: Record<string, string | number>): void;
}

/** The single RPC returns one database snapshot, so state, viewer and facts cannot disagree. */
export interface PersonalSource {
  state: AnalyticsState;
  viewer: { user_ok: boolean; kakao: boolean; session: boolean; contributor: ViewerState['contributor']; has_public_facts: boolean };
  facts: PrivateFact[];
}

const SCOPE_PARAMS: ReadonlySet<string> = new Set([
  'date_basis', 'start', 'end', 'category', 'region_code', 'agency_key', 'manager_key', 'bbox', 'law', 'expected_version',
]);

const MESSAGES: Record<string, [number, string]> = {
  auth_required: [401, '로그인이 필요합니다.'],
  session_expired: [401, '로그인이 만료되었습니다. 다시 로그인해 주세요.'],
  kakao_required: [403, '카카오 계정으로 로그인해야 내 신고를 비교할 수 있습니다.'],
  account_ineligible: [403, '이 계정으로는 내 신고 비교를 사용할 수 없습니다.'],
  origin_forbidden: [403, '허용되지 않은 요청입니다.'],
  not_found: [404, '요청을 처리할 수 없습니다.'],
  method_not_allowed: [405, '요청을 처리할 수 없습니다.'],
  INVALID_QUERY: [400, '요청을 처리할 수 없습니다.'],
  DATASET_CHANGED: [409, '그사이 새 자료가 들어왔습니다. 다시 불러와 주세요.'],
  BASIS_CONFLICT: [400, '조회 조건의 날짜 기준과 맞춤 통계 구성의 날짜 기준이 다릅니다. 하나로 맞춰 다시 요청해 주세요.'],
  rate_limited: [429, '잠시 후 다시 시도해 주세요.'],
  AGGREGATE_NOT_READY: [503, '통계가 아직 준비되지 않았습니다. 잠시 뒤 다시 확인해 주세요.'],
  RESULT_TOO_LARGE: [422, '이 조건의 신고가 한 번에 집계할 수 있는 양을 넘었습니다. 기간이나 지역을 좁혀 주세요.'],
  service_unavailable: [503, '잠시 후 다시 시도해 주세요.'],
};

class Fail extends Error {
  constructor(readonly code: string) { super(code); }
}
const fail = (code: string): never => { throw new Fail(code); };

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function requestId(): string {
  return crypto.randomUUID();
}

export function createPersonalHandler(deps: PersonalDeps): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const rid = requestId();
    const origin = request.headers.get('origin');
    const originAllowed = origin !== null && deps.allowedOrigins.includes(origin);
    // Personal data: never cacheable by a shared cache, always varies by the credential.
    const base: Record<string, string> = {
      'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store, max-age=0',
      Pragma: 'no-cache', 'X-Content-Type-Options': 'nosniff', Vary: 'Origin, Authorization',
      ...(originAllowed ? { 'Access-Control-Allow-Origin': origin! } : {}),
    };
    const respond = (status: number, body: unknown, extra: Record<string, string> = {}) =>
      new Response(JSON.stringify(body), { status, headers: { ...base, ...extra } });
    const error = (code: string) => {
      const [status, message] = MESSAGES[code] ?? MESSAGES.service_unavailable;
      deps.log?.({ event: 'my_analytics', outcome: code, request_id: rid });
      return respond(status, { error: { code: MESSAGES[code] ? code : 'service_unavailable', message } },
        status === 429 ? { 'Retry-After': '60' } : status === 401 ? { 'WWW-Authenticate': 'Bearer' } : {});
    };
    try {
      if (origin !== null && !originAllowed) fail('origin_forbidden');
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: { ...base, 'Access-Control-Allow-Methods': 'GET',
          'Access-Control-Allow-Headers': 'authorization, apikey, accept', 'Access-Control-Max-Age': '600' } });
      }
      if (request.method !== 'GET') fail('method_not_allowed');
      if (!deps.enabled) fail('service_unavailable');
      const url = new URL(request.url);
      // compare = the dashboard comparison; statistics = 맞춤 통계 with population mine/compare (S05, JWT viewer only)
      const stats = /\/my-analytics\/statistics\/?$/.test(url.pathname);
      if (!stats && !/\/my-analytics\/compare\/?$/.test(url.pathname)) fail('not_found');
      let spec: ReturnType<typeof parseSpec> | null = null;
      const scopeParams = new URLSearchParams(url.searchParams);
      if (stats) {
        spec = parseSpec(url.searchParams.get('spec'));
        if (spec.population === 'all') fail('INVALID_QUERY');
        scopeParams.delete('spec');
      } else if (url.searchParams.has('spec')) fail('INVALID_QUERY');

      const { uid, session } = await authenticate(request, deps);

      const bucket = await sha256Hex(`my-analytics|user|${uid}`);
      if (await deps.rpc('internal_community_ingest_rate_limit', { p_bucket: bucket, p_limit: 60 }) !== true) fail('rate_limited');

      // Parse the shape first so bad input never reaches the DB.
      let scope = parseScope(scopeParams, { data_min: null, data_max: null }, SCOPE_PARAMS);
      // EX-08: the scope's date basis and the recipe's are one value (a conflict is refused, never resolved silently)
      if (spec) scope = unifyBasis(scope, scopeParams.has('date_basis'), spec.date_basis);
      // single-date-v1 source: the representative is elected BEFORE the date condition, on scope.date_basis;
      // neither the comparison nor 맞춤 통계 needs the previous window (D14)
      const source = await deps.rpc('internal_my_analytics_cohort_source', {
        p_user: uid, p_session: session, p_date_basis: scope.date_basis, p_start: scope.start, p_end: scope.end,
        p_with_previous: false, p_category: scope.category,
        // region is filtered on official codes in server/aggregate.ts (same as the public API)
        p_region_code: null, p_agency_key: scope.agency_key, p_manager_key: scope.manager_key,
        p_bbox: scope.bbox,
        // the law (위반법규) is filtered in server/aggregate.ts, like the region
      }) as PersonalSource | null;
      if (!source || typeof source !== 'object' || !source.state || !source.viewer || !Array.isArray(source.facts)) fail('service_unavailable');
      const { state, viewer, facts } = source!;
      if (!viewer.user_ok) fail('account_ineligible');
      if (!viewer.kakao) fail('kakao_required');
      if (!viewer.session) fail('session_expired');
      const expected = url.searchParams.get('expected_version');
      if (expected && expected !== state.dataset_version) fail('DATASET_CHANGED');
      if (!state.ready || !state.generated_at) fail('AGGREGATE_NOT_READY');
      if (facts.length > 100000) fail('RESULT_TOO_LARGE');

      if (spec) {
        // the viewer id comes only from the verified JWT (uid); a user id in the request is never read
        const window = state.basis_bounds?.[scope.date_basis];
        const result = aggregateStatistics({ facts, scope, spec, datasetVersion: state.dataset_version, viewerId: uid,
          dataWindow: window ? { min: window.min, max: window.max } : { min: state.data_min, max: state.data_max } });
        deps.log?.({ event: 'my_analytics_statistics', outcome: 'ok', request_id: rid });
        return respond(200, result);
      }
      const body = aggregateCompare(facts, scope, uid, {
        datasetVersion: state.dataset_version, asOf: state.data_max || scope.end, dataMin: state.data_min,
        basisBounds: state.basis_bounds ?? null, today: todayKst(),
        viewer: { contributor: viewer.contributor, has_public_facts: viewer.has_public_facts === true },
      });
      deps.log?.({ event: 'my_analytics', outcome: 'ok', request_id: rid });
      return respond(200, body);
    } catch (e) {
      if (e instanceof Fail || e instanceof ViewerAuthError) return error(e.code);
      if (e instanceof QueryError) return error(e.code);
      if (e instanceof StatsQueryError) {
        if (e.code === 'RESULT_TOO_LARGE') return respond(422, { error: { code: 'RESULT_TOO_LARGE', message: e.message } });
        return error('INVALID_QUERY');
      }
      if (e instanceof Error && e.message === 'RESULT_TOO_LARGE') return error('RESULT_TOO_LARGE');
      return error('service_unavailable');
    }
  };
}
