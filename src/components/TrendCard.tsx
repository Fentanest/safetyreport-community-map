import { useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts';
import type { MonthlyBucket } from '../domain/public';
import { fmtInt, fmtMonth } from './format';

export default function TrendCard({ monthly }: { monthly: MonthlyBucket[] }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [table, setTable] = useState(false);
  const reduced = () =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    if (table || !hostRef.current || monthly.length === 0) return;
    const el = hostRef.current;
    const css = getComputedStyle(document.documentElement);
    const text = css.getPropertyValue('--text').trim() || '#F8FAFC';
    const muted = css.getPropertyValue('--muted').trim() || '#94A3B8';
    const grid = css.getPropertyValue('--grid').trim() || 'rgba(148,163,184,.12)';
    const chart = echarts.init(el, undefined, { renderer: 'canvas' });
    const months = monthly.map((m) => fmtMonth(m.month));
    chart.setOption({
      animationDuration: reduced() ? 0 : 220,
      textStyle: { color: text, fontSize: 12 },
      grid: { left: 48, right: 16, top: 16, bottom: 30 },
      tooltip: {
        trigger: 'axis',
        backgroundColor: css.getPropertyValue('--surface').trim() || '#111827',
        borderColor: css.getPropertyValue('--border').trim() || '#334155',
        textStyle: { color: text, fontSize: 12 },
      },
      legend: { show: false },
      xAxis: { type: 'category', data: months, axisLine: { lineStyle: { color: grid } }, axisLabel: { color: muted } },
      yAxis: {
        type: 'value', min: 0,
        splitLine: { lineStyle: { color: grid } },
        axisLabel: { color: muted },
      },
      series: [
        {
          name: '신고 접수', type: 'line', smooth: false,
          data: monthly.map((m) => m.report_count),
          connectNulls: false, showSymbol: true, symbolSize: 7,
          lineStyle: { width: 2.5, color: '#0D6EFD' },
          itemStyle: { color: '#0D6EFD' },
          areaStyle: { color: 'rgba(13,110,253,0.14)' },
        },
        {
          name: '처리완료', type: 'line', smooth: false,
          data: monthly.map((m) => m.completed_count),
          connectNulls: false, showSymbol: false,
          lineStyle: { width: 2, color: '#06B6D4' },
          itemStyle: { color: '#06B6D4' },
        },
      ],
    });
    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chart.dispose();
    };
  }, [table, monthly]);

  const last = monthly[monthly.length - 1];
  const prev = monthly[monthly.length - 2];
  const delta = last && prev && last.report_count != null && prev.report_count != null && prev.report_count > 0
    ? (((last.report_count - prev.report_count) / prev.report_count) * 100)
    : null;

  return (
    <article className="cm-panel trend-card" aria-label="월별 신고 · 처리 흐름">
      <div className="panel-top">
        <div>
          <h2>월별 신고 · 처리 흐름</h2>
          <span className="subtitle">신고일 / 처리완료일 기준을 구분해 비교</span>
        </div>
        <button
          className="icon-btn" type="button"
          aria-label={table ? '차트로 보기' : '차트 값을 표로 보기'}
          aria-pressed={table}
          onClick={() => setTable((v) => !v)}
        >
          <span aria-hidden="true">▦</span>
        </button>
      </div>
      <div className="chart-legend">
        <span><i className="dot" style={{ background: 'var(--brand)' }} />신고 접수</span>
        <span><i className="dot" style={{ background: 'var(--cyan)' }} />처리완료</span>
        {delta != null && last && <b>{fmtMonth(last.month)} 신고 <strong>{delta >= 0 ? '+' : ''}{delta.toFixed(1)}%</strong><small> 전월 대비(건수)</small></b>}
        {last?.partial && <span className="cm-chip">진행 중 월 포함</span>}
      </div>
      {!table && monthly.length > 0 && <div ref={hostRef} className="trend-host" role="img" aria-label={`월별 신고 ${monthly.map((m) => `${fmtMonth(m.month)} ${m.report_count ?? '결측'}건`).join(', ')}`} />}
      {!table && monthly.length === 0 && (
        <div className="empty-state" style={{ margin: '8px 16px 0' }}>월별 집계가 없습니다. 필터를 확인해 주세요.</div>
      )}
      {table && (
        <div className="trend-table">
          <table>
            <caption className="cm-muted" style={{ captionSide: 'bottom', padding: 8, fontSize: 12 }}>결측 월은 ‘—’로 표시하고 선을 연결하지 않습니다.</caption>
            <thead><tr><th scope="col">월</th><th scope="col">신고 접수</th><th scope="col">처리완료</th><th scope="col">과태료</th><th scope="col">데이터 범위</th></tr></thead>
            <tbody>
              {monthly.map((m) => (
                <tr key={m.month}>
                  <td>{fmtMonth(m.month)}</td>
                  <td>{fmtInt(m.report_count)}</td>
                  <td>{fmtInt(m.completed_count)}</td>
                  <td>{fmtInt(m.fine_count)}</td>
                  <td>{m.partial ? '진행 중' : m.coverage_note ?? '완료된 월'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="chart-caption">진행 중인 월은 같은 경과기간과 비교합니다. 비율 변화는 %p, 건수 변화는 %로 구분합니다.</p>
    </article>
  );
}
