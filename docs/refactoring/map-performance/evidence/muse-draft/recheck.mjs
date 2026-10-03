// Narrow recheck driver: FAST draft race + rk_min URL restoration on own Vite 5198.
// Real Chromium via CDP. No Playwright. All artifacts in-worktree.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Cdp, cdpTargets, evaluate, waitFor, sleep } from './cdp.mjs';

const ROOT = process.cwd();
const ORIGIN = 'http://127.0.0.1:5198';
const CDP_PORT = 19228;
const EVID = `${ROOT}/docs/refactoring/map-performance/evidence/muse-draft`;
const MOCK_SDK = readFileSync(`${ROOT}/scripts/browser/mock-kakao-sdk.js`, 'utf8');
mkdirSync(EVID, { recursive: true });

const E2E_UID = '11111111-2222-4333-8444-555555555555';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function fakeSession() {
  const exp = Math.floor(Date.now() / 1000) + 86400;
  const token = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: E2E_UID, role: 'authenticated', aud: 'authenticated', session_id: '66666666-7777-4888-9999-aaaaaaaaaaaa', exp, is_anonymous: false })}.e2e`;
  return { access_token: token, refresh_token: 'e2e-refresh', token_type: 'bearer', expires_in: 86400, expires_at: exp,
    user: { id: E2E_UID, aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'kakao' }, user_metadata: { nickname: '로컬검수' } } };
}

const checks = [];
const check = (id, name, ok, detail = '') => {
  checks.push({ id, name, status: ok ? 'PASS' : 'FAIL', detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} [${id}] ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) process.exitCode = 1;
};

const requests = []; // {t, url, params, requestId, status}
const consoleErrors = [];
const pageErrors = [];

function launchChrome() {
  // Sol-verified recovery (2026-10-04): absolute TMPDIR (even in-worktree .t)
  // still exceeds the 108-byte SingletonSocket cap. Relative TMPDIR='.' with
  // cwd=ROOT keeps the socket path short. Profile .b inside this worktree.
  // No /tmp, no $HOME profiles. Transient Chrome files stay in-worktree.
  const p = spawn('/usr/bin/google-chrome', [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`, '--no-sandbox',
    '--disable-gpu', '--disable-dev-shm-usage', '--user-data-dir=.b',
    '--lang=ko-KR', '--window-size=1440,900', 'about:blank',
  ], { cwd: ROOT, env: { ...process.env, TMPDIR: '.' }, stdio: ['ignore', 'ignore', 'ignore'] });
  return p;
}
async function waitCdpReady() {
  for (let i = 0; i < 100; i++) {
    try { const t = await cdpTargets(CDP_PORT); if (t.length) return t; } catch {}
    await sleep(200);
  }
  throw new Error('no cdp targets');
}

async function seedAndGoto(cdp, seedId, search, theme) {
  if (seedId.current) await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: seedId.current }).catch(() => {});
  const src = `try{localStorage.setItem('cm-map-auth-v1',${JSON.stringify(JSON.stringify(fakeSession()))});localStorage.setItem('cm-theme',${JSON.stringify(theme)});}catch(e){}`;
  const r = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: src });
  seedId.current = r.identifier;
  await cdp.send('Page.navigate', { url: `${ORIGIN}/${search}` });
  await waitFor(cdp, `() => !!document.querySelector('.rk-page, .cm-panel[role="note"]')`);
}

async function setViewport(cdp, w, h, mobile = false) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
}

async function shot(cdp, name) {
  const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${EVID}/${name}.png`, Buffer.from(r.data, 'base64'));
  console.log(`shot ${name}.png (${Math.round(Buffer.from(r.data, 'base64').length / 1024)}kb)`);
}

async function clickSel(cdp, selector) {
  const box = await evaluate(cdp, (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, selector);
  if (!box) throw new Error(`no element ${selector}`);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
}

async function key(cdp, name, code, vkc, text) {
  // Single-handling: CDP-injected rawKeyDown AND keyDown are EACH default-handled
  // (one Tab moved two stops). keyDown+keyUp alone drives one real key action.
  const base = { key: name, code, windowsVirtualKeyCode: vkc, nativeVirtualKeyCode: vkc };
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base });
  if (text !== undefined) await cdp.send('Input.dispatchKeyEvent', { type: 'char', text, unmodifiedText: text });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}
const keyTab = (cdp) => key(cdp, 'Tab', 'Tab', 9);
const keyDown = (cdp) => key(cdp, 'ArrowDown', 'ArrowDown', 40);
const keySpace = (cdp) => key(cdp, ' ', 'Space', 32);
const keyEnter = (cdp) => key(cdp, 'Enter', 'Enter', 13);

const rkCount = () => requests.filter((r) => r.status !== undefined).length;
const rkNew = (n) => requests.filter((r) => r.status !== undefined).slice(n);
const paramsOf = (url) => Object.fromEntries(new URL(url).searchParams);
// Signature counting: React StrictMode double-mounts effects in dev, so the SAME
// applied query may be sent twice (dup/abort share one signature). Only a NEW
// query signature counts as a new effective request.
const sig = (r) => new URL(r.url).search;
const newSigs = (n) => {
  const m = new Map();
  for (const r of rkNew(n)) m.set(sig(r), (m.get(sig(r)) ?? 0) + 1);
  return m;
};
const reqBySig = (n, s) => rkNew(n).find((r) => sig(r) === s);
// Wait for a genuinely NEW query signature (a late StrictMode abort-dup of an
// old signature must not satisfy an apply-wait).
async function waitForNewSig(before, exclude, timeoutMs = 20000) {
  const start = Date.now();
  for (;;) {
    const fresh = [...newSigs(before).keys()].filter((s) => !exclude.has(s));
    if (fresh.length > 0) return fresh;
    if (Date.now() - start > timeoutMs) throw new Error('no new query signature');
    await sleep(150);
  }
}

async function waitRkDelta(cdp, before, timeoutMs = 15000) {
  const start = Date.now();
  for (;;) {
    if (rkCount() > before) return;
    if (Date.now() - start > timeoutMs) throw new Error('no new rankings response');
    await sleep(150);
  }
}

const state = () => [
  `() => {
    const q = (s) => document.querySelector(s);
    // NOTE: the dashboard command bar has its own 날짜 기준 select; scope to .rk-page.
    const basis = q('.rk-page select[aria-label="날짜 기준"]');
    const min = q('.rk-page input[aria-label="최소 신고 건수"]');
    const det = q('.rk-page details.rk-advanced');
    const tabs = [...document.querySelectorAll('.rk-tabs button')].map(b => ({t:b.textContent.trim(), p:b.getAttribute('aria-pressed')}));
    const hint = !!document.querySelector('.rk-page details.rk-advanced .rk-hint');
    return {
      url: location.pathname + location.search,
      heading: q('.rk-sub')?.textContent ?? null,
      monthLabel: q('.rk-month-label')?.textContent ?? null,
      category: q('select[aria-label="분류"]')?.value ?? null,
      periodPressed: [...document.querySelectorAll('.rk-period .rk-seg button')].filter(b=>b.classList.contains('selected')).map(b=>b.textContent.trim()),
      detailsOpen: det ? det.open : null,
      basis: basis ? basis.value : null,
      basisVisible: basis ? basis.options[basis.selectedIndex]?.text : null,
      min: min ? min.value : null,
      advHint: hint,
      tabs,
      err: q('.rk-panel[role="alert"] h2')?.textContent ?? null,
      scopeLine: q('.rk-scope-line')?.textContent ?? null,
      active: document.activeElement ? (document.activeElement.getAttribute('aria-label') || document.activeElement.tagName) : null,
    };
  }`,
];

async function main() {
  const chrome = launchChrome();
  const seedId = { current: null };
  try {
    const targets = await waitCdpReady();
    const pageTarget = targets.find((t) => t.type === 'page');
    const cdp = new Cdp(pageTarget.webSocketDebuggerUrl);
    await cdp.connect();
    const chromeVersion = (await cdp.send('Browser.getVersion')).product;
    console.log('chrome', chromeVersion);

    cdp.on('Network.requestWillBeSent', (p) => {
      if (p.request.url.includes('/functions/v1/user-rankings')) {
        requests.push({ t: Date.now(), url: p.request.url, params: paramsOf(p.request.url), requestId: p.requestId, method: p.request.method });
      }
    });
    cdp.on('Network.responseReceived', (p) => {
      const r = requests.find((x) => x.requestId === p.requestId);
      if (r) r.status = p.response.status;
    });
    cdp.on('Network.loadingFailed', (p) => {
      const r = requests.find((x) => x.requestId === p.requestId);
      if (r && r.status === undefined) r.status = `failed:${p.errorText}`;
    });
    cdp.on('Runtime.consoleAPICalled', (p) => {
      if (p.type === 'error') consoleErrors.push(p.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300));
    });
    cdp.on('Runtime.exceptionThrown', (p) => {
      pageErrors.push((p.exceptionDetails.text ?? 'exception').slice(0, 300));
    });
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable');
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*dapi.kakao.com*' }] });
    cdp.on('Fetch.requestPaused', (p) => {
      cdp.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'text/javascript' }],
        body: Buffer.from(MOCK_SDK).toString('base64') }).catch(() => {});
    });

    // ── A. FAST open→change→apply (1440 dark, keyboard from summary) ──
    await setViewport(cdp, 1440, 900);
    await seedAndGoto(cdp, seedId, '?screen=rankings', 'dark');
    await waitRkDelta(cdp, 0);
    const s0 = await evaluate(cdp, ...state());
    const hasSummary = await evaluate(cdp, `() => !!document.querySelector('details.rk-advanced > summary')`);
    check('A0', 'direct entry renders rankings shell', hasSummary === true, `summary=${hasSummary}`);
    check('A1', 'initial fetch issued (StrictMode dup shares signature)', rkCount() >= 1, `responses=${rkCount()}`);
    check('A2', 'fixture limitation labeled: rankings API unserved on e2e stack', s0.err !== null, `panel=${s0.err}`);

    const beforeEdit = rkCount();
    const baseSig = sig(rkNew(0).slice(-1)[0]);
    await clickSel(cdp, 'details.rk-advanced > summary');
    await waitFor(cdp, `() => document.querySelector('details.rk-advanced')?.open === true`);
    await keyTab(cdp); // focus 날짜 기준 select
    await sleep(150);
    const focus1 = await evaluate(cdp, `() => document.activeElement?.getAttribute('aria-label')`);
    check('A0b', 'one Tab from summary reaches 날짜 기준 select', focus1 === '날짜 기준', `focus=${focus1}`);
    await keyDown(cdp); // 답변일 -> 신고일
    await sleep(700);
    const sEdit = await evaluate(cdp, ...state());
    check('A3', 'FAST: visible selected 신고일 survives (not reset by toggle)', sEdit.basis === 'report_date' && sEdit.basisVisible === '신고일', `basis=${sEdit.basis} visible=${sEdit.basisVisible} focusWas=${focus1}`);
    const editSigs = [...newSigs(beforeEdit).keys()];
    check('A4', 'editing alone sends no new query (only StrictMode same-signature noise)', editSigs.every((s) => s === baseSig), `newSigs=${editSigs.length} allBase=${editSigs.every((s) => s === baseSig)}`);
    check('A5', 'unapplied draft hint shown', sEdit.advHint === true, `hint=${sEdit.advHint}`);
    await keyTab(cdp); await keyTab(cdp); // min -> 적용
    const focus2 = await evaluate(cdp, `() => document.activeElement?.textContent?.trim()`);
    await keySpace(cdp);
    const fresh = await waitForNewSig(beforeEdit, new Set([baseSig]));
    const appliedReq = fresh.length === 1 ? reqBySig(beforeEdit, fresh[0]) : undefined;
    check('A6', 'apply sends exactly one new query signature', fresh.length === 1, `fresh=${fresh.length} totalNew=${rkNew(beforeEdit).length}`);
    check('A7', 'applied request carries report_date basis', appliedReq?.params.date_basis === 'report_date', JSON.stringify(appliedReq?.params));
    check('A8', 'keyboard focus reached 적용 button', focus2 === '적용', `focus=${(focus2 ?? '').slice(0, 40)}`);
    const appliedBasis = appliedReq?.params.date_basis ?? null;
    const appliedMin = appliedReq?.params.min_reports ?? null;
    await sleep(600);
    await shot(cdp, '1440-dark-fast-applied');

    // ── B. close/reopen resets unapplied drafts (expectations follow A's applied values) ──
    const b0 = rkCount();
    const knownSigs = new Set([baseSig, ...[...newSigs(beforeEdit).keys()].filter((s) => s !== baseSig)]);
    const stageBasis = appliedBasis === 'report_date' ? 'completed_date' : 'report_date';
    const stageMin = appliedMin === '1' ? '3' : '1';
    await evaluate(cdp, (sb, sm) => {
      const sel = document.querySelector('.rk-page select[aria-label="날짜 기준"]');
      const min = document.querySelector('.rk-page input[aria-label="최소 신고 건수"]');
      const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      set.call(sel, sb); sel.dispatchEvent(new Event('change', { bubbles: true }));
      const mset = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      mset.call(min, sm); min.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }, stageBasis, stageMin);
    await sleep(400);
    const sDraft = await evaluate(cdp, ...state());
    await clickSel(cdp, 'details.rk-advanced > summary'); // close
    await waitFor(cdp, `() => document.querySelector('details.rk-advanced')?.open === false`);
    await sleep(300);
    await clickSel(cdp, 'details.rk-advanced > summary'); // reopen
    await waitFor(cdp, `() => document.querySelector('details.rk-advanced')?.open === true`);
    await sleep(300);
    const sReopen = await evaluate(cdp, ...state());
    check('B1', `unapplied draft staged (${stageBasis}/${stageMin})`, sDraft.basis === stageBasis && sDraft.min === stageMin, `basis=${sDraft.basis} min=${sDraft.min}`);
    check('B2', 'close/reopen resets drafts to applied values', sReopen.basis === appliedBasis && sReopen.min === appliedMin, `basis=${sReopen.basis} min=${sReopen.min} (applied=${appliedBasis}/${appliedMin})`);
    const bSigs = [...newSigs(b0).keys()];
    check('B3', 'draft staging sends no new query', bSigs.every((s) => knownSigs.has(s)), `newSigs=${bSigs.length}`);

    // ── C. immediate controls don't apply adv draft ──
    const c0 = rkCount();
    await clickSel(cdp, '.rk-tabs button:nth-child(2)'); // 과태료 랭킹
    await waitRkDelta(cdp, c0);
    const cReqs = rkNew(c0);
    const cFresh = [...new Set(cReqs.map(sig))].filter((s) => !knownSigs.has(s));
    check('C1', 'tab change is immediate (one new query)', cFresh.length === 1, `fresh=${cFresh.length}`);
    const cReq = cFresh.length === 1 ? reqBySig(c0, cFresh[0]) : undefined;
    check('C2', 'tab request uses APPLIED basis, not adv draft', cReq?.params.theme === 'fines' && cReq?.params.date_basis === appliedBasis, JSON.stringify(cReq?.params));
    if (cReq) knownSigs.add(cFresh[0]);
    const c1 = rkCount();
    await clickSel(cdp, '.rk-period .rk-seg button:nth-child(2)'); // 월별
    await waitRkDelta(cdp, c1);
    const mReqs = rkNew(c1);
    const mFresh = [...new Set(mReqs.map(sig))].filter((s) => !knownSigs.has(s));
    check('C3', 'month switch is immediate', mFresh.length === 1 && reqBySig(c1, mFresh[0])?.params.period === 'month', JSON.stringify(mFresh.length === 1 ? reqBySig(c1, mFresh[0])?.params : null));
    const sMonth = await evaluate(cdp, ...state());
    check('C4', 'month label follows applied month', typeof sMonth.monthLabel === 'string' && sMonth.monthLabel.length > 0, `label=${sMonth.monthLabel}`);

    // ── D. FULL URL restoration (direct entry) ──
    const durl = '?screen=rankings&rk_theme=unlucky&rk_metric=partial_rate&rk_period=month&rk_month=2023-07&rk_basis=report_date&rk_category=traffic&rk_min=3';
    const d0 = rkCount();
    await seedAndGoto(cdp, seedId, durl, 'dark');
    await waitRkDelta(cdp, d0);
    const dReqs = rkNew(d0);
    const sD = await evaluate(cdp, ...state());
    check('D1', 'request restores month/basis/metric/min from URL', dReqs.length >= 1 && dReqs[0].params.month === '2023-07' && dReqs[0].params.date_basis === 'report_date' && dReqs[0].params.metric === 'partial_rate' && dReqs[0].params.min_reports === '3', JSON.stringify(dReqs[0]?.params));
    check('D2', 'heading shows 2023년 7월 + 일부수용 비율', (sD.heading ?? '').includes('2023년 7월') && (sD.heading ?? '').includes('일부수용 비율'), `heading=${sD.heading}`);
    check('D3', '불운 tab pressed, category traffic, month label', sD.tabs.find((t) => t.t === '불운 랭킹')?.p === 'true' && sD.category === 'traffic' && (sD.monthLabel ?? '').includes('2023년 7월'), JSON.stringify({ tabs: sD.tabs, cat: sD.category, ml: sD.monthLabel }));
    check('D4', 'details controls show report_date + min 3 (actual React state)', sD.basis === 'report_date' && sD.min === '3', `basis=${sD.basis} min=${sD.min}`);
    const d1 = rkCount();
    await cdp.send('Page.reload'); 
    await waitFor(cdp, `() => !!document.querySelector('.rk-page')`);
    await waitRkDelta(cdp, d1);
    const sR = await evaluate(cdp, ...state());
    check('D5', 'reload preserves full state (not URL string only)', sR.basis === 'report_date' && sR.min === '3' && (sR.heading ?? '').includes('2023년 7월'), `basis=${sR.basis} min=${sR.min} heading=${sR.heading}`);
    // rk_min=1 (the reported string-"1" case)
    const e0 = rkCount();
    await seedAndGoto(cdp, seedId, '?screen=rankings&rk_min=1', 'dark');
    await waitRkDelta(cdp, e0);
    const eReqs = rkNew(e0);
    const sE = await evaluate(cdp, ...state());
    check('D6', 'saved rk_min=1 restores numeric 1 (no fallback to default)', eReqs[0]?.params.min_reports === '1' && sE.min === '1', `req=${JSON.stringify(eReqs[0]?.params)} minInput=${sE.min}`);

    // ── E. invalid rk_min fails closed ──
    const f0 = rkCount();
    await seedAndGoto(cdp, seedId, '?screen=rankings&rk_theme=unlucky&rk_metric=partial_rate&rk_min=abc', 'dark');
    await waitRkDelta(cdp, f0);
    const fReqs = rkNew(f0);
    const sF = await evaluate(cdp, ...state());
    check('E1', 'invalid rk_min fails closed to default (min 1, default theme/metric)', fReqs[0]?.params.min_reports === '1' && sF.min === '1' && sF.tabs.find((t) => t.t === '신고 랭킹')?.p === 'true', `req=${JSON.stringify(fReqs[0]?.params)} min=${sF.min}`);

    // ── F. map→rank in-app + back/forward ──
    const fA = rkCount();
    await seedAndGoto(cdp, seedId, durl, 'dark');
    await waitRkDelta(cdp, fA);
    const railRank = await evaluate(cdp, `() => !!document.querySelector('[aria-label="유저 랭킹"]')`);
    check('F0', 'rail rankings entry exists', railRank === true, '');
    const dashBtn = await evaluate(cdp, `() => {
      const els = [...document.querySelectorAll('nav [aria-label], nav button')].map(e => e.getAttribute('aria-label') || e.textContent.trim());
      return els;
    }`);
    // go to dashboard via rail first item, then back to rankings via rail
    await clickSel(cdp, 'nav button:first-child');
    await sleep(800);
    const sMap = await evaluate(cdp, `() => ({ screen: document.querySelector('main')?.dataset.screen, url: location.search })`);
    const rkKept = new URLSearchParams(sMap.url).get('rk_month');
    const fB = rkCount();
    await clickSel(cdp, '[aria-label="유저 랭킹"]');
    await waitFor(cdp, `() => !!document.querySelector('.rk-page')`);
    await waitRkDelta(cdp, fB);
    const sBack = await evaluate(cdp, ...state());
    check('F1', 'map screen keeps rk_* in URL', sMap.screen === 'dashboard' && rkKept === '2023-07', `screen=${sMap.screen} rk_month=${rkKept}`);
    check('F2', 'map→rank restores full applied state', sBack.basis === 'report_date' && sBack.min === '3' && (sBack.heading ?? '').includes('2023년 7월'), `basis=${sBack.basis} min=${sBack.min} heading=${sBack.heading}`);
    await evaluate(cdp, `() => { history.back(); return true; }`);
    await sleep(900);
    const sHistBack = await evaluate(cdp, `() => ({ screen: document.querySelector('main')?.dataset.screen, url: location.search })`);
    await evaluate(cdp, `() => { history.forward(); return true; }`);
    await sleep(900);
    const sHistFwd = await evaluate(cdp, `() => ({ screen: document.querySelector('main')?.dataset.screen, basis: document.querySelector('.rk-page select[aria-label="날짜 기준"]')?.value ?? null })`);
    check('F3', 'history back leaves rankings', sHistBack.screen === 'dashboard', JSON.stringify(sHistBack));
    check('F4', 'history forward returns to rankings with state', sHistFwd.screen === 'rankings' && sHistFwd.basis === 'report_date', JSON.stringify(sHistFwd));

    // ── G. rapid 20-cycle open/edit stress ──
    const gA = rkCount();
    await seedAndGoto(cdp, seedId, '?screen=rankings', 'dark');
    await waitRkDelta(cdp, gA);
    await sleep(1200); // let StrictMode remount noise settle; record settled signature
    const gBase = [...newSigs(gA).keys()].slice(-1)[0];
    const g0 = rkCount();
    const stress = await evaluate(cdp, `async () => {
      const out = [];
      const summary = document.querySelector('.rk-page details.rk-advanced > summary');
      const det = document.querySelector('.rk-page details.rk-advanced');
      const sel = document.querySelector('.rk-page select[aria-label="날짜 기준"]');
      const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      for (let i = 0; i < 20; i++) {
        summary.click(); // native toggle, like a fast user
        await new Promise((r) => setTimeout(r, 25));
        // End on report_date (i=19 odd) so the final apply differs from the
        // default applied query — an identical apply is dropped by design.
        const want = i % 2 === 0 ? 'completed_date' : 'report_date';
        set.call(sel, want);
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 25));
        out.push({ i, open: det.open, value: sel.value, want });
      }
      return out;
    }`);
    const bad = stress.filter((r) => r.value !== r.want);
    check('G1', '20 rapid open/edit cycles keep every first edit', bad.length === 0, `bad=${bad.length}/20`);
    const gSigs = [...newSigs(g0).keys()];
    check('G2', 'rapid edits fire no new query', gSigs.every((s) => s === gBase), `newSigs=${gSigs.length}`);
    const g1 = rkCount();
    const lastWant = stress[19].want;
    const gOpen = await evaluate(cdp, `() => document.querySelector('.rk-page details.rk-advanced')?.open === true`);
    if (!gOpen) {
      await clickSel(cdp, '.rk-page details.rk-advanced > summary');
      await waitFor(cdp, `() => document.querySelector('.rk-page details.rk-advanced')?.open === true`);
      await sleep(300);
    }
    await clickSel(cdp, 'details.rk-advanced .rk-advanced-body .primary-button');
    const gFresh = await waitForNewSig(g1, new Set([gBase]));
    const gReq = gFresh.length === 1 ? reqBySig(g1, gFresh[0]) : undefined;
    check('G3', 'one apply after stress sends exactly one new query with latest basis', gFresh.length === 1 && gReq?.params.date_basis === lastWant, `want=${lastWant} got=${JSON.stringify(gReq?.params)}`);
    await shot(cdp, '1440-dark-stress');

    // ── H. 390 light (keyboard FAST) + 390 dark ──
    await setViewport(cdp, 390, 844, true);
    const hA = rkCount();
    await seedAndGoto(cdp, seedId, '?screen=rankings', 'light');
    await waitRkDelta(cdp, hA);
    await sleep(1200);
    const hBase = [...newSigs(hA).keys()].slice(-1)[0];
    const h0 = rkCount();
    await clickSel(cdp, 'details.rk-advanced > summary');
    await waitFor(cdp, `() => document.querySelector('details.rk-advanced')?.open === true`);
    await keyTab(cdp); await sleep(150); await keyDown(cdp); await sleep(700);
    const sH = await evaluate(cdp, ...state());
    check('H1', '390 light keyboard: 신고일 survives', sH.basis === 'report_date', `basis=${sH.basis}`);
    const hSigs = [...newSigs(h0).keys()];
    check('H2', '390 light keyboard edit sends no new query', hSigs.every((s) => s === hBase), `newSigs=${hSigs.length}`);
    await keyTab(cdp); await keyTab(cdp); await keySpace(cdp);
    const hFresh = await waitForNewSig(h0, new Set([hBase]));
    const hReq = hFresh.length === 1 ? reqBySig(h0, hFresh[0]) : undefined;
    check('H3', '390 light keyboard apply: one new query, report_date', hFresh.length === 1 && hReq?.params.date_basis === 'report_date', JSON.stringify(hReq?.params));
    await sleep(500);
    await shot(cdp, '390-light-fast');
    const hB = rkCount();
    await seedAndGoto(cdp, seedId, '?screen=rankings', 'dark');
    await waitRkDelta(cdp, hB);
    await sleep(400);
    await shot(cdp, '390-dark-entry');

    // account/session unchanged + no page overflow spot checks
    const sess = await evaluate(cdp, `() => { try { return JSON.parse(localStorage.getItem('cm-map-auth-v1')).user.id; } catch { return null; } }`);
    check('I1', 'account session unchanged across all scenarios', sess === E2E_UID, `uid=${sess}`);
    const overflow = await evaluate(cdp, `() => document.documentElement.scrollWidth <= window.innerWidth`);
    check('I2', '390 no page-level horizontal overflow', overflow === true, '');

    writeFileSync(`${EVID}/checks.json`, JSON.stringify({ chrome: chromeVersion, commit: '7542cded652c91835f3421f394f4466b6e9b0c6d', origin: ORIGIN, checks }, null, 2));
    writeFileSync(`${EVID}/network.json`, JSON.stringify(requests.map((r) => ({ url: r.url, params: r.params, method: r.method, status: r.status })), null, 2));
    writeFileSync(`${EVID}/console.json`, JSON.stringify({ consoleErrors, pageErrors }, null, 2));
    console.log(`\nTOTAL ${checks.length} checks, FAIL=${checks.filter((c) => c.status === 'FAIL').length}`);
    console.log(`requests captured: ${requests.length}, consoleErrors: ${consoleErrors.length}, pageErrors: ${pageErrors.length}`);
  } finally {
    chrome.kill();
  }
}

main().catch((e) => { console.error('DRIVER ERROR', e); process.exit(2); });
