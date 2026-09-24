export const fmtInt = (v: number | null | undefined): string =>
  v == null ? '—' : v.toLocaleString('ko-KR');

export const fmtPct1 = (v: number | null | undefined): string =>
  v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(1)}`;

export const fmtDate = (iso: string): string => {
  const [y, m, d] = iso.split('-');
  return `${y}.${m}.${d}`;
};

export const fmtMonth = (ym: string): string => {
  const [y, m] = ym.split('-');
  return `${y}.${m}`;
};

export const fmtCoord6 = (v: number): string => v.toFixed(6);
