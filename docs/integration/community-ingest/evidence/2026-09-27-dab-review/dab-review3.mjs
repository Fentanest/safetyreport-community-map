import { chromium } from '/home/better0101/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

const BASE = 'http://safemap.worklazy.net';
const OUT = '/home/better0101/projects/safetyreport-community-map-dab-review/docs/reviews/screenshots/dab-review';
const RT = '/home/better0101/projects/safetyreport-community-map-dab-review/.agent-runtime';
const shot = (n) => path.join(OUT, n);
const results = [];
const log = (m) => console.log('[dab3]', m);

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  args: ['--host-resolver-rules=MAP safemap.worklazy.net 127.0.0.1:4176', '--no-sandbox', '--disable-dev-shm-usage'],
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
const page = await ctx.newPage();
async function goto(url) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(3500);
}
function snap(name, pass, note) { results.push({ name, pass, note }); log(`${pass ? 'PASS' : 'FAIL'} ${name} :: ${String(note).slice(0, 240)}`); }
const bodyText = () => page.evaluate(() => document.body.innerText);

await page.setViewportSize({ width: 1920, height: 1080 });

// S1. 시도 select (두 번째 select) → 부산
await goto(BASE + '/?theme=dark');
try {
  const fd = page.getByRole('button', { name: /상세 필터/ });
  if (await fd.count()) { await fd.first().click({ timeout: 4000 }); await page.waitForTimeout(1200); }
  const sido = page.locator('select').nth(1);
  const opts = await sido.locator('option').allTextContents();
  snap('sido-opts', opts.some((t) => t.includes('부산')) && opts.some((t) => t.includes('광주') || t.includes('전남')), `n=${opts.length} sample=${opts.slice(0, 6).join(',').slice(0, 200)}`);
  fs.writeFileSync(RT + '/dab-sido-opts.txt', opts.join('\n'));
  const bi = opts.findIndex((t) => t.includes('부산'));
  await sido.selectOption({ index: bi });
  await page.waitForTimeout(1200);
  try { const ap = page.getByRole('button', { name: '적용' }); if (await ap.count()) { await ap.first().click({ timeout: 3000 }); await page.waitForTimeout(1500); } } catch {}
  const u1 = page.url();
  const t1 = await bodyText();
  const unitLine = t1.split('\n').filter((l) => /행정구역 경계 보기/.test(l)).join('|').slice(0, 120);
  snap('sido-pick', u1.includes('region_code=26'), `url=${u1.slice(0, 170)} boundaryUnit=${unitLine}`);
  await page.screenshot({ path: shot('60-sido-busan.png') });
  // S2. 시군구 select → 해운대
  const sgg = page.locator('select').nth(2);
  const sopts = await sgg.locator('option').allTextContents().catch(() => []);
  fs.writeFileSync(RT + '/dab-sgg-opts.txt', sopts.join('\n'));
  const hi = sopts.findIndex((t) => t.includes('해운대'));
  snap('sgg-opts', hi > 0, `n=${sopts.length} sample=${sopts.slice(0, 8).join(',').slice(0, 250)}`);
  if (hi > 0) {
    await sgg.selectOption({ index: hi });
    await page.waitForTimeout(1200);
    try { const ap = page.getByRole('button', { name: '적용' }); if (await ap.count()) { await ap.first().click({ timeout: 3000 }); await page.waitForTimeout(1500); } } catch {}
    const u2 = page.url();
    const t2 = await bodyText();
    snap('sgg-pick', /region_code=26\d{3}/.test(u2), `url=${u2.slice(0, 180)} has해운대=${t2.includes('해운대')}`);
    await page.screenshot({ path: shot('61-sgg-haeundae.png') });
    // S3. 한 단계 위 (시도 전체) → 전국
    await sgg.selectOption({ index: 0 });
    await page.waitForTimeout(1000);
    try { const ap = page.getByRole('button', { name: '적용' }); if (await ap.count()) { await ap.first().click({ timeout: 3000 }); await page.waitForTimeout(1500); } } catch {}
    const u3 = page.url();
    snap('sgg-up', u3.includes('region_code=26') && !/region_code=26\d{3}/.test(u3), 'url=' + u3.slice(0, 170));
    await sido.selectOption({ index: 0 });
    await page.waitForTimeout(1000);
    try { const ap = page.getByRole('button', { name: '적용' }); if (await ap.count()) { await ap.first().click({ timeout: 3000 }); await page.waitForTimeout(1500); } } catch {}
    snap('sido-up-nation', !page.url().includes('region_code'), 'url=' + page.url().slice(0, 170));
  }
} catch (e) { snap('sido-pick', false, String(e).slice(0, 200)); }

// S4. me=signed 상태 진단
await goto(BASE + '/?me=signed&theme=dark');
{
  const urlKept = page.url().includes('me=signed');
  const acct = await page.evaluate(() => {
    const els = [...document.querySelectorAll('button, span')].filter((e) => /예시 사용자|로그인/.test(e.innerText || e.textContent || ''));
    return els.slice(0, 4).map((e) => e.tagName + ':' + (e.innerText || e.textContent || '').trim().slice(0, 40)).join('|');
  });
  const cmp = page.getByRole('checkbox', { name: /내 신고와 비교/ });
  const cmpState = await cmp.count() ? await cmp.first().isChecked().catch(() => 'unknown') : 'no-checkbox';
  if (await cmp.count()) { await cmp.first().check().catch(() => {}); await page.waitForTimeout(2000); }
  const t = await bodyText();
  const cmpLines = t.split('\n').filter((l) => /내 신고.*건|일수 차이|평균 차이|몫|차이/.test(l)).slice(0, 6).join('|').slice(0, 500);
  snap('me-signed-diag', /내 신고 \d+건/.test(t), `urlKeptMe=${urlKept} acct=${acct.slice(0, 150)} cmpChecked=${cmpState} lines=${cmpLines}`);
  await page.screenshot({ path: shot('62-me-signed.png') });
}
// S5. me=empty/error 새 행 0 표시 여부 (비교 켠 상태)
for (const me of ['empty', 'error']) {
  await goto(`${BASE}/?me=${me}&theme=dark`);
  try {
    const cmp = page.getByRole('checkbox', { name: /내 신고와 비교/ });
    if (await cmp.count()) { await cmp.first().check().catch(() => {}); await page.waitForTimeout(2000); }
  } catch {}
  const t = await bodyText();
  const zeroFake = /내 신고[^\n]*0원/.test(t) || /내 신고[^\n]*0일/.test(t) || /내 신고\s*0건/.test(t);
  const mineLines = t.split('\n').filter((l) => /내 신고/.test(l)).slice(0, 6).join('|').slice(0, 500);
  snap(`me-${me}-rows`, !zeroFake, `zeroFake=${zeroFake} lines=${mineLines}`);
  await page.screenshot({ path: shot(`63-me-${me}.png`) });
}

fs.writeFileSync(RT + '/dab-results3.json', JSON.stringify({ results }, null, 2));
log('DONE3 results=' + results.length);
await browser.close();
