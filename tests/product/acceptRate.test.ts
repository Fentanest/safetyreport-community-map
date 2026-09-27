import { describe, expect, it } from 'vitest';
import { createPublicHandler, type AnalyticsState } from '../../server/publicHandler';
import type { PrivateFact } from '../../server/aggregate';
import { acceptRate, partialRate } from '../../src/components/format';
import { fixtureAccess, viewerRequest } from './helpers/mapViewer';

// 수용률 = 수용 ÷ 결과 확인 (일부 수용 제외, 2026-09-27 사용자 결정) — screen and server sort use the same rule.
const state: AnalyticsState = {
  dataset_version: 'v-rate', ready: true, source_updated_at: null, generated_at: '2026-09-27T00:00:00Z',
  published_at: null, data_min: '2026-01-01', data_max: '2026-09-27', coverage_note: 'x', dedupe_policy_version: 'x',
};
let n = 0;
const fact = (agency: string, status: PrivateFact['status']): PrivateFact => ({
  fact_identity: `f${n++}`, contributor_id: 'c', snapshot_id: 's', snapshot_generation: 1,
  report_date: '2026-09-01', completed_date: '2026-09-05', category: 'traffic', status, disposition: 'none',
  vehicle_raw: null, point_key: null, lat: null, lng: null, address: null, region_code: '서울 중구',
  agency_key: agency, agency_name: agency, manager_key: null, manager_name: null,
});

describe('수용률 excludes partial acceptance', () => {
  it('computes accepted ÷ result-known', () => {
    expect(acceptRate({ accepted: 1, result_known: 4 })).toBe(25);
    expect(acceptRate({ accepted: 0, result_known: 0 })).toBeNull();
    expect(acceptRate(null)).toBeNull();
    expect(partialRate({ partial: 3, result_known: 4 })).toBe(75);
    expect(partialRate({ partial: 0, result_known: 0 })).toBeNull();
  });

  it('sorts /entities by the same definition', async () => {
    // A: 1 accepted + 3 partial (old rule 100%, new 25%); B: 2 accepted + 2 rejected (50% either way).
    const facts = [
      fact('A', 'accepted'), fact('A', 'partial'), fact('A', 'partial'), fact('A', 'partial'),
      fact('B', 'accepted'), fact('B', 'accepted'), fact('B', 'rejected'), fact('B', 'rejected'),
    ];
    const handle = createPublicHandler({ getState: async () => state, getFacts: async () => facts, allowRequest: async () => true }, fixtureAccess());
    const res = await handle(viewerRequest('https://p/functions/v1/public-analytics/entities?start=2026-09-01&end=2026-09-27&kind=agency&sort=acceptRate&dir=desc'));
    const body = await res.json();
    expect(body.items.map((r: { agency_name: string }) => r.agency_name)).toEqual(['B', 'A']);
  });
});
