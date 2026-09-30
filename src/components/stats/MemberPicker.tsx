import { useEffect, useRef, useState } from 'react';
import type { Scope } from '../../domain/public';
import type { MemberStatus, StatCandidate, StatisticsSpec, StatsFilter } from '../../domain/statistics';
import { loadCandidates } from '../../data/statistics';
import { useReportActivity } from '../../data/queryActivity';
import PanelStatus from '../PanelStatus';

export const PICK_KINDS: Array<{ id: string; label: string }> = [
  { id: 'agency', label: '기관' }, { id: 'manager', label: '담당자' }, { id: 'sido', label: '시도' },
  { id: 'sgg', label: '시군구' }, { id: 'law', label: '위반법규' }, { id: 'place', label: '주소' },
];
const LIMIT = 30;

export interface PickedMember { key: string; label: string }

/**
 * S06 비교 대상 선택: server search over the full member set (debounced 300 ms, never during IME composition,
 * older answers ignored), paging by cursor, a separate "선택한 항목" list that survives paging/search, and a draft
 * that only becomes the query on 적용 (닫기/취소 discards it). The dimension's own selection never narrows its list.
 */
export default function MemberPicker({ open, initialKind, scope, basis, placeKey, filters, selected, labels, version, onApply, onClose }: {
  open: boolean;
  initialKind: string;
  scope: Scope;
  basis: StatisticsSpec['date_basis'];
  placeKey: string | null;
  /** every applied filter (the kind's own is ignored by the server's facet rule) */
  filters: StatsFilter[];
  /** applied selection per dimension */
  selected: Record<string, string[]>;
  labels: Record<string, string>;
  version: string | null;
  /** every kind's draft at once (a kind left untouched keeps its applied selection) */
  onApply: (byKind: Record<string, PickedMember[]>) => void;
  onClose: () => void;
}) {
  const [kind, setKind] = useState(initialKind);
  const [drafts, setDrafts] = useState<Record<string, PickedMember[]>>({});
  const draft = drafts[kind] ?? [];
  const setDraft = (fn: (list: PickedMember[]) => PickedMember[]) => setDrafts((d) => ({ ...d, [kind]: fn(d[kind] ?? []) }));
  const [input, setInput] = useState('');
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);
  const [items, setItems] = useState<StatCandidate[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const [statuses, setStatuses] = useState<Map<string, MemberStatus>>(new Map());
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [onlySelected, setOnlySelected] = useState(false);
  const composing = useRef(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const gen = useRef(0);

  // (re)open: the draft starts from the applied selection of this kind
  useEffect(() => {
    if (!open) return;
    setKind(initialKind);
    setDrafts(Object.fromEntries(PICK_KINDS.map((k) => [k.id, (selected[k.id] ?? []).map((key) => ({ key, label: labels[key] ?? key }))])));
  }, [open, initialKind]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    setInput(''); setQ(''); setCursor(0); setItems([]); setOnlySelected(false);
    requestAnimationFrame(() => searchRef.current?.focus());
  }, [open, kind]);

  useEffect(() => {
    if (!open || composing.current) return;
    const t = window.setTimeout(() => { if (input.trim() !== q) { setQ(input.trim()); setCursor(0); } }, 300);
    return () => window.clearTimeout(t);
  }, [input, q, open]);

  const reqKey = `${kind}|${q}|${cursor}|${JSON.stringify(scope)}|${JSON.stringify(filters)}|${basis}|${placeKey}|${version}`;
  useEffect(() => {
    if (!open) return;
    const ac = new AbortController();
    const my = ++gen.current;
    setState('loading');
    loadCandidates(scope, { kind, q, cursor, limit: LIMIT, filters, basis, placeKey, keys: draft.map((d) => d.key).slice(0, 50) }, version, ac.signal)
      .then((page) => {
        if (ac.signal.aborted || my !== gen.current) return; // an older answer never replaces a newer list
        setItems(page.items);
        setTotal(page.total);
        setNext(page.next_cursor);
        setCounts(new Map(page.selected.map((s) => [s.key, s.count])));
        setStatuses(new Map(page.selected.map((s) => [s.key, s.status ?? (s.count > 0 ? 'ok' : 'zero')] as [string, MemberStatus])));
        setState('idle');
      })
      .catch(() => { if (!ac.signal.aborted && my === gen.current) setState('error'); });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reqKey, open]);
  useReportActivity('stats-candidates', open && state === 'loading'
    ? { resource: 'candidates', phase: 'fetching', label: '비교 대상을 검색하는 중', scope: 'local' } : null);

  // Esc closes only this dialog (the page, the drawer and the address selection stay as they are)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing) return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (!open) return null;
  const has = (key: string) => draft.some((d) => d.key === key);
  const toggle = (c: StatCandidate) => setDraft((list) => (list.some((d) => d.key === c.key) ? list.filter((d) => d.key !== c.key)
    : list.length >= 50 ? list : [...list, { key: c.key, label: c.sub && kind === 'manager' ? c.label : c.label }]));
  const move = (i: number, d: -1 | 1) => setDraft((list) => {
    const j = i + d;
    if (j < 0 || j >= list.length) return list;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
  const kindLabel = PICK_KINDS.find((k) => k.id === kind)?.label ?? kind;
  const shown = onlySelected ? draft.map((d) => ({ key: d.key, label: d.label, sub: null, count: counts.get(d.key) ?? 0, status: statuses.get(d.key) })) : items;
  return (
    <div className="picker-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="picker" role="dialog" aria-modal="true" aria-labelledby="picker-title" ref={dialogRef}>
        <header className="picker-head">
          <h2 id="picker-title">비교 대상 선택</h2>
          <button type="button" className="icon-btn" aria-label="닫기(선택 취소)" onClick={onClose}>✕</button>
        </header>
        <div className="mini-segments picker-kinds" role="group" aria-label="대상 종류">
          {PICK_KINDS.map((k) => (
            <button key={k.id} type="button" className={kind === k.id ? 'selected' : ''} aria-pressed={kind === k.id} onClick={() => setKind(k.id)}>
              {k.label}{(drafts[k.id]?.length ?? 0) > 0 ? ` (${drafts[k.id].length})` : ''}
            </button>
          ))}
        </div>
        <div className="picker-body">
          <section className="picker-candidates" aria-label={`${kindLabel} 후보`} aria-busy={state === 'loading'}>
            <div className="picker-search">
              <input ref={searchRef} type="search" value={input} placeholder={`${kindLabel} 이름으로 전체에서 검색`} aria-label={`${kindLabel} 검색`}
                onChange={(e) => setInput(e.target.value)}
                onCompositionStart={() => { composing.current = true; }}
                onCompositionEnd={(e) => { composing.current = false; setInput((e.target as HTMLInputElement).value); }} />
              <PanelStatus busy={state === 'loading'} label="검색 중" />
            </div>
            <label className="picker-only"><input type="checkbox" checked={onlySelected} onChange={(e) => setOnlySelected(e.target.checked)} />선택한 항목만 보기</label>
            {state === 'error' && <p role="alert" className="place-empty">목록을 불러오지 못했습니다.</p>}
            <ul className="picker-list">
              {shown.map((c) => (
                <li key={c.key}>
                  <label>
                    <input type="checkbox" checked={has(c.key)} onChange={() => toggle(c)} />
                    <span className="picker-name">{c.label}</span>
                    <small className="cm-muted">{'status' in c && c.status === 'unconfirmed' ? '확인할 수 없음' : c.count === 0 ? '현재 조건 0건' : `${c.count.toLocaleString('ko-KR')}건`}</small>
                  </label>
                </li>
              ))}
            </ul>
            {!onlySelected && state !== 'loading' && items.length === 0 && state !== 'error' && <p className="cm-muted place-empty">{q ? `‘${q}’에 맞는 ${kindLabel}이(가) 없습니다.` : `이 조건에는 ${kindLabel}이(가) 없습니다.`}</p>}
            {!onlySelected && (
              <div className="place-more">
                <span className="cm-muted">{total === null ? '' : `검색 결과 ${total.toLocaleString('ko-KR')}개 중 ${Math.min(total, cursor + 1)}–${Math.min(total, cursor + items.length)}`}</span>
                <button type="button" className="ghost-btn" disabled={cursor === 0 || state === 'loading'} onClick={() => setCursor((c) => Math.max(0, c - LIMIT))}>이전</button>
                <button type="button" className="ghost-btn" disabled={next === null || state === 'loading'} onClick={() => next !== null && setCursor(next)}>다음</button>
              </div>
            )}
          </section>
          <section className="picker-selected" aria-label="선택한 항목">
            <h3>선택한 {kindLabel} {draft.length}개 <small className="cm-muted">(같은 종류끼리는 하나라도 해당하면, 다른 종류끼리는 모두 해당해야 포함됩니다)</small></h3>
            {draft.length === 0 && <p className="cm-muted">고르지 않으면 전체가 대상입니다.</p>}
            <ol className="picker-chosen">
              {draft.map((d, i) => (
                <li key={d.key}>
                  <span className="picker-name">{d.label}</span>
                  {state === 'error' ? <small className="picker-zero">확인하지 못함</small>
                    : state === 'loading' && !statuses.has(d.key) ? <small className="cm-muted">확인 중</small>
                      : statuses.get(d.key) === 'unconfirmed' ? <small className="picker-unavailable" title="이 기간에는 확인할 수 없는 대상입니다">확인할 수 없음</small>
                        : statuses.get(d.key) === 'zero' ? <small className="picker-zero">현재 조건 0건</small> : null}
                  <span className="picker-order">
                    <button type="button" className="mini-btn" aria-label={`${d.label} 위로`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                    <button type="button" className="mini-btn" aria-label={`${d.label} 아래로`} disabled={i === draft.length - 1} onClick={() => move(i, 1)}>↓</button>
                    <button type="button" className="mini-btn" aria-label={`${d.label} 빼기`} onClick={() => setDraft((l) => l.filter((x) => x.key !== d.key))}>✕</button>
                  </span>
                </li>
              ))}
            </ol>
            {draft.length > 0 && <button type="button" className="link-btn" onClick={() => setDraft(() => [])}>모두 해제</button>}
          </section>
        </div>
        <footer className="picker-foot">
          <button type="button" className="ghost-btn" onClick={onClose}>취소</button>
          <button type="button" className="primary-button" style={{ width: 'auto', padding: '8px 20px' }} onClick={() => onApply(drafts)}>
            적용
          </button>
        </footer>
      </div>
    </div>
  );
}
