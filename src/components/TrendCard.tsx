import { useState } from 'react';
import type { MonthlyBucket, OutcomeCounts } from '../domain/public';
import type { CompareMonth } from '../domain/personal';
import { baseOption, useEChart } from '../lib/charts';
import { fmtDays, fmtFineAmount, fmtInt, fmtMonth, fmtPercent, fmtRating } from './format';
import Icon from './icons';

type View = 'count' | 'rate';
export type RateMetric = 'accept' | 'partial' | 'reject' | 'fine';
const RATE_LABEL: Record<RateMetric, string> = { accept: '수용률', partial: '일부수용률', reject: '불수용률', fine: '과태료 부과율' };

/** A05: the month's own numerator/denominator (completion month); null = no denominator (line gap, not 0%). */
export function monthRate(o: OutcomeCounts | null | undefined, fine: number | null | undefined, completed: number | null | undefined,
  m: RateMetric): { num: number; den: number; value: number | null } | null {
  if (m === 'fine') {
    if (completed == null || fine == null) return null;
    return { num: fine, den: completed, value: completed > 0 ? (fine / completed) * 100 : null };
  }
  if (!o) return null;
  const num = m === 'accept' ? o.accepted : m === 'partial' ? o.partial : o.rejected;
  return { num, den: o.result_known, value: o.result_known > 0 ? (num / o.result_known) * 100 : null };
}

/** 월별 추이: the existing 건수 view (신고·답변) and the A05 처리결과 비율 view in one card. */
export default function TrendCard({ monthly, theme, mine = null }: {
  monthly: MonthlyBucket[];
  theme: 'dark' | 'light';
  mine?: CompareMonth[] | null;
}) {
  const [view, setView] = useState<View>('count');
  const [rate, setRate] = useState<RateMetric>('accept');
  const [table, setTable] = useState(false);
  const mineByMonth = new Map((mine ?? []).map((m) => [m.month, m]));
  const mineRates = !!mine && mine.some((m) => m.mine_outcomes !== undefined);
  const allRate = monthly.map((m) => monthRate(m.outcomes, m.fine_count, m.completed_count, rate));
  const myRate = monthly.map((m) => {
    const x = mineByMonth.get(m.month);
    return x && x.mine_outcomes !== undefined ? monthRate(x.mine_outcomes, x.mine_fine_count, x.mine_completed_count, rate) : null;
  });

  const { hostRef, error } = useEChart((t) => {
    if (monthly.length === 0) return null;
    const months = monthly.map((m) => fmtMonth(m.month));
    const common = { ...baseOption(t), grid: { left: 44, right: 16, top: 16, bottom: 28 },
      xAxis: { type: 'category', data: months, axisLine: { lineStyle: { color: t.grid } }, axisLabel: { color: t.muted } } };
    if (view === 'count') {
      return { ...common, tooltip: { ...common.tooltip, trigger: 'axis' },
        yAxis: { type: 'value', min: 0, splitLine: { lineStyle: { color: t.grid } }, axisLabel: { color: t.muted } },
        series: [
          { name: '신고', type: 'line', data: monthly.map((m) => m.report_count), connectNulls: false, symbolSize: 6,
            lineStyle: { width: 2.5, color: t.brand }, itemStyle: { color: t.brand }, areaStyle: { color: t.brand, opacity: 0.12 } },
          { name: '답변 완료', type: 'line', data: monthly.map((m) => m.completed_count), connectNulls: false, showSymbol: false,
            lineStyle: { width: 2, color: t.cyan }, itemStyle: { color: t.cyan } },
          ...(mine ? [{ name: '내 신고', type: 'line', data: monthly.map((m) => mineByMonth.get(m.month)?.mine_report_count ?? null),
            connectNulls: false, symbol: 'diamond', symbolSize: 7, lineStyle: { width: 2, type: 'dashed', color: t.brand }, itemStyle: { color: t.brand } }] : []),
        ] };
    }
    const fmt = (x: { num: number; den: number; value: number | null } | null) =>
      x === null || x.value === null ? '자료 없음' : `${x.value.toFixed(1)}% (${fmtInt(x.num)}/${fmtInt(x.den)}건)`;
    return { ...common,
      tooltip: { ...common.tooltip, trigger: 'axis', formatter: (ps: Array<{ dataIndex: number; seriesName: string }>) => {
        const i = ps[0]?.dataIndex ?? 0;
        return [`<b>${months[i]}</b>`, `전체 ${RATE_LABEL[rate]} ${fmt(allRate[i])}`,
          ...(mineRates ? [`내 신고 ${RATE_LABEL[rate]} ${fmt(myRate[i])}`] : [])].join('<br/>');
      } },
      yAxis: { type: 'value', min: 0, max: 100, splitLine: { lineStyle: { color: t.grid } }, axisLabel: { color: t.muted, formatter: '{value}%' } },
      series: [
        { name: '전체', type: 'line', data: allRate.map((x) => x?.value ?? null), connectNulls: false, symbolSize: 7,
          lineStyle: { width: 2.5, color: t.accepted }, itemStyle: { color: t.accepted } },
        ...(mineRates ? [{ name: '내 신고', type: 'line', data: myRate.map((x) => x?.value ?? null), connectNulls: false, symbol: 'diamond',
          symbolSize: 7, lineStyle: { width: 2, type: 'dashed', color: t.brand }, itemStyle: { color: t.brand } }] : []),
      ] };
  }, [monthly, mine, view, rate], theme);

  const last = monthly[monthly.length - 1];
  return (
    <article className="cm-panel chart-card trend-card" aria-label="월별 추이">
      <div className="panel-top">
        <div>
          <h2>월별 추이</h2>
          <span className="subtitle">{view === 'count' ? '신고는 신고한 달, 답변은 답변 받은 달에 셉니다' : `${RATE_LABEL[rate]} · 답변 받은 달 기준, 그 달의 실제 분자/분모`}</span>
        </div>
        <div className="card-tools">
          <div className="mini-segments" role="group" aria-label="월별 추이 보기">
            <button type="button" className={view === 'count' ? 'selected' : ''} aria-pressed={view === 'count'} onClick={() => setView('count')}>건수</button>
            <button type="button" className={view === 'rate' ? 'selected' : ''} aria-pressed={view === 'rate'} onClick={() => setView('rate')}>처리결과 비율</button>
          </div>
          <button className="icon-btn" type="button" aria-label={table ? '그래프로 보기' : '표로 보기'} aria-pressed={table} onClick={() => setTable((v) => !v)}>
            <Icon name="table" />
          </button>
        </div>
      </div>
      <div className="chart-legend">
        {view === 'count' ? (
          <>
            <span><i className="dot" style={{ background: 'var(--brand-ink)' }} />신고</span>
            <span><i className="dot" style={{ background: 'var(--cyan)' }} />답변 완료</span>
            {mine && <span><i className="dash" aria-hidden="true" />내 신고(점선)</span>}
          </>
        ) : (
          <>
            <label className="inline-select">지표
              <select value={rate} onChange={(e) => setRate(e.target.value as RateMetric)}>
                {(Object.keys(RATE_LABEL) as RateMetric[]).map((k) => <option key={k} value={k}>{RATE_LABEL[k]}</option>)}
              </select>
            </label>
            <span><i className="dot" style={{ background: 'var(--accepted)' }} />전체</span>
            {mineRates && <span><i className="dash" aria-hidden="true" />내 신고(점선)</span>}
            {mine && !mineRates && <span className="cm-muted">내 신고 비율은 서버가 아직 제공하지 않습니다</span>}
          </>
        )}
        {last?.partial && <span className="cm-chip">이번 달은 진행 중</span>}
      </div>
      <div ref={hostRef} className="chart-host" hidden={table || monthly.length === 0 || !!error} role="img"
        aria-label={view === 'count' ? `월별 신고 ${monthly.map((m) => `${fmtMonth(m.month)} ${m.report_count ?? '자료 없음'}`).join(', ')}`
          : `월별 ${RATE_LABEL[rate]} ${monthly.map((m, i) => `${fmtMonth(m.month)} ${allRate[i]?.value == null ? '자료 없음' : `${allRate[i]!.value!.toFixed(1)}%`}`).join(', ')}`} />
      {!table && error && <div className="empty-state" role="alert"><span>{error}</span><button className="ghost-btn" type="button" onClick={() => setTable(true)}>표로 보기</button></div>}
      {!table && monthly.length === 0 && <div className="empty-state">이 조건에는 월별 자료가 없습니다.</div>}
      {table && (
        <div className="trend-table">
          <table>
            <caption className="cm-muted" style={{ captionSide: 'bottom', padding: 8, fontSize: 12 }}>자료가 없는 달은 ‘—’로 표시합니다. 비율은 그 달의 실제 분자/분모입니다.</caption>
            <thead><tr><th scope="col">월</th><th scope="col">신고</th><th scope="col">답변 완료</th><th scope="col">수용률</th><th scope="col">일부수용률</th><th scope="col">불수용률</th><th scope="col">과태료</th><th scope="col">과태료 금액</th><th scope="col">평균 별점 · 건수</th><th scope="col">답변까지(중앙값)</th>{mine && <th scope="col">내 신고</th>}{mine && <th scope="col">내 답변</th>}{mineRates && <th scope="col">내 {RATE_LABEL[rate]}</th>}<th scope="col">비고</th></tr></thead>
            <tbody>
              {monthly.map((m, i) => (
                <tr key={m.month}>
                  <td>{fmtMonth(m.month)}</td>
                  <td>{fmtInt(m.report_count)}</td>
                  <td>{fmtInt(m.completed_count)}</td>
                  <td>{fmtPercent(monthRate(m.outcomes, m.fine_count, m.completed_count, 'accept')?.value)}</td>
                  <td>{fmtPercent(monthRate(m.outcomes, m.fine_count, m.completed_count, 'partial')?.value)}</td>
                  <td>{fmtPercent(monthRate(m.outcomes, m.fine_count, m.completed_count, 'reject')?.value)}</td>
                  <td>{fmtInt(m.fine_count)}</td>
                  <td>{m.fine_amount ? fmtFineAmount(m.fine_amount) : '—'}</td>
                  <td>{fmtRating(m.rating)}</td>
                  <td>{m.duration && m.duration.count > 0 ? fmtDays(m.duration.median_days) : '—'}</td>
                  {mine && <td>{fmtInt(mineByMonth.get(m.month)?.mine_report_count ?? null)}</td>}
                  {mine && <td>{fmtInt(mineByMonth.get(m.month)?.mine_completed_count ?? null)}</td>}
                  {mineRates && <td>{fmtPercent(myRate[i]?.value)}</td>}
                  <td>{m.partial ? '진행 중' : m.coverage_note ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="chart-caption">{view === 'rate' ? '답변이 없는 달은 선을 끊어 0%와 구분합니다. 비율 차이는 %p로 읽습니다.' : '이번 달은 아직 끝나지 않아 다른 달보다 적게 보일 수 있습니다.'}</p>
    </article>
  );
}
