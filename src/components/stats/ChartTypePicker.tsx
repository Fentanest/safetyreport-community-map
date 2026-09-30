import { useCallback, useRef, useState } from 'react';
import FloatingMenu from '../FloatingMenu';
import { CHART_LABEL, PICKER_TYPES, type ChartPlan, type ChartSettings, type ChartType, type PickerType } from '../../state/statistics';

/**
 * 그래프 유형 선택기 (replaces the native select). Everything it says comes from plan.availability — the same judgment
 * planChart uses for `compatible` — so an item is never offered when the chart would refuse it, and the reason shown
 * for an unavailable item is the rule that actually blocks it.
 * Choosing a type only changes the display setting (no request). An unavailable item changes nothing: it shows how to
 * make it available (rows/columns/metrics/population are never changed for the user).
 */
export default function ChartTypePicker({ value, plan, autoType, onChange }: {
  value: ChartSettings['type'];
  plan: ChartPlan;
  /** what 자동 would draw now */
  autoType: ChartType;
  onChange: (type: ChartSettings['type']) => void;
}) {
  const [open, setOpen] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => { setOpen(false); setHint(null); }, []);
  const usable = PICKER_TYPES.filter((t) => plan.availability[t].ok);
  const blocked = PICKER_TYPES.filter((t) => !plan.availability[t].ok);
  const groups: Array<{ reason: string; types: PickerType[] }> = [];
  for (const t of blocked) {
    const reason = plan.availability[t].reason ?? '';
    const g = groups.find((x) => x.reason === reason);
    if (g) g.types.push(t); else groups.push({ reason, types: [t] });
  }
  const current = value === 'auto' ? `자동 · ${CHART_LABEL[autoType]}` : CHART_LABEL[value];
  const pick = (t: ChartSettings['type']) => { onChange(t); close(); buttonRef.current?.focus(); };
  const explain = (t: PickerType) => {
    const a = plan.availability[t];
    setHint(`${CHART_LABEL[t]}: ${a.fix ?? a.reason ?? ''}`);
  };
  return (
    <span className="inline-select chart-type-picker">
      <span id="chart-type-label">유형</span>
      <button type="button" ref={buttonRef} className="picker-btn" aria-haspopup="menu" aria-expanded={open}
        aria-labelledby="chart-type-label chart-type-value" onClick={() => (open ? close() : setOpen(true))}>
        <span id="chart-type-value">{current}</span><span aria-hidden="true" className="picker-caret">▾</span>
      </button>
      <FloatingMenu anchor={buttonRef.current} open={open} onClose={close} label="그래프 유형" className="chart-menu" minWidth={220}>
        <b className="floating-menu-title" aria-hidden="true">사용할 수 있음</b>
        <button type="button" role="menuitemradio" tabIndex={-1} aria-checked={value === 'auto'}
          className={`floating-menu-item${value === 'auto' ? ' selected' : ''}`} onClick={() => pick('auto')}>
          자동 · {CHART_LABEL[autoType]}
        </button>
        {usable.map((t) => (
          <button key={t} type="button" role="menuitemradio" tabIndex={-1} aria-checked={value === t}
            className={`floating-menu-item${value === t ? ' selected' : ''}`} onClick={() => pick(t)}>
            {CHART_LABEL[t]}
          </button>
        ))}
        {blocked.length > 0 && <b className="floating-menu-title chart-menu-blocked-title" aria-hidden="true">현재 설정에서는 사용할 수 없음</b>}
        {/* a reason shared by several charts (e.g. "총 3개 기준") is stated once; each chart then shows only its fix */}
        {groups.map(({ reason, types }) => (
          <div key={reason} className="chart-menu-group">
            {types.length > 1 && <p className="chart-menu-reason chart-menu-shared">{reason}</p>}
            {types.map((t) => {
              const a = plan.availability[t];
              return (
                <button key={t} type="button" role="menuitemradio" tabIndex={-1} aria-checked={false} aria-disabled="true"
                  className="floating-menu-item chart-menu-blocked" onClick={() => explain(t)}
                  aria-label={`${CHART_LABEL[t]}, 사용할 수 없음. ${a.reason ?? ''} ${a.fix ?? ''}`.trim()}>
                  <span className="chart-menu-name">{CHART_LABEL[t]}</span>
                  {types.length === 1 && <small className="chart-menu-reason">{a.reason}</small>}
                  {a.fix && <small className="chart-menu-fix">{a.fix}</small>}
                </button>
              );
            })}
          </div>
        ))}
        {hint && <p className="chart-menu-hint" role="status">{hint}</p>}
      </FloatingMenu>
    </span>
  );
}
