import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { DashboardData, PublicEntity, PublicRegion, Scope } from '../domain/public';
import { SIDO_LIST, regionLabel, sggName, sidoOf } from '../data/regions';
import { loadEntities } from '../data/client';
import { useReportActivity } from '../data/queryActivity';
import { acceptRate, fmtDate, fmtInt, fmtPercent } from './format';
import { duplicateNames, entityLabel } from './entityMetrics';
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
  /** managers loaded so far (for the chart); called with the loaded list */
  onRows?: (rows: PublicEntity[], total: number) => void;
}) {
  const [shown, setShown] = useState(PREVIEW);
  const [input, setInput] = useState('');
  const [q, setQ] = useState('');
  const [pages, setPages] = useState(0); // extra server pages beyond the dashboard's first page (search: from page 1)
  const [server, setServer] = useState<{ key: string; items: PublicEntity[]; total: number } | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const composing = useRef(false);
  const scopeKey = `${JSON.stringify(scope)}|${version}`;
  useEffect(() => { setShown(PREVIEW); setPages(0); setServer(null); setInput(''); setQ(''); }, [scopeKey]);
  useEffect(() => {
    if (composing.current) return;
    const t = window.setTimeout(() => { if (input.trim() !== q) { setQ(input.trim()); setPages(0); setServer(null); } }, 300);
    return () => window.clearTimeout(t);
  }, [input, q]);
  const needServer = q !== '' || pages > 0;
  const wantPages = q !== '' ? Math.max(1, pages) : pages + 1;
  const reqKey = `${scopeKey}|${kind}|${q}|${wantPages}`;
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
      setServer({ key: reqKey, ...r });
      setState('idle');
    }).catch(() => { if (!ac.signal.aborted) setState('error'); });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reqKey, needServer]);
  useReportActivity(`scope-${kind}`, state === 'loading'
    ? { resource: 'entities', phase: 'fetching', label: q ? '기관·담당자를 검색하는 중' : '목록을 더 불러오는 중' } : null);

  // while a new page/search loads, the rows already on screen stay (never replaced by "검색 결과 없음")
  const rows = needServer ? (server?.items ?? (q ? [] : first)) : first;
  const all = needServer ? server?.total ?? total : total;
  useEffect(() => { if (kind === 'manager' && !q) onRows?.(rows, all ?? rows.length); }, [rows, all]); // eslint-disable-line react-hooks/exhaustive-deps
  const dup = duplicateNames(rows);
  const noun = kind === 'agency' ? '기관' : '담당자';
  return (
    <>
      <div className="scope-entity-tools">
        <input type="search" value={input} placeholder={`${noun} 이름 검색 (전체에서)`} aria-label={`${noun} 이름 검색`}
          onChange={(e) => setInput(e.target.value)}
          onCompositionStart={() => { composing.current = true; }}
          onCompositionEnd={(e) => { composing.current = false; setInput((e.target as HTMLInputElement).value); }} />
        <PanelStatus busy={state === 'loading'} label={q ? '검색 중' : '불러오는 중'} />
      </div>
      {state === 'error' && <p className="place-empty" role="alert">{noun} 목록을 불러오지 못했습니다. 화면의 목록은 이전 결과입니다.</p>}
      {rows.length === 0 && state !== 'loading' && (
        <p className="cm-muted place-empty">{q ? `‘${q}’에 맞는 ${noun}가 없습니다.` : `이 범위의 답변 완료 신고에 ${noun} 정보가 없습니다.`}</p>
      )}
      <ul className="place-entities">
        {rows.slice(0, shown).map((e) => (
          <EntityMetricRow key={e.key} kind={kind} e={e} label={entityLabel(e, kind, dup.has(e.manager_name ?? '이름 없음'))}
            active={kind === 'agency' ? activeAgency === e.agency_key && !activeManager : activeManager === e.manager_key && activeAgency === e.agency_key}
            onPick={onPick} />
        ))}
      </ul>
      <div className="place-more">
        <span className="cm-muted">표시 {fmtInt(Math.min(shown, rows.length))} / {all === undefined ? `많은 순 ${fmtInt(rows.length)}개(전체 수 서버 미지원)` : `전체 ${fmtInt(all)}`}</span>
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
  activeAgency, activeManager, conditions, onManagers, summary }: {
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
  onManagers?: (rows: PublicEntity[], total: number) => void;
  /** the dashboard's KPI summary (deltas, 내 신고 비교) — shown instead of repeating the same boxes */
  summary?: ReactNode;
}) {
  const trail = regionTrail(scope.region_code);
  const name = trail[trail.length - 1].label;
  const o = data.overview.outcomes;
  const known = o?.result_known ?? 0;
  const C = data.overview.completed_count.value;
  const F = data.overview.fine_count.value;
  const W = data.overview.warning_count;
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
          <p className="subtitle">{fmtDate(scope.start)} — {fmtDate(scope.end)}{conditions ? ` · ${conditions}` : ''}</p>
          <PanelStatus busy={busy} label="새 조건으로 갱신 중 · 아래 숫자는 이전 조건" />
        </div>
        <div className="place-actions">
          <button className="mini-btn primary-mini" type="button" onClick={onMakeStatistics}>이 조건으로 통계 만들기</button>
        </div>
      </header>
      {scope.bbox && (
        <p className="scope-note" role="note">{autoRefresh ? '지도에 보이는 범위(자동 갱신)에 든 신고만 셉니다. 지역 전체 수치가 아닙니다.'
          : '마지막으로 적용한 지도 범위의 신고만 셉니다. 지도만 움직여서는 바뀌지 않습니다.'}</p>
      )}

      {summary ? (
        <>
          {summary}
      <section className="scope-boxes compact" aria-label="처분 요약">
        <div className="pe-box"><span className="pe-label">과태료</span><b className="pe-num cm-number">{fmtInt(F)}건 <i aria-hidden="true">|</i> {fmtPercent(pct(F, C))}</b><small>÷ 답변 {fmtInt(C)}건</small></div>
        <div className="pe-box"><span className="pe-label">계도</span>
          <b className="pe-num cm-number">{W === undefined ? '—' : `${fmtInt(W)}건`}{W != null ? <> <i aria-hidden="true">|</i> {fmtPercent(pct(W, C))}</> : null}</b>
          <small>{W === undefined ? '서버 미지원' : '경고·계도 처분 ÷ 답변'}</small></div>
      </section>
        </>
      ) : (
        <>
      <section className="scope-boxes" aria-label="요약">
        <div className="pe-box"><span className="pe-label">신고</span><b className="pe-num cm-number">{fmtInt(data.overview.report_count.value)}건</b><small>신고한 날</small></div>
        <div className="pe-box"><span className="pe-label">답변</span><b className="pe-num cm-number">{fmtInt(C)}건</b><small>답변 받은 날</small></div>
        <div className="pe-box"><span className="pe-label">수용률</span><b className="pe-num cm-number">{fmtPercent(acceptRate(o))}</b><small>{fmtInt(o?.accepted ?? null)}/{fmtInt(known)}건</small></div>
        <div className="pe-box"><span className="pe-label">일부수용률</span><b className="pe-num cm-number">{fmtPercent(pct(o?.partial, known))}</b><small>{fmtInt(o?.partial ?? null)}/{fmtInt(known)}건</small></div>
        <div className="pe-box"><span className="pe-label">불수용률</span><b className="pe-num cm-number">{fmtPercent(pct(o?.rejected, known))}</b><small>{fmtInt(o?.rejected ?? null)}/{fmtInt(known)}건</small></div>
        <div className="pe-box"><span className="pe-label">과태료</span><b className="pe-num cm-number">{fmtInt(F)}건 <i aria-hidden="true">|</i> {fmtPercent(pct(F, C))}</b><small>÷ 답변 {fmtInt(C)}건</small></div>
        <div className="pe-box"><span className="pe-label">계도</span>
          <b className="pe-num cm-number">{W === undefined ? '—' : `${fmtInt(W)}건`}{W != null ? <> <i aria-hidden="true">|</i> {fmtPercent(pct(W, C))}</> : null}</b>
          <small>{W === undefined ? '서버 미지원' : '경고·계도 처분 ÷ 답변'}</small></div>
      </section>

      <section className="place-section" aria-label="처리 결과">
        <h3>처리 결과 <small>답변 {fmtInt(C)}건 중 결과가 나온 {fmtInt(known)}건</small></h3>
        {known > 0 ? (
          <>
            <div className="stack" role="img" aria-label={bars.map((r) => `${r.label} ${r.v}건`).join(', ')}>
              {bars.map((r) => <i key={r.label} style={{ width: `${(r.v / known) * 100}%`, background: r.color }} />)}
            </div>
            <div className="place-dist">
              {bars.map((r) => <span key={r.label}><i className="dot" style={{ background: r.color }} />{r.label} <b className="cm-number">{fmtInt(r.v)}</b> <small>{fmtPercent(pct(r.v, known))}</small></span>)}
              <span><i className="dot" style={{ background: 'var(--unknown)' }} />결과 미상 <b className="cm-number">{fmtInt(o?.result_unknown ?? 0)}</b> <small>비율에서 제외</small></span>
            </div>
          </>
        ) : <p className="cm-muted place-empty">이 범위에는 결과가 나온 답변이 아직 없습니다.</p>}
      </section>

        </>
      )}
      {children.length > 0 && (
        <section className="place-section" aria-label={scope.region_code ? '시군구별' : '시도별'}>
          <h3>{scope.region_code ? '시군구별' : '시도별'} <small>누르면 그 지역 상세로 이동 · 신고 위치 기준</small></h3>
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
        <h3>처리 기관 <small>{data.agency_total !== undefined ? `${fmtInt(data.agency_total)}곳` : ''} · 이 범위 신고만</small></h3>
        <ScopeEntities kind="agency" first={data.agencies} total={data.agency_total} scope={scope} version={version} onPick={onPickEntity}
          activeAgency={activeAgency} activeManager={activeManager} />
      </section>
      <section className="place-section" aria-label="담당자">
        <h3>담당자 <small>{data.manager_total !== undefined ? `${fmtInt(data.manager_total)}명` : ''} · 소속 기관과 함께</small></h3>
        <ScopeEntities kind="manager" first={data.managers} total={data.manager_total} scope={scope} version={version} onPick={onPickEntity}
          activeAgency={activeAgency} activeManager={activeManager} onRows={onManagers} />
      </section>
      <p className="place-note">지역은 신고 위치의 행정구역 기준입니다(처리 기관 소재지가 아님). 신고는 신고한 날, 처리 결과·계도·과태료는 답변 받은 날 기준입니다.</p>
    </aside>
  );
}
