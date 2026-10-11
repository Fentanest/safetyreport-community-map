/**
 * Synthetic user rankings for the demo build only (loaded through a literal VITE_DATA_MODE check, so live builds
 * drop this chunk). Participants and numbers are made up; ranks follow the same rules the server states
 * (descending value, equal values share a competition rank, rates compared as exact fractions, then larger N,
 * then UUID ascending for display order).
 */
import {
  type RankingQuery, type RankingResponse, type RankingRow, kstMonth, monthBounds, responseSchema,
} from '../../contracts/user-rankings/types';
import {
  BOARD_METRICS, type BoardQuery, type BoardResponse, boardResponseSchema,
} from '../../contracts/user-rankings-board/types';

const N = 37;
const ME = 6; // the demo viewer

/** small deterministic generator (same participants on every load) */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}
const hex = (r: () => number, n: number) => Array.from({ length: n }, () => Math.floor(r() * 16).toString(16)).join('');

type Cohort = Pick<RankingQuery, 'period' | 'month' | 'start' | 'end' | 'category' | 'date_basis' | 'min_reports'>;
type Person = { uuid: string; reports: number; fine: number; rejected: number; partial: number; unknown: number };

function people(q: Cohort): Person[] {
  // the period and category scale the counts so each choice shows a different, plausible table
  const scale = q.period === 'month' ? 0.12 : q.period === 'range' ? 0.45 : 1;
  // 5분류(observation-v5, 2026-10-11): safety·living은 교통위반·주정차보다 작은 몫, other는 더 작은 몫.
  const cat = q.category === 'all' ? 1 : q.category === 'traffic' ? 0.55 : q.category === 'parking' ? 0.35
    : q.category === 'safety' ? 0.12 : q.category === 'living' ? 0.08 : 0.04;
  const seed = [...`${q.period}|${q.month}|${q.start}|${q.end}|${q.category}|${q.date_basis}`].reduce((a, c) => a * 31 + c.charCodeAt(0), 7);
  const id = rng(20261004);
  const r = rng(seed);
  return Array.from({ length: N }, (_, i) => {
    const uuid = `${hex(id, 8)}-${hex(id, 4)}-4${hex(id, 3)}-a${hex(id, 3)}-${hex(id, 12)}`;
    const base = Math.round((260 / (i + 1.4) + r() * 18) * scale * cat);
    const reports = Math.max(1, base);
    const rejected = Math.round(reports * (0.12 + r() * 0.3));
    const partial = Math.round((reports - rejected) * (0.05 + r() * 0.18));
    const unknown = Math.round(reports * r() * 0.08);
    const fine = Math.round((reports - rejected - partial - unknown) * (0.2 + r() * 0.35));
    return { uuid, reports, fine: Math.max(0, fine), rejected, partial, unknown };
  });
}

/** Every eligible participant ranked by one metric, in the server's display order (rank → N desc → UUID). */
function rankAll(q: Cohort, metric: RankingQuery['metric']): RankingRow[] {
  const numer = (p: Person) => (metric.startsWith('fine') ? p.fine : metric.startsWith('rejected') ? p.rejected : metric.startsWith('partial') ? p.partial : p.reports);
  const isRate = metric.endsWith('_rate');
  const all = people(q).map((p, i) => ({ p, me: i === ME })).filter(({ p }) => p.reports >= q.min_reports);
  // exact comparison: a/b vs c/d by cross-multiplication for rates
  const cmp = (a: Person, b: Person) => (isRate ? numer(b) * a.reports - numer(a) * b.reports : numer(b) - numer(a));
  all.sort((x, y) => cmp(x.p, y.p) || y.p.reports - x.p.reports || (x.p.uuid < y.p.uuid ? -1 : x.p.uuid > y.p.uuid ? 1 : 0));
  const rows: RankingRow[] = [];
  all.forEach(({ p, me }, i) => {
    const prev = rows[i - 1];
    const same = i > 0 && cmp(all[i - 1].p, p) === 0;
    const rank = same ? prev.rank : i + 1;
    rows.push({
      uuid: p.uuid, rank, tie_count: 1, reports: p.reports, fine: p.fine, rejected: p.rejected, partial: p.partial,
      completed_unknown: p.unknown, numerator: numer(p), denominator: p.reports,
      value: isRate ? Math.round((numer(p) / p.reports) * 1000) / 10 : numer(p), is_me: me,
    });
  });
  const ties = new Map<number, number>();
  rows.forEach((r) => ties.set(r.rank, (ties.get(r.rank) ?? 0) + 1));
  rows.forEach((r) => { r.tie_count = ties.get(r.rank) ?? 1; });
  return rows;
}

function demoScope(q: Cohort) {
  const month = q.period === 'month' ? q.month ?? kstMonth() : null;
  const bounds = month ? monthBounds(month) : null;
  return {
    period: q.period,
    start: q.period === 'range' ? q.start : bounds?.start ?? null,
    end: q.period === 'range' ? q.end : bounds?.end ?? null,
    month, date_basis: q.date_basis, category: q.category, min_reports: q.min_reports,
    timezone: 'Asia/Seoul' as const, in_progress: month === kstMonth(),
  };
}

export function demoRankings(q: RankingQuery): RankingResponse {
  const rows = rankAll(q, q.metric);
  const start = (q.page - 1) * q.page_size;
  return responseSchema.parse({
    schema_version: 'user-rankings-v1',
    cohort_policy_version: 'single-date-v1',
    dataset_version: 'd3e0c0de0000000000000000000a1b2c',
    generated_at: new Date().toISOString(),
    scope: { theme: q.theme, metric: q.metric, ...demoScope(q) },
    total_participants: rows.length,
    rows: rows.slice(start, start + q.page_size),
    me: rows.find((r) => r.is_me) ?? null,
    page: q.page,
    page_size: q.page_size,
    next_page: start + q.page_size < rows.length ? q.page + 1 : null,
    diagnostics: { selected_date_missing: 0, completed_unknown: rows.reduce((a, r) => a + r.completed_unknown, 0), inconsistent_disposition: 0 },
  });
}

/** One-page board: each metric's top K and own rank, the same rows the paged demo list shows on its first page. */
export function demoRankingsBoard(q: BoardQuery): BoardResponse {
  const boards = BOARD_METRICS.map(({ theme, metric }) => {
    const rows = rankAll(q, metric);
    return { theme, metric, total_participants: rows.length, rows: rows.slice(0, q.top), me: rows.find((r) => r.is_me) ?? null };
  });
  return boardResponseSchema.parse({
    schema_version: 'user-rankings-board-v1',
    cohort_policy_version: 'single-date-v1',
    dataset_version: 'd3e0c0de0000000000000000000b0a2d',
    generated_at: new Date().toISOString(),
    scope: { ...demoScope(q), top: q.top },
    total_participants: boards[0].total_participants,
    boards,
    diagnostics: { selected_date_missing: 0, completed_unknown: rankAll(q, 'reports_count').reduce((a, r) => a + r.completed_unknown, 0), inconsistent_disposition: 0 },
  });
}
