import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { init, use } from 'echarts/core';
import { HeatmapChart } from 'echarts/charts';
import { GridComponent, VisualMapComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import { heatmapLabel } from '../../src/lib/heatmapLabels';
import { rampColor } from '../../src/lib/kakao';
import type { ChartTheme } from '../../src/lib/charts';
import type { LawHeatmap } from '../../src/domain/public';

const capture = vi.hoisted(() => ({ build: null as null | ((t: ChartTheme) => Record<string, unknown>) }));
vi.mock('../../src/lib/charts', () => ({
  baseOption: () => ({}),
  useEChart: (build: typeof capture.build) => { capture.build = build; return { hostRef: { current: null }, error: null }; },
}));
import { HeatmapCard } from '../../src/components/AnalyticsCharts';

const themes = {
  light: { text: '#0f172a', surface: '#ffffff' },
  dark: { text: '#f3f3f4', surface: '#131314' },
};
// Independent WCAG calculation against both hex tokens and ECharts' rendered rgb fills.
function luminance(color: string) {
  const rgb = color.startsWith('#') ? color.slice(1).match(/../g)!.map((v) => parseInt(v, 16)) : color.match(/[\d.]+/g)!.slice(0, 3).map(Number);
  return rgb.map((v) => v / 255).map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
}
function ratio(a: string, b: string) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

describe('기관 × 위반법규: 과태료 기본값과 칸 대비', () => {
  for (const [name, theme] of Object.entries(themes)) {
    it(`${name}: every displayed 0.1% step and missing value meets 4.5:1`, () => {
      for (const percent of [null, ...Array.from({ length: 1001 }, (_, i) => i / 10)]) {
        const label = heatmapLabel(percent, theme);
        expect(ratio(label.color, label.backgroundColor ?? rampColor(percent === null ? null : percent / 100))).toBeGreaterThanOrEqual(4.5);
        expect([theme.text, theme.surface]).toContain(label.color);
      }
    });
  }
  it('defaults to fine, maps percentage rather than answer count, and renders contrasting labels in ECharts', () => {
    use([HeatmapChart, GridComponent, VisualMapComponent, SVGRenderer]);
    const percentages = [0, 25, 50, 55, 60, 65, 70, 75, 100];
    const data: LawHeatmap = {
      row_kind: 'agency', rows: [{ key: 'a', agency_key: 'a', agency_name: '시험 기관', manager_key: null, manager_name: null, completed_count: 9000 }],
      laws: percentages.map((p) => ({ law_key: `법 제${p}조`, completed_count: 1000 })), total_rows: 1, total_laws: percentages.length,
      cells: percentages.map((p) => ({ row_key: 'a', law_key: `법 제${p}조`, completed_count: 1000, fine_count: p * 10,
        outcomes: { accepted: 1000, partial: 0, rejected: 0, result_known: 1000, result_unknown: 0 } })),
    };
    const html = renderToStaticMarkup(<HeatmapCard data={data} theme="light" onPick={() => {}} />);
    expect(html).toContain('aria-pressed="true">과태료</button>');
    for (const theme of Object.values(themes)) {
      const option = capture.build!({ ...theme, muted: theme.text, grid: theme.surface } as ChartTheme);
      const chart = init(null, undefined, { renderer: 'svg', ssr: true, width: 1000, height: 400 });
      try {
        chart.setOption(option);
        const rendered = (chart.getOption().series as Array<{ data: Array<{ value: number[]; label: ReturnType<typeof heatmapLabel> }> }>)[0].data;
        // The card shows seven columns before expansion.
        for (let i = 0; i < 7; i++) {
          const label = rendered[i].label;
          const fill = chart.getVisual({ seriesIndex: 0, dataIndex: i }, 'color') as string;
          expect(ratio(label.color, label.backgroundColor ?? fill)).toBeGreaterThanOrEqual(4.5);
          expect(rendered[i].value[2]).toBe(percentages[i]);
        }
        expect(chart.renderToSVGString()).toContain('60%');
      } finally { chart.dispose(); }
    }
  });
});
