import type { OutcomeCounts } from '../domain/public';
import { fmtInt, fmtPct1 } from './format';

export default function OutcomeCard({ outcomes }: { outcomes: OutcomeCounts }) {
  const d = outcomes.result_known;
  const rows = [
    { label: '수용', v: outcomes.accepted, color: 'var(--accepted)' },
    { label: '일부수용', v: outcomes.partial, color: 'var(--partial)' },
    { label: '불수용', v: outcomes.rejected, color: 'var(--rejected)' },
  ];
  const top = d > 0 ? ((outcomes.accepted + outcomes.partial) / d) * 100 : null;
  return (
    <article className="cm-panel outcome-card" aria-label="처리결과 구성">
      <div className="panel-top">
        <div>
          <h2>처리결과 구성</h2>
          <span className="subtitle">처리완료일 기준 · 결과 확인 {fmtInt(d)}건</span>
        </div>
      </div>
      <div className="outcome-summary">
        <b className="cm-number">{fmtPct1(top)}<span>%</span></b>
        <small>수용 · 일부수용 (분모 D=결과 확인건)</small>
      </div>
      <div className="stack result-stack" role="img" aria-label={`수용 ${outcomes.accepted}건, 일부수용 ${outcomes.partial}건, 불수용 ${outcomes.rejected}건`}>
        {rows.map((r) => (
          <i key={r.label} style={{ width: `${d > 0 ? (r.v / d) * 100 : 0}%`, background: r.color }} title={`${r.label} ${r.v}건`} />
        ))}
      </div>
      <div className="distribution">
        {rows.map((r) => (
          <div key={r.label}>
            <span><i className="dot" style={{ background: r.color }} />{r.label}</span>
            <b>{fmtInt(r.v)}</b>
            <small>{fmtPct1(d > 0 ? (r.v / d) * 100 : null)}%</small>
          </div>
        ))}
      </div>
      <p className="card-footnote">결과 미확인 {fmtInt(outcomes.result_unknown)}건은 위 비율의 분모에서 제외</p>
    </article>
  );
}
