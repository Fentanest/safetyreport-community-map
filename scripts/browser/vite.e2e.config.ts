/**
 * LOCAL browser-verification stack only (never used by `npm run build`/Pages).
 *
 * Serves the real frontend in *live* data mode and answers the Edge routes in-process with the REAL handlers
 * (server/publicHandler.ts, server/personalHandler.ts) over deterministic synthetic facts (src/data/demoEngine.ts).
 * Every map/filter change therefore produces real HTTP requests that Playwright can count, delay, fail (429/5xx/409)
 * or reorder. Auth is a local fake: the page is seeded with a synthetic Supabase session whose unsigned token is
 * accepted only by this server. Nothing here is a production credential.
 *
 *   E2E_PORT=5190 npx vite --config scripts/browser/vite.e2e.config.ts
 */
import { defineConfig, type Plugin, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import type { IncomingMessage, ServerResponse } from 'node:http';

const PORT = Number(process.env.E2E_PORT || 5190);
const ORIGIN = `http://127.0.0.1:${PORT}`;
export const E2E_UID = '11111111-2222-4333-8444-555555555555';
/** C01: a second synthetic account with the SAME nickname and its own shared reports */
export const E2E_UID_B = '22222222-3333-4444-8555-666666666666';
const SESSION = '66666666-7777-4888-9999-aaaaaaaaaaaa';

process.env.VITE_DATA_MODE = 'live';
process.env.VITE_PUBLIC_ANALYTICS_URL = `${ORIGIN}/functions/v1`;
process.env.VITE_SUPABASE_URL = ORIGIN;
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'e2e-local-publishable';
process.env.VITE_KAKAO_MAP_JS_KEY = process.env.VITE_KAKAO_MAP_JS_KEY || 'mock-e2e-key';

interface Injection { route: string; status: number; times: number; retryAfter?: number; delayMs?: number }
interface LogEntry { t: number; route: string; params: Record<string, string>; status: number }

function e2eApi(): Plugin {
  const log: LogEntry[] = [];
  let injections: Injection[] = [];
  /** per-route artificial latency (ms), e.g. { dashboard: 400 } to create overlapping requests */
  let delays: Record<string, number> = {};
  /** requests counted per minute window, like internal_analytics_v2_rate_limit (60/min) */
  const windows = new Map<string, number>();
  let version = 'e2e-synthetic-1';
  let access: 'ok' | 'revoked' = 'ok';
  /** date-basis-dashboard: 'oracle' serves the cohort oracle (u1 → E2E_UID, u2 → E2E_UID_B) instead of the synthetic year */
  let dataset: 'synthetic' | 'oracle' | 'dense' | 'managers' = 'synthetic';

  return {
    name: 'cm-e2e-api',
    configureServer(server: ViteDevServer) {
      const load = async () => {
        const [pub, per, demo, oracle] = await Promise.all([
          server.ssrLoadModule('/server/publicHandler.ts'),
          server.ssrLoadModule('/server/personalHandler.ts'),
          server.ssrLoadModule('/src/data/demoEngine.ts'),
          server.ssrLoadModule('/src/data/demoOracle.ts'),
        ]);
        const boundsOf = (list: Array<Record<string, unknown>>) => {
          const span = (k: string) => {
            const d = list.map(f => f[k]).filter((x): x is string => typeof x === 'string').sort();
            return { min: d[0] ?? null, max: d[d.length - 1] ?? null };
          };
          return { report_date: span('report_date'), completed_date: span('completed_date') };
        };
        if (dataset === 'dense') {
          // D10 check: 1,100 synthetic addresses (> MAP_NODE_LIMIT, so the server compacts and the map refines), all reported in
          // January 2026 and answered in March 2026 — a January report-date view has them all, a January answer-date view none
          const tpl = (demo.demoFacts() as Array<Record<string, unknown>>).find(f => f.completed_date && f.status === 'accepted') as Record<string, unknown>;
          const facts = Array.from({ length: 1100 }, (_, i) => ({ ...tpl, fact_identity: `dense-${i}`, contributor_id: `dense-user-${i % 7}`,
            address: `서울특별시 중구 합성로 ${i + 1}`, lat: 37.55 + (i % 40) * 0.0012, lng: 126.97 + Math.floor(i / 40) * 0.0012, point_key: null,
            report_date: `2026-01-${String(1 + (i % 28)).padStart(2, '0')}`, completed_date: `2026-03-${String(1 + (i % 28)).padStart(2, '0')}` }));
          basisBounds = boundsOf(facts);
          bounds = { min: '2026-01-01', max: '2026-03-28' };
          return { pub, per, facts };
        }
        if (dataset === 'managers') {
          // 담당자별 처리 현황 (2026-09-30): 118 managers at one address; 김지원 4th (강서) and 105th (양천, beyond the first 100)
          const facts = (demo.managersFacts() as Array<Record<string, unknown>>).map((f, i) => ({ ...f, contributor_id: i % 5 === 0 ? E2E_UID : f.contributor_id }));
          basisBounds = boundsOf(facts);
          bounds = { min: '2026-06-01', max: '2026-09-24' };
          return { pub, per, facts };
        }
        if (dataset === 'oracle') {
          const facts = (oracle.oracleDemoFacts() as Array<Record<string, unknown>>).map(f =>
            f.contributor_id === 'u1' ? { ...f, contributor_id: E2E_UID } : f.contributor_id === 'u2' ? { ...f, contributor_id: E2E_UID_B } : f);
          basisBounds = boundsOf(facts);
          bounds = { min: '2025-05-20', max: '2025-09-03' };
          return { pub, per, facts };
        }
        const recent = (demo.demoFacts() as Array<Record<string, unknown>>).map(f =>
          f.contributor_id === demo.DEMO_VIEWER_ID ? { ...f, contributor_id: E2E_UID }
            : f.contributor_id === 'synthetic-c03' ? { ...f, contributor_id: E2E_UID_B } : f);
        // R1 (2026-09-30): synthetic long history 2014-10..2024-09 (every 7th recent fact shifted back 2..10 years) so
        // the 12-year range and 전체 기간 are exercised end to end. Synthetic only.
        const shift = (d: unknown, years: number) => typeof d === 'string'
          ? `${Number(d.slice(0, 4)) - years}${d.slice(4) === '-02-29' ? '-02-28' : d.slice(4)}` : d;
        const older = recent.filter((_, i) => i % 7 === 0).map((f, i) => {
          const years = 2 + (i % 9);
          return { ...f, fact_identity: `${String(f.fact_identity)}-h${years}`, report_date: shift(f.report_date, years), completed_date: shift(f.completed_date, years) };
        }).filter(f => String(f.report_date) >= '2014-10-01');
        // R3: one synthetic address answered by 110 different managers, so the per-manager chart's zoom, the
        // 100-row first page and "나머지 담당자 불러오기" are exercised. Synthetic only.
        const tpl = recent.find(f => f.completed_date && f.status === 'accepted') as Record<string, unknown>;
        const crowd = Array.from({ length: 110 }, (_, i) => ({
          ...tpl, fact_identity: `e2e-crowd-${i}`, contributor_id: `e2e-crowd-user-${i % 9}`,
          address: '서울특별시 중구 세종대로 110 (합성 검수 주소)', lat: 37.5663, lng: 126.9779, point_key: null,
          manager_key: `m1:crowd-${String(i).padStart(3, '0')}`, manager_name: `합성담당${String(i + 1).padStart(3, '0')}`,
          status: ['accepted', 'partial', 'rejected', 'completed_unknown'][i % 4], disposition: i % 3 === 0 ? 'fine' : i % 3 === 1 ? 'warning' : 'none',
          report_date: '2026-09-01', completed_date: '2026-09-10',
        }));
        const facts = [...recent, ...older, ...crowd];
        // like internal_analytics_v2_state after 202609300100: bounds computed from the publicly eligible facts
        const dates = facts.flatMap(f => [f.report_date, f.completed_date]).filter((d): d is string => typeof d === 'string').sort();
        bounds = { min: dates[0], max: dates[dates.length - 1] };
        basisBounds = boundsOf(facts);
        return { pub, per, facts };
      };
      let bounds = { min: '2014-10-01', max: '2026-09-24' };
      let basisBounds: unknown = null;
      const state = () => ({
        dataset_version: version, ready: true, source_updated_at: '2026-09-24T00:00:00Z', generated_at: '2026-09-24T00:00:00Z',
        published_at: null, data_min: bounds.min, data_max: bounds.max,
        coverage_note: '로컬 검수용 합성 자료입니다. 실제 신고 통계가 아닙니다.', dedupe_policy_version: 'e2e',
        basis_bounds: basisBounds,
      });
      const getUser = async (token: string) => {
        try {
          const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
          return (claims.sub === E2E_UID || claims.sub === E2E_UID_B) && access === 'ok' ? { id: claims.sub, isAnonymous: false } : null;
        } catch { return null; }
      };
      const toRequest = async (req: IncomingMessage): Promise<Request> => {
        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
        return new Request(`${ORIGIN}${req.url}`, { method: req.method, headers });
      };
      const send = async (res: ServerResponse, response: Response) => {
        res.statusCode = response.status;
        response.headers.forEach((v, k) => res.setHeader(k, v));
        res.end(Buffer.from(await response.arrayBuffer()));
      };

      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url || '/', ORIGIN);
        if (url.pathname.startsWith('/__e2e/')) {
          const body = await new Promise<string>(r => { let s = ''; req.on('data', c => { s += c; }); req.on('end', () => r(s)); });
          const cmd = url.pathname.slice('/__e2e/'.length);
          if (cmd === 'log') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(log)); return; }
          if (cmd === 'reset') { log.length = 0; injections = []; delays = {}; windows.clear(); version = 'e2e-synthetic-1'; access = 'ok'; dataset = 'synthetic'; res.end('{}'); return; }
          if (cmd === 'dataset') { const n = JSON.parse(body).name; dataset = n === 'oracle' || n === 'dense' || n === 'managers' ? n : 'synthetic'; version = `e2e-${dataset}-1`; res.end('{}'); return; }
          if (cmd === 'inject') { injections.push(JSON.parse(body)); res.end('{}'); return; }
          if (cmd === 'delay') { delays = JSON.parse(body); res.end('{}'); return; }
          if (cmd === 'version') { version = JSON.parse(body).version; res.end('{}'); return; }
          if (cmd === 'access') { access = JSON.parse(body).access; res.end('{}'); return; }
          res.statusCode = 404; res.end('{}'); return;
        }
        if (url.pathname.startsWith('/auth/v1/')) {
          res.statusCode = 404; res.setHeader('Content-Type', 'application/json'); res.end('{"msg":"local e2e auth: no network auth"}'); return;
        }
        const pubMatch = /^\/functions\/v1\/public-analytics\/(.+)$/.exec(url.pathname);
        const perMatch = /^\/functions\/v1\/my-analytics\//.test(url.pathname);
        if (!pubMatch && !perMatch) { next(); return; }
        const route = pubMatch ? pubMatch[1] : 'my-analytics';
        const routeKey = route.startsWith('places/') ? 'places/:key' : route.startsWith('points/') ? 'points/:key' : route;
        const entry: LogEntry = { t: Date.now(), route: routeKey, params: Object.fromEntries(url.searchParams), status: 0 };
        if (req.method !== 'OPTIONS') log.push(entry);
        const delay = delays[routeKey] ?? delays['*'] ?? 0;
        if (delay && req.method !== 'OPTIONS') await new Promise(r => setTimeout(r, delay));
        const inj = req.method === 'OPTIONS' ? undefined : injections.find(i => (i.route === routeKey || i.route === '*') && i.times > 0);
        if (inj) {
          inj.times -= 1;
          if (inj.delayMs) await new Promise(r => setTimeout(r, inj.delayMs));
          entry.status = inj.status;
          const code = inj.status === 429 ? 'RATE_LIMITED' : inj.status === 409 ? 'DATASET_CHANGED' : inj.status === 401 ? 'session_expired' : 'AGGREGATE_NOT_READY';
          res.statusCode = inj.status;
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Access-Control-Allow-Origin', ORIGIN);
          res.setHeader('Access-Control-Expose-Headers', 'Retry-After');
          if (inj.retryAfter) res.setHeader('Retry-After', String(inj.retryAfter));
          res.end(JSON.stringify({ error: { code, message: 'e2e injected' } }));
          return;
        }
        try {
          const { pub, per, facts } = await load();
          const minute = Math.floor(Date.now() / 60000);
          if (pubMatch) {
            const handler = pub.createPublicHandler({
              getState: async () => state(),
              getFacts: async () => facts,
              allowRequest: async () => {
                const key = `pub:${minute}`;
                const n = (windows.get(key) ?? 0) + 1;
                windows.set(key, n);
                return n <= 60;
              },
            }, {
              allowedOrigins: [ORIGIN], jwtIssuer: null, getUser,
              viewer: async () => ({ user_ok: true, kakao: true, session: true, contributor: 'active', has_public_facts: true, public_fact_count: 12 }),
            });
            const response = await handler(await toRequest(req));
            response.headers.set('Access-Control-Expose-Headers', 'Retry-After');
            entry.status = response.status;
            await send(res, response);
            return;
          }
          const handler = per.createPersonalHandler({
            enabled: true, allowedOrigins: [ORIGIN], jwtIssuer: null, getUser,
            rpc: async (name: string) => {
              if (name === 'internal_community_ingest_rate_limit') return true;
              return { state: state(), viewer: { user_ok: true, kakao: true, session: true, contributor: 'active', has_public_facts: true }, facts };
            },
          });
          const response = await handler(await toRequest(req));
          entry.status = response.status;
          await send(res, response);
        } catch (e) {
          entry.status = 599;
          res.statusCode = 500;
          res.end(JSON.stringify({ error: { code: 'e2e_server_error', message: String((e as Error).message) } }));
        }
      });
    },
  };
}

export default defineConfig({
  root: process.cwd(),
  plugins: [react(), e2eApi()],
  server: { host: '127.0.0.1', port: PORT, strictPort: true },
  logLevel: 'warn',
});
