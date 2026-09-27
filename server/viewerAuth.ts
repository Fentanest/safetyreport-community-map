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
