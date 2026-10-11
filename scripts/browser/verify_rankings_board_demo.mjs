// Demo-mode check of the one-page ranking board (2026-10-11). No database, no network for rankings: the demo build
// answers from src/data/demoRankings.ts and marks each load with performance.mark('rankings-demo-board'|'-list').
// Run: VITE_DATA_MODE=demo npx vite --host 127.0.0.1 --port 5291 --strictPort
//      BOARD_ORIGIN=http://127.0.0.1:5291 node scripts/browser/verify_rankings_board_demo.mjs [outDir]
// Screenshots go to .agent-runs/rankings-board/ (untracked) by default.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';

const PLAYWRIGHT = process.env.PLAYWRIGHT_MODULE || '/home/better0101/projects/safetyreport/tools/web-tests/node_modules/playwright/index.mjs';
const { chromium } = await import(PLAYWRIGHT);
const base = process.env.BOARD_ORIGIN || 'http://127.0.0.1:5291';
const out = process.argv[2] || '.agent-runs/rankings-board';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.BOARD_BROWSER || '/home/better0101/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',
  headless: true, args: ['--no-sandbox', '--lang=ko-KR'],
});
const checks = [], errors = [], rankingRequests = [];
const check = (name, ok) => { assert.ok(ok, name); checks.push(name); };
const marks = (page, name) => page.evaluate((n) => performance.getEntriesByName(n).length, name);
const URL_BOARD = '/?me=signed&screen=rankings';

async function open(width, theme, { reducedMotion = 'no-preference', search = URL_BOARD } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme, reducedMotion, permissions: ['clipboard-read', 'clipboard-write'] });
  await context.addInitScript((t) => { try { localStorage.setItem('cm-theme', t); } catch { /* ignore */ } }, theme);
  // the dashboard behind may try the real Kakao SDK: keep the check offline
  await context.route('https://dapi.kakao.com/**', (r) => r.fulfill({ contentType: 'text/javascript', body: '' }));
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${width}/${theme}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`${width}/${theme}: ${e.message}`));
  page.on('request', (r) => { if (/\/functions\/v1\/user-rankings/.test(r.url())) rankingRequests.push(r.url()); });
  await page.goto(base + search);
  return { context, page };
}

try {
  for (const width of [1280, 390]) {
    for (const theme of ['light', 'dark']) {
      const { context, page } = await open(width, theme);
      const rk = page.locator('.rk-page');
      await rk.locator('.rk-card').nth(6).waitFor();
      check(`${width}/${theme} three theme sections`, (await rk.locator('.rk-theme h2').allTextContents()).join('|') === '신고 랭킹|과태료 랭킹|불운 랭킹');
      check(`${width}/${theme} seven metric cards`, await rk.locator('.rk-card').count() === 7);
      check(`${width}/${theme} no theme tabs / metric segment`, await rk.locator('.rk-tabs, [aria-label="정렬 기준"], [aria-label="불운 종류"]').count() === 0);
      check(`${width}/${theme} exactly one board load`, await marks(page, 'rankings-demo-board') === 1 && await marks(page, 'rankings-demo-list') === 0);
      check(`${width}/${theme} podium 1–3 + list 4–5 per card`, await rk.locator('.rk-card').first().locator('.rk-podium > li').count() === 3
        && await rk.locator('.rk-card').first().locator('.rk-card-rest > li').count() === 2);
      check(`${width}/${theme} figures are decorative`, await rk.locator('svg.rk-fig').count() === 21
        && await rk.locator('svg.rk-fig:not([aria-hidden="true"])').count() === 0);
      check(`${width}/${theme} rank text stays text`, (await rk.locator('.rk-card').first().locator('.rk-brick-rank').first().innerText()).trim() === '1위');
      check(`${width}/${theme} every card has 내 순위 and 전체 보기`, await rk.locator('.rk-card-me').count() === 7 && await rk.getByRole('button', { name: /전체 보기$/ }).count() === 7);
      check(`${width}/${theme} no page overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      if (width === 390) {
        const cols = await rk.locator('.rk-theme-unlucky .rk-cards').evaluate((e) => getComputedStyle(e).gridTemplateColumns.split(' ').length);
        check('390 one card per row', cols === 1);
      }
      check(`${width}/${theme} cheering arms animate`, await rk.locator('.rk-card-reporters .rk-arm-cheer.rk-arm-l').first().evaluate((e) => getComputedStyle(e).animationName) === 'rk-wave-l');
      check(`${width}/${theme} unlucky 1st is under the umbrella`, await rk.locator('.rk-card-unlucky').first().locator('.rk-pos-0 .rk-umbrella').count() === 1);
      await page.waitForTimeout(1300); // let the one-shot confetti/coins finish before the full-page shot
      await page.screenshot({ path: `${out}/board-${width}-${theme}.png`, fullPage: true });
      await rk.locator('.rk-card-reporters').scrollIntoViewIfNeeded();
      await page.waitForTimeout(350);
      await rk.locator('.rk-card-reporters').screenshot({ path: `${out}/card-reporters-${width}-${theme}.png` });
      await rk.locator('.rk-card-unlucky').first().screenshot({ path: `${out}/card-unlucky-${width}-${theme}.png` });
      await rk.locator('.rk-card-fines').first().screenshot({ path: `${out}/card-fines-${width}-${theme}.png` });
      await context.close();
    }
  }

  // reduced motion: still pose, no confetti, coins already settled
  {
    const { context, page } = await open(1280, 'light', { reducedMotion: 'reduce' });
    const rk = page.locator('.rk-page');
    await rk.locator('.rk-card').nth(6).waitFor();
    check('reduced motion: arms do not animate', await rk.locator('.rk-arm-cheer').first().evaluate((e) => getComputedStyle(e).animationName) === 'none');
    check('reduced motion: no confetti', await rk.locator('.rk-confetti').first().evaluate((e) => getComputedStyle(e).display) === 'none');
    check('reduced motion: raised-arm pose kept', await rk.locator('.rk-arm-cheer.rk-arm-l').first().evaluate((e) => getComputedStyle(e).transform !== 'none'));
    await page.screenshot({ path: `${out}/board-1280-light-reduced-motion.png`, fullPage: true });
    await context.close();
  }

  // 전체 보기 ↔ board, memory reuse, URL, old links
  {
    const { context, page } = await open(1280, 'dark');
    const rk = page.locator('.rk-page');
    await rk.locator('.rk-card').nth(6).waitFor();
    check('board URL carries no rk_theme/rk_metric', !new URL(page.url()).searchParams.has('rk_theme') && !new URL(page.url()).searchParams.has('rk_metric'));
    await rk.getByRole('button', { name: '과태료 처분율 전체 보기' }).click();
    await rk.locator('.rk-table:visible tbody tr').first().waitFor();
    const u = new URL(page.url()).searchParams;
    check('전체 보기 opens the paged list of that metric', u.get('rk_theme') === 'fines' && u.get('rk_metric') === 'fine_rate');
    check('전체 보기 is one list load', await marks(page, 'rankings-demo-list') === 1);
    check('list keeps the existing pager', await rk.locator('.rk-pager').isVisible());
    check('back button has focus', await page.evaluate(() => document.activeElement?.classList.contains('rk-back')));
    await page.screenshot({ path: `${out}/full-fine-rate-1280-dark.png`, fullPage: true });
    await rk.getByRole('button', { name: /테마별 랭킹으로/ }).click();
    await rk.locator('.rk-card').nth(6).waitFor();
    check('back to the board reuses the 120 s memory (no second board load)', await marks(page, 'rankings-demo-board') === 1);
    check('focus returns to the card that opened the list', await page.evaluate(() => document.activeElement?.getAttribute('data-rk-more') === 'fine_rate'));
    check('board URL again without theme/metric', !new URL(page.url()).searchParams.has('rk_theme'));
    await rk.getByLabel('분류').selectOption('parking');
    await page.waitForFunction(() => performance.getEntriesByName('rankings-demo-board').length === 2);
    check('a new category is one new board load', await marks(page, 'rankings-demo-board') === 2);
    await rk.getByRole('button', { name: '월별', exact: true }).click();
    await page.waitForFunction(() => performance.getEntriesByName('rankings-demo-board').length === 3);
    check('monthly board title', (await rk.locator('.rk-sub').innerText()).includes('이달'));
    // UUID dialog from a podium caption
    const opener = rk.locator('.rk-podium .rk-uuid-btn').first();
    await opener.click();
    const dialog = page.getByRole('dialog', { name: '참여자 UUID' });
    check('UUID dialog opens from the podium', await dialog.isVisible() && /^[0-9a-f-]{36}$/.test(await dialog.getByLabel('전체 UUID').inputValue()));
    await page.keyboard.press('Escape');
    check('UUID dialog returns focus', await opener.evaluate((e) => e === document.activeElement));
    await context.close();
  }
  {
    const { context, page } = await open(1280, 'light', { search: `${URL_BOARD}&rk_theme=unlucky&rk_metric=partial_rate&rk_period=all&rk_basis=completed_date&rk_category=all&rk_min=1` });
    const rk = page.locator('.rk-page');
    await rk.locator('.rk-table:visible tbody tr').first().waitFor();
    check('old rk_theme/rk_metric link opens that metric full list', (await rk.locator('.rk-sub').innerText()).includes('일부수용 비율이 높은 순위') && await marks(page, 'rankings-demo-board') === 0);
    await context.close();
  }
  check('demo makes no ranking network request', rankingRequests.length === 0);
  check('no console or page errors', errors.length === 0);
  writeFileSync(`${out}/summary.json`, JSON.stringify({ mode: 'demo (synthetic demoRankings, no DB/Edge)', browser: browser.version(), checks, errors, rankingRequests }, null, 2));
  console.log(JSON.stringify({ checks: checks.length, out }, null, 2));
} catch (e) {
  writeFileSync(`${out}/failure.json`, JSON.stringify({ message: e.message, checks, errors }, null, 2));
  throw e;
} finally {
  await browser.close();
}
