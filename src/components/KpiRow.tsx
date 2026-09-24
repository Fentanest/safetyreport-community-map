import type { Overview } from '../domain/public';
import { fmtInt, fmtPct1, fmtPercent } from './format';
import Icon, { type IconName } from './icons';

interface Props {
  overview: Overview | null;
  unsupported: boolean;
}

function head(label: string, icon: IconName) {
  return (
    <div className="kpi-head"><span>{label}</span><span className="cm-muted"><Icon name={icon} size={18} /></span></div>
  );
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
        {head('신고 접수 건수', 'doc')}
        {o.report_count.value == null ? unsup('집계 미지원') : (
          <div className="value cm-number">{fmtInt(o.report_count.value)}<span>건</span></div>
        )}
        {foot('신고일 기준', unsupported ? '선택 범위 집계 미지원' : '선택 범위 제공 표본')}
      </article>
      <article className="cm-panel kpi cyan">
        {head('처리완료 신고', 'check')}
        {o.completed_count.value == null ? unsup('집계 미지원') : (
          <div className="value cm-number">{fmtInt(o.completed_count.value)}<span>건</span></div>
        )}
        {foot('처리완료일 기준', o.outcomes ? `결과 확인 ${fmtInt(o.outcomes.result_known)}건` : '결과 집계 미지원')}
      </article>
      <article className="cm-panel kpi green">
        {head('수용 · 일부수용 비중', 'pie')}
        {accPct == null ? unsup(accDen === 0 ? '분모 0건 · 비율 없음' : '집계 미지원') : (
          <div className="value cm-number">{fmtPct1(accPct)}<span>%</span></div>
        )}
        {foot('처리완료일 기준', o.outcomes ? `${fmtInt(accNum)} / ${fmtInt(accDen)}건 · 미확인 ${fmtInt(o.outcomes.result_unknown)}건 제외` : '선택 범위 결과 집계 미지원')}
      </article>
      <article className="cm-panel kpi pink">
        {head('과태료 처분 신고', 'doc')}
        {o.fine_count.value == null ? unsup('집계 미지원') : (
          <div className="value cm-number">{fmtInt(o.fine_count.value)}<span>건</span></div>
        )}
        {foot('처리완료일 기준', fineDen === 0 ? '처리완료 0건 · 비율 없음' : `처리완료 ${fmtInt(fineDen)}건 중 ${fmtPercent(fineDen ? (o.fine_count.value ?? 0) / fineDen * 100 : null)}`)}
      </article>
      <article className="cm-panel kpi">
        {head('신고 지점', 'pin')}
        {o.point_count.value == null ? unsup('집계 미지원') : (
          <div className="value cm-number">{fmtInt(o.point_count.value)}<span>곳</span></div>
        )}
        {foot('신고일 기준', '원좌표 보존 · 지도 집계 표시는 구분')}
      </article>
      <article className="cm-panel kpi purple">
        {head('기여 계정', 'users')}
        {o.contributor_count.value == null ? unsup('집계 미지원') : (
          <div className="value cm-number">{fmtInt(o.contributor_count.value)}<span>개</span></div>
        )}
        {foot('신고일 기준', '선택 범위의 고유 계정 · 합산 아님')}
      </article>
    </section>
  );
}
