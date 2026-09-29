/**
 * F06 / E09: the Excel exporter is browser/Worker-only. Nothing the Edge functions import (server/, src/domain/,
 * supabase/functions/, shared/) may reach src/export or excelize-wasm; the initial app entry must not import the
 * Worker, the loader or the writer statically (they load on the first click).
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const root = resolve(__dirname, '../..');
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx|mjs|js)$/.test(n) ? [p] : [];
});
const imports = (file: string) => [...readFileSync(file, 'utf8').matchAll(/(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1] ?? m[2]);

/** every module reachable from `entry` through relative imports (static + dynamic) */
function closure(entry: string, followDynamic = true): Set<string> {
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length) {
    const f = stack.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    // type-only imports are erased by the compiler (they never load a module)
    const src = readFileSync(f, 'utf8').replace(/^\s*(import|export) type [^;]*;/gm, '');
    for (const m of src.matchAll(/(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|new URL\(\s*['"]([^'"]+)['"]/g)) {
      const spec = m[1] ?? (followDynamic ? m[2] ?? m[3] : undefined);
      if (!spec) continue;
      if (!spec.startsWith('.')) { seen.add(`pkg:${spec}`); continue; }
      const base = resolve(dirname(f), spec.replace(/\?.*$/, ''));
      const hit = [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')].find((p) => { try { return statSync(p).isFile(); } catch { return false; } });
      if (hit) stack.push(hit);
    }
  }
  return seen;
}

describe('F06 export boundary', () => {
  it('Edge-side code never imports the exporter or excelize', () => {
    const edge = [...walk(join(root, 'server')), ...walk(join(root, 'src/domain')), ...walk(join(root, 'supabase/functions'))];
    const offenders = edge.flatMap((f) => imports(f).filter((i) => /export\/|excelize/.test(i)).map((i) => `${f.slice(root.length)} → ${i}`));
    expect(offenders).toEqual([]);
    for (const fn of ['public-analytics', 'my-analytics']) {
      const reach = [...closure(join(root, 'supabase/functions', fn, 'index.ts'))];
      expect(reach.filter((p) => /src\/export|excelize|src\/components|react/.test(p)), fn).toEqual([]);
    }
  });
  it('the app entry reaches the Worker/loader/writer only through the click-time Worker URL or a dynamic import', () => {
    const statics = [...closure(join(root, 'src/main.tsx'), false)];
    expect(statics.filter((p) => /excelize|src\/export\/(workbook|excelizeLoader|runner|export\.worker)\.ts$/.test(p))).toEqual([]);
  });
});
