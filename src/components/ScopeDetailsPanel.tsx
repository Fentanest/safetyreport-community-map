import { useEffect, useState } from 'react';
import { DATE_BASIS_LABEL, type DashboardData, type PublicEntity, type PublicRegion, type Scope } from '../domain/public';
import { SIDO_LIST, regionLabel, sggName, sidoOf } from '../data/regions';
import { loadEntities } from '../data/client';
import { useReportActivity } from '../data/queryActivity';
import { acceptRate, fmtDate, fmtInt, fmtPercent } from './format';
import { entityLabel } from './entityMetrics';
import { sameNameIndex } from '../domain/managerNames';
import EntityMetricRow from './EntityMetricRow';
import PanelStatus from './PanelStatus';

/** breadcrumb of an applied region: 전국 › 시도 › 시군구 (official codes; same-name regions are never merged) */
export function regionTrail(code: string | null): Array<{ code: string | null; label: string }> {
  const trail: Array<{ code: string | null; label: string }> = [{ code: null, label: '전국' }];
  const sido = sidoOf(code);
  if (sido) trail.push({ code: sido, label: SIDO_LIST.find((s) => s.code === sido)?.name ?? regionLabel(sido) });
  if (code && code.length === 5) trail.push({ code, label: sggName(code) });
  return trail;
}

/** the next level to explore: 시도 rows under 전국, 시군구 rows under a 시도, nothing under a 시군구 */
export function childRegions(regions: readonly PublicRegion[] | null, code: string | null): PublicRegion[] {
  if (!regions) return [];
  const rows = !code ? regions.filter((r) => r.level === 'sido')
    : code.length === 2 ? regions.filter((r) => r.level === 'sgg' && r.sido_code === code) : [];
  return [...rows].sort((a, b) => b.report_count - a.report_count || (a.region_code ?? '').localeCompare(b.region_code ?? ''));
}

const PREVIEW = 5;
const PAGE = 100;

/** how the scope chart asks the manager list for its next server page */
export interface ManagerPaging { state: 'idle' | 'loading' | 'error'; pageSize: number; load: () => void }

/** Agencies or managers of the scope: first page from the dashboard; search and "더 보기" read the full server list. */
function ScopeEntities({ kind, first, total, scope, version, onPick, activeAgency, activeManager, onRows }: {
  kind: 'agency' | 'manager';
  first: PublicEntity[];
  total: number | undefined;
  scope: Scope;
  version: string;
  onPick: (kind: 'agency' | 'manager', e: PublicEntity) => void;
  activeAgency: string | null;
  activeManager: string | null;
  /** managers loaded so far (for the chart); called with the loaded list and how the chart asks for more */
  onRows?: (rows: PublicEntity[], total: number, more: ManagerPaging) => void;
}) {
  const [shown, setShown] = useState(PREVIEW);
  const [input, setInput] = useState('');
  const [q, setQ] = useState('');
  const [pages, setPages] = useState(0); // extra server pages beyond the dashboard's first page (search: from page 1)
  const [server, setServer] = useState<{ key: string; items: PublicEntity[]; total: number } | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [retry, setRetry] = useState(0); // the chart's "다시 시도": the same pages again, never one page further
  const [composing, setComposing] = useState(false);
  const scopeKey = `${JSON.stringify(scope)}|${version}`;
  useEffect(() => { setShown(PREVIEW); setPages(0); setServer(null); setInput(''); setQ(''); setRetry(0); }, [scopeKey]);
  useEffect(() => {
    if (composing) return;
    const t = window.setTimeout(() => { if (input.trim() !== q) { setQ(input.trim()); setPages(0); setServer(null); } }, 300);
    return () => window.clearTimeout(t);
  }, [input, q, composing]);
  const needServer = q !== '' || pages > 0;
  const wantPages = q !== '' ? Math.max(1, pages) : pages + 1;
  const cohortKey = `${scopeKey}|${kind}|${q}`;
  const reqKey = `${cohortKey}|${wantPages}|${retry}`;
  useEffect(() => {
    if (!needServer) { setState('idle'); return; }
    const ac = new AbortController();
    setState('loading');
    (async () => {
      const items: PublicEntity[] = [];
      let total = 0;
      for (let page = 1; page <= wantPages; page++) {
        const r = await loadEntities(scope, { kind, q, page, pageSize: PAGE }, version, ac.signal);
        items.push(...r.items);
        total = r.totalRows;
        if (items.length >= total) break;
      }
      return { items, total };
    })().then((r) => {
      if (ac.signal.aborted) return;
      setServer({ key: cohortKey, ...r });
      setState('idle');
    }).catch(() => { if (!ac.signal.aborted) setState('error'); });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reqKey, needServer]);
  useReportActivity(`scope-${kind}`, state === 'loading'
    ? { resource: 'entities', phase: 'fetching', label: q ? '기관·담당자를 검색하는 중' : '목록을 더 불러오는 중' } : null);

  // while a new page/search loads, the rows already on screen stay (never replaced by "검색 결과 없음")
  const currentServer = server?.key === cohortKey ? server : null;
  const rows = needServer ? (currentServer?.items ?? (q ? [] : first)) : first;
  const all = needServer ? currentServer?.total ?? total : total;
  // the chart (PlaceEntityChart) pages through the same server list: one more page per click, a failed page retried as is
  const loadMore = () => { if (state === 'error') setRetry((r) => r + 1); else setPages((p) => p + 1); };
  useEffect(() => {
    if (kind === 'manager' && !q) onRows?.(rows, all ?? rows.length, { state, pageSize: PAGE, load: loadMore });
  }, [rows, all, state]); // eslint-disable-line react-hooks/exhaustive-deps
  const same = sameNameIndex(rows);
  const noun = kind === 'agency' ? '기관' : '담당자';
  return (
    <>
      <div className="scope-entity-tools">
        <input type="search" value={input} placeholder={`${noun} 이름 검색`} aria-label={`${noun} 이름 검색`}
          onChange={(e) => setInput(e.target.value)}
          onCompositionStart={() => { setComposing(true); }}
          onCompositionEnd={(e) => { setComposing(false); setInput((e.target as HTMLInputElement).value); }} />
        <PanelStatus busy={state === 'loading'} label={q ? '검색 중' : '불러오는 중'} />
      </div>
      {state === 'error' && <p className="place-empty" role="alert">{noun} 목록을 불러오지 못했습니다.</p>}
      {rows.length === 0 && state === 'idle' && (
        <p className="cm-muted place-empty">{q ? `‘${q}’에 맞는 ${noun}가 없습니다.` : `이 범위의 답변에 ${noun} 정보가 없습니다.`}</p>
      )}
      <ul className="place-entities">
        {rows.slice(0, shown).map((e) => (
          <EntityMetricRow key={e.key} kind={kind} e={e} label={entityLabel(e, kind, kind === 'manager' ? same.get(e) : null)} same={kind === 'manager' ? same.get(e) : null}
            active={kind === 'agency' ? activeAgency === e.agency_key && !activeManager : activeManager === e.manager_key && activeAgency === e.agency_key}
            onPick={onPick} />
        ))}
      </ul>
      <div className="place-more">
        <span className="cm-muted">표시 {fmtInt(Math.min(shown, rows.length))} / {all === undefined ? `많은 순 ${fmtInt(rows.length)}개 (전체 수는 알 수 없음)` : `전체 ${fmtInt(all)}`}</span>
        {rows.length > shown && <button type="button" className="mini-btn" onClick={() => setShown((n) => n + 10)}>더 보기</button>}
        {rows.length <= shown && all !== undefined && all > rows.length && (
          <button type="button" className="mini-btn" disabled={state === 'loading'} onClick={() => { setPages((n) => n + 1); setShown((n) => n + 10); }}>
            나머지 불러오기
          </button>
        )}
      </div>
    </>
  );
}

/** S01: the right-hand detail of the applied scope when no address is selected (전국 · 시도 · 시군구 · 지도 범위). */
export default function ScopeDetailsPanel({ scope, data, version, autoRefresh, busy, onPickRegion, onPickEntity, onMakeStatistics,
  activeAgency, activeManager, conditions, onManagers }: {
  /** the DISPLAYED scope (the numbers below belong to it) */
  scope: Scope;
  data: DashboardData;
  version: string;
  autoRefresh: boolean;
  /** a newer request is running; these numbers are the previous conditions until it lands */
  busy: boolean;
  onPickRegion: (code: string | null) => void;
  onPickEntity: (kind: 'agency' | 'manager', e: PublicEntity) => void;
  onMakeStatistics: () => void;
  activeAgency: string | null;
  activeManager: string | null;
  /** human text of the applied conditions (period · category · law · agency) */
  conditions: string;
  onManagers?: (rows: PublicEntity[], total: number, more: ManagerPaging) => void;
}) {
  const trail = regionTrail(scope.region_code);
  const name = trail[trail.length - 1].label;
  const o = data.overview.outcomes;
  const known = o?.result_known ?? 0;
  const C = data.overview.completed_count.value;
  const pct = (a: number | null | undefined, d: number | null | undefined) => (a != null && d ? (a / d) * 100 : null);
  const children = childRegions(data.regions, scope.region_code);
  const [childShown, setChildShown] = useState(8);
  const bars = [
    { label: '수용', v: o?.accepted ?? 0, color: 'var(--accepted)' },
    { label: '일부 수용', v: o?.partial ?? 0, color: 'var(--partial)' },
    { label: '불수용', v: o?.rejected ?? 0, color: 'var(--rejected)' },
  ];
  return (
    <aside className="cm-panel place-panel scope-panel" aria-label="선택 범위 상세" aria-busy={busy}>
      <header className="place-head">
        <div>
          <span className="overline">선택 범위</span>
          <nav className="scope-trail" aria-label="지역 경로">
            <ol>
              {trail.map((t, i) => (
                <li key={t.code ?? 'all'}>
                  {i < trail.length - 1
                    ? <button type="button" className="link-btn" onClick={() => onPickRegion(t.code)}>{t.label}</button>
                    : <span aria-current="location">{t.label}</span>}
                </li>
              ))}
            </ol>
          </nav>
          <h2>{name}{scope.bbox ? <small className="scope-bbox"> × {autoRefresh ? '현재 지도 범위' : '마지막으로 적용한 지도 범위'}</small> : null}</h2>
          <p className="subtitle">{DATE_BASIS_LABEL[scope.date_basis]} 기준 · {fmtDate(scope.start)} — {fmtDate(scope.end)}{conditions ? ` · ${conditions}` : ''}</p>
          <PanelStatus busy={busy} label="새 조건으로 바꾸는 중 · 아래 숫자는 이전 조건의 결과" />
        </div>
        <div className="place-actions">
          <button className="mini-btn primary-mini" type="button" onClick={onMakeStatistics}>이 조건으로 통계 만들기</button>
        </div>
      </header>

      <section className="place-section" aria-label="처리 결과">
        <h3>처리 결과 <small>답변 {fmtInt(C)}건</small></h3>
        {known > 0 ? (
          <>
            <div className="stack" role="img" aria-label={bars.map((r) => `${r.label} ${r.v}건`).join(', ')}>
              {bars.map((r) => <i key={r.label} style={{ width: `${(r.v / known) * 100}%`, background: r.color }} />)}
            </div>
            <div className="place-dist">
              {bars.map((r) => <span key={r.label}><i className="dot" style={{ background: r.color }} />{r.label} <b className="cm-number">{fmtInt(r.v)}</b> <small>{fmtPercent(pct(r.v, known))}</small></span>)}
              <span title="안전신문고 처리 상태가 ‘답변완료’·‘기타’라 수용 여부가 없는 답변"><i className="dot" style={{ background: 'var(--unknown)' }} />미분류 <b className="cm-number">{fmtInt(o?.result_unknown ?? 0)}</b></span>
            </div>
          </>
        ) : <p className="cm-muted place-empty">이 범위에는 수용 여부가 분류된 답변이 아직 없습니다.</p>}
      </section>

      {children.length > 0 && (
        <section className="place-section" aria-label={scope.region_code ? '시군구별' : '시도별'}>
          <h3>{scope.region_code ? '시군구별' : '시도별'}</h3>
          <ul className="scope-children">
            {children.slice(0, childShown).map((r) => (
              <li key={r.region_code ?? r.name}>
                <button type="button" className="scope-child" onClick={() => onPickRegion(r.region_code)} disabled={!r.region_code}>
                  <b>{r.name}</b>
                  <span className="cm-number">신고 {fmtInt(r.report_count)}</span>
                  <span className="cm-number">답변 {fmtInt(r.completed_count)}</span>
                  <span className="cm-number">수용률 {fmtPercent(acceptRate(r.outcomes))}</span>
                </button>
              </li>
            ))}
          </ul>
          {children.length > childShown && <button type="button" className="mini-btn" onClick={() => setChildShown((n) => n + 20)}>더 보기 · {fmtInt(children.length - childShown)}</button>}
        </section>
      )}

      <section className="place-section" aria-label="처리 기관">
        <h3>처리 기관 {data.agency_total !== undefined && <small>{fmtInt(data.agency_total)}곳</small>}</h3>
        <ScopeEntities kind="agency" first={data.agencies} total={data.agency_total} scope={scope} version={version} onPick={onPickEntity}
          activeAgency={activeAgency} activeManager={activeManager} />
      </section>
      <section className="place-section" aria-label="담당자">
        <h3>담당자 {data.manager_total !== undefined && <small>{fmtInt(data.manager_total)}명</small>}</h3>
        <ScopeEntities kind="manager" first={data.managers} total={data.manager_total} scope={scope} version={version} onPick={onPickEntity}
          activeAgency={activeAgency} activeManager={activeManager} onRows={onManagers} />
      </section>
    </aside>
  );
}
