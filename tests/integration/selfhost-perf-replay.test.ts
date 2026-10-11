/** 2026-10-11 self-hosted measurement: replay real v1/v2 SQL sources through the current Edge handler.
 * Runs only with SELFHOST_PERF_SOURCE_DIR (sources stay outside the repository; never committed). */
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createScreenHandler } from '../../server/screenHandler';

const dir = process.env.SELFHOST_PERF_SOURCE_DIR;
const user = '00000000-0000-4000-8000-000000000001';
const token = `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: user, role: 'authenticated',
  aud: 'authenticated', session_id: '11111111-2222-4333-8444-555555555555' })).toString('base64url')}.sig`;
const panels = [{ id: 'entities', path: 'entities', params: { kind: 'agency' } }, { id: 'laws', path: 'laws', params: {} },
  { id: 'compare', path: 'compare', params: {} }, { id: 'places', path: 'places', params: { view_bbox: '126,36,129,39' } },
  { id: 'prefix', path: 'entity-prefix', params: { kind: 'agency', through_page: '2' } }];

async function replay(text: string, scope: Record<string, string>) {
  const t = performance.now(), source = JSON.parse(text), parse_ms = performance.now() - t;
  const handler = createScreenHandler({ enabled: true, allowedOrigins: [], jwtIssuer: null,
    getUser: async () => ({ id: user, isAnonymous: false }), rpc: async name => name.endsWith('rate_limit') ? true : source });
  const q = new URLSearchParams({ ...scope, panels: JSON.stringify(panels) });
  const start = performance.now();
  const response = await handler(new Request(`https://local.invalid/my-analytics/screen?${q}`, { headers: { Authorization: `Bearer ${token}` } }));
  const body = await response.text();
  return { status: response.status, body, parse_ms, handler_ms: performance.now() - start };
}

describe.skipIf(!dir)('self-hosted v1/v2 source replay', () => {
  it('produces identical public packets and records parse + handler time', async () => {
    const cases = JSON.parse(readFileSync(`${dir}/cases.json`, 'utf8')) as { key: string; scope: Record<string, string> }[];
    const out: Record<string, unknown> = {};
    for (const c of cases) {
      const packets: Record<string, string> = {}, runs: Record<string, unknown[]> = {}, bytes: Record<string, number> = {};
      for (const enc of ['v1', 'v2']) {
        const text = readFileSync(`${dir}/${c.key}-${enc}.json`, 'utf8');
        bytes[enc] = Buffer.byteLength(text);
        runs[enc] = [];
        for (let i = 0; i < 4; i++) {
          const r = await replay(text, c.scope);
          expect(r.status).toBe(200);
          if (i === 0) packets[enc] = r.body; else runs[enc].push({ parse_ms: +r.parse_ms.toFixed(1), handler_ms: +r.handler_ms.toFixed(1) });
        }
      }
      expect(JSON.parse(packets.v2)).toEqual(JSON.parse(packets.v1));
      out[c.key] = { source_bytes: bytes, public_bytes: Buffer.byteLength(packets.v1), packet_equal: true, runs };
    }
    if (process.env.SELFHOST_PERF_OUT) writeFileSync(process.env.SELFHOST_PERF_OUT, JSON.stringify({
      runtime: `Node ${process.version}; real self-hosted SQL sources; auth/RPC stubbed; not hosted Edge (Deno)`, cases: out }, null, 1) + '\n');
  }, 600_000);
});
