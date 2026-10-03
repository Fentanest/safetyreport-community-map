// Contrast supplement: light-theme gate page needs NO session, so it runs
// without touching fixtures. Corrects the transparent-bg sampling bug in
// independent-check.mjs (ancestors' transparent backgrounds were read as
// black, producing bogus 1.18). Here the EFFECTIVE background is resolved by
// walking up to the first non-transparent ancestor.
// No /session, no fixture writes, no token handling at all.
import { chromium } from "../../../../../scripts/browser/harness.mjs";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const base = process.env.RANKINGS_ORIGIN || "http://127.0.0.1:5192";
const out = process.argv[2] || "docs/implementation/user-rankings/evidence/muse";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.RANKINGS_BROWSER || "/usr/bin/google-chrome",
  headless: true,
  args: ["--no-sandbox", "--lang=ko-KR"],
});
const results = [];
const net = [];
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    colorScheme: "light",
  });
  await context.addInitScript(() => {
    localStorage.setItem("cm-theme", "light");
    localStorage.removeItem("cm-map-auth-v1");
  });
  await context.route("https://dapi.kakao.com/**", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: readFileSync(new URL("../../../../../scripts/browser/mock-kakao-sdk.js", import.meta.url), "utf8"),
    }));
  const page = await context.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 120)); });
  page.on("response", (r) => {
    if (r.url().includes("/functions/")) net.push({ url: new URL(r.url()).pathname, status: r.status() });
  });
  await page.goto(base + "/?screen=rankings");
  await page.getByRole("button", { name: "카카오로 로그인" }).waitFor({ timeout: 20000 });
  const contrast = await page.evaluate(() => {
    const parse = (rgb) => {
      const m = rgb.match(/[\d.]+/g).map(Number);
      return { r: m[0], g: m[1], b: m[2], a: m[3] === undefined ? 1 : m[3] };
    };
    const lum = ({ r, g, b }) => {
      const f = (v) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const effBg = (el) => {
      let n = el;
      while (n && n !== document.documentElement) {
        const c = parse(getComputedStyle(n).backgroundColor);
        if (c.a > 0.99) return c;
        n = n.parentElement;
      }
      const c = parse(getComputedStyle(document.body).backgroundColor);
      if (c.a > 0.99) return c;
      return { r: 255, g: 255, b: 255, a: 1 };
    };
    const ratio = (fg, bg) => {
      const x = lum(fg), y = lum(bg);
      return +(((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)).toFixed(2));
    };
    const sample = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const fg = parse(getComputedStyle(el).color);
      const bg = effBg(el);
      return { sel, fg: getComputedStyle(el).color, bgUsed: `rgb(${bg.r},${bg.g},${bg.b})`, ratio: ratio(fg, bg) };
    };
    return [
      sample("h1"),
      sample("main p, .cm-panel p, div[class] p"),
      sample("button"),
    ];
  });
  for (const s of contrast) {
    if (!s) continue;
    const pass = s.ratio >= 4.5;
    results.push({ name: `gate light contrast ${s.sel} = ${s.ratio}`, status: pass ? "PASS" : "FAIL", detail: `${s.fg} on ${s.bgUsed}` });
    console.log(`${pass ? "PASS" : "FAIL"} ${s.sel} ${s.ratio} (${s.fg} on ${s.bgUsed})`);
  }
  results.push({ name: "gate console/network notes", status: "PASS", detail: JSON.stringify({ errs, net }).slice(0, 300) });
  await page.screenshot({ path: `${out}/indep-gate-contrast-390-light.png`, fullPage: true });
  await context.close();
} finally {
  writeFileSync(`${out}/contrast-gate.json`, JSON.stringify({ results }, null, 2) + "\n");
  await browser.close();
}
console.log("DONE");
if (results.some((r) => r.status !== "PASS")) process.exit(1);
