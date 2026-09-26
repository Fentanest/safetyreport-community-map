import { useMemo, useState } from 'react';
import type { PublicRegion } from '../domain/public';
import type { CompareRegionRow } from '../domain/personal';
import { regionName } from '../state/view';
import { fmtInt, fmtPercent, fmtPp } from './format';

interface Props {
  regions: PublicRegion[] | null;
  /** personal rows for the same scope/version, or null when comparison is off/not ready */
  compare: CompareRegionRow[] | null;
  compareOn: boolean;
  interest: string[];
  onToggleInterest: (code: string) => void;
  activeRegion: string | null;
  /** explicit scope change (region condition) */
  onPickRegion: (code: string | null) => void;
  /** rows shown before "더 보기" */
  initialRows?: number;
}

type Sort = 'all' | 'mine';

const rate = (r: PublicRegion) => (r.outcomes.result_known > 0 ? ((r.outcomes.accepted + r.outcomes.partial) / r.outcomes.result_known) * 100 : null);

/** Data wiring: Sol · visual implementation: Muse (docs/personal-comparison.md §5.4). */
export default function RegionList(p: Props) {
  const [expanded, setExpanded] = useState(false);
  const [sort, setSort] = useState<Sort>('all');
  const mineByCode = useMemo(() => new Map((p.compare ?? []).map(r => [r.region_code, r])), [p.compare]);
  const rowsSorted = useMemo(() => {
    const list = [...(p.regions ?? [])];
    if (sort === 'mine' && p.compare) {
      list.sort((a, b) => (mineByCode.get(b.region_code)?.mine.report_count ?? 0) - (mineByCode.get(a.region_code)?.mine.report_count ?? 0) ||
        b.report_count - a.report_count);
    }
    return list;
  }, [p.regions, p.compare, sort, mineByCode]);
  const pinned = rowsSorted.filter(r => r.region_code !== null && p.interest.includes(r.region_code));
  const rest = rowsSorted.filter(r => !(r.region_code !== null && p.interest.includes(r.region_code)));
  const limit = p.initialRows ?? 6;
  const visible = expanded ? rest : rest.slice(0, Math.max(0, limit - Math.min(pinned.length, limit)));
  const showMine = p.compareOn && !!p.compare;

  const row = (r: PublicRegion, isInterest: boolean) => {
    const mine = mineByCode.get(r.region_code);
    const name = regionName(r.region_code);
    const allRate = rate(r);
    return (
      <li key={r.region_code ?? 'unknown'} className={`region-row${p.activeRegion === r.region_code ? ' active' : ''}`}>
        <button type="button" className="region-pick" disabled={r.region_code === null}
          aria-pressed={p.activeRegion === r.region_code}
          title={r.region_code === null ? '지역 미상 행은 조건으로 적용할 수 없습니다.' : `${name} 조건으로 조회`}
          onClick={() => p.onPickRegion(p.activeRegion === r.region_code ? null : r.region_code)}>
          <span className="region-name">{name}{p.activeRegion === r.region_code && <span className="region-active-tag">적용 중</span>}</span>
          <span className="region-nums">
            <span>전체 <b className="cm-number">{fmtInt(r.report_count)}</b>건 · 수용·일부 <b className="cm-number">{fmtPercent(allRate)}</b></span>
            {showMine && (
              mine && (mine.mine.report_count > 0 || mine.mine.completed_count > 0) ? (
                <span className="mine-col">내 <b className="cm-number">{fmtInt(mine.mine.report_count)}</b>건 · 내 <b className="cm-number">{fmtPercent(mine.mine.accept_rate)}</b> ({fmtPp(mine.accept_rate_pp)})</span>
              ) : (
                <span className="cm-muted">내 신고 없음</span>
              )
            )}
          </span>
        </button>
        {r.region_code !== null && (
          <button type="button" className="region-star" aria-pressed={isInterest}
            aria-label={isInterest ? `${name} 관심 지역 해제` : `${name} 관심 지역으로 표시`}
            title={isInterest ? '관심 지역에서 제외' : '관심 지역으로 표시 (이 브라우저에만 저장)'}
            onClick={() => p.onToggleInterest(r.region_code!)}>
            {isInterest ? '★' : '☆'}
          </button>
        )}
      </li>
    );
  };

  return (
    <section className="cm-panel region-list" id="regions" aria-label="지역 목록">
      <div className="panel-top">
        <div>
          <h2>지역 목록</h2>
          <span className="subtitle">신고일 기준 건수 · 수용·일부수용은 처리완료일 기준 · 행을 누르면 지역 조건 적용</span>
        </div>
        {showMine && (
          <div className="mini-segments" role="group" aria-label="지역 정렬">
            <button type="button" className={sort === 'all' ? 'selected' : ''} aria-pressed={sort === 'all'} onClick={() => setSort('all')}>전체순</button>
            <button type="button" className={sort === 'mine' ? 'selected' : ''} aria-pressed={sort === 'mine'} onClick={() => setSort('mine')}>내 신고순</button>
          </div>
        )}
      </div>
      {p.regions === null ? (
        <p className="empty-state">이 데이터 원천은 지역 목록을 제공하지 않습니다.</p>
      ) : p.regions.length === 0 ? (
        <p className="empty-state">현재 조건에 지역별 결과가 없습니다.</p>
      ) : (
        <>
          {pinned.length > 0 && (
            <>
              <p className="region-group-label" id="interest-label">관심 지역 · 이 브라우저에만 저장</p>
              <ul className="region-rows interest" aria-labelledby="interest-label">{pinned.map(r => row(r, true))}</ul>
            </>
          )}
          <ul className="region-rows" aria-label="지역">{visible.map(r => row(r, false))}</ul>
          {rest.length > visible.length || expanded ? (
            <div className="region-more">
              <button type="button" className="ghost-btn" aria-expanded={expanded} onClick={() => setExpanded(v => !v)}>
                {expanded ? '접기' : `더 보기 · ${fmtInt(rest.length - visible.length)}곳`}
              </button>
            </div>
          ) : null}
          <p className="chart-caption">관심 지역(★)은 이 브라우저에만 저장되며 서버로 보내지 않습니다.</p>
        </>
      )}
    </section>
  );
}
