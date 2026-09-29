// Runtime-agnostic handler of the user-only `my-reports` function (contracts/my-reports/README.md).
// Order: CORS/method/route → Content-Type/body size/strict JSON shape → user JWT (getUser + claims; the user id comes
// ONLY from the verified user) → per-user DB rate limit → cursor signature/binding → ONE RPC per request (account
// gate, own set, version, selection, aggregates and page in one DB snapshot) → allowlisted DTO → response byte cap.
// No admin-key fallback, no body/query/plate/address/token/id in logs, never a 0-row success for a failure.

import {
  CONTRACT, ERRORS, LIMITS, STATUSES, DISPOSITIONS, CATEGORIES, AMOUNT_KINDS, STATUS_LABEL, TIMEZONE,
  normalizeAddress, normalizeVehicle, officialUrl, validQuery,
  type ErrorCode, type Kind, type ReportRow, type Summary, type ManagerRow, type ManagerPage, type ReportPage,
  type ContributorState,
} from '../../contracts/my-reports/types.ts';
import { authenticate, ViewerAuthError, type ViewerAuthDeps } from '../viewerAuth.ts';
import { signCursor, verifyCursor, sha256Hex, userDigest, queryDigest, type CursorPayload, type CursorRoute } from './cursor.ts';

export type MyReportsRpc = (name: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>;

export interface MyReportsDeps extends ViewerAuthDeps {
  enabled: boolean;
  allowedOrigins: string[];
  cursorSecret: string;
  rpc: MyReportsRpc;
  /** per-user requests per minute over the three routes */
  rateLimitPerMinute?: number;
  /** DB call budget (ms) */
  queryTimeoutMs?: number;
  now?(): number;
  log?(entry: Record<string, string | number>): void;
}

/** Errors a deps.rpc implementation may throw by message. */
export const RPC_TIMEOUT = 'QUERY_TIMEOUT';
export const RPC_INVALID = 'INVALID_QUERY';

class Fail extends Error {
  constructor(readonly code: ErrorCode) { super(code); }
}
const fail = (code: ErrorCode): never => { throw new Fail(code); };

type Route = 'search' | 'summary' | 'numbers';
const FIELDS: Record<Route, ReadonlySet<string>> = {
  search: new Set(['kind', 'query', 'part', 'cursor', 'page_size', 'managers_page_size']),
  summary: new Set(['cursor', 'page_size']),
  numbers: new Set(['kind', 'query', 'cursor', 'page_size']),
};

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

async function readBody(request: Request): Promise<string> {
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > LIMITS.body_bytes)) fail('PAYLOAD_TOO_LARGE');
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > LIMITS.body_bytes) { await reader.cancel().catch(() => {}); fail('PAYLOAD_TOO_LARGE'); }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.byteLength; }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(out); } catch { return fail('INVALID_REQUEST'); }
}

function pageSize(v: unknown, max: number): number | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > max) fail('INVALID_REQUEST');
  return v as number;
}

interface Parsed {
  kind: Kind | null;
  query: string | null;
  part: 'reports' | 'managers';
  cursor: string | null;
  pageSize: number | undefined;
  managersPageSize: number | undefined;
}

function parse(route: Route, text: string): Parsed {
  let body: unknown;
  try { body = JSON.parse(text); } catch { fail('INVALID_REQUEST'); }
  if (!isObj(body)) fail('INVALID_REQUEST');
  const b = body as Record<string, unknown>;
  for (const k of Object.keys(b)) if (!FIELDS[route].has(k)) fail('INVALID_REQUEST');
  const cursor = b.cursor === undefined || b.cursor === null ? null : b.cursor;
  if (cursor !== null && (typeof cursor !== 'string' || cursor.length === 0 || cursor.length > LIMITS.cursor_chars)) fail('INVALID_REQUEST');
  let kind: Kind | null = null, query: string | null = null;
  if (route !== 'summary') {
    if (b.kind !== 'vehicle' && b.kind !== 'address') fail('INVALID_REQUEST');
    if (typeof b.query !== 'string') fail('INVALID_REQUEST');
    kind = b.kind as Kind;
    if ((b.query as string).length > LIMITS.query_raw_chars) fail('QUERY_LENGTH');
    query = kind === 'vehicle' ? normalizeVehicle(b.query as string) : normalizeAddress(b.query as string);
    if (!validQuery(kind, query)) fail('QUERY_LENGTH');
  }
  const part = b.part === undefined ? 'reports' : b.part;
  if (part !== 'reports' && part !== 'managers') fail('INVALID_REQUEST');
  const max = route === 'numbers' ? LIMITS.numbers_page_size_max : LIMITS.page_size_max;
  return {
    kind, query, part: part as 'reports' | 'managers', cursor: cursor as string | null,
    pageSize: pageSize(b.page_size, max),
    managersPageSize: pageSize(b.managers_page_size, LIMITS.managers_page_size_max),
  };
}

// ------------------------------------------------------------------------------------------ DTO (allowlist only)

const str = (v: unknown) => (typeof v === 'string' ? v : v === null || v === undefined ? null : fail('SERVICE_UNAVAILABLE'));
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : v === null || v === undefined ? null : fail('SERVICE_UNAVAILABLE'));
const count = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : fail('SERVICE_UNAVAILABLE'));
const oneOf = <T extends string>(v: unknown, set: readonly T[]): T => (set.includes(v as T) ? v as T : fail('SERVICE_UNAVAILABLE'));
const day = (v: unknown) => { const s = str(v); return s === null || /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : fail('SERVICE_UNAVAILABLE'); };

export function toReportRow(o: unknown): ReportRow {
  if (!isObj(o)) fail('SERVICE_UNAVAILABLE');
  const r = o as Record<string, unknown>;
  const status = oneOf(r.status, STATUSES);
  const sourceId = str(r.source_report_id) ?? fail('SERVICE_UNAVAILABLE');
  const rating = num(r.rating);
  return {
    report_number: str(r.report_number),
    source_report_id: sourceId,
    official_url: officialUrl(sourceId),
    vehicle_number: str(r.vehicle_number),
    report_date: day(r.report_date),
    completed_date: day(r.completed_date),
    category: oneOf(r.category, CATEGORIES),
    status,
    status_label: STATUS_LABEL[status],
    disposition: oneOf(r.disposition, DISPOSITIONS),
    amount_kind: oneOf(r.amount_kind, AMOUNT_KINDS),
    confirmed_amount_won: num(r.confirmed_amount_won),
    penalty_points: num(r.penalty_points),
    address: str(r.address),
    lat: num(r.lat),
    lng: num(r.lng),
    agency_key: str(r.agency_key),
    agency_name_original: str(r.agency_name_original),
    agency_name_current: str(r.agency_name_current),
    manager_key: str(r.manager_key),
    manager_name: str(r.manager_name),
    violation_law: str(r.violation_law),
    rating: rating !== null && Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : null,
  };
}

const counts = <K extends string>(o: unknown, keys: readonly K[]): Record<K, number> => {
  if (!isObj(o)) fail('SERVICE_UNAVAILABLE');
  return Object.fromEntries(keys.map(k => [k, count((o as Record<string, unknown>)[k])])) as Record<K, number>;
};

function fineAmount(o: unknown) {
  if (!isObj(o)) fail('SERVICE_UNAVAILABLE');
  const f = o as Record<string, unknown>;
  return {
    fine_count: count(f.fine_count), confirmed_count: count(f.confirmed_count), confirmed_sum_won: num(f.confirmed_sum_won),
    unconfirmed_count: count(f.unconfirmed_count), other_count: count(f.other_count),
  };
}

export function toSummary(o: unknown): Summary {
  if (!isObj(o)) fail('SERVICE_UNAVAILABLE');
  const s = o as Record<string, unknown>;
  return {
    total: count(s.total), status: counts(s.status, STATUSES), accept_rate: num(s.accept_rate),
    disposition: counts(s.disposition, DISPOSITIONS), fine_amount: fineAmount(s.fine_amount),
    category: counts(s.category, CATEGORIES), completed_date_missing: count(s.completed_date_missing),
  };
}

function toManager(o: unknown): ManagerRow {
  if (!isObj(o)) fail('SERVICE_UNAVAILABLE');
  const m = o as Record<string, unknown>;
  return {
    agency_key: str(m.agency_key), manager_key: str(m.manager_key) ?? fail('SERVICE_UNAVAILABLE'),
    manager_name: str(m.manager_name), agency_name_original: str(m.agency_name_original),
    agency_name_current: str(m.agency_name_current), total: count(m.total), status: counts(m.status, STATUSES),
    accept_rate: num(m.accept_rate), disposition: counts(m.disposition, DISPOSITIONS), fine_amount: fineAmount(m.fine_amount),
  };
}

const items = <T>(v: unknown, f: (x: unknown) => T): T[] => (Array.isArray(v) ? v.map(f) : fail('SERVICE_UNAVAILABLE'));

// ------------------------------------------------------------------------------------------ handler

function addDays(d: string, n: number): string {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

export function todaySeoul(nowMs: number): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(nowMs));
}

export function createMyReportsHandler(deps: MyReportsDeps): (request: Request) => Promise<Response> {
  const now = deps.now ?? (() => Date.now());
  const perMinute = deps.rateLimitPerMinute ?? 120;
  const timeoutMs = deps.queryTimeoutMs ?? 5000;
  return async (request: Request): Promise<Response> => {
    const started = now();
    const rid = crypto.randomUUID();
    const origin = request.headers.get('origin');
    const originAllowed = origin !== null && deps.allowedOrigins.includes(origin);
    const base: Record<string, string> = {
      'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store, max-age=0',
      Pragma: 'no-cache', 'X-Content-Type-Options': 'nosniff', Vary: 'Origin, Authorization', 'X-Request-Id': rid,
      ...(originAllowed ? { 'Access-Control-Allow-Origin': origin!, 'Access-Control-Expose-Headers': 'Retry-After, X-Request-Id' } : {}),
    };
    let route: Route | 'unknown' = 'unknown';
    const log = (outcome: string, extra: Record<string, number> = {}) =>
      deps.log?.({ event: 'my_reports', route, outcome, request_id: rid, ms: Math.round(now() - started), ...extra });
    const error = (code: ErrorCode) => {
      const e = ERRORS[code];
      log(code);
      const extra: Record<string, string> = code === 'RATE_LIMITED' ? { 'Retry-After': '60' }
        : e.status === 503 ? { 'Retry-After': '5' } : e.status === 401 ? { 'WWW-Authenticate': 'Bearer' } : {};
      return new Response(JSON.stringify({ error: { code, message: e.message, retryable: e.retryable }, request_id: rid }),
        { status: e.status, headers: { ...base, ...extra } });
    };
    try {
      if (origin !== null && !originAllowed) fail('ORIGIN_FORBIDDEN');
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: { ...base, 'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Max-Age': '600' } });
      }
      const m = /\/my-reports\/(search|summary|numbers)\/?$/.exec(new URL(request.url).pathname);
      if (!m) fail('NOT_FOUND');
      route = m![1] as Route;
      if (request.method !== 'POST') fail('METHOD_NOT_ALLOWED');
      if (!deps.enabled || deps.cursorSecret.length < 32) fail('SERVICE_UNAVAILABLE');
      const ctype = (request.headers.get('content-type') || '').toLowerCase();
      if (!/^application\/json\s*(;|$)/.test(ctype)) fail('UNSUPPORTED_MEDIA_TYPE');
      const input = parse(route as Route, await readBody(request));

      let viewer: { uid: string; session: string };
      try { viewer = await authenticate(request, deps); } catch (e) {
        if (e instanceof ViewerAuthError) {
          return error(({ auth_required: 'AUTH_REQUIRED', session_expired: 'SESSION_EXPIRED', kakao_required: 'KAKAO_REQUIRED',
            service_unavailable: 'SERVICE_UNAVAILABLE' } as const)[e.code]);
        }
        throw e;
      }
      const { uid, session } = viewer;

      const signal = AbortSignal.timeout(timeoutMs);
      const call = async (name: string, args: Record<string, unknown>) => {
        try { return await deps.rpc(name, args, signal); } catch (e) {
          const msg = e instanceof Error ? e.message : '';
          if (signal.aborted || msg === RPC_TIMEOUT) fail('QUERY_TIMEOUT');
          if (msg === RPC_INVALID) fail('INVALID_REQUEST');
          return fail('SERVICE_UNAVAILABLE');
        }
      };
      const bucket = await sha256Hex(`my-reports|user|${uid}`);
      if (await call('internal_community_ingest_rate_limit', { p_bucket: bucket, p_limit: perMinute }) !== true) fail('RATE_LIMITED');

      // cursor: signature, then binding to this user/route/part/query/page size, then expiry
      const u = await userDigest(uid);
      const q = input.kind ? await queryDigest(input.kind, input.query!) : '';
      const cursorRoute: CursorRoute = route === 'search' ? (input.part === 'managers' ? 'search.managers' : 'search.reports')
        : route === 'summary' ? 'summary.recent' : 'numbers';
      const size = cursorRoute === 'search.managers'
        ? input.managersPageSize ?? LIMITS.managers_page_size_default
        : input.pageSize ?? (route === 'numbers' ? LIMITS.numbers_page_size_default : LIMITS.page_size_default);
      let cur: CursorPayload | null = null;
      if (input.cursor !== null) {
        cur = await verifyCursor(deps.cursorSecret, input.cursor);
        if (!cur || cur.r !== cursorRoute || cur.u !== u || cur.q !== q) fail('INVALID_CURSOR');
        const sent = cursorRoute === 'search.managers' ? input.managersPageSize : input.pageSize;
        if (sent !== undefined && sent !== cur!.n) fail('INVALID_CURSOR');
        if (cur!.ex * 1000 <= now()) fail('CURSOR_EXPIRED');
      }
      const pageN = cur ? cur.n : size;
      const offset = cur ? cur.o : 0;
      const expected = cur ? cur.dv : null;
      const queriedAt = new Date(now()).toISOString();
      const ex = Math.floor(now() / 1000) + LIMITS.cursor_ttl_seconds;
      const next = async (dv: string, o: number, n: number, total: number, r: CursorRoute, rs?: string, re?: string) =>
        o + n < total ? signCursor(deps.cursorSecret, { v: 1, r, u, q, dv, o: o + n, n, ...(rs ? { rs, re } : {}), ex }) : null;

      let out: Record<string, unknown>;
      let rows = 0;
      if (route === 'search') {
        const first = cur === null && input.part === 'reports';
        const managersN = input.managersPageSize ?? LIMITS.managers_page_size_default;
        const res = await call('internal_my_reports_search', {
          p_user: uid, p_session: session, p_kind: input.kind, p_query: input.query,
          p_with_summary: first,
          p_reports_offset: input.part === 'reports' ? offset : null, p_reports_limit: input.part === 'reports' ? pageN : null,
          p_managers_offset: input.part === 'managers' ? offset : first ? 0 : null,
          p_managers_limit: input.part === 'managers' ? pageN : first ? managersN : null,
          p_expected_version: expected,
        });
        const r = checked(res);
        const dv = r.data_version as string;
        let reports: ReportPage | null = null, managers: ManagerPage | null = null;
        if (input.part === 'reports') {
          const rp = r.reports as Record<string, unknown>;
          const list = items(rp?.items, toReportRow);
          const total = count(rp?.total);
          rows += list.length;
          reports = { items: list, total, page_size: pageN, offset, next_cursor: await next(dv, offset, pageN, total, 'search.reports') };
        }
        if (r.managers) {
          const mp = r.managers as Record<string, unknown>;
          const mOffset = input.part === 'managers' ? offset : 0;
          const mN = input.part === 'managers' ? pageN : managersN;
          const list = items(mp.items, toManager);
          const total = count(mp.total_managers);
          rows += list.length;
          managers = { items: list, total_managers: total, unassigned_count: count(mp.unassigned_count), page_size: mN,
            offset: mOffset, next_cursor: await next(dv, mOffset, mN, total, 'search.managers') };
        }
        out = { contract: CONTRACT, route: 'search', kind: input.kind, query_normalized: input.query, data_version: dv,
          queried_at: queriedAt, account: { contributor: r.contributor }, summary: first ? toSummary(r.summary) : null, reports, managers };
      } else if (route === 'summary') {
        const recentEnd = cur ? cur.re! : todaySeoul(now());
        const recentStart = cur ? cur.rs! : addDays(recentEnd, -(LIMITS.recent_days - 1));
        const first = cur === null;
        const r = checked(await call('internal_my_reports_summary', {
          p_user: uid, p_session: session, p_recent_start: recentStart, p_recent_end: recentEnd,
          p_with_summary: first, p_offset: offset, p_limit: pageN, p_expected_version: expected,
        }));
        const dv = r.data_version as string;
        const rp = r.recent as Record<string, unknown>;
        const list = items(rp?.items, toReportRow);
        const total = count(rp?.total);
        rows += list.length;
        out = { contract: CONTRACT, route: 'summary', data_version: dv, queried_at: queriedAt, timezone: TIMEZONE,
          recent_start: recentStart, recent_end: recentEnd, account: { contributor: r.contributor },
          summary: first ? toSummary(r.summary) : null, recent_summary: first ? toSummary(r.recent_summary) : null,
          recent: { items: list, total, page_size: pageN, offset,
            next_cursor: await next(dv, offset, pageN, total, 'summary.recent', recentStart, recentEnd) } };
      } else {
        const r = checked(await call('internal_my_reports_numbers', {
          p_user: uid, p_session: session, p_kind: input.kind, p_query: input.query,
          p_offset: offset, p_limit: pageN, p_max_total: LIMITS.numbers_total_max, p_expected_version: expected,
        }));
        const dv = r.data_version as string;
        const list = items(r.items, v => (typeof v === 'string' ? v : fail('SERVICE_UNAVAILABLE')));
        const unique = count(r.unique_numbers);
        rows += list.length;
        const nextCursor = await next(dv, offset, pageN, unique, 'numbers');
        out = { contract: CONTRACT, route: 'numbers', kind: input.kind, query_normalized: input.query, data_version: dv,
          queried_at: queriedAt, account: { contributor: r.contributor }, matched_reports: count(r.matched_reports),
          without_number: count(r.without_number), unique_numbers: unique, items: list, page_size: pageN, offset,
          next_cursor: nextCursor, complete: nextCursor === null };
      }
      const text = JSON.stringify(out);
      const bytes = new TextEncoder().encode(text).byteLength;
      if (bytes > LIMITS.response_bytes) fail('RESULT_TOO_LARGE');
      log('ok', { rows, bytes });
      return new Response(text, { status: 200, headers: base });
    } catch (e) {
      if (e instanceof Fail) return error(e.code);
      return error('SERVICE_UNAVAILABLE');
    }
  };
}

const CONTRIBUTOR: readonly ContributorState[] = ['active', 'none', 'revoked'];
const DB_ERRORS: ReadonlySet<string> = new Set(['ACCOUNT_INELIGIBLE', 'KAKAO_REQUIRED', 'SESSION_EXPIRED', 'DATASET_CHANGED', 'NUMBERS_LIMIT_EXCEEDED']);

/** The RPC result after its gate: a DB-reported error code becomes that error, never data. */
function checked(res: unknown): Record<string, unknown> {
  if (!isObj(res)) fail('SERVICE_UNAVAILABLE');
  const r = res as Record<string, unknown>;
  if (r.error !== undefined && r.error !== null) fail(DB_ERRORS.has(r.error as string) ? r.error as ErrorCode : 'SERVICE_UNAVAILABLE');
  if (typeof r.data_version !== 'string' || !/^[0-9a-f]{32}$/.test(r.data_version)) fail('SERVICE_UNAVAILABLE');
  oneOf(r.contributor, CONTRIBUTOR);
  return r;
}
