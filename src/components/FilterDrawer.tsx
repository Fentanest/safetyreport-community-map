import { useEffect, useMemo, useRef, useState } from 'react';
import { LAW_NONE } from '../domain/public';
import { CATEGORY_LABEL, LAW_UNKNOWN_LABEL, lawLabel, regionLabel, type DraftFilters } from '../state/filters';
import Icon from './icons';
import RegionSelect from './RegionSelect';

interface Props {
  open: boolean;
  draft: DraftFilters;
  onDraft: (d: DraftFilters) => void;
  appliedChips: string[];
  unsupportedNote: string | null;
  onClose: () => void;
  onApply: () => void;
  onReset: () => void;
  regionCounts: Map<string, number>;
  /** validation message of the last 적용 (the draft is kept) */
  dateError?: string | null;
  /** named laws of the current data (answered reports per law; null count = kept selection not in the data) */
  lawOptions: Array<{ law: string; count: number | null }>;
}

/** 위반법규 choice: a search box narrows the list; 전체 and 법규 미상 are always offered. */
function LawSelect({ value, options, onChange }: { value: string | null; options: Props['lawOptions']; onChange: (law: string | null) => void }) {
  const [q, setQ] = useState('');
  const needle = q.trim();
  const matches = useMemo(() => (needle ? options.filter(o => o.law.includes(needle)) : options), [options, needle]);
  // the current selection stays in the list so the select never shows a value it does not have
  const shown = useMemo(() => (value && !matches.some(o => o.law === value) ? [...options.filter(o => o.law === value), ...matches] : matches),
    [options, matches, value]);
  return (
    <>
      <label>위반법규 검색
        <input type="search" value={q} placeholder="예: 도로교통법 제32조" onChange={(e) => setQ(e.target.value)}
          aria-describedby="law-count" />
      </label>
      <label>위반법규
        <select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">전체</option>
          <option value={LAW_NONE}>{LAW_UNKNOWN_LABEL}</option>
          {shown.map((o) => (
            <option key={o.law} value={o.law}>{o.count === null ? o.law : `${o.law} (${o.count.toLocaleString('ko-KR')})`}</option>
          ))}
        </select>
      </label>
      <span id="law-count" className="cm-muted" style={{ fontSize: 12 }}>
        {needle ? `검색 결과 ${matches.length.toLocaleString('ko-KR')}개 · ` : ''}괄호 안은 답변 완료 건수입니다.
      </span>
    </>
  );
}

export default function FilterDrawer(p: Props) {
  const panelRef = useRef<HTMLElement>(null);
  const lastFocus = useRef<Element | null>(null);
  // R10: the key handler reads the LATEST close callback from a ref, so the open effect below depends on `open`
  // only. Before, it depended on `p.onClose` (a new function on every parent render), so each keystroke in a date
  // field re-ran cleanup (focus restore) + setup (focus the first button) and stole focus from the input.
  const onCloseRef = useRef(p.onClose);
  onCloseRef.current = p.onClose;

  useEffect(() => {
    if (!p.open) return;
    // remember where focus was once per opening, move it into the drawer once
    lastFocus.current = document.activeElement;
    const first = panelRef.current?.querySelector<HTMLElement>('button,input,select');
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
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
      const back = lastFocus.current;
      lastFocus.current = null;
      if (back instanceof HTMLElement && back.isConnected) back.focus();
    };
  }, [p.open]);

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
          <input type="date" value={p.draft.start} aria-invalid={!!p.dateError || undefined}
            aria-describedby={p.dateError ? 'drawer-date-error' : undefined}
            onChange={(e) => p.onDraft({ ...p.draft, start: e.target.value })} />
        </label>
        <label>종료일
          <input type="date" value={p.draft.end} aria-invalid={!!p.dateError || undefined}
            aria-describedby={p.dateError ? 'drawer-date-error' : undefined}
            onChange={(e) => p.onDraft({ ...p.draft, end: e.target.value })} />
        </label>
        {p.dateError && <p className="field-error" id="drawer-date-error" role="alert">{p.dateError} 입력한 날짜는 그대로 두었습니다.</p>}
        <label>분류
          <select value={p.draft.category} onChange={(e) => p.onDraft({ ...p.draft, category: e.target.value as DraftFilters['category'] })}>
            {(Object.keys(CATEGORY_LABEL) as Array<keyof typeof CATEGORY_LABEL>).map((c) => (
              <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
            ))}
          </select>
        </label>
        <RegionSelect value={p.draft.region_code} counts={p.regionCounts}
          onChange={(code) => p.onDraft({ ...p.draft, region_code: code })} />
        <LawSelect value={p.draft.law} options={p.lawOptions} onChange={(law) => p.onDraft({ ...p.draft, law })} />
        <div className="drawer-notice">
          신고 건수는 신고한 날, 답변·과태료는 답변 받은 날을 기준으로 셉니다. 1건뿐인 결과도 그대로 보여 드립니다.
          현재 선택: {regionLabel(p.draft.region_code)} · {CATEGORY_LABEL[p.draft.category]} · {lawLabel(p.draft.law)}
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
