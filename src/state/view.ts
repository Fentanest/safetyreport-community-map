/**
 * Screen state for the personal comparison layout (docs/personal-comparison.md).
 * - U04 (2026-09-29): the three main layouts (지도+통계 / 지도 크게 / 통계 크게) were removed; the dashboard has one
 *   responsive layout. An old `view=map|stats|both` URL is ignored and dropped from the next URL (dropLayoutParam).
 *   맞춤 통계's own `view=table|chart` recipe state is a different thing and is untouched (src/state/statistics.ts).
 * - the compare preference and interest regions are per-browser conveniences in localStorage only:
 *   they are never sent to a server and never put in a shared URL.
 */
import { normalizeRegion, regionLabel } from '../data/regions';
// R01: the map's place-filter tabs (전체/내 신고가 있는 곳/함께 신고한 곳/관심 지역) were removed. There is no
// point-filter state any more, so an old URL/localStorage value can never hide pins.

/** U04: the old main-layout parameter values; any other `view` value is left alone. */
const OLD_LAYOUT = new Set(['map', 'stats', 'both']);
/** true when the URL still carries the removed main-layout parameter (the page rewrites it once, keeping the rest) */
export function hasLayoutParam(search: string): boolean {
  return OLD_LAYOUT.has(new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get('view') ?? '');
}

export const COMPARE_KEY = 'cm-compare';
export const INTEREST_KEY = 'cm-interest-regions';
export const MAX_INTEREST = 10;

export function readComparePref(): boolean {
  try { return window.localStorage.getItem(COMPARE_KEY) === '1'; } catch { return false; }
}

export function writeComparePref(on: boolean): void {
  try {
    if (on) window.localStorage.setItem(COMPARE_KEY, '1');
    else window.localStorage.removeItem(COMPARE_KEY);
  } catch { /* storage blocked: the toggle still works for this page */ }
}

/** Official region codes only (public values), at most MAX_INTEREST; old display keys are converted or dropped. */
export function sanitizeInterest(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || item.length > 24) continue;
    const code = normalizeRegion(item);
    if (!code || out.includes(code)) continue;
    out.push(code);
    if (out.length >= MAX_INTEREST) break;
  }
  return out;
}

export function readInterest(): string[] {
  try { return sanitizeInterest(JSON.parse(window.localStorage.getItem(INTEREST_KEY) ?? '[]')); } catch { return []; }
}

export function writeInterest(codes: string[]): string[] {
  const clean = sanitizeInterest(codes);
  try { window.localStorage.setItem(INTEREST_KEY, JSON.stringify(clean)); } catch { /* ignore */ }
  return clean;
}

export function toggleInterest(codes: string[], code: string): string[] {
  return codes.includes(code) ? codes.filter(c => c !== code) : sanitizeInterest([...codes, code]);
}

/** Display label for a region row code (null = 지역 미확인). */
export function regionName(code: string | null): string {
  return code === null ? '지역 미확인' : regionLabel(code);
}

/** S04: which screen the URL asks for (a page parameter, never part of the statistics scope) */
export function screenFromSearch(search: string): 'dashboard' | 'statistics' {
  return new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get('screen') === 'statistics' ? 'statistics' : 'dashboard';
}
