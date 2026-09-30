import { DATE_BASIS_LABEL } from '../domain/public';
import type { Overview } from '../domain/public';
import type { CompareSummary, PersonalCompare } from '../domain/personal';
import type { PersonalState } from '../hooks/usePersonal';
import type { AuthSnapshot } from '../auth/mapAuth';
import { acceptRate, fmtDays, fmtDaysDiff, fmtFineAmount, fmtInt, fmtPercent, fmtPp, fmtRating, fmtShare, fmtWon, fmtWonDiff, partialRate } from './format';

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
    { id: 'report', label: '신고', basis: `${DATE_BASIS_LABEL[o.report_count.basis]} 기준`, all: fmtInt(o.report_count.value), allNote: null,
      mine: m => fmtInt(m.report_count), mineNote: () => null, diff: x => fmtShare(x.diff.report_share), diffKind: 'share' },
    { id: 'completed', label: '답변 완료', basis: `${DATE_BASIS_LABEL[o.report_count.basis]} 기준`, all: fmtInt(o.completed_count.value),
      allNote: out ? `미분류 제외 ${fmtInt(d)}건` : null,
      mine: m => fmtInt(m.completed_count), mineNote: m => `미분류 제외 ${fmtInt(m.result_known)}건`,
      diff: x => fmtShare(x.diff.completed_share), diffKind: 'share' },
    { id: 'accept', label: '수용률', basis: '수용 ÷ (수용+일부수용+불수용)',
      all: fmtPercent(acceptRate(out)),
      allNote: out ? `${fmtInt(out.accepted)} / ${fmtInt(d)}건` : null,
      mine: m => fmtPercent(m.accept_rate), mineNote: m => `${fmtInt(m.accepted)} / ${fmtInt(m.result_known)}건`,
      diff: x => fmtPp(x.diff.accept_rate_pp), diffKind: 'pp' },
    { id: 'partial', label: '일부수용률', basis: '일부수용 ÷ (수용+일부수용+불수용)',
      all: fmtPercent(partialRate(out)), allNote: out ? `${fmtInt(out.partial)} / ${fmtInt(d)}건` : null,
      mine: m => fmtPercent(m.partial_rate), mineNote: m => `${fmtInt(m.partial)} / ${fmtInt(m.result_known)}건`,
      diff: x => fmtPp(x.diff.partial_rate_pp), diffKind: 'pp' },
    { id: 'reject', label: '불수용률', basis: '불수용 ÷ (수용+일부수용+불수용)',
      all: fmtPercent(out ? pct(out.rejected, d) : null), allNote: out ? `${fmtInt(out.rejected)} / ${fmtInt(d)}건` : null,
      mine: m => fmtPercent(m.reject_rate), mineNote: m => `${fmtInt(m.rejected)} / ${fmtInt(m.result_known)}건`,
      diff: x => fmtPp(x.diff.reject_rate_pp), diffKind: 'pp' },
    { id: 'fine', label: '과태료 부과율', basis: '과태료 ÷ 답변',
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
    { id: 'amount', label: '답변에 적힌 과태료 금액', basis: '합계',
      all: fmtFineAmount(o.fine_amount), allNote: amountNote(o.fine_amount),
      mine: m => fmtFineAmount(m.fine_amount), mineNote: m => amountNote(m.fine_amount),
      diff: x => fmtShare(x.diff.fine_amount_sum_share), diffKind: 'share',
      diffNote: x => x.diff.fine_amount_mean_won_diff == null ? null : `평균 ${fmtWonDiff(x.diff.fine_amount_mean_won_diff)}` },
    { id: 'rating', label: '답변 만족도 별점', basis: '1~5점',
      all: fmtRating(o.rating), allNote: null,
      mine: m => fmtRating(m.rating), mineNote: () => null,
      diff: () => '—', diffKind: 'none' },
    { id: 'points', label: '신고 장소', basis: '', all: fmtInt(o.point_count.value), allNote: null,
      mine: m => fmtInt(m.point_count), mineNote: () => null, diff: x => fmtShare(x.diff.point_share), diffKind: 'share' },
    { id: 'contributors', label: '참여한 사람', basis: '', all: fmtInt(o.contributor_count.value), allNote: null,
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
          {unsupported && <span className="subtitle">이 조건의 통계는 아직 없습니다</span>}
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
                    <small>{row.diffKind === 'share' ? '전체 중 내 신고' : row.diffKind === 'days' ? '나와 전체의 차이' : row.diffKind === 'pp' ? (data.diff.rate_reason === 'no_mine' ? '내 결과가 아직 없음' : data.diff.rate_reason === 'no_all' ? '결과가 아직 없음' : '나와 전체의 차이') : ''}</small></>)
                    : <span className="cm-muted">—</span>}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
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
        <p className="chart-caption">비율 차이는 %p, 건수는 전체 중 내 신고의 비중입니다.</p>
      )}
    </section>
  );
}
