import type { Overview } from '../domain/public';
import type { CompareSummary, PersonalCompare } from '../domain/personal';
import type { PersonalState } from '../hooks/usePersonal';
import type { AuthSnapshot } from '../auth/mapAuth';
import { fmtInt, fmtPercent, fmtPp, fmtShare } from './format';

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
  diffKind: 'share' | 'pp' | 'none';
}

const pct = (a: number, d: number) => (d > 0 ? (a / d) * 100 : null);

function rows(o: Overview): Row[] {
  const out = o.outcomes;
  const d = out?.result_known ?? 0;
  const c = o.completed_count.value ?? 0;
  return [
    { id: 'report', label: '신고 접수', basis: '신고일', all: fmtInt(o.report_count.value), allNote: null,
      mine: m => fmtInt(m.report_count), mineNote: () => null, diff: x => fmtShare(x.diff.report_share), diffKind: 'share' },
    { id: 'completed', label: '처리완료', basis: '처리완료일', all: fmtInt(o.completed_count.value),
      allNote: out ? `결과 확인 ${fmtInt(d)}건` : null,
      mine: m => fmtInt(m.completed_count), mineNote: m => `결과 확인 ${fmtInt(m.result_known)}건`,
      diff: x => fmtShare(x.diff.completed_share), diffKind: 'share' },
    { id: 'accept', label: '수용·일부수용 비율', basis: '처리완료일 · 분모 결과 확인',
      all: fmtPercent(o.accepted_including_partial.value),
      allNote: out ? `${fmtInt(o.accepted_including_partial.numerator)} / ${fmtInt(d)}건` : null,
      mine: m => fmtPercent(m.accept_rate), mineNote: m => `${fmtInt(m.accepted + m.partial)} / ${fmtInt(m.result_known)}건`,
      diff: x => fmtPp(x.diff.accept_rate_pp), diffKind: 'pp' },
    { id: 'reject', label: '불수용 비율', basis: '처리완료일 · 분모 결과 확인',
      all: fmtPercent(out ? pct(out.rejected, d) : null), allNote: out ? `${fmtInt(out.rejected)} / ${fmtInt(d)}건` : null,
      mine: m => fmtPercent(m.reject_rate), mineNote: m => `${fmtInt(m.rejected)} / ${fmtInt(m.result_known)}건`,
      diff: x => fmtPp(x.diff.reject_rate_pp), diffKind: 'pp' },
    { id: 'fine', label: '과태료 처분 비율', basis: '처리완료일 · 분모 처리완료',
      all: fmtPercent(pct(o.fine_count.value ?? 0, c)), allNote: `${fmtInt(o.fine_count.value)}건`,
      mine: m => fmtPercent(m.fine_rate), mineNote: m => `${fmtInt(m.fine_count)}건`,
      diff: x => fmtPp(x.diff.fine_rate_pp), diffKind: 'pp' },
    { id: 'points', label: '신고 지점', basis: '신고일 · 정확 지점', all: fmtInt(o.point_count.value), allNote: null,
      mine: m => fmtInt(m.point_count), mineNote: () => null, diff: x => fmtShare(x.diff.point_share), diffKind: 'share' },
    { id: 'contributors', label: '기여 계정', basis: '신고일', all: fmtInt(o.contributor_count.value), allNote: '고유 계정 수',
      mine: () => '—', mineNote: () => null, diff: () => '—', diffKind: 'none' },
  ];
}

function mineMessage(p: PersonalState, auth: AuthSnapshot): string | null {
  if (p.status === 'unconfigured') return auth.message ?? '이 배포에는 지도 로그인이 설정되지 않았습니다.';
  if (p.status === 'signed_out') return auth.message ?? '로그인하면 같은 범위의 내 신고를 나란히 비교합니다.';
  if (p.status === 'error') return p.error?.message ?? '내 신고 비교를 불러오지 못했습니다.';
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
    <section className="cm-panel compare-kpis" aria-label={showMine ? '전체와 내 신고 비교' : '핵심 지표'}>
      <div className="panel-top">
        <div>
          <h2>{showMine ? '전체 · 내 신고 비교' : '핵심 지표'}</h2>
          <span className="subtitle">같은 기간·지역·기관·담당자 조건 · 신고일/처리완료일 기준 구분{unsupported ? ' · 선택 범위 집계 미지원' : ''}</span>
        </div>
      </div>
      <table className="compare-table">
        <thead>
          <tr>
            <th scope="col">지표</th>
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
                    <small>{row.diffKind === 'share' ? '내 비중' : row.diffKind === 'pp' ? (data.diff.rate_reason === 'no_mine' ? '내 결과 확인 0건' : data.diff.rate_reason === 'no_all' ? '결과 확인 0건' : '내 − 전체') : ''}</small></>)
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
            ? '아직 공유한 신고가 없습니다. 앱에서 커뮤니티 공유를 켜면 다음 업로드부터 반영됩니다.'
            : '공유가 중지된 상태라 공개 집계에 포함된 내 신고가 없습니다.'}
        </p>
      )}
      {showMine && data && (
        <p className="chart-caption">내 신고는 공개 집계에 포함된 내 신고만 셉니다(전체에 포함). 비율 차이는 %p, 건수는 전체 중 내 비중입니다. 관측값 비교이며 평가가 아닙니다.</p>
      )}
    </section>
  );
}
