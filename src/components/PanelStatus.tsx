import { useEffect, useState } from 'react';

/** S10 panel-level "갱신 중" badge. Display only: it never starts, retries or delays a request.
 *  `delayMs` hides sub-150 ms flashes (the request itself is not delayed); slow requests are visible within 200 ms. */
export default function PanelStatus({ busy, label, tone = 'busy', delayMs = 150 }: {
  busy: boolean;
  label: string;
  tone?: 'busy' | 'wait';
  delayMs?: number;
}) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!busy) { setShown(false); return; }
    const t = window.setTimeout(() => setShown(true), delayMs);
    return () => window.clearTimeout(t);
  }, [busy, delayMs]);
  if (!busy || !shown) return null;
  return (
    <span className={`panel-status ${tone}`} role="status" aria-live="polite">
      <i className="spin" aria-hidden="true" />{label}
    </span>
  );
}
