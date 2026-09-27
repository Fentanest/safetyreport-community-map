import { describe, expect, it } from 'vitest';
import { codeForLegacyKey, regionMatches, regionName, resolveRegion } from '../../server/regions';
import { parseScope, QueryError } from '../../server/publicHandler';
import { normalizeRegion, regionLabel } from '../../src/data/regions';
import { aggregateDashboard, type PrivateFact } from '../../server/aggregate';

const state = { data_min: null, data_max: null };
const scopeOf = (region: string) => parseScope(new URLSearchParams({ start: '2026-01-01', end: '2026-09-30', region_code: region }), state);

describe('official region codes (2026-07-01)', () => {
  it('resolves ingest keys by explicit table, including renamed and merged units', () => {
    expect(resolveRegion('서울 중구')).toEqual({ sgg: '11140', sido: '11' });
    expect(resolveRegion('인천 남구')).toEqual({ sgg: '28177', sido: '28' });   // 미추홀구
    expect(resolveRegion('경북 군위군')).toEqual({ sgg: '27720', sido: '27' }); // moved to 대구
    expect(resolveRegion('광주 북구')?.sido).toBe('12');                        // 전남광주통합특별시
    expect(resolveRegion('전남 순천시')?.sido).toBe('12');
    expect(resolveRegion('강원도 춘천시')).toEqual({ sgg: '51110', sido: '51' });
  });
  it('세종 is one unit whatever the second token', () => {
    expect(resolveRegion('세종 조치원읍')).toEqual({ sgg: '36110', sido: '36' });
    expect(resolveRegion('세종 한누리대로')).toEqual({ sgg: '36110', sido: '36' });
  });
  it('split districts use the report coordinates; without them they stay unknown (never distributed)', () => {
    expect(resolveRegion('인천 중구')).toBeNull();
    expect(resolveRegion('인천 서구')).toBeNull();
    // 인천 중구 old downtown (신포동) → 제물포구; 영종도 (운서동) → 영종구
    expect(resolveRegion('인천 중구', 37.4738, 126.6216)?.sgg).toBe('28125');
    expect(resolveRegion('인천 중구', 37.4926, 126.4933)?.sgg).toBe('28155');
    // 인천 서구 검단 → 검단구; 청라·가정 → 서해구
    expect(resolveRegion('인천 서구', 37.5946, 126.6632)?.sgg).toBe('28290');
    expect(resolveRegion('인천 서구', 37.5340, 126.6493)?.sgg).toBe('28275');
  });
  it('unknown keys are unknown, not guessed from a prefix', () => {
    expect(resolveRegion('서울 없는구')).toBeNull();
    expect(resolveRegion('서울')).toBeNull();
    expect(resolveRegion(null)).toBeNull();
    expect(resolveRegion('11140')).toBeNull(); // a code is not an ingest key
  });
  it('hierarchy: a 시도 includes its 시군구, a 시군구 only itself', () => {
    const ref = resolveRegion('부산 해운대구');
    expect(regionMatches(ref, '26')).toBe(true);
    expect(regionMatches(ref, '26350')).toBe(true);
    expect(regionMatches(ref, '26470')).toBe(false);
    expect(regionMatches(null, '26')).toBe(false);
    expect(regionName('26350')).toBe('부산 해운대구');
    expect(regionName('36110')).toBe('세종특별자치시');
  });
  it('the API accepts official codes and converts old display keys; anything else is 400', () => {
    expect(scopeOf('11').region_code).toBe('11');
    expect(scopeOf('11140').region_code).toBe('11140');
    expect(scopeOf('서울 중구').region_code).toBe('11140');
    expect(codeForLegacyKey('인천 남구')).toBe('28177');
    for (const bad of ['99999', '인천 중구', '서울  중구', '<script>', 'x'.repeat(50)]) {
      expect(() => scopeOf(bad)).toThrow(QueryError);
    }
  });
  it('the browser catalog agrees with the server table', () => {
    for (const key of ['서울 중구', '인천 남구', '경북 군위군', '광주 북구', '세종 조치원읍', '제주 제주시']) {
      expect(normalizeRegion(key)).toBe(codeForLegacyKey(key));
    }
    expect(normalizeRegion('인천 중구')).toBeNull();
    expect(normalizeRegion('서울')).toBe('11');
    expect(regionLabel('11140')).toBe(regionName('11140'));
    expect(regionLabel(null)).toBe('전국');
  });
});

describe('region filter over facts', () => {
  let n = 0;
  const f = (region: string | null, patch: Partial<PrivateFact> = {}): PrivateFact => ({
    fact_identity: `r${n++}`, contributor_id: 'c', snapshot_id: 's', snapshot_generation: 1, report_date: '2026-09-01',
    completed_date: '2026-09-05', category: 'parking', status: 'accepted', disposition: 'none', vehicle_raw: null,
    point_key: null, lat: null, lng: null, address: null, region_code: region, agency_key: 'a', agency_name: 'a',
    manager_key: 'm', manager_name: 'm', ...patch,
  });
  const facts = [f('서울 중구'), f('서울 강남구'), f('부산 해운대구'), f('인천 중구'), f(null), f('세종 조치원읍')];
  const opts = { datasetVersion: 'v', sourceUpdatedAt: null, generatedAt: 'x', asOf: '2026-12-31', sample: false, dataMin: null };
  const run = (region: string | null) => aggregateDashboard(facts, { start: '2026-09-01', end: '2026-09-30', category: 'all', region_code: region, agency_key: null, manager_key: null, bbox: null }, opts);

  it('nationwide keeps unknown facts in the total and in a separate row', () => {
    const d = run(null);
    expect(d.overview.report_count.value).toBe(6);
    const top = d.regions!.filter(r => r.level !== 'sgg');
    expect(top.reduce((s, r) => s + r.report_count, 0)).toBe(6);
    expect(d.regions!.find(r => r.level === 'unknown')!.report_count).toBe(2); // no key + split without coordinates
  });
  it('a 시도 filter selects its 시군구 facts; a 시군구 filter only its own', () => {
    expect(run('11').overview.report_count.value).toBe(2);
    expect(run('11140').overview.report_count.value).toBe(1);
    expect(run('36').overview.report_count.value).toBe(1);
    expect(run('28').overview.report_count.value).toBe(0); // unresolved 인천 중구 is not guessed into 인천
  });
});
