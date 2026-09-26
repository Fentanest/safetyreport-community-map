/** Personal comparison: all vs mine over ONE scope selection. Server-only (my-analytics). */
import {
  located, monthKeys, outcomes, selectScope, kstDate, type PrivateFact,
} from './aggregate.ts';
import type { Scope } from '../src/domain/public.ts';
import type {
  CompareDiff, CompareEntityRow, CompareMonth, CompareRegionRow, CompareSide, CompareSummary,
  MyPoint, PersonalCompare, ViewerState,
} from '../src/domain/personal.ts';

const pct = (numerator: number, denominator: number): number | null =>
  denominator > 0 ? numerator * 100 / denominator : null;

export function summarize(reported: readonly PrivateFact[], done: readonly PrivateFact[]): CompareSummary {
  const o = outcomes(done);
  const fine = done.filter(fact => fact.disposition === 'fine').length;
  const points = new Set(reported.filter(located).map(fact => fact.point_key)).size;
  return {
    report_count: reported.length, completed_count: done.length,
    accepted: o.accepted, partial: o.partial, rejected: o.rejected,
    result_known: o.result_known, result_unknown: o.result_unknown,
    fine_count: fine, point_count: points,
    accept_rate: pct(o.accepted + o.partial, o.result_known),
    reject_rate: pct(o.rejected, o.result_known),
    fine_rate: pct(fine, done.length),
  };
}

const minus = (a: number | null, b: number | null) => (a === null || b === null ? null : a - b);

export function diffOf(all: CompareSummary, mine: CompareSummary): CompareDiff {
  return {
    report_share: pct(mine.report_count, all.report_count),
    completed_share: pct(mine.completed_count, all.completed_count),
    fine_share: pct(mine.fine_count, all.fine_count),
    point_share: pct(mine.point_count, all.point_count),
    accept_rate_pp: minus(mine.accept_rate, all.accept_rate),
    reject_rate_pp: minus(mine.reject_rate, all.reject_rate),
    fine_rate_pp: minus(mine.fine_rate, all.fine_rate),
    rate_reason: all.result_known === 0 ? 'no_all' : mine.result_known === 0 ? 'no_mine' : null,
  };
}

function side(reported: readonly PrivateFact[], done: readonly PrivateFact[]): CompareSide {
  const o = outcomes(done);
  return {
    report_count: reported.length, completed_count: done.length, result_known: o.result_known,
    accepted_partial: o.accepted + o.partial, rejected: o.rejected,
    fine_count: done.filter(fact => fact.disposition === 'fine').length,
    accept_rate: pct(o.accepted + o.partial, o.result_known),
  };
}

function group<K>(facts: readonly PrivateFact[], keyOf: (fact: PrivateFact) => K): Map<K, PrivateFact[]> {
  const map = new Map<K, PrivateFact[]>();
  for (const fact of facts) {
    const key = keyOf(fact);
    const list = map.get(key);
    if (list) list.push(fact);
    else map.set(key, [fact]);
  }
  return map;
}

export const MAX_COMPARE_ROWS = 50;
export const MAX_COMPARE_REGIONS = 300;
export const MAX_MY_POINTS = 1000;

export interface CompareOptions {
  datasetVersion: string;
  asOf: string;
  dataMin: string | null;
  viewer: ViewerState;
}

/**
 * `input` is exactly what the public API reads for this scope (internal_analytics_v2_facts);
 * `viewerId` comes from the verified Supabase user only — never from a request parameter.
 */
export function aggregateCompare(input: readonly PrivateFact[], scope: Scope, viewerId: string, options: CompareOptions): PersonalCompare {
  if (!viewerId) throw new Error('viewer required');
  const { reported, done } = selectScope(input, scope);
  const isMine = (fact: PrivateFact) => fact.contributor_id === viewerId;
  const myReported = reported.filter(isMine);
  const myDone = done.filter(isMine);
  const all = summarize(reported, done);
  const mine = summarize(myReported, myDone);

  // Regions: every region present in the scope (the list is short on screen; the client decides).
  const regionKey = (fact: PrivateFact) => fact.region_code;
  const regionReported = group(reported, regionKey), regionDone = group(done, regionKey);
  const regionCodes = new Set<string | null>([...regionReported.keys(), ...regionDone.keys()]);
  const regions: CompareRegionRow[] = [...regionCodes].map(code => {
    const r = regionReported.get(code) ?? [], d = regionDone.get(code) ?? [];
    const a = side(r, d), m = side(r.filter(isMine), d.filter(isMine));
    return { region_code: code, all: a, mine: m, accept_rate_pp: minus(m.accept_rate, a.accept_rate) };
  }).sort((x, y) => y.all.report_count - x.all.report_count || y.all.completed_count - x.all.completed_count ||
    (x.region_code ?? '￿').localeCompare(y.region_code ?? '￿', 'ko')).slice(0, MAX_COMPARE_REGIONS);

  // Agencies/managers the viewer actually dealt with (completion basis, same keys as the public table).
  const entities = (kind: 'agency' | 'manager'): CompareEntityRow[] => {
    const keyOf = (fact: PrivateFact) => kind === 'agency' ? (fact.agency_key || 'agency-unknown')
      : `${fact.agency_key || 'agency-unknown'}:${fact.manager_key || 'manager-unknown'}`;
    const byKey = group(done, keyOf);
    const mineKeys = new Set(myDone.map(keyOf));
    return [...mineKeys].map(key => {
      const rows = byKey.get(key) ?? [];
      const first = rows[0];
      const a = side([], rows), m = side([], rows.filter(isMine));
      return {
        kind, key, agency_key: first.agency_key, manager_key: kind === 'manager' ? first.manager_key : null,
        agency_name: first.agency_name || '기관 정보 없음', manager_name: kind === 'manager' ? first.manager_name : null,
        all: a, mine: m, accept_rate_pp: minus(m.accept_rate, a.accept_rate),
      };
    }).sort((x, y) => y.mine.completed_count - x.mine.completed_count || y.all.completed_count - x.all.completed_count ||
      x.agency_name.localeCompare(y.agency_name, 'ko') || x.key.localeCompare(y.key)).slice(0, MAX_COMPARE_ROWS);
  };

  // Monthly: same month coverage rules as the public series (no values outside the data window).
  const monthly: CompareMonth[] = monthKeys(scope.start, scope.end).map(month => {
    const outside = month > options.asOf.slice(0, 7) || (options.dataMin !== null && month < options.dataMin.slice(0, 7));
    if (outside) return { month, all_report_count: null, mine_report_count: null, all_completed_count: null,
      mine_completed_count: null, all_accept_rate: null, mine_accept_rate: null };
    const r = reported.filter(fact => kstDate(fact.report_date)?.slice(0, 7) === month);
    const d = done.filter(fact => kstDate(fact.completed_date)?.slice(0, 7) === month);
    const a = side(r, d), m = side(r.filter(isMine), d.filter(isMine));
    return { month, all_report_count: a.report_count, mine_report_count: m.report_count,
      all_completed_count: a.completed_count, mine_completed_count: m.completed_count,
      all_accept_rate: a.accept_rate, mine_accept_rate: m.accept_rate };
  });

  // Points with my facts; `shared` = another contributor recorded the same point in this scope.
  const pointReported = group(reported.filter(located), fact => fact.point_key);
  const pointDone = group(done.filter(located), fact => fact.point_key);
  const myPointKeys = new Set([...myReported, ...myDone].filter(located).map(fact => fact.point_key));
  const my_points: MyPoint[] = [...myPointKeys].map(key => {
    const r = pointReported.get(key) ?? [], d = pointDone.get(key) ?? [];
    const anchor = (r[0] ?? d[0]) as PrivateFact & { lat: number; lng: number };
    return {
      key: key as string, lat: anchor.lat, lng: anchor.lng, region_code: anchor.region_code,
      mine_report_count: r.filter(isMine).length, mine_completed_count: d.filter(isMine).length,
      shared: [...r, ...d].some(fact => !isMine(fact)),
    };
  }).sort((x, y) => y.mine_report_count - x.mine_report_count || x.key.localeCompare(y.key)).slice(0, MAX_MY_POINTS);

  return {
    schema_version: 2, dataset_version: options.datasetVersion, scope, viewer: options.viewer,
    all, mine, diff: diffOf(all, mine), regions,
    agencies: entities('agency'), managers: entities('manager'), monthly, my_points,
  };
}
