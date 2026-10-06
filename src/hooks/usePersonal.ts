/**
 * Shared personal-comparison state (Sol-owned contract for the UI).
 * The public dashboard never waits for, or fails because of, anything in this hook.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { Scope } from '../domain/public';
import type { PersonalCompare } from '../domain/personal';
import { createDemoAuth, createLiveAuth, type AuthSnapshot, type MapAuth } from '../auth/mapAuth';
import { loadCompare, PersonalApiError, sameScope, type PersonalErrorCode } from '../data/personal';

let singleton: MapAuth | null = null;

/** One auth adapter per page. Demo builds use the explicit synthetic login only. */
export function mapAuth(): MapAuth {
  singleton ??= import.meta.env.VITE_DATA_MODE === 'demo' ? createDemoAuth(window.location.search) : createLiveAuth();
  return singleton;
}

export function useMapAuth(): { auth: AuthSnapshot; signIn: () => void; signOut: () => void } {
  const adapter = mapAuth();
  const auth = useSyncExternalStore(adapter.subscribe, adapter.snapshot, adapter.snapshot);
  const signIn = useCallback(() => { void adapter.signIn(); }, [adapter]);
  const signOut = useCallback(() => { void adapter.signOut(); }, [adapter]);
  return { auth, signIn, signOut };
}

export type PersonalStatus =
  | 'off'            // compare toggle is off (or hidden by briefing mode)
  | 'unconfigured'   // this deployment has no map login
  | 'signed_out'     // needs login
  | 'waiting'        // public dashboard not ready yet (no dataset_version to compare against)
  | 'loading'
  | 'ready'
  | 'error';

export interface PersonalState {
  status: PersonalStatus;
  data: PersonalCompare | null;
  error: { code: PersonalErrorCode; message: string; retryAfter: number | null } | null;
  retry: () => void;
}

/**
 * @param enabled   compare toggle on and not hidden by briefing mode
 * @param version   dataset_version of the public dashboard currently on screen (null while loading)
 */
export function usePersonalCompare(scope: Scope, version: string | null, enabled: boolean): PersonalState {
  const { auth } = useMapAuth();
  const [data, setData] = useState<PersonalCompare | null>(null);
  const [error, setError] = useState<PersonalState['error']>(null);
  const [loading, setLoading] = useState(false);
  const [reload, setReload] = useState(0);
  const abort = useRef<AbortController | null>(null);
  const scopeKey = JSON.stringify(scope);

  // C01: another account (same nickname or not) never sees these numbers, even for a moment
  const viewer = auth.status === 'signed_in' ? auth.viewerId : null;
  const lastViewer = useRef(viewer);
  if (lastViewer.current !== viewer) {
    lastViewer.current = viewer;
    if (data !== null) setData(null);
    if (error !== null) setError(null);
  }
  useEffect(() => {
    abort.current?.abort();
    if (!enabled || auth.status !== 'signed_in' || !version) {
      setLoading(false);
      if (auth.status !== 'signed_in') {
        setData(null);
        setError(null);
      }
      return;
    }
    const ac = new AbortController();
    abort.current = ac;
    setLoading(true);
    setError(null);
    loadCompare(scope, version, mapAuth(), ac.signal)
      .then((value) => {
        if (ac.signal.aborted) return;
        setData(value);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (ac.signal.aborted || e instanceof Error && e.name === 'AbortError') return;
        // Never show numbers from another scope/version next to the current public view.
        setData(null);
        setError(e instanceof PersonalApiError
          ? { code: e.code, message: e.message, retryAfter: e.retryAfter }
          : { code: 'service_unavailable', message: '내 신고 비교를 불러오지 못했습니다. 공개 통계는 계속 볼 수 있습니다.', retryAfter: null });
        setLoading(false);
      });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey, version, enabled, auth.status, viewer, reload]);

  const retry = useCallback(() => setReload((n) => n + 1), []);

  return useMemo<PersonalState>(() => {
    if (!enabled) return { status: 'off', data: null, error: null, retry };
    if (auth.status === 'unconfigured') return { status: 'unconfigured', data: null, error: null, retry };
    if (auth.status === 'signed_out' || auth.status === 'error') return { status: 'signed_out', data: null, error: null, retry };
    if (auth.status === 'loading' || !version) return { status: 'waiting', data: null, error: null, retry };
    if (loading) return { status: 'loading', data, error: null, retry };
    if (error) return { status: 'error', data: null, error, retry };
    // A result for a different scope/version is never shown (acceptCompare already enforces this).
    if (data && (data.dataset_version !== version || !sameScope(data.scope, scope))) {
      return { status: 'loading', data: null, error: null, retry };
    }
    return { status: data ? 'ready' : 'loading', data, error: null, retry };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, auth.status, version, loading, error, data, scopeKey, retry]);
}
