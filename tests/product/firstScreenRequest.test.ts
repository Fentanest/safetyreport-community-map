/**
 * U-perf-first-screen (2026-10-12): the login dashboard's first screen used to run the heavy screen RPC TWICE —
 * once with panels=[] (screenCoordinator.ts open()), then again with panels=[entities, laws, compare] once
 * Dashboard.tsx learned personal comparison was active (astra-perf-review.md). firstScreenPanels() (Dashboard.tsx)
 * now decides, WITHOUT the dashboard's own data, whether the FIRST request should already carry the compare
 * panel; ScreenCoordinator.open()'s new `initialPanels` argument bundles it into that same request.
 *
 * These tests assert the request COUNT and the PANELS actually sent, with a fake transport (no network) — the
 * eligible scenario must see exactly one transport call, and a later panel('compare') must reuse that frame
 * instead of starting a second one.
 */
import { describe, expect, it } from 'vitest';
import { firstScreenPanels } from '../../src/pages/Dashboard';
import { ScreenCoordinator, type ScreenPanel } from '../../src/data/screenCoordinator';
import { demoEngineDashboard } from '../../src/data/demoEngine';
import { DEMO_SCOPE } from '../../src/domain/public';
import type { AuthStatus } from '../../src/auth/mapAuth';

const scope = DEMO_SCOPE;
const base = { screen: 'dashboard' as const, compareOn: true, compareDisabledReason: null as string | null, briefingHidden: false };
const COMPARE_PANEL: ScreenPanel = { id: 'compare', path: 'compare', params: {} };

describe('firstScreenPanels — U-perf-first-screen decision (no dashboard data needed)', () => {
  it('로그인 + 비교 가능 사용자: compare 패널을 첫 요청에 포함한다', () => {
    expect(firstScreenPanels({ ...base, authStatus: 'signed_in' })).toEqual([COMPARE_PANEL]);
  });
  it('비로그인(signed_out/loading/error/unconfigured): compare 없이', () => {
    for (const authStatus of ['signed_out', 'loading', 'error', 'unconfigured'] as AuthStatus[]) {
      expect(firstScreenPanels({ ...base, authStatus })).toEqual([]);
    }
  });
  it('비교 토글이 꺼져 있으면(자격이 있어도) compare 없이', () => {
    expect(firstScreenPanels({ ...base, compareOn: false, authStatus: 'signed_in' })).toEqual([]);
  });
  it('이 배포에 로그인 기능이 없으면(compareDisabledReason) compare 없이', () => {
    expect(firstScreenPanels({ ...base, compareDisabledReason: '지금은 로그인 기능을 쓸 수 없습니다.', authStatus: 'signed_in' })).toEqual([]);
  });
  it('여럿이 보는 브리핑 모드(briefingHidden)에서는 compare 없이', () => {
    expect(firstScreenPanels({ ...base, briefingHidden: true, authStatus: 'signed_in' })).toEqual([]);
  });
  it('대시보드 화면이 아니면(통계/랭킹) compare 없이', () => {
    expect(firstScreenPanels({ ...base, screen: 'statistics', authStatus: 'signed_in' })).toEqual([]);
    expect(firstScreenPanels({ ...base, screen: 'rankings', authStatus: 'signed_in' })).toEqual([]);
  });
});

describe('ScreenCoordinator.open(initialPanels) — one RPC for the first screen', () => {
  it('로그인 + 비교 가능: one transport call carries panels=[compare]; a later panel("compare") reuses it (no 2nd RPC)', async () => {
    let calls = 0;
    const seen: ScreenPanel[][] = [];
    const coordinator = new ScreenCoordinator(async (s, panels) => {
      calls++; seen.push(panels);
      const data = demoEngineDashboard(s); data.meta.dataset_version = `v${calls}`;
      return { data, panels: panels.map(p => ({ id: p.id, status: 200 as const, body: { dataset_version: data.meta.dataset_version, scope: s } })) };
    });
    const panels = firstScreenPanels({ ...base, authStatus: 'signed_in' });
    await coordinator.open(scope, undefined, panels);
    expect(calls).toBe(1);
    expect(seen).toEqual([[COMPARE_PANEL]]);
    // Dashboard's usePersonalCompare effect fires once `data`/`version` exist and asks for the SAME panel —
    // this must be answered from the already-bundled frame, never a second screen RPC.
    const result = await coordinator.panel(scope, COMPARE_PANEL);
    expect(calls).toBe(1); // still one — the whole point of the fix
    expect(result.status).toBe(200);
  });
  it('비로그인: one transport call carries panels=[] (unchanged from before)', async () => {
    let calls = 0;
    const seen: ScreenPanel[][] = [];
    const coordinator = new ScreenCoordinator(async (s, panels) => {
      calls++; seen.push(panels);
      return { data: demoEngineDashboard(s), panels: [] };
    });
    const panels = firstScreenPanels({ ...base, authStatus: 'signed_out' });
    await coordinator.open(scope, undefined, panels);
    expect(calls).toBe(1);
    expect(seen).toEqual([[]]);
  });
  it('로그인했지만 비교 자격 없음(서버가 compare를 에러로 답함): 여전히 한 번의 RPC, 화면에는 compare가 보이지 않는다', async () => {
    let calls = 0;
    const coordinator = new ScreenCoordinator(async (s, panels) => {
      calls++;
      const data = demoEngineDashboard(s);
      // the server answers the bundled compare panel with an error (e.g. under 10 reports) in the SAME response
      return { data, panels: panels.map(p => ({ id: p.id, status: 403 as const, body: { error: { code: 'upload_required', message: 'x' } } })) };
    });
    const panels = firstScreenPanels({ ...base, authStatus: 'signed_in' }); // toggle on, signed in, but server will refuse
    await coordinator.open(scope, undefined, panels);
    expect(calls).toBe(1);
    const result = await coordinator.panel(scope, COMPARE_PANEL);
    expect(calls).toBe(1);
    expect(result.status).toBe(403);
  });
  it('계정 전환: 새 세션의 첫 요청도 그 세션의 자격으로 한 번에 묶인다', async () => {
    let calls = 0;
    const seen: ScreenPanel[][] = [];
    const coordinator = new ScreenCoordinator(async (s, panels) => {
      calls++; seen.push(panels);
      const data = demoEngineDashboard(s); data.meta.dataset_version = `v${calls}`;
      return { data, panels: panels.map(p => ({ id: p.id, status: 200 as const, body: { dataset_version: data.meta.dataset_version, scope: s } })) };
    });
    await coordinator.open(scope, undefined, firstScreenPanels({ ...base, authStatus: 'signed_in' })); // account A, eligible
    expect(seen).toEqual([[COMPARE_PANEL]]);
    // C01 account boundary: useDashboardData calls screenCoordinator.reset() on a session change, then opens again
    coordinator.reset();
    await coordinator.open(scope, undefined, firstScreenPanels({ ...base, compareOn: false, authStatus: 'signed_in' })); // account B, toggle off
    expect(calls).toBe(2);
    expect(seen).toEqual([[COMPARE_PANEL], []]);
  });
  it('취소(abort): initialPanels가 있어도 버려진 scope 전환은 기존처럼 AbortError로 거부된다', async () => {
    let calls = 0; let release!: () => void;
    const coordinator = new ScreenCoordinator(async (s, panels) => {
      if (++calls === 2) await new Promise<void>(resolve => { release = resolve; });
      const data = demoEngineDashboard(s); data.meta.dataset_version = `v${calls}`;
      return { data, panels: panels.map(p => ({ id: p.id, status: 200 as const, body: { dataset_version: data.meta.dataset_version, scope: s } })) };
    });
    await coordinator.open(scope, undefined, firstScreenPanels({ ...base, authStatus: 'signed_in' }));
    const ac = new AbortController();
    const moving = coordinator.open({ ...scope, category: 'parking' }, ac.signal, firstScreenPanels({ ...base, authStatus: 'signed_in' }));
    const rejected = expect(moving).rejects.toMatchObject({ name: 'AbortError' });
    ac.abort(); release();
    await rejected;
    expect(coordinator.matches(scope)).toBe(true); // restored the still-displayed frame, exactly as before
  });
});
