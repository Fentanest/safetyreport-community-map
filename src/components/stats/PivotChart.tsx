import { useMemo } from 'react';
import type { MetricDef, StatCatalog, StatisticsResult, StatValue } from '../../domain/statistics';
import { baseOption, useEChart, type ChartTheme } from '../../lib/charts';
import { cellIndex, planChart, tupleKey, type ChartPlan, type ChartSettings } from '../../state/statistics';
import { fmtStat } from './statFormat';

const MAX_SERIES = 24;
const MAX_CATEGORIES = 400;
const MAX_HEAT = 2500;
const PALETTE = ['#3B82F6', '#14B8A6', '#F97316', '#A855F7', '#EAB308', '#EC4899', '#22C55E', '#0EA5E9', '#EF4444', '#84CC16', '#6366F1', '#F43F5E'];
/** the same member keeps its colour through re-sorting and type switches (hash of the key, not the position) */
export function memberColor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
const SEMANTIC: Record<string, keyof ChartTheme> = {
  accept_rate: 'accepted', accepted_count: 'accepted', reject_rate: 'rejected', rejected_count: 'rejected',
  partial_rate: 'partial', partial_count: 'partial', fine_rate: 'fine', fine_count: 'fine', unknown_count: 'unknown',
};
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
type Point = { value: number | null | [number, number]; sv?: StatValue; row: string[]; col: string[]; name?: string };

export interface ChartModel { plan: ChartPlan; blocked: string | null }

/** S07 chart renderer: the SAME result as the table, encoded by member keys and metric ids. */
export default function PivotChart({ result, catalog, settings, theme, onPick }: {
  result: StatisticsResult;
  catalog: StatCatalog;
  settings: ChartSettings;
  theme: 'dark' | 'light';
  onPick?: (row: string[], col: string[] | null) => void;
}) {
  const plan = useMemo(() => planChart(result.spec, catalog, settings), [result.spec, catalog, settings]);
  const cell = useMemo(() => cellIndex(result), [result]);
  const metric = (id: string): MetricDef | undefined => catalog.metrics.find((m) => m.id === id);
  const sides: Array<'all' | 'mine'> = result.spec.population === 'compare' ? ['all', 'mine'] : [result.spec.population === 'mine' ? 'mine' : 'all'];
  const sideWord = (s: 'all' | 'mine') => (result.spec.population === 'compare' ? (s === 'all' ? ' · 전체' : ' · 내 신고') : '');
  const { rows, columns } = result.spec;
  const oneDim = rows.length + columns.length === 1;
  const members = rows.length ? result.row_members : result.col_members;
  const valueAt = (side: 'all' | 'mine', key: string[], m: string): StatValue | undefined =>
    rows.length ? cell(side, key, [])?.values[m] : result.col_totals.find((t) => t.side === side && tupleKey(t.key) === tupleKey(key))?.values[m];

  // honest limits: too many series/categories are refused with a reason (never silently dropped)
  const blocked = useMemo(() => {
    if (plan.type === 'summary') return null;
    if (plan.type === 'heatmap') {
      const n = result.row_members.length * Math.max(1, result.col_members.length);
      return n > MAX_HEAT ? `히트맵 칸이 ${n.toLocaleString('ko-KR')}개로 한 화면에 그리기 어렵습니다. 비교 대상을 고르거나 표로 보세요.` : null;
    }
    if (oneDim) return members.length > MAX_CATEGORIES ? `항목이 ${members.length.toLocaleString('ko-KR')}개입니다. 비교 대상을 고르면 그래프로 볼 수 있습니다(표에는 전부 있습니다).` : null;
    const seriesCount = (columns.length ? result.col_members.length : result.row_members.length) * plan.metrics.length * sides.length;
    return seriesCount > MAX_SERIES ? `선이 ${seriesCount}개가 됩니다(최대 ${MAX_SERIES}개). 비교 대상이나 지표·집단을 줄여 주세요. 표에는 전부 있습니다.` : null;
  }, [plan, result, oneDim, members.length, columns.length, sides.length]);

  const { hostRef, error } = useEChart((t) => {
    if (blocked || plan.type === 'summary') return null;
    const base = baseOption(t);
    const pctAxis = (unit: string | undefined) => (unit === 'percent' ? { min: 0, max: 100, axisLabel: { color: t.muted, formatter: '{value}%' } } : { min: 0, axisLabel: { color: t.muted } });
    const colorOf = (m: string, key: string) => (plan.metrics.length > 1 || oneDim ? (SEMANTIC[m] ? String(t[SEMANTIC[m]]) : memberColor(m)) : memberColor(key));
    const seriesMetric = new Map<string, string>();

    if (plan.type === 'heatmap') {
      const m = plan.metrics[0];
      const unit = metric(m)?.unit;
      const xs = columns.length ? result.col_members : result.row_members.map((r) => ({ key: r.key.slice(1), label: r.label.slice(1) }));
      const ys = columns.length ? result.row_members : result.row_members.map((r) => ({ key: r.key.slice(0, 1), label: r.label.slice(0, 1) }));
      const xKeys = [...new Map(xs.map((x) => [tupleKey(x.key), x])).values()];
      const yKeys = [...new Map(ys.map((y) => [tupleKey(y.key), y])).values()];
      const data: Array<{ value: [number, number, number | null]; sv: StatValue; row: string[]; col: string[] }> = [];
      yKeys.forEach((y, yi) => xKeys.forEach((x, xi) => {
        const row = columns.length ? y.key : [...y.key, ...x.key];
        const col = columns.length ? x.key : [];
        const v = cell(sides[0], row, col)?.values[m];
        if (v) data.push({ value: [xi, yi, v.value], sv: v, row, col });
      }));
      const max = unit === 'percent' ? 100 : Math.max(1, ...data.map((d) => d.value[2] ?? 0));
      seriesMetric.set(metric(m)?.label ?? m, m);
      return { ...base, grid: { left: 150, right: 24, top: 16, bottom: 90 },
        tooltip: { ...base.tooltip, formatter: (p: { data: { value: [number, number, number | null]; sv: StatValue } }) =>
          `<b>${esc(yKeys[p.data.value[1]].label.join(' · '))}</b> × <b>${esc(xKeys[p.data.value[0]].label.join(' · '))}</b><br/>${esc(metric(m)?.label ?? m)} ${esc(fmtStat(p.data.sv, metric(m)))}` },
        xAxis: { type: 'category', data: xKeys.map((x) => x.label.join(' · ')), axisLabel: { color: t.muted, rotate: 40, width: 90, overflow: 'truncate' } },
        yAxis: { type: 'category', data: yKeys.map((y) => y.label.join(' · ')), inverse: true, axisLabel: { color: t.muted, width: 140, overflow: 'truncate' } },
        visualMap: { min: 0, max, calculable: false, orient: 'horizontal', left: 'center', bottom: 4, textStyle: { color: t.muted },
          inRange: { color: ['#DBEAFE', '#1D4ED8'] }, text: [unit === 'percent' ? '100%' : String(max), '0'] },
        series: [{ id: `heatmap:${m}:${sides[0]}`, name: metric(m)?.label ?? m, type: 'heatmap', data, label: { show: data.length <= 120, color: '#0B1220', fontSize: 10,
          formatter: (p: { data: { sv: StatValue } }) => fmtStat(p.data.sv, metric(m), false) } }] };
    }

    if (plan.type === 'scatter') {
      const [mx, my] = plan.metrics;
      const data = members.map((mb) => {
        const vx = valueAt(sides[0], mb.key, mx), vy = valueAt(sides[0], mb.key, my);
        return vx?.value != null && vy?.value != null ? { value: [vx.value, vy.value] as [number, number], name: mb.label.join(' · '), row: rows.length ? mb.key : [], col: rows.length ? [] : mb.key, vx, vy } : null;
      }).filter((x): x is NonNullable<typeof x> => x !== null);
      return { ...base, grid: { left: 56, right: 24, top: 24, bottom: 48 },
        tooltip: { ...base.tooltip, formatter: (p: { data: (typeof data)[number] }) => `<b>${esc(p.data.name)}</b><br/>${esc(metric(mx)?.label ?? mx)} ${esc(fmtStat(p.data.vx, metric(mx)))}<br/>${esc(metric(my)?.label ?? my)} ${esc(fmtStat(p.data.vy, metric(my)))}` },
        xAxis: { type: 'value', name: metric(mx)?.label, nameLocation: 'middle', nameGap: 28, ...pctAxis(metric(mx)?.unit), splitLine: { lineStyle: { color: t.grid } } },
        yAxis: { type: 'value', name: metric(my)?.label, ...pctAxis(metric(my)?.unit), splitLine: { lineStyle: { color: t.grid } } },
        series: [{ type: 'scatter', symbolSize: 12, itemStyle: { color: t.brand }, data }] };
    }

    // category charts (bar/hbar/line/stack/stack100)
    let categories: string[];
    const series: Array<Record<string, unknown>> = [];
    const horizontal = plan.type === 'hbar';
    if (oneDim) {
      categories = members.map((mb) => mb.label.join(' · '));
      for (const m of plan.metrics) for (const s of sides) {
        const name = `${metric(m)?.label ?? m}${sideWord(s)}`;
        seriesMetric.set(name, m);
        const raw = members.map((mb) => ({ sv: valueAt(s, mb.key, m), key: mb.key }));
        const data: Point[] = raw.map((r, i) => ({ value: r.sv?.value ?? null, sv: r.sv, row: rows.length ? r.key : [], col: rows.length ? [] : r.key, name: categories[i] }));
        const color = colorOf(m, m);
        series.push({ id: `${m}:${s}`, name, type: plan.type === 'line' ? 'line' : 'bar', data, connectNulls: false, smooth: false,
          stack: plan.type === 'stack' || plan.type === 'stack100' ? s : undefined,
          lineStyle: s === 'mine' ? { type: 'dashed', color } : { color }, itemStyle: { color, ...(s === 'mine' && plan.type !== 'line' ? { opacity: 0.55, borderColor: color, borderType: 'dashed', borderWidth: 1 } : {}) },
          symbol: s === 'mine' ? 'diamond' : 'circle' });
      }
      if (plan.type === 'stack100') {
        // share of the partition's own total per category (K or C); an empty category gets no bar
        for (const s of sides) {
          const own = series.filter((x) => String(x.id).endsWith(`:${s}`));
          members.forEach((_, i) => {
            const sum = own.reduce((a, x) => a + (((x.data as Point[])[i].value as number | null) ?? 0), 0);
            for (const x of own) { const p = (x.data as Point[])[i]; p.value = sum > 0 && typeof p.value === 'number' ? (p.value / sum) * 100 : null; }
          });
        }
      }
    } else {
      // two dimensions with a date: dates on the x axis, the other dimension as lines (display mapping only)
      const dateIsCol = columns.some((c) => /_(year|quarter|month|day)$/.test(c));
      const xs = dateIsCol ? result.col_members : result.row_members;
      const lines = dateIsCol ? result.row_members : result.col_members;
      categories = xs.map((x) => x.label.join(' · '));
      for (const ln of lines) for (const m of plan.metrics) for (const s of sides) {
        const name = `${ln.label.join(' · ')} · ${metric(m)?.label ?? m}${sideWord(s)}`;
        seriesMetric.set(name, m);
        const data: Point[] = xs.map((x, i) => {
          const row = dateIsCol ? ln.key : x.key, col = dateIsCol ? x.key : ln.key;
          const sv = cell(s, row, col)?.values[m];
          return { value: sv?.value ?? null, sv, row, col, name: categories[i] };
        });
        const color = memberColor(tupleKey(ln.key));
        series.push({ id: `${tupleKey(ln.key)}:${m}:${s}`, name, type: plan.type === 'line' ? 'line' : 'bar', data, connectNulls: false, smooth: false,
          lineStyle: { color, type: s === 'mine' ? 'dashed' : 'solid' }, itemStyle: { color }, symbol: s === 'mine' ? 'diamond' : 'circle' });
      }
    }
    const unit = plan.type === 'stack100' ? 'percent' : metric(plan.metrics[0])?.unit;
    const catAxis = { type: 'category', data: categories, axisLabel: { color: t.muted, width: horizontal ? 150 : 90, overflow: 'truncate', rotate: horizontal ? 0 : categories.length > 8 ? 35 : 0 } };
    const valAxis = { type: 'value', ...pctAxis(unit), splitLine: { lineStyle: { color: t.grid } } };
    return { ...base,
      grid: { left: horizontal ? 160 : 56, right: 24, top: 36, bottom: horizontal ? 32 : 72 },
      legend: { top: 0, type: 'scroll', selectedMode: false, textStyle: { color: t.muted } },
      tooltip: { ...base.tooltip, trigger: 'axis', formatter: (ps: Array<{ seriesName: string; data: Point; name: string }>) =>
        [`<b>${esc(ps[0]?.name ?? '')}</b>`, ...ps.map((p) => `${esc(p.seriesName)} ${esc(plan.type === 'stack100' && p.data?.value != null ? `${(p.data.value as number).toFixed(1)}% · ${fmtStat(p.data.sv, metric(seriesMetric.get(p.seriesName) ?? ''), false)}` : fmtStat(p.data?.sv, metric(seriesMetric.get(p.seriesName) ?? '')))}`)].join('<br/>') },
      xAxis: horizontal ? valAxis : catAxis, yAxis: horizontal ? { ...catAxis, inverse: true } : valAxis,
      ...(categories.length > 30 && !horizontal ? { dataZoom: [{ type: 'inside' }, { type: 'slider', height: 14, bottom: 6 }] } : {}),
      series };
  }, [result, plan, blocked, catalog], theme, (p) => {
    const d = p.data as Point | { row: string[]; col: string[] } | undefined;
    if (d && 'row' in d && onPick) onPick(d.row, d.col.length ? d.col : null);
  });

  if (plan.type === 'summary') {
    return (
      <div className="stats-summary">
        {result.spec.metrics.map((m) => (
          <div key={m} className="pe-box"><span className="pe-label">{metric(m)?.label}</span>
            {sides.map((s) => <b key={s} className="pe-num cm-number">{sideWord(s) ? `${sideWord(s).slice(3)} ` : ''}{fmtStat(result.grand_totals.find((x) => x.side === s)?.values[m], metric(m))}</b>)}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="pivot-chart">
      {plan.refusal && <p className="scope-note" role="note">{plan.refusal} 지금은 {plan.type === 'heatmap' ? '히트맵' : '추천 그래프'}로 그렸습니다.</p>}
      {plan.note && <p className="cm-muted chart-caption">{plan.note}</p>}
      {blocked && <div className="empty-state" role="note">{blocked}</div>}
      <div ref={hostRef} className="chart-host stats-chart-host" hidden={!!blocked || !!error} role="img"
        aria-label={`${result.spec.metrics.map((m) => metric(m)?.label).join('·')} 그래프. 같은 수치를 표로 볼 수 있습니다.`} />
      {error && <div className="empty-state" role="alert">{error}</div>}
    </div>
  );
}
