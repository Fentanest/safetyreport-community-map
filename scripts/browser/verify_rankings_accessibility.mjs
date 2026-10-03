// LOCAL synthetic session only; never writes credentials to artifacts.
import { chromium } from './harness.mjs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const base = 'http://127.0.0.1:5192';
const out = process.argv[2] || 'docs/implementation/user-rankings/evidence/accessibility';
mkdirSync(out, { recursive: true });
const { session } = await (await fetch(`${base}/__rankings/session`)).json();
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const checks = [];
const luminance = (rgb) => rgb.map(x => x / 255).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4).reduce((s, x, i) => s + x * [.2126,.7152,.0722][i], 0);
const contrast = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x,y)+.05)/(Math.min(x,y)+.05); };
try {
  for (const theme of ['light','dark']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addInitScript(({ session, theme }) => { localStorage.setItem('cm-map-auth-v1', JSON.stringify(session)); localStorage.setItem('cm-theme', theme); }, { session, theme });
    await context.route('https://dapi.kakao.com/**',r=>r.fulfill({contentType:'text/javascript',body:readFileSync(new URL('./mock-kakao-sdk.js',import.meta.url),'utf8')}));
    const page = await context.newPage();
    await page.goto(`${base}/?screen=rankings`);
    await page.locator('.rk-page .rk-list li').first().waitFor();
    const colors = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      const keys = ['--text','--text-secondary','--muted','--link','--surface','--bg','--brand'];
      return Object.fromEntries(keys.map(k => {
        const e=document.createElement('span');e.style.color=cs.getPropertyValue(k);document.body.append(e);
        const rgb=getComputedStyle(e).color.match(/[\d.]+/g).slice(0,3).map(Number);e.remove();return [k,rgb];
      }));
    });
    const ratios = Object.fromEntries(['--text','--text-secondary','--muted','--link'].map(k => [k, Math.min(contrast(colors[k],colors['--surface']),contrast(colors[k],colors['--bg']))]));
    ratios.white_on_brand = contrast([255,255,255],colors['--brand']);
    for (const [name, ratio] of Object.entries(ratios)) assert.ok(ratio >= 4.5, `${theme} ${name} contrast ${ratio}`);
    checks.push({ theme, check:'text token contrast against page/panel, white on selected control', ratios, status:'PASS' });
    // Double actual computed px sizes, including px-based text: root font-size alone does not test these.
    const fontSizes = await page.evaluate(() => {
      const els = [document.body, ...document.body.querySelectorAll('*')];
      const sizes = els.map(e => [e, parseFloat(getComputedStyle(e).fontSize)]);
      for (const [e, size] of sizes) e.style.fontSize = `${size * 2}px`;
      return { normal: sizes.find(([e]) => e.classList.contains('rk-sub'))?.[1], actual: parseFloat(getComputedStyle(document.querySelector('.rk-sub')).fontSize) };
    });
    assert.equal(fontSizes.actual, fontSizes.normal * 2);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${theme} doubled text overflows page`);
    await page.locator('.rk-tabs button').first().focus();
    const focused = await page.evaluate(() => ({ button:document.activeElement.closest('.rk-tabs') !== null, outline:getComputedStyle(document.activeElement).outlineWidth }));
    assert.ok(focused.button && parseFloat(focused.outline) >= 2);
    await page.screenshot({ path:`${out}/390-${theme}-200pct-text.png`, fullPage:true });
    checks.push({ theme, check:'200% actual computed text sizes / page width / visible focus', fontSizes, focused, status:'PASS' });
    await context.close();
  }
  for (const theme of ['light','dark']) {
    const context = await browser.newContext({ viewport:{ width:390,height:844 } });
    await context.addInitScript(t => localStorage.setItem('cm-theme',t), theme);
    await context.route('https://dapi.kakao.com/**',r=>r.fulfill({contentType:'text/javascript',body:readFileSync(new URL('./mock-kakao-sdk.js',import.meta.url),'utf8')}));
    const page = await context.newPage();
    await page.goto(`${base}/?screen=rankings`);
    await page.getByRole('button',{name:'카카오로 로그인'}).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), theme);
    assert.equal(await page.locator('.rk-page table').count(), 0);
    await page.screenshot({path:`${out}/390-${theme}-anonymous-gate.png`,fullPage:true});
    checks.push({theme,check:'anonymous stored theme and no protected table',status:'PASS'});
    await context.close();
  }
  const context = await browser.newContext({viewport:{width:1440,height:900}});
  await context.addInitScript(s => {
    if (!localStorage.getItem('rk-test-seeded')) {
      localStorage.setItem('cm-map-auth-v1',JSON.stringify(s));
      localStorage.setItem('rk-test-seeded','1');
      localStorage.setItem('cm-theme','light');
    }
  },session);
  await context.route('https://dapi.kakao.com/**',r=>r.fulfill({contentType:'text/javascript',body:readFileSync(new URL('./mock-kakao-sdk.js',import.meta.url),'utf8')}));
  const page=await context.newPage();
  await page.goto(`${base}/?screen=rankings`);
  await page.locator('.rk-page table').waitFor();
  // Build an actual same-origin history entry before logout; about:blank is not application history.
  await page.locator('.rail').getByRole('button',{name:'지도',exact:true}).click();
  await page.locator('.rail').getByRole('button',{name:'유저 랭킹',exact:true}).click();
  await page.locator('.rk-page table').waitFor();
  await page.getByRole('button',{name:/^ID /}).click();
  await page.getByRole('menuitem',{name:'로그아웃'}).click();
  await page.getByRole('button',{name:'카카오로 로그인'}).waitFor();
  assert.equal(await page.evaluate(()=>localStorage.getItem('cm-map-auth-v1')),null);
  await page.goBack();
  await page.getByRole('button',{name:'카카오로 로그인'}).waitFor();
  assert.equal(new URL(page.url()).origin,base);
  assert.equal(await page.locator('.rk-page table').count(),0);
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'light');
  assert.ok((await page.locator('body').innerText()).length>100);
  await page.screenshot({path:`${out}/logout-real-app-history.png`,fullPage:true});
  checks.push({check:'real account logout + same-origin history back stays gate/light, no JWT/table',url:page.url(),status:'PASS'});
  await context.close();
  writeFileSync(`${out}/result.json`, JSON.stringify({ browser:browser.version(), fixture:'local synthetic JWT/RPC; computed text enlargement, not operating-system accessibility settings', checks }, null, 2)+'\n');
  console.log(`${checks.length} accessibility checks PASS`);
} finally { await browser.close(); }
