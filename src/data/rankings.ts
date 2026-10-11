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
      Number(res.headers.get("Retry-After")) || null,
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
