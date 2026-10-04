import Icon, { type IconName } from './icons';

export type Screen = 'dashboard' | 'statistics' | 'rankings';

/**
 * 2026-10-04 layout: the side rail of in-page anchors was replaced by three real destinations. Desktop shows them as
 * tabs in the top bar; a phone shows the same three plus 안내 as a bottom bar. Dashboard sections are tabs inside the
 * page now (지도 패널: 개요·지역·기관·담당자, 아래 카드: 추이·기관·담당자·위반법규), so no anchor menu is needed.
 */
const ITEMS: Array<{ id: Screen; label: string; short: string; icon: IconName }> = [
  { id: 'dashboard', label: '대시보드', short: '대시보드', icon: 'map' },
  { id: 'statistics', label: '맞춤 통계', short: '통계', icon: 'table' },
  { id: 'rankings', label: '유저 랭킹', short: '랭킹', icon: 'users' },
];

export default function AppNav({ screen, onScreen, onAbout, variant }: {
  screen: Screen;
  onScreen: (screen: Screen) => void;
  onAbout: () => void;
  variant: 'top' | 'bottom';
}) {
  if (variant === 'top') {
    return (
      <nav className="app-tabs" aria-label="주요 화면">
        {ITEMS.map((it) => (
          <button key={it.id} type="button" className="app-tab" aria-current={screen === it.id ? 'page' : undefined} onClick={() => onScreen(it.id)}>
            {it.label}
          </button>
        ))}
      </nav>
    );
  }
  return (
    <nav className="bottom-nav" aria-label="모바일 주요 화면">
      {ITEMS.map((it) => (
        <button key={it.id} type="button" aria-label={it.label} aria-current={screen === it.id ? 'page' : undefined} onClick={() => onScreen(it.id)}>
          <Icon name={it.icon} size={22} />
          <span>{it.short}</span>
        </button>
      ))}
      <button type="button" aria-label="데이터 안내" onClick={onAbout}>
        <Icon name="info" size={22} />
        <span>안내</span>
      </button>
    </nav>
  );
}
