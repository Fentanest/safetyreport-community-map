import { kstMonth, querySchema, type RankingQuery } from '../../contracts/user-rankings/types';
import { BOARD_TOP_DEFAULT, type BoardQuery } from '../../contracts/user-rankings-board/types';

type Theme = RankingQuery['theme'];
type Metric = RankingQuery['metric'];

export const RANKING_THEME_METRICS: Record<Theme, Metric[]> = {
  reporters: ['reports_count'],
  fines: ['fine_count', 'fine_rate'],
  unlucky: ['rejected_count', 'rejected_rate', 'partial_count', 'partial_rate'],
};

/** The one-page board (2026-10-11): three theme sections, each with its metric cards, in this order. */
export const BOARD_SECTIONS: ReadonlyArray<{ theme: Theme; label: string; note: string; metrics: Metric[] }> = [
  { theme: 'reporters', label: '신고 랭킹', note: '공유된 완료 신고가 많은 참여자', metrics: RANKING_THEME_METRICS.reporters },
  { theme: 'fines', label: '과태료 랭킹', note: '수용·일부수용 중 과태료 처분이 많은 참여자', metrics: RANKING_THEME_METRICS.fines },
  { theme: 'unlucky', label: '불운 랭킹', note: '불수용·일부수용이 많은 참여자', metrics: RANKING_THEME_METRICS.unlucky },
];

/** 'board' = every theme on one page; 'full' = the paged list of ONE metric ('전체 보기'). */
export type RankingView = 'board' | 'full';

const RK = (k: string) => `rk_${k}`;
const RK_KEYS = ['theme', 'metric', 'period', 'start', 'end', 'month', 'basis', 'category', 'min'];

export function defaultRankingQuery(pageSize = 20): RankingQuery {
  return {
    theme: 'reporters', metric: 'reports_count', period: 'all', start: null, end: null, month: null,
    date_basis: 'completed_date', category: 'all', min_reports: 1, page: 1, page_size: pageSize, expected_version: null,
  };
}

/**
 * rk_* → applied conditions + view. rk_theme/rk_metric are written only for '전체 보기', so an older link that
 * carries them (the 2026-10-04 tab UI) opens that metric's full list. null = no rk_* at all.
 */
export function rankingStateFromSearch(search: string, pageSize = 20): { query: RankingQuery; view: RankingView } | null {
  const p = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  if (!RK_KEYS.some((k) => p.get(RK(k)) !== null)) return null;
  const view: RankingView = p.has(RK('theme')) || p.has(RK('metric')) ? 'full' : 'board';
  const theme = p.get(RK('theme'));
  const raw = {
    theme: theme ?? undefined,
    // a theme without a metric falls back to that theme's first metric (a mismatched pair is invalid → default)
    metric: p.get(RK('metric')) ?? (theme && theme in RANKING_THEME_METRICS ? RANKING_THEME_METRICS[theme as Theme][0] : undefined),
    period: p.get(RK('period')) ?? undefined,
    start: p.get(RK('start')) ?? null,
    end: p.get(RK('end')) ?? null,
    month: p.get(RK('month')) ?? null,
    date_basis: p.get(RK('basis')) ?? undefined,
    category: p.get(RK('category')) ?? undefined,
    min_reports: p.has(RK('min')) ? Number(p.get(RK('min'))) : undefined,
    page: 1,
    page_size: pageSize,
    expected_version: null,
  };
  const parsed = querySchema.safeParse(raw);
  return parsed.success
    ? { query: { ...parsed.data, page: 1, expected_version: null }, view }
    : { query: defaultRankingQuery(pageSize), view: 'board' };
}

/** Writes the applied conditions into rk_* (theme/metric only in the full view). Other parameters are untouched. */
export function writeRankingParams(params: URLSearchParams, q: RankingQuery, view: RankingView): void {
  if (view === 'full') {
    params.set(RK('theme'), q.theme);
    params.set(RK('metric'), q.metric);
  } else {
    params.delete(RK('theme'));
    params.delete(RK('metric'));
  }
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
}

/** The board request of the applied conditions (theme/metric/page are not part of it). */
export function boardQueryOf(q: RankingQuery, top = BOARD_TOP_DEFAULT): BoardQuery {
  return {
    period: q.period, start: q.start, end: q.end, month: q.month, date_basis: q.date_basis,
    category: q.category, min_reports: q.min_reports, top,
  };
}

/** '이달', '2023년 7월', 'YYYY-MM-DD — YYYY-MM-DD' or '전체 기간' — the period part of every ranking title. */
export function rankingPeriodLabel(q: Pick<RankingQuery, 'period' | 'start' | 'end' | 'month'>, now = new Date()): string {
  if (q.period === 'range' && q.start && q.end) return `${q.start} — ${q.end}`;
  if (q.period === 'month') {
    const month = q.month ?? kstMonth(now);
    if (month === kstMonth(now)) return '이달';
    const [y, m] = month.split('-');
    return `${y}년 ${Number(m)}월`;
  }
  return '전체 기간';
}
