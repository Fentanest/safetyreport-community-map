import { useContext, useEffect, useState } from 'react';
import { ActivityContext, primaryActivity, useActivities } from '../data/queryActivity';

/**
 * S10 top status (reserved slot inside the sticky TopBar: switching it on/off never changes the header height).
 * Reads the page's activity reports only. The 429 countdown ticks locally once a second (no request, not announced
 * every second: the live text says "잠시 후 다시 시도"; the seconds are aria-hidden).
 * A 150 ms display delay hides flashes of fast answers; the requests themselves are never delayed.
 */
export default function GlobalQueryStatus() {
  const registry = useContext(ActivityContext);
  const list = useActivities(registry);
  const top = primaryActivity(list);
  const [visible, setVisible] = useState(false);
  const busyKey = top ? `${top.main.resource}:${top.main.phase}` : '';
  useEffect(() => {
    if (!top) { setVisible(false); return; }
    if (top.main.phase === 'error' || top.main.phase === 'retry_wait') { setVisible(true); return; }
    const t = window.setTimeout(() => setVisible(true), 150);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busyKey]);
  const [now, setNow] = useState(() => Date.now());
  const retryAt = top?.main.phase === 'retry_wait' ? top.main.retryAt ?? null : null;
  useEffect(() => {
    if (!retryAt) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [retryAt]);

  const show = !!top && visible;
  const a = top?.main;
  const seconds = retryAt ? Math.max(0, Math.ceil((retryAt - now) / 1000)) : null;
  const working = show && a && (a.phase === 'fetching' || a.phase === 'processing' || a.phase === 'scheduled');
  return (
    <div className={`query-status${show ? ' on' : ''}${a ? ` phase-${a.phase}` : ''}`} data-resource={a?.resource ?? ''}>
      <span className="query-status-text" role="status" aria-live="polite" aria-atomic="true">
        {show && a ? (
          <>
            {working && <i className="spin" aria-hidden="true" />}
            <b>{a.label}</b>
            {a.phase === 'retry_wait' && <>{' · '}<span aria-hidden="true">{seconds}초 후 다시 시도</span><span className="sr-only">잠시 후 다시 시도</span></>}
            {top.others > 0 && <small> 외 {top.others}건</small>}
            {a.displayedLabel && a.phase !== 'error' && <small className="query-status-prov"> · 화면은 이전 조건({a.displayedLabel})</small>}
          </>
        ) : null}
      </span>
      {/* indeterminate line: no percentage, no ETA (the browser cannot know the server's progress) */}
      <span className={`query-line${working ? ' on' : ''}`} aria-hidden="true" />
    </div>
  );
}
