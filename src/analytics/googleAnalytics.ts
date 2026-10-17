/**
 * Google Analytics 4 (gtag.js, 2026-10-17 사용자 지시). 붙여 준 기본 스니펫과 같은 태그를 쓰되, 주소는 정제해서 보낸다.
 * - 이 앱의 주소창에는 카카오 로그인 콜백의 `code`, 조회 조건(기간·지역·기관), 공유 레시피(`sr`), 순위 상태(`rk_*`)가
 *   실린다. gtag 기본 page_view는 주소 전체를 Google로 보내므로 끄고(send_page_view: false), 경로와 화면 이름만 보낸다.
 * - 이전 페이지 주소(referrer)도 출처(도메인)만 보낸다. 같은 사이트 안의 이동이면 보내지 않는다.
 * - 사용자 id·계정·세션·닉네임은 보내지 않는다. 신고 데이터·차량번호는 어떤 이벤트에도 넣지 않는다.
 * - 개발 서버와 demo 빌드에서는 켜지 않는다. VITE_GA=off 이면 운영 빌드에서도 끄고, VITE_GA=on 이면 검수용으로 켠다.
 */
export const GA_MEASUREMENT_ID = 'G-44DVBQZ1S8';

export type AnalyticsScreen = 'dashboard' | 'statistics' | 'rankings';

type Gtag = (...args: unknown[]) => void;
declare global {
  interface Window { dataLayer?: unknown[]; gtag?: Gtag }
}

export function analyticsEnabled(env: { VITE_GA?: string; VITE_DATA_MODE?: string; PROD: boolean } = import.meta.env): boolean {
  if (env.VITE_GA === 'off') return false;
  if (env.VITE_GA === 'on') return true;
  return env.PROD && env.VITE_DATA_MODE !== 'demo';
}

/** origin + path + the screen name only: every other query parameter (OAuth code, scope, share recipe) is dropped */
export function analyticsLocation(href: string, screen: AnalyticsScreen): string {
  const url = new URL(href);
  return `${url.origin}${url.pathname}${screen === 'dashboard' ? '' : `?screen=${screen}`}`;
}

/** an external referrer's origin only; same-site or unreadable referrers are not sent */
export function analyticsReferrer(referrer: string, selfOrigin: string): string {
  try {
    const origin = new URL(referrer).origin;
    return origin === selfOrigin || origin === 'null' ? '' : `${origin}/`;
  } catch {
    return '';
  }
}

let lastLocation: string | null = null;

/** one page_view per distinct screen address (a re-render or the post-login URL cleanup does not count again) */
export function trackScreen(screen: AnalyticsScreen): void {
  const gtag = window.gtag;
  if (!gtag) return;
  const pageLocation = analyticsLocation(window.location.href, screen);
  if (pageLocation === lastLocation) return;
  const pageReferrer = lastLocation ?? analyticsReferrer(document.referrer, window.location.origin);
  lastLocation = pageLocation;
  // set (not only the event parameters): enhanced-measurement events (scroll, outbound click …) reuse these values
  gtag('set', { page_location: pageLocation, page_referrer: pageReferrer });
  gtag('event', 'page_view', { page_location: pageLocation, page_referrer: pageReferrer, page_title: document.title });
}

export function installAnalytics(screen: AnalyticsScreen): void {
  if (!analyticsEnabled() || window.gtag) return;
  window.dataLayer = window.dataLayer || [];
  // gtag.js reads the Arguments object itself (an array copy is ignored), exactly as in Google's snippet
  window.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments);
  };
  const pageLocation = analyticsLocation(window.location.href, screen);
  window.gtag('js', new Date());
  window.gtag('config', GA_MEASUREMENT_ID, {
    send_page_view: false,
    page_location: pageLocation,
    page_referrer: analyticsReferrer(document.referrer, window.location.origin),
  });
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
  document.head.appendChild(script);
  trackScreen(screen);
}
