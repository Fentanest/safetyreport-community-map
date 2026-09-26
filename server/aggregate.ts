/** Exact private-fact aggregation. This module must run behind the public API only. */
import type {
  Category, CountMetric, DashboardData, MonthlyBucket, OutcomeCounts,
  PublicEntity, PublicMeta, PublicPoint, Scope,
} from '../src/domain/public.ts';
import { maskPlate, parsePlate } from './plate.ts';

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
  manager_key: string | null;
  manager_name: string | null;
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

function dimensions(fact: PrivateFact, scope: Scope): boolean {
  if (scope.category !== 'all' && fact.category !== scope.category) return false;
  if (scope.region_code && fact.region_code !== scope.region_code) return false;
  if (scope.agency_key && fact.agency_key !== scope.agency_key) return false;
  if (scope.manager_key && fact.manager_key !== scope.manager_key) return false;
  if (scope.bbox) {
    const [minLng, minLat, maxLng, maxLat] = scope.bbox;
    if (fact.lat === null || fact.lng === null) return false;  // a viewport filter can only keep located facts
    if (fact.lng < minLng || fact.lng > maxLng || fact.lat < minLat || fact.lat > maxLat) return false;
  }
  return true;
}

function completed(fact: PrivateFact, start: string, end: string): boolean {
  return terminal.has(fact.status) && inRange(fact.completed_date, start, end);
}

function outcomes(facts: readonly PrivateFact[]): OutcomeCounts {
  let accepted = 0, partial = 0, rejected = 0;
  for (const fact of facts) {
    if (fact.status === 'accepted') accepted++;
    else if (fact.status === 'partial') partial++;
    else if (fact.status === 'rejected') rejected++;
  }
  const result_known = accepted + partial + rejected;
  return { accepted, partial, rejected, result_known, result_unknown: facts.length - result_known };
}

export function growth(current: number, previous: number) {
  if (previous === 0) return { delta: current, delta_percent: null, delta_reason: current > 0 ? 'new' as const : 'no_baseline' as const };
  return { delta: current - previous, delta_percent: (current - previous) * 100 / previous, delta_reason: null };
}

function countMetric(value: number, basis: 'report_date' | 'completed_date', previous: number | null, missing = 0, denominator: number | null = null): CountMetric {
  return { value, basis, denominator, eligible: value, missing, previous,
    ...(previous === null ? { delta: null, delta_percent: null, delta_reason: null, note: '비교기간 자료 없음' } : growth(value, previous)) };
}

function monthKeys(start: string, end: string): string[] {
  const first = new Date(`${start.slice(0, 7)}-01T00:00:00Z`);
  const last = end.slice(0, 7);
  const months: string[] = [];
  while (first.toISOString().slice(0, 7) <= last) {
    months.push(first.toISOString().slice(0, 7));
    first.setUTCMonth(first.getUTCMonth() + 1);
  }
  return months;
}

function entityRows(facts: readonly PrivateFact[], kind: 'agency' | 'manager'): PublicEntity[] {
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
    agency_name: rows[0].agency_name || '기관 정보 없음',
    manager_name: kind === 'manager' ? rows[0].manager_name : null,
    completed_count: rows.length, outcomes: outcomes(rows),
    fine_count: rows.filter(row => row.disposition === 'fine').length,
  })).sort((a, b) => b.completed_count - a.completed_count || a.agency_name.localeCompare(b.agency_name, 'ko'));
}

type LocatedFact = PrivateFact & { point_key: string; lat: number; lng: number };
const located = (fact: PrivateFact): fact is LocatedFact => fact.point_key !== null && fact.lat !== null && fact.lng !== null;

function pointRows(reportedAll: readonly PrivateFact[], doneAll: readonly PrivateFact[]): PublicPoint[] {
  const reported = reportedAll.filter(located), done = doneAll.filter(located);
  const reports = new Map<string, LocatedFact[]>();
  const completions = new Map<string, LocatedFact[]>();
  for (const fact of reported) reports.set(fact.point_key, [...(reports.get(fact.point_key) || []), fact]);
  for (const fact of done) completions.set(fact.point_key, [...(completions.get(fact.point_key) || []), fact]);
  return [...reports].map(([key, rows]) => {
    const finished = completions.get(key) || [];
    return { key, lat: rows[0].lat, lng: rows[0].lng, address: rows[0].address,
      region_code: rows[0].region_code, report_count: rows.length, completed_count: finished.length,
      outcomes: outcomes(finished), fine_count: finished.filter(row => row.disposition === 'fine').length };
  }).sort((a, b) => b.report_count - a.report_count || a.key.localeCompare(b.key));
}

function mapNodes(exact: readonly PublicPoint[]): PublicPoint[] {
  if (exact.length <= 1000) return [...exact];
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
    if (groups.size <= 1000) break;
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
    return {
      key: `cluster:${cell}:${cellKey}`,
      lat: sum(row => row.lat * row.report_count) / reportCount,
      lng: sum(row => row.lng * row.report_count) / reportCount,
      aggregate: true, point_count: rows.length,
      bbox: [minLng, minLat, maxLng, maxLat] as [number, number, number, number],
      address: null,
      region_code: rows.every(row => row.region_code === rows[0].region_code) ? rows[0].region_code : null,
      report_count: reportCount,
      completed_count: rows.every(row => row.completed_count !== null) ? sum(row => row.completed_count!) : null,
      outcomes: result,
      fine_count: rows.every(row => row.fine_count !== null) ? sum(row => row.fine_count!) : null,
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
  asOf: string;
  sample: boolean;
  dataMin?: string | null;
}

export function aggregateDashboard(input: readonly PrivateFact[], scope: Scope, options: AggregateOptions): DashboardData {
  const length = dayNumber(scope.end) - dayNumber(scope.start) + 1;
  if (length <= 0 || length > 1827) throw new Error('date range exceeds supported bound');
  if (scope.bbox && (scope.bbox[0] > scope.bbox[2] || scope.bbox[1] > scope.bbox[3])) throw new Error('invalid bbox');
  const prev = previousWindow(scope.start, scope.end);
  const facts = activeFacts(input).filter(fact => dimensions(fact, scope));
  const reported = facts.filter(fact => inRange(fact.report_date, scope.start, scope.end));
  const done = facts.filter(fact => completed(fact, scope.start, scope.end));
  const previousReported = facts.filter(fact => inRange(fact.report_date, prev.start, prev.end));
  const previousDone = facts.filter(fact => completed(fact, prev.start, prev.end));
  const result = outcomes(done), D = result.result_known;
  const priorResult = outcomes(previousDone), priorD = priorResult.result_known;
  const fine = done.filter(fact => fact.disposition === 'fine').length;
  const priorFine = previousDone.filter(fact => fact.disposition === 'fine').length;
  const exactPoints = pointRows(reported, done);
  const points = mapNodes(exactPoints);
  const vehicles = vehicleRows(reported);
  const sourceDates = activeFacts(input).flatMap(fact => [kstDate(fact.report_date), kstDate(fact.completed_date)])
    .filter((day): day is string => day !== null).sort();
  const dataMin = options.dataMin || sourceDates[0] || null;
  const comparisonCovered = dataMin === null || prev.start >= dataMin;
  const months: MonthlyBucket[] = monthKeys(scope.start, scope.end).map(month => {
    if (month > options.asOf.slice(0, 7)) return {
      month, report_count: null, completed_count: null, fine_count: null, outcomes: null,
      partial: false, coverage_note: '데이터 제공 종료 이후',
    };
    if (dataMin && month < dataMin.slice(0, 7)) return {
      month, report_count: null, completed_count: null, fine_count: null, outcomes: null,
      partial: false, coverage_note: '데이터 제공 시작 전',
    };
    const monthlyReports = reported.filter(fact => kstDate(fact.report_date)?.slice(0, 7) === month);
    const monthlyDone = done.filter(fact => kstDate(fact.completed_date)?.slice(0, 7) === month);
    return { month, report_count: monthlyReports.length, completed_count: monthlyDone.length,
      fine_count: monthlyDone.filter(fact => fact.disposition === 'fine').length,
      outcomes: outcomes(monthlyDone), partial: month === options.asOf.slice(0, 7) && scope.end >= options.asOf,
      coverage_note: dataMin && month === dataMin.slice(0, 7) && dataMin.slice(8) !== '01' ? '제공 시작 월(부분)' : null };
  });
  const capability = (status: 'supported' | 'missing', reason: string | null = null) => ({
    status, reason, coverage: status === 'supported' ? { eligible: facts.length, total: facts.length } : null,
  });
  const meta: PublicMeta = {
    schema_version: 2, dataset_version: options.datasetVersion, sample: options.sample,
    source_updated_at: options.sourceUpdatedAt, generated_at: options.generatedAt, published_at: null,
    data_min: dataMin, data_max: options.asOf,
    coverage_note: '커뮤니티 사용자가 공유한 답변 완료 신고만 집계합니다. 전국 전체 신고나 미완료 신고를 대표하지 않습니다.',
    population: 'shared_completed_reports',
    location_missing: facts.filter(fact => !located(fact)).length,
    dedupe_policy_version: 'ingest-latest-v1', capabilities: {
      daily_report_dates: capability('supported'), completion_dates: capability('supported'),
      manager_status_cross: capability('supported'), agency_status_cross: capability('supported'),
      vehicle_top5: capability('supported'), fine_amount: capability('missing', '금액 원천이 없습니다.'),
      processing_duration: capability('missing', '기간 분포 원천이 없습니다.'),
      region_boundaries: capability('missing', '공식 경계 데이터가 없습니다.'),
    },
  };
  return {
    meta, scope,
    overview: {
      report_count: countMetric(reported.length, 'report_date', comparisonCovered ? previousReported.length : null,
        facts.filter(fact => fact.report_date === null).length),
      completed_count: countMetric(done.length, 'completed_date', comparisonCovered ? previousDone.length : null,
        facts.filter(fact => terminal.has(fact.status) && fact.completed_date === null).length),
      accepted_including_partial: {
        value: D ? (result.accepted + result.partial) * 100 / D : null,
        basis: 'completed_date', denominator: D, numerator: result.accepted + result.partial,
        unit: 'percent', eligible: D, missing: done.length - D,
        previous: comparisonCovered && priorD ? (priorResult.accepted + priorResult.partial) * 100 / priorD : null,
        delta: D && priorD && comparisonCovered ? ((result.accepted + result.partial) * 100 / D) -
          ((priorResult.accepted + priorResult.partial) * 100 / priorD) : null,
        delta_percent: null, delta_reason: !comparisonCovered ? null : priorD ? null : D ? 'new' : 'no_baseline',
      },
      fine_count: countMetric(fine, 'completed_date', comparisonCovered ? priorFine : null, 0, done.length),
      point_count: countMetric(exactPoints.length, 'report_date', comparisonCovered ? new Set(previousReported.filter(located).map(fact => fact.point_key)).size : null, 0, reported.length),
      contributor_count: countMetric(new Set(reported.map(fact => fact.contributor_id)).size, 'report_date',
        comparisonCovered ? new Set(previousReported.map(fact => fact.contributor_id)).size : null, 0, reported.length),
      outcomes: result,
    },
    points, monthly: months, agencies: entityRows(done, 'agency'), managers: entityRows(done, 'manager'),
    vehicles: vehicles.items, vehicle_total_scope_reports: reported.length,
    vehicle_identifiable_reports: vehicles.identifiable,
  };
}
