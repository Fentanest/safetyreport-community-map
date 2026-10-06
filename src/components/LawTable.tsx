import { useEffect, useState } from 'react';
import { DATE_BASIS_LABEL, type PublicLaw, type Scope } from '../domain/public';
import { lawLabel, lawValue } from '../state/filters';
import { loadLaws } from '../data/client';
import { useReportActivity } from '../data/queryActivity';
import { DEFAULT_SORT, sortLabel, type SortSpec } from '../domain/tableSort';
import SortHeader from './SortHeader';
import { fmtFineAmount, fmtInt, fmtPercent, fmtWon, fmtRating } from './format';

interface Props {
  /** null = the source did not provide law rows (shown as not ready, never as an empty list) */
  laws: PublicLaw[] | null;
  /** current law filter (exact text, '__none__' or null) */
  activeLaw: string | null;
  /** explicit scope change: a law value, or null to show every law again */
  onPickLaw: (law: string | null) => void;
  /** U03: DISPLAYED scope + version; a sort/search reads the full law list from the server (then pages) */
  scope?: Scope | null;
  version?: string | null;
  serverList?: boolean;
}

const PAGE_SIZE = 20;
const isDefault = (s: SortSpec) => s.column === DEFAULT_SORT.column && s.value === DEFAULT_SORT.value && s.dir === DEFAULT_SORT.dir;

/** 위반법규별 현황 (docs/metrics-catalog.md law_results). The scope's single-date cohort, same scope and denominators as the
 *  rest of the dashboard. Rows come from the server in order (answers desc, then law; 법규 미상 last on ties). */
const SUMMARY_ROWS = 8;

export default function LawTable(p: Props) {
  // summary density by default (4 key columns, 8 rows); 전체 보기 shows every row and column full width
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState<{ q: string; sort: SortSpec; page: number }>({ q: '', sort: DEFAULT_SORT, page: 1 });
  const [input, setInput] = useState('');
  const [composing, setComposing] = useState(false);
  const [list, setList] = useState<{ key: string; items: PublicLaw[]; total: number; version: string } | null>(null);
  const [request, setRequest] = useState<{ key: string; state: 'idle' | 'loading' | 'error' } | null>(null);
  const [reload, setReload] = useState(0);
  const scopeKey = p.scope ? `${JSON.stringify(p.scope)}|${p.version}` : '';
  // a new displayed scope starts again from page 1 (the sort choice stays)
  const [queryScope, setQueryScope] = useState(JSON.stringify(p.scope));
  if (queryScope !== JSON.stringify(p.scope)) { setQueryScope(JSON.stringify(p.scope)); setQuery((q) => ({ ...q, page: 1 })); }
  useEffect(() => {
    if (composing) return;
    const t = window.setTimeout(() => { if (input.trim() !== query.q) setQuery((q) => ({ ...q, q: input.trim(), page: 1 })); }, 300);
    return () => window.clearTimeout(t);
  }, [input, composing]); // eslint-disable-line react-hooks/exhaustive-deps
  const server = !!p.serverList && !!p.scope && !!p.version && (expanded || query.q !== '' || !isDefault(query.sort) || query.page > 1);
  const reqKey = `${scopeKey}|${JSON.stringify(query)}|${expanded}|${reload}`;
  const currentList = list?.key === reqKey && list.version === p.version ? list : null;
  const state = server ? (request?.key === reqKey ? request.state : 'loading') : 'idle';
  useEffect(() => {
    if (!server || !p.scope || !p.version) { setRequest(null); return; }
    const ac = new AbortController();
    setList(null);
    setRequest({ key: reqKey, state: 'loading' });
    loadLaws(p.scope, { q: query.q, sort: query.sort, page: query.page, pageSize: expanded ? PAGE_SIZE : SUMMARY_ROWS }, p.version, ac.signal)
      .then((r) => { if (!ac.signal.aborted) { setList({ key: reqKey, items: r.items, total: r.totalRows, version: r.datasetVersion }); setRequest({ key: reqKey, state: 'idle' }); } })
      .catch((e: unknown) => { if (!ac.signal.aborted && !(e instanceof Error && e.name === 'AbortError')) setRequest({ key: reqKey, state: 'error' }); });
    return () => ac.abort();
  }, [reqKey, server]); // eslint-disable-line react-hooks/exhaustive-deps
  useReportActivity('laws', state === 'loading' ? { resource: 'entities', phase: 'fetching', label: '위반법규 목록을 불러오는 중' } : null);
  const all = p.laws ?? [];
  const rows = server ? (currentList?.items ?? []) : expanded ? all : all.slice(0, SUMMARY_ROWS);
  const total = server ? currentList?.total ?? 0 : all.length;
  const pageSize = expanded ? PAGE_SIZE : SUMMARY_ROWS;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const full = expanded;
  const sortBy = (sort: SortSpec) => setQuery((q) => ({ ...q, sort, page: 1 }));
  const sortable = !!p.serverList && !!p.scope;
  const basis = p.scope ? DATE_BASIS_LABEL[p.scope.date_basis] : '';
  return (
    <section className={`cm-panel laws${expanded ? ' expanded' : ''}`} id="laws" aria-label="위반법규별 현황">
      <div className="panel-top">
        <div>
          <h2>위반법규별 현황</h2>
          <span className="subtitle">법규를 누르면 그 법규만 봅니다</span>
        </div>
        {all.length > 0 && (
          <button className="ghost-btn" type="button" aria-expanded={expanded} onClick={() => { setExpanded((v) => !v); setQuery((q) => ({ ...q, page: 1 })); }}>
            {expanded ? '요약으로 보기' : '전체 보기'}
          </button>
        )}
      </div>
      {sortable && (
        <div className="entity-toolbar" role="toolbar" aria-label="위반법규 표 도구">
          <input type="search" value={input} placeholder="위반법규 검색" aria-label="위반법규 검색"
            onChange={(e) => setInput(e.target.value)}
            onCompositionStart={() => { setComposing(true); }}
            onCompositionEnd={(e) => { setComposing(false); setInput((e.target as HTMLInputElement).value); }} />
          <span className="cm-muted sort-now" aria-live="polite">정렬 {sortLabel(query.sort)}</span>
        </div>
      )}
      {state === 'error' && <div className="banner error" role="alert"><span className="grow">위반법규 목록을 불러오지 못했습니다.</span><button className="ghost-btn" type="button" onClick={() => setReload((n) => n + 1)}>다시 시도</button></div>}
      {p.laws === null ? (
        <p className="empty-state">위반법규별 통계는 아직 준비되지 않았습니다.</p>
      ) : state === 'error' ? null : rows.length === 0 ? (
        <p className="empty-state">{state === 'loading' ? '불러오는 중입니다…' : query.q ? `‘${query.q}’에 맞는 위반법규가 없습니다.` : '지금 조건에 맞는 답변이 없습니다.'}</p>
      ) : (
        <div className="table-scroll">
          <table className="entity-table law-table">
            <caption className="cm-muted" style={{ textAlign: 'left', padding: '0 16px 8px', fontSize: 12 }}>
              위반법규 {fmtInt(total)}개 · 정렬 {sortLabel(query.sort)}{basis ? ` · ${basis} 기준` : ''}{total > rows.length ? ` · ${fmtInt(rows.length)}개 표시` : ''}
            </caption>
            <thead>
              <tr>
                <th scope="col">위반법규</th>
                <SortHeader column="completed" current={query.sort} onSort={sortBy} enabled={sortable} className="num" label="답변 완료" />
                <SortHeader column="accepted" current={query.sort} onSort={sortBy} enabled={sortable} className="num" label="수용" title="건수와 수용률(÷ (수용+일부수용+불수용))" />
                <SortHeader column="fine" current={query.sort} onSort={sortBy} enabled={sortable} className="num" label="과태료" title="건수와 부과율(÷ 답변)" />
                {full && <SortHeader column="amount" current={query.sort} onSort={sortBy} enabled={sortable} className="num" label="답변에 적힌 과태료 금액" title="답변에 적힌 과태료 금액 합계" />}
                {full && <SortHeader column="penalty" current={query.sort} onSort={sortBy} enabled={sortable} className="num" label="범칙금" />}
                <SortHeader column="warning" current={query.sort} onSort={sortBy} enabled={sortable} className="num" label="계도" title="경고·계도 처분 건수와 비율(÷ 답변)" />
                {full && <SortHeader column="rating" current={query.sort} onSort={sortBy} enabled={sortable} className="num" label="평균 별점 · 건수" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const value = lawValue(r.law);
                const active = p.activeLaw === value;
                const name = lawLabel(r.law, false);
                const a = r.fine_amount;
                return (
                  <tr key={value} className={active ? 'active' : undefined}>
                    <td>
                      <button
                        type="button" className="mini-btn law-pick"
                        aria-pressed={active}
                        title={active ? '모든 법규 보기' : `${name}만 보기`}
                        onClick={() => p.onPickLaw(active ? null : value)}
                      >
                        <span className={`table-name${r.law === null ? ' law-unknown' : ''}`}>{name}</span>
                        {active && <small>보는 중</small>}
                      </button>
                    </td>
                    <td className="num">
                      {`${fmtInt(r.completed_count)}건`}
                    </td>
                    <td className="num">
                      {fmtInt(r.outcomes.accepted)}건 · {fmtPercent(r.accept_rate)}
                      <small>일부 {fmtPercent(r.partial_rate)} · 결과 {fmtInt(r.outcomes.result_known)}건</small>
                    </td>
                    <td className="num">
                      {fmtInt(r.fine_count)}건 · {fmtPercent(r.fine_rate)}
                      <small>÷ 답변 {fmtInt(r.completed_count)}건</small>
                    </td>
                    {full && (
                      <td className="num">
                        {fmtFineAmount(a)}
                        {a.confirmed_count > 0 && (
                          <small>평균 {fmtWon(a.mean_won)} · {fmtInt(a.fine_count)}건 중 {fmtInt(a.confirmed_count)}건{a.confirmed_count < a.fine_count ? '만 합산' : ''}</small>
                        )}
                      </td>
                    )}
                    {full && <td className="num">{fmtInt(r.penalty_count)}</td>}
                    <td className="num">{fmtInt(r.warning_count)}<small>{fmtPercent(r.completed_count ? (r.warning_count / r.completed_count) * 100 : null)}</small></td>
                    {full && <td className="num">{fmtRating(r.rating)}<small>{r.rating ? `${fmtInt(r.rating.count)}건` : ''}</small></td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {server && pages > 1 && (
        <div className="table-footer">
          <span className="table-pager">
            <span className="cm-muted" aria-live="polite">{query.page} / {pages}쪽{state === 'loading' ? ' · 불러오는 중…' : ''}</span>
            <button className="ghost-btn" type="button" disabled={query.page <= 1 || state === 'loading'} onClick={() => setQuery((q) => ({ ...q, page: q.page - 1 }))} aria-label="이전 페이지">이전</button>
            <button className="ghost-btn" type="button" disabled={query.page >= pages || state === 'loading'} onClick={() => setQuery((q) => ({ ...q, page: q.page + 1 }))} aria-label="다음 페이지">다음</button>
          </span>
        </div>
      )}
      <div className="table-footer">
        <span>법규 미상: 답변에서 위반법규를 찾지 못한 신고</span>
      </div>
    </section>
  );
}
