import { useState, type ReactNode } from 'react';
import type { CountMetric, DateBasis, Overview } from '../domain/public';
import { DATE_BASIS_LABEL } from '../domain/public';
import type { CompareSummary } from '../domain/personal';
import type { PersonalState } from '../hooks/usePersonal';
import { acceptRate, fmtDate, fmtDays, fmtFineAmount, fmtInt, fmtPercent, fmtPp, fmtRating, partialRate } from './format';

/** U02: what the strip describes. The strip itself never moves; only its focus and numbers change. */
export interface KpiFocus {
  kind: 'nation' | 'region' | 'bbox' | 'place';
  /** 전국 / 서울특별시 / 지도 범위 / the full address */
  label: string;
  basis: DateBasis;
  start: string;
  end: string;
}

interface Props {
  focus: KpiFocus;
  /** the overview of `focus` (one snapshot: title, numbers and denominators change together) */
  overview: Overview | null;
  /** 'loading' with an overview = the numbers below still belong to `staleFocus` */
  state: 'ready' | 'loading' | 'error';
  staleFocus?: string | null;
  errorText?: string | null;
  personal: PersonalState;
  showMine: boolean;
  /** place focus: only the viewer's report count of this address is known (never the national 내 신고 values) */
  placeMine?: { reports: number } | null;
  unsupported: boolean;
  /** the detailed all-vs-mine table and definitions (existing CompareKpis), inside the details element */
  detail: ReactNode;
}

const pct = (a: number | null | undefined, d: number | null | undefined) => (a != null && d ? (a / d) * 100 : null);

/** Real period-over-period change only: counts in %, rates in %p; a focus without comparison says so. */
function deltaText(metric: CountMetric, kind: 'count' | 'rate'): string {
  if (metric.previous === null || metric.delta === null) return '비교 자료 없음';
  if (kind === 'count') {
    if (metric.delta_percent === null) return '직전 0건';
    const d = metric.delta_percent;
    return `직전 대비 ${d > 0 ? '+' : d < 0 ? '−' : ''}${Math.abs(d).toFixed(1)}%`;
  }
  return `직전 대비 ${fmtPp(metric.delta)}`;
}

const FOCUS_WORD: Record<KpiFocus['kind'], string> = { nation: '전국', region: '지역', bbox: '지도 범위', place: '선택한 주소' };

export default function KpiPanel({ focus, overview: o, state, staleFocus, errorText, personal, showMine, placeMine, unsupported, detail }: Props) {
  const [open, setOpen] = useState(false);

  const placeFocus = focus.kind === 'place';
  const mine: CompareSummary | null = !placeFocus && showMine && personal.status === 'ready' && personal.data ? personal.data.mine : null;
  const diff = !placeFocus && personal.status === 'ready' ? personal.data?.diff : undefined;
  const mineState = !showMine ? null : placeFocus ? '주소별 내 신고 요약은 신고 건수만 제공합니다'
    : personal.status === 'ready' ? null
      : personal.status === 'loading' || personal.status === 'waiting' ? '내 신고 불러오는 중…'
        : personal.status === 'signed_out' ? '로그인하면 내 신고도 보입니다' : personal.error?.message ?? '내 신고를 불러오지 못했습니다';
  const basisWord = DATE_BASIS_LABEL[focus.basis];

  // 2026-10-04 layout: a few large figures (신고 · 처리 결과 · 과태료 · 답변까지) and one quiet line for the rest.
  type Cell = { id: string; label: string; value: string; sub: string; mine?: string | null; delta?: string };
  type Outcome = { id: string; label: string; color: string; rate: number | null; count: number | null; mine?: string | null };
  const hero: Cell[] = [];
  const minor: Cell[] = [];
  let outcomes: Outcome[] = [];
  let known = 0;
  let unknown: number | null = null;
  if (o) {
    const out = o.outcomes;
    known = out?.result_known ?? 0;
    unknown = out?.result_unknown ?? null;
    const N = o.report_count.value, C = o.completed_count.value;
    const W = o.warning_count;
    const sameNC = N !== null && N === C;
    hero.push({ id: 'report', label: '신고', value: `${fmtInt(N)}건`,
      // KP-13: N = C keeps C as a sub-value; N ≠ C shows both cells
      sub: sameNC ? `답변 확인 ${fmtInt(C)}건` : `${basisWord} 기준`,
      mine: placeFocus ? (placeMine ? `내 신고 ${fmtInt(placeMine.reports)}건` : null) : mine && `내 신고 ${fmtInt(mine.report_count)}건`,
      delta: deltaText(o.report_count, 'count') });
    if (!sameNC) hero.push({ id: 'completed', label: '답변 확인', value: `${fmtInt(C)}건`, sub: `미분류 ${fmtInt(out?.result_unknown ?? null)}건`,
      mine: mine && `내 ${fmtInt(mine.completed_count)}건`, delta: deltaText(o.completed_count, 'count') });
    outcomes = [
      { id: 'accept', label: '수용', color: 'var(--accepted)', rate: acceptRate(out), count: out?.accepted ?? null,
        mine: mine && `내 ${fmtPercent(mine.accept_rate)} (${fmtPp(diff?.accept_rate_pp)})` },
      { id: 'partial', label: '일부수용', color: 'var(--partial)', rate: partialRate(out), count: out?.partial ?? null,
        mine: mine && `내 ${fmtPercent(mine.partial_rate)} (${fmtPp(diff?.partial_rate_pp)})` },
      { id: 'reject', label: '불수용', color: 'var(--rejected)', rate: pct(out?.rejected, known), count: out?.rejected ?? null,
        mine: mine && `내 ${fmtPercent(mine.reject_rate)} (${fmtPp(diff?.reject_rate_pp)})` },
    ];
    hero.push({ id: 'fine', label: '과태료', value: fmtPercent(pct(o.fine_count.value, C)), sub: `${fmtInt(o.fine_count.value)}건 ÷ 답변 ${fmtInt(C)}건`,
      mine: mine && `내 ${fmtPercent(mine.fine_rate)} (${fmtPp(diff?.fine_rate_pp)})` });
    const d = o.processing_duration;
    hero.push({ id: 'duration', label: '답변까지', value: d?.count ? fmtDays(d.median_days) : '—',
      sub: d ? `중앙값 · 계산 ${fmtInt(d.count)}건` : '자료 없음',
      mine: mine && (mine.duration.count ? `내 ${fmtDays(mine.duration.median_days)}` : '내 계산 불가') });
    minor.push({ id: 'warning', label: '계도', value: W == null ? '—' : `${fmtInt(W)}건 · ${fmtPercent(pct(W, C))}`, sub: W == null ? '제공 안 됨' : '' });
    minor.push({ id: 'amount', label: '확인 과태료 금액', value: fmtFineAmount(o.fine_amount), sub: o.fine_amount ? `확인 ${fmtInt(o.fine_amount.confirmed_count)}건` : '제공 안 됨' });
    minor.push({ id: 'rating', label: '평균 별점', value: fmtRating(o.rating), sub: o.rating ? `평가 ${fmtInt(o.rating.count)}건` : '제공 안 됨' });
    minor.push({ id: 'places', label: '장소', value: `${fmtInt(o.point_count.value)}곳`, sub: '', mine: mine && `내 ${fmtInt(mine.point_count)}곳` });
    minor.push({ id: 'contributors', label: '참여자', value: `${fmtInt(o.contributor_count.value)}명`, sub: '', delta: deltaText(o.contributor_count, 'count') });
  }
  const heroCell = (k: Cell) => (
    <div key={k.id} className="kpi-hero-cell" data-kpi={k.id}>
      <span className="kpi-label">{k.label}</span>
      <b className="kpi-value cm-number">{k.value}</b>
      <small className="kpi-basis">{[k.sub, k.delta].filter(Boolean).join(' · ')}</small>
      {showMine && k.mine != null && <small className="kpi-mine mine-col">{k.mine}</small>}
    </div>
  );
  return (
    <section className="cm-panel kpi-strip" aria-label="주요 통계" aria-busy={state === 'loading'} id="summary">
      <header className="kpi-strip-head">
        <h2 data-section-title>주요 통계</h2>
        <span className={`kpi-focus kind-${focus.kind}`} title={focus.label}>
          <small>{FOCUS_WORD[focus.kind]}</small>
          <b className="kpi-focus-label">{focus.label}</b>
        </span>
        <span className="kpi-period">{basisWord} 기준 · {fmtDate(focus.start)} — {fmtDate(focus.end)}</span>
        {state === 'loading' && (
          <span className="kpi-status" role="status">
            {placeFocus ? '주소 정보를 불러오는 중' : '새 조건으로 불러오는 중'}{o && staleFocus ? ` · 아래 숫자는 이전 대상(${staleFocus})의 값` : ''}
          </span>
        )}
        {state === 'error' && <span className="kpi-status error" role="alert">{errorText ?? '불러오지 못했습니다'}</span>}
        {unsupported && <span className="kpi-status">이 조건의 통계는 아직 없습니다</span>}
        {showMine && <span className="cm-chip mine-chip" title="같은 조건의 내 신고">내 신고와 비교 중</span>}
      </header>
      {o ? (
        <>
          <div className="kpi-hero" role="group" aria-label="주요 통계 값">
            {heroCell(hero[0])}
            {hero[1]?.id === 'completed' && heroCell(hero[1])}
            <div className="kpi-hero-cell kpi-outcome-cell" data-kpi="outcome">
              <span className="kpi-label">처리 결과 <small>결과 확인 {fmtInt(known)}건 기준{unknown ? ` · 미분류 ${fmtInt(unknown)}건 제외` : ''}</small></span>
              <div className="kpi-outcome-values">
                {outcomes.map((r) => (
                  <div key={r.id} data-kpi={r.id}>
                    <span className="kpi-outcome-name"><i className="dot" style={{ background: r.color }} />{r.label}</span>
                    <b className="kpi-value cm-number">{fmtPercent(r.rate)}</b>
                    <small className="kpi-basis">{fmtInt(r.count)}건</small>
                    {showMine && r.mine != null && <small className="kpi-mine mine-col">{r.mine}</small>}
                  </div>
                ))}
              </div>
              {known > 0 && (
                <div className="stack kpi-outcome-bar" aria-hidden="true">
                  {outcomes.map((r) => <i key={r.id} style={{ width: `${((r.count ?? 0) / known) * 100}%`, background: r.color }} />)}
                </div>
              )}
            </div>
            {hero.filter((k) => k.id !== 'report' && k.id !== 'completed').map(heroCell)}
          </div>
          <dl className="kpi-minor">
            {minor.map((k) => (
              <div key={k.id} data-kpi={k.id}>
                <dt>{k.label}</dt>
                <dd>
                  <b className="cm-number">{k.value}</b>
                  {[k.sub, k.delta].filter(Boolean).length > 0 && <small> {[k.sub, k.delta].filter(Boolean).join(' · ')}</small>}
                  {showMine && k.mine != null && <small className="mine-col"> · {k.mine}</small>}
                </dd>
              </div>
            ))}
            <div className="kpi-minor-end">
              <button type="button" className="link-btn kpi-more" aria-expanded={open} aria-controls="kpi-detail" onClick={() => setOpen((v) => !v)}>
                {open ? '상세 접기' : showMine ? '전체와 내 신고 상세 비교' : '지표 정의와 상세 수치'}
              </button>
            </div>
          </dl>
        </>
      ) : (
        <div className="kpi-hero">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="kpi-hero-cell skeleton" role="status" aria-label="불러오는 중" />)}
        </div>
      )}
      {mineState && <p className="compare-note" role="status">{mineState}</p>}
      <div className="kpi-detail" id="kpi-detail" hidden={!open}>{open ? detail : null}</div>
    </section>
  );
}
