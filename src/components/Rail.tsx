import Icon, { type IconName } from './icons';

export type Screen = 'dashboard' | 'statistics' | 'rankings';

/** S03: exact targets — 지역 is the region list (not the map), 통계 is a separate screen (not the charts section). */
/** U05: menu order = page order (지도 → 법규 → 기관 → 추이 → 지역), then the separate 통계 screen. */
const ITEMS: Array<{ id: string; label: string; icon: IconName; target: string | null }> = [
  { id: 'mapsection', label: '지도', icon: 'map', target: 'mapsection' },
  { id: 'laws', label: '법규', icon: 'table', target: 'laws' },
  { id: 'entities', label: '기관', icon: 'building', target: 'entities' },
  { id: 'analytics', label: '추이', icon: 'chart', target: 'analytics' },
  { id: 'regions', label: '지역', icon: 'pin', target: 'regions' },
  { id: 'statistics', label: '통계', icon: 'table', target: null },
  { id: 'rankings', label: '유저 랭킹', icon: 'chart', target: null },
];

export default function Rail({ active, screen, onSection, onStatistics, onRankings, onAbout }: {
  /** section of the dashboard the reader is at (scroll spy) */
  active: string;
  screen: Screen;
  /** go to a dashboard section (restores the dashboard first when the statistics screen is open) */
  onSection: (id: string) => void;
  onStatistics: () => void;
  onRankings?: () => void;
  onAbout: () => void;
}) {
  const go = (it: typeof ITEMS[number]) => (it.target ? onSection(it.target) : it.id === 'rankings' ? onRankings?.() : onStatistics());
  // page vs in-page state: 통계 is a page (aria-current=page); dashboard sections are locations (aria-current=location)
  const current = (it: typeof ITEMS[number]) => (it.target === null
    ? (screen === it.id ? 'page' as const : undefined)
    : (screen === 'dashboard' && active === it.id ? 'location' as const : undefined));
  return (
    <>
      <nav className="rail" aria-label="주요 화면">
        {ITEMS.map((it) => (
          <button
            key={it.id}
            type="button"
            className={`nav-item${current(it) ? ' active' : ''}`}
            title={it.target ? `${it.label}(으)로 이동` : it.id === 'rankings' ? '유저 랭킹 화면' : '맞춤 통계 화면'}
            aria-label={it.target ? it.label : it.id === 'rankings' ? '유저 랭킹' : '통계 — 맞춤 통계 화면'}
            aria-current={current(it)}
            onClick={() => go(it)}
          >
            <Icon name={it.icon} size={22} />
            <small>{it.label}</small>
          </button>
        ))}
        <span className="nav-space" />
        <button type="button" className="nav-item" title="데이터 안내" aria-label="데이터 안내" onClick={onAbout}>
          <Icon name="info" size={22} />
          <small>안내</small>
        </button>
      </nav>
      <nav className="bottom-nav" aria-label="모바일 주요 화면">
        {ITEMS.map((it) => (
          <button key={it.id} type="button" aria-current={current(it)} onClick={() => go(it)}>
            <Icon name={it.icon} size={22} />
            <span>{it.label}</span>
          </button>
        ))}
      </nav>
    </>
  );
}
