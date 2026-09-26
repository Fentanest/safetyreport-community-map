import { useEffect, useRef, useState } from 'react';
import type { PublicPoint } from '../domain/public';
import { createKakaoMap, kakaoKey, type KakaoHandle } from '../lib/kakao';
import type { MapMetric } from '../state/filters';
import { fmtCoord6, fmtInt } from './format';
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
}

const METRICS: Array<{ id: MapMetric; label: string; legend: string; basis: string }> = [
  { id: 'reports', label: '신고량', legend: '신고량', basis: '신고일 기준 · 분모: 선택 범위 신고 R' },
  { id: 'acceptance', label: '수용 비중', legend: '수용 · 일부수용 비중', basis: '처리완료일 기준 · 분모 D=결과 확인건' },
  { id: 'fine', label: '과태료', legend: '과태료 비중', basis: '처리완료일 기준 · 분모 C=처리완료건' },
];

function metricValue(p: PublicPoint, m: MapMetric): number | null {
  if (m === 'reports') return p.report_count;
  if (m === 'acceptance') {
    const o = p.outcomes;
    return o && o.result_known > 0 ? ((o.accepted + o.partial) / o.result_known) * 100 : null;
  }
  if (p.fine_count == null || (p.completed_count ?? 0) === 0) return null;
  return (p.fine_count / (p.completed_count ?? 1)) * 100;
}

export default function MapPanel(p: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<KakaoHandle | null>(null);
  const [sdkState, setSdkState] = useState<'idle' | 'ready' | 'error'>(kakaoKey() ? 'idle' : 'error');
  const [sdkError, setSdkError] = useState<string | null>(
    kakaoKey() ? null : 'Kakao JavaScript 키가 설정되지 않아 실제 지도를 불러올 수 없습니다. 아래 지점 목록에서 동일하게 탐색할 수 있습니다.',
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
        label: `${pt.aggregate ? `${pt.point_count}곳 집계 표시` : (pt.address ?? '주소 미상')} · 신고 ${pt.report_count}건`,
        count: pt.report_count,
        selected: pt.key === p.selectedKey,
        metricValue: metricValue(pt, p.metric),
      })),
    );
  }, [p.points, p.selectedKey, p.metric, sdkState]);

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
      setSdkError('Kakao JavaScript 키가 설정되지 않아 실제 지도를 불러올 수 없습니다. 아래 지점 목록에서 동일하게 탐색할 수 있습니다.');
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
            label: `${pt.aggregate ? `${pt.point_count}곳 집계 표시` : (pt.address ?? '주소 미상')} · 신고 ${pt.report_count}건`,
            count: pt.report_count, selected: pt.key === p.selectedKey, metricValue: metricValue(pt, p.metric),
          })),
        );
      })
      .catch((e: Error) => {
        setSdkState('error');
        setSdkError(e.message);
      });
  };

  return (
    <article className="cm-panel map-card" aria-label="전국 신고 분포 지도">
      <div className="panel-top">
        <div>
          <h2>전국 신고 분포</h2>
          <span className="subtitle">{p.categoryLabel} · 저줌 집계 표시는 원좌표와 다릅니다{p.locationMissing ? ` · 좌표 없는 ${p.locationMissing.toLocaleString('ko-KR')}건은 통계에만 포함` : ''}</span>
        </div>
        <div className="mini-segments" role="group" aria-label="지도 지표">
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
      <div className="map-canvas" role="region" aria-label={sdkState === 'ready' ? 'Kakao 실제 지도' : '지도 대체 영역: 지점 목록으로 동일 탐색 가능'}>
        {kakaoKey() && <div ref={hostRef} className="map-sdk-host" aria-hidden={sdkState !== 'ready'} />}
        {sdkState === 'error' && (
          <div className="map-fallback">
            <div className="map-error-card" role="alert">
              <h3>실지도를 불러오지 못했습니다</h3>
              <p>{sdkError} 다른 통계 화면은 계속 사용할 수 있습니다. 지도의 저작권·attribution 영역은 가리지 않습니다.</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="ghost-btn" type="button" onClick={retry}>다시 시도</button>
                <button
                  className="ghost-btn" type="button"
                  onClick={() => document.getElementById('cm-point-list')?.querySelector('button')?.focus()}
                >
                  지점 목록으로 이동
                </button>
              </div>
            </div>
            <p className="map-points-note">접근 가능한 대체 수단 — 아래 목록은 지도 마커와 같은 지점·건수입니다. 집계 표시의 중심점은 원좌표가 아닙니다.</p>
            <ul className="point-list" id="cm-point-list" aria-label="신고 지점 목록">
              {p.points.length === 0 && <li className="cm-muted" style={{ fontSize: 13 }}>표시할 지점이 없습니다.</li>}
              {p.points.map((pt) => (
                <li key={pt.key}>
                  <button
                    type="button"
                    aria-pressed={pt.key === p.selectedKey}
                    aria-label={`${pt.aggregate ? `${pt.point_count}곳 집계 표시` : (pt.address ?? '주소 미상')} 신고 ${pt.report_count}건 선택`}
                    onClick={() => p.onSelect(pt.key === p.selectedKey ? null : pt.key)}
                  >
                    <b>{pt.aggregate ? `${pt.point_count}곳 집계 표시` : (pt.address ?? '주소 미상')}</b>
                    <small>{pt.aggregate ? `신고 ${fmtInt(pt.report_count)}건 · 표시 중심점(원좌표 아님)` : `신고 ${fmtInt(pt.report_count)}건 · ${fmtCoord6(pt.lat)}, ${fmtCoord6(pt.lng)} · 원좌표 그대로`}</small>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="map-top">
          <span className="map-status">{sdkState === 'ready' ? 'Kakao 실제 지도' : '지점 분포 미리보기'}</span>
          <button
            className="map-apply" type="button"
            disabled={!bbox}
            title={bbox ? '현재 지도 화면 범위를 분석 조건으로 적용합니다.' : '실지도가 연결되면 화면 범위를 적용할 수 있습니다.'}
            onClick={() => bbox && p.onApplyView(bbox)}
          >
            이 화면 범위 적용
          </button>
        </div>
        {sdkState === 'ready' && (
          <div className="map-tools" role="group" aria-label="지도 조작">
            <button className="map-button" type="button" aria-label="확대" onClick={() => handleRef.current?.zoomIn()}>+</button>
            <button className="map-button" type="button" aria-label="축소" onClick={() => handleRef.current?.zoomOut()}>−</button>
            <button className="map-button" type="button" aria-label="전국으로 초기화" onClick={() => handleRef.current?.reset()}><Icon name="focus" /></button>
          </div>
        )}
        <div className="map-bottom">
          <span className="legend-title" title={active.basis}>
            <b>{active.legend}</b>
            <span className="cm-muted">낮음</span>
            <i className="gradient-scale" aria-hidden="true" />
            <span className="cm-muted">높음</span>
            <span className="cm-muted">{active.basis}</span>
          </span>
          <span className="map-demo-label">{sdkState === 'ready' ? 'Kakao ©' : '지도 연결 안 됨 · 지점 목록 제공'}</span>
        </div>
      </div>
      {sdkState === 'ready' && (
        <details className="map-point-alternative">
          <summary>지도 지점 목록으로 탐색 · {fmtInt(p.points.length)}곳</summary>
          <ul className="point-list" id="cm-point-list" aria-label="신고 지점 목록">
            {p.points.map((pt) => (
              <li key={pt.key}>
                <button type="button" aria-pressed={pt.key === p.selectedKey}
                  onClick={() => p.onSelect(pt.key === p.selectedKey ? null : pt.key)}>
                  <b>{pt.aggregate ? `${pt.point_count}곳 집계 표시` : (pt.address ?? '주소 미상')}</b>
                  <small>{pt.aggregate ? `신고 ${fmtInt(pt.report_count)}건 · 표시 중심점(원좌표 아님)` : `신고 ${fmtInt(pt.report_count)}건 · ${fmtCoord6(pt.lat)}, ${fmtCoord6(pt.lng)} · 원좌표 그대로`}</small>
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
          화면 범위 자동 갱신{p.autoRefresh ? ' 켜짐' : ' 꺼짐'}
        </label>
        <span className="cm-muted" style={{ fontSize: 12 }}>{p.autoRefresh ? '지도를 움직이면 화면 범위를 분석 조건으로 적용합니다.' : '지도를 움직여도 전국 KPI는 바뀌지 않습니다. 버튼으로 명시 적용하세요.'}</span>
      </div>
    </article>
  );
}
