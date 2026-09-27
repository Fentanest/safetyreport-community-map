import { chromium } from '/home/better0101/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

const BASE = 'http://safemap.worklazy.net';
const OUT = '/home/better0101/projects/safetyreport-community-map-dab-review/docs/reviews/screenshots/dab-review';
const RT = '/home/better0101/projects/safetyreport-community-map-dab-review/.agent-runtime';
const shot = (n) => path.join(OUT, n);
const results = [];
const log = (m) => console.log('[dab4]', m);

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
function snap(name, pass, note) { results.push({ name, pass, note }); log(`${pass ? 'PASS' : 'FAIL'} ${name} :: ${String(note).slice(0, 260)}`); }
const bodyText = () => page.evaluate(() => document.body.innerText);
async function openFilter() {
  const fd = page.getByRole('button', { name: /상세 필터/ });
  if (await fd.count()) { await fd.first().click({ timeout: 4000 }); await page.waitForTimeout(1200); }
}
async function apply() {
  try { const ap = page.getByRole('button', { name: '적용' }); if (await ap.count()) { await ap.first().click({ timeout: 3000 }); await page.waitForTimeout(1500); } } catch {}
}

await page.setViewportSize({ width: 1920, height: 1080 });

// F1. 시도→시군구 풀 플로우 (drawer reopen 사이)
await goto(BASE + '/?theme=dark');
try {
  await openFilter();
  const sido = page.locator('select').nth(1);
  const opts = await sido.locator('option').allTextContents();
  await sido.selectOption({ index: opts.findIndex((t) => t.includes('부산')) });
  await page.waitForTimeout(1000);
  await apply();
  await openFilter();
  const sgg = page.locator('select').nth(2);
  const sopts = await sgg.locator('option').allTextContents().catch(() => []);
  fs.writeFileSync(RT + '/dab-sgg-opts.txt', sopts.join('\n'));
  const hi = sopts.findIndex((t) => t.includes('해운대'));
  snap('sgg-opts2', hi > 0, `n=${sopts.length} sample=${sopts.slice(0, 8).join(',').slice(0, 250)}`);
  if (hi > 0) {
    await sgg.selectOption({ index: hi });
    await page.waitForTimeout(1000);
    await apply();
    const u2 = page.url();
    const t2 = await bodyText();
    snap('sgg-pick2', /region_code=26\d{3}/.test(u2), `url=${u2.slice(0, 180)} has해운대=${t2.includes('해운대')}`);
    await page.screenshot({ path: shot('61-sgg-haeundae.png') });
    await openFilter();
    await page.locator('select').nth(2).selectOption({ index: 0 });
    await page.waitForTimeout(800);
    await apply();
    snap('sgg-up2', page.url().includes('region_code=26') && !/region_code=26\d{3}/.test(page.url()), 'url=' + page.url().slice(0, 170));
    await openFilter();
    await page.locator('select').nth(1).selectOption({ index: 0 });
    await page.waitForTimeout(800);
    await apply();
    snap('sido-up-nation2', !page.url().includes('region_code'), 'url=' + page.url().slice(0, 170));
  }
} catch (e) { snap('sgg-pick2', false, String(e).slice(0, 200)); }

// F2. ?me=signed 비교 토글 찾기
await goto(BASE + '/?me=signed&theme=dark');
{
  const ctrls = await page.evaluate(() => ({
    checks: [...document.querySelectorAll('input[type=checkbox]')].map((e) => (e.getAttribute('aria-label') || e.name || e.id || (e.closest('label')?.innerText || '').trim().slice(0, 50))).slice(0, 300),
    btns: [...document.querySelectorAll('button')].map((e) => (e.innerText || '').trim()).filter((t) => /비교|내 신고/.test(t)).slice(0, 10),
  }));
  fs.writeFileSync(RT + '/dab-signed-controls.json', JSON.stringify(ctrls, null, 2));
  snap('signed-controls', true, JSON.stringify(ctrls).slice(0, 400));
  // try toggling whatever compare control exists
  let toggled = 'none-found';
  try {
    const c = page.getByRole('checkbox', { name: /비교/ });
    if (await c.count()) { await c.first().check(); await page.waitForTimeout(2000); toggled = 'checkbox-checked'; }
    else {
      const b = page.getByRole('button', { name: /내 신고와 비교|비교/ });
      if (await b.count()) { await b.first().click({ timeout: 3000 }); await page.waitForTimeout(2000); toggled = 'button-clicked'; }
    }
  } catch (e) { toggled = 'ERR ' + String(e).slice(0, 100); }
  const t = await bodyText();
  fs.writeFileSync(RT + '/dab-me-signed-on.txt', t.split('\n').filter((l) => /내 신고|차이|몫|과태료|답변까지/.test(l)).join('\n').slice(0, 3000));
  snap('signed-compare', /내 신고 \d+건|일수 차이|평균 차이|몫/.test(t), `${toggled} lines=` + t.split('\n').filter((l) => /내 신고|차이|몫/.test(l)).slice(0, 6).join('|').slice(0, 400));
  await page.screenshot({ path: shot('62-me-signed.png') });
}

fs.writeFileSync(RT + '/dab-results4.json', JSON.stringify({ results }, null, 2));
log('DONE4 results=' + results.length);
await browser.close();
