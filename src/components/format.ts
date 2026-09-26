export const fmtInt = (v: number | null | undefined): string =>
  v == null ? '—' : v.toLocaleString('ko-KR');

export const fmtPct1 = (v: number | null | undefined): string =>
  v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(1)}`;

export const fmtPercent = (v: number | null | undefined): string =>
  v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(1)}%`;

export const fmtDate = (iso: string): string => {
  const [y, m, d] = iso.split('-');
  return `${y}.${m}.${d}`;
};

export const fmtMonth = (ym: string): string => {
  const [y, m] = ym.split('-');
  return `${y}.${m}`;
};

export const fmtCoord6 = (v: number): string => v.toFixed(6);

/** Signed percentage-point difference: +3.2%p, −1.0%p, 0.0%p, or '—'. Direction is neutral (no good/bad color). */
export const fmtPp = (v: number | null | undefined): string => {
  if (v == null || !Number.isFinite(v)) return '—';
  const rounded = Math.round(v * 10) / 10;
  if (rounded === 0) return '0.0%p';
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded).toFixed(1)}%p`;
};

/** Share of all (%), e.g. '11.4%'. */
export const fmtShare = (v: number | null | undefined): string =>
  v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(1)}%`;
