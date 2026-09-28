import { useMemo, useState } from 'react';
import type { PublicEntity } from '../domain/public';
import type { CompareEntityRow } from '../domain/personal';
import type { EntitySortKey, SortDir } from '../data/client';
import type { EntityTab } from '../state/filters';
import { acceptRate, fmtDays, fmtInt, fmtPercent, fmtPp, fmtWon, fmtRating } from './format';

interface Props {
  agencies: PublicEntity[];
  managers: PublicEntity[];
  tab: EntityTab;
  onTab: (t: EntityTab) => void;
  onPick: (kind: EntityTab, entity: PublicEntity) => void;
  // SOL-08: when present, the table browses the full /entities list (server search/sort/page)
  // instead of the dashboard top-100 summary arrays. Null keeps the previous summary behavior (demo).
  server?: ServerEntityState | null;
  /** personal rows (same keys as the public rows) when comparison is on; adds 내 완료/내 수용·일부/차이 */
  mine?: Map<string, CompareEntityRow> | null;
}

export interface ServerEntityState {
  items: PublicEntity[];
  total: number;
  page: number;
  pageSize: number;
  loading: boolean;
  error: string | null;
  q: string;
  sortKey: EntitySortKey;
  dir: SortDir;
  onSearch: (q: string) => void;
  onSort: (key: EntitySortKey) => void;
  onPage: (page: number) => void;
  onRetry: () => void;
}

type SortKey = EntitySortKey;
type Dir = SortDir;

const COLUMNS: Array<{ key: SortKey; label: string; num: boolean }> = [
  { key: 'completed', label: '답변 수', num: true },
  { key: 'accepted', label: '수용', num: true },
  { key: 'partial', label: '일부 수용', num: true },
  { key: 'rejected', label: '불수용', num: true },
  { key: 'acceptRate', label: '수용률', num: true },
  { key: 'fine', label: '과태료', num: true },
];

function val(e: PublicEntity, k: SortKey): number | null {
  switch (k) {
    case 'completed': return e.completed_count;
    case 'accepted': return e.outcomes.accepted;
    case 'partial': return e.outcomes.partial;
    case 'rejected': return e.outcomes.rejected;
    case 'fine': return e.fine_count;
    case 'acceptRate': return acceptRate(e.outcomes);
  }
}

export default function EntityTable(p: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('completed');
  const [dir, setDir] = useState<Dir>('desc');
  const [q, setQ] = useState('');
  const [mobileCols, setMobileCols] = useState(false);
  // SOL-08: server mode browses the full /entities list; summary mode keeps the dashboard top-100.
  const server = p.server ?? null;
  const rows = p.tab === 'agency' ? p.agencies : p.managers;

  const filtered = useMemo(() => {
    const needle = q.trim();
    const base = needle
      ? rows.filter((r) => r.agency_name.includes(needle) || (r.manager_name ?? '').includes(needle))
      : [...rows];
    base.sort((a, b) => {
      const va = val(a, sortKey);
      const vb = val(b, sortKey);
      const na = va == null ? -Infinity : va;
      const nb = vb == null ? -Infinity : vb;
      return dir === 'desc' ? nb - na : na - nb;
    });
    return base;
  }, [rows, q, sortKey, dir]);

  const toggle = (k: SortKey) => {
    if (server) {
      server.onSort(k);
      return;
    }
    if (k === sortKey) setDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    else {
      setSortKey(k);
      setDir('desc');
    }
  };

  const activeSort = server ? server.sortKey : sortKey;
  const activeDir = server ? server.dir : dir;
  const shown = server ? server.items : filtered;
  const pages = server ? Math.max(1, Math.ceil(server.total / server.pageSize)) : 1;

  const ariaSort = (k: SortKey): 'ascending' | 'descending' | 'none' =>
    k !== activeSort ? 'none' : activeDir === 'asc' ? 'ascending' : 'descending';

  return (
    <section className="cm-panel entities" id="entities" aria-label="기관·담당자별 처리 결과">
      <div className="panel-top">
        <div>
          <h2>기관·담당자별 처리 결과</h2>
          <span className="subtitle">공유된 신고의 처리 결과입니다. 기관이나 담당자를 평가하는 표가 아닙니다.</span>
        </div>
        <div className="mini-segments" role="group" aria-label="보기">
          <button type="button" className={p.tab === 'agency' ? 'selected' : ''} aria-pressed={p.tab === 'agency'} onClick={() => p.onTab('agency')}>기관</button>
          <button type="button" className={p.tab === 'manager' ? 'selected' : ''} aria-pressed={p.tab === 'manager'} onClick={() => p.onTab('manager')}>담당자</button>
        </div>
      </div>
      <div className="entity-toolbar">
        <input
          type="search" value={server ? server.q : q} placeholder="기관·이름 검색" aria-label="기관·이름 검색"
          onChange={(e) => (server ? server.onSearch(e.target.value) : setQ(e.target.value))}
        />
        <button className="ghost-btn" type="button" aria-pressed={mobileCols} onClick={() => setMobileCols((v) => !v)}>
          열 선택
        </button>
        {mobileCols && (
          <span className="col-picker">작은 화면에서는 표를 옆으로 밀어 나머지 칸을 볼 수 있습니다.</span>
        )}
      </div>
      {server?.error && (
        <div className="banner error" role="alert">
          <span className="grow">기관·담당자 목록을 불러오지 못했습니다. 다시 시도해 주세요.</span>
          <button className="ghost-btn" type="button" onClick={server.onRetry}>다시 시도</button>
        </div>
      )}
      <div className="table-scroll">
        <table className="entity-table">
          <caption className="cm-muted" style={{ textAlign: 'left', padding: '0 16px 8px', fontSize: 12 }}>
            {server
              ? `${p.tab === 'agency' ? '기관' : '담당자'} ${fmtInt(server.total)}${p.tab === 'agency' ? '곳' : '명'} · ${COLUMNS.find((c) => c.key === activeSort)!.label} ${activeDir === 'desc' ? '많은' : '적은'} 순`
              : `${p.tab === 'agency' ? '기관' : '담당자'} · ${COLUMNS.find((c) => c.key === activeSort)!.label} ${activeDir === 'desc' ? '많은' : '적은'} 순`}
          </caption>
          <thead>
            <tr>
              <th scope="col">{p.tab === 'agency' ? '기관' : '담당자 · 소속 기관'}</th>
              {COLUMNS.map((c) => (
                <th
                  key={c.key} scope="col" className="num sortable"
                  aria-sort={ariaSort(c.key)}
                  onClick={() => toggle(c.key)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(c.key); } }}
                  tabIndex={0}
                  title={`${c.label} 순으로 정렬`}
                >
                  {c.label}{activeSort === c.key ? (activeDir === 'desc' ? ' ▼' : ' ▲') : ''}
                </th>
              ))}
              <th scope="col">결과 비율</th>
              <th scope="col">결과가 나온 신고</th>
              <th scope="col" className="num" title="신고한 날부터 답변 받은 날까지, 중앙값">답변까지</th>
              <th scope="col" className="num" title="공개에 동의한 숫자 별점만, 별점 건수로 나눈 평균">평균 별점 · 건수</th>
              {p.mine && <th scope="col" className="num mine-col">내 답변</th>}
              {p.mine && <th scope="col" className="num mine-col">내 수용률</th>}
              {p.mine && <th scope="col" className="num mine-col">내 일부수용률</th>}
              {p.mine && <th scope="col" className="num">차이</th>}
            </tr>
          </thead>
          <tbody>
            {server?.loading && shown.length === 0 && (
              <tr><td colSpan={p.mine ? 15 : 11} style={{ textAlign: 'center', color: 'var(--muted)', padding: 24 }} role="status">불러오는 중입니다…</td></tr>
            )}
            {!(server?.loading && shown.length === 0) && shown.length === 0 && (
              <tr><td colSpan={p.mine ? 15 : 11} style={{ textAlign: 'center', color: 'var(--muted)', padding: 24 }}>조건에 맞는 기관·담당자가 없습니다.</td></tr>
            )}
            {shown.map((e) => {
              const d = e.outcomes.result_known;
              return (
                <tr key={e.key}>
                  <td>
                    <button
                      type="button" className="mini-btn" style={{ textAlign: 'left', maxWidth: 260, whiteSpace: 'normal' }}
                      title="이 기관·담당자만 보기"
                      onClick={() => p.onPick(p.tab, e)}
                      disabled={!e.agency_key || (p.tab === 'manager' && !e.manager_key)}
                    >
                      <span className="table-name">{p.tab === 'agency' ? e.agency_name : (e.manager_name ?? '이름 없음')}</span>
                      <small>{p.tab === 'agency' ? '' : e.agency_name}</small>
                    </button>
                  </td>
                  <td className="num">{fmtInt(e.completed_count)}</td>
                  <td className="num">{fmtInt(e.outcomes.accepted)}<small>{fmtPercent(d > 0 ? (e.outcomes.accepted / d) * 100 : null)}</small></td>
                  <td className="num">{fmtInt(e.outcomes.partial)}<small>{fmtPercent(d > 0 ? (e.outcomes.partial / d) * 100 : null)}</small></td>
                  <td className="num">{fmtInt(e.outcomes.rejected)}<small>{fmtPercent(d > 0 ? (e.outcomes.rejected / d) * 100 : null)}</small></td>
                  <td className="num">{fmtPercent(acceptRate(e.outcomes))}</td>
                  <td className="num">{e.fine_count == null ? '—' : fmtInt(e.fine_count)}{e.fine_amount && e.fine_amount.confirmed_count > 0 && <small title="답변에 적힌 과태료 금액 합계(금액이 확인된 것만)">{fmtWon(e.fine_amount.sum_won)}</small>}</td>
                  <td>
                    <div className="stack mini-stack" aria-hidden="true">
                      <i style={{ width: `${d > 0 ? (e.outcomes.accepted / d) * 100 : 0}%`, background: 'var(--accepted)' }} />
                      <i style={{ width: `${d > 0 ? (e.outcomes.partial / d) * 100 : 0}%`, background: 'var(--partial)' }} />
                      <i style={{ width: `${d > 0 ? (e.outcomes.rejected / d) * 100 : 0}%`, background: 'var(--rejected)' }} />
                    </div>
                  </td>
                  <td>{d === 1 ? <span className="sample-one">1건</span> : `${fmtInt(d)}건`}</td>
                  <td className="num">{e.duration && e.duration.count > 0 ? fmtDays(e.duration.median_days) : '—'}</td>
                  <td className="num">{fmtRating(e.rating)}</td>
                  {p.mine && <td className="num mine-col">{fmtInt(p.mine.get(e.key)?.mine.completed_count ?? 0)}</td>}
                  {p.mine && <td className="num mine-col">{fmtPercent(p.mine.get(e.key)?.mine.accept_rate ?? null)}</td>}
                  {p.mine && <td className="num mine-col">{fmtPercent(p.mine.get(e.key)?.mine.partial_rate ?? null)}</td>}
                  {p.mine && <td className="num">수용 {fmtPp(p.mine.get(e.key)?.accept_rate_pp ?? null)}<small>일부 {fmtPp(p.mine.get(e.key)?.partial_rate_pp ?? null)}</small></td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="table-footer">
        <span>이름이 같아도 소속 기관이 다르면 따로 보여 드립니다.</span>
        {server
          ? <span>{server.loading ? '불러오는 중…' : ''}</span>
          : <span>순위나 우수 표시는 하지 않습니다.</span>}
      </div>
      {server && (
        <div className="table-pager" style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end', padding: '8px 16px' }}>
          <span className="cm-muted" style={{ fontSize: 12 }} aria-live="polite">{server.page} / {pages}쪽 · 전체 {fmtInt(server.total)}{p.tab === 'agency' ? '곳' : '명'}</span>
          <button className="ghost-btn" type="button" disabled={server.page <= 1 || server.loading} onClick={() => server.onPage(server.page - 1)} aria-label="이전 페이지">이전</button>
          <button className="ghost-btn" type="button" disabled={server.page >= pages || server.loading} onClick={() => server.onPage(server.page + 1)} aria-label="다음 페이지">다음</button>
        </div>
      )}
    </section>
  );
}
