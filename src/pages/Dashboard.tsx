import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type DashboardData, type PublicEntity, type PublicPoint, type Scope } from '../domain/public';
import { PublicApiError, dataMode, loadDashboard } from '../data/client';
import {
  CATEGORY_LABEL, baseScope, draftFromScope, fixtureFromSearch, regionLabel, scopeFromDraft, scopeFromSearch,
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
  const [scope, setScope] = useState<Scope>(() => scopeFromSearch(window.location.search, baseScope(dataMode)));
  const [draft, setDraft] = useState<DraftFilters>(() => draftFromScope(scopeFromSearch(window.location.search, baseScope(dataMode))));
  const [fixture, setFixture] = useState(() => dataMode === 'demo' ? fixtureFromSearch(window.location.search) : 'overview');
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
      const s = scopeFromSearch(window.location.search, baseScope(dataMode));
      setScope(s);
      setDraft(draftFromScope(s));
      setFixture(dataMode === 'demo' ? fixtureFromSearch(window.location.search) : 'overview');
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const pushUrl = (s: Scope) => {
    const search = scopeToSearch(s, { fixture: dataMode === 'demo' && fixture !== 'overview' ? fixture : null });
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
    showToast('전국 · 전체 분류로 되돌렸습니다.');
  }, [showToast]); // eslint-disable-line react-hooks/exhaustive-deps

  const share = useCallback(async () => {
    const url = `${window.location.origin}${window.location.pathname}?${scopeToSearch(scope, { fixture: dataMode === 'demo' && fixture !== 'overview' ? fixture : null })}`;
    try {
      await navigator.clipboard.writeText(url);
      showToast('공개 조회 조건 URL을 복사했습니다. 차량·계정정보는 포함되지 않습니다.');
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
    return data.overview.report_count.value == null;
  }, [data]);
  const empty = data?.overview.report_count.value === 0;

  const unsupportedNote = unsupported
    ? dataMode === 'demo'
      ? '선택 범위의 합성 집계가 준비되지 않았습니다. 초기화하면 기본 예시 범위가 표시됩니다.'
      : '선택 범위의 집계가 제공되지 않습니다. 데이터 범위와 지원 여부를 확인해 주세요.'
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

  const pickEntity = (kind: EntityTab, entity: PublicEntity) => {
    if (!entity.agency_key || (kind === 'manager' && !entity.manager_key)) return;
    const next: Scope = {
      ...scope,
      agency_key: entity.agency_key,
      manager_key: kind === 'manager' ? entity.manager_key : null,
    };
    setScope(next);
    pushUrl(next);
    showToast(dataMode === 'demo' ? '조건을 적용했습니다. 합성 fixture는 기본 범위 집계만 지원합니다.' : '기관·담당자 조건을 적용했습니다.');
  };

  const analyzePoint = (pt: PublicPoint) => {
    const bbox: [number, number, number, number] = pt.bbox ?? [pt.lng, pt.lat, pt.lng, pt.lat];
    applyView(bbox);
    showToast(pt.aggregate ? `${pt.point_count}곳의 집계 표시 범위를 분석 조건으로 적용했습니다.` : '선택 지점의 정확 좌표를 분석 조건으로 적용했습니다.');
  };

  const applyView = (bbox: [number, number, number, number]) => {
    if (JSON.stringify(scope.bbox) === JSON.stringify(bbox)) return;
    const next: Scope = { ...scope, bbox };
    setScope(next);
    pushUrl(next);
    showToast(dataMode === 'demo' ? '화면 범위를 적용했습니다. 합성 fixture에는 이 범위의 집계가 없습니다.' : '화면 범위를 분석 조건으로 적용했습니다.');
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

  const stamp = data?.meta.data_max ? fmtDate(data.meta.data_max) : fmtDate(baseScope(dataMode).end);
  const resolvedTheme: 'dark' | 'light' = theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : theme;

  return (
    <>
      <TopBar
        theme={theme}
        onTheme={setTheme}
        briefing={briefing}
        onBriefing={() => setBriefing((v) => !v)}
        dataStamp={stamp}
        sample={data?.meta.sample ?? false}
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
              {(unsupported || empty) && (
                <div className="banner warn" role="note">
                  <span className="grow">
                    {empty
                      ? '현재 필터에 결과가 없습니다. 조건을 해제하면 전국 집계를 볼 수 있습니다.'
                      : unsupportedNote}
                  </span>
                  <button className="ghost-btn" type="button" onClick={reset}>전국으로 초기화</button>
                </div>
              )}
              {dataMode === 'demo' && fixture === 'one' && (
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
                <TrendCard monthly={data.monthly} theme={resolvedTheme} />
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
            <span>나만의 안전신문고 <b>COMMUNITY MAP</b>{dataMode === 'demo' ? ' · demo 합성 데이터' : ' · 공개 제공 표본'}</span>
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
