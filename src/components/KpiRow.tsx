import type { Overview } from '../domain/public';
import { fmtInt, fmtPct1 } from './format';

interface Props {
  overview: Overview | null;
  unsupported: boolean;
}

function foot(basis: string, extra: string) {
  return (
    <div className="kpi-foot">
      <span className="basis">{basis}</span>
      <span>{extra}</span>
    </div>
  );
}

export default function KpiRow({ overview, unsupported }: Props) {
  if (!overview) {
    return (
      <section className="kpis" aria-label="핵심 지표">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="skeleton" aria-hidden="true" />
        ))}
      </section>
    );
  }
  const o = overview;
  const accPct = o.accepted_including_partial.value;
  const accNum = o.accepted_including_partial.numerator;
  const accDen = o.accepted_including_partial.denominator;
  const fineDen = o.fine_count.denominator ?? o.completed_count.value;
  const unsup = (label: string) => <div className="unsupported">{label}</div>;
  return (
    <section className="kpis" aria-label="핵심 지표">
      <article className="cm-panel kpi">
        <div className="kpi-head"><span>신고 접수 건수</span><span aria-hidden="true">▦</span></div>
        {o.report_count.value == null ? unsup('집계 미지원') : (
          <div className="value cm-number">{fmtInt(o.report_count.value)}<span>건</span></div>
        )}
        {foot('신고일 기준', unsupported ? '선택 범위 집계 미지원' : '전국 제공 표본')}
      </article>
      <article className="cm-panel kpi cyan">
        <div className="kpi-head"><span>처리완료 신고</span><span aria-hidden="true">✓</span></div>
        {o.completed_count.value == null ? unsup('집계 미지원') : (
          <div className="value cm-number">{fmtInt(o.completed_count.value)}<span>건</span></div>
        )}
        {foot('처리완료일 기준', `결과 확인 ${fmtInt(o.outcomes.result_known)}건`)}
      </article>
      <article className="cm-panel kpi green">
        <div className="kpi-head"><span>수용 · 일부수용 비중</span><span aria-hidden="true">◔</span></div>
        {accPct == null ? unsup('집계 미지원') : (
          <div className="value cm-number">{fmtPct1(accPct)}<span>%</span></div>
        )}
        {foot('처리완료일 기준', `${fmtInt(accNum)} / ${fmtInt(accDen)}건 · 미확인 ${fmtInt(o.outcomes.result_unknown)}건 제외`)}
      </article>
      <article className="cm-panel kpi pink">
        <div className="kpi-head"><span>과태료 처분 신고</span><span aria-hidden="true">▦</span></div>
        {o.fine_count.value == null ? unsup('집계 미지원') : (
          <div className="value cm-number">{fmtInt(o.fine_count.value)}<span>건</span></div>
        )}
        {foot('처리완료일 기준', `처리완료 ${fmtInt(fineDen)}건 중 ${fmtPct1(fineDen ? (o.fine_count.value ?? 0) / fineDen * 100 : null)}%`)}
      </article>
      <article className="cm-panel kpi">
        <div className="kpi-head"><span>신고 지점</span><span aria-hidden="true">⌖</span></div>
        {o.point_count.value == null ? unsup('집계 미지원') : (
          <div className="value cm-number">{fmtInt(o.point_count.value)}<span>곳</span></div>
        )}
        {foot('신고일 기준', '원 좌표로 표시 · 집계 표시는 구분')}
      </article>
      <article className="cm-panel kpi purple">
        <div className="kpi-head"><span>기여 계정</span><span aria-hidden="true">👥</span></div>
        {o.contributor_count.value == null ? unsup('집계 미지원') : (
          <div className="value cm-number">{fmtInt(o.contributor_count.value)}<span>개</span></div>
        )}
        {foot('신고일 기준', '선택 범위의 고유 계정 · 합산 아님')}
      </article>
    </section>
  );
}
