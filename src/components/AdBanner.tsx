/**
 * 광고 배너 한 자리 (쿠팡 파트너스 2026-09-30, 알리익스프레스 2026-10-17 사용자 결정). 배너 코드는 `src/ads/banners.html`에서 온다.
 * iframe만 쓴다: 광고 코드는 쿠팡 도메인 또는 sandbox(고유 출처 없음)에서 따로 돌아서 이 페이지의 로그인 세션(localStorage)·화면에
 * 접근하지 못한다. 페이지 스크립트형(g.js) 배너는 쓰지 않는다.
 * - referrer: 출처(도메인)만 보낸다. 주소창의 조회 조건(기간·지역·기관)은 넘기지 않는다.
 * - 고정 폭 위젯은 자리가 좁으면 비율을 유지한 채 줄이고(minScale 미만이면 감춘다) 가로 넘침을 만들지 않는다.
 *   폭이 정해지지 않은 배너(width="100%")는 자리 폭을 그대로 채운다.
 * - media가 있으면 그 화면 조건에서만 그린다(조건 밖에서는 iframe을 만들지 않아 숨은 배너가 내려받지·돌지 않는다).
 * - 대가성 문구(banners.html의 data-disclosure)를 배너 위에 함께 보인다(2026-10-04 사용자 결정: 문구는 광고 상단). VITE_ADS=off 이면 아무것도 그리지 않는다.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AD_BANNERS, SRCDOC_SANDBOX, adsEnabled, type AdSlot } from '../ads/banners';

function useMedia(query: string | undefined): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    if (!query || typeof window.matchMedia !== 'function') return () => {};
    const mq = window.matchMedia(query);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return useSyncExternalStore(subscribe,
    () => !query || typeof window.matchMedia !== 'function' || window.matchMedia(query).matches,
    // server render (tests): only a banner without a media condition
    () => !query);
}

export default function AdBanner({ slot, minScale = 0.5, className = '', media }: {
  slot: AdSlot;
  /** below this scale a fixed-width banner is hidden instead of shrunk further */
  minScale?: number;
  className?: string;
  /** CSS media query: the banner is rendered only while it matches */
  media?: string;
}) {
  const shown = useMedia(media);
  const ad = shown ? AD_BANNERS[slot] : undefined;
  const width = ad?.width ?? null;
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = boxRef.current;
    if (!el || !width || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setScale(Math.min(1, el.clientWidth / width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);
  // a srcdoc banner that reports its content height (worklazy.net banners: 'wlpb-v1-height' after a 'wlpb-v1-init') gets
  // exactly that height, so no empty iframe area (white in dark mode) is left under it
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [fitHeight, setFitHeight] = useState<number | null>(null);
  const srcdoc = ad?.srcdoc ?? null;
  useEffect(() => {
    const el = frameRef.current;
    if (!el || !srcdoc) return;
    const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (n) => n.toString(16).padStart(2, '0')).join('');
    const init = () => el.contentWindow?.postMessage({ kind: 'wlpb-v1-init', id }, '*');
    const onMessage = (e: MessageEvent) => {
      const m = e.data as { kind?: unknown; id?: unknown; height?: unknown } | null;
      if (e.source !== el.contentWindow || !m || m.kind !== 'wlpb-v1-height' || m.id !== id) return;
      if (typeof m.height === 'number' && Number.isInteger(m.height) && m.height >= 120 && m.height <= 2400) setFitHeight(m.height);
    };
    window.addEventListener('message', onMessage);
    el.addEventListener('load', init);
    init();
    return () => { window.removeEventListener('message', onMessage); el.removeEventListener('load', init); };
  }, [srcdoc]);
  if (!adsEnabled() || !ad) return null;
  const hidden = width !== null && scale < minScale;
  const frame = (
    <iframe ref={frameRef} title={ad.title} src={ad.src ?? undefined} srcDoc={srcdoc ?? undefined} sandbox={srcdoc ? SRCDOC_SANDBOX : undefined}
      width={width ?? '100%'} height={fitHeight ?? ad.height} loading="lazy" scrolling={width ? 'no' : undefined} frameBorder={0} referrerPolicy="strict-origin"
      style={{ transform: width && scale < 1 ? `scale(${scale})` : undefined }} />
  );
  return (
    <aside className={`ad-slot ${className}`.trim()} aria-label="광고" style={{ maxWidth: width ?? undefined }}>
      {!hidden && ad.disclosure && <p className="ad-disclosure">{ad.disclosure}</p>}
      {width === null ? frame : (
        <div ref={boxRef} className="ad-frame-box" style={{ height: hidden ? 0 : Math.round((fitHeight ?? ad.height) * scale) }}>
          {!hidden && frame}
        </div>
      )}
    </aside>
  );
}
