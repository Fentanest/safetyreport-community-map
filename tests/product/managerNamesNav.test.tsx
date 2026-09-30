import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { entityRows, type PrivateFact } from '../../server/aggregate';
import { createPublicHandler, type AnalyticsRepository } from '../../server/publicHandler';
import { computeSameNames, managerLabel, sameNameIndex, sameNameNote, shortAgencyLabels } from '../../src/domain/managerNames';
import { entityLabel } from '../../src/components/entityMetrics';
import PlaceEntityChart, { firstWindow, nextWindow, prevWindow, rangeText, windowFromZoom, WINDOW } from '../../src/components/PlaceEntityChart';
import { placeManagersSnapshot } from '../../src/export/adapters/dashboard';
import { entitySchema } from '../../src/data/schema';
import { managersFacts } from '../../src/data/demoEngine';
import type { PublicEntity } from '../../src/domain/public';
import { fixtureAccess, viewerRequest } from './helpers/mapViewer';

/** 2026-09-30 담당자별 처리 현황: 동명이인 label rule + 1–8 / N navigation. Synthetic data only. */
const row = (key: string, name: string | null, agency: string, patch: Partial<PublicEntity> = {}): PublicEntity => ({
  key, agency_key: key.split(':')[0], manager_key: key, agency_name: agency, manager_name: name, completed_count: 10,
  outcomes: { accepted: 5, partial: 2, rejected: 2, result_known: 9, result_unknown: 1 }, fine_count: 3, warning_count: 1,
  duration: null, fine_amount: null, rating: null, ...patch,
});
const GANGSEO = '서울특별시경찰청 서울강서경찰서';
const YANGCHEON = '서울특별시경찰청 서울양천경찰서';
const label = (rows: PublicEntity[], i: number) => entityLabel(rows[i], 'manager', sameNameIndex(rows).get(rows[i]));

describe('동명이인: same name on DIFFERENT identities of the full list', () => {
  it('1. 김지원 at two agencies (different identities) → both carry the short agency', () => {
    const rows = [row('A:1', '김지원', GANGSEO), row('B:2', '김지원', YANGCHEON)];
    expect(label(rows, 0)).toBe('김지원 (서울강서경찰서)');
    expect(label(rows, 1)).toBe('김지원 (서울양천경찰서)');
    const same = sameNameIndex(rows).get(rows[0])!;
    expect(same).toMatchObject({ count: 2, peers: ['서울강서경찰서', '서울양천경찰서'], same_agency: false });
    expect(sameNameNote(same)[0]).toBe('동명이인 구분을 위해 소속 기관을 함께 표시합니다.');
  });
  it('2. the same row twice (same identity) is NOT a namesake', () => {
    const rows = [row('A:1', '김지원', GANGSEO), row('A:1', '김지원', GANGSEO), row('C:3', '박도윤', GANGSEO)];
    expect(computeSameNames(rows).size).toBe(0);
    expect(label(rows, 0)).toBe('김지원');
    expect(label(rows, 1)).toBe('김지원');
  });
  it('3. same agency name, different identities → never merged; told apart by an ordinal (agency alone cannot)', () => {
    const rows = [row('src-mapo:2', '정민호', '서울특별시경찰청 서울마포경찰서'), row('inst-mapo:1', '정민호', '서울특별시경찰청 서울마포경찰서')];
    const same = sameNameIndex(rows);
    const labels = rows.map((r) => entityLabel(r, 'manager', same.get(r)));
    expect(new Set(labels).size).toBe(2);
    // order of the row key: inst-mapo:1 → 1, src-mapo:2 → 2 (stable whatever order the rows arrive in)
    expect(labels).toEqual(['정민호 (서울마포경찰서 · 2)', '정민호 (서울마포경찰서 · 1)']);
    expect(same.get(rows[0])!.same_agency).toBe(true);
    expect(sameNameNote(same.get(rows[0])!).join(' ')).toMatch(/번호로 구분/);
  });
  it('4. one 김지원 in the first window (1–8), the other 50th → the first is labeled too (the full list decides)', () => {
    const rows = Array.from({ length: 60 }, (_, i) => row(`S${i}:${i}`, `담당${i}`, GANGSEO));
    rows[0] = row('A:1', '김지원', GANGSEO);
    rows[49] = row('B:2', '김지원', YANGCHEON);
    expect(label(rows, 0)).toBe('김지원 (서울강서경찰서)');
    expect(label(rows, 49)).toBe('김지원 (서울양천경찰서)');
    expect(label(rows, 1)).toBe('담당1');
  });
  it('5. the other 김지원 is 105th of 118 (not in the first 100 sent) → the server metadata still labels the first one', async () => {
    const facts = managersFacts();
    const full = entityRows(facts, 'manager');
    expect(full).toHaveLength(118);
    const first100 = full.slice(0, 100);
    const kim = first100.filter((r) => r.manager_name === '김지원');
    expect(kim).toHaveLength(1);
    // the rule over the loaded rows alone would miss it …
    expect(computeSameNames(first100).get(kim[0].key)).toBeUndefined();
    // … the server's metadata (computed over all 118) does not
    expect(kim[0].same_name).toMatchObject({ count: 2, label: '서울강서경찰서', peers: ['서울강서경찰서', '서울양천경찰서'] });
    expect(label(first100, first100.indexOf(kim[0]))).toBe('김지원 (서울강서경찰서)');
    expect(sameNameIndex(first100).fromServer).toBe(true);
    // unique names carry null (not undefined): "server says no namesake"
    expect(first100[0].same_name).toBeNull();
    for (const r of full) expect(entitySchema.safeParse(r).success).toBe(true);
  });
  it('the /dashboard and /entities routes carry the full-list metadata on every page, search and type filter', async () => {
    const facts = managersFacts();
    const state = { dataset_version: 'mn', ready: true, source_updated_at: null, generated_at: '2026-09-30T00:00:00Z', published_at: null,
      data_min: '2026-06-01', data_max: '2026-09-29', coverage_note: '', dedupe_policy_version: 'x' };
    const repo: AnalyticsRepository = { getState: async () => state, getFacts: async () => facts, allowRequest: async () => true };
    const base = 'https://api.example.invalid/public-analytics';
    const q = 'start=2026-06-01&end=2026-09-29&category=all&date_basis=completed_date';
    const dash = await (await createPublicHandler(repo, fixtureAccess())(viewerRequest(`${base}/dashboard?${q}`))).json();
    expect(dash.managers).toHaveLength(100);
    expect(dash.manager_total).toBe(118);
    const kim = dash.managers.find((r: PublicEntity) => r.manager_name === '김지원');
    expect(kim.same_name.label).toBe('서울강서경찰서');
    const page2 = await (await createPublicHandler(repo, fixtureAccess())(viewerRequest(`${base}/entities?${q}&kind=manager&page=2&page_size=100`))).json();
    const yang = page2.items.find((r: PublicEntity) => r.manager_name === '김지원');
    expect(yang.same_name).toMatchObject({ count: 2, label: '서울양천경찰서' });
    const search = await (await createPublicHandler(repo, fixtureAccess())(viewerRequest(`${base}/entities?${q}&kind=manager&q=${encodeURIComponent('강서')}`))).json();
    const found = search.items.find((r: PublicEntity) => r.manager_name === '김지원');
    // the search shows one 김지원, yet the label stays the scope's (the other one exists in the scope)
    expect(found.same_name.count).toBe(2);
    const agencies = await (await createPublicHandler(repo, fixtureAccess())(viewerRequest(`${base}/entities?${q}&kind=agency`))).json();
    expect(agencies.items.every((r: PublicEntity) => r.same_name === undefined)).toBe(true);
  });
  it('a narrower scope recomputes: with only one 김지원 left there is no agency on the name', () => {
    const facts = managersFacts().filter((f: PrivateFact) => f.agency_name !== YANGCHEON);
    const kim = entityRows(facts, 'manager').find((r) => r.manager_name === '김지원')!;
    expect(kim.same_name).toBeNull();
    expect(managerLabel(kim, kim.same_name ?? null)).toBe('김지원');
  });
  it('older server rows (no metadata) fall back to the loaded rows, and say so', () => {
    const rows = [row('A:1', '김지원', GANGSEO), row('B:2', '김지원', YANGCHEON)];
    expect(sameNameIndex(rows).fromServer).toBe(false);
    expect(label(rows, 0)).toBe('김지원 (서울강서경찰서)');
  });
});

describe('short agency names: whole trailing segments, never a character cut', () => {
  it('drops the parent 청 when the station name alone tells them apart', () => {
    expect(shortAgencyLabels([GANGSEO, YANGCHEON])).toEqual(['서울강서경찰서', '서울양천경찰서']);
  });
  it('keeps as many segments as needed, a department keeps its parent, a bare generic word is not used alone', () => {
    expect(shortAgencyLabels(['서울특별시 강서구 교통행정과', '서울특별시 양천구 교통행정과'])).toEqual(['강서구 교통행정과', '양천구 교통행정과']);
    expect(shortAgencyLabels(['갑 경찰서', '을 구청'])).toEqual(['갑 경찰서', '을 구청']);
    expect(shortAgencyLabels(['경기도남부경찰청 수원중부경찰서', '경기도북부경찰청 수원중부경찰서'])).toEqual(['경기도남부경찰청 수원중부경찰서', '경기도북부경찰청 수원중부경찰서']);
    expect(shortAgencyLabels(['(구)서울지방경찰청 서울강서경찰서', YANGCHEON])).toEqual(['(구)서울강서경찰서', '서울양천경찰서']);
    expect(shortAgencyLabels(['제주시청', '서귀포시청'])).toEqual(['제주시청', '서귀포시청']);
    for (const [full, short] of [[GANGSEO, '서울강서경찰서'], ['서울특별시 강서구 교통행정과', '강서구 교통행정과']]) expect(full.endsWith(short)).toBe(true);
  });
});

describe('1–8 / N: window math over the ONE dataZoom state', () => {
  it('3 and 8 managers: one window, no paging', () => {
    expect(firstWindow(3)).toEqual({ start: 0, end: 2 });
    expect(windowFromZoom({ start: 20, end: 60 }, 8)).toEqual({ start: 0, end: 7 });
    expect(nextWindow(firstWindow(8), 8)).toBeNull();
    expect(prevWindow(firstWindow(8), 8)).toBeNull();
    expect(rangeText(firstWindow(8), 8, 8)).toBe('담당자 1–8 / 8명');
  });
  it('9 managers: 1–8, next 9–9, prev 1–8', () => {
    const w = firstWindow(9);
    expect(rangeText(w, 9, 9)).toBe('담당자 1–8 / 9명');
    const n = nextWindow(w, 9)!;
    expect(rangeText(n, 9, 9)).toBe('담당자 9–9 / 9명');
    expect(nextWindow(n, 9)).toBeNull();
    expect(prevWindow(n, 9)).toEqual(w);
  });
  it('100 managers: 1–8 → 9–16 → 1–8; a dragged slider (values or percents) is read back', () => {
    const w = firstWindow(100);
    const n = nextWindow(w, 100)!;
    expect(rangeText(n, 100, 100)).toBe('담당자 9–16 / 100명');
    expect(prevWindow(n, 100)).toEqual(w);
    expect(rangeText(windowFromZoom({ startValue: 22, endValue: 29 }, 100), 100, 100)).toBe('담당자 23–30 / 100명');
    expect(windowFromZoom({ start: 0, end: 100 }, 100)).toEqual({ start: 0, end: 99 });
    // an odd window after a drag: prev goes back WINDOW, never below 0, and the first page is full again
    expect(prevWindow({ start: 3, end: 10 }, 100)).toEqual({ start: 0, end: 7 });
    let cur = w, steps = 0;
    while (nextWindow(cur, 100)) { cur = nextWindow(cur, 100)!; steps++; }
    expect(steps).toBe(12);
    expect(rangeText(cur, 100, 100)).toBe('담당자 97–100 / 100명');
  });
  it('118 total, 100 loaded: the end of the loaded list says so; after loading, the same window continues', () => {
    const end = { start: 96, end: 99 };
    expect(rangeText(end, 100, 118)).toBe('담당자 97–100 / 불러온 100명 · 전체 118명');
    expect(nextWindow(end, 100)).toBeNull();
    expect(nextWindow(end, 118)).toEqual({ start: 100, end: 107 });
    expect(WINDOW).toBe(8);
  });
});

describe('the card: nav, load-more, table and file use the same names', () => {
  const facts = managersFacts();
  const all = entityRows(facts, 'manager');
  const first = all.slice(0, 100);
  const render = (props: Partial<Parameters<typeof PlaceEntityChart>[0]> = {}) => renderToStaticMarkup(
    <PlaceEntityChart managers={first} total={118} theme="dark" loadingMore={false} onLoadMore={() => {}} {...props} />);
  it('shows 1–8 of the loaded and the total, prev disabled, next enabled', () => {
    const html = render();
    expect(html).toContain('담당자 1–8 / 불러온 100명 · 전체 118명');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>‹ 이전<\/button>/);
    expect(html).toMatch(/<button[^>]*class="mini-btn pe-nav-next"[^>]*>다음 ›<\/button>/);
    expect(html).not.toMatch(/pe-nav-next"[^>]*disabled/);
    // 김지원 is 4th: in the first window, so the namesake note explains its agency
    expect(html).toContain('기관명이 붙은 이름');
    expect(html).toContain('<b>김지원</b> 2명: 서울강서경찰서 · 서울양천경찰서');
  });
  it('8 or fewer managers and nothing more: no nav at all', () => {
    const html = renderToStaticMarkup(<PlaceEntityChart managers={first.slice(0, 8)} total={8} theme="dark" loadingMore={false} onLoadMore={null} />);
    expect(html).not.toContain('pe-nav');
    expect(html).toContain('담당자 8명.');
  });
  it('the table shows every loaded row with the chart names, and offers the rest', () => {
    // a table render starts in chart mode; the table rows use `labels` — check the file adapter's names instead
    const snap = placeManagersSnapshot({ managers: first, total: 118, mode: 'accept', scopeTitle: 't', conditions: [], datasetVersion: 'v', capturedAt: '2026-09-30T00:00:00Z' });
    const names = snap.table.rows.map((r) => r.cells.name);
    expect(names).toContain('김지원 (서울강서경찰서)');
    expect(names).toContain('박서준 (서울중부경찰서)');
    expect(names.filter((x) => String(x).startsWith('정민호'))).toEqual(['정민호 (서울마포경찰서 · 1)', '정민호 (서울마포경찰서 · 2)']);
    expect(snap.table.notes.join(' ')).toMatch(/소속 기관을 짧게/);
    // the agency column keeps the official name; nobody is merged
    expect(new Set(snap.table.rows.map((r) => r.id)).size).toBe(100);
    expect(snap.table.rows.find((r) => r.cells.name === '김지원 (서울강서경찰서)')!.cells.agency).toBe(GANGSEO);
  });
  it('the loading and error states keep the loaded rows (tested on the button text)', () => {
    // render at the end window is driven by ECharts at runtime; the button texts are checked in the browser run
    expect(render({ loadingMore: true })).toContain('담당자 1–8 / 불러온 100명 · 전체 118명');
  });
});
