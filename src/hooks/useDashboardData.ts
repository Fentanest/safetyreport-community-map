/**
 * Dashboard data for the page (R04). One RefreshController per page; the page passes the requested scope and
 * how it was requested. Returns the last successful snapshot (kept on screen while refreshing) plus request state.
 * The metadata/snapshot live in memory only and are dropped whenever the signed-in account changes.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { Scope } from '../domain/public';
import { loadDashboardWith, loadMeta } from '../data/client';
import { RefreshController, type RefreshState, type RequestSource } from '../data/refreshController';

export interface DashboardDataApi extends RefreshState {
  isInitialLoading: boolean;
  isRefreshing: boolean;
  retry: () => void;
}

/** @param sessionKey identity of the viewer session (+ demo fixture); null while auth is still settling */
export function useDashboardData(scope: Scope, source: RequestSource, sessionKey: string | null, enabled = true): DashboardDataApi {
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
  const wasEnabled = useRef(false);
  useLayoutEffect(() => {
    if (sessionRef.current !== undefined && sessionRef.current !== sessionKey) controller.reset();
    const first = sessionRef.current !== sessionKey;
    sessionRef.current = sessionKey;
    if (sessionKey === null || !enabled) {
      controller.suspend();
      wasEnabled.current = false;
      return;
    }
    if (!wasEnabled.current) controller.resume(scope);
    else controller.request(scope, first ? 'initial' : source);
    wasEnabled.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller, scopeKey, sessionKey, enabled]);

  // A render can precede the layout effect on account change: never expose the prior account's DTO then.
  const current = sessionKey !== null && sessionRef.current === sessionKey;
  return {
    ...state,
    displayed: current ? state.displayed : null,
    meta: current ? state.meta : null,
    access: current ? state.access : null,
    error: current ? state.error : null,
    isInitialLoading: !current || (!state.displayed && !state.access && !state.error),
    isRefreshing: current && !!state.displayed && state.refreshing,
    retry: controller.retry.bind(controller),
  };
}
