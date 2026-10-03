/**
 * ECharts for the analytics cards. Only the modules the cards use are registered (bar, line, heatmap, scatter,
 * grid, tooltip, visualMap, markLine, canvas). `useEChart` separates the chart lifetime (init once per mounted
 * host, dispose on unmount) from data updates (setOption), resizes with its container (ResizeObserver) and
 * re-applies the option when the theme changes. Colours are read from the CSS tokens at option-build time.
 */
import { useEffect, useRef, useState } from 'react';
import type { EChartsType } from 'echarts/core';

let initPromise: Promise<(el: HTMLElement) => EChartsType> | null = null;

export function loadCharts(): Promise<(el: HTMLElement) => EChartsType> {
  initPromise ??= Promise.all([
    import('echarts/core'), import('echarts/charts'), import('echarts/components'), import('echarts/renderers'),
  ]).then(([core, charts, components, renderers]) => {
    core.use([charts.BarChart, charts.LineChart, charts.HeatmapChart, charts.ScatterChart,
      components.GridComponent, components.TooltipComponent, components.VisualMapComponent, components.MarkLineComponent,
      components.DataZoomComponent, components.LegendComponent,
      renderers.CanvasRenderer]);
    return core.init;
  });
  initPromise.catch(() => { initPromise = null; });
  return initPromise;
}

export interface ChartTheme {
  text: string; muted: string; grid: string; surface: string; border: string;
  brand: string; cyan: string; accepted: string; partial: string; rejected: string; unknown: string; fine: string;
  reduced: boolean;
}

export function chartTheme(): ChartTheme {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    text: v('--text', '#f3f3f4'), muted: v('--muted', '#9ea0a4'), grid: v('--grid', 'rgba(148,163,184,.12)'),
    surface: v('--surface', '#131314'), border: v('--border', '#2d2d2f'), brand: v('--brand-ink', '#60a5fa'),
    cyan: v('--cyan', '#06b6d4'), accepted: v('--accepted', '#22c55e'), partial: v('--partial', '#f59e0b'),
    rejected: v('--rejected', '#ef4444'), unknown: v('--unknown', '#6b7280'), fine: v('--fine', '#ec4899'),
    reduced: typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true,
  };
}

export function baseOption(t: ChartTheme) {
  return {
    animationDuration: t.reduced ? 0 : 200,
    animationDurationUpdate: t.reduced ? 0 : 200,
    textStyle: { color: t.text, fontSize: 12 },
    tooltip: { backgroundColor: t.surface, borderColor: t.border, textStyle: { color: t.text, fontSize: 12 }, confine: true },
  };
}

/** dev/e2e only (the calls sit behind import.meta.env.DEV and are stripped from production): live chart instances and
 *  ResizeObservers, so the browser check can prove that switching renderers 20× leaves nothing behind (F01) */
function devCount(name: '__cmChartLive' | '__cmChartObservers' | '__cmChartZoomListeners' | '__cmChartBuilds', d: number) {
  const g = globalThis as unknown as Record<string, number>;
  g[name] = (g[name] ?? 0) + d;
}

/**
 * The host element must be rendered by the SAME component that calls this hook, on every render (F01): the instance
 * is created once when that component mounts and disposed when it unmounts.
 * @param build returns the full option for the current data (called again when `deps` or the theme change)
 * @param onClick optional series click handler (data index + series index)
 * @param events optional extra handlers, bound ONCE per instance (never re-bound per render): `datazoom` fires after
 *   every window change (slider, inside zoom, dispatchAction) and after each setOption; `axis` receives mouse events
 *   on a category axis label (needs `triggerEvent: true` on that axis)
 */
export function useEChart(build: (t: ChartTheme) => Record<string, unknown> | null, deps: readonly unknown[],
  theme: string, onClick?: (params: { dataIndex: number; seriesIndex: number; data: unknown }) => void,
  events?: { datazoom?: (chart: EChartsType) => void; axis?: (chart: EChartsType, e: { type: string; value: unknown }) => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<EChartsType | null>(null);
  const clickRef = useRef(onClick);
  clickRef.current = onClick;
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const [error, setError] = useState<string | null>(null);
  const buildRef = useRef(build);
  buildRef.current = build;
  const dirty = useRef(true);
  const apply = useRef<() => void>(() => {});

  // A CSS-hidden host has no usable size. Retain its instance/state, defer initialization and option work.
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    let dead = false, starting = false;
    let ro: ResizeObserver | null = null;
    const usable = () => !document.hidden && el.clientWidth > 0 && el.clientHeight > 0;
    const update = () => {
      if (dead || !usable()) return;
      const chart = chartRef.current;
      if (!chart) {
        if (starting) return;
        starting = true;
        loadCharts().then(init => {
          starting = false;
          if (dead || !usable()) return;
          const instance = init(el);
          chartRef.current = instance;
          if (import.meta.env.DEV) {
            (el as unknown as { __chart?: EChartsType }).__chart = instance;
            devCount('__cmChartLive', 1);
            devCount('__cmChartZoomListeners', 1);
          }
          instance.on('click', params => {
            const p = params as unknown as { componentType?: string; dataIndex: number; seriesIndex: number; data: unknown; value: unknown };
            if (p.componentType === 'xAxis') eventsRef.current?.axis?.(instance, { type: 'click', value: p.value });
            else clickRef.current?.(p);
          });
          instance.on('mouseover', params => {
            const p = params as unknown as { componentType?: string; value: unknown };
            if (p.componentType === 'xAxis') eventsRef.current?.axis?.(instance, { type: 'mouseover', value: p.value });
          });
          instance.on('datazoom', () => eventsRef.current?.datazoom?.(instance));
          dirty.current = true;
          update();
        }).catch(() => {
          starting = false;
          if (!dead) setError('그래프를 불러오지 못했습니다. 표로 보기를 눌러 주세요.');
        });
        return;
      }
      chart.resize();
      if (!dirty.current) return;
      const option = buildRef.current(chartTheme());
      if (import.meta.env.DEV) devCount('__cmChartBuilds', 1);
      if (option) chart.setOption(option, { notMerge: true });
      else chart.clear();
      dirty.current = false;
      eventsRef.current?.datazoom?.(chart);
    };
    apply.current = update;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(update);
      ro.observe(el);
      if (import.meta.env.DEV) devCount('__cmChartObservers', 1);
    }
    document.addEventListener('visibilitychange', update);
    update();
    return () => {
      dead = true;
      apply.current = () => {};
      document.removeEventListener('visibilitychange', update);
      if (import.meta.env.DEV) {
        if (ro) devCount('__cmChartObservers', -1);
        if (chartRef.current) { devCount('__cmChartLive', -1); devCount('__cmChartZoomListeners', -1); }
        delete (el as unknown as { __chart?: EChartsType }).__chart;
      }
      ro?.disconnect();
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    dirty.current = true;
    apply.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, ...deps]);

  return { hostRef, error, chartRef };
}
