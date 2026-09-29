/**
 * R3: 이 주소의 담당자별 처리 현황 — per-manager 100% stacked bars (left axis, 0–100%) + answered-count line
 * (right axis, integer counts) for ONE address under the same scope/version as the place detail.
 * Managers are categories, not time: the count points are joined with straight segments only as a reading aid.
 * Bars, table and the metric boxes share `entityRates` (src/components/entityMetrics.ts).
 */
import { useState } from 'react';
import type { PublicEntity } from '../domain/public';
import { baseOption, useEChart } from '../lib/charts';
import { duplicateNames, entityLabel, entityRates } from './entityMetrics';
import { fmtInt, fmtPercent } from './format';
import Icon from './icons';

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

export default function PlaceEntityChart({ managers, total, theme, loadingMore, onLoadMore }: {
  managers: PublicEntity[];
  total: number;
  theme: string;
  loadingMore: boolean;
  onLoadMore: (() => void) | null;
}) {
  const [mode, setMode] = useState<PlaceChartMode>('accept');
  const [table, setTable] = useState(false);
  const dup = duplicateNames(managers);
  const labels = managers.map((e) => entityLabel(e, 'manager', dup.has(e.manager_name ?? '이름 없음')));
  const rows = managers.map((e) => placeChartSegments(e, mode));
  const series = mode === 'accept' ? ACCEPT_SERIES : FINE_SERIES;
  const zoom = managers.length > 8;
  const { hostRef, error } = useEChart((t) => {
    if (managers.length === 0) return null;
    const color = (c: 'accepted' | 'partial' | 'rejected' | 'fine' | 'unknown') => t[c];
    const maxC = Math.max(1, ...rows.map((r) => r.count));
    return { ...baseOption(t), grid: { left: 44, right: 44, top: 28, bottom: zoom ? 64 : 44 },
      tooltip: { ...baseOption(t).tooltip, trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: (ps: Array<{ dataIndex: number }>) => {
          const i = ps[0]?.dataIndex ?? 0;
          const { m } = rows[i];
          const head = `<b>${labels[i]}</b><br/>답변 ${fmtInt(m.C)}건`;
          if (mode === 'accept') {
            return `${head} · 결과 확인 ${fmtInt(m.K)}건 · 결과 미상 ${fmtInt(m.U)}건<br/>`
              + `수용 ${fmtInt(m.A)}건 (${fmtPercent(m.accept)})<br/>일부수용 ${fmtInt(m.P)}건 (${fmtPercent(m.partial)})<br/>불수용 ${fmtInt(m.R)}건 (${fmtPercent(m.reject)})`
              + (m.K === 0 ? '<br/>결과가 나온 신고가 없어 비율을 계산할 수 없습니다' : '');
          }
          return `${head}<br/>과태료 처분 ${m.F === null ? '—' : `${fmtInt(m.F)}건`} (${fmtPercent(m.fineRate)})`
            + `<br/>과태료 외 ${m.F === null ? '—' : `${fmtInt(m.C - m.F)}건`} (경고·범칙금·처분 없음·미확인 포함)`;
        } },
      xAxis: { type: 'category', data: labels, axisLabel: { color: t.muted, interval: 0, rotate: managers.length > 4 ? 30 : 0, fontSize: 11 },
        axisLine: { lineStyle: { color: t.grid } } },
      yAxis: [
        { type: 'value', min: 0, max: 100, name: '비율', nameTextStyle: { color: t.muted }, axisLabel: { color: t.muted, formatter: '{value}%' }, splitLine: { lineStyle: { color: t.grid } } },
        { type: 'value', min: 0, max: Math.max(1, Math.ceil(maxC * 1.15)), minInterval: 1, name: '답변(건)', nameTextStyle: { color: t.muted },
          axisLabel: { color: t.muted }, splitLine: { show: false } },
      ],
      ...(zoom ? { dataZoom: [{ type: 'inside', xAxisIndex: 0, startValue: 0, endValue: 7 }, { type: 'slider', xAxisIndex: 0, startValue: 0, endValue: 7, height: 14, bottom: 6 }] } : {}),
      series: [
        ...series.map((s, si) => ({ name: s.name, type: 'bar', stack: 'share', yAxisIndex: 0, barMaxWidth: 36,
          itemStyle: { color: color(s.color) },
          data: rows.map((r) => (r.segments ? r.segments[si].value : null)) })),
        { name: '답변 완료(건)', type: 'line', yAxisIndex: 1, smooth: false, symbol: 'circle', symbolSize: 8,
          lineStyle: { color: t.text, width: 1.5 }, itemStyle: { color: t.text },
          data: rows.map((r) => r.count) },
      ] };
  }, [managers, mode], theme);

  return (
    <article className="cm-panel chart-card place-entity-chart" aria-label="이 주소의 담당자별 처리 현황">
      <div className="panel-top">
        <div>
          <h2>이 주소의 담당자별 처리 현황</h2>
          <span className="subtitle">선택한 주소의 신고만 · 막대는 100% 비율, 선은 답변 완료 건수</span>
        </div>
        <div className="card-tools">
          <div className="radio-group" role="radiogroup" aria-label="막대 기준">
            <label><input type="radio" name="place-chart-mode" checked={mode === 'accept'} onChange={() => setMode('accept')} />수용률</label>
            <label><input type="radio" name="place-chart-mode" checked={mode === 'fine'} onChange={() => setMode('fine')} />과태료처분율</label>
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
      {managers.length === 0 && <div className="empty-state">이 주소의 답변 완료 신고에 담당자 정보가 없습니다.</div>}
      <div ref={hostRef} className="chart-host" hidden={table || managers.length === 0 || !!error} role="img"
        aria-label={`담당자 ${managers.length}명의 ${mode === 'accept' ? '수용률' : '과태료처분율'} 막대와 답변 건수`} />
      {error && !table && <div className="empty-state" role="alert">{error}</div>}
      {table && (
        <div className="trend-table"><table>
          <thead><tr><th scope="col">담당자</th><th scope="col">답변(건)</th><th scope="col">결과 확인(건)</th><th scope="col">결과 미상(건)</th>
            <th scope="col">수용률</th><th scope="col">일부수용률</th><th scope="col">불수용률</th><th scope="col">과태료(건)</th><th scope="col">과태료처분율</th></tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={managers[i].key}><td>{labels[i]}</td><td>{fmtInt(r.m.C)}</td><td>{fmtInt(r.m.K)}</td><td>{fmtInt(r.m.U)}</td>
              <td>{fmtPercent(r.m.accept)}</td><td>{fmtPercent(r.m.partial)}</td><td>{fmtPercent(r.m.reject)}</td>
              <td>{r.m.F === null ? '—' : fmtInt(r.m.F)}</td><td>{fmtPercent(r.m.fineRate)}</td></tr>
          ))}</tbody>
        </table></div>
      )}
      <p className="chart-caption">
        {mode === 'accept'
          ? '수용률 막대의 100%는 결과 확인 건수(수용+일부수용+불수용)입니다. 결과 미상은 막대에서 빠지므로 선(답변 완료)과 다를 수 있습니다.'
          : '과태료처분율 막대의 100%는 답변 완료 건수입니다. 금액이 없어도 처분이 과태료면 포함합니다.'}
        {' '}담당자 표시 {fmtInt(managers.length)}명 / 전체 {fmtInt(Math.max(total, managers.length))}명.
        {total > managers.length && onLoadMore && (
          <button type="button" className="link-btn" disabled={loadingMore} onClick={onLoadMore}>{loadingMore ? ' 불러오는 중…' : ' 나머지 담당자 불러오기'}</button>
        )}
      </p>
    </article>
  );
}
