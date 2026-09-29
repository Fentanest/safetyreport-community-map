/**
 * 맞춤 통계 page state (S04–S08): recipes (what to compute), presets, the hand-off from the dashboard, chart
 * recommendation / compatibility, and per-viewer persistence. Pure functions, unit-tested.
 */
import type { Scope } from '../domain/public';
import type { MetricDef, StatCatalog, StatisticsResult, StatisticsSpec, StatsFilter } from '../domain/statistics';

export type ChartType = 'bar' | 'hbar' | 'line' | 'stack' | 'stack100' | 'heatmap' | 'scatter' | 'summary';
export const CHART_LABEL: Record<ChartType | 'auto', string> = {
  auto: '자동', bar: '막대', hbar: '가로 막대', line: '꺾은선', stack: '누적 막대', stack100: '100% 누적', heatmap: '히트맵', scatter: '산점도', summary: '요약값',
};

export interface StatsRecipe {
  /** the conditions handed over (period, category, region, agency/manager, law, map range) */
  scope: Scope;
  spec: StatisticsSpec;
  /** member key → display label for the chips of selected targets (labels are not sent to the server) */
  labels: Record<string, string>;
  /** where it came from, shown in the header */
  origin: string;
}

export interface ChartSettings { type: ChartType | 'auto'; primary: string | null; overlay: boolean }
export const DEFAULT_CHART: ChartSettings = { type: 'auto', primary: null, overlay: true };

export const baseSpec = (patch: Partial<StatisticsSpec> = {}): StatisticsSpec => ({
  version: 1, date_basis: 'completed_date', population: 'all', rows: ['agency'], columns: ['law'], metrics: ['fine_rate'],
  filters: [], place_key: null, ...patch,
});

export const PRESETS: Array<{ id: string; label: string; spec: Partial<StatisticsSpec> }> = [
  { id: 'agency_law_fine', label: '기관 × 위반법규 · 과태료처분율', spec: { rows: ['agency'], columns: ['law'], metrics: ['fine_rate', 'completed_count'] } },
  { id: 'month_rates', label: '답변월 추이 · 처리결과 비율', spec: { rows: ['completed_month'], columns: [], metrics: ['accept_rate', 'reject_rate', 'partial_rate', 'fine_rate'] } },
  { id: 'region_outcome', label: '시군구별 · 수용률·과태료처분율', spec: { rows: ['sgg'], columns: [], metrics: ['completed_count', 'accept_rate', 'fine_rate'] } },
  { id: 'manager_duration', label: '담당자별 · 답변·수용률·처리기간', spec: { rows: ['manager'], columns: [], metrics: ['completed_count', 'accept_rate', 'duration_median'] } },
  { id: 'outcome_disposition', label: '처리 결과 × 처분 종류 · 건수', spec: { rows: ['outcome'], columns: ['disposition'], metrics: ['completed_count'] } },
  { id: 'agency_month_fine', label: '기관 × 답변월 · 과태료처분율', spec: { rows: ['agency'], columns: ['completed_month'], metrics: ['fine_rate'] } },
];

/** the dashboard's displayed conditions → a recipe. Agency/manager/region/law stay scope conditions (chips). */
export function handoffRecipe(scope: Scope, opts: { origin: string; placeKey?: string | null; placeLabel?: string | null;
  metrics?: string[]; rows?: string[]; columns?: string[]; population?: StatisticsSpec['population'] } ): StatsRecipe {
  const rows = opts.rows ?? (scope.manager_key ? ['manager'] : scope.agency_key ? ['manager'] : ['agency']);
  const columns = opts.columns ?? (opts.rows ? [] : ['law']);
  return {
    scope: { ...scope },
    spec: baseSpec({ rows, columns, metrics: opts.metrics ?? ['fine_rate', 'completed_count'], place_key: opts.placeKey ?? null,
      population: opts.population ?? 'all' }),
    labels: opts.placeKey && opts.placeLabel ? { [opts.placeKey]: opts.placeLabel } : {},
    origin: opts.origin,
  };
}

// ── chart compatibility (S07) ───────────────────────────────────────────────────────────────────────────
const K_PARTITION = ['accepted_count', 'partial_count', 'rejected_count'];
const C_PARTITION = ['accepted_count', 'partial_count', 'rejected_count', 'unknown_count'];
const DISJOINT = new Set([...C_PARTITION, 'fine_count', 'warning_count', 'penalty_count']);
const isDate = (id: string) => /_(year|quarter|month|day)$/.test(id);
const LONG_NAMES = new Set(['agency', 'manager', 'place', 'law', 'sgg']);

export interface ChartPlan {
  type: ChartType;
  /** metrics drawn (one primary, or several of the same unit when overlaid) */
  metrics: string[];
  /** why a requested type cannot draw this result (shown to the user; the settings are not changed) */
  refusal: string | null;
  compatible: ChartType[];
  /** date axis on x even when the date dimension is the row (display mapping only) */
  note: string | null;
}

export function sameDisjointGroup(ids: string[]): 'K' | 'C' | 'disjoint' | null {
  const set = [...ids].sort().join(',');
  if (set === [...K_PARTITION].sort().join(',')) return 'K';
  if (set === [...C_PARTITION].sort().join(',')) return 'C';
  if (ids.every((m) => DISJOINT.has(m)) && !(ids.some((m) => C_PARTITION.includes(m)) && ids.some((m) => !C_PARTITION.includes(m)))) return 'disjoint';
  return null;
}

export function planChart(spec: StatisticsSpec, catalog: StatCatalog | null, settings: ChartSettings): ChartPlan {
  const metricDef = (id: string): MetricDef | undefined => catalog?.metrics.find((m) => m.id === id);
  const dims = [...spec.rows, ...spec.columns];
  const primary = settings.primary && spec.metrics.includes(settings.primary) ? settings.primary : spec.metrics[0];
  const unit = metricDef(primary)?.unit;
  const sameUnit = spec.metrics.filter((m) => metricDef(m)?.unit === unit);
  const hasDate = dims.some(isDate);
  const compatible: ChartType[] = [];
  if (dims.length === 0) compatible.push('summary');
  if (dims.length === 1) {
    compatible.push('bar', 'hbar');
    if (hasDate) compatible.push('line');
    const group = sameDisjointGroup(spec.metrics);
    if (group) compatible.push('stack');
    if (group === 'K' || group === 'C') compatible.push('stack100');
    if (spec.metrics.length >= 2 && spec.population !== 'compare') compatible.push('scatter');
  }
  if (dims.length === 2) {
    compatible.push('heatmap', 'bar');
    if (hasDate) compatible.push('line');
  }
  if (dims.length >= 3) compatible.push('heatmap');
  const auto: ChartType = dims.length === 0 ? 'summary' : hasDate ? 'line'
    : dims.length >= 2 ? 'heatmap' : LONG_NAMES.has(dims[0]) ? 'hbar' : 'bar';
  const wanted = settings.type === 'auto' ? auto : settings.type;
  let refusal: string | null = null;
  let type = wanted;
  if (!compatible.includes(wanted)) {
    refusal = dims.length >= 3 ? '행·열이 세 개 이상이면 그래프는 앞의 두 차원만 히트맵으로 그립니다. 표로 전체를 보세요.'
      : wanted === 'stack100' ? '100% 누적은 서로 겹치지 않는 건수가 전체를 이룰 때만 씁니다(수용·일부·불수용 = 결과 확인, 여기에 결과 미상을 더하면 답변 완료). 비율이나 겹치는 지표는 더해 100%로 만들지 않습니다.'
        : wanted === 'stack' ? '누적 막대는 서로 겹치지 않는 건수 지표끼리만 쌓습니다. 수용과 과태료, 전체와 내 신고처럼 겹치는 집합은 쌓지 않습니다.'
          : wanted === 'scatter' ? '산점도는 차원 하나에 지표 두 개 이상(같은 관측 단위)이 있을 때 씁니다.'
            : wanted === 'line' ? '꺾은선은 날짜 차원이 있을 때만 씁니다(기관 이름을 추세처럼 잇지 않습니다).'
              : `${CHART_LABEL[wanted]}은(는) 이 행·열 조합에 맞지 않습니다.`;
    type = auto;
  }
  // several metrics of the same unit can be overlaid (e.g. 수용률+과태료처분율 by month); units never mix on one axis
  const overlay = settings.overlay && sameUnit.length > 1 && dims.length === 1 && (type === 'line' || type === 'bar' || type === 'hbar');
  const metrics = type === 'stack' || type === 'stack100' ? spec.metrics : type === 'scatter' ? spec.metrics.slice(0, 2) : overlay ? sameUnit : [primary];
  const note = hasDate && spec.columns.length && !spec.columns.some(isDate) && type === 'line'
    ? '날짜를 가로축에 두고 다른 차원을 선으로 그렸습니다(표의 행·열 설정은 그대로).' : null;
  return { type, metrics, refusal, compatible, note };
}

// ── persistence (per viewer, per tab) ────────────────────────────────────────────────────────────────────
const SESSION_KEY = 'cm-stats-state-v1';
const SAVED_KEY = 'cm-stats-recipes-v1';

export interface StatsSession { draft: StatsRecipe; applied: StatsRecipe | null; chart: ChartSettings; view: 'table' | 'chart'; viewer: string }

export function readSession(viewer: string): StatsSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as StatsSession;
    // another account's conditions (including an address) are never restored
    if (s.viewer !== viewer || !s.draft?.spec) return null;
    return s;
  } catch { return null; }
}
export function writeSession(s: StatsSession): void {
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}
export function clearSession(): void { try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ } }

export interface SavedRecipe { name: string; spec: StatisticsSpec; labels: Record<string, string>; chart: ChartSettings }
export function readSaved(): SavedRecipe[] {
  try { const v = JSON.parse(localStorage.getItem(SAVED_KEY) ?? '[]'); return Array.isArray(v) ? v.slice(0, 20) : []; } catch { return []; }
}
/** saved recipes keep the analysis only: never an address, never 'mine' (a shared browser must not carry them) */
export function saveRecipe(name: string, r: StatsRecipe, chart: ChartSettings): SavedRecipe[] {
  const entry: SavedRecipe = { name: name.slice(0, 40), spec: { ...r.spec, place_key: null, population: r.spec.population === 'all' ? 'all' : 'all' },
    labels: Object.fromEntries(Object.entries(r.labels).filter(([k]) => !k.startsWith('pl1:'))), chart };
  const list = [entry, ...readSaved().filter((x) => x.name !== entry.name)].slice(0, 20);
  try { localStorage.setItem(SAVED_KEY, JSON.stringify(list)); } catch { /* ignore */ }
  return list;
}

export function setFilter(spec: StatisticsSpec, dimension: string, members: string[]): StatisticsSpec {
  const others = spec.filters.filter((f) => f.dimension !== dimension);
  return { ...spec, filters: members.length ? [...others, { dimension, members }] : others };
}
export const filterOf = (spec: StatisticsSpec, dimension: string): StatsFilter | undefined => spec.filters.find((f) => f.dimension === dimension);

/** result lookups keyed by member keys (never by array index) */
export const tupleKey = (key: readonly string[]) => JSON.stringify(key);
export function cellIndex(result: StatisticsResult) {
  const map = new Map<string, StatisticsResult['cells'][number]>();
  for (const c of result.cells) map.set(`${c.side}|${tupleKey(c.row)}|${tupleKey(c.col)}`, c);
  return (side: 'all' | 'mine', row: readonly string[], col: readonly string[]) => map.get(`${side}|${tupleKey(row)}|${tupleKey(col)}`);
}
