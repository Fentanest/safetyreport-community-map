import { useState, type ReactNode } from 'react';
import type { Category } from '../domain/public';
import { LAW_NONE } from '../domain/public';
import {
  CATEGORY_LABEL, LAW_UNKNOWN_LABEL, PRESETS, presetRange, regionLabel,
  type DraftFilters,
} from '../state/filters';
import { fmtDate } from './format';
import Icon from './icons';
import RegionSelect from './RegionSelect';

interface Props {
  draft: DraftFilters;
  onDraft: (d: DraftFilters) => void;
  /** applied (requested) category / law: these controls apply at once (explicit selection, pushState) */
  category: Category;
  onCategory: (c: Category) => void;
  law: string | null;
  lawOptions: Array<{ law: string; count: number | null }>;
  onLaw: (law: string | null) => void;
  /** number of applied conditions besides the dates (상세 필터 button is inverted when > 0) */
  filterCount: number;
  minDate: string | null;
  maxDate: string | null;
  onApply: () => void;
  onReset: () => void;
  onShare: () => void;
  onOpenDrawer: () => void;
  dateError: string | null;
  regionCounts: Map<string, number>;
  /** personal comparison toggle + view switch (docs/personal-comparison.md §5.1) */
  extra?: ReactNode;
}

const CATS: Category[] = ['all', 'traffic', 'parking', 'other'];

export default function CommandBar(p: Props) {
  const [open, setOpen] = useState(false);
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return (
    <section className="cm-panel command" aria-label="조건">
      <button
        className="control"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title="기간을 고른 뒤 ‘적용’을 누르세요"
      >
        <span aria-hidden="true"><Icon name="calendar" /></span>
        <span>{fmtDate(p.draft.start)} — {fmtDate(p.draft.end)}</span>
        <span aria-hidden="true"><Icon name="chevron" /></span>
      </button>
      <div className="segments" role="group" aria-label="신고 분류">
        {CATS.map((c) => (
          <button
            key={c}
            type="button"
            className={p.category === c ? 'selected' : ''}
            aria-pressed={p.category === c}
            onClick={() => p.onCategory(c)}
          >
            {CATEGORY_LABEL[c]}
          </button>
        ))}
      </div>
      <label className={`law-select${p.law ? ' filter-on' : ''}`}>
        <span className="sr-only">위반법규</span>
        <select value={p.law ?? ''} aria-label="위반법규" onChange={(e) => p.onLaw(e.target.value || null)}>
          <option value="">법규 전체</option>
          <option value={LAW_NONE}>{LAW_UNKNOWN_LABEL}</option>
          {p.lawOptions.map((o) => (
            <option key={o.law} value={o.law}>{o.count === null ? o.law : `${o.law} (${o.count.toLocaleString('ko-KR')})`}</option>
          ))}
        </select>
      </label>
      {p.extra}
      <div className="command-end">
        <button className={`control control-extra${p.filterCount > 0 ? ' filter-active' : ''}`} type="button" onClick={p.onOpenDrawer}
          aria-label={p.filterCount > 0 ? `상세 필터, 적용 중 ${p.filterCount}개` : '상세 필터'}>
          {p.filterCount > 0 ? <span className="filter-check" aria-hidden="true">✓</span> : <Icon name="filter" />}
          <span>상세 필터</span>
          {p.filterCount > 0 && <span className="filter-count" aria-hidden="true">{p.filterCount}</span>}
        </button>
        <button className="icon-btn" type="button" onClick={p.onReset} aria-label="처음 상태로" title="처음 상태로">
          <Icon name="reset" />
        </button>
        <button className="icon-btn" type="button" onClick={p.onShare} aria-label="링크 복사" title="지금 보는 화면의 링크 복사">
          <Icon name="share" />
        </button>
      </div>
      {open && (
        <div className="date-pop" role="group" aria-label="기간 선택">
          <div className="preset-row" role="group" aria-label="빠른 기간 선택">
            {PRESETS.map((pr) => (
              <button
                key={pr.id}
                type="button"
                onClick={() => {
                  const r = presetRange(pr.days, p.minDate, p.maxDate);
                  p.onDraft({ ...p.draft, start: r.start, end: r.end });
                }}
              >
                {pr.label}
              </button>
            ))}
          </div>
          <label>시작일
            <input
              type="date" value={p.draft.start} min={p.minDate ?? undefined} max={p.draft.end || today}
              onChange={(e) => p.onDraft({ ...p.draft, start: e.target.value })}
            />
          </label>
          <label>종료일
            <input
              type="date" value={p.draft.end} min={p.draft.start || undefined} max={today}
              onChange={(e) => p.onDraft({ ...p.draft, end: e.target.value })}
            />
          </label>
          <RegionSelect
            value={p.draft.region_code} counts={p.regionCounts}
            onChange={(code) => p.onDraft({ ...p.draft, region_code: code })}
            selectStyle={{ minHeight: 44, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', padding: '6px 10px' }}
          />
          <button className="primary-button" type="button" style={{ width: 'auto', padding: '10px 22px' }} onClick={() => { p.onApply(); setOpen(false); }}>
            적용
          </button>
          {p.dateError && <span className="field-error" role="alert">{p.dateError}</span>}
          <span className="basis-note">
            신고 건수는 신고한 날, 답변·과태료는 답변 받은 날을 기준으로 셉니다. ‘적용’을 눌러야 화면이 바뀝니다.
            선택: {regionLabel(p.draft.region_code)}
          </span>
        </div>
      )}
    </section>
  );
}
