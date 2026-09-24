import { useState } from 'react';
import type { DashboardData, PublicEntity, PublicPoint } from '../domain/public';
import { fmtCoord6, fmtDate, fmtInt, fmtPercent } from './format';
import Icon from './icons';

interface Props {
  data: DashboardData | null;
  point: PublicPoint | null;
  scopeLabel: string;
  onAnalyzePoint: (pt: PublicPoint) => void;
  onPickEntity: (kind: 'agency' | 'manager', entity: PublicEntity) => void;
  toast: (msg: string) => void;
}

type Tab = 'overview' | 'outcome' | 'entities';

function pct(a: number, d: number): number | null {
  return d > 0 ? (a / d) * 100 : null;
}

export default function InsightPanel(p: Props) {
  const [tab, setTab] = useState<Tab>('overview');
  const [fullCoord, setFullCoord] = useState(false);
  const d = p.data;
  const o = d?.overview ?? null;

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      p.toast(`${label}을(를) 복사했습니다.`);
    } catch {
      p.toast('복사에 실패했습니다. 직접 선택해 복사해 주세요.');
    }
  };

  const title = p.point ? (p.point.aggregate ? `${p.point.point_count}곳 집계 표시` : (p.point.address ?? '주소 미상')) : '대한민국 전국';
  const reportN = p.point ? p.point.report_count : (o?.report_count.value ?? null);
  const accPct = p.point
    ? p.point.outcomes && p.point.outcomes.result_known > 0
      ? ((p.point.outcomes.accepted + p.point.outcomes.partial) / p.point.outcomes.result_known) * 100
      : null
    : (o?.accepted_including_partial.value ?? null);
  const contrib = o?.contributor_count.value ?? null;

  const agencies = d?.agencies ?? [];
  const rel: PublicEntity[] = p.point ? [] : agencies.slice(0, 3);
  const selectedOutcomes = p.point ? p.point.outcomes : o?.outcomes;

  return (
    <aside className="cm-panel insight" aria-label="선택 범위 인사이트">
      <div className="insight-top">
        <span className="overline">REGION INSIGHT</span>
        <span className="cm-chip">{p.point?.aggregate ? '여러 지점 집계' : p.point ? '선택 지점' : '선택 범위'}</span>
      </div>
      <h2>{title}</h2>
      <p className="subtitle" style={{ margin: 0 }}>
        {p.scopeLabel}{d?.meta.sample ? ' · 합성 예시 · demo' : ' · 공개 제공 표본'}
      </p>
      <div className="insight-metrics">
        <div><b className="cm-number">{fmtInt(reportN)}</b><small>신고 접수 (신고일)</small></div>
        <div><b className="cm-number">{fmtPercent(accPct)}</b><small>수용·일부수용 (완료일)</small></div>
        <div><b className="cm-number">{fmtInt(contrib)}</b><small>기여 계정 (현재 전체 범위)</small></div>
      </div>
      {p.point && (
        <div className="insight-section" aria-label="지점 상세">
          <div className="section-title"><h3>{p.point.aggregate ? '집계 표시 상세' : '지점 상세'}</h3><span>{p.point.aggregate ? '지도 표시 중심점 · 원좌표 아님' : '원좌표 그대로 · 격자화 없음'}</span></div>
          {p.point.aggregate ? (
            <p className="insight-copy">{fmtInt(p.point.point_count ?? null)}개 원 지점을 묶어 표시합니다. 각 지점의 원좌표는 지도를 확대하거나 범위를 적용해 확인할 수 있습니다.</p>
          ) : (
            <div className="addr-row">
              <code>{fullCoord ? `${p.point.lat}, ${p.point.lng}` : `${fmtCoord6(p.point.lat)}, ${fmtCoord6(p.point.lng)}`}</code>
              <button className="mini-btn" type="button" onClick={() => setFullCoord((v) => !v)}>{fullCoord ? '6자리로' : '전체 정밀도'}</button>
              <button className="mini-btn" type="button" onClick={() => copy(`${p.point!.lat},${p.point!.lng}`, '좌표 원값')}>좌표 복사</button>
              <button className="mini-btn" type="button" onClick={() => copy(p.point!.address ?? '', '주소')}>주소 복사</button>
            </div>
          )}
          <div className="distribution">
            <div><span>처리완료</span><b>{fmtInt(p.point.completed_count)}</b><small>완료일</small></div>
            <div><span>과태료 처분 신고</span><b>{fmtInt(p.point.fine_count)}</b><small>완료일</small></div>
            <div><span>결과 미확인</span><b>{fmtInt(p.point.outcomes?.result_unknown ?? null)}</b><small>결측 표시</small></div>
          </div>
          <button className="wide-button" type="button" onClick={() => p.onAnalyzePoint(p.point!)}>
            {p.point.aggregate ? '집계 표시 범위로 분석 →' : '이 지점 범위로 분석 →'}
          </button>
        </div>
      )}
      <div className="tabs" role="tablist" aria-label="인사이트 탭">
        {([['overview', '개요'], ['outcome', '처리결과'], ['entities', '기관·담당자']] as Array<[Tab, string]>).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      {tab === 'overview' && (
        <div className="insight-section">
          <div className="section-title"><h3>데이터를 읽는 기준</h3><span className="cm-muted"><Icon name="info" size={14} /></span></div>
          <p className="insight-copy">
            신고 건수와 처리결과는 서로 다른 날짜 기준으로 집계합니다. 표본이 {reportN === 1 ? '1건인 지점도' : '적은 지점도'} 그대로 표시합니다.
          </p>
          <div className="info-note"><span>계정 이메일·UUID·신고번호·차량 원번호는 공개 통계에 포함되지 않습니다.</span></div>
        </div>
      )}
      {tab === 'outcome' && (
        <div className="insight-section">
          <div className="section-title"><h3>처리결과</h3><span>처리완료일 · 분모 D</span></div>
          {selectedOutcomes ? (
            <div className="distribution">
              <div><span><i className="dot" style={{ background: 'var(--accepted)' }} />수용</span><b>{fmtInt(selectedOutcomes.accepted)}</b><small>{fmtPercent(pct(selectedOutcomes.accepted, selectedOutcomes.result_known))}</small></div>
              <div><span><i className="dot" style={{ background: 'var(--partial)' }} />일부수용</span><b>{fmtInt(selectedOutcomes.partial)}</b><small>{fmtPercent(pct(selectedOutcomes.partial, selectedOutcomes.result_known))}</small></div>
              <div><span><i className="dot" style={{ background: 'var(--rejected)' }} />불수용</span><b>{fmtInt(selectedOutcomes.rejected)}</b><small>{fmtPercent(pct(selectedOutcomes.rejected, selectedOutcomes.result_known))}</small></div>
            </div>
          ) : <span className="cm-muted" style={{ fontSize: 13 }}>이 지점의 결과 교차자료가 제공되지 않았습니다.</span>}
          <p className="insight-copy">결과 미확인 {fmtInt(selectedOutcomes?.result_unknown ?? null)}건은 분모에서 제외하고 별도 표시합니다.</p>
        </div>
      )}
      {tab === 'entities' && (
        <div className="insight-section">
          <div className="section-title"><h3>기관·담당자</h3><span>전체 성명 + 기관</span></div>
          {rel.length === 0 && <span className="cm-muted" style={{ fontSize: 13 }}>{p.point ? '이 지점의 기관·담당자 교차자료가 아직 제공되지 않았습니다.' : '표시할 기관·담당자가 없습니다.'}</span>}
          <div className="distribution">
            {rel.map((e) => (
              <div key={e.key}>
                <span>
                  <button
                    type="button" className="mini-btn" style={{ padding: '4px 8px' }}
                    title="이 기관·담당자 조건으로 조회"
                    onClick={() => p.onPickEntity(e.manager_name ? 'manager' : 'agency', e)}
                    disabled={!e.agency_key || (!!e.manager_name && !e.manager_key)}
                  >
                    {e.manager_name ? `${e.manager_name} · ${e.agency_name}` : e.agency_name}
                  </button>
                </span>
                <b>{fmtInt(e.completed_count)}</b>
                <small>완료</small>
              </div>
            ))}
          </div>
        </div>
      )}
      {!p.point && (
        <button
          className="wide-button" type="button"
          onClick={() => document.getElementById('entities')?.scrollIntoView({ behavior: 'auto' })}
        >
          지역 분석 펼치기 →
        </button>
      )}
      {d && (
        <p className="cm-muted" style={{ fontSize: 12, margin: 0 }}>
          {fmtDate(d.scope.start)} — {fmtDate(d.scope.end)} · {d.meta.coverage_note}
        </p>
      )}
    </aside>
  );
}
