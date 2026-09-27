import { useEffect, useRef } from 'react';
import { CATEGORY_LABEL, regionLabel, type DraftFilters } from '../state/filters';
import Icon from './icons';

interface Props {
  open: boolean;
  draft: DraftFilters;
  onDraft: (d: DraftFilters) => void;
  appliedChips: string[];
  unsupportedNote: string | null;
  onClose: () => void;
  onApply: () => void;
  onReset: () => void;
  regionOptions: Array<{ code: string | null; label: string }>;
}

export default function FilterDrawer(p: Props) {
  const panelRef = useRef<HTMLElement>(null);
  const lastFocus = useRef<Element | null>(null);

  useEffect(() => {
    if (!p.open) return;
    lastFocus.current = document.activeElement;
    panelRef.current?.querySelector('button,input,select') instanceof HTMLElement &&
      (panelRef.current.querySelector('button,input,select') as HTMLElement).focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        p.onClose();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const nodes = [...panelRef.current.querySelectorAll<HTMLElement>('button,input,select')].filter(
        (n) => !n.hasAttribute('disabled'),
      );
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      if (lastFocus.current instanceof HTMLElement) lastFocus.current.focus();
    };
  }, [p.open, p.onClose]);

  if (!p.open) return null;
  return (
    <>
      <div className="drawer-backdrop" onClick={p.onClose} aria-hidden="true" />
      <section ref={panelRef} className="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
        <div className="drawer-header">
          <h2 id="drawer-title">조건 선택</h2>
          <button className="icon-btn" type="button" onClick={p.onClose} aria-label="닫기">
            <Icon name="close" />
          </button>
        </div>
        <div className="chip-row" aria-label="적용된 조건">
          {p.appliedChips.length === 0 && <span className="cm-muted" style={{ fontSize: 13 }}>추가로 고른 조건이 없습니다.</span>}
          {p.appliedChips.map((c) => (
            <span key={c} className="cm-chip">{c}</span>
          ))}
        </div>
        <label>시작일
          <input type="date" value={p.draft.start} onChange={(e) => p.onDraft({ ...p.draft, start: e.target.value })} />
        </label>
        <label>종료일
          <input type="date" value={p.draft.end} onChange={(e) => p.onDraft({ ...p.draft, end: e.target.value })} />
        </label>
        <label>분류
          <select value={p.draft.category} onChange={(e) => p.onDraft({ ...p.draft, category: e.target.value as DraftFilters['category'] })}>
            {(Object.keys(CATEGORY_LABEL) as Array<keyof typeof CATEGORY_LABEL>).map((c) => (
              <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
            ))}
          </select>
        </label>
        <label>지역
          <select value={p.draft.region_code ?? ''} onChange={(e) => p.onDraft({ ...p.draft, region_code: e.target.value || null })}>
            {p.regionOptions.map((r) => (
              <option key={r.label} value={r.code ?? ''}>{r.label}</option>
            ))}
          </select>
        </label>
        <div className="drawer-notice">
          신고 건수는 신고한 날, 답변·과태료는 답변 받은 날을 기준으로 셉니다. 1건뿐인 결과도 그대로 보여 드립니다.
          현재 선택: {regionLabel(p.draft.region_code)} · {CATEGORY_LABEL[p.draft.category]}
        </div>
        {p.unsupportedNote && (
          <div className="banner warn" role="note">
            <span className="grow">{p.unsupportedNote}</span>
          </div>
        )}
        <div className="drawer-actions">
          <button className="ghost-btn" type="button" onClick={p.onReset}>초기화</button>
          <button className="primary-button" type="button" onClick={p.onApply}>적용</button>
        </div>
      </section>
    </>
  );
}
