/**
 * 2026-10-12: 운영은 화면 집계 경로(server/screenAggregate.ts의 ScreenAggregates → my-analytics Edge
 * server/screenHandler.ts, SQL screen-aggregate-v2 인코딩)를 쓴다. 직전 커밋(d6d7910)은 데모/레거시 fact 경로인
 * server/compare.ts의 summarize()/side()에만 warning_count를 넣었고, screenAggregate.ts가 내부에서 쓰는 동명의
 * summary()/side()(ScreenAggregates.compare()가 호출)에는 빠져 있었다 — SQL은 이미 'w' 열을 all·mine 양쪽에
 * 채우고 있었는데도(stats CTE, overview()의 S01 warning_count:s.w는 정상), compare()의 all/mine 요약만 누락됐다.
 * 그래서 운영 화면에서만 KPI 하단 줄 '계도'의 '내' 값이 비어 보였다(데모 경로는 증상이 없어 재현되지 않았다).
 *
 * 이 파일은 SQL이 돌려주는 그대로의 screen-aggregate-v2 모양(Stat 행 object, encoding 필드)을 직접 구성해
 * ScreenAggregates와 my-analytics /screen 핸들러 전체를 통과시켜, 운영 경로에서 mine.warning_count가 채워지는지
 * 그리고 사이드(entity/region) 쪽 side()도 같은 결함이 있었는지 검증한다.
 */
import { describe, expect, it } from 'vitest';
import { createScreenHandler } from '../../server/screenHandler';
import { ScreenAggregates, type ScreenAggregate } from '../../server/screenAggregate';
import { dashboardResponseSchema } from '../../src/data/schema';
import { personalCompareSchema } from '../../src/data/personal';
import { DEMO_SCOPE } from '../../src/domain/public';
import { demoMeta, DEMO_VIEWER_ID } from '../../src/data/demoEngine';

const scope = DEMO_SCOPE;
const state = { ...demoMeta(), ready: true, coverage_note: 'synthetic', dedupe_policy_version: 'contribution-dedupe-v1' };
const viewer = { user_ok: true, kakao: true, session: true, contributor: 'active' as const, has_public_facts: true, public_fact_count: 10 };

type Stat = ScreenAggregate['stats'][number];
const emptyStat: Omit<Stat, 'side' | 'period' | 'kind' | 'k' | 'focus' | 'ord'> = {
  label: [null, '기관 정보 없음', null, null],
  n: 0, c: 0, a: 0, p: 0, r: 0, f: 0, w: 0, penalty: 0, places: 0, missing: 0, answer_missing: 0,
  duration: [0, null, null, null, null, null, 0, 0, 0], amount: [0, null, null, 0, 0, 0, 0, 0, 0],
  rating: [0, null], histogram: Array(13).fill(0), ratings: Array.from({ length: 6 }, () => Array(5).fill(0)),
};
const row = (side: 'all' | 'mine', kind: string, k: string, over: Partial<Stat>): Stat =>
  ({ ...emptyStat, side, period: 0, kind, k, focus: '', ord: 0, ...over });

// all: 완료 3754건 중 계도 743건(19.8%), 평균 8.6일 · 중앙값 8일. mine: 완료 50건 중 계도 8건, 평균 53.0일(2650/50) · 중앙값 56일.
const stats: Stat[] = [
  row('all', 'summary', '', { n: 4200, c: 3754, a: 2000, p: 300, r: 400, f: 800, w: 743, places: 120, missing: 50, answer_missing: 10,
    duration: [3754, 32300, 8, 20, 0, 130, 0, 0, 0], amount: [600, 90000000, 80000, 5, 150, 30, 0, 0, 15] }),
  row('mine', 'summary', '', { n: 60, c: 50, a: 20, p: 5, r: 15, f: 12, w: 8, places: 10, missing: 2, answer_missing: 1,
    duration: [50, 2650, 56, 90, 1, 120, 0, 0, 0], amount: [10, 800000, 75000, 0, 2, 0, 0, 0, 0] }),
  // region-level rows, so compare().regions[*].all/mine (built from the OTHER side() function) is also checked.
  row('all', 'region', '11', { n: 500, c: 450, a: 300, p: 50, r: 50, f: 80, w: 40, places: 30,
    duration: [450, 4500, 9, 25, 0, 90, 0, 0, 0], amount: [100, 8000000, 70000, 1, 10, 2, 0, 0, 1] }),
  row('mine', 'region', '11', { n: 8, c: 6, a: 3, p: 1, r: 1, f: 1, w: 1, places: 2,
    duration: [6, 72, 11, 15, 2, 20, 0, 0, 0], amount: [1, 50000, 50000, 0, 0, 0, 0, 0, 0] }),
];
const aggregate: ScreenAggregate = { encoding: 'screen-aggregate-v2', stats, anchors: [], full: [],
  vehicles: { identifiable: 0, top: [], days: [0, 0, 0, 0], excluded: [0, 0] }, source_min: null };

describe('ScreenAggregates.compare() — SQL screen-aggregate-v2 stats carry warning_count through (production path)', () => {
  it('summary(): all/mine.warning_count mirror the SQL w column, matching the public overview', () => {
    const agg = new ScreenAggregates(aggregate, scope, state as any);
    const result = agg.compare(viewer);
    expect(result.all.warning_count).toBe(743);
    expect(result.mine.warning_count).toBe(8);
    expect(agg.overview().warning_count).toBe(result.all.warning_count);
    // mean 53.0일(2650/50), median 56일 — matches the KpiPanel hero example in the task.
    expect(result.mine.duration.mean_days).toBe(53);
    expect(result.mine.duration.median_days).toBe(56);
    expect(personalCompareSchema.safeParse(JSON.parse(JSON.stringify(result))).success).toBe(true);
  });
  it('side(): region rows also carry warning_count and duration_mean_days for both all/mine', () => {
    const agg = new ScreenAggregates(aggregate, scope, state as any);
    const result = agg.compare(viewer);
    const seoul = result.regions.find(r => r.region_code === '11');
    expect(seoul).toBeTruthy();
    expect(seoul!.all.warning_count).toBe(40);
    expect(seoul!.mine.warning_count).toBe(1);
    expect(seoul!.all.duration_mean_days).toBe(10); // 4500/450
    expect(seoul!.mine.duration_mean_days).toBe(12); // 72/6
  });
});

describe('createScreenHandler end to end on an SQL-shaped screen-aggregate-v2 snapshot (no raw facts)', () => {
  const session = '11111111-2222-4333-8444-555555555555';
  const token = `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: DEMO_VIEWER_ID, role: 'authenticated', aud: 'authenticated', session_id: session })).toString('base64url')}.sig`;
  const q = new URLSearchParams({ date_basis: scope.date_basis, start: scope.start, end: scope.end, category: scope.category,
    panels: JSON.stringify([{ id: 'compare', path: 'compare', params: {} }]) });
  const req = () => new Request(`https://local.invalid/my-analytics/screen?${q}`, { headers: { Authorization: `Bearer ${token}` } });

  it('returns a compare panel whose mine.warning_count is populated (the exact bug the user reported)', async () => {
    const handler = createScreenHandler({ enabled: true, allowedOrigins: [], jwtIssuer: null,
      getUser: async () => ({ id: DEMO_VIEWER_ID, isAnonymous: false }), rpc: async (name, args) => {
        if (name.endsWith('rate_limit')) return true;
        expect(args.p_user).toBe(DEMO_VIEWER_ID); expect(args.p_session).toBe(session);
        return { state, viewer, aggregate };
      } });
    const response = await handler(req());
    expect(response.status).toBe(200);
    const body = await response.json();
    dashboardResponseSchema.parse(body.dashboard);
    expect(body.dashboard.overview.warning_count).toBe(743);
    const compare = personalCompareSchema.parse(body.panels[0].body);
    expect(compare.all.warning_count).toBe(743);
    expect(compare.mine.warning_count).toBe(8); // previously undefined in production
    expect(compare.mine.completed_count).toBe(50);
  });
});
