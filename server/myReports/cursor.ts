// Signed opaque cursors for my-reports-v1 (contracts/my-reports/README.md §6).
// token = base64url(JSON payload) "." base64url(HMAC-SHA256(secret, payload part)). The payload carries no raw query,
// plate, address or user id: the user and the query are bound through truncated SHA-256 digests only.

export type CursorRoute = 'search.reports' | 'search.managers' | 'summary.recent' | 'numbers';

export interface CursorPayload {
  v: 1;
  r: CursorRoute;
  /** sha256(uid) prefix */
  u: string;
  /** sha256(kind|normalized query) prefix, '' for summary */
  q: string;
  /** data_version the first page was built from */
  dv: string;
  /** offset of the next page */
  o: number;
  /** page size */
  n: number;
  /** summary only: recent window */
  rs?: string;
  re?: string;
  /** expiry, unix seconds */
  ex: number;
}

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  try {
    const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - text.length % 4) % 4);
    return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  } catch { return null; }
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export const userDigest = async (uid: string) => (await sha256Hex(`my-reports|uid|${uid}`)).slice(0, 32);
export const queryDigest = async (kind: string, normalized: string) =>
  (await sha256Hex(`my-reports|query|${kind}|${normalized}`)).slice(0, 32);

async function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function signCursor(secret: string, payload: CursorPayload): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await key(secret), enc.encode(body)));
  return `${body}.${b64url(sig)}`;
}

const ROUTES: ReadonlySet<string> = new Set(['search.reports', 'search.managers', 'summary.recent', 'numbers']);
const HEX32 = /^[0-9a-f]{32}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The verified payload, or null for anything forged, truncated or malformed (expiry is checked by the caller). */
export async function verifyCursor(secret: string, token: string): Promise<CursorPayload | null> {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const body = parts[0], sig = unb64url(parts[1]);
  if (!sig || sig.length !== 32) return null;
  // crypto.subtle.verify compares in constant time
  if (!await crypto.subtle.verify('HMAC', await key(secret), sig, enc.encode(body))) return null;
  const raw = unb64url(body);
  if (!raw) return null;
  let p: unknown;
  try { p = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); } catch { return null; }
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
  const c = p as Record<string, unknown>;
  const int = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
  if (c.v !== 1 || typeof c.r !== 'string' || !ROUTES.has(c.r) || typeof c.u !== 'string' || !HEX32.test(c.u)
    || typeof c.q !== 'string' || !(c.q === '' || HEX32.test(c.q)) || typeof c.dv !== 'string' || !HEX32.test(c.dv)
    || !int(c.o, 1, 1_000_000) || !int(c.n, 1, 500) || !int(c.ex, 0, 2 ** 40)) return null;
  if (c.r === 'summary.recent' ? !(typeof c.rs === 'string' && DAY.test(c.rs) && typeof c.re === 'string' && DAY.test(c.re))
    : (c.rs !== undefined || c.re !== undefined)) return null;
  return c as unknown as CursorPayload;
}
