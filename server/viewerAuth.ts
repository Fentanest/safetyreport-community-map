// Map viewer identity, shared by the contributor-only public API and the personal comparison API.
// The viewer id comes ONLY from the verified Supabase user (getUser) and must match the token claims;
// nothing here trusts a client-supplied id. Anonymous Supabase users are never Kakao viewers.

export interface ViewerUser { id: string; isAnonymous: boolean }
export interface ViewerAuthDeps {
  jwtIssuer: string | null;
  getUser(accessToken: string): Promise<ViewerUser | null>;
}
export interface Viewer { uid: string; session: string }

export type ViewerAuthCode = 'auth_required' | 'session_expired' | 'kakao_required' | 'service_unavailable';
export class ViewerAuthError extends Error {
  constructor(readonly code: ViewerAuthCode) { super(code); }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BEARER = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;

/**
 * Map viewer threshold (user decision 2026-09-28): the community map opens only to participants who
 * share 10 or more publicly-listed reports. A code constant on purpose — never overridden by an
 * environment variable, so a misconfigured deployment cannot silently lower the bar.
 */
export const MAP_VIEWER_MIN_REPORTS = 10;

export interface MapViewerEligibility {
  /** verified contributor with enough publicly-listed reports */
  ok: boolean;
  /** the viewer's public_fact_count when the database reported a usable number, else null (unknown) */
  current: number | null;
  required: number;
}

/**
 * Map-only gate over the internal_analytics_viewer result. Fail closed: a response from an older
 * database without the public_fact_count key (or a non-numeric/negative value) never opens the map.
 * Personal comparison (my-analytics) does not use this — its has_public_facts semantics are unchanged.
 */
export function mapViewerEligibility(viewer: { public_fact_count?: unknown }): MapViewerEligibility {
  const raw = viewer.public_fact_count;
  const current = typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : null;
  return { ok: current !== null && current >= MAP_VIEWER_MIN_REPORTS, current, required: MAP_VIEWER_MIN_REPORTS };
}

function decodeClaims(token: string): Record<string, unknown> | null {
  try {
    const part = token.split('.')[1];
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - part.length % 4) % 4);
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), c => c.charCodeAt(0))));
  } catch { return null; }
}

/** Verified viewer of this request, or a ViewerAuthError with the reason. */
export async function authenticate(request: Request, deps: ViewerAuthDeps): Promise<Viewer> {
  const m = BEARER.exec(request.headers.get('authorization') || '');
  if (!m) throw new ViewerAuthError('auth_required');
  const token = m[1];
  let user: ViewerUser | null;
  try { user = await deps.getUser(token); } catch { throw new ViewerAuthError('service_unavailable'); }
  if (!user) throw new ViewerAuthError('session_expired');
  const claims = decodeClaims(token);
  if (!claims || claims.sub !== user.id || claims.role !== 'authenticated' || claims.aud !== 'authenticated') {
    throw new ViewerAuthError('auth_required');
  }
  if (deps.jwtIssuer && claims.iss !== deps.jwtIssuer) throw new ViewerAuthError('auth_required');
  if (claims.is_anonymous === true || user.isAnonymous) throw new ViewerAuthError('kakao_required');
  if (typeof claims.session_id !== 'string' || !UUID.test(claims.session_id)) throw new ViewerAuthError('auth_required');
  return { uid: user.id, session: claims.session_id };
}
