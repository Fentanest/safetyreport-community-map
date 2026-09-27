/**
 * Official region catalog for the browser (names only, 2026-07-01 법정 codes; docs/region-boundaries.md).
 * Filter options, labels and legacy URL/interest keys use this; statistics themselves come from the server,
 * which resolves every fact (including split districts by coordinates) in server/regions.ts.
 */
import names from '../../contracts/regions/names-20260701.json';

export interface SidoEntry { code: string; name: string; short: string }
export interface SggEntry { code: string; sido: string; name: string }

const catalog = names as { version: string; sido: SidoEntry[]; sgg: SggEntry[] };

export const REGION_VERSION = catalog.version;
export const SIDO_LIST: readonly SidoEntry[] = catalog.sido;
const SIDO = new Map(catalog.sido.map(s => [s.code, s]));
const SGG = new Map(catalog.sgg.map(s => [s.code, s]));
const SGG_BY_SIDO = new Map<string, SggEntry[]>();
for (const s of catalog.sgg) {
  const list = SGG_BY_SIDO.get(s.sido);
  if (list) list.push(s); else SGG_BY_SIDO.set(s.sido, [s]);
}
for (const list of SGG_BY_SIDO.values()) list.sort((a, b) => a.name.localeCompare(b.name, 'ko'));

export const isRegionCode = (code: string | null | undefined): boolean =>
  !!code && (code.length === 2 ? SIDO.has(code) : code.length === 5 ? SGG.has(code) : false);

/** 시군구 of one 시도, by name. */
export const sggOf = (sido: string): readonly SggEntry[] => SGG_BY_SIDO.get(sido) ?? [];

/** The 시도 part of a code ('11140' → '11', '11' → '11'). */
export const sidoOf = (code: string | null): string | null => (code && isRegionCode(code) ? code.slice(0, 2) : null);

/** Display label: '전국', '서울특별시', '서울 중구', '세종특별자치시'. Unknown values are shown as given. */
export function regionLabel(code: string | null): string {
  if (!code) return '전국';
  if (code.length === 2) return SIDO.get(code)?.name ?? code;
  const s = SGG.get(code);
  if (!s) return code;
  if (s.sido === '36') return '세종특별자치시';
  return `${SIDO.get(s.sido)?.short ?? ''} ${s.name}`.trim();
}

/** Short 시군구 name within its 시도 ('중구'). */
export const sggName = (code: string): string => SGG.get(code)?.name ?? code;

const LEGACY_SIDO: Record<string, string> = {
  광주: '12', 전남: '12', 광주광역시: '12', 전라남도: '12', 강원도: '51', 전라북도: '52', 제주도: '50',
  세종시: '36', 서울시: '11', 부산시: '26', 대구시: '27', 인천시: '28', 대전시: '30', 울산시: '31',
};
const RENAMED: Record<string, string> = { '28|남구': '28177', '47|군위군': '27720', '28|동구': '28125' };
/** Split districts cannot be resolved without coordinates: an old key for them is dropped, never guessed. */
const SPLIT = new Set(['28|중구', '28|서구']);

/**
 * An official code as is, or an old display key ('서울 중구', saved before 2026-07-01 codes) converted by
 * name. Returns null when unknown or ambiguous (split districts).
 */
export function normalizeRegion(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  if (isRegionCode(v)) return v;
  const [token, name] = v.split(/\s+/);
  if (!token) return null;
  const sido = catalog.sido.find(s => s.short === token || s.name === token)?.code ?? LEGACY_SIDO[token];
  if (!sido) return null;
  if (sido === '36') return '36110';
  if (!name) return sido;
  const key = `${sido}|${name}`;
  if (SPLIT.has(key)) return null;
  return catalog.sgg.find(s => s.sido === sido && s.name === name)?.code ?? RENAMED[key] ?? null;
}

/** Does a 시군구 code fall inside the selected code (a 시도 includes its 시군구)? */
export const regionContains = (selected: string, code: string | null): boolean =>
  !!code && (selected.length === 2 ? code.slice(0, 2) === selected : code === selected);
