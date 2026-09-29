/**
 * 맞춤 통계 page state (S04–S08): recipes (what to compute), presets, the hand-off from the dashboard, chart
 * recommendation / compatibility, and per-viewer persistence. Pure functions, unit-tested.
 */
import type { Scope } from '../domain/public';
import type { MetricDef, StatCatalog, StatisticsResult, StatisticsSpec, StatsFilter } from '../domain/statistics';

export type ChartType = 'bar' | 'hbar' | 'line' | 'stack' | 'stack100' | 'heatmap' | 'scatter' | 'summary';
export const CHART_LABEL: Record<ChartType | 'auto', string> = {
  auto: '자동', bar: '막대', hbar: '가로 막대', line: '꺾은선', stack: '누적 막대', stack100: '100% 누적', heatmap: '히트맵', scatter: '산점도', summary: '숫자 요약',
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
  { id: 'agency_law_fine', label: '기관 × 위반법규 · 과태료 부과율', spec: { rows: ['agency'], columns: ['law'], metrics: ['fine_rate', 'completed_count'] } },
  { id: 'month_rates', label: '답변월 추이 · 처리결과 비율', spec: { rows: ['completed_month'], columns: [], metrics: ['accept_rate', 'reject_rate', 'partial_rate', 'fine_rate'] } },
  { id: 'region_outcome', label: '시군구별 · 수용률·과태료 부과율', spec: { rows: ['sgg'], columns: [], metrics: ['completed_count', 'accept_rate', 'fine_rate'] } },
  { id: 'manager_duration', label: '담당자별 · 답변·수용률·처리기간', spec: { rows: ['manager'], columns: [], metrics: ['completed_count', 'accept_rate', 'duration_median'] } },
  { id: 'outcome_disposition', label: '처리 결과 × 처분 종류 · 건수', spec: { rows: ['outcome'], columns: ['disposition'], metrics: ['completed_count'] } },
  { id: 'agency_month_fine', label: '기관 × 답변월 · 과태료 부과율', spec: { rows: ['agency'], columns: ['completed_month'], metrics: ['fine_rate'] } },
];

/** One basis per recipe: the spec's explicit date_basis is the scope's too (an old recipe or saved session without a
 *  scope basis keeps its own explicit spec basis — never silently moved to 답변일). */
export function normalizeRecipe<T extends { scope: Scope; spec: StatisticsSpec }>(r: T): T {
  return r.scope.date_basis === r.spec.date_basis ? r : { ...r, scope: { ...r.scope, date_basis: r.spec.date_basis } };
}

/** the dashboard's displayed conditions → a recipe. Agency/manager/region/law stay scope conditions (chips). */
export function handoffRecipe(scope: Scope, opts: { origin: string; placeKey?: string | null; placeLabel?: string | null;
  metrics?: string[]; rows?: string[]; columns?: string[]; population?: StatisticsSpec['population'] } ): StatsRecipe {
  const rows = opts.rows ?? (scope.manager_key ? ['manager'] : scope.agency_key ? ['manager'] : ['agency']);
  const columns = opts.columns ?? (opts.rows ? [] : ['law']);
  return {
    scope: { ...scope },
    // D09: the dashboard's ONE date basis is handed over as the recipe's basis (never reset to 답변일)
    spec: baseSpec({ date_basis: scope.date_basis, rows, columns, metrics: opts.metrics ?? ['fine_rate', 'completed_count'], place_key: opts.placeKey ?? null,
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
    refusal = dims.length >= 3 ? '행과 열을 합쳐 세 개 이상 고르면 그래프에는 앞의 두 개만 히트맵으로 그립니다. 전체는 표에서 보세요.'
      : wanted === 'stack100' ? '100% 누적은 수용·일부 수용·불수용 건수처럼, 서로 겹치지 않고 합하면 전체가 되는 건수에만 쓸 수 있습니다.'
        : wanted === 'stack' ? '누적 막대는 서로 겹치지 않는 건수끼리만 쌓을 수 있습니다. 수용과 과태료처럼 같은 신고가 두 번 세어지는 조합은 쌓지 않습니다.'
          : wanted === 'scatter' ? '산점도는 행이나 열을 하나만 고르고 지표를 두 개 이상 고를 때 쓸 수 있습니다.'
            : wanted === 'line' ? '꺾은선은 월·연도 같은 날짜 항목이 있을 때만 쓸 수 있습니다.'
              : `지금 행·열 설정에서는 ${CHART_LABEL[wanted]} 그래프를 쓸 수 없습니다.`;
    type = auto;
  }
  // several metrics of the same unit can be overlaid (e.g. 수용률+과태료 부과율 by month); units never mix on one axis
  const overlay = settings.overlay && sameUnit.length > 1 && dims.length === 1 && (type === 'line' || type === 'bar' || type === 'hbar');
  const metrics = type === 'stack' || type === 'stack100' ? spec.metrics : type === 'scatter' ? spec.metrics.slice(0, 2) : overlay ? sameUnit : [primary];
  const note = hasDate && spec.columns.length && !spec.columns.some(isDate) && type === 'line'
    ? '날짜를 가로축에 두고 나머지 항목을 선으로 그렸습니다. 표의 행·열은 그대로입니다.' : null;
  return { type, metrics, refusal, compatible, note };
}

// ── persistence (per viewer, per tab) ────────────────────────────────────────────────────────────────────
// C01: v2 is keyed by the account-id hash (sessionKeyOf). v1 was keyed by a nickname-based string: it is removed,
// never migrated to whoever is signed in now.
const SESSION_KEY = 'cm-stats-state-v2';
const SAVED_PREFIX = 'cm-stats-recipes-v2:';
const LEGACY_KEYS = ['cm-stats-state-v1', 'cm-stats-recipes-v1'];
export function dropLegacyStatsStorage(): void {
  for (const k of LEGACY_KEYS) {
    try { sessionStorage.removeItem(k); } catch { /* ignore */ }
    try { localStorage.removeItem(k); } catch { /* ignore */ }
  }
}

export interface StatsSession { draft: StatsRecipe; applied: StatsRecipe | null; chart: ChartSettings; view: 'table' | 'chart'; viewer: string; hidden?: string[] }

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
/** saved recipes belong to one account on this browser (another account signing in here does not see them) */
export function readSaved(viewer: string): SavedRecipe[] {
  try { const v = JSON.parse(localStorage.getItem(SAVED_PREFIX + viewer) ?? '[]'); return Array.isArray(v) ? v.slice(0, 20) : []; } catch { return []; }
}
/** saved recipes keep the analysis only: never an address, never 'mine' (a shared browser must not carry them) */
export function saveRecipe(viewer: string, name: string, r: StatsRecipe, chart: ChartSettings): SavedRecipe[] {
  const entry: SavedRecipe = { name: name.slice(0, 40), spec: { ...r.spec, place_key: null, population: 'all' },
    labels: Object.fromEntries(Object.entries(r.labels).filter(([k]) => !k.startsWith('pl1:'))), chart };
  const list = [entry, ...readSaved(viewer).filter((x) => x.name !== entry.name)].slice(0, 20);
  try { localStorage.setItem(SAVED_PREFIX + viewer, JSON.stringify(list)); } catch { /* ignore */ }
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

export type RowSort = { metric: string | null; dir: 'asc' | 'desc' };
/** the table's row order (display + Excel): by the first population's row total (with columns) or row value;
 *  unknown values last in both directions; otherwise the server order */
export function sortedRowMembers(result: StatisticsResult, sort: RowSort): StatisticsResult['row_members'] {
  const list = [...result.row_members];
  if (!sort.metric) return list;
  const side = result.spec.population === 'mine' ? 'mine' : 'all';
  const cell = cellIndex(result);
  const rowTotal = new Map(result.row_totals.map((t) => [`${t.side}|${tupleKey(t.key)}`, t]));
  const val = (key: string[]) => (result.spec.columns.length ? rowTotal.get(`${side}|${tupleKey(key)}`)?.values[sort.metric!]?.value
    : cell(side, key, [])?.values[sort.metric!]?.value) ?? null;
  return list.sort((a, b) => {
    const va = val(a.key), vb = val(b.key);
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    return sort.dir === 'desc' ? vb - va : va - vb;
  });
}
