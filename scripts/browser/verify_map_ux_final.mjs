// feat/map-ux 통합본(5개 화면 개선)의 실제 브라우저 확인. Synthetic demo only. No DB/Edge operations.
// VITE_DATA_MODE=demo npx vite --host 127.0.0.1 --port <빈 포트> --strictPort
// MAP_UX_ORIGIN=http://127.0.0.1:<포트> node scripts/browser/verify_map_ux_final.mjs
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
const { chromium } = await import('/home/better0101/projects/safetyreport/tools/web-tests/node_modules/playwright/index.mjs');
const origin = process.env.MAP_UX_ORIGIN || 'http://127.0.0.1:5293';
const out = process.env.MAP_UX_OUT || '.agent-runs/map-ux';
mkdirSync(out, { recursive: true });
const errors = [], failedRequests = [], checks = [];
const browser = await chromium.launch({ executablePath: '/home/better0101/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome', headless: true, args: ['--no-sandbox', '--lang=ko-KR'] });

function luminance(color) {
  // --surface is authored as the 3-digit shorthand (#fff) in src/styles/app.css; expand it first or
  // slice(1).match(/../g) silently drops the third channel and reports white as near-black (false 4.46:1 "fail").
  const hex = color.startsWith('#') && color.length === 4 ? `#${[...color.slice(1)].map((c) => c + c).join('')}` : color;
  const rgb = hex.startsWith('#') ? hex.slice(1).match(/../g).map((v) => parseInt(v, 16)) : hex.match(/[\d.]+/g).slice(0, 3).map(Number);
  return rgb.map((v) => v / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
}
function contrast(a, b) {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

try {
  for (const width of [1280, 390]) for (const theme of ['light', 'dark']) {
    const label = `${width}-${theme}`;
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce', colorScheme: theme });
    await context.addInitScript((t) => localStorage.setItem('cm-theme', t), theme);
    // Synthetic UI verification only; Kakao SDK integration is out of scope here.
    await context.route('https://dapi.kakao.com/**', (r) => r.fulfill({ contentType: 'text/javascript', body: '' }));
    const page = await context.newPage();
    page.on('console', (m) => { if (m.type() === 'error') errors.push({ label, message: m.text() }); });
    page.on('pageerror', (e) => errors.push({ label, message: e.message }));
    page.on('requestfailed', (r) => failedRequests.push({ label, url: r.url(), error: r.failure()?.errorText }));
    await page.goto(`${origin}/?me=signed`);
    const compare = page.getByRole('switch', { name: '내 신고와 비교', exact: true });
    await compare.check();

    // ── item 4: KPI 하단 줄(계도·확인 과태료 금액·평균 별점)에 내 값 병기 ──────────────────────────
    await page.locator('[data-kpi="warning"] .mine-col').waitFor();
    for (const id of ['warning', 'amount', 'rating']) {
      const mine = await page.locator(`[data-kpi="${id}"] .mine-col`).innerText();
      assert.match(mine, /^\s*·?\s*내 /, `[data-kpi="${id}"] mine value`);
    }
    const warningMine = await page.locator('[data-kpi="warning"] .mine-col').innerText();
    assert.match(warningMine, /내 [\d,]+건 · [\d.]+%/);
    await page.locator('.kpi-minor').screenshot({ path: `${out}/item4-kpi-minor-${label}.png` });
    checks.push({ item: 4, label, warningMine });

    // ── item 3: 답변까지 기간, 상단 KPI 중앙값 박스에 평균값 병기 ────────────────────────────────
    const durationHero = page.locator('[data-kpi="duration"]');
    const heroText = await durationHero.innerText();
    assert.match(heroText, /중앙값.*평균/s);
    assert.match(await durationHero.locator('.kpi-mine').innerText(), /내 중앙값.*평균/s);
    await page.locator('.kpi-hero').screenshot({ path: `${out}/item3-kpi-hero-${label}.png` });

    // ── item 5: 기관·담당자 표, 내 값이 같은 열 파란색, 390에서 표가 깨지지 않음 ──────────────────
    await page.getByRole('tab', { name: '기관·담당자', exact: true }).click();
    const table = page.locator('#entities');
    await table.locator('tbody .entity-mine').first().waitFor();
    assert.equal(await table.locator('thead th').count(), 6);
    assert.equal(await table.locator('tbody tr').first().locator('.entity-mine').count(), 5);
    assert.equal(await table.locator('.entity-mine').first().evaluate((e) => getComputedStyle(e).color),
      theme === 'light' ? 'rgb(11, 78, 215)' : 'rgb(96, 165, 250)');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '390px 표가 페이지를 넘기면 안 됨');
    await table.screenshot({ path: `${out}/item5-entities-${label}.png` });
    checks.push({ item: 5, label, overflow: false });

    // 더 보는 그래프를 펼쳐야 처리기간 분포·기관×위반법규·산점도가 나온다.
    await page.getByRole('region', { name: '더 보는 그래프' }).getByRole('button', { name: '펼치기', exact: true }).click();

    // item 3 (계속): 처리기간 분포 카드에도 평균값 병기
    const durationCard = page.getByRole('article', { name: '답변까지 걸린 기간의 분포', exact: true });
    await durationCard.locator('.chart-caption .mine-col').waitFor();
    assert.match(await durationCard.locator('.chart-caption').innerText(), /전체 중앙값.*평균.*내 신고 중앙값.*평균/s);
    await durationCard.screenshot({ path: `${out}/item3-duration-card-${label}.png` });
    checks.push({ item: 3, label, hero: heroText });

    // ── item 2: 기관×위반법규, 기본 탭 과태료, 칸 대비 ≥ 4.5:1 ──────────────────────────────────
    const heatmap = page.getByRole('article', { name: '기관별 위반법규 처리결과' });
    await heatmap.scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelector('[aria-label="기관별 위반법규 처리결과"] .chart-host')?.__chart?.getOption()?.series?.[0]?.data?.length > 0);
    assert.equal(await heatmap.getByRole('button', { name: '과태료', exact: true }).getAttribute('aria-pressed'), 'true');
    const heatContrast = await heatmap.locator('.chart-host').evaluate((el) => {
      const chart = el.__chart, option = chart.getOption();
      return option.series[0].data.map((p, i) => {
        const bg = p.label.backgroundColor || chart.getVisual({ seriesIndex: 0, dataIndex: i }, 'color');
        return { fg: p.label.color, bg };
      });
    }, { timeout: 5000 });
    const minHeatContrast = Math.min(...heatContrast.map((c) => contrast(c.fg, c.bg)));
    assert.ok(minHeatContrast >= 4.5, `heatmap min contrast ${minHeatContrast}`);
    await heatmap.screenshot({ path: `${out}/item2-heatmap-${label}.png` });
    checks.push({ item: 2, label, defaultTab: '과태료', minContrast: minHeatContrast });

    // ── item 1: 처리기간×처리결과 산점도, '내 신고' 테두리가 테마 전환 왕복 후에도 보임 ────────────
    const scatter = page.getByRole('article', { name: '처리기간과 처리결과' });
    await scatter.scrollIntoViewIfNeeded();
    const scatterHost = scatter.locator('.chart-host');
    await page.waitForFunction(() => document.querySelector('[aria-label^="기관별 처리기간 중앙값과 처리결과 비율 산점도"]')?.__chart?.getOption()?.series?.[0]?.data?.length > 0);
    const borderCheck = async () => scatterHost.evaluate((el) => {
      const bordered = el.__chart.getOption().series[0].data.filter((d) => d?.itemStyle?.borderColor);
      const currentText = getComputedStyle(document.documentElement).getPropertyValue('--text').trim();
      return { count: bordered.length, colors: bordered.map((d) => d.itemStyle.borderColor), currentText };
    });
    const before = await borderCheck();
    assert.ok(before.count > 0, '내 신고가 있는 기관/담당자 점이 하나 이상 있어야 한다(합성 fixture)');
    assert.ok(before.colors.every((c) => c === before.currentText), `toggle 전: 테두리 색이 현재 테마 --text와 달라 사라져 보일 수 있음 ${JSON.stringify(before)}`);
    await scatter.screenshot({ path: `${out}/item1-scatter-before-toggle-${label}.png` });

    // 라이트/다크 3회 왕복(THEME_ORDER = dark→light→system, 6클릭 = 최소 3왕복) 후에도 테두리가 현재 테마와 일치하는지
    const roundTrips = [];
    for (let i = 0; i < 6; i++) {
      await page.getByRole('button', { name: /^테마 전환/ }).click();
      await page.waitForTimeout(250);
      const after = await borderCheck();
      assert.ok(after.count === before.count, `toggle ${i + 1}: 내 신고 점 개수가 바뀌면 안 된다`);
      assert.ok(after.colors.every((c) => c === after.currentText),
        `toggle ${i + 1}: 테두리 색이 그 순간의 --text와 달라 사라져 보일 수 있음 ${JSON.stringify(after)}`);
      roundTrips.push(after);
    }
    await scatter.screenshot({ path: `${out}/item1-scatter-after-toggles-${label}.png` });
    checks.push({ item: 1, label, borderedPoints: before.count, toggles: roundTrips.length });

    await context.close();
  }
  assert.deepEqual(errors, [], `console/page errors: ${JSON.stringify(errors)}`);
  assert.deepEqual(failedRequests, [], `failed requests: ${JSON.stringify(failedRequests)}`);
  writeFileSync(`${out}/browser-results.json`, JSON.stringify({ origin, mode: 'synthetic demo; Kakao SDK stubbed', checks, errors, failedRequests }, null, 2));
  console.log(`OK: ${checks.length} checks, 0 console/page errors, 0 failed requests. ${out}`);
} catch (e) {
  writeFileSync(`${out}/browser-failure.json`, JSON.stringify({ message: e.message, checks, errors, failedRequests }, null, 2));
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
