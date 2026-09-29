import { describe, expect, it } from 'vitest';
import { aggregateDashboard, mapNodes, type PrivateFact } from '../../server/aggregate';
import { distinctPlaces, normalizeAddress, placeKeyOf, placeRows, representativeOf } from '../../server/places';
import {
  durationDistribution, entityScatter, lawHeatmap, ratingDistribution, vehicleDayDistribution,
} from '../../server/analyticsDistributions';
import { aggregateCompare } from '../../server/compare';
import { analyticsSchema, dashboardResponseSchema, pointSchema } from '../../src/data/schema';
import { personalCompareSchema } from '../../src/data/personal';
import { LAW_NONE, type PublicPoint, type Scope } from '../../src/domain/public';

/** Synthetic regression fixtures of docs/implementation/dashboard-redesign/ACCEPTANCE_TESTS.md (F01–F04, A01–A06). */
const scope: Scope = { date_basis: 'completed_date' as const, start: '2026-09-01', end: '2026-09-30', category: 'all', region_code: null,
  agency_key: null, manager_key: null, bbox: null, law: null };
const opts = { datasetVersion: 'redesign-test', sourceUpdatedAt: null, generatedAt: '2026-09-30T00:00:00Z', asOf: '2026-09-30', sample: false };
let n = 0;
const f = (patch: Partial<PrivateFact> = {}): PrivateFact => {
  n += 1;
  return {
    fact_identity: `rd-${n}`, contributor_id: `rd-user-${n}`, snapshot_id: 's', snapshot_generation: 1,
    report_date: '2026-09-02', completed_date: '2026-09-10', category: 'traffic', status: 'accepted', disposition: 'none',
    vehicle_raw: null, point_key: `pk-${n}`, lat: 37.5, lng: 127.0, address: '서울특별시 중구 세종대로 110',
    region_code: '서울 중구', agency_key: 'a1:x', agency_name: '예시 기관', manager_key: 'm1:x', manager_name: '김하늘', ...patch,
  };
};

describe('F03 address identity and distinction', () => {
  it('same full address with 20 different coordinates is one place with 20 reports', () => {
    const facts = Array.from({ length: 20 }, (_, i) => f({ lat: 37.5 + i * 0.00003, lng: 127.0 - i * 0.00002 }));
    const data = aggregateDashboard(facts, scope, opts);
    expect(data.points).toHaveLength(1);
    expect(data.points[0]).toMatchObject({ report_count: 20, grouping_version: 'address-v1', place_key: placeKeyOf('서울특별시 중구 세종대로 110') });
    expect(data.overview.point_count.value).toBe(1);
  });
  it('whitespace/control variants and short 시도 names join; 10 vs 10-1 and another 시군구 stay apart', () => {
    expect(placeKeyOf('  서울특별시   중구\t세종대로 110 ')).toBe(placeKeyOf('서울특별시 중구 세종대로 110'));
    expect(placeKeyOf('서울 중구 세종대로 110')).toBe(placeKeyOf('서울특별시 중구 세종대로 110'));
    expect(placeKeyOf('서울특별시 중구 세종대로 10 - 1')).toBe(placeKeyOf('서울특별시 중구 세종대로 10-1'));
    expect(placeKeyOf('서울특별시 중구 세종대로 10')).not.toBe(placeKeyOf('서울특별시 중구 세종대로 10-1'));
    expect(placeKeyOf('서울특별시 중구 중앙로 5')).not.toBe(placeKeyOf('부산광역시 중구 중앙로 5'));
    expect(placeKeyOf('서울특별시 중구 중앙로 5')).not.toBe(placeKeyOf('서울특별시 동구 중앙로 5'));
    // road name vs lot number are not merged without a verified alias
    expect(placeKeyOf('서울특별시 중구 태평로1가 31')).not.toBe(placeKeyOf('서울특별시 중구 세종대로 110'));
    // detail (동·호수) is kept
    expect(placeKeyOf('서울특별시 중구 세종대로 110 101동')).not.toBe(placeKeyOf('서울특별시 중구 세종대로 110'));
    expect(normalizeAddress('   ')).toBeNull();
    expect(normalizeAddress(null)).toBeNull();
  });
  it('null addresses never make a pin (neither pooled nor one per coordinate) and stay in the totals', () => {
    const facts = [...Array.from({ length: 5 }, (_, i) => f({ address: null, lat: 37 + i * 0.1, lng: 127 })),
      f({ address: '서울특별시 중구 좌표없음로 1', lat: null, lng: null, point_key: null }), f()];
    const data = aggregateDashboard(facts, scope, opts);
    expect(data.points).toHaveLength(1);
    expect(data.overview.report_count.value).toBe(7);
    expect(data.map_unplaced).toEqual({ no_address: { reported: 5, completed: 5 }, no_coordinates: { reported: 1, completed: 1 } });
    expect(data.points[0].report_count + 5 + 1).toBe(7);
  });
  it('the display representative does not depend on input order and never rewrites source facts', () => {
    const facts = [f({ lat: 37.1, lng: 127.1, report_identity: 'b' }), f({ lat: 37.2, lng: 127.2, report_identity: 'a' }),
      f({ lat: 37.1, lng: 127.1, report_identity: 'c' })];
    const before = JSON.stringify(facts);
    const a = representativeOf(facts)!, b = representativeOf([...facts].reverse())!;
    expect([a.lat, a.lng]).toEqual([37.1, 127.1]); // most frequent coordinate
    expect([b.lat, b.lng]).toEqual([37.1, 127.1]);
    const tie = [f({ lat: 37.3, lng: 127.3, report_identity: 'z' }), f({ lat: 37.4, lng: 127.4, report_identity: 'y' })];
    expect(representativeOf(tie)!.lat).toBe(37.4);
    expect(representativeOf([...tie].reverse())!.lat).toBe(37.4);
    expect(JSON.stringify(facts)).toBe(before);
  });
  it('a bbox filter selects by source coordinate first, so the pin stays inside and region totals are unchanged', () => {
    const facts = [f({ lat: 37.5, lng: 127.0 }), f({ lat: 37.9, lng: 127.9 })];
    const data = aggregateDashboard(facts, { ...scope, bbox: [126.9, 37.4, 127.1, 37.6] }, opts);
    expect(data.overview.report_count.value).toBe(1);
    expect([data.points[0].lat, data.points[0].lng]).toEqual([37.5, 127.0]);
  });
  it('the same report shared by two accounts counts once publicly and once per account', () => {
    const shared = { source_report_key: 'same', report_identity: 'same' };
    const facts = [f({ ...shared, contributor_id: 'acc-a', is_representative: true }), f({ ...shared, contributor_id: 'acc-b', is_representative: false })];
    const data = aggregateDashboard(facts, scope, opts);
    expect(data.points[0].report_count).toBe(1);
    const mine = aggregateCompare(facts, scope, 'acc-b', { datasetVersion: 'v', asOf: '2026-09-30', dataMin: null, viewer: { contributor: 'active', has_public_facts: true } });
    expect(mine.mine.report_count).toBe(1);
    expect(mine.my_points[0]).toMatchObject({ key: data.points[0].key, shared: true });
  });
});

describe('F01 weighted cluster rates (server compaction)', () => {
  it('sums numerators and denominators; 10% / 90% / 30%, never the 50% average', () => {
    const A: PublicPoint = { key: 'pl1:a', lat: 37.5, lng: 127.0, address: 'A', region_code: null, report_count: 1, completed_count: 1,
      outcomes: { accepted: 1, partial: 0, rejected: 0, result_known: 1, result_unknown: 0 }, fine_count: 1, warning_count: 0 };
    const B: PublicPoint = { key: 'pl1:b', lat: 37.5001, lng: 127.0001, address: 'B', region_code: null, report_count: 9, completed_count: 9,
      outcomes: { accepted: 0, partial: 0, rejected: 9, result_known: 9, result_unknown: 0 }, fine_count: 2, warning_count: 3 };
    const [node] = mapNodes([A, B], 1);
    expect(node.aggregate).toBe(true);
    expect(node.point_count).toBe(2);
    const o = node.outcomes!;
    expect(o.accepted / o.result_known).toBeCloseTo(0.1);
    expect(o.rejected / o.result_known).toBeCloseTo(0.9);
    expect(node.fine_count! / node.completed_count!).toBeCloseTo(0.3);
    expect(node.warning_count).toBe(3);
  });
});

describe('F02 계도 counts warning only', () => {
  it('warning 4, penalty 2, fine 3, unknown 1 → 계도 4, 과태료 3', () => {
    const d = ['warning', 'warning', 'warning', 'warning', 'penalty', 'penalty', 'fine', 'fine', 'fine', 'unknown'] as const;
    const data = aggregateDashboard(d.map(disposition => f({ disposition })), scope, opts);
    expect(data.points[0]).toMatchObject({ warning_count: 4, fine_count: 3, completed_count: 10 });
    expect(pointSchema.safeParse(data.points[0]).success).toBe(true);
    // an older server without the field stays "unknown", not 0
    const old = { ...data.points[0] } as Record<string, unknown>;
    delete old.warning_count;
    expect(pointSchema.parse(old).warning_count).toBeUndefined();
  });
});

describe('F04 more than 1,000 addresses', () => {
  it('compacts nationally but the viewport refinement returns exact address places', () => {
    const facts = Array.from({ length: 1200 }, (_, i) => f({ address: `경기도 예시시 예시로 ${i + 1}`, lat: 36 + (i % 40) * 0.05, lng: 127 + Math.floor(i / 40) * 0.05 }));
    const data = aggregateDashboard(facts, scope, opts);
    expect(data.points.length).toBeLessThanOrEqual(1000);
    expect(data.points.some(p => p.aggregate)).toBe(true);
    const { places } = placeRows(facts, facts.filter(x => x.completed_date));
    const view: [number, number, number, number] = [127, 36, 127.2, 36.2];
    const inView = places.filter(p => p.lng >= view[0] && p.lng <= view[2] && p.lat >= view[1] && p.lat <= view[3]);
    expect(inView.every(p => !p.aggregate && p.place_key)).toBe(true);
    expect(inView.length).toBeGreaterThan(1);
    expect(distinctPlaces(facts)).toBe(1200);
  });
});

describe('A01 duration distribution', () => {
  it('puts each valid report in exactly one equal-width bin (0 days included) and excludes by reason', () => {
    const facts = [
      f({ report_date: '2026-09-10', completed_date: '2026-09-10' }), // 0
      f({ report_date: '2026-09-01', completed_date: '2026-09-07' }), // 6
      f({ report_date: '2026-09-01', completed_date: '2026-09-08' }), // 7
      f({ report_date: '2026-01-01', completed_date: '2026-09-08' }), // long tail
      f({ report_date: null, completed_date: '2026-09-08' }),
      f({ report_date: '2026-09-20', completed_date: '2026-09-08' }), // reversed
    ];
    const d = durationDistribution(facts);
    expect(d.valid_count).toBe(4);
    expect(d.buckets.reduce((s, b) => s + b.count, 0)).toBe(4);
    expect(d.buckets[0]).toMatchObject({ lower: 0, upper: 6, count: 2 });
    expect(d.buckets[1]).toMatchObject({ lower: 7, upper: 13, count: 1 });
    expect(d.buckets.at(-1)).toMatchObject({ upper: null, count: 1 });
    expect(d.excluded).toEqual({ no_report_date: 1, reversed: 1 });
    expect(d.median_days).toBe(6.5);
  });
  it('personal distribution uses its own denominator', () => {
    const facts = [f({ contributor_id: 'me' }), f(), f(), f()];
    const cmp = aggregateCompare(facts, scope, 'me', { datasetVersion: 'v', asOf: '2026-09-30', dataMin: null, viewer: { contributor: 'active', has_public_facts: true } });
    expect(cmp.analytics!.duration.valid_count).toBe(1);
    expect(cmp.analytics!.duration.buckets.find(b => b.count)!.percentage).toBe(100);
    expect(personalCompareSchema.safeParse(JSON.parse(JSON.stringify(cmp))).success).toBe(true);
  });
});

describe('A02 agency × law heatmap', () => {
  it('cells are true cross counts, 법규 미상 excluded from the heatmap only, sample 1 kept', () => {
    const facts = [
      f({ agency_key: 'a1:p', agency_name: '갑 경찰서', violation_law: '도로교통법 제32조', status: 'accepted' }),
      f({ agency_key: 'a1:p', agency_name: '갑 경찰서', violation_law: '도로교통법 제32조제1항', status: 'rejected', disposition: 'fine' }),
      f({ agency_key: 'a1:p', agency_name: '갑 경찰서', violation_law: null, status: 'accepted' }),
      f({ agency_key: 'a1:q', agency_name: '을 구청', violation_law: '도로교통법 제5조', status: 'partial' }),
    ];
    const h = lawHeatmap(facts, false);
    const cell = (row: string, law: string) => h.cells.find(c => c.row_key === row && c.law_key === law);
    expect(cell('a1:p', '도로교통법 제32조')).toMatchObject({ completed_count: 2, fine_count: 1, outcomes: { accepted: 1, rejected: 1, result_known: 2 } });
    expect(cell('a1:p', LAW_NONE)).toBeUndefined();
    expect(h.laws.some(l => l.law_key === LAW_NONE)).toBe(false);
    expect(cell('a1:q', '도로교통법 제5조')).toMatchObject({ completed_count: 1, outcomes: { partial: 1 } });
    expect(cell('a1:q', '도로교통법 제32조')).toBeUndefined(); // no data ≠ 0%
    expect(h.total_rows).toBe(2);
    expect(lawHeatmap(facts, true).row_kind).toBe('manager');
  });
});

describe('A03 entity scatter', () => {
  it('uses raw per-entity medians, reports duration coverage and never places unknown durations at 0', () => {
    const facts = [
      f({ agency_key: 'a1:p', report_date: '2026-09-01', completed_date: '2026-09-03' }),
      f({ agency_key: 'a1:p', report_date: '2026-09-01', completed_date: '2026-09-11' }),
      f({ agency_key: 'a1:p', report_date: null, completed_date: '2026-09-11' }),
      f({ agency_key: 'a1:q', report_date: null, completed_date: '2026-09-11' }),
    ];
    const s = entityScatter(facts);
    const p = s.agencies.find(a => a.key === 'a1:p')!, q = s.agencies.find(a => a.key === 'a1:q')!;
    expect(p).toMatchObject({ completed_count: 3, duration_count: 2, median_days: 6 });
    expect(q).toMatchObject({ completed_count: 1, duration_count: 0, median_days: null });
    expect(s.agency_total).toBe(2);
  });
});

describe('A04 distinct report days per vehicle', () => {
  it('five same-day reports are 1 day; a next-day report makes 2 days; no plate text leaves', () => {
    const plate = '서울12가3456';
    const sameDay = Array.from({ length: 5 }, () => f({ vehicle_raw: plate, report_date: '2026-09-02' }));
    let d = vehicleDayDistribution(sameDay);
    expect(d.buckets[0]).toMatchObject({ label: '1일', vehicle_count: 1 });
    d = vehicleDayDistribution([...sameDay, f({ vehicle_raw: plate, report_date: '2026-09-03' })]);
    expect(d.buckets[1]).toMatchObject({ label: '2일', vehicle_count: 1 });
    expect(d.repeat_vehicle_count).toBe(1);
    // masked collision: different plates with the same mask stay different vehicles
    d = vehicleDayDistribution([f({ vehicle_raw: '12가3456', report_date: '2026-09-02' }), f({ vehicle_raw: '13가3457', report_date: '2026-09-03' })]);
    expect(d.vehicle_count).toBe(2);
    expect(d.repeat_vehicle_count).toBe(0);
    d = vehicleDayDistribution([f({ vehicle_raw: plate, report_date: null }), f({ vehicle_raw: 'not a plate' })]);
    expect(d.vehicle_count).toBe(0);
    expect(d.excluded).toEqual({ no_plate: 1, no_report_date: 1 });
    expect(JSON.stringify(d)).not.toContain('3456');
  });
});

describe('A05 monthly outcome rates on the completion month', () => {
  it('places a September answer of an August report in September with real numerators/denominators', () => {
    const facts = [f({ report_date: '2026-08-20', completed_date: '2026-09-02', status: 'accepted' }),
      f({ report_date: '2026-09-02', completed_date: '2026-09-05', status: 'rejected' })];
    const data = aggregateDashboard(facts, { ...scope, start: '2026-08-01' }, opts);
    const aug = data.monthly.find(m => m.month === '2026-08')!, sep = data.monthly.find(m => m.month === '2026-09')!;
    // single-date-v1 + D17: August is before the first answer date of this data → no_data (null), never 0%
    expect(aug.outcomes).toBeNull();
    expect(aug.report_count).toBeNull();
    expect(sep.outcomes).toMatchObject({ accepted: 1, rejected: 1, result_known: 2 });
    const cmp = aggregateCompare(facts, { ...scope, start: '2026-08-01' }, facts[0].contributor_id, { datasetVersion: 'v', asOf: '2026-09-30', dataMin: null, viewer: { contributor: 'active', has_public_facts: true } });
    expect(cmp.monthly.find(m => m.month === '2026-09')!.mine_outcomes).toMatchObject({ accepted: 1, result_known: 1 });
  });
});

describe('A06 rating distribution by outcome', () => {
  it('[3,3] and [1,5] have the same mean but different distributions; unrated never become 0점', () => {
    const facts = [f({ rating: 3 }), f({ rating: 3 }), f({ status: 'rejected', rating: 1 }), f({ status: 'rejected', rating: 5 }),
      f({ rating: null }), f({ rating: 7 as unknown as number }), f({ status: 'completed_unknown', rating: 2 })];
    const r = ratingDistribution(facts);
    const row = (s: string) => r.rows.find(x => x.status === s)!;
    expect(row('accepted')).toMatchObject({ counts: [0, 0, 2, 0, 0], rating_count: 2, mean: 3 });
    expect(row('rejected')).toMatchObject({ counts: [1, 0, 0, 0, 1], rating_count: 2, mean: 3 });
    expect(row('unknown')).toMatchObject({ counts: [0, 1, 0, 0, 0], rating_count: 1 });
    expect(row('all').rating_count).toBe(5);
    expect(r.unrated).toBe(2);
    for (const x of r.rows) expect(x.counts.reduce((a, b) => a + b, 0)).toBe(x.rating_count);
    expect(row('partial')).toMatchObject({ rating_count: 0, mean: null });
  });
});

describe('dashboard DTO carries the bundle', () => {
  it('validates strictly and contains no private fields', () => {
    const data = aggregateDashboard([f({ vehicle_raw: '서울12가3456', rating: 4, violation_law: '도로교통법 제32조' })], scope, opts);
    expect(analyticsSchema.safeParse(JSON.parse(JSON.stringify(data.analytics))).success).toBe(true);
    const body = { schema_version: 2, dataset_version: 'v', sample: false, scope, cohort_policy_version: 'single-date-v1', overview: data.overview, points: data.points,
      monthly: data.monthly, agencies: data.agencies, managers: data.managers, regions: data.regions, laws: data.laws,
      vehicles: data.vehicles, vehicle_total_scope_reports: 1, vehicle_identifiable_reports: 1, location_missing: 0,
      analytics: data.analytics, map_unplaced: data.map_unplaced };
    expect(dashboardResponseSchema.safeParse(JSON.parse(JSON.stringify(body))).success).toBe(true);
    const text = JSON.stringify(data.analytics);
    expect(text).not.toContain('12가3456');
    expect(text).not.toContain('rd-user');
  });
});
