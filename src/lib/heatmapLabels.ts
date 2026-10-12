import type { ChartTheme } from './charts';
import { rampColor } from './kakao';

// Existing chart tokens and ramp colours are opaque six-digit hex values.
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(a: string, b: string): number {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Choose existing theme ink against the actual cell fill. Midtones can fail both inks;
 * only those labels get a small surface backing to retain at least 4.5:1 contrast. */
export function heatmapLabel(percent: number | null, theme: Pick<ChartTheme, 'text' | 'surface'>) {
  const fill = rampColor(percent === null ? null : percent / 100);
  const textRatio = contrast(theme.text, fill), surfaceRatio = contrast(theme.surface, fill);
  return Math.max(textRatio, surfaceRatio) >= 4.5
    ? { color: textRatio >= surfaceRatio ? theme.text : theme.surface }
    : { color: theme.text, backgroundColor: theme.surface, padding: [2, 3], borderRadius: 2 };
}
