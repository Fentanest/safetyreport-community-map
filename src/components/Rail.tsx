import Icon, { type IconName } from './icons';

const ITEMS: Array<{ id: string; label: string; icon: IconName; target: string }> = [
  { id: 'mapsection', label: '상황판', icon: 'map', target: 'mapsection' },
  { id: 'regions', label: '지역', icon: 'pin', target: 'mapsection' },
  { id: 'entities', label: '기관', icon: 'building', target: 'entities' },
  { id: 'analytics', label: '추이', icon: 'chart', target: 'analytics' },
];

export default function Rail({ active, onNavigate, onAbout }: { active: string; onNavigate: (id: string) => void; onAbout: () => void }) {
  const go = (target: string, id: string) => {
    onNavigate(id);
    document.getElementById(target)?.scrollIntoView({ behavior: 'auto', block: 'start' });
  };
  return (
    <>
      <nav className="rail" aria-label="주요 화면">
        {ITEMS.map((it) => (
          <button
            key={it.id}
            type="button"
            className={`nav-item${active === it.id ? ' active' : ''}`}
            title={it.label}
            aria-label={it.label}
            aria-current={active === it.id ? 'page' : undefined}
            onClick={() => go(it.target, it.id)}
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
          <button
            key={it.id}
            type="button"
            aria-current={active === it.id ? 'page' : undefined}
            onClick={() => go(it.target, it.id)}
          >
            <Icon name={it.icon} size={22} />
            <span>{it.label}</span>
          </button>
        ))}
      </nav>
    </>
  );
}
