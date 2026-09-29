/**
 * Address places (R07): the map groups facts by their normalized full address, one pin per address.
 *
 * - The source address, coordinates and report identities are never changed; normalization only builds a key.
 * - normalizeAddress: NFC, control characters removed, whitespace collapsed, spaces around a building-number hyphen
 *   removed, and the leading 시도 token written in its official full form ('서울'·'서울시' → '서울특별시').
 *   Everything else (시군구, 도로명/지번, 본번-부번, 산, 동·호수, 참고항목) stays significant: 10 ≠ 10-1 and the
 *   same road name in another 시군구 is another place. Road-name ↔ lot-number addresses are NOT merged (no
 *   verified alias source exists); unknown addresses are never pooled into a pin.
 * - The display position of a place is chosen deterministically from the place's OWN source coordinates in the
 *   current selection: the most frequent coordinate pair; ties → the pair carried by the smallest report identity.
 *   It does not depend on input order. Because the selection already applies the region/bbox filters on each
 *   source coordinate, the representative always lies inside the selected area (statistics are never moved).
 * - A fact with an address but no coordinate still belongs to its place (and is counted there) when another fact
 *   of the same address has one; a place without any coordinate is reported as `no_coordinates` (never at 0,0).
 */
import type { MapUnplaced, OutcomeCounts, PublicPoint } from '../src/domain/public.ts';
import { PLACE_GROUPING_VERSION } from '../src/domain/public.ts';
import { outcomes, regionKeys, type PrivateFact } from './aggregate.ts';

export { PLACE_GROUPING_VERSION };

const SIDO_FULL: Record<string, string> = {
  서울: '서울특별시', 서울시: '서울특별시', 서울특별시: '서울특별시',
  부산: '부산광역시', 부산시: '부산광역시', 부산광역시: '부산광역시',
  대구: '대구광역시', 대구시: '대구광역시', 대구광역시: '대구광역시',
  인천: '인천광역시', 인천시: '인천광역시', 인천광역시: '인천광역시',
  광주: '광주광역시', 광주광역시: '광주광역시',
  대전: '대전광역시', 대전시: '대전광역시', 대전광역시: '대전광역시',
  울산: '울산광역시', 울산시: '울산광역시', 울산광역시: '울산광역시',
  세종: '세종특별자치시', 세종시: '세종특별자치시', 세종특별자치시: '세종특별자치시',
  경기: '경기도', 경기도: '경기도',
  강원: '강원특별자치도', 강원도: '강원특별자치도', 강원특별자치도: '강원특별자치도',
  충북: '충청북도', 충청북도: '충청북도', 충남: '충청남도', 충청남도: '충청남도',
  전북: '전북특별자치도', 전라북도: '전북특별자치도', 전북특별자치도: '전북특별자치도',
  전남: '전라남도', 전라남도: '전라남도',
  경북: '경상북도', 경상북도: '경상북도', 경남: '경상남도', 경상남도: '경상남도',
  제주: '제주특별자치도', 제주도: '제주특별자치도', 제주특별자치도: '제주특별자치도',
};
// '광주시' is also 경기도 광주시 in the second token, so only the first token is ever rewritten and the bare
// '광주시' first token is left as written (ambiguous).

/** Normalized address used only as a grouping key, or null when there is no usable address. */
export function normalizeAddress(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const text = raw.normalize('NFC')
    .replace(/[\u0000-\u001f\u007f-\u009f​-‍﻿]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(\d)\s*-\s*(\d)/g, '$1-$2');
  if (!text) return null;
  const [first, ...rest] = text.split(' ');
  const sido = SIDO_FULL[first];
  return sido ? [sido, ...rest].join(' ') : text;
}

/** 64-bit (two independent 32-bit FNV-1a) hex digest of a string — a stable key, not a secret. */
function hash64(text: string): string {
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
    b = (b ^ (b >>> 15)) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

/** Stable place key of an address (same address from any uploader, dataset or query order → same key). */
export function placeKeyOf(address: string | null | undefined): string | null {
  const normalized = normalizeAddress(address);
  return normalized === null ? null : `pl1:${hash64(normalized)}`;
}

const keyCache = new WeakMap<PrivateFact, string | null>();
export function placeKey(fact: PrivateFact): string | null {
  let key = keyCache.get(fact);
  if (key === undefined) {
    key = placeKeyOf(fact.address);
    keyCache.set(fact, key);
  }
  return key;
}

const hasCoordinate = (fact: PrivateFact): fact is PrivateFact & { lat: number; lng: number } =>
  typeof fact.lat === 'number' && typeof fact.lng === 'number' && Number.isFinite(fact.lat) && Number.isFinite(fact.lng);
const identityOf = (fact: PrivateFact) => fact.report_identity ?? fact.source_report_key ?? fact.fact_identity;

/** Deterministic display representative among a place's facts (see module comment). */
export function representativeOf(facts: readonly PrivateFact[]): (PrivateFact & { lat: number; lng: number }) | null {
  const byCoord = new Map<string, { n: number; best: PrivateFact & { lat: number; lng: number } }>();
  for (const fact of facts) {
    if (!hasCoordinate(fact)) continue;
    const coord = `${fact.lat},${fact.lng}`;
    const cur = byCoord.get(coord);
    if (!cur) byCoord.set(coord, { n: 1, best: fact });
    else {
      cur.n += 1;
      if (identityOf(fact) < identityOf(cur.best)) cur.best = fact;
    }
  }
  let pick: { n: number; best: PrivateFact & { lat: number; lng: number } } | null = null;
  for (const cur of byCoord.values()) {
    if (!pick || cur.n > pick.n || (cur.n === pick.n && identityOf(cur.best) < identityOf(pick.best))) pick = cur;
  }
  return pick?.best ?? null;
}

const warningCount = (rows: readonly PrivateFact[]) => rows.filter(row => row.disposition === 'warning').length;
const fineCount = (rows: readonly PrivateFact[]) => rows.filter(row => row.disposition === 'fine').length;

/** Summary row of one address place (reported by report date, the rest by completion date). */
export function placeSummary(key: string, reported: readonly PrivateFact[], done: readonly PrivateFact[],
  anchor: PrivateFact & { lat: number; lng: number }): PublicPoint {
  const result: OutcomeCounts = outcomes(done);
  return {
    key, place_key: key, grouping_version: PLACE_GROUPING_VERSION,
    lat: anchor.lat, lng: anchor.lng,
    address: normalizeAddress(anchor.address), region_code: regionKeys(anchor).sgg,
    report_count: reported.length, completed_count: done.length, outcomes: result,
    fine_count: fineCount(done), warning_count: warningCount(done),
  };
}

export interface PlaceGroups {
  reported: Map<string, PrivateFact[]>;
  done: Map<string, PrivateFact[]>;
}

export function groupPlaces(reported: readonly PrivateFact[], done: readonly PrivateFact[]): PlaceGroups {
  const into = (facts: readonly PrivateFact[]) => {
    const map = new Map<string, PrivateFact[]>();
    for (const fact of facts) {
      const key = placeKey(fact);
      if (key === null) continue;
      const list = map.get(key);
      if (list) list.push(fact);
      else map.set(key, [fact]);
    }
    return map;
  };
  return { reported: into(reported), done: into(done) };
}

/**
 * Address places of a selection plus the disjoint unplaced breakdown. A fact is in exactly one of:
 * a place (address with at least one coordinate in the place), no_address, no_coordinates.
 */
export function placeRows(reported: readonly PrivateFact[], done: readonly PrivateFact[]): { places: PublicPoint[]; unplaced: MapUnplaced } {
  const groups = groupPlaces(reported, done);
  const unplaced: MapUnplaced = { no_address: { reported: 0, completed: 0 }, no_coordinates: { reported: 0, completed: 0 } };
  unplaced.no_address.reported = reported.filter(fact => placeKey(fact) === null).length;
  unplaced.no_address.completed = done.filter(fact => placeKey(fact) === null).length;
  const places: PublicPoint[] = [];
  for (const key of new Set([...groups.reported.keys(), ...groups.done.keys()])) {
    const r = groups.reported.get(key) ?? [], d = groups.done.get(key) ?? [];
    const anchor = representativeOf([...r, ...d]);
    if (!anchor) {
      unplaced.no_coordinates.reported += r.length;
      unplaced.no_coordinates.completed += d.length;
      continue;
    }
    places.push(placeSummary(key, r, d, anchor));
  }
  places.sort((a, b) => b.report_count - a.report_count || (b.completed_count ?? 0) - (a.completed_count ?? 0) || a.key.localeCompare(b.key));
  return { places, unplaced };
}

/** Facts of one place (by key, never by a coordinate bbox) in a selection. */
export function placeFacts(key: string, reported: readonly PrivateFact[], done: readonly PrivateFact[]) {
  return { reported: reported.filter(fact => placeKey(fact) === key), done: done.filter(fact => placeKey(fact) === key) };
}

/** Distinct address places among facts (the 신고 장소 수 unit, with or without a coordinate). */
export function distinctPlaces(facts: readonly PrivateFact[]): number {
  const keys = new Set<string>();
  for (const fact of facts) {
    const key = placeKey(fact);
    if (key !== null) keys.add(key);
  }
  return keys.size;
}

const inBbox = (b: [number, number, number, number], p: { lat: number; lng: number }) =>
  p.lng >= b[0] && p.lng <= b[2] && p.lat >= b[1] && p.lat <= b[3];

/** Places whose display position is inside a map viewport (display refinement only — no statistics change). */
export function placesInView(places: readonly PublicPoint[], view: [number, number, number, number]): PublicPoint[] {
  return places.filter(place => inBbox(view, place));
}
