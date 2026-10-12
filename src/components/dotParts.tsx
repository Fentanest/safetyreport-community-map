import type { ReactNode } from 'react';

/**
 * The codebase's standard way to show several short facts on one line is `"A · B · C"` (processing_duration's
 * "평균 · 중앙값 6일 · 계산 60,297건", a KPI's "답변 확인 60,297건 · 직전 대비 +206.0%", "내 평균 38.2일 · 중앙값 38일", …).
 * Plain text, that string can still wrap in the middle of "6일" or between "내" and "신고 1,405건" — this renders
 * it as one `white-space: nowrap` span per " · "-separated unit (the "·" stays glued to the unit it introduces,
 * never left stranded alone), so a narrow screen can only break the line *between* units, never inside one.
 * `lead: true` treats the whole string as if it were itself introduced by "· " (for a mine-value cell that already
 * sits after its own " · " connector in the markup, e.g. KpiPanel's minor row).
 */
export function dotParts(text: string | null | undefined, opts?: { lead?: boolean }): ReactNode {
  if (!text) return text;
  const lead = opts?.lead ?? false;
  const parts = text.split(' · ');
  const out: ReactNode[] = [];
  parts.forEach((part, i) => {
    if (i > 0) out.push(' ');
    out.push(<span className="nb" key={i}>{i > 0 || lead ? `· ${part}` : part}</span>);
  });
  return out;
}
