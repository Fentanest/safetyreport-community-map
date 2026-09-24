/** Family-aligned stroke icons: 24px viewBox, stroke 1.8, currentColor. No emoji. */
import type { JSX } from 'react';

export type IconName =
  | 'sun' | 'moon' | 'auto' | 'expand'
  | 'map' | 'pin' | 'building' | 'chart' | 'info'
  | 'calendar' | 'chevron' | 'filter' | 'reset' | 'share'
  | 'doc' | 'check' | 'pie' | 'users'
  | 'close' | 'table' | 'focus' | 'arrow';

const PATHS: Record<IconName, JSX.Element> = {
  sun: (<><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></>),
  moon: (<path d="M20 13.5A8 8 0 0 1 10.5 4 8 8 0 1 0 20 13.5Z" />),
  auto: (<><circle cx="12" cy="12" r="8" /><path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" stroke="none" /></>),
  expand: (<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" />),
  map: (<path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15" />),
  pin: (<><path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></>),
  building: (<path d="M5 21V3h14v18M3 21h18M9 7h1m4 0h1m-6 4h1m4 0h1m-6 4h1m4 0h1m-4 6v-3h2v3" />),
  chart: (<path d="M3 3v18h18M7 16l4-5 4 2 5-7" />),
  info: (<><circle cx="12" cy="12" r="9" /><path d="M12 11v6m0-10v.1" /></>),
  calendar: (<><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M7 3v4m10-4v4M3 10h18" /></>),
  chevron: (<path d="m7 10 5 5 5-5" />),
  filter: (<><path d="M4 6h16M7 12h10m-7 6h4" /><circle cx="8" cy="6" r="2" fill="currentColor" stroke="none" /></>),
  reset: (<path d="M3 10a9 9 0 1 1 2 9M3 4v6h6" />),
  share: (<><circle cx="6" cy="12" r="3" /><circle cx="18" cy="5" r="3" /><circle cx="18" cy="19" r="3" /><path d="m9 10 6-4m-6 8 6 4" /></>),
  doc: (<><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" /><path d="M14 3v6h6M8 13h8m-8 4h5" /></>),
  check: (<><circle cx="12" cy="12" r="9" /><path d="m7 12 3 3 7-7" /></>),
  pie: (<><path d="M12 3v9h9M9 3.5a9 9 0 1 0 11.5 11.5" /><path d="M15 3.5A9 9 0 0 1 20.5 9H15Z" /></>),
  users: (<><circle cx="9" cy="8" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 4v3" /></>),
  close: (<path d="m6 6 12 12M6 18 18 6" />),
  table: (<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M9 4v16" /></>),
  focus: (<><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" /><circle cx="12" cy="12" r="3" /></>),
  arrow: (<path d="M4 12h16m-5-5 5 5-5 5" />),
};

export default function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false"
      fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
      style={{ flex: 'none', verticalAlign: '-3px' }}
    >
      {PATHS[name]}
    </svg>
  );
}
