import { describe, expect, it } from 'vitest';
import { sessionKeyOf, viewerKey } from '../../src/auth/mapAuth';
import { RefreshController } from '../../src/data/refreshController';
import type { DashboardData, PublicMeta, Scope } from '../../src/domain/public';

/** C01: the page's account boundary is the auth user id, never the nickname. */
describe('C01 session key', () => {
  it('two accounts with the same nickname get different keys; the nickname is not part of the key', () => {
    const a = sessionKeyOf({ status: 'signed_in', viewerId: '11111111-aaaa-4aaa-8aaa-000000000001' }, 'overview');
    const b = sessionKeyOf({ status: 'signed_in', viewerId: '22222222-bbbb-4bbb-8bbb-000000000002' }, 'overview');
    expect(a).not.toBe(b);
    // the key never carries the raw id (it is a hash) nor a nickname
    expect(a).not.toContain('11111111');
  });
  it('the same account keeps its key across a nickname change or token refresh; loading has no key', () => {
    const id = '33333333-cccc-4ccc-8ccc-000000000003';
    expect(sessionKeyOf({ status: 'signed_in', viewerId: id }, 'x')).toBe(sessionKeyOf({ status: 'signed_in', viewerId: id }, 'x'));
    expect(sessionKeyOf({ status: 'loading', viewerId: id }, 'x')).toBeNull();
    expect(sessionKeyOf({ status: 'signed_out', viewerId: null }, 'x')).toBe('signed_out|none|x');
    expect(viewerKey(id)).toMatch(/^[0-9a-f]{16}$/);
    expect(viewerKey(null)).toBe('none');
  });
});

describe('C01 controller reset fences late answers', () => {
  it("account A's metadata / dashboard answer arriving after the reset for B never lands", async () => {
    const scope: Scope = { date_basis: 'completed_date' as const, start: '2026-01-01', end: '2026-01-31', category: 'all', region_code: null, agency_key: null, manager_key: null, bbox: null, law: null };
    const meta = { dataset_version: 'vA' } as PublicMeta;
    let releaseMeta!: (m: PublicMeta) => void;
    let calls = 0;
    const c = new RefreshController({
      fetchMeta: () => { calls++; return calls === 1 ? new Promise((r) => { releaseMeta = r; }) : Promise.resolve({ dataset_version: 'vB' } as PublicMeta); },
      fetchDashboard: async (m, s) => ({ meta: m, scope: s } as unknown as DashboardData),
      now: () => 0, setTimer: (fn) => setTimeout(fn, 0), clearTimer: (id) => clearTimeout(id as number),
    });
    c.request(scope, 'initial');
    c.reset(); // account switch while A's metadata is still on the wire
    releaseMeta(meta);
    await new Promise((r) => setTimeout(r, 0));
    expect(c.snapshot().meta).toBeNull();
    expect(c.snapshot().displayed).toBeNull();
    c.request(scope, 'initial');
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
    expect(c.snapshot().meta?.dataset_version).toBe('vB');
    expect(c.snapshot().displayed?.version).toBe('vB');
  });
});
