import { describe, expect, it } from 'vitest';
import { installMode, installStore, isIOS, isSnoozed, isStandaloneDisplay, SNOOZE_DAYS } from '../../src/pwa/installPrompt';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 12);

describe('installMode — every branch the InstallButton display condition can take', () => {
  it('hides once the app is already running standalone, even with a live prompt event', () => {
    expect(installMode({ standalone: true, hasPromptEvent: true, ios: false, dismissedAt: null, now: NOW })).toBe('hidden');
  });
  it('shows the native prompt button once beforeinstallprompt has fired', () => {
    expect(installMode({ standalone: false, hasPromptEvent: true, ios: false, dismissedAt: null, now: NOW })).toBe('prompt');
  });
  it('shows the iOS share-sheet guide when there is no prompt event but the platform is iOS', () => {
    expect(installMode({ standalone: false, hasPromptEvent: false, ios: true, dismissedAt: null, now: NOW })).toBe('ios-guide');
  });
  it('prefers the native prompt over the iOS guide when (hypothetically) both are available', () => {
    expect(installMode({ standalone: false, hasPromptEvent: true, ios: true, dismissedAt: null, now: NOW })).toBe('prompt');
  });
  it('hides with no known install path (desktop Firefox, or Chrome has not offered a prompt yet)', () => {
    expect(installMode({ standalone: false, hasPromptEvent: false, ios: false, dismissedAt: null, now: NOW })).toBe('hidden');
  });
  it('hides right after a dismissal', () => {
    expect(installMode({ standalone: false, hasPromptEvent: true, ios: false, dismissedAt: NOW - 1000, now: NOW })).toBe('hidden');
  });
  it('hides through the whole snooze window', () => {
    const dismissedAt = NOW - (SNOOZE_DAYS * DAY - DAY); // one day short of the window
    expect(installMode({ standalone: false, hasPromptEvent: true, ios: false, dismissedAt, now: NOW })).toBe('hidden');
  });
  it('offers the button again once the snooze window has fully elapsed', () => {
    const dismissedAt = NOW - (SNOOZE_DAYS * DAY + DAY);
    expect(installMode({ standalone: false, hasPromptEvent: true, ios: false, dismissedAt, now: NOW })).toBe('prompt');
  });
});

describe('isSnoozed', () => {
  it('is false when never dismissed', () => { expect(isSnoozed(null, NOW)).toBe(false); });
  it('is true just inside the window', () => { expect(isSnoozed(NOW - 1, NOW)).toBe(true); });
  it('is false exactly at the window boundary', () => { expect(isSnoozed(NOW - SNOOZE_DAYS * DAY, NOW)).toBe(false); });
});

describe('isStandaloneDisplay', () => {
  it('true when the display-mode:standalone media query matches (Chrome/Edge/Android)', () => {
    expect(isStandaloneDisplay(true, undefined)).toBe(true);
  });
  it('true when navigator.standalone is set (iOS Safari home-screen launch)', () => {
    expect(isStandaloneDisplay(false, true)).toBe(true);
  });
  it('false in an ordinary browser tab', () => {
    expect(isStandaloneDisplay(false, undefined)).toBe(false);
    expect(isStandaloneDisplay(false, false)).toBe(false);
  });
});

describe('isIOS', () => {
  it('iPhone/iPad/iPod user agents', () => {
    expect(isIOS('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 5)).toBe(true);
    expect(isIOS('Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)', 5)).toBe(true);
  });
  it('iPadOS 13+ reporting as Macintosh with touch support', () => {
    expect(isIOS('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/605.1.15', 5)).toBe(true);
  });
  it('a real Mac (no touch points) is not treated as iOS', () => {
    expect(isIOS('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/605.1.15', 0)).toBe(false);
  });
  it('desktop Chrome/Android are not iOS', () => {
    expect(isIOS('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130', 0)).toBe(false);
    expect(isIOS('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130 Mobile', 5)).toBe(false);
  });
});

describe('installStore', () => {
  it('is a singleton (stable subscribe/snapshot references for useSyncExternalStore)', () => {
    const a = installStore();
    const b = installStore();
    expect(a).toBe(b);
    expect(a.subscribe).toBe(b.subscribe);
    expect(a.snapshot).toBe(b.snapshot);
  });
  it('starts with no deferred prompt and not installed (no beforeinstallprompt fired in this test run)', () => {
    expect(installStore().snapshot()).toEqual({ deferredEvent: null, installed: false });
  });
});
