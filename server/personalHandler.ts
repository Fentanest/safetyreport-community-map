// Runtime-agnostic handler for the user-only `my-analytics` function (docs/personal-comparison.md).
// Order: CORS/method/route → user JWT (getUser + claims; the viewer id comes ONLY from the verified user) →
// per-user rate limit → scope (same parser as the public API) → one RPC snapshot {state, viewer, facts} →
// all/mine over one selection → private, non-cacheable response. No admin-key fallback, no ids/tokens in logs.

import { aggregateCompare } from './compare.ts';
import type { PrivateFact } from './aggregate.ts';
import { parseScope, QueryError, type AnalyticsState } from './publicHandler.ts';
import type { ViewerState } from '../src/domain/personal.ts';

export type Rpc = (name: string, args: Record<string, unknown>) => Promise<unknown>;
export interface PersonalUser { id: string; isAnonymous: boolean }
export interface PersonalDeps {
  enabled: boolean;
  allowedOrigins: string[];
  jwtIssuer: string | null;
  getUser(accessToken: string): Promise<PersonalUser | null>;
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
  'start', 'end', 'category', 'region_code', 'agency_key', 'manager_key', 'bbox', 'expected_version',
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BEARER = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;

const MESSAGES: Record<string, [number, string]> = {
  auth_required: [401, '로그인이 필요합니다.'],
  session_expired: [401, '로그인이 만료되었습니다. 다시 로그인해 주세요.'],
  kakao_required: [403, '카카오 계정으로 로그인해야 내 신고를 비교할 수 있습니다.'],
  account_ineligible: [403, '이 계정으로는 내 신고 비교를 사용할 수 없습니다.'],
  origin_forbidden: [403, '허용되지 않은 요청입니다.'],
  not_found: [404, '요청을 처리할 수 없습니다.'],
  method_not_allowed: [405, '요청을 처리할 수 없습니다.'],
  INVALID_QUERY: [400, '요청을 처리할 수 없습니다.'],
  DATASET_CHANGED: [409, '데이터 버전이 변경됐습니다. 다시 조회해 주세요.'],
  rate_limited: [429, '잠시 후 다시 시도해 주세요.'],
  AGGREGATE_NOT_READY: [503, '공개 집계가 아직 준비되지 않았습니다.'],
  service_unavailable: [503, '잠시 후 다시 시도해 주세요.'],
};

class Fail extends Error {
  constructor(readonly code: string) { super(code); }
}
const fail = (code: string): never => { throw new Fail(code); };

function decodeClaims(token: string): Record<string, unknown> | null {
  try {
    const part = token.split('.')[1];
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - part.length % 4) % 4);
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), c => c.charCodeAt(0))));
  } catch { return null; }
}

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
      if (!/\/my-analytics\/compare\/?$/.test(url.pathname)) fail('not_found');

      const m = BEARER.exec(request.headers.get('authorization') || '');
      if (!m) fail('auth_required');
      const token = m![1];
      let user: PersonalUser | null;
      try { user = await deps.getUser(token); } catch { return error('service_unavailable'); }
      if (!user) fail('session_expired');
      const claims = decodeClaims(token);
      if (!claims || claims.sub !== user!.id || claims.role !== 'authenticated' || claims.aud !== 'authenticated') fail('auth_required');
      if (deps.jwtIssuer && claims!.iss !== deps.jwtIssuer) fail('auth_required');
      if (claims!.is_anonymous === true || user!.isAnonymous) fail('kakao_required');
      const session = typeof claims!.session_id === 'string' && UUID.test(claims!.session_id) ? claims!.session_id : fail('auth_required');
      const uid = user!.id;

      const bucket = await sha256Hex(`my-analytics|user|${uid}`);
      if (await deps.rpc('internal_community_ingest_rate_limit', { p_bucket: bucket, p_limit: 60 }) !== true) fail('rate_limited');

      // Bounds are re-checked against state below; parse shape first so bad input never reaches the DB.
      const scope = parseScope(url.searchParams, { data_min: null, data_max: null }, SCOPE_PARAMS);
      const source = await deps.rpc('internal_my_analytics_source', {
        p_user: uid, p_session: session, p_start: scope.start, p_end: scope.end, p_category: scope.category,
        p_region_code: scope.region_code, p_agency_key: scope.agency_key, p_manager_key: scope.manager_key,
        p_bbox: scope.bbox,
      }) as PersonalSource | null;
      if (!source || typeof source !== 'object' || !source.state || !source.viewer || !Array.isArray(source.facts)) fail('service_unavailable');
      const { state, viewer, facts } = source!;
      if (!viewer.user_ok) fail('account_ineligible');
      if (!viewer.kakao) fail('kakao_required');
      if (!viewer.session) fail('session_expired');
      parseScope(url.searchParams, state, SCOPE_PARAMS); // data_min/data_max bounds, same as the public API
      const expected = url.searchParams.get('expected_version');
      if (expected && expected !== state.dataset_version) fail('DATASET_CHANGED');
      if (!state.ready || !state.generated_at) fail('AGGREGATE_NOT_READY');
      if (facts.length > 100000) fail('AGGREGATE_NOT_READY');

      const body = aggregateCompare(facts, scope, uid, {
        datasetVersion: state.dataset_version, asOf: state.data_max || scope.end, dataMin: state.data_min,
        viewer: { contributor: viewer.contributor, has_public_facts: viewer.has_public_facts === true },
      });
      deps.log?.({ event: 'my_analytics', outcome: 'ok', request_id: rid });
      return respond(200, body);
    } catch (e) {
      if (e instanceof Fail) return error(e.code);
      if (e instanceof QueryError) return error(e.code);
      return error('service_unavailable');
    }
  };
}
