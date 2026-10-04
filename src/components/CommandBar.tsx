import { useState, type ReactNode } from 'react';
import type { Category, DateBasis } from '../domain/public';
import {
  CATEGORY_LABEL, DATE_BASIS_LABEL, PRESETS, presetRange, todayKst,
  type DraftFilters,
} from '../state/filters';
import { fmtDate } from './format';
import Icon from './icons';
import RegionSelect from './RegionSelect';

interface Props {
  draft: DraftFilters;
  onDraft: (d: DraftFilters) => void;
  /** applied (requested) period — the date button shows it; the inputs below edit the draft */
  appliedStart: string;
  appliedEnd: string;
  /** U01: the applied date basis; changing it here applies at once with the applied dates (one request) */
  basis: DateBasis;
  onBasis: (basis: DateBasis) => void;
  /** a quick period applies at once (one request, chips/URL updated); null range = bounds still unknown */
  onPreset: (range: { start: string; end: string }) => void;
  /** applied (requested) category: applies at once (explicit selection, pushState). 위반법규 lives in the 세부 필터. */
  category: Category;
  onCategory: (c: Category) => void;
  /** S01: the applied region, chosen here at once (시도 · 시군구); same action as the region list and the map */
  region?: string | null;
  onRegion?: (code: string | null) => void;
  /** number of applied conditions besides the dates (the 필터 button is inverted when > 0) */
  filterCount: number;
  /** 전체 기간 of the applied basis (never the other date's range) */
  minDate: string | null;
  maxDate: string | null;
  /** validates and applies the draft; false keeps the popover open with the typed values */
  onApply: () => boolean;
  onReset: () => void;
  onShare: () => void;
  onOpenDrawer: () => void;
  dateError: string | null;
  regionCounts: Map<string, number>;
  /** personal comparison toggle (docs/personal-comparison.md §5.1) */
  extra?: ReactNode;
}

const CATS: Category[] = ['all', 'traffic', 'parking', 'other'];

export default function CommandBar(p: Props) {
  const [open, setOpen] = useState(false);
  const today = todayKst();
  // the period button names a quick period when the applied dates are exactly one (최근 12개월 …)
  const preset = PRESETS.find((pr) => {
    const r = presetRange(pr.days, p.minDate, p.maxDate, today);
    return !!r && r.start === p.appliedStart && r.end === p.appliedEnd;
  });
  return (
    <section className="cm-panel command" aria-label="조건" data-sticky-top="">
      <div className="command-row">
        <button
          className="control date-control"
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          title="날짜 기준과 기간을 고릅니다"
        >
          <span aria-hidden="true"><Icon name="calendar" /></span>
          <b className="date-control-label">{preset ? preset.label : `${DATE_BASIS_LABEL[p.basis]} 기준`}</b>
          <span className="date-control-range">{fmtDate(p.appliedStart)} — {fmtDate(p.appliedEnd)}</span>
          {preset && <span className="sr-only"> ({DATE_BASIS_LABEL[p.basis]} 기준)</span>}
          <span aria-hidden="true"><Icon name="chevron" /></span>
        </button>
        <div className="segments" role="group" aria-label="신고 분류">
          {CATS.map((c) => (
            <button
              key={c}
              type="button"
              className={p.category === c ? 'selected' : ''}
              aria-pressed={p.category === c}
              aria-label={c === 'all' ? '전체 분류' : undefined}
              onClick={() => p.onCategory(c)}
            >
              {CATEGORY_LABEL[c]}
            </button>
          ))}
        </div>
        {p.onRegion && (
          <span className={`top-region${p.region ? ' filter-on' : ''}`} aria-label="지역 (바로 적용)">
            <RegionSelect value={p.region ?? null} onChange={p.onRegion} counts={p.regionCounts} />
          </span>
        )}
        <button className={`control control-extra${p.filterCount > 0 ? ' filter-active' : ''}`} type="button" onClick={p.onOpenDrawer}
          aria-label={p.filterCount > 0 ? `세부 필터, 적용 중 ${p.filterCount}개` : '세부 필터'}>
          <Icon name="filter" />
          <span>필터</span>
          {p.filterCount > 0 && <span className="filter-count" aria-hidden="true">{p.filterCount}</span>}
        </button>
        {p.extra}
        <div className="command-end">
          <button className="icon-btn" type="button" onClick={p.onShare} aria-label="링크 복사" title="지금 보는 화면의 링크 복사">
            <Icon name="share" />
          </button>
          <button className="icon-btn" type="button" onClick={p.onReset} aria-label="처음 상태로" title="처음 상태로">
            <Icon name="reset" />
          </button>
        </div>
      </div>
      {open && (
        <div className="date-pop" role="group" aria-label="기간 선택">
          <div className="basis-row" role="group" aria-label="날짜 기준 (바로 적용)">
            {(['completed_date', 'report_date'] as const).map((b) => (
              <button key={b} type="button" className={p.basis === b ? 'selected' : undefined} aria-pressed={p.basis === b} onClick={() => p.onBasis(b)}>
                {DATE_BASIS_LABEL[b]} 기준
              </button>
            ))}
          </div>
          <div className="preset-row" role="group" aria-label="빠른 기간 선택">
            {PRESETS.map((pr) => {
              const r = presetRange(pr.days, p.minDate, p.maxDate, today);
              const active = !!r && r.start === p.appliedStart && r.end === p.appliedEnd;
              return (
                <button
                  key={pr.id}
                  type="button"
                  className={active ? 'selected' : undefined}
                  aria-pressed={active}
                  disabled={!r}
                  title={pr.days == null ? (r ? `${fmtDate(r.start)} — ${fmtDate(r.end)}` : '자료 범위를 불러오는 중입니다') : `오늘(${fmtDate(today)})까지`}
                  onClick={() => { if (r) { p.onPreset(r); setOpen(false); } }}
                >
                  {pr.label}
                </button>
              );
            })}
          </div>
          <label>시작일
            <input
              type="date" value={p.draft.start} max={p.draft.end || today}
              onChange={(e) => p.onDraft({ ...p.draft, start: e.target.value })}
            />
          </label>
          <label>종료일
            <input
              type="date" value={p.draft.end} min={p.draft.start || undefined} max={today}
              onChange={(e) => p.onDraft({ ...p.draft, end: e.target.value })}
            />
          </label>
          <button className="primary-button" type="button" style={{ width: 'auto', padding: '10px 22px' }} onClick={() => { if (p.onApply()) setOpen(false); }}>
            적용
          </button>
          {p.dateError && <span className="field-error" role="alert">{p.dateError}</span>}
          <span className="basis-note">
            {p.minDate && p.maxDate ? `자료 범위 ${fmtDate(p.minDate)} — ${fmtDate(p.maxDate)}` : ''}
          </span>
        </div>
      )}
    </section>
  );
}
