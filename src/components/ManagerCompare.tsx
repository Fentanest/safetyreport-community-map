import { useState } from 'react';
import type { CompareEntityRow } from '../domain/personal';
import type { PersonalState } from '../hooks/usePersonal';
import { fmtDaysDiff, fmtInt, fmtPercent, fmtPp } from './format';

interface Props {
  personal: PersonalState;
  /** apply agency/manager condition (same keys as the public table) */
  onPick: (row: CompareEntityRow) => void;
}

/** Data wiring: Sol · visual implementation: Muse (docs/personal-comparison.md §4, §5.1). */
export default function ManagerCompare({ personal, onPick }: Props) {
  const [tab, setTab] = useState<'manager' | 'agency'>('manager');
  const data = personal.status === 'ready' ? personal.data : null;
  const [expanded, setExpanded] = useState(false);
  const all = data ? (tab === 'manager' ? data.managers : data.agencies) : [];
  const SHORT = 5;
  const rows = expanded ? all : all.slice(0, SHORT);
  return (
    <section className="cm-panel manager-compare" aria-label="담당자·기관 비교">
      <div className="panel-top">
        <div>
          <h2>내 신고를 처리한 담당자·기관</h2>
          <span className="subtitle">같은 담당자의 전체 결과와 내 결과를 나란히 봅니다. 평가가 아닙니다.</span>
        </div>
        <div className="mini-segments" role="group" aria-label="담당자 또는 기관">
          <button type="button" className={tab === 'manager' ? 'selected' : ''} aria-pressed={tab === 'manager'} onClick={() => { setTab('manager'); setExpanded(false); }}>담당자</button>
          <button type="button" className={tab === 'agency' ? 'selected' : ''} aria-pressed={tab === 'agency'} onClick={() => { setTab('agency'); setExpanded(false); }}>기관</button>
        </div>
      </div>
      {!data ? (
        <p className="empty-state">{personal.status === 'loading' || personal.status === 'waiting' ? '불러오는 중…' : '로그인하고 ‘내 신고와 비교’를 켜면 보입니다.'}</p>
      ) : rows.length === 0 ? (
        <p className="empty-state">이 조건에서 답변을 받은 내 신고가 없습니다.</p>
      ) : (
        <div className="table-scroll">
          <table className="entity-table compare-entities">
            <thead>
              <tr>
                <th scope="col">{tab === 'manager' ? '담당자 · 소속기관' : '처리기관'}</th>
                <th scope="col" className="num">전체 답변</th>
                <th scope="col" className="num">전체 수용률</th>
                <th scope="col" className="num">전체 일부수용률</th>
                <th scope="col" className="num mine-col">내 답변</th>
                <th scope="col" className="num mine-col">내 수용률</th>
                <th scope="col" className="num mine-col">내 일부수용률</th>
                <th scope="col" className="num">차이</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.key}>
                  <td>
                    <button type="button" className="mini-btn" title="이 담당자·기관만 보기"
                      disabled={!r.agency_key || (r.kind === 'manager' && !r.manager_key)} onClick={() => onPick(r)}>
                      <span className="table-name">{r.kind === 'manager' ? (r.manager_name ?? '이름 없음') : r.agency_name}</span>
                      {r.kind === 'manager' && <small>{r.agency_name}</small>}
                    </button>
                  </td>
                  <td className="num">{fmtInt(r.all.completed_count)}</td>
                  <td className="num">{fmtPercent(r.all.accept_rate)}<small>{fmtInt(r.all.accepted)} / {fmtInt(r.all.result_known)}</small></td>
                  <td className="num">{fmtPercent(r.all.partial_rate)}<small>{fmtInt(r.all.partial)} / {fmtInt(r.all.result_known)}</small></td>
                  <td className="num mine-col">{fmtInt(r.mine.completed_count)}{r.mine.result_known === 1 && <span className="sample-one">1건</span>}</td>
                  <td className="num mine-col">{fmtPercent(r.mine.accept_rate)}<small>{fmtInt(r.mine.accepted)} / {fmtInt(r.mine.result_known)}</small></td>
                  <td className="num mine-col">{fmtPercent(r.mine.partial_rate)}<small>{fmtInt(r.mine.partial)} / {fmtInt(r.mine.result_known)}</small></td>
                  <td className="num">수용 {fmtPp(r.accept_rate_pp)}<small>일부 {fmtPp(r.partial_rate_pp)}</small><small>답변까지 {fmtDaysDiff(r.duration_median_days_diff)}</small></td>
                </tr>
              ))}
            </tbody>
          </table>
          {all.length > SHORT && (
            <div className="compare-more">
              <button type="button" className="ghost-btn" aria-expanded={expanded} onClick={() => setExpanded(v => !v)}>
                {expanded ? '접기' : `전체 ${fmtInt(all.length)}${tab === 'manager' ? '명' : '곳'} 보기`}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
