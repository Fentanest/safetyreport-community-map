// C03 assertion runner for the local browser checks.
// - every declared ID starts as NOT_RUN; a step marks its IDs PASS/FAIL through check(); an exception inside a step
//   marks the step's still-open IDs FAIL (never silently swallowed);
// - each run writes a NEW file runs/<run_id>.json (+ latest.json copy); nothing is merged from an earlier run;
// - console errors / page errors are FAIL unless the step declared them as expected (e.g. an injected 429);
// - the process exits 1 when any ID failed (or when SELFTEST_WRONG makes one expectation deliberately wrong).
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function createRun({ dir, suite, ids, meta }) {
  mkdirSync(join(dir, 'runs'), { recursive: true });
  const runId = `${suite}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  let commit = 'unknown';
  try { commit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim(); } catch { /* ignore */ }
  let dirty = false;
  try { dirty = execSync('git status --porcelain', { encoding: 'utf8' }).trim().length > 0; } catch { /* ignore */ }
  const results = Object.fromEntries(ids.map((id) => [id, { status: 'NOT_RUN', checks: [] }]));
  const only = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
  const selftest = process.env.SELFTEST_WRONG || null;
  const record = { run_id: runId, suite, commit, working_tree_dirty: dirty, started_at: new Date().toISOString(), only: only ? [...only] : null,
    selftest_wrong: selftest, environment: meta, results, steps: {} };

  const mark = (id, ok, detail) => {
    if (!results[id]) results[id] = { status: 'NOT_RUN', checks: [] };
    results[id].checks.push({ ok, ...detail });
    if (!ok) results[id].status = 'FAIL';
    else if (results[id].status !== 'FAIL') results[id].status = 'PASS';
  };

  /** check(id, label, actual, predicate|expected) — deep equality for non-functions */
  const check = (id, label, actual, expected) => {
    let ok;
    let expectText;
    if (typeof expected === 'function') { ok = !!expected(actual); expectText = expected.toString(); }
    else { ok = JSON.stringify(actual) === JSON.stringify(expected); expectText = expected; }
    // self-test: flip exactly the named check to prove a wrong expectation fails the run
    if (selftest && selftest === `${id}:${label}`) ok = !ok;
    mark(id, ok, { label, actual, expected: expectText });
    if (!ok) console.log(`  FAIL ${id} · ${label}: got ${JSON.stringify(actual)?.slice(0, 300)}`);
    return ok;
  };

  /** step(name, ids, fn, { expectedConsole: [regex…] }) */
  const step = async (name, stepIds, fn, opts = {}) => {
    if (only && !only.has(name)) { record.steps[name] = { status: 'NOT_RUN' }; return; }
    const t0 = Date.now();
    const consoleSeen = [];
    const ctx = { check, consoleSeen, note: (k, v) => { (record.steps[name].notes ||= {})[k] = v; } };
    record.steps[name] = { status: 'RUNNING', ids: stepIds };
    try {
      await fn(ctx);
      // unexpected console / page errors fail every ID of the step
      const allowed = opts.expectedConsole ?? [];
      const unexpected = consoleSeen.filter((m) => !allowed.some((re) => re.test(m)));
      for (const id of stepIds) check(id, 'no unexpected console/page error', unexpected, []);
      record.steps[name].status = 'DONE';
    } catch (e) {
      record.steps[name].status = 'ERROR';
      record.steps[name].error = String(e && e.stack || e).slice(0, 2000);
      for (const id of stepIds) if (results[id].status !== 'FAIL') mark(id, false, { label: 'step threw before completing', actual: String(e).slice(0, 300) });
      console.log(`  ERROR in ${name}: ${String(e).slice(0, 300)}`);
    }
    record.steps[name].ms = Date.now() - t0;
    console.log(`${name}: ${stepIds.map((id) => `${id}=${results[id].status}`).join(' ')}`);
  };

  /** environment prevents the check (no SDK access, no key, unregistered domain…): BLOCKED with the reason, never PASS */
  const block = (stepIds, reason) => {
    for (const id of stepIds) if (results[id].status === 'NOT_RUN') results[id] = { status: 'BLOCKED', reason, checks: [] };
    console.log(`BLOCKED ${stepIds.join(',')}: ${reason}`);
  };

  const finish = () => {
    record.finished_at = new Date().toISOString();
    const counts = {};
    for (const r of Object.values(results)) counts[r.status] = (counts[r.status] ?? 0) + 1;
    record.summary = counts;
    const file = join(dir, 'runs', `${runId}.json`);
    writeFileSync(file, JSON.stringify(record, null, 2));
    writeFileSync(join(dir, 'latest.json'), JSON.stringify(record, null, 2));
    console.log(`summary ${JSON.stringify(counts)} → ${file}`);
    const failed = Object.values(results).some((r) => r.status === 'FAIL');
    // BLOCKED alone is not a pass either: exit 2 so CI cannot read it as green
    const blocked = !failed && Object.values(results).some((r) => r.status === 'BLOCKED');
    process.exitCode = failed ? 1 : blocked ? 2 : 0;
    return failed;
  };
  return { runId, record, check, step, block, finish };
}

/** attach console/page error capture of a page to the current step context */
export function captureConsole(page, ctx) {
  page.on('console', (m) => { if (m.type() === 'error') ctx.consoleSeen.push(m.text()); });
  page.on('pageerror', (e) => ctx.consoleSeen.push(`pageerror: ${e.message}`));
}

/** bounded polling instead of a blind sleep: resolves with the value once predicate(value) holds, else the last value */
export async function waitFor(get, predicate, { timeout = 8000, interval = 100 } = {}) {
  const end = Date.now() + timeout;
  let last;
  for (;;) {
    last = await get();
    if (predicate(last)) return last;
    if (Date.now() > end) return last;
    await new Promise((r) => setTimeout(r, interval));
  }
}
