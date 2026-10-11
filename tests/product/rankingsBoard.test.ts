import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';
import {
  BOARD_METRICS, boardQuerySchema, boardResponseSchema, type BoardQuery,
} from '../../contracts/user-rankings-board/types';
import { querySchema, type RankingRow } from '../../contracts/user-rankings/types';
import { createRankingHandler } from '../../server/rankings/handler';
import { demoRankings, demoRankingsBoard } from '../../src/data/demoRankings';

const uid = '11111111-2222-4333-8444-555555555555', session = '66666666-7777-4888-9999-aaaaaaaaaaaa';
const other = '99999999-2222-4333-8444-555555555555';
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
const token = `${b64({ alg: 'none' })}.${b64({ sub: uid, role: 'authenticated', aud: 'authenticated', session_id: session })}.test`;
const row = (uuid: string, extra: Partial<RankingRow> = {}): RankingRow => ({
  uuid, rank: 1, tie_count: 1, reports: 3, fine: 1, rejected: 1, partial: 0, completed_unknown: 0,
  numerator: 3, denominator: 3, value: 3, is_me: uuid === uid, ...extra,
});
export const boardFixture = (top = 5, rows: RankingRow[] = []) => ({
  schema_version: 'user-rankings-board-v1',
  cohort_policy_version: 'single-date-v1',
  dataset_version: 'b'.repeat(32),
  generated_at: '2026-10-11T00:00:00.000Z',
  scope: {
    period: 'all', start: null, end: null, month: null, date_basis: 'completed_date', category: 'all',
    min_reports: 1, top, timezone: 'Asia/Seoul', in_progress: false,
  },
  total_participants: rows.length,
  boards: BOARD_METRICS.map(({ theme, metric }) => ({ theme, metric, total_participants: rows.length, rows, me: rows.find((r) => r.is_me) ?? null })),
  diagnostics: { selected_date_missing: 0, completed_unknown: 0, inconsistent_disposition: 0 },
});
const setup = (extra: Record<string, unknown> = {}) => {
  const rpc = vi.fn(async () => { throw new Error('page rpc must not be used by the board route'); });
  const boardRpc = vi.fn(async (_u: string, _s: string, q: Record<string, unknown>, _sig: AbortSignal) => {
    const body = boardFixture(Number(q.top));
    return { ...body, scope: { ...body.scope, min_reports: Number(q.min_reports) } };
  });
  const allowRequest = vi.fn(async (_user: string) => true);
  const h = createRankingHandler({
    allowedOrigins: ['https://example.invalid'], jwtIssuer: null,
    getUser: async () => ({ id: uid, isAnonymous: false }), rpc, boardRpc, allowRequest, ...extra,
  });
  return { h, rpc, boardRpc, allowRequest };
};
const req = (q = '', auth = true, path = '/functions/v1/user-rankings/board', init: RequestInit = {}) =>
  new Request(`https://example.invalid${path}${q}`, { ...init, headers: { ...(auth ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) } });

describe('board route of the user-rankings function', () => {
  it('routes /user-rankings/board (with or without trailing slash) to the board RPC with the verified user only', async () => {
    const { h, rpc, boardRpc, allowRequest } = setup();
    for (const path of ['/functions/v1/user-rankings/board', '/functions/v1/user-rankings/board/', '/user-rankings/board']) {
      const r = await h(req('?period=month&month=2023-07&top=3', true, path));
      expect(r.status).toBe(200);
      expect(boardResponseSchema.parse(await r.json()).scope.top).toBe(3);
    }
    expect(rpc).not.toHaveBeenCalled();
    expect(boardRpc.mock.calls[0][0]).toBe(uid);
    expect(boardRpc.mock.calls[0][1]).toBe(session);
    expect(boardRpc.mock.calls[0][2]).toEqual({ period: 'month', start: null, end: null, month: '2023-07', date_basis: 'completed_date', category: 'all', min_reports: 1, top: 3 });
    // same rate bucket as the list: the limiter is asked with the same user key
    expect(allowRequest.mock.calls.every(([u]) => u === uid)).toBe(true);
  });
  it('other sub-paths are 404 and never reach the database', async () => {
    const { h, rpc, boardRpc } = setup();
    for (const path of ['/functions/v1/user-rankings/boards', '/functions/v1/user-rankings/board/x', '/functions/v1/user-rankings/../board2']) {
      expect((await h(req('', true, path))).status).toBe(404);
    }
    expect(rpc).not.toHaveBeenCalled();
    expect(boardRpc).not.toHaveBeenCalled();
  });
  it('query allowlist: page/theme/metric/user ids/duplicates/bad top and impossible periods are 400 without RPC', async () => {
    const { h, boardRpc } = setup();
    for (const q of ['?theme=fines', '?metric=fine_rate', '?page=1', '?page_size=5', '?expected_version=' + 'a'.repeat(32),
      '?user_id=' + other, '?top=0', '?top=11', '?top=2.5', '?top=x', '?top=3&top=4', '?min_reports=0', '?category=unknown',
      '?period=range&start=2026-10-02&end=2026-10-01', '?period=all&month=2026-10', '?period=all&start=2026-10-01',
      '?period=month&month=2026-13', '?consistency=stale', '?date_basis=upload_date']) {
      expect((await h(req(q))).status, q).toBe(400);
    }
    expect(boardRpc).not.toHaveBeenCalled();
    for (const q of ['', '?top=10', '?consistency=latest', '?period=range&start=2000-01-01&end=2026-10-11',
      '?category=safety&date_basis=report_date&min_reports=3']) {
      expect((await h(req(q))).status, q).toBe(200);
    }
  });
  it('401 anonymous, 403 bad origin, 405 method, 204 preflight — no RPC', async () => {
    const { h, boardRpc } = setup();
    expect((await h(req('', false))).status).toBe(401);
    expect((await h(req('', true, undefined, { headers: { origin: 'https://bad.invalid' } }))).status).toBe(403);
    expect((await h(req('', true, undefined, { method: 'POST' }))).status).toBe(405);
    const pre = await h(req('', false, undefined, { method: 'OPTIONS', headers: { origin: 'https://example.invalid' } }));
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-origin')).toBe('https://example.invalid');
    expect(boardRpc).not.toHaveBeenCalled();
  });
  it('429 with Retry-After, refusals 403/409, unknown DB errors and throws 503 without leaking', async () => {
    const limited = await setup({ allowRequest: async () => false }).h(req());
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('60');
    for (const [code, status] of [['upload_required', 403], ['kakao_required', 403], ['contributor_required', 403], ['session_expired', 401], ['DATASET_CHANGED', 409], ['weird', 503]] as const) {
      const r = await setup({ boardRpc: async () => ({ error: code, details: { current: 4, secret: 'CANARY' }, private: 'CANARY' }) }).h(req());
      expect(r.status, code).toBe(status);
      const text = await r.text();
      expect(text).not.toContain('CANARY');
      if (code === 'upload_required') expect(JSON.parse(text).error.details).toEqual({ required: 10, current: 4 });
    }
    const thrown = await setup({ boardRpc: async () => { throw new Error('secret private report'); } }).h(req());
    expect(thrown.status).toBe(503);
    expect(await thrown.text()).not.toContain('secret');
    const invalid = await setup({ boardRpc: async () => { throw new Error('INVALID_QUERY'); } }).h(req());
    expect(invalid.status).toBe(400);
  });
  it('strict response parse and is_me cross-check close the route (503) on any mismatch', async () => {
    const ok = boardFixture(5, [row(other, { is_me: false }), row(uid, { rank: 2 })]);
    expect((await setup({ boardRpc: async () => ok }).h(req())).status).toBe(200);
    const cases: Array<[string, unknown]> = [
      ['extra top-level field', { ...ok, vehicle_raw: 'PRIVATE_CANARY' }],
      ['extra row field', { ...ok, boards: ok.boards.map((b) => ({ ...b, rows: b.rows.map((r) => ({ ...r, report_number: 'PRIVATE_CANARY' })) })) }],
      ['forged is_me on another user', { ...ok, boards: ok.boards.map((b) => ({ ...b, rows: [row(other, { is_me: true })] })) }],
      ['own row not marked', { ...ok, boards: ok.boards.map((b) => ({ ...b, rows: [row(uid, { is_me: false })] })) }],
      ['me of another user', { ...ok, boards: ok.boards.map((b) => ({ ...b, me: row(other, { is_me: true }) })) }],
      ['wrong board order', { ...ok, boards: [...ok.boards].reverse() }],
      ['missing board', { ...ok, boards: ok.boards.slice(1) }],
      ['theme/metric pair swapped', { ...ok, boards: ok.boards.map((b, i) => (i === 0 ? { ...b, theme: 'fines' } : b)) }],
      ['more rows than top', boardFixture(1, [row(other, { is_me: false }), row(uid, { rank: 2 })])],
      ['top differs from request', { ...ok, scope: { ...ok.scope, top: 4 } }],
      ['min differs from request', { ...ok, scope: { ...ok.scope, min_reports: 2 } }],
    ];
    for (const [name, body] of cases) {
      const r = await setup({ boardRpc: async () => body }).h(req());
      expect(r.status, name).toBe(503);
      expect(await r.text(), name).not.toContain('PRIVATE_CANARY');
    }
  });
  it('success and refusal are private no-store and vary on Origin, Authorization', async () => {
    const { h } = setup();
    for (const r of [await h(req()), await h(req('?top=0'))]) {
      expect(r.headers.get('cache-control')).toContain('no-store');
      expect(r.headers.get('vary')).toContain('Authorization');
      expect(r.headers.get('pragma')).toBe('no-cache');
    }
  });
  it('the paged list route is unchanged and does not call the board RPC', async () => {
    const page = vi.fn(async () => ({
      schema_version: 'user-rankings-v1', cohort_policy_version: 'single-date-v1', dataset_version: 'a'.repeat(32),
      generated_at: '2026-10-03T00:00:00.000Z',
      scope: { theme: 'reporters', metric: 'reports_count', period: 'all', start: null, end: null, month: null, date_basis: 'completed_date', category: 'all', min_reports: 1, timezone: 'Asia/Seoul', in_progress: false },
      total_participants: 0, rows: [], me: null, page: 1, page_size: 20, next_page: null,
      diagnostics: { selected_date_missing: 0, completed_unknown: 0, inconsistent_disposition: 0 },
    }));
    const { h, boardRpc } = setup({ rpc: page });
    expect((await h(req('', true, '/functions/v1/user-rankings'))).status).toBe(200);
    expect((await h(req('?top=5', true, '/functions/v1/user-rankings'))).status).toBe(400);
    expect(page).toHaveBeenCalledTimes(1);
    expect(boardRpc).not.toHaveBeenCalled();
  });
});

describe('board contract', () => {
  it('generated JSON schemas stay synchronized with the runtime allowlists', () => {
    for (const [name, schema] of [['query', boardQuerySchema], ['response', boardResponseSchema]] as const) {
      expect(JSON.parse(readFileSync(new URL(`../../contracts/user-rankings-board/${name}.schema.json`, import.meta.url), 'utf8')))
        .toEqual(z.toJSONSchema(schema));
    }
  });
  it('defaults: all-time, completed date, all categories, minimum 1, top 5', () => {
    expect(boardQuerySchema.parse({})).toEqual({ period: 'all', start: null, end: null, month: null, date_basis: 'completed_date', category: 'all', min_reports: 1, top: 5 });
  });
});

describe('demo board uses the same order and tie rules as the demo list', () => {
  const queries: BoardQuery[] = [
    boardQuerySchema.parse({}),
    boardQuerySchema.parse({ period: 'month', month: '2023-07', top: 10 }),
    boardQuerySchema.parse({ period: 'range', start: '2026-01-01', end: '2026-06-30', category: 'parking', min_reports: 5, top: 3 }),
    boardQuerySchema.parse({ category: 'other', min_reports: 2, date_basis: 'report_date' }),
  ];
  it.each(queries.map((q) => [JSON.stringify(q), q] as const))('%s', (_label, q) => {
    const board = boardResponseSchema.parse(demoRankingsBoard(q));
    expect(board.boards.map((b) => b.metric)).toEqual(BOARD_METRICS.map((m) => m.metric));
    for (const b of board.boards) {
      const list = demoRankings(querySchema.parse({ theme: b.theme, metric: b.metric, period: q.period, start: q.start, end: q.end, month: q.month,
        date_basis: q.date_basis, category: q.category, min_reports: q.min_reports, page: 1, page_size: q.top }));
      expect(b.rows).toEqual(list.rows);
      expect(b.me).toEqual(list.me);
      expect(b.total_participants).toBe(list.total_participants);
      // competition rank: non-decreasing, a tie shares the rank, the next rank skips by the tie size
      b.rows.forEach((r, i) => {
        if (i === 0) return;
        const prev = b.rows[i - 1];
        expect(r.rank).toBeGreaterThanOrEqual(prev.rank);
        if (r.rank === prev.rank) expect(r.tie_count).toBe(prev.tie_count);
        if (r.rank !== prev.rank) expect(r.rank).toBe(i + 1);
      });
    }
  });
  it('rates tie on exact fractions (1/2 = 2/4) and the larger N is listed first; counts tie on equal values', () => {
    const board = demoRankingsBoard(boardQuerySchema.parse({ top: 10 }));
    const rate = board.boards.find((b) => b.metric === 'fine_rate')!;
    for (let i = 1; i < rate.rows.length; i++) {
      const a = rate.rows[i - 1], c = rate.rows[i];
      const cross = c.numerator * a.denominator - a.numerator * c.denominator;
      expect(cross).toBeLessThanOrEqual(0);
      if (cross === 0) {
        expect(c.rank).toBe(a.rank);
        expect(c.reports).toBeLessThanOrEqual(a.reports);
      }
    }
  });
});
