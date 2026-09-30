/**
 * 동명이인 (managers with the same name) — ONE rule for the chart, the lists, the table and the file.
 *
 * Identity: a manager row is one identity = its row key (`agency_key:manager_key`, server/aggregate.ts entityRows).
 * Rows are never merged by name, and two rows with the same key are the same person (a repeated row is not a namesake).
 * Same name: the same displayed name (NFC, trimmed; no name → '이름 없음') on two or more DIFFERENT identities of the
 * scope's FULL manager list. The server computes it over the full list (`same_name`), so a namesake beyond the loaded
 * page still counts; `sameNameIndex` falls back to the loaded rows only for rows without that metadata (older server,
 * static snapshot).
 *
 * Label: `name (agency)`, where agency is the shortest run of trailing WHOLE segments of the official current agency
 * name that tells the namesakes apart ('서울특별시경찰청 서울강서경찰서' → '서울강서경찰서'); never a character cut.
 * A trailing department segment (…과/팀/계/실/반/부/국) keeps its parent ('강서구 교통행정과'), a trailing word shorter
 * than 4 characters too ('갑 경찰서'). A '(구)' name keeps its mark.
 * When two identities share the SAME agency name too (e.g. one agency under two keys — a code that did not resolve
 * and one that did), the agency alone cannot tell them apart: they get an ordinal (`서울강서경찰서 2번`, order of the
 * row key) and the explanation says they are counted separately.
 */
import type { PublicEntity, SameNameInfo } from './public.ts';

export const NO_NAME = '이름 없음';
/** peer labels a response carries per row (the count still covers everyone) */
export const SAME_NAME_PEERS_MAX = 12;

export const managerNameOf = (e: Pick<PublicEntity, 'manager_name'>): string => (e.manager_name ?? '').normalize('NFC').trim() || NO_NAME;

const DEPARTMENT = /(과|팀|계|실|반|부|국)$/;
const MIN_SHORT = 4;

function segmentsOf(name: string): { old: boolean; parts: string[] } {
  const clean = name.normalize('NFC').trim();
  const old = clean.startsWith('(구)');
  const parts = (old ? clean.slice(3) : clean).trim().split(/\s+/).filter(Boolean);
  return { old, parts: parts.length ? parts : [clean] };
}

const suffix = (parts: string[], k: number) => parts.slice(Math.max(0, parts.length - k)).join(' ');

/** Shortest distinguishing short agency name for each of `names` (whole trailing segments, see above). */
export function shortAgencyLabels(names: readonly string[]): string[] {
  const segs = names.map(segmentsOf);
  return segs.map((s, i) => {
    const full = names[i];
    let k = Math.min(s.parts.length, s.parts.length > 1 && DEPARTMENT.test(s.parts[s.parts.length - 1]) ? 2 : 1);
    // a bare generic word ('경찰서', '구청') says nothing on its own: keep at least MIN_SHORT characters
    while (k < s.parts.length && [...suffix(s.parts, k)].length < MIN_SHORT) k++;
    for (; k < s.parts.length; k++) {
      const mine = `${s.old ? '(구)' : ''}${suffix(s.parts, k)}`;
      const clash = segs.some((o, j) => names[j] !== full && `${o.old ? '(구)' : ''}${suffix(o.parts, k)}` === mine);
      if (!clash) break;
    }
    return `${s.old ? '(구)' : ''}${suffix(s.parts, k)}`;
  });
}

type Row = Pick<PublicEntity, 'key' | 'manager_name' | 'agency_name'>;

/**
 * Same-name metadata for every row of `rows` computed over exactly these rows (server: the scope's full list).
 * Identities are distinct row keys; a repeated key counts once. Rows without a namesake are absent from the map.
 */
export function computeSameNames(rows: readonly Row[]): Map<string, SameNameInfo> {
  const identities = new Map<string, Row>();
  for (const r of rows) if (!identities.has(r.key)) identities.set(r.key, r);
  const groups = new Map<string, Row[]>();
  for (const r of identities.values()) {
    const name = managerNameOf(r);
    const g = groups.get(name);
    if (g) g.push(r); else groups.set(name, [r]);
  }
  const out = new Map<string, SameNameInfo>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => a.agency_name.localeCompare(b.agency_name, 'ko') || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    const short = shortAgencyLabels(sorted.map((r) => r.agency_name));
    const sameAgency = new Map<string, number>();
    for (const r of sorted) sameAgency.set(r.agency_name, (sameAgency.get(r.agency_name) ?? 0) + 1);
    const seen = new Map<string, number>();
    const labels = sorted.map((r, i) => {
      if ((sameAgency.get(r.agency_name) ?? 0) < 2) return short[i];
      const n = (seen.get(r.agency_name) ?? 0) + 1;
      seen.set(r.agency_name, n);
      return `${short[i]} ${n}번`;
    });
    const peers = labels.slice(0, SAME_NAME_PEERS_MAX);
    const agencyShared = sorted.map((r) => (sameAgency.get(r.agency_name) ?? 0) > 1);
    sorted.forEach((r, i) => out.set(r.key, { count: sorted.length, label: labels[i], peers, same_agency: agencyShared[i] }));
  }
  return out;
}

/**
 * The same-name metadata the UI uses for `rows`: the server's (full scope list) when the row carries it, else the
 * rule over the loaded rows. `fromServer` says whether every row had server metadata (else namesakes beyond the
 * loaded rows are unknown).
 */
export function sameNameIndex(rows: ReadonlyArray<Row & Pick<PublicEntity, 'same_name'>>): { get: (e: Row) => SameNameInfo | null; fromServer: boolean } {
  const fromServer = rows.length > 0 && rows.every((r) => r.same_name !== undefined);
  const local = fromServer ? null : computeSameNames(rows);
  const byKey = new Map<string, SameNameInfo | null>();
  for (const r of rows) byKey.set(r.key, r.same_name !== undefined ? r.same_name ?? null : local!.get(r.key) ?? null);
  return { get: (e) => byKey.get(e.key) ?? null, fromServer };
}

/** Display name of a manager: the name, plus the short agency when another identity of the scope has the same name. */
export function managerLabel(e: Pick<PublicEntity, 'manager_name'>, same: SameNameInfo | null): string {
  const name = managerNameOf(e);
  return same ? `${name} (${same.label})` : name;
}

/** Plain-text explanation of a same-name label (chart tooltip, list title, file note). */
export function sameNameNote(same: SameNameInfo): string[] {
  const lines = ['동명이인 구분을 위해 소속 기관을 함께 표시합니다.'];
  if (same.same_agency) lines.push('같은 기관 이름 아래 따로 집계된 담당자가 있어 번호로 구분했습니다(합치지 않음).');
  const more = same.count - same.peers.length;
  lines.push(`같은 이름의 담당자 ${same.count}명: ${same.peers.join(', ')}${more > 0 ? ` 외 ${more}명` : ''}`);
  return lines;
}
