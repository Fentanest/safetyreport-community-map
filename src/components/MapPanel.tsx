import { useEffect, useRef, useState } from 'react';
import type { PublicPoint } from '../domain/public';
import { createKakaoMap, kakaoKey, type KakaoHandle } from '../lib/kakao';
import type { MapMetric } from '../state/filters';
import { POINT_FILTER_LABEL, type PointFilter } from '../state/view';
import type { PointMark } from '../state/pointMarks';
import { acceptRate, fmtInt } from './format';
import Icon from './icons';

interface Props {
  points: PublicPoint[];
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  metric: MapMetric;
  onMetric: (m: MapMetric) => void;
  categoryLabel: string;
  onApplyView: (bbox: [number, number, number, number]) => void;
  autoRefresh: boolean;
  onAutoRefresh: (v: boolean) => void;
  locationMissing?: number | null;
  /** personal display marks (mine/shared/interest) keyed by point key */
  marks?: Map<string, PointMark>;
  pointFilter?: PointFilter;
  onPointFilter?: (f: PointFilter) => void;
  /** which display filters can be used now (mine/shared need a ready comparison) */
  filterAvailable?: Record<PointFilter, boolean>;
  /** total points before the display filter */
  totalPoints?: number;
}

const FILTER_REASON: Record<PointFilter, string> = {
  all: '',
  mine: '로그인하고 ‘내 신고와 비교’를 켜면 쓸 수 있습니다.',
  shared: '로그인하고 ‘내 신고와 비교’를 켜면 쓸 수 있습니다.',
  interest: '지역 목록에서 ★를 누르면 쓸 수 있습니다.',
};

/** Visible reason for disabled display filters (a disabled button's tooltip is not reliably shown). */
function unavailableHint(available: Record<PointFilter, boolean> | undefined): string | null {
  if (!available) return null;
  const parts: string[] = [];
  if (!available.mine) parts.push('내 신고가 있는 곳은 로그인 후 ‘내 신고와 비교’를 켜면 볼 수 있습니다');
  if (!available.interest) parts.push('관심 지역은 지역 목록에서 ★를 누르세요');
  return parts.length ? parts.join(' · ') : null;
}

function markLabel(mark: PointMark | undefined): string {
  if (!mark) return '';
  const parts: string[] = [];
  if (mark.mine) parts.push(`내 신고 ${mark.mineCount.toLocaleString('ko-KR')}건 포함`);
  if (mark.shared) parts.push('다른 사람과 함께 신고한 곳');
  else if (mark.mine) parts.push('나만 신고한 곳');
  if (mark.interest) parts.push('관심 지역');
  return parts.length ? ` · ${parts.join(' · ')}` : '';
}

/** Text + ring-shape badges mirroring the real-map marker rings (never color-only). */
function MarkBadges({ mark }: { mark: PointMark | undefined }) {
  if (!mark || (!mark.mine && !mark.interest)) return null;
  return (
    <span className="pt-badges">
      {mark.mine && (
        <span className="pt-badge mine">
          <i className={mark.shared ? 'ring shared' : 'ring mine'} aria-hidden="true" />
          내 신고 {mark.mineCount.toLocaleString('ko-KR')}건 · {mark.shared ? '다른 사람과 함께 신고한 곳' : '나만 신고한 곳'}
        </span>
      )}
      {mark.interest && (
        <span className="pt-badge interest" aria-label="관심 지역">
          <span aria-hidden="true">★</span> 관심 지역
        </span>
      )}
    </span>
  );
}

const METRICS: Array<{ id: MapMetric; label: string; legend: string; basis: string }> = [
  { id: 'reports', label: '신고 수', legend: '신고 수', basis: '신고한 날 기준' },
  { id: 'acceptance', label: '수용률', legend: '수용률', basis: '답변 받은 날 기준 · 결과가 나온 신고 중 수용 (일부 수용 제외)' },
  { id: 'fine', label: '과태료', legend: '과태료 부과율', basis: '답변 받은 날 기준 · 답변 완료된 신고 중' },
];

function metricValue(p: PublicPoint, m: MapMetric): number | null {
  if (m === 'reports') return p.report_count;
  if (m === 'acceptance') {
    const o = p.outcomes;
    return acceptRate(o);
  }
  if (p.fine_count == null || (p.completed_count ?? 0) === 0) return null;
  return (p.fine_count / (p.completed_count ?? 1)) * 100;
}

export default function MapPanel(p: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<KakaoHandle | null>(null);
  const [sdkState, setSdkState] = useState<'idle' | 'ready' | 'error'>(kakaoKey() ? 'idle' : 'error');
  const [sdkError, setSdkError] = useState<string | null>(
    kakaoKey() ? null : '지도를 불러올 수 없습니다. 아래 목록에서 장소를 확인할 수 있습니다.',
  );
  const [bbox, setBbox] = useState<[number, number, number, number] | null>(null);
  const applyViewRef = useRef(p.onApplyView);
  applyViewRef.current = p.onApplyView;
  const active = METRICS.find((m) => m.id === p.metric)!;

  useEffect(() => {
    if (!kakaoKey() || !hostRef.current) return;
    let cancelled = false;
    setSdkState('idle');
    createKakaoMap(hostRef.current, {
      onSelect: (key) => p.onSelect(key),
      onIdle: (b) => setBbox(b),
    })
      .then((h) => {
        if (cancelled) {
          h.destroy();
          return;
        }
        handleRef.current = h;
        setSdkState('ready');
      })
      .catch((e: Error) => {
        if (!cancelled) {
          setSdkState('error');
          setSdkError(e.message);
        }
      });
    return () => {
      cancelled = true;
      handleRef.current?.destroy();
      handleRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    handleRef.current?.setPoints(
      p.points.map((pt) => ({
        key: pt.key,
        lat: pt.lat,
        lng: pt.lng,
        label: `${pt.aggregate ? `${pt.point_count}곳 묶음` : (pt.address ?? '주소 없음')} · 신고 ${pt.report_count}건`,
        count: pt.report_count,
        selected: pt.key === p.selectedKey,
        metricValue: metricValue(pt, p.metric),
        ...p.marks?.get(pt.key),
      })),
    );
  }, [p.points, p.selectedKey, p.metric, sdkState, p.marks]);

  useEffect(() => {
    const onResize = () => handleRef.current?.relayout();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (!p.autoRefresh || !bbox) return;
    const timer = window.setTimeout(() => applyViewRef.current(bbox), 300);
    return () => window.clearTimeout(timer);
  }, [p.autoRefresh, bbox]);

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
    createKakaoMap(el, { onSelect: (key) => p.onSelect(key), onIdle: (b) => setBbox(b) })
      .then((h) => {
        handleRef.current = h;
        setSdkState('ready');
        handleRef.current.setPoints(
          p.points.map((pt) => ({
            key: pt.key, lat: pt.lat, lng: pt.lng,
            label: `${pt.aggregate ? `${pt.point_count}곳 묶음` : (pt.address ?? '주소 없음')} · 신고 ${pt.report_count}건`,
            count: pt.report_count, selected: pt.key === p.selectedKey, metricValue: metricValue(pt, p.metric),
            ...p.marks?.get(pt.key),
          })),
        );
      })
      .catch((e: Error) => {
        setSdkState('error');
        setSdkError(e.message);
      });
  };

  return (
    <article className="cm-panel map-card" aria-label="신고 지도">
      <div className="panel-top">
        <div>
          <h2>신고 지도</h2>
          <span className="subtitle">{p.categoryLabel} · 지도를 넓게 보면 가까운 장소를 묶어 보여 줍니다{p.locationMissing ? ` · 위치 정보가 없는 ${p.locationMissing.toLocaleString('ko-KR')}건은 통계에만 들어갑니다` : ''}</span>
        </div>
        <div className="mini-segments" role="group" aria-label="지도에 표시할 값">
          {METRICS.map((m) => (
            <button
              key={m.id}
              type="button"
              className={p.metric === m.id ? 'selected' : ''}
              aria-pressed={p.metric === m.id}
              onClick={() => p.onMetric(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
      {p.onPointFilter && (
        <div className="point-filter" role="group" aria-label="지도에 보일 장소 (통계는 바뀌지 않음)">
          {(['all', 'mine', 'shared', 'interest'] as PointFilter[]).map((f) => {
            const available = p.filterAvailable?.[f] ?? f === 'all';
            return (
              <button key={f} type="button" className={p.pointFilter === f ? 'selected' : ''} aria-pressed={p.pointFilter === f}
                disabled={!available} title={available ? undefined : FILTER_REASON[f]}
                aria-describedby={available ? undefined : 'point-filter-hint'} onClick={() => p.onPointFilter!(f)}>
                {POINT_FILTER_LABEL[f]}
              </button>
            );
          })}
          <span className="cm-muted">지도에 보이는 장소만 바뀌고 통계는 그대로입니다{p.pointFilter && p.pointFilter !== 'all' ? ` · ${fmtInt(p.totalPoints ?? p.points.length)}곳 중 ${fmtInt(p.points.length)}곳` : ''}</span>
          {unavailableHint(p.filterAvailable) && <span className="cm-muted point-filter-hint" id="point-filter-hint">{unavailableHint(p.filterAvailable)}</span>}
        </div>
      )}
      <div className={`map-canvas${sdkState === 'error' ? ' map-fallback-mode' : ''}`} role="region" aria-label={sdkState === 'ready' ? '카카오 지도' : '지도 대신 장소 목록'}>
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
                <button
                  className="ghost-btn" type="button"
                  onClick={() => document.getElementById('cm-point-list')?.querySelector('button')?.focus()}
                >
                  장소 목록 보기
                </button>
              </span>
            </div>
            <p className="map-points-note">지도에 표시되는 장소와 같은 목록입니다.</p>
            <ul className="point-list" id="cm-point-list" aria-label="신고 장소 목록">
              {p.points.length === 0 && <li className="cm-muted" style={{ fontSize: 13 }}>표시할 장소가 없습니다.</li>}
              {p.points.map((pt) => (
                <li key={pt.key}>
                  <button
                    type="button"
                    aria-pressed={pt.key === p.selectedKey}
                    aria-label={`${pt.aggregate ? `${pt.point_count}곳 묶음` : (pt.address ?? '주소 없음')} 신고 ${pt.report_count}건${markLabel(p.marks?.get(pt.key))} 선택`}
                    onClick={() => p.onSelect(pt.key === p.selectedKey ? null : pt.key)}
                  >
                    <b>{pt.aggregate ? `가까운 ${pt.point_count}곳 묶음` : (pt.address ?? '주소 없음')}</b>
                    <MarkBadges mark={p.marks?.get(pt.key)} />
                    <small>{`신고 ${fmtInt(pt.report_count)}건`}</small>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {sdkState !== 'error' && (
        <div className="map-top">
          {sdkState !== 'ready' && <span className="map-status">장소 목록</span>}
          <button
            className="map-apply" type="button"
            disabled={!bbox}
            title={bbox ? '지금 지도에 보이는 지역의 통계만 봅니다' : '지도가 뜨면 쓸 수 있습니다'}
            onClick={() => bbox && p.onApplyView(bbox)}
          >
            보이는 지역만 보기
          </button>
        </div>
        )}
      {(p.filterAvailable?.mine || p.filterAvailable?.shared || p.filterAvailable?.interest) && (
        <p className="legend-marks" aria-label="지도 표시 안내">
          {p.filterAvailable.mine && (
            <span className="legend-mark" title="내 신고가 있는 곳">
              <i className="ring mine" aria-hidden="true" />내 신고가 있는 곳
            </span>
          )}
          {p.filterAvailable.shared && (
            <span className="legend-mark" title="다른 사람과 함께 신고한 곳">
              <i className="ring shared" aria-hidden="true" />함께 신고한 곳
            </span>
          )}
          {p.filterAvailable.interest && (
            <span className="legend-mark" title="관심 지역으로 표시한 곳">
              <span className="legend-star" aria-hidden="true">★</span>관심 지역
            </span>
          )}
        </p>
      )}
      {sdkState === 'ready' && (
          <div className="map-tools" role="group" aria-label="지도 확대·축소">
            <button className="map-button" type="button" aria-label="확대" onClick={() => handleRef.current?.zoomIn()}>+</button>
            <button className="map-button" type="button" aria-label="축소" onClick={() => handleRef.current?.zoomOut()}>−</button>
            <button className="map-button" type="button" aria-label="전국 보기" onClick={() => handleRef.current?.reset()}><Icon name="focus" /></button>
          </div>
        )}
        {sdkState !== 'error' && (
        <div className="map-bottom">
          <span className="legend-title" title={active.basis}>
            <b>{active.legend}</b>
            <span className="cm-muted">낮음</span>
            <i className="gradient-scale" aria-hidden="true" />
            <span className="cm-muted">높음</span>
            <span className="cm-muted">{active.basis}</span>
            {(p.filterAvailable?.mine || p.filterAvailable?.shared) && (
              <span className="legend-mark" title="내 신고가 있는 곳">
                <i className="ring mine" aria-hidden="true" />내 신고가 있는 곳
              </span>
            )}
            {p.filterAvailable?.shared && (
              <span className="legend-mark" title="다른 사람과 함께 신고한 곳">
                <i className="ring shared" aria-hidden="true" />함께 신고한 곳
              </span>
            )}
          </span>
          {sdkState !== 'ready' && <span className="map-demo-label">지도 대신 목록으로 보여 드립니다</span>}
        </div>
        )}
      </div>
      {sdkState === 'ready' && (
        <details className="map-point-alternative">
          <summary>장소 목록으로 보기 · {fmtInt(p.points.length)}곳</summary>
          <ul className="point-list" id="cm-point-list" aria-label="신고 장소 목록">
            {p.points.map((pt) => (
              <li key={pt.key}>
                <button type="button" aria-pressed={pt.key === p.selectedKey}
                  aria-label={`${pt.aggregate ? `${pt.point_count}곳 묶음` : (pt.address ?? '주소 없음')} 신고 ${pt.report_count}건${markLabel(p.marks?.get(pt.key))} 선택`}
                  onClick={() => p.onSelect(pt.key === p.selectedKey ? null : pt.key)}>
                  <b>{pt.aggregate ? `가까운 ${pt.point_count}곳 묶음` : (pt.address ?? '주소 없음')}</b>
                  <MarkBadges mark={p.marks?.get(pt.key)} />
                  <small>{`신고 ${fmtInt(pt.report_count)}건`}</small>
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '0 16px 14px', flexWrap: 'wrap' }}>
        <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: 13, color: 'var(--muted)' }}>
          <input
            type="checkbox" checked={p.autoRefresh}
            onChange={(e) => p.onAutoRefresh(e.target.checked)}
            style={{ width: 20, height: 20 }}
          />
          지도를 움직이면 통계도 바꾸기
        </label>
        <span className="cm-muted" style={{ fontSize: 12 }}>{p.autoRefresh ? '지도에 보이는 지역의 통계로 바로 바뀝니다.' : '지도를 움직여도 통계는 그대로입니다. ‘보이는 지역만 보기’를 누르면 바뀝니다.'}</span>
      </div>
    </article>
  );
}
