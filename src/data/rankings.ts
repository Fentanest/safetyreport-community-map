import {
  type RankingQuery,
  type RankingResponse,
  responseSchema,
} from "../../contracts/user-rankings/types";
import {
  type BoardQuery,
  type BoardResponse,
  boardResponseSchema,
} from "../../contracts/user-rankings-board/types";
import { mapAuth } from "../hooks/usePersonal";
import { PublicApiError } from "./client";
import { parseRetryAfterHeader } from "./retryCooldown";

// ── 120초 메모리 캐시 (Astra 검수 ①, 2026-10-12) ───────────────────────────────────────────────────────────
// 계약(contracts/user-rankings/README.md): localStorage·Service Worker 금지, 로그아웃·계정 전환·pagehide 에서
// 비운다. 2026-10-12 이전에는 이 캐시가 src/pages/RankingsPage.tsx 의 모듈 전역 `memo`였고, 비우는 리스너도 그
// 컴포넌트의 effect 안에만 있었다. Dashboard는 `screen === 'rankings'`일 때만 RankingsPage 를 렌더링하므로
// (`{screen === 'rankings' && <RankingsPage .../>}`), 다른 화면으로 이동하면 컴포넌트가 완전히 unmount 돼 그
// 리스너도 사라졌다 — 랭킹을 본 뒤 지도 화면으로 이동해 로그아웃하면 캐시가 그대로 남고, 같은 계정으로 120초 안에
// 재로그인해 돌아오면 그 캐시를 다시 받을 수 있었다. 이 캐시를 이 데이터 모듈(이미 fetch 파일 허용 목록에 있다 —
// tests/product/authBoundary.test.ts)로 옮기고, 처음 쓰인 뒤로는 컴포넌트 생명주기와 무관하게 탭이 끝날 때까지
// 전역 `mapAuth` 이벤트와 `window pagehide`를 계속 듣는다. 키에는 viewer id 뿐 아니라 이 모듈이 관리하는 "로그인
// 세션 세대"(매 로그인 전환마다 — 같은 계정 재로그인도 포함 — 증가)도 넣어서, 같은 계정의 새 로그인 세션도 이전
// 세션의 캐시를 재사용하지 않는다.
export type RankingsCachePayload =
  | { kind: "board"; data: BoardResponse }
  | { kind: "list"; data: RankingResponse };
const RANKINGS_FRESH_MS = 120_000;
const RANKINGS_CACHE_LIMIT = 24;
const rankingsCache = new Map<string, { data: RankingsCachePayload; at: number }>();
let rankingsCacheWired = false;
let rankingsSessionEpoch = 0;
let rankingsLastViewer: string | null = null;

function rankingsCacheKey(viewerId: string, key: string): string {
  return `${viewerId}:${rankingsSessionEpoch}\u0000${key}`;
}

/** Wires the module-level listeners exactly once (lazily, on first actual cache use — never at import time, so
 *  importing this module never by itself loads the auth SDK or touches `window`). From then on the listeners run
 *  for the life of the tab, independent of whether RankingsPage (or any component) is currently mounted. */
function wireRankingsCacheInvalidation(): void {
  if (rankingsCacheWired) return;
  rankingsCacheWired = true;
  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", () => rankingsCache.clear());
  }
  try {
    const auth = mapAuth();
    const initial = auth.snapshot();
    rankingsLastViewer = initial.status === "signed_in" ? initial.viewerId : null;
    auth.subscribe((next) => {
      const nowViewer = next.status === "signed_in" ? next.viewerId : null;
      if (nowViewer !== rankingsLastViewer) {
        // 로그아웃, 계정 전환, 같은 계정 재로그인(새 세션) 모두 이전 캐시를 무효화한다.
        rankingsSessionEpoch += 1;
        rankingsCache.clear();
        rankingsLastViewer = nowViewer;
      }
    });
  } catch {
    // mapAuth() 는 demo 모드에서 window.location 등이 필요하다; 브라우저 밖에서는 캐시도 쓰이지 않는다.
  }
}

/** `null` when nothing is cached or the entry is stale (≥120초). Call only while signed in — `viewerId` plus this
 *  module's own session epoch scope the key (see above), so a cached answer from an earlier login session is
 *  never reused by a new one. */
export function rankingsCacheGet(viewerId: string, key: string): RankingsCachePayload | null {
  wireRankingsCacheInvalidation();
  const k = rankingsCacheKey(viewerId, key);
  const hit = rankingsCache.get(k);
  if (!hit) return null;
  if (Date.now() - hit.at >= RANKINGS_FRESH_MS) {
    rankingsCache.delete(k);
    return null;
  }
  return hit.data;
}

export function rankingsCacheSet(viewerId: string, key: string, data: RankingsCachePayload): void {
  wireRankingsCacheInvalidation();
  const k = rankingsCacheKey(viewerId, key);
  rankingsCache.delete(k);
  rankingsCache.set(k, { data, at: Date.now() });
  while (rankingsCache.size > RANKINGS_CACHE_LIMIT) rankingsCache.delete(rankingsCache.keys().next().value as string);
}

/** Explicit full clear — e.g. a 409 means every cached page/condition is stale, not just the one that answered. */
export function clearRankingsCache(): void {
  rankingsCache.clear();
}

/** One authenticated GET to the user-rankings function (list `''` or board `'/board'`). */
async function getRankings(
  path: "" | "/board",
  query: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<unknown> {
  const base = import.meta.env.VITE_PUBLIC_ANALYTICS_URL?.replace(/\/+$/, "");
  if (!base) {
    throw new PublicApiError(
      "랭킹 API가 설정되지 않았습니다.",
      503,
      null,
      "service_unavailable",
    );
  }
  const auth = mapAuth();
  await auth.settled();
  const token = await auth.accessToken();
  if (!token) {
    throw new PublicApiError(
      "카카오 로그인이 필요합니다.",
      401,
      null,
      "auth_required",
    );
  }
  const params = new URLSearchParams({ consistency: "latest" });
  for (const [k, v] of Object.entries(query)) {
    if (v !== null && v !== undefined) params.set(k, String(v));
  }
  const send = (t: string) =>
    fetch(`${base}/user-rankings${path}?${params}`, {
      signal,
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      headers: { Authorization: `Bearer ${t}` },
    });
  let res = await send(token);
  if (res.status === 401) {
    const refreshed = await auth.refreshToken();
    if (refreshed) res = await send(refreshed);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new PublicApiError(
      body?.error?.message ?? "랭킹을 불러오지 못했습니다.",
      res.status,
      parseRetryAfterHeader(res.headers.get("Retry-After")),
      body?.error?.code ?? null,
      body?.error?.details ?? null,
    );
  }
  return res.json();
}

/** Paged list of one theme/metric — the '전체 보기' sub-screen. */
export async function loadRankings(
  query: RankingQuery,
  signal?: AbortSignal,
): Promise<RankingResponse> {
  // Literal env check (not `dataMode`) so live builds drop the synthetic rankings chunk entirely.
  if (import.meta.env.VITE_DATA_MODE === "demo") {
    const { demoRankings } = await import("./demoRankings");
    await new Promise((r) => setTimeout(r, 150));
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    // demo-only counter of answered loads for browser checks (no network in demo; dev StrictMode's aborted twin is not counted)
    performance.mark("rankings-demo-list");
    return demoRankings(query);
  }
  return responseSchema.parse(await getRankings("", query, signal));
}

/** One-page board: three themes × seven metrics, top K each + own rank, in ONE request (2026-10-11). */
export async function loadRankingsBoard(
  query: BoardQuery,
  signal?: AbortSignal,
): Promise<BoardResponse> {
  if (import.meta.env.VITE_DATA_MODE === "demo") {
    const { demoRankingsBoard } = await import("./demoRankings");
    await new Promise((r) => setTimeout(r, 150));
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    performance.mark("rankings-demo-board");
    return demoRankingsBoard(query);
  }
  return boardResponseSchema.parse(await getRankings("/board", query, signal));
}
