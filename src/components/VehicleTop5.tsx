import type { PublicVehicle } from '../domain/public';
import { fmtInt } from './format';

interface Props {
  vehicles: PublicVehicle[];
  totalScope: number | null;
  identifiable: number | null;
  toast: (msg: string) => void;
}

export default function VehicleTop5({ vehicles }: Props) {
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
        </div>
      ) : (
        <ol className="vehicle-list">
          {vehicles.map((v) => (
            <li key={v.rank_item_id}>
              <span className="rank">0{v.rank}</span>
              <span>
                <code>{v.masked_plate}</code>
              </span>
              <b>{fmtInt(v.report_count)}<small>건</small></b>
              <span className="share-bar" aria-hidden="true"><i style={{ width: `${(v.report_count / max) * 100}%` }} /></span>
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}
