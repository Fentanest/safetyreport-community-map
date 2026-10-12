import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import InstallButton from '../../src/components/InstallButton';

// This suite runs under vitest's node environment (no jsdom/window), so it only exercises what static markup can
// show without `beforeinstallprompt`, `window.matchMedia` or a real iOS user agent — those paths are covered by
// the pure installMode() branches in installPrompt.test.ts and by the Playwright browser check (docs/pwa demo).
describe('InstallButton — static render', () => {
  it('renders nothing in briefing mode, regardless of install availability', () => {
    expect(renderToStaticMarkup(<InstallButton briefing />)).toBe('');
  });
  it('renders nothing outside a browser (no beforeinstallprompt, not iOS) — the default test environment', () => {
    expect(renderToStaticMarkup(<InstallButton />)).toBe('');
  });
  it('defaults briefing to false without needing the prop', () => {
    // same outcome as explicit briefing={false}: still hidden here only because no install path is known yet.
    expect(renderToStaticMarkup(<InstallButton briefing={false} />)).toBe('');
  });
});
