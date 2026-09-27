import { useState, type ReactNode } from 'react';
import type { Category } from '../domain/public';
import {
  CATEGORY_LABEL, PRESETS, isValidDate, presetRange, regionLabel,
  type DraftFilters,
} from '../state/filters';
import { fmtDate } from './format';
import Icon from './icons';
import RegionSelect from './RegionSelect';

interface Props {
  draft: DraftFilters;
  onDraft: (d: DraftFilters) => void;
  appliedLabel: string;
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
            className={p.draft.category === c ? 'selected' : ''}
            aria-pressed={p.draft.category === c}
            onClick={() => { p.onDraft({ ...p.draft, category: c }); }}
          >
            {CATEGORY_LABEL[c]}
          </button>
        ))}
      </div>
      <span className="cm-chip" title="지금 보고 있는 지역">
        <Icon name="pin" size={14} />
        <span>{p.appliedLabel}</span>
      </span>
      {p.extra}
      <div className="command-end">
        <button className="control control-extra" type="button" onClick={p.onOpenDrawer}>
          <Icon name="filter" />
          <span>상세 필터{p.filterCount > 0 ? ` ${p.filterCount}` : ''}</span>
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
          {!isValidDate(p.draft.start) || !isValidDate(p.draft.end) ? null : null}
          {p.dateError && <span className="field-error" role="alert">{p.dateError}</span>}
          <span className="basis-note">
            신고 건수는 신고한 날, 답변·과태료는 답변 받은 날을 기준으로 셉니다. ‘적용’을 눌러야 화면이 바뀝니다.
            선택: {regionLabel(p.draft.region_code)} · {CATEGORY_LABEL[p.draft.category]}
          </span>
        </div>
      )}
    </section>
  );
}
