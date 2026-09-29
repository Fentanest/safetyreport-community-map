/**
 * F06 adapter: the APPLIED 맞춤 통계 result (+ its recipe, the chart settings and the legend state at click time) →
 * ExportSnapshot. Uses the same chart semantics as the web chart (statsChartModel) and the same row order as the
 * table (sortedRowMembers). Totals are the server's (recomputed from raw facts), never summed here or in Excel.
 */
import type { MetricDef, StatCatalog, StatisticsResult, StatValue } from '../../domain/statistics';
import { CHART_LABEL, cellIndex, planChart, sortedRowMembers, tupleKey, type ChartSettings, type RowSort } from '../../state/statistics';
import { cartesianModel, heatmapAxes, heatmapMax, scatterModel, sidesOf, type SeriesColor, type Side } from '../../state/statsChartModel';
import type { ExportSnapshot, XCategoryChart, XChart, XColumn, XRef, XRow, XSeries, XUnit } from '../model';

/** colours of the light document (the web theme is not copied into the file) */
export const FILE_COLOR = { accepted: '#16A34A', partial: '#F59E0B', rejected: '#DC2626', fine: '#DB2777', unknown: '#6B7280', brand: '#2563EB', cyan: '#0891B2' } as const;
export const fileColor = (c: SeriesColor) => ('hex' in c ? c.hex : FILE_COLOR[c.token]);
const REASON: Record<NonNullable<StatValue['reason']>, string> = { zero_denominator: '계산 불가', no_data: '자료 없음' };
const NONE = '—';
const CHUNK = 50;

export interface StatisticsExportInput {
  result: StatisticsResult;
  catalog: StatCatalog;
  chart: ChartSettings;
  sort: RowSort;
  hidden: readonly string[];
  includeHidden: boolean;
  /** 조회 조건 rows computed by the page from the APPLIED recipe (dates, conditions, address label …) */
  conditions: Array<{ label: string; value: string }>;
  title: string;
  capturedAt: string;
}

export function statisticsSnapshot(input: StatisticsExportInput): ExportSnapshot {
  const { result, catalog } = input;
  const metric = (id: string): MetricDef | undefined => catalog.metrics.find((m) => m.id === id);
  const dimLabel = (id: string) => catalog.dimensions.find((d) => d.id === id)?.label ?? id;
  const sides = sidesOf(result);
  const sideLabel = (s: Side) => (result.spec.population === 'compare' ? (s === 'all' ? '전체' : '내 신고') : '');
  const cell = cellIndex(result);
  const { rows: rowDims, columns: colDims, metrics } = result.spec;
  const hasRows = rowDims.length > 0, hasCols = colDims.length > 0;
  const rowTotal = new Map(result.row_totals.map((t) => [`${t.side}|${tupleKey(t.key)}`, t]));
  const colTotal = new Map(result.col_totals.map((t) => [`${t.side}|${tupleKey(t.key)}`, t]));
  const grand = (s: Side) => result.grand_totals.find((t) => t.side === s);

  // every value of a metric (cells and totals): decides whether 분자/분모 columns exist and whether value = 분자/분모
  const allValues = (m: string): StatValue[] => [
    ...result.cells.map((c) => c.values[m]), ...result.row_totals.map((t) => t.values[m]), ...result.col_totals.map((t) => t.values[m]), ...result.grand_totals.map((t) => t.values[m]),
  ].filter((v): v is StatValue => !!v);
  const parts = new Map(metrics.map((m) => {
    const vals = allValues(m);
    const unit = metric(m)?.unit ?? 'count';
    const hasNum = vals.some((v) => v.numerator !== null), hasDen = vals.some((v) => v.denominator !== null);
    const scale = unit === 'percent' ? 100 : 1;
    // a mean (e.g. 평균 별점 = 점수 합 ÷ 평가 수) is a quotient too: written as a formula only if every value agrees
    const quotient = hasNum && hasDen && vals.every((v) => v.value === null || v.numerator === null || v.denominator === null || v.denominator === 0
      || Math.abs((v.numerator / v.denominator) * scale - v.value) <= 1e-9 * Math.max(1, Math.abs(v.value)));
    return [m, { hasNum, hasDen, quotient, unit }];
  }));

  // ── columns ───────────────────────────────────────────────────────────────────────────────────────────────
  const columns: XColumn[] = hasRows
    ? rowDims.map((d, i) => ({ id: `lab:${i}`, header: [dimLabel(d)], unit: 'text', label: true, width: 24 }))
    : [{ id: 'lab:0', header: ['구분'], unit: 'text', label: true, width: 14 }];
  const colHead = hasCols ? result.col_members.map((c) => ({ key: tupleKey(c.key), label: c.label.join(' · ') })) : [{ key: tupleKey([]), label: '' }];
  const groups = [...colHead, ...(hasCols && hasRows ? [{ key: '__rowtotal__', label: '행 합계' }] : [])];
  const levels = (g: string, m: string, s: Side, sub: string) => [g, metric(m)?.label ?? m, sideLabel(s), sub];
  for (const g of groups) for (const m of metrics) for (const s of sides) {
    const p = parts.get(m)!;
    const base = `${g.key}|${m}|${s}`;
    const unit = p.unit as XUnit;
    const valueCol: XColumn = { id: `${base}|v`, header: levels(g.label, m, s, unit === 'percent' ? '비율' : '값'), unit };
    if (p.quotient && p.hasNum && p.hasDen) valueCol.rate = { num: `${base}|n`, den: `${base}|d` };
    columns.push(valueCol);
    if (p.hasNum) columns.push({ id: `${base}|n`, header: levels(g.label, m, s, unit === 'percent' ? '해당 건수' : '합계'), unit: unit === 'percent' ? 'count' : unit });
    if (p.hasDen) columns.push({ id: `${base}|d`, header: levels(g.label, m, s, '기준 건수'), unit: 'count' });
  }

  // ── rows ──────────────────────────────────────────────────────────────────────────────────────────────────
  const put = (row: XRow, base: string, m: string, v: StatValue | undefined) => {
    const unit = parts.get(m)!.unit;
    if (!v) { row.reasons![`${base}|v`] = NONE; return; }
    if (v.numerator !== null) row.cells[`${base}|n`] = v.numerator;
    if (v.denominator !== null) row.cells[`${base}|d`] = v.denominator;
    if (v.value === null) { row.reasons![`${base}|v`] = v.reason ? REASON[v.reason] : NONE; return; }
    row.cells[`${base}|v`] = unit === 'percent' ? v.value / 100 : v.value;
  };
  const rows: XRow[] = [];
  const members = hasRows ? sortedRowMembers(result, input.sort) : [];
  for (const r of members) {
    const row: XRow = { id: tupleKey(r.key), cells: {}, reasons: {} };
    r.label.forEach((l, i) => { row.cells[`lab:${i}`] = l; });
    for (const g of colHead) for (const m of metrics) for (const s of sides) {
      const colKey = JSON.parse(g.key) as string[];
      put(row, `${g.key}|${m}|${s}`, m, cell(s, r.key, colKey)?.values[m]);
    }
    if (hasCols) for (const m of metrics) for (const s of sides) put(row, `__rowtotal__|${m}|${s}`, m, rowTotal.get(`${s}|${tupleKey(r.key)}`)?.values[m]);
    rows.push(row);
  }
  const total: XRow = { id: '__total__', cells: { 'lab:0': '합계' }, reasons: {}, total: true };
  for (const g of colHead) for (const m of metrics) for (const s of sides) {
    put(total, `${g.key}|${m}|${s}`, m, hasCols ? colTotal.get(`${s}|${g.key}`)?.values[m] : grand(s)?.values[m]);
  }
  if (hasCols && hasRows) for (const m of metrics) for (const s of sides) put(total, `__rowtotal__|${m}|${s}`, m, grand(s)?.values[m]);
  rows.push(total);

  const notes = [
    '합계는 칸을 더하거나 평균 낸 값이 아니라, 해당 신고 전체로 다시 계산한 값입니다. 예를 들어 1건 중 1건(100%)과 99건 중 9건(9.1%)을 합치면 100건 중 10건, 10%입니다.',
    '비율은 같은 줄의 ‘해당 건수 ÷ 기준 건수’로 계산하는 수식입니다. 기준 건수가 0이면 계산하지 않고 ‘계산 불가’로 적었습니다.',
    '중앙값, 상위 90% 값, 서로 다른 개수처럼 이 파일의 숫자로 다시 계산할 수 없는 값은 계산된 결과를 그대로 넣었습니다.',
    `‘${NONE}’는 해당하는 답변 신고가 없다는 뜻입니다(0이 아님).`,
    ...(result.spec.population === 'compare' ? ['내 신고는 전체에 포함되므로 둘을 더하지 않습니다. ‘내 신고’는 이 파일을 내려받은 계정의 신고입니다.'] : []),
    ...(result.spec.population === 'mine' ? ['‘내 신고’는 이 파일을 내려받은 계정의 신고입니다. 다른 사람이 이 파일을 열어도 바뀌지 않습니다.'] : []),
  ];

  // ── charts (the same plan and the same series as the web chart) ──────────────────────────────────────────
  const plan = planChart(result.spec, catalog, input.chart);
  const hiddenSet = new Set(input.hidden);
  const rowIdOf = (row: string[]) => (hasRows ? tupleKey(row) : '__total__');
  const refOf = (row: string[], col: string[], m: string, s: Side): XRef => ({ row: rowIdOf(row), col: `${tupleKey(col)}|${m}|${s}|v` });
  const charts: XChart[] = [];
  let chartNotice: string | null = null;
  const unitOf = (m: string) => (metric(m)?.unit ?? 'count') as XUnit;
  const blockedReason = chartBlockedReason(result, plan);
  const refusal = plan.refusal ? `${plan.refusal} 그래서 이 파일에도 화면과 같은 그래프(${CHART_LABEL[plan.type]})를 넣었습니다.` : undefined;
  if (plan.type === 'summary') {
    chartNotice = '행과 열을 고르지 않은 숫자 요약이라 차트는 넣지 않았습니다. 결과는 ‘통계표’ 시트의 합계 줄에 있습니다.';
  } else if (blockedReason) {
    chartNotice = `${blockedReason} 모든 숫자는 ‘통계표’ 시트에 있습니다.`;
  } else if (plan.type === 'heatmap') {
    const m = plan.metrics[0];
    const { xs, ys, rowOf, colOf } = heatmapAxes(result);
    const pct = unitOf(m) === 'percent';
    const max = pct ? 1 : heatmapMax(result, catalog, m);
    for (const s of sides) {
      charts.push({ kind: 'heatmap', id: `heatmap:${m}:${s}`, title: `${metric(m)?.label ?? m}${sideLabel(s) ? ` · ${sideLabel(s)}` : ''} 히트맵`,
        unit: unitOf(m), min: 0, max, rowTitle: hasCols ? rowDims.map(dimLabel).join(' · ') : dimLabel(rowDims[0]),
        rows: ys.map((y) => y.label.join(' · ')), cols: xs.map((x) => x.label.join(' · ')),
        cells: ys.map((y) => xs.map((x) => (cell(s, rowOf(y.key, x.key), colOf(x.key))?.values[m] ? refOf(rowOf(y.key, x.key), colOf(x.key), m, s) : null))),
        note: `색은 값에 따라 자동으로 칠해집니다(숫자를 고치면 색도 바뀝니다). 색 기준 ${pct ? '0~100%' : `0~${max.toLocaleString('ko-KR')}${sides.length > 1 ? '(전체와 내 신고 같은 기준)' : ''}`}. 빈 칸은 해당하는 신고가 없다는 뜻입니다(0이 아님).${sides.length > 1 ? ' 전체 표와 내 신고 표는 행·열 순서가 같습니다.' : ''}${refusal ? ` ${refusal}` : ''}` });
    }
  } else if (plan.type === 'scatter') {
    const sm = scatterModel(result, plan)!;
    charts.push({ kind: 'scatter', id: `scatter:${sm.x}:${sm.y}`, title: `${metric(sm.x)?.label ?? sm.x} × ${metric(sm.y)?.label ?? sm.y}`,
      xName: metric(sm.x)?.label ?? sm.x, yName: metric(sm.y)?.label ?? sm.y, xUnit: unitOf(sm.x), yUnit: unitOf(sm.y),
      points: sm.points.map((p) => ({ label: p.label, x: refOf(p.row, p.col, sm.x, sm.side), y: refOf(p.row, p.col, sm.y, sm.side) })),
      note: `점 하나가 ${hasRows ? rowDims.map(dimLabel).join('·') : colDims.map(dimLabel).join('·')} 하나입니다. 두 값이 모두 있는 것만 그렸습니다.${refusal ? ` ${refusal}` : ''}` });
  } else {
    const model = cartesianModel(result, catalog, plan)!;
    const kind: XCategoryChart['kind'] = model.type === 'line' ? 'line' : model.type === 'hbar' ? 'bar' : model.type === 'bar' ? 'col' : 'colStacked';
    const pct = model.unit === 'percent';
    const series: XSeries[] = model.series.map((s) => ({
      key: s.key, name: s.name, color: fileColor(s.color), dashed: s.dashed, marker: s.side === 'mine' ? 'diamond' : 'circle', hidden: hiddenSet.has(s.key),
      points: s.points.map((p) => (p.sv ? refOf(p.row, p.col, s.metric, s.side) : null)),
      ...(model.type === 'stack100' ? { shareOf: s.points.map((_, i) => {
        const refs = model.series.filter((o) => o.side === s.side).flatMap((o) => (o.points[i].sv ? [refOf(o.points[i].row, o.points[i].col, o.metric, o.side)] : []));
        return refs.length ? refs : null;
      }) } : {}),
    }));
    const note = [
      model.type === 'stack100' ? '막대 전체(100%)는 숨긴 항목까지 합친 건수입니다. 숨긴 항목이 있으면 막대가 100%까지 차지 않습니다.' : '',
      model.type === 'line' ? '값이 없는 구간은 선을 끊었습니다(0으로 잇지 않음). 0%로 찍힌 점은 실제로 0인 경우입니다.' : '',
      plan.note ?? '', refusal ?? '',
    ].filter(Boolean).join(' ');
    const categories = model.categories.map((c) => c.label);
    const chunks = kind === 'line' || categories.length <= CHUNK + 10 ? [[0, categories.length]] : Array.from({ length: Math.ceil(categories.length / CHUNK) }, (_, i) => [i * CHUNK, Math.min(categories.length, (i + 1) * CHUNK)]);
    const title = `${plan.metrics.map((m) => metric(m)?.label ?? m).join('·')} · ${CHART_LABEL[plan.type]}`;
    chunks.forEach(([a, b], i) => charts.push({
      kind, id: `cat:${plan.type}:${i}`, title: chunks.length > 1 ? `${title} (${a + 1}–${b} / ${categories.length})` : title,
      categoryTitle: hasRows ? rowDims.map(dimLabel).join(' · ') : colDims.map(dimLabel).join(' · '),
      categories: categories.slice(a, b), unit: pct ? 'percent' : model.unit as XUnit, axis: pct ? { min: 0, max: 1 } : { min: 0 },
      series: series.map((s) => ({ ...s, points: s.points.slice(a, b), ...(s.shareOf ? { shareOf: s.shareOf.slice(a, b) } : {}) })),
      note: `${note}${chunks.length > 1 ? ` 항목이 많아 ${CHUNK}개씩 나눠 그렸습니다(빠진 항목 없음).` : ''}`.trim() || undefined,
    }));
    if (series.length > 0 && series.every((s) => s.hidden) && !input.includeHidden) chartNotice = '화면에서 모든 항목을 숨긴 상태로 내려받았습니다(0건이라는 뜻이 아닙니다). 숫자는 통계표와 차트 데이터 시트에 모두 있습니다.';
  }
  const hiddenNames = plan.type === 'heatmap' || plan.type === 'scatter' || plan.type === 'summary' ? []
    : (cartesianModel(result, catalog, plan)?.series ?? []).filter((s) => hiddenSet.has(s.key)).map((s) => s.name);

  // compared targets: names and counts of THIS response only; an unconfirmed key is counted, never named (EX-54)
  const targets = result.spec.filters.map((f) => {
    const list = result.filter_members.filter((m) => m.dimension === f.dimension);
    const shown = list.filter((m) => m.status !== 'unconfirmed').map((m) => `${m.label ?? '이름 없음'}${m.status === 'zero' ? '(현재 조건 0건)' : ` ${m.count.toLocaleString('ko-KR')}건`}`);
    const unconfirmed = list.filter((m) => m.status === 'unconfirmed').length;
    return `${dimLabel(f.dimension)}: ${shown.join(', ') || '없음'}${unconfirmed ? ` · 이 기간에 확인할 수 없는 대상 ${unconfirmed}개는 결과에서 뺐습니다` : ''}`;
  });
  const conditions = [...input.conditions];
  const at = conditions.findIndex((c) => c.label === '지표');
  conditions.splice(at < 0 ? conditions.length : at + 1, 0, { label: '비교 대상', value: targets.length ? targets.join(' / ') : '고르지 않음 (전체)' });

  return {
    schema: 1, source: 'statistics', fileStem: '커뮤니티신고지도_맞춤통계', title: input.title, capturedAt: input.capturedAt,
    datasetVersion: result.dataset_version, conditions,
    table: { columns, rows, notes }, charts, chartNotice,
    legend: { hidden: hiddenNames, includeHidden: input.includeHidden },
  };
}

function chartBlockedReason(result: StatisticsResult, plan: ReturnType<typeof planChart>): string | null {
  if (plan.type === 'summary') return null;
  const sides = sidesOf(result).length;
  const { rows, columns } = result.spec;
  if (plan.type === 'heatmap') {
    const n = result.row_members.length * Math.max(1, result.col_members.length);
    return n > 2500 ? `히트맵 칸이 ${n.toLocaleString('ko-KR')}개나 되어 차트 시트에는 넣지 않았습니다.` : null;
  }
  if (rows.length + columns.length === 1) return null; // many categories are split into several charts instead
  const seriesCount = (columns.length ? result.col_members.length : result.row_members.length) * plan.metrics.length * sides;
  return seriesCount > 24 ? `선이 ${seriesCount}개나 되어(최대 24개) 차트는 넣지 않았습니다. 비교 대상이나 지표를 줄이면 넣을 수 있습니다.` : null;
}
