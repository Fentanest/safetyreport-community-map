import { describe, expect, it } from 'vitest';
import { ActivityRegistry, primaryActivity } from '../../src/data/queryActivity';
import { handoffRecipe, planChart, sameDisjointGroup, baseSpec, DEFAULT_CHART, setFilter } from '../../src/state/statistics';
import { statisticsCatalog } from '../../server/statistics';
import { childRegions, regionTrail } from '../../src/components/ScopeDetailsPanel';
import { screenFromSearch } from '../../src/state/view';
import { scopeToSearch } from '../../src/state/filters';
import type { PublicRegion, Scope } from '../../src/domain/public';

const scope: Scope = { start: '2026-01-01', end: '2026-06-30', category: 'all', region_code: '11', agency_key: null, manager_key: null, bbox: null, law: null };
const catalog = statisticsCatalog();

describe('S10 activity registry (display only)', () => {
  it('reports are replaced/removed by owner id; an owner cannot clear another owner (late finally)', () => {
    const r = new ActivityRegistry();
    let notes = 0;
    r.subscribe(() => { notes++; });
    r.report('place-detail', { resource: 'place-detail', phase: 'fetching', label: 'P2 상세' });
    r.report('dashboard', { resource: 'dashboard', phase: 'fetching', label: '통계' });
    r.report('personal', null); // an idle owner (or a late finally of a cancelled one) touches nothing else
    expect(r.snapshot().map(([id]) => id)).toEqual(['place-detail', 'dashboard']);
    r.report('dashboard', { resource: 'dashboard', phase: 'fetching', label: '통계' });
    expect(notes).toBe(2); // identical report: no notification
    r.report('dashboard', null);
    expect(r.snapshot().map(([id]) => id)).toEqual(['place-detail']);
    r.clear();
    expect(r.snapshot()).toHaveLength(0);
  });
  it('the top line prefers errors and retry waits, then real work, then waiting slots; local reports stay local', () => {
    const r = new ActivityRegistry();
    r.report('a', { resource: 'dashboard', phase: 'scheduled', label: '준비' });
    r.report('b', { resource: 'personal', phase: 'fetching', label: '내 신고' });
    r.report('c', { resource: 'candidates', phase: 'fetching', label: '후보', scope: 'local' });
    expect(primaryActivity(r.snapshot())).toMatchObject({ main: { label: '내 신고' }, others: 1 });
    r.report('d', { resource: 'dashboard', phase: 'retry_wait', label: '대기', retryAt: 5 });
    expect(primaryActivity(r.snapshot())!.main.label).toBe('대기');
    r.report('a', null); r.report('b', null); r.report('d', null);
    expect(primaryActivity(r.snapshot())).toBeNull();
  });
});

describe('S07 chart plan (compatibility; units and overlapping sets are never mixed)', () => {
  const plan = (patch: Parameters<typeof baseSpec>[0], type: Parameters<typeof planChart>[2]['type'] = 'auto') => planChart(baseSpec(patch), catalog, { ...DEFAULT_CHART, type });
  it('recommendations follow the data shape', () => {
    expect(plan({ rows: ['agency'], columns: ['law'] }).type).toBe('heatmap');
    expect(plan({ rows: ['agency'], columns: ['completed_month'] }).type).toBe('line');
    expect(plan({ rows: ['agency'], columns: [] }).type).toBe('hbar');
    expect(plan({ rows: ['outcome'], columns: [] }).type).toBe('bar');
    expect(plan({ rows: [], columns: [] }).type).toBe('summary');
  });
  it('CH-08/09: 100% stacks only for real partitions (K or C); rates and overlapping sets are refused with a reason', () => {
    expect(sameDisjointGroup(['accepted_count', 'partial_count', 'rejected_count'])).toBe('K');
    expect(sameDisjointGroup(['accepted_count', 'partial_count', 'rejected_count', 'unknown_count'])).toBe('C');
    expect(sameDisjointGroup(['accepted_count', 'fine_count'])).toBeNull(); // 수용과 과태료는 겹침
    const bad = plan({ rows: ['agency'], columns: [], metrics: ['accept_rate', 'fine_rate'] }, 'stack100');
    expect(bad.type).not.toBe('stack100');
    expect(bad.refusal).toMatch(/100%/);
    expect(plan({ rows: ['agency'], columns: [], metrics: ['accepted_count', 'partial_count', 'rejected_count'] }, 'stack100').type).toBe('stack100');
  });
  it('CH-07: several same-unit rates may overlay; mixed units draw the primary metric only', () => {
    expect(plan({ rows: ['completed_month'], columns: [], metrics: ['accept_rate', 'fine_rate'] }).metrics).toEqual(['accept_rate', 'fine_rate']);
    expect(plan({ rows: ['completed_month'], columns: [], metrics: ['accept_rate', 'completed_count', 'duration_median'] }).metrics).toEqual(['accept_rate']);
  });
  it('a line over agency names is refused (no fake trend across categories)', () => {
    const p = plan({ rows: ['agency'], columns: [] }, 'line');
    expect(p.type).toBe('hbar');
    expect(p.refusal).toMatch(/날짜/);
  });
});

describe('S04 hand-off and page URL', () => {
  it('the displayed scope is carried as conditions; an address becomes the place condition with its label', () => {
    const r = handoffRecipe(scope, { origin: '선택한 주소', placeKey: 'pl1:0123456789abcdef', placeLabel: '서울 중구 예시로 1길' });
    expect(r.scope).toEqual(scope);
    expect(r.spec).toMatchObject({ rows: ['agency'], columns: ['law'], place_key: 'pl1:0123456789abcdef', population: 'all' });
    expect(r.labels['pl1:0123456789abcdef']).toBe('서울 중구 예시로 1길');
    const t = handoffRecipe(scope, { origin: '월별 추이', rows: ['completed_month'], columns: [], metrics: ['accept_rate', 'fine_rate'], population: 'compare' });
    expect(t.spec).toMatchObject({ rows: ['completed_month'], columns: [], metrics: ['accept_rate', 'fine_rate'], population: 'compare' });
  });
  it('the screen parameter never enters the scope serialisation; filters keep OR-within/AND-across', () => {
    expect(screenFromSearch('?start=2026-01-01&screen=statistics')).toBe('statistics');
    expect(screenFromSearch('?screen=other')).toBe('dashboard');
    expect(scopeToSearch(scope)).not.toMatch(/screen/);
    const s = setFilter(setFilter(baseSpec(), 'agency', ['a', 'b']), 'law', ['x']);
    expect(s.filters).toEqual([{ dimension: 'agency', members: ['a', 'b'] }, { dimension: 'law', members: ['x'] }]);
    expect(setFilter(s, 'agency', []).filters).toEqual([{ dimension: 'law', members: ['x'] }]);
  });
});

describe('S01 region trail and children', () => {
  it('전국 › 시도 › 시군구 on official codes', () => {
    expect(regionTrail(null).map((t) => t.label)).toEqual(['전국']);
    expect(regionTrail('11').map((t) => t.code)).toEqual([null, '11']);
    expect(regionTrail('11140').map((t) => t.code)).toEqual([null, '11', '11140']);
  });
  it('children: 시도 under 전국, 시군구 of that 시도 only, none under a 시군구', () => {
    const row = (level: PublicRegion['level'], code: string, sido: string | null, n: number): PublicRegion => ({ level, region_code: code, name: code, sido_code: sido,
      report_count: n, completed_count: n, outcomes: { accepted: 0, partial: 0, rejected: 0, result_known: 0, result_unknown: 0 }, fine_count: 0 });
    const regions = [row('sido', '11', null, 5), row('sido', '26', null, 9), row('sgg', '11140', '11', 3), row('sgg', '26110', '26', 2)];
    expect(childRegions(regions, null).map((r) => r.region_code)).toEqual(['26', '11']);
    expect(childRegions(regions, '11').map((r) => r.region_code)).toEqual(['11140']);
    expect(childRegions(regions, '11140')).toEqual([]);
  });
});

describe('C06 scroll spy', () => {
  it('the last section at or above the sticky line wins; above the first section the first one is current', async () => {
    const { currentSection } = await import('../../src/lib/navigation');
    const at = (a: number, b: number, c: number, d: number) => currentSection([['mapsection', a], ['analytics', b], ['regions', c], ['entities', d]], 76);
    expect(at(140, 900, 1800, 2400)).toBe('mapsection');
    expect(at(-600, 90, 900, 1500)).toBe('analytics');
    expect(at(-2000, -1200, 60, 700)).toBe('regions');
    expect(at(-3000, -2000, -900, 80)).toBe('entities');
  });
});
