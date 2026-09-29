/**
 * my-reports-v1 — canonical TypeScript types and constants (contracts/my-reports/README.md is the prose contract,
 * my-reports-v1.schema.json the machine-readable one; tests keep the three and the fixtures in sync).
 *
 * This file has no imports on purpose: the Edge handler imports it, and the extension may copy it byte-for-byte
 * (MANIFEST.sha256). Never edit a copy — edit this file and re-run scripts/integration/sync_contract_copy.py.
 */

export const CONTRACT = 'my-reports-v1' as const;
export const TIMEZONE = 'Asia/Seoul' as const;

export const LIMITS = {
  /** request body (bytes, UTF-8) */
  body_bytes: 16 * 1024,
  /** response body (bytes, UTF-8); a larger result is an explicit RESULT_TOO_LARGE, never a truncated 200 */
  response_bytes: 256 * 1024,
  /** raw `query` before normalisation (UTF-16 units, cheap pre-check only) */
  query_raw_chars: 256,
  /** vehicle query after NFC + whitespace removal, in Unicode code points */
  vehicle_min: 6,
  vehicle_max: 64,
  /** address query after NFC + trim + whitespace collapse, in Unicode code points */
  address_min: 5,
  address_max: 200,
  cursor_chars: 1024,
  page_size_default: 20,
  page_size_max: 50,
  managers_page_size_default: 10,
  managers_page_size_max: 50,
  numbers_page_size_default: 200,
  numbers_page_size_max: 500,
  /** unique copyable numbers of one search; more is NUMBERS_LIMIT_EXCEEDED (nothing is cut silently) */
  numbers_total_max: 10000,
  /** cursor lifetime (seconds) */
  cursor_ttl_seconds: 15 * 60,
  /** recent window: Asia/Seoul today and the 2 previous days, by completed_date */
  recent_days: 3,
} as const;

export type Kind = 'vehicle' | 'address';
export type Status = 'accepted' | 'partial' | 'rejected' | 'completed_unknown';
export type Disposition = 'fine' | 'warning' | 'penalty' | 'none' | 'unknown';
export type Category = 'traffic' | 'parking' | 'other';
export type AmountKind = 'fine' | 'penalty' | 'combined' | 'unknown';
export type ContributorState = 'active' | 'none' | 'revoked';
export type SearchPart = 'reports' | 'managers';

export const STATUSES: readonly Status[] = ['accepted', 'partial', 'rejected', 'completed_unknown'];
export const DISPOSITIONS: readonly Disposition[] = ['fine', 'warning', 'penalty', 'none', 'unknown'];
export const CATEGORIES: readonly Category[] = ['traffic', 'parking', 'other'];
export const AMOUNT_KINDS: readonly AmountKind[] = ['fine', 'penalty', 'combined', 'unknown'];

export const STATUS_LABEL: Record<Status, string> = {
  accepted: '수용', partial: '일부 수용', rejected: '불수용', completed_unknown: '결과 미상',
};

/** The only official detail link form (safetyreport PC web/templates/base.html `safetyWebUrl`). */
export const OFFICIAL_DETAIL_PREFIX = 'https://www.safetyreport.go.kr/#mypage/mysafereport/' as const;
/** source_report_id accepted by the ingest contract (server/ingest/handler.ts REPORT_ID) */
export const SOURCE_REPORT_ID = /^[0-9A-Za-z_-]{1,40}$/;
export const REPORT_NUMBER = /^SPP-[0-9]{4,6}-[0-9]{6,8}$/;

// ---------------------------------------------------------------- requests (JSON body, POST only)

export interface SearchRequest {
  kind: Kind;
  query: string;
  /** default 'reports'. 'managers' pages the manager groups of the same search. */
  part?: SearchPart;
  /** null/absent = first page; otherwise the next_cursor of the same part */
  cursor?: string | null;
  /** reports page size (1..50, default 20); with a cursor: omit or send the same value */
  page_size?: number;
  /** managers page size (1..50, default 10); with a cursor: omit or send the same value */
  managers_page_size?: number;
}

export interface SummaryRequest {
  cursor?: string | null;
  /** recent page size (1..50, default 20) */
  page_size?: number;
}

export interface NumbersRequest {
  kind: Kind;
  query: string;
  cursor?: string | null;
  /** 1..500, default 200 */
  page_size?: number;
}

// ---------------------------------------------------------------- DTOs

export interface ReportRow {
  /** 실제 신고번호 (SPP-…); null when the uploads never carried it. Never replaced by source_report_id. */
  report_number: string | null;
  /** 안전신문고 내부 신고 ID (c_no); used only for official_url */
  source_report_id: string;
  /** OFFICIAL_DETAIL_PREFIX + encoded source_report_id, or null when the id does not pass SOURCE_REPORT_ID */
  official_url: string | null;
  /** the vehicle number exactly as the owner's own upload recorded it (display value, not normalised) */
  vehicle_number: string | null;
  report_date: string | null;
  completed_date: string | null;
  category: Category;
  status: Status;
  status_label: string;
  disposition: Disposition;
  amount_kind: AmountKind;
  /** confirmed amount as uploaded (won); null = not stated. 0 is a real 0. */
  confirmed_amount_won: number | null;
  penalty_points: number | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  agency_key: string | null;
  /** agency name as the answer stated it */
  agency_name_original: string | null;
  /** current name of that agency by the registry (may carry the registry's (구) marker); null = not computed */
  agency_name_current: string | null;
  manager_key: string | null;
  manager_name: string | null;
  violation_law: string | null;
  /** stored numeric rating 1..5, null = none */
  rating: number | null;
}

export interface StatusCounts { accepted: number; partial: number; rejected: number; completed_unknown: number }
export interface DispositionCounts { fine: number; warning: number; penalty: number; none: number; unknown: number }
export interface CategoryCounts { traffic: number; parking: number; other: number }

export interface FineAmount {
  /** reports with disposition 'fine' */
  fine_count: number;
  /** fines with amount_kind 'fine', status accepted/partial and a stated amount (0 included) */
  confirmed_count: number;
  /** sum of the confirmed fines; null when confirmed_count = 0 */
  confirmed_sum_won: number | null;
  /** fines without a stated amount (any amount_kind) */
  unconfirmed_count: number;
  /** fines with a stated amount that is not a confirmed fine (penalty/combined/unknown kind, or not accepted/partial);
   *  fine_count = confirmed_count + unconfirmed_count + other_count */
  other_count: number;
}

export interface Summary {
  /** unique completed reports of the whole scope (not the page) */
  total: number;
  status: StatusCounts;
  /** accepted / total × 100, rounded to 1 decimal (half away from zero); null when total = 0 */
  accept_rate: number | null;
  disposition: DispositionCounts;
  fine_amount: FineAmount;
  category: CategoryCounts;
  /** reports without completed_date (counted in total, never in a recent window) */
  completed_date_missing: number;
  /** reports without report_number (never copied by /numbers; show "번호 없는 n건 제외") */
  report_number_missing: number;
}

export interface ManagerRow {
  agency_key: string | null;
  manager_key: string;
  manager_name: string | null;
  agency_name_original: string | null;
  agency_name_current: string | null;
  total: number;
  status: StatusCounts;
  accept_rate: number | null;
  disposition: DispositionCounts;
  fine_amount: FineAmount;
}

export interface ReportPage {
  items: ReportRow[];
  /** unique completed reports of the whole scope (same as summary.total) */
  total: number;
  page_size: number;
  /** 0-based position of items[0] in the full ordering */
  offset: number;
  next_cursor: string | null;
}

export interface ManagerPage {
  items: ManagerRow[];
  /** distinct (agency_key, manager_key) groups */
  total_managers: number;
  /** reports without manager_key — never shown as one manager */
  unassigned_count: number;
  page_size: number;
  offset: number;
  next_cursor: string | null;
}

export interface Account { contributor: ContributorState }

export interface SearchResponse {
  contract: typeof CONTRACT;
  route: 'search';
  kind: Kind;
  query_normalized: string;
  data_version: string;
  queried_at: string;
  account: Account;
  /** present on the first reports page (cursor null, part 'reports'); null otherwise */
  summary: Summary | null;
  /** part 'reports': the page; part 'managers': null */
  reports: ReportPage | null;
  /** first reports page: managers page 1; part 'managers': the requested page; reports next pages: null */
  managers: ManagerPage | null;
}

export interface SummaryResponse {
  contract: typeof CONTRACT;
  route: 'summary';
  data_version: string;
  queried_at: string;
  timezone: typeof TIMEZONE;
  recent_start: string;
  recent_end: string;
  account: Account;
  /** all own completed reports; first page only (null on cursor pages) */
  summary: Summary | null;
  /** own completed reports with recent_start <= completed_date <= recent_end; first page only */
  recent_summary: Summary | null;
  recent: ReportPage;
}

export interface NumbersResponse {
  contract: typeof CONTRACT;
  route: 'numbers';
  kind: Kind;
  query_normalized: string;
  data_version: string;
  queried_at: string;
  account: Account;
  /** unique completed reports matching the search (= search summary.total) */
  matched_reports: number;
  /** of those, reports without a report_number */
  without_number: number;
  /** distinct report_number strings of the search = what a full copy contains */
  unique_numbers: number;
  items: string[];
  page_size: number;
  offset: number;
  next_cursor: string | null;
  /** true only on the page that ends the list (next_cursor null) */
  complete: boolean;
}

export type ErrorCode =
  | 'INVALID_REQUEST' | 'QUERY_LENGTH' | 'INVALID_CURSOR'
  | 'AUTH_REQUIRED' | 'SESSION_EXPIRED'
  | 'KAKAO_REQUIRED' | 'ACCOUNT_INELIGIBLE' | 'ORIGIN_FORBIDDEN'
  | 'NOT_FOUND' | 'METHOD_NOT_ALLOWED' | 'PAYLOAD_TOO_LARGE' | 'UNSUPPORTED_MEDIA_TYPE'
  | 'DATASET_CHANGED' | 'CURSOR_EXPIRED'
  | 'NUMBERS_LIMIT_EXCEEDED' | 'RESULT_TOO_LARGE'
  | 'RATE_LIMITED'
  | 'SERVICE_UNAVAILABLE' | 'QUERY_TIMEOUT';

export interface ErrorResponse {
  error: { code: ErrorCode; message: string; retryable: boolean };
  request_id: string;
}

/** HTTP status and retryable flag of every error code (README §오류). */
export const ERRORS: Record<ErrorCode, { status: number; retryable: boolean; message: string }> = {
  INVALID_REQUEST: { status: 400, retryable: false, message: '요청 형식이 올바르지 않습니다.' },
  QUERY_LENGTH: { status: 400, retryable: false, message: '검색어 길이가 조건에 맞지 않습니다.' },
  INVALID_CURSOR: { status: 400, retryable: false, message: '페이지 정보가 올바르지 않습니다. 처음부터 다시 조회해 주세요.' },
  AUTH_REQUIRED: { status: 401, retryable: false, message: '로그인이 필요합니다.' },
  SESSION_EXPIRED: { status: 401, retryable: true, message: '로그인이 만료되었습니다. 다시 로그인해 주세요.' },
  KAKAO_REQUIRED: { status: 403, retryable: false, message: '카카오 계정으로 로그인해야 합니다.' },
  ACCOUNT_INELIGIBLE: { status: 403, retryable: false, message: '이 계정으로는 내 신고를 조회할 수 없습니다.' },
  ORIGIN_FORBIDDEN: { status: 403, retryable: false, message: '허용되지 않은 요청입니다.' },
  NOT_FOUND: { status: 404, retryable: false, message: '요청을 처리할 수 없습니다.' },
  METHOD_NOT_ALLOWED: { status: 405, retryable: false, message: '요청을 처리할 수 없습니다.' },
  PAYLOAD_TOO_LARGE: { status: 413, retryable: false, message: '요청이 너무 큽니다.' },
  UNSUPPORTED_MEDIA_TYPE: { status: 415, retryable: false, message: '요청 형식이 올바르지 않습니다.' },
  DATASET_CHANGED: { status: 409, retryable: true, message: '그사이 내 신고 자료가 바뀌었습니다. 처음부터 다시 불러와 주세요.' },
  CURSOR_EXPIRED: { status: 409, retryable: true, message: '조회한 지 오래되었습니다. 처음부터 다시 불러와 주세요.' },
  NUMBERS_LIMIT_EXCEEDED: { status: 422, retryable: false, message: '한 번에 복사할 수 있는 신고번호 수를 넘었습니다.' },
  RESULT_TOO_LARGE: { status: 422, retryable: false, message: '결과가 너무 큽니다. 페이지 크기를 줄여 주세요.' },
  RATE_LIMITED: { status: 429, retryable: true, message: '잠시 후 다시 시도해 주세요.' },
  SERVICE_UNAVAILABLE: { status: 503, retryable: true, message: '잠시 후 다시 시도해 주세요.' },
  QUERY_TIMEOUT: { status: 503, retryable: true, message: '조회가 오래 걸려 중단했습니다. 잠시 후 다시 시도해 주세요.' },
};

// ---------------------------------------------------------------- normalisation (the server applies the same in SQL)

/** JS `\s` — the exact whitespace set removed/collapsed; SQL uses the same list (migration 202610020100). */
export const WHITESPACE = /[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]/gu;
// deno-lint-ignore no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/u;

export const codePoints = (s: string): number => [...s].length;

/** Vehicle: NFC, then every whitespace removed. Valid when 6..64 code points and no control character. */
export function normalizeVehicle(raw: string): string {
  return raw.normalize('NFC').replace(WHITESPACE, '');
}

/** Address: NFC, trimmed, every whitespace run → one ASCII space. */
export function normalizeAddress(raw: string): string {
  return raw.normalize('NFC').replace(WHITESPACE, ' ').replace(/ {2,}/g, ' ').trim();
}

/** Same-address key: the normalised address without ONE trailing ` (…)` reference group (도로명주소 참고항목). */
export function addressBase(normalized: string): string {
  const m = /^(.*[^ ]) \([^()]*\)$/su.exec(normalized);
  return m ? m[1] : normalized;
}

export function validQuery(kind: Kind, normalized: string): boolean {
  if (CONTROL.test(normalized)) return false;
  const n = codePoints(normalized);
  return kind === 'vehicle'
    ? n >= LIMITS.vehicle_min && n <= LIMITS.vehicle_max
    : n >= LIMITS.address_min && n <= LIMITS.address_max;
}

/** The single official-link builder: fixed origin + path, validated and encoded id, else null. */
export function officialUrl(sourceReportId: unknown): string | null {
  if (typeof sourceReportId !== 'string' || !SOURCE_REPORT_ID.test(sourceReportId)) return null;
  return OFFICIAL_DETAIL_PREFIX + encodeURIComponent(sourceReportId);
}
