/**
 * Registers public/sw.js (install-only; see that file's header for exactly what it is and is not allowed to
 * cache). Production builds only — a dev server reload churns through dozens of module graphs a minute and a
 * stale worker controlling that is nothing but confusion, never load-bearing for `npm run dev`.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* install just stays unavailable; nothing else depends on it */ });
  });
}
