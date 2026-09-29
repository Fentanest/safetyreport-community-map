/**
 * F06 workbook writer: ExportSnapshot → .xlsx bytes with Excelize (excelize-wasm, pinned in package.json).
 * Runs in the export Worker (or the same code on the main thread as a fallback, or in Node for tests). Every Excelize
 * call returns `{ error }` instead of throwing; `ok()` turns an error into an ExportError so no step fails silently.
 *
 * Linking (so the numbers are never independent copies):
 *   통계표 rate cell      = 분자 cell / 분모 cell (same row), only when the denominator is > 0
 *   차트 데이터 value     = '통계표'!cell   (or cell / SUM(original partition cells) for 100% stacks)
 *   native chart series  → '차트 데이터' ranges (names, categories and values are cell references)
 *   heatmap matrix       = '통계표'!cell + a colour-scale conditional format on the matrix
 * Every formula is written after its value, so the file carries a cached value and Excel recalculates on open.
 * Empty values stay empty cells (never ="" or 0): lines break, bars are absent, the colour scale skips them.
 */
import {
  ExportError, SHEETS, kst, type ExportSnapshot, type ExportStage, type XCategoryChart, type XColumn, type XHeatmap,
  type XRef, type XScatterChart, type XSeries, type XUnit, type XValue,
} from './model';

type Ret = { error?: string | null } | undefined;
/** the subset of the Excelize file API this writer uses (checked against excelize-wasm 0.1.3's index.d.ts) */
export interface XFile {
  error?: string | null;
  SetSheetName(a: string, b: string): Ret;
  NewSheet(s: string): { index: number; error: string | null };
  SetActiveSheet(i: number): Ret;
  SetCellStr(s: string, c: string, v: string): Ret;
  SetCellFloat(s: string, c: string, v: number, precision: number, bitSize: number): Ret;
  SetCellInt(s: string, c: string, v: number): Ret;
  SetCellFormula(s: string, c: string, f: string): Ret;
  SetCellStyle(s: string, a: string, b: string, style: number): Ret;
  NewStyle(style: Record<string, unknown>): { style: number; error: string | null };
  SetColWidth(s: string, a: string, b: string, w: number): Ret;
  SetRowHeight(s: string, r: number, h: number): Ret;
  SetPanes(s: string, p: Record<string, unknown>): Ret;
  AddChart(s: string, cell: string, chart: Record<string, unknown>, combo?: Record<string, unknown>): Ret;
  SetConditionalFormat(s: string, ref: string, opts: Array<Record<string, unknown>>): Ret;
  SetDocProps(p: Record<string, unknown>): Ret;
  SetCalcProps?(p: Record<string, unknown>): Ret;
  WriteToBuffer(): { buffer: unknown; error: string | null };
}
export interface XModule { NewFile(): XFile }

// chart type ids of excelize-wasm 0.1.3 (ChartType enum order in index.d.ts; checked by tests/product/excelExport.test.ts)
export const CHART = { Bar: 6, BarStacked: 7, Col: 21, ColStacked: 22, Line: 41, Scatter: 48 } as const;
const LINE_DASH = 3; // LineDashDash
const FONT = '맑은 고딕';

const ok = (ret: Ret, step: string) => { if (ret && ret.error) throw new ExportError('write_failed', `${step}: ${ret.error}`); };

/** XML 1.0 cannot carry C0 controls (except tab/newline/CR) or lone surrogates: removed so Excel never "repairs" */
export const cleanText = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '�');

export function colName(n: number): string {
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}
const addr = (col: number, row: number) => `${colName(col)}${row}`;
const abs = (col: number, row: number) => `$${colName(col)}$${row}`;
const q = (sheet: string) => `'${sheet.replace(/'/g, "''")}'`;
const ref = (sheet: string, col: number, row: number) => `${q(sheet)}!${abs(col, row)}`;
const range = (sheet: string, c1: number, r1: number, c2: number, r2: number) => `${q(sheet)}!${abs(c1, r1)}:${abs(c2, r2)}`;

const NUMFMT: Record<XUnit, string> = {
  count: '#,##0"건"', percent: '0.0%', won: '#,##0"원"', days: '0.0"일"', score: '0.00"점"', month: 'yyyy-mm', text: '@',
};
const AXIS_FMT: Record<XUnit, string> = { count: '#,##0', percent: '0%', won: '#,##0', days: '0.0', score: '0.0', month: 'yyyy-mm', text: 'General' };
export const UNIT_TEXT: Record<XUnit, string> = { count: '건', percent: '비율(0~100%)', won: '원', days: '일', score: '점', month: '월', text: '' };

export interface WriteResult { bytes: Uint8Array; stats: { tableCells: number; formulas: number; charts: number; heatmaps: number } }

export function writeWorkbook(x: XModule, snap: ExportSnapshot, onStage: (s: ExportStage) => void = () => undefined): WriteResult {
  const f = x.NewFile();
  if (f.error) throw new ExportError('write_failed', `NewFile: ${f.error}`);
  const stats = { tableCells: 0, formulas: 0, charts: 0, heatmaps: 0 };
  const style = (s: Record<string, unknown>) => { const r = f.NewStyle(s); ok(r, 'NewStyle'); return r.style; };
  const font = (extra: Record<string, unknown> = {}) => ({ Family: FONT, Size: 10, Color: '#1F2937', ...extra });
  const border = [{ Type: 'bottom', Color: '#D1D5DB', Style: 1 }];
  const S = {
    title: style({ Font: font({ Size: 14, Bold: true, Color: '#111827' }) }),
    note: style({ Font: font({ Color: '#4B5563' }), Alignment: { WrapText: true, Vertical: 'top' } }),
    /** one-line note that flows into the empty cells to its right (charts sheet, table notes) */
    flow: style({ Font: font({ Color: '#4B5563' }) }),
    head: style({ Font: font({ Bold: true }), Fill: { Type: 'pattern', Pattern: 1, Color: ['#F3F4F6'] }, Border: border, Alignment: { WrapText: true, Vertical: 'center', Horizontal: 'center' } }),
    label: style({ Font: font(), Alignment: { Vertical: 'top', WrapText: true } }),
    totalLabel: style({ Font: font({ Bold: true }), Fill: { Type: 'pattern', Pattern: 1, Color: ['#F9FAFB'] } }),
    reason: style({ Font: font({ Color: '#6B7280', Italic: true }), Alignment: { Horizontal: 'right' } }),
    key: style({ Font: font({ Bold: true }), Alignment: { Vertical: 'top' } }),
    num: Object.fromEntries((Object.keys(NUMFMT) as XUnit[]).map((u) => [u, style({ Font: font(), CustomNumFmt: NUMFMT[u], Alignment: { Horizontal: u === 'text' ? 'left' : 'right' } })])) as Record<XUnit, number>,
    numTotal: Object.fromEntries((Object.keys(NUMFMT) as XUnit[]).map((u) => [u, style({ Font: font({ Bold: true }), CustomNumFmt: NUMFMT[u], Fill: { Type: 'pattern', Pattern: 1, Color: ['#F9FAFB'] }, Alignment: { Horizontal: 'right' } })])) as Record<XUnit, number>,
  };
  const str = (sheet: string, cell: string, v: string, st?: number) => { ok(f.SetCellStr(sheet, cell, cleanText(v)), `text ${sheet}!${cell}`); if (st !== undefined) ok(f.SetCellStyle(sheet, cell, cell, st), 'style'); };
  const num = (sheet: string, cell: string, v: number, st?: number) => {
    if (!Number.isFinite(v)) throw new ExportError('write_failed', `non-finite number at ${sheet}!${cell}`);
    ok(Number.isInteger(v) && Math.abs(v) < 2 ** 31 ? f.SetCellInt(sheet, cell, v) : f.SetCellFloat(sheet, cell, v, -1, 64), `number ${sheet}!${cell}`);
    if (st !== undefined) ok(f.SetCellStyle(sheet, cell, cell, st), 'style');
  };
  /** trusted formulas only (built here from cell addresses): the cached value first, then the formula */
  const formula = (sheet: string, cell: string, cached: number, fx: string, st?: number) => {
    num(sheet, cell, cached, st);
    ok(f.SetCellFormula(sheet, cell, fx), `formula ${sheet}!${cell}`);
    stats.formulas += 1;
  };

  // ── sheets (fixed, valid, unique names) ─────────────────────────────────────────────────────────────────
  ok(f.SetSheetName('Sheet1', SHEETS.table), 'rename');
  for (const name of [SHEETS.chart, SHEETS.data, SHEETS.conditions]) { const r = f.NewSheet(name); ok(r, `sheet ${name}`); }

  // ── 통계표 ──────────────────────────────────────────────────────────────────────────────────────────────
  onStage('table');
  const T = SHEETS.table;
  const cols = snap.table.columns;
  const colIndex = new Map(cols.map((c, i) => [c.id, i + 1]));
  str(T, 'A1', snap.title, S.title);
  str(T, 'A2', `${kst(snap.capturedAt).text} 기준 집계 snapshot · 조건은 ‘${SHEETS.conditions}’ 시트`, S.flow);
  const levels = Math.max(1, ...cols.map((c) => c.header.length));
  const headTop = 4;
  const headerRows = levels; // hierarchy rows; the last one is the unique column name
  const unique = uniqueHeaders(cols);
  cols.forEach((c, i) => {
    for (let l = 0; l < levels; l++) {
      // upper rows: the hierarchy (col member / metric / population); last row: the unique full column name
      const text = l === levels - 1 ? unique[i] : c.header.length === levels ? c.header[l] : '';
      str(T, addr(i + 1, headTop + l), text, S.head);
    }
  });
  const firstDataRow = headTop + headerRows;
  const rowIndex = new Map<string, number>();
  const cached = new Map<string, number | null>();
  snap.table.rows.forEach((r, ri) => {
    const rr = firstDataRow + ri;
    rowIndex.set(r.id, rr);
    cols.forEach((c, ci) => {
      const cell = addr(ci + 1, rr);
      const key = `${r.id}\u0000${c.id}`;
      let v: XValue = r.cells[c.id] ?? null;
      if (c.rate) {
        const n = r.cells[c.rate.num], d = r.cells[c.rate.den];
        if (typeof n === 'number' && typeof d === 'number' && d > 0) {
          const nc = colIndex.get(c.rate.num)!, dc = colIndex.get(c.rate.den)!;
          formula(T, cell, n / d, `${addr(nc, rr)}/${addr(dc, rr)}`, r.total ? S.numTotal[c.unit] : S.num[c.unit]);
          cached.set(key, n / d);
          stats.tableCells += 1;
          return;
        }
        v = typeof v === 'number' ? v : null; // a rate without a usable denominator keeps its reason below
      }
      if (typeof v === 'number') {
        const unit = c.unit === 'month' ? 'month' : c.unit;
        num(T, cell, v, r.total ? S.numTotal[unit] : S.num[unit]);
        cached.set(key, v);
      } else if (typeof v === 'string') {
        str(T, cell, v, c.label ? (r.total ? S.totalLabel : S.label) : S.label);
        cached.set(key, null);
      } else {
        const why = r.reasons?.[c.id];
        if (why) str(T, cell, why, S.reason);
        cached.set(key, null);
      }
      stats.tableCells += 1;
    });
  });
  const lastRow = firstDataRow + snap.table.rows.length - 1;
  cols.forEach((c, i) => ok(f.SetColWidth(T, colName(i + 1), colName(i + 1), c.width ?? (c.label ? 22 : 14)), 'width'));
  const labelCols = cols.filter((c) => c.label).length;
  ok(f.SetPanes(T, { Freeze: true, XSplit: labelCols, YSplit: firstDataRow - 1, TopLeftCell: addr(labelCols + 1, firstDataRow), ActivePane: 'bottomRight' }), 'panes');
  let noteRow = lastRow + 2;
  for (const n of snap.table.notes) { str(T, addr(1, noteRow), n, S.flow); noteRow += 1; }

  const tableRef = (r: XRef): { a: string; v: number | null } | null => {
    const rr = rowIndex.get(r.row), cc = colIndex.get(r.col);
    if (!rr || !cc) return null;
    return { a: ref(T, cc, rr), v: cached.get(`${r.row}\u0000${r.col}`) ?? null };
  };

  // ── 차트 데이터 + 차트 ────────────────────────────────────────────────────────────────────────────────────
  onStage('chart');
  const D = SHEETS.data, C = SHEETS.chart;
  str(D, 'A1', '차트 데이터', S.title);
  str(D, 'A2', `차트가 읽는 집계 칸입니다(개별 신고가 아닙니다). 값 칸은 ‘${T}’ 시트의 칸을 가리키는 수식이라 통계표의 분자·분모를 고치면 차트도 바뀝니다. 이 시트의 값 칸에 숫자를 직접 넣어도 차트에 반영되지만 통계표와는 달라집니다. 빈 칸은 값이 없다는 뜻(0 아님)입니다.`, S.flow);
  ok(f.SetColWidth(D, 'A', 'A', 26), 'width');
  ok(f.SetColWidth(D, 'B', 'Z', 16), 'width');
  str(C, 'A1', `${snap.title} · 차트`, S.title);
  ok(f.SetColWidth(C, 'A', 'A', 24), 'width');
  let dRow = 4;
  let cRow = 3;
  if (snap.chartNotice) { str(C, addr(1, cRow), snap.chartNotice, S.flow); cRow += 2; }
  const includeHidden = snap.legend?.includeHidden ?? false;

  /** one data block: header row + one row per category; returns where each series column landed */
  const block = (title: string, categoryTitle: string, categories: Array<string | number>, categoryUnit: XUnit, series: XSeries[], unitOf: (s: XSeries) => XUnit) => {
    str(D, addr(1, dRow), title, S.key);
    const head = dRow + 1;
    str(D, addr(1, head), categoryTitle, S.head);
    series.forEach((s, i) => str(D, addr(i + 2, head), s.hidden && !includeHidden ? `${s.name} (그래프에서 숨김)` : s.name, S.head));
    categories.forEach((cat, k) => {
      const rr = head + 1 + k;
      if (typeof cat === 'number') num(D, addr(1, rr), cat, S.num[categoryUnit]);
      else str(D, addr(1, rr), cat, S.label);
    });
    series.forEach((s, i) => {
      const col = i + 2;
      s.points.forEach((p, k) => {
        const rr = head + 1 + k;
        if (!p) return;
        const t = tableRef(p);
        if (!t || t.v === null) return; // empty in the table → empty here (a gap, never 0)
        const share = s.shareOf?.[k];
        if (s.shareOf) {
          if (!share) return;
          const dens = share.map(tableRef).filter((x): x is NonNullable<typeof x> => !!x);
          const total = dens.reduce((a, x) => a + (x.v ?? 0), 0);
          if (total <= 0) return;
          formula(D, addr(col, rr), t.v / total, `${t.a}/SUM(${dens.map((x) => x.a).join(',')})`, S.num.percent);
        } else {
          formula(D, addr(col, rr), t.v, t.a, S.num[unitOf(s)]);
        }
      });
    });
    const out = { head, first: head + 1, last: head + categories.length, col: new Map(series.map((s, i) => [s.key, i + 2])) };
    dRow = head + categories.length + 2;
    return out;
  };

  const seriesOpts = (b: ReturnType<typeof block>, s: XSeries, kind: string) => {
    const col = b.col.get(s.key)!;
    const base: Record<string, unknown> = {
      Name: ref(D, col, b.head), Categories: range(D, 1, b.first, 1, b.last), Values: range(D, col, b.first, col, b.last),
    };
    if (kind === 'line') {
      base.Line = { Width: 2, Fill: { Type: 'pattern', Pattern: 1, Color: [s.color] }, ...(s.dashed ? { Dash: LINE_DASH } : {}) };
      base.Marker = { Symbol: s.marker ?? (s.dashed ? 'diamond' : 'circle'), Size: 6, Fill: { Type: 'pattern', Pattern: 1, Color: [s.color] } };
    } else {
      base.Fill = { Type: 'pattern', Pattern: 1, Color: [s.color] };
      if (s.dashed) base.Line = { Dash: LINE_DASH, Width: 1, Fill: { Type: 'pattern', Pattern: 1, Color: [s.color] } };
    }
    return base;
  };
  const TYPE: Record<XCategoryChart['kind'], number> = { line: CHART.Line, col: CHART.Col, bar: CHART.Bar, colStacked: CHART.ColStacked, barStacked: CHART.BarStacked };
  const axisOf = (unit: XUnit, a?: { min?: number; max?: number }) => ({
    MajorGridLines: true, NumFmt: { CustomNumFmt: AXIS_FMT[unit], SourceLinked: false },
    ...(a?.min !== undefined ? { Minimum: a.min } : unit === 'text' ? {} : { Minimum: 0 }), ...(a?.max !== undefined ? { Maximum: a.max } : {}),
  });

  const placeTitle = (title: string, note?: string) => {
    str(C, addr(1, cRow), title, S.key);
    cRow += 1;
    if (note) { str(C, addr(1, cRow), note, S.flow); cRow += 1; }
  };

  for (const ch of snap.charts) {
    if (ch.kind === 'heatmap') { writeHeatmap(ch); continue; }
    if (ch.kind === 'scatter') { writeScatter(ch); continue; }
    writeCategory(ch);
  }

  function writeCategory(ch: XCategoryChart) {
    const all = [...ch.series, ...(ch.combo?.series ?? [])];
    const comboKeys = new Set((ch.combo?.series ?? []).map((s) => s.key));
    const b = block(ch.title, ch.categoryTitle, ch.categories, 'text', all,
      (s) => (s.shareOf ? 'percent' : comboKeys.has(s.key) ? ch.combo!.unit : ch.unit));
    const drawn = ch.series.filter((s) => includeHidden || !s.hidden);
    const drawnCombo = (ch.combo?.series ?? []).filter((s) => includeHidden || !s.hidden);
    placeTitle(ch.title, ch.note);
    if (drawn.length === 0 && drawnCombo.length === 0) {
      str(C, addr(1, cRow), '현재 모든 계열을 숨겼습니다. 표와 차트 데이터에는 전부 있습니다(0건이 아닙니다). 웹에서 범례의 ‘전체 보기’를 누르거나 다운로드할 때 ‘숨긴 계열도 차트에 포함’을 고르세요.', S.flow);
      cRow += 3;
      return;
    }
    const kindWord = ch.kind === 'line' ? 'line' : 'bar';
    const height = Math.min(640, Math.max(320, ch.kind === 'bar' || ch.kind === 'barStacked' ? 28 + ch.categories.length * 22 : 360));
    const chart: Record<string, unknown> = {
      Type: TYPE[ch.kind], Series: drawn.map((s) => seriesOpts(b, s, kindWord)),
      Title: { Paragraph: [{ Text: cleanText(ch.title), Font: { Family: FONT, Size: 12, Bold: true } }] },
      Legend: { Position: 'bottom' }, VaryColors: false, ShowBlanksAs: 'gap',
      Dimension: { Width: 820, Height: height },
      YAxis: axisOf(ch.unit, ch.axis),
      XAxis: { Font: { Family: FONT, Size: 9 } },
      ...(ch.kind === 'col' || ch.kind === 'bar' ? { GapWidth: 80 } : {}),
      ...(ch.kind === 'colStacked' || ch.kind === 'barStacked' ? { Overlap: 100, GapWidth: 60 } : {}),
    };
    let combo: Record<string, unknown> | undefined;
    if (ch.combo && drawnCombo.length) {
      combo = { Type: CHART.Line, Series: drawnCombo.map((s) => seriesOpts(b, s, 'line')), YAxis: { ...axisOf(ch.combo.unit), Secondary: true, MajorGridLines: false }, ShowBlanksAs: 'gap' };
    }
    // excelize-wasm checks the argument count: the combo argument is passed only when there is one
    ok(combo ? f.AddChart(C, addr(2, cRow), chart, combo) : f.AddChart(C, addr(2, cRow), chart), `chart ${ch.id}`);
    stats.charts += 1;
    cRow += Math.ceil(height / 20) + 2;
  }

  function writeScatter(ch: XScatterChart) {
    str(D, addr(1, dRow), ch.title, S.key);
    const head = dRow + 1;
    str(D, addr(1, head), '항목', S.head);
    str(D, addr(2, head), ch.xName, S.head);
    str(D, addr(3, head), ch.yName, S.head);
    let rr = head;
    for (const p of ch.points) {
      const tx = tableRef(p.x), ty = tableRef(p.y);
      if (!tx || !ty || tx.v === null || ty.v === null) continue;
      rr += 1;
      str(D, addr(1, rr), p.label, S.label);
      formula(D, addr(2, rr), tx.v, tx.a, S.num[ch.xUnit]);
      formula(D, addr(3, rr), ty.v, ty.a, S.num[ch.yUnit]);
    }
    dRow = rr + 2;
    placeTitle(ch.title, ch.note);
    if (rr === head) { str(C, addr(1, cRow), '두 지표가 모두 있는 항목이 없어 산점도를 그리지 않았습니다.', S.flow); cRow += 2; return; }
    ok(f.AddChart(C, addr(2, cRow), {
      Type: CHART.Scatter,
      Series: [{ Name: ref(D, 1, head - 1), Categories: range(D, 2, head + 1, 2, rr), Values: range(D, 3, head + 1, 3, rr),
        Marker: { Symbol: 'circle', Size: 7, Fill: { Type: 'pattern', Pattern: 1, Color: ['#2563EB'] } } }],
      Title: { Paragraph: [{ Text: cleanText(ch.title), Font: { Family: FONT, Size: 12, Bold: true } }] },
      Legend: { Position: 'none' }, Dimension: { Width: 720, Height: 420 },
      XAxis: { ...axisOf(ch.xUnit), Title: { Paragraph: [{ Text: cleanText(ch.xName) }] } },
      YAxis: { ...axisOf(ch.yUnit), Title: { Paragraph: [{ Text: cleanText(ch.yName) }] } },
    }), `scatter ${ch.id}`);
    stats.charts += 1;
    cRow += 24;
  }

  function writeHeatmap(h: XHeatmap) {
    placeTitle(h.title, h.note);
    const top = cRow;
    str(C, addr(1, top), h.rowTitle, S.head);
    h.cols.forEach((c, i) => str(C, addr(i + 2, top), c, S.head));
    h.rows.forEach((r, ri) => {
      const rr = top + 1 + ri;
      str(C, addr(1, rr), r, S.label);
      h.cells[ri].forEach((p, ci) => {
        if (!p) return;
        const t = tableRef(p);
        if (!t || t.v === null) return;
        formula(C, addr(ci + 2, rr), t.v, t.a, S.num[h.unit]);
      });
    });
    if (h.rows.length && h.cols.length) {
      ok(f.SetConditionalFormat(C, `${addr(2, top + 1)}:${addr(h.cols.length + 1, top + h.rows.length)}`, [{
        Type: '2_color_scale', Criteria: '=', MinType: 'num', MaxType: 'num', MinValue: String(h.min), MaxValue: String(h.max),
        MinColor: '#DBEAFE', MaxColor: '#1D4ED8',
      }]), `heatmap ${h.id}`);
    }
    ok(f.SetColWidth(C, 'B', colName(Math.max(2, h.cols.length + 1)), 14), 'width');
    stats.heatmaps += 1;
    cRow = top + h.rows.length + 3;
  }

  // ── 조회 조건 ─────────────────────────────────────────────────────────────────────────────────────────────
  const Q = SHEETS.conditions;
  str(Q, 'A1', `${snap.title} · 조회 조건`, S.title);
  ok(f.SetColWidth(Q, 'A', 'A', 22), 'width');
  ok(f.SetColWidth(Q, 'B', 'B', 96), 'width');
  const rows: Array<{ label: string; value: string }> = [
    { label: '내보낸 시각', value: kst(snap.capturedAt).text },
    { label: '자료 버전', value: snap.datasetVersion ?? '—' },
    ...snap.conditions,
  ];
  if (snap.legend) {
    rows.push({ label: '그래프 범례', value: snap.legend.hidden.length === 0 ? '모든 계열 표시'
      : `그래프에서 숨긴 계열: ${snap.legend.hidden.join(', ')} — ${snap.legend.includeHidden ? '이 파일의 차트에는 포함했습니다' : '이 파일의 차트에서도 빠져 있고, 통계표와 차트 데이터에는 포함되어 있습니다'}` });
  }
  rows.push({ label: '이 파일', value: '조회 당시 집계 결과의 snapshot입니다. Excel에서 자료를 다시 불러오지 않으며, 지도 사이트의 최신 자료와 다를 수 있습니다. 개별 신고·차량번호·신고번호·계정 정보는 들어 있지 않습니다. 파일을 다른 사람에게 보내면 그 안의 집계와 이름을 볼 수 있습니다.' });
  rows.forEach((r, i) => { str(Q, addr(1, 3 + i), r.label, S.key); str(Q, addr(2, 3 + i), r.value, S.note); });

  // ── properties: no personal data; recalculate formulas when opened ─────────────────────────────────────
  ok(f.SetDocProps({ Title: cleanText(snap.title), Creator: '커뮤니티 신고 지도', LastModifiedBy: '', Created: snap.capturedAt, Modified: snap.capturedAt }), 'doc props');
  if (f.SetCalcProps) ok(f.SetCalcProps({ FullCalcOnLoad: true }), 'calc props');
  ok(f.SetActiveSheet(0), 'active sheet');

  onStage('finalize');
  const out = f.WriteToBuffer();
  if (out.error) throw new ExportError('write_failed', `WriteToBuffer: ${out.error}`);
  const bytes = toBytes(out.buffer);
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) throw new ExportError('invalid_output', 'not a ZIP (xlsx) buffer');
  return { bytes, stats };
}

/** the buffer's real type → an owned Uint8Array copy (never a view into the WASM heap) */
export function toBytes(b: unknown): Uint8Array {
  let view: Uint8Array;
  if (b instanceof Uint8Array) view = b;
  else if (b instanceof ArrayBuffer) view = new Uint8Array(b);
  else if (ArrayBuffer.isView(b)) view = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  else throw new ExportError('invalid_output', `unexpected buffer type ${Object.prototype.toString.call(b)}`);
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);
  return copy;
}

/** the last header level becomes a unique, readable column name (e.g. '강남서 · 과태료처분율 · 전체 · 비율') */
export function uniqueHeaders(cols: XColumn[]): string[] {
  const names = cols.map((c) => c.header.filter(Boolean).join(' · ') || c.id);
  const seen = new Map<string, number>();
  return names.map((n) => {
    const k = (seen.get(n) ?? 0) + 1;
    seen.set(n, k);
    return k === 1 ? n : `${n} (${k})`;
  });
}
