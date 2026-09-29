/**
 * F06 adapters of the dashboard cards: 월별 추이 (TrendCard) and 담당자별 처리 현황 (PlaceEntityChart, address or
 * range). They read the same selectors as the cards (trendRateRows / entityRates), so the file shows the numbers,
 * denominators and missing reasons of the screen — and only the rows the card actually has.
 */
import type { MonthlyBucket, PublicEntity } from '../../domain/public';
import type { CompareMonth } from '../../domain/personal';
import { TREND_RATES, TREND_RATE_LABEL, TREND_RATE_TOKEN, REASON_TEXT, trendRateRows, type TrendRate } from '../../components/trendMetrics';
import { duplicateNames, entityLabel, entityRates } from '../../components/entityMetrics';
import { FILE_COLOR } from './statistics';
import { monthSerial, type ExportSnapshot, type XCategoryChart, type XColumn, type XRow, type XSeries } from '../model';

const RATE_PARTS: Record<TrendRate, { num: 'A' | 'P' | 'R' | 'F'; den: 'K' | 'C' }> = {
  accept: { num: 'A', den: 'K' }, partial: { num: 'P', den: 'K' }, reject: { num: 'R', den: 'K' }, fine: { num: 'F', den: 'C' },
};
const PART_LABEL = { C: '답변 완료(건)', K: '결과 확인(건)', A: '수용(건)', P: '일부수용(건)', R: '불수용(건)', F: '과태료(건)' } as const;

export interface TrendExportInput {
  monthly: readonly MonthlyBucket[];
  /** my months, only when the comparison is shown AND arrived (else null) */
  mine: readonly CompareMonth[] | null;
  view: 'count' | 'rate';
  rates: readonly TrendRate[];
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

  const columns: XColumn[] = [
    { id: 'month', header: ['월'], unit: 'month', label: true, width: 12 },
    { id: 'report', header: ['건수', '신고(건, 신고한 달)'], unit: 'count' },
    { id: 'completed', header: ['건수', '답변 완료(건, 답변 받은 달)'], unit: 'count' },
    ...(withMine ? [
      { id: 'mine_report', header: ['건수', '내 신고(건, 신고한 달)'], unit: 'count' as const },
      { id: 'mine_completed', header: ['건수', '내 답변 완료(건)'], unit: 'count' as const },
    ] : []),
  ];
  for (const s of sides) {
    for (const p of ['K', 'A', 'P', 'R', 'F'] as const) columns.push({ id: `${p}:${s}`, header: [sideWord(s), PART_LABEL[p]], unit: 'count' });
    for (const k of TREND_RATES) columns.push({ id: `rate:${k}:${s}`, header: [sideWord(s), `${TREND_RATE_LABEL[k]} (${RATE_PARTS[k].num}/${RATE_PARTS[k].den})`], unit: 'percent',
      rate: { num: `${RATE_PARTS[k].num}:${s}`, den: RATE_PARTS[k].den === 'C' ? (s === 'all' ? 'completed' : 'mine_completed') : `K:${s}` } });
  }
  columns.push({ id: 'note', header: ['비고'], unit: 'text', width: 16 });

  const rows: XRow[] = rateRows.map((rr) => {
    const m = byMonth.get(rr.month)!;
    const mm = mineBy.get(rr.month);
    const row: XRow = { id: rr.month, cells: { month: monthSerial(rr.month), report: m.report_count, completed: m.completed_count, note: m.partial ? '진행 중인 달' : m.coverage_note ?? null }, reasons: {} };
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
    chart = { kind: 'line', id: 'trend:count', title: '월별 신고·답변 건수', categoryTitle: '월', categories, unit: 'count', axis: { min: 0 },
      series: [s('report', '신고', FILE_COLOR.brand), s('completed', '답변 완료', FILE_COLOR.cyan), ...(withMine ? [s('mine_report', '내 신고', FILE_COLOR.brand, true)] : [])],
      note: '신고는 신고한 달, 답변은 답변 받은 달에 셉니다. 자료가 없는 달은 선을 끊습니다.' };
  } else {
    const series: XSeries[] = input.rates.flatMap((k) => sides.map((s) => ({
      key: `rate:${k}:${s}`, name: `${TREND_RATE_LABEL[k]} · ${sideWord(s)}`, color: FILE_COLOR[TREND_RATE_TOKEN[k]], dashed: s === 'mine', marker: s === 'mine' ? 'diamond' as const : 'circle' as const,
      points: rateRows.map((r) => ((s === 'all' ? r.all : r.mine!)[k].value === null ? null : { row: r.month, col: `rate:${k}:${s}` })),
    })));
    chart = { kind: 'line', id: 'trend:rate', title: `월별 처리결과 비율 · ${input.rates.map((k) => TREND_RATE_LABEL[k]).join('·')}`, categoryTitle: '월', categories,
      unit: 'percent', axis: { min: 0, max: 1 }, series,
      note: '답변 받은 달 기준. 수용·일부·불수용은 결과 확인 건수, 과태료는 답변 완료 건수가 분모입니다(네 선을 더해 100%가 되지 않음). 분모가 없는 달은 선을 끊고, 실제 0%는 0에 찍습니다.' };
  }
  return {
    schema: 1, source: 'trend', fileStem: '커뮤니티신고지도_월별추이', title: input.view === 'count' ? '월별 추이 · 건수' : '월별 추이 · 처리결과 비율',
    capturedAt: input.capturedAt, datasetVersion: input.datasetVersion,
    conditions: [...input.conditions,
      { label: '보기', value: input.view === 'count' ? '건수(신고·답변)' : `처리결과 비율 · 선택 지표 ${input.rates.map((k) => TREND_RATE_LABEL[k]).join(', ')}` },
      { label: '내 신고 비교', value: withMine ? '포함(내 신고는 이 파일을 내보낸 사람의 신고)' : '포함 안 함' },
      { label: '계산식', value: '수용률 = 수용 ÷ 결과 확인(수용+일부수용+불수용) · 일부수용률 = 일부수용 ÷ 결과 확인 · 불수용률 = 불수용 ÷ 결과 확인 · 과태료처분율 = 과태료 ÷ 답변 완료. 결과 미상은 결과 확인에서 빠집니다.' },
      { label: '빈 값', value: '분모 없음 = 그 달의 분모가 0 · 서버 미지원 = 서버가 그 항목을 보내지 않음 · 자료 없음 = 자료 범위 밖. 모두 0이 아닙니다.' }],
    table: { columns, rows, notes: ['비율 칸은 같은 행의 분자 ÷ 분모 수식입니다. 월은 그 달 1일의 날짜 값(yyyy-mm 서식)입니다.', '이번 달(진행 중)은 아직 끝나지 않아 다른 달보다 적을 수 있습니다.'] },
    charts: [chart], chartNotice: input.view === 'rate' && input.rates.length === 0 ? '선택한 지표가 없어 차트를 만들지 않았습니다.' : null,
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
  const dup = duplicateNames(input.managers);
  const labels = input.managers.map((e) => entityLabel(e, 'manager', dup.has(e.manager_name ?? '이름 없음')));
  const columns: XColumn[] = [
    { id: 'name', header: ['담당자'], unit: 'text', label: true, width: 26 },
    { id: 'agency', header: ['소속 기관'], unit: 'text', label: true, width: 22 },
    { id: 'C', header: ['건수', '답변 완료(C)'], unit: 'count' }, { id: 'K', header: ['건수', '결과 확인(K)'], unit: 'count' },
    { id: 'U', header: ['건수', '결과 미상(U)'], unit: 'count' }, { id: 'A', header: ['건수', '수용(A)'], unit: 'count' },
    { id: 'P', header: ['건수', '일부수용(P)'], unit: 'count' }, { id: 'R', header: ['건수', '불수용(R)'], unit: 'count' },
    { id: 'F', header: ['건수', '과태료(F)'], unit: 'count' }, { id: 'O', header: ['건수', '과태료 외(C−F)'], unit: 'count' },
    { id: 'accept', header: ['비율', '수용률 A/K'], unit: 'percent', rate: { num: 'A', den: 'K' } },
    { id: 'partial', header: ['비율', '일부수용률 P/K'], unit: 'percent', rate: { num: 'P', den: 'K' } },
    { id: 'reject', header: ['비율', '불수용률 R/K'], unit: 'percent', rate: { num: 'R', den: 'K' } },
    { id: 'fine', header: ['비율', '과태료처분율 F/C'], unit: 'percent', rate: { num: 'F', den: 'C' } },
    { id: 'other', header: ['비율', '과태료 외 비율 (C−F)/C'], unit: 'percent', rate: { num: 'O', den: 'C' } },
  ];
  const rows: XRow[] = input.managers.map((e, i) => {
    const m = entityRates(e);
    const reasons: Record<string, string> = {};
    if (m.K === 0) for (const k of ['accept', 'partial', 'reject']) reasons[k] = '분모 없음';
    if (m.F === null) { reasons.fine = '서버 미지원'; reasons.other = '서버 미지원'; } else if (m.C === 0) { reasons.fine = '분모 없음'; reasons.other = '분모 없음'; }
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
      kind: 'colStacked', id: `managers:${input.mode}:${a}`, title: `담당자별 ${input.mode === 'accept' ? '수용률' : '과태료처분율'}${n > CHUNK ? ` (${a + 1}–${b} / ${n})` : ''}`,
      categoryTitle: '담당자', categories: labels.slice(a, b), unit: 'percent', axis: { min: 0, max: 1 },
      series: parts.map((p) => ({ key: `${p.col}`, name: p.name, color: p.color, points: slice.map((e) => (usable(e) ? { row: e.key, col: p.col } : null)) })),
      combo: { kind: 'line', unit: 'count', series: [{ key: 'C', name: '답변 완료(건, 보조축)', color: '#111827', marker: 'circle', points: slice.map((e) => ({ row: e.key, col: 'C' })) }] },
      note: `${input.mode === 'accept' ? '막대의 100%는 결과 확인 건수(수용+일부수용+불수용)입니다. 결과 미상은 막대에서 빠집니다.' : '막대의 100%는 답변 완료 건수입니다.'} 선은 답변 완료 건수(오른쪽 보조축, 건)입니다. 비율과 건수는 서로 다른 축입니다.${n > CHUNK ? ` 담당자가 많아 ${CHUNK}명씩 나눠 그렸습니다(생략 없음).` : ''}`,
    });
  }
  const partial = n < input.total;
  return {
    schema: 1, source: 'place-managers', fileStem: '커뮤니티신고지도_담당자별처리현황', title: input.scopeTitle, capturedAt: input.capturedAt, datasetVersion: input.datasetVersion,
    conditions: [...input.conditions,
      { label: '담당자 범위', value: partial ? `일부: 화면에서 불러온 담당자 ${n.toLocaleString('ko-KR')}명 / 전체 ${input.total.toLocaleString('ko-KR')}명(나머지는 이 파일에 없습니다)` : `전체 ${n.toLocaleString('ko-KR')}명` },
      { label: '막대 기준', value: input.mode === 'accept' ? '수용률(결과 확인 기준 100%)' : '과태료처분율(답변 완료 기준 100%)' },
      { label: '계산식', value: 'C 답변 완료 · K = A+P+R 결과 확인 · U = C−K 결과 미상 · 수용률 A/K · 일부수용률 P/K · 불수용률 R/K · 과태료처분율 F/C. 분모가 0이면 비율을 비웁니다.' }],
    table: { columns, rows, notes: ['비율 칸은 같은 행의 분자 ÷ 분모 수식입니다. 동명이인은 소속 기관으로 구분합니다.', ...(partial ? [`담당자 ${input.total.toLocaleString('ko-KR')}명 중 ${n.toLocaleString('ko-KR')}명만 담았습니다(화면 목록과 같음).`] : [])] },
    charts, chartNotice: n === 0 ? '담당자 정보가 있는 답변 신고가 없습니다.' : null, legend: null,
  };
}
