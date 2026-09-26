import { describe, expect, it } from 'vitest';
import { aggregateDashboard, growth, kstDate, previousWindow, type PrivateFact } from '../../server/aggregate';
import { overviewResponseSchema, pointSchema, vehicleSchema } from '../../src/data/schema';
import type { Scope } from '../../src/domain/public';

const base: PrivateFact = {
  fact_identity: 'f1', contributor_id: 'private-user-1', snapshot_id: 's1', snapshot_generation: 1,
  report_date: '2026-01-31', completed_date: '2026-02-01', category: 'traffic',
  status: 'accepted', disposition: 'fine', vehicle_raw: '서울12가3456',
  point_key: 'public-point-1', lat: 37.566535, lng: 126.9779692, address: '예시 지점',
  region_code: '11', agency_key: 'agency-1', agency_name: '예시 기관',
  manager_key: 'manager-1', manager_name: '김하늘',
};
const scope = (start: string, end: string): Scope => ({
  start, end, category: 'all', region_code: null, agency_key: null, manager_key: null, bbox: null,
});
const options = { datasetVersion: 'test-v2', sourceUpdatedAt: null, generatedAt: '2026-09-24T00:00:00Z', asOf: '2026-09-24', sample: true };
const aggregate = (facts: PrivateFact[], start = '2026-01-01', end = '2026-02-28') =>
  aggregateDashboard(facts, scope(start, end), options);
const fact = (id: number, patch: Partial<PrivateFact> = {}): PrivateFact => ({
  ...base, fact_identity: `f${id}`, contributor_id: `private-user-${id}`, ...patch,
});

describe('report and completion axes', () => {
  it('puts a January report and February completion in different monthly buckets', () => {
    const data = aggregate([base]);
    expect(data.monthly.map(row => [row.month, row.report_count, row.completed_count])).toEqual([
      ['2026-01', 1, 0], ['2026-02', 0, 1],
    ]);
    expect(aggregate([base], '2026-01-01', '2026-01-31').overview.completed_count.value).toBe(0);
    expect(aggregate([base], '2026-02-01', '2026-02-28').overview.report_count.value).toBe(0);
  });
  it('uses the result-known denominator and keeps unknown separate', () => {
    const facts = [
      fact(1), fact(2, { status: 'partial' }), fact(3, { status: 'rejected' }),
      fact(4, { status: 'completed_unknown' }),
    ];
    const data = aggregate(facts);
    expect(data.overview.completed_count.value).toBe(4);
    expect(data.overview.outcomes).toEqual({ accepted: 1, partial: 1, rejected: 1, result_known: 3, result_unknown: 1 });
    expect(data.overview.accepted_including_partial).toMatchObject({ value: 200 / 3, numerator: 2, denominator: 3, missing: 1 });
  });
  it('leaves 0 denominator as null, without manufacturing a completed date', () => {
    const data = aggregate([fact(1, { completed_date: null, status: 'accepted' })]);
    expect(data.overview.completed_count.value).toBe(0);
    expect(data.overview.completed_count.missing).toBe(1);
    expect(data.overview.accepted_including_partial.value).toBeNull();
    expect(data.overview.accepted_including_partial.denominator).toBe(0);
  });
  it('uses KST at year and leap-day boundaries and a preceding equal-duration window', () => {
    expect(kstDate('2025-12-31T15:01:00Z')).toBe('2026-01-01');
    expect(kstDate('2024-02-29T23:59:00+09:00')).toBe('2024-02-29');
    expect(previousWindow('2024-03-01', '2024-03-02')).toEqual({ start: '2024-02-28', end: '2024-02-29' });
    expect(growth(1, 0)).toEqual({ delta: 1, delta_percent: null, delta_reason: 'new' });
    expect(growth(0, 0)).toEqual({ delta: 0, delta_percent: null, delta_reason: 'no_baseline' });
  });
});

describe('identity, scope and public projection', () => {
  it('counts only the newest snapshot for a contributor and a distinct contributor once', () => {
    const old = fact(1, { snapshot_id: 'old', snapshot_generation: 1 });
    const now = fact(2, { contributor_id: old.contributor_id, snapshot_id: 'new', snapshot_generation: 2 });
    const duplicate = { ...now };
    const other = fact(3);
    const data = aggregate([old, now, duplicate, other]);
    expect(data.overview.report_count.value).toBe(2);
    expect(data.overview.contributor_count.value).toBe(2);
  });
  it('aggregates private canonical plates before masking and keeps collisions as separate rows', () => {
    const data = aggregate([
      fact(1, { vehicle_raw: '서울12가3456' }),
      fact(2, { vehicle_raw: '서울12가3456' }),
      fact(3, { vehicle_raw: '부산12가3456' }),
      fact(4, { vehicle_raw: 'not-a-plate' }),
    ]);
    expect(data.overview.report_count.value).toBe(4);
    expect(data.vehicle_identifiable_reports).toBe(3);
    expect(data.vehicles).toHaveLength(2);
    expect(data.vehicles.map(row => [row.masked_plate, row.report_count])).toEqual([
      ['서울1*가*4*6', 2], ['부산1*가*4*6', 1],
    ]);
    expect(data.vehicles.every(row => vehicleSchema.safeParse(row).success)).toBe(true);
    expect(JSON.stringify(data)).not.toContain('서울12가3456');
    expect(JSON.stringify(data)).not.toContain('private-user');
  });
  it('keeps the region in the label and never merges vehicles whose labels collide', () => {
    const data = aggregate([
      fact(1, { vehicle_raw: '경기76자3623' }),
      fact(2, { vehicle_raw: '서울12가3456' }),
      fact(3, { vehicle_raw: '서울13가3456' }),
    ]);
    expect(data.vehicles.map(row => row.masked_plate).sort()).toEqual(['경기7*자*6*3', '서울1*가*4*6', '서울1*가*4*6']);
    expect(data.vehicles.every(row => row.report_count === 1)).toBe(true);
    expect(data.vehicles.every(row => vehicleSchema.safeParse(row).success)).toBe(true);
    expect(JSON.stringify(data)).not.toContain('76자3623');
  });
  it('recomputes TOP5 across all months rather than adding monthly TOP5 lists', () => {
    const facts: PrivateFact[] = [];
    let id = 0;
    for (const month of ['01', '02']) {
      for (let i = 0; i < 5; i++) {
        const plate = `${20 + i + (month === '02' ? 10 : 0)}가0001`;
        for (let j = 0; j < 5; j++) facts.push(fact(++id, { report_date: `2026-${month}-10`, vehicle_raw: plate }));
      }
      for (let j = 0; j < 4; j++) facts.push(fact(++id, { report_date: `2026-${month}-10`, vehicle_raw: '서울12가3456' }));
    }
    const data = aggregate(facts);
    expect(data.vehicles[0]).toMatchObject({ masked_plate: '서울1*가*4*6', report_count: 8 });
  });
  it('keeps exact coordinate, full manager name, and a one-record entity', () => {
    const data = aggregate([base]);
    expect(data.points[0]).toMatchObject({ lat: 37.566535, lng: 126.9779692, report_count: 1 });
    expect(data.managers[0]).toMatchObject({ key: 'agency-1:manager-1', agency_key: 'agency-1',
      manager_key: 'manager-1', manager_name: '김하늘', completed_count: 1 });
    expect(data.agencies[0]).toMatchObject({ agency_key: 'agency-1', manager_key: null });
    expect(data.vehicles[0].report_count).toBe(1);
  });
  it('uses the manager row filter keys rather than its display row key', () => {
    const source = [base, fact(2, { agency_key: 'agency-2', manager_key: 'manager-2' })];
    const overview = aggregate(source);
    const row = overview.managers.find(entity => entity.agency_key === 'agency-1')!;
    const selected = aggregateDashboard(source, {
      ...scope('2026-01-01', '2026-02-28'), agency_key: row.agency_key,
      manager_key: row.manager_key,
    }, options);
    expect(row.key).not.toBe(row.manager_key);
    expect(selected.overview.report_count.value).toBe(1);
    expect(selected.managers).toHaveLength(1);
  });
  it('returns bounded aggregate map nodes for ten thousand exact source locations without changing totals', () => {
    const facts = Array.from({ length: 10_000 }, (_, i) => fact(i + 1, {
      point_key: `point-${i}`, lat: 33.1 + Math.floor(i / 100) * 0.05,
      lng: 124.1 + (i % 100) * 0.07,
    }));
    const data = aggregate(facts);
    expect(data.overview.report_count.value).toBe(10_000);
    expect(data.overview.point_count.value).toBe(10_000);
    expect(data.points.length).toBeLessThanOrEqual(1000);
    expect(data.points.some(point => point.aggregate === true && (point.point_count ?? 0) > 1)).toBe(true);
    expect(data.points.reduce((sum, point) => sum + point.report_count, 0)).toBe(10_000);
    expect(data.points.every(point => pointSchema.safeParse(point).success)).toBe(true);
  });
  it('rejects private or unknown response fields instead of silently projecting them', () => {
    const data = aggregate([base]);
    const good = { schema_version: 2, dataset_version: data.meta.dataset_version, scope: data.scope,
      sample: true, overview: data.overview };
    expect(overviewResponseSchema.safeParse(good).success).toBe(true);
    expect(overviewResponseSchema.safeParse({ ...good, contributor_id: 'private-user-1' }).success).toBe(false);
  });
});

describe('community ingest facts without coordinates (S-01)', () => {
  it('counts them in statistics, never as map points, and reports how many lack a location', () => {
    const facts = [fact(1), fact(2, { lat: null, lng: null, point_key: null }), fact(3, { lat: null, lng: null, point_key: null })];
    const data = aggregate(facts);
    expect(data.overview.report_count.value).toBe(3);
    expect(data.points).toHaveLength(1);
    expect(data.meta.location_missing).toBe(2);
    expect(data.meta.population).toBe('shared_completed_reports');
  });
  it('a viewport filter keeps only located facts', () => {
    const facts = [fact(1), fact(2, { lat: null, lng: null, point_key: null })];
    const data = aggregateDashboard(facts, { start: '2026-01-01', end: '2026-02-28', category: 'all', region_code: null, agency_key: null, manager_key: null, bbox: [124, 32, 132, 39.5] },
      { datasetVersion: 'v', sourceUpdatedAt: null, generatedAt: '2026-03-01T00:00:00Z', asOf: '2026-02-28', sample: false });
    expect(data.overview.report_count.value).toBe(1);
  });
});

