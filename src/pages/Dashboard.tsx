import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type DashboardData, type PublicEntity, type PublicLaw, type PublicPoint, type Scope } from '../domain/public';
import { ACCESS_CODES, PublicApiError, dataMode, entitiesAvailable, loadDashboard, loadEntities, type AccessCode, type EntitySortKey, type SortDir } from '../data/client';
import AccessGate from '../components/AccessGate';
import {
  CATEGORY_LABEL, baseScope, draftFromScope, fixtureFromSearch, lawLabel, lawOptions, regionCounts, regionLabel, scopeFromDraft,
  scopeFromSearch, scopeToSearch, validateRange, type DraftFilters, type EntityTab, type MapMetric, type ThemeMode,
} from '../state/filters';
import TopBar from '../components/TopBar';
import Rail from '../components/Rail';
import CommandBar from '../components/CommandBar';
import FilterDrawer from '../components/FilterDrawer';
import MapPanel from '../components/MapPanel';
import InsightPanel from '../components/InsightPanel';
import TrendCard from '../components/TrendCard';
import OutcomeCard from '../components/OutcomeCard';
import VehicleTop5 from '../components/VehicleTop5';
import EntityTable, { type ServerEntityState } from '../components/EntityTable';
import LawTable from '../components/LawTable';
import DataGuide from '../components/DataGuide';
import { acceptRate, fmtDate, fmtInt, fmtPercent, partialRate } from '../components/format';
import CompareKpis from '../components/CompareKpis';
import RegionList from '../components/RegionList';
import ManagerCompare from '../components/ManagerCompare';
import AccountMenu from '../components/AccountMenu';
import ViewControls from '../components/ViewControls';
import { useMapAuth, usePersonalCompare, type PersonalState, type PersonalStatus } from '../hooks/usePersonal';
import { consistentWithPublic } from '../data/personal';
import {
  readComparePref, readInterest, toggleInterest, viewFromSearch, writeComparePref, writeInterest,
  type PointFilter, type ViewMode,
} from '../state/view';
import { filterPoints, markPoints } from '../state/pointMarks';
import { demoViewerFromSearch } from '../auth/mapAuth';
import type { CompareEntityRow } from '../domain/personal';

type LoadState = 'loading' | 'ready' | 'error';

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

// Map-mode one-line statistics summary (§5.2): the full tables stay in the other views,
// so this strip shows only R · C · 수용% for all/mine. Display only — no scope change.
function MapSummary({ reportAll, completedAll, acceptAll, partialAll, showMine, personalStatus, mineReport, mineCompleted, mineAccept, minePartial }: {
  reportAll: number | null;
  completedAll: number | null;
  acceptAll: number | null;
  partialAll: number | null;
  minePartial: number | null;
  showMine: boolean;
  personalStatus: PersonalStatus;
  mineReport: number | null;
  mineCompleted: number | null;
  mineAccept: number | null;
}) {
  const mineText = !showMine ? null
    : personalStatus === 'ready' ? (
      <>내 신고 <b className="cm-number mine-col">{fmtInt(mineReport)}</b> · 답변 <b className="cm-number mine-col">{fmtInt(mineCompleted)}</b> · 수용률 <b className="cm-number mine-col">{fmtPercent(mineAccept)}</b> · 일부수용률 <b className="cm-number mine-col">{fmtPercent(minePartial)}</b></>
    )
    : personalStatus === 'loading' || personalStatus === 'waiting' ? <span className="cm-muted">내 신고 불러오는 중…</span>
    : personalStatus === 'signed_out' ? <span className="cm-muted">로그인하면 내 신고도 보입니다</span>
    : personalStatus === 'unconfigured' ? <span className="cm-muted">지금은 로그인할 수 없습니다</span>
    : <span className="cm-muted">내 신고를 불러오지 못했습니다</span>;
  return (
    <p className="map-summary" aria-label="요약">
      <span>전체 신고 <b className="cm-number">{fmtInt(reportAll)}</b> · 답변 <b className="cm-number">{fmtInt(completedAll)}</b> · 수용률 <b className="cm-number">{fmtPercent(acceptAll)}</b> · 일부수용률 <b className="cm-number">{fmtPercent(partialAll)}</b></span>
      {mineText != null && <span className="map-summary-mine">{mineText}</span>}
    </p>
  );
}

// AF-MAP2: empty only when neither indicator has rows and no map point exists, so a
// completion-only range still shows its result screen instead of the empty banner.
export function isEmptyResult(data: DashboardData | null): boolean {
  if (!data) return false;
  return data.overview.report_count.value === 0 &&
    data.overview.completed_count.value === 0 &&
    data.points.length === 0;
}

export default function Dashboard() {
  const [scope, setScope] = useState<Scope>(() => scopeFromSearch(window.location.search, baseScope(dataMode)));
  const [draft, setDraft] = useState<DraftFilters>(() => draftFromScope(scopeFromSearch(window.location.search, baseScope(dataMode))));
  const [fixture, setFixture] = useState(() => dataMode === 'demo' ? fixtureFromSearch(window.location.search) : 'overview');
  const [data, setData] = useState<DashboardData | null>(null);
  // laws offered by the filter: the law rows of the last load WITHOUT a law filter (a filtered load only has its own row)
  const [lawCatalog, setLawCatalog] = useState<PublicLaw[] | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [apiError, setApiError] = useState<{ message: string; retryAfter: number | null; code?: string | null } | null>(null);
  const [theme, setTheme] = useState<ThemeMode>(initialTheme);
  const [briefing, setBriefing] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [selection, setSelection] = useState<string | null>(null);
  const [mapMetric, setMapMetric] = useState<MapMetric>('reports');
  const [entityTab, setEntityTab] = useState<EntityTab>('agency');
  // SOL-08: full /entities browsing in live mode; the dashboard top-100 arrays stay summary-only.
  const ENTITY_PAGE_SIZE = 20;
  const [entityQ, setEntityQ] = useState('');
  const [entitySort, setEntitySort] = useState<EntitySortKey>('completed');
  const [entityDir, setEntityDir] = useState<SortDir>('desc');
  const [entityPage, setEntityPage] = useState(1);
  const [entityItems, setEntityItems] = useState<PublicEntity[]>([]);
  const [entityTotal, setEntityTotal] = useState(0);
  const [entityLoading, setEntityLoading] = useState(false);
  const [entityError, setEntityError] = useState<string | null>(null);
  const [entityReload, setEntityReload] = useState(0);
  const entitiesLive = entitiesAvailable();
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [nav, setNav] = useState('mapsection');
  const [dateError, setDateError] = useState<string | null>(null);
  // personal comparison (docs/personal-comparison.md)
  const [view, setView] = useState<ViewMode>(() => viewFromSearch(window.location.search));
  const [compareOn, setCompareOn] = useState<boolean>(readComparePref);
  const [briefingShowMine, setBriefingShowMine] = useState(false);
  const [interest, setInterest] = useState<string[]>(readInterest);
  const [pointFilter, setPointFilter] = useState<PointFilter>('all');
  const { auth, signIn, signOut } = useMapAuth();
  const demoMe = dataMode === 'demo' ? demoViewerFromSearch(window.location.search) : null;
  const toastTimer = useRef<number | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3400);
  }, []);

  // theme
  useEffect(() => {
    const resolved = resolveTheme(theme);
    document.documentElement.dataset.theme = resolved;
    try {
      localStorage.setItem('cm-theme', theme);
    } catch { /* ignore */ }
  }, [theme]);
  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => {
      document.documentElement.dataset.theme = mq.matches ? 'light' : 'dark';
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);

  // briefing + Esc
  useEffect(() => {
    document.body.classList.toggle('briefing', briefing);
    // Briefing (projector) hides personal data by default; opting in lasts only for this briefing.
    setBriefingShowMine(false);
  }, [briefing]);
  useEffect(() => {
    document.body.dataset.view = view;
    // View changes resize the map card: ask the map adapter to re-measure after paint.
    // No data is refetched here (loads are keyed on scope/fixture only).
    const t = window.setTimeout(() => window.dispatchEvent(new Event('resize')), 60);
    return () => window.clearTimeout(t);
  }, [view]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDrawer(false);
        setBriefing(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // data load (also after sign-in/out: while the map is contributor-only the API answers per viewer)
  useEffect(() => {
    if (auth.status === 'loading') return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoadState('loading');
    setApiError(null);
    // fixture changes require a fresh demo load; scope is echoed back by demo adapter
    loadDashboard(scope, ac.signal)
      .then((d) => {
        if (ac.signal.aborted) return;
        setData(d);
        if (!scope.law) setLawCatalog(d.laws);
        setLoadState('ready');
        setSelection((sel) => (sel && d.points.some((pt) => pt.key === sel) ? sel : null));
      })
      .catch((e: unknown) => {
        if (ac.signal.aborted) return;
        if (e instanceof PublicApiError) {
          setApiError({ message: e.message, retryAfter: e.retryAfter, code: e.code });
        } else {
          setApiError({ message: e instanceof Error ? e.message : '통계를 불러오지 못했습니다.', retryAfter: null });
        }
        setLoadState('error');
      });
    return () => ac.abort();
  }, [scope, fixture, auth.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // back/forward
  useEffect(() => {
    const onPop = () => {
      const s = scopeFromSearch(window.location.search, baseScope(dataMode));
      setScope(s);
      setDraft(draftFromScope(s));
      setFixture(dataMode === 'demo' ? fixtureFromSearch(window.location.search) : 'overview');
      setView(viewFromSearch(window.location.search));
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // SOL-08: full entity list follows scope/tab/query; page restarts at 1 on any query change.
  useEffect(() => {
    setEntityPage(1);
  }, [scope, entityTab, entityQ, entitySort, entityDir]);

  useEffect(() => {
    // Only browse entities for a dashboard that actually loaded (same version); a not-ready or failed
    // dashboard must not trigger a second failing request.
    if (!entitiesLive || loadState !== 'ready' || !data) return;
    const ac = new AbortController();
    setEntityLoading(true);
    setEntityError(null);
    loadEntities(scope,
      { kind: entityTab, q: entityQ, sort: entitySort, dir: entityDir, page: entityPage, pageSize: ENTITY_PAGE_SIZE },
      data?.meta.dataset_version ?? undefined, ac.signal)
      .then((result) => {
        if (ac.signal.aborted) return;
        setEntityItems(result.items);
        setEntityTotal(result.totalRows);
        setEntityLoading(false);
      })
      .catch((e: unknown) => {
        if (ac.signal.aborted) return;
        setEntityError(e instanceof Error ? e.message : '목록을 불러오지 못했습니다.');
        setEntityLoading(false);
      });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, entityTab, entityQ, entitySort, entityDir, entityPage, entitiesLive, entityReload, data?.meta.dataset_version, loadState]);

  const sortEntities = useCallback((key: EntitySortKey) => {
    if (key === entitySort) setEntityDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    else {
      setEntitySort(key);
      setEntityDir('desc');
    }
  }, [entitySort]);

  const entityServer: ServerEntityState | null = entitiesLive ? {
    items: entityItems, total: entityTotal, page: entityPage, pageSize: ENTITY_PAGE_SIZE,
    loading: entityLoading, error: entityError, q: entityQ, sortKey: entitySort, dir: entityDir,
    onSearch: setEntityQ, onSort: sortEntities, onPage: setEntityPage,
    onRetry: () => setEntityReload((n) => n + 1),
  } : null;

  const urlExtra = (v: ViewMode = view) => ({
    fixture: dataMode === 'demo' && fixture !== 'overview' ? fixture : null, view: v, me: demoMe,
  });
  const pushUrl = (s: Scope, v: ViewMode = view) => {
    const search = scopeToSearch(s, urlExtra(v));
    window.history.pushState(null, '', `${window.location.pathname}${search ? `?${search}` : ''}`);
  };

  const apply = useCallback(() => {
    const err = validateRange(draft.start, draft.end, data?.meta.data_min ?? null, data?.meta.data_max ?? null);
    setDateError(err);
    if (err) {
      showToast(err);
      return;
    }
    const next = scopeFromDraft(draft, scope);
    setScope(next);
    pushUrl(next);
    setDrawer(false);
  }, [draft, scope, data, showToast]); // eslint-disable-line react-hooks/exhaustive-deps

  const reset = useCallback(() => {
    const next: Scope = { ...baseScope(dataMode) };
    setScope(next);
    setDraft(draftFromScope(next));
    setSelection(null);
    setDateError(null);
    pushUrl(next);
    showToast('처음 상태(전국·전체)로 돌아왔습니다.');
  }, [showToast]); // eslint-disable-line react-hooks/exhaustive-deps

  const share = useCallback(async () => {
    // Share URL: public filters + panel view only. Never the personal mode, account or demo login state.
    const url = `${window.location.origin}${window.location.pathname}?${scopeToSearch(scope, { fixture: dataMode === 'demo' && fixture !== 'overview' ? fixture : null, view })}`;
    try {
      await navigator.clipboard.writeText(url);
      showToast('지금 보는 화면의 링크를 복사했습니다.');
    } catch {
      showToast(`링크: ${url}`);
    }
  }, [scope, fixture, view, showToast]);

  const point: PublicPoint | null = useMemo(
    () => data?.points.find((pt) => pt.key === selection) ?? null,
    [data, selection],
  );

  const unsupported = useMemo(() => {
    if (!data) return false;
    return data.overview.report_count.value == null;
  }, [data]);
  const empty = isEmptyResult(data);

  const unsupportedNote = unsupported
    ? dataMode === 'demo'
      ? '이 조건의 예시 자료는 없습니다. 처음 상태로 돌아가면 예시를 볼 수 있습니다.'
      : '이 조건의 통계는 아직 없습니다. 기간이나 지역을 바꿔 보세요.'
    : null;

  const appliedLabel = `${regionLabel(scope.region_code)} · ${CATEGORY_LABEL[scope.category]}${scope.law ? ` · ${lawLabel(scope.law)}` : ''}`;
  const filterCount = (scope.agency_key ? 1 : 0) + (scope.manager_key ? 1 : 0) + (scope.region_code ? 1 : 0) + (scope.category !== 'all' ? 1 : 0) +
    (scope.law ? 1 : 0);
  const appliedChips = [
    `${fmtDate(scope.start)} — ${fmtDate(scope.end)}`,
    CATEGORY_LABEL[scope.category],
    regionLabel(scope.region_code),
    ...(scope.law ? [lawLabel(scope.law)] : []),
    // Names, never internal keys (keys are opaque hashes).
    ...(scope.agency_key ? [data?.agencies.find((a) => a.agency_key === scope.agency_key)?.agency_name ?? '선택한 기관'] : []),
    ...(scope.manager_key ? [data?.managers.find((m) => m.manager_key === scope.manager_key)?.manager_name ?? '선택한 담당자'] : []),
  ];

  const pickEntity = (kind: EntityTab, entity: PublicEntity) => {
    if (!entity.agency_key || (kind === 'manager' && !entity.manager_key)) return;
    const next: Scope = {
      ...scope,
      agency_key: entity.agency_key,
      manager_key: kind === 'manager' ? entity.manager_key : null,
    };
    setScope(next);
    pushUrl(next);
    showToast(dataMode === 'demo' ? '이 기관·담당자만 보도록 바꿨습니다.' : '이 기관·담당자만 보도록 바꿨습니다.');
  };

  const analyzePoint = (pt: PublicPoint) => {
    const bbox: [number, number, number, number] = pt.bbox ?? [pt.lng, pt.lat, pt.lng, pt.lat];
    applyView(bbox);
    showToast(pt.aggregate ? `묶인 ${pt.point_count}곳만 보도록 바꿨습니다.` : '이 장소만 보도록 바꿨습니다.');
  };

  const applyView = (bbox: [number, number, number, number]) => {
    if (JSON.stringify(scope.bbox) === JSON.stringify(bbox)) return;
    const next: Scope = { ...scope, bbox };
    setScope(next);
    pushUrl(next);
    showToast(dataMode === 'demo' ? '지도에 보이는 지역만 보도록 바꿨습니다.' : '지도에 보이는 지역만 보도록 바꿨습니다.');
  };

  const retry = () => {
    setLoadState('loading');
    setApiError(null);
    const ac = new AbortController();
    abortRef.current?.abort();
    abortRef.current = ac;
    loadDashboard(scope, ac.signal)
      .then((d) => {
        if (ac.signal.aborted) return;
        setData(d);
        if (!scope.law) setLawCatalog(d.laws);
        setLoadState('ready');
      })
      .catch((e: unknown) => {
        if (ac.signal.aborted) return;
        setApiError({
          message: e instanceof PublicApiError ? e.message : '통계를 불러오지 못했습니다.',
          retryAfter: e instanceof PublicApiError ? e.retryAfter : null,
          code: e instanceof PublicApiError ? e.code : null,
        });
        setLoadState('error');
      });
  };

  const stamp = data?.meta.data_max ? fmtDate(data.meta.data_max) : fmtDate(baseScope(dataMode).end);
  const resolvedTheme: 'dark' | 'light' = theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : theme;

  // ── personal comparison ────────────────────────────────────────────────────
  const compareDisabledReason = auth.status === 'unconfigured'
    ? (auth.message ?? '지금은 로그인 기능을 쓸 수 없습니다.') : null;
  const briefingHidden = briefing && compareOn && !briefingShowMine;
  const compareActive = compareOn && !compareDisabledReason && !briefingHidden && loadState === 'ready' && !unsupported;
  const rawPersonal = usePersonalCompare(scope, loadState === 'ready' && data ? data.meta.dataset_version : null, compareActive);
  // Never show personal numbers next to public numbers from another scope/version/population.
  const personal: PersonalState = rawPersonal.status === 'ready' && rawPersonal.data && data && !consistentWithPublic(rawPersonal.data, data.overview)
    ? { status: 'error', data: null, retry: rawPersonal.retry,
      error: { code: 'DATASET_CHANGED', message: '통계가 방금 새로 바뀌었습니다. 다시 불러와 주세요.', retryAfter: null } }
    : rawPersonal;
  const compareData = personal.status === 'ready' ? personal.data : null;
  const showMine = compareOn && !compareDisabledReason && !briefingHidden;

  const changeCompare = (on: boolean) => {
    setCompareOn(on);
    writeComparePref(on);
    if (!on) setPointFilter((f) => (f === 'mine' || f === 'shared' ? 'all' : f));
  };
  const changeView = (v: ViewMode) => {
    setView(v);
    pushUrl(scope, v);
  };
  const flipInterest = (code: string) => setInterest((list) => writeInterest(toggleInterest(list, code)));
  const pickRegion = (code: string | null) => {
    // a region replaces the "visible area" condition (both at once would silently narrow to their overlap)
    const next: Scope = { ...scope, region_code: code, bbox: null };
    setScope(next);
    setDraft(draftFromScope(next));
    pushUrl(next);
    showToast(code ? `${regionLabel(code)}만 보도록 바꿨습니다.` : '전체 지역으로 돌아왔습니다.');
  };
  const pickLaw = (law: string | null) => {
    const next: Scope = { ...scope, law };
    setScope(next);
    setDraft(draftFromScope(next));
    pushUrl(next);
    showToast(law ? `${lawLabel(law)}만 보도록 바꿨습니다.` : '모든 법규를 다시 봅니다.');
  };
  const pickCompareEntity = (row: CompareEntityRow) => {
    pickEntity(row.kind, {
      key: row.key, agency_key: row.agency_key, manager_key: row.manager_key, agency_name: row.agency_name,
      manager_name: row.manager_name, completed_count: row.all.completed_count,
      outcomes: { accepted: 0, partial: 0, rejected: 0, result_known: 0, result_unknown: 0 }, fine_count: null,
    });
  };

  const marks = useMemo(
    () => markPoints(data?.points ?? [], compareData?.my_points ?? null, interest),
    [data, compareData, interest],
  );
  const effectiveFilter: PointFilter = (pointFilter === 'mine' || pointFilter === 'shared') && !compareData ? 'all' : pointFilter;
  const shownPoints = useMemo(() => filterPoints(data?.points ?? [], marks, effectiveFilter), [data, marks, effectiveFilter]);
  const entityMine = useMemo(() => {
    if (!compareData) return null;
    return new Map((entityTab === 'agency' ? compareData.agencies : compareData.managers).map((r) => [r.key, r]));
  }, [compareData, entityTab]);
  const regionCountMap = useMemo(() => regionCounts(data?.regions ?? null), [data?.regions]);
  const lawChoices = useMemo(() => lawOptions(lawCatalog, draft.law), [lawCatalog, draft.law]);

  // One instance of each panel; the three view layouts only place them (§5.2). Switching never refetches.
  const mapPanel = data && (
    <MapPanel
      points={shownPoints}
      totalPoints={data.points.length}
      selectedKey={selection}
      onSelect={setSelection}
      metric={mapMetric}
      onMetric={setMapMetric}
      categoryLabel={scope.category === 'all' ? '모든 신고' : CATEGORY_LABEL[scope.category]}
      onApplyView={applyView}
      autoRefresh={autoRefresh}
      onAutoRefresh={setAutoRefresh}
      locationMissing={data.meta.location_missing ?? null}
      marks={marks}
      pointFilter={effectiveFilter}
      onPointFilter={setPointFilter}
      filterAvailable={{ all: true, mine: !!compareData, shared: !!compareData, interest: interest.length > 0 }}
      regions={data.regions}
      activeRegion={scope.region_code}
      onPickRegion={pickRegion}
    />
  );
  const regionList = data && (
    <RegionList
      regions={data.regions}
      compare={showMine ? compareData?.regions ?? null : null}
      compareOn={showMine}
      interest={interest}
      onToggleInterest={flipInterest}
      activeRegion={scope.region_code}
      onPickRegion={pickRegion}
    />
  );
  const insightPanel = data && point && (
    <InsightPanel
      data={data}
      point={point}
      scopeLabel={`${fmtDate(scope.start)} — ${fmtDate(scope.end)} · ${regionLabel(scope.region_code)}`}
      onAnalyzePoint={analyzePoint}
      onPickEntity={pickEntity}
      toast={showToast}
      mark={showMine ? marks.get(point.key) ?? null : null}
      onClose={() => setSelection(null)}
    />
  );
  const compareKpis = data && (
    <CompareKpis
      overview={data.overview}
      personal={personal}
      compareOn={showMine}
      auth={auth}
      onSignIn={signIn}
      unsupported={unsupported}
    />
  );
  const managerCompare = showMine && <ManagerCompare personal={personal} onPick={pickCompareEntity} />;
  const trendCard = data && <TrendCard monthly={data.monthly} theme={resolvedTheme} mine={showMine ? compareData?.monthly ?? null : null} />;

  const accessCode = loadState === 'error' && apiError?.code && (ACCESS_CODES as readonly string[]).includes(apiError.code)
    ? apiError.code as AccessCode : null;
  if (accessCode) {
    // Contributor-only: nothing of the dashboard renders without a readable response (the server refuses the data).
    return (
      <>
        <TopBar theme={theme} onTheme={setTheme} briefing={false} onBriefing={() => undefined} dataStamp="" sample={false}
          account={<AccountMenu auth={auth} onSignIn={signIn} onSignOut={signOut} briefing={false} />} />
        <AccessGate code={accessCode} auth={auth} onSignIn={signIn} onSignOut={signOut} onRetry={retry} />
      </>
    );
  }

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
            <span className="heading-note">이용자들이 공유한 안전신문고 신고를 지역·기관·기간별로 볼 수 있습니다.<br /><span>로그인하면 내 신고와 나란히 비교할 수 있습니다.</span></span>
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
            onDraft={(d) => { setDraft(d); setDateError(null); }}
            appliedLabel={appliedLabel}
            filterCount={filterCount}
            minDate={data?.meta.data_min ?? null}
            maxDate={data?.meta.data_max ?? null}
            onApply={apply}
            onReset={reset}
            onShare={share}
            onOpenDrawer={() => setDrawer(true)}
            dateError={dateError}
            regionCounts={regionCountMap}
            extra={(
              <ViewControls
                compareOn={compareOn}
                onCompare={changeCompare}
                compareDisabledReason={compareDisabledReason}
                briefingHidden={briefingHidden}
                view={view}
                onView={changeView}
              />
            )}
          />

          {loadState === 'loading' && (
            <section className="kpis" aria-label="불러오는 중">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="skeleton" role="status" aria-label="불러오는 중" />
              ))}
            </section>
          )}

          {loadState === 'error' && (
            <div className="banner error" role="alert">
              <span className="grow">
                {apiError?.message ?? '통계를 불러오지 못했습니다.'}
                {apiError?.retryAfter != null && ` (${apiError.retryAfter}초 뒤에 다시 시도해 주세요)`}
              </span>
              <button className="ghost-btn" type="button" onClick={retry}>다시 시도</button>
            </div>
          )}

          {loadState === 'ready' && data && (
            <>
              {(unsupported || empty) && (
                <div className="banner warn" role="note">
                  <span className="grow">
                    {empty
                      ? '고른 조건에 맞는 신고가 아직 없습니다.'
                      : unsupportedNote}
                  </span>
                  <button className="ghost-btn" type="button" onClick={reset}>처음 상태로</button>
                </div>
              )}
              {dataMode === 'demo' && fixture === 'one' && (
                <div className="banner" role="note">
                  <span className="grow">예시: 신고가 1건뿐인 경우의 화면입니다.</span>
                </div>
              )}
              {/* ── view layouts (docs/personal-comparison.md §5.1–5.2, §5.5). ──
                  All three modes reuse the same state/props; switching never refetches. */}
              {view === 'map' ? (
                <section className="mapmode" id="mapsection" aria-label="지도 크게 보기">
                  <MapSummary
                    reportAll={data.overview.report_count.value}
                    completedAll={data.overview.completed_count.value}
                    acceptAll={acceptRate(data.overview.outcomes)}
                    partialAll={partialRate(data.overview.outcomes)}
                    minePartial={compareData?.mine.partial_rate ?? null}
                    showMine={showMine}
                    personalStatus={personal.status}
                    mineReport={compareData?.mine.report_count ?? null}
                    mineCompleted={compareData?.mine.completed_count ?? null}
                    mineAccept={compareData?.mine.accept_rate ?? null}
                  />
                  <div className="mapmode-grid">
                    {mapPanel}
                    <div className="mapmode-side">
                      {regionList}
                      {insightPanel}
                    </div>
                  </div>
                </section>
              ) : view === 'stats' ? (
                <section className="statsmode" id="mapsection" aria-label="통계 크게 보기">
                  <div className="stats-map">
                    {mapPanel}
                    <button className="ghost-btn stats-expand" type="button" onClick={() => changeView('both')}>
                      지도 크게 보기
                    </button>
                  </div>
                  <div className="stats-grid">
                    {compareKpis}
                    {managerCompare}
                    {trendCard}
                    {regionList}
                    {insightPanel}
                  </div>
                </section>
              ) : (
                <section className="compare-layout" id="mapsection" aria-label="지도와 통계">
                  <div className="layout-main">
                    {mapPanel}
                    {regionList}
                  </div>
                  <div className="layout-side">
                    {insightPanel}
                    {compareKpis}
                    {managerCompare}
                    {trendCard}
                  </div>
                </section>
              )}
              <section className="analytics-grid" id="analytics" aria-label="처리 결과와 차량">
                <OutcomeCard outcomes={data.overview.outcomes} />
                <VehicleTop5
                  vehicles={data.vehicles}
                  totalScope={data.vehicle_total_scope_reports}
                  identifiable={data.vehicle_identifiable_reports}
                  toast={showToast}
                />
              </section>
              <LawTable laws={data.laws} activeLaw={scope.law} onPickLaw={pickLaw} />
              <EntityTable
                agencies={data.agencies}
                managers={data.managers}
                tab={entityTab}
                onTab={setEntityTab}
                onPick={pickEntity}
                server={entityServer}
                mine={showMine ? entityMine : null}
              />
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
        onDraft={setDraft}
        appliedChips={appliedChips}
        unsupportedNote={unsupportedNote}
        onClose={() => setDrawer(false)}
        onApply={apply}
        onReset={reset}
        regionCounts={regionCountMap}
        lawOptions={lawChoices}
      />
      {toast && <div className="toast" role="status" aria-live="polite">{toast}</div>}
    </>
  );
}
