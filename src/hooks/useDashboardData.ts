/**
 * Dashboard data for the page (R04). One RefreshController per page; the page passes the requested scope and
 * how it was requested. Returns the last successful snapshot (kept on screen while refreshing) plus request state.
 * The metadata/snapshot live in memory only and are dropped whenever the signed-in account changes.
 */
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { Scope } from '../domain/public';
import { loadDashboardWith, loadMeta } from '../data/client';
import { RefreshController, type RefreshState, type RequestSource } from '../data/refreshController';

export interface DashboardDataApi extends RefreshState {
  isInitialLoading: boolean;
  isRefreshing: boolean;
  retry: () => void;
}

/** @param sessionKey identity of the viewer session (+ demo fixture); null while auth is still settling */
export function useDashboardData(scope: Scope, source: RequestSource, sessionKey: string | null): DashboardDataApi {
  const controller = useMemo(() => new RefreshController({
    fetchMeta: (signal) => loadMeta(signal),
    fetchDashboard: (meta, s, signal) => loadDashboardWith(meta, s, signal),
    now: () => Date.now(),
    setTimer: (fn, ms) => window.setTimeout(fn, ms),
    clearTimer: (id) => window.clearTimeout(id as number),
  }), []);
  const sessionRef = useRef<string | null | undefined>(undefined);
  // unmount (and React StrictMode's simulated unmount): cancel and forget; the next mount starts over
  useEffect(() => () => { controller.reset(); sessionRef.current = undefined; }, [controller]);
  const subscribe = useCallback((fn: () => void) => controller.subscribe(fn), [controller]);
  const read = useCallback(() => controller.snapshot(), [controller]);
  const state = useSyncExternalStore(subscribe, read, read);

  // account/session boundary: forget every cached response (P04); null = auth still settling → no request
  const scopeKey = JSON.stringify(scope);
  useEffect(() => {
    if (sessionKey === null) return;
    if (sessionRef.current !== undefined && sessionRef.current !== sessionKey) controller.reset();
    const first = sessionRef.current !== sessionKey;
    sessionRef.current = sessionKey;
    controller.request(scope, first ? 'initial' : source);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller, scopeKey, sessionKey]);

  return {
    ...state,
    isInitialLoading: !state.displayed && !state.access && !state.error,
    isRefreshing: !!state.displayed && state.refreshing,
    retry: controller.retry.bind(controller),
  };
}
