/**
 * Install-to-home-screen support for the map (public/manifest.webmanifest, public/sw.js, src/components/InstallButton.tsx).
 *
 * This module is split in two halves on purpose:
 *  - a module-level store (below) that listens for `beforeinstallprompt`/`appinstalled` as early as possible
 *    (imported once from src/main.tsx) so a prompt fired before InstallButton ever mounts is not missed — same
 *    "module singleton, not React state" shape as src/data/retryCooldown.ts.
 *  - pure, DOM-free decision/persistence functions that a unit test can call directly without a browser.
 */

declare global {
  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent;
  }
}

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt(): Promise<void>;
}

export interface InstallSnapshot {
  deferredEvent: BeforeInstallPromptEvent | null;
  installed: boolean;
}

type Listener = () => void;

/** A browser-close/"not now" dismissal hides the button for this long before it is offered again. */
export const SNOOZE_DAYS = 14;
export const DISMISS_KEY = 'cm-install-dismissed-at';

function createEmitter() {
  const listeners = new Set<Listener>();
  // `state` is always REPLACED, never mutated in place: useSyncExternalStore decides whether to re-render by
  // `Object.is`-comparing the previous and next `snapshot()` return value, so returning the same mutated object
  // reference on every call would make it believe nothing ever changed (mapAuth.ts's Emitter has the same shape).
  let state: InstallSnapshot = { deferredEvent: null, installed: false };
  const emit = () => { for (const l of listeners) l(); };
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault(); // we show our own button instead of the browser's mini-infobar
      state = { ...state, deferredEvent: e };
      emit();
    });
    window.addEventListener('appinstalled', () => {
      state = { ...state, installed: true, deferredEvent: null };
      emit();
    });
  }
  return {
    snapshot: (): InstallSnapshot => state,
    subscribe: (listener: Listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    /** A deferred prompt can only be shown once; after prompting (whatever the outcome) it must be dropped until
     *  a new `beforeinstallprompt` fires (typically the next page load). */
    consume: () => { state = { ...state, deferredEvent: null }; emit(); },
  };
}

/** One instance per page load, like `mapAuth`'s client. Importing this module alone never touches `window` —
 *  src/main.tsx calls `installStore()` once, eagerly, right at startup (before the first paint) so the listeners
 *  are attached before InstallButton has a chance to mount; every later call just returns that same instance. */
let singleton: ReturnType<typeof createEmitter> | null = null;
export function installStore() {
  singleton ??= createEmitter();
  return singleton;
}

// ── Pure decision logic (no `window`/`document` reads) — covered directly by tests/product/installPrompt.test.ts ──

export function isStandaloneDisplay(matchesStandaloneMedia: boolean, navigatorStandalone: boolean | undefined): boolean {
  return matchesStandaloneMedia || navigatorStandalone === true;
}

/** iOS has no `beforeinstallprompt`; Safari's share-sheet "홈 화면에 추가" is the only install path there. iPadOS
 *  13+ reports as "Macintosh" with touch support, so that combination counts too. */
export function isIOS(userAgent: string, maxTouchPoints: number): boolean {
  return /iphone|ipad|ipod/i.test(userAgent) || (/Macintosh/i.test(userAgent) && maxTouchPoints > 1);
}

export function isSnoozed(dismissedAt: number | null, now: number): boolean {
  return dismissedAt !== null && now - dismissedAt < SNOOZE_DAYS * 24 * 60 * 60 * 1000;
}

export type InstallMode = 'prompt' | 'ios-guide' | 'hidden';

/** The one place that decides what the button renders. Kept free of environment lookups so every combination is
 *  covered by a plain unit test instead of a real `beforeinstallprompt`/UA sniff in a browser. */
export function installMode(opts: {
  standalone: boolean;
  hasPromptEvent: boolean;
  ios: boolean;
  dismissedAt: number | null;
  now: number;
}): InstallMode {
  if (opts.standalone) return 'hidden'; // already running as the installed app
  if (isSnoozed(opts.dismissedAt, opts.now)) return 'hidden';
  if (opts.hasPromptEvent) return 'prompt';
  if (opts.ios) return 'ios-guide';
  return 'hidden'; // no known install path yet (e.g. desktop Firefox, or Chrome hasn't offered a prompt yet)
}

export function readDismissedAt(): number | null {
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function writeDismissedAt(at: number): void {
  try { window.localStorage.setItem(DISMISS_KEY, String(at)); } catch { /* ignore */ }
}
