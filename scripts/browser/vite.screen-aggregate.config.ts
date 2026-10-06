/** Local-only browser replay of rollback-only SQL exports. Never installed or deployed. */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import config from './vite.e2e.config.ts';
import type { Plugin } from 'vite';
const port = Number(process.env.E2E_PORT || 5197);
const origin = `http://127.0.0.1:${port}`;
const user = createHash('md5').update('cohort-timeout-user-1').digest('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
const fixture: Plugin = {
  name: 'screen-sql-fixture',
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      const url = new URL(req.url || '/', origin);
      if (url.pathname.endsWith('/public-analytics/meta')) {
        const source = JSON.parse(readFileSync('.agent-runtime/screen-aggregate/30000-diverse-year-after.json', 'utf8'));
        const { createPublicHandler } = await server.ssrLoadModule('/server/publicHandler.ts');
        const handler = createPublicHandler({ getState: async () => source.state, getFacts: async () => [], allowRequest: async () => true },
          { allowedOrigins: [origin], jwtIssuer: null, getUser: async () => ({ id: user, isAnonymous: false }), viewer: async () => source.viewer });
        const response = await handler(new Request(url, { headers: req.headers as Record<string, string> }));
        res.statusCode = response.status;
        response.headers.forEach((v: string, k: string) => res.setHeader(k, v));
        res.end(await response.text()); return;
      }
      if (!url.pathname.endsWith('/my-analytics/screen')) return next();
      const q = url.searchParams;
      // Reject a scope for which this fixture has no SQL result. Never relabel numbers from another scope.
      const window = q.get('start') === '2019-04-23' ? 'all' : q.get('start') === '2025-10-07' ? 'year' : null;
      if (!window || q.get('end') !== '2026-10-06' || q.get('date_basis') !== 'completed_date' ||
        !['all', null].includes(q.get('category')) || ['agency_key','manager_key','region_code','bbox','law'].some(k => q.has(k))) {
        res.statusCode = 503; res.end(JSON.stringify({ error: { code: 'AGGREGATE_NOT_READY', message: 'Scope absent from SQL fixture' } })); return;
      }
      try {
        const source = JSON.parse(readFileSync(`.agent-runtime/screen-aggregate/30000-diverse-${window}-after.json`, 'utf8'));
        const { createScreenHandler } = await server.ssrLoadModule('/server/screenHandler.ts');
        const handler = createScreenHandler({ enabled: true, allowedOrigins: [origin], jwtIssuer: null,
          getUser: async () => ({ id: user, isAnonymous: false }),
          rpc: async (name: string) => name.endsWith('rate_limit') ? true : source });
        const response = await handler(new Request(url, { headers: req.headers as Record<string, string> }));
        res.statusCode = response.status;
        response.headers.forEach((v: string, k: string) => res.setHeader(k, v));
        res.end(await response.text());
      } catch { res.statusCode = 500; res.end('fixture failed'); }
    });
  },
};
export default { ...config, cacheDir: '.agent-runtime/screen-aggregate/vite-cache', plugins: [fixture, ...(config.plugins || [])] };
