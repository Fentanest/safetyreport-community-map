import { useMemo, useState } from 'react';
import type { MetricDef, StatCatalog, StatisticsResult } from '../../domain/statistics';
import { cellIndex, sortedRowMembers, tupleKey, type RowSort } from '../../state/statistics';
import { fmtStat } from './statFormat';

const PAGE = 50;
export type { RowSort };

/**
 * S07 table renderer of a complete StatisticsResult. Rows are member tuples; columns are column members × metrics
 * (× 전체/내 신고 in compare). Totals come from the server (recomputed from raw facts), never summed here.
 * Paging and sorting are local (the result is complete); a missing combination is "—" (해당 신고 없음), not 0.
 */
export default function PivotTable({ result, catalog, sort, onSort, onPick }: {
  result: StatisticsResult;
  catalog: StatCatalog;
  sort: RowSort;
  onSort: (s: RowSort) => void;
  /** a body cell/row header was chosen: offer "이 항목으로 좁히기" */
  onPick?: (row: string[], col: string[] | null) => void;
}) {
  const [page, setPage] = useState(0);
  const [pageContext, setPageContext] = useState({ result, metric: sort.metric, dir: sort.dir });
  if (pageContext.result !== result || pageContext.metric !== sort.metric || pageContext.dir !== sort.dir) {
    setPageContext({ result, metric: sort.metric, dir: sort.dir });
    setPage(0);
  }
  const cell = useMemo(() => cellIndex(result), [result]);
  const metric = (id: string): MetricDef | undefined => catalog.metrics.find((m) => m.id === id);
  const dimLabel = (id: string) => catalog.dimensions.find((d) => d.id === id)?.label ?? id;
  const sides: Array<'all' | 'mine'> = result.spec.population === 'compare' ? ['all', 'mine'] : [result.spec.population === 'mine' ? 'mine' : 'all'];
  const sideWord = (s: 'all' | 'mine') => (result.spec.population === 'compare' ? (s === 'all' ? ' · 전체' : ' · 내 신고') : '');
  const cols = result.col_members;
  const metrics = result.spec.metrics;
  const rowTotal = useMemo(() => new Map(result.row_totals.map((t) => [`${t.side}|${tupleKey(t.key)}`, t])), [result]);
  const colTotal = useMemo(() => new Map(result.col_totals.map((t) => [`${t.side}|${tupleKey(t.key)}`, t])), [result]);
  const rows = useMemo(() => sortedRowMembers(result, sort), [result, sort]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const shown = rows.slice(page * PAGE, page * PAGE + PAGE);
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
                <th key={`${tupleKey(c.key)}-${m}-${s}`} scope="col" className={s === 'mine' ? 'mine-col' : undefined}
                  aria-sort={!hasCols && sort.metric === m && s === (result.spec.population === 'mine' ? 'mine' : 'all') ? (sort.dir === 'desc' ? 'descending' : 'ascending') : undefined}>
                  {hasCols && <span className="pivot-col-member">{c.label.join(' · ')}</span>}
                  <button type="button" className="pivot-sort"
                    onClick={() => onSort({ metric: m, dir: sort.metric === m && sort.dir === 'desc' ? 'asc' : 'desc' })}
                    title="이 지표로 행 정렬(행 합계 기준)">
                    {metric(m)?.label ?? m}{sideWord(s)}
                  </button>
                </th>
              ))))}
              {hasCols && hasRows && metrics.map((m) => sides.map((s) => <th key={`tot-${m}-${s}`} scope="col" className="pivot-total">{metric(m)?.label} 합계{sideWord(s)}</th>))}
            </tr>
          </thead>
          <tbody>
            {(hasRows ? shown : [{ key: [], label: [] as string[] }]).map((r) => (
              <tr key={tupleKey(r.key)}>
                <th scope="row">
                  {hasRows ? (onPick ? <button type="button" className="link-btn pivot-row" onClick={() => onPick(r.key, null)}>{r.label.join(' · ')}</button> : r.label.join(' · ')) : '합계'}
                </th>
                {colHead.map((c) => metrics.map((m) => sides.map((s) => {
                  const v = valueOf(s, r.key, c.key, m);
                  return <td key={`${tupleKey(c.key)}-${m}-${s}`} className={`num${s === 'mine' ? ' mine-col' : ''}`}
                    title={v ? undefined : '이 조합의 답변 신고가 없습니다'}>
                    {onPick && hasRows && hasCols && v
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
                  <td key={`${tupleKey(c.key)}-${m}-${s}`} className="num pivot-total">
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
          <span className="cm-muted">행 {rows.length.toLocaleString('ko-KR')}개 중 {Math.min(rows.length, page * PAGE + 1)}–{Math.min(rows.length, (page + 1) * PAGE)}</span>
          <button type="button" className="ghost-btn" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>이전</button>
          <button type="button" className="ghost-btn" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>다음</button>
        </div>
      )}
    </div>
  );
}
