/**
 * Screen state for the personal comparison layout (docs/personal-comparison.md).
 * - view mode is a public panel state and may be in the URL (`view=map|stats`; 'both' is the default).
 * - the compare preference and interest regions are per-browser conveniences in localStorage only:
 *   they are never sent to a server and never put in a shared URL.
 */
export type ViewMode = 'both' | 'map' | 'stats';
export type PointFilter = 'all' | 'mine' | 'shared' | 'interest';

export const VIEW_LABEL: Record<ViewMode, string> = { both: '지도+통계', map: '지도 크게', stats: '통계 크게' };
export const POINT_FILTER_LABEL: Record<PointFilter, string> = {
  all: '전체', mine: '내 신고가 있는 곳', shared: '함께 신고한 곳', interest: '관심 지역',
};

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

/** Region codes only (public values), at most MAX_INTEREST, each ≤ 24 characters. */
export function sanitizeInterest(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const code = item.trim();
    if (!code || code.length > 24 || out.includes(code)) continue;
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

const SIDO_LABEL: Record<string, string> = {
  '11': '서울특별시', '26': '부산광역시', '27': '대구광역시', '28': '인천광역시', '29': '광주광역시',
  '30': '대전광역시', '31': '울산광역시', '36': '세종특별자치시', '41': '경기도', '50': '제주특별자치도',
};

/** Display label for a stored region code ('서울 중구' stays as is; legacy numeric codes get a name). */
export function regionName(code: string | null): string {
  if (code === null) return '지역 미상';
  return SIDO_LABEL[code] ?? code;
}
