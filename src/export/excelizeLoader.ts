/**
 * F06 lazy Excelize loader (Worker or main thread; never imported by the initial bundle).
 *
 * The WASM archive comes from the pinned npm package, emitted by Vite as a hashed asset of THIS site (same origin,
 * base-path aware) — never a CDN or a floating version. excelize-wasm's `init(url)` fetches the url and always
 * gunzips it with its bundled pako, so the bytes are fetched and checked here first:
 *   gzip (1f 8b)          → handed over as is (Pages serves .gz as application/gzip without Content-Encoding)
 *   raw wasm (00 61 73 6d) → a server already decoded it (Content-Encoding: gzip): re-wrapped as gzip, so it is
 *                            decompressed exactly once
 *   anything else (an HTML 404 page, a truncated file) → 'asset_not_wasm', never passed to WebAssembly
 * No SharedArrayBuffer, no shared memory, no threads: works with crossOriginIsolated === false.
 * A failed load is not cached (the next click retries); a successful one is reused by this Worker.
 */
import { init } from 'excelize-wasm';
import { ExportError } from './model';
import type { XModule } from './workbook';

let loaded: Promise<XModule> | null = null;

export function loadExcelize(wasmUrl: string, fetchImpl: typeof fetch = fetch): Promise<XModule> {
  loaded ??= load(wasmUrl, fetchImpl);
  loaded.catch(() => { loaded = null; });
  return loaded;
}

export async function checkedArchive(wasmUrl: string, fetchImpl: typeof fetch = fetch): Promise<Uint8Array> {
  if (typeof WebAssembly !== 'object' || typeof WebAssembly.instantiate !== 'function') throw new ExportError('unsupported');
  let res: Response;
  try { res = await fetchImpl(wasmUrl, { credentials: 'same-origin' }); } catch (e) { throw new ExportError('asset_network', String(e)); }
  if (!res.ok) throw new ExportError('asset_http', `HTTP ${res.status}`);
  const type = res.headers.get('content-type') ?? '';
  if (/text\/html/i.test(type)) throw new ExportError('asset_not_wasm', `content-type ${type}`);
  let bytes: Uint8Array;
  try { bytes = new Uint8Array(await res.arrayBuffer()); } catch (e) { throw new ExportError('asset_network', String(e)); }
  const gz = bytes[0] === 0x1f && bytes[1] === 0x8b;
  const wasm = bytes[0] === 0x00 && bytes[1] === 0x61 && bytes[2] === 0x73 && bytes[3] === 0x6d;
  if (gz) return bytes;
  if (wasm) return gzip(bytes);
  throw new ExportError('asset_not_wasm', `unexpected bytes ${[...bytes.slice(0, 4)].map((b) => b.toString(16)).join(' ')}`);
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream !== 'function') throw new ExportError('asset_not_wasm', 'decoded by the server and no CompressionStream to re-wrap it');
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function load(wasmUrl: string, fetchImpl: typeof fetch): Promise<XModule> {
  const archive = await checkedArchive(wasmUrl, fetchImpl);
  const blobUrl = URL.createObjectURL(new Blob([archive as BlobPart], { type: 'application/gzip' }));
  try {
    return (await init(blobUrl)) as unknown as XModule;
  } catch (e) {
    const msg = String(e);
    throw new ExportError(/memory|allocation/i.test(msg) ? 'out_of_memory' : 'init_failed', msg.slice(0, 200));
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}
