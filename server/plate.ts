/** Private server-side plate parsing. Never import this module into browser code. */
const regions: Record<string, string> = {
  서울특별시: '서울', 부산광역시: '부산', 대구광역시: '대구', 인천광역시: '인천',
  광주광역시: '광주', 대전광역시: '대전', 울산광역시: '울산', 세종특별자치시: '세종',
  경기도: '경기', 강원특별자치도: '강원', 강원도: '강원', 충청북도: '충북',
  충청남도: '충남', 전북특별자치도: '전북', 전라북도: '전북', 전라남도: '전남',
  경상북도: '경북', 경상남도: '경남', 제주특별자치도: '제주', 제주도: '제주',
};
for (const short of Object.values(regions)) regions[short] = short;
const prefixes = Object.keys(regions).sort((a, b) => b.length - a.length);
const bodyPattern = /^[0-9]{2,3}[가-힣][0-9]{4}$/u;

export interface ParsedPlate {
  /** Server-only vehicle identity; the regional prefix remains significant. */
  canonical: string;
  /** Short regional prefix such as '경기', or '' when the plate has none. */
  region: string;
  /** Prefix-free supported plate body. */
  body: string;
}

/** Short regional prefixes that may appear in a public masked plate. */
export const PUBLIC_REGION_PREFIXES: readonly string[] = [...new Set(Object.values(regions))];

export function parsePlate(raw: unknown): ParsedPlate | null {
  if (typeof raw !== 'string' || raw.length > 64) return null;
  let text = raw.normalize('NFKC').replace(/[\s-]/gu, '');
  let region = '';
  for (const prefix of prefixes) {
    if (text.startsWith(prefix)) {
      region = regions[prefix];
      text = text.slice(prefix.length);
      break;
    }
  }
  if (!bodyPattern.test(text)) return null;
  return { canonical: region + text, region, body: text };
}

/**
 * Public display: the short region stays visible (경기도 → 경기) and is skipped when
 * counting; the 1-based 2nd/4th/6th characters of the remaining number become '*'.
 * 경기76자3623 → 경기7*자*6*3, 12가3456 → 1*가*4*6.
 */
export function maskPlate(raw: unknown): string {
  const parsed = parsePlate(raw);
  if (!parsed) return '번호 확인 불가';
  const letters = Array.from(parsed.body);
  for (const position of [1, 3, 5]) letters[position] = '*';
  return parsed.region + letters.join('');
}
