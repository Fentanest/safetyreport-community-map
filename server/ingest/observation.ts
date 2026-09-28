// community-ingest observation-v1/v2/v3: canonical JSON, value validation, status re-mapping and derived fact columns.
// Pure functions shared by the Deno Edge entry (supabase/functions/community-ingest) and Node tests.
// Rules: contracts/community-ingest/{canonical-json,observation}.md. The client hash is never trusted.
import agencyLinks from '../../shared/agency-region-registry/data/agency_links.json' with { type: 'json' };
import agencyManifest from '../../shared/agency-region-registry/manifest.json' with { type: 'json' };
import { displayAgency, resolveAgency } from '../../shared/agency-region-registry/resolvers/resolve.ts';

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
  /** 위반법규(법 이름·조항, 1..60 code points). observation-v2 (2026-09-28); absent in v1 payloads (old apps). */
  violation_law?: string | null;
  /** 원문 기관코드(TEXT, 7자리 영숫자·선행 0 보존). observation-v3 (2026-09-28); absent in v1/v2 payloads.
   *  신규 형식도 원문 그대로 보존한다(서버는 7자리 영숫자만 기관 해석에 사용). */
  source_agency_code?: string | null;
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
  // clean() replaces C0 controls and DEL with spaces, so a real v2 client never sends them; the text is a public
  // filter value (observation.md §3, 2026-09-28)
  if (typeof p.violation_law === 'string' && /[\u0000-\u001f\u007f]/.test(p.violation_law)) {
    return { code: 'schema_invalid', reason: 'violation_law_not_clean' };
  }
  // v3: the source agency code travels verbatim (only 7 alphanumerics feed the resolver); C0 controls and DEL are rejected.
  if (typeof p.source_agency_code === 'string' && [...p.source_agency_code].some(c => { const n = c.codePointAt(0)!; return n < 32 || n === 127; })) {
    return { code: 'schema_invalid', reason: 'source_agency_code_not_clean' };
  }
  return null;
}

export type EventType = 'completed_observation' | 'status_correction' | 'location_supplement' | 'reshare';

/** 2026-09-28: only final-answer observations are accepted. A non-eligible payload — or a legacy
 *  `status_correction` event of any payload — must not fail the whole request; it is rejected per
 *  event (`non_final_not_accepted`, durable=false) so the rest of the batch still processes.
 *  `status_correction` stays a known event type only so old clients get per-event rejections. */
export const NON_FINAL_REJECTION = 'non_final_not_accepted';

export function nonFinalRejection(type: EventType, p: Observation): typeof NON_FINAL_REJECTION | null {
  if (!ELIGIBLE.has(p.status) || type === 'status_correction') return NON_FINAL_REJECTION;
  return null;
}

export function validateEventType(type: EventType, trigger: string, p: Observation): ValidationError | null {
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
  /** 현행 기관 표시명(확인된 1:1 승계만, registry as_of 기준). 미확정이면 원문 기관명과 같다. */
  agency_current_name: string | null;
  manager_key: string | null; manager_name: string | null;
  /** v2 payload value as sent; null for v1 payloads (no key) and for v2 null */
  violation_law: string | null;
  /** v3 source agency code as sent (verbatim, may be a novel format); null for v1/v2 payloads (no key) and for v3 null.
   *  Stored only — not published by the public projection (consent scope open, 2026-09-28). */
  source_agency_code: string | null;
}

export async function deriveFact(p: Observation): Promise<DerivedFact> {
  // REVIEW2 높음-3: 받은 원문 기관코드를 검증된 registry resolver 로 현행 통계에 연결한다.
  // 확인된 1:1 승계면 통계 키를 기관 ID 로 묶고(개명 전후가 한 기관으로 집계),
  // 미확정·코드 없음이면 기존 기관명 해시 키를 그대로 쓴다(기존 통계 불변).
  const links = (agencyLinks as { links: Array<Record<string, string>> }).links;
  const manifest = agencyManifest as { registry_version: string; as_of_date: string };
  const resolution = resolveAgency(p.source_agency_code ?? null, p.agency_name, manifest.as_of_date, links, manifest.registry_version);
  const agencyKey = resolution.resolution_status === 'resolved' && resolution.institution_id
    ? `inst:${resolution.institution_id}`
    : p.agency_name ? `a1:${(await sha256Hex(p.agency_name.normalize('NFC'))).slice(0, 24)}` : null;
  const agencyCurrentName = displayAgency(p.agency_name, resolution) ?? p.agency_name;
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
    agency_key: agencyKey, agency_name: p.agency_name, agency_current_name: agencyCurrentName,
    manager_key: managerKey, manager_name: p.manager_name,
    violation_law: p.violation_law ?? null, source_agency_code: p.source_agency_code ?? null,
  };
}

export async function sourceReportKey(sourceReportId: string): Promise<string> {
  return sha256Hex(`safetyreport|${sourceReportId}`);
}
