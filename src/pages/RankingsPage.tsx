import { flushSync } from 'react-dom';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  kstMonth,
  monthBounds,
  querySchema,
  type RankingQuery,
  type RankingResponse,
  type RankingRow,
} from '../../contracts/user-rankings/types';
import { RANKING_THEME_METRICS } from '../domain/rankingPeriods';
import { loadRankings } from '../data/rankings';
import { useMapAuth } from '../hooks/usePersonal';
import { ACCESS_CODES, PublicApiError, type AccessCode } from '../data/client';
import AccessGate from '../components/AccessGate';
import '../styles/rankings.css';

type Theme = RankingQuery['theme'];
type Metric = RankingQuery['metric'];

const TABS: Array<{ id: Theme; label: string }> = [
  { id: 'reporters', label: '신고 랭킹' },
  { id: 'fines', label: '과태료 랭킹' },
  { id: 'unlucky', label: '불운 랭킹' },
];

const METRIC_TITLES: Record<Metric, string> = {
  reports_count: '완료 신고가 많은 순위',
  fine_count: '과태료 처분 건수가 많은 순위',
  fine_rate: '과태료 처분율이 높은 순위',
  rejected_count: '불수용 건수가 많은 순위',
  rejected_rate: '불수용 비율이 높은 순위',
  partial_count: '일부수용 건수가 많은 순위',
  partial_rate: '일부수용 비율이 높은 순위',
};

/** Desktop value-column headers. Reporters use a single count column (no repeated count). */
const VALUE_HEADERS: Record<Metric, string> = {
  reports_count: '완료 신고',
  fine_count: '과태료 처분',
  fine_rate: '과태료 처분율',
  rejected_count: '불수용 건수',
  rejected_rate: '불수용 비율',
  partial_count: '일부수용 건수',
  partial_rate: '일부수용 비율',
};

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

function defaultQuery(): RankingQuery {
  return {
    theme: 'reporters',
    metric: 'reports_count',
    period: 'all',
    start: null,
    end: null,
    month: null,
    date_basis: 'completed_date',
    category: 'all',
    min_reports: 1,
    page: 1,
    page_size: PAGE_SIZE,
    expected_version: null,
  };
}

const RK = (k: string) => `rk_${k}`;

function queryFromSearch(search: string): RankingQuery | null {
  const p = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const keys = ['theme', 'metric', 'period', 'start', 'end', 'month', 'basis', 'category', 'min'];
  if (!keys.some((k) => p.get(RK(k)) !== null)) return null;
  const raw = {
    theme: p.get(RK('theme')) ?? undefined,
    metric: p.get(RK('metric')) ?? undefined,
    period: p.get(RK('period')) ?? undefined,
    start: p.get(RK('start')) ?? null,
    end: p.get(RK('end')) ?? null,
    month: p.get(RK('month')) ?? null,
    date_basis: p.get(RK('basis')) ?? undefined,
    category: p.get(RK('category')) ?? undefined,
    min_reports: p.has(RK('min')) ? Number(p.get(RK('min'))) : undefined,
    page: 1,
    page_size: PAGE_SIZE,
    expected_version: null,
  };
  const parsed = querySchema.safeParse(raw);
  return parsed.success ? { ...parsed.data, page: 1, expected_version: null } : defaultQuery();
}

function shiftMonth(month: string, delta: number): string | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!m) return null;
  let y = Number(m[1]);
  let mo = Number(m[2]) + delta;
  while (mo < 1) { mo += 12; y -= 1; }
  while (mo > 12) { mo -= 12; y += 1; }
  if (y < 1970 || y > 2100) return null;
  return `${y}-${String(mo).padStart(2, '0')}`;
}

function shortUuid(u: string): string {
  return u.length > 13 ? `${u.slice(0, 8)}…${u.slice(-4)}` : u;
}

function formatValue(row: RankingRow, metric: Metric): string {
  if (metric.endsWith('_rate')) return `${row.value.toFixed(1)}%`;
  return `${row.value.toLocaleString('ko-KR')}건`;
}

function periodPrefix(q: RankingQuery, nowMonth: string): string {
  if (q.period === 'range' && q.start && q.end) return `${q.start} — ${q.end} · `;
  if (q.period === 'month' && q.month) {
    if (q.month === nowMonth) return '이달 · ';
    const [y, m] = q.month.split('-');
    return `${y}년 ${Number(m)}월 · `;
  }
  return '';
}

export default function RankingsPage({ active }: { active: boolean }) {
  const { auth, signIn, signOut } = useMapAuth();
  const nowMonth = useMemo(() => kstMonth(), []);
  const [applied, setApplied] = useState<RankingQuery>(() => queryFromSearch(window.location.search) ?? defaultQuery());
  // Last metric per theme (in-memory only, never persisted). Returning to a theme
  // restores its own metric — e.g. unlucky/partial_* survives a fines round-trip.
  const [lastMetric, setLastMetric] = useState<Record<Theme, Metric>>(() => {
    const q = queryFromSearch(window.location.search);
    const base: Record<Theme, Metric> = { reporters: 'reports_count', fines: 'fine_count', unlucky: 'rejected_count' };
    if (q && RANKING_THEME_METRICS[q.theme].includes(q.metric)) base[q.theme] = q.metric;
    return base;
  });
  // Range + advanced drafts. Consumed ONLY by their own 조회/적용 buttons.
  // Immediate controls (tab/metric/category/month) always use APPLIED values.
  const [rangeStart, setRangeStart] = useState(() => queryFromSearch(window.location.search)?.start ?? '');
  const [rangeEnd, setRangeEnd] = useState(() => queryFromSearch(window.location.search)?.end ?? '');
  const [periodView, setPeriodView] = useState<RankingQuery['period']>(() => (queryFromSearch(window.location.search) ?? defaultQuery()).period);
  const [advBasis, setAdvBasis] = useState<RankingQuery['date_basis']>(() => (queryFromSearch(window.location.search) ?? defaultQuery()).date_basis);
  const [advMin, setAdvMin] = useState(() => String((queryFromSearch(window.location.search) ?? defaultQuery()).min_reports));
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [response, setResponse] = useState<{ data: RankingResponse; viewer: string | null; queryKey: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ message: string; status: number | null; retryAfter: number | null } | null>(null);
  const [access, setAccess] = useState<AccessCode | null>(null);
  const [accessDetails, setAccessDetails] = useState<PublicApiError['details']>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const [pendingIntent, setPendingIntent] = useState<RankingQuery | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [dialogUuid, setDialogUuid] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'done' | 'fail'>('idle');

  const abortRef = useRef<AbortController | null>(null);
  const genRef = useRef(0);
  const appliedKey = useMemo(() => JSON.stringify(applied), [applied]);
  const viewer = auth.status === 'signed_in' ? auth.viewerId : null;
  const appliedRef = useRef(applied);
  appliedRef.current = applied;
  const appliedKeyRef = useRef(appliedKey);
  appliedKeyRef.current = appliedKey;
  const activeRef = useRef(active);
  activeRef.current = active;
  const authRef = useRef(auth.status);
  authRef.current = auth.status;
  const pendingRef = useRef(pendingIntent);
  pendingRef.current = pendingIntent;
  const retryAtRef = useRef(retryAt);
  retryAtRef.current = retryAt;
  const lastFetch = useRef(0);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // Committed period follows the applied query; the range editor never stages into it.
  useEffect(() => { setPeriodView(applied.period); }, [applied.period]);
  // Advanced drafts follow committed values while the panel is closed.
  useEffect(() => {
    if (!detailsOpen) {
      setAdvBasis(applied.date_basis);
      setAdvMin(String(applied.min_reports));
    }
  }, [applied.date_basis, applied.min_reports, detailsOpen]);

  const writeUrl = useCallback((q: RankingQuery) => {
    try {
      const url = new URL(window.location.href);
      const params = url.searchParams;
      params.set(RK('theme'), q.theme);
      params.set(RK('metric'), q.metric);
      params.set(RK('period'), q.period);
      if (q.period === 'range' && q.start && q.end) {
        params.set(RK('start'), q.start);
        params.set(RK('end'), q.end);
      } else {
        params.delete(RK('start'));
        params.delete(RK('end'));
      }
      if (q.period === 'month' && q.month) params.set(RK('month'), q.month);
      else params.delete(RK('month'));
      params.set(RK('basis'), q.date_basis);
      params.set(RK('category'), q.category);
      params.set(RK('min'), String(q.min_reports));
      window.history.replaceState(window.history.state, '', `${url.pathname}?${params.toString()}${url.hash}`);
    } catch { /* URL sync is optional */ }
  }, []);

  /** Single commit path. Identical queries are dropped (no refetch of the selected tab/button). */
  const commit = useCallback((next: RankingQuery) => {
    const key = JSON.stringify({ ...next, page: 1, expected_version: null });
    const curKey = JSON.stringify({ ...appliedRef.current, page: 1, expected_version: null });
    if (key === curKey) return;
    if (next.theme !== appliedRef.current.theme || next.metric !== appliedRef.current.metric) {
      setLastMetric((m) => ({ ...m, [next.theme]: next.metric }));
    }
    setFormError(null);
    setNotice(null);
    if (retryAtRef.current !== null && Date.now() < retryAtRef.current) {
      // 429 cooldown: retain only the latest intent, no request storm.
      setPendingIntent(next);
      return;
    }
    setPendingIntent(null);
    setApplied(next);
    writeUrl(next);
  }, [writeUrl]);

  const commitImmediate = useCallback((patch: Partial<RankingQuery>) => {
    const cur = appliedRef.current;
    commit({ ...cur, ...patch, page: 1, expected_version: null });
  }, [commit]);

  const selectTab = useCallback((t: Theme) => {
    const cur = appliedRef.current;
    if (t === cur.theme) return;
    commit({ ...cur, theme: t, metric: lastMetric[t], page: 1, expected_version: null });
  }, [commit, lastMetric]);

  const selectMetric = useCallback((m: Metric) => {
    const cur = appliedRef.current;
    if (m === cur.metric) return;
    commit({ ...cur, metric: m, page: 1, expected_version: null });
  }, [commit]);

  const selectCategory = useCallback((c: RankingQuery['category']) => {
    const cur = appliedRef.current;
    if (c === cur.category) return;
    commitImmediate({ category: c });
  }, [commitImmediate]);

  const selectPeriodAll = useCallback(() => {
    const cur = appliedRef.current;
    if (cur.period === 'all') return;
    commit({ ...cur, period: 'all', start: null, end: null, month: null, page: 1, expected_version: null });
  }, [commit]);

  const selectPeriodMonth = useCallback(() => {
    const cur = appliedRef.current;
    const month = cur.period === 'month' && cur.month ? cur.month : kstMonth();
    if (cur.period === 'month' && cur.month === month) return;
    commit({ ...cur, period: 'month', month, start: null, end: null, page: 1, expected_version: null });
  }, [commit]);

  const stepMonth = useCallback((delta: number) => {
    const cur = appliedRef.current;
    const base = cur.period === 'month' && cur.month ? cur.month : kstMonth();
    const next = shiftMonth(base, delta);
    if (!next) return;
    if (cur.period === 'month' && cur.month === next) return;
    commit({ ...cur, period: 'month', month: next, start: null, end: null, page: 1, expected_version: null });
  }, [commit]);

  const applyMonthDirect = useCallback((value: string) => {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return;
    const cur = appliedRef.current;
    if (cur.period === 'month' && cur.month === value) return;
    commit({ ...cur, period: 'month', month: value, start: null, end: null, page: 1, expected_version: null });
  }, [commit]);

  const applyRange = useCallback(() => {
    if (retryAtRef.current !== null && Date.now() < retryAtRef.current) {
      setFormError('요청이 많아 잠시 후 다시 시도해 주세요.');
      return;
    }
    if (!rangeStart || !rangeEnd) {
      setFormError('직접 범위를 선택하면 시작일과 종료일을 모두 입력해 주세요.');
      return;
    }
    if (rangeStart > rangeEnd) {
      setFormError('시작일이 종료일보다 늦습니다.');
      return;
    }
    const cur = appliedRef.current;
    commit({ ...cur, period: 'range', start: rangeStart, end: rangeEnd, month: null, page: 1, expected_version: null });
  }, [commit, rangeStart, rangeEnd]);

  const applyAdvanced = useCallback(() => {
    if (retryAtRef.current !== null && Date.now() < retryAtRef.current) {
      setFormError('요청이 많아 잠시 후 다시 시도해 주세요.');
      return;
    }
    const min = advMin.trim() === '' ? 1 : Number(advMin);
    if (!Number.isInteger(min) || min < 1) {
      setFormError('최소 신고 건수는 1 이상의 정수입니다.');
      return;
    }
    const cur = appliedRef.current;
    commit({ ...cur, date_basis: advBasis, min_reports: min, page: 1, expected_version: null });
  }, [advBasis, advMin, commit]);

  const reset = useCallback(() => {
    const d = defaultQuery();
    setRangeStart('');
    setRangeEnd('');
    setAdvBasis(d.date_basis);
    setAdvMin('1');
    setFormError(null);
    setNotice(null);
    setPendingIntent(null);
    setRetryAt(null);
    setLastMetric({ reporters: 'reports_count', fines: 'fine_count', unlucky: 'rejected_count' });
    if (retryAtRef.current !== null && Date.now() < retryAtRef.current) {
      setPendingIntent(d);
      return;
    }
    setApplied(d);
    writeUrl(d);
  }, [writeUrl]);

  const gotoPage = useCallback((page: number) => {
    const cur = appliedRef.current;
    if (!cur || page === cur.page) return;
    if (retryAtRef.current !== null && Date.now() < retryAtRef.current) {
      setPendingIntent({ ...cur, page, expected_version: page > 1 ? cur.expected_version : null });
      return;
    }
    const version = response?.data.dataset_version ?? cur.expected_version;
    const next = { ...cur, page, expected_version: page > 1 ? version : null };
    setPendingIntent(null);
    setApplied(next);
    writeUrl({ ...next, page: 1, expected_version: null });
  }, [response, writeUrl]);

  const retry = useCallback(() => {
    if (retryAtRef.current !== null && Date.now() < retryAtRef.current) return;
    setRetryAt(null);
    setError(null);
    setNonce((n) => n + 1);
  }, []);

  // 429 countdown ticker.
  useEffect(() => {
    if (retryAt === null) return undefined;
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, [retryAt]);

  // 429 expiry: auto-resume exactly one latest intent (pending) or one refetch of applied. No storm.
  useEffect(() => {
    if (retryAt === null) return undefined;
    const wait = Math.max(0, retryAt - Date.now());
    const t = window.setTimeout(() => {
      setRetryAt(null);
      const pending = pendingRef.current;
      if (pending) {
        setPendingIntent(null);
        setApplied(pending);
        writeUrl(pending);
      } else {
        setNonce((n) => n + 1);
      }
    }, wait + 50);
    return () => window.clearTimeout(t);
  }, [retryAt, writeUrl]);

  const closeDialog = useCallback((restoreFocus = true) => {
    setDialogUuid(null);
    setCopyState('idle');
    if (restoreFocus) openerRef.current?.focus();
    openerRef.current = null;
  }, []);

  // Dialog holds a protected identifier: close it on hidden/account/query changes.
  useEffect(() => {
    if (dialogUuid !== null) closeDialog(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, viewer, appliedKey]);

  // Hidden / logout / account switch: abort, advance generation, clear protected state.
  // Plain setState (no flushSync): this runs inside a passive effect.
  useEffect(() => {
    if (!active || auth.status !== 'signed_in') {
      abortRef.current?.abort();
      abortRef.current = null;
      genRef.current += 1;
      setResponse(null);
      setLoading(false);
      setDialogUuid(null);
      setCopyState('idle');
      if (auth.status !== 'signed_in') {
        setError(null);
        setAccess(null);
        setPendingIntent(null);
        setRetryAt(null);
      }
    }
  }, [active, auth.status, viewer]);

  // Refresh / back / forward: restore from prefixed params; a URL without rk_*
  // clears prefixed state to the default instead of showing a stale snapshot.
  useEffect(() => {
    const onPop = () => {
      const q = queryFromSearch(window.location.search);
      if (!q) {
        const d = defaultQuery();
        setRangeStart('');
        setRangeEnd('');
        setAdvBasis(d.date_basis);
        setAdvMin('1');
        setNotice(null);
        setError(null);
        setPendingIntent(null);
        setApplied(d);
        return;
      }
      setRangeStart(q.start ?? '');
      setRangeEnd(q.end ?? '');
      setAdvBasis(q.date_basis);
      setAdvMin(String(q.min_reports));
      setLastMetric((m) => ({ ...m, [q.theme]: q.metric }));
      setNotice(null);
      setError(null);
      setPendingIntent(null);
      setApplied(q);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // pageshow / focus / visibility: abort while hidden; revalidate once when returning.
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
      setNonce((n) => n + 1);
    };
    const onHide = () => {
      abortRef.current?.abort();
      abortRef.current = null;
      genRef.current += 1;
      flushSync(() => { setResponse(null); setLoading(false); });
      setDialogUuid(null);
      lastFetch.current = 0;
    };
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

  // Main fetch. Server computes all sorting/ranks; the client never re-sorts.
  // Guards (generation, viewer, query key, active, visible) apply even if abort is ignored.
  useEffect(() => {
    if (!active || auth.status !== 'signed_in' || !applied) return undefined;
    if (document.visibilityState === 'hidden') return undefined;
    if (retryAtRef.current !== null && Date.now() < retryAtRef.current) return undefined;
    const myGen = ++genRef.current;
    const requestViewer = viewer;
    const requestKey = appliedKey;
    const ac = new AbortController();
    abortRef.current?.abort();
    abortRef.current = ac;
    setLoading(true);
    setResponse(null);
    setError(null);
    setAccess(null);
    loadRankings(applied, ac.signal)
      .then((data) => {
        if (ac.signal.aborted || myGen !== genRef.current) return;
        if (!activeRef.current || document.visibilityState === 'hidden') return;
        if ((authRef.current === 'signed_in' ? requestViewer : null) !== requestViewer) return;
        if (appliedKeyRef.current !== requestKey) return;
        setResponse({ data, viewer: requestViewer, queryKey: requestKey });
        setRetryAt(null);
        setPendingIntent(null);
        lastFetch.current = Date.now();
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (ac.signal.aborted || myGen !== genRef.current) return;
        if (!activeRef.current) return;
        setResponse(null);
        setLoading(false);
        if (e instanceof PublicApiError) {
          if (e.status === 409) {
            const cur = appliedRef.current;
            if (cur && (cur.page !== 1 || cur.expected_version !== null)) {
              setNotice('그사이 새 자료가 들어왔습니다. 첫 페이지부터 다시 불러옵니다.');
              const first = { ...cur, page: 1, expected_version: null };
              setApplied(first);
              writeUrl(first);
              setNonce((n) => n + 1);
            } else {
              setNotice('그사이 새 자료가 들어왔습니다. 다시 조회해 주세요.');
              setError({ message: '그사이 새 자료가 들어왔습니다. 다시 조회해 주세요.', status: 409, retryAfter: null });
            }
            return;
          }
          if (e.status === 429) {
            const wait = e.retryAfter && e.retryAfter > 0 ? e.retryAfter : 30;
            setRetryAt(Date.now() + wait * 1000);
            setError({ message: `요청이 많아 잠시 후 다시 시도해 주세요. ${wait}초 뒤에 자동으로 다시 시도합니다.`, status: 429, retryAfter: wait });
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
  }, [appliedKey, nonce, active, auth.status, viewer]);

  const openDialog = useCallback((uuid: string, opener: HTMLButtonElement) => {
    openerRef.current = opener;
    setCopyState('idle');
    setDialogUuid(uuid);
  }, []);

  // Move focus into the dialog when it opens.
  useEffect(() => {
    if (dialogUuid !== null) dialogRef.current?.focus();
  }, [dialogUuid]);

  const onDialogKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeDialog(true);
      return;
    }
    if (e.key !== 'Tab' || !dialogRef.current) return;
    const items = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>('button, input, [tabindex]:not([tabindex="-1"])'),
    ).filter((el) => !el.hasAttribute('disabled'));
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }, [closeDialog]);

  const copyUuid = useCallback(async (uuid: string) => {
    try {
      await navigator.clipboard.writeText(uuid);
      setCopyState('done');
      window.setTimeout(() => setCopyState((c) => (c === 'done' ? 'idle' : c)), 1600);
    } catch {
      // Never report a failed copy as success; offer manual copy instead.
      setCopyState('fail');
    }
  }, []);

  const data = response?.data ?? null;
  // Guard: never render another account's snapshot or a stale query's rows.
  const guarded = data && response && response.viewer === viewer && response.queryKey === appliedKey && auth.status === 'signed_in' ? data : null;
  const appliedMetric: Metric = applied.metric;
  const metricTitle = METRIC_TITLES[appliedMetric];
  const heading = `${periodPrefix(applied, nowMonth)}${metricTitle}`;
  const retryWait = retryAt !== null ? Math.max(0, Math.ceil((retryAt - now) / 1000)) : 0;

  const scopeText = useMemo(() => {
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
    return `${basis} 기준 · ${period} · ${cat} 분류 · 최소 ${applied.min_reports}건`;
  }, [applied]);

  const me = guarded?.me ?? null;
  const rows = guarded?.rows ?? [];
  const isRate = appliedMetric.endsWith('_rate');
  const isReporters = applied.theme === 'reporters';
  const valueHeader = VALUE_HEADERS[appliedMetric];
  const pageSize = guarded?.page_size ?? PAGE_SIZE;
  const rangeStartRow = guarded ? (guarded.page - 1) * pageSize + 1 : 0;
  const rangeEndRow = guarded ? rangeStartRow + rows.length - 1 : 0;
  const unluckyDim: 'rejected' | 'partial' = appliedMetric.startsWith('partial') ? 'partial' : 'rejected';
  const rateCount: 'count' | 'rate' = isRate ? 'rate' : 'count';
  const rangeDirty = periodView === 'range' && (
    rangeStart !== (applied.start ?? '') || rangeEnd !== (applied.end ?? '') || applied.period !== 'range'
  );
  const advDirty = advBasis !== applied.date_basis || advMin.trim() !== String(applied.min_reports);

  const monthLabel = (m: string | null) => {
    if (!m) return nowMonth;
    const [y, mo] = m.split('-');
    return `${y}년 ${Number(mo)}월`;
  };
  const appliedMonth = applied.period === 'month' && applied.month ? applied.month : nowMonth;

  return (
    <section className="rk-page" aria-labelledby="rk-title" hidden={!active}>
      <div className="rk-head">
        <div className="overline">USER RANKINGS</div>
        <h1 id="rk-title">참여자 랭킹</h1>
        <p className="rk-sub">{heading}</p>
        <p className="rk-disclaimer">이 서비스에 공유된 완료 신고를 기준으로 집계합니다.</p>
      </div>

      <div className="rk-controls cm-panel" role="group" aria-label="랭킹 종류와 기간">
        <div className="rk-tabs" role="group" aria-label="랭킹 종류">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={applied.theme === t.id ? 'selected' : ''}
              aria-pressed={applied.theme === t.id}
              onClick={() => selectTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {!isReporters && (
          <div className="rk-metric-row">
            {applied.theme === 'unlucky' && (
              <div className="rk-seg" role="group" aria-label="불운 종류">
                <button
                  type="button"
                  className={unluckyDim === 'rejected' ? 'selected' : ''}
                  aria-pressed={unluckyDim === 'rejected'}
                  onClick={() => selectMetric(rateCount === 'rate' ? 'rejected_rate' : 'rejected_count')}
                >
                  불수용
                </button>
                <button
                  type="button"
                  className={unluckyDim === 'partial' ? 'selected' : ''}
                  aria-pressed={unluckyDim === 'partial'}
                  onClick={() => selectMetric(rateCount === 'rate' ? 'partial_rate' : 'partial_count')}
                >
                  일부수용
                </button>
              </div>
            )}
            <div className="rk-seg" role="group" aria-label="정렬 기준">
              <button
                type="button"
                className={!isRate ? 'selected' : ''}
                aria-pressed={!isRate}
                onClick={() => selectMetric(applied.theme === 'fines'
                  ? 'fine_count'
                  : unluckyDim === 'partial' ? 'partial_count' : 'rejected_count')}
              >
                건수순
              </button>
              <button
                type="button"
                className={isRate ? 'selected' : ''}
                aria-pressed={isRate}
                onClick={() => selectMetric(applied.theme === 'fines'
                  ? 'fine_rate'
                  : unluckyDim === 'partial' ? 'partial_rate' : 'rejected_rate')}
              >
                비율순
              </button>
            </div>
            {isRate && (
              <p className="rk-hint">비율순에서는 최소 건수 조건이 순위에 크게 영향을 줍니다. 현재 조건: 최소 {applied.min_reports}건 (상세 조건에서 변경).</p>
            )}
          </div>
        )}

        <div className="rk-field rk-period">
          <span id="rk-period-label">기간</span>
          <div className="rk-seg" role="group" aria-labelledby="rk-period-label">
            <button
              type="button"
              className={periodView === 'all' ? 'selected' : ''}
              aria-pressed={periodView === 'all'}
              onClick={selectPeriodAll}
            >
              전체 기간
            </button>
            <button
              type="button"
              className={periodView === 'month' ? 'selected' : ''}
              aria-pressed={periodView === 'month'}
              onClick={selectPeriodMonth}
            >
              월별
            </button>
            <button
              type="button"
              className={periodView === 'range' ? 'selected' : ''}
              aria-pressed={periodView === 'range'}
              onClick={() => {
                setPeriodView('range');
                if (applied.period === 'range') {
                  setRangeStart(applied.start ?? '');
                  setRangeEnd(applied.end ?? '');
                }
              }}
            >
              기간 지정
            </button>
          </div>
          {periodView === 'month' && (
            <div className="rk-month-row">
              <button type="button" className="ghost-btn" aria-label="이전 달" onClick={() => stepMonth(-1)}>〈</button>
              <span className="rk-month-label" aria-live="polite">{monthLabel(appliedMonth)}</span>
              <button type="button" className="ghost-btn" aria-label="다음 달" onClick={() => stepMonth(1)}>〉</button>
              <label className="rk-month-direct">직접 선택
                <input
                  type="month"
                  value={appliedMonth}
                  onChange={(e) => applyMonthDirect(e.target.value)}
                  aria-label="조회할 달 직접 선택"
                />
              </label>
            </div>
          )}
          {periodView === 'range' && (
            <div className="rk-range-row">
              <label className="rk-field">시작일
                <input type="date" value={rangeStart} onChange={(e) => setRangeStart(e.target.value)} aria-label="시작일" />
              </label>
              <label className="rk-field">종료일
                <input type="date" value={rangeEnd} onChange={(e) => setRangeEnd(e.target.value)} aria-label="종료일" />
              </label>
              <button type="button" className="primary-button rk-range-apply" onClick={applyRange} disabled={retryWait > 0}>
                조회
              </button>
            </div>
          )}
          {periodView === 'range' && rangeDirty && (
            <p className="rk-hint" role="status">입력한 범위는 조회를 누르기 전에는 반영되지 않습니다.</p>
          )}
        </div>

        <label className="rk-field rk-category">분류
          <select
            aria-label="분류"
            value={applied.category}
            onChange={(e) => selectCategory(e.target.value as RankingQuery['category'])}
          >
            <option value="all">전체</option>
            <option value="traffic">교통위반</option>
            <option value="parking">주정차</option>
            <option value="other">기타</option>
          </select>
        </label>

        <details
          className="rk-advanced"
          open={detailsOpen}
          onToggle={(e) => {
            // Closed-panel effect already synchronizes drafts. The native toggle event can run
            // after the first input event; resetting here would erase that user's new selection.
            setDetailsOpen((e.target as HTMLDetailsElement).open);
          }}
        >
          <summary>상세 조건</summary>
          <div className="rk-advanced-body">
            <label className="rk-field">날짜 기준
              <select
                aria-label="날짜 기준"
                value={advBasis}
                onChange={(e) => setAdvBasis(e.target.value as RankingQuery['date_basis'])}
              >
                <option value="completed_date">답변일</option>
                <option value="report_date">신고일</option>
              </select>
            </label>
            <label className="rk-field">최소 신고 건수
              <input
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={advMin}
                onChange={(e) => setAdvMin(e.target.value)}
                aria-label="최소 신고 건수"
              />
            </label>
            <button type="button" className="primary-button" onClick={applyAdvanced} disabled={retryWait > 0}>
              적용
            </button>
          </div>
          {advDirty && <p className="rk-hint" role="status">바꾼 상세 조건은 적용을 누르기 전에는 반영되지 않습니다.</p>}
        </details>

        {formError && <p className="field-error" role="alert">{formError}</p>}
        <div className="rk-actions">
          <button className="ghost-btn" type="button" onClick={reset} disabled={retryWait > 0}>초기화</button>
        </div>
        {pendingIntent && retryWait > 0 && (
          <p className="rk-hint" role="status">요청 제한 중입니다. {retryWait}초 뒤에 마지막 요청부터 자동으로 다시 시도합니다.</p>
        )}
      </div>

      <div aria-live="polite">
        {notice && <p className="banner warn rk-notice" role="status">{notice}</p>}
        {guarded?.scope.in_progress && (
          <p className="banner rk-notice" role="note">집계 중 — 진행 중인 달이라 순위가 계속 바뀝니다. 같은 경과 기간끼리 비교해 주세요.</p>
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
        <AccessGate code={access} auth={auth} onSignIn={signIn} onSignOut={signOut} onRetry={() => setNonce((n) => n + 1)} progress={access === 'upload_required' ? accessDetails : null} />
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
          <section className="cm-panel rk-panel rk-me" aria-label="내 순위 요약">
            <h2>내 순위</h2>
            {me ? (
              <p className="rk-me-line">
                <strong>내 순위 {me.rank}위 / {guarded.total_participants.toLocaleString('ko-KR')}명</strong>
                <span>{valueHeader} {formatValue(me, appliedMetric)}</span>
                {isRate && <span>{me.denominator.toLocaleString('ko-KR')}건 중 {me.numerator.toLocaleString('ko-KR')}건</span>}
                {!isReporters && <span>완료 신고 {me.reports.toLocaleString('ko-KR')}건</span>}
                {me.tie_count > 1 && <span>공동 {me.tie_count}명</span>}
              </p>
            ) : (
              <p className="cm-muted" role="note">이 조건에서는 내 기록이 없습니다. 공유된 완료 신고가 있으면 기간·분류·최소 신고 건수를 넓혀 보세요.</p>
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
                <h2>{heading}</h2>
                <div className="rk-badges">
                  <span className="cm-chip">참여자 {guarded.total_participants.toLocaleString('ko-KR')}명</span>
                  {guarded.total_participants === 1 && <span className="cm-chip">표본 1건</span>}
                </div>
              </div>
              <p className="rk-scope-line">{scopeText}</p>
              <div className="table-scroll rk-scroll">
                <table className="entity-table rk-table rk-table-desktop">
                  <thead>
                    <tr>
                      <th scope="col" className="num">순위</th>
                      <th scope="col">참여자</th>
                      <th scope="col" className="num">{valueHeader}</th>
                      {!isReporters && <th scope="col" className="num">완료 신고</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.uuid} className={row.is_me ? 'rk-me-row' : undefined}>
                        <td className="num">
                          {row.rank}위
                          {row.tie_count > 1 && <small> 공동 {row.tie_count}명</small>}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="rk-uuid-btn"
                            title={row.uuid}
                            aria-label={`참여자 ${shortUuid(row.uuid)} 전체 UUID 보기`}
                            aria-haspopup="dialog"
                            onClick={(e) => openDialog(row.uuid, e.currentTarget)}
                          >
                            <code className="rk-uuid">{shortUuid(row.uuid)}</code>
                          </button>
                          {row.is_me && <span className="rk-me-badge">나</span>}
                        </td>
                        <td className="num">
                          <b>{formatValue(row, appliedMetric)}</b>
                          {isRate && <small> {row.denominator.toLocaleString('ko-KR')}건 중 {row.numerator.toLocaleString('ko-KR')}건</small>}
                          {row.reports === 1 && <small>표본 1건</small>}
                        </td>
                        {!isReporters && (
                          <td className="num" aria-label={`완료 신고 ${row.reports}건, 결과 미확인 ${row.completed_unknown}건`}>
                            {row.reports.toLocaleString('ko-KR')}건
                            {row.completed_unknown > 0 && <small> 미확인 {row.completed_unknown}건 포함</small>}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="rk-list" aria-label={`${heading} 목록`}>
                {rows.map((row) => (
                  <li key={row.uuid} className={row.is_me ? 'rk-me-row' : undefined}>
                    <span className="rk-list-rank">
                      {row.rank}위{row.tie_count > 1 && <small> 공동 {row.tie_count}명</small>}
                    </span>
                    <span className="rk-list-person"><button
                      type="button"
                      className="rk-uuid-btn"
                      aria-label={`참여자 ${shortUuid(row.uuid)} 전체 UUID 보기`}
                      aria-haspopup="dialog"
                      onClick={(e) => openDialog(row.uuid, e.currentTarget)}
                    >
                      <code className="rk-uuid">{shortUuid(row.uuid)}</code>
                    </button>
                    {row.is_me && <span className="rk-me-badge">나</span>}</span>
                    <b className="rk-list-value">{formatValue(row, appliedMetric)}</b>
                    <span className="rk-list-sub">
                      {isRate
                        ? `${valueHeader} ${row.denominator.toLocaleString('ko-KR')}건 중 ${row.numerator.toLocaleString('ko-KR')}건`
                        : `완료 신고 ${row.reports.toLocaleString('ko-KR')}건`}
                      {!isReporters && row.completed_unknown > 0 ? ` · 미확인 ${row.completed_unknown}건 포함` : ''}
                      {row.reports === 1 ? ' · 표본 1건' : ''}
                    </span>
                  </li>
                ))}
              </ul>
              {isRate && <p className="rk-fraction-note">비율이 같아 보여도 실제 분수가 다를 수 있습니다. 순위는 서버가 정확한 분수로 매깁니다.</p>}
              <div className="rk-pager">
                <button
                  className="ghost-btn"
                  type="button"
                  disabled={guarded.page <= 1 || loading}
                  onClick={() => gotoPage(guarded.page - 1)}
                >
                  이전
                </button>
                <span className="cm-muted" aria-live="polite">
                  참여자 {rangeStartRow.toLocaleString('ko-KR')}–{rangeEndRow.toLocaleString('ko-KR')} / {guarded.total_participants.toLocaleString('ko-KR')}명
                </span>
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

          <section className="cm-panel rk-panel" aria-label="집계 기준">
            <h2>집계 기준 보기</h2>
            <details>
              <summary>완료 신고를 세는 방법</summary>
              <p>완료 신고는 수용·일부수용·불수용·결과 미확인을 모두 포함한, 공유된 완료 신고 건수입니다. 표본이 1건이어도 숨기지 않습니다.</p>
            </details>
            <details>
              <summary>과태료·불운을 세는 방법</summary>
              <p>과태료는 수용·일부수용 중 실제 처분이 과태료인 신고입니다(금액이 없어도 포함). 불수용·일부수용은 각 결과에 해당한 신고입니다. 비율은 같은 모임의 완료 신고를 분모로 나눈 값입니다.</p>
            </details>
            <details>
              <summary>개발용 진단 수치</summary>
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

      {dialogUuid !== null && (
        <div className="rk-dialog-backdrop" onClick={() => closeDialog(true)}>
          <div
            ref={dialogRef}
            className="rk-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="참여자 UUID"
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={onDialogKeyDown}
          >
            <h2>참여자 UUID</h2>
            <input
              className="rk-dialog-uuid"
              readOnly
              value={dialogUuid}
              aria-label="전체 UUID"
              onFocus={(e) => e.target.select()}
            />
            <div className="rk-dialog-actions">
              <button type="button" className="primary-button" onClick={() => void copyUuid(dialogUuid)}>
                {copyState === 'done' ? '복사됨' : '복사'}
              </button>
              <button type="button" className="ghost-btn" onClick={() => closeDialog(true)}>
                닫기
              </button>
            </div>
            {copyState === 'done' && <p className="rk-copy-ok" role="status">복사했습니다.</p>}
            {copyState === 'fail' && (
              <p className="rk-copy-fail" role="alert">복사에 실패했습니다. 위 주소를 직접 선택해 복사해 주세요.</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
