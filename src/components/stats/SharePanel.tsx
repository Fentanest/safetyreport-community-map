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
    <div className="share-panel" role="dialog" aria-label="통계 설정 공유">
      <p className="share-lead">링크에는 <b>표·그래프 설정과 조건</b>만 담깁니다. 숫자나 계정 정보는 담기지 않고, 링크를 연 사람의 화면에서 그때의 자료로 다시 계산합니다. 그래서 나중에 열면 숫자가 달라질 수 있습니다.</p>
      {unapplied && applied && (
        <fieldset className="radio-row">
          <legend>무엇을 공유할까요</legend>
          <label><input type="radio" name="share-which" checked={which === 'applied'} onChange={() => { setWhich('applied'); setConfirmed(false); setOut(null); }} />지금 보고 있는 결과</label>
          <label><input type="radio" name="share-which" checked={which === 'draft'} onChange={() => { setWhich('draft'); setConfirmed(false); setOut(null); }} />고치는 중인 설정(아직 반영 전)</label>
        </fieldset>
      )}
      {needConfirm && (
        <div className="share-warn" role="note">
          <ul>
            {ex.place && <li>주소({placeLabel(recipe)})는 링크에 담기지 않습니다. 받는 사람은 주소 조건 없이 보게 되어 지금 결과와 달라집니다.</li>}
            {ex.bbox && <li>지도에서 고른 범위는 링크에 담기지 않습니다. 받는 사람은 지도 범위 없이 보게 됩니다.</li>}
            {ex.mine && <li>‘내 신고’는 받는 사람 본인의 신고로 계산됩니다(로그인 필요). 내 신고 숫자는 전달되지 않습니다.</li>}
          </ul>
          <label className="inline-check"><input type="checkbox" checked={confirmed} onChange={(e) => { setConfirmed(e.target.checked); setOut(null); }} />확인했습니다. 이대로 공유할게요</label>
        </div>
      )}
      <div className="share-row">
        <button type="button" className="mini-btn primary-mini" disabled={needConfirm && !confirmed} onClick={make}>링크 만들기</button>
        <button type="button" className="link-btn" onClick={onClose}>닫기</button>
      </div>
      {out && 'error' in out && <p className="share-error" role="alert">{out.error}</p>}
      {out && 'url' in out && (
        <div className="share-result" role="status">
          <span>{out.copied ? '링크를 복사했습니다.' : '자동으로 복사하지 못했습니다. 아래 링크를 선택해 복사해 주세요.'}</span>
          <input ref={field} readOnly value={out.url} aria-label="공유 링크" onFocus={(e) => e.currentTarget.select()} />
        </div>
      )}
    </div>
  );
}
