import { describe, expect, it } from 'vitest';
import { createMyReportsHandler } from '../../server/myReportsHandler.ts';

const UID = '11111111-1111-4111-8111-111111111111';
const SESSION = '22222222-2222-4222-8222-222222222222';
const token = ['header', Buffer.from(JSON.stringify({ sub: UID, role: 'authenticated', aud: 'authenticated',
  session_id: SESSION, is_anonymous: false })).toString('base64url'), 'signature'].join('.');
const origin = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';

function setup() {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const handler = createMyReportsHandler({ enabled: true, allowedOrigins: [origin], jwtIssuer: null,
    getUser: async () => ({ id: UID, isAnonymous: false }),
    rpc: async (name, args) => {
      calls.push({ name, args });
      return name === 'internal_community_ingest_rate_limit' ? true :
        { version: 'a'.repeat(32), total: 1, missing_numbers: 0, items: [{ report_number: 'SPP-2026-123456' }] };
    },
  });
  const request = (route: string, body: unknown, authorization = `Bearer ${token}`, requestOrigin = origin) =>
    new Request(`https://project.supabase.co/functions/v1/my-reports/${route}`, { method: 'POST',
      headers: { origin: requestOrigin, authorization, 'content-type': 'application/json' },
      body: JSON.stringify(body) });
  return { handler, request, calls };
}

describe('my-reports Edge handler', () => {
  it('uses verified UID and a normalized six-character partial search', async () => {
    const { handler, request, calls } = setup();
    const res = await handler(request('search', { kind: 'vehicle', query: ' 경기 76자3623 ', user_id: 'other' }));
    expect(res.status).toBe(400);
    const good = await handler(request('search', { kind: 'vehicle', query: ' 경기 76자3623 ' }));
    expect(good.status).toBe(200);
    expect(good.headers.get('cache-control')).toContain('no-store');
    expect(calls.at(-1)?.args).toMatchObject({ p_user: UID, p_session: SESSION, p_query: '경기76자3623' });
  });
  it('rejects 0–5 characters before RPC, and does not trust a user ID', async () => {
    const { handler, request, calls } = setup();
    expect((await handler(request('search', { kind: 'vehicle', query: '12가34' }))).status).toBe(400);
    expect(calls).toHaveLength(0);
    expect((await handler(request('summary', { user_id: UID }))).status).toBe(400);
  });
  it('requires verified bearer and approved extension origin', async () => {
    const { handler, request } = setup();
    expect((await handler(request('summary', {}, 'Bearer fake'))).status).toBe(401);
    expect((await handler(request('summary', {}, `Bearer ${token}`, 'https://evil.example'))).status).toBe(403);
    expect((await handler(request('numbers', { kind: 'vehicle', query: '경기76자3623' }))).status).toBe(200);
  });
  it('bounds request bodies and never forwards fields outside the allowlist', async () => {
    const { handler, request, calls } = setup();
    const huge = await handler(request('search', { kind: 'address', query: '가상시 '.repeat(1000) }));
    expect(huge.status).toBe(400);
    expect(calls).toHaveLength(0);
    const clean = await handler(request('search', { kind: 'address', query: ' 가상시   예시구 테스트로 12 ' }));
    expect(clean.status).toBe(200);
    expect(calls.at(-1)?.args.p_query).toBe('가상시 예시구 테스트로 12');
  });
});
