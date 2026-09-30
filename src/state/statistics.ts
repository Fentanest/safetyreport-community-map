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

/** The chart types offered in the type picker, in menu order ('summary' is only ever chosen automatically). */
export const PICKER_TYPES = ['bar', 'hbar', 'line', 'stack', 'stack100', 'heatmap', 'scatter'] as const;
export type PickerType = typeof PICKER_TYPES[number];

/**
 * Whether one chart type can draw the current settings, and why not. Computed by the same judgment as
 * ChartPlan.compatible (planChart derives `compatible` from this), so the picker text can never disagree with the chart.
 *  - reason: first line — what in the current settings blocks it (with the actual items chosen)
 *  - fix: second line — what the user can change, or that the view is not provided (`supported: false`)
 */
export interface ChartAvailability { ok: boolean; reason: string | null; fix: string | null; supported: boolean }

export interface ChartPlan {
  type: ChartType;
  /** metrics drawn (one primary, or several of the same unit when overlaid) */
  metrics: string[];
  /** why a requested type cannot draw this result (shown to the user; the settings are not changed) */
  refusal: string | null;
  compatible: ChartType[];
  /** per picker type: available or the reason it is not (same rules as `compatible`) */
  availability: Record<PickerType, ChartAvailability>;
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

const OK: ChartAvailability = { ok: true, reason: null, fix: null, supported: true };
const no = (reason: string, fix: string | null, supported = true): ChartAvailability => ({ ok: false, reason, fix, supported });
const joinKo = (xs: string[]) => xs.join('·');
/** 은/는 by the final syllable (labels ending in a digit or Latin letter read as 은 only when they end in a consonant sound; default 는) */
const topic = (word: string) => {
  const c = word.trim().slice(-1).charCodeAt(0);
  const batchim = c >= 0xac00 && c <= 0xd7a3 ? (c - 0xac00) % 28 !== 0 : /[013678LMNR]$/i.test(word.trim());
  return `${word}${batchim ? '은' : '는'}`;
};

/** availability of every picker type for these settings (the single source of the compatibility rules) */
export function chartAvailability(spec: StatisticsSpec, catalog: StatCatalog | null): Record<PickerType, ChartAvailability> {
  const dimLabel = (id: string) => catalog?.dimensions.find((d) => d.id === id)?.label ?? id;
  const metricDef = (id: string): MetricDef | undefined => catalog?.metrics.find((m) => m.id === id);
  const metricLabel = (id: string) => metricDef(id)?.label ?? id;
  const dims = [...spec.rows, ...spec.columns];
  const n = dims.length;
  const names = joinKo(dims.map(dimLabel));
  const hasDate = dims.some(isDate);
  const counted = n >= 2 ? `${names}, 총 ${n}개 기준으로 나누고 있습니다.` : n === 1 ? `${names} 1개 기준으로 나누고 있습니다.` : '분류 기준(행·열 항목)이 없습니다.';
  const needOne = '행 또는 열에 항목을 하나 추가하세요.';
  const group = sameDisjointGroup(spec.metrics);
  const notCounts = spec.metrics.filter((m) => !DISJOINT.has(m));
  const mixesOutcomeAndDisposition = notCounts.length === 0 && spec.metrics.some((m) => C_PARTITION.includes(m)) && spec.metrics.some((m) => !C_PARTITION.includes(m));
  const countsOnly = '수용·일부 수용·불수용·결과 미상·과태료·계도·범칙금 건수처럼 서로 겹치지 않는 건수만 고르세요.';
  const onlyOneDim = (label: string) => (n === 0 ? no(counted, needOne)
    : no(counted, `${label}는 분류 기준 1개에서 쓸 수 있습니다. 행·열 항목을 1개로 줄이면 볼 수 있습니다.`));

  const bar = n === 1 || n === 2 ? OK : n === 0 ? no(counted, needOne)
    : no(counted, `막대는 2개 기준까지 지원합니다. 항목을 2개 이하로 줄이거나 표·히트맵으로 보세요.`);
  const hbar = n === 1 ? OK : onlyOneDim('가로 막대');
  const line = (n === 1 || n === 2) && hasDate ? OK
    : n === 0 ? no(counted, '행 또는 열에 신고 월·답변 월 같은 날짜 항목을 추가하세요.')
      : n >= 3 ? no(counted, '꺾은선은 날짜 항목을 포함해 2개 기준까지 지원합니다. 표·히트맵으로 보세요.')
        : no(`${topic(names)} 날짜 항목이 아닙니다.`, '꺾은선을 쓰려면 행 또는 열에 연도·분기·월·일 같은 날짜 항목을 추가하세요.');
  const stack = n !== 1 ? onlyOneDim('누적 막대')
    : group ? OK
      : notCounts.length ? no(`${topic(joinKo(notCounts.map(metricLabel)))} 건수가 아니라 쌓을 수 없습니다.`, countsOnly)
        : mixesOutcomeAndDisposition ? no('처리 결과 건수와 처분 건수는 같은 신고를 두 번 세므로 함께 쌓지 않습니다.', '처리 결과(수용·일부 수용·불수용·결과 미상)나 처분(과태료·계도·범칙금) 중 한쪽만 고르세요.')
          : no('선택한 건수가 서로 겹칩니다.', countsOnly);
  const stack100 = n !== 1 ? onlyOneDim('100% 누적')
    : group === 'K' || group === 'C' ? OK
      : notCounts.length ? no(`${topic(joinKo(notCounts.map(metricLabel)))} 비율·통계 지표라 100% 누적에 쓸 수 없습니다.`,
        '수용·일부 수용·불수용 건수(결과 미상까지 넣으면 답변 전체)처럼 합하면 하나의 전체가 되는 건수를 함께 고르세요.')
        : no(`${joinKo(spec.metrics.map(metricLabel))}${spec.metrics.length > 1 ? ' 건수를 합해도' : '만으로는'} 하나의 전체가 되지 않습니다.`,
          '수용·일부 수용·불수용 건수(결과 미상까지 넣으면 답변 전체)를 함께 고르세요.');
  const scatter = spec.population === 'compare'
    ? no('전체와 내 신고를 비교하는 중에는 산점도를 쓸 수 없습니다.', '보기 대상을 전체 또는 내 신고 하나로 바꾸면 쓸 수 있습니다.')
    : n !== 1 ? onlyOneDim('산점도')
      : spec.metrics.length < 2 ? no(`숫자 지표가 ${spec.metrics.length}개입니다.`, '산점도는 가로·세로 축에 쓸 숫자 지표가 2개 이상 필요합니다. 지표를 하나 더 고르세요.')
        : OK;
  const heatmap = n >= 2 ? OK : no(counted, n === 0 ? '히트맵은 행과 열에 항목이 하나씩 필요합니다.' : '히트맵은 행과 열에 항목이 하나씩 필요합니다. 하나를 더 추가하세요.');
  return { bar, hbar, line, stack, stack100, heatmap, scatter };
}

export function planChart(spec: StatisticsSpec, catalog: StatCatalog | null, settings: ChartSettings): ChartPlan {
  const metricDef = (id: string): MetricDef | undefined => catalog?.metrics.find((m) => m.id === id);
  const dims = [...spec.rows, ...spec.columns];
  const primary = settings.primary && spec.metrics.includes(settings.primary) ? settings.primary : spec.metrics[0];
  const unit = metricDef(primary)?.unit;
  const sameUnit = spec.metrics.filter((m) => metricDef(m)?.unit === unit);
  const hasDate = dims.some(isDate);
  const availability = chartAvailability(spec, catalog);
  // `compatible` is derived from the same availability the picker shows (never a second rule set)
  const compatible: ChartType[] = [...(dims.length === 0 ? ['summary' as const] : []),
    ...(['bar', 'hbar', 'line', 'stack', 'stack100', 'scatter', 'heatmap'] as const).filter((t) => availability[t].ok)];
  const auto: ChartType = dims.length === 0 ? 'summary' : hasDate ? 'line'
    : dims.length >= 2 ? 'heatmap' : LONG_NAMES.has(dims[0]) ? 'hbar' : 'bar';
  const wanted = settings.type === 'auto' ? auto : settings.type;
  let refusal: string | null = null;
  let type = wanted;
  if (!compatible.includes(wanted)) {
    const a = wanted === 'summary' ? null : availability[wanted];
    refusal = a ? `${CHART_LABEL[wanted]}: ${a.reason}${a.fix ? ` ${a.fix}` : ''}` : `${CHART_LABEL[wanted]} 그래프를 쓸 수 없습니다.`;
    type = auto;
  }
  // several metrics of the same unit can be overlaid (e.g. 수용률+과태료 부과율 by month); units never mix on one axis
  const overlay = settings.overlay && sameUnit.length > 1 && dims.length === 1 && (type === 'line' || type === 'bar' || type === 'hbar');
  const metrics = type === 'stack' || type === 'stack100' ? spec.metrics : type === 'scatter' ? spec.metrics.slice(0, 2) : overlay ? sameUnit : [primary];
  const note = hasDate && spec.columns.length && !spec.columns.some(isDate) && type === 'line'
    ? '날짜를 가로축에 두고 나머지 항목을 선으로 그렸습니다. 표의 행·열은 그대로입니다.'
    : type === 'heatmap' && dims.length >= 3 ? `히트맵에는 앞의 두 기준(${joinKo(dims.slice(0, 2).map((d) => catalog?.dimensions.find((x) => x.id === d)?.label ?? d))})만 그립니다. 전체는 표에서 보세요.` : null;
  return { type, metrics, refusal, compatible, availability, note };
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
