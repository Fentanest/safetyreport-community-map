import type { PersonalCompare } from '../src/domain/personal.ts';
export interface ScreenSnapshots { public_at: string; personal_at: string | null; comparable: boolean }
/** Keep comparisons between independently dated observations, with both timestamps attached.
 * Never clamp mine to all; only the shared-place claim remains unknown. */
export function applySnapshotComparison<T extends PersonalCompare>(value: T, snapshots?: ScreenSnapshots): T {
  if (!snapshots) return value;
  if (!snapshots.personal_at || !Number.isFinite(Date.parse(snapshots.public_at)) || !Number.isFinite(Date.parse(snapshots.personal_at))) {
    throw new Error('invalid snapshot metadata');
  }
  const metadata = { ...snapshots, personal_at: snapshots.personal_at };
  // Shared places depend on unrelated contributors at the same address, so a personal cached flag
  // is never used in v2. A future dedicated live lookup may restore this indication.
  const my_points = value.my_points.map(p => ({ ...p, shared: null }));
  return { ...value, snapshots: metadata, my_points };
}
