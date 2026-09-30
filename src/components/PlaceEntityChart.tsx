/**
 * R3: 이 주소의 담당자별 처리 현황 — per-manager 100% stacked bars (left axis, 0–100%) + answered-count line
 * (right axis, integer counts) for ONE address under the same scope/version as the place detail.
 * Managers are categories, not time: the count points are joined with straight segments only as a reading aid.
 * Bars, table and the metric boxes share `entityRates` (src/components/entityMetrics.ts).
 * Many managers: 8 at a time. The ECharts dataZoom is the ONLY window state; 이전/다음 dispatch a dataZoom action and
 * the range text is read back from the chart after every change (slider drag included). Names follow the 동명이인 rule
 * of src/domain/managerNames.ts (server metadata over the scope's full list, not the visible 8).
 */
import { useRef, useState } from 'react';
import type { EChartsType } from 'echarts/core';
import type { PublicEntity, SameNameInfo } from '../domain/public';
import { baseOption, useEChart } from '../lib/charts';
import { entityLabel, entityRates } from './entityMetrics';
import { managerNameOf, sameNameIndex, sameNameNote } from '../domain/managerNames';
import { fmtInt, fmtPercent } from './format';
import Icon from './icons';
import ExportButton from './ExportButton';
import { placeManagersSnapshot } from '../export/adapters/dashboard';

export type PlaceChartMode = 'accept' | 'fine';

/** Bar segments for one manager and mode; null values = no bar (K = 0 or F unknown), never a fake 100%. */
export function placeChartSegments(e: PublicEntity, mode: PlaceChartMode) {
  const m = entityRates(e);
  if (mode === 'accept') {
    return { denominator: m.K, count: m.C, segments: m.K > 0
      ? [{ key: 'accepted', value: m.accept!, n: m.A }, { key: 'partial', value: m.partial!, n: m.P }, { key: 'rejected', value: m.reject!, n: m.R }]
      : null, m };
  }
  return { denominator: m.C, count: m.C, segments: m.F !== null && m.C > 0
    ? [{ key: 'fine', value: m.fineRate!, n: m.F }, { key: 'other', value: 100 - m.fineRate!, n: m.C - m.F }]
    : null, m };
}

const ACCEPT_SERIES = [
  { key: 'accepted', name: '수용', color: 'accepted' as const },
  { key: 'partial', name: '일부수용', color: 'partial' as const },
  { key: 'rejected', name: '불수용', color: 'rejected' as const },
];
const FINE_SERIES = [
  { key: 'fine', name: '과태료 처분', color: 'fine' as const },
  { key: 'other', name: '과태료 외(경고·범칙금·처분 없음·미확인)', color: 'unknown' as const },
];

/** managers per chart window */
export const WINDOW = 8;
/** 0-based inclusive category range shown by the chart */
export interface ChartWindow { start: number; end: number }

export const firstWindow = (n: number): ChartWindow => ({ start: 0, end: Math.max(0, Math.min(n, WINDOW) - 1) });

/** The window of the chart's dataZoom option (value range when present, else the percent range), clamped to n. */
export function windowFromZoom(z: { start?: number; end?: number; startValue?: number | string; endValue?: number | string } | undefined, n: number): ChartWindow {
  if (n <= WINDOW || !z) return firstWindow(n);
  const last = n - 1;
  const at = (v: number | string | undefined, pct: number | undefined, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v
    : typeof pct === 'number' && Number.isFinite(pct) ? (pct / 100) * last : fallback);
  const a = Math.min(last, Math.max(0, Math.round(at(z.startValue, z.start, 0))));
  const b = Math.min(last, Math.max(a, Math.round(at(z.endValue, z.end, last))));
  return { start: a, end: b };
}

/** 다음: the next WINDOW managers after the current window (null at the end of the loaded list) */
export function nextWindow(w: ChartWindow, n: number): ChartWindow | null {
  if (w.end >= n - 1) return null;
  const start = w.end + 1;
  return { start, end: Math.min(n - 1, start + WINDOW - 1) };
}

/** 이전: the WINDOW managers before the current window (null at the start) */
export function prevWindow(w: ChartWindow, n: number): ChartWindow | null {
  if (w.start <= 0) return null;
  const end = w.start - 1;
  const start = Math.max(0, end - WINDOW + 1);
  return { start, end: start === 0 ? Math.min(n - 1, Math.max(end, WINDOW - 1)) : end };
}

/** '담당자 1–8 / 100명' or '담당자 97–100 / 불러온 100명 · 전체 118명' */
export function rangeText(w: ChartWindow, n: number, total: number): string {
  const range = n === 0 ? '0' : `${fmtInt(w.start + 1)}–${fmtInt(w.end + 1)}`;
  return total > n ? `담당자 ${range} / 불러온 ${fmtInt(n)}명 · 전체 ${fmtInt(total)}명` : `담당자 ${range} / ${fmtInt(n)}명`;
}

const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export default function PlaceEntityChart({ managers, total, theme, loadingMore, loadError = false, onLoadMore, loadStep = 100,
  title = '이 주소의 담당자별 처리 현황', exportCtx }: {
  /** S01: the same chart for a region / map range ('이 범위의 담당자별 처리 현황') */
  title?: string;
  managers: PublicEntity[];
  total: number;
  theme: string;
  /** a request for more managers is running (the loaded ones stay on screen) */
  loadingMore: boolean;
  /** the last request for more managers failed (the loaded ones stay; onLoadMore retries) */
  loadError?: boolean;
  /** asks for more managers of the same scope (server paging); null when there is nothing more or no way to ask */
  onLoadMore: (() => void) | null;
  /** how many managers one onLoadMore adds at most (button text) */
  loadStep?: number;
  /** F06: conditions of the displayed address / range (the file holds exactly the managers of this card) */
  exportCtx?: { conditions: Array<{ label: string; value: string }>; datasetVersion: string | null; blocked: string | null };
}) {
  const [mode, setMode] = useState<PlaceChartMode>('accept');
  const [table, setTable] = useState(false);
  const n = managers.length;
  const same = sameNameIndex(managers);
  const sameOf = managers.map((e) => same.get(e));
  const labels = managers.map((e, i) => entityLabel(e, 'manager', sameOf[i]));
  const rows = managers.map((e) => placeChartSegments(e, mode));
  const series = mode === 'accept' ? ACCEPT_SERIES : FINE_SERIES;
  const zoom = n > WINDOW;
  // mirror of the chart's dataZoom (read back from ECharts after every change; never an independent index)
  const [win, setWin] = useState<ChartWindow>(() => firstWindow(n));
  const winRef = useRef(win);
  const live = useRef({ n, labels, lineSeries: series.length });
  live.current = { n, labels, lineSeries: series.length };
  const readWindow = (chart: EChartsType) => {
    const z = (chart.getOption() as { dataZoom?: Array<{ start?: number; end?: number; startValue?: number; endValue?: number }> }).dataZoom?.[0];
    const w = windowFromZoom(z, live.current.n);
    winRef.current = w;
    setWin((prev) => (prev.start === w.start && prev.end === w.end ? prev : w));
  };
  const { hostRef, error, chartRef } = useEChart((t) => {
    if (n === 0) return null;
    const color = (c: 'accepted' | 'partial' | 'rejected' | 'fine' | 'unknown') => t[c];
    const maxC = Math.max(1, ...rows.map((r) => r.count));
    // keep the window across mode/theme changes and when more managers arrive (clamped when the list is shorter)
    const w = zoom ? { start: Math.min(winRef.current.start, n - 1), end: Math.min(Math.max(winRef.current.end, winRef.current.start), n - 1) } : firstWindow(n);
    // a namesake's agency goes on its own line under the name; the bottom margin follows the longest line of the whole
    // list (fixed while paging) so rotated labels never run into the slider
    const axisLines = managers.map((e, i) => (sameOf[i] ? `${managerNameOf(e)}\n(${sameOf[i]!.label})` : labels[i]));
    const lineOf = new Map(labels.map((l, i) => [l, axisLines[i]]));
    const longest = Math.max(3, ...axisLines.flatMap((l) => l.split('\n').map((x) => [...x].length)));
    const twoLines = axisLines.some((l) => l.includes('\n'));
    // a phone-width card has ~35px per category: steeper labels so neighbours do not overlap
    const rotate = n <= 4 ? 0 : (hostRef.current?.clientWidth ?? 800) < 480 ? 55 : 30;
    const rad = (rotate * Math.PI) / 180;
    const labelBand = rotate ? Math.ceil(longest * 11 * Math.sin(rad) + (twoLines ? 2 : 1) * 14 * Math.cos(rad)) : (twoLines ? 32 : 18);
    return { ...baseOption(t), grid: { left: 44, right: 44, top: 28, bottom: labelBand + 14 + (zoom ? 30 : 0) },
      tooltip: { ...baseOption(t).tooltip, trigger: 'axis', axisPointer: { type: 'shadow' }, triggerOn: 'mousemove|click',
        formatter: (ps: Array<{ dataIndex: number }>) => {
          const i = ps[0]?.dataIndex ?? 0;
          const { m } = rows[i];
          const sn = sameOf[i];
          const who = sn
            ? `<b>${esc(managerNameOf(managers[i]))}</b><br/>${esc(managers[i].agency_name)}<br/><span style="opacity:.8">${sameNameNote(sn).map(esc).join('<br/>')}</span>`
            : `<b>${esc(labels[i])}</b> <span style="opacity:.8">· ${esc(managers[i].agency_name)}</span>`;
          const head = `${who}<br/>답변 ${fmtInt(m.C)}건`;
          if (mode === 'accept') {
            return `${head} · 결과 확인 ${fmtInt(m.K)}건 · 결과 미상 ${fmtInt(m.U)}건<br/>`
              + `수용 ${fmtInt(m.A)}건 (${fmtPercent(m.accept)})<br/>일부수용 ${fmtInt(m.P)}건 (${fmtPercent(m.partial)})<br/>불수용 ${fmtInt(m.R)}건 (${fmtPercent(m.reject)})`
              + (m.K === 0 ? '<br/>결과가 나온 신고가 없어 비율을 계산할 수 없습니다' : '');
          }
          return `${head}<br/>과태료 처분 ${m.F === null ? '—' : `${fmtInt(m.F)}건`} (${fmtPercent(m.fineRate)})`
            + `<br/>과태료 외 ${m.F === null ? '—' : `${fmtInt(m.C - m.F)}건`} (경고·범칙금·처분 없음·미확인 포함)`;
        } },
      xAxis: { type: 'category', data: labels, triggerEvent: true,
        // by category VALUE: under a dataZoom window the formatter's index counts the visible ticks, not the categories
        axisLabel: { color: t.muted, interval: 0, rotate, fontSize: 11, lineHeight: 14, formatter: (v: string) => lineOf.get(v) ?? v },
        axisLine: { lineStyle: { color: t.grid } } },
      yAxis: [
        { type: 'value', min: 0, max: 100, name: '비율', nameTextStyle: { color: t.muted }, axisLabel: { color: t.muted, formatter: '{value}%' }, splitLine: { lineStyle: { color: t.grid } } },
        { type: 'value', min: 0, max: Math.max(1, Math.ceil(maxC * 1.15)), minInterval: 1, name: '답변(건)', nameTextStyle: { color: t.muted },
          axisLabel: { color: t.muted }, splitLine: { show: false } },
      ],
      ...(zoom ? { dataZoom: [
        { type: 'inside', xAxisIndex: 0, startValue: w.start, endValue: w.end, zoomOnMouseWheel: false, moveOnMouseWheel: false },
        { type: 'slider', xAxisIndex: 0, startValue: w.start, endValue: w.end, height: 14, bottom: 6, showDetail: false, brushSelect: false },
      ] } : {}),
      series: [
        ...series.map((s, si) => ({ name: s.name, type: 'bar', stack: 'share', yAxisIndex: 0, barMaxWidth: 36,
          itemStyle: { color: color(s.color) },
          data: rows.map((r) => (r.segments ? r.segments[si].value : null)) })),
        { name: '답변 완료(건)', type: 'line', yAxisIndex: 1, smooth: false, symbol: 'circle', symbolSize: 8,
          lineStyle: { color: t.text, width: 1.5 }, itemStyle: { color: t.text },
          data: rows.map((r) => r.count) },
      ] };
  }, [managers, mode], theme, undefined, {
    datazoom: readWindow,
    // a manager name on the axis: the same tooltip as its bar (hover, or tap on touch screens)
    axis: (chart, e) => {
      const i = live.current.labels.indexOf(String(e.value));
      if (i >= 0) chart.dispatchAction({ type: 'showTip', seriesIndex: live.current.lineSeries, dataIndex: i });
    },
  });

  const go = (w: ChartWindow | null) => {
    const chart = chartRef.current;
    if (!w || !chart) return;
    chart.dispatchAction({ type: 'dataZoom', startValue: w.start, endValue: w.end });
  };
  const view = win.end < n ? win : firstWindow(n);
  const prev = zoom && !table ? prevWindow(view, n) : null;
  const next = zoom && !table ? nextWindow(view, n) : null;
  const remaining = Math.max(0, total - n);
  const canLoad = remaining > 0 && !!onLoadMore;
  const atEnd = table || view.end >= n - 1;
  const loadLabel = loadingMore ? '불러오는 중…' : loadError ? '다시 시도'
    : remaining > loadStep ? `다음 ${fmtInt(loadStep)}명 불러오기` : `나머지 ${fmtInt(remaining)}명 불러오기`;
  const showNav = zoom || remaining > 0;
  // namesakes among the rows on screen: the window of the chart, or every row of the table
  const shownIdx = table ? managers.map((_, i) => i) : managers.map((_, i) => i).filter((i) => i >= view.start && i <= view.end);
  const namesakes = new Map<string, SameNameInfo>();
  for (const i of shownIdx) { const sn = sameOf[i]; if (sn && !namesakes.has(managerNameOf(managers[i]))) namesakes.set(managerNameOf(managers[i]), sn); }

  return (
    <article className="cm-panel chart-card place-entity-chart" aria-label={title}>
      <div className="panel-top">
        <div>
          <h2>{title}</h2>
          <span className="subtitle">{title.startsWith('이 주소') ? '선택한 주소의 신고만' : '선택 범위의 신고만 · 목록에 불러온 담당자만'} · 막대는 100% 비율, 선은 답변 완료 건수</span>
        </div>
        <div className="card-tools">
          <div className="radio-group" role="radiogroup" aria-label="막대 기준">
            <label><input type="radio" name="place-chart-mode" checked={mode === 'accept'} onChange={() => setMode('accept')} />수용률</label>
            <label><input type="radio" name="place-chart-mode" checked={mode === 'fine'} onChange={() => setMode('fine')} />과태료 부과율</label>
          </div>
          <button className="icon-btn" type="button" aria-label={table ? '그래프로 보기' : '표로 보기'} aria-pressed={table} onClick={() => setTable((v) => !v)}>
            <Icon name="table" />
          </button>
        </div>
      </div>
      <div className="chart-legend">
        {series.map((s) => <span key={s.key}><i className="dot" style={{ background: `var(--${s.color === 'unknown' ? 'unknown' : s.color})` }} />{s.name}</span>)}
        <span><i className="dash solid" aria-hidden="true" />답변 완료(건, 오른쪽 축)</span>
      </div>
      {n === 0 && <div className="empty-state">이 주소의 답변 완료 신고에 담당자 정보가 없습니다.</div>}
      <div ref={hostRef} className="chart-host" hidden={table || n === 0 || !!error} role="img"
        aria-label={`담당자 ${n}명 중 ${fmtInt(view.start + 1)}–${fmtInt(view.end + 1)}번째의 ${mode === 'accept' ? '수용률' : '과태료 부과율'} 막대와 답변 건수`} />
      {error && !table && <div className="empty-state" role="alert">{error}</div>}
      {table && (
        <div className="trend-table"><table>
          <thead><tr><th scope="col">담당자</th><th scope="col">답변(건)</th><th scope="col">결과 나온 신고(건)</th><th scope="col">결과 미상(건)</th>
            <th scope="col">수용률</th><th scope="col">일부수용률</th><th scope="col">불수용률</th><th scope="col">과태료(건)</th><th scope="col">과태료 부과율</th></tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={managers[i].key}><td title={sameOf[i] ? `${managers[i].agency_name}\n${sameNameNote(sameOf[i]!).join('\n')}` : managers[i].agency_name}>{labels[i]}</td><td>{fmtInt(r.m.C)}</td><td>{fmtInt(r.m.K)}</td><td>{fmtInt(r.m.U)}</td>
              <td>{fmtPercent(r.m.accept)}</td><td>{fmtPercent(r.m.partial)}</td><td>{fmtPercent(r.m.reject)}</td>
              <td>{r.m.F === null ? '—' : fmtInt(r.m.F)}</td><td>{fmtPercent(r.m.fineRate)}</td></tr>
          ))}</tbody>
        </table></div>
      )}
      {showNav && n > 0 && (
        <div className="pe-nav" role="group" aria-label="담당자 범위 이동">
          {!table && <button type="button" className="mini-btn pe-nav-prev" disabled={!prev} onClick={() => go(prev)} aria-label="이전 담당자 8명">‹ 이전</button>}
          <span className="pe-nav-range cm-number" aria-live="polite">
            {table ? (remaining > 0 ? `표: 불러온 ${fmtInt(n)}명 · 전체 ${fmtInt(total)}명` : `표: 담당자 ${fmtInt(n)}명`) : rangeText(view, n, total)}
          </span>
          {!table && (!atEnd || !canLoad) && <button type="button" className="mini-btn pe-nav-next" disabled={!next} onClick={() => go(next)} aria-label="다음 담당자 8명">다음 ›</button>}
          {atEnd && canLoad && (
            <button type="button" className="mini-btn pe-nav-more" disabled={loadingMore} aria-busy={loadingMore} onClick={() => onLoadMore?.()}>{loadLabel}</button>
          )}
          {atEnd && canLoad && loadError && !loadingMore && (
            <span className="pe-nav-error" role="alert">담당자를 더 불러오지 못했습니다. 지금 보이는 {fmtInt(n)}명은 그대로입니다.</span>
          )}
          {remaining > 0 && !onLoadMore && <span className="cm-muted pe-nav-note">나머지 {fmtInt(remaining)}명은 이 그래프에 없습니다</span>}
        </div>
      )}
      {namesakes.size > 0 && (
        <p className="pe-namesake" role="note">
          <b>기관명이 붙은 이름</b>은 이 조건 안에 같은 이름의 담당자가 둘 이상이라 소속 기관으로 구분한 것입니다
          {!same.fromServer && ' (불러온 담당자 기준)'}.
          {[...namesakes].map(([name, sn]) => (
            <span key={name} className="pe-namesake-item"><b>{name}</b> {fmtInt(sn.count)}명: {sn.peers.join(' · ')}{sn.count > sn.peers.length ? ` 외 ${fmtInt(sn.count - sn.peers.length)}명` : ''}{sn.same_agency ? ' (같은 기관 이름은 번호로 구분, 따로 집계)' : ''}</span>
          ))}
        </p>
      )}
      {exportCtx && (
        <ExportButton source="place-managers" blocked={n === 0 ? '담당자 자료가 없습니다' : exportCtx.blocked}
          capture={() => placeManagersSnapshot({ managers, total, mode, scopeTitle: title, conditions: exportCtx.conditions,
            datasetVersion: exportCtx.datasetVersion, capturedAt: new Date().toISOString() })} />
      )}
      <p className="chart-caption">
        {mode === 'accept'
          ? '수용률 막대 전체(100%)는 결과가 나온 신고(수용+일부 수용+불수용)입니다. 결과 미상은 막대에서 빠지므로 선(답변 완료)과 다를 수 있습니다.'
          : '과태료 부과율 막대 전체(100%)는 답변 완료 신고입니다. 금액이 적혀 있지 않아도 처분이 과태료면 포함합니다.'}
        {!showNav && ` 담당자 ${fmtInt(n)}명.`}
      </p>
    </article>
  );
}
