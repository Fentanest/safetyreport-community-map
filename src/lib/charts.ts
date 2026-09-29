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
      components.DataZoomComponent,
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

/**
 * @param build returns the full option for the current data (called again when `deps` or the theme change)
 * @param onClick optional series click handler (data index + series index)
 */
export function useEChart(build: (t: ChartTheme) => Record<string, unknown> | null, deps: readonly unknown[],
  theme: string, onClick?: (params: { dataIndex: number; seriesIndex: number; data: unknown }) => void) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<EChartsType | null>(null);
  const clickRef = useRef(onClick);
  clickRef.current = onClick;
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // lifetime: one instance per mounted host
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    let dead = false;
    let ro: ResizeObserver | null = null;
    loadCharts().then((init) => {
      if (dead) return;
      const chart = init(el);
      chartRef.current = chart;
      chart.on('click', (params) => clickRef.current?.(params as unknown as { dataIndex: number; seriesIndex: number; data: unknown }));
      if (typeof ResizeObserver !== 'undefined') {
        ro = new ResizeObserver(() => chart.resize());
        ro.observe(el);
      }
      setReady(true);
    }).catch(() => { if (!dead) setError('그래프를 불러오지 못했습니다. 표로 보기를 눌러 주세요.'); });
    return () => {
      dead = true;
      ro?.disconnect();
      chartRef.current?.dispose();
      chartRef.current = null;
      setReady(false);
    };
  }, []);

  // data/theme updates: setOption only
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !ready) return;
    const option = build(chartTheme());
    if (option) chart.setOption(option, { notMerge: true });
    else chart.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, theme, ...deps]);

  return { hostRef, error };
}
