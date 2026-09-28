export const fmtInt = (v: number | null | undefined): string =>
  v == null ? '—' : v.toLocaleString('ko-KR');

export const fmtPct1 = (v: number | null | undefined): string =>
  v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(1)}`;

export const fmtPercent = (v: number | null | undefined): string =>
  v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(1)}%`;

/** Mean of disclosed numeric satisfaction scores and its denominator. */
export const fmtRating = (r: { count: number; mean: number | null } | null | undefined): string =>
  r && r.count > 0 && r.mean !== null ? `${r.mean.toFixed(1)}점 · ${r.count.toLocaleString('ko-KR')}건` : '—';

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

/** 수용률 = 수용 ÷ 결과가 나온 신고(수용+일부 수용+불수용). 일부 수용은 일부수용률로 따로 보여 준다(2026-09-27 사용자 결정). */
export const acceptRate = (o: { accepted: number; result_known: number } | null | undefined): number | null =>
  o && o.result_known > 0 ? (o.accepted / o.result_known) * 100 : null;

/** 일부수용률 = 일부 수용 ÷ 결과가 나온 신고. 수용률과 따로 보여 준다. */
export const partialRate = (o: { partial: number; result_known: number } | null | undefined): number | null =>
  o && o.result_known > 0 ? (o.partial / o.result_known) * 100 : null;

/** Days: whole numbers as-is, fractions (mean, even-n median) with one decimal. */
export const fmtDays = (v: number | null | undefined): string =>
  v == null || !Number.isFinite(v) ? '—' : `${Number.isInteger(v) ? v : v.toFixed(1)}일`;

/** Signed day difference (mine − all). Direction is neutral. */
export const fmtDaysDiff = (v: number | null | undefined): string => {
  if (v == null || !Number.isFinite(v)) return '—';
  const r = Math.round(v * 10) / 10;
  if (r === 0) return '0일';
  return `${r > 0 ? '+' : '−'}${Number.isInteger(r) ? Math.abs(r) : Math.abs(r).toFixed(1)}일`;
};

/** Won, exact to 1원 (means are rounded to 1원 for display only). null → '—' (never '0원' for missing). */
export const fmtWon = (v: number | null | undefined): string =>
  v == null || !Number.isFinite(v) ? '—' : `${Math.round(v).toLocaleString('ko-KR')}원`;

/** Signed won difference (mine − all). Direction is neutral. */
export const fmtWonDiff = (v: number | null | undefined): string => {
  if (v == null || !Number.isFinite(v)) return '—';
  const r = Math.round(v);
  if (r === 0) return '0원';
  return `${r > 0 ? '+' : '−'}${Math.abs(r).toLocaleString('ko-KR')}원`;
};

/** 답변에 적힌 과태료 금액 cell: sum when confirmed, otherwise the reason (never 0원 for missing). */
export const fmtFineAmount = (a: { fine_count: number; confirmed_count: number; sum_won: number | null } | null | undefined): string => {
  if (!a) return '—';
  if (a.fine_count === 0) return '과태료 없음';
  if (a.confirmed_count === 0) return '확인된 금액 없음';
  return fmtWon(a.sum_won);
};
