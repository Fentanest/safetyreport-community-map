import { useMemo, useState } from 'react';
import type { PublicEntity } from '../domain/public';
import type { EntitySortKey, SortDir } from '../data/client';
import type { EntityTab } from '../state/filters';
import { fmtInt, fmtPercent } from './format';

interface Props {
  agencies: PublicEntity[];
  managers: PublicEntity[];
  tab: EntityTab;
  onTab: (t: EntityTab) => void;
  onPick: (kind: EntityTab, entity: PublicEntity) => void;
  // SOL-08: when present, the table browses the full /entities list (server search/sort/page)
  // instead of the dashboard top-100 summary arrays. Null keeps the previous summary behavior (demo).
  server?: ServerEntityState | null;
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
  { key: 'completed', label: '완료 건수', num: true },
  { key: 'accepted', label: '수용', num: true },
  { key: 'partial', label: '일부수용', num: true },
  { key: 'rejected', label: '불수용', num: true },
  { key: 'acceptRate', label: '수용·일부 %', num: true },
  { key: 'fine', label: '과태료', num: true },
];

function val(e: PublicEntity, k: SortKey): number | null {
  const d = e.outcomes.result_known;
  switch (k) {
    case 'completed': return e.completed_count;
    case 'accepted': return e.outcomes.accepted;
    case 'partial': return e.outcomes.partial;
    case 'rejected': return e.outcomes.rejected;
    case 'fine': return e.fine_count;
    case 'acceptRate': return d > 0 ? ((e.outcomes.accepted + e.outcomes.partial) / d) * 100 : null;
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
    <section className="cm-panel entities" id="entities" aria-label="기관 · 담당자 처리결과 비교">
      <div className="panel-top">
        <div>
          <h2>기관 · 담당자 처리결과 비교</h2>
          <span className="subtitle">관측된 처리결과를 비교합니다. 기관·개인의 성과평가가 아닙니다.</span>
        </div>
        <div className="mini-segments" role="group" aria-label="비교 대상">
          <button type="button" className={p.tab === 'agency' ? 'selected' : ''} aria-pressed={p.tab === 'agency'} onClick={() => p.onTab('agency')}>기관</button>
          <button type="button" className={p.tab === 'manager' ? 'selected' : ''} aria-pressed={p.tab === 'manager'} onClick={() => p.onTab('manager')}>담당자</button>
        </div>
      </div>
      <div className="entity-toolbar">
        <input
          type="search" value={server ? server.q : q} placeholder="기관·성명 검색" aria-label="기관·성명 검색"
          onChange={(e) => (server ? server.onSearch(e.target.value) : setQ(e.target.value))}
        />
        <button className="ghost-btn" type="button" aria-pressed={mobileCols} onClick={() => setMobileCols((v) => !v)}>
          열 선택
        </button>
        {mobileCols && (
          <span className="col-picker">모바일에서는 성명·기관·완료 3열 + 가로스크롤로 확인하세요. 전체 성명은 항상 접근 가능합니다.</span>
        )}
      </div>
      {server?.error && (
        <div className="banner error" role="alert">
          <span className="grow">기관·담당자 전체 목록 조회에 실패했습니다: {server.error} 다시 시도해 주세요.</span>
          <button className="ghost-btn" type="button" onClick={server.onRetry}>다시 시도</button>
        </div>
      )}
      <div className="table-scroll">
        <table className="entity-table">
          <caption className="cm-muted" style={{ textAlign: 'left', padding: '0 16px 8px', fontSize: 12 }}>
            {server
              ? `${p.tab === 'agency' ? '처리기관' : '담당자 · 소속기관'} 전체 ${fmtInt(server.total)}건 · ${server.page}/${pages}페이지 · ${COLUMNS.find((c) => c.key === activeSort)!.label} ${activeDir === 'desc' ? '내림' : '오름'}차순 · 서버 검색·정렬`
              : `${p.tab === 'agency' ? '처리기관' : '담당자 · 소속기관'} · ${COLUMNS.find((c) => c.key === activeSort)!.label} ${activeDir === 'desc' ? '내림' : '오름'}차순${activeSort === 'completed' && activeDir === 'desc' ? ' 기본' : ''} · 표본 1건 포함 · 같은 기관·이름 묶음의 한계가 있습니다.`}
          </caption>
          <thead>
            <tr>
              <th scope="col">{p.tab === 'agency' ? '처리기관' : '담당자 · 소속기관'}</th>
              {COLUMNS.map((c) => (
                <th
                  key={c.key} scope="col" className="num sortable"
                  aria-sort={ariaSort(c.key)}
                  onClick={() => toggle(c.key)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(c.key); } }}
                  tabIndex={0}
                  title={`${c.label} 기준 정렬`}
                >
                  {c.label}{activeSort === c.key ? (activeDir === 'desc' ? ' ▼' : ' ▲') : ''}
                </th>
              ))}
              <th scope="col">처리결과 구성</th>
              <th scope="col">결과 확인 표본</th>
            </tr>
          </thead>
          <tbody>
            {server?.loading && shown.length === 0 && (
              <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--muted)', padding: 24 }} role="status">전체 목록을 불러오는 중입니다…</td></tr>
            )}
            {!(server?.loading && shown.length === 0) && shown.length === 0 && (
              <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--muted)', padding: 24 }}>조건에 맞는 기관·담당자가 없습니다. 검색어·필터를 확인해 주세요.</td></tr>
            )}
            {shown.map((e) => {
              const d = e.outcomes.result_known;
              return (
                <tr key={e.key}>
                  <td>
                    <button
                      type="button" className="mini-btn" style={{ textAlign: 'left', maxWidth: 260, whiteSpace: 'normal' }}
                      title="이 조건으로 지도·표·차트 조회"
                      onClick={() => p.onPick(p.tab, e)}
                      disabled={!e.agency_key || (p.tab === 'manager' && !e.manager_key)}
                    >
                      <span className="table-name">{p.tab === 'agency' ? e.agency_name : (e.manager_name ?? '성명 미상')}</span>
                      <small>{p.tab === 'agency' ? '기관별 관측 결과' : e.agency_name}</small>
                    </button>
                  </td>
                  <td className="num">{fmtInt(e.completed_count)}</td>
                  <td className="num">{fmtInt(e.outcomes.accepted)}<small>{fmtPercent(d > 0 ? (e.outcomes.accepted / d) * 100 : null)}</small></td>
                  <td className="num">{fmtInt(e.outcomes.partial)}<small>{fmtPercent(d > 0 ? (e.outcomes.partial / d) * 100 : null)}</small></td>
                  <td className="num">{fmtInt(e.outcomes.rejected)}<small>{fmtPercent(d > 0 ? (e.outcomes.rejected / d) * 100 : null)}</small></td>
                  <td className="num">{fmtPercent(d > 0 ? ((e.outcomes.accepted + e.outcomes.partial) / d) * 100 : null)}</td>
                  <td className="num">{e.fine_count == null ? '—' : fmtInt(e.fine_count)}</td>
                  <td>
                    <div className="stack mini-stack" aria-hidden="true">
                      <i style={{ width: `${d > 0 ? (e.outcomes.accepted / d) * 100 : 0}%`, background: 'var(--accepted)' }} />
                      <i style={{ width: `${d > 0 ? (e.outcomes.partial / d) * 100 : 0}%`, background: 'var(--partial)' }} />
                      <i style={{ width: `${d > 0 ? (e.outcomes.rejected / d) * 100 : 0}%`, background: 'var(--rejected)' }} />
                    </div>
                  </td>
                  <td>{d === 1 ? <span className="sample-one">표본 1건</span> : `${fmtInt(d)}건`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="table-footer">
        <span>전체 성명과 기관을 함께 표시합니다. 동명이인은 이름만으로 합치지 않습니다.</span>
        {server
          ? <span>전체 {fmtInt(server.total)}건을 서버에서 검색·정렬·페이지로 조회합니다.{server.loading ? ' 불러오는 중…' : ''}</span>
          : <span>1건 표본도 공개 · 별·메달·우수 판정 없음</span>}
      </div>
      {server && (
        <div className="table-pager" style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end', padding: '8px 16px' }}>
          <span className="cm-muted" style={{ fontSize: 12 }} aria-live="polite">{server.page} / {pages}페이지 · 전체 {fmtInt(server.total)}건</span>
          <button className="ghost-btn" type="button" disabled={server.page <= 1 || server.loading} onClick={() => server.onPage(server.page - 1)} aria-label="이전 페이지">이전</button>
          <button className="ghost-btn" type="button" disabled={server.page >= pages || server.loading} onClick={() => server.onPage(server.page + 1)} aria-label="다음 페이지">다음</button>
        </div>
      )}
    </section>
  );
}
