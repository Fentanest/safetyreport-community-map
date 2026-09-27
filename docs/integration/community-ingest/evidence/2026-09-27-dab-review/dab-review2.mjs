import { chromium } from '/home/better0101/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

const BASE = 'http://safemap.worklazy.net';
const OUT = '/home/better0101/projects/safetyreport-community-map-dab-review/docs/reviews/screenshots/dab-review';
const RT = '/home/better0101/projects/safetyreport-community-map-dab-review/.agent-runtime';
const shot = (n) => path.join(OUT, n);
const results = [];
const log = (m) => console.log('[dab2]', m);

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  args: ['--host-resolver-rules=MAP safemap.worklazy.net 127.0.0.1:4176', '--no-sandbox', '--disable-dev-shm-usage'],
});
const errors = [], failedReq = [];
const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
ctx.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
ctx.on('response', (r) => {
  const u = r.url();
  if (r.status() >= 400 && !/tile|kakao|daum/i.test(u)) failedReq.push(`${r.status()} ${u.slice(0, 160)}`);
});
const page = await ctx.newPage();
async function goto(url) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(3500);
}
function snap(name, pass, note) { results.push({ name, pass, note }); log(`${pass ? 'PASS' : 'FAIL'} ${name} :: ${String(note).slice(0, 240)}`); }
const bodyText = () => page.evaluate(() => document.body.innerText);

// R1. 상세 필터 → 시도/시군구 select
await page.setViewportSize({ width: 1920, height: 1080 });
await goto(BASE + '/?theme=dark');
try {
  const fd = page.getByRole('button', { name: /상세 필터/ });
  if (await fd.count()) { await fd.first().click({ timeout: 4000 }); await page.waitForTimeout(1200); }
  const nsel = await page.locator('select').count();
  const labels = await page.evaluate(() => [...document.querySelectorAll('select')].map((s) => ((s.closest('label')?.innerText || '?').split('\n')[0]).slice(0, 60)).join('|'));
  snap('filter-selects', nsel >= 2, `selects=${nsel} labels=${labels.slice(0, 120)}`);
  await page.screenshot({ path: shot('50-filter-drawer.png') });
  if (nsel >= 2) {
    const sido = page.locator('select').first();
    const sidoOpts = await sido.locator('option').allTextContents();
    const busanIdx = sidoOpts.findIndex((t) => t.includes('부산'));
    await sido.selectOption({ index: busanIdx });
    await page.waitForTimeout(1500);
    // apply? check for 적용 button
    const apply = page.getByRole('button', { name: /적용|보기|확인/ });
    let applyNames = '';
    try { applyNames = (await apply.allTextContents()).join('|').slice(0, 120); } catch {}
    // try clicking 적용 if exists inside drawer
    try {
      const ap = page.getByRole('button', { name: '적용' });
      if (await ap.count()) { await ap.first().click({ timeout: 3000 }); await page.waitForTimeout(1500); }
    } catch {}
    const u1 = page.url();
    const t1 = await bodyText();
    snap('filter-sido', u1.includes('region_code=26'), `url=${u1.slice(0, 160)} chip=${t1.split('\n').filter((l) => /부산|전국/.test(l)).slice(0, 3).join('|').slice(0, 200)} applyBtns=${applyNames}`);
    await page.screenshot({ path: shot('51-filter-busan.png') });
    // 시군구 select should now list 부산 districts
    const sgg = page.locator('select').nth(1);
    const sggOpts = await sgg.locator('option').allTextContents().catch(() => []);
    snap('filter-sgg-opts', sggOpts.some((t) => t.includes('해운대')), `opts=${sggOpts.slice(0, 10).join(',').slice(0, 300)}`);
    const haeIdx = sggOpts.findIndex((t) => t.includes('해운대'));
    if (haeIdx > 0) {
      await sgg.selectOption({ index: haeIdx });
      await page.waitForTimeout(1200);
      try { const ap = page.getByRole('button', { name: '적용' }); if (await ap.count()) { await ap.first().click({ timeout: 3000 }); await page.waitForTimeout(1500); } } catch {}
      const u2 = page.url();
      snap('filter-sgg', /region_code=26\d{3}/.test(u2) || u2.includes('해운대'), `url=${u2.slice(0, 180)}`);
      await page.screenshot({ path: shot('52-filter-haeundae.png') });
      // 한 단계 위: 시도 전체
      await sgg.selectOption({ index: 0 });
      await page.waitForTimeout(1200);
      try { const ap = page.getByRole('button', { name: '적용' }); if (await ap.count()) { await ap.first().click({ timeout: 3000 }); await page.waitForTimeout(1500); } } catch {}
      snap('filter-up', page.url().includes('region_code=26') && !/region_code=26\d/.test(page.url()), 'url=' + page.url().slice(0, 180));
    }
  }
} catch (e) { snap('filter-selects', false, String(e).slice(0, 200)); }

// R2. 지역 목록 경로 + bbox
await goto(BASE + '/?theme=dark');
try {
  const tab = page.getByRole('button', { name: '지역' });
  // there may be several; click the tab one — just ensure region list visible
  const rows = await page.locator('button.region-pick').count();
  snap('region-list', rows > 5, `region-pick buttons=${rows}`);
  if (rows > 0) {
    const names = await page.locator('button.region-pick').allTextContents();
    fs.writeFileSync(RT + '/dab-region-rows.txt', names.join('\n').slice(0, 3000));
    const seoulIdx = names.findIndex((t) => /서울|부산|경기/.test(t));
    // ensure auto-refresh checkbox ON
    const auto = page.getByRole('checkbox', { name: /움직이면/ });
    if (await auto.count()) { if (!(await auto.first().isChecked().catch(() => true))) await auto.first().check().catch(() => {}); }
    const before = page.url();
    await page.locator('button.region-pick').nth(seoulIdx).click({ timeout: 4000 });
    await page.waitForTimeout(2000);
    const after = page.url();
    const addedBbox = after.includes('bbox') && !before.includes('bbox');
    snap('region-list-pick', after.includes('region_code'), `picked=${names[seoulIdx].slice(0, 60).replace(/\n/g, '|')} bboxAdded=${addedBbox} url=${after.slice(0, 200)}`);
    await page.screenshot({ path: shot('53-region-picked.png') });
    // 시군구 rows now?
    const rows2 = await page.locator('button.region-pick').count();
    const names2 = await page.locator('button.region-pick').allTextContents();
    snap('region-sgg-list', rows2 > 0, `rows=${rows2} sample=${names2.slice(0, 3).join('|').slice(0, 250).replace(/\n/g, ' ')}`);
    // 한 단계 위: 같은 버튼 다시 누르면 parent
    await page.locator('button.region-pick').nth(seoulIdx >= rows2 ? 0 : seoulIdx).click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(1500);
  }
} catch (e) { snap('region-list', false, String(e).slice(0, 200)); }
// 지역 미확인 행
{
  const t = await bodyText();
  snap('region-unknown', t.includes('지역 미확인') || t.includes('미확인'), 'has=' + (t.includes('미확인')));
}

// R3. 경계 hover 카드
await goto(BASE + '/');
try {
  const canvas = page.locator('canvas').first();
  if (await canvas.count()) {
    const box = await canvas.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.4, { steps: 6 });
      await page.waitForTimeout(1200);
      const hov = await page.evaluate(() => document.body.innerText.slice(0, 3000));
      await page.screenshot({ path: shot('54-hover.png') });
      snap('boundary-hover', true, 'hovered-center; card-check-manual screenshot 54-hover.png');
    }
  }
} catch (e) { snap('boundary-hover', false, String(e).slice(0, 150)); }
// 출처 문구 (정확한 워딩)
{
  const t = await bodyText();
  const hasAttr = t.includes('국가데이터처') || t.includes('행정구역 경계:');
  const i = t.indexOf('행정구역 경계:');
  snap('boundary-source-note2', hasAttr, i >= 0 ? t.slice(i, i + 180).replace(/\n/g, ' ') : 'NOT-FOUND snippet=' + t.split('\n').filter((l) => /SGIS|공공누리|통계지리/.test(l)).slice(0, 2).join('|').slice(0, 200));
}

// R4. 로그인 비교 (올바른 fixture 값)
for (const me of ['signed', 'empty', 'error']) {
  await goto(`${BASE}/?me=${me}&theme=dark`);
  const t = await bodyText();
  const mine = t.split('\n').filter((l) => /내 신고|차이|몫|평균 차이/.test(l)).slice(0, 10).join('|').slice(0, 700);
  const zeroFake = me !== 'signed' && (/내 신고[^\n]*0원/.test(t) || /내 신고[^\n]*0일/.test(t));
  fs.writeFileSync(`${RT}/dab-me-${me}.txt`, t.split('\n').filter((l) => /내 신고|차이|몫|과태료|답변까지/.test(l)).join('\n').slice(0, 2500));
  snap(`me2-${me}`, me === 'signed' ? /내 신고/.test(t) && /차이|몫/.test(t) : !zeroFake, `zeroFake=${zeroFake} ` + mine.slice(0, 300));
  await page.screenshot({ path: shot(`55-me-${me}.png`) });
  // 비교 켜기: 내 신고와 비교 checkbox
  if (me === 'signed') {
    try {
      const cmp = page.getByRole('checkbox', { name: /내 신고와 비교/ });
      if (await cmp.count()) { await cmp.first().check(); await page.waitForTimeout(1500); }
      const t2 = await bodyText();
      fs.writeFileSync(`${RT}/dab-me-signed-compared.txt`, t2.split('\n').filter((l) => /내 신고|차이|몫|과태료|답변까지/.test(l)).join('\n').slice(0, 3000));
      await page.screenshot({ path: shot('56-me-signed-compared.png') });
    } catch (e) { log('compare-toggle ' + String(e).slice(0, 120)); }
  }
}

// R5. 0원 문맥
await goto(BASE + '/');
{
  const t = await bodyText();
  const zlines = t.split('\n').filter((l) => l.includes('0원')).slice(0, 16);
  fs.writeFileSync(RT + '/dab-zero-won.txt', zlines.join('\n'));
  snap('zero-won-context', true, `count=${zlines.length} sample=` + zlines.slice(0, 4).join('|').slice(0, 400));
}

// R6. 깨끗한 로드의 console (abort 없이)
snap('console-clean', errors.length === 0 && failedReq.length === 0, `errors=${errors.length} failed=${failedReq.length} e=${errors.slice(0, 2).join(';').slice(0, 200)} f=${failedReq.slice(0, 2).join(';').slice(0, 200)}`);

// R7. 키보드: 필터 select + 경계 체크박스 + ← 보기 버튼
await goto(BASE + '/?theme=dark');
try {
  const fd = page.getByRole('button', { name: /상세 필터/ });
  if (await fd.count()) { await fd.first().click({ timeout: 4000 }); await page.waitForTimeout(1000); }
  const sel = page.locator('select').first();
  let ok = false;
  if (await sel.count()) {
    await sel.focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1000);
    ok = true;
  }
  const bchk = page.getByRole('checkbox', { name: /행정구역 경계/ });
  if (await bchk.count()) { await bchk.first().focus(); await page.keyboard.press('Space'); await page.waitForTimeout(600); await page.keyboard.press('Space'); await page.waitForTimeout(600); }
  snap('kbd-real', ok, `select-operated=${ok} boundary-focused-toggled=${await bchk.count() > 0}`);
} catch (e) { snap('kbd-real', false, String(e).slice(0, 180)); }

fs.writeFileSync(RT + '/dab-results2.json', JSON.stringify({ results, errors: errors.slice(0, 20), failedReq: failedReq.slice(0, 20) }, null, 2));
log('DONE2 results=' + results.length);
await browser.close();
