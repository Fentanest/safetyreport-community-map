import { useRef, useState } from 'react';
import type { ChartSettings, StatsRecipe } from '../../state/statistics';
import { shareExclusions, shareUrl, toPayload } from '../../state/share';

/**
 * F02 share panel. Default: the APPLIED analysis on screen; the unapplied draft only when explicitly chosen.
 * Address / map range / 내 신고 are never silently changed: the sharer sees what the link leaves out (or re-computes
 * for the opener) and confirms it before a link is made. Clipboard failure → a selectable read-only field.
 */
export default function SharePanel({ applied, draft, unapplied, chart, view, placeLabel, onClose }: {
  applied: StatsRecipe | null;
  draft: StatsRecipe | null;
  unapplied: boolean;
  chart: ChartSettings;
  view: 'table' | 'chart';
  placeLabel: (r: StatsRecipe) => string | null;
  onClose: () => void;
}) {
  const [which, setWhich] = useState<'applied' | 'draft'>(applied ? 'applied' : 'draft');
  const [confirmed, setConfirmed] = useState(false);
  const [out, setOut] = useState<{ url: string; copied: boolean } | { error: string } | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const recipe = which === 'applied' ? applied : draft;
  if (!recipe) return null;
  const ex = shareExclusions(recipe);
  const needConfirm = ex.place || ex.bbox || ex.mine;
  const make = async () => {
    const r = shareUrl(toPayload(recipe, chart, view), window.location);
    if (!r.ok) { setOut({ error: r.reason }); return; }
    let copied = false;
    try { await navigator.clipboard.writeText(r.url); copied = true; } catch { copied = false; }
    setOut({ url: r.url, copied });
    if (!copied) requestAnimationFrame(() => field.current?.select());
  };
  return (
    <div className="share-panel" role="dialog" aria-label="분석 구성 공유">
      <p className="share-lead">링크에는 <b>행·열·지표·기간·조건·비교 대상·그래프 설정</b>만 들어갑니다. 결과 수치·이름·계정 정보는 들어가지 않고, 링크를 연 사람이 자기 권한으로 다시 계산합니다(나중에 열면 새 자료로 값이 달라질 수 있습니다).</p>
      {unapplied && applied && (
        <fieldset className="radio-row">
          <legend>공유할 구성</legend>
          <label><input type="radio" name="share-which" checked={which === 'applied'} onChange={() => { setWhich('applied'); setConfirmed(false); setOut(null); }} />지금 보이는 결과의 구성</label>
          <label><input type="radio" name="share-which" checked={which === 'draft'} onChange={() => { setWhich('draft'); setConfirmed(false); setOut(null); }} />작성 중인 구성(아직 적용 전)</label>
        </fieldset>
      )}
      {needConfirm && (
        <div className="share-warn" role="note">
          <ul>
            {ex.place && <li>주소 조건({placeLabel(recipe)})은 링크에 넣지 않습니다. 링크를 연 사람은 주소 없이 나머지 조건으로 계산하므로 지금 결과와 다릅니다.</li>}
            {ex.bbox && <li>적용한 지도 범위는 링크에 넣지 않습니다. 링크를 연 사람은 지도 범위 없이 계산합니다.</li>}
            {ex.mine && <li>‘내 신고’는 링크를 연 사람의 신고로 계산합니다(로그인 필요). 내 신고 값은 링크에 들어가지 않습니다.</li>}
          </ul>
          <label className="inline-check"><input type="checkbox" checked={confirmed} onChange={(e) => { setConfirmed(e.target.checked); setOut(null); }} />위 내용을 확인했고 이대로 공유합니다</label>
        </div>
      )}
      <div className="share-row">
        <button type="button" className="mini-btn primary-mini" disabled={needConfirm && !confirmed} onClick={make}>링크 만들기</button>
        <button type="button" className="link-btn" onClick={onClose}>닫기</button>
      </div>
      {out && 'error' in out && <p className="share-error" role="alert">{out.error}</p>}
      {out && 'url' in out && (
        <div className="share-result" role="status">
          <span>{out.copied ? '링크를 복사했습니다.' : '자동으로 복사하지 못했습니다. 아래 링크를 직접 복사해 주세요.'}</span>
          <input ref={field} readOnly value={out.url} aria-label="공유 링크" onFocus={(e) => e.currentTarget.select()} />
        </div>
      )}
    </div>
  );
}
