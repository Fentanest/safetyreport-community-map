// F01 reproduction (LOCAL stack, MOCK SDK, synthetic data): 맞춤 통계 opens as an auto heatmap, then the type is
// switched straight to 막대 without going back to the table. Records whether the bar host got a live ECharts instance
// with series. Used for the before/after evidence of F01; the assertion run lives in verify_finalization.mjs.
//   node scripts/browser/repro_f01_chart_switch.mjs <out.json>
import { writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { chromium, openPage, api, sleep } from './harness.mjs';

const out = process.argv[2] || 'f01-repro.json';
const browser = await chromium.launch({ args: ['--lang=ko-KR'] });
const hosts = (page) => page.evaluate(() => [...document.querySelectorAll('.stats-result .stats-chart-host')].map((h) => ({
  hidden: h.hidden, instance: h.getAttribute('_echarts_instance_'), live: !!h.__chart && !h.__chart.isDisposed(),
  series: h.__chart && !h.__chart.isDisposed() ? (h.__chart.getOption().series || []).map((s) => `${s.type}:${s.id}:${(s.data || []).length}`) : [],
  canvas: !!h.querySelector('canvas'),
})));
const result = { commit: execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim(), dirty: execSync('git status --porcelain', { encoding: 'utf8' }).trim().length > 0, steps: [] };
try {
  await api('reset');
  const { page } = await openPage(browser, { search: '?screen=statistics', height: 1000 });
  await page.waitForSelector('.pivot-table tbody tr', { timeout: 20000 });
  await page.locator('.stats-result').getByRole('button', { name: '그래프', exact: true }).click();
  await sleep(1200);
  result.steps.push({ step: 'auto heatmap', hosts: await hosts(page) });
  await page.locator('.stats-result').getByLabel('유형').selectOption('bar');
  await sleep(1500);
  result.steps.push({ step: 'switched to 막대 (no table round trip)', hosts: await hosts(page) });
  await page.locator('.stats-result').getByLabel('유형').selectOption('heatmap');
  await sleep(1200);
  await page.locator('.stats-result').getByLabel('유형').selectOption('bar');
  await sleep(1500);
  result.steps.push({ step: '막대 → 히트맵 → 막대', hosts: await hosts(page) });
  const bar = result.steps[1].hosts[0];
  result.blank_bar_reproduced = !bar || !bar.live || bar.series.length === 0;
} finally {
  await browser.close();
}
writeFileSync(out, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 1));
