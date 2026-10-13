import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ACCEPTANCE_RAMP, DIVERGING_RAMP, METRIC_NULL, METRIC_RAMP, colorScalar, divergingBucket, divergingColor,
  divergingGoodness, rampColor,
} from '../../src/lib/kakao';
import MapPanel, { baselinePercent, regionBoundaryWeights, regionDeltaNote } from '../../src/components/MapPanel';
import type { MapMetric } from '../../src/components/mapMetrics';
import type { OutcomeCounts, PublicRegion } from '../../src/domain/public';

/**
 * R2 (2026-10-13, user report): 수용률/불수용률 지역(choropleth) 색이 실제 값이 55~70%처럼 좁게 몰리면 거의 같은
 * 파란색으로 보여 지역 격차를 구분할 수 없다는 신고를 받아, 두 지표의 지역 지도 색만 "현재 범위 기준값 대비 %p
 * 편차"의 고정 7구간 발산형 색으로 바꿨다. 과태료 지역 지도와 기본 신고 핀(R1)은 그대로다.
 * 이 파일은 Opus 결정의 완료 기준을 그대로 시험한다: 구간 경계값 ±3/±7/±15, 수용률/불수용률 반대 방향,
 * 기준값=Σnum/Σden(overview 재사용), 기준값 없을 때 기존 램프로 폴백, 계산 불가(den=0)는 그대로 회색,
 * 과태료·기본 핀은 전혀 바뀌지 않음.
 */

const outcomes = (accepted: number, partial: number, rejected: number): OutcomeCounts => ({
  accepted, partial, rejected, result_known: accepted + partial + rejected, result_unknown: 0,
});
function region(code: string, o: OutcomeCounts | null, fine = 0, completed?: number): PublicRegion {
  const c = completed ?? (o ? o.accepted + o.partial + o.rejected : 0);
  return { level: 'sido', region_code: code, name: `지역 ${code}`, sido_code: null, report_count: c, completed_count: c, outcomes: o ?? outcomes(0, 0, 0), fine_count: fine };
}

describe('R2 색: 구간 경계값 ±3/±7/±15 (고정 7구간)', () => {
  it('음수 쪽 경계는 더 음수인(왼쪽) 버킷에 속한다: -15→0, -7→1, -3→2', () => {
    expect(divergingBucket(-15)).toBe(0);
    expect(divergingBucket(-14.999)).toBe(1);
    expect(divergingBucket(-7)).toBe(1);
    expect(divergingBucket(-6.999)).toBe(2);
    expect(divergingBucket(-3)).toBe(2);
    expect(divergingBucket(-2.999)).toBe(3);
  });
  it('양수 쪽 경계는 더 양수인(오른쪽) 버킷에 속한다: +3→4, +7→5, +15→6', () => {
    expect(divergingBucket(2.999)).toBe(3);
    expect(divergingBucket(3)).toBe(4);
    expect(divergingBucket(6.999)).toBe(4);
    expect(divergingBucket(7)).toBe(5);
    expect(divergingBucket(14.999)).toBe(5);
    expect(divergingBucket(15)).toBe(6);
  });
  it('중립(0, ±3 이내)은 가운데 버킷(3)이고, 극단값은 양끝에 포화된다', () => {
    expect(divergingBucket(0)).toBe(3);
    expect(divergingBucket(-100)).toBe(0);
    expect(divergingBucket(100)).toBe(6);
  });
  it('버킷이 늘어날수록 DIVERGING_RAMP 색도 단조 증가(빨강→초록) 순서로 바뀐다(블렌딩 없이 정확히 7색)', () => {
    const colors = [-20, -10, -5, 0, 5, 10, 20].map((d) => divergingColor(d));
    expect(colors).toEqual([...DIVERGING_RAMP]);
    expect(new Set(colors).size).toBe(7); // 7개 모두 서로 다른 색(블렌딩으로 뭉개지지 않음)
  });
});

describe('R2 색: 수용률/불수용률은 반대 방향(의미상 좋음=초록으로 통일)', () => {
  it('같은 +10%p raw 편차라도 수용률은 좋음(양수 goodness), 불수용률은 나쁨(음수 goodness)', () => {
    expect(divergingGoodness('acceptance', 10)).toBe(10);
    expect(divergingGoodness('rejection', 10)).toBe(-10);
    expect(divergingGoodness('acceptance', -10)).toBe(-10);
    expect(divergingGoodness('rejection', -10)).toBe(10);
  });
  it('regionBoundaryWeights: 수용률 +10%p 지역은 초록 쪽(높은 버킷), 불수용률 +10%p 지역은 빨강 쪽(낮은 버킷)', () => {
    // 기준 60%: 수용 지역은 accepted 70/known 100(=70%, +10%p); 불수용 지역은 rejected 70/known 100(=70%, +10%p)
    const acc = region('A', outcomes(70, 0, 30)); // 수용률 70%
    const rej = region('A', outcomes(30, 0, 70)); // 불수용률 70%
    const rowsAcc = new Map([['A', acc]]);
    const rowsRej = new Map([['A', rej]]);
    const wAcc = regionBoundaryWeights(['A'], rowsAcc, 'acceptance', 60).weight.get('A')!;
    const wRej = regionBoundaryWeights(['A'], rowsRej, 'rejection', 60).weight.get('A')!;
    expect(wAcc).toBeGreaterThan(0.5); // 좋음 → 초록 쪽(스칼라 1에 가까움)
    expect(wRej).toBeLessThan(0.5); // 나쁨(불수용률이 기준보다 높음) → 빨강 쪽(스칼라 0에 가까움)
    // goodness +10%p는 +7~+15 버킷(인덱스 5, 청록) — 가장 진한 초록(인덱스 6, ≥+15)은 아니다
    expect(rampColor(wAcc, DIVERGING_RAMP)).toBe(DIVERGING_RAMP[5]);
    expect(rampColor(wRej, DIVERGING_RAMP)).toBe(DIVERGING_RAMP[1]); // goodness -10%p → -15~-7 버킷(인덱스 1, 주황)
  });
});

describe('R2 색: 기준값 = Σnum/Σden (overview 재사용, 새 재조회 없음)', () => {
  it('baselinePercent는 accepted/result_known, rejected/result_known을 그대로 쓴다', () => {
    const o = outcomes(61, 14, 25); // 수용 60.8%대 느낌의 분포
    expect(baselinePercent('acceptance', o)).toBeCloseTo((61 / 100) * 100, 6);
    expect(baselinePercent('rejection', o)).toBeCloseTo((25 / 100) * 100, 6);
  });
  it('수용률·불수용률이 아닌 지표(과태료 등)는 기준값을 계산하지 않는다(null)', () => {
    expect(baselinePercent('fine', outcomes(1, 0, 0))).toBeNull();
    expect(baselinePercent('reports', outcomes(1, 0, 0))).toBeNull();
  });
});

describe('R2 색: 기준값을 구할 수 없으면 기존 고정 램프로 폴백', () => {
  it('overview 전체 분류된 답변 0건 → baselinePercent는 null', () => {
    expect(baselinePercent('acceptance', outcomes(0, 0, 0))).toBeNull();
    expect(baselinePercent('acceptance', null)).toBeNull();
    expect(baselinePercent('acceptance', undefined)).toBeNull();
  });
  it('baselinePct===null이면 regionBoundaryWeights가 ramp를 안 주고(undefined) 기존 colorScalar 값 그대로 쓴다', () => {
    const row = region('A', outcomes(7, 0, 3)); // 수용률 70%
    const { weight, ramp } = regionBoundaryWeights(['A'], new Map([['A', row]]), 'acceptance', null);
    expect(ramp).toBeUndefined();
    expect(weight.get('A')).toBe(colorScalar('rate', 7, 10, 1)); // 기존 고정 0..1 스케일과 동일
  });
});

describe('R2 색: 계산 불가(den=0)는 발산형 모드에서도 그대로 회색', () => {
  it('답변은 있지만(완료 5건) 분류된 결과가 아직 없는(result_known=0) 지역은 weight=null(회색), 노드 자체는 없어지지 않는다', () => {
    const row = region('A', outcomes(0, 0, 0), 0, 5); // completed_count=5(그려짐)인데 result_known=0(계산 불가)
    const { weight, ramp } = regionBoundaryWeights(['A'], new Map([['A', row]]), 'acceptance', 60);
    expect(ramp).toBe(DIVERGING_RAMP); // 기준값은 있으니 발산형 모드 자체는 켜짐
    expect(weight.has('A')).toBe(true); // 신고가 있으니 지도에서 사라지지 않는다
    expect(weight.get('A')).toBeNull(); // 이 지역만 계산 불가 — null 유지
    expect(rampColor(weight.get('A') ?? null, ramp)).toBe(METRIC_NULL);
  });
});

describe('R2 색: 과태료 지역 지도·기본 신고 핀은 전혀 바뀌지 않는다', () => {
  it('과태료(fine) 지역은 baselinePercent가 null이라 기존 METRIC_RAMP·colorScalar 그대로다', () => {
    const row = region('A', outcomes(5, 0, 5), 4, 10); // completed 10, fine 4
    const { weight, ramp } = regionBoundaryWeights(['A'], new Map([['A', row]]), 'fine', 60 /* 무시돼야 함: fine은 애초에 null */);
    expect(ramp).toBeUndefined();
    expect(weight.get('A')).toBe(colorScalar('rate', 4, 10, 1));
    expect(rampColor(weight.get('A') ?? null)).not.toBe(undefined); // 기본 METRIC_RAMP 사용(블루 계열), 발산형 아님
    expect(METRIC_RAMP[0]).toBe('#e0f2fe'); // 블루 램프 자체가 그대로인지(상수 불변)
  });
  it('기본 신고 핀의 ACCEPTANCE_RAMP(빨강-주황-초록 3색)는 R2 DIVERGING_RAMP(7색)와 독립이다', () => {
    expect(ACCEPTANCE_RAMP).toEqual(['#dc2626', '#f59e0b', '#16a34a']);
    expect(DIVERGING_RAMP).toHaveLength(7);
    expect(ACCEPTANCE_RAMP).not.toEqual(DIVERGING_RAMP.slice(0, 3));
  });
});

describe('R2 범례: "평균 대비" + 7구간 색 칩, 기존 폴백 범례는 그대로', () => {
  // Legend only renders when sdkState !== 'error' (kakaoKey() truthy); renderToStaticMarkup never runs effects,
  // so stubbing the key here never touches the real SDK — it only lets the legend branch of the markup render
  // (same pattern as tests/product/mapDensityPins.test.tsx).
  afterEach(() => { vi.unstubAllEnvs(); });
  beforeEach(() => { vi.stubEnv('VITE_KAKAO_MAP_JS_KEY', 'fixture-key'); });
  const base = {
    selectedKey: null, onSelect: () => {}, onMetric: () => {}, categoryLabel: '모든 신고',
    autoRefresh: false, onAutoRefresh: () => {},
  };
  const pts: never[] = [];
  const sidoRegions: PublicRegion[] = [region('11', outcomes(61, 14, 25))];

  it('기준값 있음(overviewOutcomes 제공) → 발산형 범례: 평균 %, 7개 색 칩, ±%p 라벨', () => {
    const html = renderToStaticMarkup(
      <MapPanel {...base} points={pts} metric="acceptance" regions={sidoRegions} overviewOutcomes={outcomes(61, 14, 25)} />,
    );
    expect(html).toContain('평균 61.0% 대비');
    for (const color of DIVERGING_RAMP) expect(html).toContain(color);
    expect(html).toContain('-15%p 이하');
    expect(html).toContain('+15%p 이상');
    expect(html).toContain('±3%p 이내');
  });
  it('기준값 없음(overviewOutcomes 미제공) → 기존 0%/100% 고정 램프 범례 그대로(폴백)', () => {
    const html = renderToStaticMarkup(<MapPanel {...base} points={pts} metric="acceptance" regions={sidoRegions} />);
    expect(html).not.toContain('평균');
    expect(html).toContain('0%');
    expect(html).toContain('100%');
    expect(html).not.toContain(DIVERGING_RAMP[0]);
  });
  it('과태료(fine)는 overviewOutcomes를 줘도 발산형이 아니라 기존 범례 그대로다', () => {
    const html = renderToStaticMarkup(
      <MapPanel {...base} points={pts} metric="fine" regions={sidoRegions} overviewOutcomes={outcomes(61, 14, 25)} />,
    );
    expect(html).not.toContain('평균');
    expect(html).toContain('0%');
    expect(html).toContain('100%');
  });
  it('기본 신고 핀(reports) 범례는 R1 그대로("색: 수용률 · 크기·숫자: 신고 건수"), R2가 건드리지 않았다', () => {
    const html = renderToStaticMarkup(
      <MapPanel {...base} points={pts} metric="reports" regions={sidoRegions} overviewOutcomes={outcomes(61, 14, 25)} />,
    );
    expect(html).toContain('색: 수용률 · 크기·숫자: 신고 건수');
    expect(html).not.toContain('평균 61.0% 대비');
  });
});

describe('R2 지역 목록/툴팁 문구: "평균 대비 +4.2%p"', () => {
  it('regionDeltaNote: 수용률 70%, 기준 60% → "+10.0%p"(raw, 부호 그대로)', () => {
    const row = region('A', outcomes(7, 0, 3));
    expect(regionDeltaNote(row, 'acceptance', 60)).toBe(' · 평균 대비 +10.0%p');
  });
  it('regionDeltaNote: 불수용률 70%, 기준 60% → "+10.0%p"(raw 그대로, goodness로 뒤집지 않음)', () => {
    const row = region('A', outcomes(3, 0, 7));
    expect(regionDeltaNote(row, 'rejection', 60)).toBe(' · 평균 대비 +10.0%p');
  });
  it('기준값 없음/계산 불가/대상 지표 아님이면 빈 문자열', () => {
    const row = region('A', outcomes(7, 0, 3));
    expect(regionDeltaNote(row, 'acceptance', null)).toBe('');
    expect(regionDeltaNote(undefined, 'acceptance', 60)).toBe('');
    expect(regionDeltaNote(region('A', outcomes(0, 0, 0)), 'acceptance', 60)).toBe('');
    expect(regionDeltaNote(row, 'fine' as MapMetric, 60)).toBe('');
  });
});
