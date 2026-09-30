/**
 * One calculation for an agency/manager row (R2 metric boxes, R3 chart and its table). Same set, same definitions:
 *   C 답변 완료, A 수용, P 일부 수용, R 불수용, K = A+P+R 결과 확인, U = C−K 결과 미상,
 *   F 과태료 처분(disposition 'fine'), W 경고·계도 처분(disposition 'warning').
 *   수용률 A/K, 일부수용률 P/K, 불수용률 R/K, 과태료 부과율 F/C, 경고·계도 비율 W/C (×100).
 * A zero denominator, or a count the server does not provide (older server: undefined/null), is null — never 0.
 */
import type { PublicEntity, SameNameInfo } from '../domain/public';
import { managerLabel } from '../domain/managerNames';

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

/** Display name of an agency or manager row. A manager gets its short agency only when another identity of the scope
 *  has the same name (`same`: sameNameIndex in src/domain/managerNames.ts — never decided by the visible rows alone). */
export function entityLabel(e: Pick<PublicEntity, 'manager_name' | 'agency_name'>, kind: 'agency' | 'manager', same: SameNameInfo | null): string {
  return kind === 'agency' ? e.agency_name : managerLabel(e, same);
}
