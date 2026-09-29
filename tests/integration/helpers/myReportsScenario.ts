// The my-reports synthetic scenario (user A with every selection edge, user B as the "other account").
// Deterministic content (keys, ids, dates, values) so the data_version and the contract fixtures are reproducible.
import { plate, type Fact, type TestUser } from './myReportsSeed';

export const V = plate(12, '가', 3456);          // A's main vehicle
export const V_SPACED = ` 12 가 34 56 `;          // same plate with spaces (a different report)
export const V_LONGER = plate(12, '가', 34567);   // contains V
export const V_OTHER = plate(34, '나', 5678);
export const V_OLD = plate(99, '가', 9999);       // only on A's superseded observation of R2
export const V_B_ONLY = plate(77, '다', 7777);    // only B
export const V_WILD = `12가%456_\\`;               // literal wildcard characters
export const ADDR = '서울특별시 종로구 예시로 1';
export const ADDR_REF = '서울특별시 종로구 예시로 1 (예시동)';
export const ADDR_NEAR = '서울특별시 종로구 예시로 12';
export const ADDR_B_ONLY = '부산광역시 중구 예시로 7';

const G1 = { agencyKey: 'inst:9000001', agencyName: '예시 종로경찰서', agencyCurrent: '예시 종로경찰서' };
const G2 = { agencyKey: 'a1:example-g2', agencyName: '예시구청(구)', agencyCurrent: '예시구청' };
const M1 = { ...G1, managerKey: 'm1:example-m1', managerName: '박담당' };
const M2 = { ...G2, managerKey: 'm1:example-m2', managerName: '김담당' };
const M3 = { ...G1, managerKey: 'm1:example-m3', managerName: '김담당' };   // same name as M2, other agency

export function scenarioA(a: TestUser, revokedGrant: string): Fact[] {
  const pc = 'A-pc', mobile = 'A-mobile';
  return [
    // R1: recent accepted fine with confirmed amount; uploaded from PC and mobile (one report)
    { user: a, dataset: pc, key: 'R1', sourceId: '9100000001', number: 'SPP-2609-00000001', vehicle: V, category: 'parking',
      disposition: 'fine', amountKind: 'fine', amount: 40000, reportDate: '2026-09-20', completedDate: '2026-09-29',
      address: ADDR, lat: 37.5731, lng: 126.9794, ...M1, law: '도로교통법 제32조', rating: 5, payload: 'R1-v1' },
    { user: a, dataset: mobile, key: 'R1', sourceId: '9100000001', number: 'SPP-2609-00000001', vehicle: V, category: 'parking',
      disposition: 'fine', amountKind: 'fine', amount: 40000, reportDate: '2026-09-20', completedDate: '2026-09-29',
      address: ADDR, lat: 37.5731, lng: 126.9794, ...M1, law: '도로교통법 제32조', rating: 5, payload: 'R1-v1',
      firstAt: '2026-09-02T00:00:00Z', answerAt: '2026-09-01T00:00:00Z' },
    // R2: latest answer (rejected) received later; the older accepted answer with another plate must not revive
    { user: a, dataset: pc, key: 'R2', sourceId: '9100000002', number: 'SPP-2609-00000002', vehicle: V, status: 'rejected',
      reportDate: '2026-09-19', completedDate: '2026-09-28', address: ADDR_REF, ...M1, payload: 'R2-new', answerAt: '2026-09-28T01:00:00Z',
      firstAt: '2026-09-10T00:00:00Z' },
    { user: a, dataset: mobile, key: 'R2', sourceId: '9100000002', number: 'SPP-2609-00000002', vehicle: V_OLD, status: 'accepted',
      disposition: 'fine', amountKind: 'fine', amount: 90000, reportDate: '2026-09-19', completedDate: '2026-09-15', address: ADDR_REF,
      ...M1, payload: 'R2-old', answerAt: '2026-09-15T00:00:00Z', firstAt: '2026-09-15T00:00:00Z' },
    // R3: partial / warning, other agency's 김담당
    { user: a, dataset: pc, key: 'R3', sourceId: '9100000003', number: 'SPP-2609-00000003', vehicle: V, status: 'partial',
      disposition: 'warning', reportDate: '2026-09-18', completedDate: '2026-09-27', address: ADDR_NEAR, ...M2, rating: 1 },
    // R4: completed_unknown, spaced plate, no coordinates, no manager, before the recent window
    { user: a, dataset: pc, key: 'R4', sourceId: '9100000004', number: 'SPP-2609-00000004', vehicle: V_SPACED,
      status: 'completed_unknown', disposition: 'unknown', category: 'traffic', reportDate: '2026-09-17', completedDate: '2026-09-26',
      address: ADDR, ...G1 },
    // R5: other plate, penalty amount (never summed as a fine), 김담당 of G1
    { user: a, dataset: pc, key: 'R5', sourceId: '9100000005', number: 'SPP-2608-00000005', vehicle: V_OTHER, status: 'accepted',
      disposition: 'penalty', amountKind: 'penalty', amount: 30000, points: 10, category: 'traffic', reportDate: '2026-07-20',
      completedDate: '2026-08-01', address: ADDR_NEAR, ...M3 },
    // R6: accepted fine without a stated amount and without an answer date
    { user: a, dataset: pc, key: 'R6', sourceId: '9100000006', number: 'SPP-2609-00000006', vehicle: V, disposition: 'fine',
      amountKind: 'fine', amount: null, reportDate: '2026-09-20', completedDate: null, address: ADDR, ...M2 },
    // R7: confirmed 0 won fine, longer plate containing V, year boundary answer
    { user: a, dataset: pc, key: 'R7', sourceId: '9100000007', number: 'SPP-2512-00000007', vehicle: V_LONGER, disposition: 'fine',
      amountKind: 'fine', amount: 0, reportDate: '2025-12-20', completedDate: '2025-12-31', address: ADDR, ...M1 },
    // R8: legacy report without any number; invalid source id → official_url null
    { user: a, dataset: pc, key: 'R8', sourceId: 'R8/legacy id', number: null, vehicle: V, status: 'rejected',
      reportDate: '2025-12-25', completedDate: '2026-01-01', address: ADDR },
    // R9: still processing → never listed
    { user: a, dataset: pc, key: 'R9', sourceId: '9100000009', number: 'SPP-2609-00000009', vehicle: V, status: 'processing',
      reportDate: '2026-09-25', completedDate: null, address: ADDR },
    // R10/R11: one source key, two real report numbers → two reports
    { user: a, dataset: pc, key: 'R10', sourceId: '9100000010', number: 'SPP-2609-00000010', vehicle: V, status: 'accepted',
      reportDate: '2026-09-01', completedDate: '2026-09-05', address: ADDR, ...M1 },
    { user: a, dataset: mobile, key: 'R10', sourceId: '9100000010', number: 'SPP-2609-00000011', vehicle: V, status: 'rejected',
      reportDate: '2026-09-01', completedDate: '2026-09-06', address: ADDR, ...M1 },
    // R12: a legacy observation without a number + the same key numbered on another dataset → one numbered report
    { user: a, dataset: pc, key: 'R12', sourceId: '9100000012', number: null, vehicle: V, status: 'accepted',
      reportDate: '2026-08-01', completedDate: '2026-08-10', address: ADDR, payload: 'R12-legacy', answerAt: '2026-08-10T00:00:00Z',
      firstAt: '2026-08-10T00:00:00Z' },
    { user: a, dataset: mobile, key: 'R12', sourceId: '9100000012', number: 'SPP-2608-00000012', vehicle: V, status: 'accepted',
      reportDate: '2026-08-01', completedDate: '2026-08-10', address: ADDR, payload: 'R12-numbered', answerAt: '2026-08-11T00:00:00Z',
      firstAt: '2026-08-11T00:00:00Z' },
    // R13: uploaded under a revoked consent lineage → never listed
    { user: a, dataset: pc, key: 'R13', sourceId: '9100000013', number: 'SPP-2609-00000013', vehicle: V, grant: revokedGrant,
      reportDate: '2026-09-21', completedDate: '2026-09-29', address: ADDR },
    // R14: plate with literal %, _ and backslash
    { user: a, dataset: pc, key: 'R14', sourceId: '9100000014', number: 'SPP-2609-00000014', vehicle: V_WILD, status: 'accepted',
      reportDate: '2026-09-02', completedDate: '2026-09-03', address: '서울특별시 종로구 예시로 3' },
  ];
}

export function scenarioB(b: TestUser): Fact[] {
  return [
    // B's own report the A account must never see
    { user: b, dataset: 'B-pc', key: 'RB1', sourceId: '9200000001', number: 'SPP-2609-00000901', vehicle: V_B_ONLY,
      reportDate: '2026-09-20', completedDate: '2026-09-29', address: ADDR_B_ONLY, managerKey: 'm1:example-mb', managerName: '이담당',
      agencyKey: 'a1:example-gb', agencyName: '예시 부산경찰서' },
    // B uploads A's R1 key with a newer answer and another plate/agency: A's R1 must not change
    { user: b, dataset: 'B-pc', key: 'R1', sourceId: '9100000001', number: 'SPP-2609-00000001', vehicle: V_B_ONLY, status: 'rejected',
      reportDate: '2026-09-20', completedDate: '2026-09-29', address: ADDR, payload: 'R1-by-B', answerAt: '2026-09-29T12:00:00Z',
      managerKey: 'm1:example-mb', managerName: '이담당', agencyKey: 'a1:example-gb', agencyName: '예시 부산경찰서' },
    // B has the same address as A: A's address search must not count it
    { user: b, dataset: 'B-pc', key: 'RB2', sourceId: '9200000002', number: 'SPP-2609-00000902', vehicle: V, reportDate: '2026-09-21',
      completedDate: '2026-09-28', address: ADDR },
  ];
}

/** Expected own reports of A (by source key label + number) for the plate V search. */
export const A_VEHICLE_V = ['R1', 'R2', 'R3', 'R4', 'R6', 'R7', 'R8', 'R10#10', 'R10#11', 'R12'];
