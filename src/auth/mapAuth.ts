/**
 * Map web login (optional). This is NOT the device-connection relay (safeauth / community-auth-relay) and NOT
 * the account API (community-account): it only creates a Supabase Auth session for THIS browser on the map
 * origin so the viewer can read their own comparison. Public viewing never needs it.
 *
 * - Kakao OAuth through Supabase Auth, PKCE, session stored under a map-only storage key.
 * - Sign-out uses scope 'local': only this browser's map session ends. Global/others sign-out would revoke the
 *   app/server sessions that bind the automatic upload connection, so it is never called here.
 * - The SDK is loaded lazily: an anonymous visitor without a stored map session never downloads it.
 * - Nothing here derives ownership: the server takes the viewer id from the verified token only.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type AuthStatus = 'unconfigured' | 'loading' | 'signed_out' | 'signed_in' | 'error';

export interface AuthSnapshot {
  status: AuthStatus;
  /** Kakao nickname for the viewer's own menu only; never an email or id. */
  displayName: string | null;
  /** true only for the explicit demo fixture login */
  synthetic: boolean;
  message: string | null;
}

export interface MapAuth {
  snapshot(): AuthSnapshot;
  subscribe(listener: (s: AuthSnapshot) => void): () => void;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  /** Current access token or null. */
  accessToken(): Promise<string | null>;
  /** Refresh once after a 401; null when the map session is gone. */
  refreshToken(): Promise<string | null>;
}

export const MAP_AUTH_STORAGE_KEY = 'cm-map-auth-v1';
/** OAuth return parameters that must not stay in the address bar or a shared URL. */
const OAUTH_PARAMS = ['code', 'error', 'error_code', 'error_description', 'state'];

export function authConfig(): { url: string; key: string } | null {
  const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim().replace(/\/+$/, '') ?? '';
  const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)?.trim() ?? '';
  return url && key ? { url, key } : null;
}

/** Removes OAuth return parameters, keeping the public scope parameters. */
export function stripOAuthParams(search: string): string {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  for (const name of OAUTH_PARAMS) params.delete(name);
  const rest = params.toString();
  return rest ? `?${rest}` : '';
}

function nickname(meta: Record<string, unknown> | undefined): string | null {
  for (const name of ['nickname', 'preferred_username', 'name', 'full_name', 'user_name']) {
    const value = meta?.[name];
    if (typeof value === 'string' && value.trim() && !value.includes('@')) return value.trim().slice(0, 40);
  }
  return null;
}

class Emitter {
  private listeners = new Set<(s: AuthSnapshot) => void>();
  constructor(public state: AuthSnapshot) {}
  set(next: Partial<AuthSnapshot>) {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener(this.state);
  }
  subscribe(listener: (s: AuthSnapshot) => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
}

function hasStoredSession(): boolean {
  try {
    return window.localStorage.getItem(MAP_AUTH_STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

export function createLiveAuth(): MapAuth {
  const config = authConfig();
  const emitter = new Emitter({
    status: config ? 'signed_out' : 'unconfigured', displayName: null, synthetic: false,
    message: config ? null : '지금은 로그인 기능을 쓸 수 없습니다. 지도와 통계는 그대로 볼 수 있습니다.',
  });
  let clientPromise: Promise<SupabaseClient> | null = null;

  const client = (): Promise<SupabaseClient> => {
    if (!config) return Promise.reject(new Error('unconfigured'));
    clientPromise ??= import('@supabase/supabase-js').then(({ createClient }) => {
      const c = createClient(config.url, config.key, {
        auth: {
          flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true,
          storageKey: MAP_AUTH_STORAGE_KEY,
        },
      });
      c.auth.onAuthStateChange((_event, session) => {
        emitter.set(session
          ? { status: 'signed_in', displayName: nickname(session.user.user_metadata), message: null }
          : { status: 'signed_out', displayName: null });
      });
      return c;
    });
    return clientPromise;
  };

  const oauthReturn = /[?&](code|error)=/.test(window.location.search);
  if (config && (oauthReturn || hasStoredSession())) {
    emitter.set({ status: 'loading' });
    const failed = new URLSearchParams(window.location.search).get('error');
    client()
      .then(c => c.auth.getSession())
      .then(({ data }) => {
        emitter.set(data.session
          ? { status: 'signed_in', displayName: nickname(data.session.user.user_metadata), message: null }
          : failed
            ? { status: 'error', message: '카카오 로그인이 취소되었거나 끝나지 않았습니다. 지도는 그대로 볼 수 있습니다.' }
            : { status: 'signed_out' });
      })
      .catch(() => emitter.set({ status: 'error', message: '로그인 상태를 확인하지 못했습니다. 지도는 그대로 볼 수 있습니다.' }))
      .finally(() => {
        if (oauthReturn) {
          window.history.replaceState(window.history.state, '', `${window.location.pathname}${stripOAuthParams(window.location.search)}`);
        }
      });
  }

  return {
    snapshot: () => emitter.state,
    subscribe: listener => emitter.subscribe(listener),
    async signIn() {
      const c = await client();
      const redirectTo = `${window.location.origin}${window.location.pathname}${stripOAuthParams(window.location.search)}`;
      const { error } = await c.auth.signInWithOAuth({ provider: 'kakao', options: { redirectTo } });
      if (error) emitter.set({ status: 'error', message: '카카오 로그인을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.' });
    },
    async signOut() {
      if (!config || !clientPromise) {
        emitter.set({ status: config ? 'signed_out' : 'unconfigured', displayName: null });
        return;
      }
      const c = await client();
      // Only this browser's map session. Never 'global' or 'others' (would end the app's upload sessions).
      await c.auth.signOut({ scope: 'local' });
      emitter.set({ status: 'signed_out', displayName: null, message: null });
    },
    async accessToken() {
      if (!config || emitter.state.status !== 'signed_in') return null;
      const { data } = await (await client()).auth.getSession();
      return data.session?.access_token ?? null;
    },
    async refreshToken() {
      if (!config || !clientPromise) return null;
      const { data, error } = await (await client()).auth.refreshSession();
      if (error || !data.session) {
        emitter.set({ status: 'signed_out', displayName: null, message: '로그인이 만료되었습니다. 다시 로그인해 주세요. 앱의 자동 업로드는 그대로 계속됩니다.' });
        return null;
      }
      return data.session.access_token;
    },
  };
}

/** Explicit synthetic login for demo builds only (?me=… fixtures). Never used in live mode. */
export type DemoViewer = 'signed' | 'out' | 'unconfigured' | 'empty' | 'expired' | 'kakao' | 'suspended' | 'error' | 'rate' | 'stale';
const DEMO_VIEWERS: DemoViewer[] = ['signed', 'out', 'unconfigured', 'empty', 'expired', 'kakao', 'suspended', 'error', 'rate', 'stale'];
export const DEMO_AUTH_KEY = 'cm-demo-auth';

export function demoViewerFromSearch(search: string): DemoViewer | null {
  const value = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get('me');
  return value && (DEMO_VIEWERS as string[]).includes(value) ? value as DemoViewer : null;
}

export function createDemoAuth(search: string): MapAuth & { viewer(): DemoViewer } {
  let fixture = demoViewerFromSearch(search);
  let stored = false;
  try { stored = window.sessionStorage.getItem(DEMO_AUTH_KEY) === '1'; } catch { /* ignore */ }
  const signedStates: DemoViewer[] = ['signed', 'empty', 'expired', 'kakao', 'suspended', 'error', 'rate', 'stale'];
  const initial: AuthStatus = fixture === 'unconfigured' ? 'unconfigured'
    : fixture === 'out' ? 'signed_out'
      : fixture && signedStates.includes(fixture) ? 'signed_in' : stored ? 'signed_in' : 'signed_out';
  const emitter = new Emitter({
    status: initial, displayName: initial === 'signed_in' ? '예시 사용자' : null, synthetic: true,
    message: initial === 'unconfigured' ? '지금은 로그인 기능을 쓸 수 없습니다. 지도와 통계는 그대로 볼 수 있습니다.' : null,
  });
  return {
    viewer: () => fixture ?? 'signed',
    snapshot: () => emitter.state,
    subscribe: listener => emitter.subscribe(listener),
    async signIn() {
      if (emitter.state.status === 'unconfigured') return;
      try { window.sessionStorage.setItem(DEMO_AUTH_KEY, '1'); } catch { /* ignore */ }
      if (fixture === 'out') fixture = 'signed';
      emitter.set({ status: 'signed_in', displayName: '예시 사용자', message: null });
    },
    async signOut() {
      try { window.sessionStorage.removeItem(DEMO_AUTH_KEY); } catch { /* ignore */ }
      emitter.set({ status: 'signed_out', displayName: null, message: null });
    },
    async accessToken() { return emitter.state.status === 'signed_in' ? 'demo-synthetic-token' : null; },
    async refreshToken() {
      if (fixture === 'expired') {
        emitter.set({ status: 'signed_out', displayName: null, message: '로그인이 만료되었습니다. 다시 로그인해 주세요. 앱의 자동 업로드는 그대로 계속됩니다.' });
        return null;
      }
      return emitter.state.status === 'signed_in' ? 'demo-synthetic-token' : null;
    },
  };
}
