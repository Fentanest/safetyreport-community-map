/**
 * R08: every applied condition, whichever control set it (지역 목록, 법규, 기관·담당자, 상세 필터, 지도 범위),
 * shown as a readable chip with its own × and a 전체 해제. Chips come from the REQUESTED scope compared with the
 * defaults — never from the unapplied draft; a pending/previous-data state is stated separately.
 */
export interface AppliedChip {
  id: 'dates' | 'category' | 'region' | 'law' | 'agency' | 'manager' | 'bbox';
  kind: string;
  label: string;
  onRemove: () => void;
}

interface Props {
  chips: AppliedChip[];
  onClearAll: () => void;
  /** a request for these conditions is running or waiting */
  pending: boolean;
  /** the numbers on screen still belong to these conditions (while pending or after a refresh error) */
  displayedLabel: string | null;
  /** the draft (dates etc.) differs from what is applied */
  unapplied: boolean;
  onApplyDraft: () => void;
}

export default function AppliedFilterChips(p: Props) {
  if (p.chips.length === 0 && !p.unapplied && !p.pending) return null;
  return (
    <section className="applied-bar" aria-label="적용된 조건">
      {p.chips.length > 0 && <span className="applied-title">적용 중 {p.chips.length}</span>}
      <ul className="applied-chips">
        {p.chips.map((c) => (
          <li key={c.id} className="applied-chip">
            <span className="applied-kind">{c.kind}</span>
            <span className="applied-label">{c.label}</span>
            <button type="button" className="applied-x" aria-label={`${c.kind} 조건 해제: ${c.label}`} title="이 조건 해제" onClick={c.onRemove}>×</button>
          </li>
        ))}
      </ul>
      {p.chips.length > 1 && <button type="button" className="mini-btn applied-clear" onClick={p.onClearAll}>전체 해제</button>}
      {p.unapplied && (
        <span className="applied-draft" role="note">적용하지 않은 변경이 있습니다 <button type="button" className="mini-btn" onClick={p.onApplyDraft}>적용</button></span>
      )}
      {p.pending && (
        <span className="applied-pending" role="status">
          새 조건으로 불러오는 중{p.displayedLabel ? ` · 지금 보이는 수치는 이전 조건(${p.displayedLabel})` : ''}
        </span>
      )}
    </section>
  );
}
