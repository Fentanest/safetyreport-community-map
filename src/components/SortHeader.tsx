import { useCallback, useRef, useState, type ReactNode } from 'react';
import { SORT_COLUMNS, sortWords, type SortSpec, type SortValue } from '../domain/tableSort';
import FloatingMenu from './FloatingMenu';

/**
 * Column header with a sort menu (U03, UI revised 2026-09-30). Clicking a sortable header opens a vertical menu that
 * floats above the page (FloatingMenu: portal, never in the table flow — widths/heights do not move). One item per
 * line, words only: 건수 많은 순 / 건수 적은 순 / 비율 높은 순 / 비율 낮은 순 (no arrows; the words carry the direction).
 * The menu offers only the values the cell shows (SORT_COLUMNS.shown or the column's own `values`). Opening the menu
 * sends nothing; choosing an item calls onSort once and the table resets to page 1 in the same update.
 * The active column states its order in text under the label ("건수 많은 순"); aria-sort keeps the direction for AT.
 */
export default function SortHeader({ column, values, current, onSort, label, title, className, enabled }: {
  column: string;
  /** the values this column offers (default: the registry's `shown`) */
  values?: SortValue[];
  current: SortSpec;
  onSort: (spec: SortSpec) => void;
  label: ReactNode;
  title?: string;
  className?: string;
  enabled: boolean;
}) {
  const def = SORT_COLUMNS[column];
  const offered = values ?? def?.shown ?? [];
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const active = current.column === column && offered.includes(current.value);
  const ariaSort = !enabled || !def ? undefined : !active ? 'none' as const : current.dir === 'asc' ? 'ascending' as const : 'descending' as const;
  if (!enabled || !def) return <th scope="col" className={className} title={title}>{label}</th>;
  const words = (v: SortValue, dir: 'asc' | 'desc') => sortWords({ column, value: v, dir });
  const now = active ? words(current.value, current.dir) : '';
  const choose = (value: SortValue, dir: 'asc' | 'desc') => { setOpen(false); onSort({ column, value, dir }); buttonRef.current?.focus(); };
  return (
    <th scope="col" className={`${className ?? ''} sortable${active ? ' sort-active' : ''}`} aria-sort={ariaSort} title={title}>
      <button type="button" ref={buttonRef} className="sort-head" aria-haspopup="menu" aria-expanded={open}
        aria-label={`${def.label} 정렬${active ? `, 지금 ${now}` : ''}`}
        onClick={() => setOpen((v) => !v)}>
        <span className="sort-label">{label}</span>
        {active && <small className="sort-now-label" aria-hidden="true">{now}</small>}
      </button>
      <FloatingMenu anchor={buttonRef.current} open={open} onClose={close} label={`${def.label} 정렬`} className="sort-menu">
        <b className="floating-menu-title" aria-hidden="true">{def.label} 정렬</b>
        {offered.flatMap((v) => (['desc', 'asc'] as const).map((dir) => {
          const on = active && current.value === v && current.dir === dir;
          return (
            <button key={`${v}-${dir}`} type="button" role="menuitemradio" aria-checked={on} tabIndex={-1}
              className={`floating-menu-item${on ? ' selected' : ''}`} onClick={() => choose(v, dir)}>
              {words(v, dir)}
            </button>
          );
        }))}
      </FloatingMenu>
    </th>
  );
}
