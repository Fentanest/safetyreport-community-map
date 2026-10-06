/** Synthetic handler-only measurement. No database/hosted Edge claim; opt-in, never a 0-test pass. */
import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createScreenHandler } from '../../server/screenHandler';
import { createPublicHandler } from '../../server/publicHandler';
import { aggregateCompare } from '../../server/compare';
import { demoFacts, demoMeta, DEMO_VIEWER_ID } from '../../src/data/demoEngine';
import { todayKst } from '../../server/aggregate';
import { DEMO_SCOPE } from '../../src/domain/public';
import { fixtureAccess, viewerRequest } from './helpers/mapViewer';
import { dashboardResponseSchema, entitiesResponseSchema, lawsResponseSchema } from '../../src/data/schema';
import { personalCompareSchema } from '../../src/data/personal';

// Same twelve-month screen plus equal previous period, 30k rows; synthetic identity/coordinates only.
const scope = { ...DEMO_SCOPE, date_basis: 'completed_date' as const, start: '2025-10-07', end: '2026-10-06' };
const panels = [
  { id: 'entities', path: 'entities', params: { kind: 'agency' } },
  { id: 'laws', path: 'laws', params: {} },
  { id: 'compare', path: 'compare', params: {} },
];
const q = new URLSearchParams({ date_basis: scope.date_basis, start: scope.start, end: scope.end, category: scope.category });
const state = { ...demoMeta(), ready: true, coverage_note: 'synthetic handler-only measurement', dedupe_policy_version: 'contribution-dedupe-v1' };
const viewer = { user_ok: true, kakao: true, session: true, contributor: 'active' as const, has_public_facts: true, public_fact_count: 1000 };
const session = '11111111-2222-4333-8444-555555555555';
const token = `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: DEMO_VIEWER_ID, role: 'authenticated', aud: 'authenticated', session_id: session })).toString('base64url')}.sig`;

describe.skipIf(process.env.SCREEN_TIMEOUT_MEASURE !== '1')('30000-fact screen handler measurement (no DB)', () => {
  it('measures serialization/CPU and checks exact dashboard/table/compare parity with standalone handlers', async () => {
    const examples = demoFacts();
    const facts = Array.from({ length: 30000 }, (_, i) => {
      const date = new Date(Date.UTC(2024, 9, 7 + i % 730)).toISOString().slice(0, 10);
      return { ...examples[i % examples.length], fact_identity: `synthetic-screen-${i}`,
        source_report_key: `synthetic-key-${i}`, report_identity: `synthetic-identity-${i}`,
        report_date: date, completed_date: date, identity_report_date: date, identity_completed_date: date,
        is_representative: true };
    });
    const source = { state, viewer, facts };
    const payload = JSON.stringify(source);
    expect(Buffer.byteLength(payload)).toBeGreaterThan(17_000_000);
    const parseStart = performance.now(); const parsed = JSON.parse(payload); const parseMs = performance.now() - parseStart;
    const handler = createScreenHandler({ enabled: true, allowedOrigins: [], jwtIssuer: null,
      getUser: async () => ({ id: DEMO_VIEWER_ID, isAnonymous: false }),
      rpc: async name => name.endsWith('rate_limit') ? true : parsed });
    const measurements = [];
    let body: any;
    for (let run = 1; run <= 3; run++) {
      const start = performance.now(), cpu = process.cpuUsage();
      const response = await handler(new Request(`https://local.invalid/my-analytics/screen?${q}&panels=${encodeURIComponent(JSON.stringify(panels))}`,
        { headers: { Authorization: `Bearer ${token}` } }));
      const text = await response.text(); const elapsed = performance.now() - start;
      const used = process.cpuUsage(cpu);
      expect(response.status).toBe(200); body = JSON.parse(text);
      measurements.push({ run, handler_wall_ms: elapsed, cpu_ms: (used.user + used.system) / 1000, public_bytes: Buffer.byteLength(text) });
    }
    dashboardResponseSchema.parse(body.dashboard);
    entitiesResponseSchema.parse(body.panels[0].body); lawsResponseSchema.parse(body.panels[1].body);
    personalCompareSchema.parse(body.panels[2].body);
    const standalone = createPublicHandler({ getState: async () => state, getFacts: async () => facts,
      allowRequest: async () => true }, fixtureAccess());
    const priorStart = performance.now();
    const prior = await standalone(viewerRequest(`https://local.invalid/public-analytics/dashboard?${q}`));
    expect(prior.status).toBe(200);
    const priorBody = await prior.json(); const publicDashboardMs = performance.now() - priorStart;
    expect(body.dashboard).toEqual(priorBody);
    for (const p of panels.slice(0, 2)) {
      const params = new URLSearchParams(q);
      for (const [k, v] of Object.entries(p.params)) params.set(k, v);
      const result = await standalone(viewerRequest(`https://local.invalid/public-analytics/${p.path}?${params}`));
      expect(result.status).toBe(200);
      expect(body.panels.find((r: any) => r.id === p.id).body).toEqual(await result.json());
    }
    expect(body.panels[2].body).toEqual(aggregateCompare(facts, scope, DEMO_VIEWER_ID, {
      datasetVersion: state.dataset_version, asOf: state.data_max || scope.end, dataMin: state.data_min,
      basisBounds: state.basis_bounds ?? null, today: todayKst(), viewer: { contributor: viewer.contributor, has_public_facts: true },
    }));
    const out = process.env.SCREEN_TIMEOUT_OUT ?? '.agent-runtime/screen-timeout-handler.json';
    mkdirSync(out.slice(0, out.lastIndexOf('/')), { recursive: true });
    writeFileSync(out, JSON.stringify({ mode: 'synthetic Node handler only; RPC stub; NOT database or hosted Edge',
      node: process.version, facts: facts.length, db_sql_ms: null, source_bytes: Buffer.byteLength(payload),
      source_characters: payload.length, source_parse_ms: parseMs, standalone_public_dashboard_ms: publicDashboardMs,
      parity: { dashboard: true, entities: true, laws: true, compare: true }, measurements }, null, 2) + '\n');
  }, 120000);
});
