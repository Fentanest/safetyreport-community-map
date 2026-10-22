import { safeHttpsUrl, type UpdateGate } from '../data/personal';

interface Props {
  gate: UpdateGate;
  displayName: string | null;
  onRetry: () => void;
  onSignOut: () => void;
}

/**
 * Required app version (2026-10-22, task 2-10, user decision: below the required version the map does not open).
 * Shown instead of the map when the map's own client-status says `update_gate.blocked`: no app of this account was seen
 * at or above the required version in the last 30 days. An app reports its version when it starts, so updating and
 * opening the app once is enough. Versions, links and the optional message all come from the server.
 */
export default function UpdateRequired({ gate, displayName, onRetry, onSignOut }: Props) {
  const versions = [gate.min_version.pc && `PC ${gate.min_version.pc} 이상`, gate.min_version.mobile && `모바일 ${gate.min_version.mobile} 이상`]
    .filter(Boolean) as string[];
  const links = ([['pc', 'PC 프로그램 받기', gate.url.pc], ['mobile', '모바일 앱 받기', gate.url.mobile]] as const)
    .map(([kind, label, url]) => ({ kind, label, url: safeHttpsUrl(url) }))
    .filter((l): l is { kind: 'pc' | 'mobile'; label: 'PC 프로그램 받기' | '모바일 앱 받기'; url: string } => l.url !== null);
  return (
    <main id="main" className="access-gate update-required">
      <section className="cm-panel access-card" aria-labelledby="update-title">
        <div className="overline">나만의 안전신문고 커뮤니티</div>
        <h1 id="update-title">앱을 업데이트해 주세요</h1>
        <p className="access-lead" role="alert">
          {displayName ? `${displayName} 계정에서 ` : ''}최근 30일 안에 실행한 앱 중 필요한 버전 이상이 없어 지도를 열 수 없습니다.
        </p>
        <p>앱을 최신 버전으로 업데이트한 뒤 한 번 실행해 주세요. 앱을 실행하면 버전이 확인되고, 여기서 ‘다시 확인’을 누르면 지도가 열립니다.</p>
        {versions.length > 0 && <p className="cm-muted">필요한 버전: {versions.join(' · ')}</p>}
        {gate.message && <p className="update-required-note">{gate.message}</p>}
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
        <div className="access-actions">
          <button className="primary-button" type="button" onClick={onRetry}>다시 확인</button>
          <button className="ghost-btn" type="button" onClick={onSignOut}>다른 계정으로 로그인</button>
        </div>
      </section>
    </main>
  );
}
