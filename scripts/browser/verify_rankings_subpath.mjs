import { chromium } from "./harness.mjs";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
const out = process.argv[2] || "docs/implementation/user-rankings/evidence/subpath";
const search = process.argv[3] || "?screen=rankings";
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
const navigationCancellations = [];
let reloading = false;
page.on("pageerror", (e) => failures.push(e.message));
page.on("console",m=>{if(m.type()==="error") failures.push(m.text());});
page.on("requestfailed",r=>{
  const u=new URL(r.url()), detail=`${u.hostname}${u.pathname}: ${r.failure()?.errorText}`;
  if(u.hostname==='ads-partners.coupang.com' && u.pathname==='/widgets.html' && r.resourceType()==='document' && r.failure()?.errorText==='net::ERR_ABORTED') navigationCancellations.push({detail,phase:reloading?'reload':'auth gate transition'});
  else failures.push(detail);
});
page.on("response", (r) => {
  if (r.status() >= 400) {
    failures.push(`${r.status()} ${new URL(r.url()).pathname}`);
  }
});
await page.addInitScript((s) => {
  localStorage.setItem("cm-map-auth-v1", JSON.stringify(s));
  localStorage.setItem("cm-theme", "light");
}, session);
await page.route('https://dapi.kakao.com/**',r=>r.fulfill({contentType:'text/javascript',body:readFileSync(new URL('./mock-kakao-sdk.js',import.meta.url),'utf8')}));
const staticServer = spawn(process.execPath, ['scripts/browser/static_pages.mjs'], {
  env: { ...process.env, BASE:'/safetyreport-community-map/', PORT:'5193' }, stdio:'ignore',
});
try {
  for (let i=0;i<50;i++) {
    if (staticServer.exitCode !== null) throw new Error('Owned static server exited before review');
    try { if ((await fetch('http://127.0.0.1:5193/safetyreport-community-map/')).ok) break; } catch {}
    await new Promise(r=>setTimeout(r,100));
  }
  const url =
    "http://127.0.0.1:5193/safetyreport-community-map/" + search;
  await page.goto(url);
  await page.locator(".rk-page .rk-list li").first().waitFor({timeout:10000});
  assert.equal(new URL(page.url()).pathname, "/safetyreport-community-map/");
  reloading = true;
  await page.reload();
  await page.locator(".rk-page .rk-list li").first().waitFor({timeout:10000});
  reloading = false;
  assert.equal(await page.locator(".rk-me-badge:visible").count(), 1);
  for (const [key, value] of new URLSearchParams(search)) {
    assert.equal(new URL(page.url()).searchParams.get(key), value, `subpath refresh preserves ${key}`);
  }
  const expected = new URLSearchParams(search);
  if (expected.get('rk_period') === 'month') {
    assert.equal(await page.locator('.rk-page').getByLabel('조회할 달 직접 선택').inputValue(), expected.get('rk_month'));
  }
  if (expected.has('rk_basis')) {
    assert.equal(await page.locator('.rk-page').getByLabel('날짜 기준', {exact:true}).inputValue(), expected.get('rk_basis'));
  }
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
        preserved_query: Object.fromEntries(new URLSearchParams(search)),
        subpath: "/safetyreport-community-map/",
        browser: b.version(),
        asset_or_network_errors: failures,
        cancelled_external_widget_documents: navigationCancellations,
        fixture:
          "local static dist, real local ranking RPC + GoTrue JWT, synthetic reports; not deployed Pages",
      },
      null,
      2,
    ) + "\n",
  );
  console.log("subpath direct entry/refresh/assets/UUID row/overflow PASS");
} catch (error) {
  console.error(JSON.stringify({failures, url:page.url(), visible_text:(await page.locator("body").innerText()).slice(0,1500)}));
  throw error;
} finally {
  staticServer.kill('SIGTERM');
  await b.close();
}
