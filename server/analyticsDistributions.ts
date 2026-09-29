/**
 * New analytics A01–A04, A06 (docs/implementation/dashboard-redesign/IMPLEMENTATION_PROMPT.md §5).
 * Every function takes the completion-date cohort of ONE scope selection (`done`, already deduplicated by the
 * report-identity rules of the side it describes) and returns aggregate DTOs only: no report rows, plate text,
 * plate hashes or account ids ever leave this module. A05 (monthly outcome rates) uses the existing monthly rows.
 */
import type {
  DurationBucket, DurationDistribution, EntityScatter, HeatmapCell, HeatmapRow, LawHeatmap, OutcomeCounts,
  RatingDistribution, RatingRow, ScatterEntity, VehicleDayBucket, VehicleDayDistribution,
} from '../src/domain/public.ts';
import { lawKey } from '../src/domain/public.ts';
import { kstDate, outcomes, type PrivateFact } from './aggregate.ts';
import { durationOf, median, nearestRank } from './duration.ts';
import { parsePlate } from './plate.ts';

const pct = (n: number, d: number): number | null => (d > 0 ? (n * 100) / d : null);

/** A01: equal-width 7-day bins 0–6 … 77–83, then one explicitly open tail bin (84일 이상). */
export const DURATION_BUCKET_DAYS = 7;
export const DURATION_BUCKETS = 12;

export function durationDistribution(done: readonly PrivateFact[]): DurationDistribution {
  const days: number[] = [];
  let noReport = 0, reversed = 0;
  for (const fact of done) {
    const r = durationOf(fact);
    if ('days' in r) days.push(r.days);
    else if (r.reason === 'no_report_date') noReport++;
    else if (r.reason === 'reversed') reversed++;
  }
  days.sort((a, b) => a - b);
  const w = DURATION_BUCKET_DAYS;
  const counts = new Array<number>(DURATION_BUCKETS + 1).fill(0);
  for (const d of days) counts[Math.min(DURATION_BUCKETS, Math.floor(d / w))] += 1;
  const n = days.length;
  const buckets: DurationBucket[] = counts.map((count, i) => {
    const lower = i * w;
    const upper = i === DURATION_BUCKETS ? null : lower + w - 1;
    return { lower, upper, label: upper === null ? `${lower}일 이상` : `${lower}~${upper}일`, count, percentage: pct(count, n) };
  });
  return {
    basis: 'completed_date', bucket_width_days: w, buckets, valid_count: n,
    excluded: { no_report_date: noReport, reversed },
    median_days: median(days), mean_days: n ? days.reduce((a, b) => a + b, 0) / n : null, p90_days: nearestRank(days, 0.9),
  };
}

const agencyKeyOf = (f: PrivateFact) => f.agency_key || 'agency-unknown';
const managerKeyOf = (f: PrivateFact) => `${agencyKeyOf(f)}:${f.manager_key || 'manager-unknown'}`;
const agencyName = (f: PrivateFact) => f.agency_current_name || f.agency_name || '기관 정보 없음';

function groupBy<K>(facts: readonly PrivateFact[], keyOf: (f: PrivateFact) => K): Map<K, PrivateFact[]> {
  const map = new Map<K, PrivateFact[]>();
  for (const f of facts) {
    const k = keyOf(f);
    const list = map.get(k);
    if (list) list.push(f);
    else map.set(k, [f]);
  }
  return map;
}

export const HEATMAP_MAX_ROWS = 40;
export const HEATMAP_MAX_LAWS = 16;

/**
 * A02: real cross-tab. Rows are agencies, or the managers of the selected agency when `managerRows`.
 * Only the most-answered rows/laws are returned (bounded payload); totals say how many exist.
 */
export function lawHeatmap(allDone: readonly PrivateFact[], managerRows: boolean): LawHeatmap {
  // R4 (2026-09-30): the heatmap shows KNOWN laws only. 법규 미상 is excluded before choosing rows/laws, so it
  // never takes a top-N slot and a row with only unknown-law reports is not listed. Totals elsewhere are unchanged.
  const done = allDone.filter(f => lawKey(f.violation_law) !== null);
  const rowKey = managerRows ? managerKeyOf : agencyKeyOf;
  const rowsAll = [...groupBy(done, rowKey)].sort((a, b) => b[1].length - a[1].length || agencyName(a[1][0]).localeCompare(agencyName(b[1][0]), 'ko') || String(a[0]).localeCompare(String(b[0])));
  const lawOf = (f: PrivateFact) => lawKey(f.violation_law)!;
  const lawsAll = [...groupBy(done, lawOf)].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'ko'));
  const rowList = rowsAll.slice(0, HEATMAP_MAX_ROWS);
  const lawList = lawsAll.slice(0, HEATMAP_MAX_LAWS);
  const lawSet = new Set(lawList.map(([k]) => k));
  const rows: HeatmapRow[] = rowList.map(([key, facts]) => ({
    key, agency_key: facts[0].agency_key, manager_key: managerRows ? facts[0].manager_key : null,
    agency_name: agencyName(facts[0]), manager_name: managerRows ? facts[0].manager_name : null, completed_count: facts.length,
  }));
  const cells: HeatmapCell[] = [];
  for (const [key, facts] of rowList) {
    for (const [law, rows2] of groupBy(facts, lawOf)) {
      if (!lawSet.has(law)) continue;
      cells.push({ row_key: key, law_key: law, completed_count: rows2.length, outcomes: outcomes(rows2),
        fine_count: rows2.filter(f => f.disposition === 'fine').length });
    }
  }
  return {
    row_kind: managerRows ? 'manager' : 'agency', rows,
    laws: lawList.map(([law_key, facts]) => ({ law_key, completed_count: facts.length })),
    cells, total_rows: rowsAll.length, total_laws: lawsAll.length,
  };
}

export const SCATTER_MAX = 500;

function scatterRows(done: readonly PrivateFact[], kind: 'agency' | 'manager'): ScatterEntity[] {
  const keyOf = kind === 'agency' ? agencyKeyOf : managerKeyOf;
  return [...groupBy(done, keyOf)].map(([key, facts]) => {
    const days = facts.map(durationOf).flatMap(r => ('days' in r ? [r.days] : [])).sort((a, b) => a - b);
    const o: OutcomeCounts = outcomes(facts);
    return {
      key, agency_key: facts[0].agency_key, manager_key: kind === 'manager' ? facts[0].manager_key : null,
      agency_name: agencyName(facts[0]), manager_name: kind === 'manager' ? facts[0].manager_name : null,
      completed_count: facts.length, duration_count: days.length, median_days: median(days), outcomes: o,
      fine_count: facts.filter(f => f.disposition === 'fine').length,
    };
  }).sort((a, b) => b.completed_count - a.completed_count || a.agency_name.localeCompare(b.agency_name, 'ko') || a.key.localeCompare(b.key));
}

/** A03: every agency/manager of the cohort (bounded to SCATTER_MAX each; totals report the full count). */
export function entityScatter(done: readonly PrivateFact[]): EntityScatter {
  const agencies = scatterRows(done, 'agency'), managers = scatterRows(done, 'manager');
  return { agencies: agencies.slice(0, SCATTER_MAX), managers: managers.slice(0, SCATTER_MAX),
    agency_total: agencies.length, manager_total: managers.length };
}

/** A04 buckets of distinct report days per vehicle. */
export const VEHICLE_DAY_BUCKETS: ReadonlyArray<{ label: string; min: number; max: number | null }> = [
  { label: '1일', min: 1, max: 1 }, { label: '2일', min: 2, max: 2 }, { label: '3~4일', min: 3, max: 4 }, { label: '5일 이상', min: 5, max: null },
];

/** A04: distinct report days per parsed plate (server-only identity). Undated reports never become "1일". */
export function vehicleDayDistribution(done: readonly PrivateFact[]): VehicleDayDistribution {
  let noPlate = 0, noDate = 0;
  const days = new Map<string, Set<string>>();
  for (const fact of done) {
    const plate = parsePlate(fact.vehicle_raw);
    if (!plate) { noPlate++; continue; }
    const day = kstDate(fact.report_date);
    if (day === null) { noDate++; continue; }
    let set = days.get(plate.canonical);
    if (!set) days.set(plate.canonical, set = new Set());
    set.add(day);
  }
  const vehicleCount = days.size;
  const counts = VEHICLE_DAY_BUCKETS.map(() => 0);
  for (const set of days.values()) {
    const n = set.size;
    const i = VEHICLE_DAY_BUCKETS.findIndex(b => n >= b.min && (b.max === null || n <= b.max));
    counts[i] += 1;
  }
  const buckets: VehicleDayBucket[] = VEHICLE_DAY_BUCKETS.map((b, i) => ({ ...b, vehicle_count: counts[i], percentage: pct(counts[i], vehicleCount) }));
  const repeat = vehicleCount - counts[0];
  return { basis: 'completed_date', buckets, vehicle_count: vehicleCount, repeat_vehicle_count: repeat,
    repeat_share: pct(repeat, vehicleCount), excluded: { no_plate: noPlate, no_report_date: noDate } };
}

const validRating = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 5;

function ratingRow(status: RatingRow['status'], facts: readonly PrivateFact[]): RatingRow {
  const counts: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  let sum = 0, n = 0;
  for (const f of facts) {
    if (!validRating(f.rating)) continue;
    counts[f.rating - 1] += 1;
    sum += f.rating;
    n += 1;
  }
  return { status, counts, rating_count: n, mean: n ? sum / n : null };
}

/** A06: numeric ratings disclosed by consent only (1..5); unrated/undisclosed/out-of-range are never 0점.
 *  Rows are keyed by `status`: outcome rows (accepted/partial/rejected/unknown) partition the cohort; 'fine'
 *  (disposition = 과태료 처분) is a separate, overlapping cut — never added to the outcome rows. */
export function ratingDistribution(done: readonly PrivateFact[]): RatingDistribution {
  const by = (s: string) => done.filter(f => f.status === s);
  const unknown = done.filter(f => f.status !== 'accepted' && f.status !== 'partial' && f.status !== 'rejected');
  const rows = [ratingRow('all', done), ratingRow('accepted', by('accepted')), ratingRow('partial', by('partial')),
    ratingRow('rejected', by('rejected')), ratingRow('fine', done.filter(f => f.disposition === 'fine')), ratingRow('unknown', unknown)];
  return { basis: 'completed_date', rows, unrated: done.length - rows[0].rating_count };
}
