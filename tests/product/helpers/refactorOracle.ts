import type { PrivateFact } from '../../../server/aggregate';
import type { AnalyticsState } from '../../../server/publicHandler';
import { SORT_COLUMNS } from '../../../src/domain/tableSort';
export const oracleState: AnalyticsState = { dataset_version: 'refactor-oracle-v1', ready: true,
  source_updated_at: null, generated_at: '2026-10-03T00:00:00Z', published_at: null,
  data_min: '2026-01-01', data_max: '2026-12-31', coverage_note: 'synthetic oracle', dedupe_policy_version: 'test',
  basis_bounds: { report_date: { min: '2026-01-01', max: '2026-12-31' }, completed_date: { min: '2026-01-01', max: '2026-12-31' } } };
const base: PrivateFact = { fact_identity: 'oracle-0', contributor_id: 'synthetic-a', snapshot_id: 's2', snapshot_generation: 2,
  report_date: '2026-01-31', completed_date: '2026-02-01', category: 'parking', status: 'accepted', disposition: 'fine',
  vehicle_raw: null, point_key: 'p1', lat: 37.5, lng: 127, address: '예시로 10', region_code: '서울 중구',
  agency_key: 'a1', agency_name: '서울중구청', manager_key: 'm1', manager_name: '김예시',
  violation_law: '도로교통법 제05조 1항', amount_kind: 'fine', amount_public: true, amount_stated: true, amount_confirmed_won: 0, rating: 5 };
const f = (n: number, patch: Partial<PrivateFact> = {}): PrivateFact => ({ ...base, fact_identity: `oracle-${n}`, ...patch });
export const oracleFacts: PrivateFact[] = [f(1), f(2, { status: 'partial', amount_confirmed_won: 40000, rating: 1 }),
  f(3, { status: 'rejected', disposition: 'warning', amount_kind: 'unknown', amount_confirmed_won: null, rating: null }),
  f(4, { status: 'completed_unknown', disposition: 'none', amount_kind: 'unknown', amount_confirmed_won: null, rating: null,
    address: null, lat: null, lng: null, point_key: null }),
  f(5, { completed_date: null, report_date: '2026-02-28', amount_public: false, amount_confirmed_won: null }),
  f(6, { report_date: null, completed_date: '2026-02-28', agency_key: 'a2', agency_name: '서울예시경찰서', manager_key: 'm2' }),
  f(7, { report_date: '2026-03-01', completed_date: '2026-02-28', agency_key: 'a2', agency_name: '서울예시경찰서', manager_key: 'm2' }),
  f(8, { report_date: '2026-02-28', completed_date: '2026-02-28', category: 'traffic', agency_key: 'a3', agency_name: '이름 미상',
    manager_key: null, manager_name: null, violation_law: null, amount_public: false, amount_confirmed_won: null }),
  f(9, { snapshot_id: 's1', snapshot_generation: 1 }), // earlier snapshot is excluded
  f(10, { is_representative: false, contributor_id: 'synthetic-b', report_identity: 'co-contribution', identity_report_date: '2026-01-31', identity_completed_date: '2026-02-01' }),
  f(11, { completed_date: '2025-12-31', report_date: '2025-12-01' }),
];
export function oracleRequests() {
 const paths: string[] = [];
 for (const basis of ['completed_date','report_date']) {
  const q = `start=2026-01-01&end=2026-03-31&category=all&date_basis=${basis}`;
  for (const route of ['dashboard','overview','series','map','vehicles/top']) paths.push(`${route}?${q}`);
  for (const route of ['entities?kind=agency&','entities?kind=manager&','laws?']) {
   for (const [column,def] of Object.entries(SORT_COLUMNS)) for (const value of def.values) for (const dir of ['asc','desc'])
    paths.push(`${route}${q}&sort=${column}&sort_value=${value}&dir=${dir}&page_size=1&page=2`);
   paths.push(`${route}${q}&q=예시&agency_type=police`); // laws refuses entity-only filter
  }
 }
 return paths;
}
