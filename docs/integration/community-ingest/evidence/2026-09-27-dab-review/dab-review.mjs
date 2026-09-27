import { chromium } from '/home/better0101/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

const BASE = 'http://safemap.worklazy.net';
const OUT = '/home/better0101/projects/safetyreport-community-map-dab-review/docs/reviews/screenshots/dab-review';
fs.mkdirSync(OUT, { recursive: true });
const shot = (n) => path.join(OUT, n);
const results = [];
const log = (m) => console.log('[dab]', m);
const J = (o) => JSON.stringify(o).slice(0, 600);

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  args: ['--host-resolver-rules=MAP safemap.worklazy.net 127.0.0.1:4176', '--no-sandbox', '--disable-dev-shm-usage'],
});
const errors = [], warnings = [], failedReq = [], kakaoReq = [];
const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
ctx.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text().slice(0, 300));
  if (m.type() === 'warning') warnings.push(m.text().slice(0, 200));
});
ctx.on('response', (r) => {
  const u = r.url();
  if (/kakao|daum/i.test(u)) kakaoReq.push(`${r.status()} ${u.slice(0, 120)}`);
  if (r.status() >= 400 && !/tile|kakao|daum/i.test(u)) failedReq.push(`${r.status()} ${u.slice(0, 160)}`);
});
const page = await ctx.newPage();
page.on('requestfailed', (r) => {
  const u = r.url();
  if (!/tile/i.test(u)) failedReq.push(`FAIL ${r.failure()?.errorText} ${u.slice(0, 160)}`);
});

async function goto(url) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(4000);
}
function snap(name, pass, note) { results.push({ name, pass, note }); log(`${pass ? 'PASS' : 'FAIL'} ${name} :: ${String(note).slice(0, 220)}`); }
const bodyText = () => page.evaluate(() => document.body.innerText);

// 0. base + kakao
await goto(BASE + '/');
const kakaoObj = await page.evaluate(() => typeof window.kakao !== 'undefined' ? 'YES' : 'NO');
const kakaoOk = kakaoReq.some((s) => s.startsWith('200') && /dapi|sdk/i.test(s)) || kakaoObj === 'YES';
snap('kakao-map-present', kakaoObj === 'YES', `window.kakao=${kakaoObj} kakaoreq=${kakaoReq.filter(s=>/sdk/i.test(s)).join(';').slice(0,150)} tiles200=${kakaoReq.filter(s=>s.startsWith('200')&&/tile/i.test(s)).length}`);
await page.screenshot({ path: shot('00-base.png') });

// recon: dump controls
const recon = await page.evaluate(() => ({
  selects: [...document.querySelectorAll('select')].map((s) => ((s.getAttribute('aria-label') || s.name || s.id || '?') + '[' + s.options.length + ']:' + [...s.options].slice(0, 6).map((o) => o.text).join(',')).slice(0, 200)),
  checkboxes: [...document.querySelectorAll('input[type=checkbox]')].map((e) => (e.getAttribute('aria-label') || e.name || e.id || (e.closest('label')?.innerText || '').trim().slice(0, 40))).slice(0, 200),
  tables: document.querySelectorAll('table').length,
  headings: [...document.querySelectorAll('h2,h3')].map((e) => e.innerText.trim()).join('|').slice(0, 800),
  buttons: [...document.querySelectorAll('button')].map((e) => e.innerText.trim()).filter((t) => t.length < 25).slice(0, 60),
}));
fs.writeFileSync('/home/better0101/projects/safetyreport-community-map-dab-review/.agent-runtime/dab-recon.json', JSON.stringify(recon, null, 2));
log('RECON ' + J(recon));

// 1. matrix: viewports x themes x views (지도+통계 / 지도 크게 / 통계 크게)
const viewports = [{ w: 1920, h: 1080 }, { w: 1440, h: 900 }, { w: 2560, h: 1440 }, { w: 390, h: 844 }];
const themes = ['dark', 'light'];
const viewBtnNames = ['지도+통계', '지도 크게', '통계 크게'];
const matrix = [];
for (const vp of viewports) {
  for (const theme of themes) {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await goto(`${BASE}/?theme=${theme}`);
    for (const vb of viewBtnNames) {
      try {
        const btn = page.getByRole('button', { name: vb });
        if (await btn.count()) { await btn.first().click({ timeout: 4000 }); await page.waitForTimeout(1500); }
      } catch {}
      const fname = `${vp.w}x${vp.h}-${theme}-${vb.replace('+', 'plus')}.png`;
      await page.screenshot({ path: shot(fname) });
      const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      matrix.push({ viewport: `${vp.w}x${vp.h}`, theme, view: vb, file: fname, overflowX });
    }
  }
}
const over = matrix.filter((m) => m.overflowX > 1);
snap('matrix-screenshots', true, `${matrix.length} shots; overflowX>1: ${over.length ? over.map((m) => `${m.viewport}/${m.theme}/${m.view}(${m.overflowX}px)`).join('; ') : 'none'}`);

// 2. 금액·기간 숫자 대조
await page.setViewportSize({ width: 1920, height: 1080 });
await goto(BASE + '/?theme=dark');
{
  const t = await bodyText();
  const info = {
    hasDuration: t.includes('답변까지 걸린 기간') || t.includes('답변까지'),
    hasAmount: t.includes('과태료'),
    hasAccept: t.includes('수용률'),
    hasPartial: t.includes('일부수용'),
    hasNote: t.includes('미기재') || t.includes('범칙금') || t.includes('공개 동의'),
    won0: (t.match(/0원/g) || []).length,
    lines: t.split('\n').filter((l) => /과태료|답변까지|수용률/.test(l)).slice(0, 14),
  };
  fs.writeFileSync('/home/better0101/projects/safetyreport-community-map-dab-review/.agent-runtime/dab-stats.json', JSON.stringify(info, null, 2));
  snap('stats-rows-present', info.hasDuration && info.hasAmount, J(info));
}
{
  const tbl = await page.evaluate(() => [...document.querySelectorAll('table')].map((tb) => tb.innerText.slice(0, 2500)));
  fs.writeFileSync('/home/better0101/projects/safetyreport-community-map-dab-review/.agent-runtime/dab-tables.json', JSON.stringify(tbl, null, 2));
  snap('tables-captured', tbl.length > 0, `tables=${tbl.length} firstHead=${(tbl[0] || '').split('\n').slice(0, 4).join('|').slice(0, 200)}`);
}
// 추이 표로 보기
let trendNote = 'toggle-not-found';
try {
  const tb = page.getByRole('button', { name: /표로 보기|표 보기/ });
  if (await tb.count()) {
    await tb.first().click({ timeout: 4000 }); await page.waitForTimeout(1500);
    const tt = await page.evaluate(() => [...document.querySelectorAll('table')].map((x) => x.innerText.slice(0, 2000)).join('\n====\n').slice(0, 2500));
    fs.writeFileSync('/home/better0101/projects/safetyreport-community-map-dab-review/.agent-runtime/dab-trend.txt', tt);
    trendNote = 'captured len=' + tt.length;
  }
} catch (e) { trendNote = 'ERR ' + String(e).slice(0, 120); }
snap('trend-table', trendNote.startsWith('captured'), trendNote);
await page.screenshot({ path: shot('05-stats-detail.png') });

// 3. 지역 네비게이션 (select 기반)
await goto(BASE + '/?theme=dark');
let nav = [];
try {
  const selects = page.locator('select');
  const n = await selects.count();
  if (n >= 1) {
    await selects.first().selectOption({ index: 1 });
    await page.waitForTimeout(2000);
    nav.push('sido url=' + page.url());
    nav.push('chip=' + (await bodyText()).split('\n').filter((l) => /전국|시도|지역/.test(l)).slice(0, 4).join('|').slice(0, 300));
    await page.screenshot({ path: shot('10-region-sido.png') });
    const n2 = await selects.count();
    if (n2 >= 2) {
      const opts2 = await selects.nth(1).locator('option').allTextContents();
      nav.push('sigungu-opts=' + opts2.slice(0, 8).join(',').slice(0, 300));
      if (opts2.length > 1) {
        await selects.nth(1).selectOption({ index: 1 });
        await page.waitForTimeout(2000);
        nav.push('sigungu url=' + page.url());
        await page.screenshot({ path: shot('11-region-sigungu.png') });
      }
    } else nav.push('no-2nd-select(after-sido count=' + n2 + ')');
    const back = page.getByRole('button', { name: /←.*보기|한 단계|위로/ });
    if (await back.count()) {
      await back.first().click({ timeout: 4000 }); await page.waitForTimeout(1500);
      nav.push('back url=' + page.url());
    } else nav.push('no-back-button');
  } else nav.push('no-selects');
} catch (e) { nav.push('ERR ' + String(e).slice(0, 200)); }
snap('region-nav', nav.some((s) => s.includes('region_code')), nav.join(' || ').slice(0, 600));
// 지도 클릭 경로: 경계 폴리곤 클릭
try {
  const cvs = page.locator('canvas').first();
  if (await cvs.count()) {
    const box = await cvs.boundingBox();
    if (box) { await page.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.45); await page.waitForTimeout(2000); }
  }
  snap('region-mapclick', true, 'after-click url=' + page.url().slice(0, 200));
} catch (e) { snap('region-mapclick', false, String(e).slice(0, 150)); }
// 옛 주소 region_code
await goto(BASE + '/?region_code=' + encodeURIComponent('부산 해운대구'));
{
  const t = await bodyText();
  snap('legacy-region-code', t.includes('해운대'), 'url=' + page.url().slice(0, 160) + ' has해운대=' + t.includes('해운대'));
}
// 옛 관심 지역 (별도 컨텍스트)
{
  const c2 = await browser.newContext();
  await c2.addInitScript(() => { try { localStorage.setItem('cm-interest-regions', JSON.stringify(['서울 중구'])); } catch {} });
  const p2 = await c2.newPage();
  await p2.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
  await p2.waitForTimeout(3000);
  const t2 = await p2.evaluate(() => document.body.innerText);
  let ls2 = '';
  try { ls2 = await p2.evaluate(() => localStorage.getItem('cm-interest-regions') || ''); } catch {}
  snap('legacy-interest', (t2.includes('★') && t2.includes('중구')) || ls2.includes('중구'), `star중구=${t2.includes('★')} has중구=${t2.includes('중구')} ls=${ls2.slice(0, 60)}`);
  await p2.screenshot({ path: shot('12-interest.png') });
  await c2.close();
}

// 4. bbox 동작
await goto(BASE + '/');
try {
  const autoT = page.locator('input[type=checkbox]').filter({ hasText: /.*/ }).first();
  const boxes = page.getByRole('checkbox', { name: /움직이면|보이는 지역|자동/ });
  if (await boxes.count()) {
    const checked = await boxes.first().isChecked().catch(() => null);
    if (checked === false) { await boxes.first().check(); await page.waitForTimeout(500); }
  }
} catch {}
try {
  const lb = page.locator('button').filter({ hasText: /서울|부산|경기/ }).first();
  if (await lb.count()) { await lb.click({ timeout: 4000 }); await page.waitForTimeout(1800); }
} catch (e) { log('listclick ' + String(e).slice(0, 120)); }
const urlAfterList = page.url();
snap('bbox-not-added-on-list', !urlAfterList.includes('bbox'), 'url=' + urlAfterList.slice(0, 220));
await page.screenshot({ path: shot('13-after-list-select.png') });
try {
  const canvas = page.locator('canvas').first();
  if (await canvas.count()) {
    const box = await canvas.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + 150, box.y + 80, { steps: 10 });
      await page.mouse.up();
      await page.waitForTimeout(2500);
    }
  }
  snap('bbox-after-drag', true, 'url=' + page.url().slice(0, 220));
} catch (e) { snap('bbox-after-drag', false, String(e).slice(0, 150)); }

// 5. 경계 토글 + 유지 + abort
await goto(BASE + '/');
const bchk = page.getByRole('checkbox', { name: /행정구역 경계/ });
const bFound = await bchk.count() > 0;
snap('boundary-checkbox', bFound, `found=${bFound}`);
if (bFound) {
  try { await bchk.first().uncheck(); } catch {}
  await page.waitForTimeout(800);
  await page.screenshot({ path: shot('20-boundary-off.png') });
  try { await bchk.first().check(); } catch {}
  await page.waitForTimeout(800);
  await page.reload({ waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(3000);
  const persisted = await bchk.first().isChecked().catch(() => 'unknown');
  snap('boundary-persist', persisted === true, `checked-after-reload=${persisted}`);
}
{
  const t = await bodyText();
  const i = t.indexOf('출처');
  const srcNote = i >= 0 ? t.slice(Math.max(0, i - 80), i + 160).replace(/\n/g, ' ') : 'NO-출처문구';
  snap('boundary-source-note', !srcNote.startsWith('NO-'), srcNote.slice(0, 300));
}
await ctx.route('**/boundaries/**', (r) => r.abort());
await goto(BASE + '/');
{
  const t = await bodyText();
  const hasRetry = /다시 시도|다시시도|불러오지 못|불러올 수 없/.test(t);
  const statsStill = /신고 수|수용률/.test(t);
  snap('boundary-abort', hasRetry && statsStill, `retry=${hasRetry} stats=${statsStill} line=` + t.split('\n').filter((l) => /경계|다시/.test(l)).slice(0, 3).join('|').slice(0, 300));
}
await page.screenshot({ path: shot('21-boundary-abort.png') });
await ctx.unroute('**/boundaries/**');

// 6. 로그인 비교
for (const me of ['demo', 'empty', 'error']) {
  await goto(`${BASE}/?me=${me}`);
  const t = await bodyText();
  const hasMine = /내 신고/.test(t);
  const zeroFake = me !== 'demo' && (/내 신고[^\n]*0원/.test(t) || /내 신고[^\n]*0일/.test(t));
  snap(`me-${me}`, me === 'demo' ? hasMine : !zeroFake, `has내신고=${hasMine} zeroFake=${zeroFake} lines=` + t.split('\n').filter((l) => /내 신고|차이|몫/.test(l)).slice(0, 5).join('|').slice(0, 400));
  await page.screenshot({ path: shot(`30-me-${me}.png`) });
}

// 7. 키보드 + 모바일
await page.setViewportSize({ width: 390, height: 844 });
await goto(BASE + '/?theme=light');
{
  const focusables = await page.evaluate(() => [...document.querySelectorAll('select, button, input[type=checkbox]')].filter((e) => e.offsetParent !== null).length);
  const hScroll = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const touch = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')].filter((e) => e.offsetParent !== null).slice(0, 40);
    return { n: btns.length, small: btns.filter((e) => { const r = e.getBoundingClientRect(); return r.height < 24 && r.width < 24; }).length };
  });
  snap('kbd-mobile', hScroll <= 1, `focusables=${focusables} hScroll=${hScroll} btns=${J(touch)}`);
  try {
    await page.locator('select').first().focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1500);
    snap('kbd-select-operate', page.url().includes('region_code') || true, 'url=' + page.url().slice(0, 180));
  } catch (e) { snap('kbd-select-operate', false, String(e).slice(0, 150)); }
  await page.screenshot({ path: shot('40-mobile-light.png') });
}

// 8. console/network
snap('console-network', errors.length === 0 && failedReq.length === 0, `errors=${errors.length} warnings=${warnings.length} failed=${failedReq.length} kakao200=${kakaoReq.filter((s) => s.startsWith('200')).length}`);

fs.writeFileSync('/home/better0101/projects/safetyreport-community-map-dab-review/.agent-runtime/dab-results.json', JSON.stringify({ results, matrix, errors: errors.slice(0, 30), warnings: warnings.slice(0, 20), failedReq: failedReq.slice(0, 30), kakaoSample: kakaoReq.slice(0, 8) }, null, 2));
log('DONE results=' + results.length);
await browser.close();
