import { useEffect, useMemo, useState } from 'react';
import type { AuthSnapshot } from '../auth/mapAuth';
import { loadClientStatus, type ClientStatus } from '../data/personal';
import type { ClientUpdateValue } from '../components/ClientUpdateNotice';

/** Focus/visibility refreshes at most once a minute; a "다시 확인" click at most every few seconds. */
export const FOCUS_REFRESH_MS = 60_000;
export const CLICK_REFRESH_MS = 3_000;
const TIMEOUT_MS = 10_000;

export interface ClientStatusRefresher {
  /** new viewer (or null when signed out): clears the answer and loads again for a signed-in viewer */
  setViewer(viewer: string | null): void;
  /** explicit refresh ("다시 확인"), lightly throttled */
  refresh(): void;
  /** window focus / tab visible again, throttled to FOCUS_REFRESH_MS */
  focus(): void;
  dispose(): void;
}

/**
 * Pure refresh policy (unit-tested in tests/product/clientUpdate.test.tsx). A failed load keeps the last answer;
 * a viewer change clears it at once and drops any in-flight answer of the previous viewer.
 */
export function createClientStatusRefresher(deps: {
  load(signal: AbortSignal): Promise<ClientStatus>;
  publish(status: ClientStatus | null): void;
  now?(): number;
  timeoutMs?: number;
}): ClientStatusRefresher {
  const now = deps.now ?? Date.now;
  let viewer: string | null = null;
  let controller: AbortController | null = null;
  let lastStart = -Infinity;
  const run = () => {
    const owner = viewer;
    if (owner === null) return;
    controller?.abort();
    const c = new AbortController();
    controller = c;
    lastStart = now();
    const timer = setTimeout(() => c.abort(), deps.timeoutMs ?? TIMEOUT_MS);
    deps.load(c.signal)
      .then((s) => { if (!c.signal.aborted && viewer === owner) deps.publish(s); })
      .catch(() => { /* guidance never changes map access; keep the last known answer */ })
      .finally(() => clearTimeout(timer));
  };
  return {
    setViewer(next) {
      if (next === viewer) return;
      viewer = next;
      controller?.abort();
      controller = null;
      lastStart = -Infinity;
      deps.publish(null);
      run();
    },
    refresh() { if (now() - lastStart >= CLICK_REFRESH_MS) run(); },
    focus() { if (now() - lastStart >= FOCUS_REFRESH_MS) run(); },
    dispose() { viewer = null; controller?.abort(); controller = null; },
  };
}

/**
 * Server-driven app-update guidance for the signed-in viewer (GET /my-analytics/client-status).
 * Loads on sign-in / account change, on the gate's "다시 확인" and on window focus (throttled).
 */
export function useClientUpdate(auth: AuthSnapshot): ClientUpdateValue {
  const [status, setStatus] = useState<ClientStatus | null>(null);
  const viewer = auth.status === 'signed_in' ? `${auth.viewerId ?? ''}|${auth.sessionId ?? ''}` : null;
  const refresher = useMemo(() => createClientStatusRefresher({ load: loadClientStatus, publish: setStatus }), []);

  useEffect(() => { refresher.setViewer(viewer); }, [refresher, viewer]);
  useEffect(() => {
    const onFocus = () => { if (document.visibilityState !== 'hidden') refresher.focus(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
      refresher.dispose();
    };
  }, [refresher]);

  return useMemo(() => ({ status, refresh: () => refresher.refresh() }), [status, refresher]);
}
