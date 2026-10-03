import { useCallback, useEffect, useRef, useState } from 'react';
import { isAccessError, loadMeta, type PublicApiError } from '../data/client';
import type { PublicMeta } from '../domain/public';

/** Direct statistics entry needs the dataset gate/version/bounds, not a complete dashboard. Session memory only. */
export function useAnalyticsMeta(session: string | null, enabled: boolean, available: PublicMeta | null) {
  const [snapshot, setSnapshot] = useState<{ session: string; meta: PublicMeta } | null>(null);
  const [error, setError] = useState<{ session: string; value: PublicApiError } | null>(null);
  const latest = useRef(session);
  latest.current = session;
  const [revision, setRevision] = useState(0);
  const [force, setForce] = useState(false);
  const meta = force ? null : (snapshot?.session === session ? snapshot.meta : available);
  const retry = useCallback(() => {
    setError(null); setSnapshot(null); setForce(true); setRevision(value => value + 1);
  }, []);
  useEffect(() => {
    if (snapshot && snapshot.session !== session) setSnapshot(null);
    if (error && error.session !== session) setError(null);
    if (!enabled || session === null || meta) return;
    const ac = new AbortController();
    const requestedSession = session;
    loadMeta(ac.signal).then(value => {
      if (!ac.signal.aborted && latest.current === requestedSession) {
        setSnapshot({ session: requestedSession, meta: value }); setForce(false); setError(null);
      }
    }).catch(e => {
      if (!ac.signal.aborted && latest.current === requestedSession) setError({ session: requestedSession, value: e });
    });
    return () => ac.abort();
  }, [session, enabled, meta, revision]); // errors wait for an explicit retry; never a retry loop
  const failure = error?.session === session ? error.value : null;
  return { meta, error: failure, access: isAccessError(failure) ? failure : null, retry };
}
