import { describe, expect, it } from 'vitest';
import { demoDashboard } from '../../src/data/demo';
import { DEMO_SCOPE } from '../../src/domain/public';
import { scopeFromSearch, scopeToSearch, validateRange } from '../../src/state/filters';

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
    const scope = { ...DEMO_SCOPE, bbox: [126.1, 36.1, 127.2, 37.2] as [number, number, number, number] };
    expect(scopeFromSearch(scopeToSearch(scope), DEMO_SCOPE)).toEqual(scope);
    expect(scopeFromSearch('?bbox=1,2,3,4', DEMO_SCOPE).bbox).toBeNull();
  });

  it('rejects calendar-invalid dates rather than accepting normalized dates', () => {
    expect(validateRange('2026-02-30', '2026-03-01', null, null)).not.toBeNull();
  });
});
