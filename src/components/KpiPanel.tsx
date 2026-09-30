import { useEffect, useRef, useState, type ReactNode } from 'react';
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
  const scroller = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [edges, setEdges] = useState({ left: false, right: false });
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const update = () => setEdges({ left: el.scrollLeft > 8, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 8 });
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    ro?.observe(el);
    return () => { el.removeEventListener('scroll', update); ro?.disconnect(); };
  }, [o]);
  const nudge = (dir: 1 | -1) => scroller.current?.scrollBy({ left: dir * Math.max(200, (scroller.current.clientWidth ?? 400) * 0.7), behavior: 'smooth' });

  const placeFocus = focus.kind === 'place';
  const mine: CompareSummary | null = !placeFocus && showMine && personal.status === 'ready' && personal.data ? personal.data.mine : null;
  const diff = !placeFocus && personal.status === 'ready' ? personal.data?.diff : undefined;
  const mineState = !showMine ? null : placeFocus ? '주소별 내 신고 요약은 신고 건수만 제공합니다'
    : personal.status === 'ready' ? null
      : personal.status === 'loading' || personal.status === 'waiting' ? '내 신고 불러오는 중…'
        : personal.status === 'signed_out' ? '로그인하면 내 신고도 보입니다' : personal.error?.message ?? '내 신고를 불러오지 못했습니다';
  const basisWord = DATE_BASIS_LABEL[focus.basis];

  type Cell = { id: string; label: string; value: string; sub: string; mine?: string | null; delta?: string; tone: string };
  const cells: Cell[] = [];
  if (o) {
    const out = o.outcomes;
    const K = out?.result_known ?? 0;
    const N = o.report_count.value, C = o.completed_count.value;
    const W = o.warning_count;
    const sameNC = N !== null && N === C;
    cells.push({ id: 'report', label: '신고', value: `${fmtInt(N)}건`, tone: 'brand',
      // KP-13: N = C keeps C as a sub-value; N ≠ C shows both cells
      sub: sameNC ? `답변 확인 ${fmtInt(C)}건` : `${basisWord} 기준`,
      mine: placeFocus ? (placeMine ? `내 신고 ${fmtInt(placeMine.reports)}건` : null) : mine && `내 신고 ${fmtInt(mine.report_count)}건`,
      delta: deltaText(o.report_count, 'count') });
    if (!sameNC) cells.push({ id: 'completed', label: '답변 확인', value: `${fmtInt(C)}건`, tone: 'cyan', sub: `미분류 ${fmtInt(out?.result_unknown ?? null)}건`,
      mine: mine && `내 ${fmtInt(mine.completed_count)}건`, delta: deltaText(o.completed_count, 'count') });
    cells.push({ id: 'accept', label: '수용률', value: fmtPercent(acceptRate(out)), sub: `${fmtInt(out?.accepted ?? null)} / ${fmtInt(K)}건`, tone: 'accepted',
      mine: mine && `내 ${fmtPercent(mine.accept_rate)} (${fmtPp(diff?.accept_rate_pp)})` });
    cells.push({ id: 'partial', label: '일부수용률', value: fmtPercent(partialRate(out)), sub: `${fmtInt(out?.partial ?? null)} / ${fmtInt(K)}건`, tone: 'partial',
      mine: mine && `내 ${fmtPercent(mine.partial_rate)} (${fmtPp(diff?.partial_rate_pp)})` });
    cells.push({ id: 'reject', label: '불수용률', value: fmtPercent(pct(out?.rejected, K)), sub: `${fmtInt(out?.rejected ?? null)} / ${fmtInt(K)}건`, tone: 'rejected',
      mine: mine && `내 ${fmtPercent(mine.reject_rate)} (${fmtPp(diff?.reject_rate_pp)})` });
    cells.push({ id: 'fine', label: '과태료', value: `${fmtInt(o.fine_count.value)}건 · ${fmtPercent(pct(o.fine_count.value, C))}`, sub: `÷ 답변 ${fmtInt(C)}건`, tone: 'fine',
      mine: mine && `내 ${fmtPercent(mine.fine_rate)} (${fmtPp(diff?.fine_rate_pp)})` });
    cells.push({ id: 'warning', label: '계도', tone: 'purple',
      value: W == null ? '—' : `${fmtInt(W)}건 · ${fmtPercent(pct(W, C))}`, sub: W == null ? '제공 안 됨' : `÷ 답변 ${fmtInt(C)}건` });
    const d = o.processing_duration;
    cells.push({ id: 'duration', label: '답변까지 걸린 기간', tone: 'purple', value: d?.count ? fmtDays(d.median_days) : '—',
      sub: d ? `중앙값 · 계산 ${fmtInt(d.count)}건` : '자료 없음',
      mine: mine && (mine.duration.count ? `내 ${fmtDays(mine.duration.median_days)}` : '내 계산 불가') });
    cells.push({ id: 'amount', label: '확인 과태료 금액', tone: 'fine', value: fmtFineAmount(o.fine_amount), sub: o.fine_amount ? `확인 ${fmtInt(o.fine_amount.confirmed_count)}건` : '제공 안 됨' });
    cells.push({ id: 'rating', label: '평균 별점', tone: 'muted', value: fmtRating(o.rating), sub: o.rating ? `평가 ${fmtInt(o.rating.count)}건` : '제공 안 됨' });
    cells.push({ id: 'places', label: '장소', tone: 'muted', value: `${fmtInt(o.point_count.value)}곳`, sub: '',
      mine: mine && `내 ${fmtInt(mine.point_count)}곳` });
    cells.push({ id: 'contributors', label: '참여자', tone: 'muted', value: `${fmtInt(o.contributor_count.value)}명`, sub: '',
      delta: deltaText(o.contributor_count, 'count') });
  }
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
        <button type="button" className="link-btn kpi-more" aria-expanded={open} aria-controls="kpi-detail" onClick={() => setOpen((v) => !v)}>
          {open ? '상세 접기' : showMine ? '전체와 내 신고 상세 비교' : '지표 정의와 상세 수치'}
        </button>
      </header>
      <div className={`kpi-scroll-wrap${edges.left ? ' more-left' : ''}${edges.right ? ' more-right' : ''}`}>
        {edges.left && <button type="button" className="kpi-nudge left" aria-label="주요 통계 왼쪽 보기" onClick={() => nudge(-1)}>‹</button>}
        <div className="kpi-row" ref={scroller} tabIndex={0} role="group" aria-label="주요 통계 값 (가로로 넘겨 보기)">
          {o ? cells.map((k) => (
            <div key={k.id} className={`kpi-cell tone-${k.tone}`} data-kpi={k.id}>
              <span className="kpi-label">{k.label}</span>
              <b className="kpi-value cm-number">{k.value}</b>
              <small className="kpi-basis">{[k.sub, k.delta].filter(Boolean).join(' · ')}</small>
              {showMine && k.mine != null && <small className="kpi-mine mine-col">{k.mine}</small>}
            </div>
          )) : Array.from({ length: 6 }).map((_, i) => <div key={i} className="kpi-cell skeleton" role="status" aria-label="불러오는 중" />)}
        </div>
        {edges.right && <button type="button" className="kpi-nudge right" aria-label="주요 통계 오른쪽 보기" onClick={() => nudge(1)}>›</button>}
      </div>
      {mineState && <p className="compare-note" role="status">{mineState}</p>}
      <div className="kpi-detail" id="kpi-detail" hidden={!open}>{open ? detail : null}</div>
    </section>
  );
}
