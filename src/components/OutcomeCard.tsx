import type { OutcomeCounts } from '../domain/public';
import { fmtInt, fmtPercent } from './format';

export default function OutcomeCard({ outcomes }: { outcomes: OutcomeCounts | null }) {
  if (!outcomes) return (
    <article className="cm-panel outcome-card" aria-label="처리 결과">
      <div className="panel-top"><div><h2>처리 결과</h2><span className="subtitle">답변 받은 날 기준</span></div></div>
      <p className="cm-muted">이 조건의 처리 결과는 아직 없습니다.</p>
    </article>
  );
  const d = outcomes.result_known;
  const rows = [
    { label: '수용', v: outcomes.accepted, color: 'var(--accepted)' },
    { label: '일부 수용', v: outcomes.partial, color: 'var(--partial)' },
    { label: '불수용', v: outcomes.rejected, color: 'var(--rejected)' },
  ];
  const top = d > 0 ? ((outcomes.accepted + outcomes.partial) / d) * 100 : null;
  return (
    <article className="cm-panel outcome-card" aria-label="처리 결과">
      <div className="panel-top">
        <div>
          <h2>처리 결과</h2>
          <span className="subtitle">답변 받은 날 기준 · 결과가 나온 {fmtInt(d)}건</span>
        </div>
      </div>
      <div className="outcome-summary">
        <b className="cm-number">{fmtPercent(top)}</b>
        <small>수용률 (일부 수용 포함)</small>
      </div>
      <div className="stack result-stack" role="img" aria-label={`수용 ${outcomes.accepted}건, 일부 수용 ${outcomes.partial}건, 불수용 ${outcomes.rejected}건`}>
        {rows.map((r) => (
          <i key={r.label} style={{ width: `${d > 0 ? (r.v / d) * 100 : 0}%`, background: r.color }} title={`${r.label} ${r.v}건`} />
        ))}
      </div>
      <div className="distribution">
        {rows.map((r) => (
          <div key={r.label}>
            <span><i className="dot" style={{ background: r.color }} />{r.label}</span>
            <b>{fmtInt(r.v)}</b>
            <small>{fmtPercent(d > 0 ? (r.v / d) * 100 : null)}</small>
          </div>
        ))}
      </div>
      <p className="card-footnote">결과를 알 수 없는 {fmtInt(outcomes.result_unknown)}건은 비율 계산에서 뺐습니다</p>
    </article>
  );
}
