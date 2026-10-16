// 2026-10-16 검수 결함 3: 기본 '신고 수·수용률'(points) 모드에서 행정구역 바탕색은 R1 이전과 같은 신고 건수
// (화면에 그린 지역 중 최대 대비 로그 척도, 파란 METRIC_RAMP)다. 핀 색(수용률)이 바탕으로 번지지 않는다.
import { describe, expect, it } from 'vitest';
import { colorScalar, rampColor, METRIC_RAMP } from '../../src/lib/kakao';
import { regionBoundaryWeights, regionFillParts, renderModeOf } from '../../src/components/MapPanel';
import { metricParts, type MapMetric } from '../../src/components/mapMetrics';
import type { OutcomeCounts, PublicRegion } from '../../src/domain/public';

const outcomes = (accepted: number, partial: number, rejected: number): OutcomeCounts => ({
  accepted, partial, rejected, result_known: accepted + partial + rejected, result_unknown: 0,
});
const region = (code: string, report_count: number, o: OutcomeCounts, completed = o.result_known): PublicRegion => ({
  level: 'sido', region_code: code, name: `지역 ${code}`, sido_code: null, report_count, completed_count: completed,
  outcomes: o, fine_count: 0,
});

describe('points 모드 지역 바탕 = 신고 건수 로그 척도', () => {
  // A: 신고 많고 수용률 낮음, B: 신고 적고 수용률 높음, C: 신고만 있고 분류된 답변 없음
  const rows = new Map([
    ['A', region('A', 1000, outcomes(10, 0, 90))],
    ['B', region('B', 10, outcomes(10, 0, 0))],
    ['C', region('C', 100, outcomes(0, 0, 0), 0)],
  ]);
  const codes = ['A', 'B', 'C', 'D'];

  it('기본 지표와 옛 저장값(density 등)은 points 모드이고 바탕 가중치는 log1p(건수)/log1p(최대 건수)다', () => {
    for (const m of ['reports', 'density', 'unknown-legacy'] as MapMetric[]) {
      expect(renderModeOf(m)).toBe('points');
      const { weight, ramp } = regionBoundaryWeights(codes, rows, m, 60);
      expect(ramp).toBeUndefined(); // 파란 METRIC_RAMP
      expect(weight.get('A')).toBe(1);
      expect(weight.get('B')).toBeCloseTo(Math.log1p(10) / Math.log1p(1000), 12);
      expect(weight.get('C')).toBeCloseTo(Math.log1p(100) / Math.log1p(1000), 12);
      expect(weight.get('B')).toBe(colorScalar('count', 10, 0, 1000));
      expect(weight.has('D')).toBe(false); // 자료 없는 지역은 채우지 않는다
    }
  });

  it('바탕은 수용률을 따르지 않는다: 신고가 많은 곳이 더 진하고, 분류된 답변 0건도 회색이 아니라 건수 색이다', () => {
    const { weight } = regionBoundaryWeights(codes, rows, 'reports', null);
    expect(weight.get('A')!).toBeGreaterThan(weight.get('C')!);
    expect(weight.get('C')!).toBeGreaterThan(weight.get('B')!); // B 수용률 100%라도 건수가 적어 가장 연하다
    expect(weight.get('C')).not.toBeNull();
    expect(rampColor(weight.get('A')!)).toBe(METRIC_RAMP[METRIC_RAMP.length - 1]);
    expect(rampColor(weight.get('B')!)).not.toBe(rampColor(weight.get('A')!));
    // 같은 행의 핀 값(수용률 색 입력)은 그대로 density
    expect(metricParts(rows.get('B')!, 'reports')).toMatchObject({ kind: 'density', num: 10, den: 10, weight: 10 });
    expect(regionFillParts(rows.get('B')!, 'reports')).toEqual({ kind: 'count', num: 10, den: 0, weight: 10 });
  });

  it('지역 지표 모드(수용률·불수용률·과태료)의 바탕 값은 바뀌지 않는다', () => {
    for (const m of ['acceptance', 'rejection', 'fine'] as MapMetric[]) {
      for (const row of rows.values()) expect(regionFillParts(row, m)).toEqual(metricParts(row, m));
    }
    const { weight } = regionBoundaryWeights(codes, rows, 'acceptance', null);
    expect(weight.get('A')).toBe(colorScalar('rate', 10, 100, 1));
  });
});
