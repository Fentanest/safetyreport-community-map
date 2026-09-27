import { SIDO_LIST, sggOf, sidoOf } from '../data/regions';

interface Props {
  value: string | null;
  onChange: (code: string | null) => void;
  /** report counts per official code in the current data (shown next to names; empty codes stay selectable) */
  counts: Map<string, number>;
  selectStyle?: React.CSSProperties;
}

const withCount = (label: string, n: number | undefined) => (n ? `${label} (${n.toLocaleString('ko-KR')})` : label);

/** Two-step region choice on official 2026-07-01 codes: 시도, then (optionally) 시군구 within it. */
export default function RegionSelect({ value, onChange, counts, selectStyle }: Props) {
  const sido = sidoOf(value);
  const sgg = value && value.length === 5 ? value : '';
  const children = sido && sido !== '36' ? sggOf(sido) : [];
  return (
    <span className="region-select">
      <label>시도
        <select value={sido ?? ''} style={selectStyle} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">전국</option>
          {SIDO_LIST.map((s) => <option key={s.code} value={s.code}>{withCount(s.name, counts.get(s.code))}</option>)}
        </select>
      </label>
      <label>시군구
        <select value={sgg} style={selectStyle} disabled={!children.length}
          onChange={(e) => onChange(e.target.value || sido)}>
          <option value="">{sido ? (sido === '36' ? '세종특별자치시 전체' : '시도 전체') : '시도를 먼저 고르세요'}</option>
          {children.map((s) => <option key={s.code} value={s.code}>{withCount(s.name, counts.get(s.code))}</option>)}
        </select>
      </label>
    </span>
  );
}
