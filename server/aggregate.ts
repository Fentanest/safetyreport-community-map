/** Exact private-fact aggregation. This module must run behind the public API only. */
import type {
  BasisBounds, Category, CohortDiagnostics, CountMetric, DashboardAnalytics, DashboardData, DateBasis, MonthlyBucket,
  OutcomeCounts, Overview, PublicEntity, PublicLaw, PublicMeta, PublicPoint, PublicRegion, Scope,
} from '../src/domain/public.ts';
import { COHORT_POLICY_VERSION, LAW_NONE, lawKey } from '../src/domain/public.ts';
import { computeSameNames } from '../src/domain/managerNames.ts';
import { maskPlate, parsePlate } from './plate.ts';
import { answerDateMissing, durationBrief, durationSummary } from './duration.ts';
import { fineAmountBrief, fineAmountSummary } from './amount.ts';
import { regionMatches, regionName, resolveRegion, type RegionRef } from './regions.ts';
import { agencyTypeOf } from './agencyType.ts';
import { distinctPlaces, placeKey, placeRows } from './places.ts';
import { durationDistribution, entityScatter, lawHeatmap, ratingDistribution, vehicleDayDistribution } from './analyticsDistributions.ts';

export type Status = 'accepted' | 'partial' | 'rejected' | 'processing' | 'supplement' |
  'withdrawn' | 'transferred' | 'completed_unknown' | 'other';
export type Disposition = 'fine' | 'warning' | 'penalty' | 'none' | 'unknown';

export interface PrivateFact {
  fact_identity: string;
  contributor_id: string;
  snapshot_id: string;
  snapshot_generation: number;
  report_date: string | null;
  completed_date: string | null;
  category: Exclude<Category, 'all'>;
  status: Status;
  disposition: Disposition;
  vehicle_raw: string | null;
  point_key: string | null;
  lat: number | null;   // community ingest keeps facts without coordinates (statistics only, never a map point)
  lng: number | null;
  address: string | null;
  region_code: string | null;
  agency_key: string | null;
  agency_name: string | null;
  /** 현행 기관 표시명(확인된 1:1 승계만, ingest 확정값). null 이면 agency_name 원문을 쓴다. */
  agency_current_name?: string | null;
  manager_key: string | null;
  manager_name: string | null;
  /** 답변에 적힌 금액의 종류(community ingest). Legacy/snapshot sources omit these fields. */
  amount_kind?: 'fine' | 'penalty' | 'combined' | 'unknown' | null;
  /** exact won, only when the fact's consent policy publishes amounts (otherwise null from the RPC) */
  amount_confirmed_won?: number | null;
  /** the fact's consent policy publishes answered amounts (private.community_policy_disclosures) */
  amount_public?: boolean;
  /** the answer stated an amount (existence only) */
  amount_stated?: boolean;
  /** 위반법규 (observation-v2), only when the fact's consent policy publishes it; null/absent = 법규 미상 */
  violation_law?: string | null;
  /** 1..5 numeric satisfaction rating, null when absent or not disclosed by consent. */
  rating?: number | null;
/** true for the single publicly-counted row of an identity (same report shared by several accounts).
 *  Absent on legacy rows — treated as true. Personal scope still receives every listed row. */
  is_representative?: boolean | null;
  /** listed contribution rows for the same identity (accounts), representative row carries the total */
  contribution_count?: number | null;
  /** identity without the dataset part (same report from PC·mobile·restores shares it) */
  source_report_key?: string | null;
  /** report identity: source_report_key + authoritative report_number grouping (2026-09-28).
   *  Both numbers present and different → separate identities; a missing number joins the
   *  key's first numbered group, else the legacy group. Absent on legacy rows. */
  report_identity?: string | null;
  /** the representative contribution's authoritative report number (null = legacy) */
  report_number?: string | null;
  /** when this contribution row was first stored (elects the per-account representative) */
  first_accepted_at?: string | null;
  /** the identity representative's dates (SQL single-date-v1): membership in a period uses the representative
   *  elected BEFORE any date condition, so every row of one identity belongs to the same periods */
  identity_report_date?: string | null;
  identity_completed_date?: string | null;
}

const terminal = new Set<Status>(['accepted', 'partial', 'rejected', 'withdrawn', 'transferred', 'completed_unknown']);
const KST = 'Asia/Seoul';
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export function kstDate(value: string | null): string | null {
  if (value == null) return null;
  if (datePattern.test(value)) {
    dayNumber(value);
    return value;
  }
  if (!/[zZ]|[+-]\d{2}:\d{2}$/.test(value)) throw new Error('timestamp requires timezone');
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) throw new Error('invalid timestamp');
  return new Intl.DateTimeFormat('sv-SE', { timeZone: KST, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
}

function dayNumber(day: string): number {
  const value = Date.parse(`${day}T00:00:00Z`);
  if (!datePattern.test(day) || Number.isNaN(value) || new Date(value).toISOString().slice(0, 10) !== day) throw new Error('invalid ISO day');
  return value / 86400000;
}

export function previousWindow(start: string, end: string): { start: string; end: string } {
  const first = dayNumber(start), last = dayNumber(end);
  if (last < first) throw new Error('reversed date range');
  const length = last - first + 1;
  const iso = (n: number) => new Date(n * 86400000).toISOString().slice(0, 10);
  return { start: iso(first - length), end: iso(first - 1) };
}

function inRange(day: string | null, start: string, end: string): boolean {
  const normalized = kstDate(day);
  return normalized !== null && normalized >= start && normalized <= end;
}

function activeFacts(facts: readonly PrivateFact[]): PrivateFact[] {
  const selected = new Map<string, { generation: number; snapshot: string }>();
  for (const fact of facts) {
    const old = selected.get(fact.contributor_id);
    if (!old || fact.snapshot_generation > old.generation ||
      (fact.snapshot_generation === old.generation && fact.snapshot_id > old.snapshot)) {
      selected.set(fact.contributor_id, { generation: fact.snapshot_generation, snapshot: fact.snapshot_id });
    }
  }
  const latest = new Map<string, PrivateFact>();
  for (const fact of facts) {
    const current = selected.get(fact.contributor_id);
    if (!current || fact.snapshot_generation !== current.generation || fact.snapshot_id !== current.snapshot) continue;
    const key = `${fact.contributor_id}\u0000${fact.fact_identity}`;
    if (!latest.has(key)) latest.set(key, fact);
  }
  return [...latest.values()];
}

/** Global scope counts each shared identity once: only the representative row elected by
 *  internal_analytics_v2_facts (earliest contribution among publicly-listed rows). Rows without
 *  the flag (legacy snapshots) count as before. Personal (mine) counts filter the full input. */
export function representatives(facts: readonly PrivateFact[]): PrivateFact[] {
  return facts.filter(fact => fact.is_representative !== false);
}

/** One row per identity: the same account's PC·mobile·second-dataset·restored rows collapse to the
 *  earliest contribution. Legacy rows without identity fields collapse by fact_identity. */
export function ownRepresentatives(facts: readonly PrivateFact[]): PrivateFact[] {
  const best = new Map<string, PrivateFact>();
  for (const fact of facts) {
    const key = `${fact.contributor_id}\u0000${fact.report_identity ?? fact.source_report_key ?? fact.fact_identity}`;
    const old = best.get(key);
    // earliest contribution wins; a dated row beats an undated one; ties keep input order
    if (!old) best.set(key, fact);
    else {
      const next = fact.first_accepted_at ?? null, current = old.first_accepted_at ?? null;
      if (next !== null && (current === null || next < current)) best.set(key, fact);
    }
  }
  return [...best.values()];
}

function dimensions(fact: PrivateFact, scope: Scope): boolean {
  if (scope.category !== 'all' && fact.category !== scope.category) return false;
  if (scope.region_code && !regionMatches(regionOf(fact), scope.region_code)) return false;
  if (scope.agency_key && fact.agency_key !== scope.agency_key) return false;
  if (scope.manager_key && fact.manager_key !== scope.manager_key) return false;
  if (scope.law) {
    // 조 단위 key on both sides (a parameter with a paragraph selects its article)
    const law = lawKey(fact.violation_law);
    if (scope.law === LAW_NONE ? law !== null : law !== lawKey(scope.law)) return false;
  }
  if (scope.bbox) {
    const [minLng, minLat, maxLng, maxLat] = scope.bbox;
    if (fact.lat === null || fact.lng === null) return false;  // a viewport filter can only keep located facts
    if (fact.lng < minLng || fact.lng > maxLng || fact.lat < minLat || fact.lat > maxLat) return false;
  }
  return true;
}

/** answered (terminal status) with a completion date. Kept for callers that need a dated answer; the cohort
 *  itself never uses it (an officially completed report without an answer date stays in a report-date cohort). */
export function answered(fact: PrivateFact): boolean {
  return terminal.has(fact.status) && kstDate(fact.completed_date) !== null;
}

/** 답변 완료로 확인된 신고 (C): the status decides, independent of whether the answer date is known (U01 1.1). */
export function isCompleted(fact: PrivateFact): boolean {
  return terminal.has(fact.status);
}

/** report identity (legacy rows: the fact identity) */
export const identityOf = (fact: PrivateFact): string => fact.report_identity ?? fact.source_report_key ?? fact.fact_identity;

/**
 * The cohort date of a row on a basis: the identity representative's date (so a co-contributor's older copy
 * never moves the identity into another period), from the SQL projection when present, else from the
 * representative row found in the same input, else the row itself (legacy rows without identity fields).
 */
export function cohortDateOf(input: readonly PrivateFact[], basis: DateBasis): (fact: PrivateFact) => string | null {
  const reps = new Map<string, PrivateFact>();
  for (const fact of input) {
    if (fact.is_representative === true && fact.report_identity && !reps.has(fact.report_identity)) reps.set(fact.report_identity, fact);
  }
  const projected = basis === 'report_date' ? 'identity_report_date' : 'identity_completed_date';
  return (fact) => {
    if (fact[projected] !== undefined) return kstDate(fact[projected] ?? null);
    const rep = fact.report_identity ? reps.get(fact.report_identity) ?? fact : fact;
    return kstDate(rep[basis]);
  };
}

const otherBasis = (basis: DateBasis): DateBasis => basis === 'report_date' ? 'completed_date' : 'report_date';

/** S05: the scope's non-date filters (category, region, agency, manager, law, bbox) over the active facts */
export function scopeFacts(input: readonly PrivateFact[], scope: Scope): PrivateFact[] {
  return activeFacts(input).filter(fact => dimensions(fact, scope));
}

export function inDateRange(day: string | null, start: string, end: string): boolean {
  return inRange(day, start, end);
}

export function outcomes(facts: readonly PrivateFact[]): OutcomeCounts {
  let accepted = 0, partial = 0, rejected = 0;
  for (const fact of facts) {
    if (fact.status === 'accepted') accepted++;
    else if (fact.status === 'partial') partial++;
    else if (fact.status === 'rejected') rejected++;
  }
  const result_known = accepted + partial + rejected;
  return { accepted, partial, rejected, result_known, result_unknown: facts.length - result_known };
}

export function ratingSummary(facts: readonly PrivateFact[]): { count: number; mean: number | null } {
  const values = facts.map(fact => fact.rating).filter((n): n is number =>
    typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 5);
  return { count: values.length, mean: values.length ? values.reduce((sum, n) => sum + n, 0) / values.length : null };
}

export function growth(current: number, previous: number) {
  if (previous === 0) return { delta: current, delta_percent: null, delta_reason: current > 0 ? 'new' as const : 'no_baseline' as const };
  return { delta: current - previous, delta_percent: (current - previous) * 100 / previous, delta_reason: null };
}

function countMetric(value: number, basis: DateBasis, previous: number | null, missing = 0, denominator: number | null = null): CountMetric {
  return { value, basis, denominator, eligible: value, missing, previous,
    ...(previous === null ? { delta: null, delta_percent: null, delta_reason: null, note: '비교기간 자료 없음' } : growth(value, previous)) };
}

export function monthKeys(start: string, end: string): string[] {
  const first = new Date(`${start.slice(0, 7)}-01T00:00:00Z`);
  const last = end.slice(0, 7);
  const months: string[] = [];
  while (first.toISOString().slice(0, 7) <= last) {
    months.push(first.toISOString().slice(0, 7));
    first.setUTCMonth(first.getUTCMonth() + 1);
  }
  return months;
}

export function entityRows(facts: readonly PrivateFact[], kind: 'agency' | 'manager'): PublicEntity[] {
  const rows = entityRowsOnly(facts, kind);
  if (kind === 'agency') return rows;
  // 동명이인 over the FULL list of this selection, before any page/search/type slice (src/domain/managerNames.ts)
  const same = computeSameNames(rows);
  return rows.map(row => ({ ...row, same_name: same.get(row.key) ?? null }));
}

function entityRowsOnly(facts: readonly PrivateFact[], kind: 'agency' | 'manager'): PublicEntity[] {
  const groups = new Map<string, PrivateFact[]>();
  for (const fact of facts) {
    const key = kind === 'agency' ? (fact.agency_key || 'agency-unknown') :
      `${fact.agency_key || 'agency-unknown'}:${fact.manager_key || 'manager-unknown'}`;
    const existing = groups.get(key) || [];
    existing.push(fact);
    groups.set(key, existing);
  }
  return [...groups].map(([key, rows]) => ({
    key, agency_key: rows[0].agency_key, manager_key: kind === 'manager' ? rows[0].manager_key : null,
    agency_name: rows[0].agency_current_name || rows[0].agency_name || '기관 정보 없음',
    manager_name: kind === 'manager' ? rows[0].manager_name : null,
    agency_type: agencyTypeOf(rows[0].agency_key, rows[0].agency_current_name || rows[0].agency_name),
    completed_count: rows.length, outcomes: outcomes(rows),
    fine_count: rows.filter(row => row.disposition === 'fine').length,
    warning_count: rows.filter(row => row.disposition === 'warning').length,
    duration: durationBrief(rows), fine_amount: fineAmountBrief(rows), rating: ratingSummary(rows),
  })).sort((a, b) => b.completed_count - a.completed_count || a.agency_name.localeCompare(b.agency_name, 'ko'));
}

/** 위반법규별 현황 (docs/metrics-catalog.md law_results): one row per article key (lawKey, 항 dropped) plus one 법규 미상 row, each
 *  computed from the completion-date cohort's raw facts. Sorted by C desc, then law (법규 미상 last on ties). */
export function lawRows(done: readonly PrivateFact[]): PublicLaw[] {
  const groups = new Map<string | null, PrivateFact[]>();
  for (const fact of done) {
    const law = lawKey(fact.violation_law);  // 조 단위: the stored text (with 항) never leaves as a row name
    const rows = groups.get(law);
    if (rows) rows.push(fact);
    else groups.set(law, [fact]);
  }
  return [...groups].map(([law, rows]) => {
    const result = outcomes(rows);
    const fine = rows.filter(row => row.disposition === 'fine').length;
    return {
      law, completed_count: rows.length, outcomes: result,
      accept_rate: result.result_known ? result.accepted * 100 / result.result_known : null,
      partial_rate: result.result_known ? result.partial * 100 / result.result_known : null,
      fine_count: fine, fine_rate: rows.length ? fine * 100 / rows.length : null,
      penalty_count: rows.filter(row => row.disposition === 'penalty').length,
      warning_count: rows.filter(row => row.disposition === 'warning').length,
      fine_amount: fineAmountBrief(rows), rating: ratingSummary(rows),
    };
  }).sort((a, b) => b.completed_count - a.completed_count ||
    (a.law === null ? 1 : 0) - (b.law === null ? 1 : 0) || (a.law ?? '').localeCompare(b.law ?? '', 'ko'));
}

export type LocatedFact = PrivateFact & { point_key: string; lat: number; lng: number };
export const located = (fact: PrivateFact): fact is LocatedFact => fact.point_key !== null && fact.lat !== null && fact.lng !== null;

const regionCache = new WeakMap<PrivateFact, RegionRef | null>();
/** Official region of a fact (cached per fact object). */
export function regionOf(fact: PrivateFact): RegionRef | null {
  let ref = regionCache.get(fact);
  if (ref === undefined) {
    ref = resolveRegion(fact.region_code, fact.lat, fact.lng);
    regionCache.set(fact, ref);
  }
  return ref;
}

/** Group key of a fact at each level (unknown when the region cannot be resolved). */
export function regionKeys(fact: PrivateFact): { sido: string | null; sgg: string | null } {
  const ref = regionOf(fact);
  return { sido: ref?.sido ?? null, sgg: ref?.sgg ?? null };
}

/** Region rows at both levels, each computed from raw facts (never by adding or averaging child rows).
 *  Report counts use the report date; completion/outcome/fine/duration/amount use the completion date. */
export function regionRows(reported: readonly PrivateFact[], done: readonly PrivateFact[]): PublicRegion[] {
  const rows = new Map<string, { level: PublicRegion['level']; code: string | null; sido: string | null; reported: number; done: PrivateFact[] }>();
  const row = (level: PublicRegion['level'], code: string | null, sido: string | null) => {
    const key = `${level}:${code ?? ''}`;
    let current = rows.get(key);
    if (!current) rows.set(key, current = { level, code, sido, reported: 0, done: [] });
    return current;
  };
  const add = (fact: PrivateFact, apply: (r: { reported: number; done: PrivateFact[] }) => void) => {
    const k = regionKeys(fact);
    if (!k.sgg) { apply(row('unknown', null, null)); return; }
    apply(row('sido', k.sido, null));
    apply(row('sgg', k.sgg, k.sido));
  };
  for (const fact of reported) add(fact, r => { r.reported++; });
  for (const fact of done) add(fact, r => { r.done.push(fact); });
  const order = { sido: 0, sgg: 1, unknown: 2 } as const;
  return [...rows.values()].map(r => ({
    level: r.level, region_code: r.code, name: r.code ? regionName(r.code) ?? r.code : '지역 미확인', sido_code: r.sido,
    report_count: r.reported, completed_count: r.done.length,
    outcomes: outcomes(r.done), fine_count: r.done.filter(fact => fact.disposition === 'fine').length,
    duration: durationBrief(r.done), fine_amount: fineAmountBrief(r.done), rating: ratingSummary(r.done),
  })).sort((a, b) => order[a.level] - order[b.level] || b.report_count - a.report_count ||
    b.completed_count - a.completed_count || (a.region_code ?? '').localeCompare(b.region_code ?? ''));
}

/** Legacy exact-coordinate points (grouping by point_key). Kept for callers that still need the pre-address
 *  grouping; the dashboard map uses address places (server/places.ts, grouping_version address-v1). */
export function pointRows(reportedAll: readonly PrivateFact[], doneAll: readonly PrivateFact[]): PublicPoint[] {
  const reported = reportedAll.filter(located), done = doneAll.filter(located);
  const reports = new Map<string, LocatedFact[]>();
  const completions = new Map<string, LocatedFact[]>();
  for (const fact of reported) reports.set(fact.point_key, [...(reports.get(fact.point_key) || []), fact]);
  for (const fact of done) completions.set(fact.point_key, [...(completions.get(fact.point_key) || []), fact]);
  const keys = new Set([...reports.keys(), ...completions.keys()]);
  return [...keys].map((key) => {
    const rows = reports.get(key) || [];
    const finished = completions.get(key) || [];
    const anchor = rows[0] || finished[0];
    return { key, lat: anchor.lat, lng: anchor.lng, address: anchor.address,
      region_code: regionKeys(anchor).sgg, report_count: rows.length, completed_count: finished.length,
      outcomes: outcomes(finished), fine_count: finished.filter(row => row.disposition === 'fine').length,
      warning_count: finished.filter(row => row.disposition === 'warning').length };
  }).sort((a, b) => b.report_count - a.report_count || b.completed_count - a.completed_count || a.key.localeCompare(b.key));
}

export const MAP_NODE_LIMIT = 1000;

/**
 * Server-side compaction when a range has more than MAP_NODE_LIMIT places: places of one grid cell merge into an
 * aggregate node. Every count of a node is the SUM of its members (so any rate derived from it is Σnumerator /
 * Σdenominator — never an average of member rates); point_count is the number of member places.
 */
export function mapNodes(exact: readonly PublicPoint[], limit = MAP_NODE_LIMIT): PublicPoint[] {
  if (exact.length <= limit) return [...exact];
  let cell = 0.04;
  let groups = new Map<string, PublicPoint[]>();
  for (;;) {
    groups = new Map();
    for (const point of exact) {
      const cellKey = `${Math.floor((point.lat - 32) / cell)}:${Math.floor((point.lng - 124) / cell)}`;
      const group = groups.get(cellKey);
      if (group) group.push(point);
      else groups.set(cellKey, [point]);
    }
    if (groups.size <= limit) break;
    cell *= 2;
  }
  return [...groups].map(([cellKey, rows]) => {
    if (rows.length === 1) return rows[0];
    const sum = (pick: (point: PublicPoint) => number) => rows.reduce((n, row) => n + pick(row), 0);
    const reportCount = sum(row => row.report_count);
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    for (const row of rows) {
      minLng = Math.min(minLng, row.lng); minLat = Math.min(minLat, row.lat);
      maxLng = Math.max(maxLng, row.lng); maxLat = Math.max(maxLat, row.lat);
    }
    const allOutcomes = rows.map(row => row.outcomes);
    const result = allOutcomes.every(row => row !== null) ? {
      accepted: sum(row => row.outcomes!.accepted), partial: sum(row => row.outcomes!.partial),
      rejected: sum(row => row.outcomes!.rejected), result_known: sum(row => row.outcomes!.result_known),
      result_unknown: sum(row => row.outcomes!.result_unknown),
    } : null;
    const warnings = rows.every(row => typeof row.warning_count === 'number') ? sum(row => row.warning_count!) : null;
    return {
      key: `cluster:${cell}:${cellKey}`,
      // SOL-06: completion-only points carry report_count 0, so a cluster of those would divide by
      // zero with report weighting; fall back to the plain centroid then (display only, totals unchanged).
      lat: reportCount > 0 ? sum(row => row.lat * row.report_count) / reportCount :
        rows.reduce((n, row) => n + row.lat, 0) / rows.length,
      lng: reportCount > 0 ? sum(row => row.lng * row.report_count) / reportCount :
        rows.reduce((n, row) => n + row.lng, 0) / rows.length,
      aggregate: true, point_count: sum(row => row.point_count ?? 1),
      bbox: [minLng, minLat, maxLng, maxLat] as [number, number, number, number],
      address: null,
      region_code: rows.every(row => row.region_code === rows[0].region_code) ? rows[0].region_code : null,
      report_count: reportCount,
      completed_count: rows.every(row => row.completed_count !== null) ? sum(row => row.completed_count!) : null,
      outcomes: result,
      fine_count: rows.every(row => row.fine_count !== null) ? sum(row => row.fine_count!) : null,
      warning_count: warnings,
    };
  }).sort((a, b) => b.report_count - a.report_count || a.key.localeCompare(b.key));
}

function vehicleRows(reported: readonly PrivateFact[]) {
  const counts = new Map<string, { raw: string; count: number }>();
  for (const fact of reported) {
    const plate = parsePlate(fact.vehicle_raw);
    if (!plate) continue;
    const current = counts.get(plate.canonical);
    counts.set(plate.canonical, { raw: fact.vehicle_raw!, count: (current?.count || 0) + 1 });
  }
  const all = [...counts].sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]));
  return { identifiable: all.reduce((n, [, row]) => n + row.count, 0),
    items: all.slice(0, 5).map(([, row], index) => ({ rank: index + 1, rank_item_id: `r${index + 1}`,
      masked_plate: maskPlate(row.raw), report_count: row.count,
      percentage: reported.length === 0 ? null : row.count * 100 / reported.length })) };
}

export interface AggregateOptions {
  datasetVersion: string;
  sourceUpdatedAt: string | null;
  generatedAt: string;
  /** latest data day (whole history); used when the per-basis bounds are unknown */
  asOf: string;
  sample: boolean;
  dataMin?: string | null;
  /** 전체 기간 of each basis (internal_analytics_cohort_state); null = unknown (old state RPC) */
  basisBounds?: BasisBounds | null;
  /** KST calendar day of "now" (injectable for tests); defaults to the real clock */
  today?: string;
}

/** KST calendar day of an instant (default: now). */
export function todayKst(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: KST, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function monthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** Data window of the selected basis: the basis bounds when known, else the combined history bounds. */
export function basisWindow(basis: DateBasis, options: Pick<AggregateOptions, 'basisBounds' | 'dataMin' | 'asOf'>): { min: string | null; max: string | null } {
  const b = options.basisBounds?.[basis];
  if (b && (b.min !== null || b.max !== null)) return { min: b.min, max: b.max };
  return { min: options.dataMin ?? null, max: options.asOf ?? null };
}

/**
 * Calendar spine of the selected range (D12/D17): every month appears, with its covered interval. Months the data
 * cannot cover are `no_data` (null values); a month with data coverage and no report is a real 0.
 */
export function monthSpine(scope: Pick<Scope, 'start' | 'end'>, window: { min: string | null; max: string | null }, today: string) {
  return monthKeys(scope.start, scope.end).map(month => {
    const first = `${month}-01`, last = monthEnd(month);
    const intervalStart = scope.start > first ? scope.start : first, intervalEnd = scope.end < last ? scope.end : last;
    const noData = (window.max !== null && month > window.max.slice(0, 7)) ? '데이터 제공 종료 이후' :
      (window.min !== null && month < window.min.slice(0, 7)) ? '데이터 제공 시작 전' : null;
    const note = noData ?? (window.min && month === window.min.slice(0, 7) && window.min > first ? `자료 시작 월(${window.min.slice(5).replace('-', '.')}부터)` :
      window.max && month === window.max.slice(0, 7) && window.max < intervalEnd ? `자료 마지막 월(${window.max.slice(5).replace('-', '.')}까지)` : null);
    return { month, interval_start: intervalStart, interval_end: intervalEnd,
      range_partial: intervalStart !== first || intervalEnd !== last, in_progress: month === today.slice(0, 7),
      no_data: noData !== null, coverage_note: note };
  });
}

/**
 * One scope selection shared by the public dashboard, the place focus, the personal comparison and 맞춤 통계
 * (single-date-v1). ONE date — scope.date_basis of the identity representative — decides membership; the other
 * date never filters. `reported` is the cohort N (kept under its old name for the row builders) and `done` its
 * completed part C (status only: a completed report without an answer date stays in a report-date cohort).
 */
export interface ScopeSelection {
  basis: DateBasis;
  range: { start: string; end: string };
  prev: { start: string; end: string };
  /** active facts after the non-date filters */
  facts: PrivateFact[];
  /** the cohort N (same array as `reported`) */
  cohort: PrivateFact[];
  reported: PrivateFact[];
  done: PrivateFact[];
  previousReported: PrivateFact[];
  previousDone: PrivateFact[];
  /** cohort date of a row (the representative's selected date) */
  dateOf(fact: PrivateFact): string | null;
  diagnostics: CohortDiagnostics;
}

export function selectScope(input: readonly PrivateFact[], scope: Scope): ScopeSelection {
  const length = dayNumber(scope.end) - dayNumber(scope.start) + 1;
  // no upper bound on the period (2026-09-30): the whole history is a valid scope
  if (length <= 0) throw new Error('reversed date range');
  if (scope.bbox && (scope.bbox[0] > scope.bbox[2] || scope.bbox[1] > scope.bbox[3])) throw new Error('invalid bbox');
  const basis = scope.date_basis;
  if (basis !== 'report_date' && basis !== 'completed_date') throw new Error('invalid date basis');
  const prev = previousWindow(scope.start, scope.end);
  const active = activeFacts(input);
  const dateOf = cohortDateOf(active, basis);
  const facts = active.filter(fact => dimensions(fact, scope));
  const within = (fact: PrivateFact, start: string, end: string) => {
    const day = dateOf(fact);
    return day !== null && day >= start && day <= end;
  };
  const cohort = facts.filter(fact => within(fact, scope.start, scope.end));
  const previousCohort = facts.filter(fact => within(fact, prev.start, prev.end));
  const other = otherBasis(basis);
  return {
    basis, range: { start: scope.start, end: scope.end }, prev, facts, cohort, reported: cohort, done: cohort.filter(isCompleted),
    previousReported: previousCohort, previousDone: previousCohort.filter(isCompleted), dateOf,
    diagnostics: {
      date_basis: basis,
      // only reports whose OTHER date lies in the current range: rows read for the comparison window never count here
      selected_date_missing: facts.filter(fact => dateOf(fact) === null && inRange(fact[other], scope.start, scope.end)).length,
      other_date_missing: cohort.filter(fact => kstDate(fact[other]) === null).length,
    },
  };
}

/** Restrict a selection to one address place (U02 focus): the same cohort, prev window and diagnostics rules. */
export function focusSelection(sel: ScopeSelection, keep: (fact: PrivateFact) => boolean): ScopeSelection {
  const cohort = sel.cohort.filter(keep), previousReported = sel.previousReported.filter(keep);
  const other = otherBasis(sel.basis);
  return {
    ...sel, facts: sel.facts.filter(keep), cohort, reported: cohort, done: cohort.filter(isCompleted),
    previousReported, previousDone: previousReported.filter(isCompleted),
    diagnostics: { date_basis: sel.basis,
      selected_date_missing: sel.facts.filter(fact => keep(fact) && sel.dateOf(fact) === null &&
        inRange(fact[other], sel.range.start, sel.range.end)).length,
      other_date_missing: cohort.filter(fact => kstDate(fact[other]) === null).length },
  };
}

export interface OverviewInput {
  sel: ScopeSelection;
  /** every listed row of the same identities (co-contributors), for the participant count */
  full: ScopeSelection;
  comparisonCovered: boolean;
}

/** The one overview builder (dashboard, address focus): N, C, K, F, W, duration, amount, rating, places, participants. */
export function overviewOf({ sel, full, comparisonCovered }: OverviewInput): Overview {
  const { cohort, done, previousReported, previousDone, basis } = sel;
  const result = outcomes(done), D = result.result_known;
  const priorResult = outcomes(previousDone), priorD = priorResult.result_known;
  const fine = done.filter(fact => fact.disposition === 'fine').length;
  const priorFine = previousDone.filter(fact => fact.disposition === 'fine').length;
  const people = (rows: readonly PrivateFact[]) => new Set(rows.map(fact => fact.contributor_id)).size;
  return {
    report_count: countMetric(cohort.length, basis, comparisonCovered ? previousReported.length : null, sel.diagnostics.selected_date_missing),
    completed_count: countMetric(done.length, basis, comparisonCovered ? previousDone.length : null,
      done.filter(fact => kstDate(fact.completed_date) === null).length, cohort.length),
    accepted_including_partial: {
      value: D ? (result.accepted + result.partial) * 100 / D : null,
      basis, denominator: D, numerator: result.accepted + result.partial,
      unit: 'percent', eligible: D, missing: done.length - D,
      previous: comparisonCovered && priorD ? (priorResult.accepted + priorResult.partial) * 100 / priorD : null,
      delta: D && priorD && comparisonCovered ? ((result.accepted + result.partial) * 100 / D) -
        ((priorResult.accepted + priorResult.partial) * 100 / priorD) : null,
      delta_percent: null, delta_reason: !comparisonCovered ? null : priorD ? null : D ? 'new' : 'no_baseline',
    },
    fine_count: countMetric(fine, basis, comparisonCovered ? priorFine : null, 0, done.length),
    point_count: countMetric(distinctPlaces(cohort), basis, comparisonCovered ? distinctPlaces(previousReported) : null, 0, cohort.length),
    // participants: accounts linked to the SAME identities (every listed row), never only the representative owner
    contributor_count: countMetric(people(full.cohort), basis, comparisonCovered ? people(full.previousReported) : null, 0, full.cohort.length),
    outcomes: result,
    processing_duration: { ...durationSummary(done, basis), answer_date_missing: answerDateMissing(cohort) },
    fine_amount: fineAmountSummary(done, basis),
    rating: ratingSummary(done),
    warning_count: done.filter(fact => fact.disposition === 'warning').length,
    cohort: sel.diagnostics,
  };
}

export function aggregateDashboard(input: readonly PrivateFact[], scope: Scope, options: AggregateOptions): DashboardData {
  const sel = selectScope(representatives(input), scope);
  const { facts, cohort, done } = sel;
  const basis = scope.date_basis;
  // participants are counted over every listed row of the cohort identities (representatives alone hide co-contributors)
  const full = selectScope(input, scope);
  const today = options.today ?? todayKst();
  const declared = basisWindow(basis, options);
  // unknown bounds (no state value): the earliest selected date of the input, never the other date
  const fallbackMin = declared.min ?? (activeFacts(input).map(fact => kstDate(fact[basis])).filter((d): d is string => d !== null).sort()[0] ?? null);
  const window = { min: fallbackMin, max: declared.max };
  const comparisonCovered = window.min === null || sel.prev.start >= window.min;
  const overview = overviewOf({ sel, full, comparisonCovered });
  // R07: one pin per normalized address of the cohort (no place is hidden for its other date)
  const { places: exactPlaces, unplaced } = placeRows(cohort, done);
  const points = mapNodes(exactPlaces);
  const vehicles = vehicleRows(cohort);
  const monthOf = (fact: PrivateFact) => sel.dateOf(fact)?.slice(0, 7);
  const months: MonthlyBucket[] = monthSpine(scope, window, today).map(slot => {
    const frame = { month: slot.month, interval_start: slot.interval_start, interval_end: slot.interval_end,
      range_partial: slot.range_partial, in_progress: slot.in_progress,
      partial: slot.range_partial || slot.in_progress, coverage_note: slot.coverage_note };
    if (slot.no_data) return { ...frame, report_count: null, completed_count: null, fine_count: null, outcomes: null, duration: null, fine_amount: null };
    // one month of the cohort date: the count and every result share the same reports (U01 1.8)
    const monthly = cohort.filter(fact => monthOf(fact) === slot.month);
    const monthlyDone = monthly.filter(isCompleted);
    return { ...frame, report_count: monthly.length, completed_count: monthlyDone.length,
      fine_count: monthlyDone.filter(fact => fact.disposition === 'fine').length,
      outcomes: outcomes(monthlyDone), duration: durationBrief(monthlyDone), fine_amount: fineAmountBrief(monthlyDone), rating: ratingSummary(monthlyDone) };
  });
  const capability = (status: 'supported' | 'missing', reason: string | null = null) => ({
    status, reason, coverage: status === 'supported' ? { eligible: facts.length, total: facts.length } : null,
  });
  // facts of the cohort that are not on any address pin (no address, or an address without any coordinate)
  const placedKeys = new Set(exactPlaces.map(place => place.key));
  const locationMissing = cohort.filter(fact => {
    const key = placeKey(fact);
    return key === null || !placedKeys.has(key);
  }).length;
  const duration = overview.processing_duration!;
  const fineAmount = overview.fine_amount!;
  const meta: PublicMeta = {
    schema_version: 2, dataset_version: options.datasetVersion, sample: options.sample,
    source_updated_at: options.sourceUpdatedAt, generated_at: options.generatedAt, published_at: null,
    data_min: window.min, data_max: window.max,
    coverage_note: '커뮤니티 사용자가 공유한 답변 완료 신고만 집계합니다. 전국 전체 신고나 미완료 신고를 대표하지 않습니다.',
    population: 'shared_completed_reports',
    location_missing: locationMissing,
    dedupe_policy_version: 'contribution-dedupe-v1',
    cohort_policy_version: COHORT_POLICY_VERSION, today_kst: today, basis_bounds: options.basisBounds ?? null,
    capabilities: {
      daily_report_dates: capability('supported'), completion_dates: capability('supported'),
      manager_status_cross: capability('supported'), agency_status_cross: capability('supported'),
      vehicle_top5: capability('supported'),
      fine_amount: { status: 'supported', reason: null, coverage: { eligible: fineAmount.confirmed_count, total: fineAmount.fine_count } },
      processing_duration: { status: 'supported', reason: null, coverage: { eligible: duration.count,
        total: duration.count + duration.excluded.no_report_date + duration.excluded.reversed + (duration.excluded.no_answer_date ?? 0) } },
      region_boundaries: { status: 'supported', reason: null, coverage: null },
      // coverage = answered reports with a published law / C (the rest are 법규 미상)
      violation_law: { status: 'supported', reason: null,
        coverage: { eligible: done.filter(fact => lawKey(fact.violation_law) !== null).length, total: done.length } },
      rating: { status: 'supported', reason: null,
        coverage: { eligible: ratingSummary(done).count, total: done.length } },
    },
  };
  return {
    meta, scope, overview,
    points, monthly: months, agencies: entityRows(done, 'agency'), managers: entityRows(done, 'manager'),
    regions: regionRows(cohort, done), laws: lawRows(done),
    vehicles: vehicles.items, vehicle_total_scope_reports: cohort.length,
    vehicle_identifiable_reports: vehicles.identifiable,
    analytics: dashboardAnalytics(sel, scope),
    map_unplaced: unplaced,
  };
}

/** A01–A04, A06 from the same cohort as every other indicator of the dashboard. */
export function dashboardAnalytics(sel: Pick<ScopeSelection, 'cohort' | 'done' | 'basis'>, scope: Scope): DashboardAnalytics {
  return {
    duration: durationDistribution(sel.done, sel.basis),
    heatmap: lawHeatmap(sel.done, scope.agency_key !== null),
    scatter: entityScatter(sel.done),
    // repeat report DAYS are the reports' own report dates over the same cohort (never the answer date)
    vehicle_days: vehicleDayDistribution(sel.cohort, sel.basis),
    rating: ratingDistribution(sel.done, sel.basis),
  };
}
