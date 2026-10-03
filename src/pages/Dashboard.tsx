import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DATE_BASIS_LABEL, LAW_NONE, type DashboardData, type DateBasis, type PublicEntity, type PublicPoint, type Scope } from '../domain/public';
import { ACCESS_CODES, PublicApiError, dataMode, entitiesAvailable, loadPlace, loadPlacesInView, sameScope, type AccessCode } from '../data/client';
import type { RequestSource } from '../data/refreshController';
import AccessGate from '../components/AccessGate';
import {
  CATEGORY_LABEL, basisFromSearch, baseScope, draftFromScope, fixtureFromSearch, lawLabel, lawOptions, regionCounts, regionLabel, scopeFromDraft,
  scopeFromSearch, scopeToSearch, validateRange, type DraftFilters, type EntityTab, type ThemeMode,
} from '../state/filters';
import TopBar from '../components/TopBar';
import Rail from '../components/Rail';
import CommandBar from '../components/CommandBar';
import FilterDrawer from '../components/FilterDrawer';
import MapPanel, { renderModeOf } from '../components/MapPanel';
import ScopeDetailsPanel, { type ManagerPaging } from '../components/ScopeDetailsPanel';
import RankingsPage from './RankingsPage';
import StatisticsPage, { type ScopeChip } from './StatisticsPage';
import { clearSession as clearStatsSession, dropLegacyStatsStorage, handoffRecipe, type StatsRecipe } from '../state/statistics';
import { SPY_SECTIONS, currentSection, scrollToSection, scrollToSectionWhenReady, watchStickyInsets } from '../lib/navigation';
import type { Screen } from '../components/Rail';
import type { TrendRate } from '../components/trendMetrics';
import { TREND_RATE_METRIC_ID } from '../components/trendMetrics';
import type { MapMetric } from '../components/mapMetrics';
import PlaceDetailsPanel, { type PlaceDetailState } from '../components/PlaceDetailsPanel';
import PlaceEntityChart from '../components/PlaceEntityChart';
import CoupangAd from '../components/CoupangAd';
import TrendCard from '../components/TrendCard';
import VehicleTop5 from '../components/VehicleTop5';
import EntityTable from '../components/EntityTable';
import LawTable from '../components/LawTable';
import DataGuide from '../components/DataGuide';
import { fmtDate } from '../components/format';
import CompareKpis from '../components/CompareKpis';
import KpiPanel, { type KpiFocus } from '../components/KpiPanel';
import RegionList from '../components/RegionList';
import ManagerCompare from '../components/ManagerCompare';
import AccountMenu from '../components/AccountMenu';
import ViewControls from '../components/ViewControls';
import AppliedFilterChips, { type AppliedChip } from '../components/AppliedFilterChips';
import { DurationCard, HeatmapCard, RatingCard, ScatterCard, VehicleDaysCard, mineEntityKeys } from '../components/AnalyticsCharts';
import { useMapAuth, usePersonalCompare, type PersonalState } from '../hooks/usePersonal';
import { useDashboardData } from '../hooks/useDashboardData';
import { consistentWithPublic } from '../data/personal';
import { hasLayoutParam, readComparePref, readInterest, screenFromSearch, toggleInterest, writeComparePref, writeInterest } from '../state/view';
import { markPoints } from '../state/pointMarks';
import { demoViewerFromSearch, sessionKeyOf } from '../auth/mapAuth';
import { SHARE_PARAM } from '../state/share';
import { CLUSTER_LEVEL } from '../lib/kakao';
import type { CompareEntityRow } from '../domain/personal';
import { ActivityContext, ActivityRegistry, useReportActivity, type QueryActivity } from '../data/queryActivity';
import GlobalQueryStatus from '../components/GlobalQueryStatus';

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

/** C06: keep the current history entry's scroll position (debounced on scroll, and before every push) */
function rememberScroll(): void {
  try { window.history.replaceState({ ...(window.history.state ?? {}), cmScroll: window.scrollY }, ''); } catch { /* ignore */ }
}
/** restore after the screen switch has rendered (two frames: React commit, then layout) */
function restoreScroll(y: number): void {
  requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo({ top: y })));
}

/** U01 saved setting: the date basis last chosen by this account (hashed session key; never sent anywhere).
 *  Order of restore: explicit URL / shared link / hand-off > this saved setting > the default (답변일). */
const BASIS_KEY = 'cm-date-basis';
function readBasisPref(account: string): DateBasis | null {
  try {
    const v = (JSON.parse(localStorage.getItem(BASIS_KEY) ?? '{}') as Record<string, unknown>)[account];
    return v === 'report_date' || v === 'completed_date' ? v : null;
  } catch { return null; }
}
function writeBasisPref(account: string, basis: DateBasis): void {
  try {
    const all = JSON.parse(localStorage.getItem(BASIS_KEY) ?? '{}') as Record<string, string>;
    localStorage.setItem(BASIS_KEY, JSON.stringify({ ...all, [account]: basis }));
  } catch { /* storage blocked: the choice still works for this page */ }
}

/** D10: the exact conditions a display refinement belongs to (full scope incl. basis, account, version, mode) */
const refineKey = (s: Scope | null, version: string | null, session: string | null, mode: string) =>
  s ? `${JSON.stringify(s)}|${version}|${session}|${mode}` : '';

/** C06 scroll spy: programmatic moves (menu, restore) pause it briefly so passing sections do not flash in the menu */
let spyLockUntil = 0;
function lockSpy(ms = 1200): void { spyLockUntil = Date.now() + ms; }


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
  // how many agencies/managers the place detail asks for (100 by default; the chart's "나머지 불러오기" raises it)
  const placeLimit = useRef(100);
  useEffect(() => { placeLimit.current = 100; }, [selection]);
  // the chart's request for more managers of the SAME address/scope/version: the detail on screen stays until it lands
  const [placeMore, setPlaceMore] = useState<{ key: string; state: 'loading' | 'error' } | null>(null);
  const placeMoreAbort = useRef<AbortController | null>(null);
  const [mapMetric, setMapMetric] = useState<MapMetric>('reports');
  const [entityTab, setEntityTab] = useState<EntityTab>('agency');
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [nav, setNav] = useState('mapsection');
  // S04: separate 맞춤 통계 screen in the same shell (?screen=statistics works for direct entry and refresh on Pages)
  const [screen, setScreen] = useState<Screen>(() => screenFromSearch(window.location.search));
  const [statsOpened, setStatsOpened] = useState(() => screenFromSearch(window.location.search) === 'statistics');
  const [handoff, setHandoff] = useState<{ id: number; recipe: StatsRecipe } | null>(null);
  // F02: a shared analysis link (?screen=statistics&sr=…) — raw text, validated by the statistics page
  const [sharedRecipe, setSharedRecipe] = useState<string | null>(() => new URLSearchParams(window.location.search).get(SHARE_PARAM));
  useEffect(() => { if (screen === 'statistics') setStatsOpened(true); }, [screen]);
  const [dateError, setDateError] = useState<string | null>(null);
  // U01: whether the basis came explicitly (URL / link); otherwise this account's saved setting may apply once
  const basisExplicit = useRef(basisFromSearch(window.location.search) !== null);
  const [compareOn, setCompareOn] = useState<boolean>(readComparePref);
  const [briefingShowMine, setBriefingShowMine] = useState(false);
  const [interest, setInterest] = useState<string[]>(readInterest);
  const [entityNames, setEntityNames] = useState<Map<string, EntityName>>(() => new Map());
  // D10: a refinement carries the full key of the snapshot it was asked for; it is merged only into that snapshot
  const [refined, setRefined] = useState<{ view: [number, number, number, number]; points: PublicPoint[]; key: string } | null>(null);
  const { auth, signIn, signOut } = useMapAuth();
  // S10: one display-only activity registry per page (never starts a request)
  const activity = useMemo(() => new ActivityRegistry(), []);
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
  // C01: account boundary by the auth user id (a shared nickname is never the same account)
  const sessionKey = sessionKeyOf(auth, fixture);
  const dash = useDashboardData(scope, sourceRef.current, sessionKey, screen !== 'rankings');
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
  // U04 + U01: an old URL (layout parameter, or no date basis) is rewritten once to the new form; every other
  // parameter (share link, fixture, screen, OAuth return) is kept as it is
  useEffect(() => {
    const url = new URL(window.location.href);
    let changed = false;
    if (hasLayoutParam(url.search)) { url.searchParams.delete('view'); changed = true; }
    if (!url.searchParams.has('date_basis') && url.searchParams.has('start')) { url.searchParams.set('date_basis', scope.date_basis); changed = true; }
    if (changed) window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // S02 Esc: the topmost layer only — drawer, then briefing, then the address selection (never all at once).
  // Dialogs (e.g. 비교 대상 선택) handle their own Esc in the capture phase and stop it. Typing is never intercepted.
  const escState = useRef({ drawer: false, briefing: false, selection: null as string | null });
  escState.current = { drawer, briefing, selection };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return;
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      const st = escState.current;
      if (st.drawer) { setDrawer(false); return; }
      if (st.briefing) { setBriefing(false); return; }
      if (st.selection && !typing) setSelection(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  // C06: scroll spy on the dashboard screen only (a hidden dashboard never drives the menu on the statistics screen)
  useEffect(() => {
    if (screen !== 'dashboard') return;
    let raf = 0;
    let t: number | undefined;
    const evaluate = () => {
      if (Date.now() < spyLockUntil) { window.clearTimeout(t); t = window.setTimeout(evaluate, spyLockUntil - Date.now() + 20); return; }
      const inset = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--scroll-top-inset')) || 76;
      const tops = SPY_SECTIONS.map((id) => [id, document.getElementById(id)?.getBoundingClientRect().top ?? Infinity] as [string, number])
        .filter(([, top]) => Number.isFinite(top));
      const id = currentSection(tops, inset);
      if (id) setNav((cur) => (cur === id ? cur : id));
    };
    const onScroll = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(evaluate); };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => { window.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf); window.clearTimeout(t); };
  }, [screen]);
  // S03: publish the measured sticky cover as --scroll-top-inset (scroll-padding-top), once per page
  useEffect(() => watchStickyInsets(), []);
  // C06: the page restores scroll itself (the screens swap after popstate, so the browser's own restore is too early)
  useEffect(() => {
    try { window.history.scrollRestoration = 'manual'; } catch { /* ignore */ }
    let t: number | undefined;
    const onScroll = () => { window.clearTimeout(t); t = window.setTimeout(rememberScroll, 250); };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { window.removeEventListener('scroll', onScroll); window.clearTimeout(t); };
  }, []);

  // back/forward: conditions, chips and list selections follow the URL
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      // C06: back/forward restores this entry's scroll position once the screen it belongs to is laid out
      const y = typeof (e.state as { cmScroll?: unknown } | null)?.cmScroll === 'number' ? (e.state as { cmScroll: number }).cmScroll : null;
      if (y !== null) restoreScroll(y);
      const s = scopeFromSearch(window.location.search, baseScope(dataMode));
      requestScope(s, 'explicit');
      setDraft(draftFromScope(s));
      setFixture(dataMode === 'demo' ? fixtureFromSearch(window.location.search) : 'overview');
      setScreen(screenFromSearch(window.location.search));
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [requestScope]);

  const urlFor = (s: Scope, sc: Screen = screen) => {
    const search = scopeToSearch(s, { fixture: dataMode === 'demo' && fixture !== 'overview' ? fixture : null, me: demoMe });
    // the screen is a page parameter only: it is never part of the statistics scope sent to the API
    const params = new URLSearchParams(search);
    if (sc !== 'dashboard') params.set('screen', sc);
    for (const [key, value] of new URLSearchParams(window.location.search)) if (key.startsWith('rk_')) params.set(key, value);
    const withScreen = params.toString();
    return `${window.location.pathname}${withScreen ? `?${withScreen}` : ''}`;
  };
  /** explicit condition change: new history entry; automatic map range: replace (no history flood, R04 §11) */
  /** C06: every history entry carries its scroll position (the entry being left is updated first) */
  const pushUrl = (s: Scope, sc: Screen = screen) => {
    rememberScroll();
    window.history.pushState({ cmScroll: sc === screen ? window.scrollY : 0 }, '', urlFor(s, sc));
  };
  const replaceUrl = (s: Scope) => window.history.replaceState(window.history.state, '', urlFor(s));

  const explicit = (next: Scope, message?: string) => {
    requestScope(next, 'explicit');
    setDraft(draftFromScope(next));
    pushUrl(next);
    if (message) showToast(message);
  };

  // 전체 기간 of the SELECTED basis from the dataset metadata (/meta), never the other date's range, the last
  // screen or a filtered response (D12/D15)
  const bounds = dash.meta?.basis_bounds?.[scope.date_basis] ?? null;
  const dataMin = bounds ? bounds.min : dash.meta?.data_min ?? null;
  const dataMax = bounds ? bounds.max : dash.meta?.data_max ?? null;
  const apply = useCallback((): boolean => {
    const err = validateRange(draft.start, draft.end, dataMin, dataMax);
    setDateError(err);
    if (err) { showToast(err); return false; } // the draft, the popover/drawer and the focus stay as they are
    // dates/region/law from the draft; the other applied conditions stay (a new region replaces the map range)
    const next = { ...scopeFromDraft(draft, scope), agency_key: scope.agency_key, manager_key: scope.manager_key,
      bbox: draft.region_code !== scope.region_code ? null : scope.bbox };
    // DT-04: basis, dates and the other drawer conditions land together in ONE scope change (one request)
    if (next.date_basis !== scope.date_basis) {
      basisExplicit.current = true;
      if (sessionKey) writeBasisPref(sessionKey, next.date_basis);
    }
    requestScope(next, 'explicit');
    pushUrl(next);
    setDrawer(false);
    return true;
  }, [draft, scope, dataMin, dataMax, showToast, requestScope, sessionKey]); // eslint-disable-line react-hooks/exhaustive-deps
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
  // DT-03: the drawer always opens on the APPLIED conditions (a cancelled draft never survives a reopen)
  const openDrawer = useCallback(() => { setDraft(draftFromScope(scope)); setDateError(null); setDrawer(true); }, [scope]);
  /** U01 top selector: the new basis with the APPLIED dates at once (one request); typed-but-unapplied dates stay */
  const changeBasis = (basis: DateBasis) => {
    if (basis === scope.date_basis) return;
    basisExplicit.current = true;
    const next = { ...scope, date_basis: basis };
    requestScope(next, 'explicit');
    setDraft((d) => ({ ...d, date_basis: basis }));
    pushUrl(next);
    if (sessionKey) writeBasisPref(sessionKey, basis);
  };
  const changeDraft = useCallback((d: DraftFilters) => { setDraft(d); setDateError(null); }, []);

  const share = useCallback(async () => {
    const url = `${window.location.origin}${window.location.pathname}?${scopeToSearch(scope, { fixture: dataMode === 'demo' && fixture !== 'overview' ? fixture : null })}`;
    try {
      await navigator.clipboard.writeText(url);
      showToast('지금 보는 화면의 링크를 복사했습니다.');
    } catch {
      showToast(`링크: ${url}`);
    }
  }, [scope, fixture, showToast]);

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
    // the following fitBounds is programmatic and never re-inserts a bbox (R04 filter rules).
    // S01: an explicit region move also ends the address selection (the panel shows the region's detail).
    setSelection(null);
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
  // D10: the key of the DISPLAYED snapshot (full scope incl. date_basis, account, version, render mode). A timer or
  // request made for another key is cancelled when the key changes, and a late answer is refused at commit AND merge.
  const shownKey = refineKey(shownScope, version, sessionKey, renderMode);
  const shownKeyRef = useRef(shownKey);
  shownKeyRef.current = shownKey;
  const refineGen = useRef(0);
  useEffect(() => {
    refineGen.current += 1;
    window.clearTimeout(refineTimer.current);
    refineAbort.current?.abort();
    refineAbort.current = null;
    setRefined(null);
  }, [shownKey, shown]);
  const onView = (b: [number, number, number, number], zoom: number) => {
    window.clearTimeout(refineTimer.current);
    // pin refinement exists in the points (신고 수) mode only; a rate map never asks for or draws pins (R7)
    if (renderMode !== 'points' || !hasAggregates || !shownScope || !version || zoom >= CLUSTER_LEVEL) { if (refined) setRefined(null); return; }
    const key = shownKey, gen = refineGen.current, askScope = shownScope, askVersion = version;
    refineTimer.current = window.setTimeout(() => {
      if (gen !== refineGen.current || key !== shownKeyRef.current) return; // conditions changed while waiting
      refineAbort.current?.abort();
      const ac = new AbortController();
      refineAbort.current = ac;
      loadPlacesInView(askScope, roundBbox(b), askVersion, ac.signal)
        .then((r) => {
          // a late answer for other conditions (basis, dates, account, version, rate metric) is dropped
          if (ac.signal.aborted || gen !== refineGen.current || key !== shownKeyRef.current || renderModeRef.current !== 'points') return;
          setRefined({ view: b, points: r.points, key });
        })
        .catch(() => undefined); // display refinement only: the compacted nodes stay drawn
    }, 600);
  };
  const mapPoints = useMemo(() => {
    const base = data?.points ?? [];
    if (!refined || refined.key !== shownKey) return base;
    const keep = base.filter((pt) => !(pt.aggregate && pt.bbox && intersects(pt.bbox, refined.view)));
    const keys = new Set(keep.map((pt) => pt.key));
    return [...keep, ...refined.points.filter((pt) => !keys.has(pt.key))];
  }, [data, refined, shownKey]);

  // ── S02: one toggle / one clear for the map pin, the place list, the panel button, Esc and a blank map click ──
  const togglePlace = useCallback((key: string | null) => setSelection((cur) => (key === null || cur === key ? null : key)), []);
  const clearPlace = useCallback(() => setSelection(null), []);

  // ── place selection (R05): its own request, never a dashboard refetch; A→B races are dropped ──────────
  const point: PublicPoint | null = useMemo(() => mapPoints.find((pt) => pt.key === selection) ?? null, [mapPoints, selection]);
  const lastPoint = useRef<PublicPoint | null>(null);
  const lastKpi = useRef<{ key: string; label: string; overview: NonNullable<DashboardData['overview']> } | null>(null);
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
    placeMoreAbort.current?.abort();
    setPlaceMore(null);
    setPlaceDetail({ status: 'loading' });
    loadPlace(shownScope, selection, version, ac.signal, placeLimit.current)
      .then((detail) => { if (!ac.signal.aborted) setPlaceDetail({ status: 'ready', detail }); })
      .catch((e: unknown) => {
        if (ac.signal.aborted) return;
        setPlaceDetail(e instanceof PublicApiError && e.status === 404
          ? { status: 'error', message: '이 주소는 지금 조건의 결과에 없습니다.' }
          : { status: 'error', message: '이 주소의 기관·담당자를 불러오지 못했습니다.' });
      });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, point?.place_key, shownScope, version, placeReload]);
  const placeMoreKey = `${selection}|${JSON.stringify(shownScope)}|${version}`;
  const loadMorePlaceManagers = (total: number) => {
    if (!selection || !shownScope || !version) return;
    const key = placeMoreKey, scopeNow = shownScope, sel = selection, ver = version;
    const limit = Math.min(1000, total);
    placeMoreAbort.current?.abort();
    const ac = new AbortController();
    placeMoreAbort.current = ac;
    setPlaceMore({ key, state: 'loading' });
    loadPlace(scopeNow, sel, ver, ac.signal, limit)
      .then((detail) => {
        if (ac.signal.aborted) return;
        placeLimit.current = limit;
        setPlaceDetail({ status: 'ready', detail });
        setPlaceMore(null);
      })
      .catch(() => { if (!ac.signal.aborted) setPlaceMore({ key, state: 'error' }); });
  };

  const resolvedTheme: 'dark' | 'light' = resolveTheme(theme);

  // ── personal comparison: same DISPLAYED scope/version as the public numbers ───────────────────────────
  const compareDisabledReason = auth.status === 'unconfigured' ? (auth.message ?? '지금은 로그인 기능을 쓸 수 없습니다.') : null;
  const briefingHidden = briefing && compareOn && !briefingShowMine;
  const compareActive = compareOn && !compareDisabledReason && !briefingHidden && !!data && !unsupported;
  const rawPersonal = usePersonalCompare(shownScope ?? scope, version, compareActive);
  const personal: PersonalState = rawPersonal.status === 'ready' && rawPersonal.data && data && !consistentWithPublic(rawPersonal.data, data.overview)
    ? { status: 'error', data: null, retry: rawPersonal.retry,
      error: { code: 'DATASET_CHANGED', message: '그사이 새 자료가 들어왔습니다. 다시 불러와 주세요.', retryAfter: null } }
    : rawPersonal;
  const compareData = personal.status === 'ready' ? personal.data : null;
  const showMine = compareOn && !compareDisabledReason && !briefingHidden;

  const changeCompare = (on: boolean) => { setCompareOn(on); writeComparePref(on); };
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
  if (scope.start !== base.start || scope.end !== base.end || scope.date_basis !== base.date_basis) {
    chips.push({ id: 'dates', kind: '기간', label: `${DATE_BASIS_LABEL[scope.date_basis]} 기준 ${fmtDate(scope.start)} — ${fmtDate(scope.end)}`,
      onRemove: () => explicit({ ...scope, start: base.start, end: base.end }) });
  }
  if (scope.category !== 'all') chips.push({ id: 'category', kind: '분류', label: CATEGORY_LABEL[scope.category], onRemove: () => explicit({ ...scope, category: 'all' }) });
  if (scope.region_code) chips.push({ id: 'region', kind: '지역', label: regionLabel(scope.region_code), onRemove: () => pickRegion(null) });
  if (scope.law) chips.push({ id: 'law', kind: '법규', label: lawLabel(scope.law), onRemove: () => explicit({ ...scope, law: null }) });
  if (scope.agency_key && !scope.manager_key) chips.push({ id: 'agency', kind: '기관', label: agencyName(scope.agency_key), onRemove: () => explicit({ ...scope, agency_key: null, manager_key: null }) });
  if (scope.manager_key) chips.push({ id: 'manager', kind: '담당자', label: managerName(scope.agency_key, scope.manager_key), onRemove: () => explicit({ ...scope, manager_key: null }) });
  if (scope.bbox) chips.push({ id: 'bbox', kind: '지도 범위', label: autoRefresh ? '지도에 보이는 범위(자동)' : '마지막으로 적용한 지도 범위', onRemove: () => explicit({ ...scope, bbox: null }) });
  const filterCount = chips.filter((c) => c.id !== 'dates').length;
  const unapplied = draft.date_basis !== scope.date_basis || draft.start !== scope.start || draft.end !== scope.end || draft.region_code !== scope.region_code || (draft.law ?? null) !== (scope.law ?? null);
  // same range + another basis = another condition: every label names the basis (U01 1.3)
  const scopeLabel = (s: Scope | null) => (s ? `${DATE_BASIS_LABEL[s.date_basis]} ${fmtDate(s.start)} — ${fmtDate(s.end)} · ${regionLabel(s.region_code)}${s.category !== 'all' ? ` · ${CATEGORY_LABEL[s.category]}` : ''}${s.law ? ` · ${lawLabel(s.law)}` : ''}${s.bbox ? ' · 지도 범위' : ''}${s.agency_key ? ` · ${s.manager_key ? managerName(s.agency_key, s.manager_key) : agencyName(s.agency_key)}` : ''}` : '');

  // ── S10: what the page is waiting for, reported from the real request state (display only) ─────────────
  const displayedText = shownScope ? scopeLabel(shownScope) : null;
  const dashActivity: QueryActivity | null = dash.access ? null
    : dash.wait === 'rate_limit' ? { resource: 'dashboard', phase: 'retry_wait', label: '요청이 많아 잠시 기다리는 중', retryAt: dash.pausedUntil, displayedLabel: displayedText }
      : dash.fetching ? { resource: 'dashboard', phase: 'fetching', label: shown ? '새 조건으로 통계를 불러오는 중' : '통계를 불러오는 중', displayedLabel: shown ? displayedText : null }
        : dash.wait === 'retry' ? { resource: 'dashboard', phase: 'retry_wait', label: '연결이 불안정해 곧 한 번 더 시도하는 중', displayedLabel: displayedText }
          : dash.wait === 'debounce' ? { resource: 'dashboard', phase: 'scheduled', label: '고른 범위로 바꿀 준비 중', displayedLabel: displayedText }
            : dash.error ? { resource: 'dashboard', phase: 'error', label: '통계를 불러오지 못했습니다' } : null;
  useReportActivity('dashboard', dashActivity, activity);
  useReportActivity('personal', showMine && personal.status === 'loading'
    ? { resource: 'personal', phase: 'fetching', label: '내 신고를 비교하는 중' } : null, activity);
  useReportActivity('place-detail', selection && point && !point.aggregate && placeDetail.status === 'loading'
    ? { resource: 'place-detail', phase: 'fetching', label: '주소 상세를 불러오는 중' } : null, activity);
  // C01: a new account (or signing out) never sees the previous account's selection, address detail, hand-off,
  // pending work or 맞춤 통계 state. The dashboard controller resets itself on the same key (useDashboardData).
  const lastSession = useRef(sessionKey);
  useEffect(() => {
    if (lastSession.current === sessionKey) return;
    const previous = lastSession.current;
    lastSession.current = sessionKey;
    if (previous === null) return; // first settle of the auth check: nothing of another account to forget
    activity.clear();
    setSelection(null);
    setPlaceDetail({ status: 'loading' });
    setRefined(null);
    setEntityNames(new Map());
    setScopeManagers(null);
    placeMoreAbort.current?.abort();
    setPlaceMore(null);
    setHandoff(null);
    refineAbort.current?.abort();
  }, [activity, sessionKey]);
  useEffect(() => { if (auth.status === 'signed_out') clearStatsSession(); }, [auth.status]);
  // U01: without an explicit basis in the URL, this account's saved basis applies once (else the default 답변일)
  useEffect(() => {
    if (!sessionKey || basisExplicit.current) return;
    basisExplicit.current = true;
    const pref = readBasisPref(sessionKey);
    if (!pref || pref === scope.date_basis) return;
    const next = { ...scope, date_basis: pref };
    requestScope(next, 'explicit');
    setDraft((d) => ({ ...d, date_basis: pref }));
    replaceUrl(next);
  }, [sessionKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { dropLegacyStatsStorage(); }, []);

  // ── S04: 맞춤 통계 screen and the hand-off of the DISPLAYED conditions (never a half-requested scope) ─────
  const goStatistics = (recipe?: StatsRecipe) => {
    if (recipe) setHandoff((h) => ({ id: (h?.id ?? 0) + 1, recipe }));
    setStatsOpened(true);
    setScreen('statistics');
    pushUrl(scope, 'statistics');
    window.scrollTo({ top: 0 });
  };
  const goDashboard = (section?: string) => {
    if (section) lockSpy();
    if (screen !== 'dashboard') {
      setScreen('dashboard');
      pushUrl(scope, 'dashboard');
      scrollToSectionWhenReady(section ?? 'mapsection');
    } else if (section) scrollToSection(section);
    if (section) setNav(section);
  };
  const statsFromScope = (origin: string, extra: Parameters<typeof handoffRecipe>[1] extends infer O ? Omit<O & object, 'origin'> : never = {}) => {
    if (!shownScope) return;
    goStatistics(handoffRecipe(shownScope, { origin, ...extra }));
  };
  // D09/EX-03: the month of the SELECTED basis (신고월 / 답변월) with the same basis in the recipe
  const statsFromTrend = (rates: TrendRate[]) => statsFromScope('월별 추이', {
    rows: [shownScope?.date_basis === 'report_date' ? 'report_month' : 'completed_month'], columns: [], metrics: rates.map((r) => TREND_RATE_METRIC_ID[r]),
    population: showMine && personal.status === 'ready' ? 'compare' : 'all',
  });
  const scopeChips = (s: Scope): ScopeChip[] => {
    const out: ScopeChip[] = [];
    if (s.category !== 'all') out.push({ id: 'category', kind: '분류', label: CATEGORY_LABEL[s.category], remove: (x) => ({ ...x, category: 'all' }) });
    if (s.region_code) out.push({ id: 'region', kind: '지역', label: regionLabel(s.region_code), remove: (x) => ({ ...x, region_code: null }) });
    if (s.law) out.push({ id: 'law', kind: '법규', label: lawLabel(s.law), remove: (x) => ({ ...x, law: null }) });
    if (s.agency_key && !s.manager_key) out.push({ id: 'agency', kind: '기관', label: agencyName(s.agency_key), remove: (x) => ({ ...x, agency_key: null, manager_key: null }) });
    if (s.manager_key) out.push({ id: 'manager', kind: '담당자', label: managerName(s.agency_key, s.manager_key), remove: (x) => ({ ...x, manager_key: null }) });
    if (s.bbox) out.push({ id: 'bbox', kind: '지도 범위', label: '적용한 지도 범위', remove: (x) => ({ ...x, bbox: null }) });
    return out;
  };
  const [scopeManagers, setScopeManagers] = useState<{ key: string; rows: PublicEntity[]; total: number; more: ManagerPaging } | null>(null);
  const conditionsText = (s: Scope | null) => (s ? scopeChips(s).map((c) => `${c.kind} ${c.label}`).join(' · ') : '');
  /** F06: 조회 조건 rows of a dashboard card file (the DISPLAYED scope, fixed dates) */
  const exportConditions = (s: Scope, address?: string) => [
    { label: '날짜 기준', value: DATE_BASIS_LABEL[s.date_basis] },
    { label: '기간', value: `${s.start} — ${s.end}${partialNote(s)}` },
    ...(version ? [{ label: '자료 버전', value: version }] : []),
    { label: '대상 범위', value: scopeChips(s).filter((c) => c.id !== 'bbox').map((c) => `${c.kind} ${c.label}`).join(' · ') || '전국 · 모든 분류' },
    ...(s.bbox ? [{ label: '지도 범위', value: `지도에서 고른 범위 (경도 ${s.bbox[0]}~${s.bbox[2]}, 위도 ${s.bbox[1]}~${s.bbox[3]})` }] : []),
    ...(address ? [{ label: '주소', value: address }] : []),
  ];

  /** D12: a range that covers only part of its first/last calendar month says so (never shown as a full month) */
  function partialNote(s: Scope): string {
    const last = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);
    const parts: string[] = [];
    if (s.start.slice(8) !== '01') parts.push(`첫 달은 ${fmtDate(s.start)}부터`);
    if (s.end !== last(s.end.slice(0, 7))) parts.push(`마지막 달은 ${fmtDate(s.end)}까지`);
    return parts.length ? ` · 일부 기간: ${parts.join(', ')}` : '';
  }

  const accessCode = dash.access?.code && (ACCESS_CODES as readonly string[]).includes(dash.access.code) ? dash.access.code as AccessCode : null;
  if (accessCode && screen !== 'rankings') {
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
  // D12: the latest data day of the basis is told apart from today (never "this month in progress" for old data)
  const today = data?.meta.today_kst ?? null;
  const freshness = dataMax && today && dataMax < today && scope.end > dataMax ? ` · 최근 자료 ${fmtDate(dataMax)}` : '';

  // ── U02: the focus of the key-figure strip ─────────────────────────────────────────────────────────────
  const placeFocus = !!point && !point.aggregate;
  const placeReady = placeFocus && placeDetail.status === 'ready' && placeDetail.detail.place.key === point!.key &&
    !!shownScope && sameScope(placeDetail.detail.scope, shownScope) && !!placeDetail.detail.overview;
  const kpiFocus: KpiFocus = placeFocus
    ? { kind: 'place', label: point!.address ?? '선택한 주소', basis: shownScope?.date_basis ?? scope.date_basis, start: shownScope?.start ?? scope.start, end: shownScope?.end ?? scope.end }
    : { kind: shownScope?.bbox ? 'bbox' : shownScope?.region_code ? 'region' : 'nation',
      label: `${regionLabel(shownScope?.region_code ?? null)}${shownScope?.bbox ? ` × ${autoRefresh ? '지도에 보이는 범위' : '마지막으로 적용한 지도 범위'}` : ''}`,
      basis: shownScope?.date_basis ?? scope.date_basis, start: shownScope?.start ?? scope.start, end: shownScope?.end ?? scope.end };
  const focusKey = `${kpiFocus.kind}|${kpiFocus.label}|${refineKey(shownScope, version, sessionKey, '')}`;
  const readyOverview = placeFocus ? (placeReady && placeDetail.status === 'ready' ? placeDetail.detail.overview ?? null : null) : data?.overview ?? null;
  // KP-05/06: while the new focus loads, the strip keeps the LAST figures but names their target (never a new title
  // over old numbers, never national values under an address)
  if (readyOverview && !(dash.isRefreshing && !placeFocus)) lastKpi.current = { key: focusKey, label: kpiFocus.label, overview: readyOverview };
  const kpiState: 'ready' | 'loading' | 'error' = placeFocus
    ? (placeReady ? 'ready' : placeDetail.status === 'error' ? 'error' : 'loading')
    : dash.isRefreshing ? 'loading' : 'ready';
  const kpiOverview = kpiState === 'ready' ? readyOverview : lastKpi.current?.overview ?? null;
  const kpiStale = kpiState !== 'ready' && lastKpi.current ? (dash.isRefreshing && !placeFocus ? scopeLabel(shownScope) : lastKpi.current.label) : null;
  const err = dash.error;
  const errText = err ? `${err.status === 429 ? '요청이 많아 잠시 기다리는 중입니다' : err.message}${err.status === 429 && err.retryAfter ? ` · ${err.retryAfter}초 뒤 최신 범위로 자동으로 다시 불러옵니다` : ''}` : null;
  const entitiesLive = entitiesAvailable() && !(dataMode === 'demo' && (fixture === 'one' || fixture === 'empty'));
  const analytics = data?.analytics ?? null;

  return (
    <ActivityContext.Provider value={activity}>
      <TopBar
        theme={theme}
        onTheme={setTheme}
        briefing={briefing}
        onBriefing={() => setBriefing((v) => !v)}
        dataStamp={stamp}
        sample={data?.meta.sample ?? false}
        account={<AccountMenu auth={auth} onSignIn={signIn} onSignOut={signOut} briefing={briefing} />}
        status={<GlobalQueryStatus />}
      />
      <div className="app">
        <Rail active={nav} screen={screen} onSection={goDashboard} onStatistics={() => goStatistics()}
          onRankings={() => { setScreen('rankings'); pushUrl(scope, 'rankings'); window.scrollTo({ top: 0 }); }}
          onAbout={() => goDashboard('guide')} />
        <main id="main" data-screen={screen}>
          <div className="dashboard-screen" hidden={screen !== 'dashboard'}>
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
            region={scope.region_code}
            onRegion={pickRegion}
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
            basis={scope.date_basis}
            onBasis={changeBasis}
            extra={(
              <ViewControls compareOn={compareOn} onCompare={changeCompare} compareDisabledReason={compareDisabledReason}
                briefingHidden={briefingHidden} />
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
              {/* U02: ONE key-figure strip above the map (always in place); its focus is the selected address or the
                  applied region / map range / nation. U04: one responsive layout — the map host is never re-parented. */}
              <div id="mapsection" className="dash-stack">
              <KpiPanel
                focus={kpiFocus}
                overview={kpiOverview}
                state={kpiState}
                staleFocus={kpiStale}
                errorText={placeFocus && placeDetail.status === 'error' ? placeDetail.message : null}
                personal={personal}
                showMine={showMine}
                placeMine={placeFocus && point ? { reports: marks.get(point.key)?.mineCount ?? 0 } : null}
                unsupported={unsupported}
                detail={(
                  <>
                    <CompareKpis overview={data.overview} personal={personal} compareOn={showMine} auth={auth} onSignIn={signIn} unsupported={unsupported} />
                    {showMine && <ManagerCompare personal={personal} onPick={pickCompareEntity} />}
                  </>
                )}
              />
              <div className={`dash-grid${err && shownScope && JSON.stringify(shownScope) !== JSON.stringify(scope) ? ' stale' : ''}`} data-selected={point ? 'place' : 'none'}>
                <div className="area-map">
                  <MapPanel
                    points={mapPoints}
                    selectedKey={selection}
                    onSelect={togglePlace}
                    onBlankClick={clearPlace}
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
                  <CoupangAd id="1034404" width={1030} height={250} minScale={0.6} className="ad-map" />
                </div>
                <div className="area-side">
                  {point ? (
                    <PlaceDetailsPanel
                      point={point}
                      detail={point.aggregate ? { status: 'unsupported' } : placeDetail}
                      scopeLabel={scopeLabel(shownScope)}
                      mark={showMine ? marks.get(point.key) ?? null : null}
                      onClose={clearPlace}
                      onRetry={() => setPlaceReload((n) => n + 1)}
                      onPickEntity={pickEntity}
                      toast={showToast}
                      activeAgency={scope.agency_key}
                      activeManager={scope.manager_key}
                      onBreadcrumb={pickRegion}
                      appliedRegion={shownScope?.region_code ?? null}
                      onMakeStatistics={point.aggregate ? undefined : () => statsFromScope('선택한 주소', { placeKey: point.place_key ?? point.key, placeLabel: point.address })}
                    />
                  ) : shownScope && version ? (
                    <ScopeDetailsPanel
                      scope={shownScope}
                      data={data}
                      version={version}
                      autoRefresh={autoRefresh}
                      busy={dash.isRefreshing}
                      onPickRegion={pickRegion}
                      onPickEntity={pickEntity}
                      onMakeStatistics={() => statsFromScope('선택 범위')}
                      activeAgency={scope.agency_key}
                      activeManager={scope.manager_key}
                      conditions={conditionsText(shownScope)}
                      onManagers={(rows, total, more) => setScopeManagers({ key: `${JSON.stringify(shownScope)}|${version}`, rows, total, more })}
                    />
                  ) : null}
                  {point && !point.aggregate && placeDetail.status === 'ready' && placeDetail.detail.place.key === point.key && (
                    <PlaceEntityChart
                      key={point.key}
                      exportCtx={shownScope ? { conditions: exportConditions(shownScope, point.address ?? '선택한 주소'), datasetVersion: version,
                        blocked: dash.isRefreshing ? '새 결과를 불러오는 중이라 잠시 뒤에 받을 수 있습니다' : null } : undefined}
                      managers={placeDetail.detail.managers}
                      total={placeDetail.detail.manager_total}
                      theme={resolvedTheme}
                      loadingMore={placeMore?.key === placeMoreKey && placeMore.state === 'loading'}
                      loadError={placeMore?.key === placeMoreKey && placeMore.state === 'error'}
                      loadStep={Math.max(0, Math.min(1000, placeDetail.detail.manager_total) - placeDetail.detail.managers.length)}
                      onLoadMore={Math.min(1000, placeDetail.detail.manager_total) > placeDetail.detail.managers.length
                        ? () => loadMorePlaceManagers(placeDetail.detail.manager_total) : null}
                    />
                  )}
                  {!point && shownScope && version && scopeManagers?.key === `${JSON.stringify(shownScope)}|${version}` && scopeManagers.rows.length > 0 && (
                    <PlaceEntityChart
                      key={scopeManagers.key}
                      title="이 범위의 담당자별 처리 현황"
                      exportCtx={{ conditions: exportConditions(shownScope), datasetVersion: version, blocked: dash.isRefreshing ? '새 결과를 불러오는 중이라 잠시 뒤에 받을 수 있습니다' : null }}
                      managers={scopeManagers.rows}
                      total={scopeManagers.total}
                      theme={resolvedTheme}
                      loadingMore={scopeManagers.more.state === 'loading'}
                      loadError={scopeManagers.more.state === 'error'}
                      loadStep={scopeManagers.more.pageSize}
                      onLoadMore={scopeManagers.total > scopeManagers.rows.length ? scopeManagers.more.load : null}
                    />
                  )}
                </div>
              </div>
              </div>
              {/* KP-04: the tables and charts below always describe the APPLIED scope (never the selected address) */}
              <p className="scope-strip" role="note">아래 표와 그래프: {scopeLabel(shownScope)}{freshness}</p>
              {/* U05: 위반법규별 현황 (left) | 기관·담당자 처리 결과 (right), then 월별 추이 | 답변까지 걸린 기간 */}
              <section className="area-pair area-tables-top" aria-label="표로 보는 현황">
                <LawTable laws={data.laws} activeLaw={scope.law} onPickLaw={pickLaw} scope={shownScope} version={version} serverList={entitiesLive} />
                {shownScope && version && (
                  <EntityTable scope={shownScope} version={version} agencies={data.agencies} managers={data.managers}
                    tab={entityTab} onTab={setEntityTab} onPick={pickEntity} mine={showMine ? entityMine : null}
                    serverList={entitiesLive} activeAgency={scope.agency_key} activeManager={scope.manager_key} />
                )}
              </section>
              <section className="area-pair" id="analytics" aria-label="데이터로 보는 신고 현황">
                <TrendCard monthly={data.monthly} basis={shownScope?.date_basis ?? scope.date_basis} theme={resolvedTheme} mine={showMine ? compareData?.monthly ?? null : null}
                  exportCtx={shownScope ? { conditions: exportConditions(shownScope), datasetVersion: version } : undefined}
                  mineState={!showMine ? 'off' : personal.status === 'ready' ? 'ready'
                    : personal.status === 'loading' || personal.status === 'waiting' ? 'loading'
                      : personal.status === 'signed_out' || personal.status === 'unconfigured' ? 'signed_out' : 'error'}
                  busy={dash.isRefreshing} onMakeStatistics={statsFromTrend} />
                <DurationCard all={analytics?.duration ?? null} mine={showMine ? compareData?.analytics?.duration ?? null : null} theme={resolvedTheme} />
              </section>
              <section className="area-charts" aria-label="더 보는 그래프">
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
              <section className="area-tables" aria-label="지역과 차량">
                <RegionList regions={data.regions} compare={showMine ? compareData?.regions ?? null : null} compareOn={showMine}
                  interest={interest} onToggleInterest={flipInterest} activeRegion={scope.region_code} onPickRegion={pickRegion} />
                <VehicleTop5 vehicles={data.vehicles} totalScope={data.vehicle_total_scope_reports} identifiable={data.vehicle_identifiable_reports} toast={showToast} />
              </section>
              <DataGuide data={data} />
            </>
          )}
          </div>
          <RankingsPage key={`rankings-${sessionKey}`} active={screen === 'rankings'} />
          {statsOpened && sessionKey !== null && (
            <StatisticsPage key={sessionKey} active={screen === 'statistics'} handoff={handoff} fallbackScope={shownScope} version={version}
              viewer={sessionKey} canMine={dataMode === 'demo' || auth.status === 'signed_in'} theme={resolvedTheme}
              scopeChips={scopeChips} onBack={goDashboard} shared={sharedRecipe} onSharedDone={() => setSharedRecipe(null)} onSignIn={signIn} />
          )}

          <footer className="page-footer">
            <span>나만의 안전신문고 <b>커뮤니티 신고 지도</b>{dataMode === 'demo' ? ' · 예시 데이터' : ''}</span>
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
    </ActivityContext.Provider>
  );
}
