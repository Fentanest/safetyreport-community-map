import { useMemo } from 'react';
import type { MetricDef, StatCatalog, StatisticsResult, StatValue } from '../../domain/statistics';
import { baseOption, useEChart, type ChartTheme } from '../../lib/charts';
import { planChart, type ChartPlan, type ChartSettings } from '../../state/statistics';
import {
  cartesianModel, effectiveHidden, heatmapAxes, heatmapCells, heatmapMax, scatterModel, shareOf, sidesOf, sideWord,
  type CartesianModel, type SeriesColor, type Side,
} from '../../state/statsChartModel';
import { fmtStat } from './statFormat';

export { heatmapAxes, heatmapCells } from '../../state/statsChartModel';

const MAX_SERIES = 24;
const MAX_CATEGORIES = 400;
const MAX_HEAT = 2500;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const colorOf = (c: SeriesColor, t: ChartTheme) => ('hex' in c ? c.hex : c.token === 'brand' ? t.brand : String(t[c.token]));
type Point = { value: number | null | [number, number]; sv?: StatValue; row: string[]; col: string[]; name?: string };
type Pick = (row: string[], col: string[] | null) => void;

/** why a chart of this plan is not drawn (too many series/categories), with the reason shown to the user */
export function chartBlocked(result: StatisticsResult, plan: ChartPlan): string | null {
  if (plan.type === 'summary') return null;
  const sides = sidesOf(result);
  const { rows, columns } = result.spec;
  if (plan.type === 'heatmap') {
    const n = result.row_members.length * Math.max(1, result.col_members.length);
    return n > MAX_HEAT ? `히트맵 칸이 ${n.toLocaleString('ko-KR')}개로 한 화면에 그리기 어렵습니다. 비교 대상을 고르거나 표로 보세요.` : null;
  }
  if (rows.length + columns.length === 1) {
    const members = rows.length ? result.row_members : result.col_members;
    return members.length > MAX_CATEGORIES ? `항목이 ${members.length.toLocaleString('ko-KR')}개입니다. 비교 대상을 고르면 그래프로 볼 수 있습니다(표에는 전부 있습니다).` : null;
  }
  const seriesCount = (columns.length ? result.col_members.length : result.row_members.length) * plan.metrics.length * sides.length;
  return seriesCount > MAX_SERIES ? `선이 ${seriesCount}개가 됩니다(최대 ${MAX_SERIES}개). 비교 대상이나 지표·집단을 줄여 주세요. 표에는 전부 있습니다.` : null;
}

/**
 * S07 chart of the SAME result as the table. F01: every renderer below owns its own host element and its own ECharts
 * instance (useEChart inside the component that renders the host), so switching 히트맵 ↔ 막대 ↔ 요약값 mounts a fresh
 * renderer with a live chart instead of reusing an instance bound to a host that is no longer (or not yet) in the DOM.
 * F03: `hidden` (stable series keys) is presentation only — the table, totals, denominators and requests never change.
 */
export default function PivotChart({ result, catalog, settings, theme, hidden, onHidden, onPick }: {
  result: StatisticsResult;
  catalog: StatCatalog;
  settings: ChartSettings;
  theme: 'dark' | 'light';
  hidden: readonly string[];
  onHidden: (keys: string[]) => void;
  onPick?: Pick;
}) {
  const plan = useMemo(() => planChart(result.spec, catalog, settings), [result.spec, catalog, settings]);
  const blocked = useMemo(() => chartBlocked(result, plan), [result, plan]);
  const model = useMemo(() => (blocked ? null : cartesianModel(result, catalog, plan)), [result, catalog, plan, blocked]);
  const kind = plan.type === 'summary' ? 'summary' : blocked ? 'blocked' : plan.type === 'heatmap' ? 'heatmap' : plan.type === 'scatter' ? 'scatter' : 'cartesian';
  return (
    <div className="pivot-chart" data-renderer={kind}>
      {plan.refusal && <p className="scope-note" role="note">{plan.refusal} 지금은 {plan.type === 'heatmap' ? '히트맵' : '추천 그래프'}로 그렸습니다.</p>}
      {plan.note && kind === 'cartesian' && <p className="cm-muted chart-caption">{plan.note}</p>}
      {kind === 'summary' && <SummaryView result={result} catalog={catalog} />}
      {kind === 'blocked' && <div className="empty-state" role="note">{blocked}</div>}
      {kind === 'heatmap' && <HeatmapPair result={result} catalog={catalog} metricId={plan.metrics[0]} theme={theme} onPick={onPick} />}
      {kind === 'scatter' && <ScatterChart result={result} catalog={catalog} plan={plan} theme={theme} onPick={onPick} />}
      {kind === 'cartesian' && model && (
        <CartesianChart result={result} catalog={catalog} model={model} theme={theme} hidden={effectiveHidden(model, hidden)} onHidden={onHidden} onPick={onPick} />
      )}
    </div>
  );
}

function SummaryView({ result, catalog }: { result: StatisticsResult; catalog: StatCatalog }) {
  const metric = (id: string): MetricDef | undefined => catalog.metrics.find((m) => m.id === id);
  const sides = sidesOf(result);
  return (
    <div className="stats-summary">
      {result.spec.metrics.map((m) => (
        <div key={m} className="pe-box"><span className="pe-label">{metric(m)?.label}</span>
          {sides.map((s) => <b key={s} className="pe-num cm-number">{sideWord(result, s) ? `${sideWord(result, s).slice(3)} ` : ''}{fmtStat(result.grand_totals.find((x) => x.side === s)?.values[m], metric(m))}</b>)}
        </div>
      ))}
    </div>
  );
}

/** F03 series legend: buttons (click / Enter / Space), keyed by the stable series key, never by the display name */
export function SeriesLegend({ series, hidden, onHidden, theme }: {
  series: Array<{ key: string; name: string; color: string; dashed: boolean }>;
  hidden: readonly string[];
  onHidden: (keys: string[]) => void;
  theme?: string;
}) {
  const hiddenSet = new Set(hidden);
  const toggle = (key: string) => onHidden(hiddenSet.has(key) ? hidden.filter((k) => k !== key) : [...hidden, key]);
  return (
    <div className="series-legend" role="group" aria-label="그래프 계열 표시 (표·합계에는 영향 없음)" data-theme-name={theme}>
      {series.map((s) => (
        <button key={s.key} type="button" className={`series-toggle${hiddenSet.has(s.key) ? ' off' : ''}`} aria-pressed={!hiddenSet.has(s.key)}
          data-series-key={s.key} title={hiddenSet.has(s.key) ? '누르면 다시 표시합니다' : '누르면 그래프에서 숨깁니다(표·합계는 그대로)'} onClick={() => toggle(s.key)}>
          <i className={s.dashed ? 'dash' : 'dot'} style={s.dashed ? { borderColor: s.color } : { background: s.color }} aria-hidden="true" />{s.name}
        </button>
      ))}
      {hidden.length > 0 && <button type="button" className="link-btn" onClick={() => onHidden([])}>전체 보기</button>}
    </div>
  );
}

function CartesianChart({ result, catalog, model, theme, hidden, onHidden, onPick }: {
  result: StatisticsResult; catalog: StatCatalog; model: CartesianModel; theme: 'dark' | 'light';
  hidden: string[]; onHidden: (keys: string[]) => void; onPick?: Pick;
}) {
  const metric = (id: string): MetricDef | undefined => catalog.metrics.find((m) => m.id === id);
  const allHidden = model.series.length > 0 && hidden.length === model.series.length;
  const hiddenKey = hidden.join('|');
  const { hostRef, error } = useEChart((t) => {
    const hiddenSet = new Set(hidden);
    const shown = model.series.filter((s) => !hiddenSet.has(s.key));
    if (shown.length === 0) return null;
    const base = baseOption(t);
    const pctAxis = (unit: string) => (unit === 'percent' ? { min: 0, max: 100, axisLabel: { color: t.muted, formatter: '{value}%' } } : { min: 0, axisLabel: { color: t.muted } });
    const horizontal = model.type === 'hbar';
    const categories = model.categories.map((c) => c.label);
    const byId = new Map(model.series.map((s) => [s.key, s]));
    const series = shown.map((s) => {
      const color = colorOf(s.color, t);
      const data: Point[] = s.points.map((p, i) => ({ value: model.type === 'stack100' ? shareOf(model, s, i) : p.sv?.value ?? null, sv: p.sv, row: p.row, col: p.col, name: categories[i] }));
      return { id: s.key, name: s.name, type: model.type === 'line' ? 'line' : 'bar', data, connectNulls: false, smooth: false,
        stack: model.type === 'stack' || model.type === 'stack100' ? s.side : undefined,
        lineStyle: { color, type: s.dashed ? 'dashed' : 'solid' },
        itemStyle: { color, ...(s.dashed && model.type !== 'line' ? { opacity: 0.55, borderColor: color, borderType: 'dashed', borderWidth: 1 } : {}) },
        symbol: s.side === 'mine' ? 'diamond' : 'circle' };
    });
    const catAxis = { type: 'category', data: categories, axisLabel: { color: t.muted, width: horizontal ? 150 : 90, overflow: 'truncate', rotate: horizontal ? 0 : categories.length > 8 ? 35 : 0 } };
    // 100% stacks keep the ORIGINAL partition as 100% (a hidden part leaves a gap; the rest is never re-normalised)
    const valAxis = { type: 'value', ...pctAxis(model.unit), splitLine: { lineStyle: { color: t.grid } } };
    return { ...base,
      grid: { left: horizontal ? 160 : 56, right: 24, top: 16, bottom: horizontal ? 32 : 72 },
      legend: { show: false },
      tooltip: { ...base.tooltip, trigger: 'axis', formatter: (ps: Array<{ seriesId: string; data: Point; name: string }>) =>
        [`<b>${esc(ps[0]?.name ?? '')}</b>`, ...ps.map((p) => {
          const s = byId.get(p.seriesId);
          const m = metric(s?.metric ?? '');
          return `${esc(s?.name ?? '')} ${esc(model.type === 'stack100' && p.data?.value != null ? `${(p.data.value as number).toFixed(1)}% · ${fmtStat(p.data.sv, m, false)}` : fmtStat(p.data?.sv, m))}`;
        })].join('<br/>') },
      xAxis: horizontal ? valAxis : catAxis, yAxis: horizontal ? { ...catAxis, inverse: true } : valAxis,
      ...(categories.length > 30 && !horizontal ? { dataZoom: [{ type: 'inside' }, { type: 'slider', height: 14, bottom: 6 }] } : {}),
      series };
  }, [result, model, hiddenKey], theme, (p) => {
    const d = p.data as Point | undefined;
    if (d && 'row' in d && onPick) onPick(d.row, d.col.length ? d.col : null);
  });
  const legendItems = model.series.map((s) => ({ key: s.key, name: s.name, dashed: s.dashed,
    color: 'hex' in s.color ? s.color.hex : `var(--${s.color.token === 'brand' ? 'brand-ink' : s.color.token})` }));
  return (
    <>
      {model.series.length > 1 && <SeriesLegend series={legendItems} hidden={hidden} onHidden={onHidden} theme={theme} />}
      {allHidden && (
        <div className="empty-state" role="note">
          <span>표시할 항목을 선택해 주세요. 모든 계열을 그래프에서 숨겼습니다(표와 합계에는 그대로 있습니다).</span>
          <button type="button" className="ghost-btn" onClick={() => onHidden([])}>전체 보기</button>
        </div>
      )}
      <div ref={hostRef} className="chart-host stats-chart-host" hidden={!!error || allHidden} role="img"
        aria-label={`${result.spec.metrics.map((m) => metric(m)?.label).join('·')} 그래프. 같은 수치를 표로 볼 수 있습니다.`} />
      {model.type === 'stack100' && hidden.length > 0 && !allHidden && (
        <p className="chart-caption">숨긴 계열만큼 막대가 비어 있습니다. 100%는 원래 분모(숨긴 항목 포함)이며 남은 항목을 다시 100%로 늘리지 않았습니다.</p>
      )}
      {error && <div className="empty-state" role="alert">{error}</div>}
    </>
  );
}

function ScatterChart({ result, catalog, plan, theme, onPick }: { result: StatisticsResult; catalog: StatCatalog; plan: ChartPlan; theme: 'dark' | 'light'; onPick?: Pick }) {
  const metric = (id: string): MetricDef | undefined => catalog.metrics.find((m) => m.id === id);
  const model = useMemo(() => scatterModel(result, plan), [result, plan]);
  const { hostRef, error } = useEChart((t) => {
    if (!model) return null;
    const base = baseOption(t);
    const pctAxis = (unit: string | undefined) => (unit === 'percent' ? { min: 0, max: 100, axisLabel: { color: t.muted, formatter: '{value}%' } } : { min: 0, axisLabel: { color: t.muted } });
    const { x: mx, y: my } = model;
    const data = model.points.map((p) => ({ value: [p.vx.value!, p.vy.value!] as [number, number], name: p.label, row: p.row, col: p.col, vx: p.vx, vy: p.vy }));
    return { ...base, grid: { left: 56, right: 24, top: 24, bottom: 48 },
      tooltip: { ...base.tooltip, formatter: (p: { data: (typeof data)[number] }) => `<b>${esc(p.data.name)}</b><br/>${esc(metric(mx)?.label ?? mx)} ${esc(fmtStat(p.data.vx, metric(mx)))}<br/>${esc(metric(my)?.label ?? my)} ${esc(fmtStat(p.data.vy, metric(my)))}` },
      xAxis: { type: 'value', name: metric(mx)?.label, nameLocation: 'middle', nameGap: 28, ...pctAxis(metric(mx)?.unit), splitLine: { lineStyle: { color: t.grid } } },
      yAxis: { type: 'value', name: metric(my)?.label, ...pctAxis(metric(my)?.unit), splitLine: { lineStyle: { color: t.grid } } },
      series: [{ id: `scatter:${mx}:${my}`, type: 'scatter', symbolSize: 12, itemStyle: { color: t.brand }, data }] };
  }, [result, model], theme, (p) => {
    const d = p.data as { row: string[]; col: string[] } | undefined;
    if (d && onPick) onPick(d.row, d.col.length ? d.col : null);
  });
  return (
    <>
      <div ref={hostRef} className="chart-host stats-chart-host" hidden={!!error} role="img"
        aria-label={`${plan.metrics.map((m) => metric(m)?.label).join('·')} 산점도. 같은 수치를 표로 볼 수 있습니다.`} />
      {error && <div className="empty-state" role="alert">{error}</div>}
    </>
  );
}

/** C02: compare = two heatmaps (전체 · 내 신고) side by side (stacked on narrow screens), same axes, same scale:
 *  0–100% for rates; for counts/amounts one common 0..max over BOTH populations (stated under the charts). */
function HeatmapPair({ result, catalog, metricId, theme, onPick }: {
  result: StatisticsResult; catalog: StatCatalog; metricId: string; theme: 'dark' | 'light'; onPick?: Pick;
}) {
  const m = catalog.metrics.find((x) => x.id === metricId);
  const sides = sidesOf(result);
  const per = sides.map((side) => ({ side, data: heatmapCells(result, side, metricId) }));
  const max = heatmapMax(result, catalog, metricId);
  const compare = sides.length > 1;
  return (
    <>
      <div className={`heatmap-pair${compare ? ' compare' : ''}`}>
        {per.map((p) => (
          <HeatmapSide key={p.side} result={result} metric={m} metricId={metricId} data={p.data} max={max} theme={theme} onPick={onPick}
            title={compare ? (p.side === 'all' ? '전체' : '내 신고') : null} side={p.side} />
        ))}
      </div>
      {compare && <p className="chart-caption">왼쪽(위) 전체, 오른쪽(아래) 내 신고 · 같은 행·열 순서와 같은 색 척도({m?.unit === 'percent' ? '0~100%' : `0~${max.toLocaleString('ko-KR')} 두 집단 공통`}) · 빈 칸은 그 집단에 해당 신고가 없다는 뜻입니다(0 아님).</p>}
      <p className="chart-caption">히트맵의 색 막대는 값의 척도입니다(계열을 켜고 끄는 범례가 아닙니다).</p>
    </>
  );
}

function HeatmapSide({ result, metric, metricId, data, max, theme, title, side, onPick }: {
  result: StatisticsResult; metric: MetricDef | undefined; metricId: string; side: Side;
  data: ReturnType<typeof heatmapCells>; max: number; theme: 'dark' | 'light'; title: string | null; onPick?: Pick;
}) {
  const { xs, ys } = heatmapAxes(result);
  const { hostRef, error } = useEChart((t) => {
    const base = baseOption(t);
    return { ...base, grid: { left: 150, right: 16, top: 12, bottom: 90 },
      tooltip: { ...base.tooltip, formatter: (p: { data: { value: [number, number, number | null]; sv: StatValue } }) =>
        `<b>${esc(ys[p.data.value[1]].label.join(' · '))}</b> × <b>${esc(xs[p.data.value[0]].label.join(' · '))}</b><br/>${title ? `${esc(title)} · ` : ''}${esc(metric?.label ?? metricId)} ${esc(fmtStat(p.data.sv, metric))}` },
      xAxis: { type: 'category', data: xs.map((x) => x.label.join(' · ')), axisLabel: { color: t.muted, rotate: 40, width: 90, overflow: 'truncate' } },
      yAxis: { type: 'category', data: ys.map((y) => y.label.join(' · ')), inverse: true, axisLabel: { color: t.muted, width: 140, overflow: 'truncate' } },
      visualMap: { min: 0, max, calculable: false, orient: 'horizontal', left: 'center', bottom: 4, textStyle: { color: t.muted },
        inRange: { color: ['#DBEAFE', '#1D4ED8'] }, text: [metric?.unit === 'percent' ? '100%' : String(max), '0'] },
      series: [{ id: `heatmap:${metricId}:${side}`, name: `${title ? `${title} · ` : ''}${metric?.label ?? metricId}`, type: 'heatmap', data,
        label: { show: data.length <= 120, color: '#0B1220', fontSize: 10, formatter: (p: { data: { sv: StatValue } }) => fmtStat(p.data.sv, metric, false) } }] };
  }, [result, data, max, metricId], theme, (p) => {
    const d = p.data as { row: string[]; col: string[] } | undefined;
    if (d && onPick) onPick(d.row, d.col.length ? d.col : null);
  });
  return (
    <figure className="heatmap-side" data-side={side}>
      {title && <figcaption>{title}{data.length === 0 ? ' · 이 조건의 신고 없음' : ''}</figcaption>}
      <div ref={hostRef} className="chart-host stats-chart-host" role="img" hidden={!!error}
        aria-label={`${title ?? ''} ${metric?.label ?? metricId} 히트맵. 같은 수치를 표로 볼 수 있습니다.`} />
      {error && <div className="empty-state" role="alert">{error}</div>}
    </figure>
  );
}
