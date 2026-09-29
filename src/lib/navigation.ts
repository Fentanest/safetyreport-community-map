/**
 * S03 navigation: one way to move to a section below the sticky top area.
 *
 * Strategy (one, not two): the measured cover height is published as `--scroll-top-inset` on <html> and applied as
 * `scroll-padding-top` (CSS). Native #anchors, "본문 바로가기" and `scrollIntoView` therefore all stop below the
 * TopBar; `scrollToSection` only calls `scrollIntoView` — it never subtracts the inset a second time.
 */

/** elements that stay on top of the content while scrolling (marked in the markup) */
const STICKY_SELECTOR = '[data-sticky-top]';
const GAP = 12;

/** bottom of the continuous covered band at the top of the viewport (overlaps are not added twice) */
export function measureTopCover(doc: Document = document): number {
  const boxes = [...doc.querySelectorAll<HTMLElement>(STICKY_SELECTOR)]
    .map((el) => {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return null;
      if (style.position !== 'sticky' && style.position !== 'fixed') return null;
      const r = el.getBoundingClientRect();
      return r.height > 0 ? { top: r.top, bottom: r.bottom } : null;
    })
    .filter((b): b is { top: number; bottom: number } => b !== null)
    .sort((a, b) => a.top - b.top);
  let cover = 0;
  for (const b of boxes) {
    if (b.top > cover + 1) break; // not touching the band that starts at the viewport top
    cover = Math.max(cover, b.bottom);
  }
  return Math.max(0, Math.round(cover));
}

/** keep `--scroll-top-inset` current (ResizeObserver + resize); returns a cleanup. Never writes --topbar-h (no loop). */
export function watchStickyInsets(doc: Document = document): () => void {
  const root = doc.documentElement;
  let raf = 0;
  let last = -1;
  const update = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const v = measureTopCover(doc) + GAP;
      if (v !== last) { last = v; root.style.setProperty('--scroll-top-inset', `${v}px`); }
    });
  };
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
  const observe = () => doc.querySelectorAll<HTMLElement>(STICKY_SELECTOR).forEach((el) => ro?.observe(el));
  observe();
  const mo = typeof MutationObserver !== 'undefined' ? new MutationObserver(() => { observe(); update(); }) : null;
  mo?.observe(doc.body, { childList: true, subtree: false });
  window.addEventListener('resize', update);
  void doc.fonts?.ready.then(update).catch(() => undefined);
  update();
  return () => { cancelAnimationFrame(raf); ro?.disconnect(); mo?.disconnect(); window.removeEventListener('resize', update); };
}

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/** Move to a section so its heading is fully visible under the sticky band, and move focus there (no second scroll). */
export function scrollToSection(id: string, { focus = true }: { focus?: boolean } = {}): boolean {
  const el = document.getElementById(id);
  if (!el) return false;
  el.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
  if (focus) {
    const target = el.querySelector<HTMLElement>('[data-section-title]') ?? el;
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  }
  return true;
}

/** after a screen switch: wait for the section to exist and layout to settle (bounded rAF retries, no fixed sleep) */
export function scrollToSectionWhenReady(id: string, tries = 20): void {
  const attempt = (left: number) => {
    const el = document.getElementById(id);
    if (el && el.getBoundingClientRect().height > 0) {
      requestAnimationFrame(() => scrollToSection(id));
      return;
    }
    if (left > 0) requestAnimationFrame(() => attempt(left - 1));
  };
  attempt(tries);
}
