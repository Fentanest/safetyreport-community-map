/**
 * F06 Excel export — the transferable snapshot (pure DTO, main thread → Worker). An entry point (맞춤 통계, 월별 추이,
 * 담당자 차트) captures ONE of these at click time from the result it is displaying; the Worker turns it into an .xlsx
 * with Excelize. Never an AuthSnapshot, a Supabase client, an ECharts instance, a token or a user id.
 *
 *   통계표      the complete table (every row/column/metric of the captured result), exact numbers, rates as =분자/분모
 *   차트        native charts that reference 차트 데이터 cells; heatmaps as cell matrices with conditional formatting
 *   조회 조건    fixed dates (Asia/Seoul), conditions, legend state, definitions, missing-value rules, snapshot note
 *   차트 데이터  the aggregated blocks the charts read (formulas that point at 통계표 cells), never individual reports
 */
export type XUnit = 'count' | 'percent' | 'won' | 'days' | 'score' | 'month' | 'text';
export type XValue = number | string | null;

export interface XColumn {
  id: string;
  /** header levels, top → bottom (the last level is made unique by the writer) */
  header: string[];
  unit: XUnit;
  /** a rate column: written as =num/den of the same row when the denominator is > 0 (a real 0% stays 0) */
  rate?: { num: string; den: string };
  /** a label column (row header) */
  label?: boolean;
  width?: number;
}
export interface XRow {
  id: string;
  cells: Record<string, XValue>;
  /** text written in an empty value cell to say why it is empty (분모 없음, 자료 없음, 해당 신고 없음 …) */
  reasons?: Record<string, string>;
  total?: boolean;
}
export interface XTable { columns: XColumn[]; rows: XRow[]; notes: string[] }

/** a table cell (row id × column id) */
export interface XRef { row: string; col: string }

export interface XSeries {
  key: string;
  name: string;
  /** #RRGGBB */
  color: string;
  dashed?: boolean;
  marker?: 'circle' | 'diamond' | 'none';
  /** one per category; null = no value (a gap / no bar, never 0) */
  points: Array<XRef | null>;
  /** fixed-denominator shares (100% stacks): point ÷ SUM(these cells) per category — the ORIGINAL partition */
  shareOf?: Array<XRef[] | null>;
  /** hidden in the web legend at click time: kept in 차트 데이터, left out of the chart unless asked */
  hidden?: boolean;
}
export interface XCategoryChart {
  kind: 'line' | 'col' | 'bar' | 'colStacked' | 'barStacked';
  id: string;
  title: string;
  categoryTitle: string;
  categories: string[];
  series: XSeries[];
  unit: XUnit;
  axis?: { min?: number; max?: number };
  /** a second chart type on a secondary axis (e.g. 답변 건수 line over 100% bars): units never share one axis */
  combo?: { kind: 'line'; series: XSeries[]; unit: XUnit };
  note?: string;
}
export interface XScatterChart {
  kind: 'scatter';
  id: string;
  title: string;
  xName: string;
  yName: string;
  xUnit: XUnit;
  yUnit: XUnit;
  points: Array<{ label: string; x: XRef; y: XRef }>;
  note?: string;
}
export interface XHeatmap {
  kind: 'heatmap';
  id: string;
  title: string;
  unit: XUnit;
  /** colour scale (the same for every population of one comparison): rates 0–1, counts/amounts 0..common max */
  min: number;
  max: number;
  rowTitle: string;
  rows: string[];
  cols: string[];
  /** rows × cols, null = no reports in that combination (blank, not 0) */
  cells: Array<Array<XRef | null>>;
  note?: string;
}
export type XChart = XCategoryChart | XScatterChart | XHeatmap;

export type ExportSource = 'statistics' | 'trend' | 'place-managers';
export interface ExportSnapshot {
  schema: 1;
  source: ExportSource;
  /** e.g. '커뮤니티신고지도_맞춤통계' (no personal name, report number or detailed address) */
  fileStem: string;
  title: string;
  /** ISO time of the click (the file describes this capture) */
  capturedAt: string;
  datasetVersion: string | null;
  conditions: Array<{ label: string; value: string }>;
  table: XTable;
  charts: XChart[];
  /** shown on the 차트 sheet instead of (or above) the charts: all series hidden, a summary value, a too-big chart … */
  chartNotice: string | null;
  /** series hidden in the web legend at click time, and whether the file's chart includes them anyway */
  legend: { hidden: string[]; includeHidden: boolean } | null;
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const SHEETS = { table: '통계표', chart: '차트', conditions: '조회 조건', data: '차트 데이터' } as const;

export type ExportStage = 'prepare' | 'table' | 'chart' | 'finalize';
export const STAGE_LABEL: Record<ExportStage, string> = {
  prepare: '엑셀 기능 준비 중', table: '통계표 작성 중', chart: '차트 작성 중', finalize: '파일 만드는 중',
};
export type ExportErrorCode =
  | 'asset_network' | 'asset_http' | 'asset_not_wasm' | 'init_failed' | 'unsupported' | 'worker_failed'
  | 'out_of_memory' | 'write_failed' | 'invalid_output' | 'cancelled';
export const ERROR_TEXT: Record<ExportErrorCode, string> = {
  asset_network: '엑셀 기능 파일을 내려받지 못했습니다(네트워크).',
  asset_http: '엑셀 기능 파일을 찾지 못했습니다.',
  asset_not_wasm: '엑셀 기능 파일이 손상되었거나 잘못된 형식으로 전달되었습니다.',
  init_failed: '엑셀 기능을 시작하지 못했습니다.',
  unsupported: '이 브라우저에서는 엑셀 파일을 만들 수 없습니다(WebAssembly 미지원).',
  worker_failed: '파일을 만드는 작업이 중단되었습니다.',
  out_of_memory: '파일이 너무 커서 만들지 못했습니다. 비교 대상이나 기간을 줄여 주세요.',
  write_failed: '엑셀 파일을 쓰는 중 오류가 났습니다.',
  invalid_output: '만들어진 파일이 올바른 엑셀 파일이 아닙니다.',
  cancelled: '파일 만들기를 취소했습니다.',
};
export class ExportError extends Error {
  constructor(public code: ExportErrorCode, detail?: string) { super(detail ? `${ERROR_TEXT[code]} (${detail})` : ERROR_TEXT[code]); }
}

/** Asia/Seoul wall clock of an instant: '2026-09-29 15:30:00 (KST)' and the compact file stamp '20260929_153000' */
export function kst(iso: string): { text: string; stamp: string } {
  const d = new Date(new Date(iso).getTime() + 9 * 3600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  const y = d.getUTCFullYear(), mo = p(d.getUTCMonth() + 1), da = p(d.getUTCDate()), h = p(d.getUTCHours()), mi = p(d.getUTCMinutes()), s = p(d.getUTCSeconds());
  return { text: `${y}-${mo}-${da} ${h}:${mi}:${s} (Asia/Seoul)`, stamp: `${y}${mo}${da}_${h}${mi}${s}` };
}
export const fileName = (snap: Pick<ExportSnapshot, 'fileStem' | 'capturedAt'>) => `${snap.fileStem}_${kst(snap.capturedAt).stamp}.xlsx`;

/** Excel serial of the first day of a 'YYYY-MM' month (pure calendar arithmetic: no timezone shift) */
export const monthSerial = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return (Date.UTC(y, m - 1, 1) - Date.UTC(1899, 11, 30)) / 86_400_000;
};
