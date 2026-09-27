import type { PublicVehicle } from '../domain/public';
import { fmtInt } from './format';

interface Props {
  vehicles: PublicVehicle[];
  totalScope: number | null;
  identifiable: number | null;
  toast: (msg: string) => void;
}

export default function VehicleTop5({ vehicles, totalScope, identifiable, toast }: Props) {
  const max = Math.max(1, ...vehicles.map((v) => v.report_count));
  return (
    <article className="cm-panel vehicles-card" aria-label="많이 신고된 차량 TOP 5">
      <div className="panel-top">
        <div>
          <h2>많이 신고된 차량 <em>TOP 5</em></h2>
          <span className="subtitle">신고가 곧 위반 확정은 아닙니다</span>
        </div>
      </div>
      {vehicles.length === 0 ? (
        <div className="empty-state" style={{ margin: '8px 16px 0' }}>
          <span>번호를 알 수 있는 차량 신고가 없습니다.</span>
          <small>전체 신고 {fmtInt(totalScope)}건은 다른 통계에 그대로 들어갑니다.</small>
        </div>
      ) : (
        <ol className="vehicle-list">
          {vehicles.map((v) => (
            <li key={v.rank_item_id} title="번호 일부를 가렸기 때문에 모양이 같아도 다른 차량일 수 있습니다">
              <span className="rank">0{v.rank}</span>
              <span>
                <code>{v.masked_plate}</code>
                <button
                  type="button" className="mini-btn" style={{ marginLeft: 8 }}
                  onClick={() => toast('번호판은 지역명 뒤 2·4·6번째 글자를 *로 가려 보여 줍니다. 차량을 조회하거나 추적하는 기능은 없습니다.')}
                  aria-label={`${v.masked_plate} 번호 가림 안내`}
                >
                  안내
                </button>
                <span className="dup-note" style={{ display: 'block' }}>{`신고 ${fmtInt(v.report_count)}건`}</span>
              </span>
              <b>{fmtInt(v.report_count)}<small>건</small></b>
              <span className="share-bar" aria-hidden="true"><i style={{ width: `${(v.report_count / max) * 100}%` }} /></span>
            </li>
          ))}
        </ol>
      )}
      <p className="card-footnote">
        번호 일부는 가려서 보여 드립니다 · 번호를 알 수 있는 신고 {fmtInt(identifiable)}건 / 전체 {fmtInt(totalScope)}건
      </p>
    </article>
  );
}
