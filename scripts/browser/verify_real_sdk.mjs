// C04: map interaction check with the REAL Kakao Maps SDK and real input (mouse/wheel/keyboard) — no mock SDK and no
// __click/__blankClick helpers. Needs, from the environment (never committed):
//   REAL_SDK_BASE_URL   an origin registered for the JS key (e.g. the Pages domain or a registered localhost port)
//   (the app build at that origin must carry VITE_KAKAO_MAP_JS_KEY; the page itself loads https://dapi.kakao.com)
//   REAL_SDK_SESSION    optional JSON session for the map login (test account only, never a production user's)
// Without SDK access the run records BLOCKED with the reason and exits 2 — it never reports a pass.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, sleep } from './harness.mjs';
import { createRun, captureConsole, waitFor } from './assert.mjs';

const dir = process.argv[2] || 'evidence-real-sdk';
mkdirSync(join(dir, 'shots'), { recursive: true });
const base = process.env.REAL_SDK_BASE_URL || 'http://127.0.0.1:5190/';
const IDS = ['SDK-LOAD', 'SDK-SELECT', 'SDK-RECLICK', 'SDK-FAST-RECLICK', 'SDK-BLANK', 'SDK-DRAG', 'SDK-WHEEL', 'SDK-BUTTONS', 'SDK-CLUSTER', 'SDK-REGIONS', 'SDK-KEYBOARD'];
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args: ['--lang=ko-KR'] });
const run = createRun({ dir, suite: 'real-sdk', ids: IDS, meta: { browser: `chromium ${browser.version()}`, sdk: 'REAL (dapi.kakao.com)', base, data: process.env.REAL_SDK_DATA || 'unspecified' } });
const markers = (page) => page.locator('.map-sdk-host img[title], .map-sdk-host area[title]');
const selected = (page) => page.locator('.map-sdk-host [title*="(선택됨)"]').count();
const center = async (loc) => { const b = await loc.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };

try {
  const context = await browser.newContext({ locale: 'ko-KR', viewport: { width: 1440, height: 1000 } });
  if (process.env.REAL_SDK_SESSION) await context.addInitScript((s) => { try { localStorage.setItem('cm-map-auth-v1', s); } catch { /* ignore */ } }, process.env.REAL_SDK_SESSION);
  const page = await context.newPage();
  let loaded = false;
  // probe first: an unreachable SDK is an environment block (BLOCKED), not a product failure
  const sdk = page.waitForResponse((r) => r.url().startsWith('https://dapi.kakao.com/'), { timeout: 15000 }).then((r) => r.status()).catch(() => 'no-response');
  await page.goto(base);
  const sdkStatus = await sdk;
  loaded = await waitFor(() => page.evaluate(() => !!(window.kakao && window.kakao.maps && window.kakao.maps.Map)), (x) => x, { timeout: 15000 });
  run.record.environment.sdk_probe = sdkStatus;
  if (loaded) {
    await run.step('load', ['SDK-LOAD'], async ({ check }) => {
      check('SDK-LOAD', 'real kakao.maps loaded (not the mock)', await page.evaluate(() => !window.__kakaoStats), true);
    });
  }
  const rest = IDS.slice(1);
  if (!loaded) {
    run.block(IDS, 'real Kakao SDK not reachable here: the environment network policy refuses dapi.kakao.com (proxy CONNECT 403); a JS key with this origin registered is also required');
  } else {
    await run.step('interact', rest, async ({ check }) => {
      const map = page.locator('.map-sdk-host');
      const box = await map.boundingBox();
      // zoom into an area with pins using the real zoom buttons
      for (let i = 0; i < 6; i++) { await page.getByRole('button', { name: /확대/ }).first().click(); await sleep(250); }
      check('SDK-BUTTONS', 'zoom buttons change the level (pins appear)', await waitFor(() => markers(page).count(), (n) => n > 0, { timeout: 8000 }), (n) => n > 0);
      const pin = markers(page).first();
      const p = await center(pin);
      await page.mouse.click(p.x, p.y);
      check('SDK-SELECT', 'mouse click selects', await waitFor(() => selected(page), (n) => n === 1), 1);
      await page.mouse.click(p.x, p.y - 20);
      check('SDK-RECLICK', 're-click clears', await waitFor(() => selected(page), (n) => n === 0), 0);
      await page.mouse.click(p.x, p.y); await sleep(120); await page.mouse.click(p.x, p.y - 20);
      check('SDK-FAST-RECLICK', 'a fast re-click (≈120 ms) is not swallowed by the blank-click guard', await waitFor(() => selected(page), (n) => n === 0), 0);
      await page.mouse.click(p.x, p.y);
      await waitFor(() => selected(page), (n) => n === 1);
      await page.mouse.move(box.x + 40, box.y + box.height - 40); await page.mouse.down(); await page.mouse.move(box.x + 160, box.y + box.height - 60, { steps: 8 }); await page.mouse.up();
      check('SDK-DRAG', 'drag does not clear the selection', await selected(page), 1);
      await page.mouse.wheel(0, -300); await sleep(600);
      check('SDK-WHEEL', 'wheel zoom keeps the selection', await selected(page), 1);
      await sleep(700);
      await page.mouse.click(box.x + 30, box.y + 30);
      check('SDK-BLANK', 'real blank click clears', await waitFor(() => selected(page), (n) => n === 0), 0);
      for (let i = 0; i < 8; i++) { await page.getByRole('button', { name: /축소/ }).first().click(); await sleep(200); }
      const cluster = page.locator('.map-sdk-host [title*="묶음"]').first();
      if (await cluster.count()) {
        const before = await markers(page).count();
        const c = await center(cluster); await page.mouse.click(c.x, c.y); await sleep(1200);
        check('SDK-CLUSTER', 'cluster click zooms in', await markers(page).count(), (n) => n !== before);
      } else check('SDK-CLUSTER', 'a cluster is drawn at far zoom', 0, (n) => n > 0);
      await page.locator('.metric-switch').getByRole('button', { name: '수용률', exact: true }).click();
      check('SDK-REGIONS', 'rate map: no pin', await waitFor(() => markers(page).count(), (n) => n === 0), 0);
      await page.locator('.metric-switch').getByRole('button', { name: '신고 수', exact: true }).click();
      await page.keyboard.press('Escape');
      check('SDK-KEYBOARD', 'Esc with nothing selected keeps the page usable', await page.locator('.map-card').count(), 1);
      await page.screenshot({ path: join(dir, 'shots', 'real-sdk.png') });
    });
  }
  await context.close();
} finally {
  await browser.close();
  run.finish();
}
