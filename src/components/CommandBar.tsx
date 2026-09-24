import { useState } from 'react';
import type { Category } from '../domain/public';
import {
  CATEGORY_LABEL, PRESETS, REGION_OPTIONS, isValidDate, presetRange, regionLabel,
  type DraftFilters,
} from '../state/filters';
import { fmtDate } from './format';

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
}

const CATS: Category[] = ['all', 'traffic', 'parking', 'other'];

export default function CommandBar(p: Props) {
  const [open, setOpen] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <section className="cm-panel command" aria-label="분석 조건">
      <button
        className="control"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title="기간을 선택합니다. 적용을 눌러야 반영됩니다."
      >
        <span aria-hidden="true">📅</span>
        <span>{fmtDate(p.draft.start)} — {fmtDate(p.draft.end)}</span>
        <span aria-hidden="true">▾</span>
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
      <span className="cm-chip" title="현재 적용된 공간 범위">
        <span aria-hidden="true">⌖</span>
        <span>{p.appliedLabel}</span>
      </span>
      <div className="command-end">
        <button className="control control-extra" type="button" onClick={p.onOpenDrawer}>
          <span aria-hidden="true">⚙</span>
          <span>상세 필터{p.filterCount > 0 ? ` ${p.filterCount}` : ''}</span>
        </button>
        <button className="icon-btn" type="button" onClick={p.onReset} aria-label="조건 초기화" title="조건 초기화">
          <span aria-hidden="true">⟲</span>
        </button>
        <button className="icon-btn" type="button" onClick={p.onShare} aria-label="조건 공유" title="조건 공유">
          <span aria-hidden="true">⤴</span>
        </button>
      </div>
      {open && (
        <div className="date-pop" role="group" aria-label="기간 선택">
          <div className="preset-row" role="group" aria-label="기간 프리셋">
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
          <label>지역
            <select
              value={p.draft.region_code ?? ''}
              onChange={(e) => p.onDraft({ ...p.draft, region_code: e.target.value || null })}
              style={{ minHeight: 44, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', padding: '6px 10px' }}
            >
              {REGION_OPTIONS.map((r) => (
                <option key={r.label} value={r.code ?? ''}>{r.label}</option>
              ))}
            </select>
          </label>
          <button className="primary-button" type="button" style={{ width: 'auto', padding: '10px 22px' }} onClick={() => { p.onApply(); setOpen(false); }}>
            적용
          </button>
          {!isValidDate(p.draft.start) || !isValidDate(p.draft.end) ? null : null}
          {p.dateError && <span className="field-error" role="alert">{p.dateError}</span>}
          <span className="basis-note">
            신고 지표는 신고일, 처리·처분 지표는 처리완료일 기준입니다. 적용을 누르기 전에는 기존 화면이 바뀌지 않습니다.
            적용 범위: {regionLabel(p.draft.region_code)} · {CATEGORY_LABEL[p.draft.category]}
          </span>
        </div>
      )}
    </section>
  );
}
