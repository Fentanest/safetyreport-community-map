import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useReportActivity } from '../data/queryActivity';
import type { PublicEntity, Scope } from '../domain/public';
import type { CompareEntityRow } from '../domain/personal';
import { loadEntities, type AgencyTypeFilter, type EntitySortKey, type SortDir } from '../data/client';
import type { EntityTab } from '../state/filters';
import { acceptRate, fmtDays, fmtInt, fmtPercent, fmtPp, fmtWon, fmtRating } from './format';

interface Props {
  /** scope + version of the DISPLAYED dashboard (the list never mixes another scope) */
  scope: Scope;
  version: string;
  /** dashboard summary rows (top 100, answers desc) — used for the default summary without an extra request */
  agencies: PublicEntity[];
  managers: PublicEntity[];
  tab: EntityTab;
  onTab: (t: EntityTab) => void;
  onPick: (kind: EntityTab, entity: PublicEntity) => void;
  /** personal rows keyed like the public rows when comparison is on */
  mine?: Map<string, CompareEntityRow> | null;
  /** full-list browsing through /entities is available (live API or demo engine) */
  serverList: boolean;
  /** currently selected agency/manager keys (row highlight) */
  activeAgency: string | null;
  activeManager: string | null;
}

interface Ctx { mine: Map<string, CompareEntityRow> | null }
interface Col {
  id: string;
  label: string;
  title?: string;
  sort?: EntitySortKey;
  num: boolean;
  defaultOn: boolean;
  mineOnly?: boolean;
  cell: (e: PublicEntity, ctx: Ctx) => ReactNode;
}

const share = (a: number, d: number) => fmtPercent(d > 0 ? (a / d) * 100 : null);

/** Single source of truth for header, cells, colSpan, sorting and the column picker (R09). */
export const ENTITY_COLUMNS: Col[] = [
  // R6: every count is rendered the same way (unit in the header); a value of 1 gets no special badge
  { id: 'completed', label: '답변(건)', sort: 'completed', num: true, defaultOn: true,
    cell: (e) => fmtInt(e.completed_count) },
  { id: 'acceptRate', label: '수용률', sort: 'acceptRate', num: true, defaultOn: true, title: '수용 ÷ 결과가 나온 신고',
    cell: (e) => fmtPercent(acceptRate(e.outcomes)) },
  { id: 'rejectRate', label: '불수용률', num: true, defaultOn: true, title: '불수용 ÷ 결과가 나온 신고',
    cell: (e) => share(e.outcomes.rejected, e.outcomes.result_known) },
  { id: 'fine', label: '과태료', sort: 'fine', num: true, defaultOn: true,
    cell: (e) => <>{e.fine_count == null ? '—' : fmtInt(e.fine_count)}<small>{share(e.fine_count ?? 0, e.completed_count)}</small></> },
  { id: 'duration', label: '답변까지', num: true, defaultOn: true, title: '신고한 날부터 답변 받은 날까지, 중앙값',
    cell: (e) => (e.duration && e.duration.count > 0 ? fmtDays(e.duration.median_days) : '—') },
  { id: 'accepted', label: '수용', sort: 'accepted', num: true, defaultOn: false,
    cell: (e) => <>{fmtInt(e.outcomes.accepted)}<small>{share(e.outcomes.accepted, e.outcomes.result_known)}</small></> },
  { id: 'partial', label: '일부 수용', sort: 'partial', num: true, defaultOn: false,
    cell: (e) => <>{fmtInt(e.outcomes.partial)}<small>{share(e.outcomes.partial, e.outcomes.result_known)}</small></> },
  { id: 'rejected', label: '불수용', sort: 'rejected', num: true, defaultOn: false,
    cell: (e) => <>{fmtInt(e.outcomes.rejected)}<small>{share(e.outcomes.rejected, e.outcomes.result_known)}</small></> },
  { id: 'known', label: '결과 확인', num: true, defaultOn: false, title: '결과가 나온 신고(비율을 계산하는 기준)',
    cell: (e) => fmtInt(e.outcomes.result_known) },
  { id: 'warning', label: '계도', num: true, defaultOn: false, title: '경고·계도 처분으로 확인된 신고',
    cell: (e) => (e.warning_count == null ? '—' : fmtInt(e.warning_count)) },
  { id: 'amount', label: '과태료 금액', num: true, defaultOn: false, title: '답변에 적힌 과태료 금액 합계(확인된 것만)',
    cell: (e) => (e.fine_amount && e.fine_amount.confirmed_count > 0 ? fmtWon(e.fine_amount.sum_won) : '—') },
  { id: 'rating', label: '평균 별점', num: true, defaultOn: false, title: '공개에 동의한 숫자 별점만',
    cell: (e) => fmtRating(e.rating) },
  { id: 'bar', label: '결과 비율', num: false, defaultOn: false,
    cell: (e) => {
      const d = e.outcomes.result_known;
      return (
        <div className="stack mini-stack" aria-hidden="true">
          <i style={{ width: `${d > 0 ? (e.outcomes.accepted / d) * 100 : 0}%`, background: 'var(--accepted)' }} />
          <i style={{ width: `${d > 0 ? (e.outcomes.partial / d) * 100 : 0}%`, background: 'var(--partial)' }} />
          <i style={{ width: `${d > 0 ? (e.outcomes.rejected / d) * 100 : 0}%`, background: 'var(--rejected)' }} />
        </div>
      );
    } },
  { id: 'mineCompleted', label: '내 답변', num: true, defaultOn: true, mineOnly: true,
    cell: (e, ctx) => fmtInt(ctx.mine?.get(e.key)?.mine.completed_count ?? 0) },
  { id: 'mineAccept', label: '내 수용률', num: true, defaultOn: true, mineOnly: true,
    cell: (e, ctx) => <>{fmtPercent(ctx.mine?.get(e.key)?.mine.accept_rate ?? null)}<small>{fmtPp(ctx.mine?.get(e.key)?.accept_rate_pp ?? null)}</small></> },
  { id: 'minePartial', label: '내 일부수용률', num: true, defaultOn: false, mineOnly: true,
    cell: (e, ctx) => <>{fmtPercent(ctx.mine?.get(e.key)?.mine.partial_rate ?? null)}<small>{fmtPp(ctx.mine?.get(e.key)?.partial_rate_pp ?? null)}</small></> },
];

const SUMMARY_ROWS = 8;
const PAGE_SIZE = 20;
const COLS_KEY = 'cm-entity-columns';
function readCols(): Set<string> {
  try {
    const raw = JSON.parse(window.localStorage.getItem(COLS_KEY) ?? 'null');
    if (Array.isArray(raw)) return new Set(raw.filter((x): x is string => typeof x === 'string'));
  } catch { /* ignore */ }
  return new Set(ENTITY_COLUMNS.filter((c) => c.defaultOn).map((c) => c.id));
}

interface Query { q: string; sort: EntitySortKey; dir: SortDir; type: AgencyTypeFilter; page: number }
const DEFAULT_QUERY: Query = { q: '', sort: 'completed', dir: 'desc', type: 'all', page: 1 };

export default function EntityTable(p: Props) {
  const [expanded, setExpanded] = useState(false);
  const [cols, setCols] = useState<Set<string>>(readCols);
  const [picker, setPicker] = useState(false);
  const [input, setInput] = useState('');
  const composing = useRef(false);
  const [query, setQuery] = useState<Query>(DEFAULT_QUERY);
  const [list, setList] = useState<{ items: PublicEntity[]; total: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const pickerRef = useRef<HTMLDivElement>(null);

  // any change of kind/search/sort/type resets the page in the SAME update (one request, R09)
  const update = (patch: Partial<Query>) => setQuery((q) => ({ ...q, ...patch, page: patch.page ?? 1 }));
  // search input shows at once; the request waits for typing to pause and never runs during IME composition
  useEffect(() => {
    if (composing.current) return;
    const t = window.setTimeout(() => { if (input.trim() !== query.q) update({ q: input.trim() }); }, 300);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input]);

  const custom = query.q !== '' || query.sort !== 'completed' || query.dir !== 'desc' || query.type !== 'all' || query.page !== 1;
  const needServer = p.serverList && (custom || expanded);
  const pageSize = expanded ? PAGE_SIZE : SUMMARY_ROWS;
  const scopeKey = JSON.stringify(p.scope);
  useEffect(() => {
    if (!needServer) { setList(null); setError(null); setLoading(false); return; }
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    loadEntities(p.scope, { kind: p.tab, q: query.q, sort: query.sort, dir: query.dir, agencyType: query.type, page: query.page, pageSize },
      p.version, ac.signal)
      .then((r) => { if (!ac.signal.aborted) { setList({ items: r.items, total: r.totalRows }); setLoading(false); } })
      .catch((e: unknown) => {
        if (ac.signal.aborted) return;
        // a local table error — the map and charts stay as they are, and it is never shown as "no results"
        setError(e instanceof Error ? e.message : '목록을 불러오지 못했습니다.');
        setLoading(false);
      });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needServer, scopeKey, p.version, p.tab, query, pageSize, reload]);

  useEffect(() => {
    if (!picker) return;
    const onDown = (e: MouseEvent) => { if (!pickerRef.current?.contains(e.target as Node)) setPicker(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setPicker(false); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey, true); };
  }, [picker]);

  // S10: the list request is local to this table (the map and the other cards keep their state)
  useReportActivity('entities', loading ? { resource: 'entities', phase: 'fetching', label: '기관·담당자 목록을 불러오는 중' } : null);
  const summaryRows = p.tab === 'agency' ? p.agencies : p.managers;
  const rows = needServer ? (list?.items ?? []) : summaryRows.slice(0, pageSize);
  const total = needServer ? (list?.total ?? 0) : summaryRows.length;
  const visibleCols = useMemo(() => ENTITY_COLUMNS.filter((c) => cols.has(c.id) && (!c.mineOnly || !!p.mine)), [cols, p.mine]);
  const colSpan = visibleCols.length + 1;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const toggleCol = (id: string) => setCols((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    try { window.localStorage.setItem(COLS_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
    return next;
  });
  const sortBy = (key: EntitySortKey) => update(query.sort === key ? { dir: query.dir === 'desc' ? 'asc' : 'desc' } : { sort: key, dir: 'desc' });
  const ariaSort = (c: Col): 'ascending' | 'descending' | 'none' | undefined =>
    !c.sort ? undefined : c.sort !== query.sort ? 'none' : query.dir === 'asc' ? 'ascending' : 'descending';
  const unit = p.tab === 'agency' ? '곳' : '명';
  const sortLabel = ENTITY_COLUMNS.find((c) => c.sort === query.sort)?.label ?? '답변';

  return (
    <section className={`cm-panel entities${expanded ? ' expanded' : ''}`} id="entities" aria-label="기관·담당자별 처리 결과">
      <div className="panel-top">
        <div>
          <h2>기관·담당자 처리 결과</h2>
          <span className="subtitle">공유된 신고의 처리 결과입니다. 기관이나 담당자를 평가하는 표가 아닙니다.</span>
        </div>
        {p.serverList && (
          <button className="ghost-btn" type="button" aria-expanded={expanded} onClick={() => { setExpanded((v) => !v); setQuery((q) => ({ ...q, page: 1 })); }}>
            {expanded ? '요약으로 보기' : '전체 보기'}
          </button>
        )}
      </div>
      <div className="entity-toolbar" role="toolbar" aria-label="기관·담당자 표 도구">
        <input type="search" value={input} placeholder="기관·담당자 이름 검색" aria-label="기관·담당자 이름 검색"
          onChange={(e) => setInput(e.target.value)}
          onCompositionStart={() => { composing.current = true; }}
          onCompositionEnd={(e) => { composing.current = false; setInput((e.target as HTMLInputElement).value); }} />
        <div className="col-picker-wrap" ref={pickerRef}>
          <button className="ghost-btn" type="button" aria-haspopup="true" aria-expanded={picker} aria-controls="entity-col-menu" onClick={() => setPicker((v) => !v)}>
            열 선택
          </button>
          {picker && (
            <div className="col-menu" id="entity-col-menu" role="group" aria-label="표에 보일 열">
              {ENTITY_COLUMNS.filter((c) => !c.mineOnly || p.mine).map((c) => (
                <label key={c.id}><input type="checkbox" checked={cols.has(c.id)} onChange={() => toggleCol(c.id)} />{c.label}</label>
              ))}
              <button className="mini-btn" type="button" onClick={() => {
                const d = new Set(ENTITY_COLUMNS.filter((c) => c.defaultOn).map((c) => c.id));
                setCols(d);
                try { window.localStorage.removeItem(COLS_KEY); } catch { /* ignore */ }
              }}>기본 열로</button>
            </div>
          )}
        </div>
        <div className="mini-segments kind-switch" role="group" aria-label="목록 종류">
          <button type="button" className={p.tab === 'agency' ? 'selected' : ''} aria-pressed={p.tab === 'agency'} onClick={() => { p.onTab('agency'); update({}); }}>기관</button>
          <button type="button" className={p.tab === 'manager' ? 'selected' : ''} aria-pressed={p.tab === 'manager'} onClick={() => { p.onTab('manager'); update({}); }}>담당자</button>
        </div>
        {p.serverList && (
          <div className="mini-segments" role="group" aria-label="경찰 구분">
            {([['all', '전체'], ['police', '경찰'], ['non_police', '비경찰']] as Array<[AgencyTypeFilter, string]>).map(([id, text]) => (
              <button key={id} type="button" className={query.type === id ? 'selected' : ''} aria-pressed={query.type === id}
                title={id === 'non_police' ? '확인된 비경찰 기관만 (확인할 수 없는 기관은 제외)' : undefined} onClick={() => update({ type: id })}>{text}</button>
            ))}
          </div>
        )}
      </div>
      {error && (
        <div className="banner error" role="alert">
          <span className="grow">기관·담당자 목록을 불러오지 못했습니다. 지도와 다른 통계는 그대로입니다.</span>
          <button className="ghost-btn" type="button" onClick={() => setReload((n) => n + 1)}>다시 시도</button>
        </div>
      )}
      <div className="table-scroll">
        <table className="entity-table">
          <caption className="cm-muted table-caption">
            {p.tab === 'agency' ? '기관' : '담당자'} {fmtInt(total)}{unit} · {sortLabel} {query.dir === 'desc' ? '많은' : '적은'} 순
            {!needServer && summaryRows.length > rows.length ? ` · ${fmtInt(rows.length)}${unit}만 표시` : ''}
            {query.type !== 'all' ? ` · ${query.type === 'police' ? '경찰' : '비경찰(확인된 기관만)'}` : ''}
          </caption>
          <thead>
            <tr>
              <th scope="col">{p.tab === 'agency' ? '기관' : '담당자 · 소속 기관'}</th>
              {visibleCols.map((c) => (
                <th key={c.id} scope="col" className={`${c.num ? 'num' : ''}${c.sort && p.serverList ? ' sortable' : ''}${c.mineOnly ? ' mine-col' : ''}`}
                  aria-sort={p.serverList ? ariaSort(c) : undefined} title={c.title}
                  tabIndex={c.sort && p.serverList ? 0 : undefined}
                  onClick={c.sort && p.serverList ? () => sortBy(c.sort!) : undefined}
                  onKeyDown={c.sort && p.serverList ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sortBy(c.sort!); } } : undefined}>
                  {c.label}{c.sort && query.sort === c.sort ? (query.dir === 'desc' ? ' ▼' : ' ▲') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 && <tr><td colSpan={colSpan} className="table-empty" role="status">불러오는 중입니다…</td></tr>}
            {!loading && !error && rows.length === 0 && <tr><td colSpan={colSpan} className="table-empty">조건에 맞는 기관·담당자가 없습니다.</td></tr>}
            {rows.map((e) => {
              const active = p.tab === 'agency' ? p.activeAgency === e.agency_key && !p.activeManager
                : p.activeManager === e.manager_key && p.activeAgency === e.agency_key;
              return (
                <tr key={e.key} className={active ? 'active' : undefined}>
                  <td>
                    <button type="button" className="mini-btn table-pick" title="이 기관·담당자만 보기" aria-pressed={active}
                      onClick={() => p.onPick(p.tab, e)} disabled={!e.agency_key || (p.tab === 'manager' && !e.manager_key)}>
                      <span className="table-name">{p.tab === 'agency' ? e.agency_name : (e.manager_name ?? '이름 없음')}</span>
                      {p.tab === 'manager' && <small>{e.agency_name}</small>}
                      {active && <small className="active-tag">적용 중</small>}
                    </button>
                  </td>
                  {visibleCols.map((c) => <td key={c.id} className={`${c.num ? 'num' : ''}${c.mineOnly ? ' mine-col' : ''}`}>{c.cell(e, { mine: p.mine ?? null })}</td>)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="table-footer">
        <span>이름이 같아도 소속 기관이 다르면 따로 보여 드립니다. 순위나 우수 표시는 하지 않습니다.</span>
        {needServer && (
          <span className="table-pager">
            <span className="cm-muted" aria-live="polite">{query.page} / {pages}쪽{loading ? ' · 불러오는 중…' : ''}</span>
            <button className="ghost-btn" type="button" disabled={query.page <= 1 || loading} onClick={() => update({ page: query.page - 1 })} aria-label="이전 페이지">이전</button>
            <button className="ghost-btn" type="button" disabled={query.page >= pages || loading} onClick={() => update({ page: query.page + 1 })} aria-label="다음 페이지">다음</button>
          </span>
        )}
      </div>
    </section>
  );
}
