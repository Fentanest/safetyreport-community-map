import {
  DATE_BASIS_LABEL, DEFAULT_DATE_BASIS, DEFAULT_SCOPE, DEMO_SCOPE, LAW_NONE, isDateBasis, isLawParam, lawKey, parseBbox,
  type Category, type DateBasis, type PublicLaw, type Scope,
} from '../domain/public';
import { normalizeRegion } from '../data/regions';

export type ThemeMode = 'dark' | 'light' | 'system';
export type { MapMetric } from '../components/mapMetrics';
export type EntityTab = 'agency' | 'manager';

export const THEME_KEY = 'cm-theme';
export const DEFAULT_DATES = { start: DEFAULT_SCOPE.start, end: DEFAULT_SCOPE.end };

export function demoScope(): Scope {
  return DEMO_SCOPE;
}

export function baseScope(mode: 'demo' | 'live'): Scope {
  return mode === 'demo' ? demoScope() : DEFAULT_SCOPE;
}

export interface DraftFilters {
  /** U01: which date selects the reports (신고일 / 답변일); applied together with the dates */
  date_basis: DateBasis;
  start: string;
  end: string;
  category: Category;
  region_code: string | null;
  /** 위반법규: article key (lawKey), LAW_NONE (법규 미상) or null (전체) */
  law: string | null;
}

const CATEGORIES: Category[] = ['all', 'traffic', 'parking', 'other'];
export const CATEGORY_LABEL: Record<Category, string> = {
  all: '전체',
  traffic: '교통위반',
  parking: '주정차',
  other: '기타',
};

export { regionLabel } from '../data/regions';

export const LAW_UNKNOWN_LABEL = '법규 미상';

/** Label of a law filter value or a law row (null row = 법규 미상). */
export function lawLabel(law: string | null, filter = true): string {
  if (law === null) return filter ? '모든 법규' : LAW_UNKNOWN_LABEL;
  return law === LAW_NONE ? LAW_UNKNOWN_LABEL : law;
}

/** The same 조 단위 key the API filters and echoes (else the echo check would see a different scope). */
export const normalizeLaw = (law: string | null): string | null => (law === null || law === LAW_NONE ? law : lawKey(law));

/** Filter value of a law row (the 법규 미상 row selects LAW_NONE). */
export const lawValue = (law: string | null): string => law ?? LAW_NONE;

/** Laws offered by the filter: the rows of the current data (answered reports per law), named laws only,
 *  most answered first. The current selection is kept even when the data no longer has it. */
export function lawOptions(rows: ReadonlyArray<Pick<PublicLaw, 'law' | 'completed_count'>> | null, selected: string | null):
  Array<{ law: string; count: number | null }> {
  const list = (rows ?? []).filter((r): r is { law: string; completed_count: number } => r.law !== null)
    .map(r => ({ law: r.law, count: r.completed_count as number | null }));
  if (selected && selected !== LAW_NONE && !list.some(o => o.law === selected)) list.unshift({ law: selected, count: null });
  return list;
}

/** Report counts per official code in the current data, for the 시도/시군구 selector (codes without data still selectable). */
export function regionCounts(regions: ReadonlyArray<{ region_code: string | null; report_count: number }> | null): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of regions ?? []) if (row.region_code) counts.set(row.region_code, row.report_count);
  return counts;
}

export function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const parsed = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === s;
}

/** KST calendar day of now (never the latest data day). */
export function todayKst(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Same rules as the API (server/publicHandler.ts parseScope): a real calendar range that is not in the future.
 *  A valid period without shared data is NOT an error (DT-13/DT-15): it is a normal 0-report result, and the
 *  dates are never moved to the data. There is no length limit. */
export function validateRange(start: string, end: string, _min?: string | null, _max?: string | null): string | null {
  if (!isValidDate(start) || !isValidDate(end)) return '시작일과 종료일을 YYYY-MM-DD 형식의 실제 날짜로 입력해 주세요.';
  if (start > end) return '시작일은 종료일보다 늦을 수 없습니다.';
  if (end > todayKst()) return '종료일은 오늘 이후일 수 없습니다.';
  return null;
}

export { DATE_BASIS_LABEL };
/** '답변일 기준' */
export const basisText = (basis: DateBasis) => `${DATE_BASIS_LABEL[basis]} 기준`;

export function scopeFromDraft(draft: DraftFilters, prev: Scope): Scope {
  return {
    ...prev,
    date_basis: draft.date_basis,
    start: draft.start,
    end: draft.end,
    category: draft.category,
    region_code: draft.region_code,
    law: normalizeLaw(draft.law),
    agency_key: null,
    manager_key: null,
    bbox: null,
  };
}

export function draftFromScope(scope: Scope): DraftFilters {
  return { date_basis: scope.date_basis, start: scope.start, end: scope.end, category: scope.category, region_code: scope.region_code, law: scope.law ?? null };
}

/** URL에는 공개 필터와 선택된 viewport bbox만 보존한다. 차량·계정 식별자는 포함하지 않는다. */
export function scopeToSearch(scope: Scope, extra?: { fixture?: string | null; me?: string | null }): string {
  const p = new URLSearchParams();
  // U01: the basis is always written (a link without it is an old link, read as the default and rewritten)
  p.set('date_basis', scope.date_basis);
  p.set('start', scope.start);
  p.set('end', scope.end);
  p.set('category', scope.category);
  if (scope.region_code) p.set('region_code', scope.region_code);
  if (scope.agency_key) p.set('agency_key', scope.agency_key);
  if (scope.manager_key) p.set('manager_key', scope.manager_key);
  if (scope.bbox) p.set('bbox', scope.bbox.join(','));
  if (scope.law) p.set('law', scope.law);
  if (extra?.fixture) p.set('fixture', extra.fixture);
  // U04: the old layout parameter (view=map|stats|both) is never written again
  // demo-only synthetic login fixture (explicit test state, not an account)
  if (extra?.me) p.set('me', extra.me);
  return p.toString();
}

/** Whether the URL names the date basis itself (an old link without it opens on the default and is rewritten). */
export function basisFromSearch(search: string): DateBasis | null {
  const value = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get('date_basis');
  return isDateBasis(value) ? value : null;
}

export function scopeFromSearch(search: string, fallback: Scope): Scope {
  const p = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const basis = p.get('date_basis');
  const start = p.get('start');
  const end = p.get('end');
  const category = p.get('category');
  const region = p.get('region_code');
  const agency = p.get('agency_key');
  const manager = p.get('manager_key');
  const bbox = p.has('bbox') ? parseBbox(p.get('bbox') ?? '') : null;
  const law = p.get('law');
  return {
    ...fallback,
    date_basis: isDateBasis(basis) ? basis : fallback.date_basis ?? DEFAULT_DATE_BASIS,
    start: start && isValidDate(start) ? start : fallback.start,
    end: end && isValidDate(end) ? end : fallback.end,
    category: category && (CATEGORIES as string[]).includes(category) ? (category as Category) : fallback.category,
    // official 시도/시군구 code; an old display key ('서울 중구') is converted, anything else is dropped
    region_code: normalizeRegion(region),
    agency_key: agency || null,
    manager_key: manager || null,
    bbox,
    // exact 위반법규 text or '__none__'; anything the API would refuse is dropped
    law: law !== null && isLawParam(law) ? normalizeLaw(law) : null,
  };
}

export function fixtureFromSearch(search: string): 'overview' | 'one' | 'empty' | 'offline' | 'rate' | 'stale' | 'login' | 'noshare' | 'noupload' | 'oracle' {
  const f = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get('fixture');
  return f === 'one' || f === 'empty' || f === 'offline' || f === 'rate' || f === 'stale' || f === 'login' || f === 'noshare' || f === 'noupload' || f === 'oracle' ? f : 'overview';
}

export const PRESETS: Array<{ id: string; label: string; days: number | null }> = [
  // D12: 최근 N일 end TODAY (KST), not on the latest data day; an old data set says so separately (최근 자료: …)
  { id: 'd30', label: '최근 30일', days: 30 },
  { id: 'd90', label: '최근 90일', days: 90 },
  { id: 'm12', label: '최근 12개월', days: 365 },
  // the whole shared history of the SELECTED basis (never the fixed default year); needs the bounds from /meta
  { id: 'all', label: '전체 기간', days: null },
];

/** Preset range, or null for '전체 기간' while the real data bounds are unknown (never a fixed year).
 *  `min`/`max` = 전체 기간 of the selected basis; `today` = KST today (the end of every 최근 N일). */
export function presetRange(days: number | null, min: string | null, max: string | null, today: string = todayKst()): { start: string; end: string } | null {
  if (days == null) return min && max ? { start: min, end: max } : null;
  const end = today;
  const e = new Date(`${end}T00:00:00Z`);
  if (days === 365) {
    const previousYear = e.getUTCFullYear() - 1;
    const month = e.getUTCMonth();
    const clippedDay = Math.min(e.getUTCDate(), new Date(Date.UTC(previousYear, month + 1, 0)).getUTCDate());
    e.setUTCFullYear(previousYear, month, clippedDay);
    e.setUTCDate(e.getUTCDate() + 1);
  } else e.setUTCDate(e.getUTCDate() - (days - 1));
  // the period is never clipped to the data: a quiet stretch is a real 0, not a shorter period
  return { start: e.toISOString().slice(0, 10), end };
}
