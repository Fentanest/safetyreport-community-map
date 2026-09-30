import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * A menu that floats above the page (portal into <body>, position: fixed), anchored under a trigger element.
 * It never enters the table/document flow, so opening it cannot change column widths, header height or page width,
 * and a scrolling/clipping container (.table-scroll) cannot cut it off.
 *  - placed under the anchor; flipped left when it would leave the viewport on the right, above when no room below
 *  - follows the anchor on any scroll (capture) and on resize
 *  - closes on outside pointer-down and Escape (focus returns to the anchor)
 *  - ArrowUp/ArrowDown/Home/End move between [role=menuitemradio] items
 */
export default function FloatingMenu({ anchor, open, onClose, label, className, children, minWidth = 176 }: {
  anchor: HTMLElement | null;
  open: boolean;
  onClose: (reason: 'outside' | 'escape' | 'tab') => void;
  label: string;
  className?: string;
  children: ReactNode;
  minWidth?: number;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; maxHeight: number } | null>(null);

  const place = useCallback(() => {
    const menu = menuRef.current;
    if (!anchor || !menu) return;
    const r = anchor.getBoundingClientRect();
    const vw = document.documentElement.clientWidth, vh = window.innerHeight, gap = 4, edge = 8;
    const w = menu.offsetWidth, h = menu.scrollHeight;
    let left = r.left;
    if (left + w > vw - edge) left = Math.max(edge, r.right - w);
    if (left + w > vw - edge) left = Math.max(edge, vw - edge - w);
    const below = vh - r.bottom - gap - edge, above = r.top - gap - edge;
    const up = h > below && above > below;
    const maxHeight = Math.max(120, up ? above : below);
    const top = up ? Math.max(edge, r.top - gap - Math.min(h, maxHeight)) : r.bottom + gap;
    setPos((p) => (p && p.left === left && p.top === top && p.maxHeight === maxHeight ? p : { left, top, maxHeight }));
  }, [anchor]);

  useLayoutEffect(() => { if (open) place(); else setPos(null); }, [open, place, children]);

  useEffect(() => {
    if (!open) return;
    const onScroll = () => place();
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || anchor?.contains(t)) return;
      onClose('outside');
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose('escape'); anchor?.focus(); }
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, place, onClose, anchor]);

  // focus the checked (or first) item when the menu opens, like a native select
  useEffect(() => {
    if (!open || !pos) return;
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];
    (items.find((i) => i.getAttribute('aria-checked') === 'true') ?? items[0])?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pos === null]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => { e.preventDefault(); items[(n + items.length) % items.length]?.focus(); };
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(items.length - 1);
    else if (e.key === 'Tab') onClose('tab');
  };

  if (!open) return null;
  return createPortal(
    <div ref={menuRef} role="menu" aria-label={label} className={`floating-menu${className ? ` ${className}` : ''}`}
      style={{ position: 'fixed', left: pos?.left ?? -9999, top: pos?.top ?? -9999, minWidth, maxHeight: pos?.maxHeight,
        visibility: pos ? 'visible' : 'hidden' }}
      onKeyDown={onKeyDown}>
      {children}
    </div>,
    document.body,
  );
}
