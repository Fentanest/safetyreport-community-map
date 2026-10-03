import { chromium } from "./harness.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
const out = "docs/implementation/user-rankings/evidence/subpath";
mkdirSync(out, { recursive: true });
const { session } =
  await (await fetch("http://127.0.0.1:5192/__rankings/session")).json();
const b = await chromium.launch({
  executablePath: process.env.RANKINGS_BROWSER || "/usr/bin/google-chrome",
  headless: true,
  args: ["--no-sandbox"],
});
const page = await b.newPage({ viewport: { width: 390, height: 844 } });
const failures = [];
page.on("pageerror", (e) => failures.push(e.message));
page.on("response", (r) => {
  if (r.status() >= 400) {
    failures.push(`${r.status()} ${new URL(r.url()).pathname}`);
  }
});
await page.addInitScript((s) => {
  localStorage.setItem("cm-map-auth-v1", JSON.stringify(s));
  localStorage.setItem("cm-theme", "light");
}, session);
try {
  const url =
    "http://127.0.0.1:5193/safetyreport-community-map/?screen=rankings";
  await page.goto(url);
  await page.locator(".rk-page table").waitFor();
  assert.equal(new URL(page.url()).pathname, "/safetyreport-community-map/");
  await page.reload();
  await page.locator(".rk-page table").waitFor();
  assert.equal(await page.locator(".rk-me-badge").count(), 1);
  assert.ok(
    await page.evaluate(() =>
      document.documentElement.scrollWidth <= innerWidth
    ),
  );
  await page.screenshot({
    path: `${out}/390-light-refresh.png`,
    fullPage: true,
  });
  assert.deepEqual(failures, []);
  writeFileSync(
    `${out}/result.json`,
    JSON.stringify(
      {
        result: "PASS",
        direct_entry: true,
        refresh: true,
        subpath: "/safetyreport-community-map/",
        browser: b.version(),
        asset_or_network_errors: failures,
        fixture:
          "local static dist, real local ranking RPC + GoTrue JWT, synthetic reports; not deployed Pages",
      },
      null,
      2,
    ) + "\n",
  );
  console.log("subpath direct entry/refresh/assets/UUID row/overflow PASS");
} finally {
  await b.close();
}
