import { describe, expect, it } from 'vitest';
import { AD_BANNERS, decodeEntities, parseBanners } from '../../src/ads/banners';

const COUPANG = '이 페이지는 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.';

describe('src/ads/banners.html — the one file the owner edits', () => {
  it('map and gate are the Coupang widgets with the disclosure above them', () => {
    const map = AD_BANNERS.map!;
    expect([new URL(map.src!).searchParams.get('id'), map.width, map.height, map.disclosure, map.srcdoc]).toEqual(['1034404', 1030, 250, COUPANG, null]);
    const gate = AD_BANNERS.gate!;
    expect([new URL(gate.src!).searchParams.get('id'), gate.width, gate.height, gate.disclosure]).toEqual(['1034414', 640, 200, COUPANG]);
  });
  it('side is the AliExpress srcdoc banner: fills the rail, 858px tall, decoded once', () => {
    const side = AD_BANNERS.side!;
    expect([side.src, side.width, side.height, side.disclosure]).toEqual([null, null, 858, null]);
    expect(side.srcdoc!.startsWith('<!doctype html><html lang="ko"><head><meta name="referrer" content="strict-origin">')).toBe(true);
    expect(side.srcdoc).toContain('href="https://s.click.aliexpress.com/e/_c4sW0pc5"');
    // an entity of the inner document stays encoded (3.19&quot; IPS), the closing script tag is intact
    expect(side.srcdoc).toContain('3.19&quot; IPS');
    expect(side.srcdoc!.trimEnd().endsWith('</script></body></html>')).toBe(true);
  });
});

describe('parseBanners', () => {
  it('reads only the first iframe of a known slot and ignores comments, scripts and unknown slots', () => {
    const out = parseBanners(`
      <!-- <section data-ad-slot="map"><iframe src="https://commented.example/" width="1" height="1"></iframe></section> -->
      <section data-ad-slot="map"><script>alert(1)</script><iframe src="https://a.example/w?x=1&y=2" width="300" height="100"></iframe><iframe src="https://b.example/" height="9"></iframe></section>
      <section data-ad-slot="footer"><iframe src="https://c.example/" width="10" height="10"></iframe></section>`);
    expect(Object.keys(out)).toEqual(['map']);
    expect(out.map).toMatchObject({ src: 'https://a.example/w?x=1&y=2', width: 300, height: 100, title: '광고', disclosure: null });
  });
  it('drops non-https widgets, missing heights and empty sections (the slot then shows nothing)', () => {
    const out = parseBanners(`
      <section data-ad-slot="map"><iframe src="http://a.example/" width="300" height="100"></iframe></section>
      <section data-ad-slot="gate"><iframe src="javascript:alert(1)" width="300" height="100"></iframe></section>
      <section data-ad-slot="side"><iframe src="https://a.example/" width="300"></iframe></section>`);
    expect(out).toEqual({});
    expect(parseBanners('<section data-ad-slot="map">\n</section>')).toEqual({});
  });
  it('section data-width / data-height override the iframe size', () => {
    const out = parseBanners('<section data-ad-slot="side" data-width="320" data-height="600"><iframe srcdoc="&lt;p&gt;hi&lt;/p&gt;" width="100%" height="858"></iframe></section>');
    expect(out.side).toMatchObject({ width: 320, height: 600, srcdoc: '<meta name="referrer" content="strict-origin"><p>hi</p>', src: null });
  });
});

describe('decodeEntities', () => {
  it('decodes one level only', () => {
    expect(decodeEntities('&lt;a title=&quot;x&amp;quot;&quot;&gt; &#39;&#x41;&nbsp;&unknown;')).toBe('<a title="x&quot;"> \'A &unknown;');
  });
});
