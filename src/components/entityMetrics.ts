/**
 * One calculation for an agency/manager row (R2 metric boxes, R3 chart and its table). Same set, same definitions:
 *   C 답변 완료, A 수용, P 일부 수용, R 불수용, K = A+P+R 결과 확인, U = C−K 결과 미상,
 *   F 과태료 처분(disposition 'fine'), W 경고·계도 처분(disposition 'warning').
 *   수용률 A/K, 일부수용률 P/K, 불수용률 R/K, 과태료처분율 F/C, 계도처분율 W/C (×100).
 * A zero denominator, or a count the server does not provide (older server: undefined/null), is null — never 0.
 */
import type { PublicEntity } from '../domain/public';

export interface EntityRates {
  C: number;
  A: number;
  P: number;
  R: number;
  K: number;
  U: number;
  /** null = not provided by the server */
  F: number | null;
  W: number | null;
  accept: number | null;
  partial: number | null;
  reject: number | null;
  fineRate: number | null;
  warnRate: number | null;
}

const rate = (n: number | null, d: number): number | null => (n === null || d <= 0 ? null : (n / d) * 100);

export function entityRates(e: Pick<PublicEntity, 'completed_count' | 'outcomes' | 'fine_count' | 'warning_count'>): EntityRates {
  const C = e.completed_count;
  const { accepted: A, partial: P, rejected: R, result_known: K } = e.outcomes;
  const F = e.fine_count ?? null;
  const W = e.warning_count ?? null;
  return { C, A, P, R, K, U: Math.max(0, C - K), F, W,
    accept: rate(A, K), partial: rate(P, K), reject: rate(R, K), fineRate: rate(F, C), warnRate: rate(W, C) };
}

/** Display name of a manager; people with the same name are told apart by their agency. */
export function entityLabel(e: Pick<PublicEntity, 'manager_name' | 'agency_name'>, kind: 'agency' | 'manager', duplicate: boolean): string {
  if (kind === 'agency') return e.agency_name;
  const name = e.manager_name ?? '이름 없음';
  return duplicate ? `${name} (${e.agency_name})` : name;
}

/** Names that occur more than once among the rows (same name, different agency). */
export function duplicateNames(rows: ReadonlyArray<Pick<PublicEntity, 'manager_name'>>): Set<string> {
  const seen = new Map<string, number>();
  for (const r of rows) { const k = r.manager_name ?? '이름 없음'; seen.set(k, (seen.get(k) ?? 0) + 1); }
  return new Set([...seen].filter(([, n]) => n > 1).map(([k]) => k));
}
