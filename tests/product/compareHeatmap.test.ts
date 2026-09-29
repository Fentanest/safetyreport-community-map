import { describe, expect, it } from 'vitest';
import type { PrivateFact } from '../../server/aggregate';
import { aggregateStatistics } from '../../server/statistics';
import { heatmapAxes, heatmapCells } from '../../src/components/stats/PivotChart';
import type { Scope } from '../../src/domain/public';
import type { StatisticsSpec } from '../../src/domain/statistics';

/** C02: the compare heatmap draws BOTH populations on the same axes; mine is never the public value. */
let n = 0;
const f = (patch: Partial<PrivateFact>): PrivateFact => ({
  fact_identity: `h-${++n}`, contributor_id: 'other', snapshot_id: 's', snapshot_generation: 1, report_date: '2026-03-01', completed_date: '2026-03-10',
  category: 'traffic', status: 'accepted', disposition: 'none', vehicle_raw: null, point_key: null, lat: 37.5, lng: 127, address: null,
  region_code: '서울 중구', agency_key: 'a1:A', agency_name: '기관A', manager_key: null, manager_name: null, ...patch,
});
const scope: Scope = { start: '2026-01-01', end: '2026-06-30', category: 'all', region_code: null, agency_key: null, manager_key: null, bbox: null, law: null };
const facts = [
  // agency A × 제32조: all 1/2 = 50%, mine (me) 1/1 = 100%
  f({ violation_law: '도로교통법 제32조', contributor_id: 'me' }), f({ violation_law: '도로교통법 제32조', status: 'rejected' }),
  // agency A × 제33조: only other people → mine has no cell (not 0, not the public value)
  f({ violation_law: '도로교통법 제33조' }),
  // agency B × 제32조: mine result unknown only → zero denominator
  f({ agency_key: 'a1:B', agency_name: '기관B', violation_law: '도로교통법 제32조', contributor_id: 'me', status: 'completed_unknown' }),
  // agency B × 제33조: same value both (100%)
  f({ agency_key: 'a1:B', agency_name: '기관B', violation_law: '도로교통법 제33조', contributor_id: 'me' }),
];
const spec = (population: StatisticsSpec['population']): StatisticsSpec => ({ version: 1, date_basis: 'completed_date', population,
  rows: ['agency'], columns: ['law'], metrics: ['accept_rate'], filters: [], place_key: null });
const run = (p: StatisticsSpec['population']) => aggregateStatistics({ facts, scope, spec: spec(p), datasetVersion: 'v', viewerId: 'me' });
const at = (cells: ReturnType<typeof heatmapCells>, row: string, col: string) => cells.find((c) => c.row[0] === row && c.col[0] === col);

describe('C02 compare heatmap', () => {
  const r = run('compare');
  const all = heatmapCells(r, 'all', 'accept_rate'), mine = heatmapCells(r, 'mine', 'accept_rate');
  it('both populations share the same axes (member keys and order)', () => {
    const { xs, ys } = heatmapAxes(r);
    expect(ys.map((y) => y.key[0])).toEqual(['a1:A', 'a1:B']);
    expect(xs.map((x) => x.key[0]).sort()).toEqual(['도로교통법 제32조', '도로교통법 제33조']);
    // the same cell sits at the same [x, y] position in both heatmaps
    expect(at(all, 'a1:A', '도로교통법 제32조')!.value.slice(0, 2)).toEqual(at(mine, 'a1:A', '도로교통법 제32조')!.value.slice(0, 2));
  });
  it('different values and denominators per population, identical to the table cells', () => {
    expect(at(all, 'a1:A', '도로교통법 제32조')!.sv).toMatchObject({ value: 50, numerator: 1, denominator: 2 });
    expect(at(mine, 'a1:A', '도로교통법 제32조')!.sv).toMatchObject({ value: 100, numerator: 1, denominator: 1 });
    const tableAll = r.cells.find((c) => c.side === 'all' && c.row[0] === 'a1:A' && c.col[0] === '도로교통법 제32조')!.values.accept_rate;
    expect(at(all, 'a1:A', '도로교통법 제32조')!.sv).toEqual(tableAll);
  });
  it('mine without reports has no cell (not 0, not the public value); zero denominator stays null; equal values stay equal', () => {
    expect(at(mine, 'a1:A', '도로교통법 제33조')).toBeUndefined();
    expect(at(all, 'a1:A', '도로교통법 제33조')!.sv.value).toBe(100);
    expect(at(mine, 'a1:B', '도로교통법 제32조')!.sv).toMatchObject({ value: null, reason: 'zero_denominator' });
    expect(at(mine, 'a1:B', '도로교통법 제33조')!.sv.value).toBe(at(all, 'a1:B', '도로교통법 제33조')!.sv.value);
  });
  it('off (all) and mine-only draw exactly their own population', () => {
    expect(heatmapCells(run('all'), 'mine', 'accept_rate')).toHaveLength(0);
    expect(heatmapCells(run('mine'), 'all', 'accept_rate')).toHaveLength(0);
    expect(at(heatmapCells(run('mine'), 'mine', 'accept_rate'), 'a1:A', '도로교통법 제32조')!.sv.value).toBe(100);
  });
});
