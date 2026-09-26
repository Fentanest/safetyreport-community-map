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
import { scopeSchema } from './schema';

const count = z.number().int().nonnegative();
const rate = z.number().min(0).max(100).nullable();
const pp = z.number().min(-100).max(100).nullable();
const share = z.number().min(0).max(100).nullable();

const summarySchema = z.strictObject({
  report_count: count, completed_count: count, accepted: count, partial: count, rejected: count,
  result_known: count, result_unknown: count, fine_count: count, point_count: count,
  accept_rate: rate, reject_rate: rate, fine_rate: rate,
});
const sideSchema = z.strictObject({
  report_count: count, completed_count: count, result_known: count, accepted_partial: count,
  rejected: count, fine_count: count, accept_rate: rate,
});
const entitySchema = z.strictObject({
  kind: z.enum(['agency', 'manager']), key: z.string().max(330), agency_key: z.string().max(160).nullable(),
  manager_key: z.string().max(160).nullable(), agency_name: z.string().max(200), manager_name: z.string().max(160).nullable(),
  all: sideSchema, mine: sideSchema, accept_rate_pp: pp,
});

export const personalCompareSchema = z.strictObject({
  schema_version: z.literal(2), dataset_version: z.string().min(1), scope: scopeSchema,
  viewer: z.strictObject({
    contributor: z.enum(['active', 'none', 'suspended', 'revoked']), has_public_facts: z.boolean(),
  }),
  all: summarySchema, mine: summarySchema,
  diff: z.strictObject({
    report_share: share, completed_share: share, fine_share: share, point_share: share,
    accept_rate_pp: pp, reject_rate_pp: pp, fine_rate_pp: pp, rate_reason: z.enum(['no_all', 'no_mine']).nullable(),
  }),
  regions: z.array(z.strictObject({
    region_code: z.string().max(24).nullable(), all: sideSchema, mine: sideSchema, accept_rate_pp: pp,
  })).max(300),
  agencies: z.array(entitySchema).max(50),
  managers: z.array(entitySchema).max(50),
  monthly: z.array(z.strictObject({
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    all_report_count: count.nullable(), mine_report_count: count.nullable(),
    all_completed_count: count.nullable(), mine_completed_count: count.nullable(),
    all_accept_rate: rate, mine_accept_rate: rate,
  })).max(80),
  my_points: z.array(z.strictObject({
    key: z.string().max(160), lat: z.number().min(32).max(39.5), lng: z.number().min(124).max(132),
    region_code: z.string().max(24).nullable(), mine_report_count: count, mine_completed_count: count, shared: z.boolean(),
  })).max(1000),
});

export type PersonalErrorCode =
  | 'unconfigured' | 'signed_out' | 'session_expired' | 'kakao_required' | 'account_ineligible'
  | 'DATASET_CHANGED' | 'rate_limited' | 'AGGREGATE_NOT_READY' | 'network' | 'invalid_response' | 'service_unavailable';

export class PersonalApiError extends Error {
  constructor(readonly code: PersonalErrorCode, message: string, readonly retryAfter: number | null = null) {
    super(message);
    this.name = 'PersonalApiError';
  }
}

const MESSAGE: Record<PersonalErrorCode, string> = {
  unconfigured: '이 배포에는 지도 로그인이 설정되지 않았습니다.',
  signed_out: '로그인하면 내 신고와 함께 비교할 수 있습니다.',
  session_expired: '지도 로그인이 만료되었습니다. 다시 로그인해 주세요. 앱·서버의 자동 업로드 연결에는 영향이 없습니다.',
  kakao_required: '카카오 계정으로 로그인해야 내 신고를 비교할 수 있습니다.',
  account_ineligible: '이 계정으로는 내 신고 비교를 사용할 수 없습니다.',
  DATASET_CHANGED: '공개 데이터가 방금 갱신됐습니다. 다시 조회해 주세요.',
  rate_limited: '요청이 많아 잠시 후 다시 시도해 주세요.',
  AGGREGATE_NOT_READY: '공개 집계가 아직 준비되지 않았습니다.',
  network: '네트워크 연결을 확인한 뒤 다시 시도해 주세요.',
  invalid_response: '내 신고 비교 응답을 확인할 수 없습니다.',
  service_unavailable: '내 신고 비교를 불러오지 못했습니다. 공개 통계는 계속 볼 수 있습니다.',
};

export const personalError = (code: PersonalErrorCode, retryAfter: number | null = null) =>
  new PersonalApiError(code, MESSAGE[code], retryAfter);

export function sameScope(a: Scope, b: Scope): boolean {
  return a.start === b.start && a.end === b.end && a.category === b.category &&
    a.region_code === b.region_code && a.agency_key === b.agency_key &&
    a.manager_key === b.manager_key && JSON.stringify(a.bbox) === JSON.stringify(b.bbox);
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
  const p = new URLSearchParams({ start: scope.start, end: scope.end, category: scope.category, expected_version: version });
  if (scope.region_code) p.set('region_code', scope.region_code);
  if (scope.agency_key) p.set('agency_key', scope.agency_key);
  if (scope.manager_key) p.set('manager_key', scope.manager_key);
  if (scope.bbox) p.set('bbox', scope.bbox.join(','));
  return p;
}

const CODES = new Set<PersonalErrorCode>(['session_expired', 'kakao_required', 'account_ineligible', 'DATASET_CHANGED',
  'rate_limited', 'AGGREGATE_NOT_READY']);

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
    overview.point_count.value === c.all.point_count;
}
