/**
 * F06: the REAL Excelize (excelize-wasm, pinned) writes the workbook in Node from synthetic snapshots; the file is then
 * read back by an independent OOXML inspector (scripts/xlsx/ooxml.mjs, read-only). Expected numbers are written here
 * from the acceptance fixture (G: C=20 A=12 P=3 R=3 U=2 K=18 F=8 W=5; 1/1 + 9/99 = 10/100; M1/M2/M3 months), never
 * copied from the implementation's output.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { init } from 'excelize-wasm';
import { statisticsCatalog } from '../../server/statistics';
import type { StatisticsResult, StatisticsSpec, StatValue } from '../../src/domain/statistics';
import type { MonthlyBucket, PublicEntity } from '../../src/domain/public';
import type { CompareMonth } from '../../src/domain/personal';
import { baseSpec, tupleKey, DEFAULT_CHART } from '../../src/state/statistics';
import { statisticsSnapshot } from '../../src/export/adapters/statistics';
import { placeManagersSnapshot, trendSnapshot } from '../../src/export/adapters/dashboard';
import { CHART, cleanText, writeWorkbook, type XModule } from '../../src/export/workbook';
import { checkedArchive } from '../../src/export/excelizeLoader';
import { fileName, kst, monthSerial, type ExportSnapshot } from '../../src/export/model';
// @ts-expect-error — plain .mjs helper without types
import { inspect, rangeValues } from '../../scripts/xlsx/ooxml.mjs';

const WASM = new URL('../../node_modules/excelize-wasm/excelize.wasm.gz', import.meta.url).pathname;
let X: XModule;
beforeAll(async () => { X = (await init(WASM)) as unknown as XModule; }, 60_000);
const catalog = statisticsCatalog();
const AT = '2026-09-29T06:30:00.000Z'; // 15:30:00 KST
type Insp = ReturnType<typeof inspect>;
const write = (snap: ExportSnapshot): Insp => inspect(writeWorkbook(X, snap).bytes);

const sv = (value: number | null, numerator: number | null = null, denominator: number | null = null, reason: StatValue['reason'] = null): StatValue => ({ value, numerator, denominator, reason });
const pct = (n: number, d: number) => sv(d > 0 ? (n / d) * 100 : null, n, d, d > 0 ? null : 'zero_denominator');
function result(spec: Partial<StatisticsSpec>, parts: Partial<StatisticsResult>): StatisticsResult {
  return { schema_version: 1, dataset_version: 'v-test', scope: { start: '2026-01-01', end: '2026-06-30', category: 'all', region_code: null, agency_key: null, manager_key: null, bbox: null, law: null },
    spec: baseSpec({ columns: [], ...spec }), row_members: [], col_members: [], cells: [], row_totals: [], col_totals: [], grand_totals: [],
    population_count: { all: 20, mine: null }, excluded: { no_report_date: 0 }, filter_members: [], complete: true, ...parts };
}
const G_VALUES = {
  completed_count: sv(20), accepted_count: sv(12), partial_count: sv(3), rejected_count: sv(3), unknown_count: sv(2),
  accept_rate: pct(12, 18), partial_rate: pct(3, 18), reject_rate: pct(3, 18), fine_rate: pct(8, 20), warning_rate: pct(5, 20),
};
const statsSnap = (r: StatisticsResult, over: Partial<Parameters<typeof statisticsSnapshot>[0]> = {}) => statisticsSnapshot({
  result: r, catalog, chart: DEFAULT_CHART, sort: { metric: null, dir: 'desc' }, hidden: [], includeHidden: false,
  conditions: [{ label: '기간', value: '2026-01-01 — 2026-06-30' }, { label: '지표', value: 'x' }], title: '맞춤 통계 · 테스트', capturedAt: AT, ...over });
/** cell of the 통계표 by row label and full column header (the unique last header row) */
function tableCell(x: Insp, rowLabel: string, header: string) {
  const sh = x.sheets['통계표'].cells as Record<string, { value: unknown; num: number | null; formula: string | null; format: string; t: string | null }>;
  const headRow = Object.entries(sh).find(([, c]) => c.value === header)?.[0];
  if (!headRow) throw new Error(`header not found: ${header}`);
  const col = /^[A-Z]+/.exec(headRow)![0];
  const row = Object.entries(sh).find(([k, c]) => k.startsWith('A') && /^A\d+$/.test(k) && c.value === rowLabel)?.[0];
  if (!row) throw new Error(`row not found: ${rowLabel}`);
  return sh[`${col}${/\d+/.exec(row)![0]}`];
}

describe('excelize-wasm 0.1.3 contract', () => {
  it('ChartType ids used by the writer match the installed index.d.ts enum order', () => {
    const dts = readFileSync(new URL('../../node_modules/excelize-wasm/index.d.ts', import.meta.url), 'utf8');
    const body = /export enum ChartType \{([\s\S]*?)\}/.exec(dts)![1];
    const names = body.split(',').map((s) => s.trim()).filter(Boolean);
    for (const [k, v] of Object.entries(CHART)) expect(names.indexOf(k), k).toBe(v);
    expect(JSON.parse(readFileSync(new URL('../../node_modules/excelize-wasm/package.json', import.meta.url), 'utf8')).version).toBe('0.1.3');
  });
  it('file name and Asia/Seoul time', () => {
    expect(kst(AT).text).toBe('2026-09-29 15:30:00 (한국 시간)');
    expect(fileName({ fileStem: '커뮤니티신고지도_맞춤통계', capturedAt: AT })).toBe('커뮤니티신고지도_맞춤통계_20260929_153000.xlsx');
    expect(monthSerial('2026-01')).toBe(46023); // 2026-01-01 in the 1900 date system, no timezone shift
  });
});

describe('F06 statistics workbook', () => {
  const g = result({ rows: ['agency'], columns: [], metrics: Object.keys(G_VALUES) }, {
    row_members: [{ key: ['ag:g'], label: ['G기관'] }],
    cells: [{ row: ['ag:g'], col: [], side: 'all', values: G_VALUES }],
    grand_totals: [{ key: [], side: 'all', values: G_VALUES }],
  });
  it('EX-09 G rates are =분자/분모 formulas with 0–1 values in % format; four sheets', () => {
    const x = write(statsSnap(g));
    expect(Object.keys(x.sheets)).toEqual(['통계표', '차트', '차트 데이터', '조회 조건']);
    const expect_ = { 수용률: [12, 18], 일부수용률: [3, 18], 불수용률: [3, 18], '과태료 부과율': [8, 20], '경고·계도 비율': [5, 20] } as const;
    for (const [label, [n, d]] of Object.entries(expect_)) {
      const c = tableCell(x, 'G기관', `${label} · 비율`);
      expect(c.num, label).toBeCloseTo(n / d, 12);
      expect(c.num as number).toBeLessThanOrEqual(1);
      expect(c.formula, label).toMatch(/^[A-Z]+\d+\/[A-Z]+\d+$/);
      expect(c.format).toBe('0.0%');
    }
    expect(x.calc.fullCalcOnLoad).toBe('true');
    // recorded limitation of excelize-wasm 0.1.3: a formula cell keeps its cached result as text (t="str"); Excel
    // recalculates on open (fullCalcOnLoad), a viewer that never recalculates shows that cached text
    expect(tableCell(x, 'G기관', '수용률 · 비율').t).toBe('str');
  });
  it('EX-10 weighted total 1/1 + 9/99 = 10/100 (never the mean of rates)', () => {
    const r = result({ rows: ['sgg'], metrics: ['accept_rate'] }, {
      row_members: [{ key: ['A'], label: ['A지역'] }, { key: ['B'], label: ['B지역'] }],
      cells: [{ row: ['A'], col: [], side: 'all', values: { accept_rate: pct(1, 1) } }, { row: ['B'], col: [], side: 'all', values: { accept_rate: pct(9, 99) } }],
      grand_totals: [{ key: [], side: 'all', values: { accept_rate: pct(10, 100) } }],
    });
    const x = write(statsSnap(r));
    const total = tableCell(x, '합계', '수용률 · 비율');
    expect(total.num).toBeCloseTo(0.1, 12);
    expect(total.formula).toMatch(/^[A-Z]+\d+\/[A-Z]+\d+$/);
    expect(tableCell(x, 'A지역', '수용률 · 비율').num).toBe(1);
  });
  it('EX-15/16 compare heatmap: two matrices, same axes, same 0–1 scale; my missing cell stays blank', () => {
    const r = result({ rows: ['agency'], columns: ['law'], metrics: ['accept_rate'], population: 'compare' }, {
      row_members: [{ key: ['a1'], label: ['갑기관'] }, { key: ['a2'], label: ['을기관'] }],
      col_members: [{ key: ['l1'], label: ['제1조'] }],
      cells: [
        { row: ['a1'], col: ['l1'], side: 'all', values: { accept_rate: pct(1, 2) } },
        { row: ['a1'], col: ['l1'], side: 'mine', values: { accept_rate: pct(1, 1) } },
        { row: ['a2'], col: ['l1'], side: 'all', values: { accept_rate: pct(3, 4) } },
      ],
      population_count: { all: 6, mine: 1 },
    });
    const x = write(statsSnap(r, { chart: { type: 'heatmap', primary: null, overlay: true } }));
    const ch = x.sheets['차트'];
    expect(x.charts).toHaveLength(0); // a heatmap is cells + conditional formatting, not a chart object
    expect(ch.cf).toHaveLength(2);
    for (const cf of ch.cf) {
      expect(cf.rules[0].type).toBe('colorScale');
      expect(cf.rules[0].cfvo).toEqual([{ type: 'num', val: '0' }, { type: 'num', val: '1' }]);
    }
    const [allRange, mineRange] = ch.cf.map((c: { sqref: string }) => c.sqref);
    const vals = (sq: string) => rangeValues(x, `'차트'!${sq.replace(/([A-Z]+)(\d+)/g, '$$$1$$$2')}`);
    expect(vals(allRange)).toEqual([0.5, 0.75]);
    expect(vals(mineRange)).toEqual([1, null]); // 을기관 has no report of mine: blank, not 0 and not the 전체 value
  });
  it('EX-21 100% stack with 불수용 hidden: shares of the ORIGINAL K; 수용+일부 = 5/6; not percent-stacked', () => {
    const r = result({ rows: ['agency'], metrics: ['accepted_count', 'partial_count', 'rejected_count'] }, {
      row_members: [{ key: ['ag:g'], label: ['G기관'] }],
      cells: [{ row: ['ag:g'], col: [], side: 'all', values: G_VALUES }],
      grand_totals: [{ key: [], side: 'all', values: G_VALUES }],
    });
    const x = write(statsSnap(r, { chart: { type: 'stack100', primary: null, overlay: true }, hidden: ['rejected_count:all'] }));
    expect(x.charts).toHaveLength(1);
    const grp = x.charts[0].groups[0];
    expect(grp.type).toBe('barChart');
    expect(grp.grouping).toBe('stacked');
    expect(grp.series).toHaveLength(2);
    const shares = grp.series.map((s: { val: { f: string } }) => rangeValues(x, s.val.f)![0] as number);
    expect(shares[0]).toBeCloseTo(12 / 18, 12);
    expect(shares[0] + shares[1]).toBeCloseTo(5 / 6, 12);
    expect(x.charts[0].valAx[0].max).toBe('1');
    // the hidden series stays in 차트 데이터 (labelled) and in the table
    expect(x.allText).toContain('불수용 건수 (화면에서 숨긴 항목)');
    expect(tableCell(x, 'G기관', '불수용 건수 · 값').value).toBe(3);
    const d = x.sheets['차트 데이터'].cells as Record<string, { formula: string | null }>;
    expect(Object.values(d).some((c) => c.formula && /SUM\(/.test(c.formula))).toBe(true);
  });
  it('EX-22 all series hidden: no chart, a notice (not 0건), the table unchanged', () => {
    const r = result({ rows: ['agency'], metrics: ['accept_rate', 'fine_rate'] }, {
      row_members: [{ key: ['ag:g'], label: ['G기관'] }], cells: [{ row: ['ag:g'], col: [], side: 'all', values: G_VALUES }], grand_totals: [{ key: [], side: 'all', values: G_VALUES }],
    });
    const x = write(statsSnap(r, { chart: { type: 'bar', primary: null, overlay: true }, hidden: ['accept_rate:all', 'fine_rate:all'] }));
    expect(x.charts).toHaveLength(0);
    expect(x.allText).toContain('화면에서 모든 항목을 숨긴 상태로 내려받았습니다');
    expect(tableCell(x, 'G기관', '수용률 · 비율').num).toBeCloseTo(12 / 18, 12);
    const y = write(statsSnap(r, { chart: { type: 'bar', primary: null, overlay: true }, hidden: ['accept_rate:all', 'fine_rate:all'], includeHidden: true }));
    expect(y.charts[0].groups[0].series).toHaveLength(2); // EX-23: only when explicitly asked
  });
  it('EX-19 scatter is an XY chart of two numeric metrics', () => {
    const r = result({ rows: ['agency'], metrics: ['duration_median', 'fine_rate'] }, {
      row_members: [{ key: ['a1'], label: ['갑'] }, { key: ['a2'], label: ['을'] }],
      cells: [{ row: ['a1'], col: [], side: 'all', values: { duration_median: sv(3.5, null, 4), fine_rate: pct(1, 4) } },
        { row: ['a2'], col: [], side: 'all', values: { duration_median: sv(10, null, 2), fine_rate: pct(2, 2) } }],
    });
    const x = write(statsSnap(r, { chart: { type: 'scatter', primary: null, overlay: true } }));
    const grp = x.charts[0].groups[0];
    expect(grp.type).toBe('scatterChart');
    expect(rangeValues(x, grp.series[0].xVal.f)).toEqual([3.5, 10]);
    expect(rangeValues(x, grp.series[0].yVal.f)).toEqual([0.25, 1]);
  });
  it('EX-54 an unconfirmed target is counted, never named (not even a stored label)', () => {
    const r = result({ rows: ['agency'], metrics: ['accept_rate'], filters: [{ dimension: 'agency', members: ['ag:g', 'ag:old'] }] }, {
      row_members: [{ key: ['ag:g'], label: ['G기관'] }], cells: [{ row: ['ag:g'], col: [], side: 'all', values: G_VALUES }],
      filter_members: [{ dimension: 'agency', key: 'ag:g', label: 'G기관', count: 20, status: 'ok' }, { dimension: 'agency', key: 'ag:old', label: null, count: 0, status: 'unconfirmed' }],
    });
    const x = write(statsSnap(r));
    expect(x.allText).toContain('확인할 수 없는 대상 1개');
    expect(x.allText).not.toContain('ag:old');
  });
});

describe('F06 trend workbook (월별 추이)', () => {
  const o = (A: number, P: number, R: number) => ({ accepted: A, partial: P, rejected: R, result_known: A + P + R, result_unknown: 0 });
  const monthly: MonthlyBucket[] = [
    { month: '2026-01', report_count: 10, completed_count: 8, fine_count: 2, outcomes: o(4, 1, 1), partial: false, coverage_note: null },
    { month: '2026-02', report_count: 3, completed_count: 0, fine_count: 0, outcomes: o(0, 0, 0), partial: false, coverage_note: null },
    { month: '2026-03', report_count: 4, completed_count: 2, fine_count: 0, outcomes: o(0, 0, 2), partial: false, coverage_note: null },
  ];
  const mine: CompareMonth[] = [
    { month: '2026-01', all_report_count: 10, mine_report_count: 2, all_completed_count: 8, mine_completed_count: 1, all_accept_rate: null, mine_accept_rate: null,
      all_duration_median_days: null, mine_duration_median_days: null, mine_outcomes: o(1, 0, 0), mine_fine_count: 1 },
  ];
  const snap = (view: 'count' | 'rate', rates: Array<'accept' | 'reject' | 'partial' | 'fine'>, m: CompareMonth[] | null = null) =>
    trendSnapshot({ monthly, mine: m, view, rates, conditions: [], datasetVersion: 'v', capturedAt: AT });
  it('EX-04/05 checked rates only; 4 rates × 전체/내 = 8 native line series referencing cells', () => {
    expect(write(snap('rate', ['accept', 'fine'])).charts[0].groups[0].series).toHaveLength(2);
    const x = write(snap('rate', ['accept', 'reject', 'partial', 'fine'], mine));
    const grp = x.charts[0].groups[0];
    expect(grp.type).toBe('lineChart');
    expect(grp.series).toHaveLength(8);
    for (const s of grp.series) { expect(s.val.kind).toBe('numRef'); expect(s.val.f).toMatch(/^'차트 데이터'!\$[A-Z]+\$\d+:\$[A-Z]+\$\d+$/); expect(s.tx.f).toMatch(/^'차트 데이터'!/); }
    expect(grp.series.filter((s: { dash: string }) => s.dash === 'dash')).toHaveLength(4); // 내 신고 = dashed
    expect(x.charts[0].dispBlanksAs).toBe('gap');
  });
  it('EX-13/14 M2 without denominator is a gap; M3 with K>0 and A=0 is a real 0%', () => {
    const x = write(snap('rate', ['accept']));
    const vals = rangeValues(x, x.charts[0].groups[0].series[0].val.f);
    expect(vals[0]).toBeCloseTo(4 / 6, 12);
    expect(vals[1]).toBeNull();
    expect(vals[2]).toBe(0);
    expect(x.allText).toContain('계산 불가');
  });
  it('EX-06 count view keeps 신고/답변 counts on their own date basis (no rate axis)', () => {
    const x = write(snap('count', ['accept']));
    const grp = x.charts[0].groups[0];
    expect(grp.series).toHaveLength(2);
    expect(rangeValues(x, grp.series[0].val.f)).toEqual([10, 3, 4]);
    expect(x.charts[0].valAx[0].max).toBeNull();
  });
});

describe('F06 managers workbook (주소/범위 담당자)', () => {
  const e = (key: string, name: string, agency: string, C: number, A: number, P: number, R: number, F: number | null): PublicEntity => ({
    key, agency_key: agency, manager_key: key, agency_name: agency, manager_name: name, completed_count: C,
    outcomes: { accepted: A, partial: P, rejected: R, result_known: A + P + R, result_unknown: C - A - P - R }, fine_count: F } as PublicEntity);
  it('EX-24/EX-07 100% bars + answered-count line on a secondary axis; partial list stated', () => {
    const x = write(placeManagersSnapshot({ managers: [e('m1', '김철수', '갑서', 20, 12, 3, 3, 8), e('m2', '김철수', '을서', 1, 1, 0, 0, null)], total: 5, mode: 'accept',
      scopeTitle: '이 범위의 담당자별 처리 현황', conditions: [], datasetVersion: 'v', capturedAt: AT }));
    const groups = x.charts[0].groups;
    expect(groups.map((g2: { type: string }) => g2.type)).toEqual(['barChart', 'lineChart']);
    expect(groups[0].grouping).toBe('stacked');
    expect(x.charts[0].valAx).toHaveLength(2);
    expect(x.charts[0].valAx.some((a: { crosses: string }) => a.crosses === 'max')).toBe(true);
    expect(x.allText).toContain('김철수 (갑서)');
    expect(x.allText).toContain('김철수 (을서)');
    expect(x.allText).toContain('일부만 담음: 화면에 불러온 2명 (전체 5명');
    expect(x.allText).toContain('제공 안 됨');
  });
});

describe('F06 file safety', () => {
  it('EX-52/53 text is text (=,+,-,@, quotes, control chars); numbers stay numbers; no private data, links or repairs', () => {
    const r = result({ rows: ['agency'], metrics: ['accept_rate', 'completed_count'] }, {
      row_members: [{ key: ['a1'], label: ['=HYPERLINK("http://x","y")'] }, { key: ['a2'], label: ['+1'] }, { key: ['a3'], label: ['-2@x\u0001"따옴표\''] }],
      cells: [{ row: ['a1'], col: [], side: 'all', values: { accept_rate: pct(1, 2), completed_count: sv(-3) } }],
    });
    const x = write(statsSnap(r));
    const cells = Object.values(x.sheets['통계표'].cells) as Array<{ value: unknown; formula: string | null; t: string | null }>;
    const label = cells.find((c) => typeof c.value === 'string' && c.value.startsWith('=HYPERLINK'));
    expect(label?.formula).toBeNull();
    expect(label?.t).toBe('s');
    expect(cells.some((c) => c.value === '-2@x"따옴표\'')).toBe(true);
    expect(cells.some((c) => c.value === -3)).toBe(true);
    // every formula in every sheet is one the writer builds: cell references, / and SUM only
    for (const sh of Object.values(x.sheets) as Array<{ cells: Record<string, { formula: string | null }> }>) {
      for (const c of Object.values(sh.cells)) if (c.formula) expect(c.formula).toMatch(/^(('[^']+'!)?\$?[A-Z]+\$?\d+)(\/(('[^']+'!)?\$?[A-Z]+\$?\d+|SUM\(.+\)))?$/);
    }
    expect(x.controlChars).toEqual([]);
    expect(x.undeclaredParts).toEqual([]);
    expect(x.missingOverrides).toEqual([]);
    expect(x.brokenRels).toEqual([]);
    expect(x.externalLinks ?? 0).toBe(0);
    expect(x.names.some((n: string) => /vbaProject|externalLink|connections|customXml/.test(n))).toBe(false);
    expect(x.allText).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|access_token|refresh_token|source_report_id/);
    expect(x.docProps.core).not.toMatch(/로컬검수|@/);
  });
  it('cleanText drops XML-illegal control characters only', () => {
    expect(cleanText('a\u0001b\tc\nd\u007f')).toBe('ab\tc\nd');
  });
});

describe('F06 loader: bytes are checked before WebAssembly', () => {
  const res = (body: Uint8Array | string, init: ResponseInit & { type?: string } = {}) => async () =>
    new Response(body as BodyInit, { status: init.status ?? 200, headers: { 'content-type': init.type ?? 'application/gzip' } });
  const wasm = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 1, 0, 0, 0]);
  it('EX-41 gzip passes; raw wasm (server-decoded) is re-wrapped once; HTML/404/garbage refused', async () => {
    const gz = new Uint8Array(gzipSync(Buffer.from(wasm)));
    expect((await checkedArchive('x', res(gz) as typeof fetch)).slice(0, 2)).toEqual(new Uint8Array([0x1f, 0x8b]));
    expect((await checkedArchive('x', res(wasm, { type: 'application/wasm' }) as typeof fetch)).slice(0, 2)).toEqual(new Uint8Array([0x1f, 0x8b]));
    await expect(checkedArchive('x', res('<!doctype html>', { type: 'text/html' }) as typeof fetch)).rejects.toMatchObject({ code: 'asset_not_wasm' });
    await expect(checkedArchive('x', res('nope', { status: 404, type: 'text/plain' }) as typeof fetch)).rejects.toMatchObject({ code: 'asset_http' });
    await expect(checkedArchive('x', res('garbage!', { type: 'application/octet-stream' }) as typeof fetch)).rejects.toMatchObject({ code: 'asset_not_wasm' });
    await expect(checkedArchive('x', (async () => { throw new TypeError('offline'); }) as typeof fetch)).rejects.toMatchObject({ code: 'asset_network' });
  });
});

it('row keys are tuples (sanity for refs)', () => { expect(tupleKey(['a'])).toBe('["a"]'); });
