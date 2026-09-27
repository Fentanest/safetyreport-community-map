import type { Overview } from '../domain/public';
import type { CompareSummary, PersonalCompare } from '../domain/personal';
import type { PersonalState } from '../hooks/usePersonal';
import type { AuthSnapshot } from '../auth/mapAuth';
import { acceptRate, fmtDays, fmtDaysDiff, fmtFineAmount, fmtInt, fmtPercent, fmtPp, fmtShare, fmtWon, fmtWonDiff, partialRate } from './format';

interface Props {
  overview: Overview;
  personal: PersonalState;
  compareOn: boolean;
  auth: AuthSnapshot;
  onSignIn: () => void;
  unsupported: boolean;
}

interface Row {
  id: string;
  label: string;
  basis: string;
  all: string;
  allNote: string | null;
  mine: (m: CompareSummary) => string;
  mineNote: (m: CompareSummary) => string | null;
  diff: (c: PersonalCompare) => string;
  diffKind: 'share' | 'pp' | 'days' | 'won' | 'none';
  /** optional second line under the difference */
  diffNote?: (c: PersonalCompare) => string | null;
}

const pct = (a: number, d: number) => (d > 0 ? (a / d) * 100 : null);

type Amount = { fine_count: number; confirmed_count: number; mean_won: number | null; partial: boolean };
const amountNote = (a: Amount | null | undefined): string | null =>
  a && a.confirmed_count > 0
    ? `평균 ${fmtWon(a.mean_won)} · 과태료 ${fmtInt(a.fine_count)}건 중 ${fmtInt(a.confirmed_count)}건 금액 확인${a.partial ? '(일부만 합산)' : ''}`
    : a && a.fine_count > 0 ? `과태료 ${fmtInt(a.fine_count)}건 · 금액이 확인된 답변 없음` : null;

function rows(o: Overview): Row[] {
  const out = o.outcomes;
  const d = out?.result_known ?? 0;
  const c = o.completed_count.value ?? 0;
  return [
    { id: 'report', label: '신고', basis: '신고한 날 기준', all: fmtInt(o.report_count.value), allNote: null,
      mine: m => fmtInt(m.report_count), mineNote: () => null, diff: x => fmtShare(x.diff.report_share), diffKind: 'share' },
    { id: 'completed', label: '답변 완료', basis: '답변 받은 날 기준', all: fmtInt(o.completed_count.value),
      allNote: out ? `결과가 나온 ${fmtInt(d)}건` : null,
      mine: m => fmtInt(m.completed_count), mineNote: m => `결과가 나온 ${fmtInt(m.result_known)}건`,
      diff: x => fmtShare(x.diff.completed_share), diffKind: 'share' },
    { id: 'accept', label: '수용률', basis: '결과가 나온 신고 중 수용',
      all: fmtPercent(acceptRate(out)),
      allNote: out ? `${fmtInt(out.accepted)} / ${fmtInt(d)}건` : null,
      mine: m => fmtPercent(m.accept_rate), mineNote: m => `${fmtInt(m.accepted)} / ${fmtInt(m.result_known)}건`,
      diff: x => fmtPp(x.diff.accept_rate_pp), diffKind: 'pp' },
    { id: 'partial', label: '일부수용률', basis: '결과가 나온 신고 중 일부 수용',
      all: fmtPercent(partialRate(out)), allNote: out ? `${fmtInt(out.partial)} / ${fmtInt(d)}건` : null,
      mine: m => fmtPercent(m.partial_rate), mineNote: m => `${fmtInt(m.partial)} / ${fmtInt(m.result_known)}건`,
      diff: x => fmtPp(x.diff.partial_rate_pp), diffKind: 'pp' },
    { id: 'reject', label: '불수용률', basis: '결과가 나온 신고 중',
      all: fmtPercent(out ? pct(out.rejected, d) : null), allNote: out ? `${fmtInt(out.rejected)} / ${fmtInt(d)}건` : null,
      mine: m => fmtPercent(m.reject_rate), mineNote: m => `${fmtInt(m.rejected)} / ${fmtInt(m.result_known)}건`,
      diff: x => fmtPp(x.diff.reject_rate_pp), diffKind: 'pp' },
    { id: 'fine', label: '과태료 부과율', basis: '답변 완료된 신고 중',
      all: fmtPercent(pct(o.fine_count.value ?? 0, c)), allNote: `${fmtInt(o.fine_count.value)}건`,
      mine: m => fmtPercent(m.fine_rate), mineNote: m => `${fmtInt(m.fine_count)}건`,
      diff: x => fmtPp(x.diff.fine_rate_pp), diffKind: 'pp' },
    { id: 'duration', label: '답변까지 걸린 기간', basis: '중앙값 · 신고한 날부터 답변 받은 날까지',
      all: o.processing_duration ? (o.processing_duration.count ? fmtDays(o.processing_duration.median_days) : '계산할 신고 없음') : '—',
      allNote: o.processing_duration && o.processing_duration.count
        ? `평균 ${fmtDays(o.processing_duration.mean_days)} · 90%는 ${fmtDays(o.processing_duration.p90_days)} 이내 · ${fmtInt(o.processing_duration.count)}건` : null,
      mine: m => (m.duration.count ? fmtDays(m.duration.median_days) : '계산할 신고 없음'),
      mineNote: m => (m.duration.count ? `평균 ${fmtDays(m.duration.mean_days)} · ${fmtInt(m.duration.count)}건` : null),
      diff: x => fmtDaysDiff(x.diff.duration_median_days_diff), diffKind: 'days' },
    { id: 'amount', label: '답변에 적힌 과태료 금액', basis: '합계 · 금액이 확인된 과태료만',
      all: fmtFineAmount(o.fine_amount), allNote: amountNote(o.fine_amount),
      mine: m => fmtFineAmount(m.fine_amount), mineNote: m => amountNote(m.fine_amount),
      diff: x => fmtShare(x.diff.fine_amount_sum_share), diffKind: 'share',
      diffNote: x => x.diff.fine_amount_mean_won_diff == null ? null : `평균 ${fmtWonDiff(x.diff.fine_amount_mean_won_diff)}` },
    { id: 'points', label: '신고 장소', basis: '서로 다른 장소 수', all: fmtInt(o.point_count.value), allNote: null,
      mine: m => fmtInt(m.point_count), mineNote: () => null, diff: x => fmtShare(x.diff.point_share), diffKind: 'share' },
    { id: 'contributors', label: '참여한 사람', basis: '신고를 공유한 사람 수', all: fmtInt(o.contributor_count.value), allNote: null,
      mine: () => '—', mineNote: () => null, diff: () => '—', diffKind: 'none' },
  ];
}

function mineMessage(p: PersonalState, auth: AuthSnapshot): string | null {
  if (p.status === 'unconfigured') return auth.message ?? '지금은 로그인 기능을 쓸 수 없습니다.';
  if (p.status === 'signed_out') return auth.message ?? '로그인하면 같은 조건의 내 신고를 나란히 볼 수 있습니다.';
  if (p.status === 'error') return p.error?.message ?? '내 신고를 불러오지 못했습니다.';
  return null;
}

/** Data wiring: Sol · visual implementation: Muse (docs/personal-comparison.md §5.1, §6). */
export default function CompareKpis({ overview, personal, compareOn, auth, onSignIn, unsupported }: Props) {
  const data = personal.status === 'ready' ? personal.data : null;
  const showMine = compareOn;
  const message = showMine ? mineMessage(personal, auth) : null;
  const viewer = data?.viewer;
  const noShare = data && viewer && (viewer.contributor === 'none' || viewer.contributor === 'suspended' || viewer.contributor === 'revoked');
  return (
    <section className="cm-panel compare-kpis" aria-label={showMine ? '전체와 내 신고 비교' : '주요 통계'}>
      <div className="panel-top">
        <div>
          <h2>{showMine ? '전체와 내 신고 비교' : '주요 통계'}</h2>
          <span className="subtitle">지금 고른 기간·지역·기관·담당자 기준{unsupported ? ' · 이 조건의 통계는 아직 없습니다' : ''}</span>
        </div>
      </div>
      <table className="compare-table">
        <thead>
          <tr>
            <th scope="col">항목</th>
            <th scope="col" className="num">전체</th>
            {showMine && <th scope="col" className="num mine-col">내 신고</th>}
            {showMine && <th scope="col" className="num">차이</th>}
          </tr>
        </thead>
        <tbody>
          {rows(overview).map((row) => (
            <tr key={row.id}>
              <th scope="row"><span>{row.label}</span><small>{row.basis}</small></th>
              <td className="num"><b className="cm-number">{row.all}</b>{row.allNote && <small>{row.allNote}</small>}</td>
              {showMine && (
                <td className="num mine-col" aria-busy={personal.status === 'loading' || personal.status === 'waiting'}>
                  {data ? (<><b className="cm-number">{row.mine(data.mine)}</b>{row.mineNote(data.mine) && <small>{row.mineNote(data.mine)}</small>}</>)
                    : personal.status === 'loading' || personal.status === 'waiting'
                      ? <span className="mine-skel" role="status" aria-label="내 신고 불러오는 중" />
                      : <span className="cm-muted">—</span>}
                </td>
              )}
              {showMine && (
                <td className="num diff-col">
                  {data ? (<><b className="cm-number">{row.diff(data)}</b>
                    {row.diffNote?.(data) && <small>{row.diffNote(data)}</small>}
                    <small>{row.diffKind === 'share' ? '전체 중 내 신고' : row.diffKind === 'days' ? '나 − 전체' : row.diffKind === 'pp' ? (data.diff.rate_reason === 'no_mine' ? '내 결과가 아직 없음' : data.diff.rate_reason === 'no_all' ? '결과가 아직 없음' : '나 − 전체') : ''}</small></>)
                    : <span className="cm-muted">—</span>}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {overview.processing_duration && (overview.processing_duration.excluded.no_report_date + overview.processing_duration.excluded.reversed + overview.processing_duration.answer_date_missing) > 0 && (
        <p className="chart-caption">
          답변까지 걸린 기간에서 뺀 신고: 날짜가 맞지 않음 {fmtInt(overview.processing_duration.excluded.no_report_date + overview.processing_duration.excluded.reversed)}건
          {overview.processing_duration.answer_date_missing > 0 && ` · 답변일이 없어 기간을 알 수 없음 ${fmtInt(overview.processing_duration.answer_date_missing)}건`}
        </p>
      )}
      {overview.fine_amount && overview.fine_amount.fine_count > 0 && (
        <p className="chart-caption">
          과태료 금액은 답변에 적힌 금액입니다. 실제로 내거나 걷힌 금액이 아닙니다. 금액이 적히지 않은 답변을 0원으로 치지 않고, 범칙금이나 과태료와 범칙금이 섞인 금액은 더하지 않습니다.
          {overview.fine_amount.unconfirmed_count > 0 && ` 금액이 적히지 않음 ${fmtInt(overview.fine_amount.unconfirmed_count)}건.`}
          {overview.fine_amount.undisclosed_count > 0 && ` 금액 공개에 동의하지 않은 자료 ${fmtInt(overview.fine_amount.undisclosed_count)}건.`}
          {overview.fine_amount.conflict_count > 0 && ` 답변 내용이 서로 맞지 않아 뺀 자료 ${fmtInt(overview.fine_amount.conflict_count)}건.`}
          {overview.fine_amount.penalty_count + overview.fine_amount.combined_count > 0 && ` 범칙금·섞인 금액 ${fmtInt(overview.fine_amount.penalty_count + overview.fine_amount.combined_count)}건.`}
          {overview.fine_amount.zero_count > 0 && ` 0원으로 적힌 답변 ${fmtInt(overview.fine_amount.zero_count)}건 포함.`}
        </p>
      )}
      {message && (
        <div className="compare-note" role={personal.status === 'error' ? 'alert' : 'note'}>
          <span>{message}{personal.error?.retryAfter ? ` (${personal.error.retryAfter}초 후)` : ''}</span>
          {(personal.status === 'signed_out') && <button className="ghost-btn" type="button" onClick={onSignIn}>카카오로 로그인</button>}
          {personal.status === 'error' && personal.error?.code === 'session_expired' && <button className="ghost-btn" type="button" onClick={onSignIn}>다시 로그인</button>}
          {personal.status === 'error' && personal.error?.code !== 'session_expired' && personal.error?.code !== 'kakao_required' && personal.error?.code !== 'account_ineligible' &&
            <button className="ghost-btn" type="button" onClick={personal.retry}>다시 시도</button>}
        </div>
      )}
      {noShare && (
        <p className="compare-note" role="note">
          {viewer!.contributor === 'none'
            ? '아직 공유한 신고가 없습니다. 나만의 안전신문고 앱에서 커뮤니티 공유를 켜면 다음 업로드부터 반영됩니다.'
            : '공유를 멈춘 상태라 지도에 반영된 내 신고가 없습니다.'}
        </p>
      )}
      {showMine && data && (
        <p className="chart-caption">내 신고는 지도에 공유된 내 신고만 셉니다. 비율의 차이는 %p(퍼센트포인트)로, 건수는 전체 중 내 신고가 차지하는 비율로 보여 줍니다. 담당자나 기관을 평가하는 숫자가 아닙니다.</p>
      )}
    </section>
  );
}
