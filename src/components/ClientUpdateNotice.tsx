import { createContext, useContext } from 'react';
import { safeHttpsUrl, type ClientStatus } from '../data/personal';

/**
 * Server-driven app-update guidance (2026-10-21). Everything shown here comes from GET /my-analytics/client-status:
 * no built-in version numbers, message or download links. Nothing renders unless the server sends a notice.
 */
export interface ClientUpdateValue {
  status: ClientStatus | null;
  /** re-read client-status now (throttled); the gate's "다시 확인" calls it */
  refresh: () => void;
}
export const ClientUpdateContext = createContext<ClientUpdateValue>({ status: null, refresh: () => {} });

/** Dashboard banner: a notice, the new contract enabled, and this account still on the old consent or an old (v1) app. */
export function dashboardNoticeVisible(s: ClientStatus | null): boolean {
  return !!s?.notice && s.v2_enabled && (s.consent === 'outdated' || s.v1_connections > 0);
}

/**
 * Consent gate (no / revoked / outdated consent): only the server's generic notice, only when it sends one.
 * An account with an active consent that still lands on this gate is suspended or ineligible — no update text
 * (the server also drops the notice for suspended / non-Kakao accounts).
 */
export function gateNoticeVisible(s: ClientStatus | null): boolean {
  return !!s?.notice && s.consent !== 'active';
}

const LEVEL_LABEL = { info: '안내', warning: '업데이트 안내', required: '업데이트 필요' } as const;

function deadlineText(iso: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(t);
}

/**
 * `contributor`: the dashboard banner rule (also on the upload gate, where the same contributor is held back);
 * `consent`: the no-consent gate rule.
 */
export default function ClientUpdateNotice({ audience }: { audience: 'contributor' | 'consent' }) {
  const { status } = useContext(ClientUpdateContext);
  const visible = audience === 'consent' ? gateNoticeVisible(status) : dashboardNoticeVisible(status);
  if (!visible || !status?.notice) return null;
  const n = status.notice;
  const links = ([['pc', 'PC 앱 받기', n.url.pc], ['mobile', '모바일 앱 받기', n.url.mobile]] as const)
    .map(([kind, label, url]) => ({ kind, label, url: safeHttpsUrl(url) }))
    .filter((l): l is { kind: 'pc' | 'mobile'; label: 'PC 앱 받기' | '모바일 앱 받기'; url: string } => l.url !== null);
  const versions = [n.min_version.pc && `PC ${n.min_version.pc} 이상`, n.min_version.mobile && `모바일 ${n.min_version.mobile} 이상`].filter(Boolean);
  const deadline = deadlineText(n.deadline);
  return (
    <aside className={`client-update-notice level-${n.level} audience-${audience}`} role={n.level === 'required' ? 'alert' : 'status'}
      aria-label={LEVEL_LABEL[n.level]}>
      <p className="client-update-title">{LEVEL_LABEL[n.level]}</p>
      <p className="client-update-message">{n.message}</p>
      {(versions.length > 0 || deadline) && (
        <p className="client-update-meta">
          {versions.length > 0 && <span>필요 버전: {versions.join(' · ')}</span>}
          {deadline && <span>기한: {deadline}</span>}
        </p>
      )}
      {links.length > 0 && (
        <p className="client-update-links">
          {links.map((l) => (
            <a key={l.kind} className="client-update-link" href={l.url} target="_blank" rel="noopener noreferrer"
              aria-label={`${l.label} (새 탭에서 열림)`}>
              {l.label}<span className="external-mark" aria-hidden="true">↗</span>
            </a>
          ))}
        </p>
      )}
    </aside>
  );
}
