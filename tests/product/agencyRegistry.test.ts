// shared/agency-region-registry TS port check: same vectors as Python/Dart.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { displayAgency, displayRegion, resolveAgency, resolveRegionGap } from '../../shared/agency-region-registry/resolvers/resolve.ts';

const ROOT = new URL('../../shared/agency-region-registry/', import.meta.url);
const read = (name: string) => JSON.parse(readFileSync(new URL(name, ROOT), 'utf8'));
const registryVersion: string = read('manifest.json').registry_version;
const links = read('data/agency_links.json').links;
const events = read('data/region_events.json').events;
const cases = read('vectors/resolve_cases.json').cases;

describe('agency-region-registry vectors (shared)', () => {
  it('registry version matches the snapshot', () => {
    expect(registryVersion).toBe('2026-09-28.1');
  });
  for (const c of cases) {
    it(c.name, () => {
      const got = c.kind === 'agency'
        ? resolveAgency(c.input.code ?? null, c.input.name ?? null, c.input.answered_at ?? null, links, registryVersion)
        : resolveRegionGap(c.input.code ?? null, c.input.date ?? null, events, registryVersion);
      for (const [key, want] of Object.entries(c.expected)) {
        // NOTE 2026-09-28: `tsc -b` 차단을 풀기 위한 캐스트(동작 동일, vitest 는 통과하던 코드).
        expect((got as unknown as Record<string, unknown>)[key], `${c.name} · ${key}`).toEqual(want);
      }
    });
  }
  it('display never invents the (구) prefix for unresolved rows', () => {
    const agency = resolveAgency('9999999', '어딘가구청', '2026-09-01', links, registryVersion);
    expect(displayAgency('어딘가구청', agency)).toBe('어딘가구청');
    const region = resolveRegionGap('4159100000', '2026-09-01', events, registryVersion);
    expect(displayRegion('경기도 화성시', region)).toBe('경기도 화성시');
  });
  it('display uses the historical prefix only for known nodes', () => {
    const region = resolveRegionGap('2811000000', '2026-09-01', events, registryVersion);
    expect(displayRegion('인천광역시 중구', region)).toBe('(구)인천광역시 중구');
  });
});
