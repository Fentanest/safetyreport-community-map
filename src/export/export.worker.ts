/// <reference lib="webworker" />
/**
 * F06 export Worker (a plain dedicated Web Worker — no SharedArrayBuffer, no shared WASM memory, no COOP/COEP).
 * Messages carry the job id; the UI ignores anything that is not its current job. The file bytes are sent as a
 * transferable ArrayBuffer that this Worker owns (a copy, never the WASM heap).
 */
import { ExportError, type ExportSnapshot, type ExportStage } from './model';
import { runExport } from './runner';

export type WorkerIn = { type: 'run'; jobId: number; snapshot: ExportSnapshot };
export type WorkerOut =
  | { type: 'stage'; jobId: number; stage: ExportStage }
  | { type: 'done'; jobId: number; buffer: ArrayBuffer; stats: Record<string, number>; ms: number; crossOriginIsolated: boolean; sab: boolean }
  | { type: 'error'; jobId: number; code: ExportError['code']; message: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;
ctx.onmessage = async (e: MessageEvent<WorkerIn>) => {
  const msg = e.data;
  if (msg?.type !== 'run') return;
  const t0 = performance.now();
  try {
    const { bytes, stats } = await runExport(msg.snapshot, (stage) => ctx.postMessage({ type: 'stage', jobId: msg.jobId, stage } satisfies WorkerOut));
    const buffer = bytes.buffer as ArrayBuffer;
    ctx.postMessage({ type: 'done', jobId: msg.jobId, buffer, stats, ms: Math.round(performance.now() - t0),
      crossOriginIsolated: (self as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated === true,
      sab: typeof SharedArrayBuffer !== 'undefined' } satisfies WorkerOut, [buffer]);
  } catch (err) {
    const code = err instanceof ExportError ? err.code : 'write_failed';
    ctx.postMessage({ type: 'error', jobId: msg.jobId, code, message: err instanceof Error ? err.message : String(err) } satisfies WorkerOut);
  }
};
