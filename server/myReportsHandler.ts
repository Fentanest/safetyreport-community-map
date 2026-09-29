import { authenticate, ViewerAuthError, type ViewerAuthDeps } from './viewerAuth.ts';

export interface MyReportsDeps extends ViewerAuthDeps {
  enabled: boolean;
  allowedOrigins: string[];
  rpc(name: string, args: Record<string, unknown>): Promise<unknown>;
  log?(entry: Record<string, string>): void;
}

const ROUTES = new Set(['search', 'summary', 'numbers']);
const fail = (code: string): never => { throw new Error(code); };
const normalizeVehicle = (value: string) => value.normalize('NFC').replace(/\s/gu, '');
const normalizeAddress = (value: string) => value.normalize('NFC').trim().replace(/\s+/gu, ' ');
async function readLimitedBody(request: Request): Promise<string> {
  const body = request.body;
  if (!body) return fail('INVALID_QUERY');
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 4096) { await reader.cancel(); fail('INVALID_QUERY'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return fail('INVALID_QUERY'); }
}

export function createMyReportsHandler(deps: MyReportsDeps): (request: Request) => Promise<Response> {
  return async request => {
    const origin = request.headers.get('origin');
    const allowed = origin !== null && deps.allowedOrigins.includes(origin);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'private, no-store, max-age=0',
      Pragma: 'no-cache',
      Vary: 'Origin, Authorization',
      'X-Content-Type-Options': 'nosniff',
      ...(allowed ? { 'Access-Control-Allow-Origin': origin! } : {}),
    };
    const response = (status: number, value: unknown, extra: Record<string, string> = {}) =>
      new Response(JSON.stringify(value), { status, headers: { ...headers, ...extra } });
    const error = (code: string) => {
      const status: Record<string, number> = {
        auth_required: 401, session_expired: 401, kakao_required: 403, account_ineligible: 403,
        origin_forbidden: 403, not_found: 404, method_not_allowed: 405, INVALID_QUERY: 400,
        DATASET_CHANGED: 409, RESULT_TOO_LARGE: 422, rate_limited: 429, service_unavailable: 503,
      };
      const safe = Object.hasOwn(status, code) ? code : 'service_unavailable';
      deps.log?.({ event: 'my_reports', outcome: safe });
      return response(status[safe], { error: { code: safe } }, status[safe] === 429 ? { 'Retry-After': '60' } : {});
    };
    try {
      if (origin !== null && !allowed) fail('origin_forbidden');
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: { ...headers,
          'Access-Control-Allow-Methods': 'POST',
          'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
          'Access-Control-Max-Age': '600',
        } });
      }
      if (request.method !== 'POST') fail('method_not_allowed');
      if (!deps.enabled) fail('service_unavailable');
      const route = new URL(request.url).pathname.match(/\/my-reports\/(search|summary|numbers)\/?$/)?.[1];
      if (!route || !ROUTES.has(route)) fail('not_found');
      const length = Number(request.headers.get('content-length') || 0);
      if (length > 4096) fail('INVALID_QUERY');
      const text = await readLimitedBody(request);
      let body: unknown;
      try { body = JSON.parse(text); } catch { fail('INVALID_QUERY'); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) fail('INVALID_QUERY');
      const values = body as Record<string, unknown>;
      if (Object.keys(values).some(key => !['kind', 'query', 'offset', 'limit', 'expected_version'].includes(key))) fail('INVALID_QUERY');
      const offset = values.offset ?? 0;
      const limit = values.limit ?? 20;
      if (!Number.isInteger(offset) || (offset as number) < 0 || (offset as number) > 5000 ||
          !Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 50) fail('INVALID_QUERY');
      if (values.expected_version !== undefined &&
        (typeof values.expected_version !== 'string' || !/^[0-9a-f]{32}$/.test(values.expected_version))) fail('INVALID_QUERY');
      let kind: string | null = null;
      let query: string | null = null;
      if (route === 'summary') {
        if (values.kind !== undefined || values.query !== undefined) fail('INVALID_QUERY');
      } else {
        kind = values.kind as string;
        if (kind !== 'vehicle' && kind !== 'address') fail('INVALID_QUERY');
        if (typeof values.query !== 'string') fail('INVALID_QUERY');
        query = kind === 'vehicle' ? normalizeVehicle(values.query as string) : normalizeAddress(values.query as string);
        const size = [...query].length;
        if (kind === 'vehicle' ? (size < 6 || size > 64) : (size < 5 || size > 200)) fail('INVALID_QUERY');
      }
      const { uid, session } = await authenticate(request, deps);
      const bytes = new TextEncoder().encode(`my-reports|${uid}`);
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      const bucket = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
      if (await deps.rpc('internal_community_ingest_rate_limit', { p_bucket: bucket, p_limit: 60 }) !== true) fail('rate_limited');
      const result = await deps.rpc('internal_my_reports', {
        p_user: uid, p_session: session, p_mode: route, p_kind: kind, p_query: query,
        p_offset: offset, p_limit: limit, p_expected_version: values.expected_version ?? null,
      });
      if (!result || typeof result !== 'object' || !Array.isArray((result as { items?: unknown }).items)) fail('service_unavailable');
      if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 256 * 1024) fail('RESULT_TOO_LARGE');
      deps.log?.({ event: 'my_reports', outcome: 'ok' });
      return response(200, result);
    } catch (cause) {
      if (cause instanceof ViewerAuthError) return error(cause.code);
      if (cause instanceof Error) {
        if (/DATASET_CHANGED/.test(cause.message)) return error('DATASET_CHANGED');
        if (/ACCOUNT_INELIGIBLE/.test(cause.message)) return error('account_ineligible');
        if (/INVALID_QUERY/.test(cause.message)) return error('INVALID_QUERY');
        if (/RESULT_TOO_LARGE/.test(cause.message)) return error('RESULT_TOO_LARGE');
        if (Object.hasOwn({ origin_forbidden: 1, not_found: 1, method_not_allowed: 1,
          rate_limited: 1, service_unavailable: 1 }, cause.message)) return error(cause.message);
      }
      return error('service_unavailable');
    }
  };
}
