import type { CountMetric, Overview } from '../domain/public';
import type { CompareSummary } from '../domain/personal';
import type { PersonalState } from '../hooks/usePersonal';
import { acceptRate, fmtDays, fmtFineAmount, fmtInt, fmtPercent, fmtPp, fmtRating, fmtShare, partialRate } from './format';

interface Props {
  overview: Overview;
  personal: PersonalState;
  showMine: boolean;
  unsupported: boolean;
  /** "2025.09.25 — 2026.09.24 · 서울특별시" of the DISPLAYED data */
  scopeLabel: string;
  /** the detailed all-vs-mine table (existing CompareKpis), rendered inside the details element */
  detail: React.ReactNode;
}

const pct = (a: number, d: number) => (d > 0 ? (a / d) * 100 : null);

/** Real period-over-period change only (never a synthetic trend): counts in %, rates in %p. */
function Delta({ metric, kind }: { metric: CountMetric; kind: 'count' | 'rate' }) {
  if (metric.previous === null || metric.delta === null) return <small className="kpi-delta none">{metric.note ?? '비교기간 자료 없음'}</small>;
  if (kind === 'count') {
    if (metric.delta_percent === null) return <small className="kpi-delta none">직전 같은 기간 0건</small>;
    const d = metric.delta_percent;
    return <small className="kpi-delta">직전 같은 기간 대비 {d > 0 ? '+' : d < 0 ? '−' : ''}{Math.abs(d).toFixed(1)}%</small>;
  }
  return <small className="kpi-delta">직전 같은 기간 대비 {fmtPp(metric.delta)}</small>;
}

export default function KpiPanel({ overview: o, personal, showMine, unsupported, scopeLabel, detail }: Props) {
  const out = o.outcomes;
  const d = out?.result_known ?? 0;
  const c = o.completed_count.value ?? 0;
  const mine: CompareSummary | null = showMine && personal.status === 'ready' && personal.data ? personal.data.mine : null;
  const mineState = !showMine ? null : personal.status === 'ready' ? null
    : personal.status === 'loading' || personal.status === 'waiting' ? '내 신고 불러오는 중…'
      : personal.status === 'signed_out' ? '로그인하면 내 신고도 보입니다' : personal.error?.message ?? '내 신고를 불러오지 못했습니다';
  const cards: Array<{ id: string; label: string; value: string; unit?: string; basis: string; mine?: string | null; delta?: React.ReactNode; tone: string }> = [
    { id: 'report', label: '신고', value: fmtInt(o.report_count.value), unit: '건', basis: '신고한 날 기준', tone: 'brand',
      mine: mine && `내 신고 ${fmtInt(mine.report_count)}건`, delta: <Delta metric={o.report_count} kind="count" /> },
    { id: 'completed', label: '답변 완료', value: fmtInt(o.completed_count.value), unit: '건', basis: `답변 받은 날 · 결과가 나온 ${fmtInt(d)}건`, tone: 'cyan',
      mine: mine && `내 답변 ${fmtInt(mine.completed_count)}건`, delta: <Delta metric={o.completed_count} kind="count" /> },
    { id: 'accept', label: '수용률', value: fmtPercent(acceptRate(out)), basis: `${fmtInt(out?.accepted ?? null)} / ${fmtInt(d)}건`, tone: 'accepted',
      mine: mine && `내 신고 ${fmtPercent(mine.accept_rate)} (${fmtPp(personal.data?.diff.accept_rate_pp)})` },
    { id: 'partial', label: '일부수용률', value: fmtPercent(partialRate(out)), basis: `${fmtInt(out?.partial ?? null)} / ${fmtInt(d)}건`, tone: 'partial',
      mine: mine && `내 신고 ${fmtPercent(mine.partial_rate)} (${fmtPp(personal.data?.diff.partial_rate_pp)})` },
    { id: 'reject', label: '불수용률', value: fmtPercent(out ? pct(out.rejected, d) : null), basis: `${fmtInt(out?.rejected ?? null)} / ${fmtInt(d)}건`, tone: 'rejected',
      mine: mine && `내 신고 ${fmtPercent(mine.reject_rate)} (${fmtPp(personal.data?.diff.reject_rate_pp)})` },
    { id: 'fine', label: '과태료 부과율', value: fmtPercent(pct(o.fine_count.value ?? 0, c)), basis: `과태료 ${fmtInt(o.fine_count.value)} / 답변 ${fmtInt(c)}건`, tone: 'fine',
      mine: mine && `내 신고 ${fmtPercent(mine.fine_rate)} (${fmtPp(personal.data?.diff.fine_rate_pp)})` },
    { id: 'duration', label: '답변까지 걸린 기간', value: o.processing_duration?.count ? fmtDays(o.processing_duration.median_days) : '—',
      basis: o.processing_duration ? `중앙값 · 유효 ${fmtInt(o.processing_duration.count)}건` : '자료 없음', tone: 'purple',
      mine: mine && (mine.duration.count ? `내 신고 ${fmtDays(mine.duration.median_days)}` : '내 신고 계산 불가') },
    { id: 'contributors', label: '참여한 사람', value: fmtInt(o.contributor_count.value), unit: '명', basis: '신고를 공유한 사람 수 · 신고한 날', tone: 'muted',
      delta: <Delta metric={o.contributor_count} kind="count" /> },
  ];
  const known = d;
  return (
    <section className="cm-panel kpi-panel" aria-label="주요 통계">
      <div className="panel-top">
        <div>
          <h2>주요 통계</h2>
          <span className="subtitle">{scopeLabel}{unsupported ? ' · 이 조건의 통계는 아직 없습니다' : ''}</span>
        </div>
        {showMine && <span className="cm-chip mine-chip" title="같은 조건의 내 신고">내 신고와 비교 중</span>}
      </div>
      <div className="kpi-grid">
        {cards.map((k) => (
          <div key={k.id} className={`kpi-card tone-${k.tone}`}>
            <span className="kpi-label">{k.label}</span>
            <b className="kpi-value cm-number">{k.value}{k.unit && k.value !== '—' && <span>{k.unit}</span>}</b>
            <small className="kpi-basis">{k.basis}</small>
            {k.delta}
            {showMine && k.id !== 'contributors' && (
              <small className="kpi-mine mine-col" aria-busy={!mine && !!mineState}>{k.mine ?? (mineState ? '—' : '')}</small>
            )}
          </div>
        ))}
      </div>
      {out && known > 0 && (
        <div className="kpi-outcome" aria-label="처리 결과 분포">
          <div className="stack" role="img" aria-label={`수용 ${out.accepted}건, 일부 수용 ${out.partial}건, 불수용 ${out.rejected}건`}>
            <i style={{ width: `${(out.accepted / known) * 100}%`, background: 'var(--accepted)' }} />
            <i style={{ width: `${(out.partial / known) * 100}%`, background: 'var(--partial)' }} />
            <i style={{ width: `${(out.rejected / known) * 100}%`, background: 'var(--rejected)' }} />
          </div>
          <span className="kpi-outcome-legend">
            <span><i className="dot" style={{ background: 'var(--accepted)' }} />수용 {fmtInt(out.accepted)}</span>
            <span><i className="dot" style={{ background: 'var(--partial)' }} />일부 {fmtInt(out.partial)}</span>
            <span><i className="dot" style={{ background: 'var(--rejected)' }} />불수용 {fmtInt(out.rejected)}</span>
            <span className="cm-muted">결과 미상 {fmtInt(out.result_unknown)}건은 비율에서 제외</span>
          </span>
        </div>
      )}
      <dl className="kpi-extra" aria-label="추가 지표">
        <div><dt>답변에 적힌 과태료 금액</dt><dd className="cm-number">{fmtFineAmount(o.fine_amount)}</dd></div>
        <div><dt>평균 별점</dt><dd className="cm-number">{fmtRating(o.rating)}</dd></div>
        <div><dt>신고 장소(서로 다른 주소)</dt><dd className="cm-number">{fmtInt(o.point_count.value)}곳{mine ? ` · 내 ${fmtInt(mine.point_count)}곳 (${fmtShare(personal.data?.diff.point_share)})` : ''}</dd></div>
      </dl>
      {mineState && <p className="compare-note" role="status">{mineState}</p>}
      <details className="kpi-detail">
        <summary>{showMine ? '전체와 내 신고 상세 비교 펼치기' : '지표 정의와 상세 수치 펼치기'}</summary>
        {detail}
      </details>
    </section>
  );
}
