import type { DashboardData, Scope } from '../domain/public';

export interface ScreenPanel { id: string; path: string; params: Record<string, string> }
export interface ScreenPacket {
  data: DashboardData;
  panels: { id: string; status: number; body: unknown }[];
}
const key = (p: ScreenPanel) => JSON.stringify([p.path, Object.entries(p.params).sort(([a], [b]) => a.localeCompare(b))]);
const scopeKey = (s: Scope) => JSON.stringify(Object.entries(s).sort(([a], [b]) => a.localeCompare(b)));
const aborted = () => new DOMException('Superseded screen', 'AbortError');

/** Browser-memory safe DTOs only. Every additional panel replaces the WHOLE screen in one request.
 * Dataset hashes are opaque: request generation, never lexical version ordering, decides which answer wins. */
export class ScreenCoordinator {
  private scope: Scope | null = null;
  private frame: ScreenPacket | null = null;
  private requests = new Map<string, ScreenPanel>();
  private frameKeys = new Map<string, string>();
  private settled: { scope: Scope; frame: ScreenPacket; requests: Map<string, ScreenPanel>; keys: Map<string, string> } | null = null;
  private generation = 0;
  private pending: Promise<ScreenPacket> | null = null;
  private abort: AbortController | null = null;
  private listeners = new Set<(data: DashboardData) => void>();
  constructor(private transport: (scope: Scope, panels: ScreenPanel[], signal: AbortSignal) => Promise<ScreenPacket>) {}
  subscribe(fn: (data: DashboardData) => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  reset() {
    this.generation++; this.abort?.abort(); this.abort = null; this.pending = null;
    this.scope = null; this.frame = null; this.settled = null; this.requests.clear(); this.frameKeys.clear();
  }
  peek(scope: Scope, version: string, id: string): unknown | null {
    if (!this.matches(scope) || this.frame?.data.meta.dataset_version !== version) return null;
    const result = this.frame.panels.find(p => p.id === id);
    return result?.status === 200 ? result.body : null;
  }
  drop(id: string) { this.requests.delete(id); this.settled?.requests.delete(id); }
  active() { return this.scope !== null; }
  matches(scope: Scope) { return this.scope !== null && scopeKey(this.scope) === scopeKey(scope); }
  async open(scope: Scope, signal?: AbortSignal): Promise<DashboardData> {
    if (!this.matches(scope)) {
      // A → B → A may cancel B while the controller keeps displaying A. Preserve only the
      // last complete safe frame for that cancellation; account reset still forgets it.
      const settled = this.settled;
      this.reset(); this.settled = settled; this.scope = scope;
    }
    const job = this.fetch(signal);
    this.pending = job;
    try { return (await job).data; }
    finally { if (this.pending === job) this.pending = null; }
  }
  private async fetch(signal?: AbortSignal): Promise<ScreenPacket> {
    this.abort?.abort();
    const ac = new AbortController(); this.abort = ac;
    const cancel = () => ac.abort(); signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) ac.abort();
    const gen = ++this.generation, scope = this.scope!, requests = [...this.requests.values()];
    try {
      const frame = await this.transport(scope, requests, ac.signal);
      if (ac.signal.aborted || gen !== this.generation) throw aborted();
      this.frame = frame; this.frameKeys = new Map(requests.map(p => [p.id, key(p)]));
      this.settled = { scope, frame, requests: new Map(requests.map(p => [p.id, p])), keys: new Map(this.frameKeys) };
      for (const listener of this.listeners) listener(frame.data);
      return frame;
    } catch (e) {
      if (gen === this.generation && signal?.aborted && this.settled) {
        this.scope = this.settled.scope; this.frame = this.settled.frame;
        this.requests = new Map(this.settled.requests); this.frameKeys = new Map(this.settled.keys);
      }
      throw e;
    } finally { signal?.removeEventListener('abort', cancel); }
  }
  async panel(scope: Scope, panel: ScreenPanel, signal?: AbortSignal): Promise<{ status: number; body: unknown }> {
    if (signal?.aborted) throw aborted();
    if (!this.matches(scope)) {
      // A still-visible old frame must never fall back to individually fenced HTTP reads.
      // Await the scope transition: cancellation restores A; success supersedes this intent.
      const pending = this.pending;
      if (!pending) throw aborted();
      try { await pending; } catch { /* the screen controller owns the root error */ }
      if (this.pending && this.pending !== pending && !this.matches(scope)) return this.panel(scope, panel, signal);
      if (!this.matches(scope) || signal?.aborted) throw aborted();
    }
    this.requests.set(panel.id, panel);
    let frame = this.frame;
    if (!frame || this.frameKeys.get(panel.id) !== key(panel)) {
      if (!this.pending) {
        // Gather the table/comparison effects of one render before one bounded bundle request.
        const scheduledScope = this.scope;
        const job = new Promise<void>(resolve => setTimeout(resolve, 0)).then(() => {
          if (this.scope !== scheduledScope) throw aborted();
          return this.fetch();
        });
        this.pending = job;
        void job.finally(() => { if (this.pending === job) this.pending = null; }).catch(() => undefined);
      }
      frame = await this.pending;
      const current = this.requests.get(panel.id);
      if (!this.matches(scope) || !current || key(current) !== key(panel) || signal?.aborted) throw aborted();
      // A panel intent arrived while another bundle was in flight. One subsequent bundle includes it.
      if (this.frameKeys.get(panel.id) !== key(panel)) return this.panel(scope, panel, signal);
    }
    if (signal?.aborted) throw aborted();
    const result = frame.panels.find(p => p.id === panel.id);
    if (!result) throw new Error('Incomplete screen response');
    return result;
  }
}
