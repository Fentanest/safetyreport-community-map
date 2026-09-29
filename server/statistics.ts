/**
 * 맞춤 통계 (S05–S08): the server-side registry, request validation and exact pivot aggregation.
 *
 * The client sends registry ids only. Every cell, row/column total and grand total is computed from the raw
 * answered facts of that set (never by summing/averaging cells), with the same population rules as the dashboard:
 * representative rows for 'all', the viewer's own rows (JWT viewer only) collapsed per identity for 'mine'.
 * Private fields (vehicle number, report number, account ids, penalty points, …) are used only inside
 * derived metrics (distinct vehicles) and never become a dimension or a member label.
 */
import type { Scope } from '../src/domain/public.ts';
import { LAW_NONE, lawKey } from '../src/domain/public.ts';
import {
  STAT_LIMITS, type DimensionDef, type MetricDef, type StatCandidate, type StatCandidatesPage, type StatCatalog,
  type StatCell, type StatisticsResult, type StatisticsSpec, type StatTotal, type StatValue, type StatsFilter,
} from '../src/domain/statistics.ts';
import {
  answered, inDateRange, kstDate, outcomes, ownRepresentatives, regionKeys, representatives, scopeFacts, type PrivateFact,
} from './aggregate.ts';
import { durationOf, median, nearestRank } from './duration.ts';
import { classifyAmount } from './amount.ts';
import { parsePlate } from './plate.ts';
import { placeKey } from './places.ts';
import { regionName } from './regions.ts';
import { agencyTypeOf } from './agencyType.ts';
import { DURATION_BUCKET_DAYS, DURATION_BUCKETS } from './analyticsDistributions.ts';

export class StatsQueryError extends Error {
  constructor(readonly code: 'INVALID_QUERY' | 'RESULT_TOO_LARGE', message: string = code) { super(message); }
}

type Member = { key: string; label: string } | null;
const NONE = '__none__';

const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일'];
const OUTCOME: Record<string, { key: string; label: string }> = {
  accepted: { key: 'accepted', label: '수용' }, partial: { key: 'partial', label: '일부 수용' }, rejected: { key: 'rejected', label: '불수용' },
};
const DISPOSITION: Record<string, string> = { fine: '과태료', warning: '경고·계도', penalty: '범칙금', none: '처분 없음', unknown: '미확인' };
const AMOUNT_BINS: Array<{ key: string; label: string; min: number; max: number | null }> = [
  { key: 'a0', label: '4만원 미만', min: 0, max: 39999 }, { key: 'a1', label: '4만원', min: 40000, max: 40000 },
  { key: 'a2', label: '4만원 초과~5만원', min: 40001, max: 50000 }, { key: 'a3', label: '5만원 초과~8만원', min: 50001, max: 80000 },
  { key: 'a4', label: '8만원 초과', min: 80001, max: null },
];

interface DimImpl extends DimensionDef {
  member(fact: PrivateFact, basis: StatisticsSpec['date_basis']): Member;
  /** natural order of members (order === 'natural') */
  natural?: string[];
}

const dateOf = (fact: PrivateFact, which: 'report' | 'completed') => kstDate(which === 'report' ? fact.report_date : fact.completed_date);
const dateDims = (which: 'report' | 'completed', word: string): DimImpl[] => {
  const mk = (id: string, label: string, fn: (d: string) => { key: string; label: string }): DimImpl => ({
    id: `${which}_${id}`, label: `${word} ${label}`, group: '날짜', roles: ['row', 'column', 'filter'], order: id === 'weekday' ? 'natural' : 'date',
    searchable: false, description: `${word === '답변' ? '답변 받은 날' : '신고한 날'}의 ${label}`,
    natural: id === 'weekday' ? ['1', '2', '3', '4', '5', '6', '7'] : undefined,
    member: (fact) => { const d = dateOf(fact, which); return d ? fn(d) : { key: NONE, label: '날짜 없음' }; },
  });
  return [
    mk('year', '연도', (d) => ({ key: d.slice(0, 4), label: `${d.slice(0, 4)}년` })),
    mk('quarter', '분기', (d) => { const q = Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1; return { key: `${d.slice(0, 4)}-Q${q}`, label: `${d.slice(0, 4)}년 ${q}분기` }; }),
    mk('month', '월', (d) => ({ key: d.slice(0, 7), label: `${d.slice(0, 4)}.${d.slice(5, 7)}` })),
    mk('day', '일', (d) => ({ key: d, label: d.replace(/-/g, '.') })),
    mk('weekday', '요일', (d) => { const w = (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7; return { key: String(w + 1), label: WEEKDAYS[w] }; }),
  ];
};

const DIMS: DimImpl[] = [
  { id: 'sido', label: '시도', group: '지역·장소', roles: ['row', 'column', 'filter'], order: 'count', searchable: true,
    description: '신고 위치의 시도(현재 행정경계)',
    member: (f) => { const k = regionKeys(f).sido; return k ? { key: k, label: regionName(k) ?? k } : { key: NONE, label: '지역 미상' }; } },
  { id: 'sgg', label: '시군구', group: '지역·장소', roles: ['row', 'column', 'filter'], order: 'count', searchable: true,
    description: '신고 위치의 시군구(현재 행정경계)',
    member: (f) => { const k = regionKeys(f).sgg; return k ? { key: k, label: regionName(k) ?? k } : { key: NONE, label: '지역 미상' }; } },
  { id: 'place', label: '주소', group: '지역·장소', roles: ['row', 'filter'], order: 'count', searchable: true,
    description: '정규화한 신고 주소(같은 주소는 하나로 묶음)',
    member: (f) => { const k = placeKey(f); return k ? { key: k, label: f.address ?? '주소' } : { key: NONE, label: '주소 없음' }; } },
  { id: 'agency', label: '기관', group: '기관·담당자', roles: ['row', 'column', 'filter'], order: 'count', searchable: true,
    description: '처리 기관(현행 표시명, 확인된 승계만 반영)',
    member: (f) => (f.agency_key ? { key: f.agency_key, label: f.agency_current_name ?? f.agency_name ?? '기관' } : { key: NONE, label: '기관 없음' }) },
  { id: 'agency_type', label: '기관 유형', group: '기관·담당자', roles: ['row', 'column', 'filter'], order: 'natural', searchable: false,
    description: '경찰 / 경찰 외', natural: ['police', 'non_police', 'unknown'],
    member: (f) => { const t = agencyTypeOf(f.agency_key, f.agency_name); return { key: t, label: t === 'police' ? '경찰' : t === 'non_police' ? '경찰 외' : '유형 미상' }; } },
  { id: 'manager', label: '담당자', group: '기관·담당자', roles: ['row', 'column', 'filter'], order: 'count', searchable: true,
    description: '기관+담당자(다른 기관의 같은 이름은 별개)',
    member: (f) => (f.agency_key && f.manager_key
      ? { key: `${f.agency_key}|${f.manager_key}`, label: `${f.manager_name ?? '이름 없음'} · ${f.agency_current_name ?? f.agency_name ?? '기관'}` }
      : { key: NONE, label: '담당자 없음' }) },
  { id: 'law', label: '위반법규', group: '법규·분류', roles: ['row', 'column', 'filter'], order: 'count', searchable: true,
    description: '공개 허용된 위반법규(조 단위)',
    member: (f) => { const k = lawKey(f.violation_law); return k ? { key: k, label: k } : { key: LAW_NONE, label: '법규 미상' }; } },
  { id: 'category', label: '신고 분류', group: '법규·분류', roles: ['row', 'column', 'filter'], order: 'natural', searchable: false,
    description: '교통위반 / 주정차 / 기타', natural: ['traffic', 'parking', 'other'],
    member: (f) => ({ key: f.category, label: f.category === 'traffic' ? '교통위반' : f.category === 'parking' ? '주정차' : '기타' }) },
  { id: 'outcome', label: '처리 결과', group: '처리 결과', roles: ['row', 'column', 'filter'], order: 'natural', searchable: false,
    description: '수용 / 일부 수용 / 불수용 / 결과 미상', natural: ['accepted', 'partial', 'rejected', 'unknown'],
    member: (f) => OUTCOME[f.status] ?? { key: 'unknown', label: '결과 미상' } },
  { id: 'disposition', label: '처분 종류', group: '처리 결과', roles: ['row', 'column', 'filter'], order: 'natural', searchable: false,
    description: '과태료 / 경고·계도 / 범칙금 / 처분 없음 / 미확인', natural: ['fine', 'warning', 'penalty', 'none', 'unknown'],
    member: (f) => ({ key: f.disposition, label: DISPOSITION[f.disposition] ?? '미확인' }) },
  ...dateDims('completed', '답변'),
  ...dateDims('report', '신고'),
  { id: 'rating', label: '별점', group: '구간', roles: ['row', 'column', 'filter'], order: 'natural', searchable: false,
    description: '공개 동의된 1~5점(없음·비공개는 따로)', natural: ['1', '2', '3', '4', '5', NONE],
    member: (f) => (f.rating != null && f.rating >= 1 && f.rating <= 5 ? { key: String(f.rating), label: `${f.rating}점` } : { key: NONE, label: '평가 없음·비공개' }) },
  { id: 'duration_bin', label: '처리기간 구간', group: '구간', roles: ['row', 'column', 'filter'], order: 'natural', searchable: false,
    description: `신고일→답변일 ${DURATION_BUCKET_DAYS}일 단위(계산 불가는 따로)`,
    natural: [...Array.from({ length: DURATION_BUCKETS + 1 }, (_, i) => `d${i}`), NONE],
    member: (f) => {
      const r = durationOf(f);
      if (!('days' in r)) return { key: NONE, label: '계산 불가' };
      const i = Math.min(DURATION_BUCKETS, Math.floor(r.days / DURATION_BUCKET_DAYS));
      return { key: `d${i}`, label: i === DURATION_BUCKETS ? `${i * DURATION_BUCKET_DAYS}일 이상` : `${i * DURATION_BUCKET_DAYS}~${i * DURATION_BUCKET_DAYS + DURATION_BUCKET_DAYS - 1}일` };
    } },
  { id: 'amount_bin', label: '확인 과태료 금액 구간', group: '구간', roles: ['row', 'column', 'filter'], order: 'natural', searchable: false,
    description: '공개 동의되고 확인된 과태료 금액만(추정·미확인은 따로)', natural: [...AMOUNT_BINS.map((b) => b.key), NONE],
    member: (f) => {
      if (classifyAmount(f) !== 'confirmed' || f.amount_confirmed_won == null) return { key: NONE, label: '확인 금액 없음' };
      const won = f.amount_confirmed_won;
      const b = AMOUNT_BINS.find((x) => won >= x.min && (x.max === null || won <= x.max))!;
      return { key: b.key, label: b.label };
    } },
  { id: 'located', label: '위치 자료', group: '구간', roles: ['row', 'column', 'filter'], order: 'natural', searchable: false,
    description: '지도 좌표가 있는 신고인지', natural: ['yes', 'no'],
    member: (f) => (f.lat !== null && f.lng !== null ? { key: 'yes', label: '좌표 있음' } : { key: 'no', label: '좌표 없음' }) },
];
const DIM = new Map(DIMS.map((d) => [d.id, d]));

type Computed = StatValue;
interface MetricImpl extends MetricDef { compute(facts: readonly PrivateFact[]): Computed }
const count = (n: number): Computed => ({ value: n, numerator: n, denominator: null, reason: null });
const ratio = (num: number, den: number): Computed => ({ value: den > 0 ? (num / den) * 100 : null, numerator: num, denominator: den, reason: den > 0 ? null : 'zero_denominator' });
const stat = (value: number | null, eligible: number): Computed => ({ value, numerator: null, denominator: eligible, reason: value === null ? 'no_data' : null });
const disp = (facts: readonly PrivateFact[], d: string) => facts.filter((f) => f.disposition === d).length;
const confirmedWon = (facts: readonly PrivateFact[]) => facts.filter((f) => classifyAmount(f) === 'confirmed' && f.amount_confirmed_won != null)
  .map((f) => f.amount_confirmed_won as number).sort((a, b) => a - b);
const days = (facts: readonly PrivateFact[]) => facts.map(durationOf).filter((r): r is { days: number } => 'days' in r).map((r) => r.days).sort((a, b) => a - b);
const ratings = (facts: readonly PrivateFact[]) => facts.map((f) => f.rating).filter((r): r is number => r != null && r >= 1 && r <= 5);

const METRICS: MetricImpl[] = [
  { id: 'completed_count', label: '답변 건수', unit: 'count', kind: 'count', denominator: null, description: '답변 완료된 신고 수(C)', compute: (f) => count(f.length) },
  { id: 'accepted_count', label: '수용 건수', unit: 'count', kind: 'count', denominator: null, description: 'A', compute: (f) => count(outcomes(f).accepted) },
  { id: 'partial_count', label: '일부 수용 건수', unit: 'count', kind: 'count', denominator: null, description: 'P', compute: (f) => count(outcomes(f).partial) },
  { id: 'rejected_count', label: '불수용 건수', unit: 'count', kind: 'count', denominator: null, description: 'R', compute: (f) => count(outcomes(f).rejected) },
  { id: 'unknown_count', label: '결과 미상 건수', unit: 'count', kind: 'count', denominator: null, description: '결과가 확인되지 않은 답변', compute: (f) => count(outcomes(f).result_unknown) },
  { id: 'fine_count', label: '과태료 건수', unit: 'count', kind: 'count', denominator: null, description: '처분이 과태료(F)', compute: (f) => count(disp(f, 'fine')) },
  { id: 'warning_count', label: '계도 건수', unit: 'count', kind: 'count', denominator: null, description: '처분이 경고·계도(W)', compute: (f) => count(disp(f, 'warning')) },
  { id: 'penalty_count', label: '범칙금 건수', unit: 'count', kind: 'count', denominator: null, description: '처분이 범칙금(B)', compute: (f) => count(disp(f, 'penalty')) },
  { id: 'accept_rate', label: '수용률', unit: 'percent', kind: 'rate', denominator: 'K', description: 'A ÷ K(결과 확인)', compute: (f) => { const o = outcomes(f); return ratio(o.accepted, o.result_known); } },
  { id: 'partial_rate', label: '일부수용률', unit: 'percent', kind: 'rate', denominator: 'K', description: 'P ÷ K', compute: (f) => { const o = outcomes(f); return ratio(o.partial, o.result_known); } },
  { id: 'reject_rate', label: '불수용률', unit: 'percent', kind: 'rate', denominator: 'K', description: 'R ÷ K', compute: (f) => { const o = outcomes(f); return ratio(o.rejected, o.result_known); } },
  { id: 'fine_rate', label: '과태료처분율', unit: 'percent', kind: 'rate', denominator: 'C', description: 'F ÷ C(답변 완료)', compute: (f) => ratio(disp(f, 'fine'), f.length) },
  { id: 'warning_rate', label: '계도처분율', unit: 'percent', kind: 'rate', denominator: 'C', description: 'W ÷ C', compute: (f) => ratio(disp(f, 'warning'), f.length) },
  { id: 'penalty_rate', label: '범칙금처분율', unit: 'percent', kind: 'rate', denominator: 'C', description: 'B ÷ C', compute: (f) => ratio(disp(f, 'penalty'), f.length) },
  { id: 'amount_sum', label: '확인 과태료 합계', unit: 'won', kind: 'stat', denominator: 'amount', description: '공개 동의·확인된 과태료만(범칙금·혼합 제외)', compute: (f) => { const w = confirmedWon(f); return stat(w.length ? w.reduce((a, b) => a + b, 0) : null, w.length); } },
  { id: 'amount_mean', label: '확인 과태료 평균', unit: 'won', kind: 'stat', denominator: 'amount', description: '확인 금액 평균', compute: (f) => { const w = confirmedWon(f); return stat(w.length ? w.reduce((a, b) => a + b, 0) / w.length : null, w.length); } },
  { id: 'amount_median', label: '확인 과태료 중앙값', unit: 'won', kind: 'stat', denominator: 'amount', description: '확인 금액 중앙값', compute: (f) => { const w = confirmedWon(f); return stat(median(w), w.length); } },
  { id: 'amount_confirmed', label: '금액 확인 건수', unit: 'count', kind: 'count', denominator: null, description: '금액이 확인된 과태료 건수', compute: (f) => count(confirmedWon(f).length) },
  { id: 'duration_mean', label: '처리기간 평균', unit: 'days', kind: 'stat', denominator: 'duration', description: '신고일→답변일(역전·결측 제외)', compute: (f) => { const d = days(f); return stat(d.length ? d.reduce((a, b) => a + b, 0) / d.length : null, d.length); } },
  { id: 'duration_median', label: '처리기간 중앙값', unit: 'days', kind: 'stat', denominator: 'duration', description: '중앙값', compute: (f) => { const d = days(f); return stat(median(d), d.length); } },
  { id: 'duration_p90', label: '처리기간 90%', unit: 'days', kind: 'stat', denominator: 'duration', description: '90번째 백분위(nearest rank)', compute: (f) => { const d = days(f); return stat(nearestRank(d, 0.9), d.length); } },
  { id: 'duration_count', label: '처리기간 계산 가능 건수', unit: 'count', kind: 'count', denominator: null, description: '신고일·답변일이 모두 있고 역전되지 않은 답변', compute: (f) => count(days(f).length) },
  { id: 'rating_mean', label: '평균 별점', unit: 'score', kind: 'stat', denominator: 'rating', description: '공개 동의된 1~5점 평균', compute: (f) => { const r = ratings(f); return stat(r.length ? r.reduce((a, b) => a + b, 0) / r.length : null, r.length); } },
  { id: 'rating_count', label: '평가 건수', unit: 'count', kind: 'count', denominator: null, description: '공개 별점이 있는 답변', compute: (f) => count(ratings(f).length) },
  { id: 'vehicle_distinct', label: '식별 차량 수', unit: 'count', kind: 'distinct', denominator: null, description: '번호판으로 식별 가능한 서로 다른 차량(원번호는 내보내지 않음)',
    compute: (f) => count(new Set(f.map((x) => parsePlate(x.vehicle_raw)?.canonical).filter((v): v is string => !!v)).size) },
  { id: 'place_distinct', label: '주소 수', unit: 'count', kind: 'distinct', denominator: null, description: '서로 다른 신고 주소',
    compute: (f) => count(new Set(f.map(placeKey).filter((v): v is string => !!v)).size) },
];
const METRIC = new Map(METRICS.map((m) => [m.id, m]));

export function statisticsCatalog(): StatCatalog {
  return {
    dimensions: DIMS.map(({ member: _m, natural: _n, ...d }) => d),
    metrics: METRICS.map(({ compute: _c, ...m }) => m),
    limits: STAT_LIMITS,
  };
}

// ── request validation (allowlist only) ──────────────────────────────────────────────────────────────────
const idPattern = /^[a-z][a-z0-9_]{1,39}$/;
const memberPattern = /^[^\u0000-\u001f]{1,160}$/u;

export function parseSpec(raw: string | null): StatisticsSpec {
  const bad = (why: string): never => { throw new StatsQueryError('INVALID_QUERY', why); };
  if (!raw || raw.length > STAT_LIMITS.specChars) bad('spec length');
  let v: unknown;
  try { v = JSON.parse(raw!); } catch { bad('spec json'); }
  if (!v || typeof v !== 'object' || Array.isArray(v)) bad('spec object');
  const o = v as Record<string, unknown>;
  const allowedKeys = new Set(['version', 'date_basis', 'population', 'rows', 'columns', 'metrics', 'filters', 'place_key']);
  for (const k of Object.keys(o)) if (!allowedKeys.has(k)) bad(`unknown field ${k}`);
  if (o.version !== 1) bad('version');
  if (o.date_basis !== 'completed_date' && o.date_basis !== 'report_date') bad('date_basis');
  if (o.population !== 'all' && o.population !== 'mine' && o.population !== 'compare') bad('population');
  const ids = (x: unknown, max: number, role: 'row' | 'column' | null, kind: 'dim' | 'metric') => {
    if (!Array.isArray(x) || x.length > max) bad('list');
    const list = x as unknown[];
    for (const id of list) {
      if (typeof id !== 'string' || !idPattern.test(id)) bad('id');
      if (kind === 'metric' ? !METRIC.has(id as string) : !DIM.get(id as string)?.roles.includes(role!)) bad(`not allowed ${String(id)}`);
    }
    if (new Set(list).size !== list.length) bad('duplicate');
    return list as string[];
  };
  const rows = ids(o.rows, STAT_LIMITS.rows, 'row', 'dim');
  const columns = ids(o.columns, STAT_LIMITS.columns, 'column', 'dim');
  if (rows.some((r) => columns.includes(r))) bad('row=column');
  const metrics = ids(o.metrics, STAT_LIMITS.metrics, null, 'metric');
  if (metrics.length === 0) bad('no metric');
  if (!Array.isArray(o.filters) || o.filters.length > STAT_LIMITS.filters) bad('filters');
  const filters: StatsFilter[] = [];
  for (const f of o.filters as unknown[]) {
    if (!f || typeof f !== 'object') bad('filter');
    const ff = f as Record<string, unknown>;
    if (Object.keys(ff).some((k) => k !== 'dimension' && k !== 'members')) bad('filter field');
    if (typeof ff.dimension !== 'string' || !DIM.get(ff.dimension)?.roles.includes('filter')) bad('filter dim');
    if (!Array.isArray(ff.members) || ff.members.length === 0 || ff.members.length > STAT_LIMITS.members) bad('members');
    for (const m of ff.members as unknown[]) if (typeof m !== 'string' || !memberPattern.test(m)) bad('member');
    if (filters.some((x) => x.dimension === ff.dimension)) bad('duplicate filter');
    filters.push({ dimension: ff.dimension as string, members: [...new Set(ff.members as string[])] });
  }
  const place = o.place_key ?? null;
  if (place !== null && (typeof place !== 'string' || !/^pl1:[0-9a-f]{16}$/.test(place))) bad('place_key');
  return { version: 1, date_basis: o.date_basis as StatisticsSpec['date_basis'], population: o.population as StatisticsSpec['population'],
    rows, columns, metrics, filters, place_key: place as string | null };
}

// ── aggregation ──────────────────────────────────────────────────────────────────────────────────────────
/** answered facts of the period on the chosen date basis, after the scope and the (place) conditions */
function population(base: readonly PrivateFact[], scope: Scope, spec: Pick<StatisticsSpec, 'date_basis' | 'place_key'>) {
  let noReportDate = 0;
  const out: PrivateFact[] = [];
  for (const f of base) {
    if (!answered(f)) continue;
    if (spec.place_key && placeKey(f) !== spec.place_key) continue;
    if (spec.date_basis === 'completed_date') {
      if (inDateRange(f.completed_date, scope.start, scope.end)) out.push(f);
    } else if (kstDate(f.report_date) === null) {
      if (inDateRange(f.completed_date, scope.start, scope.end)) noReportDate++;
    } else if (inDateRange(f.report_date, scope.start, scope.end)) out.push(f);
  }
  return { facts: out, noReportDate };
}

const matches = (f: PrivateFact, filters: readonly StatsFilter[], basis: StatisticsSpec['date_basis'], skip?: string) =>
  filters.every((flt) => flt.dimension === skip || flt.members.includes(DIM.get(flt.dimension)!.member(f, basis)?.key ?? NONE));

export interface StatsInput {
  facts: readonly PrivateFact[];
  scope: Scope;
  spec: StatisticsSpec;
  datasetVersion: string;
  /** JWT-verified viewer id — required for mine/compare; never taken from the request */
  viewerId?: string | null;
}

export function sides(input: StatsInput) {
  const { facts, scope, spec } = input;
  const wantAll = spec.population !== 'mine', wantMine = spec.population !== 'all';
  if (wantMine && !input.viewerId) throw new StatsQueryError('INVALID_QUERY', 'viewer required');
  const all = wantAll ? population(scopeFacts(representatives(facts), scope), scope, spec) : null;
  const mine = wantMine
    ? population(ownRepresentatives(scopeFacts(facts, scope).filter((f) => f.contributor_id === input.viewerId)), scope, spec) : null;
  return { all, mine };
}

export function aggregateStatistics(input: StatsInput): StatisticsResult {
  const { scope, spec } = input;
  const { all, mine } = sides(input);
  const basis = spec.date_basis;
  const filtered = { all: all?.facts.filter((f) => matches(f, spec.filters, basis)) ?? null, mine: mine?.facts.filter((f) => matches(f, spec.filters, basis)) ?? null };
  const rowDims = spec.rows.map((id) => DIM.get(id)!), colDims = spec.columns.map((id) => DIM.get(id)!);
  const tuple = (f: PrivateFact, dims: DimImpl[]) => dims.map((d) => d.member(f, basis) ?? { key: NONE, label: '미상' });

  // members (union of both sides so rows line up), with their answered counts for ordering
  const collect = (dims: DimImpl[]) => {
    const map = new Map<string, { key: string[]; label: string[]; n: number }>();
    for (const side of [filtered.all, filtered.mine]) for (const f of side ?? []) {
      const t = tuple(f, dims);
      const k = JSON.stringify(t.map((x) => x.key));
      const e = map.get(k);
      if (e) e.n++; else map.set(k, { key: t.map((x) => x.key), label: t.map((x) => x.label), n: 1 });
    }
    const order = (a: { key: string[]; label: string[]; n: number }, b: typeof a) => {
      for (let i = 0; i < dims.length; i++) {
        const d = dims[i];
        if (a.key[i] === b.key[i]) continue;
        if (a.key[i] === NONE || a.key[i] === LAW_NONE) return 1;
        if (b.key[i] === NONE || b.key[i] === LAW_NONE) return -1;
        if (d.order === 'date') return a.key[i] < b.key[i] ? -1 : 1;
        if (d.order === 'natural' && d.natural) return d.natural.indexOf(a.key[i]) - d.natural.indexOf(b.key[i]);
        // count order: first dimension by its own total, ties by label (Korean collation), then key
        return b.n - a.n || a.label[i].localeCompare(b.label[i], 'ko') || (a.key[i] < b.key[i] ? -1 : 1);
      }
      return 0;
    };
    return [...map.values()].sort(order);
  };
  const rowMembers = spec.rows.length ? collect(rowDims) : [{ key: [], label: [], n: 0 }];
  const colMembers = spec.columns.length ? collect(colDims) : [{ key: [], label: [], n: 0 }];
  const cellsBudget = rowMembers.length * colMembers.length * (spec.population === 'compare' ? 2 : 1);
  if (cellsBudget > STAT_LIMITS.cells) {
    throw new StatsQueryError('RESULT_TOO_LARGE',
      `행·열 조합이 ${cellsBudget.toLocaleString('ko-KR')}칸으로 한도(${STAT_LIMITS.cells.toLocaleString('ko-KR')}칸)를 넘습니다. 비교 대상을 고르거나 기간·차원을 줄여 주세요.`);
  }
  const compute = (facts: readonly PrivateFact[]) =>
    Object.fromEntries(spec.metrics.map((id) => [id, METRIC.get(id)!.compute(facts)])) as Record<string, StatValue>;

  const cells: StatCell[] = [];
  const rowTotals: StatTotal[] = [], colTotals: StatTotal[] = [], grand: StatTotal[] = [];
  for (const [side, facts] of [['all', filtered.all], ['mine', filtered.mine]] as const) {
    if (!facts) continue;
    const groups = new Map<string, PrivateFact[]>();
    const byRow = new Map<string, PrivateFact[]>(), byCol = new Map<string, PrivateFact[]>();
    for (const f of facts) {
      const r = JSON.stringify(tuple(f, rowDims).map((x) => x.key)), c = JSON.stringify(tuple(f, colDims).map((x) => x.key));
      (groups.get(`${r}\u0000${c}`) ?? groups.set(`${r}\u0000${c}`, []).get(`${r}\u0000${c}`)!).push(f);
      (byRow.get(r) ?? byRow.set(r, []).get(r)!).push(f);
      (byCol.get(c) ?? byCol.set(c, []).get(c)!).push(f);
    }
    for (const rm of rowMembers) for (const cm of colMembers) {
      const g = groups.get(`${JSON.stringify(rm.key)}\u0000${JSON.stringify(cm.key)}`);
      if (g) cells.push({ row: rm.key, col: cm.key, side, values: compute(g) });
    }
    if (spec.rows.length) for (const rm of rowMembers) { const g = byRow.get(JSON.stringify(rm.key)); if (g) rowTotals.push({ key: rm.key, side, values: compute(g) }); }
    if (spec.columns.length) for (const cm of colMembers) { const g = byCol.get(JSON.stringify(cm.key)); if (g) colTotals.push({ key: cm.key, side, values: compute(g) }); }
    grand.push({ key: [], side, values: compute(facts) });
  }

  // selected filter members: their count under every OTHER condition (so a member the period excludes shows "0건")
  const filterMembers: StatisticsResult['filter_members'] = [];
  const pool = all?.facts ?? mine?.facts ?? [];
  for (const flt of spec.filters) {
    const d = DIM.get(flt.dimension)!;
    const others = pool.filter((f) => matches(f, spec.filters, basis, flt.dimension));
    for (const key of flt.members) {
      const hit = others.filter((f) => d.member(f, basis)?.key === key);
      filterMembers.push({ dimension: flt.dimension, key, label: hit[0] ? d.member(hit[0], basis)?.label ?? null : null, count: hit.length });
    }
  }

  return {
    schema_version: 1, dataset_version: input.datasetVersion, scope, spec,
    row_members: rowMembers.map(({ key, label }) => ({ key, label })),
    col_members: colMembers.map(({ key, label }) => ({ key, label })),
    cells, row_totals: rowTotals, col_totals: colTotals, grand_totals: grand,
    population_count: { all: filtered.all?.length ?? null, mine: filtered.mine?.length ?? null },
    excluded: { no_report_date: (all?.noReportDate ?? 0) + (mine?.noReportDate ?? 0) },
    filter_members: filterMembers,
    complete: true,
  };
}

// ── candidates (target selector) ─────────────────────────────────────────────────────────────────────────
export const CANDIDATE_KINDS = new Set(['agency', 'manager', 'sido', 'sgg', 'law', 'place']);

/** Server search over the FULL member set of the current conditions. The dimension's own selection is ignored
 *  (facet rule), so after picking A the list still offers B. Only members with answered reports are listed. */
export function statisticsCandidates(input: { facts: readonly PrivateFact[]; scope: Scope; datasetVersion: string;
  kind: string; q: string; cursor: number; limit: number; filters: StatsFilter[]; basis: StatisticsSpec['date_basis'];
  placeKey: string | null; keys: string[] }): StatCandidatesPage {
  const d = DIM.get(input.kind);
  if (!d || !CANDIDATE_KINDS.has(input.kind)) throw new StatsQueryError('INVALID_QUERY', 'kind');
  const pop = population(scopeFacts(representatives(input.facts), input.scope), input.scope, { date_basis: input.basis, place_key: input.placeKey }).facts
    .filter((f) => matches(f, input.filters, input.basis, input.kind));
  const map = new Map<string, StatCandidate>();
  for (const f of pop) {
    const m = d.member(f, input.basis);
    if (!m || m.key === NONE) continue;
    const e = map.get(m.key);
    if (e) e.count++;
    else map.set(m.key, { key: m.key, label: m.label, sub: input.kind === 'manager' ? (f.agency_current_name ?? f.agency_name ?? null) : null, count: 1 });
  }
  const needle = input.q.trim();
  const list = [...map.values()]
    .filter((c) => !needle || c.label.includes(needle) || (c.sub ?? '').includes(needle))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'ko') || (a.key < b.key ? -1 : 1));
  const items = list.slice(input.cursor, input.cursor + input.limit);
  return {
    dataset_version: input.datasetVersion, kind: input.kind, items, total: list.length,
    next_cursor: input.cursor + input.limit < list.length ? input.cursor + input.limit : null,
    selected: input.keys.map((k) => map.get(k) ?? { key: k, label: '', sub: null, count: 0 }),
  };
}

export function parseFilters(raw: string | null): StatsFilter[] {
  if (raw === null) return [];
  const spec = parseSpec(JSON.stringify({ version: 1, date_basis: 'completed_date', population: 'all', rows: [], columns: [], metrics: ['completed_count'], filters: safeJson(raw), place_key: null }));
  return spec.filters;
}
function safeJson(raw: string): unknown {
  if (raw.length > STAT_LIMITS.specChars) throw new StatsQueryError('INVALID_QUERY', 'filters length');
  try { return JSON.parse(raw); } catch { throw new StatsQueryError('INVALID_QUERY', 'filters json'); }
}
