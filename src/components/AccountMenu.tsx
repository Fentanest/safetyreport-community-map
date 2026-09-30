import { useEffect, useRef, useState } from 'react';
import type { AuthSnapshot } from '../auth/mapAuth';

interface Props {
  auth: AuthSnapshot;
  onSignIn: () => void;
  onSignOut: () => void;
  /** briefing mode hides the account name */
  briefing: boolean;
}

/** Data wiring: Sol · visual implementation: Muse. Never shows an email, id or token. */
export default function AccountMenu({ auth, onSignIn, onSignOut, briefing }: Props) {
  const [open, setOpen] = useState(false);
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
        <span className="account-name-text">{briefing ? '내 계정' : (auth.displayName ?? '내 계정')}{auth.synthetic ? ' · 예시' : ''}</span>
      </button>
      {open && (
        <div className="account-pop" role="menu">
          <button type="button" role="menuitem" className="ghost-btn" onClick={() => { setOpen(false); onSignOut(); }}>
            로그아웃
          </button>
        </div>
      )}
    </div>
  );
}
