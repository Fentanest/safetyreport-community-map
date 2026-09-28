import type { PublicLaw } from '../domain/public';
import { lawLabel, lawValue } from '../state/filters';
import { fmtFineAmount, fmtInt, fmtPercent, fmtWon, fmtRating } from './format';

interface Props {
  /** null = the source did not provide law rows (shown as not ready, never as an empty list) */
  laws: PublicLaw[] | null;
  /** current law filter (exact text, '__none__' or null) */
  activeLaw: string | null;
  /** explicit scope change: a law value, or null to show every law again */
  onPickLaw: (law: string | null) => void;
}

/** 위반법규별 현황 (docs/metrics-catalog.md law_results). Answer-date cohort, same scope and denominators as the
 *  rest of the dashboard. Rows come from the server in order (answers desc, then law; 법규 미상 last on ties). */
export default function LawTable(p: Props) {
  const rows = p.laws ?? [];
  return (
    <section className="cm-panel laws" id="laws" aria-label="위반법규별 현황">
      <div className="panel-top">
        <div>
          <h2>위반법규별 현황</h2>
          <span className="subtitle">답변에 적힌 위반법규별 처리 결과입니다. 법규를 누르면 그 법규만 봅니다.</span>
        </div>
        <span className="cm-chip" title="처리·과태료 수치는 답변 받은 날을 기준으로 셉니다">답변 받은 날 기준</span>
      </div>
      {p.laws === null ? (
        <p className="empty-state">위반법규별 통계는 아직 준비되지 않았습니다.</p>
      ) : rows.length === 0 ? (
        <p className="empty-state">지금 조건에 맞는 답변 완료 신고가 없습니다.</p>
      ) : (
        <div className="table-scroll">
          <table className="entity-table law-table">
            <caption className="cm-muted" style={{ textAlign: 'left', padding: '0 16px 8px', fontSize: 12 }}>
              위반법규 {fmtInt(rows.length)}개 · 답변 많은 순
            </caption>
            <thead>
              <tr>
                <th scope="col">위반법규</th>
                <th scope="col" className="num">답변 완료</th>
                <th scope="col" className="num">수용률</th>
                <th scope="col" className="num">과태료 부과율</th>
                <th scope="col" className="num" title="답변에 적힌 과태료 금액 합계(금액이 확인되고 공개에 동의한 것만)">답변에 적힌 과태료 금액</th>
                <th scope="col" className="num">범칙금</th>
                <th scope="col" className="num">경고</th>
                <th scope="col" className="num" title="공개에 동의한 숫자 별점만 집계">평균 별점 · 건수</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const value = lawValue(r.law);
                const active = p.activeLaw === value;
                const name = lawLabel(r.law, false);
                const a = r.fine_amount;
                return (
                  <tr key={value} className={active ? 'active' : undefined}>
                    <td>
                      <button
                        type="button" className="mini-btn" style={{ textAlign: 'left', maxWidth: 280, whiteSpace: 'normal' }}
                        aria-pressed={active}
                        title={active ? '모든 법규 보기' : `${name}만 보기`}
                        onClick={() => p.onPickLaw(active ? null : value)}
                      >
                        <span className={`table-name${r.law === null ? ' law-unknown' : ''}`}>{name}</span>
                        {active && <small>보는 중</small>}
                      </button>
                    </td>
                    <td className="num">
                      {r.completed_count === 1 ? <span className="sample-one">1건</span> : `${fmtInt(r.completed_count)}건`}
                    </td>
                    <td className="num">
                      {fmtPercent(r.accept_rate)}
                      <small>일부 {fmtPercent(r.partial_rate)} · 결과 {fmtInt(r.outcomes.result_known)}건</small>
                    </td>
                    <td className="num">
                      {fmtPercent(r.fine_rate)}
                      <small>과태료 {fmtInt(r.fine_count)}건</small>
                    </td>
                    <td className="num">
                      {fmtFineAmount(a)}
                      {a.confirmed_count > 0 && (
                        <small>평균 {fmtWon(a.mean_won)} · {fmtInt(a.fine_count)}건 중 {fmtInt(a.confirmed_count)}건{a.confirmed_count < a.fine_count ? '만 합산' : ''}</small>
                      )}
                    </td>
                    <td className="num">{fmtInt(r.penalty_count)}</td>
                    <td className="num">{fmtInt(r.warning_count)}</td>
                    <td className="num">{fmtRating(r.rating)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > 0 && (
        <p className="chart-caption">
          수용률·일부수용률 = 수용·일부 수용 ÷ 결과가 나온 신고(수용+일부 수용+불수용). 과태료 부과율 = 과태료 ÷ 답변 완료.
          금액은 금액이 확인되고 공개에 동의한 과태료만 더합니다.
        </p>
      )}
      <div className="table-footer">
        <span>법규 미상: 답변에서 위반법규를 찾지 못했거나, 위반법규를 보내기 전 앱이나 동의로 공유된 신고입니다.</span>
        <span>과태료 금액은 답변에 적힌 금액이며 실제 납부액이 아닙니다.</span>
      </div>
    </section>
  );
}
