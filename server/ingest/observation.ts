// community-ingest observation-v1: canonical JSON, value validation, status re-mapping and derived fact columns.
// Pure functions shared by the Deno Edge entry (supabase/functions/community-ingest) and Node tests.
// Rules: contracts/community-ingest/{canonical-json,observation}.md. The client hash is never trusted.

export type Status = 'accepted' | 'partial' | 'rejected' | 'completed_unknown' | 'withdrawn' | 'transferred' |
  'processing' | 'supplement' | 'other';
export const ELIGIBLE: ReadonlySet<Status> = new Set(['accepted', 'partial', 'rejected', 'completed_unknown']);

const STATUS_MAP: Record<string, Status> = {
  '수용': 'accepted', '일부수용': 'partial', '불수용': 'rejected', '답변완료': 'completed_unknown', '기타': 'completed_unknown',
  '취하': 'withdrawn', '이송': 'transferred', '보완요청': 'supplement', '처리중': 'processing',
};

export function mapStatus(statusRaw: string | null): Status {
  return (statusRaw !== null && STATUS_MAP[statusRaw]) || 'other';
}

export interface Observation {
  address: string | null; agency_name: string | null;
  amount: { confirmed_won: number | null; kind: 'fine' | 'penalty' | 'combined' | 'unknown'; penalty_points: number | null };
  category: 'traffic' | 'parking' | 'other'; completed_date: string | null;
  disposition: 'fine' | 'warning' | 'penalty' | 'none' | 'unknown';
  location: { lat: string | null; lng: string | null; source: 'geocode' | 'none' };
  manager_name: string | null; report_date: string | null; status: Status; status_raw: string | null; vehicle_raw: string | null;
}

// --- canonical JSON (keys sorted by UTF-16 code units, no whitespace, strings/ints/null/objects only) ---
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) throw new Error('canonical JSON allows safe integers only');
    return String(value);
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    const entries = Object.keys(value as Record<string, unknown>).sort()
      .map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`);
    return `{${entries.join(',')}}`;
  }
  throw new Error(`canonical JSON does not allow ${Array.isArray(value) ? 'arrays' : typeof value}`);
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// --- value rules beyond the JSON schema (observation.md §5) ---
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
export function isCalendarDay(value: string): boolean {
  const m = DAY.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

/** Shortest round-trip decimal of a double, with ".0" appended when there is no decimal point. */
export function canonicalCoordinate(value: number): string {
  const s = String(value);
  if (/[eE]/.test(s)) throw new Error('exponent form');
  return s.includes('.') ? s : `${s}.0`;
}

export type ValidationError = { code: 'schema_invalid' | 'event_type_mismatch'; reason: string };

export function validateObservationValues(p: Observation): ValidationError | null {
  const eligible = ELIGIBLE.has(p.status);
  for (const [name, day] of [['report_date', p.report_date], ['completed_date', p.completed_date]] as const) {
    if (day !== null && !isCalendarDay(day)) return { code: 'schema_invalid', reason: `${name}_not_calendar_date` };
  }
  if (!eligible && p.completed_date !== null) return { code: 'schema_invalid', reason: 'completed_date_without_final_answer' };
  const loc = p.location;
  if (loc.source === 'none') {
    if (loc.lat !== null || loc.lng !== null) return { code: 'schema_invalid', reason: 'location_none_with_coordinates' };
  } else {
    if (loc.lat === null || loc.lng === null) return { code: 'schema_invalid', reason: 'location_geocode_without_coordinates' };
    const lat = Number(loc.lat), lng = Number(loc.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { code: 'schema_invalid', reason: 'coordinate_not_number' };
    if (lat < 32 || lat > 39.5 || lng < 124 || lng > 132) return { code: 'schema_invalid', reason: 'coordinate_out_of_range' };
    if (canonicalCoordinate(lat) !== loc.lat || canonicalCoordinate(lng) !== loc.lng) {
      return { code: 'schema_invalid', reason: 'coordinate_not_canonical' };
    }
  }
  if (p.amount.kind === 'unknown' && p.amount.confirmed_won !== null) return { code: 'schema_invalid', reason: 'amount_without_kind' };
  return null;
}

export type EventType = 'completed_observation' | 'status_correction' | 'location_supplement' | 'reshare';

export function validateEventType(type: EventType, trigger: string, p: Observation): ValidationError | null {
  const eligible = ELIGIBLE.has(p.status);
  if ((type === 'completed_observation' || type === 'location_supplement' || type === 'reshare') && !eligible) {
    return { code: 'event_type_mismatch', reason: `${type}_requires_final_answer` };
  }
  if (type === 'status_correction' && eligible) return { code: 'event_type_mismatch', reason: 'correction_requires_non_final' };
  if (type === 'location_supplement' && p.location.source !== 'geocode') {
    return { code: 'event_type_mismatch', reason: 'supplement_requires_location' };
  }
  if ((type === 'reshare') !== (trigger === 'reshare')) return { code: 'event_type_mismatch', reason: 'reshare_trigger_mismatch' };
  return null;
}

// --- derived fact columns (server side, never from the client) ---
const SIDO: Record<string, string> = {
  '서울특별시': '서울', '서울시': '서울', '부산광역시': '부산', '부산시': '부산', '대구광역시': '대구', '대구시': '대구',
  '인천광역시': '인천', '인천시': '인천', '광주광역시': '광주', '광주시': '광주', '대전광역시': '대전', '대전시': '대전',
  '울산광역시': '울산', '울산시': '울산', '세종특별자치시': '세종', '세종시': '세종', '경기도': '경기', '강원도': '강원',
  '강원특별자치도': '강원', '충청북도': '충북', '충청남도': '충남', '전라북도': '전북', '전북특별자치도': '전북',
  '전라남도': '전남', '경상북도': '경북', '경상남도': '경남', '제주특별자치도': '제주', '제주도': '제주',
};

export function regionCode(address: string | null): string | null {
  if (!address) return null;
  const tokens = address.trim().split(/\s+/);
  if (tokens.length < 2) return null;
  const sido = SIDO[tokens[0]] ?? tokens[0];
  return `${sido} ${tokens[1]}`.slice(0, 24);
}

export interface DerivedFact {
  public_state: 'completed' | 'not_completed'; report_date: string | null; completed_date: string | null;
  category: string; status: Status; disposition: string; amount_kind: string; amount_confirmed_won: number | null;
  penalty_points: number | null; vehicle_raw: string | null; lat: number | null; lng: number | null;
  lat_text: string | null; lng_text: string | null; coord_source: 'geocode' | 'none'; address: string | null;
  region_code: string | null; point_key: string | null; agency_key: string | null; agency_name: string | null;
  manager_key: string | null; manager_name: string | null;
}

export async function deriveFact(p: Observation): Promise<DerivedFact> {
  const agencyKey = p.agency_name ? `a1:${(await sha256Hex(p.agency_name.normalize('NFC'))).slice(0, 24)}` : null;
  const managerKey = p.manager_name
    ? `m1:${(await sha256Hex(`${agencyKey ?? 'agency-unknown'}|${p.manager_name.normalize('NFC')}`)).slice(0, 24)}`
    : null;
  const located = p.location.source === 'geocode';
  return {
    public_state: ELIGIBLE.has(p.status) ? 'completed' : 'not_completed',
    report_date: p.report_date, completed_date: p.completed_date, category: p.category, status: p.status,
    disposition: p.disposition, amount_kind: p.amount.kind, amount_confirmed_won: p.amount.confirmed_won,
    penalty_points: p.amount.penalty_points, vehicle_raw: p.vehicle_raw,
    lat: located ? Number(p.location.lat) : null, lng: located ? Number(p.location.lng) : null,
    lat_text: located ? p.location.lat : null, lng_text: located ? p.location.lng : null,
    coord_source: p.location.source, address: p.address, region_code: regionCode(p.address),
    point_key: located ? `v1:${p.location.lat},${p.location.lng}` : null,
    agency_key: agencyKey, agency_name: p.agency_name, manager_key: managerKey, manager_name: p.manager_name,
  };
}

export async function sourceReportKey(sourceReportId: string): Promise<string> {
  return sha256Hex(`safetyreport|${sourceReportId}`);
}
