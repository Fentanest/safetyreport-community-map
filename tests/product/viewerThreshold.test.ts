import { describe, expect, it } from 'vitest';
import { MAP_VIEWER_MIN_REPORTS, mapViewerEligibility } from '../../server/viewerAuth';
import { errorResponseSchema } from '../../src/data/schema';

describe('map viewer threshold (user decision 2026-09-28)', () => {
  it('is a code constant of 10, never an environment override', () => {
    expect(MAP_VIEWER_MIN_REPORTS).toBe(10);
  });
  it('allows 10 or more, refuses 9 or fewer', () => {
    expect(mapViewerEligibility({ public_fact_count: 10 })).toEqual({ ok: true, current: 10, required: 10 });
    expect(mapViewerEligibility({ public_fact_count: 11 }).ok).toBe(true);
    expect(mapViewerEligibility({ public_fact_count: 9 })).toEqual({ ok: false, current: 9, required: 10 });
    expect(mapViewerEligibility({ public_fact_count: 0 }).ok).toBe(false);
  });
  it('fail-closes when the database has no usable count (pre-threshold SQL)', () => {
    for (const count of [undefined, null, '10', NaN, -1, Infinity, {}, []] as unknown[]) {
      const gate = mapViewerEligibility({ public_fact_count: count });
      expect(gate.ok, JSON.stringify(count)).toBe(false);
      expect(gate.required).toBe(10);
    }
    expect(mapViewerEligibility({}).current).toBeNull();
    expect(mapViewerEligibility({ public_fact_count: null }).current).toBeNull();
  });
  it('floors fractional counts without opening the gate early', () => {
    expect(mapViewerEligibility({ public_fact_count: 9.9 })).toEqual({ ok: false, current: 9, required: 10 });
  });
  it('upload_required details validate against the strict error schema', () => {
    const body = { error: { code: 'upload_required', message: 'x', details: { required: 10, current: 3 } } };
    expect(errorResponseSchema.safeParse(body).success).toBe(true);
    expect(errorResponseSchema.safeParse({ error: { code: 'upload_required', message: 'x' } }).success).toBe(true);
    expect(errorResponseSchema.safeParse(
      { error: { code: 'upload_required', message: 'x', details: { required: 10 } } }).success).toBe(false);
    expect(errorResponseSchema.safeParse(
      { error: { code: 'upload_required', message: 'x', details: { required: 10, current: -1 } } }).success).toBe(false);
  });
});
