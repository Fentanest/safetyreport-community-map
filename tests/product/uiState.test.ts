import { describe, expect, it } from 'vitest';
import { demoDashboard } from '../../src/data/demo';
import { DEMO_SCOPE } from '../../src/domain/public';
import { fixtureFromSearch, scopeFromSearch, scopeToSearch, validateRange } from '../../src/state/filters';
import { parseScope, QueryError } from '../../server/publicHandler';

describe('public UI states', () => {
  it('keeps a supported zero-result scope distinct from unavailable data', () => {
    const empty = demoDashboard(DEMO_SCOPE, 'empty');
    expect(empty.overview.report_count.value).toBe(0);
    expect(empty.overview.accepted_including_partial.value).toBeNull();
    expect(empty.overview.accepted_including_partial.denominator).toBe(0);
    expect(empty.points).toHaveLength(0);
    expect(empty.meta.capabilities.daily_report_dates.status).toBe('supported');

    const unavailable = demoDashboard({ ...DEMO_SCOPE, region_code: '11' });
    expect(unavailable.overview.report_count.value).toBeNull();
    expect(unavailable.overview.outcomes).toBeNull();
    expect(unavailable.meta.capabilities.daily_report_dates.status).toBe('missing');
  });

  it('preserves an applied public map range through a share URL', () => {
    // The actual nationwide Kakao viewport extends east of the data coordinate envelope.
    const scope = { ...DEMO_SCOPE,
      bbox: [123.77469675047854, 33.966923702070346, 135.05661803813996, 38.29007070538058] as [number, number, number, number] };
    expect(scopeFromSearch(scopeToSearch(scope), DEMO_SCOPE)).toEqual(scope);
    expect(parseScope(new URLSearchParams(scopeToSearch(scope)), { data_min: null, data_max: null }).bbox).toEqual(scope.bbox);
    for (const bad of ['181,2,182,4', '1,2,3,91', '1,2,3,', '3,2,1,4', '0x1,2,3,4']) {
      expect(scopeFromSearch(`?bbox=${bad}`, DEMO_SCOPE).bbox).toBeNull();
      expect(() => parseScope(new URLSearchParams({ start: scope.start, end: scope.end, bbox: bad }),
        { data_min: null, data_max: null })).toThrow(QueryError);
    }
  });

  it('round-trips the observation-v5 5분류 category through a share URL, including an old category=other link', () => {
    for (const category of ['traffic', 'parking', 'safety', 'living', 'other'] as const) {
      const scope = { ...DEMO_SCOPE, category };
      expect(scopeFromSearch(scopeToSearch(scope), DEMO_SCOPE).category).toBe(category);
      expect(parseScope(new URLSearchParams(scopeToSearch(scope)), { data_min: null, data_max: null }).category).toBe(category);
    }
    // an unknown category value (never issued by this app) falls back to the current scope rather than crashing
    expect(scopeFromSearch('?category=bogus', DEMO_SCOPE).category).toBe(DEMO_SCOPE.category);
  });

  it('rejects calendar-invalid dates rather than accepting normalized dates', () => {
    expect(validateRange('2026-02-30', '2026-03-01', null, null)).not.toBeNull();
  });

  it('selects explicit error fixtures without treating unknown URLs as data', () => {
    expect(['offline', 'rate', 'stale'].map(name => fixtureFromSearch(`?fixture=${name}`))).toEqual(['offline', 'rate', 'stale']);
    expect(fixtureFromSearch('?fixture=unknown')).toBe('overview');
  });
});
