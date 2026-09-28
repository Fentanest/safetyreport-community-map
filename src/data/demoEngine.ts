/**
 * DEMO BUILDS ONLY. Deterministic synthetic facts run through the real server aggregation
 * (server/aggregate.ts, server/compare.ts) so every scope, filter and the personal comparison behave like
 * production. Nothing here is a real report, account, vehicle or place record. Imported only behind
 * `import.meta.env.VITE_DATA_MODE === 'demo'`, so live builds drop this chunk (checked by the dist scan test).
 */
import { aggregateDashboard, type PrivateFact, type Status, type Disposition } from '../../server/aggregate';
import { aggregateCompare } from '../../server/compare';
import type { DashboardData, Scope } from '../domain/public';
import type { PersonalCompare } from '../domain/personal';
import type { MapAuth } from '../auth/mapAuth';
import { demoViewerFromSearch } from '../auth/mapAuth';
import { personalError } from './personal';

export const DEMO_VERSION = 'synthetic-2026-09-27';
export const DEMO_DATA_MIN = '2024-09-25';
export const DEMO_AS_OF = '2026-09-24';
export const DEMO_VIEWER_ID = 'synthetic-viewer';

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Area { code: string; sido: string; gu: string; lat: number; lng: number; agency: string; managers: string[] }
const AREAS: Area[] = [
  { code: '서울 중구', sido: '서울특별시', gu: '중구', lat: 37.5636, lng: 126.9976, agency: '예시 서울중부경찰서', managers: ['김하늘', '박도윤'] },
  { code: '서울 강남구', sido: '서울특별시', gu: '강남구', lat: 37.5172, lng: 127.0473, agency: '예시 강남구청', managers: ['이서윤', '최민준'] },
  { code: '경기 수원시', sido: '경기도', gu: '수원시', lat: 37.2636, lng: 127.0286, agency: '예시 수원시청', managers: ['정하은', '김하늘'] },
  { code: '인천 남동구', sido: '인천광역시', gu: '남동구', lat: 37.4474, lng: 126.7316, agency: '예시 인천남동경찰서', managers: ['강지호'] },
  { code: '대전 서구', sido: '대전광역시', gu: '서구', lat: 36.3554, lng: 127.3838, agency: '예시 대전서구청', managers: ['윤서아'] },
  { code: '대구 수성구', sido: '대구광역시', gu: '수성구', lat: 35.8581, lng: 128.6306, agency: '예시 대구수성경찰서', managers: ['임준서', '한지우'] },
  { code: '광주 북구', sido: '광주광역시', gu: '북구', lat: 35.174, lng: 126.912, agency: '예시 광주북구청', managers: ['오예린'] },
  { code: '부산 연제구', sido: '부산광역시', gu: '연제구', lat: 35.1763, lng: 129.0797, agency: '예시 부산연제경찰서', managers: ['서지안'] },
  { code: '부산 해운대구', sido: '부산광역시', gu: '해운대구', lat: 35.1631, lng: 129.1636, agency: '예시 해운대구청', managers: ['신우진', '문채원'] },
  { code: '제주 제주시', sido: '제주특별자치도', gu: '제주시', lat: 33.4996, lng: 126.5312, agency: '예시 제주시청', managers: ['양시우'] },
];
/** relative report volume per area (seoul/gyeonggi busy, jeju quiet) */
const WEIGHT = [18, 16, 14, 8, 6, 9, 5, 10, 8, 3];
/** the synthetic viewer mostly reports in these areas; 제주 has exactly one own report (n = 1 point) */
const MY_AREAS = [0, 1, 2, 9];
const HANGUL = '가나다라마거너더러머버서어저고노도로모보소오조구누두루무부수우주';

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function dayIndex(day: string): number { return Math.round(Date.parse(`${day}T00:00:00Z`) / 86400000); }
const SPAN = dayIndex(DEMO_AS_OF) - dayIndex(DEMO_DATA_MIN);

let cache: PrivateFact[] | null = null;

export function demoFacts(): PrivateFact[] {
  if (cache) return cache;
  const rand = mulberry32(20260927);
  const pick = <T,>(list: readonly T[]) => list[Math.floor(rand() * list.length)];
  const weighted = () => {
    const total = WEIGHT.reduce((a, b) => a + b, 0);
    let r = rand() * total;
    for (let i = 0; i < WEIGHT.length; i++) { r -= WEIGHT[i]; if (r < 0) return i; }
    return WEIGHT.length - 1;
  };
  // A small pool of synthetic vehicles, some repeated; built from digits at runtime (no literal plate text).
  const vehicles = Array.from({ length: 40 }, (_, i) => {
    const head = String(10 + Math.floor(rand() * 89));
    const tail = String(1000 + Math.floor(rand() * 8999));
    const prefix = i % 3 === 0 ? pick(['서울', '경기', '부산']) : '';
    return `${prefix}${head}${HANGUL[i % HANGUL.length]}${tail}`;
  });
  const facts: PrivateFact[] = [];
  // Answered fine amounts use their own generator so the rest of the synthetic set stays unchanged.
  const amountRand = mulberry32(20260928);
  const amountOf = (disposition: Disposition): Pick<PrivateFact, 'amount_kind' | 'amount_confirmed_won' | 'amount_public' | 'amount_stated'> => {
    const r = amountRand();
    if (disposition !== 'fine') return r < 0.04
      ? { amount_kind: 'penalty', amount_confirmed_won: null, amount_public: true, amount_stated: true }
      : { amount_kind: 'unknown', amount_confirmed_won: null, amount_public: true, amount_stated: false };
    if (r < 0.1) return { amount_kind: 'fine', amount_confirmed_won: null, amount_public: true, amount_stated: false }; // 금액이 안 적힌 답변
    if (r < 0.18) return { amount_kind: 'fine', amount_confirmed_won: null, amount_public: false, amount_stated: true }; // 금액 공개에 동의하지 않은 자료
    const won = r < 0.2 ? 0 : [40000, 40000, 50000, 50000, 60000, 80000, 100000][Math.floor(amountRand() * 7)];
    return { amount_kind: 'fine', amount_confirmed_won: won, amount_public: true, amount_stated: true };
  };
  // Synthetic 위반법규 (law name + article, as the parser extracts it) from their own generator so every other synthetic
  // value stays unchanged; about one in eight answers has no law (법규 미상).
  const lawRand = mulberry32(20260929);
  const LAWS: Record<'traffic' | 'parking' | 'other', readonly string[]> = {
    parking: ['도로교통법 제32조', '도로교통법 제32조', '도로교통법 제33조', '도로교통법 제34조', '주차장법 제29조'],
    traffic: ['도로교통법 제5조', '도로교통법 제5조', '도로교통법 제5조의2', '도로교통법 제13조', '도로교통법 제25조', '도로교통법 제27조', '도로교통법 제38조'],
    other: ['도로교통법 제49조', '자동차관리법 제10조', '도로교통법 제35조'],
  };
  const lawOf = (category: 'traffic' | 'parking' | 'other'): string | null => {
    const r = lawRand();
    const list = LAWS[category];
    if (r < 0.12) return null;
    const law = list[Math.floor(lawRand() * list.length)];
    // some answers name the paragraph too (parser forms '제32조제1항' / '제32조 1항'); the table groups them by article
    const q = lawRand();
    return q < 0.12 ? `${law}제1항` : q < 0.18 ? `${law} 2항` : law;
  };
  const add = (index: number, contributor: string, areaIndex: number, spot: number, mine: boolean) => {
    const area = AREAS[areaIndex];
    const report = addDays(DEMO_DATA_MIN, Math.floor(rand() * (SPAN + 1)));
    const r = rand();
    // Only answered reports are public (community ingest publishes completed facts only).
    // The synthetic viewer's outcome mix differs from the rest so the %p difference is visible.
    const finalStatus: Status = mine
      ? (r < 0.62 ? 'accepted' : r < 0.75 ? 'partial' : r < 0.9 ? 'rejected' : 'completed_unknown')
      : (r < 0.48 ? 'accepted' : r < 0.6 ? 'partial' : r < 0.87 ? 'rejected' : 'completed_unknown');
    const answered = addDays(report, 4 + Math.floor(rand() * 40));
    const completed: string = answered > DEMO_AS_OF ? DEMO_AS_OF : answered;
    const disposition: Disposition = finalStatus === 'accepted' || finalStatus === 'partial'
      ? (rand() < 0.45 ? 'fine' : rand() < 0.3 ? 'warning' : 'none') : finalStatus === 'rejected' ? 'none' : 'unknown';
    const locatedFact = rand() > 0.03;
    const lat = +(area.lat + (spot - 1) * 0.0071 + (spot === 2 ? 0.0033 : 0)).toFixed(6);
    const lng = +(area.lng + (spot - 1) * 0.0093).toFixed(6);
    const manager = area.managers[spot % area.managers.length];
    const category = pick(['traffic', 'traffic', 'parking', 'parking', 'other'] as const);
    facts.push({
      fact_identity: `synthetic-${index}`, contributor_id: contributor, snapshot_id: 'synthetic', snapshot_generation: 1,
      report_date: report, completed_date: completed, category,
      status: finalStatus, disposition, vehicle_raw: rand() < 0.85 ? pick(vehicles) : null,
      point_key: locatedFact ? `synthetic:${areaIndex}:${spot}` : null, lat: locatedFact ? lat : null, lng: locatedFact ? lng : null,
      address: `${area.sido} ${area.gu} 예시로 ${spot + 1}길`, region_code: area.code,
      agency_key: `a1:synthetic-${areaIndex}`, agency_name: area.agency,
      manager_key: `m1:synthetic-${areaIndex}-${manager}`, manager_name: manager, ...amountOf(disposition),
      violation_law: lawOf(category),
    });
  };
  let n = 0;
  for (let i = 0; i < 520; i++) add(n++, `synthetic-c${String(1 + Math.floor(rand() * 14)).padStart(2, '0')}`, weighted(), Math.floor(rand() * 3), false);
  for (let i = 0; i < 64; i++) add(n++, DEMO_VIEWER_ID, MY_AREAS[Math.floor(rand() * 3)], Math.floor(rand() * 3), true);
  // Exactly one own report at a point nobody else uses (표본 1건 · 나만 기록한 지점).
  const area = AREAS[9];
  facts.push({
    fact_identity: `synthetic-${n++}`, contributor_id: DEMO_VIEWER_ID, snapshot_id: 'synthetic', snapshot_generation: 1,
    report_date: '2026-08-20', completed_date: '2026-09-02', category: 'parking', status: 'accepted', disposition: 'fine',
    vehicle_raw: null, point_key: 'synthetic:9:own', lat: 33.4891, lng: 126.4983,
    address: `${area.sido} ${area.gu} 예시로 9길`, region_code: area.code,
    agency_key: 'a1:synthetic-9', agency_name: area.agency, manager_key: `m1:synthetic-9-${area.managers[0]}`, manager_name: area.managers[0],
    amount_kind: 'fine', amount_confirmed_won: 40000, amount_public: true, amount_stated: true,
    violation_law: '도로교통법 제32조',
  });
  cache = facts;
  return facts;
}

export function demoEngineDashboard(scope: Scope): DashboardData {
  const data = aggregateDashboard(demoFacts(), scope, {
    datasetVersion: DEMO_VERSION, sourceUpdatedAt: null, generatedAt: '2026-09-27T00:00:00Z',
    asOf: DEMO_AS_OF, sample: true, dataMin: DEMO_DATA_MIN,
  });
  data.meta.coverage_note = '합성 예시 자료입니다. 실제 신고 통계가 아닙니다.';
  data.meta.dedupe_policy_version = 'fixture-v2';
  return data;
}

/** Synthetic personal comparison, with the same error surface as the live endpoint (?me=… fixtures). */
export async function demoCompare(scope: Scope, version: string, auth: MapAuth): Promise<PersonalCompare> {
  const fixture = demoViewerFromSearch(window.location.search) ?? 'signed';
  if (auth.snapshot().status === 'unconfigured') throw personalError('unconfigured');
  if (!(await auth.accessToken())) throw personalError('signed_out');
  if (fixture === 'expired') {
    await auth.refreshToken();
    throw personalError('session_expired');
  }
  if (fixture === 'kakao') throw personalError('kakao_required');
  if (fixture === 'error') throw personalError('service_unavailable');
  if (fixture === 'rate') throw personalError('rate_limited', 60);
  if (fixture === 'stale') throw personalError('DATASET_CHANGED');
  // A suspended contributor's facts are not in the public population, exactly like production.
  const viewer = fixture === 'empty' || fixture === 'suspended' ? 'synthetic-viewer-without-public-reports' : DEMO_VIEWER_ID;
  const result = aggregateCompare(demoFacts(), scope, viewer, {
    datasetVersion: version, asOf: DEMO_AS_OF, dataMin: DEMO_DATA_MIN,
    viewer: fixture === 'empty' ? { contributor: 'none', has_public_facts: false }
      : fixture === 'suspended' ? { contributor: 'suspended', has_public_facts: false }
        : { contributor: 'active', has_public_facts: true },
  });
  return JSON.parse(JSON.stringify(result));
}
