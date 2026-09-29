/**
 * 맞춤 통계 client (S05–S08). Every response is validated (Zod) and checked against the request (scope, spec,
 * dataset version) before it reaches the page. Population 'all' goes to the public API; 'mine'/'compare' go to
 * my-analytics, where the viewer is the verified JWT user (no user id is ever sent).
 */
import { z } from 'zod';
import type { Scope } from '../domain/public';
import type { StatCandidatesPage, StatCatalog, StatisticsResult, StatisticsSpec, StatsFilter } from '../domain/statistics';
import { PublicApiError, read, sameScope, scopeParams } from './client';
import { readPersonalStatistics as readPersonal } from './personal';
import { scopeSchema } from './schema';

const count = z.number().int().nonnegative();
const value = z.strictObject({
  value: z.number().nullable(), numerator: z.number().nullable(), denominator: z.number().nullable(),
  reason: z.enum(['zero_denominator', 'no_data']).nullable(),
});
const keyList = z.array(z.string().max(200)).max(3);
const members = z.array(z.strictObject({ key: keyList, label: z.array(z.string().max(300)).max(3) })).max(5000);
const total = z.strictObject({ key: keyList, side: z.enum(['all', 'mine']), values: z.record(z.string(), value) });
const specSchema = z.strictObject({
  version: z.literal(1), date_basis: z.enum(['completed_date', 'report_date']), population: z.enum(['all', 'mine', 'compare']),
  rows: z.array(z.string()).max(3), columns: z.array(z.string()).max(2), metrics: z.array(z.string()).min(1).max(6),
  filters: z.array(z.strictObject({ dimension: z.string(), members: z.array(z.string()).min(1).max(50) })).max(8),
  place_key: z.string().nullable(),
});
export const statisticsResultSchema = z.strictObject({
  schema_version: z.literal(1), dataset_version: z.string(), scope: scopeSchema, spec: specSchema,
  row_members: members, col_members: members,
  cells: z.array(z.strictObject({ row: keyList, col: keyList, side: z.enum(['all', 'mine']), values: z.record(z.string(), value) })).max(10000),
  row_totals: z.array(total).max(10000), col_totals: z.array(total).max(10000), grand_totals: z.array(total).max(2),
  population_count: z.strictObject({ all: count.nullable(), mine: count.nullable() }),
  excluded: z.strictObject({ no_report_date: count }),
  filter_members: z.array(z.strictObject({ dimension: z.string(), key: z.string(), label: z.string().nullable(), count, status: z.enum(['ok', 'zero', 'unconfirmed']) })).max(400),
  complete: z.literal(true),
});
const candidate = z.strictObject({ key: z.string().max(200), label: z.string().max(300), sub: z.string().max(200).nullable(), count, status: z.enum(['ok', 'zero', 'unconfirmed']).optional() });
export const candidatesSchema = z.strictObject({
  dataset_version: z.string(), kind: z.string(), items: z.array(candidate).max(100), total: count,
  next_cursor: count.nullable(), selected: z.array(candidate).max(50),
});
export const catalogSchema = z.strictObject({
  dimensions: z.array(z.strictObject({
    id: z.string(), label: z.string(), group: z.string(), roles: z.array(z.enum(['row', 'column', 'filter'])),
    order: z.enum(['date', 'natural', 'count']), searchable: z.boolean(), description: z.string(),
  })).max(60),
  metrics: z.array(z.strictObject({
    id: z.string(), label: z.string(), unit: z.enum(['count', 'percent', 'won', 'days', 'score']), kind: z.enum(['count', 'rate', 'stat', 'distinct']),
    denominator: z.enum(['K', 'C', 'amount', 'duration', 'rating']).nullable(), description: z.string(),
  })).max(60),
  limits: z.strictObject({ rows: count, columns: count, metrics: count, filters: count, members: count, cells: count, specChars: count }),
});

const changed = () => new PublicApiError('통계가 방금 새로 바뀌었습니다. 다시 만들어 주세요.', 409, null, 'DATASET_CHANGED');

export async function loadCatalog(signal?: AbortSignal): Promise<StatCatalog> {
  if (import.meta.env.VITE_DATA_MODE === 'demo') { const { statisticsCatalog } = await import('../../server/statistics'); return statisticsCatalog(); }
  return catalogSchema.parse(await read('statistics/catalog', null, signal)) as StatCatalog;
}

export async function loadStatistics(scope: Scope, spec: StatisticsSpec, version: string | null, signal?: AbortSignal): Promise<StatisticsResult> {
  let raw: unknown;
  if (import.meta.env.VITE_DATA_MODE === 'demo') {
    const { demoStatistics } = await import('./demoEngine');
    raw = demoStatistics(scope, spec);
  } else {
    const params = scopeParams(scope, version ?? undefined, { spec: JSON.stringify(spec) });
    raw = spec.population === 'all' ? await read('statistics/query', params, signal) : await readPersonal(params, signal);
  }
  const result = statisticsResultSchema.parse(raw) as StatisticsResult;
  // the answer must be for exactly this request (a late or mismatched answer is never shown as this one)
  if ((version && result.dataset_version !== version) || !sameScope(result.scope, scope) || JSON.stringify(result.spec) !== JSON.stringify(spec)) throw changed();
  return result;
}

export async function loadCandidates(scope: Scope, q: { kind: string; q: string; cursor: number; limit: number; filters: StatsFilter[];
  basis: StatisticsSpec['date_basis']; placeKey: string | null; keys: string[] }, version: string | null, signal?: AbortSignal): Promise<StatCandidatesPage> {
  let raw: unknown;
  if (import.meta.env.VITE_DATA_MODE === 'demo') {
    const { demoCandidates } = await import('./demoEngine');
    raw = demoCandidates(scope, q);
  } else {
    const extra: Record<string, string> = { kind: q.kind, cursor: String(q.cursor), limit: String(q.limit), basis: q.basis };
    if (q.q.trim()) extra.q = q.q.trim();
    if (q.filters.length) extra.filters = JSON.stringify(q.filters);
    if (q.placeKey) extra.place_key = q.placeKey;
    if (q.keys.length) extra.keys = JSON.stringify(q.keys);
    raw = await read('statistics/candidates', scopeParams(scope, version ?? undefined, extra), signal);
  }
  const page = candidatesSchema.parse(raw) as StatCandidatesPage;
  if (version && page.dataset_version !== version) throw changed();
  return page;
}
