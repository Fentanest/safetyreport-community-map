/**
 * F06 adapters of the dashboard cards: 월별 추이 (TrendCard) and 담당자별 처리 현황 (PlaceEntityChart, address or
 * range). They read the same selectors as the cards (trendRateRows / entityRates), so the file shows the numbers,
 * denominators and missing reasons of the screen — and only the rows the card actually has.
 */
import type { DateBasis, MonthlyBucket, PublicEntity } from '../../domain/public';
import type { CompareMonth } from '../../domain/personal';
import { TREND_RATES, TREND_RATE_LABEL, TREND_RATE_TOKEN, REASON_TEXT, monthNote, trendRateRows, type TrendRate } from '../../components/trendMetrics';
import { entityLabel, entityRates } from '../../components/entityMetrics';
import { sameNameIndex } from '../../domain/managerNames';
import { FILE_COLOR } from './statistics';
import { monthSerial, type ExportSnapshot, type XCategoryChart, type XColumn, type XRow, type XSeries } from '../model';

const RATE_PARTS: Record<TrendRate, { num: 'A' | 'P' | 'R' | 'F'; den: 'K' | 'C' }> = {
  accept: { num: 'A', den: 'K' }, partial: { num: 'P', den: 'K' }, reject: { num: 'R', den: 'K' }, fine: { num: 'F', den: 'C' },
};
/** how each rate is computed, in words (column headers of the file) */
const RATE_TEXT: Record<TrendRate, string> = {
  accept: '수용 ÷ (수용+일부수용+불수용)', partial: '일부수용 ÷ (수용+일부수용+불수용)', reject: '불수용 ÷ (수용+일부수용+불수용)', fine: '과태료 처분 ÷ 답변',
};
const PART_LABEL = { C: '답변(건)', K: '분류된 답변(건)', A: '수용(건)', P: '일부 수용(건)', R: '불수용(건)', F: '과태료 처분(건)' } as const;

export interface TrendExportInput {
  monthly: readonly MonthlyBucket[];
  /** my months, only when the comparison is shown AND arrived (else null) */
  mine: readonly CompareMonth[] | null;
  view: 'count' | 'rate';
  rates: readonly TrendRate[];
  /** the ONE basis whose months these are (신고월 / 답변월) — same model as the screen, never re-selected here */
  basis?: DateBasis;
  conditions: Array<{ label: string; value: string }>;
  datasetVersion: string | null;
  capturedAt: string;
}

export function trendSnapshot(input: TrendExportInput): ExportSnapshot {
  const withMine = !!input.mine;
  const rateRows = trendRateRows(input.monthly, input.mine);
  const byMonth = new Map(input.monthly.map((m) => [m.month, m]));
  const mineBy = new Map((input.mine ?? []).map((m) => [m.month, m]));
  const sides = withMine ? (['all', 'mine'] as const) : (['all'] as const);
  const sideWord = (s: 'all' | 'mine') => (s === 'all' ? '전체' : '내 신고');
  const monthWord = input.basis === 'report_date' ? '신고월' : '답변월';

  const columns: XColumn[] = [
    { id: 'month', header: [monthWord], unit: 'month', label: true, width: 12 },
    { id: 'report', header: ['건수', `신고(건, ${monthWord})`], unit: 'count' },
    { id: 'completed', header: ['건수', `답변 완료(건, ${monthWord})`], unit: 'count' },
    ...(withMine ? [
      { id: 'mine_report', header: ['건수', `내 신고(건, ${monthWord})`], unit: 'count' as const },
      { id: 'mine_completed', header: ['건수', `내 답변 완료(건, ${monthWord})`], unit: 'count' as const },
    ] : []),
  ];
  for (const s of sides) {
    for (const p of ['K', 'A', 'P', 'R', 'F'] as const) columns.push({ id: `${p}:${s}`, header: [sideWord(s), PART_LABEL[p]], unit: 'count' });
    for (const k of TREND_RATES) columns.push({ id: `rate:${k}:${s}`, header: [sideWord(s), `${TREND_RATE_LABEL[k]} (${RATE_TEXT[k]})`], unit: 'percent',
      rate: { num: `${RATE_PARTS[k].num}:${s}`, den: RATE_PARTS[k].den === 'C' ? (s === 'all' ? 'completed' : 'mine_completed') : `K:${s}` } });
  }
  columns.push({ id: 'note', header: ['비고'], unit: 'text', width: 16 });

  const rows: XRow[] = rateRows.map((rr) => {
    const m = byMonth.get(rr.month)!;
    const mm = mineBy.get(rr.month);
    const row: XRow = { id: rr.month, cells: { month: monthSerial(rr.month), report: m.report_count, completed: m.completed_count, note: monthNote(m) || null }, reasons: {} };
    if (withMine) { row.cells.mine_report = mm?.mine_report_count ?? null; row.cells.mine_completed = mm?.mine_completed_count ?? null; }
    for (const s of sides) {
      const o = s === 'all' ? m.outcomes : mm?.mine_outcomes ?? null;
      const f = s === 'all' ? m.fine_count : mm?.mine_fine_count ?? null;
      if (o) { row.cells[`K:${s}`] = o.result_known; row.cells[`A:${s}`] = o.accepted; row.cells[`P:${s}`] = o.partial; row.cells[`R:${s}`] = o.rejected; }
      row.cells[`F:${s}`] = f ?? null;
      for (const k of TREND_RATES) {
        const c = (s === 'all' ? rr.all : rr.mine!)[k];
        if (c.value === null) row.reasons![`rate:${k}:${s}`] = c.reason ? REASON_TEXT[c.reason] : '—';
      }
    }
    return row;
  });

  const categories = rateRows.map((r) => r.month);
  let chart: XCategoryChart;
  if (input.view === 'count') {
    const s = (key: string, name: string, color: string, dashed = false): XSeries => ({ key, name, color, dashed, marker: dashed ? 'diamond' : 'circle',
      points: rateRows.map((r) => (typeof rows.find((x) => x.id === r.month)!.cells[key] === 'number' ? { row: r.month, col: key } : null)) });
    chart = { kind: 'line', id: 'trend:count', title: `${monthWord}별 신고·답변 건수`, categoryTitle: monthWord, categories, unit: 'count', axis: { min: 0 },
      series: [s('report', '신고', FILE_COLOR.brand), s('completed', '답변 완료', FILE_COLOR.cyan), ...(withMine ? [s('mine_report', '내 신고', FILE_COLOR.brand, true)] : [])],
    };
  } else {
    const series: XSeries[] = input.rates.flatMap((k) => sides.map((s) => ({
      key: `rate:${k}:${s}`, name: `${TREND_RATE_LABEL[k]} · ${sideWord(s)}`, color: FILE_COLOR[TREND_RATE_TOKEN[k]], dashed: s === 'mine', marker: s === 'mine' ? 'diamond' as const : 'circle' as const,
      points: rateRows.map((r) => ((s === 'all' ? r.all : r.mine!)[k].value === null ? null : { row: r.month, col: `rate:${k}:${s}` })),
    })));
    chart = { kind: 'line', id: 'trend:rate', title: `${monthWord}별 처리결과 비율 · ${input.rates.map((k) => TREND_RATE_LABEL[k]).join('·')}`, categoryTitle: monthWord, categories,
      unit: 'percent', axis: { min: 0, max: 1 }, series,
      note: '수용·일부수용·불수용은 미분류를 뺀 답변 중, 과태료는 전체 답변 중 비율입니다.' };
  }
  return {
    schema: 1, source: 'trend', fileStem: '커뮤니티신고지도_월별추이', title: input.view === 'count' ? '월별 추이 · 건수' : '월별 추이 · 처리결과 비율',
    capturedAt: input.capturedAt, datasetVersion: input.datasetVersion,
    conditions: [...input.conditions,
      { label: '보기', value: input.view === 'count' ? '건수 (신고·답변)' : `처리결과 비율 (${input.rates.map((k) => TREND_RATE_LABEL[k]).join(', ')})` },
      { label: '내 신고', value: withMine ? '함께 넣음' : '넣지 않음' },
      { label: '계산 방법', value: '수용률·일부수용률·불수용률은 (수용+일부수용+불수용) 중 비율, 과태료 부과율은 전체 답변 중 과태료 처분의 비율입니다. 미분류는 안전신문고 처리 상태가 ‘답변완료’·‘기타’라 수용 여부가 없는 답변입니다.' },
      { label: '빈 칸의 뜻', value: '계산 불가: 기준 신고 0건 · 제공 안 됨: 아직 없는 항목 · 자료 없음: 자료 기간 밖' }],
    table: { columns, rows, notes: ['비율은 같은 줄의 ‘해당 건수 ÷ 기준 건수’ 수식입니다.'] },
    charts: [chart], chartNotice: input.view === 'rate' && input.rates.length === 0 ? '고른 지표가 없어 차트는 넣지 않았습니다.' : null,
    legend: null,
  };
}

export interface PlaceExportInput {
  managers: readonly PublicEntity[];
  total: number;
  mode: 'accept' | 'fine';
  scopeTitle: string;
  conditions: Array<{ label: string; value: string }>;
  datasetVersion: string | null;
  capturedAt: string;
}
const CHUNK = 40;

export function placeManagersSnapshot(input: PlaceExportInput): ExportSnapshot {
  // the SAME names as the chart and its table (server 동명이인 metadata over the scope's full list)
  const same = sameNameIndex(input.managers);
  const labels = input.managers.map((e) => entityLabel(e, 'manager', same.get(e)));
  const namesakes = input.managers.filter((e) => same.get(e)).length;
  const columns: XColumn[] = [
    { id: 'name', header: ['담당자'], unit: 'text', label: true, width: 26 },
    { id: 'agency', header: ['소속 기관'], unit: 'text', label: true, width: 22 },
    { id: 'C', header: ['건수', '답변'], unit: 'count' }, { id: 'K', header: ['건수', '분류된 답변'], unit: 'count' },
    { id: 'U', header: ['건수', '미분류'], unit: 'count' }, { id: 'A', header: ['건수', '수용'], unit: 'count' },
    { id: 'P', header: ['건수', '일부 수용'], unit: 'count' }, { id: 'R', header: ['건수', '불수용'], unit: 'count' },
    { id: 'F', header: ['건수', '과태료 처분'], unit: 'count' }, { id: 'O', header: ['건수', '과태료 외 처분'], unit: 'count' },
    { id: 'accept', header: ['비율', '수용률'], unit: 'percent', rate: { num: 'A', den: 'K' } },
    { id: 'partial', header: ['비율', '일부수용률'], unit: 'percent', rate: { num: 'P', den: 'K' } },
    { id: 'reject', header: ['비율', '불수용률'], unit: 'percent', rate: { num: 'R', den: 'K' } },
    { id: 'fine', header: ['비율', '과태료 부과율'], unit: 'percent', rate: { num: 'F', den: 'C' } },
    { id: 'other', header: ['비율', '과태료 외 비율'], unit: 'percent', rate: { num: 'O', den: 'C' } },
  ];
  const rows: XRow[] = input.managers.map((e, i) => {
    const m = entityRates(e);
    const reasons: Record<string, string> = {};
    if (m.K === 0) for (const k of ['accept', 'partial', 'reject']) reasons[k] = '계산 불가';
    if (m.F === null) { reasons.fine = '제공 안 됨'; reasons.other = '제공 안 됨'; } else if (m.C === 0) { reasons.fine = '계산 불가'; reasons.other = '계산 불가'; }
    return { id: e.key, reasons, cells: { name: labels[i], agency: e.agency_name, C: m.C, K: m.K, U: m.U, A: m.A, P: m.P, R: m.R, F: m.F, O: m.F === null ? null : m.C - m.F } };
  });
  const parts = input.mode === 'accept'
    ? [{ col: 'accept', name: '수용', color: FILE_COLOR.accepted }, { col: 'partial', name: '일부수용', color: FILE_COLOR.partial }, { col: 'reject', name: '불수용', color: FILE_COLOR.rejected }]
    : [{ col: 'fine', name: '과태료 처분', color: FILE_COLOR.fine }, { col: 'other', name: '과태료 외(경고·범칙금·처분 없음·미확인)', color: FILE_COLOR.unknown }];
  const usable = (e: PublicEntity) => { const m = entityRates(e); return input.mode === 'accept' ? m.K > 0 : m.F !== null && m.C > 0; };
  const charts: XCategoryChart[] = [];
  const n = input.managers.length;
  for (let a = 0; a < n; a += CHUNK) {
    const b = Math.min(n, a + CHUNK);
    const slice = input.managers.slice(a, b);
    charts.push({
      kind: 'colStacked', id: `managers:${input.mode}:${a}`, title: `담당자별 ${input.mode === 'accept' ? '수용률' : '과태료 부과율'}${n > CHUNK ? ` (${a + 1}–${b} / ${n})` : ''}`,
      categoryTitle: '담당자', categories: labels.slice(a, b), unit: 'percent', axis: { min: 0, max: 1 },
      series: parts.map((p) => ({ key: `${p.col}`, name: p.name, color: p.color, points: slice.map((e) => (usable(e) ? { row: e.key, col: p.col } : null)) })),
      combo: { kind: 'line', unit: 'count', series: [{ key: 'C', name: '답변 완료(건, 오른쪽 축)', color: '#111827', marker: 'circle', points: slice.map((e) => ({ row: e.key, col: 'C' })) }] },
      note: `선은 답변 완료 건수(오른쪽 축)입니다.${n > CHUNK ? ` 담당자가 많아 ${CHUNK}명씩 나눠 그렸습니다.` : ''}`,
    });
  }
  const partial = n < input.total;
  return {
    schema: 1, source: 'place-managers', fileStem: '커뮤니티신고지도_담당자별처리현황', title: input.scopeTitle, capturedAt: input.capturedAt, datasetVersion: input.datasetVersion,
    conditions: [...input.conditions,
      { label: '담당자', value: partial ? `불러온 ${n.toLocaleString('ko-KR')}명 (전체 ${input.total.toLocaleString('ko-KR')}명)` : `전체 ${n.toLocaleString('ko-KR')}명` },
      { label: '막대 기준', value: input.mode === 'accept' ? '수용률 ((수용+일부수용+불수용)를 100%로)' : '과태료 부과율 (전체 답변을 100%로)' },
      { label: '계산 방법', value: '수용률·일부수용률·불수용률은 (수용+일부수용+불수용) 중 비율, 과태료 부과율은 전체 답변 중 과태료 처분의 비율입니다. 미분류는 안전신문고 처리 상태가 ‘답변완료’·‘기타’라 수용 여부가 없는 답변입니다.' }],
    table: { columns, rows, notes: ['비율은 같은 줄의 ‘해당 건수 ÷ 기준 건수’ 수식입니다.',
      ...(namesakes > 0 ? ['같은 이름의 담당자는 담당자 칸에 소속 기관을 짧게 붙였습니다.'] : []), ...(partial ? [`전체 담당자 ${input.total.toLocaleString('ko-KR')}명 중 화면에 불러온 ${n.toLocaleString('ko-KR')}명만 담았습니다.`] : [])] },
    charts, chartNotice: n === 0 ? '담당자 정보가 있는 답변 신고가 없습니다.' : null, legend: null,
  };
}
