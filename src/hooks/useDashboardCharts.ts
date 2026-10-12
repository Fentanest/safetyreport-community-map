import { useEffect, useState } from 'react';
import type { DashboardData } from '../domain/public';
import { readScreenPanel, screenCoordinator } from '../data/client';

/** A chart request replaces the complete screen via the coordinator, keeping scope/account/version fences. */
export function useDashboardCharts(data: DashboardData | null, open: boolean, session: string | null, active: boolean) {
  const key = data && session ? JSON.stringify([session, data.scope, data.meta.dataset_version]) : null;
  const [result, setResult] = useState<{ key: string; error: string | null } | null>(null);
  const [revision, setRevision] = useState(0);
  const available = data?.analytics != null;
  useEffect(() => {
    if (!open || !active || !data || !key || available) return;
    const ac = new AbortController();
    readScreenPanel(data.scope, { id: 'charts', path: 'dashboard-analytics', params: {} }, ac.signal)
      .then(() => { if (!ac.signal.aborted) setResult({ key, error: null }); })
      .catch(e => { if (!ac.signal.aborted) setResult({ key, error: e instanceof Error ? e.message : '그래프를 불러오지 못했습니다.' }); });
    return () => { ac.abort(); };
    // A replacement screen may change object identity; only its scope/version/session changes this intent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, open, active, available, revision]);
  useEffect(() => {
    if (!open) { screenCoordinator.drop('charts'); setResult(null); }
  }, [open]);
  return {
    loading: open && !available && result?.key !== key,
    error: !available && result?.key === key ? result.error : null,
    retry: () => { screenCoordinator.invalidate('charts'); setResult(null); setRevision(n => n + 1); },
  };
}
