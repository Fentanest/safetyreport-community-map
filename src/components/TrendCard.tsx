import { useEffect, useRef, useState } from 'react';
import type { ComposeOption, EChartsType } from 'echarts/core';
import type { LineSeriesOption } from 'echarts/charts';
import type { GridComponentOption, TooltipComponentOption } from 'echarts/components';
import type { MonthlyBucket } from '../domain/public';
import type { CompareMonth } from '../domain/personal';
import { fmtDays, fmtInt, fmtMonth } from './format';
import Icon from './icons';

type TrendOption = ComposeOption<LineSeriesOption | GridComponentOption | TooltipComponentOption>;

let registered = false;

async function loadChartInit(): Promise<(el: HTMLElement) => EChartsType> {
  const [{ init, use }, { LineChart }, { GridComponent, TooltipComponent }, { CanvasRenderer }] =
    await Promise.all([
      import('echarts/core'),
      import('echarts/charts'),
      import('echarts/components'),
      import('echarts/renderers'),
    ]);
  if (!registered) {
    use([LineChart, GridComponent, TooltipComponent, CanvasRenderer]);
    registered = true;
  }
  return init;
}

export default function TrendCard({ monthly, theme, mine = null }: {
  monthly: MonthlyBucket[];
  theme: 'dark' | 'light';
  /** personal monthly series for the same scope/version (dashed), or null when comparison is off */
  mine?: CompareMonth[] | null;
}) {
  const mineByMonth = new Map((mine ?? []).map((m) => [m.month, m]));
  const hostRef = useRef<HTMLDivElement>(null);
  const [table, setTable] = useState(false);
  const [chartError, setChartError] = useState<string | null>(null);

  useEffect(() => {
    if (table || !hostRef.current || monthly.length === 0) return;
    const el = hostRef.current;
    let chart: EChartsType | null = null;
    let dead = false;
    const reduced =
      typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    loadChartInit()
      .then((init) => {
        if (dead) return;
        const css = getComputedStyle(document.documentElement);
        const text = css.getPropertyValue('--text').trim() || '#f3f3f4';
        const muted = css.getPropertyValue('--muted').trim() || '#9ea0a4';
        const grid = css.getPropertyValue('--grid').trim() || 'rgba(148,163,184,.12)';
        const surface = css.getPropertyValue('--surface').trim() || '#131314';
        const border = css.getPropertyValue('--border').trim() || '#2d2d2f';
        const brandInk = css.getPropertyValue('--brand-ink').trim() || '#0D6EFD';
        const cyan = css.getPropertyValue('--cyan').trim() || '#06B6D4';
        chart = init(el);
        const option: TrendOption = {
          animationDuration: reduced ? 0 : 220,
          textStyle: { color: text, fontSize: 12 },
          grid: { left: 48, right: 16, top: 16, bottom: 30 },
          tooltip: {
            trigger: 'axis',
            backgroundColor: surface,
            borderColor: border,
            textStyle: { color: text, fontSize: 12 },
          },
          xAxis: {
            type: 'category',
            data: monthly.map((m) => fmtMonth(m.month)),
            axisLine: { lineStyle: { color: grid } },
            axisLabel: { color: muted },
          },
          yAxis: {
            type: 'value',
            min: 0,
            splitLine: { lineStyle: { color: grid } },
            axisLabel: { color: muted },
          },
          series: [
            {
              name: '신고',
              type: 'line',
              data: monthly.map((m) => m.report_count),
              connectNulls: false,
              showSymbol: true,
              symbolSize: 7,
              lineStyle: { width: 2.5, color: brandInk },
              itemStyle: { color: brandInk },
              areaStyle: { color: brandInk, opacity: 0.14 },
            },
            {
              name: '답변 완료',
              type: 'line',
              data: monthly.map((m) => m.completed_count),
              connectNulls: false,
              showSymbol: false,
              lineStyle: { width: 2, color: cyan },
              itemStyle: { color: cyan },
            },
            ...(mine ? [{
              name: '내 신고',
              type: 'line' as const,
              data: monthly.map((m) => mineByMonth.get(m.month)?.mine_report_count ?? null),
              connectNulls: false,
              showSymbol: true,
              symbol: 'diamond',
              symbolSize: 7,
              lineStyle: { width: 2, type: 'dashed' as const, color: brandInk },
              itemStyle: { color: brandInk },
            }] : []),
          ],
        };
        chart.setOption(option);
      })
      .catch(() => {
        if (!dead) setChartError('그래프를 불러오지 못했습니다. 표로 보기를 눌러 주세요.');
      });
    const onResize = () => chart?.resize();
    window.addEventListener('resize', onResize);
    return () => {
      dead = true;
      window.removeEventListener('resize', onResize);
      chart?.dispose();
      chart = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, monthly, theme, mine]);

  const last = monthly[monthly.length - 1];
  const prev = monthly[monthly.length - 2];
  const delta = last && prev && last.report_count != null && prev.report_count != null && prev.report_count > 0
    ? (((last.report_count - prev.report_count) / prev.report_count) * 100)
    : null;

  return (
    <article className="cm-panel trend-card" aria-label="월별 신고·답변 추이">
      <div className="panel-top">
        <div>
          <h2>월별 신고·답변 추이</h2>
          <span className="subtitle">신고는 신고한 달, 답변은 답변 받은 달에 셉니다</span>
        </div>
        <button
          className="icon-btn" type="button"
          aria-label={table ? '그래프로 보기' : '표로 보기'}
          aria-pressed={table}
          onClick={() => setTable((v) => !v)}
        >
          <Icon name="table" />
        </button>
      </div>
      <div className="chart-legend">
        <span><i className="dot" style={{ background: 'var(--brand-ink)' }} />신고</span>
        <span><i className="dot" style={{ background: 'var(--cyan)' }} />답변 완료</span>
        {mine && <span><i className="dash" aria-hidden="true" />내 신고(점선)</span>}
        {delta != null && last && <b>{fmtMonth(last.month)} 신고 <strong>{delta >= 0 ? '+' : ''}{delta.toFixed(1)}%</strong><small> 전월 대비</small></b>}
        {last?.partial && <span className="cm-chip">이번 달은 진행 중</span>}
      </div>
      {!table && monthly.length > 0 && !chartError && (
        <div ref={hostRef} className="trend-host" role="img" aria-label={`월별 신고 ${monthly.map((m) => `${fmtMonth(m.month)} ${m.report_count ?? '자료 없음'}`).join(', ')}`} />
      )}
      {!table && chartError && (
        <div className="empty-state" style={{ margin: '8px 16px 0' }} role="alert">
          <span>{chartError}</span>
          <button className="ghost-btn" type="button" onClick={() => setTable(true)}>표로 보기</button>
        </div>
      )}
      {!table && monthly.length === 0 && (
        <div className="empty-state" style={{ margin: '8px 16px 0' }}>이 조건에는 월별 자료가 없습니다.</div>
      )}
      {table && (
        <div className="trend-table">
          <table>
            <caption className="cm-muted" style={{ captionSide: 'bottom', padding: 8, fontSize: 12 }}>자료가 없는 달은 ‘—’로 표시합니다.</caption>
            <thead><tr><th scope="col">월</th><th scope="col">신고</th><th scope="col">답변 완료</th><th scope="col">과태료</th><th scope="col">답변까지(중앙값)</th>{mine && <th scope="col">내 신고</th>}{mine && <th scope="col">내 답변</th>}<th scope="col">비고</th></tr></thead>
            <tbody>
              {monthly.map((m) => (
                <tr key={m.month}>
                  <td>{fmtMonth(m.month)}</td>
                  <td>{fmtInt(m.report_count)}</td>
                  <td>{fmtInt(m.completed_count)}</td>
                  <td>{fmtInt(m.fine_count)}</td>
                  <td>{m.duration && m.duration.count > 0 ? fmtDays(m.duration.median_days) : '—'}</td>
                  {mine && <td>{fmtInt(mineByMonth.get(m.month)?.mine_report_count ?? null)}</td>}
                  {mine && <td>{fmtInt(mineByMonth.get(m.month)?.mine_completed_count ?? null)}</td>}
                  <td>{m.partial ? '진행 중' : m.coverage_note ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="chart-caption">이번 달은 아직 끝나지 않아 다른 달보다 적게 보일 수 있습니다.</p>
    </article>
  );
}
