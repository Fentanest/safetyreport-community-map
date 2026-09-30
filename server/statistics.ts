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
import { COHORT_POLICY_VERSION, LAW_NONE, lawKey } from '../src/domain/public.ts';
import {
  STAT_LIMITS, type DimensionDef, type MetricDef, type StatCandidate, type StatCandidatesPage, type StatCatalog,
  type StatCell, type StatisticsResult, type StatisticsSpec, type StatTotal, type StatValue, type StatsFilter,
} from '../src/domain/statistics.ts';
import {
  cohortDateOf, inDateRange, isCompleted, kstDate, monthKeys, outcomes, ownRepresentatives, regionKeys, representatives, scopeFacts,
  type PrivateFact,
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
    description: '신고 위치의 시도(지금의 행정구역 기준)',
    member: (f) => { const k = regionKeys(f).sido; return k ? { key: k, label: regionName(k) ?? k } : { key: NONE, label: '지역 미상' }; } },
  { id: 'sgg', label: '시군구', group: '지역·장소', roles: ['row', 'column', 'filter'], order: 'count', searchable: true,
    description: '신고 위치의 시군구(지금의 행정구역 기준)',
    member: (f) => { const k = regionKeys(f).sgg; return k ? { key: k, label: regionName(k) ?? k } : { key: NONE, label: '지역 미상' }; } },
  { id: 'place', label: '주소', group: '지역·장소', roles: ['row', 'filter'], order: 'count', searchable: true,
    description: '신고 주소(같은 주소는 하나로 묶음)',
    member: (f) => { const k = placeKey(f); return k ? { key: k, label: f.address ?? '주소' } : { key: NONE, label: '주소 없음' }; } },
  { id: 'agency', label: '기관', group: '기관·담당자', roles: ['row', 'column', 'filter'], order: 'count', searchable: true,
    description: '처리 기관(지금 쓰는 기관 이름)',
    member: (f) => (f.agency_key ? { key: f.agency_key, label: f.agency_current_name ?? f.agency_name ?? '기관' } : { key: NONE, label: '기관 없음' }) },
  { id: 'agency_type', label: '기관 유형', group: '기관·담당자', roles: ['row', 'column', 'filter'], order: 'natural', searchable: false,
    description: '경찰인지 아닌지', natural: ['police', 'non_police', 'unknown'],
    member: (f) => { const t = agencyTypeOf(f.agency_key, f.agency_name); return { key: t, label: t === 'police' ? '경찰' : t === 'non_police' ? '경찰 외' : '유형 미상' }; } },
  { id: 'manager', label: '담당자', group: '기관·담당자', roles: ['row', 'column', 'filter'], order: 'count', searchable: true,
    description: '담당자(기관이 다르면 이름이 같아도 다른 사람)',
    member: (f) => (f.agency_key && f.manager_key
      ? { key: `${f.agency_key}|${f.manager_key}`, label: `${f.manager_name ?? '이름 없음'} · ${f.agency_current_name ?? f.agency_name ?? '기관'}` }
      : { key: NONE, label: '담당자 없음' }) },
  { id: 'law', label: '위반법규', group: '법규·분류', roles: ['row', 'column', 'filter'], order: 'count', searchable: true,
    description: '위반법규(조 단위)',
    member: (f) => { const k = lawKey(f.violation_law); return k ? { key: k, label: k } : { key: LAW_NONE, label: '법규 미상' }; } },
  { id: 'category', label: '신고 분류', group: '법규·분류', roles: ['row', 'column', 'filter'], order: 'natural', searchable: false,
    description: '교통위반 / 주정차 / 기타', natural: ['traffic', 'parking', 'other'],
    member: (f) => ({ key: f.category, label: f.category === 'traffic' ? '교통위반' : f.category === 'parking' ? '주정차' : '기타' }) },
  { id: 'outcome', label: '처리 결과', group: '처리 결과', roles: ['row', 'column', 'filter'], order: 'natural', searchable: false,
    description: '수용 / 일부 수용 / 불수용 / 미분류', natural: ['accepted', 'partial', 'rejected', 'unknown'],
    member: (f) => OUTCOME[f.status] ?? { key: 'unknown', label: '미분류' } },
  { id: 'disposition', label: '처분 종류', group: '처리 결과', roles: ['row', 'column', 'filter'], order: 'natural', searchable: false,
    description: '과태료 / 경고·계도 / 범칙금 / 처분 없음 / 미확인', natural: ['fine', 'warning', 'penalty', 'none', 'unknown'],
    member: (f) => ({ key: f.disposition, label: DISPOSITION[f.disposition] ?? '미확인' }) },
  ...dateDims('completed', '답변'),
  ...dateDims('report', '신고'),
  { id: 'rating', label: '별점', group: '구간', roles: ['row', 'column', 'filter'], order: 'natural', searchable: false,
    description: '공개에 동의한 1~5점(별점이 없거나 비공개인 신고는 따로 셈)', natural: ['1', '2', '3', '4', '5', NONE],
    member: (f) => (f.rating != null && f.rating >= 1 && f.rating <= 5 ? { key: String(f.rating), label: `${f.rating}점` } : { key: NONE, label: '평가 없음·비공개' }) },
  { id: 'duration_bin', label: '처리기간 구간', group: '구간', roles: ['row', 'column', 'filter'], order: 'natural', searchable: false,
    description: `신고한 날부터 답변 받은 날까지 걸린 기간, ${DURATION_BUCKET_DAYS}일 단위(계산할 수 없는 신고는 따로 셈)`,
    natural: [...Array.from({ length: DURATION_BUCKETS + 1 }, (_, i) => `d${i}`), NONE],
    member: (f) => {
      const r = durationOf(f);
      if (!('days' in r)) return { key: NONE, label: '계산 불가' };
      const i = Math.min(DURATION_BUCKETS, Math.floor(r.days / DURATION_BUCKET_DAYS));
      return { key: `d${i}`, label: i === DURATION_BUCKETS ? `${i * DURATION_BUCKET_DAYS}일 이상` : `${i * DURATION_BUCKET_DAYS}~${i * DURATION_BUCKET_DAYS + DURATION_BUCKET_DAYS - 1}일` };
    } },
  { id: 'amount_bin', label: '확인 과태료 금액 구간', group: '구간', roles: ['row', 'column', 'filter'], order: 'natural', searchable: false,
    description: '공개에 동의하고 금액이 확인된 과태료만(확인되지 않은 금액은 따로 셈)', natural: [...AMOUNT_BINS.map((b) => b.key), NONE],
    member: (f) => {
      if (classifyAmount(f) !== 'confirmed' || f.amount_confirmed_won == null) return { key: NONE, label: '확인 금액 없음' };
      const won = f.amount_confirmed_won;
      const b = AMOUNT_BINS.find((x) => won >= x.min && (x.max === null || won <= x.max))!;
      return { key: b.key, label: b.label };
    } },
  { id: 'located', label: '위치 자료', group: '구간', roles: ['row', 'column', 'filter'], order: 'natural', searchable: false,
    description: '지도에 위치가 있는 신고인지', natural: ['yes', 'no'],
    member: (f) => (f.lat !== null && f.lng !== null ? { key: 'yes', label: '위치 있음' } : { key: 'no', label: '위치 없음' }) },
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
  { id: 'completed_count', label: '답변 건수', unit: 'count', kind: 'count', denominator: null, description: '답변 받은 신고 수', compute: (f) => count(f.length) },
  { id: 'accepted_count', label: '수용 건수', unit: 'count', kind: 'count', denominator: null, description: '처리 결과가 수용인 신고 수', compute: (f) => count(outcomes(f).accepted) },
  { id: 'partial_count', label: '일부 수용 건수', unit: 'count', kind: 'count', denominator: null, description: '처리 결과가 일부 수용인 신고 수', compute: (f) => count(outcomes(f).partial) },
  { id: 'rejected_count', label: '불수용 건수', unit: 'count', kind: 'count', denominator: null, description: '처리 결과가 불수용인 신고 수', compute: (f) => count(outcomes(f).rejected) },
  { id: 'unknown_count', label: '미분류 건수', unit: 'count', kind: 'count', denominator: null, description: '안전신문고 처리 상태가 ‘답변완료’·‘기타’라 수용 여부가 없는 답변 수', compute: (f) => count(outcomes(f).result_unknown) },
  { id: 'fine_count', label: '과태료 건수', unit: 'count', kind: 'count', denominator: null, description: '처분이 과태료인 신고 수', compute: (f) => count(disp(f, 'fine')) },
  { id: 'warning_count', label: '계도 건수', unit: 'count', kind: 'count', denominator: null, description: '처분이 경고·계도인 신고 수', compute: (f) => count(disp(f, 'warning')) },
  { id: 'penalty_count', label: '범칙금 건수', unit: 'count', kind: 'count', denominator: null, description: '처분이 범칙금인 신고 수', compute: (f) => count(disp(f, 'penalty')) },
  { id: 'accept_rate', label: '수용률', unit: 'percent', kind: 'rate', denominator: 'K', description: '(수용+일부수용+불수용) 중 수용의 비율', compute: (f) => { const o = outcomes(f); return ratio(o.accepted, o.result_known); } },
  { id: 'partial_rate', label: '일부수용률', unit: 'percent', kind: 'rate', denominator: 'K', description: '(수용+일부수용+불수용) 중 일부 수용의 비율', compute: (f) => { const o = outcomes(f); return ratio(o.partial, o.result_known); } },
  { id: 'reject_rate', label: '불수용률', unit: 'percent', kind: 'rate', denominator: 'K', description: '(수용+일부수용+불수용) 중 불수용의 비율', compute: (f) => { const o = outcomes(f); return ratio(o.rejected, o.result_known); } },
  { id: 'fine_rate', label: '과태료 부과율', unit: 'percent', kind: 'rate', denominator: 'C', description: '전체 답변 중 과태료 처분의 비율', compute: (f) => ratio(disp(f, 'fine'), f.length) },
  { id: 'warning_rate', label: '경고·계도 비율', unit: 'percent', kind: 'rate', denominator: 'C', description: '전체 답변 중 경고·계도 처분의 비율', compute: (f) => ratio(disp(f, 'warning'), f.length) },
  { id: 'penalty_rate', label: '범칙금 부과율', unit: 'percent', kind: 'rate', denominator: 'C', description: '전체 답변 중 범칙금 처분의 비율', compute: (f) => ratio(disp(f, 'penalty'), f.length) },
  { id: 'amount_sum', label: '확인 과태료 합계', unit: 'won', kind: 'stat', denominator: 'amount', description: '공개에 동의하고 금액이 확인된 과태료만 더함(범칙금이나 섞인 금액은 제외)', compute: (f) => { const w = confirmedWon(f); return stat(w.length ? w.reduce((a, b) => a + b, 0) : null, w.length); } },
  { id: 'amount_mean', label: '확인 과태료 평균', unit: 'won', kind: 'stat', denominator: 'amount', description: '금액이 확인된 과태료의 평균', compute: (f) => { const w = confirmedWon(f); return stat(w.length ? w.reduce((a, b) => a + b, 0) / w.length : null, w.length); } },
  { id: 'amount_median', label: '확인 과태료 중앙값', unit: 'won', kind: 'stat', denominator: 'amount', description: '금액이 확인된 과태료의 중앙값', compute: (f) => { const w = confirmedWon(f); return stat(median(w), w.length); } },
  { id: 'amount_confirmed', label: '금액 확인 건수', unit: 'count', kind: 'count', denominator: null, description: '금액이 확인된 과태료 건수', compute: (f) => count(confirmedWon(f).length) },
  { id: 'duration_mean', label: '처리기간 평균', unit: 'days', kind: 'stat', denominator: 'duration', description: '신고한 날부터 답변 받은 날까지 걸린 날수의 평균(날짜가 없거나 순서가 뒤바뀐 신고는 제외)', compute: (f) => { const d = days(f); return stat(d.length ? d.reduce((a, b) => a + b, 0) / d.length : null, d.length); } },
  { id: 'duration_median', label: '처리기간 중앙값', unit: 'days', kind: 'stat', denominator: 'duration', description: '걸린 날수를 순서대로 놓았을 때 가운데 값', compute: (f) => { const d = days(f); return stat(median(d), d.length); } },
  { id: 'duration_p90', label: '처리기간 90% 기준', unit: 'days', kind: 'stat', denominator: 'duration', description: '신고의 90%가 이 기간 안에 답변을 받음', compute: (f) => { const d = days(f); return stat(nearestRank(d, 0.9), d.length); } },
  { id: 'duration_count', label: '처리기간 계산 가능 건수', unit: 'count', kind: 'count', denominator: null, description: '신고한 날과 답변 받은 날이 모두 있어 기간을 계산할 수 있는 답변 수', compute: (f) => count(days(f).length) },
  { id: 'rating_mean', label: '평균 별점', unit: 'score', kind: 'stat', denominator: 'rating', description: '공개에 동의한 1~5점 별점의 평균', compute: (f) => { const r = ratings(f); return stat(r.length ? r.reduce((a, b) => a + b, 0) / r.length : null, r.length); } },
  { id: 'rating_count', label: '평가 건수', unit: 'count', kind: 'count', denominator: null, description: '공개된 별점이 있는 답변 수', compute: (f) => count(ratings(f).length) },
  { id: 'vehicle_distinct', label: '차량 수', unit: 'count', kind: 'distinct', denominator: null, description: '번호로 구별할 수 있는 서로 다른 차량 수(번호 자체는 보여 주지 않음)',
    compute: (f) => count(new Set(f.map((x) => parsePlate(x.vehicle_raw)?.canonical).filter((v): v is string => !!v)).size) },
  { id: 'place_distinct', label: '주소 수', unit: 'count', kind: 'distinct', denominator: null, description: '서로 다른 신고 주소 수',
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
/**
 * The cohort of the period on the ONE date basis (single-date-v1, same rule as the dashboard): the identity
 * representative's selected date decides, the other date never filters; completed status only (an officially
 * completed report without an answer date stays in a report-date cohort). `dateOf` comes from the whole input.
 */
function population(base: readonly PrivateFact[], scope: Scope, spec: Pick<StatisticsSpec, 'date_basis' | 'place_key'>,
  dateOf: (f: PrivateFact) => string | null) {
  let missing = 0;
  const other = spec.date_basis === 'report_date' ? 'completed_date' : 'report_date';
  const out: PrivateFact[] = [];
  for (const f of base) {
    if (!isCompleted(f)) continue;
    if (spec.place_key && placeKey(f) !== spec.place_key) continue;
    const day = dateOf(f);
    if (day === null) { if (inDateRange(f[other], scope.start, scope.end)) missing++; continue; }
    if (day >= scope.start && day <= scope.end) out.push(f);
  }
  return { facts: out, noReportDate: missing };
}

const TIME_UNITS = ['year', 'quarter', 'month', 'day'] as const;
/** every calendar unit of [start, end] for a date dimension of the SELECTED basis (D17) */
function spineMembers(dimId: string, start: string, end: string): Array<{ key: string; label: string }> | null {
  const unit = TIME_UNITS.find((u) => dimId.endsWith(`_${u}`));
  if (!unit) return null;
  const dim = DIM.get(dimId)!;
  const probe = (day: string) => dim.member({ report_date: day, completed_date: day } as PrivateFact, 'completed_date')!;
  const out = new Map<string, { key: string; label: string }>();
  if (unit === 'day') {
    for (let t = Date.parse(`${start}T00:00:00Z`), last = Date.parse(`${end}T00:00:00Z`); t <= last; t += 86400000) {
      const m = probe(new Date(t).toISOString().slice(0, 10));
      out.set(m.key, m);
      if (out.size > STAT_LIMITS.cells) break;
    }
  } else {
    for (const month of monthKeys(start, end)) { const m = probe(`${month}-01`); out.set(m.key, m); }
  }
  return [...out.values()];
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
  /** data window of the selected basis: spine units outside it are no_data, never 0 */
  dataWindow?: { min: string | null; max: string | null };
}

export function sides(input: StatsInput) {
  const { facts, spec } = input;
  if (input.scope.date_basis !== undefined && input.scope.date_basis !== spec.date_basis) {
    // EX-08: one basis per request; the handler unifies scope and spec or refuses the request before this point
    throw new StatsQueryError('INVALID_QUERY', 'date basis conflict');
  }
  const scope = { ...input.scope, date_basis: spec.date_basis };
  const wantAll = spec.population !== 'mine', wantMine = spec.population !== 'all';
  if (wantMine && !input.viewerId) throw new StatsQueryError('INVALID_QUERY', 'viewer required');
  const dateOf = cohortDateOf(facts, spec.date_basis);
  const all = wantAll ? population(scopeFacts(representatives(facts), scope), scope, spec, dateOf) : null;
  const mine = wantMine
    ? population(ownRepresentatives(scopeFacts(facts, scope).filter((f) => f.contributor_id === input.viewerId)), scope, spec, dateOf) : null;
  return { all, mine, dateOf };
}

export function aggregateStatistics(input: StatsInput): StatisticsResult {
  const { spec } = input;
  const scope = { ...input.scope, date_basis: spec.date_basis };
  const { all, mine, dateOf } = sides(input);
  const basis = spec.date_basis;
  const basisPrefix = basis === 'report_date' ? 'report_' : 'completed_';
  const dateAxes: NonNullable<StatisticsResult['date_axes']> = [];
  const noData = new Set<string>();
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
    // D17: a single date axis of the SELECTED basis lists every calendar unit of the period (a gap is shown as
    // 0 / null / no_data, never skipped). A date filter on that axis keeps only the picked members (explicit).
    if (dims.length === 1 && dims[0].order === 'date') {
      const d = dims[0];
      const role = dims === rowDims ? 'row' as const : 'column' as const;
      if (!d.id.startsWith(basisPrefix)) dateAxes.push({ dimension: d.id, role, mode: 'other_date' });
      else if (spec.filters.some((f) => f.dimension === d.id)) dateAxes.push({ dimension: d.id, role, mode: 'explicit' });
      else {
        const spine = spineMembers(d.id, scope.start, scope.end);
        if (spine) {
          dateAxes.push({ dimension: d.id, role, mode: 'spine' });
          for (const m of spine) {
            const k = JSON.stringify([m.key]);
            if (!map.has(k)) map.set(k, { key: [m.key], label: [m.label], n: 0 });
            // a unit entirely outside the data window of the basis cannot be a real 0 (keys of one unit sort in time order)
            const w = input.dataWindow;
            const unitKey = (day: string) => d.member({ report_date: day, completed_date: day } as PrivateFact, basis)!.key;
            if (w && ((w.max !== null && m.key > unitKey(w.max)) || (w.min !== null && m.key < unitKey(w.min)))) noData.add(`${role}:${m.key}`);
          }
        }
      }
    }
    return [...map.values()].sort(order);
  };
  const rowMembers = spec.rows.length ? collect(rowDims) : [{ key: [], label: [], n: 0 }];
  const colMembers = spec.columns.length ? collect(colDims) : [{ key: [], label: [], n: 0 }];
  const cellsBudget = rowMembers.length * colMembers.length * (spec.population === 'compare' ? 2 : 1);
  if (cellsBudget > STAT_LIMITS.cells) {
    throw new StatsQueryError('RESULT_TOO_LARGE',
      `표가 ${cellsBudget.toLocaleString('ko-KR')}칸이 되어 한 번에 만들 수 있는 크기(${STAT_LIMITS.cells.toLocaleString('ko-KR')}칸)를 넘습니다. 비교 대상을 고르거나, 기간 또는 행·열 항목을 줄여 주세요.`);
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
    const spineRow = dateAxes.some((a) => a.role === 'row' && a.mode === 'spine');
    const spineCol = dateAxes.some((a) => a.role === 'column' && a.mode === 'spine');
    const emptyValues = (reason: 'no_data' | null) => reason === 'no_data'
      ? Object.fromEntries(spec.metrics.map((id) => [id, { value: null, numerator: null, denominator: null, reason: 'no_data' as const }])) as Record<string, StatValue>
      : compute([]);
    const gap = (rm: { key: string[] }, cm: { key: string[] }) =>
      (spineRow && noData.has(`row:${rm.key[0]}`)) || (spineCol && noData.has(`column:${cm.key[0]}`)) ? 'no_data' as const : null;
    for (const rm of rowMembers) for (const cm of colMembers) {
      const g = groups.get(`${JSON.stringify(rm.key)}\u0000${JSON.stringify(cm.key)}`);
      if (g) cells.push({ row: rm.key, col: cm.key, side, values: compute(g) });
      // a spine unit without reports: count 0 and rate null (zero denominator), or no_data outside the data window
      else if ((spineRow && rm.key.length === 1 && !byRow.has(JSON.stringify(rm.key))) || (spineCol && cm.key.length === 1 && !byCol.has(JSON.stringify(cm.key)))) {
        cells.push({ row: rm.key, col: cm.key, side, values: emptyValues(gap(rm, cm)) });
      }
    }
    if (spec.rows.length) for (const rm of rowMembers) {
      const g = byRow.get(JSON.stringify(rm.key));
      if (g) rowTotals.push({ key: rm.key, side, values: compute(g) });
      else if (spineRow) rowTotals.push({ key: rm.key, side, values: emptyValues(noData.has(`row:${rm.key[0]}`) ? 'no_data' : null) });
    }
    if (spec.columns.length) for (const cm of colMembers) {
      const g = byCol.get(JSON.stringify(cm.key));
      if (g) colTotals.push({ key: cm.key, side, values: compute(g) });
      else if (spineCol) colTotals.push({ key: cm.key, side, values: emptyValues(noData.has(`column:${cm.key[0]}`) ? 'no_data' : null) });
    }
    grand.push({ key: [], side, values: compute(facts) });
  }

  // selected filter members: their count under every OTHER condition (so a member the period excludes shows "0건")
  const filterMembers: StatisticsResult['filter_members'] = [];
  const pool = all?.facts ?? mine?.facts ?? [];
  // C05: "exists" = present in this period's PERMITTED population with the other conditions relaxed (same rule as
  // the candidate list); nothing outside the viewer's permission is ever looked at
  const relaxed = relaxScope(scope);
  const period = spec.population === 'mine'
    ? population(ownRepresentatives(scopeFacts(input.facts, relaxed).filter((f) => f.contributor_id === input.viewerId)), scope, { date_basis: basis, place_key: null }, dateOf).facts
    : population(scopeFacts(representatives(input.facts), relaxed), scope, { date_basis: basis, place_key: null }, dateOf).facts;
  for (const flt of spec.filters) {
    const d = DIM.get(flt.dimension)!;
    const others = pool.filter((f) => matches(f, spec.filters, basis, flt.dimension));
    const present = new Map<string, string>();
    for (const f of period) { const m = d.member(f, basis); if (m && !present.has(m.key)) present.set(m.key, m.label); }
    for (const key of flt.members) {
      const hit = others.filter((f) => d.member(f, basis)?.key === key);
      const status = hit.length > 0 ? 'ok' as const : present.has(key) ? 'zero' as const : 'unconfirmed' as const;
      filterMembers.push({ dimension: flt.dimension, key, label: status === 'unconfirmed' ? null : (hit[0] ? d.member(hit[0], basis)?.label ?? null : present.get(key) ?? null),
        count: hit.length, status });
    }
  }

  return {
    schema_version: 1, dataset_version: input.datasetVersion, scope, spec,
    row_members: rowMembers.map(({ key, label }) => ({ key, label })),
    col_members: colMembers.map(({ key, label }) => ({ key, label })),
    cells, row_totals: rowTotals, col_totals: colTotals, grand_totals: grand,
    population_count: { all: filtered.all?.length ?? null, mine: filtered.mine?.length ?? null },
    // D11: each side's own count — the same report can be on both sides, so the two are never added
    excluded: { no_report_date: all?.noReportDate ?? mine?.noReportDate ?? 0,
      selected_date_missing: { all: all?.noReportDate ?? null, mine: mine?.noReportDate ?? null } },
    date_axes: dateAxes,
    cohort_policy_version: COHORT_POLICY_VERSION,
    filter_members: filterMembers,
    complete: true,
  };
}

const relaxScope = (s: Scope): Scope => ({ ...s, category: 'all', region_code: null, agency_key: null, manager_key: null, bbox: null, law: null });

// ── candidates (target selector) ─────────────────────────────────────────────────────────────────────────
export const CANDIDATE_KINDS = new Set(['agency', 'manager', 'sido', 'sgg', 'law', 'place']);

/** Server search over the FULL member set of the current conditions. The dimension's own selection is ignored
 *  (facet rule), so after picking A the list still offers B. Only members with answered reports are listed. */
export function statisticsCandidates(input: { facts: readonly PrivateFact[]; scope: Scope; datasetVersion: string;
  kind: string; q: string; cursor: number; limit: number; filters: StatsFilter[]; basis: StatisticsSpec['date_basis'];
  placeKey: string | null; keys: string[] }): StatCandidatesPage {
  const d = DIM.get(input.kind);
  if (!d || !CANDIDATE_KINDS.has(input.kind)) throw new StatsQueryError('INVALID_QUERY', 'kind');
  const dateOf = cohortDateOf(input.facts, input.basis);
  const pop = population(scopeFacts(representatives(input.facts), input.scope), input.scope, { date_basis: input.basis, place_key: input.placeKey }, dateOf).facts
    .filter((f) => matches(f, input.filters, input.basis, input.kind));
  const periodKeys = new Set<string>();
  for (const f of population(scopeFacts(representatives(input.facts), relaxScope(input.scope)),
    input.scope, { date_basis: input.basis, place_key: null }, dateOf).facts) { const m = d.member(f, input.basis); if (m) periodKeys.add(m.key); }
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
    selected: input.keys.map((k) => { const c = map.get(k); return c ? { ...c, status: 'ok' as const } : { key: k, label: '', sub: null, count: 0, status: periodKeys.has(k) ? 'zero' as const : 'unconfirmed' as const }; }),
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
