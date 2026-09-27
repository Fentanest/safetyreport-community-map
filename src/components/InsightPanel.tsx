import { useState } from 'react';
import type { DashboardData, PublicEntity, PublicPoint } from '../domain/public';
import type { PointMark } from '../state/pointMarks';
import { fmtCoord6, fmtDate, fmtInt, fmtPercent } from './format';
import Icon from './icons';

interface Props {
  data: DashboardData | null;
  point: PublicPoint | null;
  scopeLabel: string;
  onAnalyzePoint: (pt: PublicPoint) => void;
  onPickEntity: (kind: 'agency' | 'manager', entity: PublicEntity) => void;
  toast: (msg: string) => void;
  /** personal display mark of the selected point (comparison on) */
  mark?: PointMark | null;
  onClose?: () => void;
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
      p.toast(`${label} 복사했습니다.`);
    } catch {
      p.toast('복사에 실패했습니다. 직접 선택해 복사해 주세요.');
    }
  };

  const title = p.point ? (p.point.aggregate ? `가까운 ${p.point.point_count}곳 묶음` : (p.point.address ?? '주소 없음')) : '전국';
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
    <aside className="cm-panel insight" aria-label="선택한 장소">
      <div className="insight-top">
        <span className="overline">선택한 장소</span>
        <span className="cm-chip">{p.point?.aggregate ? '여러 장소' : p.point ? '선택한 장소' : '전체'}</span>
      </div>
      <h2>{title}</h2>
      {p.point && p.mark?.mine && (
        <p className="mine-note" role="note">
          이 {p.point.aggregate ? '묶음' : '장소'}에 내 신고 {fmtInt(p.mark.mineCount)}건 · {p.mark.shared ? '다른 사람과 함께 신고한 곳' : '나만 신고한 곳'}
        </p>
      )}
      {p.point && p.onClose && <button className="mini-btn" type="button" onClick={p.onClose}>닫기</button>}
      <p className="subtitle" style={{ margin: 0 }}>
        {p.scopeLabel}{d?.meta.sample ? ' · 예시 데이터' : ''}
      </p>
      <div className="insight-metrics">
        <div><b className="cm-number">{fmtInt(reportN)}</b><small>신고</small></div>
        <div><b className="cm-number">{fmtPercent(accPct)}</b><small>수용률</small></div>
        <div><b className="cm-number">{fmtInt(contrib)}</b><small>참여한 사람 (전체)</small></div>
      </div>
      {p.point && (
        <div className="insight-section" aria-label="장소 정보">
          <div className="section-title"><h3>{p.point.aggregate ? '묶음 정보' : '장소 정보'}</h3><span>{p.point.aggregate ? '가까운 장소를 묶어 표시' : '신고에 입력된 위치'}</span></div>
          {p.point.aggregate ? (
            <p className="insight-copy">가까운 장소 {fmtInt(p.point.point_count ?? null)}곳을 묶었습니다. 지도를 확대하면 각각 볼 수 있습니다.</p>
          ) : (
            <div className="addr-row">
              <code>{fullCoord ? `${p.point.lat}, ${p.point.lng}` : `${fmtCoord6(p.point.lat)}, ${fmtCoord6(p.point.lng)}`}</code>
              <button className="mini-btn" type="button" onClick={() => setFullCoord((v) => !v)}>{fullCoord ? '짧게' : '자세히'}</button>
              <button className="mini-btn" type="button" onClick={() => copy(`${p.point!.lat},${p.point!.lng}`, '좌표를')}>좌표 복사</button>
              <button className="mini-btn" type="button" onClick={() => copy(p.point!.address ?? '', '주소를')}>주소 복사</button>
            </div>
          )}
          <div className="distribution">
            <div><span>답변 완료</span><b>{fmtInt(p.point.completed_count)}</b><small>건</small></div>
            <div><span>과태료 부과</span><b>{fmtInt(p.point.fine_count)}</b><small>건</small></div>
            <div><span>결과 모름</span><b>{fmtInt(p.point.outcomes?.result_unknown ?? null)}</b><small>건</small></div>
          </div>
          <button className="wide-button" type="button" onClick={() => p.onAnalyzePoint(p.point!)}>
            {p.point.aggregate ? '이 묶음만 보기 →' : '이 장소만 보기 →'}
          </button>
        </div>
      )}
      <div className="tabs" role="tablist" aria-label="장소 정보 탭">
        {([['overview', '안내'], ['outcome', '처리 결과'], ['entities', '기관·담당자']] as Array<[Tab, string]>).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      {tab === 'overview' && (
        <div className="insight-section">
          <div className="section-title"><h3>숫자 읽는 법</h3><span className="cm-muted"><Icon name="info" size={14} /></span></div>
          <p className="insight-copy">
            신고는 신고한 날, 처리 결과는 답변 받은 날을 기준으로 셉니다. 신고가 {reportN === 1 ? '1건뿐인 곳도' : '적은 곳도'} 그대로 보여 드립니다.
          </p>
          <div className="info-note"><span>이메일, 계정 정보, 신고번호, 차량 번호 전체는 공개하지 않습니다.</span></div>
        </div>
      )}
      {tab === 'outcome' && (
        <div className="insight-section">
          <div className="section-title"><h3>처리 결과</h3><span>결과가 나온 신고 중</span></div>
          {selectedOutcomes ? (
            <div className="distribution">
              <div><span><i className="dot" style={{ background: 'var(--accepted)' }} />수용</span><b>{fmtInt(selectedOutcomes.accepted)}</b><small>{fmtPercent(pct(selectedOutcomes.accepted, selectedOutcomes.result_known))}</small></div>
              <div><span><i className="dot" style={{ background: 'var(--partial)' }} />일부 수용</span><b>{fmtInt(selectedOutcomes.partial)}</b><small>{fmtPercent(pct(selectedOutcomes.partial, selectedOutcomes.result_known))}</small></div>
              <div><span><i className="dot" style={{ background: 'var(--rejected)' }} />불수용</span><b>{fmtInt(selectedOutcomes.rejected)}</b><small>{fmtPercent(pct(selectedOutcomes.rejected, selectedOutcomes.result_known))}</small></div>
            </div>
          ) : <span className="cm-muted" style={{ fontSize: 13 }}>이 장소의 처리 결과는 아직 없습니다.</span>}
          <p className="insight-copy">결과를 알 수 없는 {fmtInt(selectedOutcomes?.result_unknown ?? null)}건은 비율 계산에서 뺐습니다.</p>
        </div>
      )}
      {tab === 'entities' && (
        <div className="insight-section">
          <div className="section-title"><h3>기관·담당자</h3><span>이름과 소속 기관</span></div>
          {rel.length === 0 && <span className="cm-muted" style={{ fontSize: 13 }}>{p.point ? '이 장소의 기관·담당자 정보는 아직 없습니다.' : '표시할 기관·담당자가 없습니다.'}</span>}
          <div className="distribution">
            {rel.map((e) => (
              <div key={e.key}>
                <span>
                  <button
                    type="button" className="mini-btn" style={{ padding: '4px 8px' }}
                    title="이 기관·담당자만 보기"
                    onClick={() => p.onPickEntity(e.manager_name ? 'manager' : 'agency', e)}
                    disabled={!e.agency_key || (!!e.manager_name && !e.manager_key)}
                  >
                    {e.manager_name ? `${e.manager_name} · ${e.agency_name}` : e.agency_name}
                  </button>
                </span>
                <b>{fmtInt(e.completed_count)}</b>
                <small>답변</small>
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
          지역별로 보기 →
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
