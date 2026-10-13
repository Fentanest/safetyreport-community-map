import { useEffect, useMemo, useRef, useState } from 'react';
import type { MapUnplaced, OutcomeCounts, PublicPoint, PublicRegion } from '../domain/public';
import {
  createKakaoMap, kakaoKey, METRIC_NULL, METRIC_RAMP, ACCEPTANCE_RAMP, DIVERGING_RAMP, colorScalar,
  divergingGoodness, divergingScalar, type KakaoHandle, type KakaoPointInput,
} from '../lib/kakao';
import { intersects, loadBoundaries, loadBoundaryMeta, type BoundaryFeature, type BoundaryLevel, type BoundaryMeta } from '../lib/boundaries';
import { regionLabel } from '../data/regions';
import type { PointMark } from '../state/pointMarks';
import { MAP_METRICS, metricDef, metricParts, metricText, type MapMetric } from './mapMetrics';
import { fmtInt } from './format';
import Icon from './icons';

interface Props {
  points: PublicPoint[];
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  metric: MapMetric;
  onMetric: (m: MapMetric) => void;
  categoryLabel: string;
  /** a USER map move settled (drag, wheel, zoom buttons). Programmatic moves never call this (R04 §5). */
  onUserViewport?: (bbox: [number, number, number, number], zoom: number) => void;
  /** any settled view (user or programmatic), for display-only refinement of compacted nodes (R07/F04) */
  onView?: (bbox: [number, number, number, number], zoom: number) => void;
  autoRefresh: boolean;
  onAutoRefresh: (v: boolean) => void;
  locationMissing?: number | null;
  unplaced?: MapUnplaced | null;
  /** personal display marks keyed by place key (display only; no filter) */
  marks?: Map<string, PointMark>;
  regions?: PublicRegion[] | null;
  /** R2 (2026-10-13): current-scope baseline for the 수용률/불수용률 region choropleth's diverging colour —
   *  the SAME outcomes already computed for the overview KPI (reused, never a new query). Omitted/null/no
   *  result_known → the choropleth falls back to the original fixed 0..1 ramp for those two metrics too. */
  overviewOutcomes?: OutcomeCounts | null;
  activeRegion?: string | null;
  onPickRegion?: (code: string | null) => void;
  /** a refresh is running for another scope; the map stays mounted and shows a small badge */
  refreshing?: boolean;
  /** the statistics scope carries a map range (auto refresh): region colours are 'within the range' numbers */
  statsBbox?: boolean;
  /** S02: a click on the bare map (never a marker/cluster/polygon/control click or the end of a drag) */
  onBlankClick?: () => void;
}

/** R7: rate metrics (수용률·불수용률·과태료) draw the regions (choropleth) and NO pins; everything else — 신고 수
 *  (수용률 핀, R1 기본) and any unknown/legacy metric id — draws address pins (R1 fix: safe fallback to points). */
export type RenderMode = 'points' | 'regions';
const REGION_METRIC_IDS: ReadonlySet<MapMetric> = new Set<MapMetric>(['acceptance', 'rejection', 'fine']);
export const renderModeOf = (m: MapMetric): RenderMode => (REGION_METRIC_IDS.has(m) ? 'regions' : 'points');
/** Kakao level > SGG_ZOOM → 시도; ≤ SGG_ZOOM → 시군구. Independent of the region filter (R7). */
export const boundaryLevelFor = (zoom: number): BoundaryLevel => (zoom <= SGG_ZOOM ? 'sgg' : 'sido');

/** Codes outside the applied region filter at the drawn level (drawn as 'out of range', never as 0%). */
export function outOfScopeCodes(features: readonly BoundaryFeature[], level: BoundaryLevel, active: string | null): Set<string> {
  if (!active) return new Set();
  const inside = (f: BoundaryFeature) => (level === 'sido' ? f.code === active.slice(0, 2)
    : active.length === 2 ? f.sido === active : f.code === active);
  return new Set(features.filter((f) => !inside(f)).map((f) => f.code));
}

/** R2: the current-scope baseline % (Σnum/Σden) for 수용률/불수용률's diverging colour — 이미 overview KPI로
 *  계산된 값(`outcomes`)을 그대로 쓴다(새 전체 재조회 없음). 다른 지표거나 분류된 답변이 0건이면 null(폴백). */
export function baselinePercent(m: MapMetric, outcomes: OutcomeCounts | null | undefined): number | null {
  if (m !== 'acceptance' && m !== 'rejection') return null;
  if (!outcomes || outcomes.result_known <= 0) return null;
  return ((m === 'acceptance' ? outcomes.accepted : outcomes.rejected) / outcomes.result_known) * 100;
}

export interface RegionWeights { weight: Map<string, number | null>; ramp?: readonly string[] }
/**
 * R2 (2026-10-13): region choropleth fill — pure (no DOM/Kakao SDK) so the bucket boundaries, the opposite
 * acceptance/rejection direction, the baseline fallback and the "계산 불가 stays grey" rule are all directly
 * testable. 수용률/불수용률 with a computable baseline use the 7-bucket DIVERGING_RAMP (region deviates from
 * the CURRENT SCOPE's own baseline %, in percentage points); every other metric, or acceptance/rejection
 * without a baseline (`baselinePct === null`, e.g. the overview itself has 0 분류된 답변), falls straight back
 * to the original colorScalar + default ramp (ramp omitted → METRIC_RAMP in kakao.ts) — unchanged behaviour.
 */
export function regionBoundaryWeights(codes: readonly string[], rowByCode: ReadonlyMap<string, PublicRegion>,
  m: MapMetric, baselinePct: number | null): RegionWeights {
  const parts = codes.map((code) => { const row = rowByCode.get(code); return row ? metricParts(row, m) : null; });
  const max = Math.max(1, ...parts.map((x) => (x && x.kind === 'count' ? x.num : 0)));
  const diverging = (m === 'acceptance' || m === 'rejection') && baselinePct !== null;
  const weight = new Map<string, number | null>();
  codes.forEach((code, i) => {
    const x = parts[i];
    if (!x || x.weight <= 0) return;
    if (diverging) {
      if (x.den <= 0) { weight.set(code, null); return; } // 계산 불가(분모 0) — 회색 그대로, 기존 규칙과 동일
      const regionPct = (x.num / x.den) * 100;
      const raw = regionPct - (baselinePct as number);
      weight.set(code, divergingScalar(divergingGoodness(m as 'acceptance' | 'rejection', raw)));
      return;
    }
    weight.set(code, colorScalar(x.kind, x.num, x.den, max));
  });
  return { weight, ramp: diverging ? DIVERGING_RAMP : undefined };
}

const BOUNDARY_KEY = 'cm-boundaries';
function readBoundaryPref(): boolean {
  try { return window.localStorage.getItem(BOUNDARY_KEY) !== '0'; } catch { return true; }
}
function writeBoundaryPref(on: boolean): void {
  try {
    if (on) window.localStorage.removeItem(BOUNDARY_KEY);
    else window.localStorage.setItem(BOUNDARY_KEY, '0');
  } catch { /* storage blocked: the toggle still works for this page */ }
}
/** Kakao map level at or below which 시군구 boundaries replace 시도 (roughly one metropolitan area in view). */
const SGG_ZOOM = 9;
const KOREA: [number, number, number, number] = [124.6, 33.0, 131.0, 38.7];
const parentOf = (code: string): string | null => (code.length === 5 ? code.slice(0, 2) : null);
function unionBbox(features: readonly BoundaryFeature[]): [number, number, number, number] | null {
  if (!features.length) return null;
  return features.reduce<[number, number, number, number]>((b, f) =>
    [Math.min(b[0], f.bbox[0]), Math.min(b[1], f.bbox[1]), Math.max(b[2], f.bbox[2]), Math.max(b[3], f.bbox[3])],
  [Infinity, Infinity, -Infinity, -Infinity]);
}

function markLabel(mark: PointMark | undefined): string {
  if (!mark) return '';
  const parts: string[] = [];
  if (mark.mine) parts.push(`내 신고 ${mark.mineCount.toLocaleString('ko-KR')}건 포함`);
  if (mark.shared) parts.push('다른 사람과 함께 신고한 곳');
  if (mark.interest) parts.push('관심 지역');
  return parts.length ? ` · ${parts.join(' · ')}` : '';
}

/** Places drawn for a metric: reported places for 신고 수, answered places for the rates (weight > 0). */
export function visiblePoints(points: readonly PublicPoint[], m: MapMetric): PublicPoint[] {
  return points.filter((p) => metricParts(p, m).weight > 0);
}

export function placeName(p: PublicPoint): string {
  return p.aggregate ? `서로 다른 주소 ${fmtInt(p.point_count ?? null)}곳 묶음` : (p.address ?? '주소 없음');
}

/** Tooltip/list label: place + metric value with its numerator/denominator (R03 §1). */
export function pointTitle(p: PublicPoint, m: MapMetric): string {
  const def = metricDef(m);
  const parts = metricParts(p, m);
  const sample = m === 'reports' ? '' : ` · 답변 ${fmtInt(p.completed_count)}건`;
  return `${placeName(p)} · ${def.legend} ${metricText(parts, m)}${sample}`;
}

/** R2 (2026-10-13): ' · 평균 대비 +4.2%p' — RAW deviation in the metric's OWN terms (never the colour's
 *  good/bad-flipped value, so a reader never has to mentally un-flip 불수용률's sign). '' when not applicable:
 *  not 수용률/불수용률, no baseline, or this row's own rate isn't computable (den=0, same as 계산 불가 colouring). */
export function regionDeltaNote(row: PublicRegion | undefined, m: MapMetric, baselinePct: number | null): string {
  if (!row || baselinePct === null || (m !== 'acceptance' && m !== 'rejection')) return '';
  const parts = metricParts(row, m);
  if (parts.kind !== 'rate' || parts.den <= 0) return '';
  const raw = (parts.num / parts.den) * 100 - baselinePct;
  const sign = raw > 0 ? '+' : ''; // toFixed already prints '-' for negatives
  return ` · 평균 대비 ${sign}${raw.toFixed(1)}%p`;
}

export function toKakaoInputs(points: readonly PublicPoint[], m: MapMetric, selectedKey: string | null,
  marks?: Map<string, PointMark>): KakaoPointInput[] {
  return visiblePoints(points, m).map((pt) => {
    const parts = metricParts(pt, m);
    const mark = marks?.get(pt.key);
    // R1 묶음 보존: a server-compacted node's own point_count travels with it so a further client-side
    // re-bundle (far zoom) still reports the real distinct-address count, never the lower node count.
    const places = pt.aggregate ? (pt.point_count ?? 1) : 1;
    return { key: pt.key, lat: pt.lat, lng: pt.lng, label: pointTitle(pt, m), ...parts, places, selected: pt.key === selectedKey,
      mine: mark?.mine, shared: mark?.shared ?? undefined, interest: mark?.interest };
  });
}

const LEVEL_LABEL: Record<BoundaryLevel, string> = { sido: '시도', sgg: '시군구' };

/** R1: the DEFAULT 신고 pin's legend — fill = 수용률 (fixed red→orange→green scale) · size/number = 신고 건수.
 *  A separate branch from the generic legend below (its 0%/100% blue ramp and count/rate wording are for the
 *  region-choropleth metrics only). */
function DensityLegend() {
  const gradient = `linear-gradient(90deg, ${ACCEPTANCE_RAMP.join(', ')})`;
  return (
    <span className="legend-title map-legend"
      title="핀 색 = 수용률(수용 ÷ 수용+일부수용+불수용, 고정 빨강→주황→초록) · 핀 크기·숫자 = 신고 건수(1~9/10~29/30~99/100~299/300건 이상 단계)"
      aria-label="범례: 색은 수용률, 크기와 숫자는 신고 건수">
      <b>색: 수용률 · 크기·숫자: 신고 건수</b>
      <span className="cm-muted">0%</span>
      <i className="gradient-scale" style={{ background: gradient }} aria-hidden="true" />
      <span className="cm-muted">100%</span>
      <span className="legend-null"><i style={{ background: METRIC_NULL }} aria-hidden="true" />계산 불가(분류된 답변 0건)</span>
    </span>
  );
}

/** R2: raw(관측-기준) %p 경계 라벨, bucket 0(빨강)→6(초록) 순서. 수용률은 이 순서 그대로가 자기 자신의 raw %p
 *  구간과 일치한다(bucket==raw 방향). 불수용률은 bucket이 '좋음' 방향으로 뒤집혀 있어, bucket 색이 뜻하는 raw
 *  불수용률 편차 구간은 이 배열을 뒤집은 값과 같다(아래 DivergingLegend에서 처리). */
const DIVERGING_BUCKET_LABELS = ['-15%p 이하', '-15~-7%p', '-7~-3%p', '±3%p 이내', '+3~+7%p', '+7~+15%p', '+15%p 이상'];

/** R2: 수용률/불수용률 지역 지도 전용 범례 — 7단계 발산형 색 칩 + 기준값(현재 범위 평균) + ±%p 구간 라벨.
 *  기준값을 계산할 수 없을 때(Legend에서 baselinePct===null로 걸러짐)는 호출되지 않고, 대신 아래 generic 범례
 *  (기존 고정 0..1 램프)로 그대로 폴백한다. */
function DivergingLegend({ metric, level, baselinePct }: { metric: 'acceptance' | 'rejection'; level: BoundaryLevel; baselinePct: number }) {
  const def = metricDef(metric);
  // bucket 색 순서는 항상 '나쁨→좋음'(빨강→초록); 불수용률은 raw %p 방향이 반대라 라벨만 뒤집는다(색은 안 바뀜).
  const labels = metric === 'rejection' ? [...DIVERGING_BUCKET_LABELS].reverse() : DIVERGING_BUCKET_LABELS;
  return (
    <span className="legend-title map-legend"
      title={`${LEVEL_LABEL[level]}별 ${def.legend} — 현재 범위 평균 ${baselinePct.toFixed(1)}% 대비 편차(%p), 고정 7구간 발산형 색`}
      aria-label={`범례: ${LEVEL_LABEL[level]}별 ${def.legend}, 현재 범위 평균 ${baselinePct.toFixed(1)}% 대비`}>
      <b>{LEVEL_LABEL[level]}별 {def.legend} · 평균 {baselinePct.toFixed(1)}% 대비</b>
      {DIVERGING_RAMP.map((color, i) => (
        <span className="legend-null" key={color}><i style={{ background: color, border: 'none' }} aria-hidden="true" />{labels[i]}</span>
      ))}
      <span className="legend-null"><i style={{ background: METRIC_NULL }} aria-hidden="true" />계산 불가(기준 신고 0건)</span>
      <span className="legend-null"><i className="legend-empty" aria-hidden="true" />자료 없음</span>
    </span>
  );
}

function Legend({ metric, level, statsBbox, filtered, baselinePct }: { metric: MapMetric; level: BoundaryLevel; statsBbox: boolean; filtered: boolean; baselinePct: number | null }) {
  // points mode (신고 수, the default pin) always carries the 수용률 colour legend; an unknown/legacy metric id
  // resolves to 'reports' (renderModeOf below) so it gets the same legend, never the stale generic one.
  if (renderModeOf(metric) === 'points') return <DensityLegend />;
  // R2: 수용률/불수용률 + 기준값 계산 가능 → 발산형 범례. 기준값 없음(폴백)이거나 과태료면 아래 generic 범례 그대로.
  if ((metric === 'acceptance' || metric === 'rejection') && baselinePct !== null) {
    return <DivergingLegend metric={metric} level={level} baselinePct={baselinePct} />;
  }
  const def = metricDef(metric);
  const gradient = `linear-gradient(90deg, ${METRIC_RAMP.join(', ')})`;
  const regions = renderModeOf(metric) === 'regions';
  return (
    <span className="legend-title map-legend" title={def.basis} aria-label={`범례: ${regions ? `${LEVEL_LABEL[level]}별 ` : ''}${def.legend}`}>
      <b>{regions ? `${LEVEL_LABEL[level]}별 ${def.legend}` : def.legend}</b>
      <span className="cm-muted">{def.kind === 'rate' ? '0%' : '적음'}</span>
      <i className="gradient-scale" style={{ background: gradient }} aria-hidden="true" />
      <span className="cm-muted">{def.kind === 'rate' ? '100%' : '많음'}</span>
      {regions && (
        <>
          <span className="legend-null"><i style={{ background: METRIC_NULL }} aria-hidden="true" />계산 불가(기준 신고 0건)</span>
          <span className="legend-null"><i className="legend-empty" aria-hidden="true" />자료 없음</span>
          {filtered && <span className="legend-null"><i className="legend-out" aria-hidden="true" />범위 밖</span>}
          {statsBbox && <span className="cm-muted">지도 범위 안 신고만</span>}
        </>
      )}
    </span>
  );
}

export default function MapPanel(p: Props) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<KakaoHandle | null>(null);
  const [sdkState, setSdkState] = useState<'idle' | 'ready' | 'error'>(kakaoKey() ? 'idle' : 'error');
  const [sdkError, setSdkError] = useState<string | null>(
    kakaoKey() ? null : '지도를 불러올 수 없습니다. 아래 목록에서 장소를 확인할 수 있습니다.',
  );
  const [bbox, setBbox] = useState<[number, number, number, number] | null>(null);
  const [zoom, setZoom] = useState(13);
  const [boundaryOn, setBoundaryOn] = useState(readBoundaryPref);
  const [layers, setLayers] = useState<Partial<Record<BoundaryLevel, BoundaryFeature[]>>>({});
  const [boundaryError, setBoundaryError] = useState(false);
  const [boundaryMeta, setBoundaryMeta] = useState<BoundaryMeta | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  // Latest callbacks for the long-lived SDK listeners (the map is created once per mount).
  const cb = useRef(p);
  cb.current = p;
  const mapOpts = {
    onSelect: (key: string) => cb.current.onSelect(key),
    onIdle: (b: [number, number, number, number], z: number, user: boolean) => {
      setBbox(b);
      setZoom(z);
      cb.current.onView?.(b, z);
      if (user) cb.current.onUserViewport?.(b, z);
    },
    onRegionHover: (code: string | null) => setHover(code),
    onMapClick: () => cb.current.onBlankClick?.(),
    onRegionClick: (code: string) => {
      const active = cb.current.activeRegion ?? null;
      cb.current.onPickRegion?.(active === code ? parentOf(code) : code);
    },
  };
  const def = metricDef(p.metric);
  const renderMode = renderModeOf(p.metric);
  // R2 (2026-10-13): 수용률/불수용률 지역 지도의 발산형 색 기준값 — 현재 범위(같은 기간·분류·필터) 전체의
  // Σaccepted(또는 Σrejected)/Σresult_known, 이미 overview KPI로 계산된 값을 그대로 재사용한다(새 전체 재조회
  // 없음). 기준값을 못 구하면(overview 자체가 0건 등) null → 색·범례 모두 기존 고정 램프로 폴백한다.
  const baselinePct = useMemo(() => baselinePercent(p.metric, p.overviewOutcomes), [p.metric, p.overviewOutcomes]);
  // points mode only: in regions mode there is no place list, marker or cluster at all
  const shownPoints = useMemo(() => (renderMode === 'points' ? visiblePoints(p.points, p.metric) : []), [p.points, p.metric, renderMode]);
  // U01/D02: every place of the ONE cohort is drawn — nothing is hidden because of its other date (the old
  // "답변만 있는 곳은 비율 지표에서 보임" note and its branch were removed). D02/MP-03: the place count is the number
  // of distinct addresses (a compacted node counts its member addresses), never the number of drawn nodes.
  const placeCount = shownPoints.reduce((n, pt) => n + (pt.aggregate ? pt.point_count ?? 1 : 1), 0);
  const compactedNodes = shownPoints.some((pt) => pt.aggregate);

  useEffect(() => {
    if (!kakaoKey() || !hostRef.current) return;
    let cancelled = false;
    setSdkState('idle');
    createKakaoMap(hostRef.current, mapOpts)
      .then((h) => {
        if (cancelled) { h.destroy(); return; }
        handleRef.current = h;
        setSdkState('ready');
      })
      .catch((e: Error) => {
        if (!cancelled) { setSdkState('error'); setSdkError(e.message); }
      });
    return () => {
      cancelled = true;
      handleRef.current?.destroy();
      handleRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // metric / selection / data changes only redraw markers: no refetch, no new map (R03 §5).
  // Regions mode clears every marker, cluster and the adapter's last point input (R7) — nothing to re-render later.
  useEffect(() => {
    handleRef.current?.setPoints(renderMode === 'points' ? toKakaoInputs(p.points, p.metric, p.selectedKey, p.marks) : []);
  }, [p.points, p.selectedKey, p.metric, sdkState, p.marks, renderMode]);

  // container size changes (view switch, window, side panel) → relayout only (R04 §12)
  useEffect(() => {
    const el = canvasRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let last = '';
    let t: number | undefined;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      const key = r ? `${Math.round(r.width)}x${Math.round(r.height)}` : '';
      if (key === last) return;
      last = key;
      window.clearTimeout(t);
      t = window.setTimeout(() => handleRef.current?.relayout(), 60);
    });
    ro.observe(el);
    return () => { ro.disconnect(); window.clearTimeout(t); };
  }, []);

  // ---- boundary layer (display only; its failure never touches markers or statistics) ----
  const activeCode = p.activeRegion ?? null;
  // drawn level follows the zoom only; the region filter no longer forces 시군구 (R7)
  const level: BoundaryLevel = boundaryLevelFor(zoom);
  // regions mode always draws boundaries; the saved preference applies to 신고 수 only and comes back with it
  const boundaryShown = renderMode === 'regions' || boundaryOn;
  const needed = useMemo(() => {
    const set = new Set<BoundaryLevel>();
    if (boundaryShown) set.add(level);
    if (activeCode) set.add('sgg'); // fitting to a chosen region uses the 시군구 shapes
    return [...set];
  }, [boundaryShown, level, activeCode]);
  useEffect(() => {
    if (sdkState !== 'ready') return;
    let cancelled = false;
    for (const l of needed) {
      if (layers[l]) continue;
      loadBoundaries(l)
        .then((features) => { if (!cancelled) { setLayers((x) => ({ ...x, [l]: features })); setBoundaryError(false); } })
        .catch(() => { if (!cancelled) setBoundaryError(true); });
    }
    if (boundaryShown && !boundaryMeta) loadBoundaryMeta().then((m) => { if (!cancelled) setBoundaryMeta(m); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [needed, layers, sdkState, boundaryShown, boundaryMeta]);

  // one level at a time (시도 and 시군구 are never filled together); 시군구 is limited to the viewport for speed
  const shown = useMemo(() => {
    const features = layers[level];
    if (!features) return null;
    if (level === 'sido') return features;
    return bbox ? features.filter((f) => intersects(f.bbox, bbox)) : features;
  }, [layers, level, bbox]);
  const rowByCode = useMemo(() => new Map((p.regions ?? []).filter((r) => r.region_code).map((r) => [r.region_code!, r])), [p.regions]);
  useEffect(() => {
    const h = handleRef.current;
    if (!h || sdkState !== 'ready') return;
    if (!boundaryShown || !shown) { h.setBoundaries(null, { selected: null, weight: new Map() }); return; }
    // fill = the ACTIVE metric: region rows are Σnumerator/Σdenominator from raw facts on the server (a 시도 is
    // never an average of its 시군구); rates on the fixed 0..1 scale (or R2 diverging scale), counts relative
    // to the largest shown region — see regionBoundaryWeights above for the actual rule.
    const { weight, ramp } = regionBoundaryWeights(shown.map((f) => f.code), rowByCode, p.metric, baselinePct);
    h.setBoundaries(shown, { selected: activeCode, weight, mode: renderMode, outOfScope: outOfScopeCodes(shown, level, activeCode), ramp });
  }, [boundaryShown, shown, rowByCode, activeCode, sdkState, p.metric, renderMode, level, baselinePct]);

  // Move the map to a newly chosen region (from the list, the filter or a boundary click). Programmatic move.
  const fittedRef = useRef<string | null>(null);
  useEffect(() => {
    const h = handleRef.current;
    if (!h || sdkState !== 'ready' || fittedRef.current === activeCode) return;
    if (!activeCode) {
      if (fittedRef.current !== null) h.fitBounds(KOREA);
      fittedRef.current = null;
      return;
    }
    const sgg = layers.sgg;
    if (!sgg) return;
    const target = unionBbox(sgg.filter((f) => (activeCode.length === 2 ? f.sido === activeCode : f.code === activeCode)));
    fittedRef.current = activeCode;
    if (target) h.fitBounds(target);
  }, [activeCode, layers.sgg, sdkState]);

  const toggleBoundary = (on: boolean) => {
    setBoundaryOn(on);
    writeBoundaryPref(on);
    if (!on) setHover(null);
  };
  const retryBoundary = () => { setBoundaryError(false); setLayers((x) => ({ ...x })); };
  const hoverRow = hover ? rowByCode.get(hover) : undefined;
  const hoverOut = hover && shown ? outOfScopeCodes(shown.filter((f) => f.code === hover), level, activeCode).has(hover) : false;

  const retry = () => {
    if (!kakaoKey()) {
      setSdkState('error');
      setSdkError('지도를 불러올 수 없습니다. 아래 목록에서 장소를 확인할 수 있습니다.');
      return;
    }
    handleRef.current?.destroy();
    handleRef.current = null;
    setSdkState('idle');
    const el = hostRef.current;
    if (!el) return;
    createKakaoMap(el, mapOpts)
      .then((h) => {
        handleRef.current = h;
        setSdkState('ready');
      })
      .catch((e: Error) => { setSdkState('error'); setSdkError(e.message); });
  };

  const unplaced = p.unplaced;
  const unplacedNote = unplaced
    ? [unplaced.no_address.reported + unplaced.no_address.completed > 0 ? `주소가 없는 신고 ${fmtInt(unplaced.no_address.reported)}건(답변 ${fmtInt(unplaced.no_address.completed)}건)` : null,
      unplaced.no_coordinates.reported + unplaced.no_coordinates.completed > 0 ? `주소는 있으나 위치를 찾지 못한 신고 ${fmtInt(unplaced.no_coordinates.reported)}건(답변 ${fmtInt(unplaced.no_coordinates.completed)}건)` : null]
      .filter(Boolean).join(' · ')
    : (p.locationMissing ? `위치 정보가 없는 ${fmtInt(p.locationMissing)}건` : '');

  const pointButton = (pt: PublicPoint) => (
    <li key={pt.key}>
      <button type="button" aria-pressed={pt.key === p.selectedKey}
        aria-label={`${pointTitle(pt, p.metric)}${markLabel(p.marks?.get(pt.key))} 선택`}
        onClick={() => p.onSelect(pt.key === p.selectedKey ? null : pt.key)}>
        <b>{placeName(pt)}</b>
        <small>{def.legend} {metricText(metricParts(pt, p.metric), p.metric)}</small>
      </button>
    </li>
  );

  return (
    <article className="cm-panel map-card" aria-label="신고 지도" aria-busy={p.refreshing || undefined}>
      <div className="panel-top">
        <div>
          <h2>신고 지도 {p.refreshing && <span className="refresh-badge" role="status">갱신 중…</span>}</h2>
          <span className="subtitle">{p.categoryLabel}{renderMode === 'points' ? '' : ` · ${LEVEL_LABEL[level]}별 ${def.legend}`}</span>
        </div>
        <div className="mini-segments metric-switch" role="group" aria-label="지도에 표시할 값">
          {MAP_METRICS.map((m) => (
            <button key={m.id} type="button" className={p.metric === m.id ? 'selected' : ''} aria-pressed={p.metric === m.id}
              title={m.basis} onClick={() => p.onMetric(m.id)}>
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <div ref={canvasRef} className={`map-canvas${sdkState === 'error' ? ' map-fallback-mode' : ''}`} role="region" aria-label={sdkState === 'ready' ? '카카오 지도' : '지도 대신 장소 목록'}>
        {kakaoKey() && <div ref={hostRef} className="map-sdk-host" aria-hidden={sdkState !== 'ready'} />}
        {sdkState === 'error' && (
          <div className="map-fallback">
            <div className="map-error-card compact" role="alert" title={sdkError ?? undefined}>
              <span className="grow">
                <b>지도를 불러오지 못했습니다.</b>{' '}
                아래 목록에서 장소를 볼 수 있습니다.
              </span>
              <span className="map-error-actions">
                <button className="ghost-btn" type="button" onClick={retry}>다시 시도</button>
              </span>
            </div>
            {renderMode === 'points' ? (
              <>
                <ul className="point-list" id="cm-point-list" aria-label="신고 장소 목록">
                  {shownPoints.length === 0 && <li className="cm-muted" style={{ fontSize: 13 }}>표시할 장소가 없습니다.</li>}
                  {shownPoints.map(pointButton)}
                </ul>
              </>
            ) : (
              <>
                <ul className="point-list" aria-label={`시도별 ${def.legend}`}>
                  {(p.regions ?? []).filter((r) => r.level === 'sido').map((r) => (
                    <li key={r.region_code}><button type="button" onClick={() => p.onPickRegion?.(r.region_code)}>
                      <b>{r.name}</b><small>{def.legend} {metricText(metricParts(r, p.metric), p.metric)}{regionDeltaNote(r, p.metric, baselinePct)}</small>
                    </button></li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
        {sdkState === 'ready' && boundaryShown && hover && (
          <span className="map-hover" role="status">
            <b>{regionLabel(hover)}</b>
            <span>{hoverOut ? '적용한 지역 조건 밖' : hoverRow
              ? `${def.legend} ${metricText(metricParts(hoverRow, p.metric), p.metric)}${p.metric !== 'reports' ? ` · 답변 ${fmtInt(hoverRow.completed_count)}건 · 신고 ${fmtInt(hoverRow.report_count)}건` : ''}${regionDeltaNote(hoverRow, p.metric, baselinePct)}`
              : '이 조건의 자료 없음'}</span>
            {p.statsBbox && <small>지도 범위 안 신고만</small>}
            <small>{activeCode === hover ? '누르면 한 단계 위 지역으로' : '누르면 이 지역만 보기'}</small>
          </span>
        )}
        <div className="map-top">
          <span className="map-top-left">
            {sdkState !== 'ready' && <span className="map-status">장소 목록</span>}
            {activeCode && p.onPickRegion && (
              <button className="map-back" type="button"
                aria-label={parentOf(activeCode) ? `한 단계 위 지역으로: ${regionLabel(parentOf(activeCode))}` : '전국으로'}
                title={parentOf(activeCode) ? `한 단계 위 지역으로: ${regionLabel(parentOf(activeCode))}` : '전국으로'}
                onClick={() => p.onPickRegion!(parentOf(activeCode))}>
                ← {parentOf(activeCode) ? regionLabel(parentOf(activeCode)) : '전국'}
              </button>
            )}
          </span>
        </div>
        {sdkState === 'ready' && (
          <div className="map-tools" role="group" aria-label="지도 확대·축소">
            <button className="map-button" type="button" aria-label="확대" onClick={() => handleRef.current?.zoomIn()}>+</button>
            <button className="map-button" type="button" aria-label="축소" onClick={() => handleRef.current?.zoomOut()}>−</button>
            <button className="map-button" type="button" aria-label="전국 보기" onClick={() => handleRef.current?.reset()}><Icon name="focus" /></button>
          </div>
        )}
        {sdkState !== 'error' && (
          <div className="map-bottom">
            <Legend metric={p.metric} level={level} statsBbox={!!p.statsBbox} filtered={!!activeCode} baselinePct={baselinePct} />
          </div>
        )}
      </div>
      <div className="map-options">
        <label className="map-option">
          <input type="checkbox" checked={p.autoRefresh} onChange={(e) => p.onAutoRefresh(e.target.checked)} />
          지도를 움직이면 통계도 바꾸기
        </label>
        {sdkState === 'ready' && (renderMode === 'regions' ? (
          <span className="map-option" role="note">
            <input type="checkbox" checked disabled aria-label="행정구역 경계(비율 지도에서는 항상 표시)" />
            {LEVEL_LABEL[level]} 단위로 색칠 중 · 확대하면 시군구, 멀리서 보면 시도
          </span>
        ) : (
          <label className="map-option">
            <input type="checkbox" checked={boundaryOn} onChange={(e) => toggleBoundary(e.target.checked)} />
            행정구역 경계{boundaryOn ? ` · ${LEVEL_LABEL[level]}` : ''}
          </label>
        ))}
        <span className="cm-muted map-option-note">
          {unplacedNote ? `지도에 없는 신고: ${unplacedNote}` : ''}
        </span>
      </div>
      {sdkState === 'ready' && renderMode === 'points' && (
        <details className="map-point-alternative">
          <summary>장소 목록으로 보기 · 주소 {fmtInt(placeCount)}곳{compactedNodes ? ` (가까운 주소를 묶은 점 포함 ${fmtInt(shownPoints.length)}개)` : ''}</summary>
          <ul className="point-list" id="cm-point-list" aria-label="신고 장소 목록">
            {shownPoints.map(pointButton)}
          </ul>
        </details>
      )}
      {sdkState === 'ready' && boundaryShown && boundaryError && (
        <p className="boundary-note" role="alert">
          {renderMode === 'regions' ? '행정구역 경계를 불러오지 못해 비율 지도를 그릴 수 없습니다.' : '행정구역 경계선을 불러오지 못했습니다.'}{' '}
          <button className="mini-btn" type="button" onClick={retryBoundary}>다시 시도</button>
        </p>
      )}
      {sdkState === 'ready' && boundaryShown && boundaryMeta && (
        <details className="boundary-note">
          <summary>경계선 출처</summary>
          {boundaryMeta.attribution}
        </details>
      )}
    </article>
  );
}
