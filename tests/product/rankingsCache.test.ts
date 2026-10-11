import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthSnapshot, MapAuth } from '../../src/auth/mapAuth';
import type { RankingResponse } from '../../contracts/user-rankings/types';

/**
 * Astra 검수 ①(2026-10-12): 랭킹 화면 밖에서 로그아웃·계정 전환하면 `src/pages/RankingsPage.tsx` 모듈 전역 `memo`가
 * 비워지지 않았다 — 캐시 비우기와 pagehide 리스너가 컴포넌트 안에만 있어, Dashboard가 `screen !== 'rankings'`일 때
 * RankingsPage 자체가 unmount되면(지도/src/pages/Dashboard.tsx:1000 `{screen === 'rankings' && <RankingsPage .../>}`)
 * 그 리스너들도 사라졌다. 이 캐시를 `src/data/rankings.ts`(이미 fetch 파일 허용 목록에 있음 — authBoundary.test.ts)로
 * 옮기고, 컴포넌트 생명주기와 무관하게 전역 `mapAuth` 이벤트·`window pagehide`에 연결한다. 세션 키는 viewer id +
 * 이 모듈이 관리하는 "로그인 세션 세대"(매 로그인 전환마다 — 같은 계정 재로그인도 — 증가)로 구성해, 같은 계정으로
 * 다시 로그인한 새 세션도 이전 세션의 캐시를 재사용하지 않는다.
 */
function fakeMapAuth(initial: AuthSnapshot) {
  let state = initial;
  const listeners = new Set<(s: AuthSnapshot) => void>();
  const auth: MapAuth = {
    snapshot: () => state,
    subscribe: (l) => { listeners.add(l); return () => listeners.delete(l); },
    signIn: async () => undefined,
    signOut: async () => undefined,
    accessToken: async () => null,
    refreshToken: async () => null,
    settled: async () => undefined,
  };
  return { auth, emit: (next: AuthSnapshot) => { state = next; for (const l of [...listeners]) l(state); } };
}

const signedIn = (viewerId: string): AuthSnapshot => ({ status: 'signed_in', displayName: null, viewerId, synthetic: false, message: null });
const signedOut: AuthSnapshot = { status: 'signed_out', displayName: null, viewerId: null, synthetic: false, message: null };

const sharedAuth = vi.hoisted(() => ({ current: null as unknown as MapAuth }));
vi.mock('../../src/hooks/usePersonal', () => ({ mapAuth: () => sharedAuth.current }));

const listPayload = (tag: string) => ({ kind: 'list' as const, data: { tag } as unknown as RankingResponse });

function installWindow() {
  const listeners = new Map<string, Set<() => void>>();
  vi.stubGlobal('window', {
    addEventListener: (type: string, listener: () => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener: (type: string, listener: () => void) => { listeners.get(type)?.delete(listener); },
  });
  return { fire: (type: string) => { for (const l of listeners.get(type) ?? []) l(); } };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('rankings module cache (app-wide, not tied to RankingsPage mount)', () => {
  it('misses when nothing is cached, then returns the same payload set moments ago for the same viewer+key', async () => {
    sharedAuth.current = fakeMapAuth(signedIn('u1')).auth;
    const { rankingsCacheGet, rankingsCacheSet } = await import('../../src/data/rankings');
    expect(rankingsCacheGet('u1', 'board:x')).toBeNull();
    const payload = listPayload('a');
    rankingsCacheSet('u1', 'board:x', payload);
    expect(rankingsCacheGet('u1', 'board:x')).toBe(payload);
  });

  it('misses for a different key or a different viewer, even with the same cache populated', async () => {
    sharedAuth.current = fakeMapAuth(signedIn('u1')).auth;
    const { rankingsCacheGet, rankingsCacheSet } = await import('../../src/data/rankings');
    rankingsCacheSet('u1', 'board:x', listPayload('a'));
    expect(rankingsCacheGet('u1', 'board:y')).toBeNull();
    expect(rankingsCacheGet('u2', 'board:x')).toBeNull();
  });

  it('expires after 120s (FRESH_MS) and is gone on the next get', async () => {
    sharedAuth.current = fakeMapAuth(signedIn('u1')).auth;
    const { rankingsCacheGet, rankingsCacheSet } = await import('../../src/data/rankings');
    rankingsCacheSet('u1', 'board:x', listPayload('a'));
    vi.setSystemTime(119_000);
    expect(rankingsCacheGet('u1', 'board:x')).not.toBeNull();
    vi.setSystemTime(120_000);
    expect(rankingsCacheGet('u1', 'board:x')).toBeNull();
  });

  it('window pagehide clears every entry, regardless of which screen/component is mounted', async () => {
    const win = installWindow();
    sharedAuth.current = fakeMapAuth(signedIn('u1')).auth;
    const { rankingsCacheGet, rankingsCacheSet } = await import('../../src/data/rankings');
    rankingsCacheSet('u1', 'board:x', listPayload('a'));
    expect(rankingsCacheGet('u1', 'board:x')).not.toBeNull();
    win.fire('pagehide'); // simulates the tab unloading/going to bfcache — never tied to RankingsPage being mounted
    expect(rankingsCacheGet('u1', 'board:x')).toBeNull();
  });

  // THE bug: logging out from a DIFFERENT screen (RankingsPage fully unmounted) must still clear the cache,
  // because this module subscribes to mapAuth directly — not through RankingsPage's own effects.
  it('a global sign-out event clears the cache even though nothing currently reads mapAuth through a mounted page', async () => {
    const sim = fakeMapAuth(signedIn('u1'));
    sharedAuth.current = sim.auth;
    const { rankingsCacheGet, rankingsCacheSet } = await import('../../src/data/rankings');
    rankingsCacheSet('u1', 'board:x', listPayload('a'));
    expect(rankingsCacheGet('u1', 'board:x')).not.toBeNull();
    sim.emit(signedOut); // the user signed out while on the map/statistics screen, not rankings
    expect(rankingsCacheGet('u1', 'board:x')).toBeNull();
  });

  it('switching accounts clears the previous account\'s entries', async () => {
    const sim = fakeMapAuth(signedIn('u1'));
    sharedAuth.current = sim.auth;
    const { rankingsCacheGet, rankingsCacheSet } = await import('../../src/data/rankings');
    rankingsCacheSet('u1', 'board:x', listPayload('a'));
    sim.emit(signedIn('u2'));
    expect(rankingsCacheGet('u1', 'board:x')).toBeNull();
    rankingsCacheSet('u2', 'board:x', listPayload('b'));
    expect(rankingsCacheGet('u2', 'board:x')).not.toBeNull();
  });

  // The subtle half of the bug report: a SAME-account re-login within the 120s window must not resurrect the
  // previous login session's cached answer (e.g. withdrawn/cancelled data the old session had cached).
  it('a re-login to the SAME account starts a fresh session — the old session\'s cache key misses', async () => {
    const sim = fakeMapAuth(signedIn('u1'));
    sharedAuth.current = sim.auth;
    const { rankingsCacheGet, rankingsCacheSet } = await import('../../src/data/rankings');
    rankingsCacheSet('u1', 'board:x', listPayload('stale-from-first-session'));
    expect(rankingsCacheGet('u1', 'board:x')).not.toBeNull();

    sim.emit(signedOut); // logout (e.g. from the map screen)
    sim.emit(signedIn('u1')); // same account, brand-new login session, still well within 120s

    // Even though the viewer id ('u1') is identical, the cache must not serve the first session's answer.
    expect(rankingsCacheGet('u1', 'board:x')).toBeNull();
    rankingsCacheSet('u1', 'board:x', listPayload('fresh-from-second-session'));
    expect(rankingsCacheGet('u1', 'board:x')).toEqual(listPayload('fresh-from-second-session'));
  });

  it('clearRankingsCache() clears explicitly (e.g. a 409 means every cached page/condition is stale)', async () => {
    sharedAuth.current = fakeMapAuth(signedIn('u1')).auth;
    const { clearRankingsCache, rankingsCacheGet, rankingsCacheSet } = await import('../../src/data/rankings');
    rankingsCacheSet('u1', 'board:x', listPayload('a'));
    rankingsCacheSet('u1', 'list:y', listPayload('b'));
    clearRankingsCache();
    expect(rankingsCacheGet('u1', 'board:x')).toBeNull();
    expect(rankingsCacheGet('u1', 'list:y')).toBeNull();
  });

  it('wiring never throws when mapAuth() itself throws (e.g. unconfigured outside a browser)', async () => {
    sharedAuth.current = {
      snapshot: () => { throw new Error('unconfigured'); },
    } as unknown as MapAuth;
    const { rankingsCacheGet, rankingsCacheSet } = await import('../../src/data/rankings');
    expect(() => rankingsCacheSet('u1', 'board:x', listPayload('a'))).not.toThrow();
    expect(() => rankingsCacheGet('u1', 'board:x')).not.toThrow();
  });
});
