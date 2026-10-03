// Reproducible CPU/serialization baseline over synthetic facts; no database or production calls.
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createPublicHandler } from '../../server/publicHandler';
import type { PrivateFact } from '../../server/aggregate';
import { fixtureAccess, viewerRequest } from '../product/helpers/mapViewer';

describe.skipIf(process.env.MAP_PERF !== '1')('public analytics synthetic measurements', () => {
  it('retains every sample, first run, bytes and failures at each size', async () => {
    const sizes = (process.env.MAP_PERF_SIZES ?? '0,1,500,58388,100001,500000').split(',').map(Number);
    const output: unknown[] = [];
    const out = process.env.MAP_PERF_OUT ?? '.agent-runtime/map-perf';
    mkdirSync(out, { recursive: true });
    const save = () => writeFileSync(`${out}/public-analytics.json`, JSON.stringify({ mode: 'synthetic in-process Node handler; rate/auth fixture, not normal HTTP load', seed: 'index-distribution-v1', node: process.version, results: output }, null, 2));
    for (const size of sizes) {
      const facts: PrivateFact[] = Array.from({ length: size }, (_, i) => ({
        fact_identity: `synthetic-${i}`, contributor_id: `person-${i % 1000}`,
        snapshot_id: 'ingest-v1', snapshot_generation: 1,
        report_date: '2025-01-01', completed_date: `2026-${String(1 + i % 12).padStart(2, '0')}-01`,
        category: 'parking', status: i % 4 === 0 ? 'partial' : i % 4 === 1 ? 'rejected' : i % 4 === 2 ? 'completed_unknown' : 'accepted',
        disposition: i % 4 === 0 ? 'fine' : 'warning', vehicle_raw: null,
        point_key: `p-${i % 1000}`, lat: 37.5, lng: 127,
        address: `합성 예시로 ${i % 1000}`, region_code: '서울 중구',
        agency_key: `a-${i % 100}`, agency_name: `합성 기관 ${i % 100}`,
        manager_key: `m-${i % 500}`, manager_name: `합성 담당 ${i % 500}`,
        violation_law: `합성법 제${1 + i % 10}조`,
      }));
      const handler = createPublicHandler({
        getState: async () => ({ dataset_version: 'synthetic-perf-v1', ready: true, source_updated_at: null,
          generated_at: '2026-10-03T00:00:00Z', published_at: null, data_min: '2025-01-01', data_max: '2026-12-31',
          coverage_note: 'synthetic', dedupe_policy_version: 'synthetic' }),
        getFacts: async () => facts, allowRequest: async () => true,
      }, fixtureAccess());
      for (const route of (process.env.MAP_PERF_ROUTES ?? 'entities?kind=manager&,series?,dashboard?').split(',')) {
        const repeats = Number(process.env.MAP_PERF_REPEATS ?? (size >= 100001 ? 10 : 30));
        if (!Number.isInteger(repeats) || repeats < 1 || repeats > 30) throw new Error('invalid repeats');
        const samples: Array<{ ms: number; bytes: number; status: number }> = [];
        for (let j = 0; j < repeats; j++) {
          const start = performance.now();
          const response = await handler(viewerRequest(`https://local.invalid/public-analytics/${route}start=2026-01-01&end=2026-12-31&category=all&date_basis=completed_date`));
          const body = await response.text();
          samples.push({ ms: performance.now() - start, bytes: Buffer.byteLength(body), status: response.status });
          expect(response.status).toBe(200);
          const json = JSON.parse(body);
          if (route.startsWith('entities')) expect(json.total_rows).toBe(Math.min(size, 500));
          if (route.startsWith('dashboard')) expect(json.overview.report_count.value).toBe(size);
        }
        const ordered = samples.map(s => s.ms).sort((a, b) => a - b);
        output.push({ size, route, repeats, requests: repeats, transfer: 'uncompressed handler DTO; no DB transport',
          p50_ms: ordered[Math.ceil(repeats * .5) - 1], p95_ms: ordered[Math.ceil(repeats * .95) - 1], max_ms: ordered.at(-1),
          failure_rate: samples.filter(s => s.status !== 200).length / repeats, samples,
          process_rss_bytes: process.memoryUsage().rss });
        save();
        console.log(JSON.stringify({ size, route, p50_ms: ordered[Math.ceil(repeats * .5) - 1], p95_ms: ordered[Math.ceil(repeats * .95) - 1] }));
      }
    }
    save();
  }, 1800000);
});
