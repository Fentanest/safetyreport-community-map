/** F06 one export job: load Excelize (lazy, cached per Worker) → write the workbook. Shared by the Worker and the
 *  main-thread fallback so both paths produce the same file. */
import wasmUrl from 'excelize-wasm/excelize.wasm.gz?url';
import { loadExcelize } from './excelizeLoader';
import { ExportError, type ExportSnapshot, type ExportStage } from './model';
import { writeWorkbook, type WriteResult } from './workbook';

export const EXCELIZE_WASM_URL: string = wasmUrl;

export async function runExport(snap: ExportSnapshot, onStage: (s: ExportStage) => void): Promise<WriteResult> {
  onStage('prepare');
  const x = await loadExcelize(new URL(wasmUrl, (globalThis as { location?: Location }).location?.href).href);
  try {
    return writeWorkbook(x, snap, onStage);
  } catch (e) {
    if (e instanceof ExportError) throw e;
    const msg = String(e);
    throw new ExportError(/memory|allocation|RangeError/i.test(msg) ? 'out_of_memory' : 'write_failed', msg.slice(0, 200));
  }
}
