import {
  type RankingQuery,
  type RankingResponse,
  responseSchema,
} from "../../contracts/user-rankings/types";
import { mapAuth } from "../hooks/usePersonal";
import { PublicApiError } from "./client";
export async function loadRankings(
  query: RankingQuery,
  signal?: AbortSignal,
): Promise<RankingResponse> {
  // Literal env check (not `dataMode`) so live builds drop the synthetic rankings chunk entirely.
  if (import.meta.env.VITE_DATA_MODE === "demo") {
    const { demoRankings } = await import("./demoRankings");
    await new Promise((r) => setTimeout(r, 150));
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    return demoRankings(query);
  }
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
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== null) params.set(k, String(v));
  }
  const send = (t: string) =>
    fetch(`${base}/user-rankings?${params}`, {
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
  return responseSchema.parse(await res.json());
}
