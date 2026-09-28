import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import AccessGate from '../../src/components/AccessGate';
import type { AuthSnapshot } from '../../src/auth/mapAuth';

const signedIn: AuthSnapshot = { status: 'signed_in', displayName: '예시 사용자', synthetic: false, message: null };
const noop = () => {};

describe('AccessGate viewer threshold (user decision 2026-09-28)', () => {
  it('explains the 10-report requirement instead of the old one-report copy', () => {
    const html = renderToStaticMarkup(
      <AccessGate code="upload_required" auth={signedIn} onSignIn={noop} onSignOut={noop} onRetry={noop}
        progress={{ required: 10, current: 3 }} />,
    );
    expect(html).toContain('10건 이상');
    expect(html).toContain('열 건 이상');
    expect(html).not.toContain('한 건 이상');
  });
  it('shows current progress when the refusal carries it', () => {
    const html = renderToStaticMarkup(
      <AccessGate code="upload_required" auth={signedIn} onSignIn={noop} onSignOut={noop} onRetry={noop}
        progress={{ required: 10, current: 3 }} />,
    );
    expect(html).toContain('지금 3건 / 10건');
  });
  it('shows the requirement without a number when the count is unknown', () => {
    const html = renderToStaticMarkup(
      <AccessGate code="upload_required" auth={signedIn} onSignIn={noop} onSignOut={noop} onRetry={noop}
        progress={{ required: 10, current: null }} />,
    );
    expect(html).toContain('10건 이상');
    expect(html).not.toContain('지금 null건');
  });
});
