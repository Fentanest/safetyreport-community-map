/**
 * 쿠팡 파트너스 배너 (2026-09-30 사용자 결정). iframe 위젯만 쓴다: 광고 코드는 쿠팡 도메인에서 따로 돌아서 이 페이지의 로그인
 * 세션(localStorage)·화면에 접근하지 못한다. 페이지 스크립트형(g.js) 배너는 쓰지 않는다.
 * - referrer: 출처(도메인)만 보낸다. 주소창의 조회 조건(기간·지역·기관)은 넘기지 않는다.
 * - 위젯은 고정 크기라서, 자리가 좁으면 비율을 유지한 채 줄이고(minScale 미만이면 감춘다) 가로 넘침을 만들지 않는다.
 * - 대가성 문구를 항상 배너 위에 함께 보인다(2026-10-04 사용자 결정: 문구는 광고 상단). VITE_ADS=off 이면 아무것도 그리지 않는다.
 */
import { useEffect, useRef, useState } from 'react';

export const COUPANG_DISCLOSURE = '이 페이지는 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.';
const TRACKING = 'AF9752254';

export const adsEnabled = () => import.meta.env.VITE_ADS !== 'off';

export function coupangWidgetUrl(id: string, width: number, height: number): string {
  const q = new URLSearchParams({ id, template: 'carousel', trackingCode: TRACKING, subId: '', width: String(width), height: String(height), tsource: '' });
  return `https://ads-partners.coupang.com/widgets.html?${q}`;
}

export default function CoupangAd({ id, width, height, minScale = 0.5, className = '' }: {
  id: string;
  width: number;
  height: number;
  /** below this scale the banner is hidden instead of shrunk further */
  minScale?: number;
  className?: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setScale(Math.min(1, el.clientWidth / width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);
  if (!adsEnabled()) return null;
  const hidden = scale < minScale;
  return (
    <aside className={`ad-slot ${className}`.trim()} aria-label="광고" style={{ maxWidth: width }}>
      {!hidden && <p className="ad-disclosure">{COUPANG_DISCLOSURE}</p>}
      <div ref={boxRef} className="ad-frame-box" style={{ height: hidden ? 0 : Math.round(height * scale) }}>
        {!hidden && (
          <iframe title="쿠팡 파트너스 광고" src={coupangWidgetUrl(id, width, height)} width={width} height={height}
            loading="lazy" scrolling="no" frameBorder={0} referrerPolicy="strict-origin"
            style={{ transform: scale < 1 ? `scale(${scale})` : undefined }} />
        )}
      </div>
    </aside>
  );
}
