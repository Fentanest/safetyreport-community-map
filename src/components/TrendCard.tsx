import { useEffect, useMemo, useState } from 'react';
import type { DateBasis, MonthlyBucket, OutcomeCounts } from '../domain/public';
import type { CompareMonth } from '../domain/personal';
import { baseOption, useEChart } from '../lib/charts';
import { fmtDays, fmtFineAmount, fmtInt, fmtMonth, fmtPercent, fmtRating } from './format';
import Icon from './icons';
import MonthlyRateSelector from './MonthlyRateSelector';
import PanelStatus from './PanelStatus';
import ExportButton from './ExportButton';
import { trendSnapshot } from '../export/adapters/dashboard';
import {
  monthNote, TREND_RATES, TREND_RATE_LABEL, TREND_RATE_TOKEN, rateCellText, readTrendRates, trendRateRows, writeTrendRates,
  type RateCell, type TrendRate,
} from './trendMetrics';

type View = 'count' | 'rate';
export type RateMetric = TrendRate;

/** A05 (kept for callers): the month's own numerator/denominator; null = no denominator (line gap, not 0%). */
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

/** state of the viewer's comparison, so "not arrived yet" is never drawn as the public value or as 0 */
export type TrendMineState = 'off' | 'loading' | 'error' | 'signed_out' | 'ready';
const MINE_NOTE: Record<Exclude<TrendMineState, 'off' | 'ready'>, string> = {
  loading: '내 신고를 불러오는 중', error: '내 신고를 불러오지 못했습니다', signed_out: '로그인하면 내 신고를 함께 볼 수 있습니다',
};

const VIEW_KEY = 'cm-trend-view';
const readView = (): View => { try { return localStorage.getItem(VIEW_KEY) === 'rate' ? 'rate' : 'count'; } catch { return 'count'; } };

/** 월별 추이: 건수 view (신고·답변) and the 처리결과 비율 view with 1–4 overlaid rates (S09). */
export default function TrendCard({ monthly, basis = 'completed_date', theme, mine = null, mineState = mine ? 'ready' : 'off', busy = false, onMakeStatistics, exportCtx }: {
  monthly: MonthlyBucket[];
  /** U01: the months are months of THIS date (신고월 / 답변월); the count and every rate of a month share its reports */
  basis?: DateBasis;
  theme: 'dark' | 'light';
  mine?: CompareMonth[] | null;
  mineState?: TrendMineState;
  /** the dashboard request that feeds this card is running (the last good months stay drawn) */
  busy?: boolean;
  /** hand the current conditions + the checked rates to 맞춤 통계 */
  onMakeStatistics?: (rates: TrendRate[]) => void;
  /** F06: the conditions of the DISPLAYED months (fixed dates, scope) for the Excel file */
  exportCtx?: { conditions: Array<{ label: string; value: string }>; datasetVersion: string | null };
}) {
  const [view, setViewState] = useState<View>(readView);
  const setView = (v: View) => { setViewState(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* ignore */ } };
  const [rates, setRatesState] = useState<TrendRate[]>(() => readTrendRates());
  const setRates = (next: TrendRate[]) => { const list = TREND_RATES.filter((k) => next.includes(k)); setRatesState(list); writeTrendRates(list); };
  const [table, setTable] = useState(false);
  const mineByMonth = useMemo(() => new Map((mine ?? []).map((m) => [m.month, m])), [mine]);
  // rate rows: the same selector feeds the lines, the tooltip and the table
  const rows = useMemo(() => trendRateRows(monthly, mineState === 'ready' ? mine : null), [monthly, mine, mineState]);
  const withMine = mineState === 'ready' && !!mine;
  const monthWord = basis === 'report_date' ? '신고월' : '답변월';
  // one set per month: when every month's answered count equals its report count, one line (the answered count
  // stays in the tooltip and the table) — never two lines of different date axes
  const sameLine = monthly.every((m) => m.report_count === m.completed_count);

  const { hostRef, error, chartRef } = useEChart((t) => {
    if (monthly.length === 0) return null;
    const months = monthly.map((m) => fmtMonth(m.month));
    const common = { ...baseOption(t), grid: { left: 44, right: 16, top: 16, bottom: 28 },
      xAxis: { type: 'category', data: months, axisLine: { lineStyle: { color: t.grid } }, axisLabel: { color: t.muted } } };
    if (view === 'count') {
      return { ...common, tooltip: { ...common.tooltip, trigger: 'axis' },
        yAxis: { type: 'value', min: 0, splitLine: { lineStyle: { color: t.grid } }, axisLabel: { color: t.muted } },
        series: [
          { id: 'count:report:all', name: sameLine ? '신고(모두 답변 확인)' : '신고', type: 'line', data: monthly.map((m) => m.report_count), connectNulls: false, symbolSize: 6,
            lineStyle: { width: 2.5, color: t.brand }, itemStyle: { color: t.brand }, areaStyle: { color: t.brand, opacity: 0.12 } },
          ...(sameLine ? [] : [{ id: 'count:completed:all', name: '답변 확인', type: 'line', data: monthly.map((m) => m.completed_count), connectNulls: false, showSymbol: false,
            lineStyle: { width: 2, color: t.cyan }, itemStyle: { color: t.cyan } }]),
          ...(mine ? [{ id: 'count:report:mine', name: '내 신고', type: 'line', data: monthly.map((m) => mineByMonth.get(m.month)?.mine_report_count ?? null),
            connectNulls: false, symbol: 'diamond', symbolSize: 7, lineStyle: { width: 2, type: 'dashed', color: t.brand }, itemStyle: { color: t.brand } }] : []),
        ] };
    }
    if (rates.length === 0) return null;
    const byMonth = new Map(rows.map((r) => [r.month, r]));
    const cellAt = (i: number, k: TrendRate, side: 'all' | 'mine'): RateCell | null => {
      const r = byMonth.get(monthly[i].month);
      return r ? (side === 'all' ? r.all[k] : r.mine?.[k] ?? null) : null;
    };
    const series = rates.flatMap((k) => {
      const color = t[TREND_RATE_TOKEN[k]];
      const all = { id: `rate:${k}:all`, name: `${TREND_RATE_LABEL[k]} · 전체`, type: 'line', smooth: false, connectNulls: false,
        symbol: 'circle', symbolSize: 7, lineStyle: { width: 2.5, color }, itemStyle: { color },
        data: monthly.map((_, i) => cellAt(i, k, 'all')?.value ?? null) };
      if (!withMine) return [all];
      return [all, { id: `rate:${k}:mine`, name: `${TREND_RATE_LABEL[k]} · 내 신고`, type: 'line', smooth: false, connectNulls: false,
        symbol: 'diamond', symbolSize: 8, lineStyle: { width: 2, type: 'dashed', color }, itemStyle: { color, borderColor: t.surface, borderWidth: 1 },
        data: monthly.map((_, i) => cellAt(i, k, 'mine')?.value ?? null) }];
    });
    return { ...common,
      tooltip: { ...common.tooltip, trigger: 'axis', formatter: (ps: Array<{ dataIndex: number }>) => {
        const i = ps[0]?.dataIndex ?? 0;
        const lines = rates.flatMap((k) => {
          const a = cellAt(i, k, 'all');
          const out = [`${TREND_RATE_LABEL[k]} · 전체 ${a ? rateCellText(a) : '자료 없음'}`];
          if (withMine) {
            const m = cellAt(i, k, 'mine');
            const same = a && m && a.value !== null && a.value === m.value ? ' (전체와 같음)' : '';
            out.push(`${TREND_RATE_LABEL[k]} · 내 신고 ${m ? rateCellText(m) : '자료 없음'}${same}`);
          }
          return out;
        });
        const note = monthNote(monthly[i]);
        return [`<b>${months[i]}${note ? ` (${note})` : ''}</b>`, ...lines].join('<br/>');
      } },
      yAxis: { type: 'value', min: 0, max: 100, splitLine: { lineStyle: { color: t.grid } }, axisLabel: { color: t.muted, formatter: '{value}%' } },
      series };
  }, [monthly, mine, view, rates, rows, withMine, sameLine], theme);

  const last = monthly[monthly.length - 1];
  const noRates = view === 'rate' && rates.length === 0;
  // Removing every selected metric clears the now-hidden plot immediately. Hidden nonempty plots defer builds.
  useEffect(() => { if (noRates) chartRef.current?.clear(); }, [noRates, chartRef]);
  const allNull = view === 'rate' && rates.length > 0 && rows.every((r) => rates.every((k) => r.all[k].value === null));
  // F06: the file follows the card (view, checked rates, 전체/내 신고); it waits instead of saving a half comparison
  const exportBlocked = monthly.length === 0 ? '월별 자료가 없습니다' : busy ? '새 결과를 불러오는 중이라 잠시 뒤에 받을 수 있습니다'
    : mineState === 'loading' ? '내 신고를 불러오는 중입니다. 끝나면 받을 수 있습니다'
      : mineState === 'error' ? '내 신고를 불러오지 못했습니다. ‘내 신고와 비교’를 끄면 전체만 받을 수 있습니다'
        : view === 'rate' && rates.length === 0 ? '표시할 지표를 선택해 주세요' : null;
  const captureExport = () => (exportCtx ? trendSnapshot({ monthly, mine: withMine ? mine : null, view, rates, basis, conditions: exportCtx.conditions,
    datasetVersion: exportCtx.datasetVersion, capturedAt: new Date().toISOString() }) : null);
  const mineNote = mineState === 'loading' || mineState === 'error' || mineState === 'signed_out' ? MINE_NOTE[mineState] : null;
  return (
    <article className="cm-panel chart-card trend-card" aria-label="월별 추이" aria-busy={busy || mineState === 'loading'}>
      <div className="panel-top">
        <div>
          <h2>{monthWord}별 처리결과 <PanelStatus busy={busy} label="월별 자료를 불러오는 중" /></h2>
          {view === 'rate' && <span className="subtitle">수용·일부수용·불수용은 미분류를 뺀 답변 중, 과태료는 전체 답변 중 비율</span>}
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
      {view === 'rate' && <MonthlyRateSelector value={rates} onChange={setRates} withMine={withMine} />}
      <div className="chart-legend">
        {view === 'count' ? (
          <>
            <span><i className="dot" style={{ background: 'var(--brand-ink)' }} />{sameLine ? '신고(모두 답변 확인)' : '신고'}</span>
            {!sameLine && <span><i className="dot" style={{ background: 'var(--cyan)' }} />답변 확인</span>}
            {mine && <span><i className="dash" aria-hidden="true" />내 신고(점선)</span>}
          </>
        ) : (
          <>
            <span><i className="dash solid legend-neutral" aria-hidden="true" />전체(실선 ●)</span>
            {withMine && <span><i className="dash legend-neutral" aria-hidden="true" />내 신고(점선 ◆)</span>}
          </>
        )}
        {mineNote && <span className={`cm-chip${mineState === 'loading' ? ' is-pending' : ''}`} role="status">{mineNote}</span>}
        {last?.in_progress && <span className="cm-chip">이번 달은 진행 중</span>}
        {monthly.some((m) => m.range_partial) && <span className="cm-chip">일부 기간인 달 있음</span>}
        {onMakeStatistics && (
          <button type="button" className="link-btn trend-to-stats" onClick={() => onMakeStatistics(view === 'rate' ? rates : ['accept'])}
            title="지금 조건과 고른 비율로 맞춤 통계를 엽니다">이 조건으로 통계 만들기</button>
        )}
      </div>
      <div ref={hostRef} className="chart-host" hidden={table || monthly.length === 0 || !!error || noRates || allNull} role="img"
        aria-label={view === 'count' ? `월별 신고 ${monthly.map((m) => `${fmtMonth(m.month)} ${m.report_count ?? '자료 없음'}`).join(', ')}`
          : `월별 ${rates.map((k) => TREND_RATE_LABEL[k]).join('·')} ${rows.map((r) => `${fmtMonth(r.month)} ${rates.map((k) => `${TREND_RATE_LABEL[k]} ${r.all[k].value === null ? '자료 없음' : `${r.all[k].value!.toFixed(1)}%`}`).join(' ')}`).join(', ')}`} />
      {!table && noRates && <div className="empty-state" role="note">비교할 지표를 선택해 주세요.</div>}
      {!table && allNull && <div className="empty-state" role="note">고른 지표를 계산할 수 있는 달이 없습니다. 다른 지표를 골라 보세요.</div>}
      {!table && error && <div className="empty-state" role="alert"><span>{error}</span><button className="ghost-btn" type="button" onClick={() => setTable(true)}>표로 보기</button></div>}
      {!table && monthly.length === 0 && <div className="empty-state">이 조건에는 월별 자료가 없습니다.</div>}
      {table && view === 'rate' && (
        <div className="trend-table">
          <table>
            {rates.length === 0 && <caption className="cm-muted" style={{ captionSide: 'bottom', padding: 8, fontSize: 12 }}>비교할 지표를 선택해 주세요.</caption>}
            <thead><tr><th scope="col">월</th>{rates.flatMap((k) => [
              <th key={`${k}-all`} scope="col">{TREND_RATE_LABEL[k]} 전체</th>,
              ...(withMine ? [<th key={`${k}-mine`} scope="col">{TREND_RATE_LABEL[k]} 내 신고</th>] : []),
            ])}<th scope="col">비고</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.month}>
                  <td>{fmtMonth(r.month)}</td>
                  {rates.flatMap((k) => [
                    <td key={`${k}-all`}>{rateCellText(r.all[k])}</td>,
                    ...(withMine ? [<td key={`${k}-mine`}>{r.mine ? rateCellText(r.mine[k]) : '—'}</td>] : []),
                  ])}
                  <td>{monthNote(monthly.find((m) => m.month === r.month) ?? { month: r.month })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {table && view === 'count' && (
        <div className="trend-table">
          <table>
            <thead><tr><th scope="col">월</th><th scope="col">신고</th><th scope="col">답변 확인</th><th scope="col">수용률</th><th scope="col">일부수용률</th><th scope="col">불수용률</th><th scope="col">과태료</th><th scope="col">과태료 금액</th><th scope="col">평균 별점 · 건수</th><th scope="col">답변까지(중앙값)</th>{mine && <th scope="col">내 신고</th>}{mine && <th scope="col">내 답변</th>}<th scope="col">비고</th></tr></thead>
            <tbody>
              {monthly.map((m) => (
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
                  <td>{monthNote(m)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {exportCtx && <ExportButton source="trend" blocked={exportBlocked} capture={captureExport} />}
    </article>
  );
}
