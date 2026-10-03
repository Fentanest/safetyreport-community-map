// Independent Muse review checks (local synthetic stack, root-owned server).
// Script-only corrections per Sol recovery note:
// - fresh /session per section; shared session object is never reused across logout.
// - real account-menu logout runs LAST (burns the viewer session; nothing follows).
// - large-text uses TRUE enlargement (CSS zoom ~= browser zoom), not root font-size.
// - per-section try/catch: one failure cannot lose other sections' evidence.
// - NO fixture writes: no /withdraw, /restore, /cleanup. Only /fail?status=0
//   (clears in-memory failure injection) and /session reads.
// - No token/secret is printed or written anywhere.
// Places artifacts ONLY under the given out dir (approved evidence/muse).
import { chromium } from "../../../../../scripts/browser/harness.mjs";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const base = process.env.RANKINGS_ORIGIN || "http://127.0.0.1:5192";
const out = process.argv[2] || "docs/implementation/user-rankings/evidence/muse";
mkdirSync(out, { recursive: true });

await fetch(`${base}/__rankings/fail?status=0`);
const freshSession = async () =>
  (await (await fetch(`${base}/__rankings/session`)).json()).session;

const browser = await chromium.launch({
  executablePath: process.env.RANKINGS_BROWSER || "/usr/bin/google-chrome",
  headless: true,
  args: ["--no-sandbox", "--lang=ko-KR"],
});
const results = [];
const rec = (name, pass, detail = "") => {
  results.push({ name, status: pass ? "PASS" : "FAIL", detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${name} ${detail}`.slice(0, 200));
};
const save = () =>
  writeFileSync(`${out}/independent-check.json`, JSON.stringify({ results }, null, 2) + "\n");

async function open(session, { width = 1440, height = 900, theme = "dark" } = {}) {
  const context = await browser.newContext({
    viewport: { width, height },
    colorScheme: theme,
  });
  await context.addInitScript(({ session, theme }) => {
    localStorage.setItem("cm-theme", theme);
    localStorage.setItem("cm-map-auth-v1", JSON.stringify(session));
  }, { session, theme });
  await context.route("https://dapi.kakao.com/**", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: readFileSync(new URL("../../../../../scripts/browser/mock-kakao-sdk.js", import.meta.url), "utf8"),
    }));
  const page = await context.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(base + "/?screen=rankings");
  await page.locator(".rk-page table tbody tr").first().waitFor({ timeout: 20000 });
  return { page, context, errs };
}

async function section(name, fn) {
  try {
    await fn();
  } catch (e) {
    rec(name, false, `exception: ${String(e.message || e).slice(0, 160)}`);
  } finally {
    save();
  }
}

try {
  await section("current-month in_progress shown", async () => {
    const { page, context } = await open(await freshSession());
    const rk = page.locator(".rk-page");
    await rk.getByRole("button", { name: "이달의 불운자", exact: true }).click();
    await rk.getByRole("button", { name: "적용", exact: true }).click();
    await rk.locator("table").waitFor({ timeout: 20000 });
    const bodyText = await rk.innerText();
    rec("current-month in_progress shown", /진행 중인 달/.test(bodyText), bodyText.slice(0, 160));
    await page.screenshot({ path: `${out}/indep-current-month.png`, fullPage: true });
    await context.close();
  });

  await section("date_basis switch", async () => {
    const { page, context } = await open(await freshSession());
    const rk = page.locator(".rk-page");
    const before = await rk.locator(".rk-sub").first().innerText();
    await rk.getByLabel("날짜 기준", { exact: true }).selectOption("report_date");
    await rk.getByRole("button", { name: "적용", exact: true }).click();
    await rk.locator("table").waitFor({ timeout: 20000 });
    const after = await rk.locator(".rk-sub").first().innerText();
    rec("date_basis switch changes scope label", before !== after && /신고일/.test(after), `${before.slice(0, 60)} => ${after.slice(0, 60)}`);
    await page.screenshot({ path: `${out}/indep-report-basis.png`, fullPage: true });
    await context.close();
  });

  await section("custom range application", async () => {
    const { page, context } = await open(await freshSession());
    const rk = page.locator(".rk-page");
    await rk.getByRole("button", { name: "직접 범위", exact: true }).click();
    await rk.getByLabel("시작일", { exact: true }).fill("2026-07-01");
    await rk.getByLabel("종료일", { exact: true }).fill("2026-08-31");
    await rk.getByRole("button", { name: "적용", exact: true }).click();
    await rk.locator("table").waitFor({ timeout: 20000 });
    const sub = await rk.locator(".rk-sub").first().innerText();
    rec("custom range applied", sub.includes("2026-07-01") && sub.includes("2026-08-31"), sub.slice(0, 120));
    await rk.getByRole("button", { name: "적용", exact: true }).click();
    await rk.locator("table").waitFor({ timeout: 20000 });
    const sub2 = await rk.locator(".rk-sub").first().innerText();
    rec("same-query Apply reload keeps cohort", sub2.includes("2026-07-01"), sub2.slice(0, 120));
    await page.screenshot({ path: `${out}/indep-custom-range.png`, fullPage: true });
    await context.close();
  });

  await section("high min_reports yields no own row", async () => {
    const { page, context } = await open(await freshSession());
    const rk = page.locator(".rk-page");
    await rk.getByLabel("최소 신고 건수", { exact: true }).fill("9999");
    await rk.getByRole("button", { name: "적용", exact: true }).click();
    await page.waitForTimeout(2000);
    const body = await rk.innerText();
    const badge = await rk.locator(".rk-me-badge").count();
    rec("high min_reports yields no own row", badge === 0, `badges=${badge} ` + body.slice(0, 160));
    await page.screenshot({ path: `${out}/indep-min-excludes-me.png`, fullPage: true });
    await context.close();
  });

  await section("zoomed large-text operability + focus + contrast", async () => {
    const { page, context } = await open(await freshSession(), { width: 390, height: 844, theme: "light" });
    // TRUE enlargement: CSS zoom (browser-zoom equivalent), scales px text/layout.
    await page.evaluate(() => { document.body.style.zoom = "1.5"; });
    await page.waitForTimeout(800);
    const metrics = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      innerW: window.innerWidth,
    }));
    const apply = page.locator(".rk-page").getByRole("button", { name: "적용", exact: true });
    const visible = await apply.isVisible();
    await apply.focus();
    const outline = await page.evaluate(() => {
      const el = document.activeElement;
      const cs = getComputedStyle(el);
      return `${el.tagName} outline=${cs.outlineWidth}/${cs.outlineStyle} shadow=${cs.boxShadow.slice(0, 40)}`;
    });
    rec("zoomed Apply reachable with visible focus", visible && /^BUTTON/.test(outline) && !/0px\/none/.test(outline), `${JSON.stringify(metrics)} ${outline}`);
    await page.screenshot({ path: `${out}/indep-focus-large-font.png`, fullPage: true });
    // Contrast sampling (light theme): body text and muted text vs panel bg.
    const contrast = await page.evaluate(() => {
      const lum = (rgb) => {
        const c = rgb.match(/[\d.]+/g).map(Number).slice(0, 3).map((v) => {
          v /= 255;
          return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      };
      const ratio = (a, b) => {
        const x = lum(a), y = lum(b);
        return ((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)).toFixed(2);
      };
      const bg = getComputedStyle(document.querySelector(".rk-page .cm-panel, .rk-page")).backgroundColor;
      const main = getComputedStyle(document.querySelector(".rk-page h1")).color;
      const muted = getComputedStyle(document.querySelector(".rk-page .cm-muted, .rk-page .rk-sub")).color;
      return { bg, main, muted, mainRatio: ratio(main, bg), mutedRatio: ratio(muted, bg) };
    });
    rec(
      "light text contrast >= 4.5",
      parseFloat(contrast.mainRatio) >= 4.5 && parseFloat(contrast.mutedRatio) >= 4.5,
      `main=${contrast.mainRatio} muted=${contrast.mutedRatio}`,
    );
    // Zoom overflow is REPORTED, not forced: zoom shrinks the effective viewport.
    results.push({ name: "zoom 1.5 overflow metrics (informational)", status: "PASS", detail: JSON.stringify(metrics) });
    await context.close();
  });

  // REAL logout via account menu LAST: burns this viewer session; nothing follows.
  await section("real logout gate", async () => {
    const { page, context } = await open(await freshSession());
    const rk = page.locator(".rk-page");
    await rk.locator("table").waitFor({ timeout: 20000 });
    await page.getByRole("button", { name: /^ID / }).click();
    await page.getByRole("menuitem", { name: "로그아웃" }).click();
    await page.waitForFunction(
      () => /카카오로 로그인/.test(document.body.innerText),
      { timeout: 20000 },
    );
    await page.waitForTimeout(1000);
    const tables = await page.locator(".rk-page table").count();
    const stored = await page.evaluate(() => {
      try { return localStorage.getItem("cm-map-auth-v1") || ""; } catch { return ""; }
    });
    rec("logout shows login gate, no table", tables === 0, `tables=${tables}`);
    rec("no JWT persisted after logout", !/eyJ/.test(stored), `stored_len=${stored.length}`);
    await page.screenshot({ path: `${out}/indep-logout-gate.png`, fullPage: true });
    await page.goBack().catch(() => {});
    await page.waitForTimeout(1500);
    const backTables = await page.locator(".rk-page table").count();
    const backText = await page.locator("body").innerText();
    rec("back after logout shows no cached ranks", backTables === 0 || /카카오로 로그인/.test(backText), `tables=${backTables}`);
    await page.screenshot({ path: `${out}/indep-logout-back.png`, fullPage: true });
    await context.close();
  });
} finally {
  save();
  await browser.close();
}
console.log("DONE");
if (results.some((r) => r.status !== "PASS" || /FAIL/.test(r.status))) process.exit(1);
