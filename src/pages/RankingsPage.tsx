import { flushSync } from 'react-dom';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  METRIC_LABELS,
  kstMonth,
  monthBounds,
  querySchema,
  type RankingQuery,
  type RankingResponse,
  type RankingRow,
} from '../../contracts/user-rankings/types';
import {
  RANKING_PRESETS,
  RANKING_THEME_METRICS,
  rankingTitle,
  selectRankingPreset,
  type RankingPreset,
} from '../domain/rankingPeriods';
import { loadRankings } from '../data/rankings';
import { useMapAuth } from '../hooks/usePersonal';
import { ACCESS_CODES, PublicApiError, type AccessCode } from '../data/client';
import AccessGate from '../components/AccessGate';
import '../styles/rankings.css';

type Theme = RankingQuery['theme'];
type Metric = RankingQuery['metric'];

const CUMULATIVE_PRESETS = RANKING_PRESETS.filter((p) => p.period !== 'month');
const MONTHLY_PRESETS = RANKING_PRESETS.filter((p) => p.period === 'month');

function isPresetActive(draft: Draft, preset: RankingPreset): boolean {
  if (draft.theme !== preset.theme) return false;
  return preset.period === 'month' ? draft.period === 'month' : draft.period !== 'month';
}

const CATEGORY_LABEL: Record<RankingQuery['category'], string> = {
  all: '전체',
  traffic: '교통위반',
  parking: '주정차',
  other: '기타',
};

const BASIS_LABEL: Record<RankingQuery['date_basis'], string> = {
  completed_date: '답변일',
  report_date: '신고일',
};

const PAGE_SIZE = 20;
const REVALIDATE_MS = 500;

interface Draft {
  theme: Theme;
  metric: Metric;
  period: RankingQuery['period'];
  start: string;
  end: string;
  month: string;
  date_basis: RankingQuery['date_basis'];
  category: RankingQuery['category'];
  min_reports: string;
}

function defaultDraft(): Draft {
  return {
    theme: 'reporters',
    metric: 'reports_count',
    period: 'all',
    start: '',
    end: '',
    month: kstMonth(),
    date_basis: 'completed_date',
    category: 'all',
    min_reports: '1',
  };
}

const RK = (k: string) => `rk_${k}`;

function draftFromSearch(search: string): Draft | null {
  const p = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const has = ['theme', 'metric', 'period', 'start', 'end', 'month', 'basis', 'category', 'min'].some(
    (k) => p.get(RK(k)) !== null,
  );
  if (!has) return null;
  const base = defaultDraft();
  const theme = p.get(RK('theme'));
  const metric = p.get(RK('metric'));
  const period = p.get(RK('period'));
  const basis = p.get(RK('basis'));
  const category = p.get(RK('category'));
  const next: Draft = {
    ...base,
    theme: theme === 'reporters' || theme === 'fines' || theme === 'unlucky' ? theme : base.theme,
    start: p.get(RK('start')) ?? '',
    end: p.get(RK('end')) ?? '',
    month: p.get(RK('month')) ?? base.month,
    min_reports: p.get(RK('min')) ?? base.min_reports,
  };
  next.metric = (metric as Metric) ?? next.metric;
  if (period === 'all' || period === 'range' || period === 'month') next.period = period;
  next.date_basis = basis === 'report_date' || basis === 'completed_date' ? basis : next.date_basis;
  next.category = category === 'all' || category === 'traffic' || category === 'parking' || category === 'other'
    ? category
    : next.category;
  if (!RANKING_THEME_METRICS[next.theme].includes(next.metric)) next.metric = RANKING_THEME_METRICS[next.theme][0];
  return next;
}

function draftToQuery(d: Draft, page: number, expectedVersion: string | null): RankingQuery | null {
  const min = d.min_reports.trim() === '' ? 1 : Number(d.min_reports);
  const raw = {
    theme: d.theme,
    metric: d.metric,
    period: d.period,
    start: d.period === 'range' ? d.start || null : null,
    end: d.period === 'range' ? d.end || null : null,
    month: d.period === 'month' ? d.month || null : null,
    date_basis: d.date_basis,
    category: d.category,
    min_reports: Number.isInteger(min) ? min : d.min_reports,
    page,
    page_size: PAGE_SIZE,
    expected_version: page > 1 ? expectedVersion : null,
  };
  const parsed = querySchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function shortUuid(u: string): string {
  return u.length > 13 ? `${u.slice(0, 8)}…${u.slice(-4)}` : u;
}

function formatValue(row: RankingRow, metric: Metric): string {
  if (metric.endsWith('_rate')) return `${row.value.toFixed(1)}%`;
  return `${row.value.toLocaleString('ko-KR')}건`;
}

export default function RankingsPage({ active }: { active: boolean }) {
  const { auth, signIn, signOut } = useMapAuth();
  const [draft, setDraft] = useState<Draft>(() => draftFromSearch(window.location.search) ?? defaultDraft());
  const [applied, setApplied] = useState<RankingQuery | null>(() => {
    const d = draftFromSearch(window.location.search);
    return d ? draftToQuery(d, 1, null) : draftToQuery(defaultDraft(), 1, null);
  });
  const [response, setResponse] = useState<{ data: RankingResponse; viewer: string | null; queryKey: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ message: string; status: number | null; retryAfter: number | null } | null>(null);
  const [access, setAccess] = useState<AccessCode | null>(null);
  const [accessDetails, setAccessDetails] = useState<PublicApiError['details']>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const retryAtRef = useRef(retryAt);
  retryAtRef.current = retryAt;
  const [copied, setCopied] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const appliedKey = useMemo(() => JSON.stringify(applied), [applied]);
  const viewer = auth.status === 'signed_in' ? auth.viewerId : null;
  const appliedRef = useRef(applied);
  appliedRef.current = applied;
  const authRef = useRef(auth.status);
  authRef.current = auth.status;
  const lastFetch = useRef(0);

  // Hidden / logout: stop requests and clear the protected response. Guards below
  // also refuse to render a previous account's numbers for even a moment.
  useEffect(() => {
    if (!active || auth.status !== 'signed_in') {
      abortRef.current?.abort();
      abortRef.current = null;
      setResponse(null);
      setLoading(false);
      if (auth.status !== 'signed_in') {
        setError(null);
        setAccess(null);
      }
    }
  }, [active, auth.status, viewer]);

  // Refresh / back: restore the ranking form from the prefixed URL params.
  useEffect(() => {
    const onPop = () => {
      const d = draftFromSearch(window.location.search);
      if (!d) return;
      setDraft(d);
      setApplied(draftToQuery(d, 1, null));
      setNotice(null);
      setError(null);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // pageshow / focus / visibility: revalidate a stale snapshot, abort while hidden.
  // No persistent response cache: everything lives in this component's state.
  useEffect(() => {
    if (!active) return undefined;
    const maybeRevalidate = () => {
      if (document.visibilityState === 'hidden') {
        abortRef.current?.abort();
        return;
      }
      if (authRef.current !== 'signed_in' || !appliedRef.current) return;
      if (retryAtRef.current !== null && Date.now() < retryAtRef.current) return;
      if (Date.now() - lastFetch.current < REVALIDATE_MS) return;
      setReload((n) => n + 1);
    };
    const onHide = () => { abortRef.current?.abort(); flushSync(() => { setResponse(null); setLoading(false); }); lastFetch.current = 0; };
    const onShow = () => { setResponse(null); lastFetch.current = 0; maybeRevalidate(); };
    const onFocus = () => maybeRevalidate();
    const onVis = () => {
      if (!document.hidden) maybeRevalidate();
      else onHide();
    };
    window.addEventListener('pageshow', onShow);
    window.addEventListener('pagehide', onHide);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('pageshow', onShow);
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [active]);

  // 429 countdown.
  useEffect(() => {
    if (retryAt === null) return undefined;
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, [retryAt]);

  // Main fetch. Server computes all sorting/ranks; the client never re-sorts.
  useEffect(() => {
    if (!active || auth.status !== 'signed_in' || !applied) return undefined;
    if (retryAtRef.current !== null && Date.now() < retryAtRef.current) return undefined;
    const requestViewer = viewer;
    const ac = new AbortController();
    abortRef.current?.abort();
    abortRef.current = ac;
    setLoading(true);
    setResponse(null);
    setError(null);
    setAccess(null);
    loadRankings(applied, ac.signal)
      .then((data) => {
        if (ac.signal.aborted) return;
        // Render guard: a late answer for another account is dropped.
        if ((authRef.current === 'signed_in' ? requestViewer : null) !== requestViewer) return;
        setResponse({ data, viewer: requestViewer, queryKey: appliedKey });
        setRetryAt(null);
        lastFetch.current = Date.now();
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (ac.signal.aborted) return;
        setResponse(null);
        setLoading(false);
        if (e instanceof PublicApiError) {
          if (e.status === 409) {
            const cur = appliedRef.current;
            if (cur && (cur.page !== 1 || cur.expected_version !== null)) {
              setNotice('그사이 새 자료가 들어왔습니다. 첫 페이지부터 다시 불러옵니다.');
              setApplied({ ...cur, page: 1, expected_version: null });
              setReload((n) => n + 1);
            } else {
              setNotice('그사이 새 자료가 들어왔습니다. 다시 적용해 주세요.');
              setError({ message: '그사이 새 자료가 들어왔습니다. 다시 적용해 주세요.', status: 409, retryAfter: null });
            }
            return;
          }
          if (e.status === 429) {
            const wait = e.retryAfter && e.retryAfter > 0 ? e.retryAfter : 30;
            setRetryAt(Date.now() + wait * 1000);
            setError({ message: `요청이 많아 잠시 후 다시 시도해 주세요. ${wait}초 뒤에 다시 시도할 수 있습니다.`, status: 429, retryAfter: wait });
            return;
          }
          if (e.code && (ACCESS_CODES as readonly string[]).includes(e.code)) {
            setAccess(e.code as AccessCode);
            setAccessDetails(e.details);
            return;
          }
          setError({ message: e.message || '랭킹을 불러오지 못했습니다.', status: e.status, retryAfter: e.retryAfter });
          return;
        }
        setError({ message: '랭킹을 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.', status: null, retryAfter: null });
      });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedKey, active, auth.status, viewer, reload]);

  const writeUrl = useCallback((d: Draft) => {
    try {
      const url = new URL(window.location.href);
      const q = url.searchParams;
      q.set(RK('theme'), d.theme);
      q.set(RK('metric'), d.metric);
      q.set(RK('period'), d.period);
      if (d.period === 'range') {
        if (d.start) q.set(RK('start'), d.start);
        else q.delete(RK('start'));
        if (d.end) q.set(RK('end'), d.end);
        else q.delete(RK('end'));
      } else {
        q.delete(RK('start'));
        q.delete(RK('end'));
      }
      if (d.period === 'month') q.set(RK('month'), d.month);
      else q.delete(RK('month'));
      q.set(RK('basis'), d.date_basis);
      q.set(RK('category'), d.category);
      q.set(RK('min'), d.min_reports.trim() === '' ? '1' : d.min_reports.trim());
      window.history.replaceState(window.history.state, '', `${url.pathname}?${q.toString()}${url.hash}`);
    } catch { /* URL sync is optional */ }
  }, []);

  const apply = useCallback(() => {
    if (retryAt !== null && Date.now() < retryAt) return;
    if (auth.status !== 'signed_in') {
      setFormError('카카오 로그인이 필요합니다. 먼저 로그인해 주세요.');
      return;
    }
    if (draft.period === 'month' && !/^\d{4}-(0[1-9]|1[0-2])$/.test(draft.month)) {
      setFormError('조회할 달을 YYYY-MM 형식으로 입력해 주세요.');
      return;
    }
    if (draft.period === 'range' && (!draft.start || !draft.end)) {
      setFormError('직접 범위를 선택하면 시작일과 종료일을 모두 입력해 주세요.');
      return;
    }
    if (draft.period === 'range' && draft.start > draft.end) {
      setFormError('시작일이 종료일보다 늦습니다.');
      return;
    }
    const min = draft.min_reports.trim() === '' ? 1 : Number(draft.min_reports);
    if (!Number.isInteger(min) || min < 1) {
      setFormError('최소 신고 건수는 1 이상의 정수입니다.');
      return;
    }
    const q = draftToQuery(draft, 1, null);
    if (!q) {
      setFormError('조건이 올바르지 않습니다. 기간과 달을 확인해 주세요.');
      return;
    }
    setFormError(null);
    setNotice(null);
    setError(null);
    setAccess(null);
    setResponse(null);
    setApplied(q);
    setReload((n) => n + 1);
    writeUrl(draft);
  }, [auth.status, draft, writeUrl, retryAt]);

  const reset = useCallback(() => {
    const d = defaultDraft();
    setDraft(d);
    setFormError(null);
    setNotice(null);
    setApplied(draftToQuery(d, 1, null));
    setReload((n) => n + 1);
    writeUrl(d);
  }, [writeUrl]);

  const gotoPage = useCallback((page: number) => {
    const cur = appliedRef.current;
    if (!cur) return;
    const version = response?.data.dataset_version ?? cur.expected_version;
    setApplied({ ...cur, page, expected_version: page > 1 ? version : null });
  }, [response]);

  const retry = useCallback(() => {
    if (retryAt !== null && Date.now() < retryAt) return;
    setRetryAt(null);
    setError(null);
    setReload((n) => n + 1);
  }, [retryAt]);

  const copyUuid = useCallback(async (uuid: string) => {
    try {
      await navigator.clipboard.writeText(uuid);
      setCopied(uuid);
      window.setTimeout(() => setCopied((c) => (c === uuid ? null : c)), 1600);
    } catch {
      setCopied(null);
    }
  }, []);

  const data = response?.data ?? null;
  // Guard: never render another account's snapshot.
  const guarded = data && response && response.viewer === viewer && response.queryKey === appliedKey && auth.status === 'signed_in' ? data : null;
  const appliedTheme: Theme = applied?.theme ?? 'reporters';
  const appliedMetric: Metric = applied?.metric ?? 'reports_count';
  const heading = rankingTitle({
    theme: applied?.theme ?? 'reporters',
    period: applied?.period ?? 'all',
    month: applied?.month ?? null,
  });
  const retryWait = retryAt !== null ? Math.max(0, Math.ceil((retryAt - now) / 1000)) : 0;

  const scopeText = useMemo(() => {
    if (!applied) return '';
    const basis = BASIS_LABEL[applied.date_basis];
    const cat = CATEGORY_LABEL[applied.category];
    let period = '전체 기간';
    if (applied.period === 'range' && applied.start && applied.end) period = `${applied.start} — ${applied.end}`;
    else if (applied.period === 'month' && applied.month) {
      try {
        const b = monthBounds(applied.month);
        period = `${b.start} — ${b.end}`;
      } catch { period = applied.month; }
    }
    return `${basis} 기준 · ${period} · ${cat} · 최소 ${applied.min_reports}건`;
  }, [applied]);

  const me = guarded?.me ?? null;
  const rows = guarded?.rows ?? [];
  const isRate = appliedMetric.endsWith('_rate');
  const themeMetrics = RANKING_THEME_METRICS[draft.theme];
  void appliedTheme;

  return (
    <section className="rk-page" aria-labelledby="rk-title" hidden={!active}>
      <div className="rk-head">
        <div className="overline">USER RANKINGS</div>
        <h1 id="rk-title">{heading}</h1>
        <p className="rk-sub">
          {applied ? `${METRIC_LABELS[appliedMetric]} 순위 · ${scopeText}` : '조건을 적용하면 순위를 불러옵니다.'}
        </p>
        <p className="rk-disclaimer">이 서비스에 공유된 완료 신고 기준, 전체 안전신문고 활동 아님.</p>
      </div>

      <form
        className="rk-form cm-panel"
        aria-label="랭킹 조회 조건"
        onSubmit={(e) => { e.preventDefault(); apply(); }}
      >
        <fieldset className="rk-field rk-presets">
          <legend>랭킹 바로가기</legend>
          <div className="rk-preset-group" role="group" aria-label="누적 · 기간별">
            <span className="rk-preset-caption" aria-hidden="true">누적 · 기간별</span>
            <div className="rk-seg">
              {CUMULATIVE_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={isPresetActive(draft, p) ? 'selected' : ''}
                  aria-pressed={isPresetActive(draft, p)}
                  onClick={() => setDraft(selectRankingPreset(draft, p))}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div className="rk-preset-group" role="group" aria-label="월별">
            <span className="rk-preset-caption" aria-hidden="true">월별</span>
            <div className="rk-seg">
              {MONTHLY_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={isPresetActive(draft, p) ? 'selected' : ''}
                  aria-pressed={isPresetActive(draft, p)}
                  onClick={() => setDraft(selectRankingPreset(draft, p))}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </fieldset>

        <div className="rk-grid">
          <label className="rk-field">지표
            <select
              aria-label="지표"
              value={draft.metric}
              onChange={(e) => setDraft({ ...draft, metric: e.target.value as Metric })}
            >
              {themeMetrics.map((m) => (
                <option key={m} value={m}>{METRIC_LABELS[m]}</option>
              ))}
            </select>
          </label>
          <label className="rk-field">날짜 기준
            <select
              aria-label="날짜 기준"
              value={draft.date_basis}
              onChange={(e) => setDraft({ ...draft, date_basis: e.target.value as Draft['date_basis'] })}
            >
              <option value="completed_date">답변일</option>
              <option value="report_date">신고일</option>
            </select>
          </label>
          <label className="rk-field">분류
            <select
              aria-label="분류"
              value={draft.category}
              onChange={(e) => setDraft({ ...draft, category: e.target.value as Draft['category'] })}
            >
              <option value="all">전체</option>
              <option value="traffic">교통위반</option>
              <option value="parking">주정차</option>
              <option value="other">기타</option>
            </select>
          </label>
          <label className="rk-field">최소 신고 건수
            <input
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={draft.min_reports}
              onChange={(e) => setDraft({ ...draft, min_reports: e.target.value })}
            />
          </label>
        </div>

        <div className="rk-field">
          <span id="rk-period-label">기간</span>
          <div className="rk-seg" role="group" aria-labelledby="rk-period-label">
            <button
              type="button"
              className={draft.period === 'all' ? 'selected' : ''}
              aria-pressed={draft.period === 'all'}
              onClick={() => setDraft({ ...draft, period: 'all' })}
            >
              전체 기간
            </button>
            <button
              type="button"
              className={draft.period === 'range' ? 'selected' : ''}
              aria-pressed={draft.period === 'range'}
              onClick={() => setDraft({ ...draft, period: 'range' })}
            >
              직접 범위
            </button>
            <button
              type="button"
              className={draft.period === 'month' ? 'selected' : ''}
              aria-pressed={draft.period === 'month'}
              onClick={() => setDraft({ ...draft, period: 'month', month: draft.month || kstMonth() })}
            >
              월별
            </button>
          </div>
          {draft.period === 'range' && (
            <div className="rk-grid">
              <label className="rk-field">시작일
                <input type="date" value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value })} />
              </label>
              <label className="rk-field">종료일
                <input type="date" value={draft.end} onChange={(e) => setDraft({ ...draft, end: e.target.value })} />
              </label>
            </div>
          )}
          {draft.period === 'month' && (
            <label className="rk-field">조회 달
              <input
                type="month"
                value={draft.month}
                onChange={(e) => setDraft({ ...draft, month: e.target.value })}
              />
            </label>
          )}
        </div>

        {formError && <p className="field-error" role="alert">{formError}</p>}
        <div className="rk-actions">
          <button className="primary-button rk-apply" type="submit" disabled={retryWait > 0}>적용</button>
          <button className="ghost-btn" type="button" onClick={reset} disabled={retryWait > 0}>초기화</button>
        </div>
        <p className="rk-hint">초안은 적용을 누르기 전에는 반영되지 않습니다. 같은 범위는 모든 지표에 함께 적용됩니다.</p>
      </form>

      <div aria-live="polite">
        {notice && <p className="banner warn rk-notice" role="status">{notice}</p>}
        {guarded?.scope.in_progress && (
          <p className="banner rk-notice" role="note">진행 중인 달이라 집계가 계속 바뀝니다. 같은 경과 기간끼리 비교해 주세요.</p>
        )}
      </div>

      {auth.status !== 'signed_in' ? (
        <div className="cm-panel rk-panel" role="note">
          <h2>로그인이 필요합니다</h2>
          <p className="cm-muted">랭킹은 카카오로 로그인한 뒤에 볼 수 있습니다. 다른 화면의 지도 조건과는 따로 동작합니다.</p>
          {auth.status === 'unconfigured'
            ? <p className="cm-muted">{auth.message ?? '지금은 로그인 기능을 쓸 수 없습니다.'}</p>
            : (
              <button className="primary-button kakao-login rk-login" type="button" onClick={signIn} disabled={auth.status === 'loading'}>
                {auth.status === 'loading' ? '로그인 확인 중…' : '카카오로 로그인'}
              </button>
            )}
        </div>
      ) : access ? (
        <AccessGate code={access} auth={auth} onSignIn={signIn} onSignOut={signOut} onRetry={() => setReload((n) => n + 1)} progress={access === 'upload_required' ? accessDetails : null} />
      ) : loading && !guarded ? (
        <div className="cm-panel rk-panel" aria-busy="true" aria-label="랭킹을 불러오는 중">
          <div className="skeleton" />
          <div className="skeleton" />
          <p className="cm-muted">랭킹을 불러오는 중입니다…</p>
        </div>
      ) : error && !guarded ? (
        <div className="cm-panel rk-panel" role="alert">
          <h2>랭킹을 불러오지 못했습니다</h2>
          <p className="cm-muted">{error.message}</p>
          <div className="rk-actions">
            <button className="primary-button rk-apply" type="button" onClick={retry} disabled={retryWait > 0}>
              {retryWait > 0 ? `${retryWait}초 뒤 다시 시도` : '다시 시도'}
            </button>
          </div>
        </div>
      ) : guarded ? (
        <>
          <section className="cm-panel rk-panel" aria-label="내 순위 요약">
            <h2>내 순위</h2>
            {me ? (
              <p className="rk-me-line">
                <strong>{me.rank}위</strong>
                <span>값 {formatValue(me, appliedMetric)}</span>
                {isRate && <span>{me.numerator.toLocaleString('ko-KR')}/{me.denominator.toLocaleString('ko-KR')}건</span>}
                <span>완료 신고 {me.reports.toLocaleString('ko-KR')}건</span>
                {me.tie_count > 1 && <span>공동 {me.tie_count}명</span>}
              </p>
            ) : (
              <p className="cm-muted" role="note">이 조건에서는 내 기록이 없습니다. 공유된 완료 신고가 있으면 조건을 넓혀 보세요.</p>
            )}
          </section>

          {guarded.total_participants === 0 || rows.length === 0 ? (
            <div className="cm-panel rk-panel" role="status">
              <h2>결과가 없습니다</h2>
              <p className="cm-muted">{scopeText} 조건의 순위가 비어 있습니다. 기간·분류·최소 신고 건수를 완화해 보세요.</p>
            </div>
          ) : (
            <section className="cm-panel rk-panel" aria-label={`${heading} 표`}>
              <div className="rk-table-head">
                <h2>{heading} 표</h2>
                <div className="rk-badges">
                  <span className="cm-chip">참여자 {guarded.total_participants.toLocaleString('ko-KR')}명</span>
                  {guarded.total_participants === 1 && <span className="cm-chip">참여자 1명</span>}
                </div>
              </div>
              <div className="table-scroll rk-scroll">
                <table className="entity-table rk-table">
                  <thead>
                    <tr>
                      <th scope="col" className="num">순위</th>
                      <th scope="col">사용자</th>
                      <th scope="col" className="num">값</th>
                      <th scope="col" className="num">신고</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.uuid} className={row.is_me ? 'rk-me' : undefined}>
                        <td className="num">
                          {row.rank}위
                          {row.tie_count > 1 && <small> 공동 {row.tie_count}명</small>}
                        </td>
                        <td>
                          <code className="rk-uuid" title={row.uuid}>{shortUuid(row.uuid)}</code>
                          {row.is_me && <span className="rk-me-badge">나</span>}
                          <details className="rk-uuid-full">
                            <summary>전체 UUID 보기</summary>
                            <code>{row.uuid}</code>
                            <button
                              className="mini-btn"
                              type="button"
                              onClick={() => void copyUuid(row.uuid)}
                              aria-label={`UUID ${row.uuid} 복사`}
                            >
                              {copied === row.uuid ? '복사됨' : '복사'}
                            </button>
                          </details>
                        </td>
                        <td className="num">
                          <b>{formatValue(row, appliedMetric)}</b>
                          {isRate && <small> {row.numerator.toLocaleString('ko-KR')}/{row.denominator.toLocaleString('ko-KR')}건</small>}
                          <small className="rk-mobile-sample">N {row.reports}건{row.reports === 1 ? ' · 표본 1건' : ''}{row.completed_unknown > 0 ? ` · 미확인 ${row.completed_unknown}건 포함` : ''}</small>
                        </td>
                        <td className="num" aria-label={`완료 신고 ${row.reports}건, 결과 미확인 ${row.completed_unknown}건`}>
                          {row.reports.toLocaleString('ko-KR')}건
                          {row.reports === 1 && <small>표본 1건</small>}
                          {row.completed_unknown > 0 && <small> 미확인 {row.completed_unknown}건 포함</small>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="rk-pager">
                <button
                  className="ghost-btn"
                  type="button"
                  disabled={guarded.page <= 1 || loading}
                  onClick={() => gotoPage(guarded.page - 1)}
                >
                  이전
                </button>
                <span className="cm-muted" aria-live="polite">{guarded.page}페이지 · 20명씩</span>
                <button
                  className="ghost-btn"
                  type="button"
                  disabled={guarded.next_page === null || loading}
                  onClick={() => guarded.next_page !== null && gotoPage(guarded.next_page)}
                >
                  다음
                </button>
              </div>
              {loading && <p className="cm-muted" role="status">새 페이지를 불러오는 중입니다…</p>}
            </section>
          )}

          <section className="cm-panel rk-panel" aria-label="지표 설명">
            <h2>지표를 읽는 기준</h2>
            <details open>
              <summary>N(완료 신고)의 뜻</summary>
              <p>N은 수용·일부수용·불수용·결과 미확인(completed_unknown)을 모두 포함한 완료 신고 건수입니다. 표본이 1건이어도 숨기지 않습니다.</p>
            </details>
            <details>
              <summary>F(과태료)의 뜻</summary>
              <p>F는 실제 처분이 과태료(fine)인 신고입니다. 수용·일부수용이라도 금액이 없어도 실제 처분이 과태료면 포함합니다.</p>
            </details>
            <details>
              <summary>진단 수치</summary>
              <p>
                선택 날짜 없음 {guarded.diagnostics.selected_date_missing.toLocaleString('ko-KR')}건 ·
                결과 미확인 {guarded.diagnostics.completed_unknown.toLocaleString('ko-KR')}건 ·
                처분 불일치 {guarded.diagnostics.inconsistent_disposition.toLocaleString('ko-KR')}건.
                순위는 서버가 전체 신고 집합에서 매깁니다. 비율은 각각 R/N, P/N, F/N × 100이며 주요 값이 같으면 공동 순위입니다.
              </p>
            </details>
          </section>
        </>
      ) : null}
    </section>
  );
}
