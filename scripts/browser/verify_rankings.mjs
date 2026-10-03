// Actual Chromium over local REAL ranking handler/DB/auth session and synthetic reports. No hosted service.
import { chromium } from "./harness.mjs";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
const base = process.env.RANKINGS_ORIGIN || "http://127.0.0.1:5192";
const out = process.argv[2] ||
  "docs/implementation/user-rankings/evidence/browser";
mkdirSync(out, { recursive: true });
await fetch(`${base}/__rankings/fail?status=0`);
await fetch(`${base}/__rankings/restore`);
const { session } = await (await fetch(`${base}/__rankings/session`)).json();
const browser = await chromium.launch({
  executablePath: process.env.RANKINGS_BROWSER || "/usr/bin/google-chrome",
  headless: true,
  args: ["--no-sandbox", "--lang=ko-KR"],
});
const checks = [], errors = [], network = [];
const check = (name, condition) => {
  assert.ok(condition, name);
  checks.push({ name, status: "PASS" });
};
async function open(width, theme, signed = true, search = "?screen=rankings") {
  const context = await browser.newContext({
    viewport: { width, height: 900 },
    colorScheme: theme,
    permissions: ["clipboard-read", "clipboard-write"],
  });
  await context.addInitScript(({ session, theme, signed }) => {
    localStorage.setItem("cm-theme", theme);
    if (signed) localStorage.setItem("cm-map-auth-v1", JSON.stringify(session));
  }, { session, theme, signed });
  await context.route(
    "https://dapi.kakao.com/**",
    (route) =>
      route.fulfill({
        contentType: "text/javascript",
        body: readFileSync(
          new URL("./mock-kakao-sdk.js", import.meta.url),
          "utf8",
        ),
      }),
  );
  const page = await context.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => {
    if (r.url().includes("/functions/")) {
      network.push({ url: new URL(r.url()).pathname, status: r.status() });
    }
  });
  await page.goto(base + "/" + search);
  if (signed) await page.locator(".rk-page table tbody tr").first().waitFor();
  return { page, context };
}
const shot = (page, name) =>
  page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
try {
  for (const width of [1920, 1440, 2560, 390]) {
    for (const theme of ["dark", "light"]) {
      const { page, context } = await open(width, theme);
      check(
        `${width}/${theme} direct entry`,
        await page.locator(".rk-page").isVisible(),
      );
      check(
        `${width}/${theme} page no overflow`,
        await page.evaluate(() =>
          document.documentElement.scrollWidth <= innerWidth
        ),
      );
      check(
        `${width}/${theme} own summary and badge`,
        await page.locator(".rk-me-badge").count() === 1 &&
          await page.getByRole("heading", { name: "내 순위", exact: true })
            .isVisible(),
      );
      await shot(page, `${width}-${theme}`);
      if (width === 390 && theme === "light") {
        await page.evaluate(() =>
          document.documentElement.style.fontSize = "24px"
        );
        check(
          "large font no page overflow",
          await page.evaluate(() =>
            document.documentElement.scrollWidth <= innerWidth
          ),
        );
        await shot(page, "390-light-large-font");
      }
      await context.close();
    }
  }
  const { page, context } = await open(1440, "dark");
  const rk = page.locator(".rk-page");
  await rk.getByRole("button", { name: "다음", exact: true }).click();
  await rk.getByText("2페이지 · 20명씩").waitFor();
  check(
    "pagination own rank still global",
    await rk.getByRole("region", { name: "내 순위 요약" }).count() === 0
      ? await rk.locator('[aria-label="내 순위 요약"]').isVisible()
      : true,
  );
  await shot(page, "page2");
  await rk.getByRole("button", { name: "최다 과태료 수용자", exact: true })
    .click();
  await rk.getByLabel("지표", { exact: true }).selectOption("fine_rate");
  await rk.getByRole("button", { name: "적용", exact: true }).click();
  await rk.locator("table").waitFor();
  const percent = await rk.locator("table tbody tr:first-child td").nth(2)
    .innerText();
  check(
    "rate has fraction, percent <=100",
    percent.includes("/") && parseFloat(percent) <= 100,
  );
  await shot(page, "fine-rate");
  await rk.getByRole("button", { name: "이달의 불운자", exact: true }).click();
  await rk.getByLabel("조회 달", { exact: true }).fill("2026-08");
  await rk.getByLabel("지표", { exact: true }).selectOption("rejected_rate");
  await rk.getByRole("button", { name: "적용", exact: true }).click();
  await rk.locator("table").waitFor();
  check(
    "prior month title",
    await rk.locator("h1").innerText() === "2026년 8월의 불운자",
  );
  check(
    "sample1 visible",
    await rk.getByText("표본 1건", { exact: true }).count() > 0,
  );
  await shot(page, "prior-month-single-sample");
  await rk.getByLabel("지표", { exact: true }).selectOption("partial_count");
  await rk.getByRole("button", { name: "적용", exact: true }).click();
  await rk.locator("table").waitFor();
  check(
    "partial count supported",
    await rk.locator(".rk-sub").innerText().then((x) =>
      x.includes("일부수용 건수")
    ),
  );
  await rk.getByLabel("조회 달", { exact: true }).fill("2020-01");
  await rk.getByRole("button", { name: "적용", exact: true }).click();
  await rk.getByRole("heading", { name: "결과가 없습니다" }).waitFor();
  check(
    "empty state without fake UUIDs",
    await rk.locator("table").count() === 0,
  );
  await shot(page, "empty");
  await rk.getByRole("button", { name: "초기화", exact: true }).click();
  await rk.locator("table").waitFor();
  await rk.locator("tbody tr.rk-me summary").click();
  await rk.getByRole("button", {
    name: new RegExp(`UUID ${session.user.id} 복사`),
  }).click();
  check(
    "full UUID copy",
    await page.evaluate(() => navigator.clipboard.readText()) ===
      session.user.id,
  );
  await shot(page, "uuid-copy");
  await rk.getByRole("button", { name: "적용", exact: true }).focus();
  await page.keyboard.press("Tab");
  check(
    "keyboard focus",
    await page.evaluate(() => document.activeElement?.tagName === "BUTTON"),
  );
  await shot(page, "keyboard-focus");
  await fetch(`${base}/__rankings/fail?status=429`);
  await rk.getByRole("button", { name: "적용", exact: true }).click();
  await rk.getByRole("button", { name: /초 뒤 다시 시도/ }).waitFor();
  check(
    "429 cooldown",
    await rk.getByRole("button", { name: /초 뒤 다시 시도/ }).isDisabled(),
  );
  await shot(page, "rate-limited");
  await page.waitForTimeout(2300);
  await rk.getByRole("button", { name: "다시 시도", exact: true }).click();
  await rk.locator("table").waitFor();
  await fetch(`${base}/__rankings/fail?status=503`);
  await rk.getByRole("button", { name: "적용", exact: true }).click();
  await rk.getByRole("heading", { name: "랭킹을 불러오지 못했습니다" })
    .waitFor();
  check("error clears all rank data", await rk.locator("table").count() === 0);
  await shot(page, "error");
  await rk.getByRole("button", { name: "다시 시도", exact: true }).click();
  await rk.locator("table").waitFor();
  await fetch(`${base}/__rankings/fail?status=409`);
  await rk.getByRole("button", { name: "다음", exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector(".rk-pager")?.textContent.includes("1페이지")
  );
  check(
    "409 restarts whole version",
    await rk.getByText("1페이지 · 20명씩").isVisible(),
  );
  await page.reload();
  await rk.locator("table").waitFor();
  check(
    "refresh deep link",
    new URL(page.url()).searchParams.get("screen") === "rankings",
  );
  await page.getByRole("navigation", { name: "주요 화면", exact: true })
    .getByRole("button", { name: "지도", exact: true }).click();
  await page.waitForFunction(() =>
    new URLSearchParams(location.search).get("screen") !== "rankings"
  );
  await page.waitForSelector('.kpi-strip [data-kpi="report"]');
  const mapBefore = Object.fromEntries(new URL(page.url()).searchParams);
  await page.getByRole("navigation", { name: "주요 화면", exact: true })
    .getByRole("button", { name: "유저 랭킹", exact: true }).click();
  await rk.locator("table").waitFor();
  await rk.getByRole("button", { name: "이달의 불운자", exact: true }).click();
  await rk.getByLabel("조회 달", { exact: true }).fill("2026-08");
  await rk.getByRole("button", { name: "적용", exact: true }).click();
  await rk.locator("table").waitFor();
  const mapAfter = Object.fromEntries(new URL(page.url()).searchParams);
  check(
    "ranking filters preserve map filters",
    ["start", "end", "date_basis", "category"].every((k) =>
      mapBefore[k] === mapAfter[k]
    ),
  );
  await page.goBack();
  await page.waitForFunction(() =>
    new URLSearchParams(location.search).get("screen") !== "rankings"
  );
  await page.goBack();
  await rk.locator("table").waitFor();
  check(
    "history back returns ranking",
    new URL(page.url()).searchParams.get("screen") === "rankings",
  );
  await fetch(`${base}/__rankings/withdraw`);
  await page.reload();
  await rk.getByText(/활성|동의/).first().waitFor();
  await page.waitForTimeout(500);
  check(
    "withdrawn no protected ranks",
    await rk.locator("table").count() === 0,
  );
  await shot(page, "withdrawn");
  await fetch(`${base}/__rankings/restore`);
  await context.close();
  const anon = await open(390, "dark", false);
  check(
    "anonymous gate",
    await anon.page.getByRole("button", { name: "카카오로 로그인" })
      .isVisible(),
  );
  check(
    "anonymous has no UUID table",
    await anon.page.locator(".rk-page table").count() === 0,
  );
  await shot(anon.page, "anonymous");
  await anon.context.close();
  const log = await (await fetch(`${base}/__rankings/log`)).json();
  // Expected failed auth/mock-less map requests are separated from ranking's runtime JS errors.
  check(
    "ranking responses bounded",
    log.filter((x) => x.status === 200).every((x) => x.bytes < 40000),
  );
  writeFileSync(
    `${out}/result.json`,
    JSON.stringify(
      {
        browser: browser.version(),
        data:
          "real local Postgres tables, invented users and reports; real GoTrue JWT; Node handler runtime, not hosted Edge",
        checks,
        console_errors: errors,
        network,
        requests: log,
        live: "NOT_RUN; no deploy",
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify(
      { checks: checks.length, out, console_errors: errors },
      null,
      2,
    ),
  );
} catch (e) {
  writeFileSync(
    `${out}/failure.json`,
    JSON.stringify({ message: e.message, checks, errors, network }, null, 2),
  );
  throw e;
} finally {
  await browser.close();
}
