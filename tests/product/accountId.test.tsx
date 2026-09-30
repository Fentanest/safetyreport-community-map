import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import AccountMenu, { shortId } from '../../src/components/AccountMenu';
import type { AuthSnapshot } from '../../src/auth/mapAuth';

/** 2026-09-30 user decision: the account chip shows the account's own ID (= contributor_id of its shared reports). */
const signed = { status: 'signed_in', displayName: '홍길동', viewerId: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d', message: null, synthetic: false } as AuthSnapshot;

describe('account chip', () => {
  it('shows the short ID instead of the Kakao nickname', () => {
    const html = renderToStaticMarkup(<AccountMenu auth={signed} onSignIn={() => {}} onSignOut={() => {}} briefing={false} />);
    expect(html).toContain('ID 1a2b3c4d');
    expect(html).not.toContain('홍길동');
  });
  it('briefing mode hides it', () => {
    const html = renderToStaticMarkup(<AccountMenu auth={signed} onSignIn={() => {}} onSignOut={() => {}} briefing />);
    expect(html).toContain('내 계정');
    expect(html).not.toContain('1a2b3c4d');
  });
  it('the short ID is the start of the UUID (a DB prefix search finds it)', () => {
    expect(shortId(signed.viewerId!)).toBe('1a2b3c4d');
    expect(signed.viewerId!.startsWith(shortId(signed.viewerId!))).toBe(true);
  });
});
