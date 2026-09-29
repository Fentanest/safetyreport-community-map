/**
 * F06 export job controller (main thread, small; the Worker, Excelize and the writer load only on the first click).
 *
 * - one job at a time: a second click while a file is being made is ignored (the button shows the running job);
 * - every Worker message is checked against `jobId` and the viewer that started the job: a late message of a
 *   cancelled job, or of another account, is dropped (no file, no save button);
 * - cancel = terminate the Worker (a long synchronous WASM write cannot be interrupted by a message); the next job
 *   starts a fresh Worker. The statistics/map requests are never touched;
 * - account change / sign-out (setViewer) cancels the job and drops a finished file and its save button;
 * - the finished Blob is kept until it is saved or dismissed; object URLs are revoked shortly after each save.
 */
import { useSyncExternalStore } from 'react';
import { ERROR_TEXT, ExportError, XLSX_MIME, fileName, type ExportErrorCode, type ExportSnapshot, type ExportSource, type ExportStage } from './model';
import type { WorkerIn, WorkerOut } from './export.worker';

export type ExportState =
  | { status: 'idle'; note?: string | null; source?: ExportSource }
  | { status: 'running'; jobId: number; source: ExportSource; stage: ExportStage | 'queued' }
  | { status: 'ready'; jobId: number; source: ExportSource; name: string; size: number; ms: number; saved: number; worker: boolean;
      crossOriginIsolated: boolean; sab: boolean }
  | { status: 'error'; jobId: number; source: ExportSource; code: ExportErrorCode; message: string };

const IDLE_WORKER_MS = 60_000;
const REVOKE_MS = 30_000;

class ExportController {
  private state: ExportState = { status: 'idle' };
  private listeners = new Set<() => void>();
  private worker: Worker | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private jobSeq = 0;
  private viewer: string | null = null;
  private jobViewer: string | null = null;
  private file: Blob | null = null;
  private lastSnapshot: ExportSnapshot | null = null;
  /** dev/e2e counters (read through window.__cmExport in DEV builds only) */
  readonly counters = { workersCreated: 0, workersLive: 0, urlsLive: 0, jobs: 0, dropped: 0 };

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  snapshot = () => this.state;
  private set(s: ExportState) { this.state = s; for (const fn of this.listeners) fn(); }

  /** the signed-in identity (sessionKeyOf): a change cancels the running job and forgets a finished file */
  setViewer(viewer: string | null) {
    if (viewer === this.viewer) return;
    const had = this.viewer !== null;
    this.viewer = viewer;
    if (!had) return;
    this.abort();
    this.file = null;
    this.lastSnapshot = null;
    if (this.state.status !== 'idle') this.set({ status: 'idle', note: null });
  }

  /** start a job from a snapshot captured at click time; false when another job is running */
  start(snapshot: ExportSnapshot): boolean {
    if (this.state.status === 'running') return false;
    const jobId = ++this.jobSeq;
    this.counters.jobs += 1;
    this.file = null;
    this.lastSnapshot = snapshot;
    this.jobViewer = this.viewer;
    this.set({ status: 'running', jobId, source: snapshot.source, stage: 'queued' });
    clearTimeout(this.idleTimer);
    const w = this.ensureWorker();
    if (w) {
      w.postMessage({ type: 'run', jobId, snapshot } satisfies WorkerIn);
    } else {
      void this.runInline(jobId, snapshot);
    }
    return true;
  }

  retry(): boolean { return this.lastSnapshot ? this.start({ ...this.lastSnapshot }) : false; }

  cancel() {
    const s = this.state;
    if (s.status !== 'running') return;
    this.abort();
    this.set({ status: 'idle', note: ERROR_TEXT.cancelled, source: s.source });
  }

  dismiss() {
    this.file = null;
    if (this.state.status === 'ready' || this.state.status === 'error') this.set({ status: 'idle', note: null });
  }

  /** save the finished file (the fallback button when the browser did not start the download by itself) */
  save(): boolean {
    if (this.state.status !== 'ready' || !this.file) return false;
    const url = URL.createObjectURL(this.file);
    this.counters.urlsLive += 1;
    const a = document.createElement('a');
    a.href = url;
    a.download = this.state.name;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    // the anchor and the object URL live until the browser has taken the download over
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); this.counters.urlsLive -= 1; }, REVOKE_MS);
    this.set({ ...this.state, saved: this.state.saved + 1 });
    return true;
  }

  private abort() {
    if (this.worker) { this.worker.terminate(); this.worker = null; this.counters.workersLive -= 1; }
    clearTimeout(this.idleTimer);
  }

  private ensureWorker(): Worker | null {
    if (this.worker) return this.worker;
    if (typeof Worker === 'undefined') return null;
    try {
      const w = new Worker(new URL('./export.worker.ts', import.meta.url), { type: 'module', name: 'excel-export' });
      w.onmessage = (e: MessageEvent<WorkerOut>) => this.onMessage(e.data, true);
      w.onerror = (e) => {
        e.preventDefault();
        const s = this.state;
        if (this.worker === w) { w.terminate(); this.worker = null; this.counters.workersLive -= 1; }
        // the Worker could not even start (no module/Worker support, blocked script): the same writer on this thread
        if (s.status === 'running' && s.stage === 'queued' && this.lastSnapshot) { void this.runInline(s.jobId, this.lastSnapshot); return; }
        if (s.status === 'running') this.fail(s.jobId, 'worker_failed', e.message || 'worker error');
      };
      this.worker = w;
      this.counters.workersCreated += 1;
      this.counters.workersLive += 1;
      return w;
    } catch {
      return null;
    }
  }

  private async runInline(jobId: number, snapshot: ExportSnapshot) {
    try {
      const { runExport } = await import('./runner');
      const t0 = performance.now();
      const { bytes, stats } = await runExport(snapshot, (stage) => this.onMessage({ type: 'stage', jobId, stage }, false));
      this.onMessage({ type: 'done', jobId, buffer: bytes.buffer as ArrayBuffer, stats, ms: Math.round(performance.now() - t0),
        crossOriginIsolated: globalThis.crossOriginIsolated === true, sab: typeof SharedArrayBuffer !== 'undefined' }, false);
    } catch (e) {
      // a chunk that could not be fetched (offline, blocked, a stale deployment) is a download failure, not a write error
      const code = e instanceof ExportError ? e.code : /dynamically imported module|Importing a module script failed|Failed to fetch/i.test(String(e)) ? 'asset_network' : 'write_failed';
      this.onMessage({ type: 'error', jobId, code, message: e instanceof ExportError ? e.message : ERROR_TEXT[code] }, false);
    }
  }

  private current(jobId: number): boolean {
    const s = this.state;
    const ok = s.status === 'running' && s.jobId === jobId && this.jobViewer === this.viewer;
    if (!ok) this.counters.dropped += 1;
    return ok;
  }

  private onMessage(m: WorkerOut, viaWorker: boolean) {
    if (!this.current(m.jobId)) return;
    const s = this.state as Extract<ExportState, { status: 'running' }>;
    if (m.type === 'stage') { this.set({ ...s, stage: m.stage }); return; }
    if (m.type === 'error') { this.fail(m.jobId, m.code, m.message); this.scheduleIdle(); return; }
    const name = fileName(this.lastSnapshot!);
    this.file = new Blob([m.buffer], { type: XLSX_MIME });
    this.set({ status: 'ready', jobId: m.jobId, source: s.source, name, size: this.file.size, ms: m.ms, saved: 0, worker: viaWorker,
      crossOriginIsolated: m.crossOriginIsolated, sab: m.sab });
    this.scheduleIdle();
    this.save(); // usually allowed right after the click; the "파일 저장" button stays as the fallback
  }

  private fail(jobId: number, code: ExportErrorCode, message: string) {
    const s = this.state;
    if (s.status !== 'running' || s.jobId !== jobId) return;
    this.set({ status: 'error', jobId, source: s.source, code, message: message || ERROR_TEXT[code] });
  }

  private scheduleIdle() {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => { if (this.state.status !== 'running') this.abort(); }, IDLE_WORKER_MS);
  }
}

export const exportController = new ExportController();
if (import.meta.env.DEV) (globalThis as unknown as { __cmExport?: ExportController }).__cmExport = exportController;

export function useExportState(): ExportState {
  return useSyncExternalStore(exportController.subscribe, exportController.snapshot, exportController.snapshot);
}
