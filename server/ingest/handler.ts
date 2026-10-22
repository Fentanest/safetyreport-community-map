// Runtime-agnostic handler for the user-only `community-ingest` function (contracts/community-ingest).
// Order (prompt §13.2): method/size/type → user JWT (getUser + claims) → per-user/connection rate limit →
// strict schema → server hash → value rules / status re-map / event-type rules → derived columns →
// one RPC transaction that re-checks identity, session, grant, connection and writes facts → per-event ACK.
// No admin-key fallback, no IP-header trust, no logging of bodies, tokens, ids or payloads.
// v2 gzip (contracts/community-ingest-v2/README.md): method/size(512KiB wire)/type → JWT → shared capabilities (paused?
// v2 on?) → user rate limit → bounded inflate (1MiB) → JSON. Nothing is inflated before auth and the v2 check.
// 2026-10-22: the shared capabilities are read right after the JWT on every route (ingest v1/v2, manifest, progress) so a
// paused upload switch answers 503 maintenance before any database write; the required version (426) is checked right
// after the envelope is validated, before the connection rate limit and the ingest RPC. /progress (2-1) stores a status
// report only.

import {
  FINE_ESTIMATE_RULES, canonicalJson, deriveFact, type EventType, mapStatus, nonFinalRejection, type Observation, sha256Hex, sourceReportKey,
  validateEventType, validateObservationValues,
} from './observation.ts';

import { RawFailure, hasLoneSurrogate, hasNul, rawEventFingerprint, validateRaw } from './raw.ts';
import { PROGRESS_MAX_BYTES, parseProgress } from './progress.ts';
import { compareVersions } from './version.ts';

export type Rpc = (name: string, args: Record<string, unknown>) => Promise<unknown>;
export interface IngestUser { id: string; isAnonymous: boolean }
export interface IngestDeps {
  rpc: Rpc;
  getUser(accessToken: string): Promise<IngestUser | null>;
  jwtIssuer: string | null;
  enabled: boolean;
  allowedOrigins: string[];
  v2Enabled?: boolean;
  v1Sunset?: string | null;
  clientNotice?: Record<string, unknown> | null;
  /** 공유 수신 설정(private.community_ingest_config). v2 요청과 v1 차단일 확인에만 호출한다. 실패하면 v1 은 차단일 없이
   *  진행하고(경고 로그), v2 는 503 service_unavailable(재시도 가능)이다. */
  capabilities?(): Promise<Capabilities>;
  /** 2-9/2-10 거절 수 기록(운영 콘솔 "최근 1시간 503·426"). 핸들러는 기다리지 않는다(응답이 먼저, R3-M3). 실패는 무시한다. */
  noteRejection?(code: 'maintenance' | 'client_upgrade_required', app: 'pc' | 'mobile' | 'unknown', route: Route): Promise<void>;
  log?(entry: Record<string, string | number>): void;
}

type Route = 'ingest' | 'manifest' | 'progress';
type Requirement = { min_version: { pc: string | null; mobile: string | null }; url: { pc: string | null; mobile: string | null };
  message: string | null; enforce_from: string | null };
type Capabilities = { contracts: number[]; v1_sunset?: string | null; client_notice?: Record<string, unknown> | null;
  /** 2-9: 이미 "재개 시각 전" 판정이 끝난 값(private.community_uploads_paused). */
  paused?: boolean; pause_message?: string | null; resume_at?: string | null;
  /** 2-10: 지금 적용 중인 필수 버전(적용 시작 전이면 null). */
  client_requirement?: Requirement | null };

/** 503 maintenance 의 Retry-After 상한(D7). 구버전 앱(PC 3.6.0~3.6.1, 모바일 2.5.0)은 이 값을 Supabase 전역 쿨다운으로 써서
 *  status 까지 막으므로, 재개 시각이 더 멀어도 30분을 넘기지 않는다. 새 앱은 본문 `resume_at` 으로 다음 시도를 정한다. */
export const MAINTENANCE_RETRY_AFTER_MAX = 1800;
/** 503 maintenance 의 Retry-After: 재개 시각까지 남은 초(최소 1, 최대 1800), 재개 시각이 없으면 600. */
export function maintenanceRetryAfter(resumeAt: string | null | undefined, now = Date.now()): number {
  const t = typeof resumeAt === 'string' ? Date.parse(resumeAt) : NaN;
  if (!Number.isFinite(t)) return 600;
  return Math.min(MAINTENANCE_RETRY_AFTER_MAX, Math.max(1, Math.ceil((t - now) / 1000)));
}

/** 2-10: envelope 버전이 요구보다 낮으면 그 플랫폼의 요구 버전. 요구 없음·버전 해석 실패는 null(막지 않는다). */
export function requiredVersionFor(req: Requirement | null | undefined, sourceApp: unknown, clientVersion: unknown): string | null {
  if (!req || typeof req !== 'object' || !req.min_version) return null;
  const app = sourceApp === 'safetyreport' ? 'pc' : sourceApp === 'safetyreport-mobile' ? 'mobile' : null;
  const min = app ? req.min_version[app] : null;
  if (typeof min !== 'string') return null;
  return compareVersions(clientVersion, min) === -1 ? min : null;
}

/** identity 본문 상한(v1 과 gzip 없는 v2 공통). v1 은 이 값을 넘으면 인증·JSON 해석 전에 413 이다(v1 의미 유지). */
const MAX_BODY = 256 * 1024;
/** `Content-Encoding: gzip` 은 v2 전용이다(v1 은 gzip 을 쓴 적이 없다). 전송 바이트 상한과 압축 해제 후 상한. */
const MAX_GZIP_WIRE = 512 * 1024;
const MAX_INFLATED = 1024 * 1024;
/** 압축 해제기에 한 번에 넣는 입력 조각. deflate 최대 비율(~1032:1)이라 조각 하나의 출력은 약 1MiB 를 넘지 않는다. */
const INFLATE_SLICE = 1024;

/** gzip 본문을 상한 안에서만 푼다(gzip bomb 방어). 입력을 INFLATE_SLICE 조각으로 넣고 출력 조각마다 누적 크기를 검사해
 *  max 를 넘는 즉시 해제를 중단한다. 넘으면 null, gzip 형식이 깨졌으면 throw. 전체 입력을 한 번에 넣지 않으므로
 *  상한 초과 요청이 만드는 메모리는 대략 max + 조각 하나의 출력으로 묶인다. */
export async function gunzipLimited(input: Uint8Array, max: number, slice = INFLATE_SLICE): Promise<Uint8Array | null> {
  const stream = new DecompressionStream('gzip');
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let over = false;
  const drain = (async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      total += value.byteLength;
      if (total > max) {
        over = true;
        try { await reader.cancel(); } catch { /* 이미 닫힘 */ }
        return;
      }
      chunks.push(value);
    }
  })();
  let writeError: unknown = null;
  try {
    for (let i = 0; i < input.byteLength && !over; i += slice) await writer.write(input.slice(i, i + slice) as Uint8Array<ArrayBuffer>);
    if (!over) await writer.close();
  } catch (e) { writeError = e; }
  try { await drain; } catch (e) { if (!over) throw e; }
  if (over) {
    try { await writer.abort(); } catch { /* 이미 오류·취소됨 */ }
    chunks.length = 0;
    return null;
  }
  if (writeError) throw writeError;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.byteLength; }
  return out;
}

function parseJson(bytes: Uint8Array): unknown {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { return fail('invalid_request'); }
}

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
// Both YYMM and YYMMDD middle groups occur in the upstream clients' fixtures.
const REPORT_NUMBER = /^SPP-[0-9]{4,6}-[0-9]{6,8}$/;
const POLICY = /^[0-9]{4}-[0-9]{2}-[0-9]{2}\.[0-9]{1,3}$/;
const TRIGGERS = new Set(['realtime', 'manual', 'midnight', 'recovery', 'rebuild', 'reshare']);
const EVENT_TYPES = new Set(['completed_observation', 'status_correction', 'location_supplement', 'reshare']);
/** v2 event.schema.json 의 enum 과 같다. v2 의 status_correction 은 다른 스키마 위반과 같이 schema_invalid 다. */
const EVENT_TYPES_V2 = new Set(['completed_observation', 'location_supplement', 'reshare']);

type Code = 'official_account_mismatch' | 'method_not_allowed' | 'unsupported_media_type' | 'payload_too_large' | 'invalid_request' | 'schema_invalid' |
  'raw_hash_mismatch' | 'raw_invalid' | 'raw_reporter_keys_present' | 'supplement_invalid' |
  'supplement_hash_mismatch' | 'client_observation_hash_mismatch' | 'client_upgrade_required' |
  'payload_hash_mismatch' | 'event_type_mismatch' | 'auth_required' | 'kakao_required' | 'session_revoked' |
  'consent_missing' | 'consent_revoked' | 'consent_outdated' | 'consent_grant_unknown' | 'connection_unknown' |
  'connection_revoked' | 'connection_suspended' | 'connection_session_mismatch' | 'connection_mode_mismatch' |
  'writer_superseded' | 'contributor_suspended' | 'rate_limited' | 'busy' | 'server_error' | 'service_unavailable' | 'maintenance';
const HTTP: Record<Code, number> = {
  raw_hash_mismatch: 422, raw_invalid: 422, raw_reporter_keys_present: 422, supplement_invalid: 422,
  supplement_hash_mismatch: 422, client_observation_hash_mismatch: 422, client_upgrade_required: 426,
  official_account_mismatch: 409,
  method_not_allowed: 405, unsupported_media_type: 415, payload_too_large: 413, invalid_request: 400, schema_invalid: 422,
  payload_hash_mismatch: 422, event_type_mismatch: 422, auth_required: 401, kakao_required: 403, session_revoked: 403,
  consent_missing: 403, consent_revoked: 403, consent_outdated: 403, consent_grant_unknown: 403, connection_unknown: 403,
  connection_revoked: 403, connection_suspended: 403, connection_session_mismatch: 403, connection_mode_mismatch: 403,
  writer_superseded: 403, contributor_suspended: 403, rate_limited: 429, busy: 503, server_error: 500, service_unavailable: 503,
  maintenance: 503,
};
const RETRYABLE = new Set<Code>(['rate_limited', 'busy', 'server_error', 'service_unavailable', 'maintenance']);
/** cloud-retry-brief.md ④: a retryable failure always carries a Retry-After, even when no RPC error gave one
 *  explicitly — a caller (PC/모바일/지도 웹) must never guess how long to back off. */
const DEFAULT_RETRY_AFTER: Partial<Record<Code, number>> = { busy: 30, service_unavailable: 30, server_error: 10, maintenance: 600 };

class Failure extends Error {
  constructor(readonly code: Code, readonly retryAfter?: number, readonly detail?: string, readonly extra: Record<string, unknown> = {}) { super(code); }
}
const fail = (code: Code, retryAfter?: number, detail?: string, extra?: Record<string, unknown>): never => {
  throw new Failure(code, retryAfter, detail, extra);
};

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

const OBSERVATION_V1_KEYS = ['address', 'agency_name', 'amount', 'category', 'completed_date', 'disposition', 'location',
  'manager_name', 'report_date', 'status', 'status_raw', 'vehicle_raw'] as const;
/** observation-v2 (2026-09-28) adds `violation_law`; v1 (12 keys, old apps) is still accepted. */
const OBSERVATION_V2_KEYS = [...OBSERVATION_V1_KEYS, 'violation_law'] as const;
/** observation-v3 (2026-09-28) adds `source_agency_code` (원문 기관코드, null 가능); v1/v2 still accepted. */
const OBSERVATION_V3_KEYS = [...OBSERVATION_V2_KEYS, 'source_agency_code'] as const;
const OBSERVATION_V4_KEYS = [...OBSERVATION_V3_KEYS, 'rating'] as const;

export function isObservation(p: unknown): p is Observation {
  if (!isObj(p)) return false;
  const hasEstimate = Object.hasOwn(p, 'fine_estimate');
  if (![OBSERVATION_V1_KEYS, OBSERVATION_V2_KEYS, OBSERVATION_V3_KEYS, OBSERVATION_V4_KEYS]
    .some(keys => exactKeys(p, hasEstimate ? [...keys, 'fine_estimate'] : keys))) return false;
  if (hasEstimate) {
    const e = p.fine_estimate;
    if (!isObj(e) || !exactKeys(e, ['won', 'rule', 'rule_version']) || !Number.isSafeInteger(e.won) ||
      (e.won as number) < 1 || (e.won as number) > 100000000 ||
      !FINE_ESTIMATE_RULES.includes(e.rule as typeof FINE_ESTIMATE_RULES[number]) ||
      typeof e.rule_version !== 'string' || e.rule_version.length < 1 || [...e.rule_version].length > 40) return false;
  }
  if (Object.hasOwn(p, 'rating') && !(p.rating === null || (Number.isInteger(p.rating) && (p.rating as number) >= 1 && (p.rating as number) <= 5))) return false;
  // v2: null or 1..60 code points (empty string and non-strings are schema_invalid like any other field)
  if (Object.hasOwn(p, 'violation_law') && !nstr(p.violation_law, 60)) return false;
  // v3: null or a non-empty string, kept verbatim (only 7 alphanumerics feed the resolver; the rest stays unresolved).
  // Over-length (>32 code points) is a named value error (source_agency_code_too_long), not a silent null —
  // the length gate lives in validateObservationValues so the reason is explicit.
  if (Object.hasOwn(p, 'source_agency_code') &&
      !(p.source_agency_code === null || (typeof p.source_agency_code === 'string' && p.source_agency_code.length >= 1))) return false;
  const a = p.amount, l = p.location;
  return nstr(p.address, 200) && nstr(p.agency_name, 200) && nstr(p.manager_name, 160) && nstr(p.vehicle_raw, 64) &&
    nstr(p.status_raw, 40) &&
    isObj(a) && exactKeys(a, ['confirmed_won', 'kind', 'penalty_points']) && nint(a.confirmed_won, 100000000) &&
    ['fine', 'penalty', 'combined', 'unknown'].includes(a.kind as string) && nint(a.penalty_points, 1000) &&
    // 5분류(observation-v5, 2026-10-11): traffic·parking·safety·living·other. 코드표: contracts/report-categories.json.
    ['traffic', 'parking', 'safety', 'living', 'other'].includes(p.category as string) &&
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
      ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Expose-Headers': 'Retry-After' } : {};
    let protocol = 1;
    let route: Route = 'ingest';
    try {
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'POST',
          'Access-Control-Allow-Headers': 'authorization, apikey, content-type, content-encoding', 'Cache-Control': 'no-store' } });
      }
      if (request.method !== 'POST') fail('method_not_allowed');
      if (!deps.enabled) fail('service_unavailable');
      const path = new URL(request.url).pathname.replace(/\/+$/, '');
      route = path.endsWith('/manifest') ? 'manifest' : path.endsWith('/progress') ? 'progress'
        : (path.endsWith('/community-ingest') ? 'ingest' : fail('invalid_request'));
      if (!(request.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) fail('unsupported_media_type');
      // 프로토콜 판정 규칙(contracts/community-ingest-v2/README.md): `Content-Encoding: gzip` 이면 v2 요청이다.
      // identity 본문은 v1·v2 모두 256KiB 상한이고 넘으면 인증·JSON 해석 전에 413(v1 의미 그대로).
      const encoding = (request.headers.get('content-encoding') || 'identity').trim().toLowerCase();
      const gzip = encoding === 'gzip';
      // progress(2-1)는 identity 4KiB 까지만 받는다.
      const wireCap = route === 'progress' ? PROGRESS_MAX_BYTES : gzip ? MAX_GZIP_WIRE : MAX_BODY;
      const declared = request.headers.get('content-length');
      if (declared !== null && declared.trim() !== '' && !(Number(declared) <= wireCap)) fail('payload_too_large');
      const m = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(request.headers.get('authorization') || '');
      if (!m) fail('auth_required');
      const token = m![1];
      if (encoding !== 'identity' && !gzip) fail('unsupported_media_type');
      // v2 가 설정으로 꺼진 배포(공유 설정 없음)와 manifest(v1 전용)에서 gzip 은 다른 미지원 인코딩과 같은 415 이며 본문을 읽지 않는다.
      if (gzip && (route !== 'ingest' || (!deps.capabilities && deps.v2Enabled !== true))) fail('unsupported_media_type');
      const wire = await readBodyLimited(request, wireCap); // 선언이 없거나 거짓이어도 읽는 도중 상한에서 멈춘다(SOL-10)
      if (!wire) fail('payload_too_large');
      // identity 는 v1 순서대로 인증 전에 JSON 을 해석한다. gzip 은 인증·v2 확인 전에는 절대 풀지 않는다.
      let body: unknown = gzip ? undefined : parseJson(wire!);

      let user: IngestUser | null;
      try { user = await deps.getUser(token); } catch { return fail('service_unavailable'); }
      if (!user) fail('auth_required');
      const claims = decodeClaims(token);
      if (!claims || claims.sub !== user!.id || claims.role !== 'authenticated' || claims.aud !== 'authenticated') fail('auth_required');
      if (deps.jwtIssuer && claims!.iss !== deps.jwtIssuer) fail('auth_required');
      if (claims!.is_anonymous === true || user!.isAnonymous) fail('kakao_required');
      const session = typeof claims!.session_id === 'string' && UUID.test(claims!.session_id) ? claims!.session_id : fail('auth_required');
      const uid = user!.id;
      if (!gzip) {
        if (!isObj(body) || ![1, 2].includes(body.protocol as number)) fail('invalid_request');
        protocol = Number((body as Record<string, unknown>).protocol);
      } else {
        protocol = 2;
      }

      // 2-9 업로드 일시 중지: 모든 경로(v1·v2·manifest·progress)에서 DB 쓰기(rate limit 포함) 전에 공유 설정을 읽는다.
      // gzip 은 이 판정 뒤에만 푼다. 설정 RPC 가 실패하면 중지가 아닌 것으로 본다(v2 는 아래에서 503 service_unavailable).
      // 즉 점검 스위치는 설정을 읽을 수 있을 때만 동작한다(설계 결정, CLIENT-RULES 5절·docs/deployment.md).
      let capabilities: Capabilities | null = null;
      if (deps.capabilities) {
        try {
          const c = await deps.capabilities();
          if (!c || !Array.isArray(c.contracts)) throw new Error('capabilities_invalid');
          capabilities = c;
        } catch {
          if (protocol === 2 && route === 'ingest') fail('service_unavailable');
          // v1·manifest·progress 는 차단일·중지 없이 진행한다. 로그에는 결과 코드만 남긴다(오류 본문·키·토큰 없음).
          deps.log?.({ event: 'community_ingest', route, outcome: 'capabilities_unavailable_v1_continue', request_id: rid });
        }
      }
      const bodyApp = isObj(body) ? appOf(body.source_app) : 'unknown';
      if (capabilities?.paused === true) {
        const resumeAt = typeof capabilities.resume_at === 'string' && Number.isFinite(Date.parse(capabilities.resume_at))
          ? new Date(Date.parse(capabilities.resume_at)).toISOString() : null;
        noteRejection(deps, 'maintenance', bodyApp, route);
        fail('maintenance', maintenanceRetryAfter(resumeAt), undefined, { resume_at: resumeAt,
          pause_message: typeof capabilities.pause_message === 'string' ? capabilities.pause_message : null });
      }

      const userBucket = await sha256Hex(`ingest|user|${uid}`);
      if (await deps.rpc('internal_community_ingest_rate_limit', { p_bucket: userBucket, p_limit: 60 }) !== true) fail('rate_limited', 60);

      if (route === 'manifest') {
        const b = body as Record<string, unknown>;
        if (protocol !== 1 || !exactKeys(b, ['protocol', 'connection_id', 'after', 'limit']) || typeof b.connection_id !== 'string' ||
            !UUID.test(b.connection_id) || !(b.after === null || (typeof b.after === 'string' && HEX64.test(b.after))) ||
            !Number.isSafeInteger(b.limit) || (b.limit as number) < 1 || (b.limit as number) > 5000) fail('invalid_request');
        const r = await deps.rpc('internal_community_manifest', { p_user: uid, p_session: session, p_connection: b.connection_id,
          p_after: b.after, p_limit: b.limit }) as Record<string, unknown>;
        if (r && 'error' in r) fail(mapRpcError(String(r.error)));
        deps.log?.({ event: 'community_ingest', route, outcome: 'ok', request_id: rid });
        return json(200, { protocol: 1, ...r }, cors);
      }

      if (route === 'progress') {
        // 2-1 진행 보고: 저장만 한다(원장·사실·대기열 변경 없음). outdated 동의도 받고, 필수 버전 426 은 적용하지 않는다.
        const parsed = parseProgress(body);
        if (!parsed) fail('schema_invalid');
        const r = await deps.rpc('internal_community_progress', { p_user: uid, p_session: session, p_connection: parsed!.connectionId,
          p_report: parsed!.report }) as Record<string, unknown>;
        if (r && r.error === 'rate_limited') fail('rate_limited', Math.max(1, Math.min(60, Number(r.retry_after) || 60)));
        if (r && 'error' in r) fail(mapRpcError(String(r.error)));
        deps.log?.({ event: 'community_ingest', route, outcome: 'ok', request_id: rid });
        return json(200, { protocol: 1, stored: true, request_id: rid }, cors);
      }

      const v2On = capabilities ? capabilities.contracts.includes(2) : (!deps.capabilities && deps.v2Enabled === true);
      // 공유 설정이 v2 를 끈 경우(운영 되돌림 등)는 gzip 이어도 503 재시도: 클라이언트는 다음 status 확인에서 v1 로 돌아간다.
      if (protocol === 2 && !v2On) fail('service_unavailable');
      const sunset = capabilities?.v1_sunset ?? deps.v1Sunset;
      if (protocol === 1 && sunset && Date.now() >= Date.parse(sunset)) fail('client_upgrade_required');
      if (gzip) {
        let inflated: Uint8Array | null;
        try { inflated = await gunzipLimited(wire!, MAX_INFLATED); } catch { return fail('invalid_request'); }
        if (!inflated) fail('payload_too_large');
        body = parseJson(inflated!);
        if (!isObj(body) || ![1, 2].includes(body.protocol as number)) fail('invalid_request');
        if ((body as Record<string, unknown>).protocol !== 2) fail('unsupported_media_type'); // v1 본문은 gzip 을 쓰지 않는다
      }
      const b = body as Record<string, unknown>;

      const envKeys = ['protocol', 'contract', 'source_app', 'source_mode', 'connection_id', 'consent_grant_id', 'policy_version',
        'client_version', 'parser_version', 'trigger', 'events'];
      if (!exactKeys(b, envKeys) || b.contract !== `community-ingest-v${protocol}` ||
          !['safetyreport/server', 'safetyreport-mobile/standalone'].includes(`${b.source_app}/${b.source_mode}`) ||
          typeof b.connection_id !== 'string' || !UUID.test(b.connection_id) ||
          typeof b.consent_grant_id !== 'string' || !UUID.test(b.consent_grant_id) ||
          typeof b.policy_version !== 'string' || !POLICY.test(b.policy_version) ||
          !nstr(b.client_version, 40) || b.client_version === null || !nstr(b.parser_version, 40) || b.parser_version === null ||
          typeof b.trigger !== 'string' || !(TRIGGERS.has(b.trigger) || (protocol === 2 && b.trigger === 'raw_backfill')) || !Array.isArray(b.events) ||
          b.events.length < 1 || b.events.length > 20 ||
          (protocol === 2 && (hasLoneSurrogate(b.client_version) || hasLoneSurrogate(b.parser_version)))) fail('schema_invalid');
      // 2-10 필수 버전: envelope 버전이 지금 적용 중인 요구보다 낮으면 426(구버전 포함). 해석 못 하는 버전은 막지 않는다.
      const required = requiredVersionFor(capabilities?.client_requirement, b.source_app, b.client_version);
      if (required) {
        const app = appOf(b.source_app);
        const req = capabilities!.client_requirement!;
        noteRejection(deps, 'client_upgrade_required', app, route);
        fail('client_upgrade_required', undefined, undefined, { required_version: required,
          update_url: app === 'unknown' ? null : (req.url?.[app] ?? null), update_message: req.message ?? null });
      }
      const connBucket = await sha256Hex(`ingest|conn|${b.connection_id}`);
      if (await deps.rpc('internal_community_ingest_rate_limit', { p_bucket: connBucket, p_limit: 60 }) !== true) fail('rate_limited', 60);

      const seen = new Set<string>();
      const seenReports = new Set<string>();  // one event per report per request (S-11-B): ACKs then equal the commit
      const events: Record<string, unknown>[] = [];
      for (const item of b.events as unknown[]) {
        if (!isObj(item)) fail('schema_invalid');
        const raw = item as Record<string, unknown>;
        const evKeys = ['event_id', 'event_type', 'source_system', 'source_report_id', 'source_revision', 'writer_epoch',
          'captured_at', ...(protocol === 1 ? ['payload', 'payload_sha256'] : ['raw', 'supplement', 'supplement_sha256'])];
        if (protocol === 2 && Object.hasOwn(raw, 'client_observation')) evKeys.push('client_observation', 'client_observation_sha256');
        if (!(exactKeys(raw, evKeys) || exactKeys(raw, [...evKeys, 'report_number'])) ||
            typeof raw.event_id !== 'string' || !UUID4.test(raw.event_id) ||
            seen.has(raw.event_id) || !(protocol === 2 ? EVENT_TYPES_V2 : EVENT_TYPES).has(raw.event_type as string) ||
            raw.source_system !== 'safetyreport' ||
            typeof raw.source_report_id !== 'string' || !REPORT_ID.test(raw.source_report_id) ||
            !(raw.report_number === undefined || raw.report_number === null ||
              (typeof raw.report_number === 'string' && REPORT_NUMBER.test(raw.report_number))) ||
            !Number.isSafeInteger(raw.source_revision) || (raw.source_revision as number) < 1 ||
            !Number.isSafeInteger(raw.writer_epoch) || (raw.writer_epoch as number) < 1 ||
            typeof raw.captured_at !== 'string' || !INSTANT.test(raw.captured_at) || Number.isNaN(Date.parse(raw.captured_at)) ||
            (protocol === 1 && (typeof raw.payload_sha256 !== 'string' || !HEX64.test(raw.payload_sha256) || !isObservation(raw.payload)))) {
          fail('schema_invalid');
        }
        if (seenReports.has(raw.source_report_id as string)) fail('schema_invalid', undefined, 'duplicate_report_in_request');
        seen.add(raw.event_id as string);
        seenReports.add(raw.source_report_id as string);
        if (protocol === 2) {
          if ((raw.event_type === 'reshare') !== (b.trigger === 'reshare')) fail('event_type_mismatch');
          if (Object.hasOwn(raw, 'client_observation')) {
            // 구조·짝 없는 surrogate·NUL 은 jsonb 가 거절하거나 계약 위반이므로 여기서 422 로 끊는다.
            if (!isObservation(raw.client_observation) || hasLoneSurrogate(raw.client_observation) || hasNul(raw.client_observation)) fail('schema_invalid');
          }
          // 해시 쌍·원문 무결성은 항상 검증한다(불일치는 거절).
          await validateRaw(raw);
          let ev = raw;
          if (Object.hasOwn(raw, 'client_observation') && validateObservationValues(raw.client_observation as Observation)) {
            // 선택적 비교용 관찰값의 "값" 이 잘못됐다고 원문 보존까지 막지 않는다: 관찰값(과 해시 쌍)만 버리고 저장한다.
            // 서버 파서가 원문으로 직접 파싱하므로 비교 진단만 빠진다. 값·사유는 기록하지 않는다.
            const { client_observation: _o, client_observation_sha256: _h, ...rest } = raw;
            ev = rest;
            deps.log?.({ event: 'community_ingest', route, outcome: 'client_observation_dropped', request_id: rid });
          }
          events.push({ ...ev, source_report_key: await sourceReportKey(raw.source_report_id as string),
            payload_sha256: await rawEventFingerprint(ev) });
          continue;
        }
        const payload = raw.payload as Observation;
        const hash = await sha256Hex(canonicalJson(payload));
        if (hash !== raw.payload_sha256) fail('payload_hash_mismatch');
        const valueError = validateObservationValues(payload);
        if (valueError) fail(valueError.code, undefined, valueError.reason);
        // Non-final payloads and legacy status_correction events are recognised (no 422) and rejected
        // per event by the SQL ingest function, so the rest of the batch still processes (Sol 2026-09-28:
        // a legacy/non-final event must not fail the whole batch — skip the type check for it).
        const rejectionCode = nonFinalRejection(raw.event_type as EventType, payload);
        if (!rejectionCode) {
          const typeError = validateEventType(raw.event_type as EventType, b.trigger as string, payload);
          if (typeError) fail(typeError.code, undefined, typeError.reason);
        }
        events.push({ event_id: raw.event_id, event_type: raw.event_type, source_report_id: raw.source_report_id,
          report_number: raw.report_number ?? null,
          source_report_key: await sourceReportKey(raw.source_report_id as string), source_revision: raw.source_revision,
          writer_epoch: raw.writer_epoch, captured_at: raw.captured_at, payload, payload_sha256: hash,
          quarantine_reason: mapStatus(payload.status_raw) === payload.status ? null : 'status_mapping_mismatch',
          rejection_code: rejectionCode,
          derived: await deriveFact(payload) });
      }
      const result = await deps.rpc(protocol === 2 ? 'internal_community_ingest_v2' : 'internal_community_ingest', { p_user: uid, p_session: session, p_request_id: rid,
        p_envelope: { connection_id: b.connection_id, consent_grant_id: b.consent_grant_id, source_app: b.source_app,
          source_mode: b.source_mode, trigger: b.trigger, contract: b.contract, client_version: b.client_version, parser_version: b.parser_version }, p_events: events }) as Record<string, unknown>;
      if (result && 'error' in result) fail(mapRpcError(String(result.error)));
      deps.log?.({ event: 'community_ingest', route, outcome: 'ok', events: events.length, request_id: rid });
      return json(200, { protocol, ...(protocol === 2 ? { client_notice: capabilities?.client_notice ?? deps.clientNotice ?? null } : {}), request_id: rid, dataset_version: result.dataset_version ?? null,
        results: result.results }, cors);
    } catch (error) {
      const f = error instanceof Failure ? error : error instanceof RawFailure ? new Failure(error.code)
        : new Failure(/40P01|40001|deadlock|could not serialize/i.test(String(error)) ? 'busy' : 'server_error');
      deps.log?.({ event: 'community_ingest', route, outcome: f.code, request_id: rid });
      const retryAfter = f.retryAfter ?? DEFAULT_RETRY_AFTER[f.code];
      const headers: Record<string, string> = { ...cors, ...(retryAfter ? { 'Retry-After': String(retryAfter) } : {}) };
      return json(HTTP[f.code], { error: { code: f.code, message: MESSAGE[f.code] ?? 'Request failed.', request_id: rid,
        retryable: RETRYABLE.has(f.code), ...(retryAfter ? { retry_after_seconds: retryAfter } : {}), ...f.extra } }, headers);
    }
  };
}

function appOf(sourceApp: unknown): 'pc' | 'mobile' | 'unknown' {
  return sourceApp === 'safetyreport' ? 'pc' : sourceApp === 'safetyreport-mobile' ? 'mobile' : 'unknown';
}

/** 거절 카운터는 기다리지 않는다(R3-M3): 응답이 먼저 나가고, 점검 중 몰리는 요청이 같은 카운터 행 잠금에 줄 서지 않는다.
 *  동기 throw·비동기 reject 모두 삼킨다(진단용 숫자일 뿐). */
function noteRejection(deps: IngestDeps, code: 'maintenance' | 'client_upgrade_required', app: 'pc' | 'mobile' | 'unknown', route: Route): void {
  try { void Promise.resolve(deps.noteRejection?.(code, app, route)).catch(() => { /* 응답에 영향 없음 */ }); } catch { /* 응답에 영향 없음 */ }
}

function mapRpcError(code: string): Code {
  const known: Code[] = ['service_unavailable', 'client_upgrade_required', 'official_account_mismatch', 'kakao_required', 'session_revoked', 'consent_missing', 'consent_revoked', 'consent_outdated',
    'consent_grant_unknown', 'connection_unknown', 'connection_revoked', 'connection_suspended', 'connection_session_mismatch',
    'connection_mode_mismatch', 'writer_superseded', 'contributor_suspended', 'invalid_request'];
  return (known as string[]).includes(code) ? code as Code : 'server_error';
}

const MESSAGE: Partial<Record<Code, string>> = {
  official_account_mismatch: 'The upload connection does not match your bound official account.',
  auth_required: 'A valid community sign-in is required.', kakao_required: 'A Kakao-linked community account is required.',
  consent_revoked: 'Share consent was revoked.', consent_outdated: 'The share-consent policy changed; consent again.',
  writer_superseded: 'Another device took over uploading.', rate_limited: 'Too many requests.',
  payload_hash_mismatch: 'Payload hash does not match the canonical serialization.', schema_invalid: 'Request does not match the contract.',
  busy: 'Service is busy, retry shortly.',
  maintenance: 'Uploads are paused for server maintenance. They resume automatically.',
  client_upgrade_required: 'This app version can no longer upload. Please update the app.',
};
