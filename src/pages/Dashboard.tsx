import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_SCOPE, type DashboardData, type PublicPoint, type Scope } from '../domain/public';
import { PublicApiError, dataMode, loadDashboard } from '../data/client';
import {
  CATEGORY_LABEL, draftFromScope, fixtureFromSearch, regionLabel, scopeFromDraft, scopeFromSearch,
  scopeToSearch, validateRange, type DraftFilters, type EntityTab, type MapMetric, type ThemeMode,
} from '../state/filters';
import TopBar from '../components/TopBar';
import Rail from '../components/Rail';
import CommandBar from '../components/CommandBar';
import FilterDrawer from '../components/FilterDrawer';
import KpiRow from '../components/KpiRow';
import MapPanel from '../components/MapPanel';
import InsightPanel from '../components/InsightPanel';
import TrendCard from '../components/TrendCard';
import OutcomeCard from '../components/OutcomeCard';
import VehicleTop5 from '../components/VehicleTop5';
import EntityTable from '../components/EntityTable';
import DataGuide from '../components/DataGuide';
import { fmtDate } from '../components/format';

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

export default function Dashboard() {
  const [scope, setScope] = useState<Scope>(() => scopeFromSearch(window.location.search, DEFAULT_SCOPE));
  const [draft, setDraft] = useState<DraftFilters>(() => draftFromScope(scopeFromSearch(window.location.search, DEFAULT_SCOPE)));
  const [fixture, setFixture] = useState(() => fixtureFromSearch(window.location.search));
  const [data, setData] = useState<DashboardData | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [apiError, setApiError] = useState<{ message: string; retryAfter: number | null } | null>(null);
  const [theme, setTheme] = useState<ThemeMode>(initialTheme);
  const [briefing, setBriefing] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [selection, setSelection] = useState<string | null>(null);
  const [mapMetric, setMapMetric] = useState<MapMetric>('reports');
  const [entityTab, setEntityTab] = useState<EntityTab>('agency');
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [pendingBbox, setPendingBbox] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [nav, setNav] = useState('mapsection');
  const [dateError, setDateError] = useState<string | null>(null);
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
  }, [briefing]);
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

  // data load
  useEffect(() => {
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
        setLoadState('ready');
        setSelection((sel) => (sel && d.points.some((pt) => pt.key === sel) ? sel : null));
      })
      .catch((e: unknown) => {
        if (ac.signal.aborted) return;
        if (e instanceof PublicApiError) {
          setApiError({ message: e.message, retryAfter: e.retryAfter });
        } else {
          setApiError({ message: e instanceof Error ? e.message : '통계 조회에 실패했습니다.', retryAfter: null });
        }
        setLoadState('error');
      });
    return () => ac.abort();
  }, [scope, fixture]); // eslint-disable-line react-hooks/exhaustive-deps

  // back/forward
  useEffect(() => {
    const onPop = () => {
      const s = scopeFromSearch(window.location.search, DEFAULT_SCOPE);
      setScope(s);
      setDraft(draftFromScope(s));
      setFixture(fixtureFromSearch(window.location.search));
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const pushUrl = (s: Scope) => {
    const search = scopeToSearch(s, { fixture: fixture === 'overview' ? null : fixture });
    window.history.pushState(null, '', `${window.location.pathname}${search ? `?${search}` : ''}`);
  };

  const apply = useCallback(() => {
    const err = validateRange(draft.start, draft.end, data?.meta.data_min ?? null, data?.meta.data_max ?? null);
    setDateError(err);
    if (err) {
      showToast(err);
      return;
    }
    setScope((prev) => {
      const next = scopeFromDraft(draft, prev);
      pushUrl(next);
      return next;
    });
    setDrawer(false);
  }, [draft, data, showToast]); // eslint-disable-line react-hooks/exhaustive-deps

  const reset = useCallback(() => {
    const next: Scope = { ...DEFAULT_SCOPE };
    setScope(next);
    setDraft(draftFromScope(next));
    setSelection(null);
    setDateError(null);
    pushUrl(next);
    showToast('전국 · 전체 분류로 되돌렸습니다.');
  }, [showToast]); // eslint-disable-line react-hooks/exhaustive-deps

  const share = useCallback(async () => {
    const url = `${window.location.origin}${window.location.pathname}?${scopeToSearch(scope, { fixture: fixture === 'overview' ? null : fixture })}`;
    try {
      await navigator.clipboard.writeText(url);
      showToast('기간·지역·분류 조건 URL을 복사했습니다. 차량·계정정보는 포함되지 않습니다.');
    } catch {
      showToast(`공유 URL: ${url}`);
    }
  }, [scope, fixture, showToast]);

  const point: PublicPoint | null = useMemo(
    () => data?.points.find((pt) => pt.key === selection) ?? null,
    [data, selection],
  );

  const unsupported = useMemo(() => {
    if (!data) return false;
    return data.overview.report_count.value == null || data.points.length === 0;
  }, [data]);

  const unsupportedNote = unsupported
    ? '선택 범위의 합성 집계가 준비되지 않았습니다. 기본 범위(전국 · 전체 · 2025-09-25 — 2026-09-24)로 돌리면 집계가 표시됩니다.'
    : null;

  const appliedLabel = `${regionLabel(scope.region_code)} · ${CATEGORY_LABEL[scope.category]}`;
  const filterCount = (scope.agency_key ? 1 : 0) + (scope.manager_key ? 1 : 0) + (scope.region_code ? 1 : 0) + (scope.category !== 'all' ? 1 : 0);
  const appliedChips = [
    `${fmtDate(scope.start)} — ${fmtDate(scope.end)}`,
    CATEGORY_LABEL[scope.category],
    regionLabel(scope.region_code),
    ...(scope.agency_key ? [`기관 ${scope.agency_key}`] : []),
    ...(scope.manager_key ? [`담당 ${scope.manager_key}`] : []),
  ];

  const pickEntity = (kind: EntityTab, key: string) => {
    setScope((prev) => {
      const next: Scope = {
        ...prev,
        agency_key: kind === 'agency' ? key : prev.agency_key,
        manager_key: kind === 'manager' ? key : prev.manager_key,
      };
      pushUrl(next);
      return next;
    });
    showToast('기관·담당자 조건을 적용했습니다. 합성 fixture는 기본 범위 집계만 지원합니다.');
  };

  const analyzePoint = (pt: PublicPoint) => {
    showToast(`선택 지점(${pt.address ?? pt.key}) 범위로 분석하려면 지도에서 화면 범위를 적용해 주세요. 선택만으로 전체 scope는 바뀌지 않습니다.`);
  };

  const applyView = (bbox: [number, number, number, number]) => {
    setScope((prev) => {
      const next: Scope = { ...prev, bbox };
      if (autoRefresh) pushUrl(next);
      else setPendingBbox(true);
      return next;
    });
    showToast(autoRefresh ? '화면 범위를 적용했습니다.' : '화면 범위를 draft로 받았습니다. 합성 fixture는 bbox 집계를 지원하지 않습니다.');
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
        setLoadState('ready');
      })
      .catch((e: unknown) => {
        if (ac.signal.aborted) return;
        setApiError({
          message: e instanceof PublicApiError ? e.message : '통계 조회에 실패했습니다.',
          retryAfter: e instanceof PublicApiError ? e.retryAfter : null,
        });
        setLoadState('error');
      });
  };

  const stamp = data?.meta.data_max ? fmtDate(data.meta.data_max) : fmtDate(DEFAULT_SCOPE.end);

  return (
    <>
      <TopBar
        theme={theme}
        onTheme={setTheme}
        briefing={briefing}
        onBriefing={() => setBriefing((v) => !v)}
        dataStamp={stamp}
        sample={data?.meta.sample ?? true}
      />
      <div className="app">
        <Rail active={nav} onNavigate={setNav} onAbout={() => document.getElementById('guide')?.scrollIntoView({ behavior: 'auto' })} />
        <main id="main">
          <section className="page-heading" aria-label="상황판 제목">
            <div>
              <div className="overline">NATIONWIDE OBSERVATORY · {dataMode.toUpperCase()}</div>
              <h1>함께 모은 신고, <em>전국을 한눈에.</em></h1>
            </div>
            <span className="heading-note">숫자 너머의 흐름을 살펴보세요.<br /><span>자발적으로 제공된 신고 표본을 분석합니다.</span></span>
          </section>

          {briefing && (
            <div className="banner briefing-bar" role="note">
              <span className="grow">브리핑 모드 — Esc로 종료합니다. 범위·데이터 기준·분모는 계속 표시됩니다.</span>
              <button className="ghost-btn" type="button" onClick={() => setBriefing(false)}>종료 (Esc)</button>
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
          />

          {loadState === 'loading' && (
            <section className="kpis" aria-label="불러오는 중">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="skeleton" role="status" aria-label="지표 불러오는 중" />
              ))}
            </section>
          )}

          {loadState === 'error' && (
            <div className="banner error" role="alert">
              <span className="grow">
                통계 조회에 실패했습니다: {apiError?.message}
                {apiError?.retryAfter != null && ` (${apiError.retryAfter}초 후 다시 시도)`}
                가짜 0으로 대체하지 않습니다.
              </span>
              <button className="ghost-btn" type="button" onClick={retry}>다시 시도</button>
            </div>
          )}

          {loadState === 'ready' && data && (
            <>
              {unsupported && (
                <div className="banner warn" role="note">
                  <span className="grow">
                    {fixture === 'empty'
                      ? '현재 필터에 결과가 없습니다. 조건을 해제하면 전국 집계를 볼 수 있습니다.'
                      : unsupportedNote}
                  </span>
                  <button className="ghost-btn" type="button" onClick={reset}>전국으로 초기화</button>
                </div>
              )}
              {fixture === 'one' && (
                <div className="banner" role="note">
                  <span className="grow">표본 1건 상태 — 행·마커·카드를 모두 유지하고 ‘표본 1건’ 배지를 표시합니다.</span>
                </div>
              )}
              <KpiRow overview={data.overview} unsupported={unsupported} />
              <section className="map-row" id="mapsection" aria-label="지도와 인사이트">
                <MapPanel
                  points={data.points}
                  selectedKey={selection}
                  onSelect={setSelection}
                  metric={mapMetric}
                  onMetric={setMapMetric}
                  categoryLabel={`${CATEGORY_LABEL[scope.category]} 분류`}
                  onApplyView={applyView}
                  autoRefresh={autoRefresh}
                  onAutoRefresh={setAutoRefresh}
                  pendingBbox={pendingBbox}
                />
                <InsightPanel
                  data={data}
                  point={point}
                  scopeLabel={`${fmtDate(scope.start)} — ${fmtDate(scope.end)} · ${regionLabel(scope.region_code)}`}
                  onAnalyzePoint={analyzePoint}
                  onPickEntity={pickEntity}
                  toast={showToast}
                />
              </section>
              <section className="analytics-grid" id="analytics" aria-label="하단 분석 카드">
                <TrendCard monthly={data.monthly} />
                <OutcomeCard outcomes={data.overview.outcomes} />
                <VehicleTop5
                  vehicles={data.vehicles}
                  totalScope={data.vehicle_total_scope_reports}
                  identifiable={data.vehicle_identifiable_reports}
                  toast={showToast}
                />
              </section>
              <EntityTable
                agencies={data.agencies}
                managers={data.managers}
                tab={entityTab}
                onTab={setEntityTab}
                onPick={pickEntity}
              />
              <DataGuide data={data} />
            </>
          )}

          <footer className="page-footer">
            <span>나만의 안전신문고 <b>COMMUNITY MAP</b> · demo 합성 데이터</span>
            <span>이용자가 제공한 표본 · 데이터 기준과 분모를 함께 확인하세요.</span>
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
      />
      {toast && <div className="toast" role="status" aria-live="polite">{toast}</div>}
    </>
  );
}
