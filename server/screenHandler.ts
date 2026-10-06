import { COHORT_POLICY_VERSION } from '../src/domain/public.ts';
import { compareRows, DEFAULT_SORT } from '../src/domain/tableSort.ts';
import { authenticate, ViewerAuthError } from './viewerAuth.ts';
import { createPublicHandler, parseScope, QueryError, type AnalyticsState, type ViewerCheck } from './publicHandler.ts';
import { aggregateCompare } from './compare.ts';
import { todayKst, entityRows, selectScope, representatives, type PrivateFact } from './aggregate.ts';
import type { PersonalDeps } from './personalHandler.ts';

/** A bounded screen, including personal comparison, is read once. No stored snapshot or retry race. */
export function createScreenHandler(deps: PersonalDeps) {
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get('origin');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store, max-age=0',
      Pragma: 'no-cache', Vary: 'Origin, Authorization', 'X-Content-Type-Options': 'nosniff',
      ...(origin && deps.allowedOrigins.includes(origin) ? { 'Access-Control-Allow-Origin': origin } : {}),
    };
    const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
    const error = (code: string, status: number) => reply({ error: { code, message: '통계를 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.' } }, status);
    if (origin && !deps.allowedOrigins.includes(origin)) return error('origin_forbidden', 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...headers,
      'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, apikey, accept' } });
    if (request.method !== 'GET') return error('METHOD_NOT_ALLOWED', 405);
    try {
      if (!deps.enabled) return error('AGGREGATE_NOT_READY', 503);
      const viewer = await authenticate(request, deps);
      const url = new URL(request.url), params = new URLSearchParams(url.searchParams);
      if (params.getAll('panels').length > 1 || (params.get('panels')?.length ?? 0) > 8000) throw new QueryError('INVALID_QUERY', 400);
      let panels: { id: string; path: string; params: Record<string, string> }[];
      try { panels = JSON.parse(params.get('panels') ?? '[]'); } catch { throw new QueryError('INVALID_QUERY', 400); }
      params.delete('panels');
      const scope = parseScope(params, { data_min: null, data_max: null }, new Set([
        'date_basis', 'start', 'end', 'category', 'region_code', 'agency_key', 'manager_key', 'bbox', 'law', 'expected_version', 'consistency',
      ]));
      if (!Array.isArray(panels) || panels.length > 8 || new Set(panels.map(p => p?.id)).size !== panels.length || panels.some(p =>
        !p || Object.keys(p).some(k => !['id', 'path', 'params'].includes(k)) || !/^[a-z-]{1,24}$/.test(p.id) ||
        !['entities', 'entity-prefix', 'laws', 'places', 'compare'].includes(p.path) && !/^places\/pl1:[0-9a-f]{16}$/.test(p.path) ||
        !p.params || typeof p.params !== 'object' || Array.isArray(p.params) || Object.entries(p.params).some(([k, v]) =>
          !['kind', 'page', 'page_size', 'q', 'sort', 'sort_value', 'dir', 'agency_type', 'view_bbox', 'entity_limit', 'through_page'].includes(k) || typeof v !== 'string'))) {
        throw new QueryError('INVALID_QUERY', 400);
      }
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`screen|user|${viewer.uid}`));
      const bucket = [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, '0')).join('');
      if (await deps.rpc('internal_community_ingest_rate_limit', { p_bucket: bucket, p_limit: 60 }) !== true) {
        headers['Retry-After'] = '60'; return error('RATE_LIMITED', 429);
      }
      const source = await deps.rpc('internal_analytics_read_snapshot', { p_scope: scope, p_previous: true,
        p_user: viewer.uid, p_session: viewer.session }) as { state: AnalyticsState; viewer: ViewerCheck; facts: PrivateFact[] };
      if (!source?.state || !source.viewer || !Array.isArray(source.facts)) return error('AGGREGATE_NOT_READY', 503);
      // The existing public gate/strict query validators and aggregators run over this immutable in-memory source.
      // No nested handler can issue another database read or charge another rate bucket.
      const local = createPublicHandler({ getState: async () => source.state, getFacts: async () => source.facts,
        allowRequest: async () => true }, { allowedOrigins: deps.allowedOrigins, jwtIssuer: deps.jwtIssuer,
        getUser: async () => ({ id: viewer.uid, isAnonymous: false }), viewer: async () => source.viewer });
      const read = (path: string, extra: Record<string, string> = {}) => {
        const q = new URLSearchParams(params); q.delete('expected_version'); q.set('consistency', 'latest');
        for (const [k, v] of Object.entries(extra)) q.set(k, v);
        return local(new Request(`${url.origin}/public-analytics/${path}${path === 'meta' ? '' : `?${q}`}`, { headers: request.headers, signal: request.signal }));
      };
      const dashboard = await read('dashboard');
      if (!dashboard.ok) return dashboard;
      const meta = await read('meta');
      const results = [];
      for (const p of panels) {
        if (p.path === 'entity-prefix') {
          const count = Number(p.params.through_page), kind = p.params.kind;
          if (!Number.isInteger(count) || count < 1 || count > 1000 || !['agency', 'manager'].includes(kind) ||
            Object.keys(p.params).some(k => !['kind', 'q', 'through_page'].includes(k)) || (p.params.q?.length ?? 0) > 160) throw new QueryError('INVALID_QUERY', 400);
          const needle = (p.params.q || '').trim();
          let rows = entityRows(selectScope(representatives(source.facts), scope).done, kind as 'agency' | 'manager');
          if (needle) rows = rows.filter(r => r.agency_name.includes(needle) || (r.manager_name ?? '').includes(needle));
          rows.sort(compareRows(DEFAULT_SORT, r => `${r.agency_name}\u0000${r.manager_name ?? ''}`, r => r.key));
          results.push({ id: p.id, status: 200, body: { schema_version: 2, dataset_version: source.state.dataset_version,
            scope, cohort_policy_version: COHORT_POLICY_VERSION, sample: false, items: rows.slice(0, count * 100),
            sort: DEFAULT_SORT, total_rows: rows.length, page: 1, page_size: count * 100 } });
        } else if (p.path === 'compare') {
          results.push({ id: p.id, status: 200, body: aggregateCompare(source.facts, scope, viewer.uid, {
            datasetVersion: source.state.dataset_version, asOf: source.state.data_max || scope.end,
            dataMin: source.state.data_min, basisBounds: source.state.basis_bounds ?? null, today: todayKst(),
            viewer: { contributor: source.viewer.contributor, has_public_facts: source.viewer.has_public_facts },
          }) });
        } else {
          const result = await read(p.path, p.params);
          results.push({ id: p.id, status: result.status, body: await result.json() });
        }
      }
      return reply({ schema_version: 'screen-v1', meta: await meta.json(), dashboard: await dashboard.json(), panels: results });
    } catch (e) {
      if (e instanceof QueryError) return error(e.code, e.status);
      if (e instanceof ViewerAuthError) return error(e.code, e.code === 'kakao_required' ? 403 : e.code === 'service_unavailable' ? 503 : 401);
      if (e instanceof Error && e.message === 'RESULT_TOO_LARGE') return error('RESULT_TOO_LARGE', 422);
      return error('AGGREGATE_NOT_READY', 503);
    }
  };
}
