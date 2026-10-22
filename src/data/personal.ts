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
import { fineEstimateSchema, durationDistributionSchema, ratingDistributionSchema, scopeSchema } from './schema';
import { parseRetryAfterHeader, sharedRetryCooldown } from './retryCooldown';
const cohortDiagnostics = z.strictObject({ date_basis: z.enum(['report_date', 'completed_date']), selected_date_missing: z.number().int().nonnegative(), other_date_missing: z.number().int().nonnegative() });

const count = z.number().int().nonnegative();
const rate = z.number().min(0).max(100).nullable();
const pp = z.number().min(-100).max(100).nullable();
// Independent snapshot denominators may temporarily make a share exceed 100%.
const share = z.number().nonnegative().nullable();
const days = z.number().min(0).nullable();
const dayDiff = z.number().nullable();
const won = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const rating = z.strictObject({ count, mean: z.number().min(1).max(5).nullable() }).optional();

const summarySchema = z.strictObject({
  fine_estimate: fineEstimateSchema.optional(),
  report_count: count, completed_count: count, accepted: count, partial: count, rejected: count,
  result_known: count, result_unknown: count, fine_count: count,
  // 구버전 Edge 응답(필드 없음)은 undefined로 남는다 — 화면은 '내' 값 줄을 생략한다(never 0).
  warning_count: count.optional(), point_count: count,
  accept_rate: rate, partial_rate: rate, reject_rate: rate, fine_rate: rate,
  // U-mean-primary (2026-10-12): mean_days는 선택 필드 — 구버전 응답(필드 없음)에서는 KpiPanel이 중앙값을 큰 값으로 쓰는
  // 예전 표기로 되돌린다(화면이 깨지지 않게).
  duration: z.strictObject({ count, mean_days: days.optional(), median_days: days, p90_days: days }),
  fine_amount: z.strictObject({
    fine_count: count, confirmed_count: count, sum_won: won.nullable(), mean_won: z.number().min(0).nullable(),
    median_won: z.number().min(0).nullable(), unconfirmed_count: count, undisclosed_count: count, partial: z.boolean(),
  }),
  rating,
});
const sideSchema = z.strictObject({
  report_count: count, completed_count: count, result_known: count, accepted: count, partial: count,
  rejected: count, fine_count: count, warning_count: count.optional(), accept_rate: rate, partial_rate: rate,
  duration_count: count, duration_median_days: days, duration_mean_days: days.optional(),
  fine_amount_confirmed_count: count, fine_amount_sum_won: won.nullable(),
  rating,
});
const entitySchema = z.strictObject({
  kind: z.enum(['agency', 'manager']), key: z.string().max(330), agency_key: z.string().max(160).nullable(),
  manager_key: z.string().max(160).nullable(), agency_name: z.string().max(200), manager_name: z.string().max(160).nullable(),
  all: sideSchema, mine: sideSchema, accept_rate_pp: pp, partial_rate_pp: pp, duration_median_days_diff: dayDiff,
});

export const personalCompareSchema = z.strictObject({
  snapshots: z.strictObject({ public_at: z.iso.datetime({ offset: true }), personal_at: z.iso.datetime({ offset: true }), comparable: z.boolean() }).optional(),
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
  // all of the viewer's rows (server/compare.ts MAX_COMPARE_*); the comparison table shows the first 50
  agencies: z.array(entitySchema).max(1000),
  managers: z.array(entitySchema).max(2000),
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
    region_code: z.string().regex(/^\d{5}$/).nullable(), mine_report_count: count, mine_completed_count: count, shared: z.boolean().nullable(),
  })).max(5000),
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
  // 10만 건 제한 제거(2026-10-14) 뒤에는 이전 제한이 남은 서버에서만 나온다 — 서버 personalHandler·screenHandler 문구와 같다.
  RESULT_TOO_LARGE: '통계 서버에 이전 조회 제한이 남아 있습니다. 서버 업데이트가 필요합니다.',
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
    // A genuine network failure (offline, DNS, CORS…), never a client-side abort: a shared-breaker event (①).
    if (!signal?.aborted) sharedRetryCooldown.recordFailure({ status: null });
    if (signal?.aborted) throw e;
    throw personalError('network');
  }
}

async function errorFrom(res: Response): Promise<PersonalApiError> {
  let code: string | null = null;
  try { code = ((await res.json()) as { error?: { code?: string } })?.error?.code ?? null; } catch { /* ignore */ }
  const retryAfterSeconds = parseRetryAfterHeader(res.headers.get('retry-after'));
  // 429/5xx feed the shared breaker (①); any other status (401/403/409…) is the server working normally.
  sharedRetryCooldown.recordFailure({ status: res.status, retryAfterSeconds });
  if (res.status === 429) return personalError('rate_limited', retryAfterSeconds ?? 60);
  if (code && CODES.has(code as PersonalErrorCode)) return personalError(code as PersonalErrorCode);
  if (res.status === 401) return personalError('session_expired');
  if (res.status === 409) return personalError('DATASET_CHANGED');
  return personalError('service_unavailable', res.status >= 500 ? retryAfterSeconds : null);
}

export async function loadCompare(scope: Scope, version: string, auth: MapAuth, signal?: AbortSignal): Promise<PersonalCompare> {
  if (import.meta.env.VITE_DATA_MODE === 'demo') {
    const { demoCompare } = await import('./demoEngine');
    return acceptCompare(await demoCompare(scope, version, auth), scope, version);
  }
  const { screenCoordinator, readScreenPanel } = await import('./client');
  if (screenCoordinator.active()) {
    return personalCompareSchema.parse(await readScreenPanel(scope, { id: 'compare', path: 'compare', params: {} }, signal)) as PersonalCompare;
  }
  // Shared breaker (①): a recent network/429/5xx failure anywhere (dashboard, statistics…) blocks this fetcher
  // too, without even trying the network — no second, independent retry loop during the same outage.
  const blocked = sharedRetryCooldown.blockedError();
  if (blocked) throw personalError('service_unavailable', blocked.retryAfterSeconds);
  // Astra 검수 ②: captured before the first network attempt, so a concurrent fetcher's failure recorded while
  // this request is still in flight is never erased by this request's own (possibly late) success below.
  const startGen = sharedRetryCooldown.currentGeneration();
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
  sharedRetryCooldown.recordSuccess(startGen);
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
    (!overview.fine_estimate || (overview.fine_estimate.count === c.all.fine_estimate?.count &&
      overview.fine_estimate.sum_won === c.all.fine_estimate?.sum_won)) &&
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
  // Shared breaker (①): see client.ts readWithinDeadline / loadCompare above for the same rule.
  const blocked = sharedRetryCooldown.blockedError();
  if (blocked) throw new PublicApiError('네트워크 장애가 있어 잠시 기다리는 중입니다. 자동으로 다시 시도합니다.',
    429, blocked.retryAfterSeconds, 'COOLDOWN');
  const startGen = sharedRetryCooldown.currentGeneration();
  const auth = mapAuth();
  await auth.settled();
  let token = await auth.accessToken();
  if (!token) throw new PublicApiError('내 신고를 보려면 로그인이 필요합니다.', 401, null, 'auth_required');
  const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)?.trim();
  const send = async (t: string): Promise<Response> => {
    try {
      return await fetch(`${base}/my-analytics/statistics?${params}`, { signal, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
        headers: { Accept: 'application/json', Authorization: `Bearer ${t}`, ...(key ? { apikey: key } : {}) } });
    } catch (e) {
      if (!signal?.aborted) sharedRetryCooldown.recordFailure({ status: null });
      throw e;
    }
  };
  let res = await send(token);
  if (res.status === 401) {
    token = await auth.refreshToken();
    if (!token) throw new PublicApiError('로그인이 만료되었습니다. 다시 로그인해 주세요.', 401, null, 'session_expired');
    res = await send(token);
  }
  if (!res.ok) {
    let code: string | null = null, message: string | null = null;
    try { const b = await res.json() as { error?: { code?: string; message?: string } }; code = b.error?.code ?? null; message = b.error?.message ?? null; } catch { /* ignore */ }
    const retryAfterSeconds = parseRetryAfterHeader(res.headers.get('retry-after'));
    sharedRetryCooldown.recordFailure({ status: res.status, retryAfterSeconds });
    throw new PublicApiError(res.status === 429 ? '요청이 많아 잠시 후 다시 시도해 주세요.' : message ?? '내 신고 통계를 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.',
      res.status, retryAfterSeconds, code);
  }
  sharedRetryCooldown.recordSuccess(startGen);
  return res.json();
}

// ---- App-update guidance (2026-10-21) -------------------------------------------------------------------------
// The map web reads its OWN endpoint `GET /my-analytics/client-status` (same map session token as compare). It never
// calls the account API (PROJECT_RULES 7). Nothing is shown unless the server sends a notice; there is no built-in
// version text or link. A failure is silent (guidance never blocks the map) and never feeds the shared breaker.
// 길이는 DB char_length / JSON Schema maxLength 처럼 코드포인트 기준(이모지 하나 = 1).
const cpString = (max: number) => z.string().refine((v) => { const n = [...v].length; return n >= 1 && n <= max; });
const nullableText = (max: number) => cpString(max).nullable();
export const clientNoticeSchema = z.strictObject({
  level: z.enum(['info', 'warning', 'required']),
  message: cpString(1000),
  min_version: z.strictObject({ pc: nullableText(40), mobile: nullableText(40) }),
  url: z.strictObject({ pc: z.string().max(2048).nullable(), mobile: z.string().max(2048).nullable() }),
  deadline: z.string().max(64).nullable(),
});
// 2026-10-22: upload pause banner (2-9) and the required-version gate (2-10). Optional so an older server answer still
// parses (no banner, no gate); the server decides `blocked`, the page only follows it.
export const uploadPauseSchema = z.strictObject({ paused: z.boolean(), message: z.string().max(1200).nullable(), resume_at: z.string().max(64).nullable() });
export const updateGateSchema = z.strictObject({
  blocked: z.boolean(),
  min_version: z.strictObject({ pc: nullableText(40), mobile: nullableText(40) }),
  url: z.strictObject({ pc: z.string().max(2048).nullable(), mobile: z.string().max(2048).nullable() }),
  message: z.string().max(1200).nullable(),
});
export const clientStatusSchema = z.strictObject({
  consent: z.enum(['active', 'outdated', 'none', 'revoked']),
  last_contract: z.string().max(64).nullable(),
  v1_connections: z.number().int().nonnegative(),
  v2_enabled: z.boolean(),
  notice: clientNoticeSchema.nullable(),
  upload_pause: uploadPauseSchema.optional(),
  update_gate: updateGateSchema.nullable().optional(),
});
export type ClientNotice = z.infer<typeof clientNoticeSchema>;
export type UploadPause = z.infer<typeof uploadPauseSchema>;
export type UpdateGate = z.infer<typeof updateGateSchema>;
export type ClientStatus = Omit<z.infer<typeof clientStatusSchema>, 'upload_pause' | 'update_gate'> & {
  upload_pause: UploadPause;
  update_gate: UpdateGate | null;
};

/** https link or null — any other scheme (javascript:, http:, data:) is never rendered. */
export function safeHttpsUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password ? u.toString() : null;
  } catch { return null; }
}

export function acceptClientStatus(raw: unknown): ClientStatus {
  const parsed = clientStatusSchema.parse(raw);
  const pause = parsed.upload_pause?.paused
    ? { paused: true, message: parsed.upload_pause.message?.trim() ? parsed.upload_pause.message : null,
        resume_at: parsed.upload_pause.resume_at && Number.isFinite(Date.parse(parsed.upload_pause.resume_at)) ? parsed.upload_pause.resume_at : null }
    : { paused: false, message: null, resume_at: null };
  const g = parsed.update_gate ?? null;
  const gate = g ? { ...g, message: g.message?.trim() ? g.message : null,
    url: { pc: safeHttpsUrl(g.url.pc), mobile: safeHttpsUrl(g.url.mobile) } } : null;
  const s: ClientStatus = { ...parsed, upload_pause: pause, update_gate: gate };
  if (!s.notice || !s.notice.message.trim()) return { ...s, notice: null };
  return { ...s, notice: { ...s.notice, url: { pc: safeHttpsUrl(s.notice.url.pc), mobile: safeHttpsUrl(s.notice.url.mobile) } } };
}

export async function loadClientStatus(signal?: AbortSignal): Promise<ClientStatus> {
  // Literal env check (not `dataMode`) so live builds drop the demo fixture entirely.
  if (import.meta.env.VITE_DATA_MODE === 'demo') {
    const { demoClientStatus } = await import('./demoClientStatus');
    return acceptClientStatus(demoClientStatus(window.location.search));
  }
  const base = import.meta.env.VITE_PUBLIC_ANALYTICS_URL?.replace(/\/+$/, '');
  if (!base) throw personalError('unconfigured');
  // A dashboard-wide outage is already being waited out: do not add requests, keep the last known guidance.
  if (sharedRetryCooldown.blockedError()) throw personalError('service_unavailable');
  const { mapAuth } = await import('../hooks/usePersonal');
  const auth = mapAuth();
  await auth.settled();
  let token = await auth.accessToken();
  if (!token) throw personalError('session_expired');
  const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)?.trim();
  const send = (t: string) => fetch(`${base}/my-analytics/client-status`, { signal, credentials: 'omit', cache: 'no-store',
    referrerPolicy: 'no-referrer', headers: { Accept: 'application/json', Authorization: `Bearer ${t}`, ...(key ? { apikey: key } : {}) } });
  let res = await send(token);
  if (res.status === 401) {
    token = await auth.refreshToken();
    if (!token) throw personalError('session_expired');
    res = await send(token);
  }
  if (!res.ok) throw personalError(res.status === 429 ? 'rate_limited' : 'service_unavailable');
  return acceptClientStatus(await res.json());
}
