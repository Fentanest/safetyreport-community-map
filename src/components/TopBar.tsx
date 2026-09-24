import familyMark from '../../design/assets/family-mark.png';
import { dataMode } from '../data/client';
import type { ThemeMode } from '../state/filters';
import Icon from './icons';

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
const THEME_ICON = { dark: 'moon', light: 'sun', system: 'auto' } as const;

export default function TopBar({ theme, onTheme, briefing, onBriefing, dataStamp, sample }: Props) {
  const next = THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length];
  const badge = dataMode === 'demo'
    ? { text: 'demo · 합성 데이터', title: '합성 예시 자료입니다. 실제 신고 통계가 아닙니다.' }
    : sample
      ? { text: 'live · 표본', title: '실제 공개 통계의 표본 구간입니다.' }
      : { text: 'live', title: '실제 공개 통계입니다.' };
  return (
    <header className="topbar">
      <a className="skip-link" href="#main">본문 바로가기</a>
      <a className="brand" href="#main" aria-label="커뮤니티 신고 지도 처음으로">
        <img src={familyMark} alt="" aria-hidden="true" width={40} height={40} />
        <span>
          <b>커뮤니티 신고 지도</b>
          <small>나만의 안전신문고 · COMMUNITY MAP</small>
        </span>
      </a>
      <span className="demo-badge" title={badge.title}>{badge.text}</span>
      <div className="header-end">
        <span className="data-stamp" title={dataMode === 'demo' ? '합성 예시 자료의 기준일입니다.' : '데이터 기준일'}>
          데이터 기준 {dataStamp}
        </span>
        <button
          className="icon-btn"
          type="button"
          onClick={() => onTheme(next)}
          aria-label={`테마 전환 (현재 ${THEME_LABEL[theme]}, 다음 ${THEME_LABEL[next]})`}
          title={`테마: ${THEME_LABEL[theme]}`}
        >
          <Icon name={THEME_ICON[theme]} />
          <span className="cm-muted" style={{ fontSize: 12 }}>{THEME_LABEL[theme]}</span>
        </button>
        <button className="quiet-btn" type="button" onClick={onBriefing} aria-pressed={briefing}>
          <Icon name="expand" />
          <span>{briefing ? '브리핑 종료' : '브리핑 모드'}</span>
        </button>
      </div>
    </header>
  );
}
