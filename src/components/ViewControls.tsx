import { VIEW_LABEL, type ViewMode } from '../state/view';

interface Props {
  compareOn: boolean;
  onCompare: (on: boolean) => void;
  /** reason the toggle cannot be used right now (e.g. login not configured) */
  compareDisabledReason: string | null;
  /** personal data hidden because briefing mode is on */
  briefingHidden: boolean;
  view: ViewMode;
  onView: (v: ViewMode) => void;
}

const MODES: ViewMode[] = ['both', 'map', 'stats'];

/** Data wiring: Sol · visual implementation: Muse (docs/personal-comparison.md §5.1–5.2). */
export default function ViewControls(p: Props) {
  return (
    <div className="view-controls">
      <span className="compare-wrap">
        <label className={`compare-toggle${p.compareDisabledReason ? ' disabled' : ''}`} title={p.compareDisabledReason ?? '같은 조건의 내 신고를 나란히 표시합니다.'}>
          <input
            type="checkbox" role="switch" checked={p.compareOn && !p.compareDisabledReason}
            aria-checked={p.compareOn && !p.compareDisabledReason}
            disabled={!!p.compareDisabledReason}
            onChange={(e) => p.onCompare(e.target.checked)}
          />
          <span className="switch" aria-hidden="true" />
          <span>내 데이터 함께 보기</span>
          {p.briefingHidden && <small className="cm-muted">브리핑 중 숨김</small>}
        </label>
        {p.compareDisabledReason && (
          <small className="compare-disabled-note" role="note">{p.compareDisabledReason}</small>
        )}
      </span>
      <div className="segments view-switch" role="group" aria-label="보기 전환">
        {MODES.map((mode) => (
          <button key={mode} type="button" className={p.view === mode ? 'selected' : ''} aria-pressed={p.view === mode} onClick={() => p.onView(mode)}>
            {VIEW_LABEL[mode]}
          </button>
        ))}
      </div>
    </div>
  );
}
