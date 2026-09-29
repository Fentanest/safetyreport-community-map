/**
 * Dashboard refresh controller (R04). Pure TypeScript — no React, no DOM — so the request policy is unit-tested
 * with fake timers (tests/product/refreshController.test.ts).
 *
 * State it keeps apart:
 *   requested  — the scope the user (or the map, with auto refresh on) asked for last;
 *   displayed  — the last SUCCESSFUL snapshot {data, scope, version}; it stays on screen during a refresh and
 *                after a refresh error (except access loss), so the map, charts and tables are never unmounted.
 * Policy:
 *   - explicit requests start at once; automatic (map-move) requests are trailing-debounced, spaced by a minimum
 *     interval and limited by a per-minute request budget (the server allows 60 requests/min per viewer);
 *   - the same scope as the one displayed or in flight never starts a second request;
 *   - every start increments a generation and aborts the previous request; an older response never lands;
 *   - metadata (dataset version) is read once per session and re-read only after a 409, retried once;
 *   - 429 pauses every request until Retry-After, then runs only the latest requested scope;
 *   - network/5xx get one delayed retry, then a visible error (the displayed snapshot stays);
 *   - access errors (401/403 access codes) clear everything — the caller shows the access gate.
 */
import type { DashboardData, PublicMeta, Scope } from '../domain/public';
import { PublicApiError, isAccessError, sameScope } from './client';

export type RequestSource = 'initial' | 'explicit' | 'auto';

export interface Snapshot { data: DashboardData; scope: Scope; version: string }

export interface RefreshError {
  message: string;
  status: number | null;
  code: string | null;
  retryAfter: number | null;
  details?: { required: number; current: number | null } | null;
}

export interface RefreshState {
  /** dataset metadata of this session (version, whole-history data_min/data_max); null until read */
  meta: PublicMeta | null;
  displayed: Snapshot | null;
  requested: Scope | null;
  /** a request is in flight or scheduled for a scope that is not displayed yet */
  refreshing: boolean;
  /** an automatic request is waiting for its debounce / interval / budget slot */
  scheduled: boolean;
  /** S10: a request is actually on the wire (meta → body → schema check → commit); false while only waiting */
  fetching: boolean;
  /** S10: why nothing is on the wire although a scope is wanted: debounce slot, the one transient retry, or a 429 pause */
  wait: 'debounce' | 'retry' | 'rate_limit' | null;
  error: RefreshError | null;
  /** epoch ms until which requests are paused after a 429 */
  pausedUntil: number | null;
  /** access lost (401/403 access code): the caller must show the gate; nothing is displayed */
  access: RefreshError | null;
  /** increments on every started request (diagnostics / tests) */
  generation: number;
}

export interface RefreshDeps {
  fetchMeta(signal: AbortSignal): Promise<PublicMeta>;
  fetchDashboard(meta: PublicMeta, scope: Scope, signal: AbortSignal): Promise<DashboardData>;
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(id: unknown): void;
}

export interface RefreshOptions {
  debounceMs: number;
  minIntervalMs: number;
  /** at most `budget` automatic starts per `budgetWindowMs` */
  budget: number;
  budgetWindowMs: number;
  retryDelayMs: number;
  defaultRetryAfterSec: number;
}

export const DEFAULT_REFRESH_OPTIONS: RefreshOptions = {
  debounceMs: 500, minIntervalMs: 1200, budget: 20, budgetWindowMs: 60_000, retryDelayMs: 2000, defaultRetryAfterSec: 60,
};

const isAbort = (e: unknown) => (e instanceof DOMException && e.name === 'AbortError') ||
  (e instanceof Error && e.name === 'AbortError');

export function toRefreshError(e: unknown): RefreshError {
  if (e instanceof PublicApiError) {
    return { message: e.message, status: e.status, code: e.code, retryAfter: e.retryAfter, details: e.details };
  }
  return { message: e instanceof Error && e.message ? e.message : '통계를 불러오지 못했습니다.', status: null, code: null, retryAfter: null };
}

export class RefreshController {
  private state: RefreshState = {
    meta: null, displayed: null, requested: null, refreshing: false, scheduled: false, fetching: false, wait: null, error: null, pausedUntil: null, access: null, generation: 0,
  };
  private listeners = new Set<(s: RefreshState) => void>();
  private meta: PublicMeta | null = null;
  private inflight: { scope: Scope; ac: AbortController; gen: number } | null = null;
  private timer: unknown = null;
  private pauseTimer: unknown = null;
  private starts: number[] = [];
  private lastStart = -Infinity;
  private retries = 0;
  private disposed = false;
  private readonly opts: RefreshOptions;

  constructor(private readonly deps: RefreshDeps, opts: Partial<RefreshOptions> = {}) {
    this.opts = { ...DEFAULT_REFRESH_OPTIONS, ...opts };
  }

  snapshot(): RefreshState { return this.state; }
  subscribe(fn: (s: RefreshState) => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }
  private set(patch: Partial<RefreshState>) {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn(this.state);
  }

  /** Ask for `scope`. Auto requests are coalesced; explicit ones start now (unless paused by a 429). */
  request(scope: Scope, source: RequestSource = 'explicit'): void {
    if (this.disposed) return;
    this.set({ requested: scope });
    const shown = this.state.displayed;
    if (shown && sameScope(shown.scope, scope) && !this.state.error) {
      // back to what is on screen: drop anything pending or running (its answer would no longer be wanted)
      this.cancelPending();
      this.inflight?.ac.abort();
      this.inflight = null;
      this.set({ refreshing: false, scheduled: false, fetching: false, wait: null, generation: this.state.generation + 1 });
      return;
    }
    if (this.inflight && sameScope(this.inflight.scope, scope)) return; // same request already running
    if (this.state.access) return;
    this.retries = 0;
    if (this.paused()) { this.set({ refreshing: true, scheduled: true, wait: 'rate_limit' }); return; }
    if (source === 'auto') this.schedule();
    else this.start(scope);
  }

  /** Retry the latest requested scope now (user button). Respects a running 429 pause. */
  retry(): void {
    const scope = this.state.requested;
    if (!scope || this.disposed) return;
    this.set({ error: null });
    this.retries = 0;
    if (this.paused()) { this.set({ refreshing: true, scheduled: true, wait: 'rate_limit' }); return; }
    this.start(scope);
  }

  /** Account change / sign-out: cancel everything and forget every cached response and the metadata. */
  reset(): void {
    this.cancelPending();
    // C01: a new generation, so nothing started before the reset (meta included) can land afterwards
    this.state = { ...this.state, generation: this.state.generation + 1 };
    this.inflight?.ac.abort();
    this.inflight = null;
    this.meta = null;
    this.retries = 0;
    if (this.pauseTimer !== null) this.deps.clearTimer(this.pauseTimer);
    this.pauseTimer = null;
    this.set({ meta: null, displayed: null, requested: null, refreshing: false, scheduled: false, fetching: false, wait: null, error: null, pausedUntil: null, access: null });
  }

  dispose(): void {
    this.reset();
    this.disposed = true;
    this.listeners.clear();
  }

  private paused(): boolean {
    return this.state.pausedUntil !== null && this.deps.now() < this.state.pausedUntil;
  }

  private cancelPending() {
    if (this.timer !== null) this.deps.clearTimer(this.timer);
    this.timer = null;
  }

  /** Earliest time an automatic start is allowed (debounce, minimum interval, rolling budget). */
  private nextSlot(now: number): number {
    const window = this.opts.budgetWindowMs;
    this.starts = this.starts.filter(t => now - t < window);
    let at = Math.max(now + this.opts.debounceMs, this.lastStart + this.opts.minIntervalMs);
    if (this.starts.length >= this.opts.budget) at = Math.max(at, this.starts[this.starts.length - this.opts.budget] + window);
    return at;
  }

  private schedule() {
    this.cancelPending();
    const now = this.deps.now();
    const delay = Math.max(0, this.nextSlot(now) - now);
    this.set({ refreshing: true, scheduled: true, wait: 'debounce' });
    this.timer = this.deps.setTimer(() => {
      this.timer = null;
      const scope = this.state.requested;
      if (scope) this.start(scope);
    }, delay);
  }

  private start(scope: Scope) {
    this.cancelPending();
    this.inflight?.ac.abort(); // client cancel only; the server may still finish its work
    const ac = new AbortController();
    const gen = this.state.generation + 1;
    this.inflight = { scope, ac, gen };
    const now = this.deps.now();
    this.starts.push(now);
    this.lastStart = now;
    this.set({ generation: gen, refreshing: true, scheduled: false, fetching: true, wait: null });
    void this.run(scope, ac, gen, false);
  }

  private async run(scope: Scope, ac: AbortController, gen: number, metaRetried: boolean): Promise<void> {
    try {
      if (!this.meta) {
        const fetched = await this.deps.fetchMeta(ac.signal);
        // C01: an answer for a request started before a reset/newer start is dropped before it is cached
        if (ac.signal.aborted || gen !== this.state.generation) return;
        this.meta = fetched;
        this.set({ meta: this.meta });
      }
      const meta = this.meta;
      const data = await this.deps.fetchDashboard(meta, scope, ac.signal);
      if (ac.signal.aborted || gen !== this.state.generation) return;
      this.inflight = null;
      this.retries = 0;
      const stillWanted = this.state.requested && sameScope(this.state.requested, scope);
      this.set({ displayed: { data, scope, version: data.meta.dataset_version }, error: null,
        // an automatic request may already be waiting for its slot behind this one: it stays visible as waiting
        refreshing: !stillWanted, scheduled: this.timer !== null, fetching: false, wait: this.timer !== null ? 'debounce' : null });
    } catch (e) {
      if (isAbort(e) || ac.signal.aborted || gen !== this.state.generation) return;
      const err = toRefreshError(e);
      if (isAccessError(e)) {
        this.inflight = null;
        this.meta = null;
        this.cancelPending();
        this.set({ access: err, displayed: null, refreshing: false, scheduled: false, fetching: false, wait: null, error: null });
        return;
      }
      if (err.status === 409 && !metaRetried) {
        this.meta = null; // dataset changed: read the metadata once more and retry this latest scope once
        return this.run(scope, ac, gen, true);
      }
      this.inflight = null;
      if (err.status === 429) {
        const wait = (err.retryAfter ?? this.opts.defaultRetryAfterSec) * 1000;
        const until = this.deps.now() + wait;
        if (this.pauseTimer !== null) this.deps.clearTimer(this.pauseTimer);
        this.pauseTimer = this.deps.setTimer(() => {
          this.pauseTimer = null;
          this.set({ pausedUntil: null });
          const latest = this.state.requested;
          if (latest && !(this.state.displayed && sameScope(this.state.displayed.scope, latest))) this.start(latest);
          else this.set({ refreshing: false, scheduled: false, fetching: false, wait: null, error: null });
        }, wait);
        this.set({ pausedUntil: until, error: { ...err, retryAfter: Math.ceil(wait / 1000) }, refreshing: true, scheduled: true, fetching: false, wait: 'rate_limit' });
        return;
      }
      const transient = err.status === null || err.status >= 500;
      if (transient && this.retries < 1) {
        this.retries += 1;
        this.set({ refreshing: true, scheduled: true, fetching: false, wait: 'retry' });
        this.timer = this.deps.setTimer(() => {
          this.timer = null;
          const latest = this.state.requested;
          if (latest) this.start(latest);
        }, this.opts.retryDelayMs);
        return;
      }
      this.set({ error: err, refreshing: false, scheduled: false, fetching: false, wait: null });
    }
  }
}
