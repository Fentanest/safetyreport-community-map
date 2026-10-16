// 운영 DB의 202610131000 migration 적용 여부와 관계없이 대시보드가 열려야 한다(2026-10-16 검수 결함 1·2).
// 옛 3자리 가림(1*3*4*67)은 받되 새 형식보다 더 많은 자리를 화면에 보이지 않는다.
// 형식이 맞지 않는 차량 한 행 때문에 대시보드 전체가 실패하지 않으며, 그 행의 받은 문자열은 화면 값에 남지 않는다.
import { describe, expect, it } from 'vitest';
import vectors from '../../contracts/masking-vectors.json';
import vehiclesContract from '../../contracts/public-vehicles.schema.json';
import { createPublicHandler, type AnalyticsRepository, type AnalyticsState } from '../../server/publicHandler';
import type { PrivateFact } from '../../server/aggregate';
import { parsePlate } from '../../server/plate';
import {
  dashboardResponseSchema, displayMaskedPlate, LEGACY_MASKED_PLATE_RE, MASKED_PLATE_RE, PLATE_HIDDEN_LABEL,
  vehicleListSchema, vehicleSchema, vehiclesResponseSchema,
} from '../../src/data/schema';
import { fixtureAccess, viewerRequest } from './helpers/mapViewer';

type Vector = { input: string | null; output: string; legacy_output?: string; legacy_display?: string };
const all = vectors as Vector[];
const legacyVectors = all.filter((v): v is Required<Vector> & { input: string } =>
  typeof v.input === 'string' && typeof v.legacy_output === 'string' && typeof v.legacy_display === 'string');
const row = (masked_plate: string, rank = 1) => ({ rank, rank_item_id: `r${rank}`, masked_plate, report_count: 3, percentage: 50 });

/** 202610131000 이전 `private.screen_mask_plate`·이전 Edge maskPlate: 본문의 1-기준 2·4·6번째 글자를 가렸다. */
function legacyMask(raw: string): string {
  const parsed = parsePlate(raw)!;
  const letters = Array.from(parsed.body);
  for (const i of [1, 3, 5]) letters[i] = '*';
  return parsed.region + letters.join('');
}
/** 가림 결과(지역 제외)는 정규형 본문과 같은 길이로 자리가 맞는다. 공개된 본문 위치 집합을 돌려준다. */
function revealed(masked: string, raw: string): Set<number> {
  const parsed = parsePlate(raw)!;
  expect(masked.startsWith(parsed.region)).toBe(true);
  const shown = Array.from(masked.slice(parsed.region.length));
  const body = Array.from(parsed.body);
  expect(shown.length).toBe(body.length);
  const out = new Set<number>();
  shown.forEach((ch, i) => { if (ch !== '*') { expect(ch).toBe(body[i]); out.add(i); } });
  return out;
}

describe('공개 차량 가림 옛·새 형식 호환', () => {
  it('공유 벡터에 옛 형식이 있고, 옛 형식 값은 이전 서버 가림 규칙의 실제 결과다', () => {
    expect(legacyVectors.length).toBeGreaterThanOrEqual(8);
    expect(legacyVectors.some((v) => v.legacy_output !== v.output)).toBe(true);
    for (const v of legacyVectors) expect(legacyMask(v.input), v.input).toBe(v.legacy_output);
  });

  it('새 형식은 그대로, 옛 3자리 형식은 옛·새 형식이 함께 공개하는 자리만 남겨 받는다', () => {
    for (const v of all.filter((x) => x.output !== '번호 확인 불가')) {
      expect(vehicleSchema.safeParse(row(v.output)).success, v.output).toBe(true);
      expect(displayMaskedPlate(v.output)).toBe(v.output);
    }
    for (const v of legacyVectors) {
      const display = displayMaskedPlate(v.legacy_output);
      expect(display, v.legacy_output).toBe(v.legacy_display);
      // 다시 검증해도 같은 값(멱등)
      expect(displayMaskedPlate(display!)).toBe(display);
      const shown = revealed(display!, v.input);
      const now = revealed(v.output, v.input);
      const before = revealed(v.legacy_output, v.input);
      for (const i of shown) { expect(now.has(i), `${v.input} 새 형식 밖 자리 ${i}`).toBe(true); expect(before.has(i)).toBe(true); }
      // 끝 네 자리는 두 자리 이하만 공개
      const body = parsePlate(v.input)!.body;
      expect([...shown].filter((i) => i >= body.length - 4).length).toBeLessThanOrEqual(2);
    }
    expect(displayMaskedPlate('1*3*4*67')).toBe('1*3****7');
    expect(displayMaskedPlate('경기1*3*4*67')).toBe('경기1*3****7');
  });

  it('서버 출력 계약(vehicleSchema)은 새 형식만 받아 서버 회귀를 계속 잡는다', () => {
    expect(vehicleSchema.safeParse(row('1*3*4*67')).success).toBe(false);
    expect(vehicleSchema.safeParse(row('1*3****7')).success).toBe(false);
    expect(LEGACY_MASKED_PLATE_RE.test('1*3*4*67')).toBe(true);
    expect(LEGACY_MASKED_PLATE_RE.test('1*가*4*6')).toBe(false);
    expect(MASKED_PLATE_RE.test('1*3*4*67')).toBe(false);
  });

  it('가림 형식이 아닌 행은 번호만 생략하고, 행 모양이 다르면 그 행만 뺀다', () => {
    const parsed = vehicleListSchema.parse([
      row('1*3*4*67', 1), row('서울12가3456', 2), row('경기군포다*6*1', 3),
      { ...row('1*가*4*6', 4), vehicle_canonical: '서울12가3456' }, row('1*3가*5*7', 9),
    ]);
    expect(parsed).toEqual([
      row('1*3****7', 1), row(PLATE_HIDDEN_LABEL, 2), row('경기군포다*6*1', 3),
    ]);
    expect(JSON.stringify(parsed)).not.toContain('12가3456');
    for (const bad of ['1오41357', '경기군포다26*1', '여수사*3*1', '1*3*4*6', '', '1*3*4*678']) {
      expect(vehicleListSchema.parse([row(bad)])[0].masked_plate, bad).toBe(PLATE_HIDDEN_LABEL);
    }
  });

  it('공개 계약 JSON Schema 패턴은 새 형식과 전환기 옛 형식을 받고 원번호는 거절한다', () => {
    const pattern = new RegExp(vehiclesContract.properties.items.items.properties.masked_plate.pattern, 'u');
    for (const v of all.filter((x) => x.output !== '번호 확인 불가')) expect(pattern.test(v.output), v.output).toBe(true);
    for (const v of legacyVectors) expect(pattern.test(v.legacy_output), v.legacy_output).toBe(true);
    for (const bad of ['서울12가3456', '123가4567', '경기군포다2671', '1오41357', '경기군포다26*1', '여수사*3*1', '1*3****7', '번호 확인 불가']) {
      expect(pattern.test(bad), bad).toBe(false);
    }
    // 계약 패턴 = 브라우저의 현재 형식 ∪ 옛 형식(서로 같은 집합)
    for (const s of [...all.map((v) => v.output), ...legacyVectors.map((v) => v.legacy_output), '1*3****7', '1*3*4*6', '가*2*4']) {
      expect(pattern.test(s), s).toBe(MASKED_PLATE_RE.test(s) || LEGACY_MASKED_PLATE_RE.test(s));
    }
  });
});

describe('대시보드 응답은 차량 한 행의 형식 문제로 실패하지 않는다', () => {
  const state: AnalyticsState = {
    dataset_version: 'v2-test', ready: true, source_updated_at: '2026-09-24T00:00:00Z',
    generated_at: '2026-09-24T01:00:00Z', published_at: null,
    data_min: '2026-01-01', data_max: '2026-09-24', coverage_note: 'synthetic test',
    dedupe_policy_version: 'active-snapshot-v1',
  };
  const fact = (i: number, vehicle_raw: string): PrivateFact => ({
    fact_identity: `R-${i}`, contributor_id: 'C-1', snapshot_id: 'S-1', snapshot_generation: 1,
    report_date: '2026-01-31', completed_date: '2026-02-01', category: 'traffic',
    status: 'accepted', disposition: 'fine', vehicle_raw,
    point_key: 'p1', lat: 37.566535, lng: 126.9779692, address: '서울 중구', region_code: '11',
    agency_key: 'a1', agency_name: '중구청', manager_key: 'm1', manager_name: '김하늘',
  });
  const repo: AnalyticsRepository = {
    getState: async () => state, allowRequest: async () => true,
    getFacts: async () => [fact(1, '서울123가4567'), fact(2, '서울123가4567'), fact(3, '경기군포다2671')],
  };
  const get = async (path: string) => (await createPublicHandler(repo, fixtureAccess())(
    viewerRequest(`https://example.supabase.co/functions/v1/public-analytics/${path}?start=2026-01-01&end=2026-02-28&category=all&expected_version=v2-test`))).json();

  it('현재 서버 출력은 그대로 통과한다', async () => {
    const body = await get('dashboard');
    expect(body.vehicles.map((v: { masked_plate: string }) => v.masked_plate)).toEqual(['서울1*3가*5*7', '경기군포다*6*1']);
    expect(body.vehicles.every((v: unknown) => vehicleSchema.safeParse(v).success)).toBe(true);
    expect(dashboardResponseSchema.parse(body).vehicles).toEqual(body.vehicles);
  });

  it('옛 형식·원번호·알 수 없는 키가 섞여도 대시보드 파싱은 성공하고 나머지 화면 자료는 그대로다', async () => {
    const body = await get('dashboard');
    body.vehicles = [row('서울1*3*4*67', 1), row('서울123가4567', 2), { ...row('1*가*4*6', 3), plate: '12가3456' }];
    const result = dashboardResponseSchema.safeParse(body);
    expect(result.success).toBe(true);
    expect(result.data!.vehicles).toEqual([row('서울1*3****7', 1), row(PLATE_HIDDEN_LABEL, 2)]);
    expect(result.data!.points).toEqual(body.points);
    expect(result.data!.overview).toEqual(body.overview);
    expect(JSON.stringify(result.data!.vehicles)).not.toMatch(/123가4567|12가3456/);
  });

  it('차량 TOP5 단독 응답도 같은 규칙이다', async () => {
    const body = await get('vehicles/top');
    expect(vehiclesResponseSchema.parse(body).items.map((v) => v.masked_plate)).toEqual(['서울1*3가*5*7', '경기군포다*6*1']);
    body.items = [row('1*3*4*67'), row('UNKNOWN', 2)];
    expect(vehiclesResponseSchema.parse(body).items.map((v) => v.masked_plate)).toEqual(['1*3****7', PLATE_HIDDEN_LABEL]);
  });
});
