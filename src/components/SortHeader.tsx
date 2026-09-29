import { useEffect, useRef, useState, type ReactNode } from 'react';
import { SORT_COLUMNS, type SortSpec, type SortValue } from '../domain/tableSort';

/**
 * U03 column header: a column with one value toggles ▼/▲ on click; a column that shows count AND rate (or mean and
 * count, …) opens a menu — 건수 많은 순 / 건수 적은 순 / 비율 높은 순 / 비율 낮은 순. Opening the menu sends nothing;
 * choosing an item calls onSort once (the table resets to page 1 in the same update).
 */
export default function SortHeader({ column, values, current, onSort, label, title, className, enabled }: {
  column: string;
  /** the values this column offers (default: the registry's) */
  values?: SortValue[];
  current: SortSpec;
  onSort: (spec: SortSpec) => void;
  label: ReactNode;
  title?: string;
  className?: string;
  enabled: boolean;
}) {
  const def = SORT_COLUMNS[column];
  const offered = values ?? def?.values ?? [];
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLTableCellElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey, true); };
  }, [open]);
  const active = current.column === column && offered.includes(current.value);
  const ariaSort = !enabled || !def ? undefined : !active ? 'none' as const : current.dir === 'asc' ? 'ascending' as const : 'descending' as const;
  if (!enabled || !def) return <th scope="col" className={className} title={title}>{label}</th>;
  const word = (v: SortValue) => def.words[v];
  const mark = active ? `${offered.length > 1 ? ` · ${word(current.value)?.name ?? ''}` : ''} ${current.dir === 'desc' ? '▼' : '▲'}` : '';
  const choose = (value: SortValue, dir: 'asc' | 'desc') => { setOpen(false); onSort({ column, value, dir }); };
  const single = offered.length === 1;
  return (
    <th scope="col" ref={ref} className={`${className ?? ''} sortable${active ? ' sort-active' : ''}`} aria-sort={ariaSort} title={title}>
      <button type="button" className="sort-head" aria-haspopup={single ? undefined : 'menu'} aria-expanded={single ? undefined : open}
        aria-label={`${def.label} 정렬${active ? ` (지금: ${word(current.value)?.name ?? ''} ${current.dir === 'desc' ? '내림차순' : '오름차순'})` : ''}`}
        onClick={() => (single ? choose(offered[0], active && current.dir === 'desc' ? 'asc' : 'desc') : setOpen((v) => !v))}>
        {label}<span className="sort-mark" aria-hidden="true">{mark}</span>
      </button>
      {open && (
        <div className="sort-menu" role="menu" aria-label={`${def.label} 정렬`}>
          <b className="sort-menu-title">{def.label} 정렬</b>
          {offered.flatMap((v) => (['desc', 'asc'] as const).map((dir) => {
            const on = active && current.value === v && current.dir === dir;
            return (
              <button key={`${v}-${dir}`} type="button" role="menuitemradio" aria-checked={on} className={on ? 'selected' : undefined}
                onClick={() => choose(v, dir)}>
                {dir === 'desc' ? word(v)?.desc : word(v)?.asc} <span aria-hidden="true">{dir === 'desc' ? '↓' : '↑'}</span>
              </button>
            );
          }))}
        </div>
      )}
    </th>
  );
}
