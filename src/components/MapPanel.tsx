import { useEffect, useMemo, useRef, useState } from 'react';
import type { MapUnplaced, PublicPoint, PublicRegion } from '../domain/public';
import { createKakaoMap, kakaoKey, METRIC_NULL, METRIC_RAMP, colorScalar, type KakaoHandle, type KakaoPointInput } from '../lib/kakao';
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
  activeRegion?: string | null;
  onPickRegion?: (code: string | null) => void;
  /** a refresh is running for another scope; the map stays mounted and shows a small badge */
  refreshing?: boolean;
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

export function toKakaoInputs(points: readonly PublicPoint[], m: MapMetric, selectedKey: string | null,
  marks?: Map<string, PointMark>): KakaoPointInput[] {
  return visiblePoints(points, m).map((pt) => {
    const parts = metricParts(pt, m);
    const mark = marks?.get(pt.key);
    return { key: pt.key, lat: pt.lat, lng: pt.lng, label: pointTitle(pt, m), ...parts, selected: pt.key === selectedKey,
      mine: mark?.mine, shared: mark?.shared, interest: mark?.interest };
  });
}

function Legend({ metric }: { metric: MapMetric }) {
  const def = metricDef(metric);
  const gradient = `linear-gradient(90deg, ${METRIC_RAMP.join(', ')})`;
  return (
    <span className="legend-title map-legend" title={def.basis} aria-label={`범례: ${def.legend}`}>
      <b>{def.legend}</b>
      <span className="cm-muted">{def.kind === 'rate' ? '0%' : '적음'}</span>
      <i className="gradient-scale" style={{ background: gradient }} aria-hidden="true" />
      <span className="cm-muted">{def.kind === 'rate' ? '100%' : '많음'}</span>
      {def.kind === 'rate' && (
        <span className="legend-null"><i style={{ background: METRIC_NULL }} aria-hidden="true" />– 결과 없음</span>
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
    onRegionClick: (code: string) => {
      const active = cb.current.activeRegion ?? null;
      cb.current.onPickRegion?.(active === code ? parentOf(code) : code);
    },
  };
  const def = metricDef(p.metric);
  const shownPoints = useMemo(() => visiblePoints(p.points, p.metric), [p.points, p.metric]);
  const hiddenPoints = p.points.length - shownPoints.length;
  const hiddenNote = hiddenPoints > 0
    ? (p.metric === 'reports'
      ? `이 기간에 신고가 없고 답변만 있는 ${fmtInt(hiddenPoints)}곳은 비율 지표에서 보입니다`
      : `이 기간에 답변이 없는 ${fmtInt(hiddenPoints)}곳은 ‘신고 수’에서 보입니다`)
    : null;

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

  // metric / selection / data changes only redraw markers: no refetch, no new map (R03 §5)
  useEffect(() => {
    handleRef.current?.setPoints(toKakaoInputs(p.points, p.metric, p.selectedKey, p.marks));
  }, [p.points, p.selectedKey, p.metric, sdkState, p.marks]);

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
  const level: BoundaryLevel = activeCode && activeCode !== '36' ? 'sgg' : zoom <= SGG_ZOOM ? 'sgg' : 'sido';
  const needed = useMemo(() => {
    const set = new Set<BoundaryLevel>();
    if (boundaryOn) set.add(level);
    if (activeCode) set.add('sgg');
    return [...set];
  }, [boundaryOn, level, activeCode]);
  useEffect(() => {
    if (sdkState !== 'ready') return;
    let cancelled = false;
    for (const l of needed) {
      if (layers[l]) continue;
      loadBoundaries(l)
        .then((features) => { if (!cancelled) { setLayers((x) => ({ ...x, [l]: features })); setBoundaryError(false); } })
        .catch(() => { if (!cancelled) setBoundaryError(true); });
    }
    if (boundaryOn && !boundaryMeta) loadBoundaryMeta().then((m) => { if (!cancelled) setBoundaryMeta(m); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [needed, layers, sdkState, boundaryOn, boundaryMeta]);

  const shown = useMemo(() => {
    const features = layers[level];
    if (!features) return null;
    if (level === 'sido') return features;
    if (activeCode) return features.filter((f) => f.sido === activeCode.slice(0, 2));
    return bbox ? features.filter((f) => intersects(f.bbox, bbox)) : features;
  }, [layers, level, activeCode, bbox]);
  const rowByCode = useMemo(() => new Map((p.regions ?? []).filter((r) => r.region_code).map((r) => [r.region_code!, r])), [p.regions]);
  useEffect(() => {
    const h = handleRef.current;
    if (!h || sdkState !== 'ready') return;
    if (!boundaryOn || !shown) { h.setBoundaries(null, { selected: null, weight: new Map() }); return; }
    // fill = the ACTIVE metric (R03-6): counts relative to the largest shown region, rates on the fixed 0..1 scale
    const parts = shown.map((f) => { const row = rowByCode.get(f.code); return row ? metricParts(row, p.metric) : null; });
    const max = Math.max(1, ...parts.map((x) => (x && x.kind === 'count' ? x.num : 0)));
    const weight = new Map<string, number | null>();
    shown.forEach((f, i) => {
      const x = parts[i];
      if (!x || x.weight <= 0) return;
      weight.set(f.code, colorScalar(x.kind, x.num, x.den, max));
    });
    h.setBoundaries(shown, { selected: activeCode, weight });
  }, [boundaryOn, shown, rowByCode, activeCode, sdkState, p.metric]);

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
          <span className="subtitle">{p.categoryLabel} · 같은 주소는 핀 하나 · 멀리서 보면 가까운 주소를 묶어 보여 줍니다</span>
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
                아래 목록에서 같은 장소를 볼 수 있고, 다른 통계는 그대로 쓸 수 있습니다.
              </span>
              <span className="map-error-actions">
                <button className="ghost-btn" type="button" onClick={retry}>다시 시도</button>
              </span>
            </div>
            <p className="map-points-note">지도에 표시되는 장소와 같은 목록입니다 · {def.legend}{hiddenNote ? ` · ${hiddenNote}` : ''}</p>
            <ul className="point-list" id="cm-point-list" aria-label="신고 장소 목록">
              {shownPoints.length === 0 && <li className="cm-muted" style={{ fontSize: 13 }}>표시할 장소가 없습니다.</li>}
              {shownPoints.map(pointButton)}
            </ul>
          </div>
        )}
        {sdkState === 'ready' && boundaryOn && hover && (
          <span className="map-hover" role="status">
            <b>{regionLabel(hover)}</b>
            <span>{hoverRow ? `${def.legend} ${metricText(metricParts(hoverRow, p.metric), p.metric)}` : '이 조건의 신고 없음'}</span>
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
            <Legend metric={p.metric} />
          </div>
        )}
      </div>
      <div className="map-options">
        <label className="map-option">
          <input type="checkbox" checked={p.autoRefresh} onChange={(e) => p.onAutoRefresh(e.target.checked)} />
          지도를 움직이면 통계도 바꾸기
        </label>
        {sdkState === 'ready' && (
          <label className="map-option">
            <input type="checkbox" checked={boundaryOn} onChange={(e) => toggleBoundary(e.target.checked)} />
            행정구역 경계{boundaryOn ? ` · ${level === 'sido' ? '시도' : '시군구'}` : ''}
          </label>
        )}
        <span className="cm-muted map-option-note">
          {p.autoRefresh ? '지도를 멈추면 잠시 뒤 보이는 범위의 통계로 바뀝니다.' : '지도를 움직여도 통계는 그대로입니다.'}
          {unplacedNote ? ` 지도에 없는 신고: ${unplacedNote} (통계에는 포함).` : ''}
        </span>
      </div>
      {sdkState === 'ready' && (
        <details className="map-point-alternative">
          <summary>장소 목록으로 보기 · {fmtInt(shownPoints.length)}곳{hiddenNote ? ` · ${hiddenNote}` : ''}</summary>
          <ul className="point-list" id="cm-point-list" aria-label="신고 장소 목록">
            {shownPoints.map(pointButton)}
          </ul>
        </details>
      )}
      {sdkState === 'ready' && boundaryOn && boundaryError && (
        <p className="boundary-note" role="alert">
          행정구역 경계선을 불러오지 못했습니다. 지도와 통계는 그대로 쓸 수 있습니다.{' '}
          <button className="mini-btn" type="button" onClick={retryBoundary}>다시 시도</button>
        </p>
      )}
      {sdkState === 'ready' && boundaryOn && boundaryMeta && (
        <p className="boundary-note" title={boundaryMeta.attribution}>
          경계선은 화면 표시용으로 단순화했고 색은 선택한 지표({def.legend})를 따릅니다. 거의 투명한 곳은 이 조건의 자료가 없는 곳입니다. {boundaryMeta.attribution}
        </p>
      )}
    </article>
  );
}
