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
  // 2026-10-12 Opus: 단위 전체를 nowrap 으로 묶으면 좁은 KPI 카드에서 "내 31.3% (+3.1%p)" 가 한 덩어리로 넘쳐 잘렸다.
  // 어절 안 끊김은 전역 word-break: keep-all 이 막으므로, 단위 안에서도 공백에서는 줄을 바꿀 수 있게 하고
  // "·" 와 머리말 "내" 만 다음 어절에 붙인다(NBSP).
  const glue = (s: string) => s.replace(/^내 /u, '내\u00A0');
  parts.forEach((part, i) => {
    if (i > 0) out.push(' ');
    out.push(<span className="dp" key={i}>{i > 0 || lead ? `·\u00A0${glue(part)}` : glue(part)}</span>);
  });
  return out;
}
