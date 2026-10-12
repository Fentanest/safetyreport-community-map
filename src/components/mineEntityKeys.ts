import type { CompareEntityRow } from '../domain/personal';

export function mineEntityKeys(agencies: CompareEntityRow[] | null | undefined, managers: CompareEntityRow[] | null | undefined) {
  if (!agencies || !managers) return null;
  return { agency: new Set(agencies.map((r) => r.key)), manager: new Set(managers.map((r) => r.key)) };
}
