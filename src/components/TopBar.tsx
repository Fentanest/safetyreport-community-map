import familyMark from '../../design/assets/family-mark.png';
import { dataMode } from '../data/client';
import type { ThemeMode } from '../state/filters';
import Icon from './icons';
import type { ReactNode } from 'react';

interface Props {
  theme: ThemeMode;
  onTheme: (t: ThemeMode) => void;
  briefing: boolean;
  onBriefing: () => void;
  dataStamp: string;
  sample: boolean;
  /** map web login / account menu (needed to read the map while it is contributor-only) */
  account?: ReactNode;
}

const THEME_ORDER: ThemeMode[] = ['dark', 'light', 'system'];
const THEME_LABEL: Record<ThemeMode, string> = { dark: '다크', light: '라이트', system: '시스템' };
const THEME_ICON = { dark: 'moon', light: 'sun', system: 'auto' } as const;

export default function TopBar({ theme, onTheme, briefing, onBriefing, dataStamp, sample, account }: Props) {
  const next = THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length];
  // Only the demo build needs a badge; the live site is simply the site.
  const badge = dataMode === 'demo' || sample
    ? { text: '예시 데이터', title: '실제 신고가 아닌 예시 자료로 만든 화면입니다.' }
    : null;
  return (
    <header className="topbar">
      <a className="skip-link" href="#main">본문 바로가기</a>
      <a className="brand" href="#main" aria-label="커뮤니티 신고 지도 처음으로">
        <img src={familyMark} alt="" aria-hidden="true" width={40} height={40} />
        <span>
          <b>커뮤니티 신고 지도</b>
          <small>나만의 안전신문고</small>
        </span>
      </a>
      {badge && <span className="demo-badge" title={badge.title}>{badge.text}</span>}
      <div className="header-end">
        {dataStamp && (
          <span className="data-stamp" title="이 날짜까지 공유된 신고를 반영했습니다">
            {dataStamp} 기준
          </span>
        )}
        {account}
        <button
          className="icon-btn theme-btn"
          type="button"
          onClick={() => onTheme(next)}
          aria-label={`테마 전환 (현재 ${THEME_LABEL[theme]}, 다음 ${THEME_LABEL[next]})`}
          title={`테마: ${THEME_LABEL[theme]}`}
        >
          <Icon name={THEME_ICON[theme]} />
          <span className="cm-muted btn-label" style={{ fontSize: 12 }}>{THEME_LABEL[theme]}</span>
        </button>
        <button className="quiet-btn briefing-btn" type="button" onClick={onBriefing} aria-pressed={briefing}>
          <Icon name="expand" />
          <span className="btn-label">{briefing ? '브리핑 종료' : '브리핑 모드'}</span>
        </button>
      </div>
    </header>
  );
}
