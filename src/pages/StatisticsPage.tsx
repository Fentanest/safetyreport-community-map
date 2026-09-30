import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Scope } from '../domain/public';
import type { StatCatalog, StatisticsResult, StatisticsSpec } from '../domain/statistics';
import { loadCatalog, loadStatistics } from '../data/statistics';
import { PublicApiError } from '../data/client';
import { useReportActivity } from '../data/queryActivity';
import {
  CHART_LABEL, DEFAULT_CHART, PRESETS, baseSpec, chartAvailability, filterOf, normalizeRecipe, planChart, readSaved, readSession, saveRecipe, setFilter, writeSession,
  type ChartSettings, type SavedRecipe, type StatsRecipe,
} from '../state/statistics';
import PivotTable, { type RowSort } from '../components/stats/PivotTable';
import PivotChart from '../components/stats/PivotChart';
import ChartTypePicker from '../components/stats/ChartTypePicker';
import ExportButton from '../components/ExportButton';
import SharePanel from '../components/stats/SharePanel';
import { statisticsSnapshot } from '../export/adapters/statistics';
import { cartesianModel, effectiveHidden } from '../state/statsChartModel';
import { checkAgainstCatalog, decodeShare, dropShareParam, recipeFromPayload, type SharePayload } from '../state/share';
import MemberPicker, { PICK_KINDS, type PickedMember } from '../components/stats/MemberPicker';
import PanelStatus from '../components/PanelStatus';
import { fmtDate } from '../components/format';

export interface ScopeChip { id: string; kind: string; label: string; remove: (s: Scope) => Scope }

type Run = { status: 'idle' } | { status: 'loading'; recipe: StatsRecipe } | { status: 'error'; message: string; code: string | null; recipe: StatsRecipe };

const recipeKey = (r: StatsRecipe) => JSON.stringify({ scope: r.scope, spec: r.spec });

/** S04 맞춤 통계 page (a separate screen inside the same shell). Draft edits never query; 통계 만들기 runs once. */
/** D11: each side's own missing-date count (the same report can be on both sides — never added together) */
function missingRows(result: StatisticsResult, basis: StatisticsSpec['date_basis']): Array<{ label: string; value: string }> {
  const word = basis === 'completed_date' ? '답변일' : '신고일';
  const sides = result.excluded.selected_date_missing ?? { all: result.excluded.no_report_date, mine: null };
  const parts = [sides.all ? `전체 ${sides.all.toLocaleString('ko-KR')}건` : '', sides.mine ? `내 신고 ${sides.mine.toLocaleString('ko-KR')}건` : ''].filter(Boolean);
  return parts.length ? [{ label: '제외', value: `${word}이 없어 이 기간에 넣을 수 없는 신고: ${parts.join(', ')} (각각 따로 센 수)` }] : [];
}

export default function StatisticsPage({ active, handoff, fallbackScope, version, viewer, canMine, theme, scopeChips, onBack, shared = null, onSharedDone, onSignIn }: {
  /** the screen is shown (the page stays mounted while hidden so its draft and result survive a round trip) */
  active: boolean;
  /** a hand-off from the dashboard (new id = new hand-off) */
  handoff: { id: number; recipe: StatsRecipe } | null;
  /** the dashboard's displayed conditions, used when the page opens without a hand-off or a saved session */
  fallbackScope: Scope | null;
  version: string | null;
  /** viewer/session identity: another account's conditions and results are never shown */
  viewer: string;
  canMine: boolean;
  theme: 'dark' | 'light';
  scopeChips: (s: Scope) => ScopeChip[];
  onBack: (section?: string) => void;
  /** F02: the raw `sr` parameter of a shared analysis link (validated here, never trusted) */
  shared?: string | null;
  onSharedDone?: () => void;
  onSignIn?: () => void;
}) {
  const [catalog, setCatalog] = useState<StatCatalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  // F02: an opened share link wins over this tab's restored session (the user asked for that analysis)
  const restored = useRef(shared ? null : readSession(viewer));
  const [share, setShare] = useState<{ status: 'none' } | { status: 'pending'; payload: SharePayload | null; error: string | null }
    | { status: 'waiting_login'; payload: SharePayload } | { status: 'applied'; mine: boolean } | { status: 'error'; reason: string }>(() => {
    if (!shared) return { status: 'none' };
    const d = decodeShare(shared);
    return d.ok ? { status: 'pending', payload: d.payload, error: null } : { status: 'error', reason: d.reason };
  });
  const [draft, setDraftRaw] = useState<StatsRecipe | null>(() => (restored.current?.draft ? normalizeRecipe(restored.current.draft) : null));
  // one date basis per recipe: every draft change keeps scope.date_basis = spec.date_basis (EX-08 never reaches the server)
  const setDraft = useCallback((next: StatsRecipe | null | ((d: StatsRecipe | null) => StatsRecipe | null)) =>
    setDraftRaw((prev) => { const r = typeof next === 'function' ? next(prev) : next; return r ? normalizeRecipe(r) : r; }), []);
  const [applied, setApplied] = useState<StatsRecipe | null>(null);
  const [result, setResult] = useState<StatisticsResult | null>(null);
  const [run, setRun] = useState<Run>({ status: 'idle' });
  const [view, setView] = useState<'table' | 'chart'>(restored.current?.view ?? 'table');
  const [chart, setChart] = useState<ChartSettings>(restored.current?.chart ?? DEFAULT_CHART);
  const [sort, setSort] = useState<RowSort>({ metric: null, dir: 'desc' });
  // F03: series hidden in the chart legend (stable series keys; presentation only)
  const [hidden, setHidden] = useState<string[]>(restored.current?.hidden ?? []);
  const [includeHidden, setIncludeHidden] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [picker, setPicker] = useState<string | null>(null);
  const [pick, setPick] = useState<{ row: string[]; col: string[] | null } | null>(null);
  const [saved, setSaved] = useState<SavedRecipe[]>(() => readSaved(viewer));
  const [saveName, setSaveName] = useState('');
  const gen = useRef(0);
  const abort = useRef<AbortController | null>(null);

  // catalog: once per page (the registry is the server's)
  useEffect(() => {
    if (!active || catalog) return;
    const ac = new AbortController();
    loadCatalog(ac.signal).then((c) => { if (!ac.signal.aborted) setCatalog(c); })
      .catch(() => { if (!ac.signal.aborted) setCatalogError('고를 수 있는 통계 항목을 불러오지 못했습니다. 새로고침해 주세요.'); });
    return () => ac.abort();
  }, [active, catalog]);

  // F02: the shared recipe is checked against this server's registry, then run with the opener's own permission
  useEffect(() => {
    if (share.status !== 'pending' || !catalog || !share.payload) return;
    const why = checkAgainstCatalog(share.payload, catalog);
    if (why) { setShare({ status: 'error', reason: why }); return; }
    const { recipe, chart: c, view: v } = recipeFromPayload(share.payload);
    setDraft(recipe);
    setChart(c);
    setView(v);
    setHidden([]);
    if (recipe.spec.population !== 'all' && !canMine) { setShare({ status: 'waiting_login', payload: share.payload }); return; }
    setShare({ status: 'applied', mine: recipe.spec.population !== 'all' });
    execute(recipe);
  }, [share, catalog, canMine]); // eslint-disable-line react-hooks/exhaustive-deps
  const closeShareError = () => { dropShareParam(); onSharedDone?.(); setShare({ status: 'none' }); };

  const runRef = useRef<StatsRecipe | null>(null);
  const onSharedDoneRef = useRef(onSharedDone);
  onSharedDoneRef.current = onSharedDone;
  const execute = useCallback((input: StatsRecipe) => {
    const recipe = normalizeRecipe(input);
    abort.current?.abort(); // client-side cancel of the older run; its late answer is ignored by the generation
    const ac = new AbortController();
    abort.current = ac;
    runRef.current = recipe;
    const my = ++gen.current;
    setRun({ status: 'loading', recipe });
    loadStatistics(recipe.scope, recipe.spec, version, ac.signal)
      .then((r) => {
        if (ac.signal.aborted || my !== gen.current) return;
        // one commit: the result, its recipe and the idle state together (no half-updated table/chart)
        runRef.current = null;
        setResult(r);
        setApplied(recipe);
        setRun({ status: 'idle' });
        if (recipe.origin === '공유 링크') { dropShareParam(); onSharedDoneRef.current?.(); }
      })
      .catch((e: unknown) => {
        if (ac.signal.aborted || my !== gen.current) return;
        runRef.current = null;
        const code = e instanceof PublicApiError ? e.code : null;
        setRun({ status: 'error', recipe, code, message: e instanceof Error ? e.message : '통계를 만들지 못했습니다.' });
      });
  }, [version]);
  // unmount cancels the client wait; a remount (React StrictMode, or a page that comes back) resumes the same run
  useEffect(() => {
    if (runRef.current && !abort.current) execute(runRef.current);
    return () => { abort.current?.abort(); abort.current = null; };
  }, [execute]);

  // C01: this component instance belongs to ONE viewer — Dashboard remounts it (key = session key) on any account
  // change, so the previous account's draft, result, hand-off, run and catalog can never be saved under the new one.
  // hand-off from the dashboard: the displayed conditions + preset/metrics, run once
  const lastHandoff = useRef<number | null>(null);
  useEffect(() => {
    if (!handoff || handoff.id === lastHandoff.current) return;
    lastHandoff.current = handoff.id;
    setDraft(handoff.recipe);
    setSort({ metric: null, dir: 'desc' });
    execute(handoff.recipe);
  }, [handoff, execute]);
  // first open without a hand-off: restore the session's applied recipe, else the default preset on the dashboard scope
  useEffect(() => {
    // a hand-off (handled just above, same pass) or a restored draft always wins over the default preset
    if (!active || draft || !fallbackScope || lastHandoff.current !== null || share.status !== 'none') return;
    const r: StatsRecipe = { scope: fallbackScope, spec: baseSpec({ date_basis: fallbackScope.date_basis, rows: ['agency'], columns: ['law'], metrics: ['fine_rate', 'completed_count'] }), labels: {}, origin: '기본 예시' };
    setDraft(r);
    execute(r);
  }, [active, draft, fallbackScope, execute, share.status]);
  useEffect(() => {
    if (!active || applied || run.status !== 'idle' || !restored.current?.applied) return;
    const r = restored.current.applied;
    restored.current = null;
    execute(r); // a refresh re-runs the last applied recipe once (the result itself is never stored)
  }, [active, applied, run.status, execute]);
  useEffect(() => {
    if (draft) writeSession({ draft, applied, chart, view, viewer, hidden });
  }, [draft, applied, chart, view, viewer, hidden]);
  // F03: a new result drops the hidden keys of series it no longer has (never hides another series in their place)
  useEffect(() => {
    if (!result || !catalog) return;
    const universe = cartesianModel(result, catalog, { type: 'bar', metrics: result.spec.metrics, refusal: null, compatible: [], availability: chartAvailability(result.spec, catalog), note: null });
    setHidden((h) => { const next = effectiveHidden(universe, h); return next.length === h.length ? h : next; });
  }, [result, catalog]);

  useReportActivity('statistics', run.status === 'loading'
    ? { resource: 'statistics', phase: 'fetching', label: result ? '선택한 조건으로 통계를 다시 만드는 중' : '선택한 조건으로 통계를 만드는 중' }
    : run.status === 'error' ? { resource: 'statistics', phase: 'error', label: '맞춤 통계를 만들지 못했습니다' } : null);

  const dimLabel = (id: string) => catalog?.dimensions.find((d) => d.id === id)?.label ?? id;
  const metricLabel = (id: string) => catalog?.metrics.find((m) => m.id === id)?.label ?? id;
  const unapplied = !!draft && (!applied || recipeKey(draft) !== recipeKey(applied));
  const running = run.status === 'loading';
  const sameAsRunning = running && draft && recipeKey(draft) === recipeKey(run.recipe);
  // arriving on the page: focus its title (no second scroll) once the page is on screen
  const hasDraft = !!draft;
  useEffect(() => {
    if (!active) return;
    const id = requestAnimationFrame(() => document.getElementById('stats-title')?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(id);
  }, [active, hasDraft]);
  const plan = useMemo(() => (result && catalog ? planChart(result.spec, catalog, chart) : null), [result, catalog, chart]);
  // F06: the file is the APPLIED result on screen (never the draft); a newer run in flight locks the button
  const exportBlocked = !result || !applied || !catalog ? '통계를 만든 뒤에 받을 수 있습니다'
    : run.status === 'loading' ? '새 결과를 만드는 중이라 잠시 뒤에 받을 수 있습니다' : null;
  const captureExport = () => {
    if (!result || !applied || !catalog) return null;
    const dl = (id: string) => catalog.dimensions.find((d) => d.id === id)?.label ?? id;
    const ml = (id: string) => catalog.metrics.find((m) => m.id === id)?.label ?? id;
    const chipsText = scopeChips(applied.scope).filter((c) => c.id !== 'bbox').map((c) => `${c.kind} ${c.label}`).join(' · ');
    const p = planChart(result.spec, catalog, chart);
    const conditions = [
      { label: '기간', value: `${applied.scope.start} — ${applied.scope.end} (시작일·종료일 포함)` },
      { label: '날짜 기준', value: `${applied.spec.date_basis === 'completed_date' ? '답변일' : '신고일'} — 이 날짜가 기간 안인 신고만 모았습니다(다른 날짜는 기간 밖이어도 포함)` },
      ...(result.date_axes ?? []).map((a) => ({ label: `${a.role === 'row' ? '행' : '열'} 날짜 축`, value: a.mode === 'spine'
        ? `${dl(a.dimension)}: 기간의 모든 단위를 빠짐없이 보여 줍니다(신고 0건은 0, 비율을 셀 수 없으면 빈 칸, 자료가 없는 구간은 ‘자료 없음’)`
        : a.mode === 'explicit' ? `${dl(a.dimension)}: 고른 단위만 보여 줍니다(사이의 빠진 단위는 조회하지 않았습니다)`
          : `${dl(a.dimension)}: ${applied.spec.date_basis === 'completed_date' ? '답변일' : '신고일'} 기준으로 모은 신고를 이 날짜로 나눠 본 것입니다` })),
      { label: '대상 범위', value: chipsText || '전국 · 모든 분류' },
      ...(applied.scope.bbox ? [{ label: '지도 범위', value: `지도에서 고른 범위 (경도 ${applied.scope.bbox[0]}~${applied.scope.bbox[2]}, 위도 ${applied.scope.bbox[1]}~${applied.scope.bbox[3]})` }] : []),
      ...(applied.spec.place_key ? [{ label: '주소', value: applied.labels[applied.spec.place_key] ?? '선택한 주소' }] : []),
      { label: '누구의 신고', value: applied.spec.population === 'all' ? '전체' : applied.spec.population === 'mine' ? '내 신고 (이 파일을 내려받은 계정의 신고)' : '전체와 내 신고 함께 (이 파일을 내려받은 계정의 신고)' },
      { label: '행', value: applied.spec.rows.map(dl).join(' › ') || '없음' },
      { label: '열', value: applied.spec.columns.map(dl).join(' › ') || '없음' },
      { label: '지표', value: applied.spec.metrics.map(ml).join(', ') },
      { label: '답변 신고', value: [result.population_count.all !== null ? `전체 ${result.population_count.all.toLocaleString('ko-KR')}건` : '', result.population_count.mine !== null ? `내 신고 ${result.population_count.mine.toLocaleString('ko-KR')}건` : ''].filter(Boolean).join(' · ') },
      ...missingRows(result, applied.spec.date_basis),
      { label: '표 정렬', value: sort.metric ? `${ml(sort.metric)} ${sort.dir === 'desc' ? '큰 값부터' : '작은 값부터'}` : '기본 순서' },
      { label: '그래프', value: chart.type === 'auto' ? `${CHART_LABEL[p.type]} (자동 선택)` : p.refusal ? `${CHART_LABEL[p.type]} (고른 ${CHART_LABEL[chart.type]} 그래프는 이 설정에서 쓸 수 없어 바꿨습니다)` : CHART_LABEL[p.type] },
      { label: '지표 정의', value: applied.spec.metrics.map((m) => `${ml(m)}: ${catalog.metrics.find((x) => x.id === m)?.description ?? ''}`).join(' · ') },
      { label: '빈 칸의 뜻', value: '‘—’는 해당하는 신고가 없음, ‘계산 불가’는 비율의 기준이 되는 신고가 0건, ‘자료 없음’은 계산할 자료가 없다는 뜻입니다. 모두 0과 다릅니다.' },
    ];
    return statisticsSnapshot({ result, catalog, chart, sort, hidden, includeHidden, conditions, title: `맞춤 통계 · ${describe(applied)}`, capturedAt: new Date().toISOString() });
  };

  // F02 banners (also shown before any draft exists: an invalid link never falls back to a default silently)
  const shareBanners = (
    <>
      {share.status === 'error' && (
        <div className="banner error share-banner" role="alert">
          <span className="grow">공유 링크를 열 수 없습니다. {share.reason}</span>
          <button type="button" className="ghost-btn" onClick={closeShareError}>기본 화면 보기</button>
        </div>
      )}
      {share.status === 'waiting_login' && (
        <div className="banner warn share-banner" role="note">
          <span className="grow">이 링크는 내 신고를 함께 보는 설정입니다. 로그인하면 내 신고로 계산해 보여 드립니다. 공유한 사람의 신고는 보이지 않습니다.</span>
          {onSignIn && <button type="button" className="ghost-btn" onClick={onSignIn}>로그인</button>}
        </div>
      )}
      {share.status === 'applied' && (
        <div className="banner info share-banner" role="note">
          <span className="grow">공유받은 설정으로 통계를 만들었습니다. 숫자는 지금 자료로 새로 계산한 것이라 공유한 사람이 본 숫자와 다를 수 있습니다{share.mine ? '. 내 신고는 내 계정의 신고로 계산했습니다' : ''}.</span>
          <button type="button" className="link-btn" onClick={() => setShare({ status: 'none' })}>닫기</button>
        </div>
      )}
    </>
  );
  if (!draft) {
    return (
      <section className="stats-page" aria-labelledby="stats-title" hidden={!active}>
        <h1 id="stats-title" tabIndex={-1}>맞춤 통계</h1>
        {shareBanners}
        {share.status !== 'error' && <p className="cm-muted">통계를 준비하는 중입니다…</p>}
      </section>
    );
  }
  const spec = draft.spec;
  const edit = (patch: Partial<StatisticsSpec>) => setDraft((d) => d && { ...d, spec: { ...d.spec, ...patch } });
  const editScope = (s: Scope) => setDraft((d) => d && { ...d, scope: s });
  const listEditor = (key: 'rows' | 'columns' | 'metrics', role: 'row' | 'column' | null, max: number) => {
    const list = spec[key];
    const used = new Set([...spec.rows, ...spec.columns]);
    const options = key === 'metrics'
      ? (catalog?.metrics ?? []).filter((m) => !list.includes(m.id))
      : (catalog?.dimensions ?? []).filter((d) => d.roles.includes(role!) && !used.has(d.id));
    const label = key === 'metrics' ? metricLabel : dimLabel;
    const move = (i: number, d: -1 | 1) => { const n = [...list]; [n[i], n[i + d]] = [n[i + d], n[i]]; edit({ [key]: n } as Partial<StatisticsSpec>); };
    return (
      <div className="stats-list">
        <ol>
          {list.map((id, i) => (
            <li key={id}>
              <span>{label(id)}</span>
              <span className="picker-order">
                <button type="button" className="mini-btn" aria-label={`${label(id)} 위로`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                <button type="button" className="mini-btn" aria-label={`${label(id)} 아래로`} disabled={i === list.length - 1} onClick={() => move(i, 1)}>↓</button>
                <button type="button" className="mini-btn" aria-label={`${label(id)} 빼기`} disabled={key === 'metrics' && list.length === 1}
                  onClick={() => edit({ [key]: list.filter((x) => x !== id) } as Partial<StatisticsSpec>)}>✕</button>
              </span>
            </li>
          ))}
        </ol>
        {list.length < max && (
          <select aria-label={`${key === 'rows' ? '행' : key === 'columns' ? '열' : '지표'} 추가`} value=""
            onChange={(e) => { if (e.target.value) edit({ [key]: [...list, e.target.value] } as Partial<StatisticsSpec>); }}>
            <option value="">+ 추가</option>
            {key === 'metrics'
              ? options.map((o) => <option key={o.id} value={o.id}>{(o as { label: string }).label}</option>)
              : [...new Set((options as NonNullable<typeof catalog>['dimensions']).map((d) => d.group))].map((g) => (
                <optgroup key={g} label={g}>
                  {(options as NonNullable<typeof catalog>['dimensions']).filter((d) => d.group === g).map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
                </optgroup>
              ))}
          </select>
        )}
        <small className="cm-muted">최대 {max}개</small>
      </div>
    );
  };
  const selectedByKind = Object.fromEntries(PICK_KINDS.map((k) => [k.id, filterOf(spec, k.id)?.members ?? []]));
  const applyPicked = (byKind: Record<string, PickedMember[]>) => {
    setDraft((d) => {
      if (!d) return d;
      let s = d.spec;
      const labels = { ...d.labels };
      for (const [dim, members] of Object.entries(byKind)) {
        s = setFilter(s, dim, members.map((m) => m.key));
        for (const m of members) labels[m.key] = m.label;
      }
      return { ...d, spec: s, labels };
    });
    setPicker(null);
  };
  const narrow = (row: string[], col: string[] | null) => {
    if (!result) return;
    setDraft((d) => {
      if (!d) return d;
      let s = d.spec;
      const labels = { ...d.labels };
      const add = (dims: string[], key: string[], members: StatisticsResult['row_members']) => {
        const m = members.find((x) => JSON.stringify(x.key) === JSON.stringify(key));
        dims.forEach((dim, i) => { s = setFilter(s, dim, [key[i]]); if (m) labels[key[i]] = m.label[i]; });
      };
      add(result.spec.rows, row, result.row_members);
      if (col) add(result.spec.columns, col, result.col_members);
      return { ...d, spec: s, labels };
    });
    setPick(null);
  };
  const chips = scopeChips(draft.scope);
  const appliedChips = applied ? scopeChips(applied.scope).map((c) => `${c.kind} ${c.label}`).join(' · ') : '';
  const describe = (r: StatsRecipe) => `${r.spec.rows.map(dimLabel).join('·') || '전체'}${r.spec.columns.length ? ` × ${r.spec.columns.map(dimLabel).join('·')}` : ''} · ${r.spec.metrics.map(metricLabel).join(', ')}`;

  return (
    <section className="stats-page" aria-labelledby="stats-title" hidden={!active}>
      <header className="stats-head">
        <div>
          <h1 id="stats-title" tabIndex={-1}>맞춤 통계</h1>
          <p className="subtitle">행·열·지표와 비교할 대상을 골라 표와 그래프로 확인합니다</p>
        </div>
        <button type="button" className="ghost-btn" onClick={() => onBack()}>지도로 돌아가기</button>
      </header>
      {catalogError && <div className="banner error" role="alert"><span className="grow">{catalogError}</span></div>}
      {shareBanners}
      <div className="stats-layout">
        <aside className="cm-panel stats-builder" aria-label="통계 설정">
          <label className="stats-field">예시 설정
            <select value="" onChange={(e) => {
              const p = PRESETS.find((x) => x.id === e.target.value);
              if (p) setDraft((d) => d && { ...d, spec: { ...d.spec, ...p.spec, filters: d.spec.filters }, origin: p.label });
            }}>
              <option value="">예시 고르기…</option>
              {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </label>
          <fieldset className="stats-field">
            <legend>대상 범위</legend>
            <p className="cm-muted stats-period">{fmtDate(draft.scope.start)} — {fmtDate(draft.scope.end)}</p>
            <div className="stats-chips">
              {chips.filter((c) => c.id !== 'dates').map((c) => (
                <span key={c.id} className="applied-chip"><small>{c.kind}</small> {c.label}
                  <button type="button" aria-label={`${c.kind} ${c.label} 조건 빼기`} onClick={() => editScope(c.remove(draft.scope))}>×</button></span>
              ))}
              {spec.place_key && (
                <span className="applied-chip"><small>주소</small> {draft.labels[spec.place_key] ?? '선택한 주소'}
                  <button type="button" aria-label="주소 조건 빼기" onClick={() => edit({ place_key: null })}>×</button></span>
              )}
              {chips.filter((c) => c.id !== 'dates').length === 0 && !spec.place_key && <span className="cm-muted">전국 · 모든 분류</span>}
            </div>
          </fieldset>
          <fieldset className="stats-field radio-row">
            <legend>날짜 기준</legend>
            <label><input type="radio" name="basis" checked={spec.date_basis === 'completed_date'} onChange={() => edit({ date_basis: 'completed_date' })} />답변일</label>
            <label><input type="radio" name="basis" checked={spec.date_basis === 'report_date'} onChange={() => edit({ date_basis: 'report_date' })} />신고일</label>
          </fieldset>
          <fieldset className="stats-field radio-row">
            <legend>누구의 신고</legend>
            <label><input type="radio" name="pop" checked={spec.population === 'all'} onChange={() => edit({ population: 'all' })} />전체</label>
            <label title={canMine ? undefined : '로그인하면 쓸 수 있습니다'}><input type="radio" name="pop" disabled={!canMine} checked={spec.population === 'mine'} onChange={() => edit({ population: 'mine' })} />내 신고</label>
            <label title={canMine ? undefined : '로그인하면 쓸 수 있습니다'}><input type="radio" name="pop" disabled={!canMine} checked={spec.population === 'compare'} onChange={() => edit({ population: 'compare' })} />전체와 비교</label>
          </fieldset>
          <div className="stats-field"><span className="stats-label">행</span>{listEditor('rows', 'row', catalog?.limits.rows ?? 3)}</div>
          <div className="stats-field"><span className="stats-label">열</span>{listEditor('columns', 'column', catalog?.limits.columns ?? 2)}</div>
          <div className="stats-field"><span className="stats-label">지표</span>{listEditor('metrics', null, catalog?.limits.metrics ?? 6)}</div>
          <div className="stats-field">
            <span className="stats-label">비교 대상</span>
            <div className="stats-chips">
              {spec.filters.map((f) => (
                <span key={f.dimension} className="applied-chip"><small>{dimLabel(f.dimension)}</small>
                  {f.members.map((k) => {
                    // C05: 0건 (exists, excluded by the conditions) vs 확인할 수 없음 (not confirmable under the current
                    // permission/period) vs no answer yet — never collapsed into one another or dropped silently
                    const fm = applied && recipeKey(applied) === recipeKey(draft) ? result?.filter_members.find((m) => m.dimension === f.dimension && m.key === k) : undefined;
                    const st = fm?.status;
                    const label = fm?.label ?? draft.labels[k] ?? k;
                    return <span key={k} className={`stats-member${st === 'zero' ? ' zero' : st === 'unconfirmed' ? ' unavailable' : ''}`}
                      title={st === 'unconfirmed' ? '이 기간에는 확인할 수 없는 대상이라 결과에서 뺐습니다.' : undefined}>
                      {label}{st === 'zero' ? ' (현재 조건 0건)' : st === 'unconfirmed' ? ' (확인할 수 없음)' : !fm && result ? ' (아직 반영 안 됨)' : ''}</span>;
                  })}
                  <button type="button" aria-label={`${dimLabel(f.dimension)} 선택 해제`} onClick={() => edit({ filters: spec.filters.filter((x) => x !== f) })}>×</button></span>
              ))}
              {spec.filters.length === 0 && <span className="cm-muted">고르지 않으면 전체</span>}
            </div>
            <button type="button" className="ghost-btn" onClick={() => setPicker(spec.rows.find((r) => PICK_KINDS.some((k) => k.id === r)) ?? 'agency')}>비교 대상 선택</button>
          </div>
          <div className="stats-run">
            <button type="button" className="primary-button" disabled={!catalog || !!sameAsRunning || (!unapplied && run.status !== 'error')}
              onClick={() => draft && execute(draft)}>{sameAsRunning ? '만드는 중…' : '통계 만들기'}</button>
            {unapplied && <span className="unapplied-note" role="status">바꾼 설정이 아직 반영되지 않았습니다</span>}
          </div>
          <details className="stats-save">
            <summary>설정 저장·불러오기</summary>
            <div className="stats-save-row">
              <input value={saveName} placeholder="이름" aria-label="설정 이름" maxLength={40} onChange={(e) => setSaveName(e.target.value)} />
              <button type="button" className="mini-btn" disabled={!saveName.trim()} onClick={() => { setSaved(saveRecipe(viewer, saveName.trim(), draft, chart)); setSaveName(''); }}>저장</button>
            </div>
            <small className="cm-muted">이 브라우저에만 저장합니다. 주소와 내 신고 선택은 저장하지 않습니다.</small>
            <ul>
              {saved.map((r) => (
                <li key={r.name}><button type="button" className="link-btn" onClick={() => { setDraft((d) => d && { ...d, spec: { ...r.spec }, labels: { ...d.labels, ...r.labels }, origin: r.name }); setChart(r.chart); }}>{r.name}</button></li>
              ))}
            </ul>
          </details>
        </aside>

        <section className="cm-panel stats-result" aria-label="통계 결과" aria-busy={running}>
          <div className="stats-result-head">
            <div>
              <h2>{applied ? describe(applied) : '결과'}</h2>
              <p className="subtitle">
                {applied ? `${fmtDate(applied.scope.start)} — ${fmtDate(applied.scope.end)} · ${applied.spec.date_basis === 'completed_date' ? '답변일 기준' : '신고일 기준'}${appliedChips ? ` · ${appliedChips}` : ''}${applied.spec.population === 'mine' ? ' · 내 신고' : applied.spec.population === 'compare' ? ' · 전체와 내 신고' : ''}` : ''}
                {result ? ` · 답변 ${result.population_count.all ?? result.population_count.mine ?? 0}건` : ''}
                {result ? missingRows(result, result.spec.date_basis).map((r) => ` · ${r.value}`).join('') : ''}
              </p>
              <PanelStatus busy={running} label={result ? '선택한 조건으로 통계를 만드는 중 · 아래는 이전 조건의 결과' : '선택한 조건으로 통계를 만드는 중'} />
            </div>
            <div className="card-tools">
              <div className="mini-segments" role="group" aria-label="보기">
                <button type="button" className={view === 'table' ? 'selected' : ''} aria-pressed={view === 'table'} onClick={() => setView('table')}>표</button>
                <button type="button" className={view === 'chart' ? 'selected' : ''} aria-pressed={view === 'chart'} onClick={() => setView('chart')}>그래프</button>
              </div>
              {view === 'chart' && plan && (
                <>
                  {/* display setting only: changing the type sends no request (the result is already here) */}
                  <ChartTypePicker value={chart.type} plan={plan} autoType={planChart(result!.spec, catalog, { ...chart, type: 'auto' }).type}
                    onChange={(type) => setChart((c) => ({ ...c, type }))} />
                  {result!.spec.metrics.length > 1 && (
                    <label className="inline-select">기준 지표
                      <select value={chart.primary ?? result!.spec.metrics[0]} onChange={(e) => setChart((c) => ({ ...c, primary: e.target.value }))}>
                        {result!.spec.metrics.map((m) => <option key={m} value={m}>{metricLabel(m)}</option>)}
                      </select>
                    </label>
                  )}
                  <label className="inline-check"><input type="checkbox" checked={chart.overlay} onChange={(e) => setChart((c) => ({ ...c, overlay: e.target.checked }))} />같은 단위 지표 겹쳐 보기</label>
                </>
              )}
            </div>
          </div>
          <div className="stats-actions">
            <ExportButton source="statistics" blocked={exportBlocked} capture={captureExport}
              extra={hidden.length > 0 && view === 'chart' ? (
                <label className="inline-check export-option"><input type="checkbox" checked={includeHidden} onChange={(e) => setIncludeHidden(e.target.checked)} />숨긴 항목도 엑셀 차트에 넣기</label>
              ) : null} />
            <button type="button" className="mini-btn" aria-expanded={shareOpen} disabled={!applied && !draft} onClick={() => setShareOpen((o) => !o)}>공유 링크</button>
          </div>
          {shareOpen && (
            <SharePanel applied={applied} draft={draft} unapplied={unapplied} chart={chart} view={view} placeLabel={(r) => (r.spec.place_key ? r.labels[r.spec.place_key] ?? '선택한 주소' : null)}
              onClose={() => setShareOpen(false)} />
          )}
          {result && result.filter_members.some((m) => m.status === 'unconfirmed') && (
            <div className="banner warn" role="note">
              <span className="grow">비교 대상 {result.filter_members.filter((m) => m.status === 'unconfirmed').length}개는 이 기간에 확인할 수 없어 결과에서 뺐습니다. 필요 없으면 설정에서 지워 주세요.</span>
            </div>
          )}
          {run.status === 'error' && (
            <div className={`banner ${result ? 'warn' : 'error'}`} role="alert">
              <span className="grow">{run.message}{result ? ' · 아래는 이전 조건의 결과입니다.' : ''}</span>
              <button type="button" className="ghost-btn" onClick={() => execute(run.recipe)}>다시 시도</button>
            </div>
          )}
          {!result && running && <div className="skeleton stats-skeleton" role="status" aria-label="통계를 만드는 중" />}
          {result && catalog && (view === 'table'
            ? <PivotTable result={result} catalog={catalog} sort={sort} onSort={setSort} onPick={(row, col) => setPick({ row, col })} />
            : <PivotChart result={result} catalog={catalog} settings={chart} theme={theme} hidden={hidden} onHidden={setHidden} onPick={(row, col) => setPick({ row, col })} />)}
          {result && result.population_count.all === 0 && result.population_count.mine !== null && result.population_count.mine === 0 && <p className="cm-muted">이 조건에 맞는 답변 신고가 없습니다.</p>}
          {pick && result && (
            <div className="stats-pick" role="dialog" aria-label="이 항목으로 좁히기">
              <p><b>{[...(result.row_members.find((m) => JSON.stringify(m.key) === JSON.stringify(pick.row))?.label ?? []),
                ...(pick.col ? result.col_members.find((m) => JSON.stringify(m.key) === JSON.stringify(pick.col))?.label ?? [] : [])].join(' · ')}</b></p>
              <button type="button" className="mini-btn" onClick={() => narrow(pick.row, pick.col)}>이 항목으로 좁히기(설정에 추가)</button>
              <button type="button" className="mini-btn" onClick={() => setPick(null)}>닫기</button>
            </div>
          )}
        </section>
      </div>
      <MemberPicker open={picker !== null} initialKind={picker ?? 'agency'} scope={draft.scope} basis={spec.date_basis} placeKey={spec.place_key}
        filters={spec.filters} selected={selectedByKind} labels={draft.labels} version={version}
        onApply={applyPicked} onClose={() => setPicker(null)} />
    </section>
  );
}
