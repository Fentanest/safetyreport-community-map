// 위반법규 (violation_law, observation-v2 2026-09-28): per-law rows, the law filter (exact / 법규 미상), the public
// and personal API parameter, UI state round-trip and render safety. Every expected number is computed by hand.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { aggregateDashboard, lawRows, type PrivateFact } from '../../server/aggregate';
import { aggregateCompare } from '../../server/compare';
import { createPublicHandler, parseScope, QueryError, type AnalyticsRepository, type AnalyticsState } from '../../server/publicHandler';
import { dashboardResponseSchema, metaSchema } from '../../src/data/schema';
import { DEMO_SCOPE, LAW_NONE, type Scope } from '../../src/domain/public';
import { draftFromScope, lawLabel, lawOptions, scopeFromDraft, scopeFromSearch, scopeToSearch } from '../../src/state/filters';
import { sameScope, scopeParams } from '../../src/data/client';
import { compareParams, sameScope as samePersonalScope } from '../../src/data/personal';
import LawTable from '../../src/components/LawTable';
import FilterDrawer from '../../src/components/FilterDrawer';
import { demoFacts, demoEngineDashboard } from '../../src/data/demoEngine';
import { fixtureAccess, viewerRequest } from './helpers/mapViewer';

let n = 0;
const fact = (patch: Partial<PrivateFact>): PrivateFact => ({
  fact_identity: `law-${n++}`, contributor_id: 'c1', snapshot_id: 'ingest-v1', snapshot_generation: 1,
  report_date: '2026-09-01', completed_date: '2026-09-05', category: 'parking', status: 'accepted', disposition: 'none',
  vehicle_raw: null, point_key: null, lat: null, lng: null, address: null, region_code: '서울 중구',
  agency_key: 'a1', agency_name: '기관1', manager_key: 'm1', manager_name: '담당1',
  amount_kind: 'unknown', amount_confirmed_won: null, amount_public: true, amount_stated: false, violation_law: null, ...patch,
});
const fineFact = (law: string | null, won: number | null, patch: Partial<PrivateFact> = {}) => fact({
  violation_law: law, disposition: 'fine', amount_kind: 'fine', amount_confirmed_won: won, amount_stated: won !== null, ...patch,
});
const L32 = '도로교통법 제32조', L5 = '도로교통법 제5조', L34 = '도로교통법 제34조';
const scope: Scope = { date_basis: 'completed_date' as const, start: '2026-09-01', end: '2026-09-30', category: 'all', region_code: null, agency_key: null, manager_key: null, bbox: null, law: null };
const opts = { datasetVersion: 'v', sourceUpdatedAt: null, generatedAt: '2026-09-28T00:00:00Z', asOf: '2026-12-31', sample: false, dataMin: '2020-01-01' };

// 제32조: 5 answers — A2 (fine 40,000 / fine 60,000), P1 (fine, amount NOT published: 90,000 withheld), J1, unknown1 (warning)
// 제5조: 3 answers — A1 (penalty), J2
// 제34조: 1 answer — A1 (fine 0원)
// 법규 미상: 3 answers — A1 (fine, no amount written), P1 (warning), J1 — plus one outside the range and one not answered
const facts: PrivateFact[] = [
  fineFact(L32, 40000), fineFact(L32, 60000),
  fineFact(L32, null, { status: 'partial', amount_public: false, amount_stated: true }),
  fact({ violation_law: L32, status: 'rejected' }),
  fact({ violation_law: L32, status: 'completed_unknown', disposition: 'warning' }),
  fact({ violation_law: L5, disposition: 'penalty', amount_kind: 'penalty' }),
  fact({ violation_law: L5, status: 'rejected' }), fact({ violation_law: L5, status: 'rejected' }),
  fineFact(L34, 0),
  fineFact(null, null), fact({ status: 'partial', disposition: 'warning' }), fact({ status: 'rejected' }),
  fact({ violation_law: L32, completed_date: '2026-10-02' }),               // answered after the range
  fact({ violation_law: L32, status: 'processing', completed_date: null }), // not answered
];

describe('per-law rows (docs/metrics-catalog.md law_results)', () => {
  const data = aggregateDashboard(facts, scope, opts);
  it('computes C, A/P/J/D, rates, F, penalty, warning and published amounts per law from the answer-date cohort', () => {
    expect(data.laws!.map(r => r.law)).toEqual([L32, L5, null, L34]); // C desc; 법규 미상 after a named law of equal C
    const [l32, l5, none, l34] = data.laws!;
    expect(l32).toEqual({
      law: L32, completed_count: 5, outcomes: { accepted: 2, partial: 1, rejected: 1, result_known: 4, result_unknown: 1 },
      accept_rate: 50, partial_rate: 25, fine_count: 3, fine_rate: 60, penalty_count: 0, warning_count: 1,
      // the withheld 90,000 never enters: 2 of 3 fines confirmed, 40,000 + 60,000
      fine_amount: { fine_count: 3, confirmed_count: 2, sum_won: 100000, mean_won: 50000 },
      rating: { count: 0, mean: null },
    });
    expect(l5).toEqual({
      law: L5, completed_count: 3, outcomes: { accepted: 1, partial: 0, rejected: 2, result_known: 3, result_unknown: 0 },
      accept_rate: 100 / 3, partial_rate: 0, fine_count: 0, fine_rate: 0, penalty_count: 1, warning_count: 0,
      fine_amount: { fine_count: 0, confirmed_count: 0, sum_won: null, mean_won: null },
      rating: { count: 0, mean: null },
    });
    expect(none).toEqual({
      law: null, completed_count: 3, outcomes: { accepted: 1, partial: 1, rejected: 1, result_known: 3, result_unknown: 0 },
      accept_rate: 100 / 3, partial_rate: 100 / 3, fine_count: 1, fine_rate: 100 / 3, penalty_count: 0, warning_count: 1,
      fine_amount: { fine_count: 1, confirmed_count: 0, sum_won: null, mean_won: null },  // no amount written: never 0원
      rating: { count: 0, mean: null },
    });
    expect(l34).toMatchObject({ completed_count: 1, accept_rate: 100, fine_rate: 100,
      fine_amount: { fine_count: 1, confirmed_count: 1, sum_won: 0, mean_won: 0 } });           // explicit 0원 is a real 0
  });
  it('rows add up to the dashboard totals (same facts, same denominators)', () => {
    const sum = (pick: (r: NonNullable<typeof data.laws>[number]) => number) => data.laws!.reduce((a, r) => a + pick(r), 0);
    expect(sum(r => r.completed_count)).toBe(data.overview.completed_count.value);
    expect(sum(r => r.outcomes.result_known)).toBe(data.overview.outcomes!.result_known);
    expect(sum(r => r.fine_count)).toBe(data.overview.fine_count.value);
    expect(sum(r => r.fine_amount.confirmed_count)).toBe(data.overview.fine_amount!.confirmed_count);
    expect(sum(r => r.fine_amount.sum_won ?? 0)).toBe(data.overview.fine_amount!.sum_won);
    expect(data.meta.capabilities.violation_law).toEqual({ status: 'supported', reason: null, coverage: { eligible: 9, total: 12 } });
  });
  it('facts without the field (legacy source) are 법규 미상, and an empty cohort has no rows', () => {
    const { violation_law: _drop, ...legacy } = fact({ violation_law: L32 });
    expect(lawRows([legacy as PrivateFact])[0].law).toBeNull();
    expect(aggregateDashboard(facts, { ...scope, start: '2026-01-01', end: '2026-01-31' }, opts).laws).toEqual([]);
  });
  it('the law filter narrows every indicator; __none__ selects facts without a law', () => {
    const only32 = aggregateDashboard(facts, { ...scope, law: L32 }, opts);
    expect(only32.overview.completed_count.value).toBe(5);
    // single-date-v1: N and C are the same answer-date set (the old report-date count of 7 was another set)
    expect(only32.overview.report_count.value).toBe(5);
    expect(only32.laws!.map(r => r.law)).toEqual([L32]);
    expect(only32.agencies[0].completed_count).toBe(5);
    const none = aggregateDashboard(facts, { ...scope, law: LAW_NONE }, opts);
    expect(none.overview.completed_count.value).toBe(3);
    expect(none.laws!.map(r => r.law)).toEqual([null]);
    expect(aggregateDashboard(facts, { ...scope, law: '없는 법 제1조' }, opts).overview.completed_count.value).toBe(0);
  });
  it('the personal comparison reads the same law population', () => {
    const mine = aggregateCompare(facts, { ...scope, law: L5 }, 'c1', { datasetVersion: 'v', asOf: '2026-12-31', dataMin: '2020-01-01',
      viewer: { contributor: 'active', has_public_facts: true } });
    expect(mine.all.completed_count).toBe(3);
    expect(mine.scope.law).toBe(L5);
  });
});

const state: AnalyticsState = {
  dataset_version: 'v2-law', ready: true, source_updated_at: '2026-09-28T00:00:00Z', generated_at: '2026-09-28T01:00:00Z',
  published_at: null, data_min: '2026-01-01', data_max: '2026-09-30', coverage_note: 'synthetic test', dedupe_policy_version: 'contribution-dedupe-v1',
};
const repo = (): AnalyticsRepository => ({ getState: async () => state, getFacts: async () => facts, allowRequest: async () => true });
const endpoint = (path: string) => viewerRequest(`https://example.supabase.co/functions/v1/public-analytics/${path}`);
const base = 'start=2026-09-01&end=2026-09-30&category=all&expected_version=v2-law';

describe('public API law parameter', () => {
  it('returns strict law rows and echoes the scope (null when absent)', async () => {
    const res = await createPublicHandler(repo(), fixtureAccess())(endpoint(`dashboard?${base}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(dashboardResponseSchema.safeParse(body).success).toBe(true);
    expect(body.scope.law).toBeNull();
    expect(body.laws).toHaveLength(4);
    expect(JSON.stringify(body.laws)).not.toContain('90000');  // an unpublished amount never leaves in any form
  });
  it('filters by an exact law and by __none__, echoing the value', async () => {
    const handler = createPublicHandler(repo(), fixtureAccess());
    const exact = await (await handler(endpoint(`dashboard?${base}&law=${encodeURIComponent(L32)}`))).json();
    expect(exact.scope.law).toBe(L32);
    expect(exact.overview.completed_count.value).toBe(5);
    expect(dashboardResponseSchema.safeParse(exact).success).toBe(true);
    const none = await (await handler(endpoint(`dashboard?${base}&law=__none__`))).json();
    expect(none.scope.law).toBe('__none__');
    expect(none.laws).toEqual([expect.objectContaining({ law: null, completed_count: 3 })]);
    const overview = await (await handler(endpoint(`overview?${base}&law=${encodeURIComponent(L5)}`))).json();
    expect(overview.scope.law).toBe(L5);
    expect(overview.overview.completed_count.value).toBe(3);
  });
  it('refuses an empty, over-long, control-character or repeated law and still refuses unknown parameters', async () => {
    const handler = createPublicHandler(repo(), fixtureAccess());
    // 80 code points is the parameter bound (an article key can be one longer than its ≤ 60 stored text); blank is refused
    for (const bad of ['law=', 'law=%20%20', `law=${'가'.repeat(81)}`, 'law=%E6%B3%95%0A1', `law=a&law=b`, 'violation_law=a']) {
      expect((await handler(endpoint(`dashboard?${base}&${bad}`))).status).toBe(400);
    }
    expect((await handler(endpoint(`dashboard?${base}&law=${encodeURIComponent('𠀀'.repeat(80))}`))).status).toBe(200);
    const meta = await (await handler(endpoint('meta'))).json();
    expect(metaSchema.safeParse(meta).success).toBe(true);
    expect(meta.capabilities.violation_law.status).toBe('supported');
  });
  it('the personal API accepts the same parameter (shared parser)', () => {
    const personal = new Set(['start', 'end', 'category', 'region_code', 'agency_key', 'manager_key', 'bbox', 'law', 'expected_version']);
    expect(parseScope(new URLSearchParams({ start: '2026-09-01', end: '2026-09-30', law: L5 }), state, personal).law).toBe(L5);
    expect(() => parseScope(new URLSearchParams({ start: '2026-09-01', end: '2026-09-30', law: '' }), state, personal)).toThrow(QueryError);
  });
});

describe('law filter UI state', () => {
  it('round-trips through the draft, the share URL and the API parameters', () => {
    for (const law of [L32, LAW_NONE, '주차장법 제29조', '형식 밖 법규', null]) {
      const s = scopeFromDraft({ ...draftFromScope(DEMO_SCOPE), law }, { ...DEMO_SCOPE, agency_key: 'a1' });
      expect(s.law).toBe(law);
      expect(s.agency_key).toBeNull();
      expect(draftFromScope(s).law).toBe(law);
      expect(scopeFromSearch(scopeToSearch(s), DEMO_SCOPE)).toEqual(s);
      expect(parseScope(new URLSearchParams(scopeToSearch(s)), { data_min: null, data_max: null }).law).toBe(law);
      expect(scopeParams(s).get('law')).toBe(law);
      expect(compareParams(s, 'v').get('law')).toBe(law);
      expect(sameScope(s, { ...s })).toBe(true);
      expect(sameScope(s, { ...s, law: law === L5 ? null : L5 })).toBe(false);
      expect(samePersonalScope(s, { ...s, law: law === L5 ? null : L5 })).toBe(false);
    }
    // anything the API would refuse is dropped from a pasted URL instead of failing the page
    expect(scopeFromSearch(`?law=${'가'.repeat(81)}`, DEMO_SCOPE).law).toBeNull();
    // a pasted or drafted law with a paragraph becomes its article key, the same value the API echoes
    expect(scopeFromSearch(`?law=${encodeURIComponent('도로교통법 제32조제1항')}`, DEMO_SCOPE).law).toBe(L32);
    expect(scopeFromDraft({ ...draftFromScope(DEMO_SCOPE), law: ' 도로교통법  제32조 2항 ' }, DEMO_SCOPE).law).toBe(L32);
    expect(scopeFromSearch('?law=', DEMO_SCOPE).law).toBeNull();
  });
  it('labels and options: 법규 미상 row, named laws only, and a kept selection', () => {
    expect(lawLabel(null)).toBe('모든 법규');
    expect(lawLabel(null, false)).toBe('법규 미상');
    expect(lawLabel(LAW_NONE)).toBe('법규 미상');
    const rows = [{ law: L32, completed_count: 5 }, { law: null, completed_count: 3 }];
    expect(lawOptions(rows, null)).toEqual([{ law: L32, count: 5 }]);
    expect(lawOptions(rows, L5)).toEqual([{ law: L5, count: null }, { law: L32, count: 5 }]);
    expect(lawOptions(null, LAW_NONE)).toEqual([]);
  });
  it('demo data has laws and unknown laws, deterministically', () => {
    const laws = demoFacts().map(f => f.violation_law ?? null);
    expect(laws.filter(l => l === null).length).toBeGreaterThan(0);
    expect(new Set(laws.filter(Boolean)).size).toBeGreaterThan(5);
    const data = demoEngineDashboard(DEMO_SCOPE);
    expect(data.laws!.length).toBeGreaterThan(5);
    expect(data.laws!.reduce((a, r) => a + r.completed_count, 0)).toBe(data.overview.completed_count.value);
    expect(demoEngineDashboard(DEMO_SCOPE).laws).toEqual(data.laws);
  });
});

describe('law text rendering', () => {
  it('escapes an untrusted law text in the table and the filter, and marks the active row', () => {
    const payload = '<img src=x onerror=alert(1)>';
    const rows = lawRows([fact({ violation_law: payload }), fact({})]);
    const table = renderToStaticMarkup(<LawTable laws={rows} activeLaw={payload} onPickLaw={() => {}} />);
    const drawer = renderToStaticMarkup(
      <FilterDrawer open draft={{ ...draftFromScope(DEMO_SCOPE), law: payload }} onDraft={() => {}} appliedChips={[payload]}
        unsupportedNote={null} onClose={() => {}} onApply={() => {}} onReset={() => {}} regionCounts={new Map()}
        lawOptions={lawOptions(rows, payload)} />,
    );
    expect(table).toContain('&lt;img');
    expect(drawer).toContain('&lt;img');
    expect(table + drawer).not.toContain(payload);
    expect(table).toContain('법규 미상');
    expect(table).toContain('aria-pressed="true"');
    expect(table).toContain('보는 중');
    expect(renderToStaticMarkup(<LawTable laws={null} activeLaw={null} onPickLaw={() => {}} />)).toContain('아직 준비되지 않았습니다');
    expect(renderToStaticMarkup(<LawTable laws={[]} activeLaw={null} onPickLaw={() => {}} />)).toContain('답변 완료 신고가 없습니다');
  });
});
