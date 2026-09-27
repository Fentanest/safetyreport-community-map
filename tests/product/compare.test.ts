import { describe, expect, it } from 'vitest';
import { aggregateDashboard, entityRows, selectScope, type PrivateFact } from '../../server/aggregate';
import { aggregateCompare, diffOf, summarize } from '../../server/compare';
import { demoFacts, DEMO_AS_OF, DEMO_DATA_MIN, DEMO_VIEWER_ID } from '../../src/data/demoEngine';
import { consistentWithPublic, personalCompareSchema } from '../../src/data/personal';
import { DEMO_SCOPE, type Scope } from '../../src/domain/public';

const opts = { datasetVersion: 'v-test', asOf: DEMO_AS_OF, dataMin: DEMO_DATA_MIN, viewer: { contributor: 'active' as const, has_public_facts: true } };
const dash = (facts: PrivateFact[], scope: Scope) => aggregateDashboard(facts, scope, {
  datasetVersion: 'v-test', sourceUpdatedAt: null, generatedAt: '2026-09-27T00:00:00Z', asOf: DEMO_AS_OF, sample: false, dataMin: DEMO_DATA_MIN,
});

const facts = demoFacts();
const scopes: Array<[string, Scope]> = [
  ['nationwide 12 months', DEMO_SCOPE],
  ['region', { ...DEMO_SCOPE, region_code: '서울 중구' }],
  ['category', { ...DEMO_SCOPE, category: 'parking' }],
  ['agency', { ...DEMO_SCOPE, agency_key: 'a1:synthetic-2' }],
  ['manager', { ...DEMO_SCOPE, agency_key: 'a1:synthetic-0', manager_key: 'm1:synthetic-0-김하늘' }],
  ['bbox', { ...DEMO_SCOPE, bbox: [126.9, 37.4, 127.1, 37.6] }],
  ['30 days', { ...DEMO_SCOPE, start: '2026-08-26', end: '2026-09-24' }],
  ['full span', { ...DEMO_SCOPE, start: DEMO_DATA_MIN, end: DEMO_AS_OF }],
];

describe('all side equals the public numbers for the same scope (same population and selection)', () => {
  it.each(scopes)('%s', (_name, scope) => {
    const pub = dash(facts, scope);
    const cmp = aggregateCompare(facts, scope, DEMO_VIEWER_ID, opts);
    expect(cmp.all.report_count).toBe(pub.overview.report_count.value);
    expect(cmp.all.completed_count).toBe(pub.overview.completed_count.value);
    expect(cmp.all.result_known).toBe(pub.overview.outcomes!.result_known);
    // 수용률 = 수용 ÷ 결과 확인 (일부 수용 제외); the public field accepted_including_partial is a separate metric.
    expect(cmp.all.accepted + cmp.all.partial).toBe(pub.overview.accepted_including_partial.numerator);
    expect(cmp.all.accepted).toBe(pub.overview.outcomes!.accepted);
    expect(cmp.all.accept_rate).toBe(pub.overview.outcomes!.result_known ? pub.overview.outcomes!.accepted * 100 / pub.overview.outcomes!.result_known : null);
    expect(cmp.all.fine_count).toBe(pub.overview.fine_count.value);
    expect(cmp.all.point_count).toBe(pub.overview.point_count.value);
    expect(consistentWithPublic(cmp, pub.overview)).toBe(true);
    expect(cmp.scope).toEqual(scope);
    expect(personalCompareSchema.safeParse(JSON.parse(JSON.stringify(cmp))).success).toBe(true);
  });
});

describe('mine is the viewer subset of the same population', () => {
  it.each(scopes)('%s', (_name, scope) => {
    const cmp = aggregateCompare(facts, scope, DEMO_VIEWER_ID, opts);
    const onlyMine = dash(facts.filter(f => f.contributor_id === DEMO_VIEWER_ID), scope).overview;
    expect(cmp.mine.report_count).toBe(onlyMine.report_count.value);
    expect(cmp.mine.completed_count).toBe(onlyMine.completed_count.value);
    expect(cmp.mine.result_known).toBe(onlyMine.outcomes!.result_known);
    expect(cmp.mine.fine_count).toBe(onlyMine.fine_count.value);
    expect(cmp.mine.point_count).toBe(onlyMine.point_count.value);
    for (const k of ['report_count', 'completed_count', 'result_known', 'fine_count', 'point_count', 'accepted', 'partial', 'rejected'] as const) {
      expect(cmp.mine[k]).toBeLessThanOrEqual(cmp.all[k]);
    }
  });

  it('never counts another contributor as mine and depends only on the viewer id argument', () => {
    const other = aggregateCompare(facts, DEMO_SCOPE, 'synthetic-c01', opts);
    const me = aggregateCompare(facts, DEMO_SCOPE, DEMO_VIEWER_ID, opts);
    expect(other.all).toEqual(me.all);
    expect(other.mine).not.toEqual(me.mine);
    expect(() => aggregateCompare(facts, DEMO_SCOPE, '', opts)).toThrow();
  });

  it('carries no account identifiers in the response', () => {
    const text = JSON.stringify(aggregateCompare(facts, DEMO_SCOPE, DEMO_VIEWER_ID, opts));
    expect(text).not.toContain('contributor_id');
    expect(text).not.toContain(DEMO_VIEWER_ID);
    expect(text).not.toContain('synthetic-c0');
    expect(text).not.toContain('vehicle');
  });
});

describe('differences', () => {
  it('uses percentage points for rates and my share for counts', () => {
    const cmp = aggregateCompare(facts, DEMO_SCOPE, DEMO_VIEWER_ID, opts);
    expect(cmp.diff.accept_rate_pp).toBeCloseTo(cmp.mine.accept_rate! - cmp.all.accept_rate!, 10);
    expect(cmp.diff.reject_rate_pp).toBeCloseTo(cmp.mine.reject_rate! - cmp.all.reject_rate!, 10);
    expect(cmp.diff.fine_rate_pp).toBeCloseTo(cmp.mine.fine_rate! - cmp.all.fine_rate!, 10);
    expect(cmp.diff.report_share).toBeCloseTo(cmp.mine.report_count * 100 / cmp.all.report_count, 10);
    expect(cmp.diff.rate_reason).toBeNull();
  });

  it('keeps zero denominators as null with a reason instead of 0 or 100', () => {
    const none = summarize([], []);
    const all = summarize(selectScope(facts, DEMO_SCOPE).reported, selectScope(facts, DEMO_SCOPE).done);
    expect(none.accept_rate).toBeNull();
    expect(none.fine_rate).toBeNull();
    const d = diffOf(all, none);
    expect(d.accept_rate_pp).toBeNull();
    expect(d.rate_reason).toBe('no_mine');
    expect(d.report_share).toBe(0); // a real 0 stays 0
    expect(diffOf(none, none).rate_reason).toBe('no_all');
    expect(diffOf(none, none).report_share).toBeNull();
  });

  it('shows a single own report (n = 1) instead of hiding it', () => {
    const one: PrivateFact[] = [{
      ...facts[0], contributor_id: 'solo', fact_identity: 'solo-1', report_date: '2026-09-01', completed_date: '2026-09-05',
      status: 'rejected', disposition: 'none', point_key: 'solo:pt', lat: 37.1, lng: 127.1, region_code: '경기 수원시',
    }];
    const cmp = aggregateCompare([...facts, ...one], DEMO_SCOPE, 'solo', opts);
    expect(cmp.mine.report_count).toBe(1);
    expect(cmp.mine.result_known).toBe(1);
    expect(cmp.mine.accept_rate).toBe(0);
    expect(cmp.mine.reject_rate).toBe(100);

    expect(cmp.my_points).toEqual([expect.objectContaining({ key: 'solo:pt', lat: 37.1, lng: 127.1, mine_report_count: 1, shared: false })]);
  });
});

describe('수용률 definition', () => {
  it('counts only full acceptance in 수용률 (partial acceptance excluded)', () => {
    const base = { ...facts[0], contributor_id: 'rate', report_date: '2026-09-01', completed_date: '2026-09-05',
      disposition: 'none' as const, point_key: null, lat: null, lng: null };
    const rows: PrivateFact[] = [
      { ...base, fact_identity: 'r-a', status: 'accepted' },
      { ...base, fact_identity: 'r-p', status: 'partial' },
      { ...base, fact_identity: 'r-j', status: 'rejected' },
      { ...base, fact_identity: 'r-j2', status: 'rejected' },
    ];
    const cmp = aggregateCompare(rows, DEMO_SCOPE, 'rate', opts);
    expect(cmp.mine.result_known).toBe(4);
    expect(cmp.mine.accept_rate).toBe(25);
    expect(cmp.regions[0].mine.accepted).toBe(1);
    expect(cmp.regions[0].mine.accept_rate).toBe(25);
    expect(cmp.managers[0].mine.accept_rate).toBe(25);
  });
});

describe('rows share the public keys and totals', () => {
  const cmp = aggregateCompare(facts, DEMO_SCOPE, DEMO_VIEWER_ID, opts);
  const pub = dash(facts, DEMO_SCOPE);

  it('region rows sum to the overview on both sides and match public region rows', () => {
    expect(cmp.regions.reduce((n, r) => n + r.all.report_count, 0)).toBe(cmp.all.report_count);
    expect(cmp.regions.reduce((n, r) => n + r.mine.report_count, 0)).toBe(cmp.mine.report_count);
    expect(cmp.regions.reduce((n, r) => n + r.all.completed_count, 0)).toBe(cmp.all.completed_count);
    for (const row of pub.regions!) {
      const c = cmp.regions.find(r => r.region_code === row.region_code)!;
      expect(c.all.report_count).toBe(row.report_count);
      expect(c.all.completed_count).toBe(row.completed_count);
      expect(c.all.result_known).toBe(row.outcomes.result_known);
    }
  });

  it('manager/agency rows exist only where I have completions and keep the public keys (no same-name merge)', () => {
    const publicManagers = new Map(entityRows(selectScope(facts, DEMO_SCOPE).done, 'manager').map(r => [r.key, r]));
    expect(cmp.managers.length).toBeGreaterThan(0);
    for (const row of cmp.managers) {
      expect(row.mine.completed_count).toBeGreaterThan(0);
      const p = publicManagers.get(row.key)!;
      expect(p).toBeDefined();
      expect(row.all.completed_count).toBe(p.completed_count);
      expect(row.all.result_known).toBe(p.outcomes.result_known);
      expect(row.manager_key).toBe(p.manager_key);
      expect(row.agency_key).toBe(p.agency_key);
    }
    const kimRows = cmp.managers.filter(r => r.manager_name === '김하늘');
    expect(new Set(kimRows.map(r => r.agency_key)).size).toBe(kimRows.length);
    expect(cmp.managers.reduce((n, r) => n + r.mine.completed_count, 0)).toBe(cmp.mine.completed_count);
  });

  it('monthly series add up to the summaries and keep the public month coverage', () => {
    expect(cmp.monthly.map(m => m.month)).toEqual(pub.monthly.map(m => m.month));
    expect(cmp.monthly.reduce((n, m) => n + (m.mine_report_count ?? 0), 0)).toBe(cmp.mine.report_count);
    expect(cmp.monthly.reduce((n, m) => n + (m.all_report_count ?? 0), 0)).toBe(cmp.all.report_count);
    cmp.monthly.forEach((m, i) => expect(m.all_report_count).toBe(pub.monthly[i].report_count));
  });

  it('my points are exact public point keys and coordinates; shared means another contributor recorded it too', () => {
    const pubPoints = new Map(pub.points.map(p => [p.key, p]));
    const scoped = selectScope(facts, DEMO_SCOPE);
    for (const own of cmp.my_points) {
      const p = pubPoints.get(own.key)!;
      expect(p).toBeDefined();
      expect([own.lat, own.lng]).toEqual([p.lat, p.lng]);
      const others = [...scoped.reported, ...scoped.done].some(f => f.point_key === own.key && f.contributor_id !== DEMO_VIEWER_ID);
      expect(own.shared).toBe(others);
    }
    expect(cmp.my_points.some(p => !p.shared)).toBe(true);
    expect(cmp.my_points.some(p => p.shared)).toBe(true);
  });
});
