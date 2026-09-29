interface Props {
  compareOn: boolean;
  onCompare: (on: boolean) => void;
  /** reason the toggle cannot be used right now (e.g. login not configured) */
  compareDisabledReason: string | null;
  /** personal data hidden because briefing mode is on */
  briefingHidden: boolean;
}

// U04: the layout switch (지도+통계 / 지도 크게 / 통계 크게) was removed; only the comparison toggle stays.
/** Data wiring: Sol · visual implementation: Muse (docs/personal-comparison.md §5.1–5.2). */
export default function ViewControls(p: Props) {
  return (
    <div className="view-controls">
      <span className="compare-wrap">
        <label className={`compare-toggle${p.compareDisabledReason ? ' disabled' : ''}`} title={p.compareDisabledReason ?? '같은 조건으로 내 신고를 함께 보여 드립니다'}>
          <input
            type="checkbox" role="switch" checked={p.compareOn && !p.compareDisabledReason}
            aria-checked={p.compareOn && !p.compareDisabledReason}
            disabled={!!p.compareDisabledReason}
            onChange={(e) => p.onCompare(e.target.checked)}
          />
          <span className="switch" aria-hidden="true" />
          <span>내 신고와 비교</span>
          {p.briefingHidden && <small className="cm-muted">브리핑 중에는 숨김</small>}
        </label>
        {p.compareDisabledReason && (
          <small className="compare-disabled-note" role="note">{p.compareDisabledReason}</small>
        )}
      </span>
    </div>
  );
}
