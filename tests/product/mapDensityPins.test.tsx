import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ACCEPTANCE_RAMP, METRIC_NULL, acceptanceColor, clusterPoints, colorScalar, densityClusterSvg, densityDiameter,
  densityPinSvg, pinText, type KakaoPointInput,
} from '../../src/lib/kakao';
import MapPanel, { toKakaoInputs, renderModeOf, visiblePoints } from '../../src/components/MapPanel';
import { MAP_METRICS, metricDef, metricParts, metricText, resolveMapMetric, type MapMetric } from '../../src/components/mapMetrics';
import type { PublicPoint } from '../../src/domain/public';

/**
 * R1 (2026-10-13): the DEFAULT 신고 pin ('reports') is coloured by 수용률 (fixed scale) and sized/numbered by
 * 신고 건수 (밀집도), at the same time — not an opt-in extra mode.
 *
 * R1 FIX (2026-10-13, Astra P2): a first pass added a separate 'density' toggle button and left the DEFAULT
 * 'reports' pin on the old report-COUNT blue colour, which rescaled with whatever else was on screen — exactly
 * the "화면 안 최대·최솟값으로 색 기준을 바꾸지 마" violation Astra reproduced (same 5건/수용률 0% pin, #1e3a8a when
 * the on-screen max was 1000, #7ad2fc when it was 5). Fixed by folding the colour+size encoding into 'reports'
 * itself and removing the separate button (back to four: 신고 수·수용률/수용률/불수용률/과태료). These tests now
 * exercise 'reports' directly (the production id) for everything that used to go through 'density', plus a
 * dedicated regression test for the exact bug Astra reproduced and a back-compat test for a stray old 'density'
 * value (e.g. from a stored/shared link) safely resolving to 'reports'.
 */

const outcomes = (accepted: number, partial: number, rejected: number) => ({
  accepted, partial, rejected, result_known: accepted + partial + rejected, result_unknown: 0,
});

function point(key: string, lat: number, lng: number, reportCount: number, o: { accepted: number; partial: number; rejected: number } | null,
  extra: Partial<PublicPoint> = {}): PublicPoint {
  return {
    key, lat, lng, address: key, region_code: null, report_count: reportCount, completed_count: o ? o.accepted + o.partial + o.rejected : 0,
    outcomes: o ? outcomes(o.accepted, o.partial, o.rejected) : null, fine_count: 0, ...extra,
  };
}
function outcomesArg(a: number, p: number, r: number) { return { accepted: a, partial: p, rejected: r }; }

describe('R1 지도: 수용률 색 고정 매핑', () => {
  it('같은 수용률은 화면 안 최대·최솟값(maxCount)과 무관하게 같은 색', () => {
    const a = colorScalar('density', 3, 10, 1);
    const b = colorScalar('density', 3, 10, 1_000_000);
    expect(a).toBe(b);
    expect(acceptanceColor(a)).toBe(acceptanceColor(b));
  });
  it('0%→빨강, 50%→주황, 100%→초록의 고정 스톱을 그대로 쓴다', () => {
    expect(acceptanceColor(0)).toBe(ACCEPTANCE_RAMP[0]);
    expect(acceptanceColor(1)).toBe(ACCEPTANCE_RAMP[2]);
    const mid = acceptanceColor(0.5);
    expect(mid).not.toBe(ACCEPTANCE_RAMP[0]);
    expect(mid).not.toBe(ACCEPTANCE_RAMP[2]);
  });
  it('기존 과태료/신고량 블루 램프(METRIC_RAMP)와 독립 — 과태료율 계산식을 복사하지 않았다', () => {
    expect(ACCEPTANCE_RAMP[0]).not.toBe('#e0f2fe');
    expect(new Set(ACCEPTANCE_RAMP).size).toBe(ACCEPTANCE_RAMP.length);
  });
});

describe('R1 FIX 회귀: 기본 신고 핀(reports)이 더 이상 화면 최대건수로 색이 바뀌지 않는다 (Astra P2 재현)', () => {
  // Astra 재현: 동일한 5건·수용률 0% 핀이 화면 최대 건수 5→1000 에 따라 #1e3a8a→#7ad2fc 로 바뀌었다(위반).
  // 원인: 'reports' metricParts가 kind:'count'(report_count 로그스케일, METRIC_RAMP)였다. 이제 kind:'density'로
  // 바뀌어 colorScalar가 num/den(수용률)만 쓰고 maxCount를 무시하므로 같은 장소·같은 수용률은 항상 같은 색이다.
  const five = point('p5', 37.5, 127, 5, outcomesArg(0, 0, 5)); // 신고 5건, 수용률 0%(0/5)
  it('화면에 이 핀만 있을 때(최대 5)와 1000건짜리 다른 핀이 섞였을 때(최대 1000) 색이 같다', () => {
    const alone = toKakaoInputs([five], 'reports', null);
    const big = point('pbig', 37.6, 127.1, 1000, outcomesArg(500, 0, 500));
    const withBig = toKakaoInputs([five, big], 'reports', null);
    const p1 = alone.find((i) => i.key === 'p5')!;
    const p2 = withBig.find((i) => i.key === 'p5')!;
    expect(p1.kind).toBe('density'); // 더 이상 'count'가 아니다 — maxCount에 영향받지 않는 kind
    const maxAlone = Math.max(1, ...alone.map((i) => i.num));
    const maxWithBig = Math.max(1, ...withBig.map((i) => i.num));
    const colorAlone = colorScalar(p1.kind, p1.num, p1.den, maxAlone);
    const colorWithBig = colorScalar(p2.kind, p2.num, p2.den, maxWithBig);
    expect(colorAlone).toBe(colorWithBig); // 0(=0%, 빨강) — 화면 구성과 무관
    expect(acceptanceColor(colorAlone)).toBe(acceptanceColor(colorWithBig));
    expect(acceptanceColor(colorAlone)).toBe(ACCEPTANCE_RAMP[0]); // 실제 0% = 빨강
  });
  it('핀 숫자는 여전히 신고 건수(5)이고 수용률 %로 바뀌지 않는다', () => {
    const [input] = toKakaoInputs([five], 'reports', null);
    expect(pinText(input.kind, input.num, input.den, input.weight)).toBe('5');
  });
});

describe('R1 지도: 계산 불가(회색) vs 실제 0%(빨강) 구분', () => {
  it('den=0(분류된 답변 0건)은 회색이고 실제 0%는 빨강이다 — 서로 다른 색', () => {
    const none = colorScalar('density', 0, 0, 10);
    const zeroPct = colorScalar('density', 0, 5, 10);
    expect(none).toBeNull();
    expect(zeroPct).toBe(0);
    expect(acceptanceColor(none)).toBe(METRIC_NULL);
    expect(acceptanceColor(zeroPct)).not.toBe(METRIC_NULL);
    expect(acceptanceColor(zeroPct)).toBe(ACCEPTANCE_RAMP[0]);
  });
  it('계산 불가 핀도 결과 없음일 뿐 신고가 있으면 유지한다(기본 reports 가시성은 report_count 기준)', () => {
    const unknown = point('u1', 37.5, 127, 3, null); // 신고 3건, 답변 결과 아직 없음
    expect(visiblePoints([unknown], 'reports')).toHaveLength(1);
    const parts = metricParts(unknown, 'reports');
    expect(parts).toMatchObject({ kind: 'density', num: 0, den: 0, weight: 3 });
    expect(metricText(parts, 'reports')).toContain('계산 불가');
    expect(metricText(parts, 'reports')).toContain('3건');
  });
  it('완료만 있고 신고 0건인 곳은 기본 모드에서도 그리지 않는다(report_count 기준 유지)', () => {
    const completionOnly = point('c1', 37.5, 127, 0, outcomesArg(1, 0, 0));
    expect(visiblePoints([completionOnly], 'reports')).toHaveLength(0);
  });
});

describe('R1 지도: 표본 1건 표시', () => {
  it('신고 1건, 답변 1건(수용)인 곳도 핀으로 유지되고 핀 숫자는 1이다', () => {
    const one = point('one', 37.5, 127, 1, outcomesArg(1, 0, 0));
    expect(visiblePoints([one], 'reports')).toHaveLength(1);
    const [input] = toKakaoInputs([one], 'reports', null);
    expect(input.weight).toBe(1);
    expect(pinText(input.kind, input.num, input.den, input.weight)).toBe('1');
    expect(colorScalar(input.kind, input.num, input.den, 1)).toBe(1); // 1/1 = 100%
  });
});

describe('R1 지도: 묶음 Σaccepted/Σresult_known 가중(단순 평균 금지)', () => {
  it('1/1(100%)과 9/99(약 9.09%)를 묶으면 10/100 = 10%다(두 비율의 평균 50%가 아니다)', () => {
    const a = point('a', 37.5, 127, 1, outcomesArg(1, 0, 0));
    const b = point('b', 37.5001, 127.0001, 99, outcomesArg(9, 0, 90));
    const inputs = toKakaoInputs([a, b], 'reports', null);
    const groups = clusterPoints(inputs, 13);
    const cluster = groups.find((g) => g.kind === 'cluster');
    if (!cluster || cluster.kind !== 'cluster') throw new Error('expected a cluster');
    expect(cluster.num).toBe(10);
    expect(cluster.den).toBe(100);
    expect(colorScalar('density', cluster.num, cluster.den, 1)).toBeCloseTo(0.1);
    expect(colorScalar('density', cluster.num, cluster.den, 1)).not.toBeCloseTo(0.5); // never the mean of 100%/9.09%
    // the pin NUMBER is the report-count sum (1+99=100), a different number from the color's num (10)
    expect(cluster.count).toBe(100);
    expect(pinText('density', cluster.num, cluster.den, cluster.count)).toBe('100');
  });
});

describe('R1 지도: 서버 압축점의 건수·분모·point_count 보존', () => {
  it('서버가 이미 5곳을 묶은 압축점을 클라이언트가 다시 묶어도 분모/건수/곳 수를 모두 보존한다', () => {
    const compacted = point('agg', 37.5, 127, 50, outcomesArg(20, 5, 25), { aggregate: true, point_count: 5 });
    const plain = point('plain', 37.5001, 127.0001, 10, outcomesArg(4, 1, 5));
    const inputs = toKakaoInputs([compacted, plain], 'reports', null);
    expect(inputs.find((i) => i.key === 'agg')?.places).toBe(5);
    expect(inputs.find((i) => i.key === 'plain')?.places).toBe(1);
    const groups = clusterPoints(inputs, 13);
    const cluster = groups.find((g) => g.kind === 'cluster');
    if (!cluster || cluster.kind !== 'cluster') throw new Error('expected a cluster');
    // 건수(분자) 합계
    expect(cluster.num).toBe(20 + 4);
    // 분모 합계
    expect(cluster.den).toBe((20 + 5 + 25) + (4 + 1 + 5));
    // point_count 보존: 5곳(압축점) + 1곳(일반) = 6곳 — 묶인 노드 수(2)가 아니다
    expect(cluster.places).toBe(6);
    expect(cluster.places).not.toBe(cluster.members.length);
  });
});

describe('R1 지도: 크기 단계 경계값', () => {
  it('1~9/10~29/30~99/100~299/300+ → 32/38/44/50/56px 경계가 정확하다', () => {
    const cases: Array<[number, number]> = [
      [1, 32], [9, 32], [10, 38], [29, 38], [30, 44], [99, 44], [100, 50], [299, 50], [300, 56], [100000, 56],
    ];
    for (const [count, diameter] of cases) expect(densityDiameter(count)).toBe(diameter);
  });
  it('단계는 건수가 늘어날 때만 커진다(비감소)', () => {
    const sizes = [1, 9, 10, 29, 30, 99, 100, 299, 300, 500].map(densityDiameter);
    for (let i = 1; i < sizes.length; i++) expect(sizes[i]).toBeGreaterThanOrEqual(sizes[i - 1]);
  });
});

describe('R1 지도: 핀 숫자는 항상 신고 건수(수용률 %로 바꾸지 않음)', () => {
  it('pinText(density)는 num/den 비율이 아니라 weight(신고 건수)를 보여준다', () => {
    expect(pinText('density', 1, 10, 37)).toBe('37'); // 10%가 아니라 37
    expect(pinText('density', 10, 100, 100)).toBe('100'); // 10%가 아니라 100
    expect(pinText('density', 0, 0, 1)).toBe('1'); // 계산 불가라도 숫자는 신고 건수
  });
  it('densityPinSvg/densityClusterSvg 텍스트도 같은 숫자를 그린다', () => {
    const colors = { mineInk: '#00f', cyan: '#0ff', partial: '#fa0' };
    const svg = densityPinSvg(pinText('density', 1, 10, 7), false, colorScalar('density', 1, 10, 1), densityDiameter(7), colors);
    expect(svg).toContain('>7<');
    expect(svg).not.toContain('>10%<');
    const clusterSvg = densityClusterSvg(pinText('density', 10, 100, 100), false, colorScalar('density', 10, 100, 1), densityDiameter(100));
    expect(clusterSvg).toContain('>100<');
  });
  it('계산 불가(회색, 점선)와 실제 0%(빨강, 실선)는 SVG에서도 다르다', () => {
    const colors = { mineInk: '#00f', cyan: '#0ff', partial: '#fa0' };
    const grey = densityPinSvg('5', false, null, 32, colors);
    const red = densityPinSvg('5', false, 0, 32, colors);
    expect(grey).not.toBe(red);
    expect(grey).toContain('stroke-dasharray');
    expect(grey).toContain(METRIC_NULL);
    expect(red).toContain(ACCEPTANCE_RAMP[0]);
  });
});

describe('R1 FIX: 지표 버튼은 다시 네 개(신고 수·수용률/수용률/불수용률/과태료) — 별도 밀집도 버튼 없음', () => {
  it('MAP_METRICS는 정확히 네 개이고 reports 자체가 수용률 색·points 렌더 모드를 쓴다', () => {
    expect(MAP_METRICS.map((d) => d.id)).toEqual(['reports', 'acceptance', 'rejection', 'fine']);
    expect(MAP_METRICS).toHaveLength(4);
    expect(renderModeOf('reports')).toBe('points');
    expect(renderModeOf('acceptance')).toBe('regions'); // 기존 지역별 수용률 지도 유지
    expect(renderModeOf('rejection')).toBe('regions');
    expect(renderModeOf('fine')).toBe('regions');
    expect(metricDef('reports').kind).toBe('density');
  });
  it('선택·내 신고·관심 표시 입력은 기본 reports 핀에서도 그대로 전달된다', () => {
    const p = point('m1', 37.5, 127, 4, outcomesArg(2, 0, 2));
    const marks = new Map([[p.key, { mine: true, mineCount: 1, shared: true, interest: true }]]);
    const [input] = toKakaoInputs([p], 'reports', p.key, marks as never);
    expect(input.selected).toBe(true);
    expect(input.mine).toBe(true);
    expect(input.shared).toBe(true);
    expect(input.interest).toBe(true);
  });
});

describe('R1 FIX: 저장된/공유된 옛 "density" 값은 reports로 안전하게 매핑된다', () => {
  // TypeScript는 더 이상 'density'를 MapMetric으로 허용하지 않는다(의도적) — 저장된 값·공유 링크처럼
  // 타입을 우회해 들어올 수 있는 문자열을 흉내내려고 캐스팅한다.
  const legacy = 'density' as unknown as MapMetric;
  it('resolveMapMetric이 미지의/과거 값을 reports로 바꾼다', () => {
    expect(resolveMapMetric('density')).toBe('reports');
    expect(resolveMapMetric('acceptance')).toBe('acceptance'); // 알려진 값은 그대로
    expect(resolveMapMetric(undefined)).toBe('reports');
    expect(resolveMapMetric('')).toBe('reports');
    expect(resolveMapMetric('nonsense')).toBe('reports');
  });
  it('metricDef/renderModeOf/metricParts 모두 옛 density 값을 reports와 동일하게 처리한다', () => {
    expect(metricDef(legacy)).toBe(metricDef('reports'));
    expect(renderModeOf(legacy)).toBe('points');
    const row = point('leg', 37.5, 127, 5, outcomesArg(2, 0, 3));
    expect(metricParts(row, legacy)).toEqual(metricParts(row, 'reports'));
  });
});

describe('R1 지도: 범례 문구("색: 수용률 / 크기·숫자: 신고 건수")가 기본 신고 핀에 나온다', () => {
  // Legend only renders when sdkState !== 'error' (kakaoKey() truthy); renderToStaticMarkup never runs effects,
  // so stubbing the key here never touches the real SDK — it only lets the legend branch of the markup render.
  afterEach(() => { vi.unstubAllEnvs(); });
  beforeEach(() => { vi.stubEnv('VITE_KAKAO_MAP_JS_KEY', 'fixture-key'); });
  const base = {
    selectedKey: null, onSelect: () => {}, onMetric: () => {}, categoryLabel: '모든 신고',
    autoRefresh: false, onAutoRefresh: () => {},
  };
  const pts = [point('leg1', 37.5, 127, 5, outcomesArg(2, 0, 3))];

  it('기본(신고 수·수용률) 버튼과 색/크기·숫자 범례 문구가 함께 나오고, 별도 밀집도 버튼은 없다', () => {
    const html = renderToStaticMarkup(<MapPanel {...base} points={pts} metric="reports" />);
    expect(html).toContain('>신고 수·수용률</button>');
    expect(html).not.toContain('>밀집도</button>');
    expect(html).not.toContain('밀집도');
    expect(html).toContain('색: 수용률 · 크기·숫자: 신고 건수');
    expect(html).toContain('계산 불가(분류된 답변 0건)');
    expect(html).not.toContain('일부수용률'); // R1: unrelated existing metric stays untouched
  });
  it('기본 모드는 points 모드라 지역 choropleth 문구("시도별 …")를 쓰지 않는다(R7과 분리)', () => {
    const html = renderToStaticMarkup(<MapPanel {...base} points={pts} metric="reports" />);
    expect(html).not.toContain('시도별');
    expect(renderModeOf('reports')).toBe('points');
    // the data-level check (actual place is kept/visible) is covered by visiblePoints()/toKakaoInputs() above.
    expect(visiblePoints(pts, 'reports').map((p) => p.key)).toEqual(['leg1']);
  });
  it('기존 수용률(지역) 범례는 그대로 블루 톤 0%/100% 문구를 쓴다(R1이 덮어쓰지 않았다)', () => {
    const html = renderToStaticMarkup(<MapPanel {...base} points={pts} metric="acceptance" />);
    expect(html).toContain('시도별 수용률');
    expect(html).not.toContain('색: 수용률 · 크기·숫자: 신고 건수');
  });
});

// keep the KakaoPointInput import used (type-only re-export check for the test file's own typing)
const _typeCheck: KakaoPointInput['kind'] = 'density';
void _typeCheck;
