import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Icon from './icons';
import { installMode, installStore, isIOS, isStandaloneDisplay, readDismissedAt, writeDismissedAt } from '../pwa/installPrompt';

interface Props {
  /** briefing mode is meant for presenting to a room; an install nudge is noise there, so it hides (same idea as
   *  AccountMenu hiding the viewer's own ID in briefing mode). */
  briefing?: boolean;
}

/** TopBar's "앱 설치" control. Chrome/Edge: shows once `beforeinstallprompt` has actually fired and triggers the
 *  native prompt. iOS Safari (no such event exists there): shows a small "공유 → 홈 화면에 추가" popover instead.
 *  Already running installed (standalone) or dismissed within the last 14 days: renders nothing. */
export default function InstallButton({ briefing = false }: Props) {
  const store = installStore();
  const snapshot = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Read the stored dismissal only after mount: tests render via renderToStaticMarkup (no DOM/localStorage), and
  // this keeps the server/first-paint snapshot deterministic (not-yet-dismissed) either way.
  useEffect(() => { setDismissedAt(readDismissedAt()); }, []);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  if (briefing || snapshot.installed) return null;

  const standalone = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? isStandaloneDisplay(window.matchMedia('(display-mode: standalone)').matches, (navigator as Navigator & { standalone?: boolean }).standalone)
    : false;
  const ios = typeof navigator !== 'undefined' ? isIOS(navigator.userAgent, navigator.maxTouchPoints ?? 0) : false;
  const mode = installMode({ standalone, hasPromptEvent: !!snapshot.deferredEvent, ios, dismissedAt, now: Date.now() });
  if (mode === 'hidden') return null;

  const dismiss = () => {
    const now = Date.now();
    writeDismissedAt(now);
    setDismissedAt(now);
    setOpen(false);
  };

  if (mode === 'prompt') {
    const onClick = async () => {
      const deferred = snapshot.deferredEvent;
      if (!deferred) return;
      try {
        await deferred.prompt();
        const choice = await deferred.userChoice;
        if (choice.outcome === 'dismissed') { writeDismissedAt(Date.now()); setDismissedAt(Date.now()); }
      } catch { /* ignore — the browser may refuse a stale/second prompt */ }
      store.consume();
    };
    return (
      <button className="icon-btn install-btn" type="button" onClick={onClick} title="앱 설치" aria-label="앱 설치">
        <Icon name="install" />
        <span className="cm-muted btn-label" style={{ fontSize: 12 }}>앱 설치</span>
      </button>
    );
  }

  return (
    <div className="install-menu" ref={ref}>
      <button
        className="icon-btn install-btn" type="button" aria-haspopup="dialog" aria-expanded={open}
        onClick={() => setOpen((v) => !v)} title="앱 설치" aria-label="앱 설치 방법 보기"
      >
        <Icon name="install" />
        <span className="cm-muted btn-label" style={{ fontSize: 12 }}>앱 설치</span>
      </button>
      {open && (
        <div className="install-pop" role="dialog" aria-label="홈 화면에 추가하는 방법">
          <p><Icon name="share" /> <span>공유 버튼을 누른 뒤 <b>홈 화면에 추가</b>를 선택하면 앱처럼 쓸 수 있습니다.</span></p>
          <button type="button" className="ghost-btn" onClick={dismiss}>닫기</button>
        </div>
      )}
    </div>
  );
}
