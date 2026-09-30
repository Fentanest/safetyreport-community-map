import { useEffect, useRef, useState } from 'react';
import type { AuthSnapshot } from '../auth/mapAuth';

interface Props {
  auth: AuthSnapshot;
  onSignIn: () => void;
  onSignOut: () => void;
  /** briefing mode hides the account name */
  briefing: boolean;
}

/** The account's own ID (user decision 2026-09-30) instead of the Kakao nickname: the Supabase user id is the
 *  `contributor_id` of every shared report, so the viewer can quote it when asking about their reports. Shown only to
 *  that viewer, hidden in briefing mode. Never an email or a token. */
export const shortId = (id: string) => id.replace(/-/g, '').slice(0, 8);
export default function AccountMenu({ auth, onSignIn, onSignOut, briefing }: Props) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (!open) setCopied(false); }, [open]);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  if (auth.status === 'unconfigured') {
    return <span className="account-chip muted" title={auth.message ?? ''}>로그인 준비 중</span>;
  }
  if (auth.status === 'loading') return <span className="account-chip muted" role="status">로그인 확인 중…</span>;
  if (auth.status !== 'signed_in') {
    return (
      <button className="quiet-btn account-login" type="button" onClick={onSignIn} title="앱에서 쓰는 카카오 계정으로 로그인">
        카카오 로그인{auth.synthetic ? ' (예시)' : ''}
      </button>
    );
  }
  return (
    <div className="account-menu" ref={ref}>
      <button className="quiet-btn account-name" type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(v => !v)}>
        <span className="account-name-text">{briefing || !auth.viewerId ? '내 계정' : `ID ${shortId(auth.viewerId)}`}{auth.synthetic ? ' · 예시' : ''}</span>
      </button>
      {open && (
        <div className="account-pop" role="menu">
          {auth.viewerId && !briefing && (
            <div className="account-id">
              <span className="cm-muted">내 ID</span>
              <code>{auth.viewerId}</code>
              <button type="button" role="menuitem" className="mini-btn" onClick={() => {
                navigator.clipboard?.writeText(auth.viewerId!).then(() => setCopied(true), () => setCopied(false));
              }}>{copied ? '복사됨' : '복사'}</button>
            </div>
          )}
          <button type="button" role="menuitem" className="ghost-btn" onClick={() => { setOpen(false); onSignOut(); }}>
            로그아웃
          </button>
        </div>
      )}
    </div>
  );
}
