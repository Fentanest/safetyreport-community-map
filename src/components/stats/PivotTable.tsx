import { useMemo } from 'react';
import { STAT_OTHER_KEY, type MetricDef, type StatCatalog, type StatisticsResult } from '../../domain/statistics';
import { cellIndex, tupleKey, type RowSort } from '../../state/statistics';
import { fmtStat } from './statFormat';

export type { RowSort };
/** D22 LEGACY: the synthetic '그 외' member an unpaged top-N cut folds the rest into (never a real, pickable
 *  member). A D23 paged response (every live request now sends `row_cursor`) never produces one. */
const isOther = (key: readonly string[]) => key[0] === STAT_OTHER_KEY;

/**
 * S07 table renderer of ONE row page of a StatisticsResult (D23 row paging, 2026-10-12) — `result.row_members`/
 * `row_totals`/`cells` cover only `result.row_page`'s rows; `col_members`/`col_totals`/`grand_totals` are always
 * complete. Page navigation and the metric sort that decides row order are both server round trips owned by the
 * caller (`onPageOffset`/`onSort`); this component only renders what it was given. A missing combination is
 * "—" (해당 신고 없음), not 0. `result.row_page` absent (legacy/unpaged) falls back to showing every row at once.
 */
export default function PivotTable({ result, catalog, sort, onSort, onPick, onPageOffset, pageBusy }: {
  result: StatisticsResult;
  catalog: StatCatalog;
  sort: RowSort;
  onSort: (s: RowSort) => void;
  /** a body cell/row header was chosen: offer "이 항목으로 좁히기" */
  onPick?: (row: string[], col: string[] | null) => void;
  /** D23: fetch the row page starting at this offset (0 = first page); a no-op when `result.row_page` is absent */
  onPageOffset?: (offset: number) => void;
  /** D23: a page fetch (page turn or sort change) is in flight — disables the pager without blanking the table */
  pageBusy?: boolean;
}) {
  const cell = useMemo(() => cellIndex(result), [result]);
  const metric = (id: string): MetricDef | undefined => catalog.metrics.find((m) => m.id === id);
  const dimLabel = (id: string) => catalog.dimensions.find((d) => d.id === id)?.label ?? id;
  const sides: Array<'all' | 'mine'> = result.spec.population === 'compare' ? ['all', 'mine'] : [result.spec.population === 'mine' ? 'mine' : 'all'];
  const sideWord = (s: 'all' | 'mine') => (result.spec.population === 'compare' ? (s === 'all' ? ' · 전체' : ' · 내 신고') : '');
  const cols = result.col_members;
  const metrics = result.spec.metrics;
  const rowTotal = useMemo(() => new Map(result.row_totals.map((t) => [`${t.side}|${tupleKey(t.key)}`, t])), [result]);
  const colTotal = useMemo(() => new Map(result.col_totals.map((t) => [`${t.side}|${tupleKey(t.key)}`, t])), [result]);
  // D23: the server already sorted/paged this exact row page — never re-sort or re-slice on the client.
  const rows = result.row_members;
  const rp = result.row_page ?? { offset: 0, limit: Math.max(1, rows.length), total: rows.length, has_more: false };
  const hasRows = result.spec.rows.length > 0, hasCols = result.spec.columns.length > 0;
  const valueOf = (side: 'all' | 'mine', row: string[], col: string[], m: string) => {
    if (!hasRows && !hasCols) return result.grand_totals.find((t) => t.side === side)?.values[m];
    if (!hasCols) return (hasRows ? cell(side, row, []) : undefined)?.values[m];
    if (!hasRows) return colTotal.get(`${side}|${tupleKey(col)}`)?.values[m];
    return cell(side, row, col)?.values[m];
  };
  const colHead = hasCols ? cols : [{ key: [], label: [] as string[] }];

  return (
    <div className="pivot">
      <div className="pivot-scroll" tabIndex={0} role="region" aria-label="통계 표 (가로로 스크롤할 수 있습니다)">
        <table className="pivot-table">
          <thead>
            <tr>
              <th scope="col" className="pivot-corner">{hasRows ? result.spec.rows.map(dimLabel).join(' · ') : '전체'}</th>
              {colHead.map((c) => metrics.map((m) => sides.map((s) => (
                <th key={`${tupleKey(c.key)}-${m}-${s}`} scope="col" className={[s === 'mine' ? 'mine-col' : '', isOther(c.key) ? 'pivot-other' : ''].filter(Boolean).join(' ') || undefined}
                  aria-sort={!hasCols && sort.metric === m && s === (result.spec.population === 'mine' ? 'mine' : 'all') ? (sort.dir === 'desc' ? 'descending' : 'ascending') : undefined}>
                  {hasCols && <span className="pivot-col-member">{c.label.join(' · ')}</span>}
                  <button type="button" className="pivot-sort"
                    onClick={() => onSort({ metric: m, dir: sort.metric === m && sort.dir === 'desc' ? 'asc' : 'desc' })}
                    title="이 지표로 행 정렬(행 합계 기준)">
                    {metric(m)?.label ?? m}{sideWord(s)}
                  </button>
                </th>
              ))))}
              {hasCols && hasRows && metrics.map((m) => sides.map((s) => (
                <th key={`tot-${m}-${s}`} scope="col" className="pivot-total"
                  aria-sort={sort.metric === m && s === (result.spec.population === 'mine' ? 'mine' : 'all') ? (sort.dir === 'desc' ? 'descending' : 'ascending') : undefined}>
                  <button type="button" className="pivot-sort"
                    onClick={() => onSort({ metric: m, dir: sort.metric === m && sort.dir === 'desc' ? 'asc' : 'desc' })}
                    title="이 지표로 행 정렬(행 합계 기준)">
                    {metric(m)?.label} 합계{sideWord(s)}
                  </button>
                </th>
              )))}
            </tr>
          </thead>
          <tbody>
            {(hasRows ? rows : [{ key: [], label: [] as string[] }]).map((r) => (
              <tr key={tupleKey(r.key)} className={hasRows && isOther(r.key) ? 'pivot-other' : undefined}>
                <th scope="row">
                  {hasRows
                    ? (onPick && !isOther(r.key) ? <button type="button" className="link-btn pivot-row" onClick={() => onPick(r.key, null)}>{r.label.join(' · ')}</button> : r.label.join(' · '))
                    : '합계'}
                </th>
                {colHead.map((c) => metrics.map((m) => sides.map((s) => {
                  const v = valueOf(s, r.key, c.key, m);
                  return <td key={`${tupleKey(c.key)}-${m}-${s}`} className={`num${s === 'mine' ? ' mine-col' : ''}${hasCols && isOther(c.key) ? ' pivot-other' : ''}`}
                    title={v ? undefined : '이 조합의 답변 신고가 없습니다'}>
                    {onPick && hasRows && hasCols && v && !isOther(r.key) && !isOther(c.key)
                      ? <button type="button" className="link-btn pivot-cell" onClick={() => onPick(r.key, c.key)}
                          aria-label={`${r.label.join(' · ')} · ${c.label.join(' · ')} · ${metric(m)?.label ?? m}${sideWord(s)} ${fmtStat(v, metric(m))}, 이 항목으로 좁히기`}>
                          {fmtStat(v, metric(m))}
                        </button>
                      : v ? fmtStat(v, metric(m)) : '—'}
                  </td>;
                })))}
                {hasCols && hasRows && metrics.map((m) => sides.map((s) => (
                  <td key={`tot-${m}-${s}`} className="num pivot-total">{fmtStat(rowTotal.get(`${s}|${tupleKey(r.key)}`)?.values[m], metric(m))}</td>
                )))}
              </tr>
            ))}
          </tbody>
          {hasRows && (
            <tfoot>
              <tr>
                <th scope="row">합계</th>
                {colHead.map((c) => metrics.map((m) => sides.map((s) => (
                  <td key={`${tupleKey(c.key)}-${m}-${s}`} className={`num pivot-total${hasCols && isOther(c.key) ? ' pivot-other' : ''}`}>
                    {fmtStat(hasCols ? colTotal.get(`${s}|${tupleKey(c.key)}`)?.values[m] : result.grand_totals.find((t) => t.side === s)?.values[m], metric(m))}
                  </td>
                ))))}
                {hasCols && metrics.map((m) => sides.map((s) => (
                  <td key={`g-${m}-${s}`} className="num pivot-total">{fmtStat(result.grand_totals.find((t) => t.side === s)?.values[m], metric(m))}</td>
                )))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {hasRows && (
        <div className="pivot-pager">
          {/* D23 (2026-10-12): the position indicator that replaced the old '그 외' banner, merged into the same
              pager line the table already had — "기관 491곳" style counting, kept generic (개) across dimensions. */}
          <span className="cm-muted">
            {result.spec.rows.map(dimLabel).join(' · ')} {rp.total.toLocaleString('ko-KR')}개 중 {rows.length ? `${(rp.offset + 1).toLocaleString('ko-KR')}~${(rp.offset + rows.length).toLocaleString('ko-KR')}번째 표시` : '0개'}
          </span>
          <button type="button" className="ghost-btn" disabled={!!pageBusy || rp.offset === 0} onClick={() => onPageOffset?.(Math.max(0, rp.offset - rp.limit))}>이전</button>
          <button type="button" className="ghost-btn" disabled={!!pageBusy || !rp.has_more} onClick={() => onPageOffset?.(rp.offset + rp.limit)}>다음</button>
          {pageBusy && <span className="cm-muted" role="status">쪽을 받는 중…</span>}
        </div>
      )}
    </div>
  );
}
