// Runtime-agnostic handler for the user-only `community-ingest` function (contracts/community-ingest).
// Order (prompt §13.2): method/size/type → user JWT (getUser + claims) → per-user/connection rate limit →
// strict schema → server hash → value rules / status re-map / event-type rules → derived columns →
// one RPC transaction that re-checks identity, session, grant, connection and writes facts → per-event ACK.
// No admin-key fallback, no IP-header trust, no logging of bodies, tokens, ids or payloads.

import {
  canonicalJson, deriveFact, type EventType, mapStatus, type Observation, sha256Hex, sourceReportKey,
  validateEventType, validateObservationValues,
} from './observation.ts';

export type Rpc = (name: string, args: Record<string, unknown>) => Promise<unknown>;
export interface IngestUser { id: string; isAnonymous: boolean }
export interface IngestDeps {
  rpc: Rpc;
  getUser(accessToken: string): Promise<IngestUser | null>;
  jwtIssuer: string | null;
  enabled: boolean;
  allowedOrigins: string[];
  log?(entry: Record<string, string | number>): void;
}

const MAX_BODY = 256 * 1024;

/** 요청 본문을 최대 max 바이트까지만 읽는다(감사 SOL-10, auth `server/adapters.ts readBodyLimited` 와 같은 규칙).
 *  선언된 Content-Length 가 max 를 넘거나 숫자가 아니면 읽지 않고, 읽는 도중 max 를 넘는 순간 스트림을 취소한다. 넘으면 null. */
export async function readBodyLimited(request: Request, max: number): Promise<Uint8Array | null> {
  const declared = request.headers.get('content-length');
  if (declared !== null && declared.trim() !== '' && !(Number(declared) <= max)) return null;
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      try { await reader.cancel(); } catch { /* 이미 닫힘 */ }
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.byteLength; }
  return out;
}
const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;
const COORD = /^-?\d{1,3}\.\d{1,17}$/;
const REPORT_ID = /^[0-9A-Za-z_-]{1,40}$/;
const POLICY = /^[0-9]{4}-[0-9]{2}-[0-9]{2}\.[0-9]{1,3}$/;
const TRIGGERS = new Set(['realtime', 'manual', 'midnight', 'recovery', 'rebuild', 'reshare']);
const EVENT_TYPES = new Set(['completed_observation', 'status_correction', 'location_supplement', 'reshare']);

type Code = 'method_not_allowed' | 'unsupported_media_type' | 'payload_too_large' | 'invalid_request' | 'schema_invalid' |
  'payload_hash_mismatch' | 'event_type_mismatch' | 'auth_required' | 'kakao_required' | 'session_revoked' |
  'consent_missing' | 'consent_revoked' | 'consent_outdated' | 'consent_grant_unknown' | 'connection_unknown' |
  'connection_revoked' | 'connection_suspended' | 'connection_session_mismatch' | 'connection_mode_mismatch' |
  'writer_superseded' | 'contributor_suspended' | 'rate_limited' | 'busy' | 'server_error' | 'service_unavailable';
const HTTP: Record<Code, number> = {
  method_not_allowed: 405, unsupported_media_type: 415, payload_too_large: 413, invalid_request: 400, schema_invalid: 422,
  payload_hash_mismatch: 422, event_type_mismatch: 422, auth_required: 401, kakao_required: 403, session_revoked: 403,
  consent_missing: 403, consent_revoked: 403, consent_outdated: 403, consent_grant_unknown: 403, connection_unknown: 403,
  connection_revoked: 403, connection_suspended: 403, connection_session_mismatch: 403, connection_mode_mismatch: 403,
  writer_superseded: 403, contributor_suspended: 403, rate_limited: 429, busy: 503, server_error: 500, service_unavailable: 503,
};
const RETRYABLE = new Set<Code>(['rate_limited', 'busy', 'server_error', 'service_unavailable']);

class Failure extends Error {
  constructor(readonly code: Code, readonly retryAfter?: number, readonly detail?: string) { super(code); }
}
const fail = (code: Code, retryAfter?: number, detail?: string): never => { throw new Failure(code, retryAfter, detail); };

function requestId(): string {
  const b = new Uint8Array(12); crypto.getRandomValues(b);
  return 'ing_' + [...b].map(x => x.toString(16).padStart(2, '0')).join('');
}

function isObj(v: unknown): v is Record<string, unknown> { return !!v && typeof v === 'object' && !Array.isArray(v); }
function exactKeys(o: Record<string, unknown>, keys: readonly string[]): boolean {
  const k = Object.keys(o); return k.length === keys.length && keys.every(x => Object.hasOwn(o, x));
}
const nstr = (v: unknown, max: number) => v === null || (typeof v === 'string' && v.length >= 1 && [...v].length <= max);
const nint = (v: unknown, max: number) => v === null || (Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= max);

export function isObservation(p: unknown): p is Observation {
  if (!isObj(p) || !exactKeys(p, ['address', 'agency_name', 'amount', 'category', 'completed_date', 'disposition', 'location',
    'manager_name', 'report_date', 'status', 'status_raw', 'vehicle_raw'])) return false;
  const a = p.amount, l = p.location;
  return nstr(p.address, 200) && nstr(p.agency_name, 200) && nstr(p.manager_name, 160) && nstr(p.vehicle_raw, 64) &&
    nstr(p.status_raw, 40) &&
    isObj(a) && exactKeys(a, ['confirmed_won', 'kind', 'penalty_points']) && nint(a.confirmed_won, 100000000) &&
    ['fine', 'penalty', 'combined', 'unknown'].includes(a.kind as string) && nint(a.penalty_points, 1000) &&
    ['traffic', 'parking', 'other'].includes(p.category as string) &&
    (p.completed_date === null || (typeof p.completed_date === 'string' && DAY.test(p.completed_date))) &&
    (p.report_date === null || (typeof p.report_date === 'string' && DAY.test(p.report_date))) &&
    ['fine', 'warning', 'penalty', 'none', 'unknown'].includes(p.disposition as string) &&
    ['accepted', 'partial', 'rejected', 'completed_unknown', 'withdrawn', 'transferred', 'processing', 'supplement', 'other']
      .includes(p.status as string) &&
    isObj(l) && exactKeys(l, ['lat', 'lng', 'source']) &&
    (l.lat === null || (typeof l.lat === 'string' && COORD.test(l.lat))) &&
    (l.lng === null || (typeof l.lng === 'string' && COORD.test(l.lng))) && ['geocode', 'none'].includes(l.source as string);
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers } });
}

function decodeClaims(token: string): Record<string, unknown> | null {
  try {
    const part = token.split('.')[1];
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - part.length % 4) % 4);
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), c => c.charCodeAt(0))));
  } catch { return null; }
}

export function createIngestHandler(deps: IngestDeps): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const rid = requestId();
    const origin = request.headers.get('origin');
    const cors: Record<string, string> = origin && deps.allowedOrigins.includes(origin)
      ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};
    let route = 'ingest';
    try {
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'POST',
          'Access-Control-Allow-Headers': 'authorization, apikey, content-type', 'Cache-Control': 'no-store' } });
      }
      if (request.method !== 'POST') fail('method_not_allowed');
      if (!deps.enabled) fail('service_unavailable');
      const path = new URL(request.url).pathname.replace(/\/+$/, '');
      route = path.endsWith('/manifest') ? 'manifest' : (path.endsWith('/community-ingest') ? 'ingest' : fail('invalid_request'));
      if (!(request.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) fail('unsupported_media_type');
      const declared = request.headers.get('content-length');
      if (declared !== null && declared.trim() !== '' && !(Number(declared) <= MAX_BODY)) fail('payload_too_large');
      const m = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(request.headers.get('authorization') || '');
      if (!m) fail('auth_required');
      const token = m![1];
      const buf = await readBodyLimited(request, MAX_BODY); // 선언이 없거나 거짓이어도 읽는 도중 상한에서 멈춘다(SOL-10)
      if (!buf) fail('payload_too_large');
      let body: unknown;
      try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buf!)); } catch { return fail('invalid_request'); }

      let user: IngestUser | null;
      try { user = await deps.getUser(token); } catch { return fail('service_unavailable'); }
      if (!user) fail('auth_required');
      const claims = decodeClaims(token);
      if (!claims || claims.sub !== user!.id || claims.role !== 'authenticated' || claims.aud !== 'authenticated') fail('auth_required');
      if (deps.jwtIssuer && claims!.iss !== deps.jwtIssuer) fail('auth_required');
      if (claims!.is_anonymous === true || user!.isAnonymous) fail('kakao_required');
      const session = typeof claims!.session_id === 'string' && UUID.test(claims!.session_id) ? claims!.session_id : fail('auth_required');
      const uid = user!.id;
      if (!isObj(body) || body.protocol !== 1) fail('invalid_request');
      const b = body as Record<string, unknown>;

      const userBucket = await sha256Hex(`ingest|user|${uid}`);
      if (await deps.rpc('internal_community_ingest_rate_limit', { p_bucket: userBucket, p_limit: 60 }) !== true) fail('rate_limited', 60);

      if (route === 'manifest') {
        if (!exactKeys(b, ['protocol', 'connection_id', 'after', 'limit']) || typeof b.connection_id !== 'string' ||
            !UUID.test(b.connection_id) || !(b.after === null || (typeof b.after === 'string' && HEX64.test(b.after))) ||
            !Number.isSafeInteger(b.limit) || (b.limit as number) < 1 || (b.limit as number) > 5000) fail('invalid_request');
        const r = await deps.rpc('internal_community_manifest', { p_user: uid, p_session: session, p_connection: b.connection_id,
          p_after: b.after, p_limit: b.limit }) as Record<string, unknown>;
        if (r && 'error' in r) fail(mapRpcError(String(r.error)));
        deps.log?.({ event: 'community_ingest', route, outcome: 'ok', request_id: rid });
        return json(200, { protocol: 1, ...r }, cors);
      }

      const envKeys = ['protocol', 'contract', 'source_app', 'source_mode', 'connection_id', 'consent_grant_id', 'policy_version',
        'client_version', 'parser_version', 'trigger', 'events'];
      if (!exactKeys(b, envKeys) || b.contract !== 'community-ingest-v1' ||
          !['safetyreport/server', 'safetyreport-mobile/standalone'].includes(`${b.source_app}/${b.source_mode}`) ||
          typeof b.connection_id !== 'string' || !UUID.test(b.connection_id) ||
          typeof b.consent_grant_id !== 'string' || !UUID.test(b.consent_grant_id) ||
          typeof b.policy_version !== 'string' || !POLICY.test(b.policy_version) ||
          !nstr(b.client_version, 40) || b.client_version === null || !nstr(b.parser_version, 40) || b.parser_version === null ||
          typeof b.trigger !== 'string' || !TRIGGERS.has(b.trigger) || !Array.isArray(b.events) ||
          b.events.length < 1 || b.events.length > 20) fail('schema_invalid');
      const connBucket = await sha256Hex(`ingest|conn|${b.connection_id}`);
      if (await deps.rpc('internal_community_ingest_rate_limit', { p_bucket: connBucket, p_limit: 60 }) !== true) fail('rate_limited', 60);

      const seen = new Set<string>();
      const seenReports = new Set<string>();  // one event per report per request (S-11-B): ACKs then equal the commit
      const events: Record<string, unknown>[] = [];
      for (const item of b.events as unknown[]) {
        if (!isObj(item)) fail('schema_invalid');
        const raw = item as Record<string, unknown>;
        const evKeys = ['event_id', 'event_type', 'source_system', 'source_report_id', 'source_revision', 'writer_epoch',
          'captured_at', 'payload', 'payload_sha256'];
        if (!exactKeys(raw, evKeys) || typeof raw.event_id !== 'string' || !UUID4.test(raw.event_id) ||
            seen.has(raw.event_id) || !EVENT_TYPES.has(raw.event_type as string) || raw.source_system !== 'safetyreport' ||
            typeof raw.source_report_id !== 'string' || !REPORT_ID.test(raw.source_report_id) ||
            !Number.isSafeInteger(raw.source_revision) || (raw.source_revision as number) < 1 ||
            !Number.isSafeInteger(raw.writer_epoch) || (raw.writer_epoch as number) < 1 ||
            typeof raw.captured_at !== 'string' || !INSTANT.test(raw.captured_at) || Number.isNaN(Date.parse(raw.captured_at)) ||
            typeof raw.payload_sha256 !== 'string' || !HEX64.test(raw.payload_sha256) || !isObservation(raw.payload)) {
          fail('schema_invalid');
        }
        if (seenReports.has(raw.source_report_id as string)) fail('schema_invalid', undefined, 'duplicate_report_in_request');
        seen.add(raw.event_id as string);
        seenReports.add(raw.source_report_id as string);
        const payload = raw.payload as Observation;
        const hash = await sha256Hex(canonicalJson(payload));
        if (hash !== raw.payload_sha256) fail('payload_hash_mismatch');
        const valueError = validateObservationValues(payload);
        if (valueError) fail(valueError.code, undefined, valueError.reason);
        const typeError = validateEventType(raw.event_type as EventType, b.trigger as string, payload);
        if (typeError) fail(typeError.code, undefined, typeError.reason);
        events.push({ event_id: raw.event_id, event_type: raw.event_type, source_report_id: raw.source_report_id,
          source_report_key: await sourceReportKey(raw.source_report_id as string), source_revision: raw.source_revision,
          writer_epoch: raw.writer_epoch, captured_at: raw.captured_at, payload, payload_sha256: hash,
          quarantine_reason: mapStatus(payload.status_raw) === payload.status ? null : 'status_mapping_mismatch',
          derived: await deriveFact(payload) });
      }
      const result = await deps.rpc('internal_community_ingest', { p_user: uid, p_session: session, p_request_id: rid,
        p_envelope: { connection_id: b.connection_id, consent_grant_id: b.consent_grant_id, source_app: b.source_app,
          source_mode: b.source_mode, trigger: b.trigger }, p_events: events }) as Record<string, unknown>;
      if (result && 'error' in result) fail(mapRpcError(String(result.error)));
      deps.log?.({ event: 'community_ingest', route, outcome: 'ok', events: events.length, request_id: rid });
      return json(200, { protocol: 1, request_id: rid, dataset_version: result.dataset_version ?? null,
        results: result.results }, cors);
    } catch (error) {
      const f = error instanceof Failure ? error
        : new Failure(/40P01|40001|deadlock|could not serialize/i.test(String(error)) ? 'busy' : 'server_error');
      deps.log?.({ event: 'community_ingest', route, outcome: f.code, request_id: rid });
      const headers: Record<string, string> = { ...cors, ...(f.retryAfter ? { 'Retry-After': String(f.retryAfter) } : {}) };
      return json(HTTP[f.code], { error: { code: f.code, message: MESSAGE[f.code] ?? 'Request failed.', request_id: rid,
        retryable: RETRYABLE.has(f.code), ...(f.retryAfter ? { retry_after_seconds: f.retryAfter } : {}) } }, headers);
    }
  };
}

function mapRpcError(code: string): Code {
  const known: Code[] = ['kakao_required', 'session_revoked', 'consent_missing', 'consent_revoked', 'consent_outdated',
    'consent_grant_unknown', 'connection_unknown', 'connection_revoked', 'connection_suspended', 'connection_session_mismatch',
    'connection_mode_mismatch', 'writer_superseded', 'contributor_suspended', 'invalid_request'];
  return (known as string[]).includes(code) ? code as Code : 'server_error';
}

const MESSAGE: Partial<Record<Code, string>> = {
  auth_required: 'A valid community sign-in is required.', kakao_required: 'A Kakao-linked community account is required.',
  consent_revoked: 'Share consent was revoked.', consent_outdated: 'The share-consent policy changed; consent again.',
  writer_superseded: 'Another device took over uploading.', rate_limited: 'Too many requests.',
  payload_hash_mismatch: 'Payload hash does not match the canonical serialization.', schema_invalid: 'Request does not match the contract.',
  busy: 'Service is busy, retry shortly.',
};
