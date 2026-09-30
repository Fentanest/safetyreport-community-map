/**
 * New analytics cards A01–A04, A06 (server DTOs only; no raw reports reach the browser). Every card has a table
 * alternative, a caption with its denominator/exclusions, and distinguishes 0 from "no data".
 */
import { useMemo, useState, type ReactNode } from 'react';
import type {
  DurationDistribution, EntityScatter, LawHeatmap, RatingDistribution, RatingRow, ScatterEntity, VehicleDayDistribution,
} from '../domain/public';
import { LAW_NONE } from '../domain/public';
import type { CompareEntityRow } from '../domain/personal';
import { baseOption, useEChart } from '../lib/charts';
import { METRIC_RAMP, METRIC_NULL } from '../lib/kakao';
import { LAW_UNKNOWN_LABEL } from '../state/filters';
import { fmtDays, fmtInt, fmtPercent } from './format';
import Icon from './icons';

const pct = (n: number, d: number) => (d > 0 ? (n / d) * 100 : null);

function Card({ title, subtitle, tools, children, caption, label, wide }: { title: string; subtitle: string; tools?: ReactNode;
  children: ReactNode; caption?: ReactNode; label: string; wide?: boolean }) {
  return (
    <article className={`cm-panel chart-card${wide ? ' wide' : ''}`} aria-label={label}>
      <div className="panel-top">
        <div><h2>{title}</h2><span className="subtitle">{subtitle}</span></div>
        {tools && <div className="card-tools">{tools}</div>}
      </div>
      {children}
      {caption && <p className="chart-caption">{caption}</p>}
    </article>
  );
}

function TableToggle({ table, onToggle }: { table: boolean; onToggle: () => void }) {
  return (
    <button className="icon-btn" type="button" aria-label={table ? '그래프로 보기' : '표로 보기'} aria-pressed={table} onClick={onToggle}>
      <Icon name="table" />
    </button>
  );
}

function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void; label: string }) {
  return (
    <div className="mini-segments" role="group" aria-label={label}>
      {options.map(([id, text]) => (
        <button key={id} type="button" className={value === id ? 'selected' : ''} aria-pressed={value === id} onClick={() => onChange(id)}>{text}</button>
      ))}
    </div>
  );
}

const Unsupported = ({ what }: { what: string }) => <div className="empty-state">{what} 정보는 아직 제공하지 않습니다.</div>;

// ── A01 ─────────────────────────────────────────────────────────────────────────────────────────────
export function DurationCard({ all, mine, theme }: { all: DurationDistribution | null; mine: DurationDistribution | null; theme: string }) {
  const [mode, setMode] = useState<'count' | 'share'>('count');
  const [table, setTable] = useState(false);
  const effective = mine ? 'share' : mode; // comparing groups of different size only makes sense in shares
  const { hostRef, error } = useEChart((t) => {
    if (!all || all.valid_count === 0) return null;
    const labels = all.buckets.map((b) => b.label);
    const val = (d: DurationDistribution, i: number) => (effective === 'share' ? d.buckets[i]?.percentage ?? null : d.buckets[i]?.count ?? 0);
    return { ...baseOption(t), grid: { left: 44, right: 12, top: 20, bottom: 44 },
      tooltip: { ...baseOption(t).tooltip, trigger: 'axis', formatter: (ps: Array<{ dataIndex: number }>) => {
        const i = ps[0]?.dataIndex ?? 0;
        const line = (name: string, d: DurationDistribution) => `${name} ${fmtInt(d.buckets[i].count)}건 · ${fmtPercent(d.buckets[i].percentage)} (유효 ${fmtInt(d.valid_count)}건 중)`;
        return [`<b>${labels[i]}</b>`, line('전체', all), ...(mine ? [line('내 신고', mine)] : [])].join('<br/>');
      } },
      xAxis: { type: 'category', data: labels, axisLabel: { color: t.muted, rotate: 40, fontSize: 10 }, axisLine: { lineStyle: { color: t.grid } } },
      yAxis: { type: 'value', min: 0, ...(effective === 'share' ? { max: 100 } : {}), splitLine: { lineStyle: { color: t.grid } },
        axisLabel: { color: t.muted, formatter: effective === 'share' ? '{value}%' : '{value}' } },
      series: [
        { name: '전체', type: 'bar', barMaxWidth: 26, data: all.buckets.map((_, i) => val(all, i)), itemStyle: { color: t.brand, borderRadius: [3, 3, 0, 0] },
          markLine: all.median_days === null ? undefined : { symbol: 'none', silent: true, lineStyle: { color: t.partial, type: 'dashed' },
            label: { color: t.partial, formatter: `중앙값 ${fmtDays(all.median_days)}` },
            data: [{ xAxis: Math.min(all.buckets.length - 1, Math.floor(all.median_days / all.bucket_width_days)) }] } },
        ...(mine && mine.valid_count > 0 ? [{ name: '내 신고', type: 'bar', barMaxWidth: 26, data: mine.buckets.map((_, i) => val(mine, i)),
          itemStyle: { color: t.cyan, borderRadius: [3, 3, 0, 0] } }] : []),
      ] };
  }, [all, mine, effective], theme);
  return (
    <Card label="답변까지 걸린 기간의 분포" title="답변까지 걸린 기간" subtitle="기간 구간별 건수 · 7일 단위, 마지막 구간은 84일 이상"
      tools={<>
        {!mine && <Seg label="값" value={mode} onChange={setMode} options={[['count', '건수'], ['share', '비중']]} />}
        <TableToggle table={table} onToggle={() => setTable((v) => !v)} />
      </>}
      caption={all && <>중앙값 {fmtDays(all.median_days)} · 평균 {fmtDays(all.mean_days)} · 90%는 {fmtDays(all.p90_days)} 이내</>}>
      {!all ? <Unsupported what="기간 분포" /> : all.valid_count === 0 ? <div className="empty-state">기간을 계산할 수 있는 답변이 없습니다.</div> : null}
      <div ref={hostRef} className="chart-host" hidden={table || !all || all.valid_count === 0 || !!error} role="img"
        aria-label={all ? `기간 구간별 건수 ${all.buckets.map((b) => `${b.label} ${b.count}건`).join(', ')}` : '자료 없음'} />
      {error && !table && <div className="empty-state" role="alert">{error}</div>}
      {table && all && (
        <div className="trend-table"><table>
          <thead><tr><th scope="col">기간</th><th scope="col">전체 건수</th><th scope="col">전체 비중</th>{mine && <th scope="col">내 건수</th>}{mine && <th scope="col">내 비중</th>}</tr></thead>
          <tbody>{all.buckets.map((b, i) => (
            <tr key={b.label}><td>{b.label}</td><td>{fmtInt(b.count)}</td><td>{fmtPercent(b.percentage)}</td>
              {mine && <td>{fmtInt(mine.buckets[i]?.count ?? null)}</td>}{mine && <td>{fmtPercent(mine.buckets[i]?.percentage ?? null)}</td>}</tr>
          ))}</tbody>
        </table></div>
      )}
    </Card>
  );
}

// ── A02 ─────────────────────────────────────────────────────────────────────────────────────────────
type CellMetric = 'accept' | 'reject' | 'fine';
const CELL_LABEL: Record<CellMetric, string> = { accept: '수용률', reject: '불수용률', fine: '과태료 부과율' };
const lawText = (key: string) => (key === LAW_NONE ? LAW_UNKNOWN_LABEL : key);

export function HeatmapCard({ data, theme, onPick }: { data: LawHeatmap | null; theme: string;
  onPick: (row: LawHeatmap['rows'][number], lawKey: string) => void }) {
  const [metric, setMetric] = useState<CellMetric>('accept');
  const [expanded, setExpanded] = useState(false);
  const [table, setTable] = useState(false);
  // narrow screens get fewer law columns so every cell stays readable (the rest via 더 넓게 보기 / 표)
  const narrow = typeof window !== 'undefined' && window.matchMedia?.('(max-width: 700px)').matches === true;
  const rows = data ? (expanded ? data.rows : data.rows.slice(0, 8)) : [];
  const laws = data ? (expanded ? data.laws : data.laws.slice(0, narrow ? 4 : 7)) : [];
  const cellOf = useMemo(() => new Map((data?.cells ?? []).map((c) => [`${c.row_key}\u0000${c.law_key}`, c])), [data]);
  const value = (c: LawHeatmap['cells'][number]) => (metric === 'fine' ? pct(c.fine_count, c.completed_count)
    : pct(metric === 'accept' ? c.outcomes.accepted : c.outcomes.rejected, c.outcomes.result_known));
  const rowName = (r: LawHeatmap['rows'][number]) => (data?.row_kind === 'manager' ? `${r.manager_name ?? '이름 없음'} · ${r.agency_name}` : r.agency_name);
  const { hostRef, error } = useEChart((t) => {
    if (!data || rows.length === 0 || laws.length === 0) return null;
    const points: Array<{ value: [number, number, number | string, number]; label: { color: string } }> = [];
    rows.forEach((r, y) => laws.forEach((l, x) => {
      const c = cellOf.get(`${r.key}\u0000${l.law_key}`);
      if (!c) return; // no reports for this pair: empty cell, never 0%
      const v = value(c);
      // readable label on the ramp: dark text on light cells, white on dark ones
      points.push({ value: [x, y, v === null ? '-' : Math.round(v * 10) / 10, c.completed_count],
        label: { color: v !== null && v >= 70 ? '#ffffff' : '#0b1220' } });
    }));
    const left = narrow ? 104 : 150;
    return { ...baseOption(t), grid: { left, right: 12, top: 8, bottom: 86 },
      tooltip: { ...baseOption(t).tooltip, formatter: (p: { data: { value: [number, number, number | string, number] } }) => {
        const [x, y] = p.data.value;
        const c = cellOf.get(`${rows[y].key}\u0000${laws[x].law_key}`)!;
        const num = metric === 'fine' ? c.fine_count : metric === 'accept' ? c.outcomes.accepted : c.outcomes.rejected;
        const den = metric === 'fine' ? c.completed_count : c.outcomes.result_known;
        return `<b>${rowName(rows[y])}</b><br/>${lawText(laws[x].law_key)}<br/>${CELL_LABEL[metric]} ${den > 0 ? `${((num / den) * 100).toFixed(1)}%` : '계산 불가'} (${fmtInt(num)}/${fmtInt(den)}건)<br/>답변 ${fmtInt(c.completed_count)}건 · 누르면 이 조합만 보기`;
      } },
      xAxis: { type: 'category', data: laws.map((l) => lawText(l.law_key).replace(/^도로교통법 /, '도교법 ')), splitArea: { show: false },
        axisLabel: { color: t.muted, rotate: 35, fontSize: 10, interval: 0 }, axisLine: { lineStyle: { color: t.grid } } },
      yAxis: { type: 'category', data: rows.map((r) => { const n = rowName(r); const max = narrow ? 9 : 16; return n.length > max ? `${n.slice(0, max - 1)}…` : n; }), inverse: true,
        axisLabel: { color: t.text, fontSize: 11 }, axisLine: { lineStyle: { color: t.grid } } },
      visualMap: { min: 0, max: 100, show: false, inRange: { color: [...METRIC_RAMP] }, outOfRange: { color: METRIC_NULL } },
      series: [{ type: 'heatmap', data: points, label: { show: true, fontSize: 10, color: t.text,
        formatter: (p: { data: { value: [number, number, number | string, number] } }) => (p.data.value[2] === '-' ? '–' : `${p.data.value[2]}%`) },
        itemStyle: { borderColor: t.surface, borderWidth: 2 }, emphasis: { itemStyle: { borderColor: t.text, borderWidth: 1 } } }],
    };
  }, [data, metric, expanded, narrow], theme, (params) => {
    const d = (params.data as { value: [number, number] } | undefined)?.value;
    if (!d) return;
    onPick(rows[d[1]], laws[d[0]].law_key);
  });
  return (
    <Card label="기관별 위반법규 처리결과" title={data?.row_kind === 'manager' ? '담당자 × 위반법규 처리결과' : '기관 × 위반법규 처리결과'}
      subtitle="칸을 누르면 그 조합만 봅니다"
      tools={<>
        <Seg label="지표" value={metric} onChange={setMetric} options={[['accept', '수용률'], ['reject', '불수용률'], ['fine', '과태료']]} />
        <TableToggle table={table} onToggle={() => setTable((v) => !v)} />
      </>}
      caption={data && <>
        {data.row_kind === 'manager' ? '담당자' : '기관'} {fmtInt(data.total_rows)}개 중 {fmtInt(rows.length)}개 · 법규 {fmtInt(data.total_laws)}개 중 {fmtInt(laws.length)}개(답변 많은 순)
        {' '}· ‘–’는 분류된 답변이 없는 칸{' '}
        {(data.rows.length > 8 || data.laws.length > laws.length) && (
          <button type="button" className="link-btn" onClick={() => setExpanded((v) => !v)}>{expanded ? '줄여 보기' : '더 넓게 보기'}</button>
        )}
      </>}>
      {!data ? <Unsupported what="기관 × 법규 교차표" /> : data.rows.length === 0 ? <div className="empty-state">표시할 위반법규 자료가 없습니다.</div> : null}
      <div ref={hostRef} className="chart-host tall" style={{ height: Math.max(220, rows.length * 30 + 100) }} hidden={table || !data || data.rows.length === 0 || !!error} role="img"
        aria-label="기관과 위반법규별 처리결과 히트맵. 표로 보기에서 같은 값을 읽을 수 있습니다." />
      {error && !table && <div className="empty-state" role="alert">{error}</div>}
      {table && data && (
        <div className="trend-table"><table>
          <thead><tr><th scope="col">{data.row_kind === 'manager' ? '담당자' : '기관'}</th>{laws.map((l) => <th key={l.law_key} scope="col">{lawText(l.law_key)}</th>)}</tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.key}><td>{rowName(r)}</td>{laws.map((l) => {
              const c = cellOf.get(`${r.key}\u0000${l.law_key}`);
              const v = c ? value(c) : null;
              return <td key={l.law_key}>{!c ? '' : v === null ? `– (${fmtInt(c.completed_count)}건)` : `${v.toFixed(1)}% (${fmtInt(c.completed_count)}건)`}</td>;
            })}</tr>
          ))}</tbody>
        </table></div>
      )}
    </Card>
  );
}

// ── A03 ─────────────────────────────────────────────────────────────────────────────────────────────
export function ScatterCard({ data, theme, mineKeys, onPick }: { data: EntityScatter | null; theme: string;
  mineKeys: { agency: Set<string>; manager: Set<string> } | null; onPick: (kind: 'agency' | 'manager', e: ScatterEntity) => void }) {
  const [kind, setKind] = useState<'agency' | 'manager'>('agency');
  const [y, setY] = useState<'fine' | 'accept'>('fine');
  const [table, setTable] = useState(false);
  const list = data ? (kind === 'agency' ? data.agencies : data.managers) : [];
  const total = data ? (kind === 'agency' ? data.agency_total : data.manager_total) : 0;
  const yOf = (e: ScatterEntity) => (y === 'fine' ? pct(e.fine_count, e.completed_count) : pct(e.outcomes.accepted, e.outcomes.result_known));
  const drawable = list.filter((e) => e.median_days !== null && yOf(e) !== null);
  const name = (e: ScatterEntity) => (kind === 'manager' ? `${e.manager_name ?? '이름 없음'} · ${e.agency_name}` : e.agency_name);
  const mine = mineKeys ? (kind === 'agency' ? mineKeys.agency : mineKeys.manager) : null;
  const maxN = Math.max(1, ...drawable.map((e) => e.completed_count));
  const { hostRef, error } = useEChart((t) => {
    if (drawable.length === 0) return null;
    const mk = (e: ScatterEntity) => ({ value: [e.median_days, Math.round(yOf(e)! * 10) / 10, e.completed_count], name: name(e),
      itemStyle: mine?.has(e.key) ? { borderColor: t.text, borderWidth: 2 } : undefined });
    return { ...baseOption(t), grid: { left: 48, right: 20, top: 16, bottom: 40 },
      tooltip: { ...baseOption(t).tooltip, formatter: (p: { dataIndex: number }) => {
        const e = drawable[p.dataIndex];
        const num = y === 'fine' ? e.fine_count : e.outcomes.accepted;
        const den = y === 'fine' ? e.completed_count : e.outcomes.result_known;
        return `<b>${name(e)}</b><br/>답변까지 중앙값 ${fmtDays(e.median_days)} (날짜 유효 ${fmtInt(e.duration_count)}건 / 답변 ${fmtInt(e.completed_count)}건)<br/>${y === 'fine' ? '과태료 부과율' : '수용률'} ${fmtPercent(yOf(e))} (${fmtInt(num)}/${fmtInt(den)}건)${mine?.has(e.key) ? '<br/>내 신고 있음' : ''}`;
      } },
      xAxis: { type: 'value', name: '답변까지 중앙값(일)', nameLocation: 'middle', nameGap: 26, min: 0, nameTextStyle: { color: t.muted },
        axisLabel: { color: t.muted }, splitLine: { lineStyle: { color: t.grid } } },
      yAxis: { type: 'value', min: 0, max: 100, axisLabel: { color: t.muted, formatter: '{value}%' }, splitLine: { lineStyle: { color: t.grid } } },
      series: [{ type: 'scatter', data: drawable.map(mk), symbolSize: (v: number[]) => 6 + 22 * Math.sqrt(v[2] / maxN),
        itemStyle: { color: y === 'fine' ? t.fine : t.accepted, opacity: 0.72 } }],
    };
  }, [data, kind, y, mineKeys], theme, (p) => onPick(kind, drawable[p.dataIndex]));
  return (
    <Card label="처리기간과 처리결과" title="처리기간 × 처리결과" subtitle="점 하나가 기관(또는 담당자) · 크기는 답변 건수 · 누르면 그 기관·담당자만 봅니다"
      tools={<>
        <Seg label="대상" value={kind} onChange={setKind} options={[['agency', '기관'], ['manager', '담당자']]} />
        <Seg label="세로축" value={y} onChange={setY} options={[['fine', '과태료'], ['accept', '수용률']]} />
        <TableToggle table={table} onToggle={() => setTable((v) => !v)} />
      </>}
      caption={data && (list.length < total || mine) ? <>{list.length < total && `${kind === 'agency' ? '기관' : '담당자'} ${fmtInt(total)}개 중 답변 많은 ${fmtInt(list.length)}개. `}
        {mine && '테두리가 있는 점은 내 신고가 있는 곳입니다.'}</> : null}>
      {!data ? <Unsupported what="처리기간 산점도" /> : drawable.length === 0 ? <div className="empty-state">그릴 수 있는 {kind === 'agency' ? '기관' : '담당자'}가 없습니다.</div> : null}
      <div ref={hostRef} className="chart-host" hidden={table || drawable.length === 0 || !!error} role="img" aria-label="기관별 처리기간 중앙값과 처리결과 비율 산점도. 표로 보기에서 값을 읽을 수 있습니다." />
      {error && !table && <div className="empty-state" role="alert">{error}</div>}
      {table && (
        <div className="trend-table"><table>
          <thead><tr><th scope="col">{kind === 'agency' ? '기관' : '담당자'}</th><th scope="col">답변</th><th scope="col">기간 유효</th><th scope="col">중앙값</th><th scope="col">{y === 'fine' ? '과태료 부과율' : '수용률'}</th></tr></thead>
          <tbody>{list.map((e) => <tr key={e.key}><td>{name(e)}</td><td>{fmtInt(e.completed_count)}</td><td>{fmtInt(e.duration_count)}</td><td>{fmtDays(e.median_days)}</td><td>{fmtPercent(yOf(e))}</td></tr>)}</tbody>
        </table></div>
      )}
    </Card>
  );
}

// ── A04 ─────────────────────────────────────────────────────────────────────────────────────────────
export function VehicleDaysCard({ data, theme }: { data: VehicleDayDistribution | null; theme: string }) {
  const [table, setTable] = useState(false);
  const { hostRef, error } = useEChart((t) => {
    if (!data || data.vehicle_count === 0) return null;
    return { ...baseOption(t), grid: { left: 44, right: 12, top: 24, bottom: 30 },
      tooltip: { ...baseOption(t).tooltip, trigger: 'axis', formatter: (ps: Array<{ dataIndex: number }>) => {
        const b = data.buckets[ps[0]?.dataIndex ?? 0];
        return `<b>서로 다른 신고일 ${b.label}</b><br/>차량 ${fmtInt(b.vehicle_count)}대 · ${fmtPercent(b.percentage)} (번호를 알 수 있는 ${fmtInt(data.vehicle_count)}대 중)`;
      } },
      xAxis: { type: 'category', data: data.buckets.map((b) => b.label), axisLabel: { color: t.muted, interval: 0 }, axisLine: { lineStyle: { color: t.grid } }, name: '신고일 수', nameLocation: 'end', nameTextStyle: { color: t.muted } },
      yAxis: { type: 'value', min: 0, minInterval: 1, axisLabel: { color: t.muted }, splitLine: { lineStyle: { color: t.grid } } },
      series: [{ type: 'bar', barMaxWidth: 48, data: data.buckets.map((b) => b.vehicle_count), itemStyle: { color: t.brand, borderRadius: [4, 4, 0, 0] },
        label: { show: true, position: 'top', color: t.text, fontSize: 11 } }] };
  }, [data], theme);
  return (
    <Card label="차량별 반복 신고일 분포" title="차량별 반복 신고일 분포" subtitle="같은 차량이 신고된 서로 다른 날짜 수 · 같은 날 여러 건은 하루로 셉니다"
      tools={<TableToggle table={table} onToggle={() => setTable((v) => !v)} />}
      caption={data && <>2일 이상 신고된 차량 {fmtInt(data.repeat_vehicle_count)}대 ({fmtPercent(data.repeat_share)}). 신고가 곧 위반 확정은 아니며 재범률이 아닙니다.</>}>
      {!data ? <Unsupported what="차량 신고일 분포" /> : data.vehicle_count === 0 ? <div className="empty-state">번호를 알 수 있는 차량 답변이 없습니다.</div> : null}
      <div ref={hostRef} className="chart-host" hidden={table || !data || data.vehicle_count === 0 || !!error} role="img"
        aria-label={data ? `차량 수 ${data.buckets.map((b) => `${b.label} ${b.vehicle_count}대`).join(', ')}` : '자료 없음'} />
      {error && !table && <div className="empty-state" role="alert">{error}</div>}
      {table && data && (
        <div className="trend-table"><table>
          <thead><tr><th scope="col">서로 다른 신고일</th><th scope="col">차량 수</th><th scope="col">비중</th></tr></thead>
          <tbody>{data.buckets.map((b) => <tr key={b.label}><td>{b.label}</td><td>{fmtInt(b.vehicle_count)}</td><td>{fmtPercent(b.percentage)}</td></tr>)}</tbody>
        </table></div>
      )}
    </Card>
  );
}

// ── A06 ─────────────────────────────────────────────────────────────────────────────────────────────
/** Row order and labels. 'fine' (과태료 처분) is a separate, overlapping cut — never summed with outcome rows. */
export const RATING_KEYS: ReadonlyArray<RatingRow['status']> = ['all', 'accepted', 'partial', 'rejected', 'fine', 'unknown'];
export const RATING_LABEL: Record<RatingRow['status'], string> = {
  all: '전체', accepted: '수용', partial: '일부 수용', rejected: '불수용', fine: '과태료 처분', unknown: '미분류',
};
export type MineRatingState = 'off' | 'loading' | 'error' | 'signed_out' | 'ready';
export interface RatingLine {
  key: RatingRow['status'];
  side: 'all' | 'mine';
  label: string;
  /** null = no row to draw: not provided by this server, still loading, or failed (see `note`) */
  row: RatingRow | null;
  note: string | null;
}

/** Rows of the card, matched by KEY (never by array position). With comparison on every category is paired
 *  as 전체 / 내 신고; a mine row is never filled with the public numbers. */
/** in paired mode the 전체 row is named by what it covers, so it never reads “전체 · 전체” */
const pairName = (key: RatingRow['status']) => (key === 'all' ? '모든 결과' : RATING_LABEL[key]);

export function ratingLines(all: RatingDistribution, mine: RatingDistribution | null, state: MineRatingState): RatingLine[] {
  const pick = (d: RatingDistribution | null, key: RatingRow['status']) => d?.rows.find((r) => r.status === key) ?? null;
  const lines: RatingLine[] = [];
  for (const key of RATING_KEYS) {
    const a = pick(all, key);
    lines.push({ key, side: 'all', label: state === 'off' ? RATING_LABEL[key] : `${pairName(key)} · 전체`, row: a,
      note: a ? null : '제공 안 됨' });
    if (state === 'off') continue;
    const m = state === 'ready' ? pick(mine, key) : null;
    lines.push({ key, side: 'mine', label: `${pairName(key)} · 내 신고`, row: m,
      note: m ? null : state === 'loading' ? '불러오는 중' : state === 'error' ? '불러오지 못함'
        : state === 'signed_out' ? '로그인하면 볼 수 있음' : '제공 안 됨' });
  }
  return lines;
}

const lineText = (l: RatingLine) => (l.row
  ? (l.row.rating_count ? `평가 ${fmtInt(l.row.rating_count)}건 · 평균 ${l.row.mean!.toFixed(1)}점` : '평가 0건 · 자료 없음')
  : l.note ?? '—');

export function RatingCard({ all, mine, mineState, theme }: { all: RatingDistribution | null; mine: RatingDistribution | null;
  mineState: MineRatingState; theme: string }) {
  const [table, setTable] = useState(false);
  const lines = all ? ratingLines(all, mine, mineState) : [];
  const allTotal = all?.rows.find((r) => r.status === 'all')?.rating_count ?? 0;
  const { hostRef, error } = useEChart((t) => {
    if (!all || allTotal === 0) return null;
    const narrow = window.matchMedia?.('(max-width: 700px)').matches === true;
    return { ...baseOption(t), grid: { left: narrow ? 118 : 196, right: 14, top: 8, bottom: 24 },
      tooltip: { ...baseOption(t).tooltip, formatter: (p: { dataIndex: number; seriesIndex: number }) => {
        const l = lines[p.dataIndex];
        if (!l.row || !l.row.rating_count) return `<b>${l.label}</b><br/>${lineText(l)}`;
        const n = l.row.counts[p.seriesIndex];
        return `<b>${l.label}</b><br/>${p.seriesIndex + 1}점 ${fmtInt(n)}건 · ${fmtPercent(pct(n, l.row.rating_count))}<br/>${lineText(l)}`;
      } },
      xAxis: { type: 'value', min: 0, max: 100, axisLabel: { color: t.muted, formatter: '{value}%' }, splitLine: { lineStyle: { color: t.grid } } },
      yAxis: { type: 'category', inverse: true, data: lines.map((l) => l.label),
        axisLabel: { fontSize: 11, color: t.text, formatter: (v: string, i: number) => `${v}\n{sub|${lineText(lines[i])}}`,
          rich: { sub: { color: t.muted, fontSize: 10 } } } },
      series: [0, 1, 2, 3, 4].map((s) => ({ name: `${s + 1}점`, type: 'bar', stack: 'r', barMaxWidth: 16,
        // rows without ratings / not loaded get no bar (never a 0점 bar)
        data: lines.map((l) => (l.row && l.row.rating_count ? (l.row.counts[s] / l.row.rating_count) * 100 : null)),
        itemStyle: { color: METRIC_RAMP[s] } })),
    };
  }, [all, mine, mineState], theme);
  return (
    <Card label="처리결과별 별점 분포" title="처리결과별 별점 분포" subtitle="행마다 그 행의 평가 건수가 100%"
      tools={<TableToggle table={table} onToggle={() => setTable((v) => !v)} />}
      caption={all && <>
        <span className="rating-legend">{[1, 2, 3, 4, 5].map((s) => <span key={s}><i className="dot" style={{ background: METRIC_RAMP[s - 1] }} />{s}점</span>)}</span>
        {mineState === 'ready' && !mine && ' 내 신고 별점 분포는 아직 제공하지 않습니다.'}</>}>
      {!all ? <Unsupported what="별점 분포" /> : allTotal === 0 ? <div className="empty-state">공개된 별점이 아직 없습니다.</div> : null}
      <div ref={hostRef} className="chart-host" style={{ height: Math.max(200, lines.length * 38 + 40) }} hidden={table || !all || allTotal === 0 || !!error} role="img"
        aria-label={lines.map((l) => `${l.label} ${lineText(l)}`).join(', ')} />
      {error && !table && <div className="empty-state" role="alert">{error}</div>}
      {table && all && (
        <div className="trend-table"><table>
          <thead><tr><th scope="col">구분</th>{[1, 2, 3, 4, 5].map((s) => <th key={s} scope="col">{s}점(건)</th>)}<th scope="col">평가(건)</th><th scope="col">평균</th></tr></thead>
          <tbody>{lines.map((l) => (
            <tr key={`${l.key}-${l.side}`} className={l.side === 'mine' ? 'mine-row' : undefined}>
              <td>{l.label}</td>
              {l.row ? l.row.counts.map((c, i) => <td key={i}>{fmtInt(c)}</td>) : <td colSpan={5}>{l.note}</td>}
              <td>{l.row ? fmtInt(l.row.rating_count) : '—'}</td>
              <td>{l.row ? (l.row.mean === null ? '자료 없음' : `${l.row.mean.toFixed(1)}점`) : '—'}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </Card>
  );
}

export function mineEntityKeys(agencies: CompareEntityRow[] | null | undefined, managers: CompareEntityRow[] | null | undefined) {
  if (!agencies || !managers) return null;
  return { agency: new Set(agencies.map((r) => r.key)), manager: new Set(managers.map((r) => r.key)) };
}
