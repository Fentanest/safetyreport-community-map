/**
 * 2026-10-18: the personal comparison cut agencies/managers at 50 and my_points at 1000. The scatter outline
 * (AnalyticsCharts ScatterCard), the public table's "내" line (EntityTable) and the map marks (pointMarks) look
 * rows up by key, so the 51st agency of a viewer with 64 (인천제물포경찰서, one answer) lost its outline.
 * The response now carries every row of mine up to bounds above the largest production contributor
 * (agencies 275, managers 749, places 3,376); only the comparison table stays a top-50 list.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { ScreenAggregates, type ScreenAggregate } from '../../server/screenAggregate';
import { MAX_COMPARE_AGENCIES, MAX_COMPARE_MANAGERS, MAX_MY_POINTS } from '../../server/compare';
import { personalCompareSchema } from '../../src/data/personal';
import { DEMO_SCOPE } from '../../src/domain/public';
import { demoMeta } from '../../src/data/demoEngine';
import ManagerCompare from '../../src/components/ManagerCompare';
import type { PersonalState } from '../../src/hooks/usePersonal';

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

// 64 agencies like the reported viewer: the first 46 with two or more answers, the rest with one
const AGENCIES = 64, MANAGERS = 800, PLACES = 1200;
const agencyKey = (i: number) => `inst:ag-c${String(i).padStart(7, '0')}`;
const stats: Stat[] = [
  row('all', 'summary', '', { n: 9000, c: 8000 }), row('mine', 'summary', '', { n: 1400, c: 1300 }),
  ...Array.from({ length: AGENCIES }, (_, i) => {
    const label: Stat['label'] = [agencyKey(i), `기관 ${i}`, null, null];
    return [row('all', 'agency', agencyKey(i), { label, n: 900 - i, c: 900 - i }),
      row('mine', 'agency', agencyKey(i), { label, n: i < 46 ? 60 - i : 1, c: i < 46 ? 60 - i : 1 })];
  }).flat(),
  ...Array.from({ length: MANAGERS }, (_, i) => {
    const key = `${agencyKey(i % AGENCIES)}:mg-${i}`;
    const label: Stat['label'] = [agencyKey(i % AGENCIES), `기관 ${i % AGENCIES}`, `mg-${i}`, `담당자 ${i}`];
    return [row('all', 'manager', key, { label, n: 50, c: 50 }), row('mine', 'manager', key, { label, n: 1, c: 1 })];
  }).flat(),
  ...Array.from({ length: PLACES }, (_, i) => row('mine', 'place', `pl1:${i}`, { n: 1, c: 1 })),
];
const anchors: ScreenAggregate['anchors'] = Array.from({ length: PLACES }, (_, i) =>
  ['mine', `pl1:${i}`, 37 + i / 10000, 126.8 + i / 10000, '주소', '11500']);
const aggregate: ScreenAggregate = { encoding: 'screen-aggregate-v2', stats, anchors, full: [],
  vehicles: { identifiable: 0, top: [], days: [0, 0, 0, 0], excluded: [0, 0] }, source_min: null };

describe('personal comparison carries every row of mine (production screen path)', () => {
  const result = new ScreenAggregates(aggregate, DEMO_SCOPE, state as any).compare(viewer);

  it('keeps the 51st+ agency, every manager and every place, and the client schema accepts it', () => {
    expect(result.agencies).toHaveLength(AGENCIES);
    expect(result.agencies.findIndex(r => r.key === agencyKey(63))).toBe(63); // one answer, last in the order
    expect(result.managers).toHaveLength(MANAGERS);
    expect(result.my_points).toHaveLength(PLACES);
    expect(personalCompareSchema.safeParse(JSON.parse(JSON.stringify(result))).success).toBe(true);
  });

  it('bounds stay above the largest production contributor and match the client schema', () => {
    expect(MAX_COMPARE_AGENCIES).toBeGreaterThanOrEqual(275 * 1.5);
    expect(MAX_COMPARE_MANAGERS).toBeGreaterThanOrEqual(749 * 1.5);
    expect(MAX_MY_POINTS).toBeGreaterThanOrEqual(3376 * 1.4);
    const many = { ...JSON.parse(JSON.stringify(result)),
      agencies: Array(MAX_COMPARE_AGENCIES + 1).fill(result.agencies[0]) };
    expect(personalCompareSchema.safeParse(many).success).toBe(false);
  });

  it('the comparison table stays a top list: the toggle offers the first 50 of the full count', () => {
    const personal = { status: 'ready', data: result, error: null, retry: () => {} } as unknown as PersonalState;
    const html = renderToStaticMarkup(createElement(ManagerCompare, { personal, onPick: () => {} }));
    expect(html).toContain('상위 50명 보기 (전체 800)');
    expect(html.match(/<tr>/g)?.length).toBe(1 + 5); // header + the first five
  });
});
