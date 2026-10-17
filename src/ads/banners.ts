/**
 * 광고 배너 설정 (2026-10-17 사용자 결정): 배너 코드는 `banners.html` 한 파일에만 둔다. 사용자가 그 파일의
 * <section data-ad-slot="..."> 안에 광고 사이트가 준 iframe 코드를 그대로 붙여 넣으면 배너가 바뀐다.
 * 여기서는 그 코드에서 iframe 한 개의 값(src 또는 srcdoc·크기·제목)만 읽고, 그리는 iframe의 보안 속성은 코드가 정한다:
 * - src 위젯(쿠팡): https만, referrer는 출처만(strict-origin).
 * - srcdoc 배너(알리익스프레스 등): 항상 sandbox(allow-same-origin 없음)라 이 페이지의 로그인 세션·화면에 접근하지 못한다.
 * - <script> 같은 iframe 밖의 코드는 실행하지 않는다.
 */
import raw from './banners.html?raw';

export type AdSlot = 'map' | 'gate' | 'side';

export interface Banner {
  title: string;
  /** remote widget page (https) */
  src: string | null;
  /** self-contained banner document, rendered sandboxed */
  srcdoc: string | null;
  /** null when the code gives no pixel width (e.g. width="100%"): the banner fills its slot */
  width: number | null;
  height: number;
  /** commission notice shown above the banner (null: the banner carries its own) */
  disclosure: string | null;
}

/** the only permissions a pasted srcdoc banner gets: its own scripts and opening product pages in a new tab */
export const SRCDOC_SANDBOX = 'allow-scripts allow-popups allow-popups-to-escape-sandbox';

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** one pass, so an encoded entity inside srcdoc (`&amp;quot;`) stays encoded for the inner document */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function attributes(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of s.matchAll(/([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    out[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return out;
}

const px = (v: string | undefined): number | null => (v && /^\s*\d+(\.\d+)?\s*(px)?\s*$/i.test(v) ? Math.round(parseFloat(v)) : null);

function httpsUrl(v: string | undefined): string | null {
  if (!v) return null;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

/** an origin-only referrer for the banner's own requests (images, clicked links) */
function withReferrerMeta(doc: string): string {
  const meta = '<meta name="referrer" content="strict-origin">';
  return /<head\b[^>]*>/i.test(doc) ? doc.replace(/<head\b[^>]*>/i, (h) => h + meta) : meta + doc;
}

const IFRAME = /<iframe\b((?:\s+[^\s=/>"']+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*\/?>/i;

export function parseBanners(html: string): Partial<Record<AdSlot, Banner>> {
  const out: Partial<Record<AdSlot, Banner>> = {};
  const text = html.replace(/<!--[\s\S]*?-->/g, '');
  for (const m of text.matchAll(/<section\b([^>]*)>([\s\S]*?)<\/section>/gi)) {
    const sec = attributes(m[1]);
    const slot = sec['data-ad-slot'] as AdSlot | undefined;
    if (slot !== 'map' && slot !== 'gate' && slot !== 'side') continue;
    const tag = IFRAME.exec(m[2]);
    if (!tag) continue;
    const a = attributes(tag[1]);
    const srcdoc = 'srcdoc' in a && a.srcdoc.trim() ? withReferrerMeta(a.srcdoc) : null;
    const src = srcdoc ? null : httpsUrl(a.src);
    const height = px(sec['data-height']) ?? px(a.height);
    if ((!src && !srcdoc) || !height) continue;
    out[slot] = {
      title: a.title?.trim() || '광고',
      src,
      srcdoc,
      width: px(sec['data-width']) ?? px(a.width),
      height,
      disclosure: sec['data-disclosure']?.trim() || null,
    };
  }
  return out;
}

export const AD_BANNERS = parseBanners(raw);

export const adsEnabled = () => import.meta.env.VITE_ADS !== 'off';
