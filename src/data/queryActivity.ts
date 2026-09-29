/**
 * S10 query activity — a page-scoped, display-only aggregator of what the page is waiting for.
 *
 * It never starts, retries, polls or delays a request. Every owner of a real request (the dashboard
 * RefreshController, the place detail, the personal comparison, the entity list, 맞춤 통계, the candidate search…)
 * reports its CURRENT state declaratively under a stable id; the report is replaced on every change and removed when
 * the owner stops waiting or unmounts. Because the report is derived from the owner's generation-guarded state (not
 * from a shared boolean set in a `finally`), a late or aborted request can never clear the newer request's status.
 */
import { createContext, useContext, useEffect, useRef, useSyncExternalStore } from 'react';

export type ActivityPhase = 'scheduled' | 'fetching' | 'processing' | 'retry_wait' | 'error';
export type ActivityResource =
  | 'dashboard' | 'scope-detail' | 'place-detail' | 'entities' | 'personal' | 'statistics' | 'candidates'
  | 'chart-series' | 'map-places' | 'map-boundaries' | 'session'
  /** F06: making an Excel file in the browser (no database request) */
  | 'export';

export interface QueryActivity {
  resource: ActivityResource;
  phase: ActivityPhase;
  /** user-facing Korean text, e.g. '통계를 불러오는 중' (never a token, key or raw value) */
  label: string;
  /** what is still on screen while waiting (provenance), e.g. '2026.01.01 — 2026.09.29 · 전국' */
  displayedLabel?: string | null;
  /** epoch ms of an automatic retry (429 Retry-After) — the display counts down locally, no polling */
  retryAt?: number | null;
  /** global = shown in the top status; local = only in its own panel */
  scope?: 'global' | 'local';
}

type Listener = () => void;

export class ActivityRegistry {
  private items = new Map<string, QueryActivity>();
  private list: ReadonlyArray<[string, QueryActivity]> = [];
  private listeners = new Set<Listener>();

  subscribe = (fn: Listener) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  snapshot = () => this.list;

  /** replace (or remove with null) the report of one owner; identical reports do not notify */
  report(id: string, activity: QueryActivity | null): void {
    const prev = this.items.get(id);
    if (activity === null) {
      if (!prev) return;
      this.items.delete(id);
    } else {
      if (prev && sameActivity(prev, activity)) return;
      this.items.set(id, activity);
    }
    this.list = [...this.items.entries()];
    for (const fn of this.listeners) fn();
  }

  /** session boundary (sign-out / account change): forget every report */
  clear(): void {
    if (this.items.size === 0) return;
    this.items.clear();
    this.list = [];
    for (const fn of this.listeners) fn();
  }
}

const sameActivity = (a: QueryActivity, b: QueryActivity) =>
  a.resource === b.resource && a.phase === b.phase && a.label === b.label && (a.displayedLabel ?? null) === (b.displayedLabel ?? null) &&
  (a.retryAt ?? null) === (b.retryAt ?? null) && (a.scope ?? 'global') === (b.scope ?? 'global');

const PRIORITY: Record<ActivityPhase, number> = { error: 0, retry_wait: 1, fetching: 2, processing: 3, scheduled: 4 };

/** the one line the top status shows: related errors / retry waits first, then real work, then waiting slots */
export function primaryActivity(list: ReadonlyArray<[string, QueryActivity]>): { main: QueryActivity; others: number } | null {
  const global = list.map(([, a]) => a).filter((a) => (a.scope ?? 'global') === 'global');
  if (global.length === 0) return null;
  const sorted = [...global].sort((a, b) => PRIORITY[a.phase] - PRIORITY[b.phase]);
  return { main: sorted[0], others: global.filter((a) => a.phase !== 'error').length - (sorted[0].phase === 'error' ? 0 : 1) };
}

export const ActivityContext = createContext<ActivityRegistry | null>(null);

/** Declarative report: pass the current state (or null when idle). Removed on unmount. */
export function useReportActivity(id: string, activity: QueryActivity | null, own?: ActivityRegistry | null): void {
  const fromContext = useContext(ActivityContext);
  const registry = own ?? fromContext;
  const key = activity ? JSON.stringify(activity) : '';
  useEffect(() => {
    registry?.report(id, activity);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registry, id, key]);
  const last = useRef(registry);
  last.current = registry;
  useEffect(() => () => { last.current?.report(id, null); }, [id]);
  // a session boundary clears reports; re-report the current state after it
  useEffect(() => { if (activity) registry?.report(id, activity); }); // eslint-disable-line react-hooks/exhaustive-deps
}

export function useActivities(registry: ActivityRegistry | null): ReadonlyArray<[string, QueryActivity]> {
  const empty = useRef<ReadonlyArray<[string, QueryActivity]>>([]);
  return useSyncExternalStore(
    registry ? registry.subscribe : () => () => undefined,
    registry ? registry.snapshot : () => empty.current,
    registry ? registry.snapshot : () => empty.current,
  );
}
