import { useState } from 'react';
import type { PlaceDetail, PublicEntity, PublicPoint } from '../domain/public';
import type { PointMark } from '../state/pointMarks';
import { acceptRate, fmtInt, fmtPercent } from './format';
import { duplicateNames, entityLabel, entityRates } from './entityMetrics';

export type PlaceDetailState =
  | { status: 'loading' }
  | { status: 'ready'; detail: PlaceDetail }
  | { status: 'error'; message: string }
  | { status: 'unsupported' };

interface Props {
  /** the selected pin as drawn (immediate summary while the detail loads) */
  point: PublicPoint;
  detail: PlaceDetailState;
  scopeLabel: string;
  mark?: PointMark | null;
  onClose: () => void;
  onRetry: () => void;
  onPickEntity: (kind: 'agency' | 'manager', entity: PublicEntity) => void;
  toast: (msg: string) => void;
  /** currently applied agency/manager filter (active highlight) */
  activeAgency?: string | null;
  activeManager?: string | null;
}

const LIST_STEP = 6;
const pct = (a: number, d: number) => (d > 0 ? (a / d) * 100 : null);

/** R2: name (the only button) + separate metric boxes; boxes are plain cells, never nested buttons. */
function EntityMetricRow({ kind, e, label, active, onPick }: { kind: 'agency' | 'manager'; e: PublicEntity; label: string;
  active: boolean; onPick: Props['onPickEntity'] }) {
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
        <div className="pe-box"><span className="pe-label">계도처분율</span><b className="pe-num cm-number">{fmtPercent(m.warnRate)}</b></div>
      </div>
    </li>
  );
}

function EntityList({ kind, rows, total, onPick, activeAgency, activeManager }: { kind: 'agency' | 'manager'; rows: PublicEntity[]; total: number;
  onPick: Props['onPickEntity']; activeAgency: string | null; activeManager: string | null }) {
  const [shown, setShown] = useState(LIST_STEP);
  const dup = duplicateNames(rows);
  if (rows.length === 0) return <p className="cm-muted place-empty">이 주소의 답변 완료 신고에 {kind === 'agency' ? '기관' : '담당자'} 정보가 없습니다.</p>;
  return (
    <>
      <ul className="place-entities">
        {rows.slice(0, shown).map((e) => (
          <EntityMetricRow key={e.key} kind={kind} e={e} label={entityLabel(e, kind, dup.has(e.manager_name ?? '이름 없음'))}
            active={kind === 'agency' ? activeAgency === e.agency_key && !activeManager : activeManager === e.manager_key && activeAgency === e.agency_key}
            onPick={onPick} />
        ))}
      </ul>
      {(rows.length > shown || total > rows.length) && (
        <div className="place-more">
          {rows.length > shown && (
            <button type="button" className="mini-btn" onClick={() => setShown((n) => n + LIST_STEP)}>더 보기 · {fmtInt(rows.length - shown)}</button>
          )}
          {total > rows.length && <span className="cm-muted">많은 순 {fmtInt(rows.length)}개만 받음 · 전체 {fmtInt(total)}개</span>}
        </div>
      )}
    </>
  );
}

/** R05: one scrollable panel, sections in a fixed order — no tabs, no accordion. */
export default function PlaceDetailsPanel(p: Props) {
  const pt = p.detail.status === 'ready' ? p.detail.detail.place : p.point;
  const o = pt.outcomes;
  const known = o?.result_known ?? 0;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(pt.address ?? '');
      p.toast('주소를 복사했습니다.');
    } catch {
      p.toast('복사에 실패했습니다. 직접 선택해 복사해 주세요.');
    }
  };
  const warning = pt.warning_count;
  const rows = [
    { label: '수용', v: o?.accepted ?? 0, color: 'var(--accepted)' },
    { label: '일부 수용', v: o?.partial ?? 0, color: 'var(--partial)' },
    { label: '불수용', v: o?.rejected ?? 0, color: 'var(--rejected)' },
  ];
  return (
    <aside className="cm-panel place-panel" aria-label="선택한 주소">
      <header className="place-head">
        <div>
          <span className="overline">선택한 주소</span>
          <h2>{pt.address ?? '주소 없음'}</h2>
          <p className="subtitle">{p.scopeLabel}</p>
        </div>
        <div className="place-actions">
          <button className="mini-btn" type="button" onClick={copy} disabled={!pt.address}>주소 복사</button>
          <button className="mini-btn" type="button" onClick={p.onClose} aria-label="선택한 주소 닫기">닫기</button>
        </div>
      </header>
      {p.mark?.mine && (
        <p className="mine-note" role="note">이 주소에 내 신고 {fmtInt(p.mark.mineCount)}건 · {p.mark.shared ? '다른 사람과 함께 신고한 곳' : '나만 신고한 곳'}</p>
      )}

      <section className="place-summary" aria-label="요약">
        <div><small>신고</small><b className="cm-number">{fmtInt(pt.report_count)}</b><span>건 · 신고한 날</span></div>
        <div title="경고·계도 처분으로 확인된 신고 (답변 받은 날 기준)">
          <small>계도</small>
          <b className="cm-number">{warning === undefined ? '—' : fmtInt(warning)}</b>
          <span>{warning === undefined ? '서버 미지원' : '건 · 경고·계도 처분'}</span>
        </div>
        <div><small>과태료</small><b className="cm-number">{fmtInt(pt.fine_count)}</b><span>건 · 답변 받은 날</span></div>
        <div><small>수용률</small><b className="cm-number">{fmtPercent(acceptRate(o))}</b><span>{fmtInt(o?.accepted ?? null)}/{fmtInt(known)}건</span></div>
        <div><small>불수용률</small><b className="cm-number">{fmtPercent(pct(o?.rejected ?? 0, known))}</b><span>{fmtInt(o?.rejected ?? null)}/{fmtInt(known)}건</span></div>
      </section>

      <section className="place-section" aria-label="처리 결과">
        <h3>처리 결과 <small>답변 {fmtInt(pt.completed_count)}건 중 결과가 나온 {fmtInt(known)}건</small></h3>
        {known > 0 ? (
          <>
            <div className="stack" role="img" aria-label={rows.map((r) => `${r.label} ${r.v}건`).join(', ')}>
              {rows.map((r) => <i key={r.label} style={{ width: `${(r.v / known) * 100}%`, background: r.color }} />)}
            </div>
            <div className="place-dist">
              {rows.map((r) => (
                <span key={r.label}><i className="dot" style={{ background: r.color }} />{r.label} <b className="cm-number">{fmtInt(r.v)}</b> <small>{fmtPercent(pct(r.v, known))}</small></span>
              ))}
              <span><i className="dot" style={{ background: 'var(--unknown)' }} />결과 미상 <b className="cm-number">{fmtInt(o?.result_unknown ?? 0)}</b> <small>비율에서 제외</small></span>
            </div>
          </>
        ) : <p className="cm-muted place-empty">이 주소에는 결과가 나온 답변이 아직 없습니다.</p>}
      </section>

      {pt.aggregate ? (
        <section className="place-section">
          <p className="insight-copy">서로 다른 주소 {fmtInt(pt.point_count ?? null)}곳을 묶어 보여 주는 점입니다. 지도를 확대하면 주소별 핀으로 나뉩니다.</p>
        </section>
      ) : p.detail.status === 'loading' ? (
        <section className="place-section" aria-busy="true"><p className="cm-muted place-empty" role="status">이 주소의 기관·담당자를 불러오는 중…</p></section>
      ) : p.detail.status === 'error' ? (
        <section className="place-section" role="alert">
          <p className="place-empty">{p.detail.message}</p>
          <button className="mini-btn" type="button" onClick={p.onRetry}>다시 시도</button>
        </section>
      ) : p.detail.status === 'unsupported' ? (
        <section className="place-section"><p className="cm-muted place-empty">이 서버는 주소별 기관·담당자 목록을 아직 제공하지 않습니다.</p></section>
      ) : (
        <>
          <section className="place-section" aria-label="처리 기관">
            <h3>처리 기관 <small>{fmtInt(p.detail.detail.agency_total)}곳 · 이 주소 신고만</small></h3>
            <EntityList kind="agency" rows={p.detail.detail.agencies} total={p.detail.detail.agency_total} onPick={p.onPickEntity}
              activeAgency={p.activeAgency ?? null} activeManager={p.activeManager ?? null} />
          </section>
          <section className="place-section" aria-label="담당자">
            <h3>담당자 <small>{fmtInt(p.detail.detail.manager_total)}명 · 소속 기관과 함께</small></h3>
            <EntityList kind="manager" rows={p.detail.detail.managers} total={p.detail.detail.manager_total} onPick={p.onPickEntity}
              activeAgency={p.activeAgency ?? null} activeManager={p.activeManager ?? null} />
          </section>
        </>
      )}
      <p className="place-note">
        신고는 신고한 날, 처리 결과·계도·과태료는 답변 받은 날 기준입니다. 같은 주소의 신고를 하나로 묶었고, 지도 위치는 표시용 대표 위치입니다.
        이름·기관은 처리 결과 비교용이며 평가가 아닙니다.
      </p>
    </aside>
  );
}
