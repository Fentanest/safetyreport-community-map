import { describe, expect, it } from 'vitest';
import { RefreshController, type RefreshDeps } from '../../src/data/refreshController';
import { PublicApiError } from '../../src/data/client';
import type { DashboardData, PublicMeta, Scope } from '../../src/domain/public';

/** R04 / P02 / P03 / P04 request policy with a manual clock (no real timers, no network). */
const base: Scope = { start: '2026-01-01', end: '2026-09-24', category: 'all', region_code: null, agency_key: null, manager_key: null, bbox: null, law: null };
const bbox = (i: number): Scope => ({ ...base, bbox: [126 + i * 0.01, 37, 127 + i * 0.01, 38] });
const meta = (version = 'v1'): PublicMeta => ({ schema_version: 2, dataset_version: version, sample: false, source_updated_at: null,
  generated_at: null, published_at: null, data_min: null, data_max: null, coverage_note: '', dedupe_policy_version: 't', capabilities: {} });
const dataFor = (scope: Scope, version = 'v1') => ({ meta: meta(version), scope } as unknown as DashboardData);

interface Pending { scope: Scope; resolve: (d: DashboardData) => void; reject: (e: unknown) => void; signal: AbortSignal }

function harness(opts = {}) {
  let now = 0;
  const timers: Array<{ at: number; fn: () => void; id: number }> = [];
  let nextId = 1;
  const pending: Pending[] = [];
  let metaCalls = 0;
  let metaVersion = 'v1';
  const deps: RefreshDeps = {
    fetchMeta: async () => { metaCalls += 1; return meta(metaVersion); },
    fetchDashboard: (_m, scope, signal) => new Promise((resolve, reject) => {
      pending.push({ scope, resolve, reject, signal });
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }),
    now: () => now,
    setTimer: (fn, ms) => { const id = nextId++; timers.push({ at: now + ms, fn, id }); return id; },
    clearTimer: (id) => { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1); },
  };
  const c = new RefreshController(deps, opts);
  const flush = () => new Promise(r => setTimeout(r, 0));
  const advance = async (ms: number) => {
    const target = now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const t = timers[0];
      if (!t || t.at > target) break;
      timers.shift();
      now = t.at;
      t.fn();
      await flush();
    }
    now = target;
    await flush();
  };
  return { c, pending, advance, flush, metaCalls: () => metaCalls, setMetaVersion: (v: string) => { metaVersion = v; } };
}

describe('coalescing and stale responses (P02)', () => {
  it('20 quick automatic moves inside the debounce become one request for the last range', async () => {
    const h = harness();
    h.c.request(base, 'initial');
    await h.flush();
    h.pending.shift()!.resolve(dataFor(base));
    await h.flush();
    for (let i = 0; i < 20; i++) { h.c.request(bbox(i), 'auto'); await h.advance(100); }
    expect(h.pending).toHaveLength(0);
    await h.advance(2000);
    expect(h.pending).toHaveLength(1);
    expect(h.pending[0].scope).toEqual(bbox(19));
    expect(h.metaCalls()).toBe(1); // metadata is not re-read per move
  });
  it('a late A response never replaces B', async () => {
    const h = harness();
    h.c.request(bbox(1), 'explicit');
    await h.flush();
    h.c.request(bbox(2), 'explicit');
    await h.flush();
    const [a, b] = h.pending;
    expect(a.signal.aborted).toBe(true);
    b.resolve(dataFor(bbox(2)));
    await h.flush();
    a.resolve(dataFor(bbox(1)));
    await h.flush();
    expect(h.c.snapshot().displayed!.scope).toEqual(bbox(2));
  });
  it('keeps the displayed snapshot during a refresh and does not refetch the displayed scope', async () => {
    const h = harness();
    h.c.request(base);
    await h.flush();
    h.pending.shift()!.resolve(dataFor(base));
    await h.flush();
    h.c.request(bbox(1));
    await h.flush();
    expect(h.c.snapshot().refreshing).toBe(true);
    expect(h.c.snapshot().displayed!.scope).toEqual(base);
    h.c.request(base); // back to the shown scope → cancel, no new request
    await h.flush();
    expect(h.pending.filter(p => !p.signal.aborted).length).toBe(0);
    expect(h.c.snapshot().refreshing).toBe(false);
  });
  it('limits automatic starts by the minimum interval and the per-minute budget', async () => {
    const h = harness({ budget: 3, budgetWindowMs: 60_000, minIntervalMs: 1000, debounceMs: 100 });
    const started: number[] = [];
    for (let i = 0; i < 6; i++) {
      h.c.request(bbox(i), 'auto');
      await h.advance(1100);
      while (h.pending.length) { const p = h.pending.shift()!; started.push(i); p.resolve(dataFor(p.scope)); await h.flush(); }
    }
    expect(started).toHaveLength(3); // budget reached within the minute
    await h.advance(60_000);
    expect(h.pending.length).toBe(1);
    expect(h.pending[0].scope).toEqual(bbox(5)); // only the latest range after the wait
  });
});

describe('failures (P03/P04)', () => {
  it('429: no request before Retry-After, keeps data, then only the latest range', async () => {
    const h = harness();
    h.c.request(base);
    await h.flush();
    h.pending.shift()!.resolve(dataFor(base));
    await h.flush();
    h.c.request(bbox(1));
    await h.flush();
    h.pending.shift()!.reject(new PublicApiError('많음', 429, 10));
    await h.flush();
    expect(h.c.snapshot().displayed!.scope).toEqual(base);
    expect(h.c.snapshot().error!.status).toBe(429);
    for (let i = 2; i < 6; i++) { h.c.request(bbox(i), 'auto'); await h.advance(1500); }
    expect(h.pending).toHaveLength(0);
    await h.advance(10_000);
    expect(h.pending).toHaveLength(1);
    expect(h.pending[0].scope).toEqual(bbox(5));
  });
  it('409 re-reads metadata once and retries; a second 409 is shown, no loop', async () => {
    const h = harness();
    h.c.request(base);
    await h.flush();
    h.setMetaVersion('v2');
    h.pending.shift()!.reject(new PublicApiError('changed', 409));
    await h.flush();
    expect(h.metaCalls()).toBe(2);
    h.pending.shift()!.reject(new PublicApiError('changed', 409));
    await h.flush();
    expect(h.pending).toHaveLength(0);
    expect(h.c.snapshot().error!.status).toBe(409);
    await h.advance(120_000);
    expect(h.pending).toHaveLength(0);
  });
  it('5xx/network: one delayed retry, then a visible error with the old data kept', async () => {
    const h = harness();
    h.c.request(base);
    await h.flush();
    h.pending.shift()!.resolve(dataFor(base));
    await h.flush();
    h.c.request(bbox(1));
    await h.flush();
    h.pending.shift()!.reject(new PublicApiError('down', 503));
    await h.flush();
    expect(h.c.snapshot().error).toBeNull();
    await h.advance(2000);
    h.pending.shift()!.reject(new TypeError('Failed to fetch'));
    await h.flush();
    expect(h.c.snapshot().error).not.toBeNull();
    expect(h.c.snapshot().displayed!.scope).toEqual(base);
    await h.advance(60_000);
    expect(h.pending).toHaveLength(0);
  });
  it('an aborted request is never reported as an error', async () => {
    const h = harness();
    h.c.request(bbox(1));
    await h.flush();
    h.c.request(bbox(2));
    await h.flush();
    expect(h.c.snapshot().error).toBeNull();
  });
  it('access loss clears the displayed data and cached metadata', async () => {
    const h = harness();
    h.c.request(base);
    await h.flush();
    h.pending.shift()!.resolve(dataFor(base));
    await h.flush();
    h.c.request(bbox(1));
    await h.flush();
    h.pending.shift()!.reject(new PublicApiError('로그인', 401, null, 'auth_required'));
    await h.flush();
    expect(h.c.snapshot().displayed).toBeNull();
    expect(h.c.snapshot().access!.code).toBe('auth_required');
    h.c.reset();
    h.c.request(base);
    await h.flush();
    expect(h.metaCalls()).toBe(2);
  });
});

describe('S10 request phases (display reads them; nothing new is fetched)', () => {
  it('debounce wait → fetching → idle; a 429 is retry_wait with its own time, not "fetching"', async () => {
    const h = harness();
    h.c.request(base, 'initial');
    await h.flush();
    expect(h.c.snapshot()).toMatchObject({ fetching: true, wait: null });
    h.pending.shift()!.resolve(dataFor(base));
    await h.flush();
    expect(h.c.snapshot()).toMatchObject({ fetching: false, wait: null, refreshing: false });
    h.c.request(bbox(1), 'auto');
    expect(h.c.snapshot()).toMatchObject({ fetching: false, wait: 'debounce', scheduled: true });
    await h.advance(2000);
    expect(h.c.snapshot()).toMatchObject({ fetching: true, wait: null });
    h.pending.shift()!.reject(new PublicApiError('rate', 429, 5, 'RATE_LIMITED'));
    await h.flush();
    expect(h.c.snapshot()).toMatchObject({ fetching: false, wait: 'rate_limit' });
    expect(h.c.snapshot().pausedUntil).toBeGreaterThan(0);
    await h.advance(5000);
    expect(h.c.snapshot()).toMatchObject({ fetching: true, wait: null });
  });
  it('LD-16/17: A→B→C with answers in reverse order — only C lands, and A/B never end C\'s fetching', async () => {
    const h = harness();
    h.c.request(base, 'initial');
    await h.flush();
    h.pending.shift()!.resolve(dataFor(base));
    await h.flush();
    h.c.request(bbox(1), 'explicit'); await h.flush();
    h.c.request(bbox(2), 'explicit'); await h.flush();
    h.c.request(bbox(3), 'explicit'); await h.flush();
    const [a, b, c] = h.pending.splice(0);
    b.resolve(dataFor(bbox(2))); a.resolve(dataFor(bbox(1)));
    await h.flush();
    expect(h.c.snapshot().fetching).toBe(true);
    expect(h.c.snapshot().displayed!.scope).toEqual(base);
    c.resolve(dataFor(bbox(3)));
    await h.flush();
    expect(h.c.snapshot()).toMatchObject({ fetching: false, refreshing: false });
    expect(h.c.snapshot().displayed!.scope).toEqual(bbox(3));
  });
  it('LD-34: back to the displayed scope cancels the wait and the flight at once', async () => {
    const h = harness();
    h.c.request(base, 'initial'); await h.flush();
    h.pending.shift()!.resolve(dataFor(base)); await h.flush();
    h.c.request(bbox(1), 'explicit'); await h.flush();
    expect(h.c.snapshot().fetching).toBe(true);
    h.c.request(base, 'explicit');
    expect(h.c.snapshot()).toMatchObject({ fetching: false, wait: null, refreshing: false });
  });
  it('LD-18: one transient retry is a visible wait, then a stop with the error (no loop)', async () => {
    const h = harness();
    h.c.request(base, 'initial'); await h.flush();
    h.pending.shift()!.reject(new PublicApiError('down', 503, null, 'AGGREGATE_NOT_READY')); await h.flush();
    expect(h.c.snapshot()).toMatchObject({ wait: 'retry', fetching: false });
    await h.advance(2000);
    h.pending.shift()!.reject(new PublicApiError('down', 503, null, 'AGGREGATE_NOT_READY')); await h.flush();
    expect(h.c.snapshot()).toMatchObject({ wait: null, fetching: false, refreshing: false });
    expect(h.c.snapshot().error?.status).toBe(503);
    await h.advance(60_000);
    expect(h.pending).toHaveLength(0);
  });
});
