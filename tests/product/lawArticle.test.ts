// 위반법규 조 단위 묶음 (user decision 2026-09-28): key `{법이름} 제{N}조[의{M}]`, paragraph dropped, 조의M kept,
// whitespace absorbed, other text kept as trimmed text. Rows, filter and every public response use the key only.
import { describe, expect, it } from 'vitest';
import { aggregateDashboard, lawRows, type PrivateFact } from '../../server/aggregate';
import { aggregateCompare } from '../../server/compare';
import { createPublicHandler, type AnalyticsRepository, type AnalyticsState } from '../../server/publicHandler';
import { createPersonalHandler } from '../../server/personalHandler';
import { dashboardResponseSchema } from '../../src/data/schema';
import { DEMO_SCOPE, LAW_NONE, lawKey, type Scope } from '../../src/domain/public';
import { lawOptions } from '../../src/state/filters';
import { demoFacts, demoEngineDashboard } from '../../src/data/demoEngine';
import { fixtureAccess, TEST_MAP_ORIGIN, viewerRequest } from './helpers/mapViewer';

describe('lawKey', () => {
  it('drops the paragraph in both parser forms and keeps 조의M as its own article', () => {
    expect(lawKey('자동차관리법 제29조제1항')).toBe('자동차관리법 제29조');
    expect(lawKey('자동차관리법 제29조 1항')).toBe('자동차관리법 제29조');
    expect(lawKey('자동차관리법 제29조 제12항')).toBe('자동차관리법 제29조');
    expect(lawKey('도로교통법 제32조')).toBe('도로교통법 제32조');
    expect(lawKey('도로교통법 제5조의2')).toBe('도로교통법 제5조의2');
    expect(lawKey('도로교통법 제5조의2제3항')).toBe('도로교통법 제5조의2');
    expect(lawKey('도로교통법 제5조의2')).not.toBe(lawKey('도로교통법 제5조'));
  });
  it('absorbs whitespace and leading zeros', () => {
    for (const v of ['도로교통법제32조', ' 도로교통법  제 32 조 ', '도로 교통법 제32조', '도로교통법 제032조', '도로교통법　제32조 제1항']) {
      expect(lawKey(v)).toBe('도로교통법 제32조');
    }
    expect(lawKey('도로교통법 제 5 조 의 2')).toBe('도로교통법 제5조의2');
  });
  it('keeps a value outside the form as trimmed text, never drops it; null and blank are 법규 미상', () => {
    expect(lawKey('  도로교통법 위반  ')).toBe('도로교통법 위반');
    expect(lawKey('도로교통법 제32조 및 제33조')).toBe('도로교통법 제32조 및 제33조');
    expect(lawKey('제32조')).toBe('제32조');  // no law name: outside the form
    expect(lawKey(null)).toBeNull();
    expect(lawKey(undefined)).toBeNull();
    expect(lawKey('   ')).toBeNull();
  });
  it('keeps the same article of different laws apart', () => {
    expect(lawKey('도로교통법 제29조제1항')).not.toBe(lawKey('자동차관리법 제29조제1항'));
    expect(lawKey('주차장법 제29조')).toBe('주차장법 제29조');
  });
});

let n = 0;
const fact = (law: string | null, patch: Partial<PrivateFact> = {}): PrivateFact => ({
  fact_identity: `art-${n++}`, contributor_id: 'c1', snapshot_id: 'ingest-v1', snapshot_generation: 1,
  report_date: '2026-09-01', completed_date: '2026-09-05', category: 'parking', status: 'accepted', disposition: 'none',
  vehicle_raw: null, point_key: null, lat: null, lng: null, address: null, region_code: '서울 중구',
  agency_key: 'a1', agency_name: '기관1', manager_key: 'm1', manager_name: '담당1',
  amount_kind: 'unknown', amount_confirmed_won: null, amount_public: true, amount_stated: false, violation_law: law, ...patch,
});
const scope: Scope = { start: '2026-09-01', end: '2026-09-30', category: 'all', region_code: null, agency_key: null, manager_key: null, bbox: null, law: null };
const opts = { datasetVersion: 'v', sourceUpdatedAt: null, generatedAt: '2026-09-28T00:00:00Z', asOf: '2026-12-31', sample: false, dataMin: '2020-01-01' };
// 제32조: 4 (two with a paragraph) · 제5조: 2 · 제5조의2: 1 · 자동차관리법 제29조: 2 (both with a paragraph) · 도로교통법 제29조: 1 · 형식 밖 1 · 미상 1
const facts = [
  fact('도로교통법 제32조'), fact('도로교통법 제32조제1항', { status: 'rejected' }), fact('도로교통법 제32조 2항', { disposition: 'fine', amount_kind: 'fine', amount_confirmed_won: 40000, amount_stated: true }),
  fact('도로교통법제32조', { status: 'partial' }),
  fact('도로교통법 제5조'), fact('도로교통법 제5조', { status: 'rejected' }), fact('도로교통법 제5조의2'),
  fact('자동차관리법 제29조제1항'), fact('자동차관리법 제29조제3항', { status: 'rejected' }), fact('도로교통법 제29조'),
  fact(' 도로교통법 위반 '), fact(null),
];
const PARAGRAPH = /항/;

describe('rows and filter by article', () => {
  const data = aggregateDashboard(facts, scope, opts);
  it('groups paragraphs into their article; rows add up to the dashboard totals', () => {
    expect(data.laws!.map(r => [r.law, r.completed_count])).toEqual([
      ['도로교통법 제32조', 4], ['도로교통법 제5조', 2], ['자동차관리법 제29조', 2],
      ['도로교통법 위반', 1], ['도로교통법 제29조', 1], ['도로교통법 제5조의2', 1], [null, 1],
    ]);
    const l32 = data.laws![0];
    expect(l32.outcomes).toEqual({ accepted: 2, partial: 1, rejected: 1, result_known: 4, result_unknown: 0 });
    expect(l32.accept_rate).toBe(50);
    expect(l32.fine_count).toBe(1);
    expect(l32.fine_amount).toEqual({ fine_count: 1, confirmed_count: 1, sum_won: 40000, mean_won: 40000 });
    const total = (pick: (r: NonNullable<typeof data.laws>[number]) => number) => data.laws!.reduce((a, r) => a + pick(r), 0);
    expect(total(r => r.completed_count)).toBe(data.overview.completed_count.value);
    expect(total(r => r.outcomes.accepted)).toBe(data.overview.outcomes!.accepted);
    expect(total(r => r.fine_count)).toBe(data.overview.fine_count.value);
    expect(data.meta.capabilities.violation_law.coverage).toEqual({ eligible: 11, total: 12 });
    expect(data.laws!.some(r => r.law !== null && PARAGRAPH.test(r.law))).toBe(false);
  });
  it('filters by the article key; a parameter with a paragraph selects its whole article', () => {
    for (const law of ['도로교통법 제32조', '도로교통법 제32조제1항', '도로교통법 제32조 9항']) {
      const only = aggregateDashboard(facts, { ...scope, law }, opts);
      expect(only.overview.completed_count.value).toBe(4);
      expect(only.laws!.map(r => r.law)).toEqual(['도로교통법 제32조']);
    }
    expect(aggregateDashboard(facts, { ...scope, law: '도로교통법 제5조' }, opts).overview.completed_count.value).toBe(2);
    expect(aggregateDashboard(facts, { ...scope, law: '도로교통법 제5조의2' }, opts).overview.completed_count.value).toBe(1);
    expect(aggregateDashboard(facts, { ...scope, law: '자동차관리법 제29조' }, opts).overview.completed_count.value).toBe(2);
    expect(aggregateDashboard(facts, { ...scope, law: '도로교통법 위반' }, opts).overview.completed_count.value).toBe(1);
    expect(aggregateDashboard(facts, { ...scope, law: LAW_NONE }, opts).overview.completed_count.value).toBe(1);
    const mine = aggregateCompare(facts, { ...scope, law: '자동차관리법 제29조제1항' }, 'c1', { datasetVersion: 'v', asOf: '2026-12-31',
      dataMin: '2020-01-01', viewer: { contributor: 'active', has_public_facts: true } });
    expect(mine.all.completed_count).toBe(2);
  });
  it('filter options are article keys', () => {
    expect(lawOptions(data.laws, null).some(o => PARAGRAPH.test(o.law))).toBe(false);
    expect(lawRows([fact('도로교통법 제32조제1항')])[0].law).toBe('도로교통법 제32조');
  });
});

const state: AnalyticsState = {
  dataset_version: 'v-art', ready: true, source_updated_at: '2026-09-28T00:00:00Z', generated_at: '2026-09-28T01:00:00Z',
  published_at: null, data_min: '2026-01-01', data_max: '2026-09-30', coverage_note: 'synthetic test', dedupe_policy_version: 'ingest-latest-v1',
};
const base = 'start=2026-09-01&end=2026-09-30&category=all';

describe('no paragraph text in any public response', () => {
  it('public dashboard: rows and the echoed scope are article keys', async () => {
    const repo: AnalyticsRepository = { getState: async () => state, getFacts: async () => facts, allowRequest: async () => true };
    const handler = createPublicHandler(repo, fixtureAccess());
    const all = await handler(viewerRequest(`https://example.supabase.co/functions/v1/public-analytics/dashboard?${base}`));
    const body = await all.json();
    expect(dashboardResponseSchema.safeParse(body).success).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(PARAGRAPH);
    const res = await handler(viewerRequest(`https://example.supabase.co/functions/v1/public-analytics/dashboard?${base}&law=${encodeURIComponent('도로교통법 제32조제1항')}`));
    const filtered = await res.json();
    expect(filtered.scope.law).toBe('도로교통법 제32조');
    expect(filtered.overview.completed_count.value).toBe(4);
    expect(JSON.stringify(filtered)).not.toMatch(PARAGRAPH);
    expect((await handler(viewerRequest(`https://example.supabase.co/functions/v1/public-analytics/dashboard?${base}&law=%20`))).status).toBe(400);
  });
  it('personal comparison: the echoed scope is the article key', async () => {
    const handler = createPersonalHandler({ ...fixtureAccess(), enabled: true, allowedOrigins: [TEST_MAP_ORIGIN],
      rpc: async (name: string) => name.endsWith('rate_limit') ? true : { state, facts,
        viewer: { user_ok: true, kakao: true, session: true, contributor: 'active', has_public_facts: true } } } as never);
    const res = await handler(viewerRequest(`https://example.supabase.co/functions/v1/my-analytics/compare?${base}&law=${encodeURIComponent('자동차관리법 제29조 제3항')}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scope.law).toBe('자동차관리법 제29조');
    expect(JSON.stringify(body)).not.toMatch(PARAGRAPH);
  });
  it('demo data carries paragraphs that the table groups away', () => {
    expect(demoFacts().some(f => f.violation_law && PARAGRAPH.test(f.violation_law))).toBe(true);
    const data = demoEngineDashboard(DEMO_SCOPE);
    expect(data.laws!.some(r => r.law !== null && PARAGRAPH.test(r.law))).toBe(false);
    expect(data.laws!.map(r => r.law)).toContain('도로교통법 제5조의2');
    expect(data.laws!.reduce((a, r) => a + r.completed_count, 0)).toBe(data.overview.completed_count.value);
  });
});
