import { DEFAULT_SCOPE, DEMO_SCOPE, type Category, type Scope } from '../domain/public';

export type ThemeMode = 'dark' | 'light' | 'system';
export type MapMetric = 'reports' | 'acceptance' | 'fine';
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
  start: string;
  end: string;
  category: Category;
  region_code: string | null;
}

const CATEGORIES: Category[] = ['all', 'traffic', 'parking', 'other'];
export const CATEGORY_LABEL: Record<Category, string> = {
  all: '전체',
  traffic: '교통위반',
  parking: '주정차',
  other: '기타',
};

export const REGION_OPTIONS: Array<{ code: string | null; label: string }> = [
  { code: null, label: '대한민국 전국' },
  { code: '11', label: '서울특별시' },
  { code: '26', label: '부산광역시' },
  { code: '50', label: '제주특별자치도' },
];

export function regionLabel(code: string | null): string {
  return REGION_OPTIONS.find((r) => r.code === code)?.label ?? (code ? `지역 ${code}` : '대한민국 전국');
}

export function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const parsed = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === s;
}

export function validateRange(start: string, end: string, min: string | null, max: string | null): string | null {
  if (!isValidDate(start) || !isValidDate(end)) return '시작일과 종료일을 YYYY-MM-DD 형식으로 입력해 주세요.';
  if (start > end) return '시작일은 종료일보다 늦을 수 없습니다.';
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  if (end > today) return '종료일은 오늘 이후일 수 없습니다.';
  if (min && start < min) return `분석 가능 기간은 ${min} 이후입니다.`;
  if (max && end > max) return `분석 가능 기간은 ${max} 이전입니다.`;
  return null;
}

export function scopeFromDraft(draft: DraftFilters, prev: Scope): Scope {
  return {
    ...prev,
    start: draft.start,
    end: draft.end,
    category: draft.category,
    region_code: draft.region_code,
    agency_key: null,
    manager_key: null,
    bbox: null,
  };
}

export function draftFromScope(scope: Scope): DraftFilters {
  return { start: scope.start, end: scope.end, category: scope.category, region_code: scope.region_code };
}

/** URL에는 공개 필터와 선택된 viewport bbox만 보존한다. 차량·계정 식별자는 포함하지 않는다. */
export function scopeToSearch(scope: Scope, extra?: { fixture?: string | null }): string {
  const p = new URLSearchParams();
  p.set('start', scope.start);
  p.set('end', scope.end);
  p.set('category', scope.category);
  if (scope.region_code) p.set('region_code', scope.region_code);
  if (scope.agency_key) p.set('agency_key', scope.agency_key);
  if (scope.manager_key) p.set('manager_key', scope.manager_key);
  if (scope.bbox) p.set('bbox', scope.bbox.join(','));
  if (extra?.fixture) p.set('fixture', extra.fixture);
  return p.toString();
}

export function scopeFromSearch(search: string, fallback: Scope): Scope {
  const p = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const start = p.get('start');
  const end = p.get('end');
  const category = p.get('category');
  const region = p.get('region_code');
  const agency = p.get('agency_key');
  const manager = p.get('manager_key');
  const bboxValues = p.get('bbox')?.split(',').map(Number);
  const bbox = bboxValues?.length === 4 && bboxValues.every(Number.isFinite) &&
    bboxValues[0] >= 124 && bboxValues[2] <= 132 && bboxValues[1] >= 32 && bboxValues[3] <= 39.5 &&
    bboxValues[0] <= bboxValues[2] && bboxValues[1] <= bboxValues[3]
    ? bboxValues as Scope['bbox'] : null;
  return {
    ...fallback,
    start: start && isValidDate(start) ? start : fallback.start,
    end: end && isValidDate(end) ? end : fallback.end,
    category: category && (CATEGORIES as string[]).includes(category) ? (category as Category) : fallback.category,
    region_code: region || null,
    agency_key: agency || null,
    manager_key: manager || null,
    bbox,
  };
}

export function fixtureFromSearch(search: string): 'overview' | 'one' | 'empty' | 'offline' | 'rate' | 'stale' {
  const f = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get('fixture');
  return f === 'one' || f === 'empty' || f === 'offline' || f === 'rate' || f === 'stale' ? f : 'overview';
}

export const PRESETS: Array<{ id: string; label: string; days: number | null }> = [
  { id: 'd30', label: '최근 30일', days: 30 },
  { id: 'd90', label: '최근 90일', days: 90 },
  { id: 'm12', label: '최근 12개월', days: 365 },
  { id: 'all', label: '전체', days: null },
];

export function presetRange(days: number | null, min: string | null, max: string | null): { start: string; end: string } {
  const end = max ?? DEFAULT_SCOPE.end;
  if (days == null) return { start: min ?? DEFAULT_SCOPE.start, end };
  const e = new Date(`${end}T00:00:00Z`);
  if (days === 365) {
    const previousYear = e.getUTCFullYear() - 1;
    const month = e.getUTCMonth();
    const clippedDay = Math.min(e.getUTCDate(), new Date(Date.UTC(previousYear, month + 1, 0)).getUTCDate());
    e.setUTCFullYear(previousYear, month, clippedDay);
    e.setUTCDate(e.getUTCDate() + 1);
  } else e.setUTCDate(e.getUTCDate() - (days - 1));
  const start = e.toISOString().slice(0, 10);
  return { start: min && start < min ? min : start, end };
}
