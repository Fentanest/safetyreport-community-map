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
    <article className="cm-panel vehicles-card" aria-label="신고 접수 차량 TOP5">
      <div className="panel-top">
        <div>
          <h2>신고 접수 차량 <em>TOP 5</em></h2>
          <span className="subtitle">선택 지역 · 신고일 기준 · 위반 확정 아님</span>
        </div>
      </div>
      {vehicles.length === 0 ? (
        <div className="empty-state" style={{ margin: '8px 16px 0' }}>
          <span>식별 가능한 차량 신고가 없습니다.</span>
          <small>전체 신고 {fmtInt(totalScope)}건은 유지됩니다. 없는 값을 0건처럼 채우지 않습니다.</small>
        </div>
      ) : (
        <ol className="vehicle-list">
          {vehicles.map((v) => (
            <li key={v.rank_item_id} title="같은 마스킹 표시라도 서로 다른 원번호일 수 있습니다. 행을 합치지 않습니다.">
              <span className="rank">0{v.rank}</span>
              <span>
                <code>{v.masked_plate}</code>
                <button
                  type="button" className="mini-btn" style={{ marginLeft: 8 }}
                  onClick={() => toast('마스킹 기준: 지역명은 그대로 두고, 그 뒤 번호의 2·4·6번째 글자를 *로 표시합니다. 원번호 조회·추적 화면은 제공하지 않습니다.')}
                  aria-label={`${v.masked_plate} 마스킹 기준 설명`}
                >
                  기준
                </button>
                <span className="dup-note" style={{ display: 'block' }}>{v.rank_item_id} · {v.report_count === 1 ? '표본 1건' : `신고 ${fmtInt(v.report_count)}건`}</span>
              </span>
              <b>{fmtInt(v.report_count)}<small>건</small></b>
              <span className="share-bar" aria-hidden="true"><i style={{ width: `${(v.report_count / max) * 100}%` }} /></span>
            </li>
          ))}
        </ol>
      )}
      <p className="card-footnote">
        지역명 뒤 번호의 2·4·6번째 글자 마스킹 · 1건도 표시 · 식별 {fmtInt(identifiable)} / 전체 {fmtInt(totalScope)}건
      </p>
    </article>
  );
}
