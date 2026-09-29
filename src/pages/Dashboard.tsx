import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LAW_NONE, type DashboardData, type PublicEntity, type PublicPoint, type Scope } from '../domain/public';
import { ACCESS_CODES, PublicApiError, dataMode, entitiesAvailable, loadPlace, loadPlacesInView, type AccessCode } from '../data/client';
import type { RequestSource } from '../data/refreshController';
import AccessGate from '../components/AccessGate';
import {
  CATEGORY_LABEL, baseScope, draftFromScope, fixtureFromSearch, lawLabel, lawOptions, regionCounts, regionLabel, scopeFromDraft,
  scopeFromSearch, scopeToSearch, validateRange, type DraftFilters, type EntityTab, type ThemeMode,
} from '../state/filters';
import TopBar from '../components/TopBar';
import Rail from '../components/Rail';
import CommandBar from '../components/CommandBar';
import FilterDrawer from '../components/FilterDrawer';
import MapPanel, { renderModeOf } from '../components/MapPanel';
import RegionSummaryCard from '../components/RegionSummaryCard';
import type { MapMetric } from '../components/mapMetrics';
import PlaceDetailsPanel, { type PlaceDetailState } from '../components/PlaceDetailsPanel';
import PlaceEntityChart from '../components/PlaceEntityChart';
import TrendCard from '../components/TrendCard';
import VehicleTop5 from '../components/VehicleTop5';
import EntityTable from '../components/EntityTable';
import LawTable from '../components/LawTable';
import DataGuide from '../components/DataGuide';
import { fmtDate } from '../components/format';
import CompareKpis from '../components/CompareKpis';
import KpiPanel from '../components/KpiPanel';
import RegionList from '../components/RegionList';
import ManagerCompare from '../components/ManagerCompare';
import AccountMenu from '../components/AccountMenu';
import ViewControls from '../components/ViewControls';
import AppliedFilterChips, { type AppliedChip } from '../components/AppliedFilterChips';
import { DurationCard, HeatmapCard, RatingCard, ScatterCard, VehicleDaysCard, mineEntityKeys } from '../components/AnalyticsCharts';
import { useMapAuth, usePersonalCompare, type PersonalState } from '../hooks/usePersonal';
import { useDashboardData } from '../hooks/useDashboardData';
import { consistentWithPublic } from '../data/personal';
import { readComparePref, readInterest, toggleInterest, viewFromSearch, writeComparePref, writeInterest, type ViewMode } from '../state/view';
import { markPoints } from '../state/pointMarks';
import { demoViewerFromSearch } from '../auth/mapAuth';
import { CLUSTER_LEVEL } from '../lib/kakao';
import type { CompareEntityRow } from '../domain/personal';

function initialTheme(): ThemeMode {
  try {
    const s = localStorage.getItem('cm-theme');
    if (s === 'dark' || s === 'light' || s === 'system') return s;
  } catch { /* ignore */ }
  return 'dark';
}

function resolveTheme(t: ThemeMode): 'dark' | 'light' {
  if (t !== 'system') return t;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

// AF-MAP2: empty only when neither indicator has rows and no map point exists, so a
// completion-only range still shows its result screen instead of the empty banner.
export function isEmptyResult(data: DashboardData | null): boolean {
  if (!data) return false;
  return data.overview.report_count.value === 0 &&
    data.overview.completed_count.value === 0 &&
    data.points.length === 0;
}

/** Viewport bbox for the statistics scope: rounded (≈10 m) so sub-pixel moves never create a new request.
 *  Only the request bbox is rounded; no source coordinate is touched. */
export function roundBbox(b: [number, number, number, number]): [number, number, number, number] {
  return b.map((v) => Math.round(v * 1e4) / 1e4) as [number, number, number, number];
}
const sameBbox = (a: Scope['bbox'], b: Scope['bbox']) => JSON.stringify(a) === JSON.stringify(b);
const intersects = (a: [number, number, number, number], b: [number, number, number, number]) =>
  a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

type EntityName = { agency: string; manager: string | null };

export default function Dashboard() {
  const [scope, setScopeState] = useState<Scope>(() => scopeFromSearch(window.location.search, baseScope(dataMode)));
  const sourceRef = useRef<RequestSource>('initial');
  const [draft, setDraft] = useState<DraftFilters>(() => draftFromScope(scopeFromSearch(window.location.search, baseScope(dataMode))));
  const [fixture, setFixture] = useState(() => dataMode === 'demo' ? fixtureFromSearch(window.location.search) : 'overview');
  const [theme, setTheme] = useState<ThemeMode>(initialTheme);
  const [briefing, setBriefing] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [selection, setSelection] = useState<string | null>(null);
  const [placeDetail, setPlaceDetail] = useState<PlaceDetailState>({ status: 'loading' });
  const [placeReload, setPlaceReload] = useState(0);
  // how many agencies/managers the place detail asks for (100 by default; "나머지 불러오기" raises it)
  const [placeLimit, setPlaceLimit] = useState(100);
  useEffect(() => { setPlaceLimit(100); }, [selection]);
  const [mapMetric, setMapMetric] = useState<MapMetric>('reports');
  const [entityTab, setEntityTab] = useState<EntityTab>('agency');
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [nav, setNav] = useState('mapsection');
  const [dateError, setDateError] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>(() => viewFromSearch(window.location.search));
  const [compareOn, setCompareOn] = useState<boolean>(readComparePref);
  const [briefingShowMine, setBriefingShowMine] = useState(false);
  const [interest, setInterest] = useState<string[]>(readInterest);
  const [entityNames, setEntityNames] = useState<Map<string, EntityName>>(() => new Map());
  const [refined, setRefined] = useState<{ view: [number, number, number, number]; points: PublicPoint[]; version: string } | null>(null);
  const { auth, signIn, signOut } = useMapAuth();
  const demoMe = dataMode === 'demo' ? demoViewerFromSearch(window.location.search) : null;
  const toastTimer = useRef<number | undefined>(undefined);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3400);
  }, []);

  /** requested scope + how it was requested (explicit = at once; auto = map move, coalesced) */
  const requestScope = useCallback((next: Scope, source: RequestSource = 'explicit') => {
    sourceRef.current = source;
    setScopeState(next);
  }, []);

  // ── data (R04): the last successful snapshot stays on screen while a new one loads ─────────────────────
  const sessionKey = auth.status === 'loading' ? null : `${auth.status}|${auth.displayName ?? ''}|${fixture}`;
  const dash = useDashboardData(scope, sourceRef.current, sessionKey);
  const shown = dash.displayed;
  const data = shown?.data ?? null;
  const shownScope = shown?.scope ?? null;
  const version = shown?.version ?? null;

  // theme
  useEffect(() => {
    document.documentElement.dataset.theme = resolveTheme(theme);
    try { localStorage.setItem('cm-theme', theme); } catch { /* ignore */ }
  }, [theme]);
  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => { document.documentElement.dataset.theme = mq.matches ? 'light' : 'dark'; };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);

  // briefing + Esc
  useEffect(() => {
    document.body.classList.toggle('briefing', briefing);
    setBriefingShowMine(false);
  }, [briefing]);
  useEffect(() => { document.body.dataset.view = view; }, [view]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setDrawer(false); setBriefing(false); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // back/forward: conditions, chips and list selections follow the URL
  useEffect(() => {
    const onPop = () => {
      const s = scopeFromSearch(window.location.search, baseScope(dataMode));
      requestScope(s, 'explicit');
      setDraft(draftFromScope(s));
      setFixture(dataMode === 'demo' ? fixtureFromSearch(window.location.search) : 'overview');
      setView(viewFromSearch(window.location.search));
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [requestScope]);

  const urlFor = (s: Scope, v: ViewMode = view) => {
    const search = scopeToSearch(s, { fixture: dataMode === 'demo' && fixture !== 'overview' ? fixture : null, view: v, me: demoMe });
    return `${window.location.pathname}${search ? `?${search}` : ''}`;
  };
  /** explicit condition change: new history entry; automatic map range: replace (no history flood, R04 §11) */
  const pushUrl = (s: Scope, v: ViewMode = view) => window.history.pushState(null, '', urlFor(s, v));
  const replaceUrl = (s: Scope) => window.history.replaceState(window.history.state, '', urlFor(s));

  const explicit = (next: Scope, message?: string) => {
    requestScope(next, 'explicit');
    setDraft(draftFromScope(next));
    pushUrl(next);
    if (message) showToast(message);
  };

  // whole-history bounds come from the dataset metadata (/meta), never from the last screen or a filtered response
  const dataMin = dash.meta?.data_min ?? null;
  const dataMax = dash.meta?.data_max ?? null;
  const apply = useCallback((): boolean => {
    const err = validateRange(draft.start, draft.end, dataMin, dataMax);
    setDateError(err);
    if (err) { showToast(err); return false; } // the draft, the popover/drawer and the focus stay as they are
    // dates/region/law from the draft; the other applied conditions stay (a new region replaces the map range)
    const next = { ...scopeFromDraft(draft, scope), agency_key: scope.agency_key, manager_key: scope.manager_key,
      bbox: draft.region_code !== scope.region_code ? null : scope.bbox };
    requestScope(next, 'explicit');
    pushUrl(next);
    setDrawer(false);
    return true;
  }, [draft, scope, dataMin, dataMax, showToast, requestScope]); // eslint-disable-line react-hooks/exhaustive-deps
  /** quick period (incl. 전체 기간): dates only, applied at once — draft, chips, URL and one request together */
  const applyPreset = (range: { start: string; end: string }) => {
    setDateError(null);
    explicit({ ...scope, start: range.start, end: range.end });
  };

  const reset = useCallback(() => {
    const next: Scope = { ...baseScope(dataMode) };
    requestScope(next, 'explicit');
    setDraft(draftFromScope(next));
    setSelection(null);
    setRefined(null);
    setDateError(null);
    pushUrl(next);
    showToast('처음 상태(전국·전체)로 돌아왔습니다.');
  }, [showToast, requestScope]); // eslint-disable-line react-hooks/exhaustive-deps

  // R10: stable callbacks for the drawer (a new function per render re-ran its focus effect)
  const closeDrawer = useCallback(() => setDrawer(false), []);
  const openDrawer = useCallback(() => setDrawer(true), []);
  const changeDraft = useCallback((d: DraftFilters) => { setDraft(d); setDateError(null); }, []);

  const share = useCallback(async () => {
    const url = `${window.location.origin}${window.location.pathname}?${scopeToSearch(scope, { fixture: dataMode === 'demo' && fixture !== 'overview' ? fixture : null, view })}`;
    try {
      await navigator.clipboard.writeText(url);
      showToast('지금 보는 화면의 링크를 복사했습니다.');
    } catch {
      showToast(`링크: ${url}`);
    }
  }, [scope, fixture, view, showToast]);

  const unsupported = !!data && data.overview.report_count.value == null;
  const empty = isEmptyResult(data);
  const unsupportedNote = unsupported
    ? dataMode === 'demo'
      ? '이 조건의 예시 자료는 없습니다. 처음 상태로 돌아가면 예시를 볼 수 있습니다.'
      : '이 조건의 통계는 아직 없습니다. 기간이나 지역을 바꿔 보세요.'
    : null;

  // ── names for chips (never internal keys) ─────────────────────────────────────────────────────────────
  const rememberEntity = (e: { agency_key: string | null; manager_key: string | null; agency_name: string; manager_name: string | null }, kind: 'agency' | 'manager') => {
    setEntityNames((m) => {
      const next = new Map(m);
      if (e.agency_key) next.set(`a:${e.agency_key}`, { agency: e.agency_name, manager: null });
      if (kind === 'manager' && e.manager_key) next.set(`m:${e.agency_key}:${e.manager_key}`, { agency: e.agency_name, manager: e.manager_name });
      return next;
    });
  };
  const agencyName = (key: string) => entityNames.get(`a:${key}`)?.agency ?? data?.agencies.find((a) => a.agency_key === key)?.agency_name ?? '선택한 기관';
  const managerName = (agency: string | null, key: string) => {
    const hit = entityNames.get(`m:${agency}:${key}`) ?? (() => {
      const m = data?.managers.find((x) => x.manager_key === key && x.agency_key === agency);
      return m ? { agency: m.agency_name, manager: m.manager_name } : undefined;
    })();
    return hit ? `${hit.manager ?? '이름 없음'} · ${hit.agency}` : '선택한 담당자';
  };

  const pickEntity = (kind: EntityTab, entity: Pick<PublicEntity, 'agency_key' | 'manager_key' | 'agency_name' | 'manager_name'>) => {
    if (!entity.agency_key || (kind === 'manager' && !entity.manager_key)) return;
    rememberEntity(entity, kind);
    explicit({ ...scope, agency_key: entity.agency_key, manager_key: kind === 'manager' ? entity.manager_key : null },
      kind === 'manager' ? `${entity.manager_name ?? '담당자'} · ${entity.agency_name}만 봅니다.` : `${entity.agency_name}만 봅니다.`);
  };
  const pickLaw = (law: string | null) => explicit({ ...scope, law }, law ? `${lawLabel(law)}만 봅니다.` : '모든 법규를 다시 봅니다.');
  const pickCategory = (category: Scope['category']) => { if (category !== scope.category) explicit({ ...scope, category }); };
  const pickRegion = (code: string | null) => {
    // a region replaces the automatic map range (both at once would silently narrow to their overlap);
    // the following fitBounds is programmatic and never re-inserts a bbox (R04 filter rules)
    setRefined(null);
    explicit({ ...scope, region_code: code, bbox: null }, code ? `${regionLabel(code)}만 봅니다.` : '전체 지역으로 돌아왔습니다.');
  };
  /** A02 cell: agency (or manager) + law applied atomically in one request and one history entry */
  const pickCell = (row: { agency_key: string | null; manager_key: string | null; agency_name: string; manager_name: string | null }, lawKey: string) => {
    if (!row.agency_key) return;
    const manager = scope.agency_key !== null && !!row.manager_key;
    rememberEntity(row, manager ? 'manager' : 'agency');
    explicit({ ...scope, agency_key: row.agency_key, manager_key: manager ? row.manager_key : null, law: lawKey },
      `${manager ? `${row.manager_name} · ` : ''}${row.agency_name} + ${lawKey === LAW_NONE ? '법규 미상' : lawKey}만 봅니다.`);
  };

  // ── automatic map range (R04) ───────────────────────────────────────────────────────────────────────
  const onUserViewport = (b: [number, number, number, number]) => {
    if (!autoRefresh) return; // OFF: map moves never change the statistics
    const bbox = roundBbox(b);
    if (sameBbox(bbox, scope.bbox)) return; // sub-pixel / identical range: no request
    const next = { ...scope, bbox };
    requestScope(next, 'auto');
    replaceUrl(next);
  };
  const changeAutoRefresh = (on: boolean) => {
    setAutoRefresh(on);
    if (!on && shownScope && !sameBbox(scope.bbox, shownScope.bbox) && dash.scheduled) {
      // cancel a waiting automatic request: back to the range on screen (its bbox stays as a removable chip)
      requestScope(shownScope, 'explicit');
      replaceUrl(shownScope);
    }
  };

  // ── display-only refinement of server-compacted nodes (R07/F04) ─────────────────────────────────────
  const refineTimer = useRef<number | undefined>(undefined);
  const renderModeRef = useRef<'points' | 'regions'>('points');
  renderModeRef.current = renderModeOf(mapMetric);
  // switching to a rate metric: no address is selected any more (its detail and manager chart go away with it)
  useEffect(() => {
    if (renderModeOf(mapMetric) === 'regions') {
      setSelection(null);
      refineAbort.current?.abort();
      window.clearTimeout(refineTimer.current);
      setRefined(null);
    }
  }, [mapMetric]);
  const refineAbort = useRef<AbortController | null>(null);
  const hasAggregates = !!data?.points.some((pt) => pt.aggregate);
  const renderMode = renderModeOf(mapMetric);
  const onView = (b: [number, number, number, number], zoom: number) => {
    window.clearTimeout(refineTimer.current);
    // pin refinement exists in the points (신고 수) mode only; a rate map never asks for or draws pins (R7)
    if (renderMode !== 'points' || !hasAggregates || !shownScope || !version || zoom >= CLUSTER_LEVEL) { if (refined) setRefined(null); return; }
    refineTimer.current = window.setTimeout(() => {
      refineAbort.current?.abort();
      const ac = new AbortController();
      refineAbort.current = ac;
      loadPlacesInView(shownScope, roundBbox(b), version, ac.signal)
        // a late answer after switching to a rate metric is dropped (no pin can come back)
        .then((r) => { if (!ac.signal.aborted && renderModeRef.current === 'points') setRefined({ view: b, points: r.points, version }); })
        .catch(() => undefined); // display refinement only: the compacted nodes stay drawn
    }, 600);
  };
  useEffect(() => { setRefined(null); }, [version, shown]);
  const mapPoints = useMemo(() => {
    const base = data?.points ?? [];
    if (!refined || refined.version !== version) return base;
    const keep = base.filter((pt) => !(pt.aggregate && pt.bbox && intersects(pt.bbox, refined.view)));
    const keys = new Set(keep.map((pt) => pt.key));
    return [...keep, ...refined.points.filter((pt) => !keys.has(pt.key))];
  }, [data, refined, version]);

  // ── place selection (R05): its own request, never a dashboard refetch; A→B races are dropped ──────────
  const point: PublicPoint | null = useMemo(() => mapPoints.find((pt) => pt.key === selection) ?? null, [mapPoints, selection]);
  const lastPoint = useRef<PublicPoint | null>(null);
  useEffect(() => { if (point) lastPoint.current = point; }, [point]);
  useEffect(() => {
    if (selection && data && !point) {
      setSelection(null);
      showToast('선택한 주소는 새 조건의 결과에 없어서 선택을 닫았습니다.');
    }
  }, [data, point, selection, showToast]);
  useEffect(() => {
    if (!selection || !point || point.aggregate || !shownScope || !version) return;
    if (!point.place_key) { setPlaceDetail({ status: 'unsupported' }); return; }
    const ac = new AbortController();
    setPlaceDetail({ status: 'loading' });
    loadPlace(shownScope, selection, version, ac.signal, placeLimit)
      .then((detail) => { if (!ac.signal.aborted) setPlaceDetail({ status: 'ready', detail }); })
      .catch((e: unknown) => {
        if (ac.signal.aborted) return;
        setPlaceDetail(e instanceof PublicApiError && e.status === 404
          ? { status: 'error', message: '이 주소는 지금 조건의 결과에 없습니다.' }
          : { status: 'error', message: '이 주소의 기관·담당자를 불러오지 못했습니다.' });
      });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, point?.place_key, shownScope, version, placeReload, placeLimit]);

  const resolvedTheme: 'dark' | 'light' = resolveTheme(theme);

  // ── personal comparison: same DISPLAYED scope/version as the public numbers ───────────────────────────
  const compareDisabledReason = auth.status === 'unconfigured' ? (auth.message ?? '지금은 로그인 기능을 쓸 수 없습니다.') : null;
  const briefingHidden = briefing && compareOn && !briefingShowMine;
  const compareActive = compareOn && !compareDisabledReason && !briefingHidden && !!data && !unsupported;
  const rawPersonal = usePersonalCompare(shownScope ?? scope, version, compareActive);
  const personal: PersonalState = rawPersonal.status === 'ready' && rawPersonal.data && data && !consistentWithPublic(rawPersonal.data, data.overview)
    ? { status: 'error', data: null, retry: rawPersonal.retry,
      error: { code: 'DATASET_CHANGED', message: '통계가 방금 새로 바뀌었습니다. 다시 불러와 주세요.', retryAfter: null } }
    : rawPersonal;
  const compareData = personal.status === 'ready' ? personal.data : null;
  const showMine = compareOn && !compareDisabledReason && !briefingHidden;

  const changeCompare = (on: boolean) => { setCompareOn(on); writeComparePref(on); };
  const changeView = (v: ViewMode) => { setView(v); pushUrl(scope, v); };
  const flipInterest = (code: string) => setInterest((list) => writeInterest(toggleInterest(list, code)));
  const pickCompareEntity = (row: CompareEntityRow) => pickEntity(row.kind, row);

  const marks = useMemo(() => markPoints(mapPoints, compareData?.my_points ?? null, interest), [mapPoints, compareData, interest]);
  const entityMine = useMemo(() => {
    if (!compareData) return null;
    return new Map((entityTab === 'agency' ? compareData.agencies : compareData.managers).map((r) => [r.key, r]));
  }, [compareData, entityTab]);
  const regionCountMap = useMemo(() => regionCounts(data?.regions ?? null), [data?.regions]);
  // laws offered by the selectors: the catalogue of the last displayed data without a law filter
  const lawCatalog = useRef<DashboardData['laws']>(null);
  if (data && shownScope && !shownScope.law) lawCatalog.current = data.laws;
  const lawChoices = useMemo(() => lawOptions(lawCatalog.current, scope.law), [data, scope.law]); // eslint-disable-line react-hooks/exhaustive-deps
  const drawerLawChoices = useMemo(() => lawOptions(lawCatalog.current, draft.law), [data, draft.law]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── applied chips (R08): requested scope vs defaults; human names only ────────────────────────────────
  const base = baseScope(dataMode);
  const chips: AppliedChip[] = [];
  if (scope.start !== base.start || scope.end !== base.end) {
    chips.push({ id: 'dates', kind: '기간', label: `${fmtDate(scope.start)} — ${fmtDate(scope.end)}`, onRemove: () => explicit({ ...scope, start: base.start, end: base.end }) });
  }
  if (scope.category !== 'all') chips.push({ id: 'category', kind: '분류', label: CATEGORY_LABEL[scope.category], onRemove: () => explicit({ ...scope, category: 'all' }) });
  if (scope.region_code) chips.push({ id: 'region', kind: '지역', label: regionLabel(scope.region_code), onRemove: () => pickRegion(null) });
  if (scope.law) chips.push({ id: 'law', kind: '법규', label: lawLabel(scope.law), onRemove: () => explicit({ ...scope, law: null }) });
  if (scope.agency_key && !scope.manager_key) chips.push({ id: 'agency', kind: '기관', label: agencyName(scope.agency_key), onRemove: () => explicit({ ...scope, agency_key: null, manager_key: null }) });
  if (scope.manager_key) chips.push({ id: 'manager', kind: '담당자', label: managerName(scope.agency_key, scope.manager_key), onRemove: () => explicit({ ...scope, manager_key: null }) });
  if (scope.bbox) chips.push({ id: 'bbox', kind: '지도 범위', label: autoRefresh ? '지도에 보이는 범위(자동)' : '마지막으로 적용한 지도 범위', onRemove: () => explicit({ ...scope, bbox: null }) });
  const filterCount = chips.filter((c) => c.id !== 'dates').length;
  const unapplied = draft.start !== scope.start || draft.end !== scope.end || draft.region_code !== scope.region_code || (draft.law ?? null) !== (scope.law ?? null);
  const scopeLabel = (s: Scope | null) => (s ? `${fmtDate(s.start)} — ${fmtDate(s.end)} · ${regionLabel(s.region_code)}${s.category !== 'all' ? ` · ${CATEGORY_LABEL[s.category]}` : ''}${s.law ? ` · ${lawLabel(s.law)}` : ''}${s.bbox ? ' · 지도 범위' : ''}${s.agency_key ? ` · ${s.manager_key ? managerName(s.agency_key, s.manager_key) : agencyName(s.agency_key)}` : ''}` : '');

  const accessCode = dash.access?.code && (ACCESS_CODES as readonly string[]).includes(dash.access.code) ? dash.access.code as AccessCode : null;
  if (accessCode) {
    // Contributor-only: nothing of the dashboard renders without a readable response (the server refuses the data).
    return (
      <>
        <TopBar theme={theme} onTheme={setTheme} briefing={false} onBriefing={() => undefined} dataStamp="" sample={false}
          account={<AccountMenu auth={auth} onSignIn={signIn} onSignOut={signOut} briefing={false} />} />
        <AccessGate code={accessCode} auth={auth} onSignIn={signIn} onSignOut={signOut} onRetry={dash.retry}
          progress={accessCode === 'upload_required' ? dash.access?.details ?? null : null} />
      </>
    );
  }

  const stamp = data?.meta.data_max ? fmtDate(data.meta.data_max) : fmtDate(baseScope(dataMode).end);
  const err = dash.error;
  const errText = err ? `${err.status === 429 ? '요청이 많아 잠시 쉬고 있습니다' : err.message}${err.status === 429 && err.retryAfter ? ` · ${err.retryAfter}초 뒤 최신 범위로 자동으로 다시 불러옵니다` : ''}` : null;
  const entitiesLive = entitiesAvailable() && !(dataMode === 'demo' && (fixture === 'one' || fixture === 'empty'));
  const analytics = data?.analytics ?? null;

  return (
    <>
      <TopBar
        theme={theme}
        onTheme={setTheme}
        briefing={briefing}
        onBriefing={() => setBriefing((v) => !v)}
        dataStamp={stamp}
        sample={data?.meta.sample ?? false}
        account={<AccountMenu auth={auth} onSignIn={signIn} onSignOut={signOut} briefing={briefing} />}
      />
      <div className="app">
        <Rail active={nav} onNavigate={setNav} onAbout={() => document.getElementById('guide')?.scrollIntoView({ behavior: 'auto' })} />
        <main id="main" data-view={view}>
          <section className="page-heading" aria-label="소개">
            <div>
              <div className="overline">나만의 안전신문고 커뮤니티</div>
              <h1>함께 모은 신고를 <em>지도로 봅니다</em></h1>
            </div>
            <span className="heading-note">이용자들이 공유한 안전신문고 신고를 지역·기관·기간별로 봅니다. 로그인하면 내 신고와 나란히 비교할 수 있습니다.</span>
          </section>

          {briefing && (
            <div className="banner briefing-bar" role="note">
              <span className="grow">
                브리핑 모드입니다. Esc를 누르면 끝납니다.
                {compareOn && (briefingShowMine ? ' 내 신고도 보이는 중입니다.' : ' 여럿이 보는 화면이라 내 신고는 숨겼습니다.')}
              </span>
              {compareOn && !compareDisabledReason && (
                <button className="ghost-btn" type="button" aria-pressed={briefingShowMine} onClick={() => setBriefingShowMine((v) => !v)}>
                  {briefingShowMine ? '내 신고 숨기기' : '내 신고 보이기'}
                </button>
              )}
              <button className="ghost-btn" type="button" onClick={() => setBriefing(false)}>끝내기 (Esc)</button>
            </div>
          )}

          <CommandBar
            draft={draft}
            onDraft={changeDraft}
            category={scope.category}
            onCategory={pickCategory}
            law={scope.law}
            lawOptions={lawChoices}
            onLaw={pickLaw}
            filterCount={filterCount}
            minDate={dataMin}
            maxDate={dataMax}
            appliedStart={scope.start}
            appliedEnd={scope.end}
            onPreset={applyPreset}
            onApply={apply}
            onReset={reset}
            onShare={share}
            onOpenDrawer={openDrawer}
            dateError={dateError}
            regionCounts={regionCountMap}
            extra={(
              <ViewControls compareOn={compareOn} onCompare={changeCompare} compareDisabledReason={compareDisabledReason}
                briefingHidden={briefingHidden} view={view} onView={changeView} />
            )}
          />
          <AppliedFilterChips chips={chips} onClearAll={reset} pending={dash.isRefreshing}
            displayedLabel={dash.isRefreshing || err ? scopeLabel(shownScope) : null} unapplied={unapplied} onApplyDraft={apply} />

          {dash.isInitialLoading && (
            <section className="kpis" aria-label="불러오는 중">
              {Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton" role="status" aria-label="불러오는 중" />)}
            </section>
          )}
          {err && (
            <div className={`banner ${data ? 'warn' : 'error'}`} role="alert">
              <span className="grow">
                {errText}
                {data && ` · 화면의 수치는 마지막으로 불러온 조건(${scopeLabel(shownScope)})의 결과입니다.`}
              </span>
              {err.status !== 429 && <button className="ghost-btn" type="button" onClick={dash.retry}>다시 시도</button>}
            </div>
          )}

          {data && (
            <>
              {(unsupported || empty) && (
                <div className="banner warn" role="note">
                  <span className="grow">{empty ? '고른 조건에 맞는 신고가 아직 없습니다.' : unsupportedNote}</span>
                  <button className="ghost-btn" type="button" onClick={reset}>처음 상태로</button>
                </div>
              )}
              {dataMode === 'demo' && fixture === 'one' && (
                <div className="banner" role="note"><span className="grow">예시: 신고가 1건뿐인 경우의 화면입니다.</span></div>
              )}
              {/* One stable grid for every view: the map host is never re-parented or remounted (R04 §12). */}
              <div className={`dash-grid${err && shownScope && JSON.stringify(shownScope) !== JSON.stringify(scope) ? ' stale' : ''}`} id="mapsection" data-view={view} data-selected={point ? 'place' : 'none'}>
                <div className="area-map">
                  <MapPanel
                    points={mapPoints}
                    selectedKey={selection}
                    onSelect={setSelection}
                    metric={mapMetric}
                    onMetric={setMapMetric}
                    categoryLabel={shownScope?.category === 'all' ? '모든 신고' : CATEGORY_LABEL[shownScope?.category ?? 'all']}
                    onUserViewport={onUserViewport}
                    onView={onView}
                    autoRefresh={autoRefresh}
                    onAutoRefresh={changeAutoRefresh}
                    locationMissing={data.meta.location_missing ?? null}
                    unplaced={data.map_unplaced ?? null}
                    marks={showMine ? marks : undefined}
                    regions={data.regions}
                    activeRegion={scope.region_code}
                    onPickRegion={pickRegion}
                    refreshing={dash.isRefreshing}
                    statsBbox={!!shownScope?.bbox}
                  />
                </div>
                <div className="area-side">
                  {point ? (
                    <PlaceDetailsPanel
                      point={point}
                      detail={point.aggregate ? { status: 'unsupported' } : placeDetail}
                      scopeLabel={scopeLabel(shownScope)}
                      mark={showMine ? marks.get(point.key) ?? null : null}
                      onClose={() => setSelection(null)}
                      onRetry={() => setPlaceReload((n) => n + 1)}
                      onPickEntity={pickEntity}
                      toast={showToast}
                      activeAgency={scope.agency_key}
                      activeManager={scope.manager_key}
                    />
                  ) : null}
                  {point && !point.aggregate && placeDetail.status === 'ready' && placeDetail.detail.place.key === point.key && (
                    <PlaceEntityChart
                      key={point.key}
                      managers={placeDetail.detail.managers}
                      total={placeDetail.detail.manager_total}
                      theme={resolvedTheme}
                      loadingMore={false}
                      onLoadMore={placeDetail.detail.manager_total > placeDetail.detail.managers.length
                        ? () => setPlaceLimit(Math.min(1000, placeDetail.detail.manager_total)) : null}
                    />
                  )}
                  {!point && renderMode === 'regions' && scope.region_code && (
                    <RegionSummaryCard code={scope.region_code} regions={data.regions} metric={mapMetric}
                      statsBbox={!!shownScope?.bbox} onClear={() => pickRegion(null)} />
                  )}
                  {!point && (
                    <KpiPanel
                      overview={data.overview}
                      personal={personal}
                      showMine={showMine}
                      unsupported={unsupported}
                      scopeLabel={scopeLabel(shownScope)}
                      detail={(
                        <>
                          <CompareKpis overview={data.overview} personal={personal} compareOn={showMine} auth={auth} onSignIn={signIn} unsupported={unsupported} />
                          {showMine && <ManagerCompare personal={personal} onPick={pickCompareEntity} />}
                        </>
                      )}
                    />
                  )}
                </div>
                <section className="area-charts" id="analytics" aria-label="데이터로 보는 신고 현황">
                  <TrendCard monthly={data.monthly} theme={resolvedTheme} mine={showMine ? compareData?.monthly ?? null : null} />
                  <DurationCard all={analytics?.duration ?? null} mine={showMine ? compareData?.analytics?.duration ?? null : null} theme={resolvedTheme} />
                  <HeatmapCard data={analytics?.heatmap ?? null} theme={resolvedTheme} onPick={pickCell} />
                  <VehicleDaysCard data={analytics?.vehicle_days ?? null} theme={resolvedTheme} />
                  <ScatterCard data={analytics?.scatter ?? null} theme={resolvedTheme}
                    mineKeys={showMine ? mineEntityKeys(compareData?.agencies, compareData?.managers) : null}
                    onPick={(kind, e) => pickEntity(kind, e)} />
                  <RatingCard all={analytics?.rating ?? null} mine={showMine ? compareData?.analytics?.rating ?? null : null} theme={resolvedTheme}
                    mineState={!showMine ? 'off' : personal.status === 'ready' ? 'ready'
                      : personal.status === 'loading' || personal.status === 'waiting' ? 'loading'
                        : personal.status === 'signed_out' || personal.status === 'unconfigured' ? 'signed_out' : 'error'} />
                </section>
                <section className="area-tables" aria-label="표로 보는 현황">
                  <RegionList regions={data.regions} compare={showMine ? compareData?.regions ?? null : null} compareOn={showMine}
                    interest={interest} onToggleInterest={flipInterest} activeRegion={scope.region_code} onPickRegion={pickRegion} />
                  <VehicleTop5 vehicles={data.vehicles} totalScope={data.vehicle_total_scope_reports} identifiable={data.vehicle_identifiable_reports} toast={showToast} />
                  <LawTable laws={data.laws} activeLaw={scope.law} onPickLaw={pickLaw} />
                  {shownScope && version && (
                    <EntityTable scope={shownScope} version={version} agencies={data.agencies} managers={data.managers}
                      tab={entityTab} onTab={setEntityTab} onPick={pickEntity} mine={showMine ? entityMine : null}
                      serverList={entitiesLive} activeAgency={scope.agency_key} activeManager={scope.manager_key} />
                  )}
                </section>
              </div>
              <DataGuide data={data} />
            </>
          )}

          <footer className="page-footer">
            <span>나만의 안전신문고 <b>커뮤니티 신고 지도</b>{dataMode === 'demo' ? ' · 예시 데이터' : ''}</span>
            <span>이용자가 공유한 신고만 모았습니다. 전체 신고를 대표하지는 않습니다.</span>
          </footer>
        </main>
      </div>
      <FilterDrawer
        open={drawer}
        draft={draft}
        onDraft={changeDraft}
        appliedChips={chips.map((c) => `${c.kind}: ${c.label}`)}
        unsupportedNote={unsupportedNote}
        onClose={closeDrawer}
        onApply={apply}
        onReset={reset}
        regionCounts={regionCountMap}
        lawOptions={drawerLawChoices}
        dateError={dateError}
      />
      {toast && <div className="toast" role="status" aria-live="polite">{toast}</div>}
    </>
  );
}
