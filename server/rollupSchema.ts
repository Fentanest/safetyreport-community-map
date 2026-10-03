/** Service-only aggregate transport. Public v2 DTOs and JavaScript namesake labels remain unchanged. */
import { z } from 'zod';
import type { RollupKind, RollupResult } from './rollups.ts';
import { computeSameNames } from '../src/domain/managerNames.ts';

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const nullable = z.number().finite().nullable();
const outcomes = z.strictObject({ accepted: count, partial: count, rejected: count, result_known: count, result_unknown: count });
const duration = z.strictObject({ count, median_days: nullable, mean_days: nullable });
const amount = z.strictObject({ fine_count: count, confirmed_count: count, sum_won: count.nullable(), mean_won: nullable });
const rating = z.strictObject({ count, mean: nullable });
const entity = z.strictObject({ key: z.string(), agency_key: z.string().nullable(), manager_key: z.string().nullable(),
  agency_name: z.string(), manager_name: z.string().nullable(), agency_type: z.enum(['police','non_police','unknown']),
  completed_count: count, outcomes, fine_count: count, warning_count: count, duration, fine_amount: amount, rating });
const law = z.strictObject({ law: z.string().nullable(), completed_count: count, outcomes,
  accept_rate: nullable, partial_rate: nullable, fine_count: count, fine_rate: nullable, penalty_count: count,
  warning_count: count, fine_amount: amount, rating });
const month = z.strictObject({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), report_count: count,
  completed_count: count, fine_count: count, outcomes, duration, fine_amount: amount, rating });
const names = z.array(z.strictObject({ key: z.string(), agency_name: z.string(), manager_name: z.string().nullable() }));
const envelope = z.strictObject({ items: z.array(z.unknown()), total_rows: count, names });
export function parseRollup(kind: RollupKind, value: unknown): RollupResult {
  const frame = envelope.parse(value);
  if (kind === 'series') return { ...frame, items: z.array(month).parse(frame.items) };
  if (kind === 'laws') return { ...frame, items: z.array(law).parse(frame.items) };
  const items = z.array(entity).parse(frame.items);
  const same = kind === 'manager' ? computeSameNames(frame.names) : null;
  return { total_rows: frame.total_rows, items: items.map(item => same ? { ...item, same_name: same.get(item.key) ?? null } : item) };
}
