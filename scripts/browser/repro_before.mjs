// Reproduction on the pre-change code (R03/R04/R10). Writes JSON evidence to argv[2].
import { writeFileSync } from 'node:fs';
import { chromium, openPage, waitMap, api, sleep, summarizeLog } from './harness.mjs';

const out = process.argv[2] || 'repro.json';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const evidence = {};
try {
  await api('reset');
  const { page, consoleErrors, navs } = await openPage(browser);
  await waitMap(page);
  await sleep(1500);
  const base = await page.evaluate(() => ({ maps: window.__kakaoStats.maps, idle: window.__kakaoStats.idle, skeletons: window.__skeletons }));
  const logBefore = await api('log');
  // R04: auto refresh on, 20 quick user pans
  await page.getByText('지도를 움직이면 통계도 바꾸기').click();
  await sleep(800);
  for (let i = 0; i < 20; i++) {
    await page.evaluate((i) => window.__kakaoMaps[window.__kakaoMaps.length - 1].__userPan(i % 2 ? 40 : -35, 12), i);
    await sleep(120);
  }
  await sleep(6000);
  const after = await page.evaluate(() => ({ maps: window.__kakaoStats.maps, idle: window.__kakaoStats.idle, skeletons: window.__skeletons,
    errorBanner: document.querySelector('.banner.error')?.textContent ?? null, scrollY: window.scrollY }));
  const log = await api('log');
  evidence.R04 = { baseline: base, initialRequests: summarizeLog(logBefore), afterPans: after,
    requestsDuringPans: summarizeLog(log.slice(logBefore.length)), statuses: log.slice(logBefore.length).map(e => `${e.route}:${e.status}`),
    documentNavigations: navs() };
  // R10: drawer date sequential typing
  await api('reset');
  await page.goto(page.url().split('?')[0]);
  await waitMap(page).catch(() => undefined);
  await sleep(1500);
  const opened = await page.getByRole('button', { name: /상세 필터/ }).click().then(() => true).catch((e) => String(e));
  await sleep(300);
  const dateInput = page.locator('.drawer input[type=date]').first();
  await dateInput.click();
  await page.keyboard.press('Home').catch(() => undefined);
  const steps = [];
  for (const key of ['2', '0', '2', '5', 'ArrowRight', '0', '3', 'ArrowRight', '1', '5']) {
    await page.keyboard.press(key);
    await sleep(80);
    steps.push(await page.evaluate((key) => ({ key, active: `${document.activeElement?.tagName}${document.activeElement?.getAttribute('type') ? `[${document.activeElement.getAttribute('type')}]` : ''}${document.activeElement?.getAttribute('aria-label') ? `(${document.activeElement.getAttribute('aria-label')})` : ''}`,
      value: document.querySelector('.drawer input[type=date]')?.value ?? null }), key));
  }
  evidence.R10 = { opened, steps, requestsWhileTyping: summarizeLog(await api('log')) };
  await page.keyboard.press('Escape');
  // R03: marker colors per metric
  await sleep(500);
  const metricRuns = {};
  for (const label of ['신고 수', '수용률', '일부수용률', '과태료']) {
    const btn = page.getByRole('button', { name: label, exact: true });
    if (!(await btn.count())) { metricRuns[label] = 'button missing'; continue; }
    await btn.first().click();
    await sleep(300);
    metricRuns[label] = await page.evaluate(() => window.__kakaoLiveMarkers().slice(0, 4).map(m => ({ title: m.title,
      fill: /fill="(rgba\([^"]+\))"/.exec(m.src)?.[1] ?? null, text: />([^<>]+)<\/text><\/svg>$/.exec(m.src)?.[1] ?? null })));
  }
  evidence.R03 = metricRuns;
  evidence.consoleErrors = consoleErrors.slice(0, 20);
} finally {
  writeFileSync(out, JSON.stringify(evidence, null, 2));
  await browser.close();
}
console.log(JSON.stringify(evidence, null, 2));
