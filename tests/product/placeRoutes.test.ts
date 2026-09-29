import { describe, expect, it } from 'vitest';
import { createPublicHandler, type AnalyticsRepository, type AnalyticsState } from '../../server/publicHandler';
import { placeKeyOf } from '../../server/places';
import { demoFacts } from '../../src/data/demoEngine';
import { entitiesResponseSchema, placeDetailResponseSchema, placesResponseSchema } from '../../src/data/schema';
import { fixtureAccess, viewerRequest } from './helpers/mapViewer';

/** Route contract for /places/{key}, /places?view_bbox and /entities?agency_type (R05/R07/R09). */
const state: AnalyticsState = {
  dataset_version: 'routes-v1', ready: true, source_updated_at: null, generated_at: '2026-09-27T00:00:00Z', published_at: null,
  data_min: '2024-09-25', data_max: '2026-09-24', coverage_note: 'test', dedupe_policy_version: 'test',
};
const repo: AnalyticsRepository = { getState: async () => state, getFacts: async () => demoFacts(), allowRequest: async () => true };
const handler = createPublicHandler(repo, fixtureAccess());
const q = 'start=2025-09-25&end=2026-09-24&category=all';
const get = (path: string) => handler(viewerRequest(`https://api.example.invalid/public-analytics/${path}`));
const address = '서울특별시 강남구 예시로 2길';

describe('/places/{key}', () => {
  it('returns every agency/manager of that address under the scope, never the national list', async () => {
    const key = placeKeyOf(address)!;
    const res = await get(`places/${encodeURIComponent(key)}?${q}&expected_version=routes-v1`);
    expect(res.status).toBe(200);
    const body = placeDetailResponseSchema.parse(await res.json());
    expect(body.place.key).toBe(key);
    const own = demoFacts().filter(f => f.address === address && f.is_representative !== false &&
      f.completed_date && f.completed_date >= '2025-09-25' && f.completed_date <= '2026-09-24');
    expect(body.place.completed_count).toBe(own.length);
    expect(new Set(body.agencies.map(a => a.agency_key))).toEqual(new Set(own.map(f => f.agency_key)));
    expect(body.agencies.reduce((n, a) => n + a.completed_count, 0)).toBe(own.length);
    expect(body.managers.reduce((n, m) => n + m.completed_count, 0)).toBe(own.length);
    expect(body.place.warning_count).toBe(own.filter(f => f.disposition === 'warning').length);
  });
  it('404s for an unknown place and 400s for a malformed key; 409 on a stale version', async () => {
    expect((await get(`places/${encodeURIComponent('pl1:0000000000000000')}?${q}`)).status).toBe(404);
    expect((await get(`places/not-a-key?${q}`)).status).toBe(400);
    expect((await get(`places/${encodeURIComponent(placeKeyOf(address)!)}?${q}&expected_version=old`)).status).toBe(409);
  });
});

describe('/places?view_bbox', () => {
  it('returns exact address places inside the viewport and keeps the statistics scope unchanged', async () => {
    const res = await get(`places?${q}&view_bbox=126.9,37.4,127.2,37.7`);
    expect(res.status).toBe(200);
    const body = placesResponseSchema.parse(await res.json());
    expect(body.scope.bbox).toBeNull();
    expect(body.points.every(p => p.lng >= 126.9 && p.lng <= 127.2 && p.lat >= 37.4 && p.lat <= 37.7)).toBe(true);
    expect(body.points.every(p => p.place_key && !p.aggregate)).toBe(true);
  });
  it('refuses view_bbox anywhere else, and a missing/invalid one', async () => {
    expect((await get(`dashboard?${q}&view_bbox=126.9,37.4,127.2,37.7`)).status).toBe(400);
    expect((await get(`places?${q}`)).status).toBe(400);
    expect((await get(`places?${q}&view_bbox=1,2,3`)).status).toBe(400);
  });
});

describe('/entities agency_type', () => {
  it('filters the FULL list on the server and never counts unknown as non-police', async () => {
    const all = entitiesResponseSchema.parse(await (await get(`entities?${q}&kind=agency&page_size=100`)).json());
    const police = entitiesResponseSchema.parse(await (await get(`entities?${q}&kind=agency&page_size=100&agency_type=police`)).json());
    const non = entitiesResponseSchema.parse(await (await get(`entities?${q}&kind=agency&page_size=100&agency_type=non_police`)).json());
    expect(police.items.every(r => r.agency_type === 'police' && /경찰/.test(r.agency_name))).toBe(true);
    expect(non.items.every(r => r.agency_type === 'non_police')).toBe(true);
    expect(police.total_rows + non.total_rows).toBeLessThanOrEqual(all.total_rows);
    expect(police.total_rows).toBeGreaterThan(0);
    expect((await get(`entities?${q}&kind=agency&agency_type=other`)).status).toBe(400);
    expect((await get(`dashboard?${q}&agency_type=police`)).status).toBe(400);
  });
});
