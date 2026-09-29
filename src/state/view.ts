/**
 * Screen state for the personal comparison layout (docs/personal-comparison.md).
 * - view mode is a public panel state and may be in the URL (`view=map|stats`; 'both' is the default).
 * - the compare preference and interest regions are per-browser conveniences in localStorage only:
 *   they are never sent to a server and never put in a shared URL.
 */
import { normalizeRegion, regionLabel } from '../data/regions';
export type ViewMode = 'both' | 'map' | 'stats';

export const VIEW_LABEL: Record<ViewMode, string> = { both: '지도+통계', map: '지도 크게', stats: '통계 크게' };
// R01: the map's place-filter tabs (전체/내 신고가 있는 곳/함께 신고한 곳/관심 지역) were removed. There is no
// point-filter state any more, so an old URL/localStorage value can never hide pins.

export function viewFromSearch(search: string): ViewMode {
  const value = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get('view');
  return value === 'map' || value === 'stats' ? value : 'both';
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
