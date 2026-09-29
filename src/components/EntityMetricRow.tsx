import type { PublicEntity } from '../domain/public';
import { fmtInt, fmtPercent } from './format';
import { entityRates } from './entityMetrics';

/** R2: name (the only button) + separate metric boxes; boxes are plain cells, never nested buttons. */
export default function EntityMetricRow({ kind, e, label, active, onPick }: { kind: 'agency' | 'manager'; e: PublicEntity; label: string;
  active: boolean; onPick: (kind: 'agency' | 'manager', entity: PublicEntity) => void }) {
  const m = entityRates(e);
  const full = kind === 'manager' ? `${e.manager_name ?? '이름 없음'} · ${e.agency_name}` : e.agency_name;
  return (
    <li className={`pe-row${active ? ' active' : ''}`}>
      <div className="pe-name">
        <button type="button" className="pe-pick" title={`${full} — 이 ${kind === 'agency' ? '기관' : '담당자'}만 보기`} aria-pressed={active}
          disabled={!e.agency_key || (kind === 'manager' && !e.manager_key)} onClick={() => onPick(kind, e)}>
          {label}
        </button>
        {kind === 'manager' && <small title={e.agency_name}>{e.agency_name}</small>}
      </div>
      <div className="pe-metrics">
        <div className="pe-box"><span className="pe-label">답변</span><b className="pe-num cm-number">{fmtInt(m.C)}건</b></div>
        <div className="pe-box pe-triple" title={`결과 확인 ${m.K}건 기준 · 결과 미상 ${m.U}건 제외`}>
          <span className="pe-label">처리 결과 <small>(결과 확인 {fmtInt(m.K)}건)</small></span>
          <div className="pe-cells">
            <span><em>수용</em><b className="pe-num cm-number">{fmtPercent(m.accept)}</b></span>
            <span><em>일부수용</em><b className="pe-num cm-number">{fmtPercent(m.partial)}</b></span>
            <span><em>불수용</em><b className="pe-num cm-number">{fmtPercent(m.reject)}</b></span>
          </div>
        </div>
        <div className="pe-box"><span className="pe-label">과태료</span>
          <b className="pe-num cm-number">{m.F === null ? '—' : `${fmtInt(m.F)}건`} <i aria-hidden="true">|</i> {fmtPercent(m.fineRate)}</b></div>
        <div className="pe-box"><span className="pe-label">계도</span><b className="pe-num cm-number">{m.W === null ? '—' : `${fmtInt(m.W)}건`}</b></div>
        <div className="pe-box"><span className="pe-label">경고·계도 비율</span><b className="pe-num cm-number">{fmtPercent(m.warnRate)}</b></div>
      </div>
    </li>
  );
}

