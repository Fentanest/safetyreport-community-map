/**
 * F02 analysis share link: a small VERSIONED recipe in the URL (`?screen=statistics&sr=<base64url JSON>`), so the
 * receiver re-runs the same analysis with THEIR OWN permission. It is a configuration, never a result.
 *
 * Carried (allowlist, v1): dates, date basis, population (mine/compare = "the opener's own reports"), rows/columns/
 * metrics registry ids and their order, category/region/law/agency/manager scope keys, compared targets (filter member
 * keys), chart type / primary metric / overlay, table-or-chart view.
 * Never carried: tokens, user ids or hashes, labels or names (the server re-derives them), result values, the viewer's
 * own counts, an address (place_key) or a map bbox (personal location choices: removed only after an explicit
 * confirmation by the sharer), anything not in the schema (strict: unknown fields are refused, not ignored).
 */
import { z } from 'zod';
import type { Scope } from '../domain/public';
import { isLawParam } from '../domain/public';
import type { StatCatalog } from '../domain/statistics';
import { normalizeRegion } from '../data/regions';
import { isValidDate } from './filters';
import { baseSpec, type ChartSettings, type StatsRecipe } from './statistics';

export const SHARE_PARAM = 'sr';
export const SHARE_LIMITS = { encodedChars: 3500, jsonBytes: 4096, members: 50, filters: 8, key: 200 } as const;

const id = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/);
const key = z.string().min(1).max(SHARE_LIMITS.key).refine((s) => !/[\u0000-\u001f\u007f]/.test(s), 'control character');
const date = z.string().refine(isValidDate, 'date');
const payloadSchema = z.strictObject({
  v: z.literal(1),
  scope: z.strictObject({
    start: date, end: date, category: z.enum(['all', 'traffic', 'parking', 'other']),
    region_code: z.string().regex(/^\d{2}(\d{3})?$/).nullable(),
    agency_key: key.nullable(), manager_key: key.nullable(),
    law: z.string().max(200).refine((s) => isLawParam(s), 'law').nullable(),
  }),
  spec: z.strictObject({
    date_basis: z.enum(['completed_date', 'report_date']), population: z.enum(['all', 'mine', 'compare']),
    rows: z.array(id).max(3), columns: z.array(id).max(2), metrics: z.array(id).min(1).max(6),
    filters: z.array(z.strictObject({ dimension: id, members: z.array(key).min(1).max(SHARE_LIMITS.members) })).max(SHARE_LIMITS.filters),
  }),
  chart: z.strictObject({ type: z.enum(['auto', 'bar', 'hbar', 'line', 'stack', 'stack100', 'heatmap', 'scatter', 'summary']), primary: id.nullable(), overlay: z.boolean() }),
  view: z.enum(['table', 'chart']),
});
export type SharePayload = z.infer<typeof payloadSchema>;

/** what a recipe loses when it is shared (the sharer must confirm before a link is made) */
export function shareExclusions(r: StatsRecipe): { place: boolean; bbox: boolean; mine: boolean } {
  return { place: r.spec.place_key !== null, bbox: r.scope.bbox !== null, mine: r.spec.population !== 'all' };
}

export function toPayload(r: StatsRecipe, chart: ChartSettings, view: 'table' | 'chart'): SharePayload {
  const s = r.scope;
  return {
    v: 1,
    scope: { start: s.start, end: s.end, category: s.category, region_code: s.region_code, agency_key: s.agency_key, manager_key: s.manager_key, law: s.law },
    spec: { date_basis: r.spec.date_basis, population: r.spec.population, rows: [...r.spec.rows], columns: [...r.spec.columns], metrics: [...r.spec.metrics],
      filters: r.spec.filters.map((f) => ({ dimension: f.dimension, members: [...f.members] })) },
    chart: { type: chart.type, primary: chart.primary, overlay: chart.overlay },
    view,
  };
}

const b64url = (bytes: Uint8Array) => {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64url = (s: string) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

export type EncodeResult = { ok: true; url: string; chars: number } | { ok: false; reason: string };
/** the link (absolute, same page) or why it cannot be made — a too-long recipe is refused, never truncated */
export function shareUrl(payload: SharePayload, base: { origin: string; pathname: string }): EncodeResult {
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, reason: '공유할 수 없는 값이 들어 있어 링크를 만들지 못했습니다.' };
  const json = JSON.stringify(parsed.data);
  const bytes = new TextEncoder().encode(json);
  if (bytes.length > SHARE_LIMITS.jsonBytes) return { ok: false, reason: '설정이 너무 많아 링크를 만들 수 없습니다. 비교 대상을 줄여 주세요.' };
  const enc = b64url(bytes);
  if (enc.length > SHARE_LIMITS.encodedChars) return { ok: false, reason: '링크가 너무 길어집니다. 비교 대상을 줄여 주세요.' };
  const p = new URLSearchParams({ screen: 'statistics', [SHARE_PARAM]: enc });
  return { ok: true, url: `${base.origin}${base.pathname}?${p.toString()}`, chars: enc.length };
}

export type DecodeResult = { ok: true; payload: SharePayload } | { ok: false; reason: string };
/** size-checked decode + strict schema; catalog checks come after (checkAgainstCatalog) */
export function decodeShare(raw: string | null): DecodeResult {
  if (raw === null) return { ok: false, reason: '링크에 공유된 설정이 없습니다.' };
  if (raw.length === 0 || raw.length > SHARE_LIMITS.encodedChars) return { ok: false, reason: '링크가 너무 길거나 비어 있습니다. 받은 링크 전체를 복사했는지 확인해 주세요.' };
  if (!/^[A-Za-z0-9_-]+$/.test(raw)) return { ok: false, reason: '공유 링크의 형식이 올바르지 않습니다.' };
  let json: string;
  try {
    const bytes = fromB64url(raw);
    if (bytes.length > SHARE_LIMITS.jsonBytes) return { ok: false, reason: '링크에 담긴 설정이 너무 많습니다.' };
    json = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch { return { ok: false, reason: '공유 링크의 형식이 올바르지 않습니다.' }; }
  let data: unknown;
  try { data = JSON.parse(json); } catch { return { ok: false, reason: '공유 링크의 형식이 올바르지 않습니다.' }; }
  if (data && typeof data === 'object' && 'v' in data && (data as { v: unknown }).v !== 1) return { ok: false, reason: '이 사이트에서 열 수 없는 형식의 링크입니다.' };
  const parsed = payloadSchema.safeParse(data);
  if (!parsed.success) return { ok: false, reason: '링크에 이 사이트에서 쓰지 않는 값이 들어 있습니다.' };
  const s = parsed.data.scope;
  if (s.start > s.end) return { ok: false, reason: '링크의 기간이 올바르지 않습니다.' };
  if (s.region_code !== null && normalizeRegion(s.region_code) !== s.region_code) return { ok: false, reason: '링크의 지역을 알 수 없습니다.' };
  const sp = parsed.data.spec;
  const dims = [...sp.rows, ...sp.columns];
  if (new Set(dims).size !== dims.length || new Set(sp.metrics).size !== sp.metrics.length || new Set(sp.filters.map((f) => f.dimension)).size !== sp.filters.length) {
    return { ok: false, reason: '링크에 같은 항목이 두 번 들어 있습니다.' };
  }
  return { ok: true, payload: parsed.data };
}

/** the registry of THIS server decides: unknown ids / roles / limits are refused with the reason */
export function checkAgainstCatalog(p: SharePayload, catalog: StatCatalog): string | null {
  const dim = (x: string) => catalog.dimensions.find((d) => d.id === x);
  for (const r of p.spec.rows) if (!dim(r)?.roles.includes('row')) return '링크에 지금은 쓸 수 없는 행 항목이 있습니다.';
  for (const c of p.spec.columns) if (!dim(c)?.roles.includes('column')) return '링크에 지금은 쓸 수 없는 열 항목이 있습니다.';
  for (const m of p.spec.metrics) if (!catalog.metrics.some((x) => x.id === m)) return '링크에 지금은 쓸 수 없는 지표가 있습니다.';
  for (const f of p.spec.filters) if (!dim(f.dimension)?.roles.includes('filter')) return '링크에 지금은 쓸 수 없는 비교 대상이 있습니다.';
  if (p.spec.rows.length > catalog.limits.rows || p.spec.columns.length > catalog.limits.columns || p.spec.metrics.length > catalog.limits.metrics
    || p.spec.filters.length > catalog.limits.filters || p.spec.filters.some((f) => f.members.length > catalog.limits.members)) return '링크의 설정이 고를 수 있는 개수를 넘습니다.';
  if (p.chart.primary !== null && !p.spec.metrics.includes(p.chart.primary)) return '링크의 기준 지표가 지표 목록에 없습니다.';
  return null;
}

export function recipeFromPayload(p: SharePayload): { recipe: StatsRecipe; chart: ChartSettings; view: 'table' | 'chart' } {
  const scope: Scope = { ...p.scope, bbox: null };
  return {
    recipe: { scope, spec: baseSpec({ ...p.spec, place_key: null }), labels: {}, origin: '공유 링크' },
    chart: { ...p.chart }, view: p.view,
  };
}

/** remove the share parameter from the address bar (after the shared recipe ran, or when it is dismissed) */
export function dropShareParam(): void {
  try {
    const u = new URL(window.location.href);
    if (!u.searchParams.has(SHARE_PARAM)) return;
    u.searchParams.delete(SHARE_PARAM);
    window.history.replaceState(window.history.state, '', `${u.pathname}${u.search}${u.hash}`);
  } catch { /* ignore */ }
}
