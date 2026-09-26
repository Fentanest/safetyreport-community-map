import { useEffect, useRef, useState } from 'react';
import type { AuthSnapshot } from '../auth/mapAuth';

interface Props {
  auth: AuthSnapshot;
  onSignIn: () => void;
  onSignOut: () => void;
  /** briefing mode hides the account name */
  briefing: boolean;
}

/** Baseline (Sol). Visual implementation: Muse. Never shows an email, id or token. */
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
    return <span className="account-chip muted" title={auth.message ?? ''}>로그인 미설정</span>;
  }
  if (auth.status === 'loading') return <span className="account-chip muted" role="status">로그인 확인 중…</span>;
  if (auth.status !== 'signed_in') {
    return (
      <button className="quiet-btn account-login" type="button" onClick={onSignIn} title="공개 지도는 로그인 없이 볼 수 있습니다. 로그인하면 내 신고와 비교합니다.">
        카카오 로그인{auth.synthetic ? ' (합성)' : ''}
      </button>
    );
  }
  return (
    <div className="account-menu" ref={ref}>
      <button className="quiet-btn" type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(v => !v)}>
        {briefing ? '내 계정' : (auth.displayName ?? '내 계정')}{auth.synthetic ? ' · 합성' : ''}
      </button>
      {open && (
        <div className="account-pop" role="menu">
          <p className="cm-muted">이 브라우저의 지도 로그인입니다. 앱·서버의 자동 업로드 연결과는 별개입니다.</p>
          <button type="button" role="menuitem" className="ghost-btn" onClick={() => { setOpen(false); onSignOut(); }}>
            이 브라우저에서 로그아웃
          </button>
          <small className="cm-muted">로그아웃해도 앱·서버의 자동 업로드는 계속됩니다.</small>
        </div>
      )}
    </div>
  );
}
