import { useMemo, useState } from 'react';
import type { MetricDef, StatCatalog, StatisticsResult } from '../../domain/statistics';
import { cellIndex, tupleKey } from '../../state/statistics';
import { fmtStat } from './statFormat';

const PAGE = 50;
export type RowSort = { metric: string | null; dir: 'asc' | 'desc' };

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
  const cell = useMemo(() => cellIndex(result), [result]);
  const metric = (id: string): MetricDef | undefined => catalog.metrics.find((m) => m.id === id);
  const dimLabel = (id: string) => catalog.dimensions.find((d) => d.id === id)?.label ?? id;
  const sides: Array<'all' | 'mine'> = result.spec.population === 'compare' ? ['all', 'mine'] : [result.spec.population === 'mine' ? 'mine' : 'all'];
  const sideWord = (s: 'all' | 'mine') => (result.spec.population === 'compare' ? (s === 'all' ? ' · 전체' : ' · 내 신고') : '');
  const cols = result.col_members;
  const metrics = result.spec.metrics;
  const rowTotal = useMemo(() => new Map(result.row_totals.map((t) => [`${t.side}|${tupleKey(t.key)}`, t])), [result]);
  const colTotal = useMemo(() => new Map(result.col_totals.map((t) => [`${t.side}|${tupleKey(t.key)}`, t])), [result]);
  const rows = useMemo(() => {
    const list = [...result.row_members];
    if (sort.metric) {
      const val = (key: string[]) => (result.spec.columns.length ? rowTotal.get(`${sides[0]}|${tupleKey(key)}`)?.values[sort.metric!]?.value
        : cell(sides[0], key, [])?.values[sort.metric!]?.value) ?? null;
      list.sort((a, b) => {
        const va = val(a.key), vb = val(b.key);
        if (va === null && vb === null) return 0;
        if (va === null) return 1; // unknown values last in both directions
        if (vb === null) return -1;
        return sort.dir === 'desc' ? vb - va : va - vb;
      });
    }
    return list;
  }, [result, sort, rowTotal, cell]); // eslint-disable-line react-hooks/exhaustive-deps
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
                <th key={`${tupleKey(c.key)}-${m}-${s}`} scope="col" className={s === 'mine' ? 'mine-col' : undefined}>
                  {hasCols && <span className="pivot-col-member">{c.label.join(' · ')}</span>}
                  <button type="button" className="pivot-sort" aria-sort={!hasCols && sort.metric === m ? (sort.dir === 'desc' ? 'descending' : 'ascending') : undefined}
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
                    title={v ? undefined : '이 조합의 답변 신고가 없습니다'}
                    onClick={onPick && hasRows && hasCols && v ? () => onPick(r.key, c.key) : undefined}>{v ? fmtStat(v, metric(m)) : '—'}</td>;
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
      <p className="chart-caption">합계는 칸을 더하거나 평균한 값이 아니라 원 신고에서 다시 계산했습니다. ‘—’는 그 조합의 답변 신고가 없다는 뜻이며 0이 아닙니다.
        {result.spec.population === 'compare' ? ' 전체와 내 신고는 겹치는 집합이라 더하지 않습니다.' : ''}</p>
    </div>
  );
}
