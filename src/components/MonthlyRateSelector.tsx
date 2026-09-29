import { TREND_RATES, TREND_RATE_LABEL, TREND_RATE_TOKEN, type TrendRate } from './trendMetrics';

/** S09: independent checkboxes (native inputs → Space toggles, checked state is announced). Presentation only:
 *  toggling never requests data. The checkbox is the single control of a metric's 전체/내 신고 lines. */
export default function MonthlyRateSelector({ value, onChange, withMine }: {
  value: readonly TrendRate[];
  onChange: (next: TrendRate[]) => void;
  withMine: boolean;
}) {
  const all = value.length === TREND_RATES.length;
  const toggle = (k: TrendRate, on: boolean) => onChange(on ? [...value, k] : value.filter((x) => x !== k));
  return (
    <fieldset className="rate-selector">
      <legend>표시할 지표 <small className="cm-muted">({value.length}/{TREND_RATES.length}{withMine ? ` · 선 ${value.length * 2}개` : ''})</small></legend>
      <div className="rate-checks">
        {TREND_RATES.map((k) => (
          <label key={k} className={`rate-check${value.includes(k) ? ' checked' : ''}`}>
            <input type="checkbox" checked={value.includes(k)} onChange={(e) => toggle(k, e.target.checked)} />
            <i className="rate-swatch" style={{ background: `var(--${TREND_RATE_TOKEN[k]})` }} aria-hidden="true" />
            {TREND_RATE_LABEL[k]}
          </label>
        ))}
      </div>
      <button type="button" className="link-btn" onClick={() => onChange(all ? [] : [...TREND_RATES])}>{all ? '전체 해제' : '전체 선택'}</button>
    </fieldset>
  );
}
