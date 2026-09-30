/**
 * Personal comparison client. Separate from the public client on purpose:
 * - only this module sends an Authorization header, and only to `/my-analytics/compare`;
 * - responses are never written to the static snapshot, localStorage or any shared cache (cache: 'no-store');
 * - a response is accepted only for the exact scope and dataset_version the public dashboard shows.
 */
import { z } from 'zod';
import type { Scope } from '../domain/public';
import type { PersonalCompare } from '../domain/personal';
import type { MapAuth } from '../auth/mapAuth';
import { COHORT_POLICY_VERSION } from '../domain/public';
import { durationDistributionSchema, ratingDistributionSchema, scopeSchema } from './schema';
const cohortDiagnostics = z.strictObject({ date_basis: z.enum(['report_date', 'completed_date']), selected_date_missing: z.number().int().nonnegative(), other_date_missing: z.number().int().nonnegative() });

const count = z.number().int().nonnegative();
const rate = z.number().min(0).max(100).nullable();
const pp = z.number().min(-100).max(100).nullable();
const share = z.number().min(0).max(100).nullable();
const days = z.number().min(0).nullable();
const dayDiff = z.number().nullable();
const won = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const rating = z.strictObject({ count, mean: z.number().min(1).max(5).nullable() }).optional();

const summarySchema = z.strictObject({
  report_count: count, completed_count: count, accepted: count, partial: count, rejected: count,
  result_known: count, result_unknown: count, fine_count: count, point_count: count,
  accept_rate: rate, partial_rate: rate, reject_rate: rate, fine_rate: rate,
  duration: z.strictObject({ count, mean_days: days, median_days: days, p90_days: days }),
  fine_amount: z.strictObject({
    fine_count: count, confirmed_count: count, sum_won: won.nullable(), mean_won: z.number().min(0).nullable(),
    median_won: z.number().min(0).nullable(), unconfirmed_count: count, undisclosed_count: count, partial: z.boolean(),
  }),
  rating,
});
const sideSchema = z.strictObject({
  report_count: count, completed_count: count, result_known: count, accepted: count, partial: count,
  rejected: count, fine_count: count, accept_rate: rate, partial_rate: rate,
  duration_count: count, duration_median_days: days,
  fine_amount_confirmed_count: count, fine_amount_sum_won: won.nullable(),
  rating,
});
const entitySchema = z.strictObject({
  kind: z.enum(['agency', 'manager']), key: z.string().max(330), agency_key: z.string().max(160).nullable(),
  manager_key: z.string().max(160).nullable(), agency_name: z.string().max(200), manager_name: z.string().max(160).nullable(),
  all: sideSchema, mine: sideSchema, accept_rate_pp: pp, partial_rate_pp: pp, duration_median_days_diff: dayDiff,
});

export const personalCompareSchema = z.strictObject({
  schema_version: z.literal(2), dataset_version: z.string().min(1), scope: scopeSchema,
  viewer: z.strictObject({
    contributor: z.enum(['active', 'none', 'suspended', 'revoked']), has_public_facts: z.boolean(),
  }),
  all: summarySchema, mine: summarySchema,
  diff: z.strictObject({
    report_share: share, completed_share: share, fine_share: share, point_share: share,
    accept_rate_pp: pp, partial_rate_pp: pp, reject_rate_pp: pp,
    duration_median_days_diff: dayDiff, duration_mean_days_diff: dayDiff,
    fine_amount_sum_share: share, fine_amount_mean_won_diff: z.number().nullable(), fine_rate_pp: pp, rate_reason: z.enum(['no_all', 'no_mine']).nullable(),
  }),
  regions: z.array(z.strictObject({
    level: z.enum(['sido', 'sgg', 'unknown']), region_code: z.string().regex(/^\d{2}(\d{3})?$/).nullable(),
    name: z.string().max(40), sido_code: z.string().regex(/^\d{2}$/).nullable(), all: sideSchema, mine: sideSchema, accept_rate_pp: pp, partial_rate_pp: pp, duration_median_days_diff: dayDiff,
  })).max(300),
  agencies: z.array(entitySchema).max(50),
  managers: z.array(entitySchema).max(50),
  monthly: z.array(z.strictObject({
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    all_report_count: count.nullable(), mine_report_count: count.nullable(),
    all_completed_count: count.nullable(), mine_completed_count: count.nullable(),
    all_accept_rate: rate, mine_accept_rate: rate,
    all_duration_median_days: days, mine_duration_median_days: days,
    all_rating: rating, mine_rating: rating,
    mine_outcomes: z.strictObject({ accepted: count, partial: count, rejected: count, result_known: count, result_unknown: count }).nullable().optional(),
    mine_fine_count: count.nullable().optional(),
  })).max(2400), // one row per calendar month of the period (the whole history is allowed; 80 cut periods over 6.6 years)
  my_points: z.array(z.strictObject({
    key: z.string().max(160), lat: z.number().min(32).max(39.5), lng: z.number().min(124).max(132),
    region_code: z.string().regex(/^\d{5}$/).nullable(), mine_report_count: count, mine_completed_count: count, shared: z.boolean(),
  })).max(1000),
  analytics: z.strictObject({ duration: durationDistributionSchema, rating: ratingDistributionSchema }).optional(),
  // EX-09: required — an older (dual-set) server's comparison is refused, never shown under the new labels
  cohort_policy_version: z.literal(COHORT_POLICY_VERSION),
  cohort: z.strictObject({ all: cohortDiagnostics, mine: cohortDiagnostics }),
});

export type PersonalErrorCode =
  | 'unconfigured' | 'signed_out' | 'session_expired' | 'kakao_required' | 'account_ineligible'
  | 'DATASET_CHANGED' | 'rate_limited' | 'AGGREGATE_NOT_READY' | 'RESULT_TOO_LARGE' | 'network' | 'invalid_response' | 'service_unavailable';

export class PersonalApiError extends Error {
  constructor(readonly code: PersonalErrorCode, message: string, readonly retryAfter: number | null = null) {
    super(message);
    this.name = 'PersonalApiError';
  }
}

const MESSAGE: Record<PersonalErrorCode, string> = {
  unconfigured: '지금은 로그인 기능을 쓸 수 없습니다.',
  signed_out: '로그인하면 내 신고와 비교할 수 있습니다.',
  session_expired: '로그인이 만료되었습니다. 다시 로그인해 주세요.',
  kakao_required: '카카오 계정으로 로그인해야 내 신고를 볼 수 있습니다.',
  account_ineligible: '이 계정으로는 내 신고를 볼 수 없습니다.',
  DATASET_CHANGED: '그사이 새 자료가 들어왔습니다. 다시 불러와 주세요.',
  rate_limited: '요청이 많아 잠시 후 다시 시도해 주세요.',
  AGGREGATE_NOT_READY: '통계가 아직 준비되지 않았습니다.',
  RESULT_TOO_LARGE: '이 조건의 신고가 한 번에 집계할 수 있는 양을 넘었습니다. 기간이나 지역을 좁혀 주세요.',
  network: '네트워크 연결을 확인한 뒤 다시 시도해 주세요.',
  invalid_response: '내 신고를 불러오지 못했습니다. 다시 시도해 주세요.',
  service_unavailable: '내 신고를 불러오지 못했습니다.',
};

export const personalError = (code: PersonalErrorCode, retryAfter: number | null = null) =>
  new PersonalApiError(code, MESSAGE[code], retryAfter);

export function sameScope(a: Scope, b: Scope): boolean {
  return a.date_basis === b.date_basis && a.start === b.start && a.end === b.end && a.category === b.category &&
    a.region_code === b.region_code && a.agency_key === b.agency_key &&
    a.manager_key === b.manager_key && JSON.stringify(a.bbox) === JSON.stringify(b.bbox) &&
    (a.law ?? null) === (b.law ?? null);
}

/** Accepts only a response for exactly this scope and published version (same population as the public view). */
export function acceptCompare(raw: unknown, scope: Scope, version: string): PersonalCompare {
  const parsed = personalCompareSchema.safeParse(raw);
  if (!parsed.success) throw personalError('invalid_response');
  const value = parsed.data as PersonalCompare;
  if (value.dataset_version !== version) throw personalError('DATASET_CHANGED');
  if (!sameScope(value.scope, scope)) throw personalError('DATASET_CHANGED');
  return value;
}

export function compareParams(scope: Scope, version: string): URLSearchParams {
  const p = new URLSearchParams({ date_basis: scope.date_basis, start: scope.start, end: scope.end, category: scope.category, expected_version: version });
  if (scope.region_code) p.set('region_code', scope.region_code);
  if (scope.agency_key) p.set('agency_key', scope.agency_key);
  if (scope.manager_key) p.set('manager_key', scope.manager_key);
  if (scope.bbox) p.set('bbox', scope.bbox.join(','));
  if (scope.law) p.set('law', scope.law);
  return p;
}

const CODES = new Set<PersonalErrorCode>(['session_expired', 'kakao_required', 'account_ineligible', 'DATASET_CHANGED',
  'rate_limited', 'AGGREGATE_NOT_READY', 'RESULT_TOO_LARGE']);

async function fetchLive(scope: Scope, version: string, token: string, signal?: AbortSignal): Promise<Response> {
  const base = import.meta.env.VITE_PUBLIC_ANALYTICS_URL?.replace(/\/+$/, '');
  const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)?.trim();
  if (!base) throw personalError('unconfigured');
  const headers: Record<string, string> = { Accept: 'application/json', Authorization: `Bearer ${token}` };
  if (key) headers.apikey = key;
  try {
    return await fetch(`${base}/my-analytics/compare?${compareParams(scope, version)}`, {
      signal, headers, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw personalError('network');
  }
}

async function errorFrom(res: Response): Promise<PersonalApiError> {
  let code: string | null = null;
  try { code = ((await res.json()) as { error?: { code?: string } })?.error?.code ?? null; } catch { /* ignore */ }
  const retry = Number(res.headers.get('retry-after'));
  if (res.status === 429) return personalError('rate_limited', Number.isFinite(retry) && retry > 0 ? retry : 60);
  if (code && CODES.has(code as PersonalErrorCode)) return personalError(code as PersonalErrorCode);
  if (res.status === 401) return personalError('session_expired');
  if (res.status === 409) return personalError('DATASET_CHANGED');
  return personalError('service_unavailable');
}

export async function loadCompare(scope: Scope, version: string, auth: MapAuth, signal?: AbortSignal): Promise<PersonalCompare> {
  if (import.meta.env.VITE_DATA_MODE === 'demo') {
    const { demoCompare } = await import('./demoEngine');
    return acceptCompare(await demoCompare(scope, version, auth), scope, version);
  }
  const snap = auth.snapshot();
  if (snap.status === 'unconfigured') throw personalError('unconfigured');
  let token = await auth.accessToken();
  if (!token) throw personalError('signed_out');
  let res = await fetchLive(scope, version, token, signal);
  if (res.status === 401) {
    token = await auth.refreshToken();
    if (!token) throw personalError('session_expired');
    res = await fetchLive(scope, version, token, signal);
  }
  if (!res.ok) throw await errorFrom(res);
  let body: unknown;
  try { body = await res.json(); } catch { throw personalError('invalid_response'); }
  return acceptCompare(body, scope, version);
}

/**
 * Defence in depth: the `all` side of a personal response must equal the public numbers on screen
 * (same scope, population and version). Any mismatch means the two are not comparable, so the
 * personal columns are withheld instead of shown next to different public numbers.
 */
export function consistentWithPublic(c: PersonalCompare, overview: import('../domain/public').Overview): boolean {
  return overview.report_count.value === c.all.report_count &&
    overview.completed_count.value === c.all.completed_count &&
    (overview.outcomes?.result_known ?? null) === c.all.result_known &&
    overview.fine_count.value === c.all.fine_count &&
    overview.point_count.value === c.all.point_count &&
    (!overview.fine_amount || (overview.fine_amount.confirmed_count === c.all.fine_amount.confirmed_count &&
      overview.fine_amount.sum_won === c.all.fine_amount.sum_won));
}

/**
 * 맞춤 통계 with population mine/compare (S05): the same credential rules as the comparison — the viewer is the
 * verified JWT user, no user id is sent, no cookies. Errors keep their code; the page shows them in its result area.
 */
export async function readPersonalStatistics(params: URLSearchParams, signal?: AbortSignal): Promise<unknown> {
  const { PublicApiError } = await import('./client');
  const { mapAuth } = await import('../hooks/usePersonal');
  const base = import.meta.env.VITE_PUBLIC_ANALYTICS_URL?.replace(/\/+$/, '');
  if (!base) throw new PublicApiError('내 신고를 불러올 수 없습니다. 인터넷 연결을 확인해 주세요.');
  const auth = mapAuth();
  await auth.settled();
  let token = await auth.accessToken();
  if (!token) throw new PublicApiError('내 신고를 보려면 로그인이 필요합니다.', 401, null, 'auth_required');
  const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)?.trim();
  const send = (t: string) => fetch(`${base}/my-analytics/statistics?${params}`, { signal, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
    headers: { Accept: 'application/json', Authorization: `Bearer ${t}`, ...(key ? { apikey: key } : {}) } });
  let res = await send(token);
  if (res.status === 401) {
    token = await auth.refreshToken();
    if (!token) throw new PublicApiError('로그인이 만료되었습니다. 다시 로그인해 주세요.', 401, null, 'session_expired');
    res = await send(token);
  }
  if (!res.ok) {
    let code: string | null = null, message: string | null = null;
    try { const b = await res.json() as { error?: { code?: string; message?: string } }; code = b.error?.code ?? null; message = b.error?.message ?? null; } catch { /* ignore */ }
    const retry = Number(res.headers.get('retry-after'));
    throw new PublicApiError(res.status === 429 ? '요청이 많아 잠시 후 다시 시도해 주세요.' : message ?? '내 신고 통계를 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.',
      res.status, Number.isFinite(retry) && retry > 0 ? retry : null, code);
  }
  return res.json();
}
