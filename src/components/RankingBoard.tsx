/**
 * One-page ranking board cards (2026-10-11 user decision): 1–3위 on a block-brick podium with generic block figures
 * (NOT a trademark design: no brand name, logo or trademark shapes — 문구는 '블록 피규어'), 4–5위 list, own rank line and
 * '전체 보기'. Figures and effects are decorative (aria-hidden); rank, value and UUID stay plain text and buttons.
 * Motion is CSS keyframes on transform/opacity only; prefers-reduced-motion shows a still pose (rankings.css).
 */
import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import type { BoardEntry } from '../../contracts/user-rankings-board/types';
import type { RankingQuery, RankingRow } from '../../contracts/user-rankings/types';

type Theme = RankingQuery['theme'];
type Metric = RankingQuery['metric'];

export const CARD_TITLES: Record<Metric, string> = {
  reports_count: '완료 신고 건수',
  fine_count: '과태료 처분 건수',
  fine_rate: '과태료 처분율',
  rejected_count: '불수용 건수',
  rejected_rate: '불수용 비율',
  partial_count: '일부수용 건수',
  partial_rate: '일부수용 비율',
};

export function shortUuid(u: string): string {
  return u.length > 13 ? `${u.slice(0, 8)}…${u.slice(-4)}` : u;
}

export function formatRankValue(row: RankingRow, metric: Metric): string {
  if (metric.endsWith('_rate')) return `${row.value.toFixed(1)}%`;
  return `${row.value.toLocaleString('ko-KR')}건`;
}

type Pose = 'cheer' | 'shrug' | 'umbrella';

/** Generic block figure: stud on a cylinder head, trapezoid torso, C-shaped hands. viewBox fits crown/cloud/flag. */
function BlockFigure({ pose, place, theme, me, crown }: { pose: Pose; place: number; theme: Theme; me: boolean; crown: boolean }) {
  const sad = pose !== 'cheer';
  // place = podium position (1 = centre). One confetti/coin burst over position 1 only; crown + jump for every 1위.
  return (
    <svg className={`rk-fig rk-fig-${pose}${crown ? ' rk-fig-jump' : ''}`} viewBox="-12 -40 64 94" width="64" height="94" aria-hidden="true" focusable="false">
      {pose === 'umbrella' && (
        <g className="rk-weather">
          <g className="rk-cloud">
            <circle cx="20" cy="-31" r="5.5" />
            <circle cx="27" cy="-34" r="6.5" />
            <circle cx="34" cy="-31" r="5" />
            <rect x="15" y="-31" width="24" height="6" rx="3" />
          </g>
          {[18, 24, 30, 36].map((x, i) => (
            <rect key={x} className="rk-drop" x={x} y="-23" width="1.4" height="3.6" rx="0.7" style={{ animationDelay: `${i * 0.22}s` } as CSSProperties} />
          ))}
          <path className="rk-umbrella" d="M8 -9 Q24 -27 40 -9 Q36 -12 32 -9 Q28 -12 24 -9 Q20 -12 16 -9 Q12 -12 8 -9 Z" />
          <line className="rk-umbrella-shaft" x1="24" y1="-9" x2="30.5" y2="7" />
        </g>
      )}
      <g className="rk-fig-body">
        {crown && (
          <g className="rk-crown">
            <rect x="12" y="-10" width="16" height="5" rx="1" />
            <rect x="13" y="-13.5" width="3.4" height="4" rx="0.8" />
            <rect x="18.3" y="-14.5" width="3.4" height="5" rx="0.8" />
            <rect x="23.6" y="-13.5" width="3.4" height="4" rx="0.8" />
          </g>
        )}
        {/* left arm sits behind the torso */}
        <g className={`rk-arm rk-arm-l rk-arm-${pose}`}>
          <rect x="8.5" y="18" width="5" height="12" rx="2.4" className="rk-sleeve" />
          <circle cx="11" cy="32.2" r="2.7" className="rk-hand" strokeDasharray="11.5 5.5" />
        </g>
        <rect className="rk-stud-head" x="16" y="-4" width="8" height="4.5" rx="1.2" />
        <rect className="rk-head" x="11" y="0" width="18" height="16" rx="4.5" />
        <circle className="rk-eye" cx="16.5" cy="6.6" r="1.3" />
        <circle className="rk-eye" cx="23.5" cy="6.6" r="1.3" />
        <path className="rk-mouth" d={sad ? 'M16 12.6 Q20 9.8 24 12.6' : 'M15.4 10.2 Q20 14.6 24.6 10.2'} />
        <polygon className="rk-torso" points="12,16.5 28,16.5 32,36 8,36" />
        <rect className="rk-hips" x="8" y="35.5" width="24" height="4" rx="0.8" />
        <rect className="rk-leg" x="8.5" y="39" width="11" height="13.5" rx="1" />
        <rect className="rk-leg" x="20.5" y="39" width="11" height="13.5" rx="1" />
        <g className={`rk-arm rk-arm-r rk-arm-${pose}`}>
          <rect x="26.5" y="18" width="5" height="12" rx="2.4" className="rk-sleeve" />
          <circle cx="29" cy="32.2" r="2.7" className="rk-hand" strokeDasharray="11.5 5.5" />
        </g>
      </g>
      {me && (
        <g className="rk-flag">
          <line x1="-10" y1="52" x2="-10" y2="20" />
          <rect x="-10" y="20" width="12" height="9.5" rx="1" />
          <text x="-4" y="27.4" textAnchor="middle">나</text>
        </g>
      )}
      {theme === 'reporters' && place === 1 && (
        <g className="rk-confetti">
          {CONFETTI.map((c, i) => (
            <g key={i} className={`rk-bit rk-bit-${i % 4}`} style={{ '--dx': `${c[0]}px`, '--dy': `${c[1]}px`, '--r': `${c[2]}deg`, animationDelay: `${c[3]}s` } as CSSProperties}>
              <rect x="18" y="-12" width="5" height="3" rx="0.6" />
              <rect x="19.3" y="-13.2" width="2.4" height="1.4" rx="0.4" />
            </g>
          ))}
        </g>
      )}
      {theme === 'fines' && place === 1 && (
        <g className="rk-coins">
          {COINS.map((x, i) => (
            <g key={x} className="rk-coin" style={{ animationDelay: `${0.12 * i}s` } as CSSProperties}>
              <circle cx={x} cy="50.5" r="3.2" />
              <circle cx={x} cy="50.5" r="1.5" className="rk-coin-stud" />
            </g>
          ))}
        </g>
      )}
    </svg>
  );
}
// [dx, dy, rotate, delay]
const CONFETTI: Array<[number, number, number, number]> = [
  [-22, -20, 170, 0], [-12, -30, -120, 0.05], [-2, -34, 200, 0.02], [10, -30, -160, 0.08],
  [22, -22, 140, 0.04], [-26, -6, -90, 0.1], [26, -8, 110, 0.07], [4, -24, 260, 0.12],
];
const COINS = [-4, 3, 38, 45];

function useSeen<T extends Element>() {
  const ref = useRef<T | null>(null);
  const [seen, setSeen] = useState(false);
  const [onscreen, setOnscreen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (typeof IntersectionObserver === 'undefined') { setSeen(true); setOnscreen(true); return undefined; }
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        setOnscreen(e.isIntersecting);
        if (e.isIntersecting) setSeen(true);
      }
    }, { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return { ref, seen, onscreen };
}

interface CardProps {
  entry: BoardEntry;
  title: string;
  onOpenFull: (theme: Theme, metric: Metric) => void;
  onOpenUuid: (uuid: string, opener: HTMLButtonElement) => void;
}

function UuidButton({ uuid, onOpenUuid }: { uuid: string; onOpenUuid: CardProps['onOpenUuid'] }) {
  return (
    <button
      type="button"
      className="rk-uuid-btn"
      title={uuid}
      aria-label={`참여자 ${shortUuid(uuid)} 전체 UUID 보기`}
      aria-haspopup="dialog"
      onClick={(e: MouseEvent<HTMLButtonElement>) => onOpenUuid(uuid, e.currentTarget)}
    >
      <code className="rk-uuid">{shortUuid(uuid)}</code>
    </button>
  );
}

export function BoardCard({ entry, title, onOpenFull, onOpenUuid }: CardProps) {
  const { ref, seen, onscreen } = useSeen<HTMLElement>();
  const { theme, metric, rows, me } = entry;
  const podium = rows.slice(0, 3);
  const rest = rows.slice(3);
  const isRate = metric.endsWith('_rate');
  const headingId = `rk-card-${metric}`;
  const sub = (row: RankingRow) => (isRate
    ? `${row.denominator.toLocaleString('ko-KR')}건 중 ${row.numerator.toLocaleString('ko-KR')}건`
    : theme === 'reporters' ? '' : `완료 ${row.reports.toLocaleString('ko-KR')}건`);
  return (
    <article
      ref={ref}
      className={`cm-panel rk-card rk-card-${theme}${seen ? ' rk-seen' : ''}${onscreen ? ' rk-onscreen' : ''}`}
      aria-labelledby={headingId}
      data-metric={metric}
    >
      <header className="rk-card-head">
        <h3 id={headingId}>{title}</h3>
        <span className="cm-chip">참여자 {entry.total_participants.toLocaleString('ko-KR')}명</span>
      </header>
      {rows.length === 0 ? (
        <p className="cm-muted rk-card-empty" role="status">이 조건의 순위가 없습니다.</p>
      ) : (
        <>
          <ol className="rk-podium" aria-label={`${title} 1~3위`}>
            {podium.map((row, i) => {
              const pose: Pose = theme === 'unlucky' ? (row.rank === 1 ? 'umbrella' : 'shrug') : 'cheer';
              const place = Math.min(row.rank, 3);
              return (
                <li key={row.uuid} className={`rk-step rk-pos-${i} rk-place-${place}${row.is_me ? ' rk-me-row' : ''}`}>
                  <div className="rk-stage">
                    <BlockFigure pose={pose} place={i + 1} theme={theme} me={row.is_me} crown={row.rank === 1 && pose === 'cheer'} />
                    <div className="rk-brick">
                      <span className="rk-studs" aria-hidden="true"><i /><i /><i /><i /></span>
                      <span className="rk-brick-rank">{row.rank}<small>위</small></span>
                    </div>
                  </div>
                  <div className="rk-caption">
                    <span className="rk-caption-who">
                      <UuidButton uuid={row.uuid} onOpenUuid={onOpenUuid} />
                      {row.is_me && <span className="rk-me-badge">나</span>}
                    </span>
                    <b className="rk-caption-value">{formatRankValue(row, metric)}</b>
                    {(sub(row) || row.tie_count > 1 || row.reports === 1) && (
                      <small>{[sub(row), row.tie_count > 1 ? `공동 ${row.tie_count}명` : '', row.reports === 1 ? '표본 1건' : ''].filter(Boolean).join(' · ')}</small>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
          {rest.length > 0 && (
            <ol className="rk-card-rest" aria-label={`${title} 4~${3 + rest.length}위`}>
              {rest.map((row) => (
                <li key={row.uuid} className={row.is_me ? 'rk-me-row' : undefined}>
                  <span className="rk-rest-rank">{row.rank}위</span>
                  <span className="rk-rest-who">
                    <UuidButton uuid={row.uuid} onOpenUuid={onOpenUuid} />
                    {row.is_me && <span className="rk-me-badge">나</span>}
                  </span>
                  <span className="rk-rest-value">
                    <b>{formatRankValue(row, metric)}</b>
                    {(sub(row) || row.tie_count > 1) && (
                      <small>{[sub(row), row.tie_count > 1 ? `공동 ${row.tie_count}명` : ''].filter(Boolean).join(' · ')}</small>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
      <p className="rk-card-me">
        <span className="rk-me-label">내 순위</span>
        {me ? (
          <span>
            <b>{me.rank}위</b> / {entry.total_participants.toLocaleString('ko-KR')}명 · {formatRankValue(me, metric)}
            {isRate && ` (${me.denominator.toLocaleString('ko-KR')}건 중 ${me.numerator.toLocaleString('ko-KR')}건)`}
            {me.tie_count > 1 && ` · 공동 ${me.tie_count}명`}
          </span>
        ) : (
          <span className="cm-muted">이 조건에서는 내 기록이 없습니다</span>
        )}
      </p>
      <button
        type="button"
        className="ghost-btn rk-card-more"
        data-rk-more={metric}
        aria-label={`${title} 전체 보기`}
        onClick={() => onOpenFull(theme, metric)}
      >
        전체 보기
      </button>
    </article>
  );
}
