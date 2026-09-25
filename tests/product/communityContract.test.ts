// Server-side half of the three-language contract check (I05): canonical JSON, hash, value rules, status re-map
// and eligibility for every vector in contracts/community-ingest/vectors (the same files Python and Dart read).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canonicalJson, canonicalCoordinate, deriveFact, ELIGIBLE, mapStatus, sha256Hex, sourceReportKey,
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
    expect(validateEventType('completed_observation', 'realtime', notDone)?.code).toBe('event_type_mismatch');
    expect(validateEventType('status_correction', 'realtime', ok)?.code).toBe('event_type_mismatch');
    expect(validateEventType('reshare', 'manual', ok)?.code).toBe('event_type_mismatch');
    expect(validateEventType('reshare', 'reshare', ok)).toBeNull();
    expect(validateEventType('location_supplement', 'manual', { ...ok, location: { lat: null, lng: null, source: 'none' } })?.code)
      .toBe('event_type_mismatch');
  });
  it('source report key is computed server side', async () => {
    expect(await sourceReportKey('R1')).toBe(await sha256Hex('safetyreport|R1'));
  });
});
