// Server-side half of the three-language contract check (I05): canonical JSON, hash, value rules, status re-map
// and eligibility for every vector in contracts/community-ingest/vectors (the same files Python and Dart read).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canonicalJson, canonicalCoordinate, deriveFact, ELIGIBLE, mapStatus, nonFinalRejection, sha256Hex, sourceReportKey,
  validateEventType, validateObservationValues, type Observation } from '../../server/ingest/observation';

const V = new URL('../../contracts/community-ingest/vectors/', import.meta.url);
const read = (name: string) => JSON.parse(readFileSync(new URL(name, V), 'utf8'));

describe('community-ingest contract vectors', () => {
  const obs = read('observations.json');
  for (const c of obs.cases) {
    it(`observation ${c.name}`, async () => {
      const p = c.expected_payload as Observation;
      expect(canonicalJson(p)).toBe(c.canonical_json);
      expect(await sha256Hex(c.canonical_json)).toBe(c.payload_sha256);
      expect(validateObservationValues(p)).toBeNull();
      expect(mapStatus(p.status_raw)).toBe(p.status);
      expect(ELIGIBLE.has(p.status)).toBe(c.eligible);
      const d = await deriveFact(p);
      expect(d.public_state).toBe(c.eligible ? 'completed' : 'not_completed');
      if (p.location.source === 'geocode') expect(d.point_key).toBe(`v1:${p.location.lat},${p.location.lng}`);
      else expect([d.lat, d.lng, d.point_key]).toEqual([null, null, null]);
    });
  }
  for (const c of read('canonical-json.json').cases) {
    it(`canonical ${c.name}`, async () => {
      expect(canonicalJson(c.value)).toBe(c.canonical_json);
      expect(await sha256Hex(c.canonical_json)).toBe(c.sha256);
    });
  }
});

describe('server value rules beyond the schema', () => {
  const ok = read('observations.json').cases[0].expected_payload as Observation;
  const bad = (patch: Partial<Observation>) => validateObservationValues({ ...ok, ...patch } as Observation)?.reason;
  it('rejects impossible dates, answer dates on unfinished reports and non-canonical coordinates', () => {
    expect(bad({ report_date: '2026-02-30' })).toBe('report_date_not_calendar_date');
    expect(bad({ status: 'processing', status_raw: '처리중' })).toBe('completed_date_without_final_answer');
    expect(bad({ location: { lat: '37.000', lng: '126.9779451', source: 'geocode' } })).toBe('coordinate_not_canonical');
    expect(bad({ location: { lat: '40.1', lng: '127.0', source: 'geocode' } })).toBe('coordinate_out_of_range');
    expect(bad({ location: { lat: '37.5', lng: null, source: 'geocode' } })).toBe('location_geocode_without_coordinates');
    expect(bad({ location: { lat: '37.5', lng: '127.0', source: 'none' } })).toBe('location_none_with_coordinates');
    expect(bad({ amount: { kind: 'unknown', confirmed_won: 10, penalty_points: null } })).toBe('amount_without_kind');
  });
  it('shortest round-trip coordinates', () => {
    expect(canonicalCoordinate(37)).toBe('37.0');
    expect(canonicalCoordinate(127.02861010903201)).toBe('127.02861010903202');
  });
  it('event types must match eligibility and the reshare trigger', () => {
    const notDone = { ...ok, status: 'withdrawn', status_raw: '취하', completed_date: null } as Observation;
    // 2026-09-28: non-final payloads and legacy status_correction are per-event rejections, not 422.
    expect(nonFinalRejection('completed_observation', notDone)).toBe('non_final_not_accepted');
    expect(nonFinalRejection('status_correction', notDone)).toBe('non_final_not_accepted');
    expect(nonFinalRejection('status_correction', ok)).toBe('non_final_not_accepted');
    expect(nonFinalRejection('completed_observation', ok)).toBeNull();
    expect(nonFinalRejection('reshare', ok)).toBeNull();
    expect(validateEventType('completed_observation', 'realtime', notDone)).toBeNull();
    expect(validateEventType('reshare', 'manual', ok)?.code).toBe('event_type_mismatch');
    expect(validateEventType('reshare', 'reshare', ok)).toBeNull();
    expect(validateEventType('location_supplement', 'manual', { ...ok, location: { lat: null, lng: null, source: 'none' } })?.code)
      .toBe('event_type_mismatch');
  });
  it('source report key is computed server side', async () => {
    expect(await sourceReportKey('R1')).toBe(await sha256Hex('safetyreport|R1'));
  });
});

describe('verified succession resolves from either code (REVIEW3 높음-2)', () => {
  const ok = read('observations.json').cases[0].expected_payload as Observation;
  it('pre- and post-change codes share one institution key in any arrival order', async () => {
    const before = await deriveFact({ ...ok, source_agency_code: '1812314', agency_name: '광주광역시경찰청' });
    const after = await deriveFact({ ...ok, source_agency_code: '1815198', agency_name: '광주경찰청' });
    expect(before.agency_key).toBe('inst:ag-gwangju-police-hq');
    expect(after.agency_key).toBe('inst:ag-gwangju-police-hq');
    expect(before.agency_current_name).toBe('광주경찰청 광주동부경찰서');
    expect(after.agency_current_name).toBe('광주경찰청 광주동부경찰서');
    // 원문 기관명은 그대로 보존된다.
    expect(before.agency_name).toBe('광주광역시경찰청');
    expect(after.agency_name).toBe('광주경찰청');
    expect(after.source_agency_code).toBe('1815198');
  });
  it('an unknown code keeps the name-hash key (existing stats unchanged)', async () => {
    const d = await deriveFact({ ...ok, source_agency_code: '9999999', agency_name: '어딘가구청' });
    expect(d.agency_key).toBe(`a1:${(await sha256Hex('어딘가구청')).slice(0, 24)}`);
    expect(d.agency_current_name).toBe('어딘가구청');
  });
});

describe('REVIEW4 migration invariants (1600)', () => {
  const sql = readFileSync(new URL('../../supabase/migrations/202609281600_answer_recency.sql', import.meta.url), 'utf8');
  it('backfills existing rows unconditionally so migration time never becomes the answer time', () => {
    // 버그: WHERE(answer_accepted_at IS NOT DISTINCT FROM first_accepted_at)는
    // ADD COLUMN DEFAULT now() 뒤라 일반 기존 행에 한 번도 맞지 않아 전 행이
    // migration 시각을 답변 수신 시각으로 가졌다. 무조건 백필이어야 한다.
    expect(sql).toContain('update private.community_report_facts set answer_accepted_at = first_accepted_at;');
    expect(sql).not.toContain('where answer_accepted_at is not distinct from first_accepted_at');
  });
  it('records the answer time with clock_timestamp so lock order equals time order', () => {
    // now()는 트랜잭션 시작 시각이라 먼저 시작하고 잠금을 늦게 얻은 제출이 더
    // 이른 시각을 가져 순서가 뒤집힌다. 수신 시각 기록은 clock_timestamp()여야 한다.
    const answerWrites = [...sql.matchAll(/answer_accepted_at\s*=\s*case[\s\S]*?else\s+(clock_timestamp\(\)|now\(\))/g)]
      .map(m => m[1]);
    expect(answerWrites.length).toBeGreaterThanOrEqual(1);
    expect(answerWrites.every(w => w === 'clock_timestamp()')).toBe(true);
    expect(sql).toContain('clock_timestamp()');
  });
  it('keeps the stored institution key on a same-name keyless update', () => {
    // 코드 없는 구버전 갱신(같은 기관명)이 derived 기관명 해시(a1:)로 덮으면
    // 승계 기관의 inst: 통계가 갈라진다. 저장 키·현행명 보존 분기가 있어야 한다.
    expect(sql).toContain('then v_fact.agency_key');
    expect(sql).toContain('then v_fact.agency_current_name');
    expect(sql).toContain("when d->>'manager_name' is not distinct from v_fact.manager_name");
  });
});
