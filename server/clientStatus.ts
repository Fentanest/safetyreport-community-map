// `GET /my-analytics/client-status` (2026-10-21): the map web's own read of the app-update guidance.
// The map never calls the account API (PROJECT_RULES 7); this route reads the shared ingest settings through
// `public.internal_map_client_state(p_user)` and returns exactly its seven fields after strict validation.
// 2026-10-22: `upload_pause` (2-9 maintenance banner) and `update_gate` (2-10 required version: the map web shows the
// update screen instead of the map while `blocked`). The decision is made in SQL (community_user_meets_requirement).
// Notice shape: contracts/community-ingest-v2/client-notice.schema.json. Links are https only (others become null).

export type ClientConsent = 'active' | 'outdated' | 'none' | 'revoked';
export interface ClientNotice {
  level: 'info' | 'warning' | 'required';
  message: string;
  min_version: { pc: string | null; mobile: string | null };
  url: { pc: string | null; mobile: string | null };
  deadline: string | null;
}
export interface UploadPause { paused: boolean; message: string | null; resume_at: string | null }
export interface UpdateGate {
  blocked: boolean;
  min_version: { pc: string | null; mobile: string | null };
  url: { pc: string | null; mobile: string | null };
  message: string | null;
}
export interface ClientStatus {
  consent: ClientConsent;
  last_contract: string | null;
  v1_connections: number;
  v2_enabled: boolean;
  notice: ClientNotice | null;
  upload_pause: UploadPause;
  update_gate: UpdateGate | null;
}

const CONSENT: ReadonlySet<string> = new Set(['active', 'outdated', 'none', 'revoked']);
const LEVEL: ReadonlySet<string> = new Set(['info', 'warning', 'required']);
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exactKeys = (v: Record<string, unknown>, keys: string[]) =>
  Object.keys(v).length === keys.length && keys.every((k) => k in v);

/** https URL (no credentials) or null; anything else is dropped, never passed to the page. */
export function httpsUrl(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 2048) return null;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && !u.username && !u.password ? u.toString() : null;
  } catch { return null; }
}

/** 글자 수는 DB char_length / JSON Schema maxLength 와 같게 코드포인트로 센다(UTF-16 단위 아님). */
const version = (v: unknown): string | null => (typeof v === 'string' && [...v].length >= 1 && [...v].length <= 40 ? v : null);

/** A notice that does not match the schema is dropped (null), so a bad setting never reaches the page. */
export function parseClientNotice(v: unknown): ClientNotice | null {
  if (!obj(v) || !exactKeys(v, ['level', 'message', 'min_version', 'url', 'deadline'])) return null;
  const { level, message, min_version: min, url, deadline } = v;
  if (typeof level !== 'string' || !LEVEL.has(level)) return null;
  if (typeof message !== 'string' || !message.trim() || [...message].length > 1000) return null;
  if (!obj(min) || !exactKeys(min, ['pc', 'mobile']) || !obj(url) || !exactKeys(url, ['pc', 'mobile'])) return null;
  if ((min.pc !== null && version(min.pc) === null) || (min.mobile !== null && version(min.mobile) === null)) return null;
  if (deadline !== null && (typeof deadline !== 'string' || !Number.isFinite(Date.parse(deadline)))) return null;
  return {
    level: level as ClientNotice['level'], message,
    min_version: { pc: version(min.pc), mobile: version(min.mobile) },
    url: { pc: httpsUrl(url.pc), mobile: httpsUrl(url.mobile) },
    deadline: deadline as string | null,
  };
}

const shortText = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.trim() && [...v].length <= max && !/[\u0000-\u001f\u007f]/.test(v) ? v : null;
const isoText = (v: unknown): string | null =>
  typeof v === 'string' && Number.isFinite(Date.parse(v)) ? new Date(Date.parse(v)).toISOString() : null;

/** Missing/odd pause data reads as "not paused" (a banner only; it never blocks the map). */
export function parseUploadPause(v: unknown): UploadPause {
  if (!obj(v) || v.paused !== true) return { paused: false, message: null, resume_at: null };
  return { paused: true, message: shortText(v.message, 300), resume_at: isoText(v.resume_at) };
}

/** null when there is no requirement in force; undefined when the value is unusable (the route answers 503). */
export function parseUpdateGate(v: unknown): UpdateGate | null | undefined {
  if (v === null || v === undefined) return null;
  if (!obj(v) || typeof v.blocked !== 'boolean') return undefined;
  const { min_version: min, url } = v;
  if (!obj(min) || !obj(url)) return undefined;
  if ((min.pc !== null && version(min.pc) === null) || (min.mobile !== null && version(min.mobile) === null)) return undefined;
  return { blocked: v.blocked, min_version: { pc: version(min.pc), mobile: version(min.mobile) },
    url: { pc: httpsUrl(url.pc), mobile: httpsUrl(url.mobile) }, message: shortText(v.message, 300) };
}

/** Strict decode of the RPC result; null when the database answer is unusable (the route then answers 503). */
export function parseClientStatus(v: unknown): ClientStatus | null {
  if (!obj(v)) return null;
  const { consent, last_contract: last, v1_connections: v1, v2_enabled: v2 } = v;
  if (typeof consent !== 'string' || !CONSENT.has(consent)) return null;
  if (last !== null && last !== undefined && (typeof last !== 'string' || last.length > 64)) return null;
  if (typeof v1 !== 'number' || !Number.isInteger(v1) || v1 < 0) return null;
  if (typeof v2 !== 'boolean') return null;
  const gate = parseUpdateGate(v.update_gate);
  if (gate === undefined) return null;
  return { consent: consent as ClientConsent, last_contract: (last as string | null | undefined) ?? null, v1_connections: v1,
    v2_enabled: v2, notice: v.notice === null || v.notice === undefined ? null : parseClientNotice(v.notice),
    upload_pause: parseUploadPause(v.upload_pause), update_gate: gate };
}
