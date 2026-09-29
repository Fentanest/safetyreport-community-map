/** Personal comparison: all vs mine over ONE scope selection. Server-only (my-analytics). */
import {
  basisWindow, inDateRange, monthSpine, outcomes, ownRepresentatives, regionKeys, representatives, selectScope, ratingSummary, todayKst,
  type PrivateFact,
} from './aggregate.ts';
import { distinctPlaces, groupPlaces, representativeOf } from './places.ts';
import { durationDistribution, ratingDistribution } from './analyticsDistributions.ts';
import { regionName } from './regions.ts';
import { COHORT_POLICY_VERSION, type BasisBounds, type Scope } from '../src/domain/public.ts';
import { durationSummary } from './duration.ts';
import { fineAmountSummary } from './amount.ts';
import type {
  CompareDiff, CompareEntityRow, CompareMonth, CompareRegionRow, CompareSide, CompareSummary,
  MyPoint, PersonalCompare, ViewerState,
} from '../src/domain/personal.ts';

const pct = (numerator: number, denominator: number): number | null =>
  denominator > 0 ? numerator * 100 / denominator : null;

export function summarize(reported: readonly PrivateFact[], done: readonly PrivateFact[]): CompareSummary {
  const o = outcomes(done);
  const fine = done.filter(fact => fact.disposition === 'fine').length;
  // 신고 장소 = distinct address places (R07), the same key as the public map and point_count
  const points = distinctPlaces(reported);
  return {
    report_count: reported.length, completed_count: done.length,
    accepted: o.accepted, partial: o.partial, rejected: o.rejected,
    result_known: o.result_known, result_unknown: o.result_unknown,
    fine_count: fine, point_count: points,
    // 수용률 = 수용 ÷ 결과 확인(D), 일부수용률 = 일부 수용 ÷ D — 따로 보여 준다(2026-09-27 사용자 결정).
    accept_rate: pct(o.accepted, o.result_known),
    partial_rate: pct(o.partial, o.result_known),
    reject_rate: pct(o.rejected, o.result_known),
    fine_rate: pct(fine, done.length),
    duration: (({ count, mean_days, median_days, p90_days }) => ({ count, mean_days, median_days, p90_days }))(durationSummary(done)),
    fine_amount: (({ fine_count, confirmed_count, sum_won, mean_won, median_won, unconfirmed_count, undisclosed_count, partial }) =>
      ({ fine_count, confirmed_count, sum_won, mean_won, median_won, unconfirmed_count, undisclosed_count, partial }))(fineAmountSummary(done)),
    rating: ratingSummary(done),
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
    partial_rate_pp: minus(mine.partial_rate, all.partial_rate),
    reject_rate_pp: minus(mine.reject_rate, all.reject_rate),
    fine_rate_pp: minus(mine.fine_rate, all.fine_rate),
    duration_median_days_diff: minus(mine.duration.median_days, all.duration.median_days),
    duration_mean_days_diff: minus(mine.duration.mean_days, all.duration.mean_days),
    // Sum share only when all has a positive confirmed sum (an all-0원 total has no meaningful share).
    fine_amount_sum_share: all.fine_amount.sum_won ? pct(mine.fine_amount.sum_won ?? 0, all.fine_amount.sum_won) : null,
    fine_amount_mean_won_diff: minus(mine.fine_amount.mean_won, all.fine_amount.mean_won),
    rate_reason: all.result_known === 0 ? 'no_all' : mine.result_known === 0 ? 'no_mine' : null,
  };
}

function side(reported: readonly PrivateFact[], done: readonly PrivateFact[]): CompareSide {
  const o = outcomes(done);
  const dur = durationSummary(done);
  const amount = fineAmountSummary(done);
  return {
    report_count: reported.length, completed_count: done.length, result_known: o.result_known,
    accepted: o.accepted, partial: o.partial, rejected: o.rejected,
    fine_count: done.filter(fact => fact.disposition === 'fine').length,
    accept_rate: pct(o.accepted, o.result_known),
    partial_rate: pct(o.partial, o.result_known),
    duration_count: dur.count,
    duration_median_days: dur.median_days,
    fine_amount_confirmed_count: amount.confirmed_count,
    fine_amount_sum_won: amount.sum_won,
    rating: ratingSummary(done),
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
  basisBounds?: BasisBounds | null;
  today?: string;
}

/**
 * `input` is exactly what the public API reads for this scope (internal_analytics_v2_facts);
 * `viewerId` comes from the verified Supabase user only — never from a request parameter.
 */
export function aggregateCompare(input: readonly PrivateFact[], scope: Scope, viewerId: string, options: CompareOptions): PersonalCompare {
  if (!viewerId) throw new Error('viewer required');
  // Global side counts each shared identity once (representative rows); the personal side sees
  // every listed row so each account's own contribution is counted in its personal scope.
  const sel = selectScope(representatives(input), scope);
  const { reported, done } = sel;
  const mineSel = selectScope(input, scope);
  const isMine = (fact: PrivateFact) => fact.contributor_id === viewerId;
  // Personal counts collapse the viewer's own second-dataset/restored rows to one per identity.
  const myReported = ownRepresentatives(mineSel.reported.filter(isMine));
  const myDone = ownRepresentatives(mineSel.done.filter(isMine));
  const all = summarize(reported, done);
  const mine = summarize(myReported, myDone);

  // Regions at both levels on official codes (the same grouping as the public rows), each from raw facts.
  type Bucket = { level: CompareRegionRow['level']; code: string | null; sido: string | null;
    r: PrivateFact[]; d: PrivateFact[]; mr: PrivateFact[]; md: PrivateFact[] };
  const buckets = new Map<string, Bucket>();
  const bucket = (level: Bucket['level'], code: string | null, sido: string | null) => {
    const key = `${level}:${code ?? ''}`;
    let b = buckets.get(key);
    if (!b) buckets.set(key, b = { level, code, sido, r: [], d: [], mr: [], md: [] });
    return b;
  };
  const place = (fact: PrivateFact, list: 'r' | 'd' | 'mr' | 'md') => {
    const k = regionKeys(fact);
    if (!k.sgg || !k.sido) { bucket('unknown', null, null)[list].push(fact); return; }
    bucket('sido', k.sido, null)[list].push(fact);
    bucket('sgg', k.sgg, k.sido)[list].push(fact);
  };
  for (const fact of reported) place(fact, 'r');
  for (const fact of done) place(fact, 'd');
  for (const fact of myReported) place(fact, 'mr');
  for (const fact of myDone) place(fact, 'md');
  const levelOrder = { sido: 0, sgg: 1, unknown: 2 } as const;
  const regions: CompareRegionRow[] = [...buckets.values()].map(b => {
    const a = side(b.r, b.d), m = side(b.mr, b.md);
    return { level: b.level, region_code: b.code, name: b.code ? regionName(b.code) ?? b.code : '지역 미확인',
      sido_code: b.sido, all: a, mine: m, accept_rate_pp: minus(m.accept_rate, a.accept_rate),
      partial_rate_pp: minus(m.partial_rate, a.partial_rate),
      duration_median_days_diff: minus(m.duration_median_days, a.duration_median_days) };
  }).sort((x, y) => levelOrder[x.level] - levelOrder[y.level] || y.all.report_count - x.all.report_count ||
    y.all.completed_count - x.all.completed_count || (x.region_code ?? '').localeCompare(y.region_code ?? ''))
    .slice(0, MAX_COMPARE_REGIONS);

  // Agencies/managers the viewer actually dealt with (completion basis, same keys as the public table).
  const entities = (kind: 'agency' | 'manager'): CompareEntityRow[] => {
    const keyOf = (fact: PrivateFact) => kind === 'agency' ? (fact.agency_key || 'agency-unknown')
      : `${fact.agency_key || 'agency-unknown'}:${fact.manager_key || 'manager-unknown'}`;
    const byKey = group(done, keyOf);
    const byMineKey = group(myDone, keyOf);
    const mineKeys = new Set(byMineKey.keys());
    return [...mineKeys].map(key => {
      const rows = byKey.get(key) ?? [];
      const first = rows[0] ?? byMineKey.get(key)![0];
      const a = side([], rows), m = side([], byMineKey.get(key) ?? []);
      return {
        kind, key, agency_key: first.agency_key, manager_key: kind === 'manager' ? first.manager_key : null,
        agency_name: first.agency_current_name || first.agency_name || '기관 정보 없음', manager_name: kind === 'manager' ? first.manager_name : null,
        all: a, mine: m, accept_rate_pp: minus(m.accept_rate, a.accept_rate),
        partial_rate_pp: minus(m.partial_rate, a.partial_rate),
        duration_median_days_diff: minus(m.duration_median_days, a.duration_median_days),
      };
    }).sort((x, y) => y.mine.completed_count - x.mine.completed_count || y.all.completed_count - x.all.completed_count ||
      x.agency_name.localeCompare(y.agency_name, 'ko') || x.key.localeCompare(y.key)).slice(0, MAX_COMPARE_ROWS);
  };

  // Monthly: same month coverage rules as the public series (no values outside the data window).
  // Monthly: the cohort month of the SELECTED basis for both sides (one set per month, U01 1.8), on the same
  // calendar spine and data window as the public series.
  const monthOf = (fact: PrivateFact) => mineSel.dateOf(fact)?.slice(0, 7);
  const spine = monthSpine(scope, basisWindow(scope.date_basis, { basisBounds: options.basisBounds, dataMin: options.dataMin, asOf: options.asOf }),
    options.today ?? todayKst());
  const monthly: CompareMonth[] = spine.map(({ month, no_data: outside }) => {
    if (outside) return { month, all_report_count: null, mine_report_count: null, all_completed_count: null,
      mine_completed_count: null, all_accept_rate: null, mine_accept_rate: null,
      all_duration_median_days: null, mine_duration_median_days: null, mine_outcomes: null, mine_fine_count: null };
    const r = reported.filter(fact => monthOf(fact) === month);
    const d = done.filter(fact => monthOf(fact) === month);
    const mr = myReported.filter(fact => monthOf(fact) === month);
    const md = myDone.filter(fact => monthOf(fact) === month);
    const a = side(r, d), m = side(mr, md);
    return { month, all_report_count: a.report_count, mine_report_count: m.report_count,
      all_completed_count: a.completed_count, mine_completed_count: m.completed_count,
      all_accept_rate: a.accept_rate, mine_accept_rate: m.accept_rate,
      all_duration_median_days: a.duration_median_days, mine_duration_median_days: m.duration_median_days,
      all_rating: a.rating, mine_rating: m.rating,
      // A05: the viewer's own numerators/denominators of the month (cohort month), never a re-averaged rate
      mine_outcomes: outcomes(md), mine_fine_count: md.filter(fact => fact.disposition === 'fine').length };
  });

  // Address places with my facts (R07: same place key and display position as the public map);
  // `shared` = another contributor recorded the same address in this scope (checked against every listed row).
  const publicPlaces = groupPlaces(reported, done);
  const fullPlaces = groupPlaces(mineSel.reported, mineSel.done);
  const myPlaces = groupPlaces(myReported, myDone);
  const myPlaceKeys = new Set([...myPlaces.reported.keys(), ...myPlaces.done.keys()]);
  const my_points: MyPoint[] = [...myPlaceKeys].flatMap(key => {
    const anchor = representativeOf([...(publicPlaces.reported.get(key) ?? []), ...(publicPlaces.done.get(key) ?? [])]) ??
      representativeOf([...(myPlaces.reported.get(key) ?? []), ...(myPlaces.done.get(key) ?? [])]);
    if (!anchor) return [];
    const mineR = myPlaces.reported.get(key) ?? [], mineD = myPlaces.done.get(key) ?? [];
    return [{
      key, lat: anchor.lat, lng: anchor.lng, region_code: regionKeys(anchor).sgg,
      mine_report_count: mineR.length, mine_completed_count: mineD.length,
      shared: [...(fullPlaces.reported.get(key) ?? []), ...(fullPlaces.done.get(key) ?? [])].some(fact => !isMine(fact)),
    }];
  }).sort((x, y) => y.mine_report_count - x.mine_report_count || x.key.localeCompare(y.key)).slice(0, MAX_MY_POINTS);

  return {
    schema_version: 2, dataset_version: options.datasetVersion, scope, viewer: options.viewer,
    cohort_policy_version: COHORT_POLICY_VERSION,
    // D11: each side's own missing-date diagnostics (never added together)
    cohort: { all: sel.diagnostics, mine: { ...mineSel.diagnostics,
      selected_date_missing: ownRepresentatives(mineSel.facts.filter(fact => isMine(fact) && mineSel.dateOf(fact) === null &&
        inDateRange(scope.date_basis === 'report_date' ? fact.completed_date : fact.report_date, scope.start, scope.end))).length,
      other_date_missing: ownRepresentatives(mineSel.cohort.filter(isMine)).filter(fact =>
        (scope.date_basis === 'report_date' ? fact.completed_date : fact.report_date) === null).length } },
    all, mine, diff: diffOf(all, mine), regions,
    agencies: entities('agency'), managers: entities('manager'), monthly, my_points,
    // A01/A06 for the viewer's own cohort (own denominators; the public side is in the dashboard response)
    analytics: { duration: durationDistribution(myDone), rating: ratingDistribution(myDone) },
  };
}
