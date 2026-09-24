import type { ThemeMode } from '../state/filters';

interface Props {
  theme: ThemeMode;
  onTheme: (t: ThemeMode) => void;
  briefing: boolean;
  onBriefing: () => void;
  dataStamp: string;
  sample: boolean;
}

const THEME_ORDER: ThemeMode[] = ['dark', 'light', 'system'];
const THEME_LABEL: Record<ThemeMode, string> = { dark: '다크', light: '라이트', system: '시스템' };

export default function TopBar({ theme, onTheme, briefing, onBriefing, dataStamp, sample }: Props) {
  const next = THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length];
  return (
    <header className="topbar">
      <a className="skip-link" href="#main">본문 바로가기</a>
      <a className="brand" href="#main" aria-label="커뮤니티 신고 지도 처음으로">
        <span aria-hidden="true" style={{ width: 40, height: 40, borderRadius: 10, background: 'linear-gradient(135deg,#0D6EFD,#06B6D4)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, color: '#fff', fontWeight: 800 }}>안</span>
        <span>
          <b>커뮤니티 신고 지도</b>
          <small>나만의 안전신문고 · COMMUNITY MAP</small>
        </span>
      </a>
      <span className="demo-badge" title="합성 예시 자료입니다. 실제 신고 통계가 아닙니다.">demo · 합성 데이터</span>
      <div className="header-end">
        <span className="data-stamp" title={sample ? '합성 예시 자료의 기준일입니다.' : '데이터 기준일'}>
          데이터 기준 {dataStamp}
        </span>
        <button
          className="icon-btn"
          type="button"
          onClick={() => onTheme(next)}
          aria-label={`테마 전환 (현재 ${THEME_LABEL[theme]}, 다음 ${THEME_LABEL[next]})`}
          title={`테마: ${THEME_LABEL[theme]}`}
        >
          <span aria-hidden="true">{theme === 'dark' ? '☾' : theme === 'light' ? '☀' : '◐'}</span>
          <span className="cm-muted" style={{ fontSize: 12 }}>{THEME_LABEL[theme]}</span>
        </button>
        <button className="quiet-btn" type="button" onClick={onBriefing} aria-pressed={briefing}>
          <span aria-hidden="true">⛶</span>
          <span>{briefing ? '브리핑 종료' : '브리핑 모드'}</span>
        </button>
      </div>
    </header>
  );
}
