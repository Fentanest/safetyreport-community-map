# request_mode: review / policy cm-2026-09-24

Read PROJECT_RULES.md, MUSE.md, .agents/skills/cm-browser-review/SKILL.md and .agents/skills/cm-sol-muse/SKILL.md.
You are the Muse contributor browser reviewer. Do not edit product files or run migrations/deployments.
Only write evidence and report under docs/implementation/analytics-row-limit-20261014/muse/ in this review worktree.
Candidate = this worktree HEAD. Sol is editing a different worktree.
Task: verify the removal of the analytics 100,000-report cap on a real local browser.
SQL tests export synthetic aggregates in /tmp/cm-cache-browser-year.json and /tmp/cm-cache-browser-all.json.
Wait for /tmp/cm-row-limit-evidence.json to exist, and verify its expected > 100000 before using the fixture.
Start your own Vite server on 5209 with:
E2E_PORT=5209 npx vite --config scripts/browser/vite.screen-result-cache.config.ts --host 127.0.0.1 --port 5209 --strictPort
Use E2E_PORT=5209 node scripts/browser/verify_screen_result_cache.mjs as a starting browser harness.
It launches Chrome and checks 390/1440/1920/2560, dark/light, count, overflow, table sort, compare, whole-period navigation, console/network.
You may adapt a COPY of the harness in your evidence directory if selectors changed. Do not alter the application.
Read current evidence timestamp: do not count stale /tmp/cm-cache-browser files as this task's evidence.
Open generated screenshots using your image-reading tool. Copy evidence to your owned directory.
Capture actual model/session/tool versions, candidate commit, screenshots, interactions, network statuses, console errors, limits.
This is synthetic SQL + real handler + real browser with fake auth/mock Kakao. It is NOT production verification.
Report PASS/FAIL/BLOCKED honestly and return exact paths. Stop your own Vite process afterward.
Do not spawn other models, change host permissions or use API billing.
