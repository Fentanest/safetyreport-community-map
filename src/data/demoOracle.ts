/**
 * DEMO/TEST ONLY. The cohort oracle (docs/implementation/date-basis-dashboard/fixtures/cohort-oracle.json) as
 * PrivateFact rows for the real server aggregation. Synthetic keys only; plate text is built at runtime from
 * digits (no literal plate in the source). Reached only behind VITE_DATA_MODE === 'demo' (?fixture=oracle) and
 * from unit tests, never from a live build.
 */
import type { PrivateFact, Status, Disposition } from '../../server/aggregate';
import oracle from '../../docs/implementation/date-basis-dashboard/fixtures/cohort-oracle.json';

export const ORACLE = oracle;
export const ORACLE_TODAY: string = oracle.today_kst;

const PLACES: Record<string, { address: string; lat: number; lng: number; region: string }> = {
  P1: { address: '서울특별시 종로구 예시로 1', lat: 37.5731, lng: 126.9794, region: '11110' },
  P2: { address: '서울특별시 중구 예시로 2', lat: 37.5636, lng: 126.9976, region: '11140' },
  P3: { address: '서울특별시 용산구 예시로 3', lat: 37.5326, lng: 126.9905, region: '11170' },
};
const AGENCIES: Record<string, string> = { G1: '예시 종로경찰서', G2: '예시 중구청' };
// digits only in the source; the plate text exists at runtime (same rule as the synthetic demo vehicles)
const plateOf = (v: string) => `${12 + Number(v.slice(1))}가${String(1000 + Number(v.slice(1)) * 1111).slice(0, 4)}`;

export function oracleDemoFacts(): PrivateFact[] {
  const rows: PrivateFact[] = [];
  for (const r of oracle.reports) {
    const place = PLACES[r.place];
    r.contributors.forEach((contributor, i) => {
      rows.push({
        fact_identity: `oracle:${r.id}`, contributor_id: contributor, snapshot_id: 'oracle', snapshot_generation: 1,
        report_date: r.report_date, completed_date: r.completed_date, category: 'parking',
        status: r.status as Status, disposition: r.disposition as Disposition, vehicle_raw: plateOf(r.vehicle),
        point_key: `oracle:${r.place}`, lat: place.lat, lng: place.lng, address: place.address, region_code: place.region,
        agency_key: `a1:oracle-${r.agency}`, agency_name: AGENCIES[r.agency],
        manager_key: `m1:oracle-${r.agency}`, manager_name: '예시 담당',
        amount_kind: r.disposition === 'fine' ? 'fine' : 'unknown', amount_confirmed_won: r.disposition === 'fine' && r.stated ? 40000 : null,
        amount_public: true, amount_stated: r.disposition === 'fine' && r.stated,
        violation_law: r.agency === 'G1' ? '도로교통법 제32조' : '도로교통법 제33조', rating: r.status === 'accepted' ? 4 : 2,
        // one identity shared by several accounts: the first listed contribution represents it publicly
        report_identity: `oracle:${r.id}|legacy`, source_report_key: `oracle:${r.id}`, is_representative: i === 0,
        contribution_count: r.contributors.length, first_accepted_at: `2025-09-0${i + 1}T00:00:00Z`,
      });
    });
  }
  return rows;
}
