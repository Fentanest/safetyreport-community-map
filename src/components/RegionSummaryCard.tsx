import type { PublicRegion } from '../domain/public';
import { regionLabel } from '../data/regions';
import { MAP_METRICS, metricParts, metricText, type MapMetric } from './mapMetrics';
import { fmtInt } from './format';

/** R7: the region chosen on the rate map, shown beside it (same scope/version as the map colours). */
export default function RegionSummaryCard({ code, regions, metric, statsBbox, onClear }: {
  code: string;
  regions: PublicRegion[] | null;
  metric: MapMetric;
  statsBbox: boolean;
  onClear: () => void;
}) {
  const row = (regions ?? []).find((r) => r.region_code === code) ?? null;
  return (
    <section className="cm-panel region-summary" aria-label="선택한 지역">
      <header className="place-head">
        <div>
          <span className="overline">선택한 지역</span>
          <h2>{regionLabel(code)}</h2>
          <p className="subtitle">신고 위치의 행정구역 기준{statsBbox ? ' · 화면 범위 내 신고만' : ''}</p>
        </div>
        <div className="place-actions"><button className="mini-btn" type="button" onClick={onClear}>지역 해제</button></div>
      </header>
      {!row ? <p className="cm-muted place-empty">이 조건에서 이 지역의 자료가 없습니다.</p> : (
        <div className="region-summary-grid">
          <div className="pe-box"><span className="pe-label">신고</span><b className="pe-num cm-number">{fmtInt(row.report_count)}건</b></div>
          <div className="pe-box"><span className="pe-label">답변</span><b className="pe-num cm-number">{fmtInt(row.completed_count)}건</b></div>
          {MAP_METRICS.filter((m) => m.kind === 'rate').map((m) => (
            <div key={m.id} className={`pe-box${m.id === metric ? ' is-current' : ''}`}>
              <span className="pe-label">{m.legend}</span>
              <b className="pe-num cm-number">{metricText(metricParts(row, m.id), m.id)}</b>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
